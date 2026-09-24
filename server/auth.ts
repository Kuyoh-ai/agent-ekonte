// auth.ts: how the agents authenticate. The user picks it explicitly per project (Step 1):
//   subscription: the Claude Code login on this machine (Pro / Max / Team plans). API keys in the environment are removed.
//   apiKey:       an Anthropic API key (pay as you go). Saved outside the projects folder, never committed.
import { query, type AccountInfo, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type AuthMode = 'unset' | 'subscription' | 'apiKey';

export const CONFIG_DIR = process.env.STUDIO_CONFIG_DIR || join(homedir(), '.agent-video-studio');
const SETTINGS = join(CONFIG_DIR, 'settings.json');

function readSettings(): { apiKey?: string } {
  try { return JSON.parse(readFileSync(SETTINGS, 'utf8')); } catch { return {}; }
}
export function saveApiKey(key: string | null) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const s = readSettings();
  if (key) s.apiKey = key.trim(); else delete s.apiKey;
  writeFileSync(SETTINGS, JSON.stringify(s, null, 2));
  try { chmodSync(SETTINGS, 0o600); } catch { /* Windows */ }
}
const mask = (k: string) => `${k.slice(0, 7)}…${k.slice(-4)}`;
export function keyStatus() {
  const saved = readSettings().apiKey, env = process.env.ANTHROPIC_API_KEY;
  return { saved: saved ? mask(saved) : null, env: env ? mask(env) : null, file: existsSync(SETTINGS) ? SETTINGS : null };
}

// When the studio is started from inside a Claude Code session, that session's identity variables would leak into
// the agents (shared session ids, inherited effort, auto-backgrounding). Drop them; keep proxies and the rest.
const SESSION_VARS = ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_REMOTE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_PID',
  'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_ADDITIONAL_DIRECTORIES', 'CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD', 'CLAUDE_AFTER_LAST_COMPACT', 'CLAUDE_EFFORT'];

export class AuthError extends Error {}

// Environment for the agent process, so the chosen method is the one that is actually used.
export function agentEnv(mode: AuthMode): Record<string, string | undefined> {
  if (mode === 'unset') throw new AuthError('Claude の接続方法が未設定です。Step 1（ブリーフ）の「Claude の接続」で選んでください。');
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of SESSION_VARS) delete env[k];
  if (mode === 'subscription') {
    delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
  } else {
    const key = readSettings().apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new AuthError('API キーが設定されていません。Step 1 の「Claude の接続」でキーを保存してください。');
    env.ANTHROPIC_API_KEY = key;
    delete env.ANTHROPIC_AUTH_TOKEN; delete env.CLAUDE_CODE_OAUTH_TOKEN;
  }
  return env;
}

export interface AuthCheck { ok: boolean; mode: AuthMode; summary: string; account?: AccountInfo; error?: string }

export function describeAccount(mode: AuthMode, a: AccountInfo): string {
  if (mode === 'apiKey') return `API キー（従量課金）${a.organization ? ` · ${a.organization}` : ''}`;
  const plan = a.subscriptionType ? `${a.subscriptionType} プラン` : 'サブスクリプション';
  const note = /api/i.test(a.subscriptionType || '') ? '（注意: サブスクリプションではなく API として認証されています）' : '';
  return `${plan}${a.email ? ` · ${a.email}` : ''}${note}`;
}

// Start the agent process without sending any prompt (no tokens are used) and ask who it is signed in as.
export async function checkAuth(mode: AuthMode): Promise<AuthCheck> {
  let env; try { env = agentEnv(mode); } catch (e) { return { ok: false, mode, summary: '', error: (e as Error).message }; }
  let release!: () => void; const hold = new Promise<void>(r => { release = r; });
  async function* idle(): AsyncGenerator<SDKUserMessage> { await hold; }
  const abort = new AbortController();
  const q = query({ prompt: idle(), options: { env, settingSources: [], tools: [], abortController: abort, persistSession: false } });
  try {
    const account = await Promise.race([q.accountInfo(), new Promise<never>((_, bad) => setTimeout(() => bad(new Error('30 秒以内に応答がありませんでした')), 30000))]);
    const signedIn = mode === 'apiKey' ? account.apiKeySource !== 'none' : !!(account.email || account.subscriptionType || account.tokenSource);
    if (!signedIn) return { ok: false, mode, account, summary: '', error: mode === 'subscription'
      ? 'Claude Code にログインしていません。ターミナルで `claude` を起動して /login でログインしてから、もう一度確認してください。'
      : 'API キーが認識されませんでした。' };
    return { ok: true, mode, account, summary: describeAccount(mode, account) };
  } catch (e) {
    return { ok: false, mode, summary: '', error: (e as Error).message };
  } finally {
    release(); abort.abort(); try { q.close(); } catch { /* already closed */ }
  }
}

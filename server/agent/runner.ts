// runner.ts: runs one Claude agent task for a project with the Claude Agent SDK and streams it to the GUI.
import { query, type CanUseTool, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { appendFile, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { ENGINE_DIR, ROOT_DIR } from '../../engine/tools.mjs';
import { publish, projectChanged, type ChatEntry } from '../events.ts';
import * as git from '../git.ts';
import { loadBrief, loadProject, loadStoryboard, projectDir, updateProject, HttpError } from '../store.ts';
import { openComments, projectContext, subagents, systemAppend, taskPrompt, type AgentTask } from './prompts.ts';
import { studioServer } from './tools.ts';
import { runMock } from './mock.ts';

export const MOCK = process.env.STUDIO_MOCK === '1';

interface Run { id: string; task: AgentTask; abort: AbortController; startedAt: number }
const running = new Map<string, Run>();
export const currentRun = (slug: string) => running.get(slug) || null;

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Which session each task continues: review continues itself, retakes continue the production session.
const sessionKey = (task: AgentTask) => (task === 'retake' ? 'build' : task);
const resumes = (task: AgentTask) => task === 'review' || task === 'retake';

export async function chatHistory(slug: string): Promise<ChatEntry[]> {
  try {
    const raw = await readFile(join(projectDir(slug), '.studio', 'chat.jsonl'), 'utf8');
    return raw.split('\n').filter(Boolean).map(l => JSON.parse(l) as ChatEntry);
  } catch { return []; }
}

// ---------- permissions: agents may read the project and the engine, and write only what their task needs ----------
function policy(dir: string, task: AgentTask, onDeny: (msg: string) => void): CanUseTool {
  const readRoots = [dir, ENGINE_DIR, join(ROOT_DIR, 'examples')];
  const inside = (p: string, root: string) => { const r = relative(root, p); return !r.startsWith('..') && !isAbsolute(r); };
  const abs = (p: unknown) => (typeof p === 'string' && p ? resolve(dir, p) : null);
  const managed = new Set(['project.json', 'brief.json', 'storyboard.json', 'captions.json'].map(f => join(dir, f)));
  const canWrite = (p: string) => {
    if (!inside(p, dir) || managed.has(p) || inside(p, join(dir, '.git')) || inside(p, join(dir, '.studio'))) return false;
    const rel = relative(dir, p).replace(/\\/g, '/');
    if (task === 'plan' || task === 'review') return rel === 'style.md';
    if (task === 'drafts') return /^drafts\/[^/]+\.svg$/.test(rel);
    return true; // build / retake: code, assets, style tweaks
  };
  return async (toolName, input) => {
    if (toolName.startsWith('mcp__studio__') || ['Agent', 'TodoWrite'].includes(toolName)) return { behavior: 'allow', updatedInput: input };
    if (['Read', 'Glob', 'Grep'].includes(toolName)) {
      const p = abs(input.file_path ?? input.path);
      if (!p || readRoots.some(r => inside(p, r))) return { behavior: 'allow', updatedInput: input };
      onDeny(`プロジェクト外の読み込みをブロックしました: ${String(input.file_path ?? input.path)}`);
      return { behavior: 'deny', message: 'Reading outside the project and engine folders is not allowed.' };
    }
    if (['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
      const p = abs(input.file_path);
      if (p && canWrite(p)) return { behavior: 'allow', updatedInput: input };
      const hint = task === 'plan' || task === 'review' ? 'In this step you may only write style.md; change the storyboard with the mcp__studio__ tools.'
        : task === 'drafts' ? 'In this step you may only write drafts/<shotId>.svg files.' : 'Write only inside the project folder (not project.json, brief.json, storyboard.json or captions.json).';
      onDeny(`この工程では許可されていない書き込みをブロックしました: ${p ? relative(dir, p) : '?'}`);
      return { behavior: 'deny', message: hint };
    }
    onDeny(`${toolName} の使用をブロックしました`);
    return { behavior: 'deny', message: `${toolName} is not available in Agent Video Studio. Use render_sheet to check renders.` };
  };
}

const BUILTIN: Record<AgentTask, string[]> = {
  plan: ['Read', 'Write', 'Glob', 'Grep'],
  review: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
  drafts: ['Read', 'Write', 'Glob', 'Agent'],
  build: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Agent', 'TodoWrite'],
  retake: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite'],
};

function toolSummary(name: string, input: Record<string, unknown>, dir: string): string {
  const rel = (p: unknown) => (typeof p === 'string' ? relative(dir, resolve(dir, p)).replace(/\\/g, '/') : '');
  switch (name) {
    case 'Read': return `読み込み ${rel(input.file_path)}`;
    case 'Write': return `書き込み ${rel(input.file_path)}`;
    case 'Edit': case 'MultiEdit': return `編集 ${rel(input.file_path)}`;
    case 'Glob': case 'Grep': return `検索 ${String(input.pattern ?? '')}`;
    case 'Agent': return `サブエージェント起動: ${String(input.description ?? input.subagent_type ?? '')}`;
    case 'TodoWrite': return 'やることリストを更新';
    case 'mcp__studio__save_storyboard': return 'ストーリーボードを保存';
    case 'mcp__studio__update_shots': return 'ショットを更新';
    case 'mcp__studio__resolve_comments': return 'コメントに返信';
    case 'mcp__studio__set_shot_status': return `状態を「${String(input.status)}」に: ${(input.shotIds as string[] | undefined)?.join(', ') ?? ''}`;
    case 'mcp__studio__view_drafts': return 'ラフ絵コンテを確認';
    case 'mcp__studio__render_sheet': return `レンダリング確認 ${(input.times as number[] | undefined)?.map(t => t + 's').join(', ') ?? ''}`;
    default: return name;
  }
}

export async function startRun(slug: string, task: AgentTask, message: string, opts: { shotIds?: string[] } = {}) {
  if (running.has(slug)) throw new HttpError(409, 'Claude はすでにこのプロジェクトで作業中です');
  const dir = projectDir(slug);
  const run: Run = { id: newId(), task, abort: new AbortController(), startedAt: Date.now() };
  running.set(slug, run);
  publish(slug, { type: 'agent-state', running: true, runId: run.id, task });

  const record = async (e: Omit<ChatEntry, 'id' | 'at' | 'task'>) => {
    const entry: ChatEntry = { id: newId(), at: new Date().toISOString(), task, ...e };
    await appendFile(join(dir, '.studio', 'chat.jsonl'), JSON.stringify(entry) + '\n').catch(() => {});
    publish(slug, { type: 'agent', runId: run.id, task, entry });
  };

  (async () => {
    let cost = 0;
    try {
      if (message.trim()) await record({ role: 'user', text: message.trim() });
      await git.commit(dir, `Claude 作業前の保存 (${task})`);
      const [project, brief, sb] = await Promise.all([loadProject(slug), loadBrief(slug), loadStoryboard(slug)]);
      const comments = openComments(sb);
      const prompt = taskPrompt(task, projectContext(project, brief, sb), message, { comments, shotIds: opts.shotIds, engineDir: ENGINE_DIR });

      if (MOCK) { cost = await runMock(slug, task, record, run.abort.signal, opts.shotIds); }
      else {
        const model = task === 'plan' || task === 'review' ? project.models.planning : task === 'drafts' ? project.models.drafts : project.models.production;
        const key = sessionKey(task), resume = resumes(task) ? project.sessions[key] : undefined;
        const q = query({
          prompt,
          options: {
            cwd: dir,
            additionalDirectories: [ENGINE_DIR, join(ROOT_DIR, 'examples')],
            model,
            effort: project.effort,
            ...(project.budgetUsd > 0 ? { maxBudgetUsd: project.budgetUsd } : {}),
            ...(resume ? { resume } : {}),
            systemPrompt: { type: 'preset', preset: 'claude_code', append: systemAppend(task, ENGINE_DIR) },
            settingSources: [],
            tools: BUILTIN[task],
            mcpServers: { studio: studioServer(slug, task) },
            canUseTool: policy(dir, task, msg => { record({ role: 'system', text: msg }); }),
            agents: task === 'drafts' || task === 'build' ? subagents(ENGINE_DIR, project.models) : undefined,
            abortController: run.abort,
            stderr: (d: string) => { if (/error/i.test(d)) console.error('[agent]', d.trim()); },
          },
        });
        for await (const m of q as AsyncIterable<SDKMessage>) {
          if (m.type === 'system' && m.subtype === 'init' && m.session_id && project.sessions[key] !== m.session_id) {
            await updateProject(slug, p => { p.sessions[key] = m.session_id; });
          }
          if (m.type === 'assistant') {
            const sub = m.parent_tool_use_id ? 'サブエージェント' : undefined;
            for (const block of m.message.content) {
              if (block.type === 'text' && block.text.trim() && !sub) await record({ role: 'assistant', text: block.text });
              if (block.type === 'tool_use') await record({ role: 'tool', text: toolSummary(block.name, block.input as Record<string, unknown>, dir), sub });
            }
          }
          if (m.type === 'user' && Array.isArray(m.message.content) && m.message.content.some(b => typeof b === 'object' && b.type === 'tool_result')) projectChanged(slug, 'agent');
          if (m.type === 'result') {
            cost = m.total_cost_usd || 0;
            if (m.subtype !== 'success') await record({ role: 'error', text: m.subtype === 'error_max_budget_usd' ? '予算の上限に達したため停止しました。' : `エラーで停止しました: ${m.errors?.join(' / ') || m.subtype}` });
          }
        }
      }
      await record({ role: 'result', text: '完了', costUsd: cost });
    } catch (e) {
      const aborted = run.abort.signal.aborted;
      await record({ role: aborted ? 'system' : 'error', text: aborted ? '停止しました' : explainError(e as Error) });
    } finally {
      if (cost) await updateProject(slug, p => { p.costUsd = Math.round((p.costUsd + cost) * 10000) / 10000; }).catch(() => {});
      await git.commit(dir, `Claude: ${labelOf(task)}`);
      running.delete(slug);
      publish(slug, { type: 'agent-state', running: false, runId: run.id, task, costUsd: cost });
      projectChanged(slug, 'agent-done', 0);
    }
  })();
  return run.id;
}

export function stopRun(slug: string) {
  const r = running.get(slug); if (!r) return false;
  r.abort.abort(); return true;
}

const labelOf = (t: AgentTask) => ({ plan: '構成案', review: 'レビュー反映', drafts: 'ラフ絵コンテ', build: '本制作', retake: 'リテイク' })[t];

function explainError(e: Error) {
  const msg = e.message || String(e);
  if (/auth|login|api key|401|credential/i.test(msg)) return `Claude に接続できませんでした（認証エラー）。ターミナルで \`claude\` にログインするか、ANTHROPIC_API_KEY を設定してからサーバーを再起動してください。\n詳細: ${msg}`;
  return `エラー: ${msg}`;
}

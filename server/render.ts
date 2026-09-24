// render.ts: runs engine/render.mjs as a child process: check sheets for the agents, and the export job for the GUI.
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { ENGINE_DIR } from '../engine/tools.mjs';
import { publish } from './events.ts';

interface RenderMsg { type: string; message?: string; done?: number; total?: number; etaSec?: number; msPerFrame?: number; out?: string; ms?: number[] }

function runRender(dir: string, args: string[], onMsg: (m: RenderMsg) => void) {
  const child = spawn(process.execPath, [join(ENGINE_DIR, 'render.mjs'), `--project=${dir}`, '--json', ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '', errTail = '';
  child.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.startsWith('@@')) { try { onMsg(JSON.parse(line.slice(2))); } catch { /* partial */ } }
    }
  });
  child.stderr.on('data', d => { errTail = (errTail + d).slice(-4000); });
  const done = new Promise<{ code: number; errTail: string }>(ok => child.on('close', code => ok({ code: code ?? 1, errTail })));
  return { child, done };
}

// A few concurrent headless Chromes at most: subagents render check sheets in parallel.
let active = 0; const queue: (() => void)[] = [];
const MAX_SHEETS = Math.max(1, +(process.env.STUDIO_MAX_RENDERS || 3));
async function slot<T>(fn: () => Promise<T>) {
  if (active >= MAX_SHEETS) await new Promise<void>(r => queue.push(r));
  active++;
  try { return await fn(); } finally { active--; queue.shift()?.(); }
}

export function renderSheet(dir: string, times: number[], opts: { cols?: number; width?: number; out: string; test?: string }) {
  return slot(async () => {
    const logs: string[] = []; let result: RenderMsg | null = null;
    const { done } = runRender(dir, [`--sheet=${times.join(',')}`, `--cols=${opts.cols || 3}`, `--w=${opts.width || 640}`, `--out=${opts.out}`, ...(opts.test ? [`--test=${opts.test}`] : [])], m => {
      if (m.type === 'log' && m.message && !m.message.includes('ms/frame')) logs.push(m.message);
      if (m.type === 'error') logs.push('ERROR: ' + m.message);
      if (m.type === 'done') result = m;
    });
    const { code, errTail } = await done;
    return { ok: code === 0 && !!result, out: opts.out, ms: (result as RenderMsg | null)?.ms || [], logs, errTail };
  });
}

// ---------- export job (frames → encode), one per project ----------
const jobs = new Map<string, { child: ChildProcess | null; cancelled: boolean }>();
export const exportRunning = (slug: string) => jobs.has(slug);

export async function runExport(slug: string, dir: string, opts: { workers: number; before?: () => Promise<void> }) {
  if (jobs.has(slug)) throw new Error('書き出しはすでに実行中です');
  const job = { child: null as ChildProcess | null, cancelled: false };
  jobs.set(slug, job);
  const ev = (phase: 'start' | 'progress' | 'log' | 'done' | 'error', job_: string, extra: Record<string, unknown> = {}) =>
    publish(slug, { type: 'render', job: job_, phase, ...extra });
  (async () => {
    try {
      ev('start', 'prepare', { message: '音声と字幕を準備しています' });
      await opts.before?.();
      for (const [name, args] of [['frames', ['--frames', `--workers=${opts.workers}`]], ['encode', ['--encode']]] as const) {
        if (job.cancelled) throw new Error('キャンセルしました');
        ev('start', name);
        const { child, done } = runRender(dir, [...args], m => {
          if (m.type === 'progress') ev('progress', name, { done: m.done, total: m.total, etaSec: m.etaSec, msPerFrame: m.msPerFrame });
          else if (m.type === 'log' || m.type === 'error') ev('log', name, { message: m.message });
        });
        job.child = child;
        const { code, errTail } = await done;
        if (job.cancelled) throw new Error('キャンセルしました');
        if (code !== 0) throw new Error(errTail.trim().split('\n').slice(-3).join('\n') || `${name} failed`);
        ev('done', name);
      }
      ev('done', 'export', { out: 'out/final.mp4' });
    } catch (e) {
      ev('error', 'export', { message: (e as Error).message });
    } finally {
      jobs.delete(slug);
      publish(slug, { type: 'project-updated', reason: 'export' });
    }
  })();
}

export function cancelExport(slug: string) {
  const j = jobs.get(slug); if (!j) return false;
  j.cancelled = true; j.child?.kill();
  return true;
}

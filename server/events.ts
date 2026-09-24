// events.ts: per-project event bus, streamed to the GUI over SSE.
export type StudioEvent =
  | { type: 'agent'; runId: string; task: string; entry: ChatEntry }
  | { type: 'agent-state'; running: boolean; runId?: string; task?: string; costUsd?: number }
  | { type: 'project-updated'; reason: string }
  | { type: 'render'; job: string; phase: 'start' | 'progress' | 'log' | 'done' | 'error'; done?: number; total?: number; etaSec?: number; msPerFrame?: number; message?: string; out?: string }
  | { type: 'tts'; phase: 'progress' | 'done' | 'error'; done?: number; total?: number; message?: string };

export interface ChatEntry {
  id: string;
  task: string;
  role: 'user' | 'assistant' | 'tool' | 'result' | 'error' | 'system';
  text: string;
  at: string;
  sub?: string;          // subagent label when the entry comes from a subagent
  image?: string;        // project-relative path of an image the entry refers to
  costUsd?: number;
}

type Listener = (e: StudioEvent) => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribe(slug: string, fn: Listener) {
  let set = listeners.get(slug); if (!set) listeners.set(slug, set = new Set());
  set.add(fn);
  return () => { set!.delete(fn); };
}
export function publish(slug: string, e: StudioEvent) {
  for (const fn of listeners.get(slug) || []) { try { fn(e); } catch { /* listener gone */ } }
}

// Coalesce bursts (e.g. many tool results) into one refresh.
const timers = new Map<string, ReturnType<typeof setTimeout>>();
export function projectChanged(slug: string, reason: string, delay = 250) {
  clearTimeout(timers.get(slug));
  timers.set(slug, setTimeout(() => { timers.delete(slug); publish(slug, { type: 'project-updated', reason }); }, delay));
}

// api.ts: typed calls to the studio server, plus the live project hook (REST snapshot + SSE updates).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Brief, Chapter, Project, Shot, Storyboard, StepId } from '../../server/schema.ts';
import type { ChatEntry, StudioEvent } from '../../server/events.ts';

export type { Brief, Chapter, Project, Shot, Storyboard, StepId, ChatEntry };
export type Asset = Project['assets'][number];
export type AgentTask = 'plan' | 'review' | 'drafts' | 'build' | 'retake';

export interface ProjectData {
  project: Project; brief: Brief; storyboard: Storyboard; style: string;
  files: { drafts: Record<string, number>; chapters: string[]; finalVideo: number; frames: number; mix: number };
  running: { id: string; task: AgentTask; startedAt: number } | null;
  exporting: boolean;
  mock: boolean;
}
export interface Health { mock: boolean; projectsDir: string; chrome: string | null; ffmpeg: boolean; ffprobe: boolean; git: boolean; node: string }
export interface KeyStatus { saved: string | null; env: string | null; file: string | null }
export interface ProjectSummary { slug: string; name: string; step: StepId; updatedAt: string; shots: number; hasVideo: boolean }
export interface Revision { id: string; message: string; at: string; files: number }
export interface Tempo { bpm: number; offset: number; confidence: number; candidates?: { bpm: number; score: number }[] }

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.body = JSON.stringify(body); (init.headers as Record<string, string>)['Content-Type'] = 'application/json'; }
  // In dev the GUI (Vite) is usually up before the API server, and `tsx watch` restarts it on every edit. The proxy then
  // answers 502/503/504 or the connection fails without reaching the server, so waiting and retrying is safe for every
  // method. Give up after ~30 s with a message that points at the server log.
  for (let attempt = 0; ; attempt++) {
    let r: Response | null = null;
    try { r = await fetch(url, init); } catch { r = null; }
    if (r && ![502, 503, 504].includes(r.status)) {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data as { error?: string }).error || `${r.status} ${r.statusText}`);
      return data as T;
    }
    if (attempt >= 40) throw new Error('サーバーに接続できません。`npm run dev` のターミナルに [server] のエラーが出ていないか確認してください。');
    serverWaiting(true);
    await new Promise(res => setTimeout(res, Math.min(250 + attempt * 150, 1000)));
  }
}

// Lets the UI show "starting the server…" while requests are being retried.
type WaitListener = (waiting: boolean) => void;
const waitListeners = new Set<WaitListener>();
let waitTimer: ReturnType<typeof setTimeout> | undefined;
function serverWaiting(on: boolean) {
  waitListeners.forEach(fn => fn(on));
  clearTimeout(waitTimer);
  if (on) waitTimer = setTimeout(() => serverWaiting(false), 1500);
}
export function useServerWaiting() {
  const [w, setW] = useState(false);
  useEffect(() => { waitListeners.add(setW); return () => { waitListeners.delete(setW); }; }, []);
  return w;
}

const P = (slug: string) => `/api/projects/${slug}`;
export const api = {
  health: () => req<Health>('GET', '/api/health'),
  authStatus: () => req<KeyStatus>('GET', '/api/auth'),
  saveKey: (key: string | null) => req<KeyStatus>('PUT', '/api/auth/key', { key }),
  checkAuth: (slug: string) => req<{ ok: boolean; summary: string; error?: string }>('POST', `/api/projects/${slug}/auth/check`, {}),
  projects: () => req<ProjectSummary[]>('GET', '/api/projects'),
  create: (name: string, format: Partial<Project['format']>) => req<Project>('POST', '/api/projects', { name, format }),
  get: (slug: string) => req<ProjectData>('GET', P(slug)),
  patch: (slug: string, patch: Partial<Project> | Record<string, unknown>) => req<Project>('PATCH', P(slug), patch),
  saveBrief: (slug: string, b: Brief) => req('PUT', `${P(slug)}/brief`, b),
  saveStyle: (slug: string, markdown: string) => req('PUT', `${P(slug)}/style`, { markdown }),
  saveStoryboard: (slug: string, sb: Storyboard) => req<{ ok: boolean; problems: string[] }>('PUT', `${P(slug)}/storyboard`, sb),
  comment: (slug: string, shotId: string, text: string) => req('POST', `${P(slug)}/shots/${shotId}/comments`, { text }),
  editComment: (slug: string, shotId: string, cid: string, patch: { resolved?: boolean; delete?: boolean }) => req('PATCH', `${P(slug)}/shots/${shotId}/comments/${cid}`, patch),
  setStatus: (slug: string, ids: string[], status: Shot['status'], note?: string) => req('POST', `${P(slug)}/shots/status`, { ids, status, note }),
  uploadAsset: (slug: string, file: File, dims: { width: number; height: number }) => {
    const f = new FormData(); f.append('file', file); f.append('width', String(dims.width)); f.append('height', String(dims.height));
    return req<{ id: string; project: Project }>('POST', `${P(slug)}/assets`, f);
  },
  patchAsset: (slug: string, id: string, patch: { name?: string; description?: string }) => req<Project>('PATCH', `${P(slug)}/assets/${id}`, patch),
  deleteAsset: (slug: string, id: string) => req<Project>('DELETE', `${P(slug)}/assets/${id}`),
  history: (slug: string) => req<Revision[]>('GET', `${P(slug)}/history`),
  saveVersion: (slug: string, message: string) => req<{ id: string | null }>('POST', `${P(slug)}/history/save`, { message }),
  restore: (slug: string, id: string) => req('POST', `${P(slug)}/history/restore`, { id }),
  uploadMusic: (slug: string, file: File) => { const f = new FormData(); f.append('file', file); return req<{ project: Project; tempo: Tempo }>('POST', `${P(slug)}/music`, f); },
  removeMusic: (slug: string) => req<Project>('DELETE', `${P(slug)}/music`),
  tempo: (slug: string, bpm?: number) => req<Tempo>('POST', `${P(slug)}/music/tempo`, { bpm }),
  lyrics: (slug: string, text: string) => req<{ count: number }>('POST', `${P(slug)}/lyrics`, { text }),
  speakers: (url: string) => req<{ ok: boolean; speakers?: { id: number; name: string }[]; error?: string }>('GET', `/api/voicevox/speakers?url=${encodeURIComponent(url)}`),
  synthesize: (slug: string, retime: boolean) => req<{ started: number }>('POST', `${P(slug)}/narration/synthesize`, { retime }),
  runAgent: (slug: string, task: AgentTask, message = '', shotIds?: string[]) => req<{ runId: string }>('POST', `${P(slug)}/agent`, { task, message, shotIds }),
  stopAgent: (slug: string) => req('POST', `${P(slug)}/agent/stop`),
  chat: (slug: string) => req<ChatEntry[]>('GET', `${P(slug)}/chat`),
  resetSession: (slug: string, key: string) => req('POST', `${P(slug)}/sessions/reset`, { key }),
  exportVideo: (slug: string, workers: number, fresh: boolean) => req('POST', `${P(slug)}/export`, { workers, fresh }),
  cancelExport: (slug: string) => req('POST', `${P(slug)}/export/cancel`),
};

export const fileUrl = (slug: string, rel: string, v?: number) => `/p/${slug}/${rel}${v ? `?v=${Math.round(v)}` : ''}`;

export interface RenderState { job: string; phase: string; done?: number; total?: number; etaSec?: number; msPerFrame?: number; message?: string; log: string[] }
export interface TtsState { phase: string; done?: number; total?: number; message?: string }

// Live view of one project: snapshot + chat + progress, refreshed from the SSE stream.
export function useProject(slug: string) {
  const [data, setData] = useState<ProjectData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [render, setRender] = useState<RenderState | null>(null);
  const [tts, setTts] = useState<TtsState | null>(null);
  const [version, setVersion] = useState(0);
  const inflight = useRef(false), again = useRef(false);

  const reload = useCallback(async () => {
    if (inflight.current) { again.current = true; return; }
    inflight.current = true;
    try { setData(await api.get(slug)); setError(null); setVersion(v => v + 1); }
    catch (e) { setError((e as Error).message); }
    finally { inflight.current = false; if (again.current) { again.current = false; reload(); } }
  }, [slug]);

  useEffect(() => {
    reload(); api.chat(slug).then(setChat).catch(() => {});
    // EventSource gives up for good when the server answers with an error (e.g. a 502 while it is still starting or
    // restarting), so reconnect ourselves and refresh everything once the stream is back.
    let es: EventSource, closed = false, retry: ReturnType<typeof setTimeout> | undefined, wasDown = false, lastSeen = Date.now();
    const connect = () => {
      lastSeen = Date.now();
      es = new EventSource(`/api/projects/${slug}/events`);
      es.addEventListener('ping', () => { lastSeen = Date.now(); });
      es.onopen = () => { if (wasDown) { wasDown = false; reload(); api.chat(slug).then(setChat).catch(() => {}); } };
      es.onerror = () => {
        wasDown = true; // events may have been missed: refresh when the stream reopens
        if (es.readyState === EventSource.CLOSED && !closed) retry = setTimeout(connect, 1500);
      };
      es.onmessage = onMessage;
    };
    // The server pings every 5 s. Silence means the stream is dead even if the connection looks open.
    const watchdog = setInterval(() => {
      if (closed || Date.now() - lastSeen < 12000) return;
      es.close(); clearTimeout(retry); wasDown = true; connect();
    }, 3000);
    const onMessage = (ev: MessageEvent) => {
      lastSeen = Date.now();
      const e = JSON.parse(ev.data) as StudioEvent;
      if (e.type === 'project-updated') reload();
      else if (e.type === 'agent') setChat(c => [...c, e.entry]);
      else if (e.type === 'agent-state') { reload(); }
      else if (e.type === 'render') setRender(r => {
        const log = [...(r?.log || []), ...(e.message && (e.phase === 'log' || e.phase === 'error') ? [e.message] : [])].slice(-200);
        return { ...e, log };
      });
      else if (e.type === 'tts') setTts(e);
    };
    connect();
    return () => { closed = true; clearTimeout(retry); clearInterval(watchdog); es.close(); };
  }, [slug, reload]);

  return { data, error, chat, render, tts, reload, version, setRender };
}

export function fmtTime(t: number) {
  if (!Number.isFinite(t)) return '–';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
export const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// index.ts: the Agent Video Studio server. REST + SSE for the GUI, static files for project previews.
import { serve } from '@hono/node-server';
import { RESPONSE_ALREADY_SENT } from '@hono/node-server/utils/response';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { ENGINE_DIR, ROOT_DIR, findChrome, projectMounts, resolveMount, sendFile } from '../engine/tools.mjs';
import { FFMPEG, FFPROBE, buildMix, estimateTempo, parseLyrics, probeDuration, retimeForNarration, saveUpload, toolVersion, voicevoxSpeakers, voicevoxSynth } from './audio.ts';
import { chatHistory, currentRun, MOCK, startRun, stopRun } from './agent/runner.ts';
import type { AgentTask } from './agent/prompts.ts';
import { publish, subscribe, projectChanged } from './events.ts';
import * as git from './git.ts';
import { cancelExport, exportRunning, runExport } from './render.ts';
import { Brief, Project, STEPS, Storyboard, checkStoryboard } from './schema.ts';
import { HttpError, PROJECTS_DIR, createProject, listProjects, loadAll, loadProject, loadStoryboard, projectDir, regenerateCaptions, saveBrief, saveStyle, updateProject, updateStoryboard, withLock, saveStoryboardFile } from './store.ts';

const PROD = process.argv.includes('--prod');
const PORT = +(process.env.PORT || 8787);
const app = new Hono();

app.onError((err, c) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) console.error(err);
  return c.json({ error: err.message }, status as 400);
});

const body = async <T = Record<string, unknown>>(c: Context) => (await c.req.json().catch(() => ({}))) as T;
const touched = (slug: string, reason: string) => { projectChanged(slug, reason, 0); };

// ---------- environment ----------
app.get('/api/health', async c => {
  const [ffmpeg, ffprobe, gitOk] = await Promise.all([toolVersion(FFMPEG), toolVersion(FFPROBE), git.isAvailable()]);
  return c.json({
    mock: MOCK, projectsDir: PROJECTS_DIR, chrome: findChrome(), ffmpeg: !!ffmpeg, ffprobe: !!ffprobe, git: gitOk,
    auth: process.env.ANTHROPIC_API_KEY ? 'api-key' : 'claude-login', node: process.version,
  });
});

// ---------- projects ----------
app.get('/api/projects', async c => c.json(await listProjects()));
app.post('/api/projects', async c => {
  const b = await body<{ name?: string; format?: Record<string, number> }>(c);
  if (!b.name?.trim()) throw new HttpError(400, 'プロジェクト名を入力してください');
  return c.json(await createProject({ name: b.name.trim(), format: b.format }));
});
app.get('/api/projects/:slug', async c => {
  const slug = c.req.param('slug');
  const all = await loadAll(slug);
  const run = currentRun(slug);
  return c.json({ ...all, running: run ? { id: run.id, task: run.task, startedAt: run.startedAt } : null, exporting: exportRunning(slug) });
});
app.patch('/api/projects/:slug', async c => {
  const slug = c.req.param('slug'), patch = await body<Partial<Project>>(c);
  const allowed = ['name', 'step', 'format', 'captions', 'models', 'effort', 'budgetUsd', 'approvals', 'audio'] as const;
  const p = await updateProject(slug, p => {
    for (const k of allowed) if (patch[k] !== undefined) {
      const v = patch[k] as unknown;
      (p as Record<string, unknown>)[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(p as Record<string, unknown>)[k] as object, ...v } : v;
    }
    if (p.audio.music?.file) p.format.duration = p.audio.music.duration || p.format.duration;
    return Project.parse(p);
  });
  if (patch.audio || patch.captions) await regenerateCaptions(slug);
  touched(slug, 'project');
  return c.json(p);
});
app.put('/api/projects/:slug/brief', async c => {
  const slug = c.req.param('slug'); await saveBrief(slug, Brief.parse(await body(c))); touched(slug, 'brief'); return c.json({ ok: true });
});
app.put('/api/projects/:slug/style', async c => {
  const slug = c.req.param('slug'); const b = await body<{ markdown: string }>(c);
  await saveStyle(slug, String(b.markdown ?? '')); touched(slug, 'style'); return c.json({ ok: true });
});
app.put('/api/projects/:slug/storyboard', async c => {
  const slug = c.req.param('slug'), sb = Storyboard.parse(await body(c));
  const p = await loadProject(slug);
  await withLock(slug, () => saveStoryboardFile(slug, sb));
  const end = sb.chapters.at(-1)?.end;
  if (!p.audio.music?.file && end && Math.abs(end - p.format.duration) > .01) await updateProject(slug, x => { x.format.duration = end; });
  await regenerateCaptions(slug);
  touched(slug, 'storyboard');
  return c.json({ ok: true, problems: checkStoryboard(sb, p.audio.music?.file ? p.format.duration : 0) });
});
// Comments and statuses change often from the GUI: small endpoints that go through the storyboard lock.
app.post('/api/projects/:slug/shots/:id/comments', async c => {
  const { slug, id } = c.req.param(); const b = await body<{ text: string }>(c);
  if (!b.text?.trim()) throw new HttpError(400, 'コメントが空です');
  await updateStoryboard(slug, sb => {
    const s = sb.chapters.flatMap(ch => ch.shots).find(x => x.id === id); if (!s) throw new HttpError(404, 'shot not found');
    s.comments.push({ id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, author: 'user', text: b.text.trim(), at: new Date().toISOString(), resolved: false });
  });
  touched(slug, 'comments'); return c.json({ ok: true });
});
app.patch('/api/projects/:slug/shots/:id/comments/:cid', async c => {
  const { slug, id, cid } = c.req.param(); const b = await body<{ resolved?: boolean; delete?: boolean }>(c);
  await updateStoryboard(slug, sb => {
    const s = sb.chapters.flatMap(ch => ch.shots).find(x => x.id === id); if (!s) throw new HttpError(404, 'shot not found');
    if (b.delete) s.comments = s.comments.filter(x => x.id !== cid);
    else { const cm = s.comments.find(x => x.id === cid); if (cm && b.resolved !== undefined) cm.resolved = b.resolved; }
  });
  touched(slug, 'comments'); return c.json({ ok: true });
});
app.post('/api/projects/:slug/shots/status', async c => {
  const slug = c.req.param('slug'); const b = await body<{ ids: string[]; status: string; note?: string }>(c);
  await updateStoryboard(slug, sb => { for (const s of sb.chapters.flatMap(ch => ch.shots)) if (b.ids.includes(s.id)) { s.status = b.status as never; if (b.note !== undefined) s.statusNote = b.note; } });
  touched(slug, 'status'); return c.json({ ok: true });
});

// ---------- history ----------
app.get('/api/projects/:slug/history', async c => c.json(await git.log(projectDir(c.req.param('slug')))));
app.post('/api/projects/:slug/history/save', async c => {
  const slug = c.req.param('slug'); const b = await body<{ message?: string }>(c);
  const id = await git.commit(projectDir(slug), b.message?.trim() || '手動で保存'); return c.json({ id });
});
app.post('/api/projects/:slug/history/restore', async c => {
  const slug = c.req.param('slug'); const b = await body<{ id: string }>(c);
  if (currentRun(slug)) throw new HttpError(409, 'Claude の作業中は復元できません');
  const id = await git.restore(projectDir(slug), b.id); touched(slug, 'restore'); return c.json({ id });
});

// ---------- audio ----------
app.post('/api/projects/:slug/music', async c => {
  const slug = c.req.param('slug'), dir = projectDir(slug);
  const form = await c.req.parseBody(); const file = form.file;
  if (!(file instanceof File)) throw new HttpError(400, '音声ファイルを選んでください');
  const rel = await saveUpload(dir, file.name, await file.arrayBuffer());
  const duration = await probeDuration(join(dir, rel));
  const tempo = await estimateTempo(join(dir, rel)).catch(() => ({ bpm: 0, offset: 0, confidence: 0, candidates: [] }));
  const p = await updateProject(slug, p => {
    p.audio.music = { file: rel, duration, bpm: tempo.bpm, offset: tempo.offset, lyrics: p.audio.music?.lyrics || [] };
    p.format.duration = duration;
  });
  touched(slug, 'music');
  return c.json({ project: p, tempo });
});
app.delete('/api/projects/:slug/music', async c => {
  const slug = c.req.param('slug');
  const p = await updateProject(slug, p => { if (p.audio.music?.file) rmSync(join(projectDir(slug), p.audio.music.file), { force: true }); p.audio.music = undefined; });
  await regenerateCaptions(slug); touched(slug, 'music'); return c.json(p);
});
app.post('/api/projects/:slug/music/tempo', async c => {
  const slug = c.req.param('slug'); const b = await body<{ bpm?: number }>(c);
  const p = await loadProject(slug); if (!p.audio.music?.file) throw new HttpError(400, '音楽ファイルがありません');
  return c.json(await estimateTempo(join(projectDir(slug), p.audio.music.file), b.bpm || undefined));
});
app.post('/api/projects/:slug/lyrics', async c => {
  const slug = c.req.param('slug'); const b = await body<{ text: string }>(c);
  const p0 = await loadProject(slug); if (!p0.audio.music) throw new HttpError(400, '先に音楽ファイルを追加してください');
  const lyrics = parseLyrics(String(b.text || ''), p0.format.duration);
  const p = await updateProject(slug, p => { p.audio.music!.lyrics = lyrics; });
  await regenerateCaptions(slug); touched(slug, 'lyrics'); return c.json({ project: p, count: lyrics.length });
});
app.get('/api/voicevox/speakers', async c => {
  const url = c.req.query('url') || 'http://127.0.0.1:50021';
  try { return c.json({ ok: true, speakers: await voicevoxSpeakers(url) }); }
  catch (e) { return c.json({ ok: false, error: `VOICEVOX に接続できません (${url}): ${(e as Error).message}` }); }
});
app.post('/api/projects/:slug/narration/synthesize', async c => {
  const slug = c.req.param('slug'), dir = projectDir(slug); const b = await body<{ retime?: boolean; ids?: string[] }>(c);
  const p = await loadProject(slug), n = p.audio.narration;
  if (!n.enabled) throw new HttpError(400, 'ナレーションが無効です');
  const sb = await loadStoryboard(slug);
  const todo = sb.chapters.flatMap(ch => ch.shots).filter(s => s.narration.trim() && (!b.ids || b.ids.includes(s.id)));
  if (!todo.length) throw new HttpError(400, 'ナレーション文のあるショットがありません');
  mkdirSync(join(dir, 'assets', 'narration'), { recursive: true });
  (async () => {
    try {
      const results = new Map<string, { file: string; duration: number }>();
      for (const [i, s] of todo.entries()) {
        publish(slug, { type: 'tts', phase: 'progress', done: i, total: todo.length, message: s.id });
        const wav = await voicevoxSynth(n.url, s.narration.trim(), n.speaker, n.speed);
        const file = `assets/narration/${s.id}.wav`; await writeFile(join(dir, file), wav);
        results.set(s.id, { file, duration: Math.round(await probeDuration(join(dir, file)) * 1000) / 1000 });
      }
      let total = 0;
      await updateStoryboard(slug, sb => {
        for (const s of sb.chapters.flatMap(ch => ch.shots)) { const r = results.get(s.id); if (r) s.narrationAudio = r; }
        if (b.retime !== false && !p.audio.music?.file) total = retimeForNarration(sb, n.gap);
      });
      if (total) await updateProject(slug, x => { x.format.duration = total; });
      await regenerateCaptions(slug);
      publish(slug, { type: 'tts', phase: 'done', done: todo.length, total: todo.length });
      touched(slug, 'narration');
    } catch (e) { publish(slug, { type: 'tts', phase: 'error', message: (e as Error).message }); }
  })();
  return c.json({ started: todo.length });
});

// ---------- agent ----------
const TASKS: AgentTask[] = ['plan', 'review', 'drafts', 'build', 'retake'];
app.post('/api/projects/:slug/agent', async c => {
  const slug = c.req.param('slug'); const b = await body<{ task: AgentTask; message?: string; shotIds?: string[] }>(c);
  if (!TASKS.includes(b.task)) throw new HttpError(400, 'unknown task');
  if (exportRunning(slug) && (b.task === 'build' || b.task === 'retake')) throw new HttpError(409, '書き出し中は制作を始められません');
  const runId = await startRun(slug, b.task, b.message || '', { shotIds: b.shotIds });
  return c.json({ runId });
});
app.post('/api/projects/:slug/agent/stop', async c => c.json({ stopped: stopRun(c.req.param('slug')) }));
app.get('/api/projects/:slug/chat', async c => c.json(await chatHistory(c.req.param('slug'))));
app.post('/api/projects/:slug/sessions/reset', async c => {
  const slug = c.req.param('slug'); const b = await body<{ key: string }>(c);
  await updateProject(slug, p => { delete p.sessions[b.key]; }); return c.json({ ok: true });
});

// ---------- export ----------
app.post('/api/projects/:slug/export', async c => {
  const slug = c.req.param('slug'), dir = projectDir(slug); const b = await body<{ workers?: number; fresh?: boolean }>(c);
  if (currentRun(slug)) throw new HttpError(409, 'Claude の作業が終わってから書き出してください');
  if (b.fresh) rmSync(join(dir, 'out', 'frames'), { recursive: true, force: true });
  await runExport(slug, dir, {
    workers: Math.max(1, Math.min(16, b.workers || 4)),
    before: async () => { const [p, sb] = await Promise.all([loadProject(slug), loadStoryboard(slug)]); await regenerateCaptions(slug); await buildMix(dir, p, sb); },
  });
  return c.json({ ok: true });
});
app.post('/api/projects/:slug/export/cancel', async c => c.json({ cancelled: cancelExport(c.req.param('slug')) }));

// ---------- live events ----------
app.get('/api/projects/:slug/events', c => {
  const slug = c.req.param('slug'); projectDir(slug);
  return streamSSE(c, async stream => {
    const off = subscribe(slug, e => { stream.writeSSE({ data: JSON.stringify(e) }).catch(() => {}); });
    // Heartbeat: the GUI reconnects when pings stop (a dev proxy can keep a dead stream open after a server restart).
    await stream.writeSSE({ event: 'ping', data: '' }).catch(() => {});
    const ping = setInterval(() => { stream.writeSSE({ event: 'ping', data: '' }).catch(() => {}); }, 5000);
    await new Promise<void>(r => stream.onAbort(() => r()));
    clearInterval(ping); off();
  });
});

// ---------- static: project files (/p/:slug/...), engine and vendor mounts, built GUI ----------
function nodeIO(c: Context) {
  const env = c.env as { incoming: IncomingMessage; outgoing: ServerResponse };
  return env;
}
function sendStatic(c: Context, file: string | null) {
  if (!file || !existsSync(file)) return c.text('not found', 404);
  const { incoming, outgoing } = nodeIO(c);
  sendFile(incoming, outgoing, file);
  return RESPONSE_ALREADY_SENT;
}
app.get('/p/:slug/*', c => {
  const slug = c.req.param('slug'); const dir = projectDir(slug);
  const rest = c.req.path.slice(`/p/${slug}`.length) || '/';
  if (rest.startsWith('/.git') || rest.startsWith('/.studio')) return c.text('forbidden', 403);
  return sendStatic(c, resolveMount({ '/': dir }, rest));
});
app.get('/vendor/*', c => sendStatic(c, resolveMount(projectMounts(ROOT_DIR), c.req.path)));
app.get('/engine/*', c => sendStatic(c, resolveMount({ '/engine/': ENGINE_DIR }, c.req.path)));
if (PROD) {
  const dist = join(ROOT_DIR, 'web', 'dist');
  app.get('*', c => {
    const f = resolveMount({ '/': dist }, c.req.path);
    return sendStatic(c, f && existsSync(f) && !c.req.path.endsWith('/') ? f : join(dist, 'index.html'));
  });
}

const server = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, info => {
  const url = `http://localhost:${PROD ? info.port : 5173}`;
  console.log(`\n  Agent Video Studio  →  ${url}${MOCK ? '   (STUDIO_MOCK=1: Claude is not called)' : ''}\n  API: http://127.0.0.1:${info.port}   projects: ${PROJECTS_DIR}\n`);
});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  ポート ${PORT} は別のプロセスが使用中です。そのプロセスを止めるか、PORT=8788 npm run dev のように別のポートで起動してください。\n`);
  else console.error(e);
  process.exit(1);
});
export { STEPS };

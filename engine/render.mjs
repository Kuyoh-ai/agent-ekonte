#!/usr/bin/env node
// render.mjs: drive a project's studio.html in headless Chrome (generalised from examples/pdoom/render.mjs).
//
//   node engine/render.mjs --project=projects/demo --sheet=1.2,3.4,5.0 [--cols=3] [--w=640] [--out=out/check/sheet.jpg]
//   node engine/render.mjs --project=projects/demo --stills=0.8,3 [--out=out/stills]            full-res PNGs
//   node engine/render.mjs --project=projects/demo --clip=0:6 [--out=out/clip.mp4]              short clip with audio
//   node engine/render.mjs --project=projects/demo --frames[=a:b] [--workers=4]                 JPEG frames → out/frames (resumable)
//   node engine/render.mjs --project=projects/demo --encode [--out=out/final.mp4]               frames + audio → MP4
// Common: --chrome=<path> (else CHROME_PATH or auto-detect) · --json (machine-readable "@@{...}" progress lines)
// Output paths are relative to the project directory.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { findChrome, findFfmpeg, serveProject } from './tools.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return i < 0 ? [a.replace(/^--/, ''), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const JSON_OUT = !!args.json;
const emit = (o) => { if (JSON_OUT) console.log('@@' + JSON.stringify(o)); };
const log = (msg) => { console.log(msg); emit({ type: 'log', message: msg }); };
function fail(msg) { console.error('ERROR: ' + msg); emit({ type: 'error', message: msg }); process.exit(1); }

if (!args.project || args.project === true) fail('--project=<dir> is required');
const PROJECT = resolve(String(args.project));
if (!existsSync(join(PROJECT, 'project.json'))) fail(`no project.json in ${PROJECT}`);
const project = JSON.parse(readFileSync(join(PROJECT, 'project.json'), 'utf8'));
const W = project.format?.width || 1920, H = project.format?.height || 1080, FPS = +(args.fps || project.format?.fps || 24), DUR = project.format?.duration || 10;
const P = (...p) => join(PROJECT, ...p);
const FRAMES_DIR = P('out', 'frames');
const TOTAL = Math.round(DUR * FPS);
const FFMPEG = findFfmpeg();

const run = (cmd, a) => new Promise((ok, bad) => { const p = spawn(cmd, a, { stdio: ['ignore', 'inherit', 'inherit'] }); p.on('error', bad); p.on('close', c => c ? bad(new Error(`${cmd} exited ${c}`)) : ok()); });
function audioTrack() {
  const mix = P('out', 'audio', 'mix.wav');
  if (existsSync(mix)) return mix;
  const m = project.audio?.music?.file && P(project.audio.music.file);
  return m && existsSync(m) ? m : null;
}

if (args.encode) {
  const out = P(String(args.out && args.out !== true ? args.out : 'out/final.mp4'));
  const n = existsSync(FRAMES_DIR) ? readdirSync(FRAMES_DIR).filter(f => f.endsWith('.jpg')).length : 0;
  if (!n) fail('no frames in out/frames: run --frames first');
  if (n < TOTAL) log(`warning: ${n}/${TOTAL} frames present; the video will be shorter than the project`);
  mkdirSync(dirname(out), { recursive: true });
  const audio = audioTrack();
  log(`encoding ${n} frames${audio ? ' + ' + audio.slice(PROJECT.length + 1) : ' (no audio)'} → ${out.slice(PROJECT.length + 1)}`);
  const a = ['-y', '-loglevel', 'error', '-stats', '-framerate', String(FPS), '-i', join(FRAMES_DIR, 'f%05d.jpg')];
  if (audio) a.push('-i', audio, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest');
  a.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
  try { await run(FFMPEG, a); } catch (e) { fail(`ffmpeg failed (${e.message}). Install ffmpeg or set FFMPEG_PATH.`); }
  emit({ type: 'done', out: out.slice(PROJECT.length + 1) });
  log('wrote ' + out);
  process.exit(0);
}

const chrome = findChrome(args.chrome && String(args.chrome));
if (!chrome) fail('Chrome not found: pass --chrome=<path> or set CHROME_PATH');
const server = await serveProject(PROJECT);
const flags = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', `--window-size=${W},${H}`, '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--hide-scrollbars'];
if (process.platform === 'win32') flags.push('--use-angle=d3d11');
if (process.platform === 'linux' && process.getuid?.() === 0) flags.push('--no-sandbox');
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, protocolTimeout: 0, args: flags });
const cleanup = async () => { await browser.close().catch(() => {}); await server.close(); };

async function openPage(tag = '') {
  const page = await browser.newPage();
  await page.setViewport({ width: Math.min(W, 1920), height: Math.min(H, 1920) });
  page.on('console', m => { if (['error', 'warn'].includes(m.type()) && !m.text().startsWith('Failed to load resource')) log(`[page${tag}] ${m.text()}`); });
  page.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) log(`[page${tag}] ${r.status()} ${r.url().replace(server.url, '')}`); });
  page.on('pageerror', e => log(`[page error${tag}] ${e.message}`));
  await page.goto(`${server.url}/studio.html?render`, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction('window.ready === true', { timeout: 120000 });
  return page;
}
const frameOf = async (page, t, type, q) => {
  const url = await page.evaluate((t, type, q) => window.renderAt(t, type, q), t, type, q);
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
};
const times = s => String(s).split(',').map(Number).filter(Number.isFinite);
const range = (s, a0, b0) => { if (!s || s === true) return [a0, b0]; const [a, b] = String(s).split(':').map(Number); return [a ?? a0, b ?? b0]; };

try {
  if (args.sheet) {
    const page = await openPage(), out = P(String(args.out && args.out !== true ? args.out : 'out/check/sheet.jpg'));
    mkdirSync(dirname(out), { recursive: true });
    const { url, ms } = await page.evaluate((ts, c, w) => window.renderSheet(ts, c, w), times(args.sheet), +(args.cols || 3), +(args.w || 640));
    writeFileSync(out, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    log(`${out.slice(PROJECT.length + 1)}  ms/frame: ${ms.join(' ')}`);
    emit({ type: 'done', out: out.slice(PROJECT.length + 1), ms });
  } else if (args.stills) {
    const page = await openPage(), out = P(String(args.out && args.out !== true ? args.out : 'out/stills')); mkdirSync(out, { recursive: true });
    const files = [];
    for (const s of times(args.stills)) {
      const t0 = Date.now(), buf = await frameOf(page, s, 'image/png');
      const f = join(out, `t${s.toFixed(2).replace('.', '_')}.png`); writeFileSync(f, buf); files.push(f.slice(PROJECT.length + 1));
      log(`${f.slice(PROJECT.length + 1)}  ${Date.now() - t0} ms`);
    }
    emit({ type: 'done', files });
  } else if (args.clip) {
    const [a, b] = range(args.clip, 0, DUR), out = P(String(args.out && args.out !== true ? args.out : 'out/clip.mp4'));
    mkdirSync(dirname(out), { recursive: true });
    const page = await openPage(), audio = audioTrack();
    const ffa = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-'];
    if (audio) ffa.push('-ss', String(a), '-t', String(b - a), '-i', audio, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest');
    ffa.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', out);
    const ff = spawn(FFMPEG, ffa, { stdio: ['pipe', 'inherit', 'inherit'] });
    const n = Math.round((b - a) * FPS), start = Date.now();
    for (let i = 0; i < n; i++) {
      const buf = await frameOf(page, a + i / FPS, 'image/jpeg', .92);
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
      if (i % 12 === 0 || i === n - 1) emit({ type: 'progress', done: i + 1, total: n, msPerFrame: Math.round((Date.now() - start) / (i + 1)) });
    }
    ff.stdin.end(); await new Promise(r => ff.on('close', r));
    log('wrote ' + out); emit({ type: 'done', out: out.slice(PROJECT.length + 1) });
  } else if (args.frames) {
    // Parallel and resumable: each worker page pulls the next missing frame index; files are written atomically.
    const [a, b] = range(args.frames, 0, DUR), workers = Math.max(1, +(args.workers || 4));
    mkdirSync(FRAMES_DIR, { recursive: true });
    const first = Math.round(a * FPS), last = Math.min(TOTAL - 1, Math.round(b * FPS) - 1);
    const todo = []; for (let i = first; i <= last; i++) { const f = join(FRAMES_DIR, `f${String(i).padStart(5, '0')}.jpg`); if (!existsSync(f) || statSync(f).size < 1000) todo.push(i); }
    // Frames past the project's end (left over from a longer cut) would leak into the encode, so remove them.
    for (const f of readdirSync(FRAMES_DIR)) { const m = /^f(\d+)\.jpg$/.exec(f); if (m && +m[1] >= TOTAL) unlinkSync(join(FRAMES_DIR, f)); }
    log(`${todo.length} frames to render (${last - first + 1 - todo.length} already done), ${workers} workers`);
    emit({ type: 'progress', done: 0, total: todo.length, skipped: last - first + 1 - todo.length });
    let next = 0, done = 0; const start = Date.now();
    await Promise.all(Array.from({ length: Math.min(workers, todo.length || 1) }, async (_, w) => {
      const page = await openPage('#' + w);
      while (next < todo.length) {
        const i = todo[next++], f = join(FRAMES_DIR, `f${String(i).padStart(5, '0')}.jpg`);
        const buf = await frameOf(page, i / FPS, 'image/jpeg', .94);
        writeFileSync(f + '.tmp', buf); renameSync(f + '.tmp', f);
        done++;
        if (done % 12 === 0 || done === todo.length) {
          const el = (Date.now() - start) / 1000;
          emit({ type: 'progress', done, total: todo.length, msPerFrame: Math.round(el / done * 1000), etaSec: Math.round((todo.length - done) * el / done) });
          if (!JSON_OUT) console.log(`frame ${done}/${todo.length}  ${(el / done * 1000).toFixed(0)} ms/frame  eta ${((todo.length - done) * el / done / 60).toFixed(1)} min`);
        }
      }
    }));
    emit({ type: 'done', frames: done });
  } else {
    fail('nothing to do: pass --sheet, --stills, --clip, --frames or --encode');
  }
} catch (e) {
  await cleanup(); fail(e.stack || e.message);
}
await cleanup();

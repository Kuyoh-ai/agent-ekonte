// audio.ts: music analysis (duration, BPM, beat offset), lyric import, narration TTS (VOICEVOX) and the final mix.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findFfmpeg, findFfprobe } from '../engine/tools.mjs';
import type { Project, Storyboard, TimedLine } from './schema.ts';

export const FFMPEG = findFfmpeg();
export const FFPROBE = findFfprobe();

export function probeDuration(file: string): Promise<number> {
  return new Promise((ok, bad) => execFile(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    (err, out) => err ? bad(new Error('ffprobe failed: ' + err.message)) : ok(Math.round(parseFloat(out) * 1000) / 1000)));
}

export async function toolVersion(bin: string) {
  return new Promise<string | null>(ok => execFile(bin, ['-version'], (err, out) => ok(err ? null : out.split('\n')[0])));
}

// Decode to mono float32 PCM at `rate` Hz (first `maxSec` seconds).
function decodePCM(file: string, rate: number, maxSec: number): Promise<Float32Array> {
  return new Promise((ok, bad) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-t', String(maxSec), '-i', file, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-']);
    const chunks: Buffer[] = [];
    p.stdout.on('data', c => chunks.push(c));
    p.on('error', bad);
    p.on('close', code => {
      if (code) return bad(new Error('ffmpeg could not decode the audio file'));
      const buf = Buffer.concat(chunks);
      ok(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)));
    });
  });
}

// Tempo estimate: spectral-flux onset envelope → autocorrelation, scored with its multiples (2×, 4× the lag = bars) and
// a mild prior around 110 BPM, then the beat phase that best lines up with onsets. A starting point the user can correct.
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
export async function estimateTempo(file: string, forceBpm?: number) {
  const rate = 11025, hop = 128, win = 1024, bins = win / 2;
  const pcm = await decodePCM(file, rate, 150);
  const n = Math.floor((pcm.length - win) / hop);
  if (n < 400) return { bpm: 0, offset: 0, confidence: 0 };
  const env = new Float32Array(n), prev = new Float64Array(bins), re = new Float64Array(win), im = new Float64Array(win);
  const hann = Float64Array.from({ length: win }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / win));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < win; j++) { re[j] = pcm[i * hop + j] * hann[j]; im[j] = 0; }
    fft(re, im);
    let flux = 0;
    for (let k = 1; k < bins; k++) { const m = Math.log1p(100 * Math.hypot(re[k], im[k])); const d = m - prev[k]; if (d > 0) flux += d; prev[k] = m; }
    env[i] = flux;
  }
  // subtract a moving average so only sharp onsets remain
  const W = 16, clean = new Float32Array(n); let acc = 0;
  for (let i = 0; i < n; i++) { acc += env[i]; if (i >= W) acc -= env[i - W]; clean[i] = Math.max(0, env[i] - acc / Math.min(i + 1, W)); }
  const fr = rate / hop, ac = (lag: number) => {
    const L = Math.round(lag); if (L >= n) return 0;
    let s = 0; for (let i = L; i < n; i++) s += clean[i] * clean[i - L]; return s / (n - L);
  };
  const lagMin = Math.floor(fr * 60 / 200), lagMax = Math.ceil(fr * 60 / 55);
  let best = 0, bestLag = 0; const raw: number[] = [];
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const bpm = 60 * fr / lag, prior = Math.exp(-.5 * Math.pow(Math.log2(bpm / 110) / 1.1, 2));
    const s = (ac(lag) + .6 * ac(2 * lag) + .4 * ac(4 * lag)) * prior;
    raw[lag] = s; if (s > best) { best = s; bestLag = lag; }
  }
  const a = raw[bestLag - 1] ?? best, c = raw[bestLag + 1] ?? best, den = a - 2 * best + c;
  const lag = forceBpm ? 60 * fr / forceBpm : bestLag + (den ? Math.max(-.5, Math.min(.5, (a - c) / (2 * den))) : 0);
  const bpm = forceBpm || Math.round(600 * fr / lag) / 10;
  let bestPh = 0, bestSum = -1;
  for (let ph = 0; ph < lag; ph += .5) {
    let s = 0; for (let k = ph; k < n; k += lag) s += clean[Math.round(k)] || 0;
    if (s > bestSum) { bestSum = s; bestPh = ph; }
  }
  const vals = raw.filter(v => v > 0), avg = vals.reduce((x, y) => x + y, 0) / (vals.length || 1);
  // Alternatives the user can pick from: local maxima of the score, strongest first (half/double/3:2 confusions are common).
  const peaks: { bpm: number; score: number }[] = [];
  for (let l = lagMin + 1; l < lagMax; l++) if (raw[l] > raw[l - 1] && raw[l] >= raw[l + 1]) peaks.push({ bpm: Math.round(600 * fr / l) / 10, score: raw[l] / best });
  const candidates = peaks.sort((x, y) => y.score - x.score).filter((p, i, arr) => arr.findIndex(q => Math.abs(q.bpm - p.bpm) < 3) === i).slice(0, 5)
    .map(p => ({ bpm: p.bpm, score: Math.round(p.score * 100) / 100 }));
  return { candidates, bpm, offset: Math.round(bestPh / fr * 1000) / 1000, confidence: Math.round(Math.min(1, (best / (avg || 1) - 1) / 3) * 100) / 100 };
}

// Lyrics: LRC ("[01:02.50]line") or tab/space separated "start end text" / "start text" (seconds).
export function parseLyrics(text: string, duration: number): TimedLine[] {
  const rows: { start: number; end?: number; text: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const lrc = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (lrc.length) {
      const body = line.replace(/\[[^\]]*\]/g, '').trim();
      for (const m of lrc) rows.push({ start: +m[1] * 60 + +m[2], text: body });
      continue;
    }
    const m = /^(\d+(?:\.\d+)?)(?:\s*[-–\t ]\s*(\d+(?:\.\d+)?))?\s+(.+)$/.exec(line);
    if (m) rows.push({ start: +m[1], end: m[2] ? +m[2] : undefined, text: m[3].trim() });
  }
  rows.sort((a, b) => a.start - b.start);
  return rows.filter(r => r.text).map((r, i) => {
    const next = rows[i + 1]?.start ?? duration;
    return { start: r.start, end: Math.min(r.end ?? next - .05, r.start + 8, duration || Infinity), text: r.text };
  });
}

// ---------- VOICEVOX (local TTS engine, https://voicevox.hiroshiba.jp/) ----------
export async function voicevoxSpeakers(url: string) {
  const r = await fetch(`${url}/speakers`, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error(`VOICEVOX returned ${r.status}`);
  const list = await r.json() as { name: string; styles: { name: string; id: number }[] }[];
  return list.flatMap(s => s.styles.map(st => ({ id: st.id, name: `${s.name}（${st.name}）` })));
}

export async function voicevoxSynth(url: string, text: string, speaker: number, speed: number): Promise<Buffer> {
  const q = await fetch(`${url}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`, { method: 'POST' });
  if (!q.ok) throw new Error(`VOICEVOX audio_query failed (${q.status})`);
  const query = await q.json() as Record<string, unknown>;
  query.speedScale = speed;
  const s = await fetch(`${url}/synthesis?speaker=${speaker}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query) });
  if (!s.ok) throw new Error(`VOICEVOX synthesis failed (${s.status})`);
  return Buffer.from(await s.arrayBuffer());
}

export function wavDuration(buf: Buffer): number {
  let byteRate = 0, off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(off + 16);
    if (id === 'data') return byteRate ? size / byteRate : 0;
    off += 8 + size + (size & 1);
  }
  return 0;
}

// Stretch shots so each narration line fits (line + gap), keep shots without narration as they are,
// then re-pack every shot and chapter back-to-back. Returns the new total duration.
export function retimeForNarration(sb: Storyboard, gap: number): number {
  let t = 0;
  for (const ch of sb.chapters) {
    ch.start = t;
    for (const s of ch.shots) {
      const len = s.end - s.start, need = s.narrationAudio ? s.narrationAudio.duration + gap : 0;
      const d = Math.round(Math.max(len, need, .5) * 100) / 100;
      s.start = Math.round(t * 100) / 100; t += d; s.end = Math.round(t * 100) / 100;
    }
    ch.end = Math.round(t * 100) / 100;
  }
  return Math.round(t * 100) / 100;
}

// out/audio/mix.wav = music (ducked when narration exists) + narration clips at their shot times, padded to the video length.
export async function buildMix(dir: string, p: Project, sb: Storyboard): Promise<string | null> {
  const out = join(dir, 'out', 'audio'); mkdirSync(out, { recursive: true });
  const target = join(out, 'mix.wav');
  const music = p.audio.music?.file && existsSync(join(dir, p.audio.music.file)) ? join(dir, p.audio.music.file) : null;
  const gap = p.audio.narration.gap / 2;
  const clips = p.audio.narration.enabled
    ? sb.chapters.flatMap(c => c.shots).filter(s => s.narrationAudio && existsSync(join(dir, s.narrationAudio.file)))
      .map(s => ({ file: join(dir, s.narrationAudio!.file), at: s.start + gap }))
    : [];
  if (!music && !clips.length) { rmSync(target, { force: true }); return null; }
  const args = ['-y', '-v', 'error'];
  const labels: string[] = []; let filter = ''; let idx = 0;
  if (music) {
    args.push('-i', music);
    filter += `[${idx}:a]volume=${clips.length ? p.audio.narration.musicVolume : 1}[m];`; labels.push('[m]'); idx++;
  }
  for (const c of clips) {
    args.push('-i', c.file);
    const ms = Math.max(0, Math.round(c.at * 1000));
    filter += `[${idx}:a]aresample=48000,adelay=${ms}|${ms}[n${idx}];`; labels.push(`[n${idx}]`); idx++;
  }
  filter += `${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,apad,atrim=0:${p.format.duration}[out]`;
  args.push('-filter_complex', filter, '-map', '[out]', '-ac', '2', '-ar', '48000', target);
  await new Promise<void>((ok, bad) => execFile(FFMPEG, args, err => err ? bad(new Error('ffmpeg mix failed: ' + err.message)) : ok()));
  return target;
}

export async function saveUpload(dir: string, name: string, data: ArrayBuffer) {
  const assets = join(dir, 'assets'); mkdirSync(assets, { recursive: true });
  const safe = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+/, '') || 'upload';
  await writeFile(join(assets, safe), Buffer.from(data));
  return `assets/${safe}`;
}

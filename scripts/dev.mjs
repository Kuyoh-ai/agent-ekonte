#!/usr/bin/env node
// dev.mjs: `npm run dev`. Starts the API server first (tsx watch), waits until it answers, then starts the GUI (Vite).
// If the server fails to start, its error stays at the bottom of the terminal instead of being buried under proxy errors.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 8787);
const bin = rel => join(ROOT, 'node_modules', rel);
const color = (c, s) => (process.stdout.isTTY ? `\x1b[${c}m${s}\x1b[0m` : s);
const children = [];

function run(name, c, args) {
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['inherit', 'pipe', 'pipe'] });
  const prefix = color(c, `[${name}]`);
  const pipe = (src, dst) => { let buf = ''; src.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); dst.write(`${prefix} ${line}\n`); buf = buf.slice(i + 1); if (name === 'server' && /^Node\.js v\d/.test(line.trim())) crashed(); } }); };
  pipe(child.stdout, process.stdout); pipe(child.stderr, process.stderr);
  child.on('exit', code => { if (!stopping) { console.log(`${prefix} exited (${code})`); stop(code || 1); } });
  children.push(child);
  return child;
}
let stopping = false, serverUp = false;
// tsx watch keeps running after the server crashes (it waits for a file change), so say so right away.
function crashed() {
  if (serverUp) return;
  console.log(color(31, `\n  API サーバーが起動時にエラーで止まりました。原因は直前の [server] の行です。`) + `\n  ファイルを直して保存すると自動で再起動します。Ctrl+C で終了できます。\n`);
}
function stop(code = 0) { stopping = true; for (const c of children) c.kill(); setTimeout(() => process.exit(code), 300); }
process.on('SIGINT', () => stop(0)); process.on('SIGTERM', () => stop(0));

// 1. Is the port free? (On Windows, ports reserved by Hyper-V/WSL fail with EACCES.)
const free = await new Promise(ok => {
  const s = createServer().once('error', e => ok(e.code)).once('listening', () => s.close(() => ok(true))).listen(PORT, '127.0.0.1');
});
if (free !== true) {
  console.error(color(31, `\n  ポート ${PORT} を使えません (${free})。`) + `\n  ${free === 'EADDRINUSE' ? '別のプロセス（前回の npm run dev など）が使用中です。止めてから再実行するか、' : 'OS に予約されている可能性があります。'}別のポートで起動してください:\n    PORT=8788 npm run dev        (macOS / Linux)\n    set PORT=8788 && npm run dev (Windows cmd)\n    $env:PORT=8788; npm run dev  (PowerShell)\n`);
  process.exit(1);
}

// 2. API server
console.log(color(36, `  API サーバーを起動しています (http://127.0.0.1:${PORT}) …`));
run('server', 34, [bin('tsx/dist/cli.mjs'), 'watch', '--clear-screen=false', 'server/index.ts']);

// 3. Wait for /api/health, then start Vite.
const t0 = Date.now(); let warned = false;
for (;;) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) break; } catch { /* not yet */ }
  if (!warned && Date.now() - t0 > 20000) {
    warned = true;
    console.log(color(33, `\n  API サーバーが 20 秒たっても応答しません。上の [server] の行にエラーが出ていないか確認してください。\n  （エラーがなければ起動に時間がかかっているだけなので、そのまま待ってください）\n`));
  }
  await new Promise(r => setTimeout(r, 400));
}
serverUp = true;
console.log(color(36, `  API サーバーの準備ができました (${((Date.now() - t0) / 1000).toFixed(1)} 秒)。画面を起動します …`));
run('web', 35, [bin('vite/bin/vite.js'), '--config', 'web/vite.config.ts']);

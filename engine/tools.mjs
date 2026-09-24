// tools.mjs: locating Chrome / ffmpeg and serving a project over HTTP. Shared by render.mjs and the GUI server.
import { existsSync, statSync, createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = resolve(ENGINE_DIR, '..');
export const VENDOR_DIR = join(ROOT_DIR, 'node_modules');
const require = createRequire(import.meta.url);

export function findChrome(explicit) {
  const c = [explicit, process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/opt/pw-browsers/chromium'];
  return c.find(p => p && existsSync(p)) || null;
}
function staticBin(pkg, pick) { try { const m = require(pkg); const p = pick(m); return p && existsSync(p) ? p : null; } catch { return null; } }
export const findFfmpeg = () => process.env.FFMPEG_PATH || staticBin('ffmpeg-static', m => m) || 'ffmpeg';
export const findFfprobe = () => process.env.FFPROBE_PATH || staticBin('ffprobe-static', m => m.path) || 'ffprobe';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.glsl': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.map': 'application/json',
};

// Resolve a URL path against a mount table { '/vendor/': dir, '/engine/': dir, '/': dir }, refusing to leave the mount.
export function resolveMount(mounts, urlPath) {
  const path = decodeURIComponent(urlPath.split('?')[0]);
  for (const [prefix, dir] of Object.entries(mounts).sort((a, b) => b[0].length - a[0].length)) {
    if (!path.startsWith(prefix)) continue;
    const file = normalize(join(dir, path.slice(prefix.length)));
    if (file !== dir && !file.startsWith(dir.endsWith(sep) ? dir : dir + sep)) return null;
    return file;
  }
  return null;
}

// Minimal static file server with Range support (needed for seeking in <video>/<audio>).
export function sendFile(req, res, file) {
  let st; try { st = statSync(file); } catch { res.writeHead(404); res.end('not found'); return; }
  if (st.isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const start = m[1] ? +m[1] : Math.max(0, st.size - +m[2]), end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
    if (start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    createReadStream(file).pipe(res);
  }
}

export function projectMounts(projectDir) {
  return { '/vendor/': VENDOR_DIR, '/engine/': ENGINE_DIR, '/': resolve(projectDir) };
}

// Serve one project on 127.0.0.1 with /vendor and /engine mounted. Resolves to { url, close }.
export function serveProject(projectDir) {
  const mounts = projectMounts(projectDir);
  const server = createServer((req, res) => {
    const file = resolveMount(mounts, req.url || '/');
    if (!file) { res.writeHead(403); res.end(); return; }
    sendFile(req, res, file);
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    ok({ url: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(() => r())) });
  }));
}

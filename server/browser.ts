// browser.ts: one shared headless Chrome for quick server-side snapshots (rough-board contact sheets).
import puppeteer, { type Browser } from 'puppeteer-core';
import { readFile } from 'node:fs/promises';
import { findChrome } from '../engine/tools.mjs';

let browser: Promise<Browser> | null = null;
let idle: NodeJS.Timeout | undefined;

async function getBrowser() {
  clearTimeout(idle);
  idle = setTimeout(() => { const b = browser; browser = null; b?.then(x => x.close()).catch(() => {}); }, 120_000);
  if (!browser) {
    const exe = findChrome();
    if (!exe) throw new Error('Chrome not found: set CHROME_PATH');
    const args = ['--hide-scrollbars'];
    if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox');
    browser = puppeteer.launch({ executablePath: exe, headless: true, args });
    browser.catch(() => { browser = null; });
  }
  return browser;
}

// Lay out SVG files in a grid with captions and return a JPEG (base64).
export async function svgContactSheet(items: { file: string; label: string }[], cols = 3, cellW = 480, aspect = 9 / 16) {
  const cellH = Math.round(cellW * aspect), rows = Math.ceil(items.length / cols);
  const cells = await Promise.all(items.map(async it => {
    let svg = ''; try { svg = await readFile(it.file, 'utf8'); } catch { svg = ''; }
    const src = svg ? 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') : '';
    return `<figure><div class="f">${src ? `<img src="${src}">` : '<span>(missing)</span>'}</div><figcaption>${it.label.replace(/[<&]/g, '')}</figcaption></figure>`;
  }));
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#2a2c33;font:14px system-ui,sans-serif;color:#eee}
    main{display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:8px;padding:8px}
    figure{margin:0}.f{width:${cellW}px;height:${cellH}px;background:#fff;display:grid;place-items:center;overflow:hidden}
    img{width:100%;height:100%;object-fit:contain}figcaption{padding:4px 2px}span{color:#b00}</style><main>${cells.join('')}</main>`;
  const b = await getBrowser(); const page = await b.newPage();
  try {
    await page.setViewport({ width: cols * (cellW + 8) + 8, height: rows * (cellH + 34) + 8 });
    await page.setContent(html, { waitUntil: 'load' });
    const buf = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: true });
    return Buffer.from(buf).toString('base64');
  } finally { await page.close(); }
}

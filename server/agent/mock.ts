// mock.ts: STUDIO_MOCK=1 stands in for Claude so the whole GUI flow can be tried (and developed) without credentials.
// It writes plausible but simple files: a storyboard split from the brief, placeholder SVG boards and Canvas2D scenes.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatEntry } from '../events.ts';
import { projectChanged } from '../events.ts';
import { loadBrief, loadProject, loadStoryboard, projectDir, regenerateCaptions, saveStyle, updateProject, updateStoryboard } from '../store.ts';
import { Storyboard, checkStoryboard } from '../schema.ts';
import type { AgentTask } from './prompts.ts';

type Record = (e: Omit<ChatEntry, 'id' | 'at' | 'task'>) => Promise<void>;
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((ok, bad) => {
  const t = setTimeout(ok, ms); signal.addEventListener('abort', () => { clearTimeout(t); bad(new Error('aborted')); }, { once: true });
});
const PALETTES = [['#1d2340', '#8ec3e6', '#ffc857', '#fff5e2'], ['#2b2233', '#e27a92', '#e8aa38', '#fff5e2'], ['#12343b', '#3a9c98', '#f2a283', '#f4efe6'], ['#231942', '#7b5ca8', '#9fd8cb', '#fdf6ec']];
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function runMock(slug: string, task: AgentTask, record: Record, signal: AbortSignal, shotIds?: string[]) {
  const dir = projectDir(slug);
  const [p, brief, sb] = await Promise.all([loadProject(slug), loadBrief(slug), loadStoryboard(slug)]);
  await record({ role: 'system', text: 'モックモード（STUDIO_MOCK=1）で動作しています。Claude は呼び出していません。' });
  await sleep(400, signal);

  if (task === 'plan') {
    await record({ role: 'tool', text: '読み込み brief.json' }); await sleep(500, signal);
    const D = p.format.duration, beats = p.audio.music?.bpm ? 60 / p.audio.music.bpm * 4 : 0;
    const snap = (t: number) => (beats ? r2(Math.round((t - (p.audio.music?.offset || 0)) / beats) * beats + (p.audio.music?.offset || 0)) : r2(t));
    const names = [['intro', '導入', '世界と主人公を見せる'], ['rise', '展開', '問題が大きくなる'], ['turn', '転換', '意外な発見'], ['finale', '結び', 'メッセージを残して締める']];
    const n = D < 20 ? 3 : 4, chapters: Storyboard['chapters'] = [];
    let t = 0;
    for (let i = 0; i < n; i++) {
      const end = i === n - 1 ? D : Math.max(t + 1, snap(D * (i + 1) / n));
      const shots = []; const k = Math.max(1, Math.round((end - t) / 3.5));
      for (let j = 0; j < k; j++) {
        const s0 = r2(t + (end - t) * j / k), s1 = j === k - 1 ? r2(end) : r2(t + (end - t) * (j + 1) / k);
        shots.push({ id: `s${String(chapters.reduce((a, c) => a + c.shots.length, 0) + j + 1).padStart(2, '0')}`, title: `${names[i][1]} ${j + 1}`, start: s0, end: s1,
          action: `${brief.theme || 'テーマ'}について、${names[i][2]}（${j + 1}/${k}）`, visual: j % 2 ? 'ゆっくり寄る。中央に主役のシルエット' : '横移動。前景と背景の視差', transition: j === k - 1 ? '色面のワイプで次の章へ' : '動きを引き継いでカット',
          narration: p.audio.narration.enabled ? `${names[i][1]}のナレーション、その${j + 1}。` : '' });
      }
      chapters.push({ id: names[i][0], title: names[i][1], start: r2(t), end: r2(end), summary: names[i][2], palette: PALETTES[i % PALETTES.length], shots } as never);
      t = end;
    }
    const board = Storyboard.parse({ logline: brief.theme ? `${brief.theme}を${n}つの章で描く` : 'モックの構成案', chapters });
    const errs = checkStoryboard(board, p.audio.music?.file ? D : 0);
    if (errs.length) throw new Error('mock storyboard invalid: ' + errs.join('; '));
    await updateStoryboard(slug, () => board); await regenerateCaptions(slug);
    await record({ role: 'tool', text: 'ストーリーボードを保存' }); projectChanged(slug, 'storyboard'); await sleep(400, signal);
    await saveStyle(slug, `# スタイルガイド（モック）\n\n## Concept\n${brief.theme || '（ブリーフのテーマ）'}\n\n## Look & technique\nCanvas2D のフラットなシェイプと大きな文字。\n\n## Palette\n${PALETTES[0].map(c => `- ${c}`).join('\n')}\n\n## Motion language\nイーズアウトで入り、拍に合わせて弾む。\n`);
    await record({ role: 'tool', text: '書き込み style.md' }); projectChanged(slug, 'style');
    await record({ role: 'assistant', text: `${n}章・${board.chapters.reduce((a, c) => a + c.shots.length, 0)}ショットの構成案を作りました（モック）。\nレビューで気になるショットにコメントを付けてください。` });
    return 0;
  }

  if (task === 'review') {
    let n = 0;
    await updateStoryboard(slug, s => { for (const shot of s.chapters.flatMap(c => c.shots)) for (const c of [...shot.comments]) if (!c.resolved && c.author === 'user') {
      c.resolved = true; n++; shot.comments.push({ id: `c${Date.now().toString(36)}${n}`, author: 'claude', text: `「${c.text.slice(0, 30)}」を反映しました（モック）`, at: new Date().toISOString(), resolved: true });
      shot.visual = `${shot.visual}（修正: ${c.text.slice(0, 40)}）`;
    } });
    await sleep(600, signal); await record({ role: 'tool', text: 'ショットを更新' }); await record({ role: 'tool', text: 'コメントに返信' }); projectChanged(slug, 'storyboard');
    await record({ role: 'assistant', text: n ? `${n}件のコメントを反映しました（モック）。` : 'ご意見ありがとうございます。変更が必要な点をショットのコメントで教えてください（モック）。' });
    return 0;
  }

  const shots = sb.chapters.flatMap(c => c.shots.map(s => ({ ...s, ch: c }))).filter(s => !shotIds?.length || shotIds.includes(s.id));
  if (task === 'drafts') {
    const { width: W, height: H } = p.format;
    for (const s of shots) {
      if (!shotIds?.length && s.status !== 'planned' && s.status !== 'retake') continue;
      const [bg, a, b, fg] = s.ch.palette.length >= 4 ? s.ch.palette : PALETTES[0];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><title>${s.id} ${s.title}</title>
<rect width="${W}" height="${H}" fill="${fg}"/><rect y="${H * .62}" width="${W}" height="${H * .38}" fill="${a}" opacity=".35"/>
<circle cx="${W * (.3 + .4 * ((s.start * 7) % 1))}" cy="${H * .45}" r="${H * .16}" fill="${b}" stroke="${bg}" stroke-width="6"/>
<rect x="${W * .55}" y="${H * .3}" width="${W * .18}" height="${H * .32}" rx="18" fill="${a}" stroke="${bg}" stroke-width="6"/>
<path d="M${W * .2} ${H * .78} L${W * .7} ${H * .78}" stroke="${bg}" stroke-width="5" stroke-dasharray="18 12" fill="none"/>
<text x="${W * .03}" y="${H * .08}" font-family="sans-serif" font-size="${H * .04}" fill="${bg}">${s.visual.includes('寄る') ? 'PUSH IN' : 'PAN →'}</text></svg>`;
      await writeFile(join(dir, 'drafts', `${s.id}.svg`), svg);
      await record({ role: 'tool', text: `書き込み drafts/${s.id}.svg`, sub: 'サブエージェント' }); projectChanged(slug, 'drafts'); await sleep(250, signal);
    }
    await updateStoryboard(slug, x => { for (const s of x.chapters.flatMap(c => c.shots)) if (shots.some(y => y.id === s.id) && (s.status === 'planned' || s.status === 'retake')) s.status = 'drafted'; });
    await record({ role: 'assistant', text: `${shots.length}ショットのラフ絵コンテを描きました（モック）。` });
    return 0;
  }

  // build / retake: one Canvas2D chapter file per chapter with a title-card style shot per storyboard shot.
  const byChapter = new Map<string, typeof shots>();
  for (const s of shots) byChapter.set(s.ch.id, [...(byChapter.get(s.ch.id) || []), s]);
  const full = await loadStoryboard(slug);
  for (const ch of full.chapters) {
    if (task === 'retake' && !byChapter.has(ch.id)) continue;
    await updateStoryboard(slug, x => { for (const s of x.chapters.find(c => c.id === ch.id)!.shots) if (!shotIds?.length || shotIds.includes(s.id)) s.status = 'building'; });
    projectChanged(slug, 'status'); await sleep(500, signal);
    const pal = JSON.stringify(ch.palette.length >= 4 ? ch.palette : PALETTES[0]);
    const code = `// ${ch.id}.js (mock): one simple shot per storyboard shot.
(() => {
  const PAL = ${pal};
  const card = (title, sub, k) => (t, lt, dur) => {
    const c = VIDEO.ctx, W = VIDEO.W, H = VIDEO.H, p = lt / dur;
    c.fillStyle = PAL[3]; c.fillRect(0, 0, W, H);
    c.fillStyle = PAL[1]; c.globalAlpha = .35; c.fillRect(0, H * .62, W, H * .38); c.globalAlpha = 1;
    const x = W * (.2 + .6 * easeInOut(p)), y = H * .45 - Math.abs(Math.sin(lt * 3 + k)) * H * .08;
    c.fillStyle = PAL[2]; c.strokeStyle = PAL[0]; c.lineWidth = 6; c.beginPath(); c.arc(x, y, H * .12 * backOut(seg(lt, 0, .5)), 0, TAU); c.fill(); c.stroke();
    c.fillStyle = PAL[0]; c.font = \`800 \${Math.round(H * .07)}px system-ui, sans-serif\`; c.textAlign = 'center';
    c.globalAlpha = easeOut(seg(lt, .1, .5)); c.fillText(title, W / 2, H * .2); c.globalAlpha = 1;
    c.font = \`500 \${Math.round(H * .03)}px system-ui, sans-serif\`; c.fillText(sub, W / 2, H * .27);
  };
  VIDEO.chapter(${JSON.stringify(ch.id)}, ${ch.start}, ${ch.end}, [
${ch.shots.map((s, i) => `    [${s.start}, card(${JSON.stringify(s.title)}, ${JSON.stringify(s.action.slice(0, 40))}, ${i}), ${JSON.stringify(s.id)}]`).join(',\n')}
  ]);
})();
`;
    await writeFile(join(dir, 'chapters', `${ch.id}.js`), code);
    await record({ role: 'tool', text: `書き込み chapters/${ch.id}.js`, sub: 'サブエージェント' });
    await updateStoryboard(slug, x => { for (const s of x.chapters.find(c => c.id === ch.id)!.shots) if (!shotIds?.length || shotIds.includes(s.id)) { s.status = 'built'; s.statusNote = 'モックで生成'; } });
    projectChanged(slug, 'status'); await sleep(300, signal);
  }
  // studio.html: one script tag per chapter, in time order
  const { readFile } = await import('node:fs/promises');
  let html = await readFile(join(dir, 'studio.html'), 'utf8');
  html = html.replace(/<!-- CHAPTERS:[^\n]*\n[\s\S]*?<!-- END CHAPTERS -->/, `<!-- CHAPTERS: one file per storyboard chapter, in time order -->\n${full.chapters.map(c => `<script src="chapters/${c.id}.js"></script>`).join('\n')}\n<!-- END CHAPTERS -->`);
  await writeFile(join(dir, 'studio.html'), html);
  await updateProject(slug, x => x);
  await record({ role: 'assistant', text: task === 'retake' ? `${shots.length}ショットを作り直しました（モック）。` : `${full.chapters.length}章を実装しました（モック）。プレビューで確認してください。` });
  return 0;
}

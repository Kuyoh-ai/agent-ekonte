// tools.ts: the "studio" MCP server the agents use to read and change structured project state.
// Writing storyboard.json through these tools (instead of the Write tool) keeps it valid and lets the GUI refresh live.
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { projectChanged } from '../events.ts';
import { renderSheet } from '../render.ts';
import { svgContactSheet } from '../browser.ts';
import { SHOT_STATUS, Storyboard, checkStoryboard, type Shot } from '../schema.ts';
import { loadProject, loadStoryboard, projectDir, updateProject, updateStoryboard, withLock, saveStoryboardFile, regenerateCaptions } from '../store.ts';

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], isError });

const ShotIn = z.object({
  id: z.string().describe('Stable shot id, e.g. "s01". Keep ids when revising so comments and drafts stay attached.'),
  title: z.string().describe('Short name of the shot'),
  start: z.number().describe('Start time in seconds (must equal the previous shot end)'),
  end: z.number().describe('End time in seconds'),
  action: z.string().describe('What happens on screen, concretely'),
  visual: z.string().describe('Composition, camera move, key colours, framing'),
  transition: z.string().describe('How this shot leads into the next one'),
  audioCue: z.string().optional().describe('Lyric line, beat or sound this shot lands on'),
  narration: z.string().optional().describe('Narration spoken over this shot (narration projects only)'),
  onScreenText: z.string().optional().describe('Text that must appear in the frame, if any'),
});
const ChapterIn = z.object({
  id: z.string().describe('Lowercase id, e.g. "intro". Becomes chapters/<id>.js'),
  title: z.string(),
  start: z.number(),
  end: z.number(),
  summary: z.string().describe('What this chapter does for the story'),
  palette: z.array(z.string()).describe('3–6 hex colours for this chapter'),
  shots: z.array(ShotIn),
});

// Keep status, comments and narration audio of shots that survive a revision.
function mergeShots(prev: Storyboard, next: Storyboard) {
  const old = new Map(prev.chapters.flatMap(c => c.shots).map(s => [s.id, s] as const));
  for (const c of next.chapters) c.shots = c.shots.map(s => {
    const o = old.get(s.id); if (!o) return s;
    const changed = ['action', 'visual', 'start', 'end'].some(k => (o as Record<string, unknown>)[k] !== (s as Record<string, unknown>)[k]);
    const keepAudio = o.narrationAudio && o.narration === s.narration;
    return { ...s, comments: o.comments, status: changed && o.status === 'approved' ? 'drafted' : o.status, statusNote: o.statusNote, narrationAudio: keepAudio ? o.narrationAudio : undefined };
  });
  return next;
}

export function studioServer(slug: string, task: string) {
  const dir = projectDir(slug);
  let sheetN = 0;
  return createSdkMcpServer({
    name: 'studio',
    version: '1.0.0',
    instructions: 'Tools for the Agent Video Studio project in the working directory. Use them for storyboard.json and shot status; never write those files directly.',
    tools: [
      tool('save_storyboard', 'Replace the whole storyboard (chapters and shots). Chapters must be contiguous from 0 to the video duration and shots contiguous inside each chapter. Returns validation errors to fix if any.', {
        logline: z.string().describe('One-sentence concept of the video'),
        chapters: z.array(ChapterIn),
      }, async (args) => {
        const project = await loadProject(slug);
        const sb = Storyboard.parse(args);
        const fixedDuration = !!project.audio.music?.file;
        const errs = checkStoryboard(sb, fixedDuration ? project.format.duration : 0);
        if (errs.length) return text('Not saved. Fix these problems and call save_storyboard again:\n- ' + errs.join('\n- '), true);
        await withLock(slug, async () => saveStoryboardFile(slug, mergeShots(await loadStoryboard(slug), sb)));
        const end = sb.chapters.at(-1)?.end ?? 0;
        if (!fixedDuration && end > 0 && Math.abs(end - project.format.duration) > .01) await updateProject(slug, p => { p.format.duration = end; });
        await regenerateCaptions(slug);
        projectChanged(slug, 'storyboard');
        const n = sb.chapters.reduce((k, c) => k + c.shots.length, 0);
        return text(`Saved: ${sb.chapters.length} chapters, ${n} shots, ${end.toFixed(2)} s.`);
      }),

      tool('update_shots', 'Change fields of existing shots and/or chapters without resending everything. Timing changes must keep shots contiguous: include the neighbouring shots in the same call.', {
        shots: z.array(ShotIn.partial().extend({ id: z.string() })).optional().describe('Shots to patch, by id'),
        chapters: z.array(ChapterIn.omit({ shots: true }).partial().extend({ id: z.string() })).optional().describe('Chapters to patch, by id'),
      }, async ({ shots = [], chapters = [] }) => {
        const project = await loadProject(slug);
        let problems: string[] = [];
        await updateStoryboard(slug, sb => {
          const draft: Storyboard = structuredClone(sb);
          for (const p of chapters) { const c = draft.chapters.find(x => x.id === p.id); if (!c) { problems.push(`unknown chapter ${p.id}`); continue; } Object.assign(c, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined))); }
          for (const p of shots) {
            const s = draft.chapters.flatMap(c => c.shots).find(x => x.id === p.id);
            if (!s) { problems.push(`unknown shot ${p.id}`); continue; }
            const before = { action: s.action, visual: s.visual, narration: s.narration };
            Object.assign(s, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)));
            if (s.status === 'approved' && (s.action !== before.action || s.visual !== before.visual)) s.status = 'drafted';
            if (s.narration !== before.narration) s.narrationAudio = undefined;
          }
          problems = problems.concat(checkStoryboard(draft, project.audio.music?.file ? project.format.duration : 0));
          return problems.length ? sb : draft;
        });
        if (problems.length) return text('Not saved:\n- ' + problems.join('\n- '), true);
        await regenerateCaptions(slug);
        projectChanged(slug, 'storyboard');
        return text(`Updated ${shots.length} shot(s) and ${chapters.length} chapter(s).`);
      }),

      tool('resolve_comments', "Mark the user's review comments as handled and leave a short reply on each (in the user's language).", {
        items: z.array(z.object({ commentId: z.string(), reply: z.string().describe('What you changed, or the answer to the question') })),
      }, async ({ items }) => {
        let n = 0;
        await updateStoryboard(slug, sb => {
          for (const s of sb.chapters.flatMap(c => c.shots)) for (const it of items) {
            const c = s.comments.find(x => x.id === it.commentId); if (!c) continue;
            c.resolved = true; n++;
            s.comments.push({ id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, author: 'claude', text: it.reply, at: new Date().toISOString(), resolved: true });
          }
        });
        projectChanged(slug, 'comments');
        return text(`Resolved ${n} comment(s).`);
      }),

      tool('set_shot_status', 'Report progress on shots: drafted (rough board done), building (you started coding it), built (passes your visual check), blocked (cannot finish: say why in note).', {
        shotIds: z.array(z.string()),
        status: z.enum(SHOT_STATUS),
        note: z.string().optional().describe('One line for the user'),
      }, async ({ shotIds, status, note }) => {
        const missing: string[] = [];
        await updateStoryboard(slug, sb => {
          const all = new Map(sb.chapters.flatMap(c => c.shots).map(s => [s.id, s] as const));
          for (const id of shotIds) { const s = all.get(id); if (!s) { missing.push(id); continue; } s.status = status; s.statusNote = note || ''; }
        });
        projectChanged(slug, 'status', 100);
        return text(missing.length ? `Updated; unknown ids: ${missing.join(', ')}` : `Set ${shotIds.length} shot(s) to ${status}.`, missing.length === shotIds.length);
      }),

      tool('view_drafts', 'Render rough-board SVGs (drafts/<shotId>.svg) into one contact sheet image so you can check them visually.', {
        shotIds: z.array(z.string()).optional().describe('Defaults to every shot that has a draft'),
      }, async ({ shotIds }) => {
        const [sb, project] = await Promise.all([loadStoryboard(slug), loadProject(slug)]);
        const shots: Shot[] = sb.chapters.flatMap(c => c.shots).filter(s => shotIds ? shotIds.includes(s.id) : existsSync(join(dir, 'drafts', `${s.id}.svg`)));
        if (!shots.length) return text('No drafts found.', true);
        const items = shots.slice(0, 24).map(s => ({ file: join(dir, 'drafts', `${s.id}.svg`), label: `${s.id} · ${s.start.toFixed(1)}–${s.end.toFixed(1)}s · ${s.title}` }));
        const jpg = await svgContactSheet(items, 3, 480, project.format.height / project.format.width);
        return { content: [{ type: 'image' as const, data: jpg, mimeType: 'image/jpeg' }, { type: 'text' as const, text: `${items.length} draft(s)${shots.length > 24 ? ' (first 24 shown)' : ''}.` }] };
      }),

      tool('render_sheet', 'Render frames of the real video at the given times with headless Chrome and return them as one contact sheet image, with ms per frame and any page errors. Use it to check your scene code visually.', {
        times: z.array(z.number()).min(1).max(12).describe('Times in seconds'),
        cols: z.number().int().min(1).max(4).optional(),
        width: z.number().int().min(240).max(960).optional().describe('Width of each cell in px (default 640)'),
      }, async ({ times, cols, width }) => {
        const out = `out/check/${task}-${Date.now().toString(36)}-${++sheetN}.jpg`;
        const r = await renderSheet(dir, times, { cols: cols || Math.min(3, times.length), width, out });
        const notes = [r.ms.length ? `ms/frame: ${r.ms.join(' ')}` : '', ...r.logs.slice(0, 20)].filter(Boolean).join('\n');
        if (!r.ok) return text(`Render failed.\n${notes}\n${r.errTail}`.trim(), true);
        const jpg = await readFile(join(dir, r.out));
        return { content: [{ type: 'image' as const, data: jpg.toString('base64'), mimeType: 'image/jpeg' }, { type: 'text' as const, text: `${r.out}\n${notes}`.trim() }] };
      }),
    ],
  });
}

export const STUDIO_TOOLS = ['save_storyboard', 'update_shots', 'resolve_comments', 'set_shot_status', 'view_drafts', 'render_sheet'].map(n => `mcp__studio__${n}`);

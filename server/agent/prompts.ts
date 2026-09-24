// prompts.ts: what each step asks of Claude. The system prompt sets the role; the user prompt carries the project context.
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { Brief, Project, Storyboard } from '../schema.ts';

export type AgentTask = 'plan' | 'review' | 'drafts' | 'build' | 'retake';

const f2 = (n: number) => n.toFixed(2);

const COMMON = `
You work inside Agent Video Studio, a local app where a user makes a video with you step by step:
brief → storyboard plan → storyboard review → rough boards → production → export.
The working directory is the project folder. The user watches your replies in a chat panel next to the storyboard and
timeline, so keep replies short, concrete and friendly. Reply in the language the brief is written in (Japanese unless
the brief is clearly in another language). Do not paste whole files or JSON into replies.
storyboard.json, project.json, brief.json and captions.json are managed by the app: change the storyboard only through
the mcp__studio__* tools, and never edit the other three.
The rendering engine and its contract are described in /engine/AGENT_GUIDE.md (on disk: ENGINE_DIR/AGENT_GUIDE.md).
`.trim();

export function systemAppend(task: AgentTask, engineDir: string) {
  const role: Record<AgentTask, string> = {
    plan: `Right now you are the director: turn the brief into a timeline (chapters and shots) and a style guide that a team of animator agents can execute in code.`,
    review: `Right now you are the director in a review session: the user comments on the storyboard and you revise it with them.`,
    drafts: `Right now you are the storyboard artist: draw rough boards (simple SVG frames) so the user can review composition and flow before production starts.`,
    build: `Right now you are the lead animator: set up the project's code and coordinate chapter-builder subagents that implement the approved storyboard, then check the whole video.`,
    retake: `Right now you are the lead animator handling retakes: fix the specific shots the user flagged, check them visually, and report.`,
  };
  return `${COMMON.replace('ENGINE_DIR', engineDir)}\n\n${role[task]}`;
}

export function projectContext(p: Project, brief: Brief, sb: Storyboard) {
  const lines: string[] = [];
  lines.push(`## Project\n- name: ${p.name}\n- format: ${p.format.width}×${p.format.height}, ${p.format.fps} fps, ${f2(p.format.duration)} s`);
  const b = Object.entries(brief).filter(([, v]) => String(v).trim()).map(([k, v]) => `- ${k}: ${String(v).trim()}`);
  lines.push(`## Brief (from the user)\n${b.join('\n') || '- (empty)'}`);
  const m = p.audio.music;
  if (m?.file) {
    let s = `## Music\n- file: ${m.file} (${f2(m.duration)} s). The video length is fixed to the music: the storyboard must end at exactly ${f2(p.format.duration)} s.`;
    if (m.bpm > 0) {
      const beat = 60 / m.bpm, bar = beat * 4;
      const bars: string[] = []; for (let t = m.offset, i = 0; t < p.format.duration && i < 400; t += bar, i++) bars.push(f2(t));
      s += `\n- tempo: ${m.bpm} BPM, beat 0 at ${f2(m.offset)} s, beat = ${f2(beat)} s, bar (4 beats) = ${f2(bar)} s. In code: beatTime(n), pulse(t).\n- bar starts (s): ${bars.join(', ')}`;
    }
    if (m.lyrics.length) s += `\n- lyrics (start–end: line). Cut on lyric lines; each line usually gets its own shot:\n${m.lyrics.map(l => `  ${f2(l.start)}–${f2(l.end)}: ${l.text}`).join('\n')}`;
    lines.push(s);
  } else lines.push(`## Music\n- none. The target length is about ${f2(p.format.duration)} s; you may adjust it if the story needs it.`);
  if (p.audio.narration.enabled) lines.push(`## Narration\n- enabled (TTS, synthesised later from each shot's "narration" field). Write natural spoken lines. Budget about 7 Japanese characters or 2.5 English words per second, plus ${p.audio.narration.gap}s of air per line; the app stretches shots later to fit the real audio.`);
  lines.push(`## Captions\n- ${p.captions === 'none' ? 'off' : p.captions + ' (drawn by the runtime in the bottom ~14% of the frame)'}`);
  lines.push(`## Look (chosen by the user)\n- ${LOOK_TEXT[p.look] || LOOK_TEXT.auto}`);
  if (p.assets.length) lines.push(`## Image assets (uploaded by the user)\nWhen any text says @imgN it means that image. Look at the ones you need with the Read tool before planning or drawing with them.\n` +
    p.assets.map(a => `- @${a.id}: ${a.file} (${a.width}×${a.height})${a.name ? ` "${a.name}"` : ''}${a.description ? ` — ${a.description}` : ''}`).join('\n'));
  if (sb.chapters.length) {
    lines.push(`## Current storyboard (${sb.chapters.length} chapters, logline: ${sb.logline || '-'})\n` + sb.chapters.map(c =>
      `- [${c.id}] ${f2(c.start)}–${f2(c.end)} ${c.title}\n` + c.shots.map(s => `  - ${s.id} ${f2(s.start)}–${f2(s.end)} (${s.status}) ${s.title}: ${s.action}`).join('\n')).join('\n'));
  }
  return lines.join('\n\n');
}

const LOOK_TEXT: Record<string, string> = {
  auto: 'auto: choose the rendering approach that gives the RICHEST result for this brief, and justify it in style.md. Prefer the painted kit for illustrated, picture-book, hand-made or cute looks; the vector + chibi kits (anime) for characters with faces that act (cel look, morphing eyes and mouths); the motion kit for graphic, flat, corporate or typographic looks; three.js for 3D. Never choose for render speed.',
  painted: 'painted: watercolour and ink on paper with the painted kit (p5 + p5.brush), like examples/pdoom.',
  motion: 'motion graphics: Canvas2D with the motion kit (depth, light, texture, particles, finish overlay), GSAP where useful.',
  sketch: 'hand-drawn sketch: Rough.js line work on top of the motion kit (colour fills, texture, light and depth are still required).',
  anime: 'anime / vector: cel-shaded vector shapes with the vector kit (Catmull-Rom curves, tapered ink, morphable eyes and mouths) and chibi character rigs from the chibi kit, on top of the motion kit for camera and finish. Follow engine/VECTOR_GUIDE.md.',
  '3d': '3D: three.js with proper lighting, materials, fog and a 2D grain overlay from the motion kit.',
};

export function openComments(sb: Storyboard) {
  const out: string[] = [];
  for (const c of sb.chapters) for (const s of c.shots) for (const cm of s.comments) if (!cm.resolved && cm.author === 'user') out.push(`- comment ${cm.id} on shot ${s.id} ("${s.title}", ${f2(s.start)}–${f2(s.end)}): ${cm.text}`);
  return out;
}

export function taskPrompt(task: AgentTask, ctx: string, userMessage: string, extra: { comments: string[]; shotIds?: string[]; engineDir: string }) {
  const msg = userMessage.trim() ? `\n\n## Message from the user\n${userMessage.trim()}` : '';
  const comments = extra.comments.length ? `\n\n## Open review comments\n${extra.comments.join('\n')}` : '';
  switch (task) {
    case 'plan': return `${ctx}${msg}

## Your task: propose the plan
1. Read the brief closely (and any image assets it mentions). Decide the concept and a structure that serves the purpose
   and audience. Aim high: skim ${extra.engineDir}/../examples/pdoom/STORYBOARD.md for the level
   of invention expected — a visual idea or gag in every shot, recurring motifs that pay off, motivated transitions.
2. Split the video into chapters (sections of the story: 3–9 for most videos) and shots (usually 1.5–6 s; faster for
   energetic pieces). Every shot needs a concrete, visual action: something happens on screen (a character acts,
   something transforms, breaks, grows, is revealed). Say what the camera does. Plan transitions that carry motion across
   the cut. Keep on-screen text minimal unless the brief needs it.
3. Write style.md (with the Write tool) as the production bible for a team of animator agents, with these sections:
   Concept · Rendering (the kit and libraries from ${extra.engineDir}/AGENT_GUIDE.md, following the Look above, and why) ·
   Palette (hex values with roles, per chapter if the palette evolves) · Typography (Google Fonts faces, if any text) ·
   Characters & recurring motifs (shapes, proportions, poses, expressions: specific enough to build a rig) ·
   Depth & light (layers, atmosphere, light sources) · Texture & finish · Motion language (easing, squash and stretch,
   rhythm, camera) · Transitions · Do / Don't. Frames may take up to ~3 s each to render: never simplify for speed.
4. Save the timeline with mcp__studio__save_storyboard. If it returns problems, fix them and save again.
5. Reply with a short summary: the concept in one line, the structure in a few lines, the look you chose and why, and at
   most 3 questions or choices you want the user to weigh in on during review.`;
    case 'review': return `${ctx}${comments}${msg}

## Your task: revise the storyboard with the user
- Address every open comment and the user's message. Change the storyboard with mcp__studio__update_shots (small edits)
  or mcp__studio__save_storyboard (structural changes: adding, removing or reordering shots). Keep shot ids of shots that
  survive so drafts and comments stay attached. Update style.md if a comment changes the look.
- A comment that is a question may need an answer rather than a change.
- Then call mcp__studio__resolve_comments with a one-line reply for each comment you handled.
- Leave everything the user did not ask about unchanged. Do not touch code in this step: if a shot that is already
  "built" changes, set it to "retake" with mcp__studio__set_shot_status so production redoes it. Reply with what
  changed, briefly.`;
    case 'drafts': {
      const scope = extra.shotIds?.length ? `only these shots: ${extra.shotIds.join(', ')}` : 'every shot that has no approved draft yet';
      return `${ctx}${comments}${msg}

## Your task: rough boards for ${scope}
Read style.md first. For each shot, write drafts/<shotId>.svg: one key frame that shows the composition at the shot's
most telling moment.
- <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H"> with the project's width and height; include a <title>.
- Simple flat shapes in the style's palette, clear silhouettes, simple faces/poses; no fine detail, at most ~150 elements.
  Boards fix composition and staging only; production will render far richer frames, so spend the effort on framing,
  staging, depth layers (show foreground / midground / background) and the key pose, not on rendering.
- Where an image asset (@imgN) appears, draw a labelled rectangle with its aspect ratio and the label "@imgN".
- Show motion with dashed arrows, and camera moves with a small label in a corner (e.g. "PUSH IN", "PAN →").
- Keep the bottom ~14% free of key action when captions are on.
- If a shot changes a lot within itself, you may add drafts/<shotId>_b.svg for its end state.
When there are more than 6 shots, delegate: spawn one storyboard-artist subagent per chapter in parallel (Agent tool),
giving each the chapter id, shot ids with their fields, the palette and the style notes it needs. Afterwards call
mcp__studio__view_drafts, fix anything that is off-style or unclear, set the shots to "drafted" with
mcp__studio__set_shot_status, resolve any comments you addressed, and reply with a short summary.`;
    }
    case 'build': {
      const scope = extra.shotIds?.length ? `these shots: ${extra.shotIds.join(', ')}` : 'every shot that is not "built" yet';
      return `${ctx}${comments}${msg}

## Your task: produce the video (${scope})
Read ${extra.engineDir}/AGENT_GUIDE.md fully (especially "Rendering kits" and "The quality bar"), then style.md, the
drafts and any image assets. Skim one chapter of ${extra.engineDir}/../examples/pdoom/src/ch/ to calibrate the density expected.
1. Look development (you, the lead) — before any chapter work:
   - studio.html: libraries and the kit named in style.md, fonts, one <script> per chapter file chapters/<chapterId>.js
     in time order before the END CHAPTERS marker.
   - lib/: the palette, reusable rigs for every character and recurring prop (pose, expression, blink, squash, emote
     parameters, like ${extra.engineDir}/../examples/pdoom/src/clawd.js), background/environment builders with depth layers, and helpers every
     chapter will use. Put a short API comment at the top of each file.
   - Register VIDEO.test('cast', ...) (a model sheet: each character in several poses and expressions) and
     VIDEO.test('style', ...) (one finished style frame of a typical scene). Render them with
     mcp__studio__render_sheet({ times, test }) and iterate until they look like frames from a finished film. This is
     where the look is decided: do not delegate until they do.
   - A stub for each chapter that registers VIDEO.chapter(...) with all its shots so the whole timeline renders.
2. Delegate: spawn one chapter-builder subagent per chapter, in parallel (several Agent tool calls in one message).
   Give each: chapter id, start/end, its shots (id, times, action, visual, transition, audio cue), the draft files, the
   lib/ API, the look-dev frames to match, and the quality bar. They edit only their own chapter file.
3. Integrate: render sheets around every chapter boundary and a spread of frames across the video; fix seams, style
   drift and errors.
4. Polish pass: review every shot against the quality bar in AGENT_GUIDE.md (something happens, depth, camera, acting,
   light, texture, rhythm). For shots that fall short, either fix them yourself or send them back to a chapter-builder
   with specific notes. Make sure every shot ends "built" (or "blocked" with a reason).
5. Reply with a short summary: what was built, anything blocked, and what to look at first.`;
    }
    case 'retake': return `${ctx}${comments}${msg}

## Your task: retakes for ${extra.shotIds?.length ? extra.shotIds.join(', ') : 'the shots mentioned in the comments'}
Read ${extra.engineDir}/AGENT_GUIDE.md if you have not in this session. Fix the flagged shots in their chapter files
(and lib/ only if the fix really is shared), keeping to the quality bar in AGENT_GUIDE.md. Set each to "building" while you work, check it with
mcp__studio__render_sheet (first/middle/last frame plus any hit), then set it to "built". Resolve the comments you
addressed with mcp__studio__resolve_comments and reply briefly.`;
  }
}

export function subagents(engineDir: string, models: { drafts: string; production: string }): Record<string, AgentDefinition> {
  return {
    'storyboard-artist': {
      description: 'Draws rough SVG storyboard frames (drafts/<shotId>.svg) for one chapter of the video.',
      model: models.drafts,
      tools: ['Read', 'Write', 'Glob', 'mcp__studio__view_drafts', 'mcp__studio__set_shot_status'],
      prompt: `You draw rough storyboard frames for one chapter of a video, as SVG files in drafts/. Read style.md first.
For each shot you are given, write drafts/<shotId>.svg: one key frame, viewBox matching the project size, a <title>,
simple flat shapes in the palette, clear silhouettes, dashed arrows for motion, a small corner label for camera moves,
bottom ~14% free of key action. At most ~150 elements per file. Then check your work with mcp__studio__view_drafts,
fix anything unclear, and set your shots to "drafted" with mcp__studio__set_shot_status. Report in one short paragraph.`,
    },
    'chapter-builder': {
      description: 'Implements one storyboard chapter as scene code (chapters/<id>.js) for the frame runtime and verifies it visually.',
      model: models.production,
      tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'mcp__studio__render_sheet', 'mcp__studio__view_drafts', 'mcp__studio__set_shot_status'],
      prompt: `You animate one chapter of a video as code. First read ${engineDir}/AGENT_GUIDE.md completely (the rendering
kits and the quality bar), then style.md, everything in lib/, studio.html and your shots' drafts (drafts/<shotId>.svg).
Render the lead's look-dev frames (mcp__studio__render_sheet with test: 'style' and 'cast') and match that finish.
Edit only chapters/<yourChapterId>.js. Rough boards fix composition only: your frames must be far richer.
For each shot: set it to "building", implement it as a pure function of t with depth layers, a camera move, acting
(anticipation, overshoot, squash and stretch, secondary motion), light and texture, using the lib/ rigs for characters.
A shot is typically 60–200 lines with its own private helpers. Check it with mcp__studio__render_sheet (first/last
frame, a few in between, every ~0.1 s around hits, and the transitions in and out of your chapter) and iterate until it
passes the quality bar, then set it to "built" with a one-line note. When all shots are built, do a second pass: render
the whole chapter again and upgrade the weakest shot. If you cannot finish a shot, set it to "blocked" with the reason.
Finish with a short report: what you built, helpers you wrote privately, problems.`,
    },
  };
}

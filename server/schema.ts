// schema.ts: the files that make up a project folder, validated with zod.
import { z } from 'zod';

export const STEPS = ['brief', 'plan', 'review', 'drafts', 'build', 'export'] as const;
export type StepId = (typeof STEPS)[number];

export const MODEL_CHOICES = ['claude-opus-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-haiku-4-5'] as const;
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export const Format = z.object({
  width: z.number().int().min(160).max(4096).default(1920),
  height: z.number().int().min(160).max(4096).default(1080),
  fps: z.number().int().min(1).max(60).default(24),
  duration: z.number().positive().max(3600).default(30),
});

export const TimedLine = z.object({ start: z.number(), end: z.number(), text: z.string() });
export type TimedLine = z.infer<typeof TimedLine>;

export const Music = z.object({
  file: z.string(),                    // relative to the project folder, e.g. assets/music.mp3
  duration: z.number().default(0),
  bpm: z.number().default(0),          // 0 = unknown / not beat-synced
  offset: z.number().default(0),       // time of beat 0 in seconds
  lyrics: z.array(TimedLine).default([]),
});
export const Narration = z.object({
  enabled: z.boolean().default(false),
  engine: z.enum(['voicevox', 'none']).default('voicevox'),
  url: z.string().default('http://127.0.0.1:50021'),
  speaker: z.number().int().default(3),
  speed: z.number().min(.5).max(2).default(1),
  gap: z.number().min(0).max(3).default(.5), // silence kept around each line when retiming shots
  musicVolume: z.number().min(0).max(1).default(.35), // music level under narration
});

export const Project = z.object({
  name: z.string().min(1),
  slug: z.string(),
  createdAt: z.string(),
  step: z.enum(STEPS).default('brief'),
  format: Format.default(Format.parse({})),
  audio: z.object({ music: Music.optional(), narration: Narration.default(Narration.parse({})) }).default({ narration: Narration.parse({}) }),
  captions: z.enum(['none', 'subtitle', 'karaoke']).default('subtitle'),
  models: z.object({
    planning: z.string().default('claude-opus-5'),
    drafts: z.string().default('claude-opus-5'),
    production: z.string().default('claude-opus-5'),
  }).default({ planning: 'claude-opus-5', drafts: 'claude-opus-5', production: 'claude-opus-5' }),
  effort: z.enum(EFFORTS).default('high'),
  budgetUsd: z.number().min(0).default(0), // 0 = no cap per agent run
  approvals: z.object({ storyboard: z.boolean().default(false), drafts: z.boolean().default(false) }).default({ storyboard: false, drafts: false }),
  // Visual approach. 'auto' lets Claude choose (and justify) in the plan; the others pin an engine kit.
  look: z.enum(['auto', 'painted', 'motion', 'sketch', '3d']).default('auto'),
  // Image assets the user uploaded; mentioned in any text as @img1, @img2, ...
  assets: z.array(z.object({
    id: z.string(), file: z.string(), name: z.string().default(''), description: z.string().default(''),
    width: z.number().default(0), height: z.number().default(0),
  })).default([]),
  // How the agents sign in: chosen explicitly in Step 1 (see server/auth.ts).
  auth: z.enum(['unset', 'subscription', 'apiKey']).default('unset'),
  authInfo: z.object({ ok: z.boolean(), summary: z.string(), at: z.string(), mode: z.string() }).optional(),
  sessions: z.record(z.string(), z.string()).default({}),
  costUsd: z.number().default(0),
});
export type Project = z.infer<typeof Project>;

export const Brief = z.object({
  title: z.string().default(''),
  purpose: z.string().default(''),     // why the video exists / what it should achieve
  audience: z.string().default(''),
  theme: z.string().default(''),       // subject and message
  flow: z.string().default(''),        // rough structure: beginning → middle → end
  tone: z.string().default(''),
  visualStyle: z.string().default(''),
  references: z.string().default(''),
  mustHave: z.string().default(''),
  avoid: z.string().default(''),
  notes: z.string().default(''),
});
export type Brief = z.infer<typeof Brief>;

export const SHOT_STATUS = ['planned', 'drafted', 'approved', 'building', 'built', 'blocked', 'retake'] as const;
export const Comment = z.object({
  id: z.string(),
  author: z.enum(['user', 'claude']),
  text: z.string(),
  at: z.string(),
  resolved: z.boolean().default(false),
});
export type Comment = z.infer<typeof Comment>;

export const Shot = z.object({
  id: z.string(),
  title: z.string().default(''),
  start: z.number(),
  end: z.number(),
  action: z.string().default(''),      // what happens
  visual: z.string().default(''),      // composition, camera, key colours
  transition: z.string().default(''),  // how it leads into the next shot
  audioCue: z.string().default(''),    // lyric / beat / sound this shot lands on
  narration: z.string().default(''),   // narration line spoken over this shot (narration mode)
  onScreenText: z.string().default(''),
  status: z.enum(SHOT_STATUS).default('planned'),
  statusNote: z.string().default(''),
  comments: z.array(Comment).default([]),
  narrationAudio: z.object({ file: z.string(), duration: z.number() }).optional(),
});
export type Shot = z.infer<typeof Shot>;

export const Chapter = z.object({
  id: z.string(),
  title: z.string().default(''),
  start: z.number(),
  end: z.number(),
  summary: z.string().default(''),
  palette: z.array(z.string()).default([]),
  shots: z.array(Shot).default([]),
});
export type Chapter = z.infer<typeof Chapter>;

export const Storyboard = z.object({
  logline: z.string().default(''),
  chapters: z.array(Chapter).default([]),
});
export type Storyboard = z.infer<typeof Storyboard>;

export const allShots = (sb: Storyboard) => sb.chapters.flatMap(c => c.shots.map(s => ({ ...s, chapterId: c.id })));

// Structural checks shared by the save tool and the manual editor. Returns human-readable problems.
export function checkStoryboard(sb: Storyboard, duration: number): string[] {
  const errs: string[] = [], ids = new Set<string>(), chIds = new Set<string>();
  const eps = 1e-3;
  let prevEnd = 0;
  sb.chapters.forEach((c, ci) => {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(c.id)) errs.push(`chapter "${c.id}": id must be lowercase letters, digits, - or _`);
    if (chIds.has(c.id)) errs.push(`chapter id "${c.id}" is used twice`); chIds.add(c.id);
    if (!(c.end > c.start)) errs.push(`chapter ${c.id}: end must be after start`);
    if (Math.abs(c.start - prevEnd) > eps) errs.push(`chapter ${c.id} starts at ${c.start}s but the previous one ends at ${prevEnd}s (chapters must be contiguous, starting at 0)`);
    prevEnd = c.end;
    if (!c.shots.length) errs.push(`chapter ${c.id} has no shots`);
    let sPrev = c.start;
    c.shots.forEach((s, si) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(s.id)) errs.push(`shot "${s.id}": id must be letters, digits, - or _`);
      if (ids.has(s.id)) errs.push(`shot id "${s.id}" is used twice`); ids.add(s.id);
      if (!(s.end > s.start)) errs.push(`shot ${s.id}: end must be after start`);
      if (Math.abs(s.start - sPrev) > eps) errs.push(`shot ${s.id} starts at ${s.start}s but should start where the previous shot ends (${sPrev}s)`);
      sPrev = s.end;
      if (si === c.shots.length - 1 && Math.abs(s.end - c.end) > eps) errs.push(`last shot ${s.id} ends at ${s.end}s but chapter ${c.id} ends at ${c.end}s`);
    });
    if (ci === sb.chapters.length - 1 && duration > 0 && Math.abs(c.end - duration) > .05) errs.push(`the last chapter ends at ${c.end}s but the video is ${duration}s long`);
  });
  return errs;
}

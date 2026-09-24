// store.ts: project folders on disk. Every project is a self-describing folder with its own git history.
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ENGINE_DIR, ROOT_DIR } from '../engine/tools.mjs';
import { Brief, Project, Storyboard, type TimedLine } from './schema.ts';
import * as git from './git.ts';

export const PROJECTS_DIR = resolve(process.env.STUDIO_PROJECTS_DIR || join(ROOT_DIR, 'projects'));
mkdirSync(PROJECTS_DIR, { recursive: true });

export const projectDir = (slug: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new HttpError(400, 'invalid project id');
  return join(PROJECTS_DIR, slug);
};
export class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

// Serialise writes per project: parallel subagents update the storyboard at the same time.
const locks = new Map<string, Promise<unknown>>();
export function withLock<T>(slug: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(slug) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(slug, next.catch(() => {}));
  return next;
}

async function readJSON<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return fallback; }
}
const writeJSON = (file: string, data: unknown) => writeFile(file, JSON.stringify(data, null, 2) + '\n');

export async function loadProject(slug: string): Promise<Project> {
  const dir = projectDir(slug);
  if (!existsSync(join(dir, 'project.json'))) throw new HttpError(404, `project "${slug}" not found`);
  return Project.parse(await readJSON(join(dir, 'project.json'), {}));
}
export const saveProjectFile = (slug: string, p: Project) => writeJSON(join(projectDir(slug), 'project.json'), Project.parse(p));
export async function updateProject(slug: string, fn: (p: Project) => Project | void): Promise<Project> {
  return withLock(slug, async () => {
    const p = await loadProject(slug); const next = fn(p) || p;
    await saveProjectFile(slug, next); return next;
  });
}

export const loadBrief = async (slug: string) => Brief.parse(await readJSON(join(projectDir(slug), 'brief.json'), {}));
export const saveBrief = (slug: string, b: unknown) => writeJSON(join(projectDir(slug), 'brief.json'), Brief.parse(b));
export const loadStoryboard = async (slug: string) => Storyboard.parse(await readJSON(join(projectDir(slug), 'storyboard.json'), {}));
export const saveStoryboardFile = (slug: string, sb: Storyboard) => writeJSON(join(projectDir(slug), 'storyboard.json'), Storyboard.parse(sb));
export async function updateStoryboard(slug: string, fn: (sb: Storyboard) => Storyboard | void): Promise<Storyboard> {
  return withLock(slug, async () => {
    const sb = await loadStoryboard(slug); const next = Storyboard.parse(fn(sb) || sb);
    await saveStoryboardFile(slug, next); return next;
  });
}
export const loadStyle = async (slug: string) => { try { return await readFile(join(projectDir(slug), 'style.md'), 'utf8'); } catch { return ''; } };
export const saveStyle = (slug: string, md: string) => writeFile(join(projectDir(slug), 'style.md'), md);

function slugify(name: string) {
  const base = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let slug = base || `video-${stamp}`, i = 2;
  while (existsSync(join(PROJECTS_DIR, slug))) slug = `${base || 'video-' + stamp}-${i++}`;
  return slug;
}

export async function createProject(input: { name: string; format?: Partial<Project['format']> }) {
  const slug = slugify(input.name);
  const dir = join(PROJECTS_DIR, slug);
  for (const d of ['assets', 'drafts', 'lib', 'chapters', 'out', '.studio']) mkdirSync(join(dir, d), { recursive: true });
  const project = Project.parse({ name: input.name, slug, createdAt: new Date().toISOString(), format: input.format || {} });
  await saveProjectFile(slug, project);
  await saveBrief(slug, { title: input.name });
  await saveStoryboardFile(slug, Storyboard.parse({}));
  await writeFile(join(dir, 'style.md'), '');
  await writeJSON(join(dir, 'captions.json'), []);
  const tpl = await readFile(join(ENGINE_DIR, 'studio.template.html'), 'utf8');
  await writeFile(join(dir, 'studio.html'), tpl.replace('{{TITLE}}', input.name.replace(/[<&]/g, '')));
  await writeFile(join(dir, 'lib', 'shared.js'), '// shared.js: palette, characters and helpers shared by every chapter (written by the lead agent).\n');
  await writeFile(join(dir, '.gitignore'), 'out/\n.studio/\n');
  await git.init(dir);
  await git.commit(dir, 'プロジェクト作成');
  return project;
}

export interface ProjectSummary { slug: string; name: string; step: string; updatedAt: string; shots: number; hasVideo: boolean }
export async function listProjects(): Promise<ProjectSummary[]> {
  const out: ProjectSummary[] = [];
  for (const slug of readdirSync(PROJECTS_DIR)) {
    const dir = join(PROJECTS_DIR, slug);
    if (!existsSync(join(dir, 'project.json'))) continue;
    try {
      const p = await loadProject(slug), sb = await loadStoryboard(slug);
      out.push({ slug, name: p.name, step: p.step, updatedAt: statSync(join(dir, 'project.json')).mtime.toISOString(),
        shots: sb.chapters.reduce((n, c) => n + c.shots.length, 0), hasVideo: existsSync(join(dir, 'out', 'final.mp4')) });
    } catch { /* skip broken folders */ }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadAll(slug: string) {
  const dir = projectDir(slug);
  const [project, brief, storyboard, style] = await Promise.all([loadProject(slug), loadBrief(slug), loadStoryboard(slug), loadStyle(slug)]);
  const list = (sub: string, re: RegExp) => { try { return readdirSync(join(dir, sub)).filter(f => re.test(f)).sort(); } catch { return []; } };
  const stat = (f: string) => { try { return statSync(join(dir, f)).mtimeMs; } catch { return 0; } };
  return {
    project, brief, storyboard, style,
    files: {
      drafts: Object.fromEntries(list('drafts', /\.svg$/).map(f => [f, stat(join('drafts', f))])),
      chapters: list('chapters', /\.js$/),
      finalVideo: stat('out/final.mp4') || 0,
      frames: list('out/frames', /\.jpg$/).length,
      mix: stat('out/audio/mix.wav') || 0,
    },
  };
}

// captions.json: what the runtime draws in the caption band. Lyrics win; otherwise narration lines.
export async function regenerateCaptions(slug: string) {
  const [p, sb] = await Promise.all([loadProject(slug), loadStoryboard(slug)]);
  let lines: TimedLine[] = [];
  if (p.audio.music?.lyrics?.length) lines = p.audio.music.lyrics;
  else if (p.audio.narration.enabled) {
    const gap = p.audio.narration.gap / 2;
    lines = sb.chapters.flatMap(c => c.shots).filter(s => s.narration.trim()).map(s => {
      const start = s.start + (s.narrationAudio ? gap : 0);
      return { start, end: Math.min(s.end, start + (s.narrationAudio?.duration ?? (s.end - s.start))), text: s.narration.trim() };
    });
  }
  await writeJSON(join(projectDir(slug), 'captions.json'), lines);
  return lines;
}

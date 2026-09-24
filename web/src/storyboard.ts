// storyboard.ts: pure edits on the storyboard (the server re-validates on save).
import type { Shot, Storyboard } from './api.ts';

const r2 = (n: number) => Math.round(n * 100) / 100;
export const clone = (sb: Storyboard): Storyboard => structuredClone(sb);
export const shotsOf = (sb: Storyboard) => sb.chapters.flatMap(c => c.shots.map(s => ({ shot: s, chapter: c })));
export const findShot = (sb: Storyboard, id: string | null) => (id ? shotsOf(sb).find(x => x.shot.id === id) || null : null);
export const shotAt = (sb: Storyboard, t: number) => shotsOf(sb).find(x => t >= x.shot.start && t < x.shot.end) || shotsOf(sb).at(-1) || null;
export const totalEnd = (sb: Storyboard) => sb.chapters.at(-1)?.end ?? 0;

// Move the cut after `shotId` (its end = next shot's start) to time t. Crossing a chapter boundary moves it too.
export function moveCut(sb0: Storyboard, shotId: string, t: number, minLen = .3): Storyboard | null {
  const sb = clone(sb0), flat = shotsOf(sb), i = flat.findIndex(x => x.shot.id === shotId);
  const cur = flat[i], next = flat[i + 1]; if (!cur || !next) return null;
  t = r2(Math.max(cur.shot.start + minLen, Math.min(next.shot.end - minLen, t)));
  cur.shot.end = t; next.shot.start = t;
  if (cur.chapter !== next.chapter) { cur.chapter.end = t; next.chapter.start = t; }
  return sb;
}

// Change a shot's length; later shots shift (only for projects whose length is free).
export function setDuration(sb0: Storyboard, shotId: string, len: number): Storyboard {
  const sb = clone(sb0); let delta = 0, found = false;
  for (const c of sb.chapters) {
    c.start = r2(c.start + delta);
    for (const s of c.shots) {
      s.start = r2(s.start + delta);
      if (s.id === shotId) { found = true; const old = s.end + delta - s.start; delta += Math.max(.3, len) - old; }
      s.end = r2(s.end + delta);
    }
    c.end = r2(c.end + delta);
  }
  return found ? sb : sb0;
}

export function nextShotId(sb: Storyboard) {
  let n = shotsOf(sb).length + 1; const ids = new Set(shotsOf(sb).map(x => x.shot.id));
  while (ids.has(`s${String(n).padStart(2, '0')}`)) n++;
  return `s${String(n).padStart(2, '0')}`;
}

// Split a shot in two at its midpoint (or at t).
export function splitShot(sb0: Storyboard, shotId: string, at?: number): Storyboard {
  const sb = clone(sb0), hit = findShot(sb, shotId); if (!hit) return sb0;
  const { shot, chapter } = hit, mid = r2(at ?? (shot.start + shot.end) / 2);
  if (mid - shot.start < .3 || shot.end - mid < .3) return sb0;
  const second: Shot = { ...structuredClone(shot), id: nextShotId(sb), title: `${shot.title}（後半）`, start: mid, comments: [], status: 'planned', statusNote: '', narration: '', narrationAudio: undefined };
  shot.end = mid;
  chapter.shots.splice(chapter.shots.indexOf(shot) + 1, 0, second);
  return sb;
}

// Remove a shot; its time goes to the previous shot in the chapter (or the next one if it was first).
export function removeShot(sb0: Storyboard, shotId: string): Storyboard {
  const sb = clone(sb0), hit = findShot(sb, shotId); if (!hit) return sb0;
  const { shot, chapter } = hit, i = chapter.shots.indexOf(shot);
  if (chapter.shots.length === 1) return sb0;
  if (i > 0) chapter.shots[i - 1].end = shot.end; else chapter.shots[1].start = shot.start;
  chapter.shots.splice(i, 1);
  return sb;
}

export function patchShot(sb0: Storyboard, shotId: string, patch: Partial<Shot>): Storyboard {
  const sb = clone(sb0), hit = findShot(sb, shotId); if (!hit) return sb0;
  Object.assign(hit.shot, patch);
  return sb;
}

export const STATUS_LABEL: Record<Shot['status'], string> = {
  planned: '未着手', drafted: 'ラフあり', approved: '承認済み', building: '制作中', built: '完成', blocked: '要対応', retake: 'リテイク',
};
export const openCommentCount = (s: Shot) => s.comments.filter(c => !c.resolved && c.author === 'user').length;

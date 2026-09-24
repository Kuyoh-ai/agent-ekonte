// git.ts: per-project history. Every agent run and every manual save becomes a commit the user can go back to.
import { execFile } from 'node:child_process';

const run = (cwd: string, args: string[]) => new Promise<string>((ok, bad) =>
  execFile('git', args, { cwd, maxBuffer: 16 << 20 }, (err, stdout, stderr) => err ? bad(new Error(stderr || err.message)) : ok(stdout)));

let available: boolean | null = null;
export async function isAvailable() {
  if (available === null) available = await run(process.cwd(), ['--version']).then(() => true, () => false);
  return available;
}

export async function init(dir: string) {
  if (!(await isAvailable())) return;
  await run(dir, ['init', '-q']);
  await run(dir, ['config', 'user.name', 'Agent Video Studio']);
  await run(dir, ['config', 'user.email', 'studio@localhost']);
  await run(dir, ['config', 'core.autocrlf', 'false']);
}

// Commit everything if anything changed. Returns the new commit id or null.
export async function commit(dir: string, message: string): Promise<string | null> {
  if (!(await isAvailable())) return null;
  try {
    await run(dir, ['add', '-A']);
    const status = await run(dir, ['status', '--porcelain']);
    if (!status.trim()) return null;
    await run(dir, ['commit', '-q', '-m', message]);
    return (await run(dir, ['rev-parse', '--short', 'HEAD'])).trim();
  } catch { return null; }
}

export interface Revision { id: string; message: string; at: string; files: number }
export async function log(dir: string, limit = 60): Promise<Revision[]> {
  if (!(await isAvailable())) return [];
  try {
    const out = await run(dir, ['log', `-${limit}`, '--pretty=format:%h\x1f%s\x1f%cI', '--shortstat']);
    const revs: Revision[] = [];
    for (const line of out.split('\n')) {
      if (line.includes('\x1f')) { const [id, message, at] = line.split('\x1f'); revs.push({ id, message, at, files: 0 }); }
      else { const m = /(\d+) files? changed/.exec(line); if (m && revs.length) revs[revs.length - 1].files = +m[1]; }
    }
    return revs;
  } catch { return []; }
}

// Restore the working tree to a past revision (as a new commit, so the jump itself can be undone).
export async function restore(dir: string, id: string) {
  if (!/^[0-9a-f]{4,40}$/.test(id)) throw new Error('invalid revision');
  await commit(dir, '復元前の自動保存');
  await run(dir, ['restore', `--source=${id}`, '--staged', '--worktree', '--', '.']);
  const subject = (await run(dir, ['log', '-1', '--pretty=%s', id])).trim();
  return commit(dir, `復元: ${subject} (${id})`);
}

export async function diffStat(dir: string, id: string) {
  if (!(await isAvailable())) return '';
  try { return await run(dir, ['show', '--stat', '--pretty=format:', id]); } catch { return ''; }
}

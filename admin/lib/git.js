// Git through execFile with argument arrays (no shell). Paths are repo-relative and checked by callers.
import { execFile } from 'node:child_process';

export const REV_RE = /^[0-9a-f]{7,40}$/;

export function createGit(siteDir) {
  function git(args, { input, author } = {}) {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
      if (author) {
        env.GIT_AUTHOR_NAME = author; env.GIT_AUTHOR_EMAIL = `${author}@alno-admin.local`;
        env.GIT_COMMITTER_NAME = author; env.GIT_COMMITTER_EMAIL = `${author}@alno-admin.local`;
      }
      const child = execFile('git', ['-c', 'core.quotepath=off', ...args], { cwd: siteDir, env, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (err, stdout, stderr) => {
        if (err) { err.stderr = stderr.toString(); err.message = `git ${args[0]}: ${err.stderr.trim() || err.message}`; return reject(err); }
        resolve(stdout);
      });
      if (input !== undefined) child.stdin.end(input);
    });
  }
  const text = async (args, o) => (await git(args, o)).toString('utf8');

  return {
    raw: git,
    async isRepo() {
      try { return (await text(['rev-parse', '--is-inside-work-tree'])).trim() === 'true'; } catch { return false; }
    },
    // Commits exactly `paths` (additions, changes and deletions), nothing else that may be staged.
    async commit(paths, message, author) {
      await git(['add', '-A', '--', ...paths]);
      const staged = (await text(['diff', '--cached', '--name-only', '--', ...paths])).trim();
      if (!staged) return null;
      await git(['commit', '-q', '--no-verify', '-m', message, '--', ...paths], { author });
      return (await text(['rev-parse', 'HEAD'])).trim();
    },
    async head() {
      try { return (await text(['rev-parse', 'HEAD'])).trim(); } catch { return null; }
    },
    async log(relPath, limit = 50) {
      const args = ['log', `-n${limit}`, '--format=%H%x1f%an%x1f%aI%x1f%s%x1e'];
      if (relPath) args.push('--follow', '--', relPath);
      const out = await text(args);
      return out.split('\x1e').map((r) => r.trim()).filter(Boolean).map((r) => {
        const [hash, author, date, subject] = r.split('\x1f');
        return { hash, author, date, subject };
      });
    },
    // Recently changed files below the given directories.
    async recentFiles(dirs, limit = 200) {
      const out = await text(['log', `-n${limit}`, '--name-only', '--format=%x1e%H%x1f%an%x1f%aI%x1f%s', '--', ...dirs]);
      const seen = new Map();
      for (const block of out.split('\x1e').filter((b) => b.trim())) {
        const [head, ...files] = block.split('\n');
        const [hash, author, date, subject] = head.split('\x1f');
        for (const f of files.map((x) => x.trim()).filter(Boolean)) {
          if (!seen.has(f)) seen.set(f, { file: f, hash, author, date, subject, count: 0 });
          seen.get(f).count++;
        }
      }
      return [...seen.values()];
    },
    async show(rev, relPath) {
      if (!REV_RE.test(rev)) throw new Error('Ungültige Revision');
      return git(['show', `${rev}:${relPath}`]);
    },
    async push() {
      return text(['push', '--quiet']);
    },
  };
}

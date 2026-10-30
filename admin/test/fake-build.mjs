// Stand-in for `npm run build` in tests and the demo. Fails when a content file contains BUILD_FAIL
// or a file named .fail-build exists, and records start/end so tests can check builds never overlap.
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const delay = Number(process.env.FAKE_BUILD_MS || 50);
const logFile = process.env.FAKE_BUILD_LOG;
if (logFile) fs.appendFileSync(logFile, `start ${Date.now()}\n`);
await new Promise((r) => setTimeout(r, delay));

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(json|md)$/.test(e.name)) {
      const text = fs.readFileSync(p, 'utf8');
      if (e.name.endsWith('.json')) JSON.parse(text);
      if (text.includes('BUILD_FAIL')) { console.error(`[fake-build] error in ${path.relative(cwd, p)}`); process.exit(1); }
    }
  }
}
walk(path.join(cwd, 'src', 'content'));
if (fs.existsSync(path.join(cwd, '.fail-build'))) { console.error('[fake-build] forced failure'); process.exit(1); }
if (logFile) fs.appendFileSync(logFile, `end ${Date.now()}\n`);
console.log('[fake-build] ok');

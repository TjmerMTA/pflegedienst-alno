// Rules::missingBodyImages against the real renderer of the site: whatever the admin lets through must
// not stop the build. Astro fails on a local image it cannot find (localImagePaths) and on an address
// decodeURI refuses, so these two are what is compared. Needs `npm ci`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.join(here, '..', '..', 'node_modules', '@astrojs', 'markdown-satteri', 'dist', 'index.js');
const skip = fs.existsSync(renderer) ? false : 'node_modules is missing: run npm ci';

const OK = '../../assets/img/ok.jpg', NO = '../../assets/img/nope.jpg';

function rules(cases) {
  const code = `require $argv[1]; $e = fn ($p) => $p === 'ok.jpg';
    echo json_encode(array_map(function ($md) use ($e) { $s = rtrim(Rules::sanitizeMarkdown($md), " \\t\\n");
      return ['san' => $s, 'refused' => Rules::hasUnsafeLink($s) || Rules::missingBodyImages($s, $e), 'imgs' => Rules::bodyImages($s)]; }, json_decode(stream_get_contents(STDIN), true)), JSON_INVALID_UTF8_SUBSTITUTE);`;
  const lib = path.join(here, '..', 'public', 'wp-admin', 'lib', 'Rules.php');
  return JSON.parse(execFileSync(process.env.PHP || 'php', ['-r', code, lib], { input: JSON.stringify(cases), maxBuffer: 1e9 }).toString());
}

async function check(cases) {
  const { createSatteriMarkdownProcessor } = await import(pathToFileURL(renderer).href);
  const proc = await createSatteriMarkdownProcessor({});
  console.warn = () => {}; // Shiki on every odd fence
  const decided = rules(cases);
  const out = [];
  for (let i = 0; i < cases.length; i++) {
    const r = decided[i];
    if (r.refused) continue;
    try {
      for (const p of (await proc.render(r.san, {})).metadata.localImagePaths) {
        if (p !== OK) out.push([cases[i], `the build would look for ${p}`]);
        else if (!r.imgs.includes(p)) out.push([cases[i], 'a staged image would not be carried']);
      }
    } catch (e) { out.push([cases[i], e.message]); }
  }
  return out;
}

test('hand-picked forms: nothing that passes stops the build', { skip }, async () => {
  const hard = [`![[a]](${NO})`, `![a\nb](${NO})`, `> ![a\n> b](${NO})`, `- ![a\n  b](${NO})`, `![a](\n${NO}\n)`, `> ![a](\n> ${NO}\n> )`, `![a](<${OK} b.jpg>)`,
    `![\`]\`](${NO})`, `![a\`](${OK})\`](${NO})`, `![a [b](/c) d](${NO})`, `![a ![b](${OK}) c](${NO})`, `![a [b](x](${OK})) e](${NO})`, `![![a](${OK})](${NO})`, `# \`abc\n![a\`]\`](${NO})`,
    `![a][r]\n\n[r]: ${NO}`, `![a][]\n\n[a]: ${NO}`, `![a]\n\n[a]: /%zz`, `![a](/%zz.jpg)`, `![a](/&percnt;zz.jpg)`, `![a](/\\%zz.jpg)`, `![a](/%ff.jpg)`, `![a](https:)`, `![a](https://[)`, `![a](https://1.2.3.256/x.jpg)`];
  assert.deepEqual(await check(hard), []);
});

test('random bodies: nothing that passes stops the build', { skip }, async () => {
  const frag = ['![', '![', '[', ']', '](', '(', ')', '`', '``', '\\', '\n', '\n\n', ' ', '> ', '- ', '# ', '"', "'", '<', '>', 'a', '!', '%', '|', '*', '[r]', '![a][r]', `[r]: ${NO}\n`,
    OK, NO, `![a](${OK})`, `![a](${NO})`, `](${OK})`, `](${NO})`, `](<${OK} b.jpg>)`, '](/%zz)', '&#93;', '&#91;', '    ', '```\n', '~~~\n', '\t', ' '];
  let x = 20261030;
  const rnd = (n) => { x = (x * 1103515245 + 12345) & 0x7fffffff; return (x >>> 8) % n; };
  const cases = Array.from({ length: 4000 }, () => { let s = ''; for (let k = 2 + rnd(12); k > 0; k--) s += frag[rnd(frag.length)]; return s; });
  assert.deepEqual((await check(cases)).slice(0, 5), []);
});

test('the forms a client writes pass and reach the renderer as images', { skip }, async () => {
  const { createSatteriMarkdownProcessor } = await import(pathToFileURL(renderer).href);
  const proc = await createSatteriMarkdownProcessor({});
  const good = [`![a](${OK})`, `![](${OK})`, `![Foto [2026]](${OK})`, `![a\nb](${OK})`, `![a](${OK} "Titel")`, `![a](<${OK}>)`, `[![a](${OK})](https://a.de)`, `> ![a](${OK})`, `![a](${OK})\n\n[Link](../x)`];
  for (const [i, r] of rules(good).entries()) {
    assert.ok(!r.refused, good[i]);
    assert.deepEqual((await proc.render(r.san, {})).metadata.localImagePaths, [OK], good[i]);
  }
  const plain = ['Toll!\n\n[x](../y)', 'Toll![1]', '`![` ist kein Bild', 'Fußnote[1]: siehe unten'];
  for (const [i, r] of rules(plain).entries()) assert.ok(!r.refused, plain[i]);
});

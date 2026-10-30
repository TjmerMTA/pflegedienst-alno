// The browser's Markdown <-> HTML. What the Visuell tab writes into the textarea is what gets stored,
// so a round trip must not change a text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { markdownToHtml, htmlToMarkdown, unsupportedMarkdown } from '../public/wp-admin/assets/js/markdown.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const body = (file) => file.replace(/^---\n[\s\S]*?\n---\n+/, '').replace(/\n+$/, '');

function realFiles() {
  const out = [];
  const fixtures = path.join(here, 'fixtures', 'site', 'src', 'content');
  for (const dir of ['blog', 'leistungen']) {
    for (const f of fs.readdirSync(path.join(fixtures, dir))) out.push([`${dir}/${f}`, fs.readFileSync(path.join(fixtures, dir, f), 'utf8')]);
  }
  // The real texts of this checkout, read at test time.
  try {
    const list = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', 'src/content/blog', 'src/content/leistungen'], { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n');
    for (const f of list) if (f.endsWith('.md')) out.push([f, execFileSync('git', ['show', `HEAD:${f}`], { cwd: here }).toString()]);
  } catch { /* no git here */ }
  return out;
}

test('Markdown → HTML covers what the site uses', () => {
  const html = markdownToHtml('## Titel\n\nText **fett** und *kursiv* mit [Link](/kontakt/).\n\n- a\n- b\n\n1. x\n2. y\n\n> **Tipp:** Zitat');
  assert.match(html, /<h2>Titel<\/h2>/);
  assert.match(html, /<strong>fett<\/strong>/);
  assert.match(html, /<em>kursiv<\/em>/);
  assert.match(html, /<a href="\/kontakt\/">Link<\/a>/);
  assert.match(html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(html, /<ol><li>x<\/li><li>y<\/li><\/ol>/);
  assert.match(html, /<blockquote><p><strong>Tipp:<\/strong> Zitat<\/p><\/blockquote>/);
});

test('Markdown → HTML does not pass unsafe links or tags', () => {
  assert.doesNotMatch(markdownToHtml('[x](javascript:alert(1))'), /href/);
  assert.doesNotMatch(markdownToHtml('<script>alert(1)</script>'), /<script/);
});

test('HTML → Markdown', () => {
  assert.equal(htmlToMarkdown('<h2>T</h2><p>a <strong>b</strong> <em>c</em> <a href="/x/">d</a></p><ul><li>e</li><li>f</li></ul>'), '## T\n\na **b** *c* [d](/x/)\n\n- e\n- f\n');
  assert.equal(htmlToMarkdown('<ol><li>a</li><li>b</li></ol>'), '1. a\n2. b\n');
  assert.equal(htmlToMarkdown('<blockquote><p>z</p></blockquote>'), '> z\n');
  assert.equal(htmlToMarkdown('<script>x</script><p onclick="y">t</p>'), 't\n');
});

test('text that looks like Markdown is escaped, not turned into formatting', () => {
  const md = htmlToMarkdown('<p>2 * 3 * 4 und a_b</p>');
  assert.equal(markdownToHtml(md), '<p>2 * 3 * 4 und a_b</p>');
  const md2 = htmlToMarkdown('<p>1. Mai ist frei</p>');
  assert.equal(markdownToHtml(md2), '<p>1. Mai ist frei</p>');
});

test('unsupported constructs switch the Visuell tab off', () => {
  assert.deepEqual(unsupportedMarkdown('## ok\n\n- a\n'), []);
  assert.ok(unsupportedMarkdown('| a | b |\n|---|---|\n').includes('Tabelle'));
  assert.ok(unsupportedMarkdown('![x](y.jpg)').includes('Bild im Text'));
  for (const md of ['![[a]](y.jpg)', '![a\nb](y.jpg)', '![`]`](y.jpg)']) assert.ok(unsupportedMarkdown(md).includes('Bild im Text'), md);
  assert.ok(unsupportedMarkdown('a <div>b</div>').includes('HTML'));
});


test('round trip is lossless for the fixtures and the real blog and Leistungen files', () => {
  const files = realFiles();
  assert.ok(files.length >= 4);
  for (const [name, text] of files) {
    const md = body(text);
    if (unsupportedMarkdown(md).length) continue;
    assert.equal(htmlToMarkdown(markdownToHtml(md)).trim(), md.trim(), name);
  }
});

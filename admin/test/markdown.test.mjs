import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { markdownToHtml, htmlToMarkdown, sanitizeMarkdown, unsupportedMarkdown } from '../lib/markdown.js';
import { splitFrontmatter, parseFrontmatter, buildMarkdownFile, FrontmatterError } from '../lib/frontmatter.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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

test('round trip is lossless for the real blog and Leistungen files', () => {
  for (const coll of ['blog', 'leistungen']) {
    const dir = path.join(repo, 'src', 'content', coll);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const { body } = splitFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
      assert.equal(htmlToMarkdown(markdownToHtml(body)).trim(), body.trim(), f);
    }
  }
});

test('sanitizeMarkdown removes raw HTML and unsafe links', () => {
  assert.equal(sanitizeMarkdown('a <script>alert(1)</script> b'), 'a alert(1) b');
  assert.doesNotMatch(sanitizeMarkdown('[x](javascript:alert(1))'), /javascript/);
  assert.doesNotMatch(markdownToHtml(sanitizeMarkdown('[x](javascript:alert(1))')), /href="(?!#)/);
});

test('sanitizeMarkdown keeps normal Markdown and comparisons', () => {
  const md = '## T\n\na < 5 und **b** [c](/d/) `<b>`\n';
  assert.equal(sanitizeMarkdown(md), md);
});

test('sanitizeMarkdown: removing a tag cannot leave a new one behind', () => {
  for (const s of ['<<b>script>alert(1)<</b>/script>', '<scr<x>ipt>alert(1)', '<<<<b>b>b>img src=x onerror=1>', '<!doctype html>', '<a href=x', '<![CDATA[x]]>']) {
    const out = sanitizeMarkdown(s);
    assert.doesNotMatch(out, /<[a-zA-Z/!?]/, `${s} → ${out}`);
    assert.doesNotMatch(markdownToHtml(out), /<(script|img|a)\b/, `${s} → ${out}`);
  }
});

test('sanitizeMarkdown keeps inline code as it is', () => {
  assert.equal(sanitizeMarkdown('nutze `<div>` hier'), 'nutze `<div>` hier');
});

test('Markdown checks cost linear time on hostile input', () => {
  const n = 1024 * 1024;
  const inputs = { lt: '<a '.repeat(n / 3), newlines: '\n'.repeat(n), nest: '<'.repeat(n / 2) + 'b>'.repeat(n / 4), img: '!['.repeat(n / 2), refs: '[a'.repeat(n / 2), spaces: `a${' '.repeat(n)}b`, ticks: '` '.repeat(n / 2), dashes: '-\n'.repeat(n / 2) };
  for (const [name, s] of Object.entries(inputs)) {
    let t = performance.now(); sanitizeMarkdown(s);
    assert.ok(performance.now() - t < 1500, `sanitizeMarkdown ${name}`);
    t = performance.now(); unsupportedMarkdown(s);
    assert.ok(performance.now() - t < 1500, `unsupportedMarkdown ${name}`);
    t = performance.now(); buildMarkdownFile([['a', 'b']], s);
    assert.ok(performance.now() - t < 1500, `buildMarkdownFile ${name}`);
  }
  const t = performance.now();
  parseFrontmatter(`a: x${' '.repeat(n)}y`);
  assert.ok(performance.now() - t < 1500, 'parseFrontmatter');
});

test('unsupported constructs switch the Visuell tab off', () => {
  assert.deepEqual(unsupportedMarkdown('## ok\n\n- a\n'), []);
  assert.ok(unsupportedMarkdown('| a | b |\n|---|---|\n').includes('Tabelle'));
  assert.ok(unsupportedMarkdown('![x](y.jpg)').includes('Bild im Text'));
  assert.ok(unsupportedMarkdown('a <div>b</div>').includes('HTML'));
});

test('frontmatter of every real file survives parse and rewrite unchanged', () => {
  for (const coll of ['blog', 'leistungen', 'team']) {
    const dir = path.join(repo, 'src', 'content', coll);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const { fm, body } = splitFrontmatter(text);
      assert.equal(buildMarkdownFile(parseFrontmatter(fm), body, ['tags']), text, f);
    }
  }
});

test('frontmatter quotes what YAML would misread', () => {
  const out = buildMarkdownFile([['title', 'Pflege: alles klar'], ['a', 'true'], ['b', '123'], ['c', '2026-01-01'], ['d', '- x'], ['e', 'mit # Raute'], ['f', 'Zitat "x"']], '');
  const back = new Map(parseFrontmatter(splitFrontmatter(out).fm));
  assert.equal(back.get('title'), 'Pflege: alles klar');
  assert.equal(back.get('a'), 'true');
  assert.equal(back.get('b'), '123');
  assert.equal(back.get('c'), '2026-01-01');
  assert.equal(back.get('d'), '- x');
  assert.equal(back.get('e'), 'mit # Raute');
  assert.equal(back.get('f'), 'Zitat "x"');
});

test('strings that YAML would read as another type are quoted', () => {
  for (const v of ['1e3', '0x10', '0o7', '.5', '+5', '1_000', '.inf', '.NaN', 'Null', 'TRUE', 'yes', 'n', '~']) {
    assert.match(buildMarkdownFile([['a', v]], ''), new RegExp(`^a: ".*"$`, 'm'), v);
    assert.equal(new Map(parseFrontmatter(splitFrontmatter(buildMarkdownFile([['a', v]], '')).fm)).get('a'), v);
  }
  assert.match(buildMarkdownFile([['a', 'Grundpflege']], ''), /^a: Grundpflege$/m);
  assert.match(buildMarkdownFile([['a', 'Pflege 24 Stunden']], ''), /^a: Pflege 24 Stunden$/m);
});

test('a newline cannot inject a frontmatter key', () => {
  const out = buildMarkdownFile([['title', 'x\ndraft: true']], '');
  const back = new Map(parseFrontmatter(splitFrontmatter(out).fm));
  assert.equal(back.get('title'), 'x\ndraft: true');
  assert.equal(back.has('draft'), false);
});

test('unsupported YAML is refused rather than rewritten', () => {
  assert.throws(() => parseFrontmatter('a: |\n  block'), FrontmatterError);
  assert.throws(() => parseFrontmatter('a:\n  b: c'), FrontmatterError);
  assert.throws(() => parseFrontmatter('a: "offen'), FrontmatterError);
  assert.throws(() => parseFrontmatter('a: 1\na: 2'), FrontmatterError);
});

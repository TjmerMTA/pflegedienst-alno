import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markdownToHtml } from 'satteri';
import { buildPolicy, inlineHashes, policyFor, safeMarkdown } from '../src/lib/hardening.mjs';
import { safeScheme } from '../src/lib/safe-url.mjs';

const md = async (source) => (await markdownToHtml(source, { hastPlugins: [safeMarkdown] })).html;

test('Markdown: сырой HTML выходит текстом', async () => {
  assert.equal(await md('a <img src=x onerror=alert(1)> b'), '<p>a &lt;img src=x onerror=alert(1)&gt; b</p>\n');
  assert.doesNotMatch(await md('<script>alert(1)</script>'), /<script/);
});

test('Markdown: опасные ссылки теряют адрес, обычные остаются', async () => {
  for (const link of ['[a](javascript:x)', '[a](JaVaScRiPt:x)', '[a](jav&#x61;script:x)', '<javascript:x>', '[a][r]\n\n[r]: vbscript:x', '[a](data:text/html,x)']) {
    assert.doesNotMatch(await md(link), /href/, link);
  }
  assert.match(await md('[a](https://example.de/x)'), /href="https:\/\/example\.de\/x"/);
  assert.match(await md('[a](/kontakt/) [b](#teil) [c](mailto:a@b.de) [d](tel:+49231)'), /href="\/kontakt\/".*href="#teil".*href="mailto:a@b\.de".*href="tel:\+49231"/);
});

test('схема адреса: как её видит браузер', () => {
  for (const url of ['javascript:x', ' javascript:x', 'java\tscript:x', 'java\nscript:x', 'vbscript:x', 'data:text/html,x', 'file:///etc']) assert.equal(safeScheme(url), false, url);
  for (const url of ['https://a.de', 'HTTP://a.de', 'mailto:a@b.de', 'tel:+49', '/kontakt/', '#x', 'a/b', '']) assert.equal(safeScheme(url), true, url);
});

test('хеши: только то, что браузер исполняет', () => {
  const { scripts, styles } = inlineHashes(`<script>a</script><script type="module">b</script><script src="/x.js"></script>
    <script type="application/ld+json">{"a":1}</script><style>c</style><style media="print">d</style>`);
  assert.equal(scripts.length, 2);
  assert.equal(styles.length, 2);
  // Значение из спецификации CSP: sha256 от alert('Hello, world.');
  assert.deepEqual(inlineHashes(`<script>alert('Hello, world.');</script>`).scripts, ["'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='"]);
});

test('политика: строгие директивы и условные адреса', () => {
  const plain = buildPolicy({ scripts: ["'sha256-A'"], styles: ["'sha256-B'"] });
  assert.match(plain, /script-src 'self' 'sha256-A';/);
  assert.match(plain, /style-src 'self' 'sha256-B';/);
  assert.doesNotMatch(plain, /unsafe-eval|google|\*/);
  assert.doesNotMatch(/script-src [^;]*/.exec(plain)[0], /unsafe/);
  assert.doesNotMatch(/style-src [^;]*/.exec(plain)[0], /unsafe/);
  for (const d of ["default-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"]) assert.ok(plain.includes(d), d);
  assert.match(buildPolicy({ ga: true }), /script-src 'self' https:\/\/www\.googletagmanager\.com/);
});

test('политика по страницам: повторы один раз, внешний адрес форм разрешён', () => {
  const page = `<script>a</script><form data-endpoint="https://forms.example.de/x"></form>`;
  const policy = policyFor([page, page, '<div id="consent"></div>']);
  assert.equal(policy.match(/sha256/g).length, 1);
  assert.match(policy, /connect-src 'self' https:\/\/forms\.example\.de /);
  assert.match(policy, /googletagmanager/);
  assert.doesNotMatch(policyFor(['<form data-endpoint="/api/anfrage.php"></form>']), /connect-src 'self' \/api/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeHtml, safeHref, looksLikeHtml, PAGE_TAGS } from '../lib/sanitize.js';

test('keeps exactly the allowed tags', () => {
  const s = '<p>a <strong>b</strong> <b>c</b> <em>d</em> <i>e</i><br></p><ul><li>x</li></ul><ol><li>y</li></ol><h2>h</h2><h3>i</h3><a href="/kontakt/">k</a>';
  assert.equal(sanitizeHtml(s), s);
});

test('strips other tags but keeps their text', () => {
  assert.equal(sanitizeHtml('<p><span style="color:red">Hallo</span> <u>Welt</u></p>'), '<p>Hallo Welt</p>');
  assert.equal(sanitizeHtml('<h1>Groß</h1><div>x</div>'), 'Großx');
});

test('removes script-like elements with their content', () => {
  assert.equal(sanitizeHtml('<p>a</p><script>alert(1)</script><p>b</p>'), '<p>a</p><p>b</p>');
  assert.equal(sanitizeHtml('<style>p{}</style><iframe src=x>y</iframe>z'), 'z');
  assert.equal(sanitizeHtml('<svg><script>alert(1)</script></svg>ok'), 'ok');
  assert.equal(sanitizeHtml('<SCRIPT>x</SCRIPT >ok'), 'ok');
});

test('drops every attribute except a safe href', () => {
  assert.equal(sanitizeHtml('<p onclick="x()" class="y">t</p>'), '<p>t</p>');
  assert.equal(sanitizeHtml('<a href="/x" onclick="y()" target="_blank">t</a>'), '<a href="/x">t</a>');
  assert.equal(sanitizeHtml('<img src=x onerror=alert(1)>t'), 't');
});

test('unsafe links lose the link, keep the text', () => {
  for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html;base64,xx', 'vbscript:x', '&#106;avascript:alert(1)', '//evil.example/x']) {
    assert.equal(sanitizeHtml(`<a href="${href}">t</a>`), 't', href);
  }
  assert.equal(safeHref('https://a.example/'), 'https://a.example/');
  assert.equal(safeHref('mailto:a@b.de'), 'mailto:a@b.de');
  assert.equal(safeHref('tel:+49231'), 'tel:+49231');
  assert.equal(safeHref('#anker'), '#anker');
});

test('malformed markup cannot smuggle a tag through', () => {
  const samples = ['<scr<script>ipt>alert(1)</scr</script>ipt>', '<<script>alert(1)//<</script>', '<img src="x" onerror="1"', '<a href="x" onclick="y"', '<!--<script>x</script>-->', '<p/onclick=x>t</p>'];
  for (const s of samples) {
    const out = sanitizeHtml(s);
    assert.ok(!/<(script|img)\b/i.test(out), `${s} → ${out}`);
    assert.doesNotMatch(out, /<[a-z][^>]*\son\w+\s*=/i, `${s} → ${out}`);
  }
});

test('text is escaped, entities stay readable', () => {
  assert.equal(sanitizeHtml('<p>a &amp; b &lt;c&gt;</p>'), '<p>a &amp; b &lt;c&gt;</p>');
  assert.equal(sanitizeHtml('a < b'), 'a &lt; b');
  assert.equal(sanitizeHtml('<p>{{phone}}</p>'), '<p>{{phone}}</p>');
});

test('unclosed tags are closed, stray closers dropped', () => {
  assert.equal(sanitizeHtml('<p><strong>x</p>'), '<p><strong>x</strong></p>');
  assert.equal(sanitizeHtml('x</p></li>'), 'x');
});

test('sanitising twice changes nothing', () => {
  for (const s of ['<p>a &amp; b</p>', '<a href="/x?a=1&amp;b=2">t</a>', 'a < b > c', '<ul><li>x<ul><li>y</li></ul></li></ul>']) {
    const once = sanitizeHtml(s);
    assert.equal(sanitizeHtml(once), once);
  }
});

test('looksLikeHtml spots tags, not comparisons', () => {
  assert.equal(looksLikeHtml('<b>x</b>'), true);
  assert.equal(looksLikeHtml('<script>'), true);
  assert.equal(looksLikeHtml('a < 5 und b > 3'), false);
  assert.equal(PAGE_TAGS.includes('h2'), true);
});

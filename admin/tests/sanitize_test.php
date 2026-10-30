<?php
// Port of sanitize.test.mjs: the allow-list sanitiser against Rules directly.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/../public/wp-admin/lib/Rules.php';

function within(float $ms, callable $fn, string $what): void
{
    $t = microtime(true);
    $fn();
    $took = (microtime(true) - $t) * 1000;
    ok($took < $ms, sprintf('%s took %.0f ms', $what, $took));
}

test('keeps exactly the allowed tags', function () {
    $s = '<p>a <strong>b</strong> <b>c</b> <em>d</em> <i>e</i><br></p><ul><li>x</li></ul><ol><li>y</li></ol><h2>h</h2><h3>i</h3><a href="/kontakt/">k</a>';
    eq(Rules::sanitizeHtml($s), $s);
});

test('strips other tags but keeps their text', function () {
    eq(Rules::sanitizeHtml('<p><span style="color:red">Hallo</span> <u>Welt</u></p>'), '<p>Hallo Welt</p>');
    eq(Rules::sanitizeHtml('<h1>Groß</h1><div>x</div>'), 'Großx');
});

test('removes script-like elements with their content', function () {
    eq(Rules::sanitizeHtml('<p>a</p><script>alert(1)</script><p>b</p>'), '<p>a</p><p>b</p>');
    eq(Rules::sanitizeHtml('<style>p{}</style><iframe src=x>y</iframe>z'), 'z');
    eq(Rules::sanitizeHtml('<svg><script>alert(1)</script></svg>ok'), 'ok');
    eq(Rules::sanitizeHtml('<SCRIPT>x</SCRIPT >ok'), 'ok');
});

test('drops every attribute except a safe href', function () {
    eq(Rules::sanitizeHtml('<p onclick="x()" class="y">t</p>'), '<p>t</p>');
    eq(Rules::sanitizeHtml('<a href="/x" onclick="y()" target="_blank">t</a>'), '<a href="/x">t</a>');
    eq(Rules::sanitizeHtml('<img src=x onerror=alert(1)>t'), 't');
});

test('unsafe links lose the link, keep the text', function () {
    foreach (['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', "java\tscript:alert(1)", 'data:text/html;base64,xx', 'vbscript:x', '&#106;avascript:alert(1)', '//evil.example/x'] as $href) {
        eq(Rules::sanitizeHtml("<a href=\"$href\">t</a>"), 't', $href);
    }
    eq(Rules::safeHref('https://a.example/'), 'https://a.example/');
    eq(Rules::safeHref('mailto:a@b.de'), 'mailto:a@b.de');
    eq(Rules::safeHref('tel:+49231'), 'tel:+49231');
    eq(Rules::safeHref('#anker'), '#anker');
});

test('malformed markup cannot smuggle a tag through', function () {
    foreach (['<scr<script>ipt>alert(1)</scr</script>ipt>', '<<script>alert(1)//<</script>', '<img src="x" onerror="1"', '<a href="x" onclick="y"', '<!--<script>x</script>-->', '<p/onclick=x>t</p>'] as $s) {
        $out = Rules::sanitizeHtml($s);
        ok(!preg_match('/<(script|img)\b/i', $out), "$s -> $out");
        ok(!preg_match('/<[a-z][^>]*\son\w+\s*=/i', $out), "$s -> $out");
    }
});

test('text is escaped, entities stay readable', function () {
    eq(Rules::sanitizeHtml('<p>a &amp; b &lt;c&gt;</p>'), '<p>a &amp; b &lt;c&gt;</p>');
    eq(Rules::sanitizeHtml('a < b'), 'a &lt; b');
    eq(Rules::sanitizeHtml('<p>{{phone}}</p>'), '<p>{{phone}}</p>');
});

test('unclosed tags are closed, stray closers dropped', function () {
    eq(Rules::sanitizeHtml('<p><strong>x</p>'), '<p><strong>x</strong></p>');
    eq(Rules::sanitizeHtml('x</p></li>'), 'x');
});

test('sanitising twice changes nothing', function () {
    foreach (['<p>a &amp; b</p>', '<a href="/x?a=1&amp;b=2">t</a>', 'a < b > c', '<ul><li>x<ul><li>y</li></ul></li></ul>'] as $s) {
        $once = Rules::sanitizeHtml($s);
        eq(Rules::sanitizeHtml($once), $once, $s);
    }
});

test('looksLikeHtml also spots a tag that is only opened', function () {
    foreach (['Pflegedienst ALNO GmbH</script a', '<img src=x onerror=alert(1) a', '<!-- x', '<?php', '<{{name}}'] as $s) eq(Rules::looksLikeHtml($s), true, $s);
    foreach (['Preis < 5 €', 'a <5', '3 > 2', '<', '>'] as $s) eq(Rules::looksLikeHtml($s), false, $s);
});

test('hostile markup costs linear time', function () {
    $n = 1024 * 1024;
    foreach (['<script ', '<a ', '<a "', '<p>', '&a', '<!-- ', '<', '</'] as $s) {
        $input = str_repeat($s, (int) ($n / strlen($s)));
        $out = '';
        within(1500, function () use ($input, &$out) { $out = Rules::sanitizeHtml($input); }, $s);
        ok(!preg_match('/<(script|a)\b/', $out), $s);
    }
    within(1500, fn () => Rules::sanitizeHtml(str_repeat('<p>', 100000) . str_repeat('</li>', 100000)), 'deep nesting');
});

test('a tag that never ends turns the rest into text', function () {
    eq(Rules::sanitizeHtml('<p>a</p><a href="x <b>y</b>'), '<p>a</p>&lt;a href="x &lt;b&gt;y&lt;/b&gt;');
});

test('looksLikeHtml spots tags, not comparisons', function () {
    eq(Rules::looksLikeHtml('<b>x</b>'), true);
    eq(Rules::looksLikeHtml('<script>'), true);
    eq(Rules::looksLikeHtml('a < 5 und b > 3'), false);
    ok(in_array('h2', Rules::PAGE_TAGS, true));
});
finish();

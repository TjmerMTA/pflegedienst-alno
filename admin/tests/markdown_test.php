<?php
// Port of markdown.test.mjs. The Markdown renderer lives in the browser now (assets/js/markdown.js),
// so what is left on the server is sanitizeMarkdown, hasUnsafeLink and the frontmatter.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/../public/wp-admin/lib/Rules.php';
require_once __DIR__ . '/../public/wp-admin/lib/Frontmatter.php';

function parsed(string $file): array
{
    $map = [];
    foreach (Frontmatter::parse(Frontmatter::split($file)['fm']) as [$k, $v]) $map[$k] = $v;
    return $map;
}

function within(float $ms, callable $fn, string $what): void
{
    $t = microtime(true);
    $fn();
    $took = (microtime(true) - $t) * 1000;
    ok($took < $ms, sprintf('%s took %.0f ms', $what, $took));
}

/** Files of a branch, read at test time so that nothing of the real site lands in the repository. */
function realFiles(string $dir): array
{
    $root = dirname(__DIR__, 2);
    $list = shell_exec('git -C ' . escapeshellarg($root) . ' ls-tree -r --name-only HEAD ' . escapeshellarg($dir) . ' 2>/dev/null');
    $names = array_filter(explode("\n", trim((string) $list)), static fn ($f) => substr($f, -3) === '.md');
    if (!$names) throw new Skip('no real files at HEAD');
    $out = [];
    foreach ($names as $f) $out[$f] = (string) shell_exec('git -C ' . escapeshellarg($root) . ' show ' . escapeshellarg("HEAD:$f"));
    return $out;
}

test('sanitizeMarkdown escapes raw HTML, nothing is deleted', function () {
    eq(Rules::sanitizeMarkdown('a <script>alert(1)</script> b'), 'a &lt;script>alert(1)&lt;/script> b');
    eq(Rules::sanitizeMarkdown('a <iframe src=x></iframe> b'), 'a &lt;iframe src=x>&lt;/iframe> b');
});

test('hasUnsafeLink refuses, it does not rewrite', function () {
    $md = '[x](javascript:alert(1))';
    eq(Rules::hasUnsafeLink($md), true);
    eq(Rules::sanitizeMarkdown($md), $md, 'the text stays as typed, the save is refused');
});

test('sanitizeMarkdown keeps normal Markdown and comparisons', function () {
    $md = "## T\n\na < 5 und **b** [c](/d/)\n";
    eq(Rules::sanitizeMarkdown($md), $md);
});

test('sanitizeMarkdown leaves no tag-opening < behind, whatever the nesting', function () {
    foreach (['<<b>script>alert(1)<</b>/script>', '<scr<x>ipt>alert(1)', '<<<<b>b>b>img src=x onerror=1>', '<!doctype html>', '<a href=x', '<![CDATA[x]]>', '<?php echo 1;'] as $s) {
        $out = Rules::sanitizeMarkdown($s);
        ok(!preg_match('/<[a-zA-Z\/!?]/', $out), "$s -> $out");
    }
});

test('sanitizeMarkdown escapes inside inline code too: renderers disagree on where code begins', function () {
    eq(Rules::sanitizeMarkdown('nutze `<div>` hier'), 'nutze `&lt;div>` hier');
});

test('«data: 5» in a sentence is no link', function () {
    eq(Rules::hasUnsafeLink('Unsere data: 5 Punkte'), false);
    eq(Rules::hasUnsafeLink('![x](data:image/png;base64,AAAA)'), true);
    eq(Rules::hasUnsafeLink("[x]: java\nscript:alert(1)"), true);
    eq(Rules::hasUnsafeLink('[x](&#106;avascript:alert(1))'), true);
    eq(Rules::hasUnsafeLink('[x](/seite/?a=javascript)'), false);
});

test('Markdown checks cost linear time on hostile input', function () {
    $n = 1024 * 1024;
    $inputs = [
        'lt' => str_repeat('<a ', (int) ($n / 3)), 'newlines' => str_repeat("\n", $n), 'nest' => str_repeat('<', (int) ($n / 2)) . str_repeat('b>', (int) ($n / 4)),
        'img' => str_repeat('![', (int) ($n / 2)), 'refs' => str_repeat('[a', (int) ($n / 2)), 'spaces' => 'a' . str_repeat(' ', $n) . 'b',
        'ticks' => str_repeat('` ', (int) ($n / 2)), 'dashes' => str_repeat("-\n", (int) ($n / 2)), 'entities' => str_repeat('&#106;', (int) ($n / 6)),
    ];
    foreach ($inputs as $name => $s) {
        within(1500, fn () => Rules::sanitizeMarkdown($s), "sanitizeMarkdown $name");
        within(1500, fn () => Rules::hasUnsafeLink($s), "hasUnsafeLink $name");
        within(1500, fn () => Frontmatter::build([['a', 'b']], $s), "build $name");
    }
    within(1500, fn () => Frontmatter::parse('a: x' . str_repeat(' ', $n) . 'y'), 'parse');
});

test('frontmatter of the fixture files survives parse and rewrite unchanged', function () {
    $files = glob(__DIR__ . '/fixtures/site/src/content/*/*.md');
    ok(count($files) >= 6);
    foreach ($files as $f) {
        $text = (string) file_get_contents($f);
        $p = Frontmatter::split($text);
        eq(Frontmatter::build(Frontmatter::parse($p['fm']), $p['body'], ['tags']), $text, basename($f));
    }
});

foreach (['blog', 'leistungen', 'team'] as $coll) {
    test("frontmatter of every real $coll file survives parse and rewrite unchanged", function () use ($coll) {
        foreach (realFiles("src/content/$coll") as $name => $text) {
            $p = Frontmatter::split($text);
            eq(Frontmatter::build(Frontmatter::parse($p['fm']), $p['body'], ['tags']), $text, $name);
        }
    });
}

test('frontmatter quotes what YAML would misread', function () {
    $in = ['title' => 'Pflege: alles klar', 'a' => 'true', 'b' => '123', 'c' => '2026-01-01', 'd' => '- x', 'e' => 'mit # Raute', 'f' => 'Zitat "x"'];
    $entries = [];
    foreach ($in as $k => $v) $entries[] = [$k, $v];
    eq(parsed(Frontmatter::build($entries, '')), $in);
});

test('strings that YAML would read as another type are quoted', function () {
    foreach (['1e3', '0x10', '0o7', '.5', '+5', '1_000', '.inf', '.NaN', 'Null', 'TRUE', 'yes', 'n', '~'] as $v) {
        $out = Frontmatter::build([['a', $v]], '');
        ok(preg_match('/^a: ".*"$/m', $out) === 1, "$v: $out");
        eq(parsed($out)['a'], $v);
    }
    has(Frontmatter::build([['a', 'Grundpflege']], ''), "\na: Grundpflege\n");
    has(Frontmatter::build([['a', 'Pflege 24 Stunden']], ''), "\na: Pflege 24 Stunden\n");
});

test('a newline cannot inject a frontmatter key', function () {
    $back = parsed(Frontmatter::build([['title', "x\ndraft: true"]], ''));
    eq($back['title'], "x\ndraft: true");
    ok(!array_key_exists('draft', $back));
});

test('unsupported YAML is refused rather than rewritten', function () {
    foreach (["a: |\n  block", "a:\n  b: c", 'a: "offen', "a: 1\na: 2"] as $bad) {
        try { Frontmatter::parse($bad); } catch (FrontmatterError $e) { continue; }
        throw new RuntimeException("parsed: $bad");
    }
});
finish();

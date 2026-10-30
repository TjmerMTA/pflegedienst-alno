<?php
// The site's real content must pass the validator as it stands, and a save without changes must
// leave every file byte-identical: otherwise the client meets errors on texts nobody touched.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/../public/wp-admin/lib/bootstrap.php';

$root = realpath(__DIR__ . '/../..');
$pages = glob("$root/src/content/pages/*.json") ?: [];
if (!$pages) { echo "  skip: no src/content/pages on this branch\n"; finish(); }

$exists = static fn ($p) => Rules::isImagePath($p) && is_file("$root/src/assets/img/$p");
$tokens = Site::tokenKeys(json_decode((string) file_get_contents("$root/src/content/pages/_global.json"), true));
$collections = json_decode((string) file_get_contents(__DIR__ . '/../public/wp-admin/schema/collections.json'), true);
$byCollection = [];

test('there are real pages and tokens', function () use ($pages, $tokens) {
    ok(count($pages) >= 8, 'pages: ' . count($pages));
    ok(in_array('phone', $tokens, true), 'tokens: ' . show($tokens));
});

foreach ($pages as $file) {
    $name = basename($file);
    test("page $name", function () use ($file, $name, $exists, $tokens) {
        $text = (string) file_get_contents($file);
        $page = json_decode($text, true);
        ok(is_array($page), 'no JSON');
        eq(Rules::checkStructure($page), [], 'structure');
        eq(Rules::validatePageValues($page, ['imageExists' => $exists, 'tokens' => $tokens]), [], 'values');
        // What the edit screen sends back, for every field.
        $values = [];
        foreach ($page['groups'] as $g) foreach ($g['fields'] as $f) {
            if ($f['type'] === 'image') $values[$g['id']][$f['id']] = ['value' => $f['value'] ?? '', 'alt' => $f['alt'] ?? ''];
            elseif ($f['type'] === 'list') $values[$g['id']][$f['id']] = array_map(static function ($item) use ($f) {
                $out = [];
                foreach ($f['fields'] as $s) $out[$s['id']] = $s['type'] === 'image' ? Rules::itemImage($item, $s) : ($item[$s['id']] ?? '');
                return $out;
            }, $f['value'] ?? []);
            else $values[$g['id']][$f['id']] = $f['value'] ?? '';
        }
        $r = Rules::applyPageValues($page, $values, ['imageExists' => $exists, 'tokens' => $tokens]);
        eq($r['errors'], [], 'a save without changes');
        eq(Site::serializePage($r['page']), $text, "$name rewritten");
    });
}

foreach ($collections as $coll => $def) {
    $files = glob("$root/src/content/{$def['dir']}/*.md") ?: [];
    test("collection $coll has files", fn () => ok($files !== []));
    $flow = [];
    foreach ($def['fields'] as $f) if ($f['type'] === 'tags') $flow[] = $f['id'];
    foreach ($files as $file) {
        $name = "$coll/" . basename($file);
        test("entry $name", function () use ($file, $name, $def, $flow, $exists) {
            $text = (string) file_get_contents($file);
            $parts = Frontmatter::split($text);
            $entries = Frontmatter::parse($parts['fm']);
            $body = ltrim($parts['body'], "\n");
            $r = Rules::applyEntryValues($def, $entries, Site::formValues($def, $entries) + ['body' => $body], ['imageExists' => $exists, 'oldBody' => $body]);
            eq($r['errors'], [], 'values');
            eq(Frontmatter::build($r['entries'], $r['body'], $flow), $text, "$name rewritten");
        });
    }
}
finish();

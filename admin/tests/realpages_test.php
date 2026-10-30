<?php
// A page rewritten without changes must be byte-identical, or every save would drag formatting
// changes through the repository. Runs on the real pages of branch vobuda/anna, read at test time:
// nothing of the client's content is kept in this repository. Skips if the branch is not there.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

const BRANCH = 'vobuda/anna';

/**
 * A temporary site from the branch: pages and Markdown with their real bytes, read with `git show`.
 * Images are only names to the admin here, so empty files stand in for them. Null without the branch.
 */
function realSite(): ?string
{
    $git = 'git -C ' . escapeshellarg(dirname(__DIR__, 2));
    exec("$git rev-parse --verify --quiet " . BRANCH . '^{commit} 2>/dev/null', $out, $code);
    if ($code !== 0) return null;
    exec("$git ls-tree -r --name-only " . BRANCH . ' src/content src/assets/img', $paths, $code);
    if ($code !== 0 || !$paths) return null;
    $dir = tmpDir('alno-real');
    foreach ($paths as $p) {
        if (!is_dir(dirname("$dir/$p"))) mkdir(dirname("$dir/$p"), 0700, true);
        file_put_contents("$dir/$p", strncmp($p, 'src/content/', 12) === 0 ? (string) shell_exec("$git show " . escapeshellarg(BRANCH . ":$p")) : '');
    }
    return $dir;
}

$site = realSite();
if ($site === null) {
    test('real pages', function () { throw new Skip('branch ' . BRANCH . ' not available'); });
    finish();
}
register_shutdown_function('rmTree', $site);
$pages = array_map('basename', glob("$site/src/content/pages/*.json"));
$read = static fn (string $name) => (string) file_get_contents("$site/src/content/pages/$name");

test('there are real pages to check', function () use ($pages) {
    ok(count($pages) >= 5, show($pages));
    ok(in_array('_global.json', $pages, true));
});

foreach ($pages as $name) {
    test("$name: parse and serialize give the same bytes", function () use ($read, $name) {
        $text = $read($name);
        eq(Site::serializePage(json_decode($text, true)), $text);
    });
    test("$name: fits the contract", function () use ($read, $name) {
        eq(Rules::checkStructure(json_decode($text = $read($name), true)), []);
    });
    test("$name: applying its own values changes nothing", function () use ($read, $name) {
        $page = json_decode($read($name), true);
        $r = Rules::applyPageValues($page, pageValues($page));
        eq(array_map(static fn ($x) => "{$x['path']}: {$x['msg']}", $r['errors']), []);
        eq(Site::serializePage($r['page']), $read($name));
    });
}

$e = new Env(true, 1, $site);
$c = $e->as('admin');

foreach ($pages as $name) {
    $id = substr($name, 0, -5);
    test("$id: saving it unchanged through the API makes no commit", function () use ($c, $e, $id, $name, $read) {
        $head = $e->git->head();
        $r = savePage($c, $id, function () {});
        eq($r['status'], 200, $r['body']);
        eq($r['json'], ['ok' => true, 'unchanged' => true]);
        eq($e->git->head(), $head);
        eq($e->git->read("src/content/pages/$name"), $read($name));
    });
}

test('a real change touches only its one line', function () use ($c, $e, $read) {
    $before = explode("\n", $read('index.json'));
    $p = $c->get('page', ['id' => 'index'])['json']['page'];
    $seo = array_column($p['groups'], null, 'id')['seo'];
    $title = array_column($seo['fields'], null, 'id')['title']['value'];
    $r = savePage($c, 'index', function (array &$v) { $v['seo']['title'] = 'Geänderter Titel'; });
    eq($r['status'], 200, $r['body']);
    $after = explode("\n", (string) $e->git->read('src/content/pages/index.json'));
    eq(count($after), count($before));
    $diff = array_keys(array_diff_assoc($after, $before));
    eq(count($diff), 1, show($diff));
    has($before[$diff[0]], substr((string) json_encode($title, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 1, -1));
});

foreach (['blog' => 'post', 'leistungen' => 'leistung', 'team' => 'team'] as $coll => $type) {
    test("$coll: an entry saved unchanged through the API makes no commit", function () use ($c, $e, $coll, $type, $site) {
        $files = glob("$site/src/content/$coll/*.md");
        if (!$files) throw new Skip("no $coll files");
        $head = $e->git->head();
        foreach ($files as $f) {
            $slug = basename($f, '.md');
            $r = saveEntry($c, $type, $slug, function () {});
            eq($r['status'], 200, "$slug: {$r['body']}");
            eq($r['json']['unchanged'] ?? null, true, $slug);
        }
        eq($e->git->head(), $head);
    });
}
finish();

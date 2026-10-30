<?php
// scripts/deploy-sftp.sh against a stand-in for lftp that works on a local folder. This proves the
// script's logic (what goes up, in which order, what gets deleted); lftp's own syntax it cannot.
declare(strict_types=1);

require_once __DIR__ . '/lib.php';

const SCRIPT = __DIR__ . '/../../scripts/deploy-sftp.sh';

function fakeLftp(string $bin): void
{
    $php = PHP_BINARY;
    file_put_contents("$bin/lftp", <<<PHP
#!$php
<?php
\$home = getenv('FAKE_HOST');
\$log = getenv('FAKE_LOG');
\$failed = false;
function copyTree(string \$from, string \$to): void {
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator(\$from, FilesystemIterator::SKIP_DOTS)) as \$f) {
        \$rel = substr(\$f->getPathname(), strlen(\$from) + 1);
        if (!is_dir(dirname("\$to/\$rel"))) mkdir(dirname("\$to/\$rel"), 0755, true);
        copy(\$f->getPathname(), "\$to/\$rel");
        file_put_contents(getenv('FAKE_LOG'), "upload \$to/\$rel\\n", FILE_APPEND);
    }
}
foreach (preg_split('/[\\n;]+/', \$argv[2]) as \$line) {
    \$p = preg_split('/\\s+/', trim(\$line));
    switch (\$p[0]) {
        case 'get':
            // As the real lftp: a local file that exists is refused, a missing remote one named so.
            if (is_file(\$p[3])) { fwrite(STDERR, "get: \$p[3]: File exists\\n"); \$failed = true; break; }
            if (getenv('FAKE_GET_FAILS')) { fwrite(STDERR, "get: Fatal error: Connection refused\\n"); \$failed = true; break; }
            if (!is_file("\$home/\$p[1]")) { fwrite(STDERR, "get: Access failed: No such file (\$p[1])\\n"); \$failed = true; break; }
            copy("\$home/\$p[1]", \$p[3]);
            break;
        case 'put':
            copy(\$p[1], "\$home/\$p[3]");
            file_put_contents(\$log, "put \$p[3]\\n", FILE_APPEND);
            break;
        case 'mirror':
            \$n = count(\$p);
            copyTree(\$p[\$n - 2], "\$home/" . \$p[\$n - 1]);
            break;
        case 'rm':
            \$f = "\$home/\$p[2]";
            if (getenv('FAKE_RM_FAILS')) { \$failed = true; exit(1); }
            if (is_file(\$f)) { unlink(\$f); file_put_contents(\$log, "rm \$p[2]\\n", FILE_APPEND); }
            break;
        case 'rmdir':
            if (!@rmdir("\$home/\$p[1]")) \$failed = true;
            break;
    }
}
exit(\$failed ? 1 : 0);
PHP);
    chmod("$bin/lftp", 0755);
}

function setup(): array
{
    $d = sys_get_temp_dir() . '/alno-deploy-' . bin2hex(random_bytes(4));
    foreach (['bin', 'host/public_html', 'host/alno-data', 'src/_astro', 'src/wp-admin', 'src/kontakt'] as $x) mkdir("$d/$x", 0755, true);
    fakeLftp("$d/bin");
    file_put_contents("$d/host/alno-data/users.json", '{"keep":true}');
    file_put_contents("$d/host/public_html/google123.html", 'verification file of the client');
    file_put_contents("$d/src/index.html", 'start');
    file_put_contents("$d/src/kontakt/index.html", 'kontakt');
    file_put_contents("$d/src/_astro/a1.css", 'css');
    file_put_contents("$d/src/wp-admin/.htaccess", 'Require all denied');
    file_put_contents("$d/src/wp-admin/api.php", '<?php');
    return [$d, new class($d) {
        public function __construct(public string $d) {}
        public function run(array $env = [], ?string $src = null, string $root = 'public_html', string $manifest = '.alno-deploy-manifest', string $foreign = ''): int
        {
            @unlink("$this->d/log");
            $e = array_merge(getenv(), ['PATH' => "$this->d/bin:" . getenv('PATH'), 'FAKE_HOST' => "$this->d/host", 'FAKE_LOG' => "$this->d/log", 'SFTP_HOST' => 'h', 'SFTP_USER' => 'u', 'SFTP_PORT' => '22', 'SFTP_KEY_FILE' => '~/k', 'SFTP_KNOWN_HOSTS_FILE' => '~/n'], $env);
            // Its own process group: a loop in a subshell would outlive a plain kill and hold the tests up.
            $guard = '$p = fork; if (!$p) { setpgrp(0, 0); exec @ARGV } $SIG{ALRM} = sub { kill KILL => -$p; exit 124 }; alarm 30; waitpid($p, 0); exit($? >> 8)';
            $p = proc_open(['perl', '-e', $guard, 'bash', SCRIPT, $src ?? "$this->d/src", $root, $manifest, $foreign], [1 => ['file', "$this->d/out", 'w'], 2 => ['file', "$this->d/err", 'w']], $pipes, null, $e);
            return proc_close($p);
        }
        public function log(): array { return @file("$this->d/log", FILE_IGNORE_NEW_LINES) ?: []; }
    }];
}

test('first upload: everything goes up, dotfiles too, assets before pages, manifest last', function () {
    [$d, $h] = setup();
    eq($h->run(), 0, (string) @file_get_contents("$d/err"));
    $log = $h->log();
    ok(is_file("$d/host/public_html/wp-admin/.htaccess"), '.htaccess arrived');
    eq(file_get_contents("$d/host/public_html/kontakt/index.html"), 'kontakt');
    ok(array_search("upload $d/host/public_html/_astro/a1.css", $log) < array_search("upload $d/host/public_html/index.html", $log), 'assets first');
    eq(end($log), 'put .alno-deploy-manifest');
    exec('rm -rf ' . escapeshellarg($d));
});

test('second upload: only what changed, nothing when nothing changed', function () use (&$x) {
    [$d, $h] = setup();
    $h->run();
    eq($h->run(), 0);
    eq($h->log(), ['put .alno-deploy-manifest'], 'nothing to upload');
    file_put_contents("$d/src/kontakt/index.html", 'neu');
    eq($h->run(), 0);
    eq($h->log(), ["upload $d/host/public_html/kontakt/index.html", 'put .alno-deploy-manifest']);
    eq(file_get_contents("$d/host/public_html/kontakt/index.html"), 'neu');
    exec('rm -rf ' . escapeshellarg($d));
});

test('stale files of an earlier upload go, with their empty folders; anything else stays', function () {
    [$d, $h] = setup();
    $h->run();
    unlink("$d/src/kontakt/index.html");
    rmdir("$d/src/kontakt");
    eq($h->run(), 0, (string) @file_get_contents("$d/err"));
    ok(!is_file("$d/host/public_html/kontakt/index.html"), 'stale file deleted');
    ok(!is_dir("$d/host/public_html/kontakt"), 'empty folder deleted');
    ok(is_file("$d/host/public_html/google123.html"), 'a file it never uploaded stays');
    eq(file_get_contents("$d/host/alno-data/users.json"), '{"keep":true}', 'data folder untouched');
    exec('rm -rf ' . escapeshellarg($d));
});

test('FULL=true uploads everything again', function () {
    [$d, $h] = setup();
    $h->run();
    eq($h->run(['FULL' => 'true']), 0);
    ok(count($h->log()) >= 6, 'all files: ' . count($h->log()));
    exec('rm -rf ' . escapeshellarg($d));
});

test('a strange file name stops the run before anything is uploaded', function () {
    [$d, $h] = setup();
    file_put_contents("$d/src/böse; rm -rf name.html", 'x');
    ok($h->run() !== 0, 'must fail');
    ok(!is_file("$d/log"), 'nothing uploaded');
    has((string) file_get_contents("$d/err"), 'Unsafe file name');
    exec('rm -rf ' . escapeshellarg($d));
});

test('a manifest holding a path outside public_html cannot make it delete there', function () {
    [$d, $h] = setup();
    $h->run();
    file_put_contents("$d/host/.alno-deploy-manifest", str_repeat('0', 64) . "  ../alno-data/users.json\n", FILE_APPEND);
    eq($h->run(), 0, (string) @file_get_contents("$d/err"));
    ok(is_file("$d/host/alno-data/users.json"), 'not deleted');
    exec('rm -rf ' . escapeshellarg($d));
});

test('absolute and ../ paths in the manifest are ignored and the run ends; a real stale file still goes', function () {
    [$d, $h] = setup();
    eq($h->run(), 0, (string) @file_get_contents("$d/err"));
    $outside = "$d/host/fremd.txt";
    file_put_contents($outside, 'bleibt');
    $poison = [$outside, '/etc/passwd', '//etc/passwd', '/', '../fremd.txt', 'kontakt/../../fremd.txt', 'a/../b', '..'];
    $hash = str_repeat('0', 64);
    file_put_contents("$d/host/.alno-deploy-manifest", implode('', array_map(static fn ($p) => "$hash  $p\n", $poison)), FILE_APPEND);
    unlink("$d/src/kontakt/index.html");
    $t = microtime(true);
    eq($h->run(), 0, (string) @file_get_contents("$d/err"));
    ok(microtime(true) - $t < 10, 'took too long');
    ok(is_file($outside), 'deleted outside the docroot');
    ok(is_file("$d/host/alno-data/users.json"));
    ok(!is_file("$d/host/public_html/kontakt/index.html"), 'stale file stayed');
    $log = implode("\n", $h->log());
    hasNot($log, 'fremd');
    hasNot($log, 'passwd');
    has((string) file_get_contents("$d/err"), '8 unsafe paths');
    hasNot((string) file_get_contents("$d/err"), 'passwd');
    hasNot((string) file_get_contents("$d/host/.alno-deploy-manifest"), 'passwd');
    exec('rm -rf ' . escapeshellarg($d));
});

test('junk in the manifest does not count as files of the last upload', function () {
    [$d, $h] = setup();
    eq($h->run(), 0, (string) @file_get_contents("$d/err"));
    $hash = str_repeat('0', 64);
    for ($i = 0; $i < 30; $i++) file_put_contents("$d/host/.alno-deploy-manifest", "$hash  /x/$i\n", FILE_APPEND);
    eq($h->run(), 0, (string) @file_get_contents("$d/err"));
    exec('rm -rf ' . escapeshellarg($d));
});

test('a manifest that cannot be read stops the run instead of forgetting stale files', function () {
    [$d, $h] = setup();
    $h->run();
    file_put_contents("$d/src/neu.html", 'neu');
    ok($h->run(['FAKE_GET_FAILS' => '1']) !== 0, 'must fail');
    ok(!is_file("$d/host/public_html/neu.html"), 'nothing uploaded');
    exec('rm -rf ' . escapeshellarg($d));
});

test('FULL=true still knows what is stale', function () {
    [$d, $h] = setup();
    $h->run();
    unlink("$d/src/kontakt/index.html");
    eq($h->run(['FULL' => 'true']), 0, (string) @file_get_contents("$d/err"));
    ok(!is_file("$d/host/public_html/kontakt/index.html"), 'stale file deleted');
    exec('rm -rf ' . escapeshellarg($d));
});

test('a delete that fails keeps the file in the manifest, so the next run tries again', function () {
    [$d, $h] = setup();
    $h->run();
    unlink("$d/src/kontakt/index.html");
    ok($h->run(['FAKE_RM_FAILS' => '1']) !== 0, 'must fail');
    has((string) file_get_contents("$d/host/.alno-deploy-manifest"), 'kontakt/index.html');
    eq($h->run(), 0, (string) @file_get_contents("$d/err"));
    ok(!is_file("$d/host/public_html/kontakt/index.html"));
    exec('rm -rf ' . escapeshellarg($d));
});

foreach (['an empty folder' => static function (string $d): void { exec('rm -rf ' . escapeshellarg("$d/src")); mkdir("$d/src"); },
    'no index.html' => static function (string $d): void { unlink("$d/src/index.html"); },
    'an empty index.html' => static function (string $d): void { file_put_contents("$d/src/index.html", ''); }] as $name => $break) {
    test("$name stops the run: nothing uploaded, nothing deleted, the manifest stays", function () use ($break) {
        [$d, $h] = setup();
        eq($h->run(), 0, (string) @file_get_contents("$d/err"));
        $manifest = file_get_contents("$d/host/.alno-deploy-manifest");
        $break($d);
        ok($h->run() !== 0, 'must fail');
        has((string) file_get_contents("$d/err"), 'refusing to deploy');
        eq($h->log(), []);
        ok(is_file("$d/host/public_html/kontakt/index.html"), 'site gone');
        eq(file_get_contents("$d/host/.alno-deploy-manifest"), $manifest);
        exec('rm -rf ' . escapeshellarg($d));
    });
}
test('a build that lost most of its files stops the run; ALLOW_SHRINK lets a real clean-up through', function () {
    [$d, $h] = setup();
    mkdir("$d/src/seiten");
    for ($i = 0; $i < 20; $i++) file_put_contents("$d/src/seiten/s$i.html", "s$i");
    eq($h->run(), 0, (string) @file_get_contents("$d/err"));
    exec('rm -rf ' . escapeshellarg("$d/src/seiten"));
    ok($h->run() !== 0, 'must fail');
    has((string) file_get_contents("$d/err"), 'refusing to deploy');
    ok(is_file("$d/host/public_html/seiten/s7.html"), 'files deleted');
    eq($h->run(['ALLOW_SHRINK' => 'true']), 0, (string) @file_get_contents("$d/err"));
    ok(!is_file("$d/host/public_html/seiten/s7.html"), 'stale file stayed');
    exec('rm -rf ' . escapeshellarg($d));
});
test('a manifest entry that starts with a dash is a file name, not an option', function () {
    [$d, $h] = setup();
    eq($h->run(), 0, (string) @file_get_contents("$d/err"));
    $hash = str_repeat('a', 64);
    file_put_contents("$d/host/.alno-deploy-manifest", "$hash  -rf\n$hash  -x/y\n", FILE_APPEND);
    eq($h->run(), 0, (string) @file_get_contents("$d/err"));
    ok(strpos((string) file_get_contents("$d/host/.alno-deploy-manifest"), '-rf') === false, 'manifest not rewritten');
    exec('rm -rf ' . escapeshellarg($d));
});

test('the site never touches the admin folder inside its docroot, whatever the manifest says', function () {
    [$d, $h] = setup();
    eq($h->run([], null, 'public_html', '.alno-deploy-manifest', 'admin-alno'), 0, (string) @file_get_contents("$d/err"));
    mkdir("$d/host/public_html/admin-alno/wp-admin", 0755, true);
    foreach (['.htaccess', 'wp-admin/api.php', 'robots.txt', 'wp-login.php'] as $f) file_put_contents("$d/host/public_html/admin-alno/$f", 'admin');
    $hash = str_repeat('0', 64);
    $poison = ['admin-alno/wp-admin/api.php', 'admin-alno/.htaccess', 'admin-alno', './admin-alno/.htaccess', './admin-alno/wp-admin/api.php', './/admin-alno/robots.txt', '././admin-alno/wp-login.php', 'x//admin-alno', 'admin-alno//.htaccess'];
    file_put_contents("$d/host/.alno-deploy-manifest", implode('', array_map(static fn ($p) => "$hash  $p\n", $poison)), FILE_APPEND);
    eq($h->run([], null, 'public_html', '.alno-deploy-manifest', 'admin-alno'), 0, (string) @file_get_contents("$d/err"));
    foreach (['.htaccess', 'wp-admin/api.php', 'robots.txt', 'wp-login.php'] as $f) eq(file_get_contents("$d/host/public_html/admin-alno/$f"), 'admin', $f);
    hasNot(implode("\n", $h->log()), 'admin-alno');
    has((string) file_get_contents("$d/err"), '9 unsafe paths');
    hasNot((string) file_get_contents("$d/host/.alno-deploy-manifest"), 'admin-alno');
    exec('rm -rf ' . escapeshellarg($d));
});
test('a site folder holding the admin folder stops the run before anything moves', function () {
    [$d, $h] = setup();
    mkdir("$d/src/admin-alno");
    file_put_contents("$d/src/admin-alno/.htaccess", 'site');
    ok($h->run([], null, 'public_html', '.alno-deploy-manifest', 'admin-alno') !== 0, 'must fail');
    has((string) file_get_contents("$d/err"), 'refusing to deploy');
    eq($h->log(), []);
    exec('rm -rf ' . escapeshellarg($d));
});
test('a name that only starts like the admin folder is the site\'s own', function () {
    [$d, $h] = setup();
    file_put_contents("$d/src/admin-alno-info.html", 'x');
    eq($h->run([], null, 'public_html', '.alno-deploy-manifest', 'admin-alno'), 0, (string) @file_get_contents("$d/err"));
    unlink("$d/src/admin-alno-info.html");
    eq($h->run([], null, 'public_html', '.alno-deploy-manifest', 'admin-alno'), 0, (string) @file_get_contents("$d/err"));
    ok(!is_file("$d/host/public_html/admin-alno-info.html"), 'stale file stayed');
    exec('rm -rf ' . escapeshellarg($d));
});

test('two docroots with two manifests do not touch each other', function () {
    [$d, $h] = setup();
    mkdir("$d/adm/wp-admin/lib", 0755, true);
    file_put_contents("$d/adm/.htaccess", 'headers');
    file_put_contents("$d/adm/wp-admin/.htaccess", 'x');
    file_put_contents("$d/adm/wp-admin/lib/.htaccess", 'Require all denied');
    file_put_contents("$d/adm/wp-admin/api.php", '<?php');
    file_put_contents("$d/adm/wp-admin/index.html", 'admin');
    eq($h->run(), 0, (string) @file_get_contents("$d/err"));
    eq($h->run([], "$d/adm", 'public_html/admin-alno', '.alno-deploy-manifest-admin-alno'), 0, (string) @file_get_contents("$d/err"));
    ok(is_file("$d/host/public_html/admin-alno/.htaccess"), 'the docroot .htaccess arrived');
    ok(is_file("$d/host/public_html/admin-alno/wp-admin/lib/.htaccess"));
    ok(is_file("$d/host/public_html/index.html"), 'site untouched');
    unlink("$d/adm/wp-admin/api.php");
    eq($h->run([], "$d/adm", 'public_html/admin-alno', '.alno-deploy-manifest-admin-alno'), 0, (string) @file_get_contents("$d/err"));
    ok(!is_file("$d/host/public_html/admin-alno/wp-admin/api.php"), 'stale admin file deleted');
    ok(is_file("$d/host/public_html/wp-admin/.htaccess"), 'the other docroot keeps its own');
    eq(file_get_contents("$d/host/alno-data/users.json"), '{"keep":true}');
    exec('rm -rf ' . escapeshellarg($d));
});

finish();

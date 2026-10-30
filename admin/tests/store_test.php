<?php
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

test('the data folder is the home of the user, like the form endpoint finds it', function () {
    putenv('ALNO_DATA_DIR');
    $home = posix_getpwuid(posix_geteuid())['dir'];
    eq(Store::defaultDir(), rtrim($home, '/') . '/alno-data');
});
test('ALNO_DATA_DIR wins', function () {
    putenv('ALNO_DATA_DIR=/x/y/');
    eq(Store::defaultDir(), '/x/y');
    putenv('ALNO_DATA_DIR');
});
test('without HOME and posix nothing guesses a folder, and nothing can be written', function () {
    $root = realpath(sys_get_temp_dir()) . '/alno-store-' . bin2hex(random_bytes(4));
    mkdir("$root/www/x/admin-alno/wp-admin/lib", 0755, true);
    copy(__DIR__ . '/../public/wp-admin/lib/Store.php', "$root/www/x/admin-alno/wp-admin/lib/Store.php");
    copy(__DIR__ . '/../public/wp-admin/lib/data-dir.php', "$root/www/x/admin-alno/wp-admin/lib/data-dir.php");
    $code = 'putenv("ALNO_DATA_DIR"); putenv("HOME"); require $argv[1]; $s = new Store(); echo json_encode([$s->dir, $s->exists("config.json"), $s->readJson("config.json")]);
        try { $s->write("x", "y"); echo " written"; } catch (RuntimeException $e) { echo " " . $e->getMessage(); }';
    $out = shell_exec(escapeshellarg(PHP_BINARY) . ' -d disable_functions=posix_getpwuid -r ' . escapeshellarg($code) . ' ' . escapeshellarg("$root/www/x/admin-alno/wp-admin/lib/Store.php"));
    $folders = (string) shell_exec('find ' . escapeshellarg($root) . " -name 'alno-data*'");
    exec('rm -rf ' . escapeshellarg($root));
    eq($out, '["",false,null] Datenordner unbekannt');
    eq($folders, '', 'a folder was made');
});
test('cron without a data folder stops and writes nothing', function () {
    $root = realpath(sys_get_temp_dir()) . '/alno-cron-' . bin2hex(random_bytes(4));
    mkdir($root);
    file_put_contents("$root/prep.php", '<?php putenv("HOME"); putenv("ALNO_DATA_DIR");');
    $cron = __DIR__ . '/../public/wp-admin/cron.php';
    exec(escapeshellarg(PHP_BINARY) . ' -d disable_functions=posix_getpwuid -d auto_prepend_file=' . escapeshellarg("$root/prep.php") . ' ' . escapeshellarg($cron) . ' 2>&1', $o, $code);
    exec('rm -rf ' . escapeshellarg($root));
    eq(implode("\n", $o), 'no data folder');
    eq($code, 0);
});
test('the admin and the form endpoint use one file to find the folder', function () {
    $site = (string) file_get_contents(__DIR__ . '/../../public/api/data-dir.php');
    eq((string) file_get_contents(__DIR__ . '/../public/wp-admin/lib/data-dir.php'), $site, 'the two copies differ');
    $form = (string) file_get_contents(__DIR__ . '/../../public/api/anfrage.php');
    has($form, "require_once __DIR__ . '/data-dir.php'");
    has($form, 'alno_data_dir(web_root())');
    foreach (['posix_getpwuid', "getenv('ALNO_DATA_DIR')", 'dirname(web_root())'] as $own) hasNot($form, $own, 'a search of its own');
});

function layout(): string
{
    $root = realpath(sys_get_temp_dir()) . '/alno-dir-' . bin2hex(random_bytes(4));
    mkdir("$root/www/users/x/admin-alno", 0755, true);
    mkdir("$root/home");
    symlink("$root/www/users/x", "$root/home/public_html");
    return $root;
}
test('a path counts as in the web root by where it really is, whatever the names', function () {
    $root = layout();
    $roots = [realpath("$root/home/public_html")];
    symlink("$root/www/users/x", "$root/umweg");
    symlink("$root/www/users", "$root/umweg2");
    foreach (['www/users/x/daten', 'www/users/x/a/b/c', 'home/public_html/daten', 'umweg/daten', 'umweg2/x/daten/tief', 'www/users/x'] as $p) ok(alno_inside_web("$root/$p", $roots), $p);
    foreach (['home/alno-data', 'www/users/daten', 'www/users/x-daten', 'www/daten', 'nirgends/x'] as $p) ok(!alno_inside_web("$root/$p", $roots), $p);
    exec('rm -rf ' . escapeshellarg($root));
});
test('the web roots: the site, the document root and ~/public_html, each as a real path', function () {
    $root = layout();
    mkdir("$root/seite");
    mkdir("$root/doc");
    $code = 'require $argv[1]; $_SERVER["DOCUMENT_ROOT"] = $argv[2]; echo json_encode(alno_web_roots($argv[3]));';
    $out = shell_exec('HOME=' . escapeshellarg("$root/home") . ' ' . escapeshellarg(PHP_BINARY) . ' -d disable_functions=posix_getpwuid -r ' . escapeshellarg($code) . ' ' . escapeshellarg(__DIR__ . '/../public/wp-admin/lib/data-dir.php') . ' ' . escapeshellarg("$root/doc") . ' ' . escapeshellarg("$root/seite"));
    eq(json_decode((string) $out, true), ["$root/seite", "$root/doc", "$root/www/users/x"]);
    exec('rm -rf ' . escapeshellarg($root));
});
test('the setting: written once, read by the same function, and it beats HOME', function () {
    $root = layout();
    $site = "$root/www/users/x";
    $code = 'require $argv[1]; putenv("ALNO_DATA_DIR"); echo alno_data_dir($argv[2]);';
    $run = fn (string $home) => shell_exec('HOME=' . escapeshellarg($home) . ' ' . escapeshellarg(PHP_BINARY) . ' -d disable_functions=posix_getpwuid -r ' . escapeshellarg($code) . ' ' . escapeshellarg(__DIR__ . '/../public/wp-admin/lib/data-dir.php') . ' ' . escapeshellarg($site));
    eq($run("$root/home"), "$root/home/alno-data", 'before setup');
    putenv('ALNO_DATA_DIR');
    ok(alno_fix_data_dir($site, "$root/home/alno-data"));
    eq(decoct(fileperms("$root/www/users/.alno-data-dir") & 0777), '600');
    ok(alno_fix_data_dir($site, '/anderswo'), 'a second call is no error');
    eq($run('/gibt/es/nicht'), "$root/home/alno-data", 'written once, and HOME no longer matters');
    eq($run("$root/www"), "$root/home/alno-data");
    exec('rm -rf ' . escapeshellarg($root));
});
test('ALNO_DATA_DIR wins and writes no setting', function () {
    $root = layout();
    putenv('ALNO_DATA_DIR=/x/y/');
    ok(alno_fix_data_dir("$root/www/users/x", '/x/y'));
    eq(alno_data_dir("$root/www/users/x"), '/x/y');
    putenv('ALNO_DATA_DIR');
    ok(!is_file("$root/www/users/.alno-data-dir"));
    exec('rm -rf ' . escapeshellarg($root));
});
test('a broken setting is no folder, not a reason to fall back', function () {
    $root = layout();
    putenv('ALNO_DATA_DIR');
    foreach (['relativ/pfad', '/a/../b', '', "/a\n/b\nzwei"] as $bad) {
        file_put_contents("$root/www/users/.alno-data-dir", $bad);
        eq(alno_data_dir("$root/www/users/x"), '', $bad);
    }
    exec('rm -rf ' . escapeshellarg($root));
});
finish();

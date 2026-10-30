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
test('the admin and the endpoint agree on the folder', function () {
    // Both copies of the search must stay the same; the endpoint is on another branch until merged.
    $src = (string) @file_get_contents(__DIR__ . '/../../public/api/anfrage.php');
    if ($src === '') throw new Skip('anfrage.php is not on this branch');
    has($src, "posix_getpwuid(posix_geteuid())");
    has($src, "getenv('ALNO_DATA_DIR')");
    has($src, "'/alno-data'");
    hasNot($src, 'dirname(web_root())', 'a guess of its own');
});
finish();

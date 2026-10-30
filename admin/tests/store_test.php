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
test('an admin docroot inside public_html does not count as a place outside the web', function () {
    eq(Store::outerWebRoot('/usr/home/x/public_html/admin-alno'), '/usr/home/x/public_html');
    eq(Store::outerWebRoot('/usr/home/x/public_html'), '/usr/home/x/public_html');
    eq(Store::outerWebRoot('/usr/home/x/public_html/a/b'), '/usr/home/x/public_html');
    eq(dirname(Store::outerWebRoot('/usr/home/x/public_html/admin-alno')), '/usr/home/x');
    eq(Store::outerWebRoot('/usr/home/x/admin_html'), '/usr/home/x/admin_html');
    eq(Store::outerWebRoot('/usr/home/x/public_html_alt/a'), '/usr/home/x/public_html_alt/a');
    eq(Store::outerWebRoot(''), '');
});
test('without HOME and posix the folder is still found above public_html, never in it', function () {
    $root = realpath(sys_get_temp_dir()) . '/alno-store-' . bin2hex(random_bytes(4));
    mkdir("$root/public_html/admin-alno/wp-admin/lib", 0755, true);
    copy(__DIR__ . '/../public/wp-admin/lib/Store.php', "$root/public_html/admin-alno/wp-admin/lib/Store.php");
    $code = 'putenv("ALNO_DATA_DIR"); putenv("HOME"); require $argv[1]; echo Store::defaultDir();';
    $out = shell_exec(escapeshellarg(PHP_BINARY) . ' -d disable_functions=posix_getpwuid -r ' . escapeshellarg($code) . ' ' . escapeshellarg("$root/public_html/admin-alno/wp-admin/lib/Store.php"));
    exec('rm -rf ' . escapeshellarg($root));
    eq($out, "$root/alno-data");
});
test('the admin and the endpoint agree on the folder', function () {
    // Both copies of the search must stay the same; the endpoint is on another branch until merged.
    $src = (string) @file_get_contents(__DIR__ . '/../../public/api/anfrage.php');
    if ($src === '') throw new Skip('anfrage.php is not on this branch');
    has($src, "posix_getpwuid(posix_geteuid())");
    has($src, "getenv('ALNO_DATA_DIR')");
    has($src, "'/alno-data'");
});
finish();

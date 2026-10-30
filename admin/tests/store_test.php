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
test('the admin and the endpoint agree on the folder', function () {
    // Both copies of the search must stay the same; the endpoint is on another branch until merged.
    $src = (string) @file_get_contents(__DIR__ . '/../../public/api/anfrage.php');
    if ($src === '') throw new Skip('anfrage.php is not on this branch');
    has($src, "posix_getpwuid(posix_geteuid())");
    has($src, "getenv('ALNO_DATA_DIR')");
    has($src, "'/alno-data'");
});
finish();

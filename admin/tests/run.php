<?php
// Runs every *_test.php in its own process, or those named on the command line (`run.php auth flow`).
// Prints what failed and one summary line; exits non-zero on any failure.
declare(strict_types=1);

const FILE_LIMIT = 300; // seconds, for one test file

$names = array_slice($argv, 1);
$files = glob(__DIR__ . '/*_test.php') ?: [];
if ($names) $files = array_values(array_filter($files, static fn ($f) => in_array(basename($f, '_test.php'), $names, true)));
if (!$files) { echo "no test files\n"; exit(1); }

$started = microtime(true);
$pass = 0;
$fail = 0;
$skip = 0;
$broken = [];
foreach ($files as $file) {
    $name = basename($file, '_test.php');
    $t = microtime(true);
    $out = tempnam(sys_get_temp_dir(), 'alno-test');
    $p = proc_open([PHP_BINARY, $file], [0 => ['file', '/dev/null', 'r'], 1 => ['file', $out, 'w'], 2 => ['file', $out, 'a']], $pipes);
    while (($st = proc_get_status($p))['running'] && microtime(true) - $t < FILE_LIMIT) usleep(50000);
    if ($st['running']) {
        proc_terminate($p);
        $code = 124;
    } else {
        $code = $st['exitcode'];
    }
    proc_close($p);
    $text = (string) file_get_contents($out);
    unlink($out);
    $ok = preg_match('/^(\d+) passed, (\d+) failed, (\d+) skipped$/m', $text, $m) === 1;
    if ($ok) { $pass += (int) $m[1]; $fail += (int) $m[2]; $skip += (int) $m[3]; }
    // A file that died has no summary, or one that hides what it never reached.
    if (!$ok || $code !== 0) {
        if (!$ok || (int) $m[2] === 0) { $broken[] = $name; }
        echo "--- $name (exit $code)\n" . rtrim($text) . "\n";
    } else {
        foreach (explode("\n", $text) as $line) if (strncmp($line, '  skip:', 7) === 0) echo "$name$line\n";
    }
    printf("%-14s %s  %.1fs\n", $name, $ok ? "{$m[1]} passed, {$m[2]} failed, {$m[3]} skipped" : 'NO SUMMARY', microtime(true) - $t);
}
$total = $pass + $fail;
printf("TOTAL: %d tests, %d passed, %d failed, %d skipped, in %d files, %.0fs%s\n", $total, $pass, $fail, $skip, count($files), microtime(true) - $started, $broken ? ' — BROKEN: ' . implode(', ', $broken) : '');
exit($fail || $broken ? 1 : 0);

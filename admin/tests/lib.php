<?php
// A very small test runner: plain PHP, no Composer. Each *_test.php calls test('name', fn () => ...).
declare(strict_types=1);

$GLOBALS['t_pass'] = 0;
$GLOBALS['t_fail'] = [];

final class Skip extends Exception {}

function test(string $name, callable $fn): void
{
    try {
        $fn();
        $GLOBALS['t_pass']++;
    } catch (Skip $e) {
        echo "  skip: $name ({$e->getMessage()})\n";
    } catch (Throwable $e) {
        $GLOBALS['t_fail'][] = $name;
        $where = basename($e->getFile()) . ':' . $e->getLine();
        foreach ($e->getTrace() as $f) {
            if (isset($f['file']) && str_ends_with($f['file'], '_test.php')) { $where = basename($f['file']) . ':' . $f['line']; break; }
        }
        echo "FAIL $name\n     $where: " . mb_substr($e->getMessage(), 0, 600) . "\n";
    }
}

function show($v): string
{
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
}

function eq($actual, $expected, string $what = ''): void
{
    if ($actual !== $expected) throw new RuntimeException("$what\n     got:  " . show($actual) . "\n     want: " . show($expected));
}

function ok($cond, string $what = ''): void
{
    if (!$cond) throw new RuntimeException($what ?: 'expected true');
}

function has(string $haystack, string $needle, string $what = ''): void
{
    if (strpos($haystack, $needle) === false) throw new RuntimeException("$what\n     «{$needle}» not in: " . mb_substr($haystack, 0, 400));
}

function hasNot(string $haystack, string $needle, string $what = ''): void
{
    if (strpos($haystack, $needle) !== false) throw new RuntimeException("$what\n     «{$needle}» found in: " . mb_substr($haystack, 0, 400));
}

function finish(): void
{
    $f = $GLOBALS['t_fail'];
    echo $GLOBALS['t_pass'] . ' passed, ' . count($f) . " failed\n";
    exit($f ? 1 : 0);
}

<?php
// Frontmatter of the Markdown collections: a small, strict YAML subset.
// Supported: `key: scalar` (plain, "double", 'single'), `key: [a, b]`, and block lists (`key:` + `  - item`).
// Anything else throws, so a file the admin does not understand is never rewritten half-parsed.
declare(strict_types=1);

final class FrontmatterError extends RuntimeException {}

final class Frontmatter
{
    public static function split(string $text): array
    {
        if (!mb_check_encoding($text, 'UTF-8')) throw new FrontmatterError('Die Datei ist nicht in UTF-8 gespeichert');
        $s = str_replace(["\r\n", "\r"], "\n", (string) preg_replace('/^\x{FEFF}/u', '', $text));
        if (!preg_match('/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/D', $s, $m)) return ['fm' => '', 'body' => $s, 'hasFm' => false];
        return ['fm' => $m[1], 'body' => substr($s, strlen($m[0])), 'hasFm' => true];
    }

    private static function unquote(string $v, int $line): ?string
    {
        if ($v !== '' && $v[0] === '"') {
            if (!preg_match('/^"(?:[^"\\\\]|\\\\.)*"$/sD', $v)) throw new FrontmatterError("Zeile $line: Anführungszeichen nicht geschlossen");
            $d = json_decode(str_replace("\\'", "'", $v));
            if (!is_string($d)) throw new FrontmatterError("Zeile $line: ungültige Zeichenkette");
            return $d;
        }
        if ($v !== '' && $v[0] === "'") {
            if (!preg_match("/^'(?:[^']|'')*'$/sD", $v)) throw new FrontmatterError("Zeile $line: Anführungszeichen nicht geschlossen");
            return str_replace("''", "'", substr($v, 1, -1));
        }
        return null;
    }

    private static function scalar(string $raw, int $line)
    {
        $v = Rules::trim($raw);
        $q = self::unquote($v, $line);
        if ($q !== null) return $q;
        if (preg_match('/^[|>&*!%@`]/', $v)) throw new FrontmatterError("Zeile $line: nicht unterstütztes YAML");
        $plain = rtrim(preg_match('/\s#/', $v, $m, PREG_OFFSET_CAPTURE) ? substr($v, 0, $m[0][1]) : $v);
        if ($plain === '' || $plain === '~' || $plain === 'null') return null;
        if ($plain === 'true') return true;
        if ($plain === 'false') return false;
        if (preg_match('/^-?\d+(\.\d+)?$/D', $plain)) return strpos($plain, '.') === false ? (int) $plain : (float) $plain;
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/D', $plain)) return ['date' => $plain];
        return $plain;
    }

    private static function splitFlow(string $inner, int $line): array
    {
        $items = [];
        $cur = '';
        $q = null;
        $n = strlen($inner);
        for ($i = 0; $i < $n; $i++) {
            $ch = $inner[$i];
            if ($q !== null) { $cur .= $ch; if ($ch === $q) $q = null; continue; }
            // A quote opens a string only at the start of an item: «it's» is a plain word.
            if (($ch === '"' || $ch === "'") && trim($cur) === '') { $q = $ch; $cur .= $ch; continue; }
            if ($ch === '[' || $ch === '{') throw new FrontmatterError("Zeile $line: verschachtelte Listen werden nicht unterstützt");
            if ($ch === ',') { $items[] = $cur; $cur = ''; continue; }
            $cur .= $ch;
        }
        if ($q !== null) throw new FrontmatterError("Zeile $line: Anführungszeichen nicht geschlossen");
        if (trim($cur) !== '') $items[] = $cur;
        return array_map(static fn ($s) => self::scalar($s, $line), $items);
    }

    /** Returns an ordered list of [key, value]; dates are ['date' => 'YYYY-MM-DD']. */
    public static function parse(string $fm): array
    {
        $lines = explode("\n", $fm);
        $entries = [];
        $seen = [];
        $count = count($lines);
        for ($i = 0; $i < $count; $i++) {
            $line = $lines[$i];
            if (preg_match('/^\s*(#.*)?$/D', $line)) continue;
            $no = $i + 1;
            if (!preg_match('/^([A-Za-z_][\w-]*):(?:\s+([\s\S]*)|\s*)$/D', $line, $m)) throw new FrontmatterError("Zeile $no: nicht unterstütztes YAML");
            $key = $m[1];
            $rest = Rules::trim($m[2] ?? '');
            if (isset($seen[$key])) throw new FrontmatterError("Zeile $no: Schlüssel „{$key}“ doppelt");
            $seen[$key] = true;
            if ($rest !== '' && $rest[0] === '[') {
                if (!preg_match('/\]\s*(#.*)?$/D', $rest, $c, PREG_OFFSET_CAPTURE)) throw new FrontmatterError("Zeile $no: Liste nicht geschlossen");
                $entries[] = [$key, self::splitFlow(substr($rest, 1, $c[0][1] - 1), $no)];
                continue;
            }
            if ($rest === '' || $rest[0] === '#') {
                $items = [];
                while ($i + 1 < $count && preg_match('/^\s+-(\s|$)/', $lines[$i + 1])) {
                    $i++;
                    $items[] = self::scalar((string) preg_replace('/^\s+-\s?/', '', $lines[$i]), $i + 1);
                }
                if ($i + 1 < $count && preg_match('/^\s+\S/', $lines[$i + 1])) throw new FrontmatterError('Zeile ' . ($i + 2) . ': nicht unterstütztes YAML');
                $entries[] = [$key, $items ?: null];
                continue;
            }
            $entries[] = [$key, self::scalar($rest, $no)];
        }
        return $entries;
    }

    private static function quote(string $s): string
    {
        return (string) json_encode($s, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS);
    }

    private static function looksNumeric(string $s): bool
    {
        return preg_match('/^[+-]?(\d+\.?\d*(e[+-]?\d+)?|\.\d+(e[+-]?\d+)?|infinity)$/iD', $s) === 1
            || preg_match('/^0(x[0-9a-f]+|o[0-7]+|b[01]+)$/iD', $s) === 1
            || preg_match('/^[-+]?[\d_]+(\.\d*)?$/D', $s) === 1
            || preg_match('/^[-+]?\.(inf|nan)$/iD', $s) === 1;
    }

    private static function quoteIfNeeded(string $s): string
    {
        if ($s === '') return '""';
        $ws = Rules::WS_CLASS;
        $risky = preg_match("/^[$ws\\-?:,\\[\\]{}#&*!|>'\"%@`]/u", $s)
            || preg_match("/:([$ws]|$)|[$ws]#|\\n|\\t|[$ws]$/Du", $s)
            || preg_match('/^(true|false|null|~|yes|no|on|off|y|n)$/iD', $s)
            || preg_match('/^\d{4}-\d{1,2}-\d{1,2}/', $s)
            || self::looksNumeric($s);
        return $risky ? self::quote($s) : $s;
    }

    private static function fmtScalar($v, bool $inFlow = false): string
    {
        if ($v === null) return '';
        if (is_bool($v)) return $v ? 'true' : 'false';
        if (is_int($v) || is_float($v)) return (string) $v;
        if (is_array($v) && isset($v['date'])) return $v['date'];
        $q = self::quoteIfNeeded((string) $v);
        return $inFlow && $q[0] !== '"' && preg_match('/[,\[\]{}\'"]/', $q) ? self::quote((string) $v) : $q;
    }

    /** `flowKeys`: arrays written as `key: [a, b]` (like the site's `tags`), all others as block lists. */
    public static function stringify(array $entries, array $flowKeys = []): string
    {
        $out = [];
        foreach ($entries as [$key, $v]) {
            if ($v === null) continue;
            if (is_array($v) && !isset($v['date'])) {
                if (!$v) { $out[] = "$key: []"; continue; }
                if (in_array($key, $flowKeys, true)) {
                    $out[] = "$key: [" . implode(', ', array_map(static fn ($x) => self::fmtScalar($x, true), $v)) . ']';
                    continue;
                }
                $out[] = "$key:";
                foreach ($v as $item) $out[] = '  - ' . self::fmtScalar($item);
                continue;
            }
            $out[] = "$key: " . self::fmtScalar($v);
        }
        return implode("\n", $out);
    }

    public static function build(array $entries, string $body, array $flowKeys = []): string
    {
        $b = rtrim(ltrim(str_replace(["\r\n", "\r"], "\n", $body), "\n"), " \t\n\v\f\r");
        return "---\n" . self::stringify($entries, $flowKeys) . "\n---\n" . ($b !== '' ? "\n$b\n" : '');
    }
}

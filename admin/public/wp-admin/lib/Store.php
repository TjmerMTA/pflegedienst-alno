<?php
// The data folder outside the web root: config, users, lockout, sessions, logs, caches, trash.
declare(strict_types=1);

final class Store
{
    public string $dir;

    public function __construct(?string $dir = null)
    {
        $this->dir = rtrim($dir ?? self::defaultDir(), '/');
        if ($this->dir !== '' && !is_dir($this->dir)) @mkdir($this->dir, 0700, true);
    }

    /** Whether the data folder is $root or lies below it. */
    public function isInside(string $root): bool
    {
        $base = $root !== '' ? realpath($root) : false;
        $dir = $this->dir !== '' ? realpath($this->dir) : false; // realpath('') is the working directory
        return $base !== false && $dir !== false && strncmp("$dir/", "$base/", strlen($base) + 1) === 0;
    }

    /**
     * ~/alno-data, found exactly as public/api/anfrage.php finds it: the form endpoint writes here.
     */
    public static function defaultDir(): string
    {
        $env = getenv('ALNO_DATA_DIR');
        if (is_string($env) && $env !== '') return rtrim($env, '/');
        $home = '';
        if (function_exists('posix_getpwuid') && function_exists('posix_geteuid')) {
            $user = posix_getpwuid(posix_geteuid());
            $home = is_array($user) ? (string) $user['dir'] : '';
        }
        if ($home === '' || !@is_dir($home)) $home = (string) getenv('HOME');
        // No guess from here: the code's path says nothing about where the web root ends, and a folder
        // guessed wrongly is served to anyone. '' means unknown; setup then asks for ALNO_DATA_DIR.
        if ($home === '' || !@is_dir($home)) return '';
        return rtrim($home, '/') . '/alno-data';
    }

    public function path(string $rel): string
    {
        if ($this->dir === '') throw new RuntimeException('Datenordner unbekannt');
        return $this->dir . '/' . $rel;
    }

    public function exists(string $rel): bool
    {
        return $this->dir !== '' && is_file($this->path($rel));
    }

    public function read(string $rel): ?string
    {
        $v = $this->dir === '' ? false : @file_get_contents($this->path($rel));
        return $v === false ? null : $v;
    }

    public function readJson(string $rel, $default = null)
    {
        $raw = $this->read($rel);
        if ($raw === null) return $default;
        $v = json_decode($raw, true);
        return $v === null ? $default : $v;
    }

    /** Atomic: a crash leaves the old file or the new one, never half of one. */
    public function write(string $rel, string $data): void
    {
        $file = $this->path($rel);
        $dir = dirname($file);
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) throw new RuntimeException("Ordner nicht anlegbar: $rel");
        $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
        if (@file_put_contents($tmp, $data) === false) { @unlink($tmp); throw new RuntimeException("Nicht schreibbar: $rel"); }
        @chmod($tmp, 0600);
        if (!@rename($tmp, $file)) { @unlink($tmp); throw new RuntimeException("Nicht schreibbar: $rel"); }
    }

    public function writeJson(string $rel, $data): void
    {
        $this->write($rel, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n");
    }

    public function delete(string $rel): void
    {
        @unlink($this->path($rel));
    }

    /** One critical section at a time, across PHP processes. */
    public function withLock(string $name, callable $fn)
    {
        if (!is_dir($this->path('locks'))) @mkdir($this->path('locks'), 0700, true);
        $h = fopen($this->path("locks/$name.lock"), 'c');
        if ($h === false) throw new RuntimeException('Sperre nicht möglich');
        flock($h, LOCK_EX);
        try {
            return $fn();
        } finally {
            flock($h, LOCK_UN);
            fclose($h);
        }
    }

    /** $log: `admin`, or `access` for who read which submission, which only logged-in users can fill. */
    public function log(array $entry, string $log = 'admin'): void
    {
        if (!is_dir($this->path('logs'))) @mkdir($this->path('logs'), 0700, true);
        $file = $this->path("logs/$log.log");
        clearstatcache(true, $file);
        if (@filesize($file) > 2097152) {
            $this->withLock('log', static function () use ($file): void {
                clearstatcache(true, $file);
                if (@filesize($file) > 2097152) @rename($file, $file . '.1');
            });
        }
        @file_put_contents($file, json_encode(['at' => gmdate('c')] + $entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
    }
}

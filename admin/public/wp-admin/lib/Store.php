<?php
// The data folder outside the web root: config, users, lockout, sessions, logs, caches, trash.
declare(strict_types=1);

final class Store
{
    public string $dir;

    public function __construct(?string $dir = null)
    {
        // ~/alno-data next to public_html; lib/ is public_html/wp-admin/lib.
        $this->dir = rtrim($dir ?? (getenv('ALNO_DATA_DIR') ?: dirname(__DIR__, 3) . '/alno-data'), '/');
        if (!is_dir($this->dir)) @mkdir($this->dir, 0700, true);
    }

    /** Whether the data folder is $root or lies below it. */
    public function isInside(string $root): bool
    {
        $base = $root !== '' ? realpath($root) : false;
        $dir = realpath($this->dir);
        return $base !== false && $dir !== false && strncmp("$dir/", "$base/", strlen($base) + 1) === 0;
    }

    public function path(string $rel): string
    {
        return $this->dir . '/' . $rel;
    }

    public function exists(string $rel): bool
    {
        return is_file($this->path($rel));
    }

    public function read(string $rel): ?string
    {
        $v = @file_get_contents($this->path($rel));
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

    public function log(array $entry): void
    {
        if (!is_dir($this->path('logs'))) @mkdir($this->path('logs'), 0700, true);
        $file = $this->path('logs/admin.log');
        if (@filesize($file) > 2097152) @rename($file, $file . '.1');
        @file_put_contents($file, json_encode(['at' => gmdate('c')] + $entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
    }
}

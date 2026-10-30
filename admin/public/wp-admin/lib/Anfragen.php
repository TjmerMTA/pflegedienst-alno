<?php
// Submissions of the site's forms (docs/anfragen-format.md). They hold personal and health data:
// every value came from a stranger, nothing leaves this class unchecked, `ip_hash` is never handed
// out, and retention is enforced here, in the trash too.
declare(strict_types=1);

final class Anfragen
{
    const ID_RE = '/^\d{4}-\d\d-\d\d-\d{6}-[0-9a-f]{16}$/D';
    const STORED_RE = '/^[0-9a-f]{32}$/D';
    const LIVE = 'anfragen';
    const TRASH = 'anfragen-papierkorb';
    const TRASH_DAYS = 30;
    const APPLICATIONS = ['karriere', 'ausbildung'];
    const STATUSES = ['neu', 'erledigt'];

    private Store $store;
    private int $now;

    public function __construct(Store $store, ?int $now = null)
    {
        $this->store = $store;
        $this->now = $now ?? time();
    }

    public function retention(): array
    {
        $r = $this->store->readJson('settings.json', [])['retention'] ?? [];
        return ['inquiries' => (int) ($r['inquiries'] ?? 6), 'applications' => (int) ($r['applications'] ?? 6)];
    }

    public function setRetention(int $inquiries, int $applications): void
    {
        $this->store->withLock('settings', function () use ($inquiries, $applications) {
            $s = $this->store->readJson('settings.json', []);
            $s['retention'] = ['inquiries' => $inquiries, 'applications' => $applications];
            $this->store->writeJson('settings.json', $s);
        });
    }

    private function deleteAt(array $rec, array $retention): int
    {
        $months = in_array($rec['form'] ?? '', self::APPLICATIONS, true) ? $retention['applications'] : $retention['inquiries'];
        $ts = strtotime((string) ($rec['received'] ?? ''));
        if ($ts === false) $ts = (int) @filemtime($this->store->path(self::LIVE . '/' . ($rec['id'] ?? '') . '.json')) ?: $this->now;
        return (new DateTimeImmutable('@' . $ts))->modify("+$months months")->getTimestamp();
    }

    /** When something in the trash goes at the latest. */
    private function trashEnd(string $id): int
    {
        return (int) @filemtime($this->store->path(self::TRASH . "/$id.json")) + self::TRASH_DAYS * 86400;
    }

    private function records(string $dir): array
    {
        $out = [];
        foreach (glob($this->store->path("$dir/*.json")) ?: [] as $file) {
            $name = basename($file);
            if ($name[0] === '.' || !preg_match(self::ID_RE, substr($name, 0, -5))) continue;
            $rec = json_decode((string) @file_get_contents($file), true);
            if (is_array($rec)) { $rec['id'] = substr($name, 0, -5); $out[] = $rec; }
        }
        usort($out, static fn ($a, $b) => strcmp($b['id'], $a['id']));
        return $out;
    }

    private function brief(array $rec, array $retention, bool $trashed = false): array
    {
        $f = is_array($rec['fields'] ?? null) ? $rec['fields'] : [];
        $at = $this->deleteAt($rec, $retention);
        return [
            'id' => $rec['id'], 'received' => (string) ($rec['received'] ?? ''), 'form' => (string) ($rec['form'] ?? ''),
            'name' => (string) ($f['name'] ?? ''), 'phone' => (string) ($f['phone'] ?? ''), 'status' => (string) ($rec['status'] ?? 'neu'),
            'files' => count(is_array($rec['files'] ?? null) ? $rec['files'] : []), 'deleteAt' => gmdate('c', $trashed ? min($at, $this->trashEnd($rec['id'])) : $at),
            'invalid' => array_values(array_filter(is_array($rec['invalid'] ?? null) ? $rec['invalid'] : [], 'is_string')), 'filesRefused' => max(0, (int) ($rec['files_refused'] ?? 0)),
        ];
    }

    /** The endpoint's notice while the storage limit is reached. Only its numbers are passed on. */
    public function warning(): ?array
    {
        $w = $this->store->readJson('anfragen-warnung.json');
        if (!is_array($w)) return null;
        return ['since' => (string) ($w['since'] ?? ''), 'usedMb' => (float) ($w['used_mb'] ?? 0), 'limitMb' => (float) ($w['limit_mb'] ?? 0)];
    }

    public function counts(): array
    {
        $new = 0;
        foreach ($this->records(self::LIVE) as $r) if (($r['status'] ?? 'neu') === 'neu') $new++;
        return ['new' => $new];
    }

    public function listing(string $view): array
    {
        $this->purge();
        $retention = $this->retention();
        $live = $this->records(self::LIVE);
        $trash = $this->records(self::TRASH);
        $rows = $view === 'trash' ? $trash : ($view === 'neu' || $view === 'erledigt' ? array_filter($live, static fn ($r) => ($r['status'] ?? 'neu') === $view) : $live);
        return [
            'items' => array_values(array_map(fn ($r) => $this->brief($r, $retention, $view === 'trash'), $rows)),
            'counts' => ['all' => count($live), 'neu' => count(array_filter($live, static fn ($r) => ($r['status'] ?? 'neu') === 'neu')), 'erledigt' => count(array_filter($live, static fn ($r) => ($r['status'] ?? 'neu') === 'erledigt')), 'trash' => count($trash)],
            'retention' => $retention, 'view' => $view,
        ];
    }

    private function load(string $id, string $dir = self::LIVE): ?array
    {
        if (!preg_match(self::ID_RE, $id)) return null;
        $rec = $this->store->readJson("$dir/$id.json");
        return is_array($rec) ? $rec : null;
    }

    public function detail(string $id): ?array
    {
        $this->purge();
        $dir = self::LIVE;
        $rec = $this->load($id);
        if (!$rec) { $dir = self::TRASH; $rec = $this->load($id, $dir); }
        if (!$rec) return null;
        $rec['id'] = $id;
        $files = [];
        foreach (is_array($rec['files'] ?? null) ? $rec['files'] : [] as $f) {
            if (preg_match(self::STORED_RE, (string) ($f['stored'] ?? ''))) $files[] = ['name' => (string) ($f['name'] ?? ''), 'stored' => $f['stored'], 'size' => (int) ($f['size'] ?? 0), 'type' => (string) ($f['type'] ?? '')];
        }
        return $this->brief($rec, $this->retention(), $dir === self::TRASH) + [
            'page' => (string) ($rec['page'] ?? ''), 'fields' => array_filter(is_array($rec['fields'] ?? null) ? $rec['fields'] : [], 'is_scalar'),
            'attachments' => $files, 'trashed' => $dir === self::TRASH,
        ];
    }

    /** Path of an attachment that the record really lists. */
    public function attachment(string $id, string $stored): ?array
    {
        if (!preg_match(self::STORED_RE, $stored)) return null;
        $this->purge();
        foreach ([self::LIVE, self::TRASH] as $dir) {
            $rec = $this->load($id, $dir);
            foreach (is_array($rec['files'] ?? null) ? $rec['files'] : [] as $f) {
                if (($f['stored'] ?? '') === $stored && is_file($this->store->path("$dir/files/$stored"))) {
                    return ['path' => $this->store->path("$dir/files/$stored"), 'name' => (string) ($f['name'] ?? 'datei'), 'type' => (string) ($f['type'] ?? '')];
                }
            }
        }
        return null;
    }

    public function setStatus(string $id, string $status): bool
    {
        if (!in_array($status, self::STATUSES, true)) return false;
        $rec = $this->load($id);
        if (!$rec) return false;
        $rec['status'] = $status;
        $this->store->write(self::LIVE . "/$id.json", (string) json_encode($rec, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        return true;
    }

    private function move(array $rec, string $id, string $from, string $to): void
    {
        if (!is_dir($this->store->path("$to/files"))) @mkdir($this->store->path("$to/files"), 0700, true);
        foreach (is_array($rec['files'] ?? null) ? $rec['files'] : [] as $f) {
            $stored = (string) ($f['stored'] ?? '');
            if (preg_match(self::STORED_RE, $stored) && is_file($this->store->path("$from/files/$stored"))) @rename($this->store->path("$from/files/$stored"), $this->store->path("$to/files/$stored"));
        }
        @rename($this->store->path("$from/$id.json"), $this->store->path("$to/$id.json"));
    }

    public function trash(string $id): bool
    {
        $rec = $this->load($id);
        if (!$rec) return false;
        $this->move($rec, $id, self::LIVE, self::TRASH);
        @touch($this->store->path(self::TRASH . "/$id.json"), $this->now);
        return true;
    }

    public function restore(string $id): bool
    {
        $rec = $this->load($id, self::TRASH);
        if (!$rec) return false;
        $this->move($rec, $id, self::TRASH, self::LIVE);
        return true;
    }

    /** Deleting a submission deletes its files too. */
    public function destroy(string $id, string $dir = self::TRASH): bool
    {
        $rec = $this->load($id, $dir);
        if (!$rec) return false;
        foreach (is_array($rec['files'] ?? null) ? $rec['files'] : [] as $f) {
            $stored = (string) ($f['stored'] ?? '');
            if (preg_match(self::STORED_RE, $stored)) @unlink($this->store->path("$dir/files/$stored"));
        }
        @unlink($this->store->path("$dir/$id.json"));
        return true;
    }

    /**
     * Automatic deletion. Past its date a submission goes for good, also from the trash: the trash
     * cannot extend the retention. What sits in the trash goes after TRASH_DAYS at the latest.
     * Returns how many were deleted.
     */
    public function purge(): int
    {
        $retention = $this->retention();
        $n = 0;
        foreach ($this->records(self::LIVE) as $r) {
            if ($this->deleteAt($r, $retention) <= $this->now && $this->destroy($r['id'], self::LIVE)) $n++;
        }
        foreach ($this->records(self::TRASH) as $r) {
            if (min($this->trashEnd($r['id']), $this->deleteAt($r, $retention)) <= $this->now && $this->destroy($r['id'], self::TRASH)) $n++;
        }
        if ($n) $this->store->log(['event' => 'anfragen-purge', 'deleted' => $n]);
        return $n;
    }
}

<?php
// A small git repository on disk that answers like GitHub. Object ids are real git blob ids. Used by
// fake-github.php (the HTTP side) and directly by the tests, to seed it and to change it behind the
// admin's back.
declare(strict_types=1);

final class FakeGit
{
    const REPO = 'TjmerMTA/pflegedienst-alno';

    public string $dir;

    public function __construct(string $dir)
    {
        $this->dir = rtrim($dir, '/');
        foreach (['blobs', 'trees', 'commits'] as $d) if (!is_dir("$this->dir/$d")) @mkdir("$this->dir/$d", 0700, true);
    }

    // ---------------- objects ----------------

    public function putBlob(string $bytes): string
    {
        $sha = sha1('blob ' . strlen($bytes) . "\0" . $bytes);
        file_put_contents("$this->dir/blobs/$sha", $bytes);
        return $sha;
    }

    public function blob(string $sha): ?string
    {
        $v = @file_get_contents("$this->dir/blobs/$sha");
        return $v === false ? null : $v;
    }

    /** $map: path => blob sha. */
    public function putTree(array $map): string
    {
        ksort($map);
        $json = json_encode($map);
        $sha = sha1("tree $json");
        file_put_contents("$this->dir/trees/$sha.json", $json);
        return $sha;
    }

    public function tree(string $sha): ?array
    {
        $v = @file_get_contents("$this->dir/trees/$sha.json");
        return $v === false ? null : json_decode($v, true);
    }

    public function putCommit(array $c): string
    {
        $sha = sha1('commit ' . json_encode($c) . random_bytes(8));
        file_put_contents("$this->dir/commits/$sha.json", json_encode($c + ['sha' => $sha]));
        return $sha;
    }

    public function commit(string $sha): ?array
    {
        $v = @file_get_contents("$this->dir/commits/$sha.json");
        return $v === false ? null : json_decode($v, true);
    }

    public function head(): string
    {
        return trim((string) @file_get_contents("$this->dir/ref"));
    }

    public function setHead(string $sha): void
    {
        file_put_contents("$this->dir/ref", $sha);
    }

    /** The files of the branch head, or of a commit: path => blob sha. */
    public function files(?string $commit = null): array
    {
        $c = $this->commit($commit ?? $this->head());
        return $c ? (array) $this->tree($c['tree']) : [];
    }

    public function read(string $path, ?string $commit = null): ?string
    {
        $sha = $this->files($commit)[$path] ?? null;
        return $sha ? $this->blob($sha) : null;
    }

    /** Commit shas from the head back to the first one. */
    public function history(): array
    {
        $out = [];
        for ($c = $this->commit($this->head()); $c; $c = $c['parents'] ? $this->commit($c['parents'][0]) : null) $out[] = $c['sha'];
        return $out;
    }

    /** Paths one commit changed against its parent. */
    public function changed(string $sha): array
    {
        $c = $this->commit($sha);
        $now = $this->files($sha);
        $before = $c['parents'] ? $this->files($c['parents'][0]) : [];
        $out = [];
        foreach ($now + $before as $p => $_) if (($now[$p] ?? null) !== ($before[$p] ?? null)) $out[] = $p;
        sort($out);
        return $out;
    }

    // ---------------- control, for the tests ----------------

    public function control(): array
    {
        return (array) json_decode((string) @file_get_contents("$this->dir/control.json"), true);
    }

    public function setControl(array $values): void
    {
        file_put_contents("$this->dir/control.json", json_encode($values + $this->control()));
    }

    /** Commits directly on the branch, like someone pushing. $files: path => bytes or null. */
    public function push(array $files, string $message = 'push', string $author = 'someone'): string
    {
        $map = $this->files();
        foreach ($files as $path => $bytes) {
            if ($bytes === null) unset($map[$path]); else $map[$path] = $this->putBlob($bytes);
        }
        $head = $this->head();
        $date = gmdate('Y-m-d\TH:i:s\Z');
        $sha = $this->putCommit([
            'tree' => $this->putTree($map), 'parents' => $head !== '' ? [$head] : [], 'message' => $message,
            'author' => ['name' => $author, 'email' => "$author@example.org", 'date' => $date],
            'committer' => ['name' => $author, 'email' => "$author@example.org", 'date' => $date],
        ]);
        $this->setHead($sha);
        $this->addRun($sha, $message);
        return $sha;
    }

    /** Fills the repository from a folder, in one commit. */
    public function seed(string $src, string $message = 'Ausgangsstand'): string
    {
        $files = [];
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($src, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if ($f->isFile()) $files[substr($f->getPathname(), strlen(rtrim($src, '/')) + 1)] = (string) file_get_contents($f->getPathname());
        }
        return $this->push($files, $message . ' [skip ci]', 'seed');
    }

    // ---------------- Actions ----------------

    public function runs(): array
    {
        $runs = (array) json_decode((string) @file_get_contents("$this->dir/runs.json"), true);
        $auto = $this->control()['autoRun'] ?? null;
        if ($auto) {
            foreach ($runs as &$r) {
                if (($r['status'] ?? '') === 'completed') continue;
                $age = time() - (int) $r['started'];
                if ($age >= (int) $auto) {
                    $r['status'] = 'completed';
                    $r['conclusion'] = $this->control()['autoConclusion'] ?? 'success';
                    $r['updated_at'] = gmdate('Y-m-d\TH:i:s\Z');
                } elseif ($age >= (int) $auto / 2) {
                    $r['status'] = 'in_progress';
                }
            }
            unset($r);
            $this->setRuns($runs);
        }
        return $runs;
    }

    public function setRuns(array $runs): void
    {
        file_put_contents("$this->dir/runs.json", json_encode(array_values($runs)));
    }

    /** $fields: status, conclusion, failed_job. Applied to the newest run of a commit, or the newest. */
    public function setRun(array $fields, ?string $commit = null): void
    {
        $runs = $this->runs();
        foreach ($runs as $i => $r) {
            if ($commit !== null && $r['head_sha'] !== $commit) continue;
            $runs[$i] = $fields + $r;
            break;
        }
        $this->setRuns($runs);
    }

    public function addRun(string $sha, string $message): void
    {
        if (strpos($message, '[skip ci]') !== false) return;
        $runs = $this->runs();
        $id = count($runs) + 1000;
        $now = gmdate('Y-m-d\TH:i:s\Z');
        array_unshift($runs, [
            'id' => $id, 'head_sha' => $sha, 'head_branch' => 'main', 'status' => 'queued', 'conclusion' => null,
            'html_url' => 'https://github.com/' . self::REPO . "/actions/runs/$id", 'created_at' => $now, 'updated_at' => $now, 'started' => time(),
        ]);
        $this->setRuns($runs);
    }
}

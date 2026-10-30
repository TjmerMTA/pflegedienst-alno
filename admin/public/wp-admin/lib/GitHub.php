<?php
// The repository is the source of truth; this is the only code that talks to it. Reads go through a
// cache keyed by git object ids, which never change. Every save is one commit made with the Git Data
// API, so several files (an image and the JSON using it) land together or not at all.
declare(strict_types=1);

final class GitHubError extends RuntimeException
{
    public int $status;
    public function __construct(int $status, string $message)
    {
        parent::__construct($message);
        $this->status = $status;
    }
}

final class ConflictError extends RuntimeException {}

final class GitHub
{
    const REPO = 'TjmerMTA/pflegedienst-alno';
    const BRANCH = 'main';
    const COMMITTER = ['name' => 'alno-admin-bot', 'email' => 'admin-bot@pflegedienst-alno.de'];

    private Store $store;
    private string $token;
    private string $api;
    private ?array $tree = null;
    private ?string $head = null;

    public function __construct(Store $store, string $token)
    {
        $this->store = $store;
        $this->token = $token;
        $this->api = rtrim(getenv('ALNO_GITHUB_API') ?: 'https://api.github.com', '/');
    }

    private function repoPath(string $path): string
    {
        return '/repos/' . self::REPO . $path;
    }

    /** Returns [status, body string, headers]. */
    private function send(string $method, string $path, ?string $body, array $headers): array
    {
        $headers = array_merge([
            'Accept: application/vnd.github+json',
            'Authorization: Bearer ' . $this->token,
            'X-GitHub-Api-Version: 2022-11-28',
            'User-Agent: alno-admin',
        ], $headers);
        if ($body !== null) $headers[] = 'Content-Type: application/json';
        $respHeaders = [];
        if (function_exists('curl_init')) {
            $c = curl_init($this->api . $path);
            curl_setopt_array($c, [
                CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $headers,
                CURLOPT_TIMEOUT => 60, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$respHeaders): int {
                    $p = strpos($line, ':');
                    if ($p !== false) $respHeaders[strtolower(substr($line, 0, $p))] = trim(substr($line, $p + 1));
                    return strlen($line);
                },
            ]);
            if ($body !== null) curl_setopt($c, CURLOPT_POSTFIELDS, $body);
            $resp = curl_exec($c);
            $status = (int) curl_getinfo($c, CURLINFO_RESPONSE_CODE);
            $error = curl_error($c);
            if ($resp === false) throw new GitHubError(0, 'GitHub nicht erreichbar: ' . $error);
            return [$status, (string) $resp, $respHeaders];
        }
        $ctx = stream_context_create(['http' => ['method' => $method, 'header' => implode("\r\n", $headers), 'content' => $body ?? '', 'ignore_errors' => true, 'timeout' => 60, 'follow_location' => 0]]);
        $resp = @file_get_contents($this->api . $path, false, $ctx);
        if ($resp === false) throw new GitHubError(0, 'GitHub nicht erreichbar');
        $status = 0;
        foreach ($http_response_header ?? [] as $line) {
            if (preg_match('/^HTTP\/\S+\s+(\d+)/', $line, $m)) $status = (int) $m[1];
            $p = strpos($line, ':');
            if ($p !== false) $respHeaders[strtolower(substr($line, 0, $p))] = trim(substr($line, $p + 1));
        }
        return [$status, $resp, $respHeaders];
    }

    private function fail(int $status, string $body, array $headers): GitHubError
    {
        $msg = json_decode($body, true)['message'] ?? '';
        if ($status === 401) return new GitHubError($status, 'Der GitHub-Token ist ungültig oder abgelaufen.');
        if ($status === 429 || ($status === 403 && (($headers['x-ratelimit-remaining'] ?? '') === '0' || isset($headers['retry-after'])))) return new GitHubError($status, 'GitHub-Limit erreicht. Bitte in einigen Minuten erneut versuchen.');
        return new GitHubError($status, "GitHub-Fehler $status" . ($msg !== '' ? ": $msg" : ''));
    }

    public function get(string $path): array
    {
        [$status, $body, $headers] = $this->send('GET', $this->repoPath($path), null, []);
        if ($status !== 200) throw $this->fail($status, $body, $headers);
        return (array) json_decode($body, true);
    }

    private function write(string $method, string $path, array $data): array
    {
        [$status, $body, $headers] = $this->send($method, $this->repoPath($path), json_encode($data), []);
        if ($status === 409 || ($status === 422 && $method === 'PATCH')) throw new ConflictError('Branch hat sich geändert');
        if ($status < 200 || $status >= 300) throw $this->fail($status, $body, $headers);
        return (array) json_decode($body, true);
    }

    /** Caches only save requests: one that cannot be written must not stop the work. */
    private function remember(string $key, string $data): void
    {
        try {
            $this->store->write($key, $data);
        } catch (RuntimeException $e) {
            $this->store->log(['event' => 'cache-failed', 'error' => $e->getMessage()]);
        }
    }

    /** GET with an ETag: an unchanged answer does not count against the rate limit. */
    private function getCached(string $path): array
    {
        $key = 'cache/http/' . sha1($path) . '.json';
        $cached = $this->store->readJson($key);
        [$status, $body, $headers] = $this->send('GET', $this->repoPath($path), null, $cached ? ['If-None-Match: ' . $cached['etag']] : []);
        if ($status === 304 && $cached) return $cached['data'];
        if ($status !== 200) throw $this->fail($status, $body, $headers);
        $data = (array) json_decode($body, true);
        if (!empty($headers['etag'])) $this->remember($key, (string) json_encode(['etag' => $headers['etag'], 'data' => $data]));
        return $data;
    }

    /** A blob of the token's repository can be created only with write access: that is the check. */
    public function verifyWriteAccess(): void
    {
        $this->write('POST', '/git/blobs', ['content' => 'alno-admin setup check', 'encoding' => 'utf-8']);
    }

    public function head(): string
    {
        if ($this->head === null) $this->head = $this->getCached('/git/ref/heads/' . self::BRANCH)['object']['sha'];
        return $this->head;
    }

    /** Path => ['sha' => blob, 'size' => bytes] of the branch head. */
    public function tree(): array
    {
        if ($this->tree !== null) return $this->tree;
        $head = $this->head();
        $key = "cache/trees/$head.json";
        $map = $this->store->readJson($key);
        if ($map === null) {
            $map = self::flatten($this->get("/git/trees/$head?recursive=1"));
            $this->remember($key, (string) json_encode($map));
        }
        return $this->tree = $map;
    }

    private static function flatten(array $tree): array
    {
        // A cut-off listing would make files look deleted.
        if (!empty($tree['truncated'])) throw new GitHubError(0, 'Das Repository ist zu groß für eine vollständige Dateiliste.');
        $map = [];
        foreach ($tree['tree'] ?? [] as $e) {
            if (($e['type'] ?? '') === 'blob') $map[$e['path']] = ['sha' => $e['sha'], 'size' => (int) ($e['size'] ?? 0)];
        }
        return $map;
    }

    public function blob(string $sha): string
    {
        if (!preg_match('/^[0-9a-f]{40}$/D', $sha)) throw new GitHubError(404, 'not found');
        $key = "cache/blobs/$sha";
        $cached = $this->store->read($key);
        if ($cached !== null) return $cached;
        $b = $this->get("/git/blobs/$sha");
        $data = (string) base64_decode(str_replace("\n", '', (string) ($b['content'] ?? '')));
        $this->remember($key, $data);
        return $data;
    }

    public function file(string $path): ?array
    {
        $e = $this->tree()[$path] ?? null;
        return $e ? ['sha' => $e['sha'], 'content' => $this->blob($e['sha'])] : null;
    }

    /** Files below a folder as path => entry. */
    public function under(string $prefix): array
    {
        $out = [];
        foreach ($this->tree() as $p => $e) {
            if (strncmp($p, $prefix, strlen($prefix)) === 0) $out[$p] = $e;
        }
        return $out;
    }

    /** One file as it was at a commit. */
    public function fileAt(string $path, string $ref): ?string
    {
        try {
            $c = $this->get('/contents/' . implode('/', array_map('rawurlencode', explode('/', $path))) . '?ref=' . rawurlencode($ref));
        } catch (GitHubError $e) {
            if ($e->status === 404) return null;
            throw $e;
        }
        // Above 1 MB /contents gives no content, only the blob's id.
        if (($c['content'] ?? '') === '' && !empty($c['sha']) && ($c['size'] ?? 0) > 0) return $this->blob((string) $c['sha']);
        return (string) base64_decode(str_replace("\n", '', (string) ($c['content'] ?? '')));
    }

    /** Forgets what this request has read: inside the write lock only the current branch counts. */
    public function refresh(): void
    {
        $this->head = null;
        $this->tree = null;
    }

    public function commits(?string $path, int $limit): array
    {
        $q = 'sha=' . self::BRANCH . "&per_page=$limit" . ($path !== null ? '&path=' . rawurlencode($path) : '');
        return array_map(static fn (array $c) => [
            'hash' => $c['sha'], 'author' => $c['commit']['author']['name'] ?? '', 'date' => $c['commit']['author']['date'] ?? '',
            'subject' => strtok((string) ($c['commit']['message'] ?? ''), "\n"),
        ], $this->getCached("/commits?$q"));
    }

    /** File names of a commit; a commit never changes, so this is cached for good. */
    public function commitFiles(string $sha): array
    {
        $key = "cache/commits/$sha.json";
        $cached = $this->store->readJson($key);
        if ($cached !== null) return $cached;
        $files = array_column($this->get("/commits/$sha")['files'] ?? [], 'filename');
        $this->remember($key, (string) json_encode($files));
        return $files;
    }

    /**
     * Makes one commit on the branch. $files: path => bytes, or null to delete. $expected: path =>
     * blob sha the file must still have (null: must not exist). Throws ConflictError if it has not.
     * Returns the new commit sha.
     */
    public function commit(array $files, string $message, string $author, array $expected = []): string
    {
        for ($attempt = 0; ; $attempt++) {
            [$status, $body, $headers] = $this->send('GET', $this->repoPath('/git/ref/heads/' . self::BRANCH), null, []);
            if ($status !== 200) throw $this->fail($status, $body, $headers);
            $head = json_decode($body, true)['object']['sha'];
            $this->head = $head;
            $this->tree = null;
            $current = $this->tree();
            foreach ($expected as $path => $sha) {
                if (($current[$path]['sha'] ?? null) !== $sha) throw new ConflictError($path);
            }
            $entries = [];
            foreach ($files as $path => $content) {
                if ($content === null) {
                    if (isset($current[$path])) $entries[] = ['path' => $path, 'mode' => '100644', 'type' => 'blob', 'sha' => null];
                    continue;
                }
                $blob = $this->write('POST', '/git/blobs', ['content' => base64_encode($content), 'encoding' => 'base64']);
                $entries[] = ['path' => $path, 'mode' => '100644', 'type' => 'blob', 'sha' => $blob['sha']];
            }
            $baseTree = $this->get("/git/commits/$head")['tree']['sha'];
            $tree = $this->write('POST', '/git/trees', ['base_tree' => $baseTree, 'tree' => $entries]);
            $now = gmdate('Y-m-d\TH:i:s\Z');
            $commit = $this->write('POST', '/git/commits', [
                'message' => $message, 'tree' => $tree['sha'], 'parents' => [$head],
                'author' => ['name' => $author, 'email' => "$author@users.pflegedienst-alno.de", 'date' => $now],
                'committer' => self::COMMITTER + ['date' => $now],
            ]);
            try {
                $this->write('PATCH', '/git/refs/heads/' . self::BRANCH, ['sha' => $commit['sha'], 'force' => false]);
            } catch (ConflictError $e) {
                // Someone pushed in between: start again from the new head.
                if ($attempt >= 2) throw $e;
                continue;
            }
            $this->head = $commit['sha'];
            $this->tree = null;
            return $commit['sha'];
        }
    }

    // ---------------- Actions ----------------

    /** What happened to one commit: queued | running | done | failed | superseded. */
    public function runOf(string $commit): array
    {
        $runs = $this->getCached('/actions/runs?head_sha=' . rawurlencode($commit) . '&per_page=5')['workflow_runs'] ?? [];
        if (!$runs) return ['state' => 'queued', 'url' => null];
        return self::describeRun($runs[0], $this);
    }

    /** The newest run on the branch, and the newest finished one. */
    public function latestRuns(): array
    {
        $runs = $this->getCached('/actions/runs?branch=' . self::BRANCH . '&per_page=10')['workflow_runs'] ?? [];
        $latest = $runs ? self::describeRun($runs[0], $this) : null;
        $finished = null;
        foreach ($runs as $r) {
            if (($r['status'] ?? '') === 'completed' && ($r['conclusion'] ?? '') !== 'cancelled') { $finished = $r === $runs[0] ? $latest : self::describeRun($r, $this); break; }
        }
        return ['latest' => $latest, 'finished' => $finished];
    }

    private static function describeRun(array $r, self $gh): array
    {
        $base = ['url' => $r['html_url'] ?? null, 'at' => $r['updated_at'] ?? ($r['created_at'] ?? null), 'commit' => $r['head_sha'] ?? null, 'id' => $r['id'] ?? null];
        $status = $r['status'] ?? '';
        if ($status !== 'completed') return ['state' => $status === 'in_progress' ? 'running' : 'queued'] + $base;
        $c = $r['conclusion'] ?? '';
        if ($c === 'success') return ['state' => 'done'] + $base;
        if ($c === 'cancelled' || $c === 'skipped') return ['state' => 'superseded'] + $base;
        $phase = 'build';
        foreach ($gh->get("/actions/runs/{$r['id']}/jobs")['jobs'] ?? [] as $job) {
            if (($job['conclusion'] ?? '') === 'failure' && stripos((string) $job['name'], 'deploy') !== false) $phase = 'deploy';
        }
        return ['state' => 'failed', 'phase' => $phase] + $base;
    }
}

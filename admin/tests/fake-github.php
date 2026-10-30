<?php
// Router for `php -S`: the part of the GitHub REST API the admin uses, on a FakeGit. State lives in
// FAKE_GH_DIR. Behaves like GitHub where it matters to the admin: 422 on a non-fast-forward ref
// update and on a tree that deletes a missing path, 401 and 403 for tokens, ETag and 304.
//
// control.json (set through FakeGit::setControl):
//   tokens          token => 'write' | 'read'; default good-token => write, read-token => read
//   raceOnPatch     n: the next n ref updates lose a race against another push
//   raceFiles       path => bytes that push changes; default one new file of its own
//   failRoute       ['GET /git/trees' => 500]: answers that status for routes starting with this
//   rateLimited     true: every request answers 403 with x-ratelimit-remaining: 0
//   autoRun         seconds: new runs go queued → in_progress → completed by themselves
//   autoConclusion  how they end, default success
declare(strict_types=1);

require __DIR__ . '/fakegit.php';

$git = new FakeGit((string) getenv('FAKE_GH_DIR'));
$lock = fopen("$git->dir/lock", 'c');
flock($lock, LOCK_EX);

function answer(int $status, $data, array $headers = []): void
{
    $body = json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $etag = 'W/"' . sha1((string) $body) . '"';
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    foreach ($headers as $h) header($h);
    if ($status === 200 && $_SERVER['REQUEST_METHOD'] === 'GET') {
        header("ETag: $etag");
        if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) { http_response_code(304); exit; }
    }
    echo $body;
    exit;
}

function refuse(int $status, string $message): void
{
    answer($status, ['message' => $message, 'documentation_url' => 'https://docs.github.com/rest']);
}

$method = $_SERVER['REQUEST_METHOD'];
$uri = (string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
parse_str((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_QUERY), $q);
$control = $git->control();

// The request log lets a test count what the admin really sends.
file_put_contents("$git->dir/requests.log", "$method {$_SERVER['REQUEST_URI']}\n", FILE_APPEND);

$tokens = $control['tokens'] ?? ['good-token' => 'write', 'read-token' => 'read'];
$token = preg_replace('/^Bearer /', '', (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? ''));
if (!isset($tokens[$token])) refuse(401, 'Bad credentials');
if (!empty($control['rateLimited'])) { header('x-ratelimit-remaining: 0'); refuse(403, 'API rate limit exceeded'); }

$base = '/repos/' . FakeGit::REPO;
if (strncmp($uri, "$base/", strlen($base) + 1) !== 0) refuse(404, 'Not Found');
$path = substr($uri, strlen($base));

foreach ($control['failRoute'] ?? [] as $prefix => $status) {
    if (strncmp("$method $path", $prefix, strlen($prefix)) === 0) refuse((int) $status, 'forced failure');
}
if ($method !== 'GET' && $tokens[$token] !== 'write') refuse(403, 'Resource not accessible by personal access token');

$input = (array) json_decode((string) file_get_contents('php://input'), true);

$commitOut = static function (array $c) {
    return ['sha' => $c['sha'], 'commit' => ['message' => $c['message'], 'author' => $c['author'], 'committer' => $c['committer'], 'tree' => ['sha' => $c['tree']]], 'parents' => array_map(static fn ($p) => ['sha' => $p], $c['parents'])];
};
$resolve = static function (string $ref) use ($git): ?array {
    if ($ref === 'main') return $git->commit($git->head());
    if (preg_match('/^[0-9a-f]{40}$/D', $ref)) return $git->commit($ref);
    if (preg_match('/^[0-9a-f]{7,39}$/D', $ref)) {
        foreach (glob("$git->dir/commits/$ref*.json") ?: [] as $f) return $git->commit(basename($f, '.json'));
    }
    return null;
};
$under = static function (array $map, string $p): array {
    return array_filter($map, static fn ($k) => $k === $p || strncmp((string) $k, "$p/", strlen($p) + 1) === 0, ARRAY_FILTER_USE_KEY);
};

if ($method === 'GET' && $path === '/git/ref/heads/main') answer(200, ['ref' => 'refs/heads/main', 'object' => ['sha' => $git->head(), 'type' => 'commit']]);

if ($method === 'PATCH' && $path === '/git/refs/heads/main') {
    if (($control['raceOnPatch'] ?? 0) > 0) {
        $git->setControl(['raceOnPatch' => $control['raceOnPatch'] - 1]);
        $git->push($control['raceFiles'] ?? ['fremd-' . count(glob("$git->dir/commits/*")) . '.txt' => 'pushed in between'], 'Someone else');
    }
    $sha = (string) ($input['sha'] ?? '');
    $c = $git->commit($sha);
    if (!$c) refuse(422, 'Object does not exist');
    $head = $git->head();
    $walk = $c;
    $ff = false;
    while ($walk) {
        if ($walk['sha'] === $head) { $ff = true; break; }
        $walk = $walk['parents'] ? $git->commit($walk['parents'][0]) : null;
    }
    if (!$ff && empty($input['force'])) refuse(422, 'Update is not a fast forward');
    $git->setHead($sha);
    $git->addRun($sha, $c['message']);
    answer(200, ['ref' => 'refs/heads/main', 'object' => ['sha' => $sha, 'type' => 'commit']]);
}

if (preg_match('#^/git/trees/([0-9a-f]{40})$#D', $path, $m) && $method === 'GET') {
    $c = $git->commit($m[1]);
    $map = $git->tree($c ? $c['tree'] : $m[1]);
    if ($map === null) refuse(404, 'Not Found');
    $tree = [];
    foreach ($map as $p => $sha) $tree[] = ['path' => $p, 'mode' => '100644', 'type' => 'blob', 'sha' => $sha, 'size' => strlen((string) $git->blob($sha))];
    foreach (array_unique(array_map(static fn ($p) => dirname((string) $p), array_keys($map))) as $d) {
        if ($d !== '.') $tree[] = ['path' => $d, 'mode' => '040000', 'type' => 'tree', 'sha' => sha1($d)];
    }
    answer(200, ['sha' => $m[1], 'tree' => $tree, 'truncated' => false]);
}

if ($method === 'POST' && $path === '/git/trees') {
    $map = $git->tree((string) ($input['base_tree'] ?? ''));
    if ($map === null) refuse(422, 'Invalid tree info');
    if (empty($input['tree'])) refuse(422, 'Invalid tree info');
    foreach ($input['tree'] as $e) {
        if (!array_key_exists('sha', $e)) refuse(422, 'Must supply a valid tree.sha or tree.content');
        if ($e['sha'] === null) {
            if (!isset($map[$e['path']])) refuse(422, 'GitRPC::BadObjectState');
            unset($map[$e['path']]);
        } else {
            if ($git->blob($e['sha']) === null) refuse(422, 'tree.sha ' . $e['sha'] . ' is not a valid blob');
            $map[$e['path']] = $e['sha'];
        }
    }
    answer(201, ['sha' => $git->putTree($map)]);
}

if (preg_match('#^/git/blobs/([0-9a-f]{40})$#D', $path, $m) && $method === 'GET') {
    $b = $git->blob($m[1]);
    if ($b === null) refuse(404, 'Not Found');
    answer(200, ['sha' => $m[1], 'size' => strlen($b), 'encoding' => 'base64', 'content' => chunk_split(base64_encode($b), 60, "\n")]);
}

if ($method === 'POST' && $path === '/git/blobs') {
    $content = (string) ($input['content'] ?? '');
    $bytes = ($input['encoding'] ?? 'utf-8') === 'base64' ? (string) base64_decode($content, true) : $content;
    answer(201, ['sha' => $git->putBlob($bytes)]);
}

if (preg_match('#^/git/commits/([0-9a-f]{40})$#D', $path, $m) && $method === 'GET') {
    $c = $git->commit($m[1]);
    if (!$c) refuse(404, 'Not Found');
    answer(200, ['sha' => $c['sha'], 'tree' => ['sha' => $c['tree']], 'message' => $c['message'], 'author' => $c['author'], 'committer' => $c['committer'], 'parents' => array_map(static fn ($p) => ['sha' => $p], $c['parents'])]);
}

if ($method === 'POST' && $path === '/git/commits') {
    if ($git->tree((string) ($input['tree'] ?? '')) === null) refuse(422, 'Tree SHA does not exist');
    $sha = $git->putCommit(['tree' => $input['tree'], 'parents' => $input['parents'] ?? [], 'message' => $input['message'] ?? '', 'author' => $input['author'] ?? [], 'committer' => $input['committer'] ?? []]);
    answer(201, ['sha' => $sha]);
}

if ($method === 'GET' && $path === '/commits') {
    $c = $resolve((string) ($q['sha'] ?? 'main'));
    $filter = isset($q['path']) ? (string) $q['path'] : null;
    $out = [];
    $limit = (int) ($q['per_page'] ?? 30);
    while ($c && count($out) < $limit) {
        $parent = $c['parents'] ? $git->commit($c['parents'][0]) : null;
        $now = (array) $git->tree($c['tree']);
        $before = $parent ? (array) $git->tree($parent['tree']) : [];
        if ($filter === null || $under($now, $filter) !== $under($before, $filter)) $out[] = $commitOut($c);
        $c = $parent;
    }
    answer(200, $out);
}

if (preg_match('#^/commits/([0-9a-f]{7,40})$#D', $path, $m) && $method === 'GET') {
    $c = $resolve($m[1]);
    if (!$c) refuse(404, 'Not Found');
    $now = (array) $git->tree($c['tree']);
    $parent = $c['parents'] ? $git->commit($c['parents'][0]) : null;
    $before = $parent ? (array) $git->tree($parent['tree']) : [];
    $files = [];
    foreach ($now + $before as $p => $_) if (($now[$p] ?? null) !== ($before[$p] ?? null)) $files[] = ['filename' => $p];
    answer(200, $commitOut($c) + ['files' => $files]);
}

if (strncmp($path, '/contents/', 10) === 0 && $method === 'GET') {
    $c = $resolve((string) ($q['ref'] ?? 'main'));
    if (!$c) refuse(404, 'No commit found for the ref');
    $p = rawurldecode(substr($path, 10));
    $sha = ((array) $git->tree($c['tree']))[$p] ?? null;
    if (!$sha) refuse(404, 'Not Found');
    answer(200, ['type' => 'file', 'path' => $p, 'sha' => $sha, 'encoding' => 'base64', 'content' => chunk_split(base64_encode((string) $git->blob($sha)), 60, "\n")]);
}

if ($method === 'GET' && $path === '/actions/runs') {
    $runs = $git->runs();
    if (isset($q['head_sha'])) $runs = array_filter($runs, static fn ($r) => $r['head_sha'] === $q['head_sha']);
    if (isset($q['branch'])) $runs = array_filter($runs, static fn ($r) => $r['head_branch'] === $q['branch']);
    $runs = array_values($runs);
    answer(200, ['total_count' => count($runs), 'workflow_runs' => array_slice($runs, 0, (int) ($q['per_page'] ?? 30))]);
}

if (preg_match('#^/actions/runs/(\d+)/jobs$#D', $path, $m) && $method === 'GET') {
    foreach ($git->runs() as $r) {
        if ((string) $r['id'] !== $m[1]) continue;
        $failed = $r['failed_job'] ?? 'build';
        answer(200, ['total_count' => 2, 'jobs' => [
            ['name' => 'build', 'conclusion' => $failed === 'build' ? 'failure' : 'success'],
            ['name' => 'deploy', 'conclusion' => $failed === 'deploy' ? 'failure' : ($failed === 'build' ? 'skipped' : 'success')],
        ]]);
    }
    refuse(404, 'Not Found');
}

refuse(404, 'Not Found');

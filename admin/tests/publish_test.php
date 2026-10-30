<?php
// What replaced the Node publisher (local build queue, status file, fake deploy): a save is a commit,
// the job id is its sha, and GitHub Actions says what became of it. Port of publish.test.mjs and the
// build/deploy parts of flow.test.mjs, plus the failure modes of talking to GitHub.
declare(strict_types=1);
require_once __DIR__ . '/harness.php';

$e = new Env();
$c = $e->as('redakteurin');
$n = 0;
$save = function () use ($c, &$n): string {
    $n++;
    $r = savePage($c, 'index', function (array &$v) use ($n) { $v['hero']['pill'] = "Stand $n"; });
    eq($r['status'], 200, $r['body']);
    return $r['json']['job'];
};
$status = static fn (string $sha) => $c->get('status', ['commit' => $sha]);

test('a new commit is queued: the job id is the commit sha', function () use ($e, $save, $status) {
    $job = $save();
    eq($job, $e->git->head());
    $s = $status($job)['json'];
    eq($s['state'], 'queued');
    eq($s['commit'], $job);
    has((string) $s['url'], 'github.com/' . FakeGit::REPO . '/actions/runs/');
});

test('GitHub has not made a run yet: still queued, no error', function () use ($e, $save, $status) {
    $job = $save();
    $e->git->setRuns(array_values(array_filter($e->git->runs(), static fn ($r) => $r['head_sha'] !== $job)));
    $s = $status($job);
    eq($s['status'], 200);
    eq($s['json'], ['state' => 'queued', 'url' => null]);
});

test('in_progress is running', function () use ($e, $save, $status) {
    $job = $save();
    $e->git->setRun(['status' => 'in_progress'], $job);
    eq($status($job)['json']['state'], 'running');
});

test('success is done', function () use ($e, $save, $status) {
    $job = $save();
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'success'], $job);
    eq($status($job)['json']['state'], 'done');
});

test('failure in the build job: failed, phase build', function () use ($e, $save, $status) {
    $job = $save();
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'failure', 'failed_job' => 'build'], $job);
    $s = $status($job)['json'];
    eq($s['state'], 'failed');
    eq($s['phase'], 'build');
    ok($s['url']);
});

test('failure in the deploy job: failed, phase deploy', function () use ($e, $save, $status) {
    $job = $save();
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'failure', 'failed_job' => 'deploy'], $job);
    $s = $status($job)['json'];
    eq($s['state'], 'failed');
    eq($s['phase'], 'deploy');
});

test('timed_out counts as failed', function () use ($e, $save, $status) {
    $job = $save();
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'timed_out', 'failed_job' => 'build'], $job);
    eq($status($job)['json']['state'], 'failed');
});

test('a cancelled run was replaced: the latest run is reported', function () use ($e, $save, $status) {
    $old = $save();
    $new = $save();
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'cancelled'], $old);
    $e->git->setRun(['status' => 'in_progress'], $new);
    $s = $status($old)['json'];
    eq($s['state'], 'running');
    eq($s['commit'], $new);
});

test('the replacing run\'s failure keeps its phase', function () use ($e, $save, $status) {
    $old = $save();
    $new = $save();
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'cancelled'], $old);
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'failure', 'failed_job' => 'deploy'], $new);
    $s = $status($old)['json'];
    eq($s['state'], 'failed');
    eq($s['phase'], 'deploy');
    eq($s['commit'], $new);
});

test('the dashboard names the failed phase too', function () use ($e, $c, $save) {
    $job = $save();
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'failure', 'failed_job' => 'deploy'], $job);
    $runs = $c->get('dashboard')['json']['runs'];
    eq($runs['latest']['phase'], 'deploy');
    eq($runs['finished']['phase'], 'deploy');
});

test('a cancelled run with nothing newer stays superseded', function () use ($e, $save, $status) {
    $job = $save();
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'cancelled'], $job);
    eq($status($job)['json']['state'], 'superseded');
});

test('a skipped run counts like a cancelled one', function () use ($e, $save, $status) {
    $old = $save();
    $new = $save();
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'skipped'], $old);
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'success'], $new);
    eq($status($old)['json']['state'], 'done');
});

test('an unknown commit is not an error page', function () use ($c, $status) {
    $s = $status(str_repeat('a', 40));
    eq($s['status'], 200, $s['body']);
    eq($s['json'], ['state' => 'queued', 'url' => null]);
    foreach (['../x', 'HEAD', 'abc', str_repeat('g', 40)] as $bad) eq($status($bad)['status'], 404, $bad);
});

test('without a commit: latest run and latest finished run', function () use ($e, $c, $save) {
    $done = $save();
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'success'], $done);
    $cancelled = $save();
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'cancelled'], $cancelled);
    $running = $save();
    $e->git->setRun(['status' => 'in_progress'], $running);
    $s = $c->get('status')['json'];
    eq($s['latest']['state'], 'running');
    eq($s['latest']['commit'], $running);
    eq($s['finished']['state'], 'done');
    eq($s['finished']['commit'], $done);
});

test('the session reports the state of the latest run', function () use ($e, $c, $save) {
    $job = $save();
    eq($c->get('session')['json']['status'], ['state' => 'queued', 'failed' => false]);
    $e->git->setRun(['status' => 'in_progress'], $job);
    eq($c->get('session')['json']['status'], ['state' => 'running', 'failed' => false]);
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'failure'], $job);
    eq($c->get('session')['json']['status'], ['state' => 'idle', 'failed' => true]);
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'success'], $job);
    eq($c->get('session')['json']['status'], ['state' => 'idle', 'failed' => false]);
});

test('the change is kept after a failed build, and the next save publishes', function () use ($e, $c, $save, $status) {
    $job = $save();
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'failure'], $job);
    has((string) $e->git->read('src/content/pages/index.json'), 'Stand');
    $next = $save();
    eq($status($next)['json']['state'], 'queued');
    $e->git->setRun(['status' => 'completed', 'conclusion' => 'success'], $next);
    eq($c->get('dashboard')['json']['runs']['latest']['state'], 'done');
});

test('a run going through by itself: queued, running, done', function () use ($e, $save, $status) {
    $e->git->setControl(['autoRun' => 2]);
    $job = $save();
    eq($status($job)['json']['state'], 'queued');
    $run = array_values(array_filter($e->git->runs(), static fn ($r) => $r['head_sha'] === $job))[0];
    $e->git->setRun(['started' => time() - 1], $job);
    eq($status($job)['json']['state'], 'running');
    $e->git->setRun(['started' => time() - 3], $job);
    eq($status($job)['json']['state'], 'done');
    $e->git->setControl(['autoRun' => null]);
});

test('polling an unchanged run costs no rate limit: it goes by ETag', function () use ($e, $save, $status) {
    $job = $save();
    $status($job);
    $key = 'cache/http/' . sha1('/actions/runs?head_sha=' . $job . '&per_page=5') . '.json';
    ok($e->store->exists($key), 'answer cached');
    eq($status($job)['json']['state'], 'queued', 'the 304 is served from the cache');
});

test('a damaged cache does not block saving', function () use ($e, $c, $save) {
    foreach (glob("$e->data/cache/http/*.json") ?: [] as $f) file_put_contents($f, '{ kaputt');
    foreach (glob("$e->data/cache/trees/*.json") ?: [] as $f) file_put_contents($f, '{ kaputt');
    $job = $save();
    eq($c->get('status', ['commit' => $job])['json']['state'], 'queued');
});

test('a cache that cannot be written does not stop reading or saving', function () {
    $x = new Env();
    $c = $x->as('redakteurin');
    rmTree("$x->data/cache");
    file_put_contents("$x->data/cache", 'kein Ordner');
    $r = $c->get('page', ['id' => 'index']);
    eq($r['status'], 200, $r['body']);
    $s = savePage($c, 'index', function (array &$v) { $v['hero']['pill'] = 'Ohne Cache'; });
    eq($s['status'], 200, $s['body']);
    has((string) $x->git->read('src/content/pages/index.json'), 'Ohne Cache');
    $x->stop();
});

// ---------------- when GitHub does not play along ----------------

/** Every failure is JSON with a message a person can read; nothing of the server shows. */
function clearError(array $r, string $message, string $what): void
{
    eq($r['status'], 502, "$what: {$r['body']}");
    eq($r['json']['error'] ?? null, 'github', $what);
    has($r['json']['message'], $message, $what);
    foreach (['.php', 'Stack trace', '#0', 'Fatal', TEST_TOKEN, 'Bearer'] as $bad) hasNot($r['body'], $bad, $what);
}

$routes = static function (Client $c): array {
    return [
        'dashboard' => $c->get('dashboard'), 'pages' => $c->get('pages'), 'page' => $c->get('page', ['id' => 'index']), 'entries' => $c->get('entries', ['type' => 'post']),
        'media' => $c->get('media'), 'status' => $c->get('status'), 'status of a commit' => $c->get('status', ['commit' => str_repeat('b', 40)]), 'revisions' => $c->get('revisions'),
        'save' => $c->post('page', ['id' => 'index', 'hash' => 'x', 'values' => []]),
    ];
};

test('GitHub rate limited: a clear error on every route', function () use ($routes) {
    $x = new Env();
    $c = $x->as('redakteurin');
    $x->git->setControl(['rateLimited' => true]);
    foreach ($routes($c) as $what => $r) clearError($r, 'GitHub-Limit erreicht', $what);
    $x->stop();
});

test('the token revoked: a clear error on every route', function () use ($routes) {
    $x = new Env();
    $c = $x->as('redakteurin');
    $x->store->writeJson('config.json', ['token' => 'widerrufen'] + (array) $x->store->readJson('config.json'));
    foreach ($routes($c) as $what => $r) clearError($r, 'GitHub-Token ist ungültig', $what);
    hasNot($x->log(), 'widerrufen');
    $x->stop();
});

test('GitHub down: a clear error on every route, the session still answers', function () use ($routes) {
    $x = new Env();
    $c = $x->as('redakteurin');
    $x->gh->stop();
    foreach ($routes($c) as $what => $r) clearError($r, 'GitHub nicht erreichbar', $what);
    $s = $c->get('session');
    eq($s['status'], 200, $s['body']);
    eq($s['json']['user'], 'redakteurin');
    eq($s['json']['status']['unknown'], true);
    eq($s['json']['pages'], []);
    has($x->log(), '"event":"github-error"');
    hasNot($x->log(), TEST_TOKEN);
    $x->stop();
});

test('GitHub answering 500 on a commit step: the branch stays, the error is clear', function () {
    $x = new Env();
    $c = $x->as('redakteurin');
    foreach (['POST /git/blobs', 'POST /git/trees', 'POST /git/commits', 'PATCH /git/refs'] as $step) {
        $head = $x->git->head();
        $x->git->setControl(['failRoute' => [$step => 500]]);
        $r = savePage($c, 'index', function (array &$v) use ($step) { $v['hero']['pill'] = "Scheitert $step"; });
        clearError($r, 'GitHub-Fehler 500', $step);
        eq($x->git->head(), $head, $step);
        hasNot((string) $x->git->read('src/content/pages/index.json'), 'Scheitert');
    }
    $x->git->setControl(['failRoute' => []]);
    eq(savePage($c, 'index', function (array &$v) { $v['hero']['pill'] = 'Wieder gut'; })['status'], 200, 'works again');
    $x->stop();
});

test('the jobs of a run cannot be read: an error, not a wrong state', function () {
    $x = new Env();
    $c = $x->as('redakteurin');
    $job = savePage($c, 'index', function (array &$v) { $v['hero']['pill'] = 'x'; })['json']['job'];
    $x->git->setRun(['status' => 'completed', 'conclusion' => 'failure'], $job);
    $x->git->setControl(['failRoute' => ['GET /actions/runs/' => 503]]);
    clearError($c->get('status', ['commit' => $job]), 'GitHub-Fehler 503', 'jobs');
    $x->stop();
});

test('the token is in no response and no log of a normal day', function () use ($e, $c, $save) {
    $save();
    foreach (['session', 'dashboard', 'pages', 'media', 'revisions', 'status', 'users', 'anfragen'] as $route) {
        hasNot($e->as('admin')->get($route)['body'], TEST_TOKEN, $route);
    }
    hasNot($e->log(), TEST_TOKEN);
    foreach (glob("$e->data/cache/http/*.json") ?: [] as $f) hasNot((string) file_get_contents($f), TEST_TOKEN);
});
finish();

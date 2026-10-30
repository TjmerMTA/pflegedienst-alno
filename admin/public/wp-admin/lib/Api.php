<?php
// The JSON API of the admin (documented in admin/API.md). Every request comes through api.php.
declare(strict_types=1);

final class HttpError extends RuntimeException
{
    public int $status;
    public string $code_;
    public array $extra;
    public function __construct(int $status, string $code, string $message = '', array $extra = [])
    {
        parent::__construct($message);
        $this->status = $status;
        $this->code_ = $code;
        $this->extra = $extra;
    }
}

final class Api
{
    const SESSION_COOKIE = 'alno_session';
    const LOGIN_COOKIE = 'alno_login';
    const DEVICE_COOKIE = 'alno_device';
    const COOKIE_PATH = '/';
    const ADMIN_HOST = 'admin.pflegedienst-alno.de';
    const SITE_URL = 'https://pflegedienst-alno.de';

    private Store $store;
    private Auth $auth;
    private ?array $config;
    private ?GitHub $gh = null;
    private ?Site $site = null;
    private ?array $user = null;

    public function __construct()
    {
        $this->store = new Store();
        $this->auth = new Auth($this->store);
        $this->config = $this->store->readJson('config.json');
        if ($this->config) {
            $this->gh = new GitHub($this->store, $this->config['token']);
            $this->site = new Site($this->gh, $this->store);
        }
    }

    // ---------------- output ----------------

    private static function headers(): void
    {
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: same-origin');
        header('Cross-Origin-Resource-Policy: same-origin');
        header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
        header('Cache-Control: no-store');
    }

    private static function json(int $status, array $data): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    }

    // ---------------- request ----------------

    private static function host(): string
    {
        return strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
    }

    private static function isLocal(): bool
    {
        return preg_match('/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/D', self::host()) === 1;
    }

    private function hostAllowed(): bool
    {
        if (self::isLocal()) return true;
        return in_array(self::host(), $this->config['hosts'] ?? [self::ADMIN_HOST], true);
    }

    private static function originOk(): bool
    {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
        if ($origin === 'null') return false;
        $v = $origin ?? ($_SERVER['HTTP_REFERER'] ?? null);
        if ($v === null) return true;
        $p = parse_url($v);
        $h = strtolower(($p['host'] ?? '') . (isset($p['port']) ? ":{$p['port']}" : ''));
        return $h === self::host();
    }

    private static function secureCookie(): bool
    {
        return !self::isLocal() || (($_SERVER['HTTPS'] ?? '') !== '' && ($_SERVER['HTTPS'] ?? '') !== 'off');
    }

    /**
     * Host-only by name: the browser refuses a __Host- cookie that has a Domain, a path other than /
     * or no Secure, so the public site next door can neither read these nor plant one here. It needs
     * HTTPS, so local development uses the plain name.
     */
    private static function cookieName(string $name): string
    {
        return self::secureCookie() ? "__Host-$name" : $name;
    }

    private static function readJson(int $limit = Rules::FORM_MAX_BYTES): array
    {
        $type = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? ''))[0]));
        if ($type !== 'application/json') throw new HttpError(415, 'bad_request', 'Falscher Inhaltstyp');
        if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $limit) throw new HttpError(413, 'too_large', 'Anfrage zu groß');
        $raw = (string) stream_get_contents(fopen('php://input', 'r'), $limit + 1);
        if (strlen($raw) > $limit) throw new HttpError(413, 'too_large', 'Anfrage zu groß');
        $data = json_decode($raw, true, 32);
        if (!is_array($data) || ($data !== [] && array_is_list($data))) throw new HttpError(400, 'bad_request', 'Ungültige Daten');
        return $data;
    }

    private static function setCookie(string $name, string $value, int $maxAge): void
    {
        setcookie(self::cookieName($name), $value, ['expires' => $maxAge ? time() + $maxAge : 1, 'path' => self::COOKIE_PATH, 'httponly' => true, 'samesite' => 'Strict', 'secure' => self::secureCookie()]);
    }

    private static function clientIp(): string
    {
        return (string) ($_SERVER['REMOTE_ADDR'] ?? '?');
    }

    // ---------------- session ----------------

    private function sessionSetup(): void
    {
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        session_cache_limiter('');
        ini_set('session.gc_maxlifetime', (string) (Auth::SESSION_IDLE * 2));
        session_name(self::cookieName(self::SESSION_COOKIE));
        if (!is_dir($this->store->path('sessions'))) @mkdir($this->store->path('sessions'), 0700, true);
        session_save_path($this->store->path('sessions'));
        session_set_cookie_params(['lifetime' => 0, 'path' => self::COOKIE_PATH, 'httponly' => true, 'samesite' => 'Strict', 'secure' => self::secureCookie()]);
    }

    /** Loads the user of the session cookie, without keeping the session locked. */
    private function loadSession(): void
    {
        // Only a session this server made: PHP would answer a made-up id with a new file.
        $sid = (string) ($_COOKIE[self::cookieName(self::SESSION_COOKIE)] ?? '');
        if (!preg_match('/^[a-zA-Z0-9,-]{22,256}$/D', $sid) || !$this->store->exists("sessions/sess_$sid")) return;
        $this->sessionSetup();
        session_start(['read_and_close' => true]);
        $s = $_SESSION;
        if (empty($s['user'])) return;
        $u = $this->auth->users()[$s['user']] ?? null;
        $idle = time() - (int) ($s['seen'] ?? 0);
        if (!$u || (int) ($s['pwv'] ?? 0) !== (int) ($u['pwv'] ?? 1) || $idle > Auth::SESSION_IDLE) return;
        $this->user = ['name' => $s['user'], 'lang' => $u['lang'] ?? 'de', 'admin' => !empty($u['admin']), 'anfragen' => !empty($u['admin']) || !empty($u['anfragen']), 'csrf' => $s['csrf']];
        if ($idle > 60) {
            session_start();
            $_SESSION['seen'] = time();
            session_write_close();
        }
    }

    private function createSession(string $user): void
    {
        $this->sessionSetup();
        session_start();
        session_regenerate_id(true);
        $_SESSION = ['user' => $user, 'csrf' => rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '='), 'seen' => time(), 'pwv' => (int) ($this->auth->users()[$user]['pwv'] ?? 1)];
        session_write_close();
        foreach (glob($this->store->path('sessions/sess_*')) ?: [] as $f) {
            if (@filemtime($f) < time() - 2 * Auth::SESSION_IDLE) @unlink($f);
        }
    }

    /** One write at a time, each working from the branch as it is now, not as this request first read it. */
    private function writeLock(callable $fn)
    {
        return $this->store->withLock('write', function () use ($fn) {
            $this->gh->refresh();
            return $fn();
        });
    }

    private function needUser(): array
    {
        if (!$this->user) throw new HttpError(401, 'login');
        return $this->user;
    }

    private function needAdmin(): void
    {
        if (!$this->needUser()['admin']) throw new HttpError(403, 'forbidden');
    }

    private function needAnfragen(): void
    {
        if (!$this->needUser()['anfragen']) throw new HttpError(403, 'forbidden');
    }

    // ---------------- routing ----------------

    public function run(): void
    {
        self::headers();
        try {
            $this->route((string) ($_GET['r'] ?? ''), (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        } catch (HttpError $e) {
            self::json($e->status, ['error' => $e->code_, 'message' => $e->getMessage()] + $e->extra);
        } catch (ConflictError $e) {
            self::json(409, ['error' => 'conflict']);
        } catch (GitHubError $e) {
            $this->store->log(['event' => 'github-error', 'status' => $e->status, 'error' => $e->getMessage()]);
            self::json(502, ['error' => 'github', 'message' => $e->getMessage()]);
        } catch (FrontmatterError $e) {
            self::json(422, ['error' => 'unreadable', 'message' => $e->getMessage()]);
        } catch (Throwable $e) {
            $this->store->log(['event' => 'error', 'route' => (string) ($_GET['r'] ?? ''), 'error' => $e->getMessage() . ' @' . basename($e->getFile()) . ':' . $e->getLine()]);
            self::json(500, ['error' => 'server', 'message' => 'server']);
        }
    }

    private function route(string $r, string $method): void
    {
        if (!$this->hostAllowed()) throw new HttpError(421, 'bad_request', 'Host nicht erlaubt');
        // The public site is same-site with this host, so SameSite cookies do not tell them apart.
        if (in_array($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '', ['same-site', 'cross-site'], true)) throw new HttpError(403, 'forbidden', 'origin');
        if ($method === 'POST' && !self::originOk()) throw new HttpError(403, 'forbidden', 'origin');
        if (!$this->config) {
            if ($r === 'setup' && $method === 'POST') { $this->setup(); return; }
            if ($r === 'session' && $method === 'GET') { $this->sessionInfo(); return; }
            throw new HttpError(503, 'setup');
        }
        $this->loadSession();
        if ($method === 'POST') {
            if ($r === 'login') { $this->login(); return; }
            $u = $this->needUser();
            if (!hash_equals($u['csrf'], (string) ($_SERVER['HTTP_X_WP_NONCE'] ?? ''))) {
                $this->store->log(['event' => 'csrf-reject', 'user' => $u['name'], 'route' => $r]);
                throw new HttpError(403, 'forbidden', 'csrf');
            }
            if ($r === 'media/upload') { $this->upload(); return; }
            $b = self::readJson();
            switch ($r) {
                case 'logout': $this->logout(); return;
                case 'page': $this->savePage($b); return;
                case 'entry': $this->saveEntry($b); return;
                case 'entry/trash': $this->trashEntry($b); return;
                case 'entry/untrash': $this->fromTrash($b, false); return;
                case 'entry/delete': $this->fromTrash($b, true); return;
                case 'media/meta': $this->saveMediaMeta($b); return;
                case 'media/delete': $this->deleteMedia($b); return;
                case 'revisions/restore': $this->restoreRevision($b); return;
                case 'profile/lang': $this->setLang($b); return;
                case 'profile/password': $this->setPassword($b); return;
                case 'users/add': $this->addUser($b); return;
                case 'users/update': $this->updateUser($b); return;
                case 'users/delete': $this->deleteUser($b); return;
                case 'anfragen/status': $this->anfrageAct($b, 'status'); return;
                case 'anfragen/trash': $this->anfrageAct($b, 'trash'); return;
                case 'anfragen/restore': $this->anfrageAct($b, 'restore'); return;
                case 'anfragen/delete': $this->anfrageAct($b, 'delete'); return;
                case 'anfragen/retention': $this->setRetention($b); return;
            }
            throw new HttpError(404, 'not_found');
        }
        if ($method !== 'GET') throw new HttpError(405, 'bad_request');
        if ($r === 'session') { $this->sessionInfo(); return; }
        $this->needUser();
        $q = $_GET;
        switch ($r) {
            case 'dashboard': $this->dashboard(); return;
            case 'pages': self::json(200, ['pages' => $this->site->listPages()]); return;
            case 'page': $this->getPage((string) ($q['id'] ?? '')); return;
            case 'entries': $this->getEntries(); return;
            case 'entry': $this->getEntry(); return;
            case 'entry/new': $this->newEntry(); return;
            case 'media': $this->getMedia(); return;
            case 'media/item': $this->getMediaItem(); return;
            case 'media/file': $this->mediaFile(); return;
            case 'revisions': $this->getRevisions(); return;
            case 'revisions/file': $this->getRevisionFile(); return;
            case 'status': $this->status(); return;
            case 'users': $this->needAdmin(); self::json(200, ['users' => $this->auth->listUsers()]); return;
            case 'anfragen': $this->needAnfragen(); $this->anfragenList(); return;
            case 'anfragen/item': $this->needAnfragen(); $this->anfrageItem(); return;
            case 'anfragen/file': $this->needAnfragen(); $this->anfrageFile(); return;
        }
        throw new HttpError(404, 'not_found');
    }

    // ---------------- setup, login ----------------

    /** The data folder holds the token and the submissions: no URL may reach it. */
    private function dataExposed(): bool
    {
        foreach ([(string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), dirname(__DIR__, 2)] as $root) {
            if ($this->store->isInside($root) || $this->store->isInside(Store::outerWebRoot($root))) return true;
        }
        return false;
    }

    /** What the host offers, so that a missing extension is seen before anything fails. */
    private function checks(): array
    {
        $engine = Media::engine();
        return [
            'php' => PHP_VERSION, 'phpOk' => PHP_VERSION_ID >= 80200,
            'curl' => function_exists('curl_init') || (bool) ini_get('allow_url_fopen'), 'mbstring' => extension_loaded('mbstring'),
            'fileinfo' => class_exists('finfo'), 'imageEngine' => $engine, 'webp' => Media::supportsWebp(),
            'uploadMax' => ini_get('upload_max_filesize'), 'postMax' => ini_get('post_max_size'), 'memory' => ini_get('memory_limit'),
            'dataOutside' => !$this->dataExposed(),
        ];
    }

    private function loginNonce(): string
    {
        $token = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
        self::setCookie(self::LOGIN_COOKIE, $token, 3600);
        return $token;
    }

    private function checkLoginNonce(): void
    {
        $cookie = (string) ($_COOKIE[self::cookieName(self::LOGIN_COOKIE)] ?? '');
        if ($cookie === '' || !hash_equals($cookie, (string) ($_SERVER['HTTP_X_LOGIN_NONCE'] ?? ''))) throw new HttpError(403, 'forbidden', 'csrf');
    }

    private function sessionInfo(): void
    {
        if (!$this->config) { self::json(401, ['error' => 'setup', 'loginNonce' => $this->loginNonce(), 'checks' => $this->checks()]); return; }
        if (!$this->user) { self::json(401, ['error' => 'login', 'loginNonce' => $this->loginNonce(), 'siteUrl' => $this->config['site_url'] ?? self::SITE_URL]); return; }
        $u = $this->user;
        $status = ['state' => 'idle', 'failed' => false];
        $pages = [];
        try {
            $latest = $this->gh->latestRuns()['latest'];
            if ($latest) $status = ['state' => in_array($latest['state'], ['queued', 'running'], true) ? $latest['state'] : 'idle', 'failed' => $latest['state'] === 'failed'];
            $pages = array_map(static fn ($p) => ['id' => $p['id'], 'label' => $p['label']], $this->site->listPages());
        } catch (GitHubError $e) {
            $status['unknown'] = true;
        }
        self::json(200, [
            'user' => $u['name'], 'lang' => $u['lang'], 'admin' => $u['admin'], 'anfragen' => $u['anfragen'], 'nonce' => $u['csrf'],
            'siteUrl' => $this->config['site_url'], 'actionsUrl' => 'https://github.com/' . GitHub::REPO . '/actions', 'uploadMaxBytes' => self::uploadMax(),
            'pages' => $pages, 'status' => $status, 'newAnfragen' => $u['anfragen'] ? (new Anfragen($this->store))->counts()['new'] : 0,
        ]);
    }

    private static function bytes(string $v): int
    {
        $n = (int) $v;
        $unit = strtolower(substr(trim($v), -1));
        return $unit === 'g' ? $n * 1073741824 : ($unit === 'm' ? $n * 1048576 : ($unit === 'k' ? $n * 1024 : $n));
    }

    private static function uploadMax(): int
    {
        return min(Media::MAX_BYTES, self::bytes((string) ini_get('upload_max_filesize')), self::bytes((string) ini_get('post_max_size')));
    }

    /**
     * Only someone holding a token with write access to the repository gets through: that proves
     * ownership, so a stranger cannot claim a fresh installation.
     */
    private function setup(): void
    {
        $this->checkLoginNonce();
        if ($this->dataExposed()) throw new HttpError(422, 'data_dir', 'Der Datenordner liegt im Web-Root. Bitte ALNO_DATA_DIR auf einen Ordner außerhalb setzen.');
        $b = self::readJson(65536);
        $token = trim((string) ($b['token'] ?? ''));
        $name = strtolower(trim((string) ($b['user'] ?? '')));
        $password = (string) ($b['password'] ?? '');
        if ($token === '') throw new HttpError(422, 'token');
        if (!preg_match(Rules::USERNAME_RE, $name)) throw new HttpError(422, 'bad_name');
        $problem = Auth::passwordProblem($password);
        if ($problem) throw new HttpError(422, $problem);
        try {
            (new GitHub($this->store, $token))->verifyWriteAccess();
        } catch (GitHubError | ConflictError $e) {
            $this->store->log(['event' => 'setup-rejected', 'status' => $e instanceof GitHubError ? $e->status : 409, 'ip' => self::clientIp()]);
            throw new HttpError(422, 'token', $e instanceof GitHubError ? $e->getMessage() : 'Das Repository ist leer.');
        }
        $this->store->withLock('setup', function () use ($token, $name, $password) {
            if ($this->store->exists('config.json')) throw new HttpError(403, 'forbidden');
            $this->auth->addUser($name, $password, true);
            $hosts = array_values(array_unique([self::ADMIN_HOST, self::host()]));
            $this->store->writeJson('config.json', [
                'token' => $token, 'site_url' => self::SITE_URL, 'hosts' => $hosts,
                'cron_key' => bin2hex(random_bytes(24)), 'created' => gmdate('c'),
            ]);
        });
        $this->store->log(['event' => 'setup', 'user' => $name, 'ip' => self::clientIp()]);
        self::json(200, ['ok' => true]);
    }

    private function login(): void
    {
        $this->checkLoginNonce();
        $b = self::readJson(65536);
        $ip = self::clientIp();
        $device = (string) ($_COOKIE[self::cookieName(self::DEVICE_COOKIE)] ?? '');
        $r = $this->auth->login($b['user'] ?? '', $b['password'] ?? '', $ip, $device);
        if (!$r['ok']) {
            // Locked attempts cost nothing to send: logging each would let anyone flush the log.
            if ($r['reason'] === 'invalid') $this->store->log(['event' => 'login-failed', 'user' => mb_substr((string) (is_string($b['user'] ?? null) ? $b['user'] : ''), 0, 40), 'ip' => $ip, 'reason' => $r['reason']]);
            if ($r['reason'] === 'locked') throw new HttpError(429, 'locked', '', ['retryMinutes' => (int) ceil($r['retry'] / 60)]);
            if ($r['reason'] === 'slow') throw new HttpError(429, 'slow', '', ['retrySeconds' => (int) $r['retry']]);
            throw new HttpError(401, 'invalid');
        }
        $this->createSession($r['user']);
        self::setCookie(self::LOGIN_COOKIE, '', 0);
        self::setCookie(self::DEVICE_COOKIE, $this->auth->rememberDevice($r['user']), Auth::DEVICE_DAYS * 86400);
        $this->store->log(['event' => 'login', 'user' => $r['user'], 'ip' => $ip]);
        self::json(200, ['ok' => true]);
    }

    private function logout(): void
    {
        $this->sessionSetup();
        session_start();
        $_SESSION = [];
        session_destroy();
        self::setCookie(self::SESSION_COOKIE, '', 0);
        $this->store->log(['event' => 'logout', 'user' => $this->user['name']]);
        self::json(200, ['ok' => true]);
    }

    // ---------------- dashboard, status ----------------

    private function dashboard(): void
    {
        $pages = $this->site->listPages();
        $count = fn ($c) => count($this->site->listEntries($c));
        $first = null;
        foreach ($pages as $p) if ($p['id'] === 'index') $first = $p;
        if (!$first) foreach ($pages as $p) if ($p['id'] !== '_global') { $first = $p; break; }
        $activity = [];
        try { $activity = $this->gh->commits(null, 8); } catch (GitHubError $e) {}
        self::json(200, [
            'counts' => ['pages' => count(array_filter($pages, static fn ($p) => $p['id'] !== '_global')), 'posts' => $count('blog'), 'leistungen' => $count('leistungen'), 'team' => $count('team'), 'media' => count($this->site->listImages())],
            'runs' => $this->gh->latestRuns(), 'activity' => $activity, 'firstPage' => $first ? ['id' => $first['id']] : null,
            'anfragenWarning' => $this->user['anfragen'] ? (new Anfragen($this->store))->warning() : null,
        ]);
    }

    private function status(): void
    {
        $commit = (string) ($_GET['commit'] ?? '');
        if ($commit === '') { self::json(200, $this->gh->latestRuns()); return; }
        if (!preg_match(Rules::REV_RE, $commit)) throw new HttpError(404, 'not_found');
        $run = $this->gh->runOf($commit);
        // A newer save replaced this run; what counts is the one that carries both.
        if ($run['state'] === 'superseded') {
            $latest = $this->gh->latestRuns()['latest'];
            if ($latest) $run = $latest;
        }
        self::json(200, $run);
    }

    // ---------------- pages ----------------

    private function revCount(string $path): int
    {
        try { return count($this->gh->commits($path, 100)); } catch (GitHubError $e) { return 0; }
    }

    private function getPage(string $id): void
    {
        $p = $this->site->page($id);
        if (!$p) throw new HttpError(404, 'not_found');
        self::json(200, ['id' => $id, 'page' => $p['page'], 'hash' => $p['hash'], 'revisions' => $this->revCount($p['path']), 'tokens' => $this->site->tokens(), 'structureErrors' => $p['structureErrors']]);
    }

    private function ctx(): array
    {
        return ['imageExists' => fn ($p) => $this->site->imageExists($p)];
    }

    private function savePage(array $b): void
    {
        $id = (string) ($b['id'] ?? '');
        $this->writeLock(function () use ($id, $b) {
            $loaded = $this->site->page($id);
            if (!$loaded) throw new HttpError(404, 'not_found');
            if ($loaded['structureErrors']) throw new HttpError(422, 'structure', '', ['structureErrors' => $loaded['structureErrors']]);
            $tokens = $id === '_global' ? Site::tokenKeys($loaded['page']) : $this->site->tokens();
            $values = is_array($b['values'] ?? null) ? $b['values'] : [];
            $r = Rules::applyPageValues($loaded['page'], $values, $this->ctx() + ['tokens' => $tokens]);
            if (($b['hash'] ?? '') !== $loaded['hash']) throw new HttpError(409, 'conflict', '', ['hash' => $loaded['hash'], 'page' => $r['page']]);
            if ($r['errors']) throw new HttpError(422, 'validation', '', ['errors' => $r['errors'], 'page' => $r['page']]);
            $out = Site::serializePage($r['page']);
            if ($out === $loaded['text']) { self::json(200, ['ok' => true, 'unchanged' => true]); return; }
            $extra = $this->site->pendingFiles(Site::pageImageRefs($r['page']));
            $label = Site::commitLabel((string) ($r['page']['label'] ?? $id));
            $commit = $this->gh->commit([$loaded['path'] => $out] + $extra, "Admin: $label aktualisiert", $this->user['name'], [$loaded['path'] => $loaded['hash']]);
            $this->site->clearPending($extra);
            $this->store->log(['event' => 'save', 'user' => $this->user['name'], 'file' => $loaded['path'], 'commit' => $commit]);
            self::json(200, ['ok' => true, 'job' => $commit]);
        });
    }

    // ---------------- collections ----------------

    private function coll(string $postType): string
    {
        $c = $this->site->collectionOf($postType);
        if ($c === null) throw new HttpError(404, 'not_found');
        return $c;
    }

    private function trashDir(string $coll): string
    {
        return "trash/$coll";
    }

    private function listTrash(string $coll): array
    {
        $out = [];
        foreach (glob($this->store->path($this->trashDir($coll) . '/*.json')) ?: [] as $f) {
            $meta = json_decode((string) file_get_contents($f), true);
            if (is_array($meta)) $out[] = $meta;
        }
        usort($out, static fn ($a, $b) => strcmp((string) ($b['at'] ?? ''), (string) ($a['at'] ?? '')));
        return $out;
    }

    private function getEntries(): void
    {
        $coll = $this->coll((string) ($_GET['type'] ?? 'post'));
        $def = $this->site->collections()[$coll];
        $raw = (string) ($_GET['status'] ?? '');
        $view = in_array($raw, ['publish', 'draft', 'trash'], true) ? $raw : 'all';
        $search = mb_strtolower(Rules::trim((string) ($_GET['s'] ?? '')), 'UTF-8');
        $entries = $this->site->listEntries($coll);
        $trash = !empty($def['canDelete']) ? $this->listTrash($coll) : [];
        usort($entries, static function ($a, $b) use ($coll) {
            $x = (array) $a['values'];
            $y = (array) $b['values'];
            $r = $coll === 'blog' ? strcmp((string) ($y['date'] ?? ''), (string) ($x['date'] ?? '')) : ((float) (($x['order'] ?? '') === '' ? 100 : $x['order']) <=> (float) (($y['order'] ?? '') === '' ? 100 : $y['order']));
            return $r ?: strcmp($a['slug'], $b['slug']);
        });
        $isDraft = static fn ($e) => !empty(((array) $e['values'])['draft']);
        $counts = ['all' => count($entries), 'publish' => count(array_filter($entries, static fn ($e) => !$isDraft($e))), 'draft' => count(array_filter($entries, $isDraft)), 'trash' => count($trash)];
        if ($view === 'publish') $entries = array_filter($entries, static fn ($e) => !$isDraft($e));
        if ($view === 'draft') $entries = array_filter($entries, $isDraft);
        if ($search !== '') {
            $entries = array_filter($entries, static fn ($e) => strpos(mb_strtolower((string) json_encode($e['values'], JSON_UNESCAPED_UNICODE), 'UTF-8'), $search) !== false || strpos($e['slug'], $search) !== false);
        }
        self::json(200, ['def' => $def, 'entries' => array_values($entries), 'trash' => $trash, 'view' => $view, 'search' => $search, 'counts' => $counts]);
    }

    private function getEntry(): void
    {
        $coll = $this->coll((string) ($_GET['type'] ?? 'post'));
        $slug = (string) ($_GET['id'] ?? '');
        $entry = $this->site->entry($coll, $slug);
        if (!$entry) throw new HttpError(404, 'not_found');
        $def = $this->site->collections()[$coll];
        self::json(200, ['def' => $def, 'slug' => $slug, 'values' => Site::formValues($def, $entry['entries']), 'body' => $entry['body'], 'hash' => $entry['hash'], 'revisions' => $this->revCount($entry['path'])]);
    }

    private function newEntry(): void
    {
        $coll = $this->coll((string) ($_GET['type'] ?? 'post'));
        $def = $this->site->collections()[$coll];
        if (empty($def['canCreate'])) throw new HttpError(404, 'not_found');
        self::json(200, ['def' => $def, 'slug' => '', 'values' => Site::formValues($def, $coll === 'blog' ? [['date', ['date' => date('Y-m-d')]]] : []), 'body' => '']);
    }

    private function saveEntry(array $b): void
    {
        $coll = $this->coll((string) ($b['type'] ?? ''));
        $def = $this->site->collections()[$coll];
        $existing = (string) ($b['id'] ?? '');
        $isNew = $existing === '';
        if ($isNew && empty($def['canCreate'])) throw new HttpError(403, 'forbidden');
        $input = (is_array($b['values'] ?? null) ? $b['values'] : []) + ['body' => $b['body'] ?? ''];
        $this->writeLock(function () use ($coll, $def, $existing, $isNew, $input, $b) {
            $entry = null;
            $slug = $existing;
            if (!$isNew) {
                $entry = $this->site->entry($coll, $existing);
                if (!$entry) throw new HttpError(404, 'not_found');
            }
            $old = $entry['entries'] ?? [];
            $r = Rules::applyEntryValues($def, $old, $input, $this->ctx() + ['oldBody' => $entry['body'] ?? '']);
            $errors = $r['errors'];
            if ($isNew) {
                $titleKey = 'title';
                foreach ($def['fields'] as $f) if ($f['box'] === 'title') $titleKey = $f['id'];
                $wanted = Rules::trim((string) ($b['slug'] ?? ''));
                $slug = Rules::slugify($wanted !== '' ? $wanted : (string) ($input[$titleKey] ?? ''));
                if (!preg_match(Rules::SLUG_RE, $slug)) $errors[] = ['path' => 'slug', 'label' => 'Permalink', 'msg' => Rules::MSG_SLUG_INVALID];
                elseif (isset($this->gh->tree()[$this->site->entryPath($coll, $slug)])) $errors[] = ['path' => 'slug', 'label' => 'Permalink', 'msg' => Rules::MSG_SLUG_TAKEN];
            }
            if (!$isNew && ($b['hash'] ?? '') !== $entry['hash']) throw new HttpError(409, 'conflict', '', ['hash' => $entry['hash']]);
            if ($errors) throw new HttpError(422, 'validation', '', ['errors' => $errors]);
            $path = $this->site->entryPath($coll, $slug);
            $out = $this->site->serializeEntry($coll, $r['entries'], $r['body']);
            if ($entry && $out === $entry['text']) { self::json(200, ['ok' => true, 'id' => $slug, 'unchanged' => true]); return; }
            $title = '';
            foreach ($r['entries'] as [$k, $v]) if ($k === ($coll === 'team' ? 'name' : 'title')) $title = (string) $v;
            $extra = $this->site->pendingFiles(array_merge($this->site->entryImageRefs($coll, $r['entries']), Site::bodyImageRefs($r['body'])));
            $commit = $this->gh->commit([$path => $out] + $extra, 'Admin: ' . ($isNew ? 'neu' : 'aktualisiert') . ' – ' . Site::commitLabel($title) . " ({$def['dir']}/$slug.md)", $this->user['name'], [$path => $entry['hash'] ?? null]);
            $this->site->clearPending($extra);
            $this->store->log(['event' => $isNew ? 'create' : 'save', 'user' => $this->user['name'], 'file' => $path, 'commit' => $commit]);
            self::json(200, ['ok' => true, 'id' => $slug, 'job' => $commit]);
        });
    }

    private function trashEntry(array $b): void
    {
        $coll = $this->coll((string) ($b['type'] ?? ''));
        $def = $this->site->collections()[$coll];
        if (empty($def['canDelete'])) throw new HttpError(403, 'forbidden');
        $slug = (string) ($b['id'] ?? '');
        if (!preg_match(Rules::SLUG_RE, $slug)) throw new HttpError(404, 'not_found');
        $this->writeLock(function () use ($coll, $def, $slug) {
            $path = $this->site->entryPath($coll, $slug);
            $f = $this->gh->file($path);
            if (!$f) throw new HttpError(404, 'not_found');
            $title = $slug;
            try {
                $entry = $this->site->entry($coll, $slug);
                $v = Site::formValues($def, $entry['entries']);
                $title = ($coll === 'team' ? $v['name'] : $v['title']) ?: $slug;
            } catch (FrontmatterError $e) {}
            $commit = $this->gh->commit([$path => null], "Admin: in den Papierkorb – {$def['dir']}/$slug.md", $this->user['name'], [$path => $f['sha']]);
            $id = time() . "-$slug";
            $this->store->write($this->trashDir($coll) . "/$id.md", $f['content']);
            $this->store->writeJson($this->trashDir($coll) . "/$id.json", ['id' => $id, 'slug' => $slug, 'coll' => $coll, 'by' => $this->user['name'], 'at' => gmdate('c'), 'title' => $title]);
            $this->store->log(['event' => 'trash', 'user' => $this->user['name'], 'file' => $path, 'commit' => $commit]);
            self::json(200, ['ok' => true, 'job' => $commit]);
        });
    }

    private function fromTrash(array $b, bool $permanently): void
    {
        $coll = $this->coll((string) ($b['type'] ?? ''));
        $def = $this->site->collections()[$coll];
        if (empty($def['canDelete'])) throw new HttpError(403, 'forbidden');
        $id = (string) ($b['trashId'] ?? '');
        if (!preg_match('/^\d+-[a-z0-9]+(?:-[a-z0-9]+)*$/D', $id)) throw new HttpError(404, 'not_found');
        $this->writeLock(function () use ($coll, $def, $id, $permanently) {
            $dir = $this->trashDir($coll);
            $meta = $this->store->readJson("$dir/$id.json");
            if (!is_array($meta) || !preg_match(Rules::SLUG_RE, (string) ($meta['slug'] ?? ''))) throw new HttpError(404, 'not_found');
            if ($permanently) {
                $this->store->delete("$dir/$id.md");
                $this->store->delete("$dir/$id.json");
                $this->store->log(['event' => 'delete', 'user' => $this->user['name'], 'id' => $id]);
                self::json(200, ['ok' => true]);
                return;
            }
            $path = $this->site->entryPath($coll, $meta['slug']);
            if (isset($this->gh->tree()[$path])) throw new HttpError(409, 'exists', Rules::MSG_SLUG_TAKEN);
            $content = $this->store->read("$dir/$id.md");
            if ($content === null) throw new HttpError(404, 'not_found');
            $extra = $this->site->pendingFiles($this->imagesOf($coll, $content));
            $commit = $this->gh->commit([$path => $content] + $extra, "Admin: aus dem Papierkorb wiederhergestellt – {$def['dir']}/{$meta['slug']}.md", $this->user['name'], [$path => null]);
            $this->site->clearPending($extra);
            $this->store->delete("$dir/$id.md");
            $this->store->delete("$dir/$id.json");
            $this->store->log(['event' => 'untrash', 'user' => $this->user['name'], 'file' => $path, 'commit' => $commit]);
            self::json(200, ['ok' => true, 'id' => $meta['slug'], 'job' => $commit]);
        });
    }

    /**
     * The images an entry's file needs. Refuses one that has gone while it lay in the trash: the
     * build would fail on it. One still waiting in pending/ goes into the same commit.
     */
    private function imagesOf(string $coll, string $content): array
    {
        try {
            $parts = Frontmatter::split($content);
            $entries = Frontmatter::parse($parts['fm']);
        } catch (FrontmatterError $e) {
            return [];
        }
        $exists = fn ($p) => $this->site->imageExists($p);
        $errors = Rules::missingBodyImages($parts['body'], $exists);
        $refs = $this->site->entryImageRefs($coll, $entries);
        foreach ($refs as $r) {
            if (!$exists($r['path'])) $errors[] = ['path' => 'image', 'label' => $r['where'], 'msg' => Rules::msgImageMissing($r['path'])];
        }
        if ($errors) throw new HttpError(422, 'validation', '', ['errors' => $errors]);
        return array_merge($refs, Site::bodyImageRefs($parts['body']));
    }

    // ---------------- media ----------------

    private function mediaAlts(): array
    {
        return $this->store->readJson('media.json', []);
    }

    private function getMedia(): void
    {
        $search = mb_strtolower(Rules::trim((string) ($_GET['s'] ?? '')), 'UTF-8');
        $alts = $this->mediaAlts();
        $out = [];
        foreach ($this->site->listImages() as $i) {
            if ($search === '' || strpos(mb_strtolower($i['path'], 'UTF-8'), $search) !== false) $out[] = $i + ['alt' => $alts[$i['path']]['alt'] ?? ''];
        }
        self::json(200, ['images' => $out]);
    }

    private function getMediaItem(): void
    {
        $item = (string) ($_GET['path'] ?? '');
        $bytes = Rules::isImagePath($item) ? $this->site->imageBytes($item) : null;
        if ($bytes === null) throw new HttpError(404, 'not_found');
        $info = @getimagesizefromstring($bytes);
        $image = ['path' => $item, 'name' => basename($item), 'size' => strlen($bytes), 'pending' => isset($this->site->pending()[$item])];
        self::json(200, ['image' => $image, 'info' => $info ? ['width' => $info[0], 'height' => $info[1]] : (object) [], 'usedOn' => $this->site->usages($item), 'alt' => $this->mediaAlts()[$item]['alt'] ?? '']);
    }

    private function saveMediaMeta(array $b): void
    {
        $item = (string) ($b['path'] ?? '');
        if (!$this->site->imageExists($item)) throw new HttpError(404, 'not_found');
        $this->store->withLock('media', function () use ($item, $b) {
            $alts = $this->mediaAlts();
            $alt = mb_substr(Rules::cleanText((string) ($b['alt'] ?? '')), 0, Rules::ALT_MAX, 'UTF-8');
            if ($alt !== '') $alts[$item] = ['alt' => $alt]; else unset($alts[$item]);
            $this->store->writeJson('media.json', $alts);
        });
        self::json(200, ['ok' => true]);
    }

    private function deleteMedia(array $b): void
    {
        $item = (string) ($b['path'] ?? '');
        $this->writeLock(function () use ($item) {
            if (!$this->site->imageExists($item)) throw new HttpError(404, 'not_found');
            if ($this->site->usages($item)) throw new HttpError(409, 'in_use');
            $pending = $this->site->pending()[$item] ?? null;
            if ($pending) {
                @unlink($pending);
            } else {
                $path = Site::IMG . $item;
                $bytes = (string) $this->site->imageBytes($item);
                $this->gh->commit([$path => null], "Admin: Bild gelöscht – $item [skip ci]", $this->user['name'], [$path => $this->gh->tree()[$path]['sha']]);
                $this->store->write('trash/media/' . time() . '-' . str_replace('/', '__', $item), $bytes);
            }
            $this->store->log(['event' => 'media-delete', 'user' => $this->user['name'], 'file' => $item]);
            self::json(200, ['ok' => true]);
        });
    }

    /**
     * Through the media modal an image waits in the data folder for the save that uses it, and lands
     * in one commit with it. From the library it is committed at once, without a build: nothing uses
     * it yet.
     */
    private function upload(): void
    {
        if (!$_FILES && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > self::bytes((string) ini_get('post_max_size'))) throw new HttpError(413, 'too_large', 'Datei zu groß');
        $f = $_FILES['file'] ?? null;
        $errors = [];
        $done = [];
        if (!is_array($f) || !is_string($f['tmp_name'] ?? null)) {
            $errors[] = ['file' => '', 'msg' => 'Leere Datei'];
        } elseif ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE) {
            $errors[] = ['file' => (string) $f['name'], 'msg' => 'Datei zu groß (höchstens ' . (int) round(self::uploadMax() / 1048576) . ' MB)'];
        } elseif ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) {
            $errors[] = ['file' => (string) $f['name'], 'msg' => 'Leere Datei'];
        } else {
            try {
                [$bytes, $ext, $w, $h] = Media::process((string) file_get_contents($f['tmp_name']), self::uploadMax());
                $name = Media::randomName($ext);
                $p = "uploads/$name";
                if (($_GET['stage'] ?? '') === '1') {
                    Media::prunePending($this->store);
                    if (count(glob($this->store->path('pending/*')) ?: []) >= Media::PENDING_MAX) throw new UploadError('Zu viele Bilder warten auf das Speichern');
                    $this->store->write("pending/$name", $bytes);
                } else {
                    $this->writeLock(function () use ($p, $bytes, $name) {
                        $this->gh->commit([Site::IMG . $p => $bytes], "Admin: Bild hochgeladen – uploads/$name [skip ci]", $this->user['name'], [Site::IMG . $p => null]);
                    });
                }
                $this->store->log(['event' => 'upload', 'user' => $this->user['name'], 'file' => $p, 'original' => mb_substr((string) $f['name'], 0, 80), 'bytes' => strlen($bytes)]);
                $done[] = ['path' => $p, 'name' => $name, 'width' => $w, 'height' => $h, 'size' => strlen($bytes), 'alt' => ''];
            } catch (UploadError $e) {
                $errors[] = ['file' => mb_substr((string) $f['name'], 0, 120), 'msg' => $e->getMessage()];
            }
        }
        self::json($errors && !$done ? 422 : 200, ['files' => $done, 'errors' => $errors]);
    }

    private function mediaFile(): void
    {
        $f = (string) ($_GET['path'] ?? '');
        $bytes = Rules::isImagePath($f) ? $this->site->imageBytes($f) : null;
        if ($bytes === null) throw new HttpError(404, 'not_found');
        session_write_close();
        header('Cache-Control: private, max-age=3600');
        if (!empty($_GET['thumb'])) {
            $thumb = Media::thumbnail($bytes, $this->store);
            if ($thumb !== null) { header('Content-Type: image/jpeg'); echo $thumb; return; }
        }
        $ext = strtolower((string) pathinfo($f, PATHINFO_EXTENSION));
        header('Content-Type: ' . (Site::IMAGE_MIME[$ext] ?? 'application/octet-stream'));
        echo $bytes;
    }

    // ---------------- revisions ----------------

    private function fileTitle(string $file): string
    {
        $f = $this->gh->file($file);
        if (!$f) return basename($file);
        if (substr($file, -5) === '.json') return (string) (json_decode($f['content'], true)['label'] ?? $file);
        try {
            $coll = explode('/', $file)[2];
            foreach (Frontmatter::parse(Frontmatter::split($f['content'])['fm']) as [$k, $v]) {
                if ($k === ($coll === 'team' ? 'name' : 'title')) return (string) $v;
            }
        } catch (FrontmatterError $e) {}
        return basename($file);
    }

    private function editTarget(string $file): ?array
    {
        if (preg_match('/^src\/content\/pages\/(.+)\.json$/D', $file, $m)) return ['type' => 'page', 'id' => $m[1]];
        if (preg_match('/^src\/content\/(blog|leistungen|team)\/(.+)\.md$/D', $file, $m)) return ['type' => $this->site->collections()[$m[1]]['postType'], 'id' => $m[2]];
        return null;
    }

    private function getRevisions(): void
    {
        $seen = [];
        foreach ($this->gh->commits('src/content', 40) as $c) {
            foreach ($this->gh->commitFiles($c['hash']) as $file) {
                if (!preg_match(Rules::REV_FILE_RE, $file)) continue;
                if (!isset($seen[$file])) $seen[$file] = ['file' => $file, 'title' => $this->fileTitle($file), 'count' => 0] + $c;
                $seen[$file]['count']++;
            }
        }
        self::json(200, ['isRepo' => true, 'files' => array_values($seen)]);
    }

    private function getRevisionFile(): void
    {
        $file = (string) ($_GET['file'] ?? '');
        if (!preg_match(Rules::REV_FILE_RE, $file)) throw new HttpError(404, 'not_found');
        $revs = $this->gh->commits($file, 100);
        $rev = (string) ($_GET['rev'] ?? '');
        if ($rev !== '' && !preg_match(Rules::REV_RE, $rev)) throw new HttpError(404, 'not_found');
        $selected = null;
        foreach ($revs as $r) if ($rev !== '' && strncmp($r['hash'], $rev, strlen($rev)) === 0) $selected = $r;
        if ($rev === '') $selected = $revs[1] ?? ($revs[0] ?? null);
        $diff = [];
        $same = false;
        if ($selected) {
            $old = (string) $this->gh->fileAt($file, $selected['hash']);
            $cur = (string) ($this->gh->file($file)['content'] ?? '');
            $isJson = substr($file, -5) === '.json';
            // Page files are compared field by field; formatting of the JSON is not a change.
            if ($isJson) {
                $a = json_decode($old, true);
                $b = json_decode($cur, true);
                if (is_array($a) && is_array($b) && !Rules::checkStructure($a) && !Rules::checkStructure($b)) { $old = Site::pageLines($a); $cur = Site::pageLines($b); }
            }
            $same = $old === $cur;
            $diff = Diff::compact(Diff::lines($cur, $old), $isJson ? 1 : 3);
        }
        $exists = isset($this->gh->tree()[$file]);
        self::json(200, ['isRepo' => true, 'file' => $file, 'title' => $this->fileTitle($file), 'edit' => $exists ? $this->editTarget($file) : null, 'revs' => $revs, 'selected' => $selected, 'diff' => $diff, 'same' => $same]);
    }

    /** A restored version goes through the same rules as a save: an old revision is not trusted. */
    private function restoreRevision(array $b): void
    {
        $file = (string) ($b['file'] ?? '');
        $rev = (string) ($b['rev'] ?? '');
        if (!preg_match(Rules::REV_FILE_RE, $file) || !preg_match(Rules::REV_RE, $rev)) throw new HttpError(404, 'not_found');
        $this->writeLock(function () use ($file, $rev) {
            $old = $this->gh->fileAt($file, $rev);
            if ($old === null) throw new HttpError(404, 'not_found');
            $current = $this->gh->file($file);
            $refuse = static function (array $errors): void { throw new HttpError(422, 'validation', '', ['errors' => $errors]); };
            $extra = [];
            if (substr($file, -5) === '.json') {
                if (!$current) throw new HttpError(404, 'not_found');
                $a = json_decode($old, true);
                $b = json_decode($current['content'], true);
                if (!is_array($a) || !is_array($b)) $refuse([['path' => $file, 'msg' => 'JSON']]);
                $merged = Site::mergeOldValues($b, $a);
                $errors = Rules::validatePageValues($merged, $this->ctx() + ['tokens' => $this->site->tokens()]);
                if ($errors) $refuse($errors);
                $out = Site::serializePage($merged);
                $extra = $this->site->pendingFiles(Site::pageImageRefs($merged));
            } else {
                $coll = explode('/', $file)[2];
                $def = $this->site->collections()[$coll];
                if (!$current && empty($def['canCreate'])) throw new HttpError(403, 'forbidden');
                try {
                    $parts = Frontmatter::split($old);
                    $entries = Frontmatter::parse($parts['fm']);
                } catch (FrontmatterError $e) {
                    $refuse([['path' => $file, 'msg' => $e->getMessage()]]);
                }
                $oldBody = Rules::sanitizeMarkdown(ltrim($parts['body'], "\n"));
                $r = Rules::applyEntryValues($def, $entries, Site::formValues($def, $entries) + ['body' => $oldBody], $this->ctx() + ['oldBody' => $oldBody]);
                $map = array_column($entries, 1, 0);
                foreach ($def['fields'] as $f) {
                    // Saves keep a path outside the library; a restored one is not trusted.
                    if ($f['type'] === 'image' && !empty($map[$f['id']]) && Rules::imgFromFrontmatter($map[$f['id']]) === '') $r['errors'][] = ['path' => $f['id'], 'label' => $f['label'], 'msg' => Rules::MSG_BAD_IMAGE];
                }
                if ($r['errors']) $refuse($r['errors']);
                $out = $this->site->serializeEntry($coll, $r['entries'], $r['body']);
                $extra = $this->site->pendingFiles(array_merge($this->site->entryImageRefs($coll, $r['entries']), Site::bodyImageRefs($r['body'])));
            }
            $short = substr($rev, 0, 7);
            $commit = $this->gh->commit([$file => $out] + $extra, "Admin: Revision $short wiederhergestellt – $file", $this->user['name'], [$file => $current['sha'] ?? null]);
            $this->site->clearPending($extra);
            $this->store->log(['event' => 'restore', 'user' => $this->user['name'], 'file' => $file, 'rev' => $rev, 'commit' => $commit]);
            self::json(200, ['ok' => true, 'job' => $commit, 'edit' => $this->editTarget($file)]);
        });
    }

    // ---------------- profile, users ----------------

    private function setLang(array $b): void
    {
        $lang = $b['lang'] ?? '';
        if (!in_array($lang, ['de', 'ru'], true)) throw new HttpError(400, 'bad_request');
        $this->auth->setLang($this->user['name'], $lang);
        self::json(200, ['ok' => true]);
    }

    private function setPassword(array $b): void
    {
        $name = $this->user['name'];
        $check = $this->auth->checkCurrent($name, (string) ($b['current'] ?? ''));
        if ($check !== true) {
            if ($check > 0) throw new HttpError(429, 'locked', '', ['retryMinutes' => (int) ceil($check / 60)]);
            throw new HttpError(422, 'wrong_password');
        }
        $password = (string) ($b['password'] ?? '');
        $problem = Auth::passwordProblem($password);
        if ($problem) throw new HttpError(422, $problem);
        $this->auth->setPassword($name, $password);
        $this->createSession($name);
        self::setCookie(self::DEVICE_COOKIE, $this->auth->rememberDevice($name), Auth::DEVICE_DAYS * 86400);
        $this->store->log(['event' => 'password', 'user' => $name]);
        self::json(200, ['ok' => true]);
    }

    private function addUser(array $b): void
    {
        $this->needAdmin();
        $name = strtolower(trim((string) ($b['name'] ?? '')));
        $problem = $this->auth->addUser($name, (string) ($b['password'] ?? ''), !empty($b['admin']), ($b['lang'] ?? '') === 'ru' ? 'ru' : 'de', !empty($b['anfragen']));
        if ($problem) throw new HttpError(422, $problem);
        $this->store->log(['event' => 'user-add', 'user' => $this->user['name'], 'name' => $name]);
        self::json(200, ['ok' => true]);
    }

    private function updateUser(array $b): void
    {
        $this->needAdmin();
        $name = (string) ($b['name'] ?? '');
        if (!isset($this->auth->users()[$name])) throw new HttpError(404, 'not_found');
        if (isset($b['password']) && $b['password'] !== '') {
            $problem = Auth::passwordProblem((string) $b['password']);
            if ($problem) throw new HttpError(422, $problem);
            $this->auth->setPassword($name, (string) $b['password']);
        }
        if (array_key_exists('anfragen', $b)) $this->auth->setFlag($name, 'anfragen', !empty($b['anfragen']));
        $this->store->log(['event' => 'user-update', 'user' => $this->user['name'], 'name' => $name]);
        self::json(200, ['ok' => true]);
    }

    private function deleteUser(array $b): void
    {
        $this->needAdmin();
        $name = (string) ($b['name'] ?? '');
        if ($name === $this->user['name']) throw new HttpError(409, 'self');
        if (!isset($this->auth->users()[$name])) throw new HttpError(404, 'not_found');
        $this->auth->deleteUser($name);
        $this->store->log(['event' => 'user-delete', 'user' => $this->user['name'], 'name' => $name]);
        self::json(200, ['ok' => true]);
    }

    // ---------------- Anfragen ----------------

    private function anfragenList(): void
    {
        $raw = (string) ($_GET['view'] ?? '');
        $a = new Anfragen($this->store);
        $out = $a->listing(in_array($raw, ['neu', 'erledigt', 'trash'], true) ? $raw : 'all') + ['warning' => $a->warning()];
        if ($this->user['admin']) $out['cronUrl'] = (self::secureCookie() ? 'https://' : 'http://') . self::host() . '/wp-admin/cron.php?key=' . rawurlencode((string) ($this->config['cron_key'] ?? ''));
        self::json(200, $out);
    }

    private function anfrageItem(): void
    {
        $id = (string) ($_GET['id'] ?? '');
        $d = (new Anfragen($this->store))->detail($id);
        if (!$d) throw new HttpError(404, 'not_found');
        // Who read which submission: the record of access, no content.
        $this->store->log(['event' => 'anfrage-read', 'user' => $this->user['name'], 'id' => $id], 'access');
        self::json(200, $d);
    }

    private function anfrageFile(): void
    {
        $id = (string) ($_GET['id'] ?? '');
        $file = (new Anfragen($this->store))->attachment($id, (string) ($_GET['stored'] ?? ''));
        if (!$file) throw new HttpError(404, 'not_found');
        $this->store->log(['event' => 'anfrage-file', 'user' => $this->user['name'], 'id' => $id], 'access');
        // Always a download: the content is a stranger's, it is never opened here or inline.
        $name = (string) preg_replace('/[^\w.\- ]+/u', '_', $file['name']);
        header('Content-Type: ' . (preg_match('/^[a-z]+\/[a-z0-9.+-]+$/iD', $file['type']) ? $file['type'] : 'application/octet-stream'));
        header("Content-Disposition: attachment; filename*=UTF-8''" . rawurlencode($name));
        header('Content-Length: ' . filesize($file['path']));
        readfile($file['path']);
    }

    private function anfrageAct(array $b, string $act): void
    {
        $this->needAnfragen();
        $id = (string) ($b['id'] ?? '');
        $a = new Anfragen($this->store);
        switch ($act) {
            case 'status': $ok = $a->setStatus($id, (string) ($b['status'] ?? '')); break;
            case 'trash': $ok = $a->trash($id); break;
            case 'restore': $ok = $a->restore($id); break;
            default: $ok = $a->destroy($id);
        }
        if (!$ok) throw new HttpError(404, 'not_found');
        $this->store->log(['event' => "anfrage-$act", 'user' => $this->user['name'], 'id' => $id], 'access');
        self::json(200, ['ok' => true]);
    }

    private function setRetention(array $b): void
    {
        $this->needAdmin();
        $i = (int) ($b['inquiries'] ?? 0);
        $a = (int) ($b['applications'] ?? 0);
        if ($i < 1 || $i > 60 || $a < 1 || $a > 60) throw new HttpError(422, 'retention');
        (new Anfragen($this->store))->setRetention($i, $a);
        $this->store->log(['event' => 'retention', 'user' => $this->user['name'], 'inquiries' => $i, 'applications' => $a]);
        self::json(200, ['ok' => true]);
    }
}

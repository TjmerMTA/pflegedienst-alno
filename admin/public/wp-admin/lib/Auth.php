<?php
// Users, login lockout and sessions. Everything lives in the data folder outside the web root.
declare(strict_types=1);

final class Auth
{
    const MAX_FAILS = 5;
    const IP_MAX = 20;
    const WINDOW = 900;
    const LOCK = 900;
    const SESSION_IDLE = 28800;

    private Store $store;
    /** @var callable */
    private $now;

    public function __construct(Store $store, ?callable $now = null)
    {
        $this->store = $store;
        $this->now = $now ?? static fn (): int => time();
    }

    public static function hashPassword(string $password): string
    {
        return password_hash($password, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT);
    }

    public static function passwordProblem(string $password): ?string
    {
        if (mb_strlen($password, 'UTF-8') < Rules::PASSWORD_MIN) return 'too_short';
        if (strlen($password) > Rules::PASSWORD_MAX_BYTES) return 'too_long';
        return null;
    }

    public function users(): array
    {
        return $this->store->readJson('users.json', []);
    }

    private function saveUsers(array $users): void
    {
        $this->store->writeJson('users.json', $users);
    }

    public function listUsers(): array
    {
        $out = [];
        foreach ($this->users() as $name => $u) $out[] = ['name' => $name, 'lang' => $u['lang'] ?? 'de', 'admin' => !empty($u['admin']), 'anfragen' => !empty($u['admin']) || !empty($u['anfragen']), 'created' => $u['created'] ?? ''];
        return $out;
    }

    public function setFlag(string $name, string $flag, bool $value): void
    {
        $this->store->withLock('users', function () use ($name, $flag, $value) {
            $users = $this->users();
            if (isset($users[$name])) { $users[$name][$flag] = $value; $this->saveUsers($users); }
        });
    }

    public function addUser(string $name, string $password, bool $admin = false, string $lang = 'de', bool $anfragen = false): ?string
    {
        if (!preg_match(Rules::USERNAME_RE, $name)) return 'bad_name';
        $problem = self::passwordProblem($password);
        if ($problem) return $problem;
        $hash = self::hashPassword($password);
        return $this->store->withLock('users', function () use ($name, $hash, $admin, $lang, $anfragen) {
            $users = $this->users();
            if (isset($users[$name])) return 'exists';
            // A random start: a session of an earlier user with this name must not fit the new one.
            $users[$name] = ['hash' => $hash, 'lang' => $lang, 'admin' => $admin, 'anfragen' => $anfragen, 'pwv' => random_int(1, 1 << 48), 'created' => gmdate('c')];
            $this->saveUsers($users);
            return null;
        });
    }

    public function deleteUser(string $name): void
    {
        $this->store->withLock('users', function () use ($name) {
            $users = $this->users();
            unset($users[$name]);
            $this->saveUsers($users);
        });
    }

    /** A new password ends all other sessions: they carry the old `pwv`. */
    public function setPassword(string $name, string $password): int
    {
        $hash = self::hashPassword($password);
        return $this->store->withLock('users', function () use ($name, $hash) {
            $users = $this->users();
            $users[$name]['hash'] = $hash;
            $users[$name]['pwv'] = (int) ($users[$name]['pwv'] ?? 1) + 1;
            $this->saveUsers($users);
            return $users[$name]['pwv'];
        });
    }

    public function setLang(string $name, string $lang): void
    {
        $this->store->withLock('users', function () use ($name, $lang) {
            $users = $this->users();
            if (isset($users[$name])) { $users[$name]['lang'] = $lang; $this->saveUsers($users); }
        });
    }

    public function checkPassword(string $name, string $password): bool
    {
        $u = $this->users()[$name] ?? null;
        return $u !== null && password_verify($password, $u['hash']);
    }

    // ---------------- lockout ----------------

    /** One IPv6 customer owns a whole /64, so that is what counts as one address. */
    public static function network(string $ip): string
    {
        $b = strpos($ip, ':') !== false ? @inet_pton($ip) : false;
        return $b === false ? $ip : bin2hex(substr($b, 0, 8));
    }

    private function lockedFor(array $table, string $key): int
    {
        $e = $table[$key] ?? null;
        $left = $e ? (int) ($e['until'] ?? 0) - ($this->now)() : 0;
        return max(0, $left);
    }

    private function recordFail(array &$table, string $key, int $max): void
    {
        $t = ($this->now)();
        $e = $table[$key] ?? null;
        if (!$e || ($t - $e['first'] > self::WINDOW && (int) ($e['until'] ?? 0) < $t)) $e = ['count' => 0, 'first' => $t, 'until' => 0];
        $e['count']++;
        if ($e['count'] >= $max) $e['until'] = $t + self::LOCK;
        $table[$key] = $e;
    }

    /**
     * Returns ['ok' => true, 'user' => name] or ['ok' => false, 'reason' => 'invalid'|'locked', 'retry' => seconds].
     * The attempt is counted before the slow hash: otherwise parallel guesses all pass the check.
     * The name's counter is per network, or a stranger could keep any account locked for good.
     */
    public function login($name, $password, string $ip): array
    {
        $uname = strtolower(Rules::trim(is_string($name) ? $name : ''));
        $net = self::network($ip);
        $ukey = 'u:' . sha1("$uname|$net");
        $ikey = 'ip:' . sha1($net);
        $locked = $this->store->withLock('lockout', function () use ($ukey, $ikey) {
            $t = $this->store->readJson('lockout.json', []);
            $left = max($this->lockedFor($t, $ukey), $this->lockedFor($t, $ikey));
            if ($left) return $left;
            $this->recordFail($t, $ukey, self::MAX_FAILS);
            $this->recordFail($t, $ikey, self::IP_MAX);
            $now = ($this->now)();
            foreach ($t as $k => $e) {
                if ($now - $e['first'] > 2 * self::WINDOW && (int) ($e['until'] ?? 0) < $now) unset($t[$k]);
            }
            $this->store->writeJson('lockout.json', $t);
            return 0;
        });
        if ($locked) return ['ok' => false, 'reason' => 'locked', 'retry' => $locked];

        $users = $this->users();
        $u = preg_match(Rules::USERNAME_RE, $uname) ? ($users[$uname] ?? null) : null;
        // A hash of the same cost for unknown users, so they answer as slowly as known ones.
        if ($u === null) self::hashPassword(bin2hex(random_bytes(8)));
        $good = $u !== null && password_verify(is_string($password) ? $password : '', $u['hash']);
        return $this->store->withLock('lockout', function () use ($good, $uname, $ukey, $ikey) {
            $t = $this->store->readJson('lockout.json', []);
            if (!$good) {
                $left = max($this->lockedFor($t, $ukey), $this->lockedFor($t, $ikey));
                return $left ? ['ok' => false, 'reason' => 'locked', 'retry' => $left] : ['ok' => false, 'reason' => 'invalid'];
            }
            unset($t[$ukey]);
            if (isset($t[$ikey])) {
                $t[$ikey]['count']--;
                if ($t[$ikey]['count'] < self::IP_MAX) $t[$ikey]['until'] = 0;
            }
            $this->store->writeJson('lockout.json', $t);
            return ['ok' => true, 'user' => $uname];
        });
    }
}

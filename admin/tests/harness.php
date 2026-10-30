<?php
// Starts the real admin under `php -S` against fake-github.php, each test file with its own data
// folder and repository, and talks to it over HTTP with a cookie jar.
declare(strict_types=1);

require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/fakegit.php';
require_once __DIR__ . '/../public/wp-admin/lib/bootstrap.php';

const WP_ROOT = __DIR__ . '/../public';
const TEST_TOKEN = 'good-token';

function tmpDir(string $tag = 'alno'): string
{
    $d = sys_get_temp_dir() . "/$tag-" . bin2hex(random_bytes(5));
    mkdir($d, 0700, true);
    return $d;
}

function rmTree(string $d): void
{
    if (!is_dir($d)) return;
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $f) {
        $f->isDir() && !$f->isLink() ? rmdir($f->getPathname()) : unlink($f->getPathname());
    }
    rmdir($d);
}

/** What the browser sends for a page: {group: {field: value}}, images as {value, alt}. */
function pageValues(array $page): array
{
    $values = [];
    foreach ($page['groups'] as $g) {
        foreach ($g['fields'] as $f) {
            $values[$g['id']][$f['id']] = $f['type'] === 'image' ? ['value' => $f['value'] ?? '', 'alt' => $f['alt'] ?? ''] : ($f['value'] ?? '');
        }
    }
    return $values;
}

/** Opens a page, lets $edit change the values, saves it with the hash it read. */
function savePage(Client $c, string $id, callable $edit): array
{
    $p = $c->get('page', ['id' => $id])['json'];
    $values = pageValues($p['page']);
    $edit($values);
    return $c->post('page', ['id' => $id, 'hash' => $p['hash'], 'values' => $values]);
}

/** The same for a collection entry. $edit gets values and body. */
function saveEntry(Client $c, string $type, string $id, callable $edit): array
{
    $p = $c->get('entry', ['type' => $type, 'id' => $id])['json'];
    $values = $p['values'];
    $body = $p['body'];
    $edit($values, $body);
    return $c->post('entry', ['type' => $type, 'id' => $id, 'hash' => $p['hash'], 'values' => $values, 'body' => $body]);
}

/** A generated image of one colour: 'jpeg', 'png' or 'webp'. */
function img(int $w, int $h, string $format = 'jpeg'): string
{
    $im = imagecreatetruecolor($w, $h);
    imagefill($im, 0, 0, (int) imagecolorallocate($im, 136, 170, 204));
    ob_start();
    $format === 'jpeg' ? imagejpeg($im) : ($format === 'png' ? imagepng($im) : imagewebp($im));
    return (string) ob_get_clean();
}

final class Server
{
    public int $port;
    private $proc;

    public function __construct(array $args, array $env, int $workers = 1)
    {
        $s = stream_socket_server('tcp://127.0.0.1:0');
        $this->port = (int) substr(strrchr(stream_socket_get_name($s, false), ':'), 1);
        fclose($s);
        $env = array_merge(getenv(), $env, $workers > 1 ? ['PHP_CLI_SERVER_WORKERS' => (string) $workers] : []);
        $cmd = array_merge([PHP_BINARY, '-d', 'variables_order=EGPCS', '-S', "127.0.0.1:$this->port"], $args);
        $this->proc = proc_open($cmd, [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, null, $env);
        for ($i = 0; $i < 200; $i++) {
            $c = @fsockopen('127.0.0.1', $this->port, $no, $msg, 0.1);
            if ($c) { fclose($c); return; }
            usleep(25000);
        }
        throw new RuntimeException('server did not start');
    }

    public function stop(): void
    {
        if (!$this->proc) return;
        $st = proc_get_status($this->proc);
        // The workers are children of the first process.
        @exec('pkill -P ' . (int) $st['pid']);
        proc_terminate($this->proc);
        proc_close($this->proc);
        $this->proc = null;
    }
}

final class Client
{
    public array $cookies = [];
    public ?string $nonce = null;
    public string $base;
    public array $headers = [];

    public function __construct(string $base)
    {
        $this->base = $base;
    }

    public function raw(string $method, string $url, ?string $body = null, array $headers = []): array
    {
        $h = $headers;
        foreach ($this->headers as $k => $v) $h[] = "$k: $v";
        if ($this->cookies) $h[] = 'Cookie: ' . implode('; ', array_map(static fn ($k, $v) => "$k=$v", array_keys($this->cookies), $this->cookies));
        $resp = [];
        $c = curl_init($url[0] === '/' ? $this->base . $url : $url);
        curl_setopt_array($c, [
            CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $h, CURLOPT_TIMEOUT => 60,
            CURLOPT_HEADERFUNCTION => function ($ch, string $line) use (&$resp): int {
                $p = strpos($line, ':');
                if ($p !== false) {
                    $k = strtolower(substr($line, 0, $p));
                    $v = trim(substr($line, $p + 1));
                    $resp[$k][] = $v;
                    if ($k === 'set-cookie' && preg_match('/^([^=]+)=([^;]*)/', $v, $m)) {
                        if ($m[2] === '' || $m[2] === 'deleted') unset($this->cookies[$m[1]]); else $this->cookies[$m[1]] = $m[2];
                    }
                }
                return strlen($line);
            },
        ]);
        if ($body !== null) curl_setopt($c, CURLOPT_POSTFIELDS, $body);
        $out = curl_exec($c);
        $status = (int) curl_getinfo($c, CURLINFO_RESPONSE_CODE);
        curl_close($c);
        return ['status' => $status, 'body' => (string) $out, 'json' => json_decode((string) $out, true), 'headers' => $resp];
    }

    public function get(string $route, array $query = []): array
    {
        return $this->raw('GET', '/wp-admin/api.php?' . http_build_query(['r' => $route] + $query));
    }

    public function post(string $route, array $data = [], array $headers = []): array
    {
        $body = json_encode($data === [] ? (object) [] : $data, JSON_UNESCAPED_UNICODE);
        $h = array_merge(['Content-Type: application/json'], $this->nonce ? ['X-WP-Nonce: ' . $this->nonce] : [], $headers);
        return $this->raw('POST', '/wp-admin/api.php?r=' . rawurlencode($route), $body, $h);
    }

    /** The same POST $n times at once, for races. */
    public function burst(string $route, array $data, int $n, array $headers = []): array
    {
        return $this->together(array_fill(0, $n, [$route, $data]), $headers);
    }

    /** Several POSTs at the same moment. $posts: [route, data] each. Returns status, body, json each. */
    public function together(array $posts, array $headers = []): array
    {
        $h = array_merge(['Content-Type: application/json'], $this->nonce ? ['X-WP-Nonce: ' . $this->nonce] : [], $headers);
        if ($this->cookies) $h[] = 'Cookie: ' . implode('; ', array_map(static fn ($k, $v) => "$k=$v", array_keys($this->cookies), $this->cookies));
        $multi = curl_multi_init();
        $handles = [];
        foreach ($posts as [$route, $data]) {
            $c = curl_init($this->base . '/wp-admin/api.php?r=' . rawurlencode($route));
            curl_setopt_array($c, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($data, JSON_UNESCAPED_UNICODE), CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $h, CURLOPT_TIMEOUT => 120]);
            curl_multi_add_handle($multi, $c);
            $handles[] = $c;
        }
        do {
            curl_multi_exec($multi, $running);
            if ($running) curl_multi_select($multi, 0.05);
        } while ($running);
        $out = [];
        foreach ($handles as $c) {
            $raw = (string) curl_multi_getcontent($c);
            $out[] = ['status' => (int) curl_getinfo($c, CURLINFO_RESPONSE_CODE), 'body' => $raw, 'json' => json_decode($raw, true)];
            curl_multi_remove_handle($multi, $c);
            curl_close($c);
        }
        curl_multi_close($multi);
        return $out;
    }

    /** Multipart upload of one file; returns the response. */
    public function upload(string $bytes, string $name, string $query = '', ?string $nonce = null): array
    {
        $b = '----alno' . bin2hex(random_bytes(6));
        $body = "--$b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$name\"\r\nContent-Type: application/octet-stream\r\n\r\n$bytes\r\n--$b--\r\n";
        return $this->raw('POST', '/wp-admin/api.php?r=media/upload' . $query, $body, ["Content-Type: multipart/form-data; boundary=$b", 'X-WP-Nonce: ' . ($nonce ?? $this->nonce)]);
    }

    public function login(string $user, string $password): array
    {
        $s = $this->get('session');
        $r = $this->post('login', ['user' => $user, 'password' => $password], ['X-Login-Nonce: ' . ($s['json']['loginNonce'] ?? '')]);
        if ($r['status'] === 200) $this->nonce = $this->get('session')['json']['nonce'] ?? null;
        return $r;
    }
}

/** One admin + one repository. Ready to log in as `redakteurin` / `admin` unless $setup is false. */
final class Env
{
    public string $data;
    public string $repo;
    public FakeGit $git;
    public Store $store;
    public Server $gh;
    public Server $admin;
    public string $password = 'richtig-gutes-passwort';

    public function __construct(bool $setup = true, int $workers = 1, ?string $seed = null)
    {
        $this->data = tmpDir('alno-data');
        $this->repo = tmpDir('alno-repo');
        $this->git = new FakeGit($this->repo);
        $this->git->seed($seed ?? __DIR__ . '/fixtures/site');
        $this->gh = new Server([__DIR__ . '/fake-github.php'], ['FAKE_GH_DIR' => $this->repo], 4);
        $this->admin = new Server(['-t', WP_ROOT], ['ALNO_DATA_DIR' => $this->data, 'ALNO_GITHUB_API' => "http://127.0.0.1:{$this->gh->port}"], $workers);
        $this->store = new Store($this->data);
        if ($setup) {
            $this->store->writeJson('config.json', ['token' => TEST_TOKEN, 'site_url' => 'https://pflegedienst-alno.de', 'hosts' => ['127.0.0.1'], 'cron_key' => 'test-cron-key', 'created' => gmdate('c')]);
            $auth = new Auth($this->store);
            $auth->addUser('admin', $this->password, true);
            $auth->addUser('redakteurin', $this->password, false);
        }
        register_shutdown_function([$this, 'stop']);
    }

    public function client(): Client
    {
        return new Client("http://127.0.0.1:{$this->admin->port}");
    }

    public function as(string $user): Client
    {
        $c = $this->client();
        $r = $c->login($user, $this->password);
        if ($r['status'] !== 200) throw new RuntimeException("login failed: {$r['body']}");
        return $c;
    }

    /** The admin's own log. */
    public function log(): string
    {
        return (string) @file_get_contents("$this->data/logs/admin.log") . (string) @file_get_contents("$this->data/logs/access.log");
    }

    /** Requests the fake GitHub saw, optionally only those starting with $prefix (`PATCH`, `POST /git`). */
    public function requests(string $prefix = ''): array
    {
        $base = '/repos/' . FakeGit::REPO;
        $lines = explode("\n", trim((string) @file_get_contents("$this->repo/requests.log")));
        $lines = array_map(static fn ($l) => str_replace(" $base", ' ', $l), $lines);
        return array_values(array_filter($lines, static fn ($l) => $l !== '' && strncmp($l, $prefix, strlen($prefix)) === 0));
    }

    public function clearRequests(): void
    {
        @unlink("$this->repo/requests.log");
    }

    /** Runs cron.php on the command line. Returns [exit code, output]. */
    public function cronCli(): array
    {
        $p = proc_open([PHP_BINARY, WP_ROOT . '/wp-admin/cron.php'], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, array_merge(getenv(), ['ALNO_DATA_DIR' => $this->data]));
        $out = (string) stream_get_contents($pipes[1]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        return [proc_close($p), $out];
    }

    /** Stores one submission as the form endpoint does. $files: stored name => bytes. Returns the id. */
    public function anfrage(array $over = [], array $files = [], string $dir = 'anfragen'): string
    {
        $id = $over['id'] ?? (date('Y-m-d-His') . '-' . bin2hex(random_bytes(8)));
        $list = [];
        foreach ($files as $stored => $bytes) {
            $list[] = ['name' => 'Lebenslauf.pdf', 'stored' => $stored, 'size' => strlen($bytes), 'type' => 'application/pdf'];
            $this->store->write("$dir/files/$stored", $bytes);
        }
        $rec = $over + [
            'id' => $id, 'received' => date('c'), 'form' => 'beratung', 'page' => '/kontakt/',
            'fields' => ['name' => 'Ben Beispiel', 'phone' => '0231 654321', 'email' => 'ben@example.org', 'datenschutz' => 'ja'],
            'files' => $list, 'status' => 'neu', 'ip_hash' => 'f63982b1640f5c0f9a9becc2a39bed16',
        ];
        $this->store->write("$dir/$id.json", json_encode($rec, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        return $id;
    }

    public function stop(): void
    {
        $this->admin->stop();
        $this->gh->stop();
        rmTree($this->data);
        rmTree($this->repo);
    }
}

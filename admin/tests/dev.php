<?php
// Local admin against the fake GitHub: php admin/tests/dev.php [--seed=<folder>] [--fresh] [--port=4400] [--setup]
// Nothing here touches the real repository. Seed folder: a copy of the repo layout (default: the
// fixtures). Runs "take" about 8 seconds and end green; see control.json in the fake's folder.
declare(strict_types=1);

require __DIR__ . '/fakegit.php';
require __DIR__ . '/../public/wp-admin/lib/bootstrap.php';

$o = getopt('', ['seed:', 'fresh', 'port:', 'setup']);
$port = (int) ($o['port'] ?? 4400);
$base = sys_get_temp_dir() . "/alno-dev-$port";
if (isset($o['fresh'])) exec('rm -rf ' . escapeshellarg($base));
$dataDir = "$base/data";
$repoDir = "$base/repo";
$new = !is_dir($repoDir);
$git = new FakeGit($repoDir);
if ($new) {
    $git->seed($o['seed'] ?? __DIR__ . '/fixtures/site');
    $git->setControl(['autoRun' => 8]);
}
$store = new Store($dataDir);
if (!isset($o['setup']) && !$store->exists('config.json')) {
    $store->writeJson('config.json', ['token' => 'good-token', 'site_url' => 'https://pflegedienst-alno.de', 'hosts' => ['127.0.0.1'], 'cron_key' => 'dev-cron-key', 'created' => gmdate('c')]);
    (new Auth($store))->addUser('admin', 'dev-passwort-123', true);
    (new Auth($store))->addUser('redakteurin', 'dev-passwort-123', false);
    $id = date('Y-m-d-His-', time() - 86400) . 'aaaabbbbccccdddd';
    $store->write("anfragen/$id.json", json_encode(['id' => $id, 'received' => date('c', time() - 86400), 'form' => 'erstbegutachtung', 'page' => '/erstbegutachtung/', 'fields' => ['name' => 'Berta Beispiel <img src=x onerror=alert(1)>', 'phone' => '0231 123456', 'stadtteil' => 'Hörde', 'email' => 'keine-adresse', 'message' => "Zweizeilig\n<script>alert(2)</script>", 'datenschutz' => 'ja'], 'invalid' => ['email'], 'files' => [], 'files_refused' => 2, 'status' => 'neu', 'ip_hash' => str_repeat('f', 32)], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    $id2 = date('Y-m-d-His-', time() - 3600) . '1111222233334444';
    $stored = str_repeat('6f', 16);
    $store->write("anfragen/files/$stored", "%PDF-1.4 Beispiel\n");
    $store->write("anfragen/$id2.json", json_encode(['id' => $id2, 'received' => date('c', time() - 3600), 'form' => 'karriere', 'page' => '/karriere/', 'fields' => ['position' => 'Pflegefachkraft (m/w/d)', 'name' => 'Ben Beispiel', 'phone' => '0231 654321', 'email' => 'ben@example.org', 'datenschutz' => 'ja'], 'files' => [['name' => 'Lebenslauf.pdf', 'stored' => $stored, 'size' => 18, 'type' => 'application/pdf']], 'status' => 'neu', 'ip_hash' => str_repeat('e', 32)], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    $store->write('anfragen-warnung.json', json_encode(['code' => 'anfragen_voll', 'since' => date('c'), 'used_mb' => 201.3, 'limit_mb' => 200, 'message' => 'Der Speicher für Anfragen ist voll: 201.3 von 200 MB. Bitte erledigte Anfragen löschen.']));
}

$php = PHP_BINARY;
$ghPort = $port + 1;
$env = array_merge(getenv(), ['FAKE_GH_DIR' => $repoDir, 'ALNO_DATA_DIR' => $dataDir, 'ALNO_GITHUB_API' => "http://127.0.0.1:$ghPort", 'PHP_CLI_SERVER_WORKERS' => '4']);
$gh = proc_open([$php, '-d', 'variables_order=EGPCS', '-S', "127.0.0.1:$ghPort", __DIR__ . '/fake-github.php'], [0 => ['file', '/dev/null', 'r'], 1 => ['file', "$base/gh.log", 'a'], 2 => ['file', "$base/gh.log", 'a']], $p1, null, $env);
$admin = proc_open([$php, '-d', 'variables_order=EGPCS', '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public'], [0 => ['file', '/dev/null', 'r'], 1 => ['file', "$base/admin.log", 'a'], 2 => ['file', "$base/admin.log", 'a']], $p2, null, $env);
echo "http://127.0.0.1:$port/wp-admin/  admin / dev-passwort-123   token for setup: good-token\nstate in $base\n";
while (proc_get_status($admin)['running'] && proc_get_status($gh)['running']) sleep(1);

<?php
// Automatic deletion of expired submissions, so that it does not wait for someone to log in.
// konsoleH cron: php /usr/home/<user>/public_html/wp-admin/cron.php, or call the URL with ?key=
// (the key is shown under Anfragen for administrators).
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';

$store = new Store();
$config = $store->readJson('config.json');
if (PHP_SAPI !== 'cli' && (!$config || !hash_equals((string) ($config['cron_key'] ?? "\0"), (string) ($_GET['key'] ?? '')))) {
    http_response_code(403);
    exit;
}
header('Content-Type: text/plain; charset=utf-8');
echo 'deleted: ' . (new Anfragen($store))->purge() . "\n";

<?php
// Automatic deletion of expired submissions, so that it does not wait for someone to log in.
// konsoleH cron: php /usr/home/<user>/public_html/admin-alno/wp-admin/cron.php, or call the URL with ?key=
// (the key is shown under Anfragen for administrators).
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';

$store = new Store();
$config = $store->dir === '' ? null : $store->readJson('config.json');
if ($config === null && !isset($_SERVER['REMOTE_ADDR'])) exit("no data folder\n");
// Over the web there is a client address; a cron job started through php-cgi has none and is no visitor.
if (isset($_SERVER['REMOTE_ADDR']) && (!$config || !hash_equals((string) ($config['cron_key'] ?? "\0"), (string) ($_GET['key'] ?? '')))) {
    http_response_code(403);
    exit;
}
header('Content-Type: text/plain; charset=utf-8');
echo 'deleted: ' . (new Anfragen($store))->purge() . "\n";
Media::prunePending($store);
$store->write('cron-last', gmdate('c'));

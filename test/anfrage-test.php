<?php
// Тесты public/api/anfrage.php: настоящий файл через php -S и настоящий mail() с поддельным sendmail.
// Запуск: php test/anfrage-test.php (для проверки форм нужен dist: PUBLIC_FORM_ENDPOINT=/api/anfrage.php npm run build)
declare(strict_types=1);

const PORT = 18947;
const ROOT = __DIR__ . '/..';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const JPG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';

$tmp = sys_get_temp_dir() . '/anfrage-test-' . bin2hex(random_bytes(4));
$www = "$tmp/www";
$data = "$tmp/alno-data";
$mails = "$tmp/mails";
mkdir("$www/api", 0777, true);
mkdir($mails);
copy(ROOT . '/public/api/anfrage.php', "$www/api/anfrage.php");
file_put_contents("$www/api/anfrage-site.json", json_encode(['email' => 'info@site.example', 'domain' => 'site.example']));
file_put_contents("$tmp/sendmail", "#!/bin/sh\nn=\$(ls '$mails' | wc -l | tr -d ' ')\n{ echo \"ARGS: \$*\"; cat; } > '$mails/'\$n.eml\n[ -f '$tmp/mail-fails' ] && exit 1\nexit 0\n");
chmod("$tmp/sendmail", 0755);

function serve(string $docroot, string $dataDir, int $port): mixed {
  global $tmp;
  $cmd = [PHP_BINARY, '-S', "127.0.0.1:$port", '-t', $docroot, '-d', "sendmail_path=$tmp/sendmail -t -i", '-d', 'post_max_size=64M', '-d', 'opcache.enable=0',
    '-d', 'upload_max_filesize=20M', '-d', 'display_errors=0', '-d', 'log_errors=1', '-d', "error_log=$tmp/php-errors.log"];
  $p = proc_open($cmd, [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, null, ['ALNO_DATA_DIR' => $dataDir, 'PATH' => getenv('PATH')]);
  for ($i = 0; $i < 100; $i++) { $s = @fsockopen('127.0.0.1', $port); if ($s) { fclose($s); return $p; } usleep(50000); }
  throw new RuntimeException('server did not start');
}
$server = serve($www, $data, PORT);

// --- клиент ---
function multipart(array $fields, array $files = []): array {
  $b = '----t' . bin2hex(random_bytes(8));
  $body = '';
  foreach ($fields as $pair) { [$k, $v] = $pair; $body .= "--$b\r\nContent-Disposition: form-data; name=\"$k\"\r\n\r\n$v\r\n"; }
  foreach ($files as $f) { [$field, $name, $type, $bytes] = $f; $body .= "--$b\r\nContent-Disposition: form-data; name=\"$field\"; filename=\"$name\"\r\nContent-Type: $type\r\n\r\n$bytes\r\n"; }
  return ["$body--$b--\r\n", "multipart/form-data; boundary=$b"];
}
function http(string $method, string $body = '', array $headers = [], int $port = PORT, string $path = '/api/anfrage.php'): array {
  $s = fsockopen('127.0.0.1', $port, $e, $es, 5);
  stream_set_timeout($s, 30);
  $req = "$method $path HTTP/1.1\r\nHost: 127.0.0.1:$port\r\nConnection: close\r\n";
  foreach ($headers as $k => $v) if ($v !== null) $req .= "$k: $v\r\n";
  if (!array_key_exists('Content-Length', $headers)) $req .= 'Content-Length: ' . strlen($body) . "\r\n";
  fwrite($s, "$req\r\n$body");
  $raw = stream_get_contents($s);
  fclose($s);
  [$head, $resp] = array_pad(explode("\r\n\r\n", (string) $raw, 2), 2, '');
  preg_match('~^HTTP/1\.[01] (\d+)~', $head, $m);
  return ['status' => (int) ($m[1] ?? 0), 'head' => $head, 'body' => $resp, 'json' => json_decode($resp, true)];
}
function post(array $assoc, array $files = [], array $headers = [], int $port = PORT): array {
  $pairs = [];
  foreach ($assoc as $k => $v) $pairs[] = [$k, $v];
  [$body, $type] = multipart($pairs, $files);
  return http('POST', $body, $headers + ['Origin' => "http://127.0.0.1:$port", 'Content-Type' => $type], $port);
}

// --- данные ---
function rueckruf(array $o = []): array {
  return array_merge(['subject' => 'Website: Rückruf-Anfrage', 'from_page' => '/', 'name' => 'Anna Muster', 'phone' => '0231 123456',
    'rueckrufzeit' => 'Vormittags', 'website' => '', 'datenschutz' => 'on', 'fill_ms' => '5000'], $o);
}
function beratung(array $o = []): array {
  return array_merge(['subject' => 'Website: Kostenlose Beratung', 'from_page' => '/kontakt/', 'leistung' => 'Grundpflege', 'name' => 'Anna Muster',
    'phone' => '0231 123456', 'email' => 'anna@example.org', 'message' => 'Meine Mutter hat Pflegegrad 3.', 'website' => '', 'datenschutz' => 'on', 'fill_ms' => '5000'], $o);
}
function karriere(array $o = []): array {
  return array_merge(['subject' => 'Website: Bewerbung Stelle', 'from_page' => '/karriere/', 'position' => 'Pflegefachkraft', 'name' => 'Ben Beispiel',
    'phone' => '0231 654321', 'email' => 'ben@example.org', 'arbeitszeit' => 'Vollzeit', 'website' => '', 'datenschutz' => 'on', 'fill_ms' => '5000'], $o);
}
function pdf(): string { return "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"; }
function docx(string $extra = ''): string {
  $f = tempnam(sys_get_temp_dir(), 'dx');
  $z = new ZipArchive(); $z->open($f, ZipArchive::OVERWRITE);
  $z->addFromString('[Content_Types].xml', '<Types/>'); $z->addFromString('word/document.xml', '<w:document/>');
  if ($extra !== '') $z->addFromString($extra, 'x');
  $z->close();
  $b = (string) file_get_contents($f); unlink($f);
  return $b;
}

// --- проверки ---
function stored(): array { global $data; return array_values(glob("$data/anfragen/*.json") ?: []); }
function last(): array { $f = stored(); return json_decode((string) file_get_contents(end($f)), true); }
function storedFiles(): array { global $data; return array_values(array_filter(glob("$data/anfragen/files/*") ?: [], 'is_file')); }
function mails(): array { global $mails; return array_values(glob("$mails/*.eml") ?: []); }
function lastMail(): string { $m = mails(); return (string) file_get_contents(end($m)); }
function reset_state(): void {
  global $data, $mails, $tmp;
  foreach (["$data/anfragen/*.json", "$data/anfragen/files/*", "$data/ratelimit/*", "$mails/*"] as $g) foreach (glob($g) ?: [] as $f) if (is_file($f)) unlink($f);
  @unlink("$data/config.php"); @unlink("$tmp/mail-fails");
}
function is_same($a, $b, string $m = ''): void { if ($a !== $b) throw new RuntimeException($m . ' expected ' . var_export($b, true) . ', got ' . var_export($a, true)); }
function ok(bool $c, string $m): void { if (!$c) throw new RuntimeException($m); }
function rejected(array $r, int $status): void {
  is_same($r['status'], $status, 'status');
  is_same($r['json']['ok'] ?? null, false, 'json ok');
  ok(is_string($r['json']['error'] ?? null), 'json error code missing');
  is_same(count(stored()), 0, 'stored after rejection');
  is_same(count(storedFiles()), 0, 'files after rejection');
  is_same(count(mails()), 0, 'mail after rejection');
}
function accepted(array $r): void { is_same($r['status'], 200, 'status (' . $r['body'] . ')'); is_same($r['json']['ok'] ?? null, true, 'json ok'); }

$pass = 0; $fail = [];
function t(string $name, callable $fn): void {
  global $pass, $fail;
  reset_state();
  try { $fn(); $pass++; echo "  ok   $name\n"; }
  catch (Throwable $e) { $fail[] = $name; echo "  FAIL $name\n       " . $e->getMessage() . "\n"; }
}

echo "Запрос\n";
t('GET is 405 with Allow: POST', function () { $r = http('GET'); is_same($r['status'], 405); ok(stripos($r['head'], 'Allow: POST') !== false, 'Allow header'); is_same($r['json']['ok'] ?? null, false); });
t('urlencoded POST is rejected', function () { rejected(http('POST', 'name=x', ['Origin' => 'http://127.0.0.1:' . PORT, 'Content-Type' => 'application/x-www-form-urlencoded']), 415); });
t('response is JSON and not cached', function () { $r = post(rueckruf()); ok(stripos($r['head'], 'application/json') !== false, 'type'); ok(stripos($r['head'], 'no-store') !== false, 'cache'); });
t('foreign Origin is rejected', function () { rejected(post(rueckruf(), [], ['Origin' => 'https://evil.example']), 403); });
t('foreign Referer without Origin is rejected', function () { rejected(post(rueckruf(), [], ['Origin' => null, 'Referer' => 'https://evil.example/x']), 403); });
t('neither Origin nor Referer is rejected', function () { rejected(post(rueckruf(), [], ['Origin' => null]), 403); });
t('own Referer without Origin passes', function () { accepted(post(rueckruf(), [], ['Origin' => null, 'Referer' => 'http://127.0.0.1:' . PORT . '/'])); });
t('body over the limit for a form without files is 413', function () { rejected(post(beratung(['message' => str_repeat('x', 200000)])), 413); });
t('body over the total limit is 413', function () { rejected(http('POST', str_repeat('x', 34 * 1024 * 1024), ['Origin' => 'http://127.0.0.1:' . PORT, 'Content-Type' => 'multipart/form-data; boundary=x']), 413); });

echo "Защита от спама\n";
t('honeypot: looks like success, nothing stored or mailed', function () { $r = post(rueckruf(['website' => 'http://spam.example'])); accepted($r); is_same(count(stored()), 0); is_same(count(mails()), 0); });
t('fill time under 3 s is rejected', function () { rejected(post(rueckruf(['fill_ms' => '2999'])), 422); });
t('fill time of exactly 3 s passes', function () { accepted(post(rueckruf(['fill_ms' => '3000']))); });
t('missing fill time is rejected', function () { $f = rueckruf(); unset($f['fill_ms']); rejected(post($f), 422); });
t('non-numeric fill time is rejected', function () { rejected(post(rueckruf(['fill_ms' => '9e9'])), 422); });
t('rate limit: 5 pass, the 6th is 429 with Retry-After', function () {
  for ($i = 0; $i < 5; $i++) accepted(post(rueckruf()));
  $r = post(rueckruf()); is_same($r['status'], 429); ok(stripos($r['head'], 'Retry-After:') !== false, 'Retry-After'); is_same(count(stored()), 5);
});
t('rate limit: rejected requests count too', function () {
  for ($i = 0; $i < 5; $i++) rejected(post(rueckruf(['fill_ms' => '1'])), 422);
  rejected(post(rueckruf()), 429);
});
t('rate limit: file name holds no IP, window expires', function () {
  global $data;
  file_put_contents("$data/config.php", "<?php return ['rate_max' => 1, 'rate_window' => 1];");
  accepted(post(rueckruf()));
  is_same(post(rueckruf())['status'], 429);
  foreach (glob("$data/ratelimit/*") as $f) { ok(!str_contains(basename($f) . file_get_contents($f), '127.0.0.1'), 'raw IP in rate file'); }
  sleep(2);
  accepted(post(rueckruf()));
});

echo "Белый список\n";
t('unknown field is rejected', function () { rejected(post(rueckruf(['admin' => '1'])), 422); });
t('field of another form is rejected', function () { rejected(post(rueckruf(['message' => 'x'])), 422); });
t('array value is rejected', function () {
  [$b, $t] = multipart([['subject', 'Website: Rückruf-Anfrage'], ['name[]', 'x'], ['phone', '0231 123456'], ['datenschutz', 'on'], ['fill_ms', '5000'], ['website', '']]);
  rejected(http('POST', $b, ['Origin' => 'http://127.0.0.1:' . PORT, 'Content-Type' => $t]), 422);
});
t('unknown subject is rejected', function () { rejected(post(rueckruf(['subject' => 'Website: Hack'])), 422); });
t('missing consent is rejected', function () { $f = rueckruf(); unset($f['datenschutz']); rejected(post($f), 422); });
t('consent with another value is rejected', function () { rejected(post(rueckruf(['datenschutz' => '0'])), 422); });
t('missing name is rejected', function () { rejected(post(rueckruf(['name' => '   '])), 422); });
t('one-letter name is rejected', function () { rejected(post(rueckruf(['name' => 'A'])), 422); });
t('bad phone is rejected', function () { rejected(post(rueckruf(['phone' => 'call me'])), 422); });
t('bad e-mail is rejected', function () { rejected(post(beratung(['email' => 'nope'])), 422); });
t('e-mail is optional on beratung', function () { accepted(post(beratung(['email' => '']))); ok(!isset(last()['fields']['email']), 'empty optional kept'); });
t('e-mail is required on karriere', function () { rejected(post(karriere(['email' => ''])), 422); });
t('bad date is rejected', function () { rejected(post(karriere(['eintritt' => '31.12.2026'])), 422); });
t('impossible date is rejected', function () { rejected(post(karriere(['eintritt' => '2026-02-31'])), 422); });
t('year out of range is rejected', function () { rejected(post(['subject' => 'Website: Bewerbung Ausbildung/Praktikum', 'from_page' => '/ausbildung/', 'wunsch' => 'Praktikum', 'name' => 'Ben B', 'geburtsjahr' => '1200', 'phone' => '0231 654321', 'email' => 'b@example.org', 'schulabschluss' => 'Abitur', 'website' => '', 'datenschutz' => 'on', 'fill_ms' => '5000']), 422); });
t('name of 100 characters passes, 101 is rejected', function () {
  accepted(post(rueckruf(['name' => str_repeat('ü', 100)])));
  reset_state();
  rejected(post(rueckruf(['name' => str_repeat('ü', 101)])), 422);
});
t('invalid UTF-8 in a field name still answers JSON', function () { rejected(post(rueckruf(["na\xC3\x28me" => 'x'])), 422); });
t('invalid UTF-8 is rejected', function () { rejected(post(rueckruf(['name' => "Anna \xC3\x28"])), 422); });

echo "Нормализация и хранение\n";
t('whitespace and control characters are normalised', function () {
  accepted(post(beratung(['name' => "  Anna \t  Muster\x07 ", 'message' => "  Zeile 1\r\n\r\n\r\n\r\nZeile  2\x00  "])));
  $f = last()['fields'];
  is_same($f['name'], 'Anna Muster');
  is_same($f['message'], "Zeile 1\n\nZeile 2");
});
t('record has exactly the documented keys', function () {
  accepted(post(beratung(), [], ['Referer' => 'http://127.0.0.1:' . PORT . '/kontakt/?name=Anna#x']));
  $r = last();
  is_same(array_keys($r), ['id', 'received', 'form', 'page', 'fields', 'files', 'status', 'ip_hash']);
  is_same($r['form'], 'beratung'); is_same($r['status'], 'neu'); is_same($r['files'], []);
  is_same($r['page'], '/kontakt/', 'page has no query');
  ok((bool) preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/', $r['received']), 'ISO 8601: ' . $r['received']);
  is_same(basename(stored()[0]), $r['id'] . '.json');
  ok((bool) preg_match('/^\d{4}-\d\d-\d\d-\d{6}-[0-9a-f]{16}$/', $r['id']), 'id: ' . $r['id']);
  is_same($r['fields']['datenschutz'], 'ja', 'consent kept as evidence');
  foreach (['subject', 'from_page', 'website', 'fill_ms'] as $k) ok(!isset($r['fields'][$k]), "$k in fields");
});
t('raw IP is not stored anywhere', function () {
  global $data;
  accepted(post(beratung()));
  ok((bool) preg_match('/^[0-9a-f]{32}$/', last()['ip_hash']), 'hash format');
  $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($data, FilesystemIterator::SKIP_DOTS));
  foreach ($it as $f) if ($f->isFile()) ok(!str_contains((string) file_get_contents($f->getPathname()), '127.0.0.1'), 'IP in ' . $f->getFilename());
});
t('files are private to the hosting user', function () {
  global $data;
  accepted(post(karriere(), [['dateien[]', 'cv.pdf', 'application/pdf', pdf()]]));
  $mode = fn ($p) => decoct(fileperms($p) & 0777);
  is_same($mode(stored()[0]), '600'); is_same($mode(storedFiles()[0]), '600');
  foreach (["$data", "$data/anfragen", "$data/anfragen/files", "$data/ratelimit"] as $d) is_same($mode($d), '700', $d);
  is_same($mode("$data/salt"), '600');
});
t('page falls back to from_page', function () { accepted(post(beratung(['from_page' => '/leistungen/grundpflege/']))); is_same(last()['page'], '/leistungen/grundpflege/'); });
t('path traversal in from_page and Referer is dropped', function () {
  accepted(post(beratung(['from_page' => '/../../etc/passwd']), [], ['Referer' => 'http://127.0.0.1:' . PORT . '/a/../../b']));
  is_same(last()['page'], '');
});
t('a value cannot steer the storage path', function () {
  global $data, $tmp;
  accepted(post(beratung(['name' => '../../../evil', 'message' => '../evil.json'])));
  is_same(count(glob("$tmp/*.json") ?: []) + count(glob("$data/*.json") ?: []), 0);
  ok(!str_contains(stored()[0], 'evil'), 'name in path');
});
t('data directory inside the web root: fails closed', function () {
  global $tmp;
  $root = "$tmp/www2"; mkdir("$root/api", 0777, true); copy(ROOT . '/public/api/anfrage.php', "$root/api/anfrage.php");
  $p = serve($root, "$root/data", PORT + 1);
  $r = post(rueckruf(), [], [], PORT + 1);
  proc_terminate($p);
  is_same($r['status'], 500); is_same($r['json']['ok'] ?? null, false);
  ok(!is_dir("$root/data/anfragen"), 'data written into the web root');
  is_same(count(mails()), 0);
});
t('storage impossible: 500 and no mail', function () {
  global $tmp;
  file_put_contents("$tmp/plainfile", 'x');
  $p = serve("$tmp/www", "$tmp/plainfile/alno-data", PORT + 2);
  $r = post(rueckruf(), [], [], PORT + 2);
  proc_terminate($p);
  is_same($r['status'], 500); is_same(count(mails()), 0);
});

echo "Письмо\n";
t('one plain-text mail per submission', function () {
  accepted(post(beratung()));
  is_same(count(mails()), 1);
  $m = lastMail();
  ok(str_contains($m, 'text/plain'), 'plain'); ok(str_contains($m, 'charset=UTF-8'), 'charset');
  ok(str_contains($m, 'To: info@site.example') || str_contains($m, 'info@site.example'), 'fallback address');
  ok(str_contains($m, 'From: no-reply@site.example'), 'from');
  ok(str_contains($m, 'Reply-To: anna@example.org'), 'reply-to');
  ok(str_contains($m, 'im Admin unter Anfragen'), 'admin hint');
  ok(str_contains($m, 'Anna Muster') && str_contains($m, '0231 123456'), 'contact data');
});
t('config address wins over the site address', function () {
  global $data;
  file_put_contents("$data/config.php", "<?php return ['anfragen_to' => 'buero@site.example'];");
  accepted(post(beratung()));
  ok(str_contains(lastMail(), 'buero@site.example'), 'config address');
});
t('invalid config address falls back to the site address', function () {
  global $data;
  file_put_contents("$data/config.php", "<?php return ['anfragen_to' => \"x@y.z\\r\\nBcc: v@example.org\"];");
  accepted(post(beratung()));
  ok(str_contains(lastMail(), 'info@site.example'), 'fallback'); ok(stripos(lastMail(), 'Bcc') === false, 'Bcc');
});
t('broken config.php does not lose the submission', function () {
  global $data;
  file_put_contents("$data/config.php", '<?php this is not php');
  accepted(post(beratung()));
  is_same(count(stored()), 1); is_same(count(mails()), 1);
});
t('health details and free text stay out of the mail', function () {
  accepted(post(beratung(['message' => 'GEHEIM-Diagnose Demenz'])));
  ok(!str_contains(lastMail(), 'GEHEIM'), 'message in mail');
});
t('no Reply-To without an e-mail', function () { accepted(post(rueckruf())); ok(stripos(lastMail(), 'Reply-To') === false, 'Reply-To'); });
t('subject carries no personal data', function () {
  accepted(post(beratung(['name' => 'Zacharias Zufall'])));
  preg_match('/^Subject: (.+)$/mi', lastMail(), $m);
  $s = iconv_mime_decode(trim($m[1]));
  ok(str_contains($s, 'Kostenlose Beratung'), 'label: ' . $s); ok(!str_contains($s, 'Zacharias'), 'name in subject');
});
t('header injection through e-mail is rejected', function () { rejected(post(beratung(['email' => "a@example.org\r\nBcc: victim@example.org"])), 422); });
t('header injection through e-mail with a bare LF is rejected', function () { rejected(post(beratung(['email' => "a@example.org\nBcc: victim@example.org"])), 422); });
t('header injection through the name stays in the body', function () {
  accepted(post(beratung(['name' => "Eve\r\nBcc: victim@example.org\r\nSubject: x"])));
  $m = lastMail();
  [$head] = explode("\n\n", str_replace("\r\n", "\n", $m), 2);
  ok(stripos($head, 'Bcc:') === false, 'Bcc header'); is_same(preg_match_all('/^Subject:/mi', $head), 1, 'subject count');
  ok(!preg_match('/^Bcc:/mi', $m), 'Bcc on its own line');
});
t('header injection through a config-free From is impossible: Host is ignored', function () {
  [$b, $t] = multipart(array_map(null, array_keys(beratung()), array_values(beratung())));
  $r = http('POST', $b, ['Origin' => 'http://127.0.0.1:' . PORT, 'Content-Type' => $t, 'X-Forwarded-Host' => "evil.example\r\nBcc: x@y.z"]);
  accepted($r); ok(!str_contains(lastMail(), 'evil.example'), 'host header in mail');
});
t('mail failure keeps the submission', function () {
  global $tmp;
  touch("$tmp/mail-fails");
  accepted(post(beratung()));
  is_same(count(stored()), 1);
});

echo "Файлы\n";
$sent = fn (string $name, string $type, string $bytes) => post(karriere(), [['dateien[]', $name, $type, $bytes]]);
foreach ([['cv.pdf', 'application/pdf', 'pdf', 'application/pdf'], ['foto.jpg', 'image/jpeg', 'jpg', 'image/jpeg'], ['foto.jpeg', 'image/jpeg', 'jpg', 'image/jpeg'], ['bild.PNG', 'image/png', 'png', 'image/png'], ['cv.docx', 'application/octet-stream', 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']] as [$n, $ct, $k, $want]) {
  t("accepts $n by its content", function () use ($sent, $n, $ct, $k, $want) {
    $bytes = ['pdf' => fn () => pdf(), 'jpg' => fn () => base64_decode(JPG), 'png' => fn () => base64_decode(PNG), 'docx' => fn () => docx()][$k]();
    accepted($sent($n, $ct, $bytes));
    $f = last()['files'][0];
    is_same(array_keys($f), ['name', 'stored', 'size', 'type']);
    is_same($f['name'], $n); is_same($f['type'], $want); is_same($f['size'], strlen($bytes));
    ok((bool) preg_match('/^[0-9a-f]{32}$/', $f['stored']), 'stored: ' . $f['stored']);
    is_same(md5_file(storedFiles()[0]), md5($bytes)); is_same(basename(storedFiles()[0]), $f['stored']);
  });
}
t('PHP code named .pdf is rejected', function () use ($sent) { rejected($sent('cv.pdf', 'application/pdf', '<?php system($_GET["c"]);'), 422); });
t('HTML named .pdf is rejected', function () use ($sent) { rejected($sent('cv.pdf', 'application/pdf', '<html><script>alert(1)</script>'), 422); });
t('%PDF not at offset 0 is rejected', function () use ($sent) { rejected($sent('cv.pdf', 'application/pdf', '<?php ?>%PDF-1.4'), 422); });
t('real PDF with a .php name is rejected', function () use ($sent) { rejected($sent('cv.php', 'application/pdf', pdf()), 422); });
t('PNG header without an image is rejected', function () use ($sent) { rejected($sent('a.png', 'image/png', "\x89PNG\r\n\x1a\n<?php"), 422); });
t('PDF renamed to .png is rejected', function () use ($sent) { rejected($sent('a.png', 'image/png', pdf()), 422); });
t('plain ZIP named .docx is rejected', function () use ($sent) {
  $f = tempnam(sys_get_temp_dir(), 'z'); $z = new ZipArchive(); $z->open($f, ZipArchive::OVERWRITE); $z->addFromString('a.txt', 'x'); $z->close();
  $b = (string) file_get_contents($f); unlink($f);
  rejected($sent('cv.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', $b), 422);
});
t('macro document named .docx is rejected', function () use ($sent) { rejected($sent('cv.docx', 'application/octet-stream', docx('word/vbaProject.bin')), 422); });
t('empty file is rejected', function () use ($sent) { rejected($sent('cv.pdf', 'application/pdf', ''), 422); });
t('file of exactly 10 MB passes, one byte more is rejected', function () use ($sent) {
  $big = pdf() . str_repeat('x', 10485760 - strlen(pdf()));
  accepted($sent('cv.pdf', 'application/pdf', $big));
  reset_state();
  rejected($sent('cv.pdf', 'application/pdf', $big . 'x'), 422);
});
t('three files pass, four are rejected', function () {
  $f = fn (int $i) => ['dateien[]', "cv$i.pdf", 'application/pdf', pdf()];
  accepted(post(karriere(), [$f(1), $f(2), $f(3)]));
  is_same(count(last()['files']), 3); is_same(count(storedFiles()), 3);
  reset_state();
  rejected(post(karriere(), [$f(1), $f(2), $f(3), $f(4)]), 422);
});
t('one bad file rejects all, nothing stays', function () {
  rejected(post(karriere(), [['dateien[]', 'ok.pdf', 'application/pdf', pdf()], ['dateien[]', 'bad.pdf', 'application/pdf', '<?php']]), 422);
});
t('files on a form without uploads are rejected', function () { rejected(post(rueckruf(), [['dateien[]', 'cv.pdf', 'application/pdf', pdf()]]), 422); });
t('another upload field is rejected', function () { rejected(post(karriere(), [['evil', 'cv.pdf', 'application/pdf', pdf()]]), 422); });
foreach (['../../evil.pdf', '..\\..\\evil.pdf', '/etc/passwd.pdf', 'a/../../b.pdf'] as $n) {
  t("traversal in file name: $n", function () use ($sent, $n) {
    global $data, $tmp, $www;
    accepted($sent($n, 'application/pdf', pdf()));
    $f = last()['files'][0];
    ok(!preg_match('~[/\\\\]|\.\.~', $f['name']), 'clean name: ' . $f['name']);
    is_same(count(glob("$data/anfragen/*.pdf") ?: []) + count(glob("$data/*.pdf") ?: []) + count(glob("$tmp/*.pdf") ?: []) + count(glob("$www/*/*.pdf") ?: []), 0, 'file outside files/');
    is_same(dirname(storedFiles()[0]), "$data/anfragen/files");
  });
}
t('nothing from a submission lands in the web root', function () {
  global $www;
  accepted(post(karriere(), [['dateien[]', 'cv.pdf', 'application/pdf', pdf()]]));
  $names = array_map(fn ($f) => $f->getFilename(), iterator_to_array(new RecursiveIteratorIterator(new RecursiveDirectoryIterator($www, FilesystemIterator::SKIP_DOTS)), false));
  sort($names); is_same($names, ['anfrage-site.json', 'anfrage.php']);
});

echo "Формы сайта\n";
t('every form in dist is accepted exactly as the browser sends it', function () {
  $files = array_filter(iterator_to_array(new RecursiveIteratorIterator(new RecursiveDirectoryIterator(ROOT . '/dist', FilesystemIterator::SKIP_DOTS)), false), fn ($f) => $f->getExtension() === 'html');
  ok(count($files) > 0, 'dist is empty: build it first');
  $seen = [];
  foreach ($files as $file) {
    $dom = new DOMDocument(); @$dom->loadHTML('<?xml encoding="utf-8">' . file_get_contents($file->getPathname()));
    foreach ((new DOMXPath($dom))->query('//form[@data-lead-form or @data-application-form]') as $form) {
      is_same($form->getAttribute('data-endpoint'), '/api/anfrage.php', 'endpoint in ' . $file->getPathname());
      $id = $form->getAttribute('id');
      if (isset($seen[$id])) continue;
      $seen[$id] = true;
      $v = ['fill_ms' => '5000'];
      foreach ((new DOMXPath($dom))->query('.//input|.//select|.//textarea', $form) as $el) {
        $n = $el->getAttribute('name'); $t = $el->getAttribute('type');
        if ($n === '' || $n === 'website') { if ($n === 'website') $v[$n] = ''; continue; }
        if ($el->nodeName === 'select') { $o = (new DOMXPath($dom))->query('.//option[string-length(@value)>0 or not(@value)]', $el)->item(0); $v[$n] = $o->getAttribute('value') ?: trim($o->textContent); continue; }
        if ($t === 'hidden') { $v[$n] = $n === 'rechner_ergebnis' ? "Pflegegrad 2\n- L01" : $el->getAttribute('value'); continue; }
        if ($t === 'radio') { $v[$n] ??= $el->getAttribute('value'); continue; }
        $v[$n] = match ($t ?: $el->nodeName) { 'checkbox' => 'on', 'tel' => '0231 123456', 'email' => 'x@example.org', 'date' => '2026-12-01', 'number' => '2000', default => 'Testwert' };
      }
      reset_state();
      accepted(post($v, [], ['Referer' => 'http://127.0.0.1:' . PORT . '/test/']));
      foreach ($v as $k => $x) if (!in_array($k, ['subject', 'from_page', 'website', 'fill_ms', 'datenschutz'], true)) ok(isset(last()['fields'][$k]), "$id: $k not stored");
    }
  }
  $ids = array_keys($seen); sort($ids);
  is_same($ids, ['ausbildung-form', 'eb-form', 'karriere-form', 'kontakt-form', 'rc-kontakt', 'rc-termin', 'rueckruf-form', 'svc-form'], 'forms');
});

proc_terminate($server);
exec('rm -rf ' . escapeshellarg($tmp));
printf("\n%d passed, %d failed (PHP %s)\n", $pass, count($fail), PHP_VERSION);
exit($fail ? 1 : 0);

<?php
// Приём заявок с форм сайта. Формат хранения — docs/anfragen-format.md, тесты — test/anfrage-test.php.
// Данные лежат вне веб-корня, в ~/alno-data/: заявки, файлы, счётчики частоты, соль и config.php.
// Персональные данные (Art. 9 DSGVO): в логи не пишем ничего, кроме id заявки; IP храним только как хэш с солью.
declare(strict_types=1);

const MIN_FILL_MS = 3000;
const MAX_BODY_PLAIN = 131072;          // форма без файлов
const MAX_BODY_TOTAL = 33554432;        // три файла по 10 МБ и поля
const MAX_FILE_SIZE = 10485760;
const MAX_FILES = 3;
const RATE_MAX = 5;                     // запросов с одного IP за окно
const RATE_WINDOW = 600;                // секунд
const META_FIELDS = ['subject', 'from_page', 'website', 'fill_ms', 'datenschutz'];
const UPLOAD_FIELD = 'dateien';

// Поле: [тип, максимум символов, обязательное]
const NAME = ['name', 100, true];
const PHONE = ['phone', 40, true];
const EMAIL_OPTIONAL = ['email', 254, false];
const EMAIL_REQUIRED = ['email', 254, true];
const LINE = ['line', 200, false];
const LINE_REQUIRED = ['line', 200, true];
const DATE = ['date', 10, false];
const MESSAGE = ['text', 5000, false];

// Форма определяется скрытым полем subject (задано в ContactForm.astro и ApplicationForm.astro).
// Значения вариантов (leistung, tageszeit …) правятся в админке, поэтому здесь проверяются только имена, тип и длина.
const FORMS = [
  'Website: Kostenlose Beratung' => ['form' => 'beratung', 'label' => 'Kostenlose Beratung', 'fields' => [
    'leistung' => LINE, 'name' => NAME, 'phone' => PHONE, 'email' => EMAIL_OPTIONAL, 'message' => MESSAGE]],
  'Website: Rückruf-Anfrage' => ['form' => 'rueckruf', 'label' => 'Rückruf-Anfrage', 'fields' => [
    'name' => NAME, 'phone' => PHONE, 'rueckrufzeit' => LINE]],
  'Website: Termin Erstbegutachtung' => ['form' => 'erstbegutachtung', 'label' => 'Termin Erstbegutachtung', 'fields' => [
    'leistung' => LINE, 'name' => NAME, 'phone' => PHONE, 'stadtteil' => LINE_REQUIRED, 'wunschtermin' => DATE, 'tageszeit' => LINE,
    'pflegegrad' => LINE, 'email' => EMAIL_OPTIONAL, 'message' => MESSAGE]],
  'Website: Pflege-Rechner (Kontaktdaten)' => ['form' => 'rechner', 'label' => 'Pflege-Rechner (Kontaktdaten)', 'fields' => [
    'rechner_ergebnis' => ['text', 6000, false], 'name' => NAME, 'phone' => PHONE, 'email' => EMAIL_OPTIONAL]],
  'Website: Pflege-Rechner (Beratungstermin)' => ['form' => 'rechnertermin', 'label' => 'Pflege-Rechner (Beratungstermin)', 'fields' => [
    'rechner_ergebnis' => ['text', 6000, false], 'name' => NAME, 'phone' => PHONE, 'wunschtermin' => DATE, 'tageszeit' => LINE]],
  'Website: Bewerbung Stelle' => ['form' => 'karriere', 'label' => 'Bewerbung Stelle', 'uploads' => true, 'fields' => [
    'position' => LINE_REQUIRED, 'name' => NAME, 'phone' => PHONE, 'email' => EMAIL_REQUIRED, 'qualifikation' => ['text', 3000, false],
    'eintritt' => DATE, 'arbeitszeit' => LINE, 'message' => MESSAGE]],
  'Website: Bewerbung Ausbildung/Praktikum' => ['form' => 'ausbildung', 'label' => 'Bewerbung Ausbildung/Praktikum', 'uploads' => true, 'fields' => [
    'wunsch' => LINE, 'name' => NAME, 'geburtsjahr' => ['year', 4, true], 'phone' => PHONE, 'email' => EMAIL_REQUIRED,
    'schulabschluss' => LINE_REQUIRED, 'beginn' => DATE, 'message' => MESSAGE]],
];

const FILE_TYPES = [
  'pdf' => 'application/pdf',
  'jpg' => 'image/jpeg',
  'png' => 'image/png',
  'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const FILE_EXTENSIONS = ['pdf' => 'pdf', 'jpg' => 'jpg', 'jpeg' => 'jpg', 'png' => 'png', 'docx' => 'docx'];

function reply(int $status, array $body, array $headers = []): never {
  http_response_code($status);
  foreach ($headers as $h) header($h);
  echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
  exit;
}

// Формы показывают свой текст (MSG.fail) по статусу ответа; message — для отладки и будущих форм
function fail(int $status, string $error, string $message, array $extra = [], array $headers = []): never {
  reply($status, ['ok' => false, 'error' => $error, 'message' => $message] + $extra, $headers);
}

function invalid(string $field): never {
  fail(422, 'invalid', 'Bitte prüfen Sie Ihre Angaben.', ['field' => $field]);
}

// --- Адрес данных ---

function web_root(): string {
  return realpath(dirname(__DIR__)) ?: dirname(__DIR__);
}

// __DIR__ здесь не годится: на Hetzner ~/public_html может оказаться ссылкой в другое дерево
function data_dir(): string {
  $env = getenv('ALNO_DATA_DIR');
  if (is_string($env) && $env !== '') return rtrim($env, '/');
  $home = '';
  if (function_exists('posix_getpwuid') && function_exists('posix_geteuid')) {
    $user = posix_getpwuid(posix_geteuid());
    $home = is_array($user) ? (string) $user['dir'] : '';
  }
  if ($home === '' || !@is_dir($home)) $home = (string) getenv('HOME');
  if ($home === '' || !@is_dir($home)) $home = dirname(web_root());
  return rtrim($home, '/') . '/alno-data';
}

// Каталог может ещё не существовать: сравниваем по ближайшему существующему родителю
function inside_web_root(string $path): bool {
  $existing = $path;
  $tail = '';
  while (!@file_exists($existing) && dirname($existing) !== $existing) {
    $tail = '/' . basename($existing) . $tail;
    $existing = dirname($existing);
  }
  $full = (realpath($existing) ?: $existing) . $tail;
  return str_starts_with($full . '/', web_root() . '/');
}

function prepare_storage(string $data): void {
  foreach ([$data, "$data/anfragen", "$data/anfragen/files", "$data/ratelimit"] as $dir) {
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) throw new RuntimeException('storage not available');
    @chmod($dir, 0700);
  }
}

function load_config(string $data): array {
  $file = "$data/config.php";
  if (!is_file($file)) return [];
  try {
    $config = include $file;
  } catch (Throwable) {
    error_log('anfrage: config.php not readable');
    return [];
  }
  return is_array($config) ? $config : [];
}

function site_settings(): array {
  $raw = @file_get_contents(__DIR__ . '/anfrage-site.json');
  $site = is_string($raw) ? json_decode($raw, true) : null;
  return is_array($site) ? $site : [];
}

function salt(string $data): string {
  $file = "$data/salt";
  for ($i = 0; $i < 5; $i++) {
    $salt = @file_get_contents($file);
    if (is_string($salt) && strlen($salt) >= 64) return $salt;
    $handle = @fopen($file, 'x');
    if ($handle) {
      $salt = bin2hex(random_bytes(32));
      fwrite($handle, $salt);
      fclose($handle);
      return $salt;
    }
    usleep(20000);
  }
  throw new RuntimeException('salt not available');
}

// --- Проверка запроса ---

function same_origin(): bool {
  $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
  $source = (string) ($_SERVER['HTTP_ORIGIN'] ?? ($_SERVER['HTTP_REFERER'] ?? ''));
  $url = parse_url($source);
  if ($host === '' || !is_array($url) || !isset($url['host'])) return false;
  return strtolower($url['host']) . (isset($url['port']) ? ':' . $url['port'] : '') === $host;
}

// Секунд до следующей попытки, 0 — можно. Отказанные попытки окно не продлевают
function rate_wait(string $file, int $max, int $window): int {
  $handle = @fopen($file, 'c+');
  if (!$handle) throw new RuntimeException('rate limit not available');
  flock($handle, LOCK_EX);
  $now = time();
  $times = json_decode((string) stream_get_contents($handle), true);
  $times = array_values(array_filter(is_array($times) ? $times : [], fn ($t) => is_int($t) && $t > $now - $window));
  $wait = 0;
  if (count($times) >= $max) {
    $wait = max(1, $times[0] + $window - $now);
  } else {
    $times[] = $now;
    rewind($handle);
    ftruncate($handle, 0);
    fwrite($handle, json_encode($times));
  }
  flock($handle, LOCK_UN);
  fclose($handle);
  return $wait;
}

function collect_rate_garbage(string $dir, int $window): void {
  $limit = time() - max($window, 86400);
  foreach (glob("$dir/*") ?: [] as $file) if (@filemtime($file) < $limit) @unlink($file);
}

function char_count(string $s): int {
  return (int) preg_match_all('/./su', $s);
}

function clean_line(string $s): string {
  $s = (string) preg_replace('/\p{Cf}/u', '', $s);
  return trim((string) preg_replace('/[\s\p{Cc}]+/u', ' ', $s));
}

function clean_text(string $s): string {
  $s = str_replace(["\r\n", "\r"], "\n", $s);
  $s = (string) preg_replace('/\p{Cf}/u', '', $s);
  $s = (string) preg_replace('/[^\S\n]+|[^\P{Cc}\n]+/u', ' ', $s);
  $s = (string) preg_replace('/[ ]+/', ' ', $s);
  $s = (string) preg_replace('/ ?\n ?/', "\n", $s);
  return trim((string) preg_replace('/\n{3,}/', "\n\n", $s));
}

function valid_date(string $s): bool {
  return preg_match('/^(\d{4})-(\d\d)-(\d\d)$/', $s, $m) === 1 && checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
}

function valid_value(string $type, string $v): bool {
  return match ($type) {
    'name' => char_count($v) >= 2,
    'phone' => preg_match('~^[0-9 +()/\-]{6,}$~', $v) === 1,
    'email' => filter_var($v, FILTER_VALIDATE_EMAIL) !== false,
    'date' => valid_date($v),
    'year' => preg_match('/^\d{4}$/', $v) === 1 && (int) $v >= 1900 && (int) $v <= (int) date('Y'),
    default => true,
  };
}

// Имя вне белого списка, массив вместо строки, битый UTF-8, лишняя длина — отказ всей заявки
function read_fields(array $form): array {
  foreach ($_POST as $key => $value) {
    if (!is_string($value)) invalid((string) $key);
    if (!isset($form['fields'][$key]) && !in_array($key, META_FIELDS, true)) invalid((string) $key);
    if (preg_match('//u', $value) !== 1) invalid((string) $key);
  }
  $fields = [];
  foreach ($form['fields'] as $key => [$type, $max, $required]) {
    $raw = $_POST[$key] ?? '';
    $value = $type === 'text' ? clean_text($raw) : clean_line($raw);
    if ($value === '') {
      if ($required) invalid($key);
      continue;
    }
    if (char_count($value) > $max || !valid_value($type, $value)) invalid($key);
    $fields[$key] = $value;
  }
  if (($_POST['datenschutz'] ?? '') !== 'on') invalid('datenschutz');
  $fields['datenschutz'] = 'ja';
  return $fields;
}

function page_path(): string {
  $referer = parse_url((string) ($_SERVER['HTTP_REFERER'] ?? ''), PHP_URL_PATH);
  foreach ([$referer, $_POST['from_page'] ?? null] as $path) {
    if (is_string($path) && strlen($path) <= 200 && !str_contains($path, '..') && preg_match('~^/[a-zA-Z0-9/_.-]*$~', $path) === 1) return $path;
  }
  return '';
}

// --- Файлы ---

function is_image(string $path, int $type): bool {
  $info = @getimagesize($path);
  return is_array($info) && $info[2] === $type;
}

function is_docx(string $path): bool {
  $bytes = (string) file_get_contents($path);
  return str_contains($bytes, '[Content_Types].xml') && str_contains($bytes, 'word/document.xml') && !str_contains($bytes, 'vbaProject.bin');
}

// Тип определяется только по содержимому; присланным Content-Type и расширением не верим
function sniff(string $path): ?string {
  $handle = @fopen($path, 'rb');
  if (!$handle) return null;
  $head = (string) fread($handle, 8);
  fclose($handle);
  if (str_starts_with($head, '%PDF-')) return 'pdf';
  if (str_starts_with($head, "\xFF\xD8\xFF")) return is_image($path, IMAGETYPE_JPEG) ? 'jpg' : null;
  if (str_starts_with($head, "\x89PNG\r\n\x1A\n")) return is_image($path, IMAGETYPE_PNG) ? 'png' : null;
  if (str_starts_with($head, "PK\x03\x04")) return is_docx($path) ? 'docx' : null;
  return null;
}

// Имя файла клиента только для показа: в пути на диске оно не участвует
function clean_file_name(string $name, string $extension): string {
  $name = clean_line(basename(str_replace('\\', '/', $name)));
  $name = str_replace('..', '.', $name);
  $stem = preg_replace('/\.[^.]*$/', '', $name);
  return (char_count($name) <= 120 && $stem !== '') ? $name : 'Datei.' . $extension;
}

function read_uploads(array $form): array {
  $keys = array_keys($_FILES);
  if ($keys === []) return [];
  if (empty($form['uploads']) || $keys !== [UPLOAD_FIELD] || !is_array($_FILES[UPLOAD_FIELD]['name'])) invalid((string) $keys[0]);
  $set = $_FILES[UPLOAD_FIELD];
  $files = [];
  foreach (array_keys($set['name']) as $i) {
    if (!is_string($set['name'][$i])) invalid(UPLOAD_FIELD);
    if ($set['error'][$i] === UPLOAD_ERR_NO_FILE && $set['name'][$i] === '') continue;
    if ($set['error'][$i] !== UPLOAD_ERR_OK || !is_uploaded_file($set['tmp_name'][$i])) invalid(UPLOAD_FIELD);
    $size = (int) filesize($set['tmp_name'][$i]);
    if ($size === 0 || $size > MAX_FILE_SIZE || preg_match('//u', $set['name'][$i]) !== 1) invalid(UPLOAD_FIELD);
    $kind = sniff($set['tmp_name'][$i]);
    $extension = strtolower(pathinfo(str_replace('\\', '/', $set['name'][$i]), PATHINFO_EXTENSION));
    if ($kind === null || (FILE_EXTENSIONS[$extension] ?? null) !== $kind) invalid(UPLOAD_FIELD);
    $files[] = ['tmp' => $set['tmp_name'][$i], 'name' => clean_file_name($set['name'][$i], $extension), 'size' => $size, 'type' => FILE_TYPES[$kind]];
  }
  if (count($files) > MAX_FILES) invalid(UPLOAD_FIELD);
  return $files;
}

// Файлы переносятся только после проверки всей заявки. Сбой посередине убирает уже перенесённые
function store_uploads(array $uploads, string $dir): array {
  $stored = [];
  foreach ($uploads as $file) {
    $name = bin2hex(random_bytes(16));
    if (!move_uploaded_file($file['tmp'], "$dir/$name")) {
      foreach ($stored as $done) @unlink("$dir/{$done['stored']}");
      throw new RuntimeException('upload not stored');
    }
    @chmod("$dir/$name", 0600);
    $stored[] = ['name' => $file['name'], 'stored' => $name, 'size' => $file['size'], 'type' => $file['type']];
  }
  return $stored;
}

// Запись через временный файл: админка никогда не увидит половину заявки
function store_record(array $record, string $dir): void {
  $json = json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);
  $tmp = "$dir/.{$record['id']}.tmp";
  if (file_put_contents($tmp, $json . "\n") === false || !rename($tmp, "$dir/{$record['id']}.json")) {
    @unlink($tmp);
    throw new RuntimeException('record not stored');
  }
}

// --- Письмо ---

function valid_address(mixed $v): ?string {
  return is_string($v) && strlen($v) <= 254 && filter_var($v, FILTER_VALIDATE_EMAIL) !== false ? $v : null;
}

function mail_from(array $config, array $site): ?string {
  $from = valid_address($config['mail_from'] ?? null);
  if ($from !== null) return $from;
  $domain = (string) ($site['domain'] ?? '');
  if ($domain === '') $domain = substr(strrchr((string) ($site['email'] ?? ''), '@') ?: '@', 1);
  return valid_address("no-reply@$domain");
}

// Только контакт, чтобы перезвонить: письмо идёт через чужие серверы, поэтому текст и данные о здоровье
// остаются на сервере. Тема — метка формы из FORMS, From и Reply-To — только проверенные адреса.
function send_notification(array $record, array $form, array $config, array $site): void {
  $to = valid_address($config['anfragen_to'] ?? null) ?? valid_address($site['email'] ?? null);
  $from = mail_from($config, $site);
  if ($to === null || $from === null) {
    error_log("anfrage: no mail address, {$record['id']} stored only");
    return;
  }
  $f = $record['fields'];
  $lines = ['Neue Anfrage über die Website', '', 'Formular: ' . $form['label'], 'Eingegangen: ' . date('d.m.Y, H:i') . ' Uhr'];
  if ($record['page'] !== '') $lines[] = 'Seite: ' . $record['page'];
  $lines[] = '';
  $lines[] = 'Name: ' . $f['name'];
  $lines[] = 'Telefon: ' . $f['phone'];
  if (isset($f['email'])) $lines[] = 'E-Mail: ' . $f['email'];
  $lines[] = '';
  $lines[] = 'Alle Angaben finden Sie im Admin unter Anfragen.';
  if ($record['files']) $lines[] = 'Dateien: ' . count($record['files']) . ' (bleiben auf dem Server, im Admin unter Anfragen)';
  $lines[] = 'Vorgang: ' . $record['id'];

  $headers = ["From: $from", 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', 'Auto-Submitted: auto-generated'];
  $reply = valid_address($f['email'] ?? null);
  if ($reply !== null) $headers[] = "Reply-To: $reply";
  $subject = '=?UTF-8?B?' . base64_encode('Neue Anfrage: ' . $form['label']) . '?=';
  if (!mail($to, $subject, implode("\r\n", $lines) . "\r\n", implode("\r\n", $headers), "-f$from")) {
    error_log("anfrage: mail not sent, {$record['id']} stored");
  }
}

// --- Запрос ---

function handle(): never {
  if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, 'method', 'Nur POST.', [], ['Allow: POST']);
  if (!str_starts_with(strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? '')), 'multipart/form-data')) fail(415, 'content_type', 'Falsches Format.');
  $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
  if ($length <= 0 || $length > MAX_BODY_TOTAL) fail(413, 'too_large', 'Die Anfrage ist zu groß.');
  if (!same_origin()) fail(403, 'origin', 'Anfrage nicht erlaubt.');

  $data = data_dir();
  if (inside_web_root($data)) throw new RuntimeException('data directory inside the web root');
  prepare_storage($data);
  $config = load_config($data);
  $salt = salt($data);

  $ipHash = substr(hash_hmac('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? ''), $salt), 0, 32);
  $window = (int) ($config['rate_window'] ?? RATE_WINDOW);
  if (random_int(1, 50) === 1) collect_rate_garbage("$data/ratelimit", $window);
  $wait = rate_wait("$data/ratelimit/$ipHash", (int) ($config['rate_max'] ?? RATE_MAX), $window);
  if ($wait > 0) fail(429, 'rate_limit', 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.', [], ["Retry-After: $wait"]);

  // PHP отбрасывает тело сверх post_max_size: тогда здесь пусто
  if ($_POST === [] && $_FILES === []) fail(413, 'too_large', 'Die Anfrage ist zu groß.');

  // Ловушка: бот видит успех, но заявка не сохраняется. Живого посетителя браузер останавливает раньше
  if (($_POST['website'] ?? '') !== '') reply(200, ['ok' => true]);
  $fill = $_POST['fill_ms'] ?? '';
  if (!is_string($fill) || preg_match('/^\d{1,12}$/', $fill) !== 1 || (int) $fill < MIN_FILL_MS) fail(422, 'spam', 'Bitte versuchen Sie es erneut.');

  $form = FORMS[is_string($_POST['subject'] ?? null) ? $_POST['subject'] : ''] ?? null;
  if ($form === null) invalid('subject');
  if (empty($form['uploads']) && $length > MAX_BODY_PLAIN) fail(413, 'too_large', 'Die Anfrage ist zu groß.');

  $fields = read_fields($form);
  $uploads = read_uploads($form);

  $id = date('Y-m-d-His') . '-' . bin2hex(random_bytes(8));
  $files = store_uploads($uploads, "$data/anfragen/files");
  $record = ['id' => $id, 'received' => date('c'), 'form' => $form['form'], 'page' => page_path(), 'fields' => $fields, 'files' => $files, 'status' => 'neu', 'ip_hash' => $ipHash];
  try {
    store_record($record, "$data/anfragen");
  } catch (Throwable $e) {
    foreach ($files as $file) @unlink("$data/anfragen/files/{$file['stored']}");
    throw $e;
  }
  // Сбой письма заявку не теряет: она уже на сервере
  send_notification($record, $form, $config, site_settings());
  reply(200, ['ok' => true]);
}

umask(0077);
ini_set('display_errors', '0');
date_default_timezone_set('Europe/Berlin');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex');
header('Cache-Control: no-store');
try {
  handle();
} catch (Throwable $e) {
  error_log('anfrage: ' . $e->getMessage());
  fail(500, 'storage', 'Die Anfrage konnte nicht gespeichert werden.');
}

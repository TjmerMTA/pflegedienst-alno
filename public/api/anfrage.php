<?php
// Приём заявок с форм сайта. Формат хранения — docs/anfragen-format.md, тесты — test/anfrage-test.php.
// Правила полей — src/config/form-rules.json, те же, что у форм; при сборке попадают в anfrage-site.json.
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
const ANFRAGEN_MAX_MB = 200;            // предел каталога anfragen/, в config.php — anfragen_max_mb
const ANFRAGEN_HARD_STOP = 1.1;         // выше предела текстовые заявки ещё пишем, дальше 503
const WARNING_FILE = 'anfragen-warnung.json';

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

// Строго хост и порт: parse_url прощает «http://evil\\@host», браузер такого не присылает
function same_origin(): bool {
  $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
  $source = (string) ($_SERVER['HTTP_ORIGIN'] ?? ($_SERVER['HTTP_REFERER'] ?? ''));
  if ($host === '' || preg_match('~^https?://([a-z0-9.-]+(?::\d+)?)(?:[/?#]|$)~i', $source, $m) !== 1) return false;
  return strtolower($m[1]) === $host;
}

// Счётчик и хэш: IPv6-клиент владеет целой /64, поэтому считаем её, а не адрес
function rate_key(string $ip): string {
  $bin = @inet_pton($ip);
  if ($bin === false || strlen($bin) !== 16 || str_starts_with($bin, str_repeat("\0", 10) . "\xFF\xFF")) return $ip;
  return bin2hex(substr($bin, 0, 8));
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

function valid_value(array $rule, string $v): bool {
  if (char_count($v) < ($rule['min'] ?? 0) || char_count($v) > $rule['max']) return false;
  if (isset($rule['pattern']) && preg_match('~^(?:' . $rule['pattern'] . ')$~D', $v) !== 1) return false;
  return match ($rule['kind']) {
    'date' => valid_date($v),
    'year' => preg_match('/^\d{4}$/', $v) === 1 && (int) $v >= $rule['firstYear'] && (int) $v <= (int) date('Y') - $rule['minAge'],
    default => true,
  };
}

function cut_chars(string $s, int $max): string {
  return preg_match('/^.{0,' . $max . '}/su', $s, $m) === 1 ? rtrim($m[0]) : '';
}

// Имя вне белого списка, массив вместо строки, битый UTF-8 — отказ всей заявки. Обязательное поле с ошибкой тоже
// (форма покажет, какое). Необязательное заявку не роняет: значение сохраняется, имя поля попадает в invalid.
function read_fields(array $form, array $rules): array {
  foreach ($_POST as $key => $value) {
    if (!is_string($value)) invalid((string) $key);
    if (!isset($form['fields'][$key]) && !in_array($key, META_FIELDS, true)) invalid((string) $key);
    if (preg_match('//u', $value) !== 1) invalid((string) $key);
  }
  $fields = [];
  $flagged = [];
  foreach ($form['fields'] as $key => $required) {
    $rule = $rules['fields'][$key];
    $raw = $_POST[$key] ?? '';
    $value = in_array($rule['kind'], ['text', 'summary'], true) ? clean_text($raw) : clean_line($raw);
    if ($value === '') {
      if ($required) invalid($key);
      continue;
    }
    // Итог расчёта посетитель не видит и исправить не может
    if ($rule['kind'] === 'summary') $value = cut_chars($value, $rule['max']);
    if (!valid_value($rule, $value)) {
      if ($required) invalid($key);
      $value = cut_chars($value, $rule['max']);
      $flagged[] = $key;
    }
    $fields[$key] = $value;
  }
  if (($_POST['datenschutz'] ?? '') !== 'on') invalid('datenschutz');
  $fields['datenschutz'] = 'ja';
  return [$fields, $flagged];
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

// Настоящий ZIP с документом Word и без объявленных макросов. Без расширения zip DOCX не принимаем
function is_docx(string $path): bool {
  if (!class_exists('ZipArchive')) return false;
  $zip = new ZipArchive();
  if ($zip->open($path, ZipArchive::CHECKCONS) !== true) return false;
  $types = $zip->getFromName('[Content_Types].xml');
  $ok = is_string($types) && $zip->locateName('word/document.xml') !== false && $zip->locateName('word/vbaProject.bin') === false
    && str_contains($types, 'wordprocessingml.document.main+xml') && stripos($types, 'vbaProject') === false && stripos($types, 'macroEnabled') === false;
  $zip->close();
  return $ok;
}

function is_pdf(string $path): bool {
  $handle = @fopen($path, 'rb');
  if (!$handle) return false;
  fseek($handle, -min(1024, (int) filesize($path)), SEEK_END);
  $tail = (string) fread($handle, 1024);
  fclose($handle);
  return str_contains($tail, '%%EOF');
}

// Тип определяется только по содержимому; присланным Content-Type и расширением не верим
function sniff(string $path): ?string {
  $handle = @fopen($path, 'rb');
  if (!$handle) return null;
  $head = (string) fread($handle, 8);
  fclose($handle);
  if (str_starts_with($head, '%PDF-')) return is_pdf($path) ? 'pdf' : null;
  if (str_starts_with($head, "\xFF\xD8\xFF")) return is_image($path, IMAGETYPE_JPEG) ? 'jpg' : null;
  if (str_starts_with($head, "\x89PNG\r\n\x1A\n")) return is_image($path, IMAGETYPE_PNG) ? 'png' : null;
  if (str_starts_with($head, "PK\x03\x04")) return is_docx($path) ? 'docx' : null;
  return null;
}

// Имя файла клиента только для показа: в пути на диске оно не участвует
function clean_file_name(string $name, string $extension): string {
  $name = clean_line(basename(str_replace('\\', '/', $name)));
  $name = str_replace(['..', '<', '>', '"'], ['.', '_', '_', '_'], $name);
  $stem = preg_replace('/\.[^.]*$/', '', $name);
  return (char_count($name) <= 120 && $stem !== '') ? $name : 'Datei.' . $extension;
}

// Поля для файлов на сайте нет, поэтому по умолчанию любой файл — отказ. Включается ключом uploads в config.php
function read_uploads(bool $allowed): array {
  $keys = array_keys($_FILES);
  if ($keys === []) return [];
  if (!$allowed || $keys !== [UPLOAD_FIELD] || !is_array($_FILES[UPLOAD_FIELD]['name'])) invalid((string) $keys[0]);
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

// Размер заявок и файлов. Предупреждение для панели админки лежит рядом, в размер не входит
function anfragen_bytes(string $dir): int {
  $sum = 0;
  foreach ([...(glob("$dir/*.json") ?: []), ...(glob("$dir/files/*") ?: [])] as $file) $sum += (int) @filesize($file);
  return $sum;
}

function update_warning(string $data, int $used, int $limit): void {
  $file = "$data/" . WARNING_FILE;
  if ($used < $limit) {
    @unlink($file);
    return;
  }
  $old = json_decode((string) @file_get_contents($file), true);
  $mb = fn (int $bytes) => round($bytes / 1048576, 1);
  $limitMb = (int) round($limit / 1048576);
  $warning = ['code' => 'anfragen_voll', 'since' => is_array($old) && isset($old['since']) ? $old['since'] : date('c'), 'used_mb' => $mb($used), 'limit_mb' => $limitMb,
    'message' => "Der Speicher für Anfragen ist voll: {$mb($used)} von $limitMb MB. Bitte erledigte Anfragen löschen."];
  $tmp = "$file.tmp";
  if (file_put_contents($tmp, json_encode($warning, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n") !== false) @rename($tmp, $file);
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
// остаются на сервере. Тема — метка формы из правил, From и Reply-To — только проверенные адреса.
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
  $emailOk = isset($f['email']) && !in_array('email', $record['invalid'], true);
  if (isset($f['email'])) $lines[] = 'E-Mail: ' . $f['email'] . ($emailOk ? '' : ' (ungültig)');
  $lines[] = '';
  $lines[] = 'Alle Angaben finden Sie im Admin unter Anfragen.';
  if ($record['files']) $lines[] = 'Dateien: ' . count($record['files']) . ' (bleiben auf dem Server, im Admin unter Anfragen)';
  if (isset($record['files_refused'])) $lines[] = 'Dateien nicht gespeichert: ' . $record['files_refused'] . ' (Speicher voll)';
  $lines[] = 'Vorgang: ' . $record['id'];

  $headers = ["From: $from", 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: 8bit', 'Auto-Submitted: auto-generated'];
  $reply = $emailOk ? valid_address($f['email']) : null;
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
  $site = site_settings();
  $rules = $site['rules'] ?? null;
  if (!is_array($rules)) throw new RuntimeException('form rules not available');

  $ipHash = substr(hash_hmac('sha256', rate_key((string) ($_SERVER['REMOTE_ADDR'] ?? '')), $salt), 0, 32);
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

  $form = $rules['forms'][is_string($_POST['subject'] ?? null) ? $_POST['subject'] : ''] ?? null;
  if ($form === null) invalid('subject');
  $uploadsAllowed = !empty($config['uploads']) && !empty($form['uploads']);
  if (!$uploadsAllowed && $length > MAX_BODY_PLAIN) fail(413, 'too_large', 'Die Anfrage ist zu groß.');

  [$fields, $flagged] = read_fields($form, $rules);
  $uploads = read_uploads($uploadsAllowed);

  // Предел достигнут: файлы не берём, но текстовая заявка важнее порядка. Дальше — только 503
  $limit = (int) (((int) ($config['anfragen_max_mb'] ?? ANFRAGEN_MAX_MB)) * 1048576);
  $used = anfragen_bytes("$data/anfragen");
  if ($used >= (int) ($limit * ANFRAGEN_HARD_STOP)) {
    update_warning($data, $used, $limit);
    fail(503, 'storage_full', 'Der Speicher ist voll.');
  }
  $refused = $used >= $limit ? count($uploads) : 0;
  if ($refused > 0) $uploads = [];

  $id = date('Y-m-d-His') . '-' . bin2hex(random_bytes(8));
  $files = store_uploads($uploads, "$data/anfragen/files");
  $record = ['id' => $id, 'received' => date('c'), 'form' => $form['form'], 'page' => page_path(), 'fields' => $fields, 'invalid' => $flagged, 'files' => $files, 'status' => 'neu', 'ip_hash' => $ipHash];
  if ($refused > 0) $record['files_refused'] = $refused;
  try {
    store_record($record, "$data/anfragen");
  } catch (Throwable) {
    foreach ($files as $file) @unlink("$data/anfragen/files/{$file['stored']}");
    update_warning($data, max($used, $limit), $limit);
    error_log("anfrage: $id not stored");
    fail(503, 'storage_full', 'Der Speicher ist voll.');
  }
  update_warning($data, anfragen_bytes("$data/anfragen"), $limit);
  // Сбой письма заявку не теряет: она уже на сервере
  send_notification($record, $form, $config, $site);
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

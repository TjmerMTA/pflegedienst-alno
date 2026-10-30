<?php
// Where the data folder is, one answer for the form endpoint and the admin. The admin has a copy of this file in
// wp-admin/lib, because it is uploaded on its own: a test and scripts/assemble-upload.sh refuse if the two differ.
// Everything is decided by real paths. A folder's name says nothing: ~/public_html can be a link into another tree.
declare(strict_types=1);

function alno_home(): string
{
    $home = '';
    if (function_exists('posix_getpwuid') && function_exists('posix_geteuid')) {
        $user = posix_getpwuid(posix_geteuid());
        $home = is_array($user) ? (string) $user['dir'] : '';
    }
    if ($home === '' || !@is_dir($home)) $home = (string) getenv('HOME');
    return $home !== '' && @is_dir($home) ? rtrim($home, '/') : '';
}

// Beside the site's web root: both sides find it from their own real path, without HOME and without a name.
function alno_setting_file(string $siteRoot): string
{
    return dirname($siteRoot) . '/.alno-data-dir';
}

/** ALNO_DATA_DIR, then the path fixed at setup, then ~/alno-data until setup has run. '' = unknown: no guessing. */
function alno_data_dir(string $siteRoot): string
{
    $env = getenv('ALNO_DATA_DIR');
    if (is_string($env) && $env !== '') return rtrim($env, '/');
    $file = alno_setting_file($siteRoot);
    if (is_file($file)) {
        $saved = trim((string) @file_get_contents($file));
        return preg_match('~^/[^\x00-\x1f]*$~D', $saved) === 1 && preg_match('~(^|/)\.\.(/|$)~', $saved) === 0 ? rtrim($saved, '/') : '';
    }
    $home = alno_home();
    return $home === '' ? '' : "$home/alno-data";
}

/**
 * Written once, at setup, also when ALNO_DATA_DIR gave the path: a SetEnv in public_html/.htaccess is gone after
 * the next deploy, this file never is. False if the host does not let us; ~/alno-data is then what both sides find.
 */
function alno_fix_data_dir(string $siteRoot, string $dir): bool
{
    $file = alno_setting_file($siteRoot);
    if (is_file($file)) return true;
    if (@file_put_contents($file, "$dir\n", LOCK_EX) === false) return false;
    return @chmod($file, 0600);
}

/** Real paths of everything a URL can reach. */
function alno_web_roots(string $siteRoot): array
{
    $home = alno_home();
    $all = [$siteRoot, (string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), $home === '' ? '' : "$home/public_html"];
    return array_values(array_unique(array_filter(array_map(static fn ($p) => $p === '' ? false : realpath($p), $all))));
}

/** Whether a path or any of its parents, resolved, lies in one of the roots. The folder need not exist yet. */
function alno_inside_web(string $path, array $roots): bool
{
    for ($p = $path;; $p = dirname($p)) {
        $real = $p === '' ? false : realpath($p);
        if ($real !== false) {
            foreach ($roots as $root) {
                if (strncmp("$real/", "$root/", strlen($root) + 1) === 0) return true;
            }
        }
        if ($p === dirname($p)) return false;
    }
}

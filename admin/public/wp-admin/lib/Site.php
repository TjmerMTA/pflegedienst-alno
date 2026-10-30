<?php
// The site's content as it is in the repository: page files, Markdown collections, the image library.
declare(strict_types=1);

final class Json
{
    /** Exactly what JSON.stringify(data, null, 2) writes, so that files stay byte-identical. */
    public static function stringify($v, string $indent = ''): string
    {
        if (is_array($v)) {
            if ($v === []) return '[]';
            $inner = $indent . '  ';
            $parts = [];
            if (array_is_list($v)) {
                foreach ($v as $x) $parts[] = $inner . self::stringify($x, $inner);
                return "[\n" . implode(",\n", $parts) . "\n$indent]";
            }
            foreach ($v as $k => $x) $parts[] = $inner . self::scalar((string) $k) . ': ' . self::stringify($x, $inner);
            return "{\n" . implode(",\n", $parts) . "\n$indent}";
        }
        return self::scalar($v);
    }

    private static function scalar($v): string
    {
        return (string) json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS);
    }
}

final class Site
{
    const PAGES = 'src/content/pages/';
    const CONTENT = 'src/content/';
    const IMG = 'src/assets/img/';
    const IMAGE_MIME = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];

    private GitHub $gh;
    private Store $store;
    private array $collections;

    public function __construct(GitHub $gh, Store $store)
    {
        $this->gh = $gh;
        $this->store = $store;
        $this->collections = json_decode((string) file_get_contents(__DIR__ . '/../schema/collections.json'), true);
    }

    public function collections(): array { return $this->collections; }

    public function collectionOf(string $postType): ?string
    {
        foreach ($this->collections as $key => $c) if ($c['postType'] === $postType) return $key;
        return null;
    }

    // ---------------- pages ----------------

    public function listPages(): array
    {
        $out = [];
        foreach ($this->gh->under(self::PAGES) as $path => $e) {
            $name = substr($path, strlen(self::PAGES));
            if (substr($name, -5) !== '.json') continue;
            $id = substr($name, 0, -5);
            if (!preg_match(Rules::PAGE_ID_RE, $id)) continue;
            $page = json_decode($this->gh->blob($e['sha']), true);
            if (!is_array($page)) { $out[] = ['id' => $id, 'label' => $id, 'url' => null, 'order' => 9999, 'error' => 'JSON', 'structureErrors' => []]; continue; }
            $out[] = ['id' => $id, 'label' => $page['label'] ?? $id, 'url' => $page['url'] ?? null, 'order' => (int) ($page['order'] ?? 999), 'structureErrors' => Rules::checkStructure($page)];
        }
        usort($out, static fn ($a, $b) => [$a['id'] === '_global', $a['order'], $a['label']] <=> [$b['id'] === '_global', $b['order'], $b['label']]);
        return $out;
    }

    public function page(string $id): ?array
    {
        if (!preg_match(Rules::PAGE_ID_RE, $id)) return null;
        $f = $this->gh->file(self::PAGES . "$id.json");
        if (!$f) return null;
        $page = json_decode($f['content'], true);
        return [
            'path' => self::PAGES . "$id.json", 'hash' => $f['sha'], 'text' => $f['content'], 'page' => is_array($page) ? $page : null,
            'structureErrors' => is_array($page) ? Rules::checkStructure($page) : [['path' => 'JSON', 'msg' => json_last_error_msg()]],
        ];
    }

    /** Editors' words in a commit message must not switch off the build. */
    public static function commitLabel(string $s): string
    {
        return Rules::trim((string) preg_replace('/\[\s*(?:skip\s+ci|ci\s+skip|no\s+ci|skip\s+actions|actions\s+skip)\s*\]|\*\*\*NO_CI\*\*\*/i', '', str_replace("\n", ' ', $s)));
    }

    public static function serializePage(array $page): string
    {
        return Json::stringify($page) . "\n";
    }

    /** Token keys available as {{key}}: fields of group `contact` in _global.json. */
    public static function tokenKeys(?array $global): array
    {
        foreach ($global['groups'] ?? [] as $g) {
            if (($g['id'] ?? null) !== 'contact' || !is_array($g['fields'] ?? null)) continue;
            return array_values(array_map(static fn ($f) => $f['id'], array_filter($g['fields'], static fn ($f) => $f['type'] !== 'list' && $f['type'] !== 'image')));
        }
        return [];
    }

    public function tokens(): array
    {
        return self::tokenKeys($this->page('_global')['page'] ?? null);
    }

    // What a save would have cleaned; validation then sees the same value a save would store.
    private static function restored($v, string $type)
    {
        if (!is_string($v)) return $v;
        return $type === 'richtext' ? Rules::cleanBody($v) : Rules::cleanText($v, $type === 'textarea');
    }

    /** Values of an old version poured into the current structure. */
    public static function mergeOldValues(array $current, array $old): array
    {
        foreach ($current['groups'] as $gi => $g) {
            $og = null;
            foreach ($old['groups'] ?? [] as $x) if (($x['id'] ?? null) === $g['id']) $og = $x;
            if (!$og) continue;
            foreach ($g['fields'] as $fi => $f) {
                $of = null;
                foreach ($og['fields'] ?? [] as $x) if (($x['id'] ?? null) === $f['id'] && ($x['type'] ?? null) === $f['type']) $of = $x;
                if (!$of) continue;
                if ($f['type'] === 'list') {
                    if (!is_array($of['value'] ?? null)) continue;
                    $items = [];
                    foreach ($of['value'] as $item) {
                        $res = [];
                        foreach ($f['fields'] as $s) $res[$s['id']] = $s['type'] === 'image' ? Rules::itemImage($item, $s) : self::restored($item[$s['id']] ?? '', $s['type']);
                        $items[] = $res;
                    }
                    $current['groups'][$gi]['fields'][$fi]['value'] = $items;
                } else {
                    $current['groups'][$gi]['fields'][$fi]['value'] = $f['type'] === 'image' ? ($of['value'] ?? '') : self::restored($of['value'] ?? '', $f['type']);
                    if ($f['type'] === 'image') $current['groups'][$gi]['fields'][$fi]['alt'] = !empty($of['value']) ? ($of['alt'] ?? '') : '';
                }
            }
        }
        return $current;
    }

    /** Every image a page uses, for «verwendet auf». */
    public static function pageImageRefs(array $page): array
    {
        $refs = [];
        foreach ($page['groups'] ?? [] as $g) {
            foreach ($g['fields'] ?? [] as $f) {
                if ($f['type'] === 'image' && !empty($f['value'])) $refs[] = ['path' => $f['value'], 'alt' => $f['alt'] ?? '', 'where' => "{$g['label']} › {$f['label']}"];
                if ($f['type'] === 'list' && is_array($f['value'] ?? null)) {
                    foreach ($f['fields'] ?? [] as $sub) {
                        if ($sub['type'] !== 'image') continue;
                        foreach ($f['value'] as $i => $item) {
                            $im = Rules::itemImage($item, $sub);
                            if ($im['value'] !== '') $refs[] = ['path' => $im['value'], 'alt' => $im['alt'], 'where' => "{$g['label']} › " . ($f['itemLabel'] ?? $f['label']) . ' ' . ($i + 1)];
                        }
                    }
                }
            }
        }
        return $refs;
    }

    /** A page as readable lines («Gruppe › Feld: Wert») for the revision comparison. */
    public static function pageLines(array $page): string
    {
        $lines = [];
        $show = static fn ($s) => str_replace("\n", ' ⏎ ', (string) $s);
        $img = static fn ($v, $alt) => $v ? "$v (Alt: " . ($alt ?? '') . ')' : '—';
        foreach ($page['groups'] ?? [] as $g) {
            foreach ($g['fields'] ?? [] as $f) {
                $p = "{$g['label']} › {$f['label']}";
                if ($f['type'] === 'image') { $lines[] = "$p: " . $img($f['value'] ?? '', $f['alt'] ?? ''); continue; }
                if ($f['type'] !== 'list') { $lines[] = "$p: " . $show($f['value'] ?? ''); continue; }
                foreach (is_array($f['value'] ?? null) ? $f['value'] : [] as $i => $item) {
                    foreach ($f['fields'] ?? [] as $sub) {
                        $q = "{$g['label']} › " . ($f['itemLabel'] ?? $f['label']) . ' ' . ($i + 1) . " › {$sub['label']}";
                        if ($sub['type'] === 'image') { $im = Rules::itemImage($item, $sub); $lines[] = "$q: " . $img($im['value'], $im['alt']); }
                        else $lines[] = "$q: " . $show($item[$sub['id']] ?? '');
                    }
                }
            }
        }
        return implode("\n", $lines);
    }

    // ---------------- collections ----------------

    public static function formValues(array $def, array $entries): array
    {
        $map = [];
        foreach ($entries as [$k, $v]) $map[$k] = $v;
        $out = [];
        foreach ($def['fields'] as $f) {
            $raw = $map[$f['id']] ?? null;
            switch ($f['type']) {
                case 'date': $out[$f['id']] = is_array($raw) ? ($raw['date'] ?? '') : (is_string($raw) ? substr($raw, 0, 10) : ''); break;
                case 'boolean': $out[$f['id']] = $raw === true; break;
                case 'number': $out[$f['id']] = $raw === null ? '' : (string) $raw; break;
                case 'tags':
                case 'strings':
                    $out[$f['id']] = is_array($raw) ? array_map(static fn ($x) => is_array($x) ? ($x['date'] ?? '') : (string) $x, $raw) : [];
                    break;
                case 'image':
                    $alt = !empty($f['altKey']) ? ($map[$f['altKey']] ?? '') : '';
                    $out[$f['id']] = ['value' => Rules::imgFromFrontmatter($raw), 'alt' => is_string($alt) ? $alt : ''];
                    break;
                default:
                    $out[$f['id']] = $raw === null ? '' : (is_array($raw) ? ($raw['date'] ?? '') : (is_bool($raw) ? ($raw ? 'true' : 'false') : (string) $raw));
            }
        }
        return $out;
    }

    public function entryPath(string $coll, string $slug): string
    {
        return self::CONTENT . $this->collections[$coll]['dir'] . "/$slug.md";
    }

    /** Throws FrontmatterError for a file the admin does not understand. */
    public function entry(string $coll, string $slug): ?array
    {
        if (!preg_match(Rules::SLUG_RE, $slug)) return null;
        $f = $this->gh->file($this->entryPath($coll, $slug));
        if (!$f) return null;
        $parts = Frontmatter::split($f['content']);
        return [
            'slug' => $slug, 'path' => $this->entryPath($coll, $slug), 'text' => $f['content'], 'hash' => $f['sha'],
            'entries' => Frontmatter::parse($parts['fm']), 'body' => ltrim($parts['body'], "\n"),
        ];
    }

    public function listEntries(string $coll): array
    {
        $out = [];
        $prefix = self::CONTENT . $this->collections[$coll]['dir'] . '/';
        foreach ($this->gh->under($prefix) as $path => $e) {
            $name = substr($path, strlen($prefix));
            if (substr($name, -3) !== '.md') continue;
            $slug = substr($name, 0, -3);
            if (!preg_match(Rules::SLUG_RE, $slug)) continue;
            try {
                $parts = Frontmatter::split($this->gh->blob($e['sha']));
                $out[] = ['slug' => $slug, 'values' => self::formValues($this->collections[$coll], Frontmatter::parse($parts['fm']))];
            } catch (FrontmatterError $err) {
                $out[] = ['slug' => $slug, 'error' => $err->getMessage(), 'values' => (object) []];
            }
        }
        return $out;
    }

    public function serializeEntry(string $coll, array $entries, string $body): string
    {
        $flow = [];
        foreach ($this->collections[$coll]['fields'] as $f) if ($f['type'] === 'tags') $flow[] = $f['id'];
        return Frontmatter::build($entries, $body, $flow);
    }

    public function entryImageRefs(string $coll, array $entries): array
    {
        $map = [];
        foreach ($entries as [$k, $v]) $map[$k] = $v;
        $out = [];
        foreach ($this->collections[$coll]['fields'] as $f) {
            if ($f['type'] !== 'image') continue;
            $p = Rules::imgFromFrontmatter($map[$f['id']] ?? null);
            if ($p !== '') $out[] = ['path' => $p, 'alt' => !empty($f['altKey']) ? ($map[$f['altKey']] ?? '') : '', 'where' => $f['label']];
        }
        return $out;
    }

    // ---------------- images ----------------

    /** Uploaded through the media modal, waiting for the save that uses them. */
    public function pending(): array
    {
        $out = [];
        foreach (glob($this->store->path('pending/*')) ?: [] as $file) {
            if (preg_match('/^[0-9a-f]{16}\.(jpg|png|webp)$/D', basename($file))) $out['uploads/' . basename($file)] = $file;
        }
        return $out;
    }

    public function imageExists(string $p): bool
    {
        return Rules::isImagePath($p) && (isset($this->gh->tree()[self::IMG . $p]) || isset($this->pending()[$p]));
    }

    public function listImages(): array
    {
        $out = [];
        foreach ($this->pending() as $p => $file) $out[] = ['path' => $p, 'name' => basename($p), 'size' => (int) filesize($file), 'pending' => true];
        foreach ($this->gh->under(self::IMG) as $path => $e) {
            $p = substr($path, strlen(self::IMG));
            if (Rules::isImagePath($p)) $out[] = ['path' => $p, 'name' => basename($p), 'size' => $e['size'], 'pending' => false];
        }
        usort($out, static fn ($a, $b) => [$b['pending'], strncmp($b['path'], 'uploads/', 8) === 0, $a['path']] <=> [$a['pending'], strncmp($a['path'], 'uploads/', 8) === 0, $b['path']]);
        return $out;
    }

    public function imageBytes(string $p): ?string
    {
        $pending = $this->pending()[$p] ?? null;
        if ($pending) return (string) file_get_contents($pending);
        $e = $this->gh->tree()[self::IMG . $p] ?? null;
        return $e ? $this->gh->blob($e['sha']) : null;
    }

    /** The blobs a save has to carry: images it refers to that are not in the repository yet. */
    public function pendingFiles(array $refs): array
    {
        $files = [];
        $pending = $this->pending();
        foreach ($refs as $r) {
            if (isset($pending[$r['path']])) $files[self::IMG . $r['path']] = (string) file_get_contents($pending[$r['path']]);
        }
        return $files;
    }

    public function clearPending(array $files): void
    {
        foreach (array_keys($files) as $path) {
            if (strncmp($path, self::IMG . 'uploads/', strlen(self::IMG) + 8) === 0) $this->store->delete('pending/' . basename($path));
        }
    }

    /** Where an image is used: pages, collection entries and the site's code (logo etc.). */
    public function usages(string $img): array
    {
        $out = [];
        foreach ($this->listPages() as $p) {
            $page = $this->page($p['id'])['page'] ?? null;
            if (!$page) continue;
            foreach (self::pageImageRefs($page) as $r) {
                if ($r['path'] === $img) $out[] = ['title' => $page['label'] ?? $p['id'], 'where' => $r['where'], 'alt' => $r['alt'], 'edit' => ['type' => 'page', 'id' => $p['id']]];
            }
        }
        foreach ($this->collections as $coll => $def) {
            foreach ($this->listEntries($coll) as $e) {
                try { $entry = $this->entry($coll, $e['slug']); } catch (FrontmatterError $err) { continue; }
                if (!$entry) continue;
                $title = (array) $e['values'];
                $title = ($coll === 'team' ? ($title['name'] ?? '') : ($title['title'] ?? '')) ?: $e['slug'];
                $edit = ['type' => $def['postType'], 'id' => $e['slug']];
                foreach ($this->entryImageRefs($coll, $entry['entries']) as $r) {
                    if ($r['path'] === $img) $out[] = ['title' => $title, 'where' => $r['where'], 'alt' => $r['alt'], 'edit' => $edit];
                }
                if (strpos($entry['body'], "assets/img/$img") !== false) $out[] = ['title' => $title, 'where' => 'Text', 'alt' => '', 'edit' => $edit];
            }
        }
        // Images the site's code imports directly must not be deleted either.
        $needle = "assets/img/$img";
        foreach ($this->gh->under('src/') as $path => $e) {
            if (!preg_match('/\.(astro|ts|js|mjs|css|mdx)$/D', $path) || $e['size'] > 500000) continue;
            if (strpos($this->gh->blob($e['sha']), $needle) !== false) $out[] = ['title' => 'Website-Code', 'where' => $path, 'alt' => '', 'edit' => null];
        }
        return $out;
    }
}

final class Diff
{
    /** Line diff (LCS) for the revision screen, between what two versions do not share. */
    public static function lines(string $a, string $b): array
    {
        $A = explode("\n", $a);
        $B = explode("\n", $b);
        $start = 0;
        while ($start < count($A) && $start < count($B) && $A[$start] === $B[$start]) $start++;
        $endA = count($A);
        $endB = count($B);
        while ($endA > $start && $endB > $start && $A[$endA - 1] === $B[$endB - 1]) { $endA--; $endB--; }
        $out = [];
        for ($i = 0; $i < $start; $i++) $out[] = ['op' => 'same', 'text' => $A[$i]];
        $x = array_slice($A, $start, $endA - $start);
        $y = array_slice($B, $start, $endB - $start);
        $n = count($x);
        $m = count($y);
        if ($n * $m > 4000000) {
            foreach ($x as $t) $out[] = ['op' => 'del', 'text' => $t];
            foreach ($y as $t) $out[] = ['op' => 'add', 'text' => $t];
        } else {
            $next = array_fill(0, $m + 1, 0);
            $rows = [];
            for ($i = $n - 1; $i >= 0; $i--) {
                $row = array_fill(0, $m + 1, 0);
                for ($j = $m - 1; $j >= 0; $j--) $row[$j] = $x[$i] === $y[$j] ? $next[$j + 1] + 1 : max($next[$j], $row[$j + 1]);
                $rows[$i] = $row;
                $next = $row;
            }
            $rows[$n] = array_fill(0, $m + 1, 0);
            $i = 0;
            $j = 0;
            while ($i < $n && $j < $m) {
                if ($x[$i] === $y[$j]) { $out[] = ['op' => 'same', 'text' => $x[$i]]; $i++; $j++; }
                elseif ($rows[$i + 1][$j] >= $rows[$i][$j + 1]) $out[] = ['op' => 'del', 'text' => $x[$i++]];
                else $out[] = ['op' => 'add', 'text' => $y[$j++]];
            }
            while ($i < $n) $out[] = ['op' => 'del', 'text' => $x[$i++]];
            while ($j < $m) $out[] = ['op' => 'add', 'text' => $y[$j++]];
        }
        for ($i = $endA; $i < count($A); $i++) $out[] = ['op' => 'same', 'text' => $A[$i]];
        return $out;
    }

    /** Changed lines with `context` lines around them; long unchanged runs become «…». */
    public static function compact(array $diff, int $context = 3): array
    {
        $keep = array_fill(0, count($diff), false);
        foreach ($diff as $i => $d) {
            if ($d['op'] === 'same') continue;
            for ($k = max(0, $i - $context); $k <= min(count($diff) - 1, $i + $context); $k++) $keep[$k] = true;
        }
        $out = [];
        $skipped = false;
        foreach ($diff as $i => $d) {
            if ($keep[$i]) { $out[] = $d; $skipped = false; }
            elseif (!$skipped) { $out[] = ['op' => 'skip', 'text' => '…']; $skipped = true; }
        }
        return $out;
    }
}

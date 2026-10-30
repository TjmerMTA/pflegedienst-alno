<?php
// Every validation and sanitising rule of the admin, in one place. The written spec is
// admin/VALIDATION.md; admin/tests/vectors/rules.json holds input/output pairs it must reproduce.
// assets/js/rules.js has the same sanitiser for the editor's preview. The server's answer is the
// only one that counts.
declare(strict_types=1);

final class Rules
{
    const FORM_MAX_BYTES = 1048576; // request body of a save
    const RICHTEXT_MAX = 50000;
    const BODY_MAX = 200000;
    const ALT_MAX = 300;
    const TAG_MAX = 60;
    const SLUG_MAX = 80;
    const WORD_MAX = 30; // an unbroken word: buttons do not wrap, and a heading breaks only where it can
    const IMAGE_MAX_SIDE = 2400;
    const IMAGE_MAX_PIXELS = 40000000; // a 256 MB PHP cannot decode more
    const PASSWORD_MIN = 10;
    const PASSWORD_MAX_BYTES = 72; // bcrypt ignores what comes after

    const PAGE_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'a', 'ul', 'ol', 'li', 'h2', 'h3'];
    const FIELD_TYPES = ['text', 'textarea', 'richtext', 'image', 'list'];

    const SLUG_RE = '/^[a-z0-9]+(?:-[a-z0-9]+)*$/D';
    const PAGE_ID_RE = '/^_?[a-z0-9]+(?:-[a-z0-9]+)*$/D';
    const IMAGE_RE = '/\.(jpe?g|png|webp)$/iD';
    const REV_FILE_RE = '/^src\/content\/(?:pages\/_?[a-z0-9]+(?:-[a-z0-9]+)*\.json|(?:blog|leistungen|team)\/[a-z0-9]+(?:-[a-z0-9]+)*\.md)$/D';
    const REV_RE = '/^[0-9a-f]{7,40}$/D';
    const USERNAME_RE = '/^[a-z][a-z0-9._-]{1,31}$/D';

    // The German messages. Russian users get them translated in the browser (i18n.js).
    const MSG_REQUIRED = 'Pflichtfeld';
    const MSG_INVALID = 'ungültiger Wert';
    const MSG_NO_HTML = 'HTML ist hier nicht erlaubt';
    const MSG_BAD_HTML = 'nicht erlaubtes HTML';
    const MSG_ONE_LINE = 'nur eine Zeile';
    const MSG_NO_ANGLE = 'Die Zeichen < und > sind in den Kontaktdaten nicht erlaubt.';
    const MSG_ALT_REQUIRED = 'Alternativtext fehlt: Ist ein Bild gesetzt, muss der Alternativtext ausgefüllt sein.';
    const MSG_ALT_TOO_LONG = 'Alternativtext zu lang';
    const MSG_BAD_IMAGE = 'ungültiger Bildpfad';
    const MSG_IMAGE_SQUARE = 'Das Bild muss quadratisch sein.';
    const MSG_BAD_PHONE = 'Bitte eine Telefonnummer mit Vorwahl eingeben.';
    const MSG_BAD_PHONE_INTL = 'Bitte leer lassen oder mit + und Ländervorwahl schreiben, z. B. +49 231 5467686.';
    const MSG_IMAGE_EXTERNAL = 'Bilder von fremden Websites werden hier nicht angezeigt. Bitte das Bild in die Mediathek hochladen und von dort einsetzen.';
    const MSG_UNKNOWN_GROUP = 'unbekannte Gruppe';
    const MSG_UNKNOWN_FIELD = 'unbekanntes Feld';
    const MSG_BAD_LIST = 'ungültige Liste';
    const MSG_BAD_ITEM = 'ungültiger Eintrag';
    const MSG_MIN_ONE = 'mindestens ein Eintrag';
    const MSG_STRUCTURE = 'Struktur verändert';
    const MSG_BAD_DATE = 'ungültiges Datum';
    const MSG_BAD_NUMBER = 'keine Zahl';
    const MSG_BAD_CHOICE = 'ungültige Auswahl';
    const MSG_BAD_TAG = 'ungültiges Schlagwort';
    const MSG_SLUG_INVALID = 'Ungültiger Permalink: nur a–z, 0–9 und Bindestriche.';
    const MSG_SLUG_TAKEN = 'Unter diesem Namen gibt es bereits einen Eintrag.';
    const MSG_BODY_IMAGE_PREFIX = 'Bild im Text nicht gefunden: ';
    const MSG_BODY_IMAGE_FORM = 'Ein Bild im Text hat eine Form, die hier nicht geht. Bitte so schreiben: ![Beschreibung](../../assets/img/datei.jpg)';
    const MSG_UNSAFE_LINK = 'Der Text enthält eine unsichere Link-Adresse. Erlaubt sind http, https, mailto, tel und Pfade der Website.';

    public static function msgTooLong(int $max, int $now): string { return "höchstens $max Zeichen (jetzt $now)"; }
    public static function msgLongWord(string $w, int $n): string
    {
        return "Das Wort „{$w}“ ist mit $n Zeichen zu lang (höchstens " . self::WORD_MAX . '): Auf schmalen Bildschirmen passt es nicht in die Zeile. Bitte mit einem Bindestrich oder Leerzeichen trennen.';
    }

    public static function msgImageSmall(int $w, int $h, int $nowW, int $nowH): string { return "Das Bild ist zu klein: mindestens $w × $h Pixel, dieses hat $nowW × $nowH."; }
    public static function msgImageMissing(string $p): string { return "Bild „{$p}“ nicht gefunden"; }
    public static function msgBadToken(string $t): string { return 'unbekannter Platzhalter {{' . $t . '}}'; }
    public static function msgMinItems(int $n): string { return $n === 1 ? self::MSG_MIN_ONE : "mindestens $n Einträge"; }
    public static function msgMaxItems(int $n): string { return "höchstens $n Einträge"; }

    public static function chars(string $s): int { return mb_strlen($s, 'UTF-8'); }

    // ---------------- text ----------------

    // Everything YAML refuses as non-printable, plus line separators a parser would split on.
    const NOT_PRINTABLE = '/[\x{0000}-\x{0008}\x{000B}\x{000C}\x{000E}-\x{001F}\x{007F}-\x{009F}\x{2028}\x{2029}\x{FEFF}\x{FFFE}\x{FFFF}]/u';

    /** For multi-line content that keeps its own whitespace. */
    public static function cleanBody($v): string
    {
        if (!is_string($v)) return '';
        $s = str_replace(["\r\n", "\r"], "\n", mb_scrub($v, 'UTF-8'));
        return (string) preg_replace(self::NOT_PRINTABLE, '', $s);
    }

    public static function cleanText($v, bool $multiline = false): string
    {
        $s = self::cleanBody($v);
        return self::trim($multiline ? $s : (string) preg_replace('/\n+/', ' ', $s));
    }

    // What JavaScript's \s means. PCRE's \s differs from it, with and without the u flag.
    const WS_CLASS = ' \t\n\x0B\f\r\x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}';

    // PHP's trim() knows ASCII only; texts also come with no-break and typographic spaces.
    private const WS = ["\u{A0}" => 1, "\u{1680}" => 1, "\u{2000}" => 1, "\u{2001}" => 1, "\u{2002}" => 1, "\u{2003}" => 1, "\u{2004}" => 1, "\u{2005}" => 1,
        "\u{2006}" => 1, "\u{2007}" => 1, "\u{2008}" => 1, "\u{2009}" => 1, "\u{200A}" => 1, "\u{2028}" => 1, "\u{2029}" => 1, "\u{202F}" => 1, "\u{205F}" => 1,
        "\u{3000}" => 1, "\u{FEFF}" => 1];

    public static function trim(string $s): string
    {
        $start = 0;
        $n = strlen($s);
        while ($start < $n) {
            $len = strspn($s, " \t\n\v\f\r", $start);
            $start += $len;
            $width = 0;
            foreach ([2, 3] as $w) if (isset(self::WS[substr($s, $start, $w)])) $width = $w;
            if (!$width) break;
            $start += $width;
        }
        while ($n > $start) {
            if (strpos(" \t\n\v\f\r", $s[$n - 1]) !== false) { $n--; continue; }
            $width = 0;
            foreach ([2, 3] as $w) if ($n - $w >= $start && isset(self::WS[substr($s, $n - $w, $w)])) $width = $w;
            if (!$width) break;
            $n -= $width;
        }
        return substr($s, $start, $n - $start);
    }

    /** True when a plain text value could open a tag: `</script a` needs no `>` in the same field. */
    public static function looksLikeHtml(string $s): bool
    {
        return preg_match('/<[a-zA-Z\/!?{]/', $s) === 1;
    }

    /**
     * The first word of a one-line text the browser cannot break, or null. A word ends where a line
     * may end: spaces (not the no-break ones), hyphens, dashes, slashes, soft hyphens. Tokens are
     * filled in by the site, and addresses are not text a reader has to fit on a line.
     */
    public static function longWord(string $s): ?string
    {
        if (preg_match('/^(https?:|mailto:|tel:|\/)/i', self::trim($s))) return null;
        $s = (string) preg_replace('/\{\{[^{}]*\}\}/', ' ', $s);
        foreach (preg_split('/[ \t\n\x{1680}\x{2000}-\x{2006}\x{2008}-\x{200B}\x{205F}\x{3000}\x{AD}\/\x{2010}\x{2013}\x{2014}-]+/u', $s) ?: [] as $word) {
            if (self::chars($word) > self::WORD_MAX && strpos($word, '@') === false) return $word;
        }
        return null;
    }

    // ---------------- names and paths ----------------

    public static function slugify(string $s): string
    {
        $s = mb_strtolower($s, 'UTF-8');
        $s = strtr($s, ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss']);
        $s = strtr($s, [
            'à' => 'a', 'á' => 'a', 'â' => 'a', 'ã' => 'a', 'å' => 'a', 'ç' => 'c', 'è' => 'e', 'é' => 'e', 'ê' => 'e', 'ë' => 'e',
            'ì' => 'i', 'í' => 'i', 'î' => 'i', 'ï' => 'i', 'ñ' => 'n', 'ò' => 'o', 'ó' => 'o', 'ô' => 'o', 'õ' => 'o', 'ù' => 'u',
            'ú' => 'u', 'û' => 'u', 'ý' => 'y', 'ÿ' => 'y', 'ć' => 'c', 'č' => 'c', 'ě' => 'e', 'ń' => 'n', 'ň' => 'n', 'ř' => 'r',
            'ś' => 's', 'š' => 's', 'ş' => 's', 'ž' => 'z', 'ź' => 'z', 'ż' => 'z',
        ]);
        $s = (string) preg_replace('/[^a-z0-9]+/', '-', $s);
        $s = (string) preg_replace('/^-|-$/', '', $s);
        return (string) preg_replace('/-$/', '', substr($s, 0, self::SLUG_MAX));
    }

    public static function isImagePath($v): bool
    {
        if (!is_string($v) || !preg_match(self::IMAGE_RE, $v) || strpos($v, '\\') !== false || strpos($v, "\0") !== false || $v[0] === '/') return false;
        foreach (explode('/', $v) as $seg) {
            if ($seg === '' || $seg[0] === '.') return false;
        }
        return true;
    }

    public static function validDate(string $s): bool
    {
        return preg_match('/^(\d{4})-(\d{2})-(\d{2})$/D', $s, $m) === 1 && checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
    }

    /** Type by content, never by name or the browser's claim. */
    public static function sniffImage(string $bytes): ?string
    {
        if (strlen($bytes) < 12) return null;
        if (strncmp($bytes, "\xFF\xD8\xFF", 3) === 0) return 'jpeg';
        if (strncmp($bytes, "\x89PNG\r\n\x1A\n", 8) === 0) return 'png';
        if (strncmp($bytes, 'RIFF', 4) === 0 && substr($bytes, 8, 4) === 'WEBP') return 'webp';
        return null;
    }

    // ---------------- HTML ----------------

    private const VOID_TAGS = ['br' => 1, 'hr' => 1];
    private const DROP_WITH_CONTENT = ['script' => 1, 'style' => 1, 'iframe' => 1, 'object' => 1, 'embed' => 1, 'noscript' => 1, 'template' => 1, 'svg' => 1, 'math' => 1, 'textarea' => 1, 'select' => 1, 'title' => 1, 'head' => 1];
    private const ENTITY = ['amp' => '&', 'lt' => '<', 'gt' => '>', 'quot' => '"', 'apos' => "'", 'nbsp' => "\u{A0}", 'colon' => ':', 'tab' => "\t", 'newline' => "\n"];

    public static function decodeEntities(string $s): string
    {
        return (string) preg_replace_callback('/&(#x[0-9a-f]+|#\d+|[a-z]+);/i', static function (array $m): string {
            $e = $m[1];
            if ($e[0] === '#') {
                $hex = $e[1] === 'x' || $e[1] === 'X';
                $digits = ltrim(substr($e, $hex ? 2 : 1), '0');
                if ($digits === '' || strlen($digits) > 7) return '';
                $n = $hex ? (int) hexdec($digits) : (int) $digits;
                if ($n < 1 || $n >= 0x110000 || ($n >= 0xD800 && $n <= 0xDFFF)) return '';
                return (string) mb_chr($n, 'UTF-8');
            }
            return self::ENTITY[strtolower($e)] ?? $m[0];
        }, $s);
    }

    private static function escText(string $s): string
    {
        return strtr($s, ['&' => '&amp;', '<' => '&lt;', '>' => '&gt;']);
    }

    private static function escAttr(string $s): string
    {
        return strtr($s, ['&' => '&amp;', '<' => '&lt;', '>' => '&gt;', '"' => '&quot;']);
    }

    /** Links: http(s), mailto, tel, site-relative paths and anchors. Everything else goes. */
    public static function safeHref(?string $href): ?string
    {
        $v = (string) preg_replace('/[\x{0000}-\x{0020}\x{007F}-\x{009F}]/u', '', self::decodeEntities((string) $href));
        if ($v === '') return null;
        if (preg_match('/^(https?:|mailto:|tel:)/i', $v)) return $v;
        if (preg_match('/^[a-z][a-z0-9+.-]*:/i', $v)) return null;
        if (strncmp($v, '//', 2) === 0) return null;
        if (preg_match('/^[\/#?]/', $v) || preg_match('/^[\w.-]/', $v)) return $v;
        return null;
    }

    private static function getHref(string $attrs): ?string
    {
        $w = self::WS_CLASS;
        if (!preg_match("/(?:^|[$w])href[$w]*=[$w]*(?:\"([^\"]*)\"|'([^']*)'|([^$w\"'>]+))/iu", $attrs, $m)) return null;
        return $m[3] ?? ($m[2] ?? $m[1]);
    }

    // By byte value: ctype_alpha() follows the host's locale, a sanitiser must not.
    private static function isAlpha(string $c): bool
    {
        return ($c >= 'a' && $c <= 'z') || ($c >= 'A' && $c <= 'Z');
    }

    // Index of the `>` ending a tag, skipping quoted attribute values; -1 if the tag never ends.
    private static function tagEnd(string $src, int $i): int
    {
        $n = strlen($src);
        while ($i < $n) {
            $i += strcspn($src, "\"'>", $i);
            if ($i >= $n) return -1;
            if ($src[$i] === '>') return $i;
            $close = strpos($src, $src[$i], $i + 1);
            if ($close === false) return -1;
            $i = $close + 1;
        }
        return -1;
    }

    /**
     * Allow-list sanitiser. One pass over the input, so hostile markup costs linear time. Once a tag
     * turns out never to end, everything after it is plain text: no later `<` can open a tag either.
     */
    public static function sanitizeHtml(string $src, array $allowed = self::PAGE_TAGS): string
    {
        $allow = array_flip($allowed);
        $out = '';
        $pos = 0;
        $len = strlen($src);
        $stack = [];
        $open = [];
        $dropTag = null;
        $dropDepth = 0;
        $text = static function (string $t) use (&$out, &$dropTag): void {
            if ($dropTag === null && $t !== '') $out .= self::escText(self::decodeEntities($t));
        };
        $skipTo = static function (string $marker, int $from) use ($src, $len): int {
            $e = strpos($src, $marker, min($from, $len));
            return $e === false ? $len : $e + strlen($marker);
        };
        while ($pos < $len) {
            $lt = strpos($src, '<', $pos);
            if ($lt === false) { $text(substr($src, $pos)); break; }
            $text(substr($src, $pos, $lt - $pos));
            if (substr_compare($src, '<!--', $lt, 4) === 0) { $pos = $skipTo('-->', $lt + 4); continue; }
            if (substr_compare($src, '<![CDATA[', $lt, 9) === 0) { $pos = $skipTo(']]>', $lt + 9); continue; }
            $next = $src[$lt + 1] ?? '';
            if ($next === '!' || $next === '?') { $pos = $skipTo('>', $lt + 2); continue; }
            $closing = $next === '/';
            $nameStart = $lt + ($closing ? 2 : 1);
            if (!self::isAlpha($src[$nameStart] ?? '')) {
                if ($dropTag === null) $out .= '&lt;';
                $pos = $lt + 1;
                continue;
            }
            $nameEnd = $nameStart + strspn($src, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-', $nameStart);
            $end = self::tagEnd($src, $nameEnd);
            if ($end === -1) { $text(substr($src, $lt)); break; }
            $tag = strtolower(substr($src, $nameStart, $nameEnd - $nameStart));
            $attrs = substr($src, $nameEnd, $end - $nameEnd);
            $pos = $end + 1;
            if ($dropTag !== null) {
                if ($tag === $dropTag) {
                    $dropDepth += $closing ? -1 : 1;
                    if ($dropDepth === 0) $dropTag = null;
                }
                continue;
            }
            if (isset(self::DROP_WITH_CONTENT[$tag])) {
                if (!$closing && !preg_match('/\/[' . self::WS_CLASS . ']*$/Du', $attrs)) { $dropTag = $tag; $dropDepth = 1; }
                continue;
            }
            if (!isset($allow[$tag])) continue;
            if (isset(self::VOID_TAGS[$tag])) {
                if (!$closing) $out .= "<$tag>";
                continue;
            }
            if ($closing) {
                if (empty($open[$tag])) continue;
                while (true) {
                    [$top, $shown] = array_pop($stack);
                    $open[$top]--;
                    if ($shown) $out .= "</$top>";
                    if ($top === $tag) break;
                }
                continue;
            }
            // <a> without a usable href is just text.
            $href = $tag === 'a' ? self::safeHref(self::getHref($attrs)) : null;
            $shown = $tag !== 'a' || $href !== null;
            if ($shown) $out .= $href !== null ? '<a href="' . self::escAttr($href) . '">' : "<$tag>";
            $stack[] = [$tag, $shown];
            $open[$tag] = ($open[$tag] ?? 0) + 1;
        }
        while ($stack) {
            [$top, $shown] = array_pop($stack);
            if ($shown) $out .= "</$top>";
        }
        return self::trim($out);
    }

    // ---------------- Markdown ----------------

    /**
     * Nothing is deleted from a Markdown body: raw HTML needs a literal `<` before a letter, `/`, `!`
     * or `?`, so turning exactly those into `&lt;` leaves no raw HTML at all, wherever the renderer
     * thinks code spans begin. In running text the reader sees the characters that were typed; inside
     * a code span the renderer shows `&lt;` literally, which is the price of not trusting code spans.
     */
    public static function sanitizeMarkdown($md): string
    {
        return (string) preg_replace('/<(?=[a-zA-Z\/!?])/', '&lt;', self::cleanBody($md));
    }

    /**
     * Whether the text anywhere names an active URL scheme, after the decoding a Markdown renderer
     * does. Not limited to link positions: those depend on the renderer (references inside quotes or
     * lists, line breaks). `javascript:` counts whatever follows it: the renderer encodes a space
     * after the colon and the browser still runs it. Only «data: 5» in a sentence is fine, with a
     * typed space: data: URLs do not run at the top level, and the entity form is not a sentence.
     */
    public static function hasUnsafeLink(string $md): bool
    {
        $decoded = str_replace(['\\', "\n", "\r", "\t"], '', self::decodeEntities($md));
        if (preg_match('/(?:^|[^a-z0-9+.-])(?:javascript|vbscript):/iu', $decoded)) return true;
        if (preg_match('/(?:^|[^a-z0-9+.-])data:&/i', str_replace('\\', '', $md))) return true;
        if (preg_match('/(?:^|[^a-z0-9+.-])data:(?=[^ \n\t])/iu', $decoded)) return true;
        // Link targets follow the list richtext links have: blob:, ftp: and the like have no place here.
        preg_match_all('/\]\([ \t]*<?([a-z][a-z0-9+.-]*):(?=\S)|^[ \t]*\[[^\]\n]+\]:[ \t]*<?([a-z][a-z0-9+.-]*):(?=\S)/im', self::decodeEntities($md), $m, PREG_SET_ORDER);
        foreach ($m as $target) {
            if (!in_array(strtolower($target[2] ?? '' ?: $target[1]), ['http', 'https', 'mailto', 'tel'], true)) return true;
        }
        return false;
    }

    /**
     * The image form the admin understands: alt text with line breaks and one level of brackets, no
     * code span and no link in it, a target and at most a quoted title. The renderer knows more forms,
     * and a form misread here breaks the build or is left out of the commit, so this list is closed:
     * whatever could still be an image once these are taken out is refused, see hasOddImage.
     */
    private const MD_IMAGE = '/!\[(?:[^\[\]\\\\`]++|\\\\.|\[(?:[^\[\]\\\\`]++|\\\\.)*+\](?!\())*+\]\([ \t]*+(?:\n[ \t>]*+)?(?:<([^<>\n\\\\]*+)>|((?:[^\s()\\\\]++|\\\\.|\((?:[^\s()\\\\]++|\\\\.)*+\))*+))(?:[ \t]*+(?:\n[ \t>]*+)?(?:"[^"\n]*+"|\'[^\'\n]*+\'))?[ \t]*+(?:\n[ \t>]*+)?\)/s';

    /** Targets of the Markdown images in a body, in the form MD_IMAGE knows. */
    public static function bodyImages(string $md): array
    {
        preg_match_all(self::MD_IMAGE, $md, $m, PREG_SET_ORDER);
        return array_map(static fn (array $x): string => ($x[2] ?? '') !== '' ? $x[2] : $x[1], $m);
    }

    /** The CSP of the site allows images from its own origin only: a foreign one would stay blank. */
    public static function isExternalImage(string $src): bool
    {
        return preg_match('/^[ \t]*(?:https?:|\/\/)/i', $src) === 1;
    }

    /** Medien shows `uploads/x.jpg`: an image written with that path gets the one the build needs. */
    public static function normalizeBodyImages(string $md, callable $exists): string
    {
        return preg_replace_callback(self::MD_IMAGE, static function (array $m) use ($exists): string {
            [$src, $at] = ($m[2][0] ?? '') !== '' ? $m[2] : $m[1];
            if (!self::isImagePath($src) || !$exists($src)) return $m[0][0];
            return substr_replace($m[0][0], self::IMG_PREFIX . $src, $at - $m[0][1], strlen($src));
        }, $md, -1, $count, PREG_OFFSET_CAPTURE) ?? $md;
    }

    /** `![` that is no image in the known form, with a `](` after it or a reference definition anywhere. */
    private static function hasOddImage(string $md): bool
    {
        $rest = preg_replace(self::MD_IMAGE, ' ', $md);
        if ($rest === null) return true;
        $p = strpos($rest, '![');
        return $p !== false && (strpos($rest, '](', $p) !== false || strpos($rest, ']:') !== false);
    }

    /** The build runs decodeURI over every image address, and a malformed one stops it. */
    private static function decodesAsUri(string $url): bool
    {
        return !preg_match('/%(?![0-9a-f]{2})/i', $url) && preg_match('//u', rawurldecode($url)) === 1;
    }

    /** Why an address cannot be an image in a body, or null. */
    private static function bodyImageError(string $src, callable $exists): ?string
    {
        if (self::isExternalImage($src)) return self::MSG_IMAGE_EXTERNAL;
        $missing = self::MSG_BODY_IMAGE_PREFIX . $src;
        // Escapes and entities would change the address the renderer sees; an image address needs neither.
        if ($src === '' || preg_match('/\\\\|&#?[a-z0-9]+;/i', $src)) return $missing;
        if ($src[0] === '/') return self::decodesAsUri($src) ? null : $missing;
        $p = strncmp($src, self::IMG_PREFIX, strlen(self::IMG_PREFIX)) === 0 ? substr($src, strlen(self::IMG_PREFIX)) : '';
        return self::isImagePath($p) && $exists($p) ? null : $missing;
    }

    /** A local image the build cannot find fails the whole site. */
    public static function missingBodyImages(string $md, callable $exists): array
    {
        $out = [];
        if (self::hasOddImage($md)) $out[] = ['path' => 'body', 'label' => 'Inhalt', 'msg' => self::MSG_BODY_IMAGE_FORM];
        foreach (self::bodyImages($md) as $src) {
            $msg = self::bodyImageError($src, $exists);
            if ($msg !== null) $out[] = ['path' => 'body', 'label' => 'Inhalt', 'msg' => $msg];
        }
        return $out;
    }

    // ---------------- page files ----------------

    private static function isObject($v): bool
    {
        return is_array($v) && ($v === [] || !array_is_list($v));
    }

    private static function checkFields(array $fields, string $prefix, callable $err, bool $allowList): void
    {
        $ids = [];
        foreach ($fields as $f) {
            if (!is_array($f) || !is_string($f['id'] ?? null) || $f['id'] === '') { $err($prefix, 'Feld ohne id'); continue; }
            $p = "$prefix.{$f['id']}";
            if (isset($ids[$f['id']])) $err($p, 'Feld-id doppelt');
            $ids[$f['id']] = true;
            $type = $f['type'] ?? '';
            if (!in_array($type, self::FIELD_TYPES, true) || ($type === 'list' && !$allowList)) { $err($p, 'unbekannter Typ „' . (is_string($type) ? $type : '') . '“'); continue; }
            if ($type === 'list') {
                if (!is_array($f['fields'] ?? null)) $err($p, 'list ohne fields');
                else self::checkFields($f['fields'], $p, $err, false);
            }
        }
    }

    /** Checks that a page has the shape the contract describes. Returns a list of errors. */
    public static function checkStructure($page): array
    {
        $errs = [];
        $err = static function (string $p, string $msg) use (&$errs): void { $errs[] = ['path' => $p, 'msg' => $msg]; };
        if (!is_array($page) || array_is_list($page)) return [['path' => '', 'msg' => 'kein Objekt']];
        if (!is_string($page['label'] ?? null)) $err('label', 'fehlt');
        if (!is_array($page['groups'] ?? null)) { $err('groups', 'fehlt'); return $errs; }
        $gids = [];
        foreach ($page['groups'] as $gi => $g) {
            if (!is_array($g) || !is_string($g['id'] ?? null) || $g['id'] === '') { $err("groups[$gi]", 'Gruppe ohne id'); continue; }
            if (isset($gids[$g['id']])) $err("groups[$gi]", "Gruppen-id „{$g['id']}“ doppelt");
            $gids[$g['id']] = true;
            if (!is_array($g['fields'] ?? null)) { $err($g['id'], 'fields fehlt'); continue; }
            self::checkFields($g['fields'], $g['id'], $err, true);
        }
        return $errs;
    }

    /** Structure fingerprint: everything except values. */
    public static function structureOf(array $page): string
    {
        $strip = static function (array $f) use (&$strip): array {
            unset($f['value'], $f['alt']);
            if (($f['type'] ?? '') === 'list') $f['fields'] = array_map($strip, $f['fields'] ?? []);
            return $f;
        };
        foreach ($page['groups'] ?? [] as $i => $g) $page['groups'][$i]['fields'] = array_map($strip, $g['fields'] ?? []);
        return (string) json_encode($page, JSON_UNESCAPED_UNICODE);
    }

    /** An image sub-field of a list item is item[id] = {value, alt}. «No image» is "" and "". */
    public static function itemImage($item, array $sub): array
    {
        $v = is_array($item) ? ($item[$sub['id']] ?? null) : null;
        $value = is_array($v) && is_string($v['value'] ?? null) ? $v['value'] : '';
        $alt = is_array($v) && is_string($v['alt'] ?? null) ? $v['alt'] : '';
        return ['value' => $value, 'alt' => $value !== '' ? $alt : ''];
    }

    private static function setFieldValue(array &$f, $v, string $p, array &$errors): void
    {
        switch ($f['type']) {
            case 'text':
            case 'textarea':
                if (!is_string($v)) { $errors[] = ['path' => $p, 'msg' => self::MSG_INVALID]; return; }
                $f['value'] = self::cleanText($v, $f['type'] === 'textarea');
                return;
            case 'richtext':
                if (!is_string($v)) { $errors[] = ['path' => $p, 'msg' => self::MSG_INVALID]; return; }
                $f['value'] = self::sanitizeHtml(self::cleanBody($v));
                return;
            case 'image':
                if (!self::isObject($v)) { $errors[] = ['path' => $p, 'msg' => self::MSG_INVALID]; return; }
                $f['value'] = self::cleanText($v['value'] ?? '');
                $f['alt'] = $f['value'] !== '' ? self::cleanText($v['alt'] ?? '') : '';
                return;
            case 'list':
                if (!is_array($v) || !array_is_list($v)) { $errors[] = ['path' => $p, 'msg' => self::MSG_BAD_LIST]; return; }
                $subIds = array_flip(array_column($f['fields'], 'id'));
                $items = [];
                foreach ($v as $i => $item) {
                    $n = $i + 1;
                    $res = [];
                    if (!self::isObject($item)) { $errors[] = ['path' => "{$p}[$n]", 'msg' => self::MSG_BAD_ITEM]; $items[] = $res; continue; }
                    foreach (array_keys($item) as $k) {
                        if (!isset($subIds[$k])) $errors[] = ['path' => "{$p}[$n].$k", 'msg' => self::MSG_UNKNOWN_FIELD];
                    }
                    foreach ($f['fields'] as $sub) {
                        $sv = $item[$sub['id']] ?? null;
                        if ($sub['type'] === 'image') {
                            $value = self::cleanText(is_array($sv) ? ($sv['value'] ?? '') : '');
                            $res[$sub['id']] = ['value' => $value, 'alt' => $value !== '' ? self::cleanText(is_array($sv) ? ($sv['alt'] ?? '') : '') : ''];
                        } elseif ($sub['type'] === 'richtext') {
                            $res[$sub['id']] = self::sanitizeHtml(self::cleanBody($sv));
                        } else {
                            $res[$sub['id']] = self::cleanText($sv, $sub['type'] === 'textarea');
                        }
                    }
                    $items[] = $res;
                }
                $f['value'] = $items;
                return;
        }
    }

    // $contact: values of the group contact end up in JSON-LD and, as tokens, on every page.
    private static function checkValue(array $f, $value, $alt, string $p, array $ctx, array &$errors, ?string $label = null, bool $contact = false): void
    {
        $label ??= $f['label'] ?? $p;
        $err = static function (string $msg) use (&$errors, $p, $label): void { $errors[] = ['path' => $p, 'msg' => $msg, 'label' => $label]; };
        if ($f['type'] === 'image') {
            if (!is_string($value)) { $err(self::MSG_INVALID); return; }
            if ($value === '') { if (!empty($f['required'])) $err(self::MSG_REQUIRED); return; }
            if (!self::isImagePath($value)) { $err(self::isExternalImage($value) ? self::MSG_IMAGE_EXTERNAL : self::MSG_BAD_IMAGE); return; }
            if (isset($ctx['imageExists']) && !$ctx['imageExists']($value)) { $err(self::msgImageMissing($value)); return; }
            $size = isset($ctx['imageSize']) && (isset($f['minWidth']) || isset($f['minHeight']) || !empty($f['square'])) ? $ctx['imageSize']($value) : null;
            if ($size !== null) {
                if ($size[0] < ($f['minWidth'] ?? 0) || $size[1] < ($f['minHeight'] ?? 0)) { $err(self::msgImageSmall((int) ($f['minWidth'] ?? 0), (int) ($f['minHeight'] ?? 0), $size[0], $size[1])); return; }
                if (!empty($f['square']) && abs($size[0] - $size[1]) > 0.02 * max($size)) { $err(self::MSG_IMAGE_SQUARE); return; }
            }
            if (!is_string($alt) || self::trim($alt) === '') { $err(self::MSG_ALT_REQUIRED); return; }
            if (self::chars($alt) > self::ALT_MAX) $err(self::MSG_ALT_TOO_LONG);
            return;
        }
        if (!is_string($value)) { $err(self::MSG_INVALID); return; }
        $n = self::chars($value);
        if ($f['type'] === 'richtext' && $n > self::RICHTEXT_MAX) $err(self::msgTooLong(self::RICHTEXT_MAX, $n));
        $plain = $f['type'] === 'richtext' ? self::trim((string) preg_replace('/<[^>]*>/', '', $value)) : self::trim($value);
        if (!empty($f['required']) && $plain === '') $err(self::MSG_REQUIRED);
        $isPlain = $f['type'] === 'text' || $f['type'] === 'textarea';
        if ($isPlain && !empty($f['max']) && $n > $f['max']) $err(self::msgTooLong((int) $f['max'], $n));
        if ($isPlain) {
            if ($contact && strpbrk($value, '<>') !== false) $err(self::MSG_NO_ANGLE);
            elseif ($contact && $f['id'] === 'phone' && $plain !== '' && strlen((string) preg_replace('/\D/', '', $plain)) < 6) $err(self::MSG_BAD_PHONE);
            elseif ($contact && $f['id'] === 'phoneIntl' && $plain !== '' && !preg_match('/^\+[0-9 ()\/-]{6,}$/D', $plain)) $err(self::MSG_BAD_PHONE_INTL);
            elseif (self::looksLikeHtml($value)) $err(self::MSG_NO_HTML);
        }
        if ($f['type'] === 'text' && strpos($value, "\n") !== false) $err(self::MSG_ONE_LINE);
        if ($f['type'] === 'text' && ($w = self::longWord($value)) !== null) $err(self::msgLongWord($w, self::chars($w)));
        if ($f['type'] === 'richtext' && self::sanitizeHtml($value) !== self::trim($value)) $err(self::MSG_BAD_HTML);
        if (!empty($ctx['tokens']) && preg_match_all('/\{\{([^{}]*)\}\}/', $value, $m)) {
            foreach ($m[1] as $t) {
                if (!in_array(self::trim($t), $ctx['tokens'], true)) $err(self::msgBadToken($t));
            }
        }
    }

    /** Validates all values of a page. ctx: imageExists(path), tokens. */
    public static function validatePageValues(array $page, array $ctx = []): array
    {
        $errors = [];
        foreach ($page['groups'] ?? [] as $g) {
            $contact = $g['id'] === 'contact';
            foreach ($g['fields'] ?? [] as $f) {
                $p = "{$g['id']}.{$f['id']}";
                if ($f['type'] === 'list') {
                    $items = $f['value'] ?? null;
                    if (!is_array($items) || !array_is_list($items)) { $errors[] = ['path' => $p, 'msg' => self::MSG_BAD_LIST, 'label' => $f['label'] ?? $p]; continue; }
                    if (isset($f['min']) && count($items) < $f['min']) $errors[] = ['path' => $p, 'msg' => self::msgMinItems((int) $f['min']), 'label' => $f['label'] ?? $p];
                    if (isset($f['max']) && count($items) > $f['max']) $errors[] = ['path' => $p, 'msg' => self::msgMaxItems((int) $f['max']), 'label' => $f['label'] ?? $p];
                    foreach ($items as $i => $item) {
                        $n = $i + 1;
                        foreach ($f['fields'] ?? [] as $sub) {
                            $sp = "{$p}[$n].{$sub['id']}";
                            $label = ($f['itemLabel'] ?? ($f['label'] ?? '')) . " $n › " . ($sub['label'] ?? '');
                            if ($sub['type'] === 'image') {
                                $im = self::itemImage($item, $sub);
                                self::checkValue($sub, $im['value'], $im['alt'], $sp, $ctx, $errors, $label);
                            } else {
                                self::checkValue($sub, is_array($item) ? ($item[$sub['id']] ?? '') : '', null, $sp, $ctx, $errors, $label, $contact);
                            }
                        }
                    }
                    continue;
                }
                self::checkValue($f, $f['value'] ?? '', $f['alt'] ?? null, $p, $ctx, $errors, null, $contact);
            }
        }
        return $errors;
    }

    /**
     * Copies submitted values into `page`. `input` is {groupId: {fieldId: value}}. Never adds or
     * removes groups or fields; a group that is not sent keeps its values.
     */
    public static function applyPageValues(array $page, array $input, array $ctx = []): array
    {
        $errors = [];
        $out = $page;
        $known = array_flip(array_column($out['groups'], 'id'));
        foreach (array_keys($input) as $gid) {
            if (!isset($known[$gid])) $errors[] = ['path' => (string) $gid, 'msg' => self::MSG_UNKNOWN_GROUP];
        }
        foreach ($out['groups'] as $gi => $g) {
            if (!array_key_exists($g['id'], $input)) continue;
            $gin = $input[$g['id']];
            if (!self::isObject($gin)) { $errors[] = ['path' => $g['id'], 'msg' => self::MSG_INVALID]; continue; }
            $fids = array_flip(array_column($g['fields'], 'id'));
            foreach (array_keys($gin) as $k) {
                if (!isset($fids[$k])) $errors[] = ['path' => "{$g['id']}.$k", 'msg' => self::MSG_UNKNOWN_FIELD];
            }
            foreach ($g['fields'] as $fi => $f) {
                if (array_key_exists($f['id'], $gin)) self::setFieldValue($out['groups'][$gi]['fields'][$fi], $gin[$f['id']], "{$g['id']}.{$f['id']}", $errors);
            }
        }
        if (self::structureOf($out) !== self::structureOf($page)) $errors[] = ['path' => '', 'msg' => self::MSG_STRUCTURE];
        return ['page' => $out, 'errors' => array_merge($errors, self::validatePageValues($out, $ctx))];
    }

    // ---------------- Markdown collections ----------------

    const IMG_PREFIX = '../../assets/img/';

    public static function imgFromFrontmatter($v): string
    {
        return is_string($v) && strncmp($v, self::IMG_PREFIX, strlen(self::IMG_PREFIX)) === 0 ? substr($v, strlen(self::IMG_PREFIX)) : '';
    }

    /**
     * Builds new frontmatter from submitted values. `def` is the collection from
     * schema/collections.json, `oldEntries` the old frontmatter as [key, value] pairs (unknown keys are
     * kept), dates are ['date' => 'YYYY-MM-DD'].
     */
    public static function applyEntryValues(array $def, array $oldEntries, array $input, array $ctx = []): array
    {
        $errors = [];
        $err = static function (array $f, string $msg) use (&$errors): void { $errors[] = ['path' => $f['id'], 'label' => $f['label'], 'msg' => $msg]; };
        $next = [];
        foreach ($oldEntries as [$k, $v]) $next[$k] = $v;
        $set = static function (string $k, $v) use (&$next): void {
            if ($v === null) unset($next[$k]); else $next[$k] = $v;
        };
        foreach ($def['fields'] as $f) {
            $raw = $input[$f['id']] ?? null;
            switch ($f['type']) {
                case 'text':
                case 'textarea':
                case 'select':
                    $v = self::cleanText($raw, $f['type'] === 'textarea');
                    if (!empty($f['required']) && $v === '') { $err($f, self::MSG_REQUIRED); break; }
                    if (!empty($f['max']) && self::chars($v) > $f['max']) $err($f, self::msgTooLong((int) $f['max'], self::chars($v)));
                    if (self::looksLikeHtml($v)) $err($f, self::MSG_NO_HTML);
                    if ($f['type'] === 'text' && ($w = self::longWord($v)) !== null) $err($f, self::msgLongWord($w, self::chars($w)));
                    if ($f['type'] === 'select' && $v !== '' && !in_array($v, $f['options'], true)) $err($f, self::MSG_BAD_CHOICE);
                    $set($f['id'], $v !== '' ? $v : null);
                    break;
                case 'date':
                    $v = self::cleanText($raw);
                    if ($v === '') { if (!empty($f['required'])) $err($f, self::MSG_REQUIRED); $set($f['id'], null); break; }
                    if (!self::validDate($v)) { $err($f, self::MSG_BAD_DATE); break; }
                    $set($f['id'], ['date' => $v]);
                    break;
                case 'number':
                    $v = self::cleanText(is_int($raw) || is_float($raw) ? (string) $raw : $raw);
                    if ($v === '') { if (!empty($f['required'])) $err($f, self::MSG_REQUIRED); $set($f['id'], null); break; }
                    if (!preg_match('/^-?\d{1,6}(\.\d{1,3})?$/D', $v)) { $err($f, self::MSG_BAD_NUMBER); break; }
                    $set($f['id'], strpos($v, '.') === false ? (int) $v : (float) $v);
                    break;
                case 'boolean':
                    // Keep the key if it was there before, otherwise only write `true`.
                    $set($f['id'], $raw === true ? true : (array_key_exists($f['id'], $next) ? false : null));
                    break;
                case 'tags':
                    $list = is_array($raw) ? array_values(array_filter(array_map(static fn ($x) => self::cleanText($x), $raw), static fn ($x) => $x !== '')) : [];
                    $uniq = array_values(array_unique($list));
                    foreach ($uniq as $t) {
                        if (self::looksLikeHtml($t) || self::chars($t) > self::TAG_MAX) { $err($f, self::MSG_BAD_TAG); break; }
                        if (($w = self::longWord($t)) !== null) { $err($f, self::msgLongWord($w, self::chars($w))); break; }
                    }
                    $set($f['id'], $uniq || array_key_exists($f['id'], $next) ? $uniq : null);
                    break;
                case 'strings':
                    $list = is_array($raw) ? array_values(array_filter(array_map(static fn ($x) => self::cleanText($x), $raw), static fn ($x) => $x !== '')) : [];
                    if (!empty($f['required']) && !$list) $err($f, self::MSG_MIN_ONE);
                    foreach ($list as $t) {
                        if (self::looksLikeHtml($t)) { $err($f, self::MSG_NO_HTML); break; }
                    }
                    $set($f['id'], $list);
                    break;
                case 'image':
                    $v = self::cleanText(is_array($raw) ? ($raw['value'] ?? '') : '');
                    if ($v === '') {
                        // A path the library cannot show (outside src/assets/img) is not the user's removal.
                        $old = $next[$f['id']] ?? null;
                        if ($old && self::imgFromFrontmatter($old) === '') break;
                        $set($f['id'], null);
                        if (!empty($f['altKey'])) $set($f['altKey'], null);
                        break;
                    }
                    if (!self::isImagePath($v)) { $err($f, self::isExternalImage($v) ? self::MSG_IMAGE_EXTERNAL : self::MSG_BAD_IMAGE); break; }
                    if (isset($ctx['imageExists']) && !$ctx['imageExists']($v)) { $err($f, self::msgImageMissing($v)); break; }
                    $set($f['id'], self::IMG_PREFIX . $v);
                    if (!empty($f['altKey'])) {
                        $alt = self::cleanText(is_array($raw) ? ($raw['alt'] ?? '') : '');
                        if ($alt === '') $err(['id' => $f['altKey'], 'label' => $f['label']], self::MSG_ALT_REQUIRED);
                        $set($f['altKey'], $alt !== '' ? $alt : null);
                    }
                    break;
            }
        }
        // Order: keys in the order of the old file, new keys in schema order.
        $order = array_column($oldEntries, 0);
        foreach ($def['fields'] as $f) {
            if (!in_array($f['id'], $order, true)) $order[] = $f['id'];
            if (!empty($f['altKey']) && !in_array($f['altKey'], $order, true)) $order[] = $f['altKey'];
        }
        $entries = [];
        foreach ($order as $k) {
            if (array_key_exists($k, $next)) $entries[] = [$k, $next[$k]];
        }
        // A collection without a body in the admin (team) keeps whatever text its file has.
        $body = $ctx['oldBody'] ?? '';
        if (!empty($def['body'])) {
            $body = rtrim(self::sanitizeMarkdown($input['body'] ?? ''), " \t\n");
            if (isset($ctx['imageExists'])) $body = self::normalizeBodyImages($body, $ctx['imageExists']);
            $n = self::chars($body);
            if ($n > self::BODY_MAX) $errors[] = ['path' => 'body', 'label' => 'Inhalt', 'msg' => self::msgTooLong(self::BODY_MAX, $n)];
            if (self::hasUnsafeLink($body)) $errors[] = ['path' => 'body', 'label' => 'Inhalt', 'msg' => self::MSG_UNSAFE_LINK];
            if (isset($ctx['imageExists'])) $errors = array_merge($errors, self::missingBodyImages($body, $ctx['imageExists']));
        }
        return ['entries' => $entries, 'body' => $body, 'errors' => $errors];
    }
}

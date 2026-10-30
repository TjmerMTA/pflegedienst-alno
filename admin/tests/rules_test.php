<?php
// The vectors were recorded from the hardened JavaScript rules; this port has to reproduce them.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/../public/wp-admin/lib/Rules.php';
require_once __DIR__ . '/../public/wp-admin/lib/Frontmatter.php';

const MD_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote', 'hr', 'code'];
$v = json_decode(file_get_contents(__DIR__ . '/vectors/rules.json'), true);
$simple = [
    'sanitizeHtml' => fn ($i) => Rules::sanitizeHtml($i),
    'sanitizeHtmlMd' => fn ($i) => Rules::sanitizeHtml($i, MD_TAGS),
    'safeHref' => fn ($i) => Rules::safeHref($i),
    'looksLikeHtml' => fn ($i) => Rules::looksLikeHtml($i),
    'sanitizeMarkdown' => fn ($i) => Rules::sanitizeMarkdown($i),
    'hasUnsafeLink' => fn ($i) => Rules::hasUnsafeLink($i),
    'slugify' => fn ($i) => Rules::slugify($i),
    'isImagePath' => fn ($i) => Rules::isImagePath($i),
    'validDate' => fn ($i) => Rules::validDate($i),
    'slugRe' => fn ($i) => preg_match(Rules::SLUG_RE, $i) === 1,
    'pageIdRe' => fn ($i) => preg_match(Rules::PAGE_ID_RE, $i) === 1,
    'revFileRe' => fn ($i) => preg_match(Rules::REV_FILE_RE, $i) === 1,
    'revRe' => fn ($i) => preg_match(Rules::REV_RE, $i) === 1,
];
foreach ($simple as $name => $fn) {
    foreach ($v[$name] as $i => [$in, $want]) test("$name #$i " . mb_substr((string) $in, 0, 40), fn () => eq($fn($in), $want, show($in)));
}
foreach ($v['cleanText'] as $i => [$in, $multi, $want]) test("cleanText #$i", fn () => eq(Rules::cleanText($in, $multi), $want, show($in)));

$fromJs = function ($e) {
    return $e;
};
foreach ($v['frontmatterBuild'] as $i => [$entries, $want]) test("frontmatter build #$i", fn () => eq(Frontmatter::build($entries, "Text\n\n", ['tags']), $want));
foreach ($v['frontmatterParse'] as $i => [$in, $want]) test("frontmatter parse #$i", fn () => eq(Frontmatter::parse($in), $want, $in));
foreach ($v['frontmatterRefused'] as $i => $in) {
    test("frontmatter refuses #$i", function () use ($in) {
        try { Frontmatter::parse($in); } catch (FrontmatterError $e) { return; }
        throw new RuntimeException("parsed: $in");
    });
}
finish();

# Validation and sanitising rules

The rules every save goes through. The code is `public/wp-admin/lib/Rules.php` and `Frontmatter.php`; `tests/vectors/rules.json`
holds recorded input and output pairs for them. The server decides: the browser only previews.

Length is counted in Unicode code points, not bytes. German messages are in `Rules.php`; `assets/js/i18n.js` translates them.

## Limits

| What | Limit |
|---|---|
| Request body of a save | 1 MB (413) |
| Login and setup body | 64 KB |
| JSON nesting | 32 levels |
| Richtext field | 50,000 characters |
| Markdown body | 200,000 characters |
| Alt text | 300 characters |
| Tag | 60 characters |
| Unbroken word in a one-line text | 30 characters |
| Slug | 80 characters, `^[a-z0-9]+(-[a-z0-9]+)*$` |
| Page id | as a slug, with an optional leading `_` |
| User name | `^[a-z][a-z0-9._-]{1,31}$` |
| Password | at least 10 characters, at most 72 bytes |
| Upload | 10 MB or the host's `upload_max_filesize` and `post_max_size`, whichever is lower |
| Image | longest side reduced to 2400 px; at most 40 million pixels |

## Text

**Clean** (every value): invalid UTF-8 is replaced, `\r\n` and `\r` become `\n`, and these are removed: U+0000–0008, 000B, 000C,
000E–001F, 007F–009F, 2028, 2029, FEFF, FFFE, FFFF.

**Trim** removes whitespace as JavaScript's `\s` defines it, including no-break and typographic spaces.

**`text`:** clean, line breaks become one space, trim. Must not hold a line break afterwards. Up to `max` if the field has one.

**Long words:** in `text` fields and tags no unbroken word may have more than 30 characters: buttons do not wrap, and a heading breaks only where it can. A word ends at a space (not a no-break space), a hyphen, a dash, `/` or a soft hyphen. `{{tokens}}` do not count, and neither do values that are addresses (`http:`, `https:`, `mailto:`, `tel:`, a leading `/`) or words with `@`.

**`textarea`:** clean, trim, line breaks stay. Up to `max`.

**Both refuse HTML:** a value is refused when it has `<` followed by a letter, `/`, `!`, `?` or `{`. A single `<` before a space or digit
(«a < b») is allowed, because it cannot open a tag.

**Group `contact`** in any page (lists included): `<` and `>` are refused altogether. These values reach JSON-LD and, as tokens, every page.

**`{{token}}`:** in text, textarea and richtext every `{{name}}` must be a field of group `contact` in `_global.json` (its text-like fields, no lists or
images). Spaces inside the braces are allowed. While `_global.json` is being saved, its own fields count.

## Richtext

An allow-list sanitiser in one pass, linear in the size of the input.

- Allowed tags: `p br strong b em i a ul ol li h2 h3`. Other tags are removed and their text stays.
- Removed with their content: `script style iframe object embed noscript template svg math textarea select title head`.
- Comments, CDATA, `<!…>` and `<?…>` are removed.
- No attribute survives except `href` on `a`. An `a` without a usable `href` becomes its text.
- Open tags are closed, stray closing tags dropped, text is entity-decoded once and escaped again.
- A tag that never ends: everything from there on is text.

The stored value must equal its sanitised form. Saving sanitises first, so this fails only for a value that reaches validation another way (a restored
revision, for one). Then the message is «nicht erlaubtes HTML».

**`href`:** after decoding entities and removing control characters and spaces, it must be `http:`, `https:`, `mailto:`, `tel:`, or a relative path,
`#anchor` or `?query`. Any other scheme and `//host` are refused.

## Markdown bodies

**Nothing is deleted.** Every `<` followed by a letter, `/`, `!` or `?` becomes `&lt;`, everywhere, inside code too. This leaves no raw HTML for any
renderer, wherever it thinks a code span starts. In running text the reader sees the characters that were typed; inside a code span the reader sees `&lt;`. Trailing whitespace goes.

**Unsafe links are refused, never rewritten.** After decoding entities and removing backslashes and line breaks, the text must not hold `javascript:` or `vbscript:`,
whatever follows them, unless a letter, digit, `+`, `.` or `-` comes right before. The same goes for `data:` followed by anything but a typed space: «data: 5» in a sentence is fine.

**Images in the text** must be `http(s)`, start with `/`, or be `../../assets/img/<file>` of an existing image: any other local image fails the build of the whole site. A reference-style image (`![a][r]`) is not checked.

The site should also filter rendered Markdown at build time: this rule protects what the admin saves, not what someone commits by hand.

## Pages (`src/content/pages/*.json`)

- A file with a changed structure is refused for editing: label, `groups`, unique ids, known field types (`text textarea richtext image list`), `list` with `fields` and no list
  inside a list.
- A save only changes `value` and `alt`. Unknown groups or fields are errors, a group that is not sent keeps its values, and the structure fingerprint must stay the same.
- Lists are arrays in the API. `min` and `max` count items. An image inside a list item is `{value, alt}`.
- Required fields must not be empty; richtext counts as empty when nothing is left without its tags.
- The file is rewritten as `JSON.stringify(data, null, 2)` plus a newline. Unchanged content stays byte-identical and makes no commit.

## Images in fields

- «No image» is value `""` and alt `""`. A required image must be set.
- **A set image needs an alt text**, at most 300 characters.
- Path: relative to `src/assets/img/`, ends in `.jpg .jpeg .png .webp`, no backslash, no NUL, no leading `/`, no segment that is empty or starts with a dot. The file must exist in the
  repository or wait in `pending/`.

## Collections (`src/content/{blog,leistungen,team}/*.md`)

Fields per `schema/collections.json`.

| Type | Rule |
|---|---|
| text, textarea | as above; `max` if set |
| select | one of `options` |
| date | `YYYY-MM-DD`, a real date |
| number | `-?\d{1,6}(\.\d{1,3})?` |
| boolean | `true` is written; `false` only if the key existed before |
| tags | cleaned, duplicates removed, 60 characters each, no HTML |
| strings | cleaned, empty lines removed, no HTML |
| image | as above; `altKey` names the alt field if there is one |

Keys the schema does not know stay in the file, in their order. A new key comes after them in schema order. A collection without a body in the admin (Team) keeps the text its file has.

Frontmatter is parsed and written by `Frontmatter.php`. A file it does not understand, with no frontmatter or a mapping in a value, is shown as unreadable and not touched. Comments in frontmatter do not survive a save.

## New entries, trash, revisions

- The slug comes from the Permalink field or the title: lower case, `ä ö ü ß` to `ae oe ue ss`, accents removed, anything else to `-`. A taken slug is refused.
- Trash: the commit that removes the file comes first; only then is the copy written to the data folder. Restoring from the trash is refused if one of the entry's images has gone.
- A restored revision goes through the same rules as a save. Page values are poured into the current structure, and a value that no longer passes refuses the restore. An image outside the library is refused, and a file of a collection without «create» cannot come back once it is gone.
- Commit messages drop `[skip ci]` and its variants from titles: an editor's words must not switch off the build.

## Uploads

1. Not empty, within the size limit.
2. No SVG: the first 512 bytes must not start with `<svg` or `<?xml` or hold `<svg`.
3. Type from the content's magic bytes (JPEG, PNG, WebP), confirmed by `finfo`. The name and the browser's claim are ignored.
4. WebP needs support on the host. An animated WebP is refused.
5. Must decode, at most 40 million pixels (a 256 MB PHP cannot decode more).
6. Re-encoded through GD (Imagick where there is no GD): JPEG 84, PNG 9, WebP 84. EXIF orientation is applied, metadata does not survive. Longest side at most 2400 px.
7. Stored as `uploads/<16 hex>.<ext>`. The original name goes to the log only.

## Requests

- Host must be local or in `hosts` of `config.json` (421).
- POST: `Origin`, or else `Referer`, must match the host; `Origin: null` is refused.
- POST needs `X-WP-Nonce` equal to the session's token. Login and setup: `X-Login-Nonce` equal to the cookie `alno_login`.
- JSON bodies need `Content-Type: application/json`.
- Login: 5 failures per name and network, 20 per network, within 15 minutes lock for 15 minutes. A network is the IPv4 address or the IPv6 /64. The attempt is counted before the slow hash, under a file lock, so parallel guesses cannot pass the check together. Locked attempts are not logged. A stranger cannot lock someone else out from another network.
- Reads of Anfragen go to `logs/access.log`, which only logged-in users can fill.
- Saves carry the blob id they were based on. Another id answers 409 and the input stays on the screen.
- Anfragen: rules in `docs/anfragen-format.md`, section 4.

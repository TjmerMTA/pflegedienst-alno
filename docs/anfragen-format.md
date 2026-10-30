# Anfragen: stored submissions (contract between the form endpoint and the admin)

`public/api/anfrage.php` receives the site's forms and stores each one as a JSON file outside the web root.
The admin's «Anfragen» screen reads these files. They hold personal data, some of it health data (Art. 9 GDPR).

## 1. Where the data lives

```
~/alno-data/                     0700, created on the first submission
  config.php                     optional, section 5
  salt                           random, generated once. Never show it, never delete it
  anfragen-warnung.json          only while the storage limit is reached, section 5
  ratelimit/<hash>               request times per IP hash, removed after 24 h
  anfragen/
    <id>.json                    one file per submission, 0600
    files/<stored>               uploaded files, 0600, no extension
```

`public/api/data-dir.php` finds the folder, and the admin uses the same file: `ALNO_DATA_DIR` as an override, else the
absolute path written at setup into `.alno-data-dir` beside the web root, else `~` from `posix_getpwuid()` or `$HOME`. If none
of them answers, or the path really lies in a web root (by `realpath`, through every parent), the endpoint stores nothing
and answers 500.

## 2. One submission

`anfragen/<id>.json`, UTF-8, pretty-printed:

```json
{
    "id": "2026-10-30-132824-b48fc68bab33b63f",
    "received": "2026-10-30T13:28:24+01:00",
    "form": "karriere",
    "page": "/karriere/",
    "fields": {
        "position": "Pflegefachkraft (m/w/d)",
        "name": "Ben Beispiel",
        "phone": "0231 654321",
        "email": "ben@example.org",
        "datenschutz": "ja"
    },
    "invalid": [],
    "files": [
        { "name": "Lebenslauf.pdf", "stored": "6f1c0e5b9d3a4f7e8a2b1c0d9e8f7a6b", "size": 48213, "type": "application/pdf" }
    ],
    "status": "neu",
    "ip_hash": "f63982b1640f5c0f9a9becc2a39bed16"
}
```

| Key | Meaning |
|---|---|
| `id` | `YYYY-MM-DD-HHMMSS-<16 hex>`, the file name without `.json`. Time is Europe/Berlin. Sort by it for newest first |
| `received` | ISO 8601 with offset |
| `form` | one of the values in section 3 |
| `page` | path of the page the form was sent from, no query string. `""` if it was not a clean path |
| `fields` | `{ name: value }`, section 3. Empty optional fields are absent. `datenschutz` is always `"ja"`: the visitor ticked the consent box |
| `invalid` | names of optional fields that failed their rule. The value stays in `fields` as given (cut to the limit), so show it marked, for example with `ungültig`. A flagged `email` is not a usable address: no mailto link, no reply button. `[]` on a clean enquiry |
| `files` | array, `[]` when there are none. `name` is the visitor's cleaned file name (for display only), `stored` the name under `files/`, `size` bytes, `type` the type found by reading the content |
| `files_refused` | only when the storage limit was reached: how many files were sent but not stored. Show it: the applicant believes they arrived |
| `status` | `"neu"` on arrival. All other values belong to the admin |
| `ip_hash` | 32 hex, salted HMAC of the IP. Pseudonymous, still personal data: do not show it. The raw IP is stored nowhere |

## 3. Forms and fields

Values are plain text. `message`, `qualifikation` and `rechner_ergebnis` may contain `\n`, all others are one line. Dates are
`YYYY-MM-DD`, unless the field is listed in `invalid`. Field order in the file is the order below, then `datenschutz`.

| `form` | Fields (`*` always present) | Notes |
|---|---|---|
| `beratung` | `leistung`, `name*`, `phone*`, `email`, `message` | Kontakt |
| `rueckruf` | `name*`, `phone*`, `rueckrufzeit` | Startseite, Leistungen |
| `erstbegutachtung` | `leistung`, `name*`, `phone*`, `stadtteil*`, `wunschtermin`, `tageszeit`, `pflegegrad`, `email`, `message` | |
| `rechner` | `rechner_ergebnis`, `name*`, `phone*`, `email` | Pflege-Rechner dialog |
| `rechnertermin` | `rechner_ergebnis`, `name*`, `phone*`, `wunschtermin`, `tageszeit` | Pflege-Rechner dialog |
| `karriere` | `position*`, `name*`, `phone*`, `email*`, `qualifikation`, `eintritt`, `arbeitszeit`, `message` | may have `files` |
| `ausbildung` | `wunsch`, `name*`, `geburtsjahr*`, `phone*`, `email*`, `schulabschluss*`, `beginn`, `message` | may have `files` |

Suggested German labels: Leistung, Name, Telefon, E-Mail, Nachricht, Rückrufzeit, Ort / Stadtteil, Wunschtermin, Tageszeit,
Pflegegrad, Ergebnis des Pflege-Rechners, Stelle, Qualifikation, Eintrittstermin, Arbeitszeit, Wunsch, Geburtsjahr,
Schulabschluss, Beginn, Datenschutz.

**One rule set:** `src/config/form-rules.json` holds the forms, their fields, which are required, and each field's minimum,
maximum and pattern. The forms take their `minlength`, `maxlength` and `pattern` from it (`fieldAttrs()` in
`src/config/site.ts`), and the endpoint reads the same file through `/api/anfrage-site.json`. A new form or field needs an
entry there plus the input in the component. `npm run test:anfrage` fails when they drift apart: it posts every form it
finds in `dist` and compares each input's attributes with the rules.

## 4. Rules for the admin

- **Everything in a record came from a stranger.** Escape every value on output. `fields` and `files[].name` can hold any
  text that passes the length limits.
- **Check ids before building a path.** `id` must match `^\d{4}-\d\d-\d\d-\d{6}-[0-9a-f]{16}$`, `stored` must match
  `^[0-9a-f]{32}$`. Never put `files[].name` in a path.
- **Files are downloads, never inline.** Send `Content-Disposition: attachment`, the stored `type`, and
  `X-Content-Type-Options: nosniff`. Do not open them on the server.
- **Same user.** Files are `0600`: the admin must run as the hosting user to read them.
- **Changing `status`:** write a temp file next to the record and `rename()` it, keep `0600`, keep all other keys.
- **Deleting a submission deletes its `files/<stored>` too.**
- **Ignore file names starting with a dot** in `anfragen/`: they are writes in progress.
- **Show `anfragen-warnung.json` on the dashboard** while it exists, section 5. Deleting records frees the space; the
  next submission removes the warning.

## 5. Configuration

`~/alno-data/config.php`, optional, uploaded by hand:

```php
<?php return [
  'anfragen_to' => 'buero@example.de',          // default: the contact e-mail of the site
  'anfragen_max_mb' => 200,                     // limit for anfragen/, records and files together
  'mail_from'   => 'no-reply@example.de',       // default: no-reply@<domain of SITE_URL>
  'rate_max'    => 5,                           // requests per IP per window
  'rate_window' => 600,                         // seconds
  'uploads'     => false,                       // section 8
];
```

Fallback values come from `/api/anfrage-site.json`, generated at build time from `_global.json` (`contact.email`) and
`SITE_URL`. A broken or invalid `config.php` falls back to them and the submission is kept.

**Storage limit.** At `anfragen_max_mb`, files are no longer stored but text enquiries still are, so nothing is lost while
someone reacts. At 110 % of the limit, or if a record cannot be written, the endpoint answers 503, stores nothing and sends
no mail. From the limit on, `~/alno-data/anfragen-warnung.json` exists:

```json
{
    "code": "anfragen_voll",
    "since": "2026-10-30T13:28:24+01:00",
    "used_mb": 201.3,
    "limit_mb": 200,
    "message": "Der Speicher für Anfragen ist voll: 201.3 von 200 MB. Bitte erledigte Anfragen löschen."
}
```

It holds no personal data. The endpoint removes it with the first submission after the size is back under the limit.

## 6. Build and deployment

| Variable | Production value | Without it |
|---|---|---|
| `PUBLIC_FORM_ENDPOINT` | `/api/anfrage.php` | Forms stay in preview mode: checked, not sent, a preview message is shown. This is what `npm run dev`, `astro preview` and the GitHub Pages preview do |
| `SITE_URL` | `https://<production domain>` | The notification comes from `no-reply@dev.siteboosty.com` |

Set both in the deploy workflow's build step. The domain in `SITE_URL` must be allowed to send from the Hetzner host
(SPF), or the notifications land in spam.

Try it locally:

```bash
PUBLIC_FORM_ENDPOINT=/api/anfrage.php npm run build
ALNO_DATA_DIR=/tmp/alno-data php -S 127.0.0.1:8000 -t dist
```

**First deploy:** send one test form, then check by FTP that `~/alno-data/anfragen/` holds it and is not under
`public_html`, and that the mail arrived. If the form shows the error message, the PHP error log says why (it holds ids
only, no personal data). If the home directory is detected wrongly, set `ALNO_DATA_DIR` with `SetEnv` in `.htaccess`.

## 7. What the endpoint enforces

Only `POST` as `multipart/form-data`, with `Origin` or `Referer` of the same host. 128 KB body without files, 32 MB with.
Rate limit per IP, per /64 for IPv6, rejected requests included. Honeypot `website` (answers success, stores nothing).
`fill_ms`, the time the browser reports since page load, at least 3000: it stops simple bots, a script can fake it.
Field names per form and the consent box are strict.

**A required field that fails rejects the submission** with 422 and its name in `field`, and the form shows the error under
that field. **An optional field never costs an enquiry:** the page stops the visitor first, and anything that still arrives
is stored and flagged in `invalid`. The hidden `rechner_ergebnis` is cut at its limit without a flag: the visitor cannot see
or fix it.

| Status | `error` | Meaning |
|---|---|---|
| 200 | | `{ "ok": true }` |
| 403 | `origin` | not sent from the site |
| 405, 415 | `method`, `content_type` | not a form post |
| 413 | `too_large` | body too big |
| 422 | `spam`, `invalid` (+ `field`) | failed a check |
| 429 | `rate_limit` | too many requests, with `Retry-After` |
| 500 | `storage` | not set up: data folder or rules unavailable, nothing stored, no mail |
| 503 | `storage_full` | over the hard stop or a failed write, nothing stored, no mail |

Failures are `{ "ok": false, "error": "…", "message": "…" }`. For `invalid` the form shows its own text for that field
(`errName`, `errPhone`, `errEmail`, `errInvalid` in `_global.json`, group `forms`); every other failure shows `msgFail` with
the phone number. A form reports success only for `{ "ok": true }`, not for a 200 alone.

The notification mail holds form, time, page, name, phone and e-mail, a flagged e-mail marked `(ungültig)` and never used
as `Reply-To`. Free text, health details and files stay on the server, because the mail travels through outside servers. It is sent after storing, so a mail failure loses nothing:
the visitor still gets success and the error log records the id.

## 8. File uploads

**Off.** No form has a file field, so any file part is refused with 422 and `field: "dateien"`, and the 128 KB body limit
applies to every form. The forms ask applicants to send the CV by e-mail.

To switch them on later: `'uploads' => true` in `config.php`, an `<input type="file" name="dateien[]" multiple>` with its
visible text in `ApplicationForm.astro`, and `upload_max_filesize` 10 M and `post_max_size` 33 M on the host. They then
work on `karriere` and `ausbildung` only: pdf, jpg, png, docx, at most 3 files of 10 MB each. The type is read from the
content and the extension must match. A DOCX must be a real ZIP with the Word content type (this needs PHP's zip extension)
and must not declare macros. A PDF needs its end marker. Check the storage limit first: at 200 MB a few applications with
files will reach it.

## 9. Open before go-live

- **Datenschutzerklärung** section 3 and 5 still have the placeholders for hoster and form provider, and do not yet
  say that submissions are stored on the server and announced by e-mail.
- **Deletion:** section 5 promises deletion once a request is finished. Nothing deletes records yet. The admin needs a
  delete action and an agreed retention period, with a separate one for applications.
- **Encryption at rest:** records are plain JSON, protected by file permissions only.

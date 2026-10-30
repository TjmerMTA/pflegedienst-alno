# Anfragen: stored submissions (contract between the form endpoint and the admin)

`public/api/anfrage.php` receives the site's forms and stores each one as a JSON file outside the web root.
The admin's «Anfragen» screen reads these files. They hold personal data, some of it health data (Art. 9 GDPR).

## 1. Where the data lives

```
~/alno-data/                     0700, created on the first submission
  config.php                     optional, section 5
  salt                           random, generated once. Never show it, never delete it
  ratelimit/<hash>               request times per IP hash, removed after 24 h
  anfragen/
    <id>.json                    one file per submission, 0600
    files/<stored>               uploaded files, 0600, no extension
```

`~` is the hosting user's home, found through `posix_getpwuid()`, then `$HOME`, then the parent of the web root. The
environment variable `ALNO_DATA_DIR` overrides it. If the path is inside the web root, the endpoint stores nothing and
answers 500.

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
| `files` | array, `[]` when there are none. `name` is the visitor's cleaned file name (for display only), `stored` the name under `files/`, `size` bytes, `type` the type found by reading the content |
| `status` | `"neu"` on arrival. All other values belong to the admin |
| `ip_hash` | 32 hex, salted HMAC of the IP. Pseudonymous, still personal data: do not show it. The raw IP is stored nowhere |

## 3. Forms and fields

Values are plain text. `name`-type fields are one line; `message`, `qualifikation` and `rechner_ergebnis` may contain `\n`.
Dates are `YYYY-MM-DD`. Field order in the file is the order below, then `datenschutz`.

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

A new form or field needs the same change in the component and in `FORMS` at the top of `anfrage.php`, or it is rejected.
`npm run test:anfrage` fails when they drift apart: it posts every form it finds in `dist`.

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

## 5. Configuration

`~/alno-data/config.php`, optional, uploaded by hand:

```php
<?php return [
  'anfragen_to' => 'buero@example.de',          // default: the contact e-mail of the site
  'mail_from'   => 'no-reply@example.de',       // default: no-reply@<domain of SITE_URL>
  'rate_max'    => 5,                           // requests per IP per window
  'rate_window' => 600,                         // seconds
];
```

Fallback values come from `/api/anfrage-site.json`, generated at build time from `_global.json` (`contact.email`) and
`SITE_URL`. A broken or invalid `config.php` falls back to them and the submission is kept.

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
Per-IP rate limit, rejected requests included. Honeypot `website` (answers success, stores nothing). `fill_ms`, the time
the browser reports since page load, at least 3000: it stops simple bots, a script can fake it. Field names per form,
types, length limits, consent. One invalid value rejects the whole submission.

| Status | `error` | Meaning |
|---|---|---|
| 200 | | `{ "ok": true }` |
| 403 | `origin` | not sent from the site |
| 405, 415 | `method`, `content_type` | not a form post |
| 413 | `too_large` | body too big |
| 422 | `spam`, `invalid` (+ `field`) | failed a check |
| 429 | `rate_limit` | too many requests, with `Retry-After` |
| 500 | `storage` | nothing could be stored, no mail was sent |

Failures are `{ "ok": false, "error": "…", "message": "…" }`. The forms look only at the status and show their own
message, which includes the phone number.

The notification mail holds form, time, page, name, phone and e-mail. Free text, health details and files stay on the
server, because the mail travels through outside servers. It is sent after storing, so a mail failure loses nothing:
the visitor still gets success and the error log records the id.

## 8. File uploads

The endpoint accepts them on `karriere` and `ausbildung`, in the field `dateien[]`: pdf, jpg, png, docx, at most 3 files of
10 MB each. The type is read from the content, the extension must match it, and macro documents are refused.
**The forms have no file field today**: they ask applicants to send the CV by e-mail. Adding one means an
`<input type="file" name="dateien[]" multiple>`, the visible text around it, and raising `upload_max_filesize` to 10 M
and `post_max_size` to 33 M on the host.

## 9. Open before go-live

- **Datenschutzerklärung** section 3 and 5 still have the placeholders for hoster and form provider, and do not yet
  say that submissions are stored on the server and announced by e-mail.
- **Deletion:** section 5 promises deletion once a request is finished. Nothing deletes records yet. The admin needs a
  delete action and an agreed retention period, with a separate one for applications.
- **Encryption at rest:** records are plain JSON, protected by file permissions only.

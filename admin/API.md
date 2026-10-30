# Admin API

One front controller: `/wp-admin/api.php?r=<route>`. Implemented in `public/wp-admin/lib/Api.php`.

- **GET** takes its parameters in the query.
- **POST** takes JSON (`Content-Type: application/json`, at most 1 MB) and the header `X-WP-Nonce: <nonce>` from `session`. Upload is the exception.
- **Login and setup** take the header `X-Login-Nonce: <loginNonce>`, which must equal the cookie `alno_login` set by `session`.
- Answers are JSON, `Cache-Control: no-store`.
- `job` in an answer is the commit sha: pass it to `status`.

## Errors

`{ "error": code, "message": text, ... }`

| Status | `error` | Meaning |
|---|---|---|
| 400 | `bad_request` | not a JSON object, bad value |
| 401 | `login`, `invalid` | no session, wrong login |
| 403 | `forbidden` | `message: csrf` or `origin`, or no permission |
| 404 | `not_found` | |
| 405 | `bad_request` | wrong method |
| 409 | `conflict` | the file changed; `hash` (and `page`) if it could be read |
| 409 | `exists`, `in_use`, `self` | slug taken, image still used, deleting yourself |
| 413 | `too_large` | |
| 415 | `bad_request` | wrong content type |
| 421 | `bad_request` | host not allowed |
| 422 | `validation` | `errors: [{path, label, msg}]`, for pages also `page` with the input |
| 422 | `structure`, `unreadable` | the file cannot be edited |
| 422 | `token`, `bad_name`, `too_short`, `too_long`, `wrong_password`, `retention` | |
| 429 | `locked` | `retryMinutes` |
| 500 | `server` | details in the log only |
| 502 | `github` | GitHub refused or is unreachable; `message` says why |
| 503 | `setup` | not set up yet |

## Session and setup

| Route | Method | Who | In | Out |
|---|---|---|---|---|
| `session` | GET | anyone | | 200 `user lang admin anfragen nonce siteUrl actionsUrl uploadMaxBytes pages status newAnfragen`; 401 `error: login, loginNonce`; 401 `error: setup, loginNonce, checks` |
| `setup` | POST | anyone, once | `token user password` | `ok` |
| `login` | POST | anyone | `user password` | `ok` |
| `logout` | POST | user | | `ok` |

## Content

| Route | Method | Who | In | Out |
|---|---|---|---|---|
| `dashboard` | GET | user | | `counts runs activity firstPage anfragenWarning` |
| `status` | GET | user | `commit` optional | with `commit`: `state url at commit id phase`; without: `latest finished` |
| `pages` | GET | user | | `pages` |
| `page` | GET | user | `id` | `id page hash revisions tokens structureErrors` |
| `page` | POST | user | `id hash values` | `ok job` or `ok unchanged` |
| `entries` | GET | user | `type status s` | `def entries trash view search counts` |
| `entry` | GET | user | `type id` | `def slug values body hash revisions` |
| `entry/new` | GET | user | `type` | `def slug values body` |
| `entry` | POST | user | `type id hash slug values body` (`id` empty = new) | `ok id job` or `ok id unchanged` |
| `entry/trash` | POST | user | `type id` | `ok job` |
| `entry/untrash` | POST | user | `type trashId` | `ok id job` |
| `entry/delete` | POST | user | `type trashId` | `ok` |

`type` is `post`, `leistung` or `team`. `state` is `queued`, `running`, `done`, `failed` (with `phase: build | deploy`) or `superseded`. A commit with no run yet reads as `queued`.

`values` of a page: `{ group: { field: value } }`, an image `{value, alt}`, a list an array of objects.

## Media

| Route | Method | Who | In | Out |
|---|---|---|---|---|
| `media` | GET | user | `s` | `images` |
| `media/item` | GET | user | `path` | `image info usedOn alt` |
| `media/file` | GET | user | `path thumb` | the image |
| `media/upload` | POST | user | multipart field `file`, one per request; `?stage=1` from the modal | `files errors` |
| `media/meta` | POST | user | `path alt` | `ok` |
| `media/delete` | POST | user | `path` | `ok` |

`?stage=1` keeps the image in `pending/` until a save uses it, and that save commits both together. Without it the image is committed at once with `[skip ci]`, because nothing uses it yet.

## Revisions

| Route | Method | Who | In | Out |
|---|---|---|---|---|
| `revisions` | GET | user | | `files` |
| `revisions/file` | GET | user | `file rev` | `file title edit revs selected diff same` |
| `revisions/restore` | POST | user | `file rev` | `ok job edit` |

## Users

| Route | Method | Who | In | Out |
|---|---|---|---|---|
| `profile/lang` | POST | user | `lang` | `ok` |
| `profile/password` | POST | user | `current password` | `ok` |
| `users` | GET | admin | | `users` |
| `users/add` | POST | admin | `name password admin lang anfragen` | `ok` |
| `users/update` | POST | admin | `name password anfragen` | `ok` |
| `users/delete` | POST | admin | `name` | `ok` |

## Anfragen

For administrators and users with the `anfragen` flag; `anfragen/retention` for administrators only. Each read and download is logged by id, without content.

| Route | Method | In | Out |
|---|---|---|---|
| `anfragen` | GET | `view` (`neu`, `erledigt`, `trash`) | `items counts retention view cronLast warning`, for administrators `cronUrl` |
| `anfragen/item` | GET | `id` | `id received form name phone status files deleteAt invalid filesRefused page fields attachments trashed` |
| `anfragen/file` | GET | `id stored` | the file, always as a download |
| `anfragen/status` | POST | `id status` (`neu`, `erledigt`) | `ok` |
| `anfragen/trash` | POST | `id` | `ok` |
| `anfragen/restore` | POST | `id` | `ok` |
| `anfragen/delete` | POST | `id` | `ok` |
| `anfragen/retention` | POST | `inquiries applications` (months, 1–60) | `ok` |

`warning` and `anfragenWarning` are `{since, usedMb, limitMb}` while `anfragen-warnung.json` exists, otherwise `null`.

## Cron

`cron.php` runs the automatic deletion. From the command line, or over HTTP as `cron.php?key=<cron_key>`. A missing or wrong key answers 403.

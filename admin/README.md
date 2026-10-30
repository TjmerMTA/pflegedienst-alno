# ALNO Admin

Die Verwaltung der Website im Stil von WordPress: alle Texte und Bilder ändern, ohne Code anzufassen.
Админка сайта в стиле WordPress: меняете все тексты и картинки, не трогая код.

- [Deutsch](#deutsch)
- [Русский](#русский)
- [English: hosting and setup](#english-hosting-and-setup)

---

## Deutsch

### Anmelden

Im Browser öffnen: <https://pflegedienst-alno.de/wp-admin/>

### Benutzer anlegen

Unter **Benutzer** (nur für Administratoren) → „Neuen Benutzer anlegen“. Das Passwort braucht mindestens 10 Zeichen. Die Sprache stellt jeder selbst um: oben rechts auf den Namen zeigen → „Русский“, oder unter „Profil“.

Nur wer das Häkchen **Anfragen lesen** hat, sieht die Anfragen. Dort stehen Gesundheitsdaten: Bitte nur Personen freischalten, die sie brauchen.

### So funktioniert das Speichern

1. Du klickst auf „Aktualisieren“. Die Eingaben werden geprüft.
2. Die Änderung wird gespeichert und als Revision abgelegt.
3. Die Website wird neu erstellt: „Seite aktualisiert — die Website ist in 1–2 Minuten auf dem neuen Stand“.
4. Danach steht oben „Website aktuell“.

Geht beim Erstellen etwas schief, erscheint eine Fehlermeldung und **die Website wurde nicht verändert**: Die Besucher sehen weiter den alten Stand, deine Änderung bleibt gespeichert.

### Bilder

Unter **Medien** oder direkt am Bildfeld mit „Bild ersetzen“. Erlaubt sind JPG, PNG und WebP. Zu große Bilder werden automatisch verkleinert. Wer ein Bild einsetzt, muss einen Alternativtext ausfüllen: Das ist die Beschreibung für Menschen, die das Bild nicht sehen können.

### Anfragen

Unter **Anfragen** stehen die Eingänge aus den Formularen der Website. Die Liste zeigt Datum, Formular, Name und Telefon. Alles Weitere steht nur in der Ansicht einer Anfrage.

- **Als erledigt markieren**, wenn sie bearbeitet ist.
- **In den Papierkorb**: Dort bleibt sie höchstens 30 Tage.
- **Automatische Löschung:** Nach Ablauf der Frist wird eine Anfrage endgültig gelöscht, auch aus dem Papierkorb. Das geplante Datum steht bei jedem Eintrag. Die Fristen legt ein Administrator unten auf der Seite fest (Standard: je 6 Monate für Anfragen und Bewerbungen).
- Ein Feld mit dem Vermerk **ungültig** hat die Prüfung nicht bestanden, zum Beispiel eine E-Mail-Adresse ohne @. Dort hilft nur ein Anruf.
- Erscheint auf dem Dashboard „Der Speicher für Anfragen ist voll“, bitte erledigte Anfragen löschen.

### Wo liegen die Daten?

| Was | Wo |
|---|---|
| Texte, Beiträge, Bilder | im GitHub-Repository, mit dem ganzen Verlauf |
| Benutzer, Anfragen, Papierkorb, Protokolle | auf dem Hosting in `~/alno-data`, außerhalb der Website |

Bitte `~/alno-data` regelmäßig sichern: Dort liegen die Benutzer und die Anfragen. Diese Sicherung enthält Gesundheitsdaten.

### Passwort vergessen

Ein Administrator vergibt unter **Benutzer** ein neues Passwort. Hat kein Administrator mehr Zugang, siehe unten im englischen Teil (für den Webmaster).

---

## Русский

### Вход

Откройте в браузере: <https://pflegedienst-alno.de/wp-admin/>

### Как добавить пользователя

Раздел **Пользователи** (только для администраторов) → «Создать пользователя». В пароле не меньше 10 символов. Язык каждый меняет сам: наведите на имя справа вверху → «Deutsch», или в «Профиле».

Заявки видит только тот, у кого стоит галочка **Чтение заявок**. Там есть данные о здоровье: открывайте доступ только тем, кому он нужен.

### Как работает сохранение

1. Вы нажимаете «Обновить». Введённое проверяется.
2. Изменение сохраняется как редакция.
3. Сайт пересобирается: «Страница обновлена — через 1–2 минуты изменения появятся на сайте».
4. После этого вверху видно, что сайт актуален.

Если при сборке что-то пошло не так, появится сообщение об ошибке, и **на сайте ничего не изменится**: посетители видят старую версию, а ваше изменение остаётся сохранённым.

### Картинки

В разделе **Медиафайлы** или прямо в поле картинки кнопкой «Заменить картинку». Подходят JPG, PNG и WebP. Слишком большие картинки уменьшаются сами. Если картинка выбрана, нужно заполнить альтернативный текст: это описание для тех, кто её не видит.

### Заявки

В разделе **Заявки** лежит всё, что пришло с форм сайта. В списке видны дата, форма, имя и телефон. Остальное есть только в карточке заявки.

- **Отметить обработанной**, когда заявка закрыта.
- **В корзину**: там она хранится не больше 30 дней.
- **Автоудаление:** по истечении срока заявка удаляется навсегда, в том числе из корзины. Плановая дата видна у каждой записи. Сроки задаёт администратор внизу страницы (по умолчанию по 6 месяцев для заявок и откликов на вакансии).
- Пометка **неверно** значит, что поле не прошло проверку, например e-mail без @. В таком случае лучше позвонить.
- Если на консоли появилось «Хранилище заявок заполнено», удалите обработанные заявки.

### Где лежат данные

| Что | Где |
|---|---|
| Тексты, записи, картинки | в репозитории GitHub, со всей историей |
| Пользователи, заявки, корзина, журналы | на хостинге в `~/alno-data`, вне сайта |

Регулярно делайте копию `~/alno-data`: там пользователи и заявки. В этой копии есть данные о здоровье.

### Забыли пароль

Администратор задаёт новый пароль в разделе **Пользователи**. Если доступа нет ни у одного администратора, смотрите английскую часть (для вебмастера).

---

## English: hosting and setup

Target: Hetzner Webhosting M (konsoleH). Apache and PHP 8.2 or newer, cron, SFTP. No Node, no shell. Nothing runs in the admin's place: the admin writes commits, and GitHub Actions builds and uploads.

```
GitHub repo TjmerMTA/pflegedienst-alno, branch main   source of truth
  ↑ commits (GitHub REST API, fine-grained token)
  │                       ↓ push → .github/workflows/deploy.yml: build, then SFTP
public_html/              site, api/, wp-admin/, wp-login.php
~/alno-data/              config.json (token), users.json, sessions, logs, trash, anfragen/
~/.alno-deploy-manifest   what the last deploy uploaded, with hashes
```

### Setup, once

**1. SSH key for the upload.** On your machine:

```bash
ssh-keygen -t ed25519 -N '' -C alno-deploy -f alno_sftp
```

Add `alno_sftp.pub` to the hosting account (konsoleH, SSH keys, or `~/.ssh/authorized_keys` by SFTP). Then store the private key and the host key as repository secrets:

```bash
gh secret set SFTP_KEY --repo TjmerMTA/pflegedienst-alno < alno_sftp
ssh-keyscan -p 22 www810.your-server.de > known_hosts     # compare the fingerprint with konsoleH
gh secret set SFTP_KNOWN_HOSTS --repo TjmerMTA/pflegedienst-alno < known_hosts
rm alno_sftp known_hosts
```

Without `SFTP_KNOWN_HOSTS` the workflow warns and trusts whatever key answers that day. Pushing `deploy.yml` itself needs a token with the `workflow` right. The admin's token never touches it.

**2. PHP.** In konsoleH: PHP 8.2 or newer, `upload_max_filesize` at least 12M (konsoleH sets `post_max_size` with it). The setup screen shows what the host really has: GD or Imagick, WebP, limits.

**3. First deploy.** Push to `main`, or start the workflow by hand. Open <https://pflegedienst-alno.de/wp-admin/lib/Rules.php>: it must answer 403. If it does not, `.htaccess` is not in effect. The whole admin needs HTTPS, its cookies are `Secure`.

**4. Token.** <https://github.com/settings/personal-access-tokens/new>:

| Setting | Value |
|---|---|
| Resource owner | `TjmerMTA` |
| Repository access | Only select repositories: `pflegedienst-alno` |
| Contents | Read and write |
| Actions | Read-only |
| Metadata | Read-only (set automatically) |

Nothing else. Choose an expiry and put it in the calendar.

**5. Setup screen.** Open <https://pflegedienst-alno.de/wp-admin/> and paste the token, a user name and a password. This creates the first administrator. A stranger cannot claim the installation: setup needs a token that can write to this repository, and it refuses once `config.json` exists.

**6. Cron.** In konsoleH add a daily job. The address with its key is under **Anfragen**, for administrators:

```
https://pflegedienst-alno.de/wp-admin/cron.php?key=…
```

or, where cron runs PHP scripts directly, `php ~/public_html/wp-admin/cron.php`. Deletion also runs on every visit to Anfragen, so the job is what keeps retention when nobody logs in.

**7. Check a form.** Send one test enquiry from the site and find it under Anfragen. Details: `docs/anfragen-format.md`, section 6.

### How deploys work

- `deploy.yml` has jobs `build` and `deploy`. Keep these names: the admin reads them through the Actions API to tell a failed build from a failed upload.
- `scripts/assemble-upload.sh` puts `dist/` and the admin in one folder; `scripts/deploy-sftp.sh` uploads it.
- Only changed files go up, assets before pages. The only files ever deleted are ones an earlier deploy uploaded, listed in `~/.alno-deploy-manifest`. Anything else in `public_html` stays, and `~/alno-data` is never touched.
- The first deploy therefore leaves old files of a previous site in place. Remove them by hand.
- Start the workflow by hand with `full` to upload everything again.
- One deploy at a time; a running deploy is never cut off, and a newer push replaces a waiting one.

### Good to know

- **Data folder:** `~/alno-data`, found exactly as `public/api/anfrage.php` finds it (`ALNO_DATA_DIR`, the user's home from `posix_getpwuid`, `$HOME`, the parent of the web root). Both must agree; if the home is detected wrongly, set `ALNO_DATA_DIR` with `SetEnv` in `.htaccess`. Setup refuses a folder inside the web root.
- **Token expired:** the admin says so. Create a new one and replace `token` in `~/alno-data/config.json` by SFTP.
- **Locked out, no administrator left:** by SFTP delete `~/alno-data/users.json` and `~/alno-data/config.json`, open the setup screen, paste a token. Content and Anfragen are not affected.
- **Backups:** `~/alno-data` is not in Git. It holds health data, so keep the backup as protected as the host.
- **Rate limit:** GitHub allows 5,000 requests an hour per token. Reads go through a cache in `~/alno-data/cache` keyed by object id, and conditional requests do not count. The cache can be deleted at any time.
- **Images:** the host's limits are 256 MB per script and 180 s, so uploads above 40 million pixels are refused.

### Development

```bash
npm run admin        # php admin/tests/dev.php: http://127.0.0.1:4400/wp-admin/  admin / dev-passwort-123
npm run test:admin   # php admin/tests/run.php
```

`dev.php` runs the real admin under `php -S` against `tests/fake-github.php`, with sample enquiries. It touches nothing real. `--seed=<folder>` starts from a copy of the repository, `--setup` from the setup screen, `--fresh` from nothing.

- `API.md`: the endpoints.
- `VALIDATION.md`: every rule.
- `docs/admin-content-format.md`: the content contract.
- `docs/anfragen-format.md`: stored submissions.

# ALNO Admin

Die Verwaltung der Website im Stil von WordPress: alle Texte und Bilder ändern, ohne Code anzufassen.
Админка сайта в стиле WordPress: меняете все тексты и картинки, не трогая код.

- [Deutsch](#deutsch)
- [Русский](#русский)
- [English: running it on a Linux server](#english-running-it-on-a-linux-server)

---

## Deutsch

### Starten

Im Ordner der Website:

```bash
npm install          # nur beim ersten Mal
npm run admin
```

Dann im Browser öffnen: <http://127.0.0.1:4400/wp-admin/>

### Benutzer anlegen

```bash
npm run admin:user -- add anna              # fragt nach dem Passwort (mindestens 10 Zeichen)
npm run admin:user -- add olga --lang=ru    # Oberfläche auf Russisch
npm run admin:user -- passwd anna           # Passwort ändern
npm run admin:user -- delete anna           # Benutzer löschen
npm run admin:user -- list                  # alle Benutzer anzeigen
```

Die Sprache kann jeder Benutzer selbst umstellen: oben rechts auf den Namen zeigen → „Русский“, oder unter „Profil“.

### So funktioniert das Speichern

1. Du klickst auf „Aktualisieren“. Die Eingaben werden geprüft.
2. Die Änderung wird gespeichert und als Revision abgelegt (Git).
3. Die Website wird neu erstellt. Oben siehst du „Website wird erstellt …“.
4. Klappt das, wird sie veröffentlicht: „Seite aktualisiert“.

Geht beim Erstellen etwas schief, erscheint eine Fehlermeldung und **die Website wurde nicht verändert**: Die Besucher sehen weiter den alten Stand. Deine Änderung bleibt gespeichert. Unter „Revisionen“ kannst du jederzeit einen früheren Stand wiederherstellen.

### Wo liegen die Daten?

| Was | Wo |
|---|---|
| Texte, Beiträge, Bilder | im Website-Ordner (`src/content`, `src/assets/img`), mit Verlauf in Git |
| Benutzer, Sitzungen, Protokolle, Papierkorb | `~/.alno-admin` (außerhalb der Website) |

Bitte `~/.alno-admin` mitsichern: Dort liegen die Benutzer und der Papierkorb.

### Passwort vergessen

```bash
npm run admin:user -- passwd anna
```

Nach fünf falschen Passwörtern ist die Anmeldung für 15 Minuten gesperrt.

---

## Русский

### Запуск

В папке сайта:

```bash
npm install          # только в первый раз
npm run admin
```

Затем откройте в браузере: <http://127.0.0.1:4400/wp-admin/>

### Как добавить пользователя

```bash
npm run admin:user -- add anna              # спросит пароль (не меньше 10 символов)
npm run admin:user -- add olga --lang=ru    # интерфейс на русском
npm run admin:user -- passwd anna           # сменить пароль
npm run admin:user -- delete anna           # удалить пользователя
npm run admin:user -- list                  # список пользователей
```

Язык каждый пользователь переключает сам: наведите на имя справа вверху → «Deutsch»/«Русский», или в разделе «Профиль».

### Как работает сохранение

1. Вы нажимаете «Обновить». Введённое проверяется.
2. Изменение сохраняется и записывается как редакция (в Git).
3. Сайт пересобирается. Вверху видно: «Сайт собирается …».
4. Если всё хорошо, сайт публикуется: «Страница обновлена».

Если сборка не удалась, появится сообщение об ошибке, и **на сайте ничего не изменится**: посетители видят старую версию. Ваше изменение останется сохранённым. В разделе «Редакции» можно в любой момент вернуть прежнюю версию.

### Где лежат данные

| Что | Где |
|---|---|
| Тексты, записи, картинки | в папке сайта (`src/content`, `src/assets/img`), с историей в Git |
| Пользователи, сеансы, журналы, корзина | `~/.alno-admin` (вне сайта) |

Папку `~/.alno-admin` тоже сохраняйте в резервной копии: там пользователи и корзина.

### Забыли пароль

```bash
npm run admin:user -- passwd anna
```

После пяти неверных паролей вход блокируется на 15 минут.

---

## English: running it on a Linux server

### Requirements

- Node.js 22.12 or newer. The admin itself runs on Node 20+, but it runs `astro build`, and Astro 7 needs 22.12+.
- `git` and a clone of the site repository with `npm ci` done. `sharp` comes with Astro; there is nothing else to install.
- A git identity is not needed: commits carry the admin user as author and committer.
- Whatever `deploy.sh` needs on that machine (it pushes to GitHub Pages using `gh`), or your own `ADMIN_DEPLOY_CMD`.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ADMIN_SITE_DIR` | repo root | the site repository to edit |
| `ADMIN_DATA_DIR` | `~/.alno-admin` | users, sessions, logs, trash. Must be outside the repository; the admin refuses to start otherwise |
| `ADMIN_DEPLOY_CMD` | `./deploy.sh` | run from the site folder after a green build |
| `ADMIN_BUILD_CMD` | `npm run build` | the check before deploying |
| `ADMIN_GIT_PUSH` | off | `1` = `git push` after a green build, before the deploy |
| `ADMIN_HOST` / `ADMIN_PORT` | `127.0.0.1` / `4400` | keep it on loopback behind nginx |
| `ADMIN_SITE_URL` | `SITE_URL`, else the preview site | public address, for «Seite ansehen» |
| `ADMIN_ALLOWED_HOSTS` | none | comma list of extra `Host` values, e.g. `admin.example.de`. **Needed behind nginx** (DNS rebinding protection) |
| `ADMIN_TRUST_PROXY` | off | `1` = trust `X-Forwarded-Proto`, `X-Real-IP`. **Needed behind nginx**, otherwise cookies are not `Secure` and all visitors share one login rate limit |
| `ADMIN_COOKIE_SECURE` | off | force `Secure` cookies |
| `ADMIN_UPLOAD_MAX_MB` | `10` | upload size limit |
| `ADMIN_BUILD_TIMEOUT_S` | `900` | limit per build and per deploy |
| `ADMIN_SESSION_HOURS` | `8` | idle session lifetime |

`ADMIN_BUILD_CMD` and `ADMIN_DEPLOY_CMD` go through `/bin/sh`. They come from the service environment only, never from a request.

### systemd

`/etc/systemd/system/alno-admin.service`:

```ini
[Unit]
Description=ALNO Admin
After=network.target

[Service]
User=alno
WorkingDirectory=/srv/alno/site
ExecStart=/usr/bin/node admin/server.js
Environment=NODE_ENV=production
Environment=ADMIN_SITE_DIR=/srv/alno/site
Environment=ADMIN_DATA_DIR=/srv/alno/admin-data
Environment=ADMIN_TRUST_PROXY=1
Environment=ADMIN_ALLOWED_HOSTS=admin.example.de
Environment=ADMIN_SITE_URL=https://www.example.de
Environment=SITE_URL=https://www.example.de
Restart=on-failure
RestartSec=3

# Hardening. The service only needs to write to the repository and its data folder.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/srv/alno/site /srv/alno/admin-data
PrivateDevices=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now alno-admin
sudo -u alno env ADMIN_DATA_DIR=/srv/alno/admin-data npm --prefix /srv/alno/site run admin:user -- add anna
journalctl -u alno-admin -f
```

If `deploy.sh` needs credentials from the home folder (`gh`), adjust `ProtectHome` or use a deploy command that does not.

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name admin.example.de;

    ssl_certificate     /etc/letsencrypt/live/admin.example.de/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.example.de/privkey.pem;

    # A little above ADMIN_UPLOAD_MAX_MB.
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:4400;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}

server {
    listen 80;
    server_name admin.example.de;
    return 301 https://$host$request_uri;
}
```

`proxy_set_header Host $host` must match `ADMIN_ALLOWED_HOSTS`. Requests with any other `Host` get a 421. It is worth limiting the admin further, by IP allow-list or VPN.

### Good to know

- **Backups:** the repository has the content and its history; `ADMIN_DATA_DIR` has users and the trash. Back up both.
- **One instance only.** The build queue and the login lockout live in the process.
- **Logs:** `ADMIN_DATA_DIR/logs/admin.log`, one JSON object per line (logins, saves, builds, CSRF rejections). Rotate it with logrotate.
- **A red build keeps its commit.** The edit stays in git, the deploy does not run, and the next green build publishes everything. With `ADMIN_GIT_PUSH=1` nothing is pushed until then.
- **Two builds per publish.** The default deploy command, `deploy.sh`, builds again by itself; the first build is the safety check.

### Development

```bash
npm run test:admin    # node:test; uses a fake build and a fake deploy, never deploy.sh
npm run admin:demo    # the admin on a throw-away copy of the fixtures, prints a random password
```

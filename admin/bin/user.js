#!/usr/bin/env node
// User management: npm run admin:user -- add <name> | passwd <name> | delete <name> | list
// Passwords are read from the terminal without echo (or from stdin when it is not a terminal).
import { loadConfig } from '../lib/config.js';
import { createAuth, USERNAME_RE } from '../lib/auth.js';

const [cmd, name, ...rest] = process.argv.slice(2);
const langArg = rest.find((a) => a.startsWith('--lang='))?.slice(7);
const cfg = loadConfig();
const auth = createAuth({ dataDir: cfg.dataDir });

function usage() {
  console.log(`Benutzung / Использование:
  npm run admin:user -- add <name> [--lang=ru]   Benutzer anlegen / создать пользователя
  npm run admin:user -- passwd <name>            Passwort ändern / сменить пароль
  npm run admin:user -- delete <name>            Benutzer löschen / удалить пользователя
  npm run admin:user -- list                     Benutzer anzeigen / список
Daten / данные: ${cfg.dataDir}`);
}

let stdinLines = null;
async function readStdinLines() {
  if (stdinLines) return stdinLines;
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  stdinLines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
  return stdinLines;
}

function askHidden(prompt) {
  if (!process.stdin.isTTY) return readStdinLines().then((l) => l.shift() ?? '');
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let pw = '';
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); return resolve(pw); }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') { pw = pw.slice(0, -1); continue; }
        pw += c;
      }
    };
    stdin.on('data', onData);
  });
}

async function askNewPassword() {
  const p1 = await askHidden('Passwort / пароль: ');
  const p2 = await askHidden('Wiederholen / повторить: ');
  if (p1 !== p2) throw new Error('Die Passwörter stimmen nicht überein / пароли не совпадают');
  return p1;
}

try {
  switch (cmd) {
    case 'add':
      if (!name || !USERNAME_RE.test(name)) throw new Error('Name: a–z, 0–9, . _ - (2–32 Zeichen, Anfang mit Buchstabe)');
      if ((await auth.getUser(name))) throw new Error(`Benutzer „${name}“ existiert bereits`);
      await auth.addUser(name, await askNewPassword(), { lang: langArg === 'ru' ? 'ru' : 'de' });
      console.log(`Benutzer „${name}“ angelegt. / Пользователь «${name}» создан.`);
      break;
    case 'passwd':
      if (!name) { usage(); process.exit(1); }
      await auth.setPassword(name, await askNewPassword());
      console.log('Passwort geändert, alle Sitzungen beendet. / Пароль изменён, все сеансы завершены.');
      break;
    case 'delete':
      if (!name) { usage(); process.exit(1); }
      await auth.deleteUser(name);
      console.log(`Benutzer „${name}“ gelöscht. / Пользователь удалён.`);
      break;
    case 'list':
      for (const u of await auth.listUsers()) console.log(`${u.name}\t${u.lang}\t${u.created || ''}`);
      break;
    default:
      usage();
      process.exit(cmd ? 1 : 0);
  }
  process.exit(0);
} catch (e) {
  console.error(`Fehler / ошибка: ${e.message}`);
  process.exit(1);
}

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeSite, startApp, Client, PASSWORD, FAKE_DEPLOY, read, deploys, setField } from './helpers.mjs';

let site; let srv; let c;
const INDEX = 'src/content/pages/index.json';
const editUrl = '/wp-admin/post.php?post_type=page&post=index';

before(async () => {
  site = makeSite();
  srv = await startApp(site);
  await srv.app.auth.addUser('tester', PASSWORD);
  c = new Client(srv.base);
  await c.login();
});
after(async () => { await srv.close(); fs.rmSync(site.root, { recursive: true, force: true }); });
beforeEach(async () => { await srv.app.publisher.idle(); });

const save = (fields) => c.post('/wp-admin/post.php', fields);
const heroH1 = () => JSON.parse(read(site, INDEX)).groups[1].fields[1].value;
const jobOf = (res) => Number(/job=(\d+)/.exec(res.headers.get('location'))?.[1]);
const status = async (job) => JSON.parse((await c.get(`/wp-admin/admin-ajax.php?action=status&job=${job}`)).text_);

test('never configured with the real deploy script', () => {
  assert.ok(!srv.cfg.deployCmd.includes('deploy.sh'));
  assert.ok(srv.cfg.deployCmd.includes('fake-deploy'));
});

test('save → file → commit with admin author → build → deploy → notice', async () => {
  const before_ = deploys(site);
  const { fields } = await c.editForm(editUrl);
  setField(fields, 'f[hero][h1]', 'Neue Überschrift');
  const r = await save(fields);
  assert.equal(r.status, 303);
  assert.equal(heroH1(), 'Neue Überschrift');
  assert.match(site.git('log', '-1', '--format=%an <%ae>|%s'), /^tester <tester@alno-admin\.local>\|Admin: Startseite aktualisiert/);
  assert.equal(site.git('status', '--porcelain').trim(), '');
  await srv.app.publisher.idle();
  assert.equal(deploys(site), before_ + 1);
  const page = await c.get(r.headers.get('location'));
  assert.match(page.text_, /Seite aktualisiert\. Die Website ist in etwa einer Minute auf dem neuen Stand\./);
  const s = await srv.app.publisher.snapshot();
  assert.equal(s.state, 'idle');
  assert.equal(s.lastBuild.ok, true);
  assert.equal(s.lastDeploy.ok, true);
});

test('saving the form unchanged does nothing', async () => {
  const head = site.git('rev-parse', 'HEAD');
  const before_ = deploys(site);
  const { fields } = await c.editForm(editUrl);
  const r = await save(fields);
  assert.match(r.headers.get('location'), /message=nochange/);
  assert.equal(site.git('rev-parse', 'HEAD'), head);
  await srv.app.publisher.idle();
  assert.equal(deploys(site), before_);
});

test('invalid input: nothing written, nothing committed, nothing built', async () => {
  const head = site.git('rev-parse', 'HEAD');
  const text = read(site, INDEX);
  const before_ = deploys(site);
  const { fields } = await c.editForm(editUrl);
  setField(fields, 'f[seo][title]', 'x'.repeat(71));
  const r = await save(fields);
  assert.equal(r.status, 422);
  assert.match(r.text_, /Nicht gespeichert/);
  assert.match(r.text_, /höchstens 70 Zeichen/);
  assert.match(r.text_, new RegExp('x'.repeat(71)), 'the form keeps what was typed');
  assert.equal(read(site, INDEX), text);
  assert.equal(site.git('rev-parse', 'HEAD'), head);
  assert.equal(deploys(site), before_);
});

test('a failed build does not deploy and says so', async () => {
  const before_ = deploys(site);
  const { fields } = await c.editForm(editUrl);
  setField(fields, 'f[hero][pill]', 'BUILD_FAIL');
  const r = await save(fields);
  const job = jobOf(r);
  await srv.app.publisher.idle();
  assert.equal(deploys(site), before_, 'deploy must not run');
  const st = await status(job);
  assert.equal(st.job.state, 'failed');
  assert.match(st.job.notice.message, /die Website wurde nicht verändert/);
  assert.match(st.job.notice.log, /fake-build/);
  const page = await c.get(r.headers.get('location'));
  assert.match(page.text_, /die Website wurde nicht verändert/);
  assert.match(page.text_, /fake-build/);
  const dash = await c.get('/wp-admin/');
  assert.match(dash.text_, /fehlgeschlagen/);
  // The change is kept and the next good save publishes.
  const again = await c.editForm(editUrl);
  setField(again.fields, 'f[hero][pill]', 'Wieder gut');
  await save(again.fields);
  await srv.app.publisher.idle();
  assert.equal(deploys(site), before_ + 1);
  assert.equal((await srv.app.publisher.snapshot()).lastError, null);
});

test('a failed deploy is reported', async (t) => {
  process.env.FAKE_DEPLOY_FAIL = '1';
  t.after(() => { delete process.env.FAKE_DEPLOY_FAIL; });
  const { fields } = await c.editForm(editUrl);
  setField(fields, 'f[hero][pill]', 'Deploy kaputt');
  const job = jobOf(await save(fields));
  await srv.app.publisher.idle();
  delete process.env.FAKE_DEPLOY_FAIL;
  const st = await status(job);
  assert.equal(st.job.state, 'failed');
  assert.match(st.job.notice.message, /Veröffentlichung ist fehlgeschlagen/);
  const { fields: f2 } = await c.editForm(editUrl);
  setField(f2, 'f[hero][pill]', 'Deploy gut');
  await save(f2);
  await srv.app.publisher.idle();
});

test('one build at a time: saves during a build share one follow-up run', async (t) => {
  process.env.FAKE_BUILD_MS = '300';
  t.after(() => { delete process.env.FAKE_BUILD_MS; });
  fs.rmSync(site.buildLog, { force: true });
  const before_ = deploys(site);
  const jobs = [];
  for (const v of ['Eins', 'Zwei', 'Drei', 'Vier']) {
    const { fields } = await c.editForm(editUrl);
    setField(fields, 'f[hero][pill]', v);
    jobs.push(jobOf(await save(fields)));
  }
  await srv.app.publisher.idle();
  delete process.env.FAKE_BUILD_MS;
  const events = fs.readFileSync(site.buildLog, 'utf8').trim().split('\n').map((l) => l.split(' '));
  assert.ok(events.filter((e) => e[0] === 'start').length <= 3, 'at most: the running build plus one or two follow-ups');
  for (let i = 1; i < events.length; i++) assert.notEqual(events[i][0], events[i - 1][0], 'start and end alternate: no overlap');
  assert.ok(deploys(site) > before_);
  for (const j of jobs) assert.equal((await srv.app.publisher.job(j)).state, 'done');
  assert.equal(JSON.parse(read(site, INDEX)).groups[1].fields[0].value, 'Vier');
});

test('concurrent saves of different files all land in git', async () => {
  const a = await c.editForm('/wp-admin/post.php?post_type=page&post=ueber-uns');
  const b = await c.editForm('/wp-admin/post.php?post_type=page&post=_global');
  setField(a.fields, 'f[seo][title]', 'Parallel A');
  setField(b.fields, 'f[contact][phone]', '0231 111111');
  const [ra, rb] = await Promise.all([save(a.fields), save(b.fields)]);
  assert.equal(ra.status, 303);
  assert.equal(rb.status, 303);
  assert.equal(site.git('status', '--porcelain').trim(), '');
  assert.match(site.git('log', '-2', '--format=%s'), /Über uns/);
  assert.match(site.git('log', '-2', '--format=%s'), /Einstellungen/);
});

test('someone else changed the file: nothing is overwritten silently', async () => {
  const { fields } = await c.editForm(editUrl);
  const other = await c.editForm(editUrl);
  setField(other.fields, 'f[hero][pill]', 'Von Kollegin');
  await save(other.fields);
  setField(fields, 'f[hero][h1]', 'Veraltet');
  const r = await save(fields);
  assert.equal(r.status, 409);
  assert.match(r.text_, /inzwischen von jemand anderem geändert/);
  assert.match(r.text_, /Veraltet/, 'typed text is still in the form');
  assert.equal(JSON.parse(read(site, INDEX)).groups[1].fields[0].value, 'Von Kollegin');
  assert.notEqual(heroH1(), 'Veraltet');
});

test('a form with a changed structure is refused', async () => {
  const { fields } = await c.editForm(editUrl);
  fields.push(['f[hero][neu]', 'x']);
  const r = await save(fields);
  assert.equal(r.status, 422);
  assert.match(r.text_, /unbekanntes Feld/);
});

test('list items: reorder, add, remove through the form', async () => {
  const { fields } = await c.editForm(editUrl);
  const items = fields.filter(([k]) => /^f\[hero\]\[trust\]\[[^_]/.test(k));
  const rest = fields.filter(([k]) => !/^f\[hero\]\[trust\]\[[^_]/.test(k));
  const r = await save([...rest, items[1], items[0], ['f[hero][trust][neu1][text]', 'Dritter']]);
  assert.equal(r.status, 303);
  const v = JSON.parse(read(site, INDEX)).groups[1].fields[5].value;
  assert.deepEqual(v.map((x) => x.text), ['Telefon {{hours}}', 'Alle Kassen', 'Dritter']);
});

test('image and alt change through the form', async () => {
  const { fields } = await c.editForm(editUrl);
  setField(fields, 'f[hero][image][value]', 'team.jpg');
  setField(fields, 'f[hero][image][alt]', 'Neuer Alternativtext');
  assert.equal((await save(fields)).status, 303);
  const f = JSON.parse(read(site, INDEX)).groups[1].fields[4];
  assert.equal(f.value, 'team.jpg');
  assert.equal(f.alt, 'Neuer Alternativtext');
});

test('image and alt per list item through the form', async () => {
  const { fields, res } = await c.editForm(editUrl);
  assert.match(res.text_, /Team auf einem Bild/);
  const name = fields.find(([k]) => /^f\[cards\]\[items\]\[[^_].*\]\[photo\]\[value\]$/.test(k))[0];
  setField(fields, name, 'hero/start.jpg');
  setField(fields, name.replace('[value]', '[alt]'), 'Anderes Bild');
  assert.equal((await save(fields)).status, 303);
  assert.deepEqual(JSON.parse(read(site, INDEX)).groups[2].fields[0].value[0].photo, { value: 'hero/start.jpg', alt: 'Anderes Bild' });
  const media = await c.get('/wp-admin/upload.php?item=hero%2Fstart.jpg');
  assert.match(media.text_, /Karten › Karten 1/);
  assert.match(media.text_, /Anderes Bild/);
});

test('removing an image saves value "" and alt "", even if the alt was still in the form', async () => {
  const { fields } = await c.editForm(editUrl);
  setField(fields, 'f[hero][image][value]', '');
  assert.ok(fields.find(([k]) => k === 'f[hero][image][alt]')[1], 'the old alt is still sent');
  assert.equal((await save(fields)).status, 303);
  const f = JSON.parse(read(site, INDEX)).groups[1].fields[4];
  assert.equal(f.value, '');
  assert.equal(f.alt, '');
  const back = await c.editForm(editUrl);
  setField(back.fields, 'f[hero][image][value]', 'team.jpg');
  setField(back.fields, 'f[hero][image][alt]', 'Wieder da');
  assert.equal((await save(back.fields)).status, 303);
});

test('an image without alt is refused with a clear message, naming the list item', async () => {
  const text = read(site, INDEX);
  const { fields } = await c.editForm(editUrl);
  const name = fields.find(([k]) => /^f\[cards\]\[items\]\[[^_].*\]\[photo\]\[alt\]$/.test(k))[0];
  setField(fields, name, '  ');
  const r = await save(fields);
  assert.equal(r.status, 422);
  assert.match(r.text_, /Karte 1 › Bild: Alternativtext fehlt: Ist ein Bild gesetzt, muss der Alternativtext ausgefüllt sein\./);
  assert.equal(read(site, INDEX), text);
});

test('saving is decided by the server: the browser must not block the form silently', async () => {
  for (const p of [editUrl, '/wp-admin/post.php?post_type=post&post=erster-beitrag', '/wp-admin/post-new.php?post_type=post', '/wp-admin/post.php?post_type=team&post=erika-beispiel']) {
    const r = await c.get(p);
    assert.match(r.text_, /<form[^>]*id="post"[^>]*\bnovalidate\b/, p);
    assert.doesNotMatch(r.text_, /type="url"/, p);
  }
});

test('blog: edit keeps the Markdown body and the unknown keys', async () => {
  const url = '/wp-admin/post.php?post_type=post&post=erster-beitrag';
  const original = read(site, 'src/content/blog/erster-beitrag.md');
  const { fields } = await c.editForm(url);
  assert.equal((await save(fields)).headers.get('location').includes('nochange'), true, 'an unchanged form rewrites nothing');
  assert.equal(read(site, 'src/content/blog/erster-beitrag.md'), original);
  setField(fields, 'title', 'Neuer Titel: mit Doppelpunkt');
  assert.equal((await save(fields)).status, 303);
  const text = read(site, 'src/content/blog/erster-beitrag.md');
  assert.match(text, /^title: "Neuer Titel: mit Doppelpunkt"$/m);
  assert.match(text, /^tags: \[Test, Beispiel\]$/m);
  assert.match(text, /> \*\*Tipp:\*\* ein Zitat\./);
});

test('blog: create, then trash, then restore, then delete for good', async () => {
  const nonce = await c.nonce();
  const created = await save({ _wpnonce: nonce, action: 'editpost', post_type: 'post', post: '', title: 'Größe & Mut', description: 'D', date: '2026-10-01', slug: '', body: '## Hallo\n\nText\n', author: '', tags: 'A, B' });
  assert.equal(created.status, 303);
  const file = 'src/content/blog/groesse-mut.md';
  assert.match(read(site, file), /^tags: \[A, B\]$/m);
  assert.match(site.git('log', '-1', '--format=%an'), /tester/);
  const dup = await save({ _wpnonce: nonce, action: 'editpost', post_type: 'post', post: '', title: 'Größe & Mut', description: 'D', date: '2026-10-01', slug: '', body: '' });
  assert.equal(dup.status, 422);
  assert.match(dup.text_, /gibt es bereits/);

  const trashed = await save({ _wpnonce: nonce, action: 'trash', post_type: 'post', post: 'groesse-mut' });
  assert.equal(trashed.status, 303);
  assert.equal(fs.existsSync(path.join(site.siteDir, file)), false);
  assert.equal(site.git('status', '--porcelain').trim(), '');
  const list = await c.get('/wp-admin/edit.php?post_type=post&post_status=trash');
  assert.match(list.text_, /Größe &amp; Mut/);
  const id = /name="trash_id" value="([^"]+)"/.exec(list.text_)[1];
  assert.ok(fs.readdirSync(path.join(site.dataDir, 'trash', 'blog')).length, 'kept outside src');
  assert.equal(fs.existsSync(path.join(site.siteDir, 'src', 'trash')), false);

  const restored = await save({ _wpnonce: nonce, action: 'untrash', post_type: 'post', trash_id: id });
  assert.equal(restored.status, 303);
  assert.ok(fs.existsSync(path.join(site.siteDir, file)));

  await save({ _wpnonce: nonce, action: 'trash', post_type: 'post', post: 'groesse-mut' });
  const l2 = await c.get('/wp-admin/edit.php?post_type=post&post_status=trash');
  const id2 = /name="trash_id" value="([^"]+)"/.exec(l2.text_)[1];
  assert.equal((await save({ _wpnonce: nonce, action: 'delete', post_type: 'post', trash_id: id2 })).status, 303);
  assert.deepEqual(fs.readdirSync(path.join(site.dataDir, 'trash', 'blog')), []);
});

test('Leistungen cannot be created or deleted; team members can', async () => {
  const nonce = await c.nonce();
  assert.equal((await c.get('/wp-admin/post-new.php?post_type=leistung')).status, 404);
  assert.equal((await save({ _wpnonce: nonce, action: 'editpost', post_type: 'leistung', post: '', title: 'x' })).status, 403);
  assert.equal((await save({ _wpnonce: nonce, action: 'trash', post_type: 'leistung', post: 'grundpflege' })).status, 403);
  assert.ok(fs.existsSync(path.join(site.siteDir, 'src/content/leistungen/grundpflege.md')));
  const r = await save({ _wpnonce: nonce, action: 'editpost', post_type: 'team', post: '', name: 'Neue Person', role: 'Pflege', slug: '' });
  assert.equal(r.status, 303);
  assert.ok(fs.existsSync(path.join(site.siteDir, 'src/content/team/neue-person.md')));
});

test('Leistungen: highlights list and order are saved', async () => {
  const url = '/wp-admin/post.php?post_type=leistung&post=grundpflege';
  const { fields } = await c.editForm(url);
  fields.push(['highlights[neu]', 'Baden']);
  setField(fields, 'order', '7');
  assert.equal((await save(fields)).status, 303);
  const text = read(site, 'src/content/leistungen/grundpflege.md');
  assert.match(text, /^order: 7$/m);
  assert.match(text, /^ {2}- Baden$/m);
  assert.match(text, /## Was ist Grundpflege\?/);
});

test('a body with a table is edited as Markdown only', async () => {
  const r = await c.get('/wp-admin/post.php?post_type=leistung&post=beratung');
  assert.match(r.text_, /data-visual="off"/);
  assert.match(r.text_, /Tabelle/);
});

test('revisions: list, compare, restore makes a new commit', async () => {
  const before_ = heroH1();
  const { fields } = await c.editForm(editUrl);
  setField(fields, 'f[hero][h1]', 'Revision B');
  await save(fields);
  const log = site.git('log', '--format=%H', '--', INDEX).trim().split('\n');
  const prev = log[1];
  const list = await c.get(`/wp-admin/revision.php?file=${encodeURIComponent(INDEX)}`);
  assert.equal(list.status, 200);
  assert.match(list.text_, /tester/);
  const cmp = await c.get(`/wp-admin/revision.php?file=${encodeURIComponent(INDEX)}&rev=${prev}`);
  assert.match(cmp.text_, /Revision B/);
  const count = log.length;
  const r = await c.post('/wp-admin/revision.php', { _wpnonce: await c.nonce(), action: 'restore', file: INDEX, rev: prev });
  assert.equal(r.status, 303);
  assert.equal(heroH1(), before_);
  assert.equal(site.git('log', '--format=%H', '--', INDEX).trim().split('\n').length, count + 1, 'history only grows');
  assert.match(site.git('log', '-1', '--format=%an|%s'), /^tester\|Admin: Revision [0-9a-f]{7} wiederhergestellt/);
  await srv.app.publisher.idle();
  assert.equal((await srv.app.publisher.snapshot()).lastBuild.ok, true);
});

test('revisions: a Markdown file can be restored', async () => {
  const f = 'src/content/team/erika-beispiel.md';
  const old = read(site, f);
  const { fields } = await c.editForm('/wp-admin/post.php?post_type=team&post=erika-beispiel');
  setField(fields, 'role', 'Neue Rolle');
  await save(fields);
  const prev = site.git('log', '--format=%H', '--', f).trim().split('\n')[1];
  await c.post('/wp-admin/revision.php', { _wpnonce: await c.nonce(), action: 'restore', file: f, rev: prev });
  assert.equal(read(site, f), old);
});

test('every screen renders', async () => {
  for (const p of ['/wp-admin/', '/wp-admin/edit.php?post_type=page', '/wp-admin/edit.php?post_type=post', '/wp-admin/edit.php?post_type=leistung', '/wp-admin/edit.php?post_type=team',
    '/wp-admin/post.php?post_type=page&post=index', '/wp-admin/post.php?post_type=page&post=_global', '/wp-admin/post.php?post_type=post&post=erster-beitrag',
    '/wp-admin/post-new.php?post_type=post', '/wp-admin/post-new.php?post_type=team', '/wp-admin/upload.php', '/wp-admin/media-new.php', '/wp-admin/revision.php', '/wp-admin/profile.php']) {
    const r = await c.get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.text_, /id="wpadminbar"/, p);
    assert.doesNotMatch(r.text_, /\[object Object\]|undefined/, p);
  }
});

test('user content is escaped on every screen', async () => {
  const nonce = await c.nonce();
  const evil = '"><img src=x onerror=alert(1)>';
  await c.post('/wp-admin/upload.php', { _wpnonce: nonce, action: 'save-meta', item: 'team.jpg', alt: evil });
  const r = await c.get('/wp-admin/upload.php?item=team.jpg');
  assert.doesNotMatch(r.text_, /<img src=x/);
  const s = await c.get(`/wp-admin/edit.php?post_type=post&s=${encodeURIComponent(evil)}`);
  assert.doesNotMatch(s.text_, /<img src=x/);
});

test('language switch is per user', async () => {
  await srv.app.auth.addUser('olga', PASSWORD, { lang: 'de' });
  const o = new Client(srv.base);
  await o.login('olga');
  assert.match((await o.get('/wp-admin/')).text_, /Willkommen/);
  await o.post('/wp-admin/profile.php', { _wpnonce: await o.nonce(), action: 'lang', lang: 'ru', back: '/wp-admin/' });
  const ru = await o.get('/wp-admin/');
  assert.match(ru.text_, /Добро пожаловать/);
  assert.match(ru.text_, /<html lang="ru">/);
  assert.match((await c.get('/wp-admin/')).text_, /Willkommen/, 'other users keep their language');
});

test('Russian users see translated validation messages', async () => {
  const o = new Client(srv.base);
  await o.login('olga');
  const { fields } = await o.editForm(editUrl);
  setField(fields, 'f[seo][title]', '');
  const r = await o.post('/wp-admin/post.php', fields);
  assert.match(r.text_, /обязательное поле/);
});

test('password change from the profile', async () => {
  await srv.app.auth.addUser('pia', PASSWORD);
  const p = new Client(srv.base);
  await p.login('pia');
  const nonce = await p.nonce();
  const wrong = await p.post('/wp-admin/profile.php', { _wpnonce: nonce, action: 'profile', lang: 'de', pass0: 'falsch', pass1: 'neues-passwort-1', pass2: 'neues-passwort-1' });
  assert.equal(wrong.status, 422);
  const ok = await p.post('/wp-admin/profile.php', { _wpnonce: nonce, action: 'profile', lang: 'de', pass0: PASSWORD, pass1: 'neues-passwort-1', pass2: 'neues-passwort-1' });
  assert.equal(ok.status, 303);
  assert.equal((await p.get('/wp-admin/')).status, 200, 'stays logged in');
  assert.equal((await new Client(srv.base).login('pia', 'neues-passwort-1')).status, 303);
});

test('git push happens only after a green build, when switched on', async (t) => {
  const bare = path.join(site.root, 'remote.git');
  site.git('init', '-q', '--bare', bare);
  site.git('remote', 'add', 'origin', bare);
  site.git('push', '-q', '-u', 'origin', 'main');
  const srv2 = await startApp(site, { ADMIN_GIT_PUSH: '1' });
  t.after(() => srv2.close());
  const c2 = new Client(srv2.base);
  await c2.login();
  const { fields } = await c2.editForm(editUrl);
  setField(fields, 'f[hero][pill]', 'Gepusht');
  await c2.post('/wp-admin/post.php', fields);
  await srv2.app.publisher.idle();
  assert.equal(site.git('rev-parse', 'origin/main').trim(), site.git('rev-parse', 'HEAD').trim());
  const head = site.git('rev-parse', 'HEAD').trim();
  const again = await c2.editForm(editUrl);
  setField(again.fields, 'f[hero][pill]', 'BUILD_FAIL');
  await c2.post('/wp-admin/post.php', again.fields);
  await srv2.app.publisher.idle();
  assert.equal(site.git('rev-parse', 'origin/main').trim(), head, 'a red build is not pushed');
  const fix = await c.editForm(editUrl);
  setField(fix.fields, 'f[hero][pill]', 'Repariert');
  await save(fix.fields);
  await srv.app.publisher.idle();
});

test('an interrupted run is reported after a restart', async (t) => {
  const f = path.join(site.dataDir, 'status.json');
  const st = JSON.parse(fs.readFileSync(f, 'utf8'));
  fs.writeFileSync(f, JSON.stringify({ ...st, state: 'building', runningFrom: st.seq, runningUpTo: st.seq }));
  const srv2 = await startApp(site);
  t.after(() => srv2.close());
  const s = await srv2.app.publisher.snapshot();
  assert.equal(s.state, 'idle');
  assert.match(s.lastError.log, /Unterbrochen/);
  fs.writeFileSync(f, JSON.stringify(st));
});

test('if the commit fails, the file goes back and nothing is built', async () => {
  const text = read(site, INDEX);
  const before_ = deploys(site);
  const { fields } = await c.editForm(editUrl);
  setField(fields, 'f[hero][pill]', 'Commit scheitert');
  const lock = path.join(site.siteDir, '.git', 'index.lock');
  fs.writeFileSync(lock, '');
  const r = await save(fields);
  fs.rmSync(lock);
  assert.equal(r.status, 500);
  assert.equal(read(site, INDEX), text);
  await srv.app.publisher.idle();
  assert.equal(deploys(site), before_);
});

test('an unknown {{token}} is refused, known ones and token links pass', async () => {
  const { fields } = await c.editForm(editUrl);
  setField(fields, 'f[hero][pill]', 'Ruf {{telefon}} an');
  const r = await save(fields);
  assert.equal(r.status, 422);
  assert.match(r.text_, /unbekannter Platzhalter \{\{telefon\}\}/);
  setField(fields, 'f[hero][pill]', 'Ruf {{phone}} an');
  setField(fields, 'f[hero][lead]', '<p><a href="{{phone}}">Anruf</a></p>');
  assert.equal((await save(fields)).status, 303);
  assert.match(read(site, INDEX), /href=\\"\{\{phone\}\}\\"/);
});

test('values YAML would read as numbers, booleans or null stay strings', async () => {
  const url = '/wp-admin/post.php?post_type=team&post=max-muster';
  for (const v of ['1e3', '0x10', '.5', '-1.5', 'null', 'Yes', '.inf', '1_000', '12:30', 'a: b', '# x', '- y', '"z"']) {
    const { fields } = await c.editForm(url);
    setField(fields, 'role', v);
    const r = await save(fields);
    assert.ok([303].includes(r.status), v);
    const again = await c.editForm(url);
    assert.equal(again.fields.find(([k]) => k === 'role')[1], v);
    const line = /^role: (.*)$/m.exec(read(site, 'src/content/team/max-muster.md'))[1];
    if (/^(1e3|0x10|\.5|-1\.5|null|Yes|\.inf|1_000)$/.test(v)) assert.ok(line.startsWith('"'), `${v} must be quoted, got ${line}`);
  }
});

test('an image outside the library is kept, not dropped on save', async () => {
  const f = path.join(site.siteDir, 'src/content/team/max-muster.md');
  fs.writeFileSync(f, '---\nname: Max Muster\nrole: Verwaltung\nphoto: ../../other/foto.jpg\norder: 2\n---\n');
  site.git('-c', 'user.name=x', '-c', 'user.email=x@example.org', 'commit', '-qam', 'Testbild');
  const { fields } = await c.editForm('/wp-admin/post.php?post_type=team&post=max-muster');
  setField(fields, 'role', 'Geändert');
  assert.equal((await save(fields)).status, 303);
  assert.match(fs.readFileSync(f, 'utf8'), /^photo: \.\.\/\.\.\/other\/foto\.jpg$/m);
});

test('the fake deploy command is what ran', () => {
  assert.ok(FAKE_DEPLOY.includes('fake-deploy.mjs'));
  assert.ok(fs.readFileSync(site.deployLog, 'utf8').includes('deploy'));
});

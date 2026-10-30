import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sniffImage, processUpload, randomName, loadSharp, UploadError, MAX_SIDE, listImages } from '../lib/media.js';
import { makeSite, startApp, Client, PASSWORD } from './helpers.mjs';

let site; let srv; let c; let nonce; let sharp;
const LIMIT = 2 * 1024 * 1024;
before(async () => {
  site = makeSite();
  srv = await startApp(site, { ADMIN_UPLOAD_MAX_MB: '2' });
  await srv.app.auth.addUser('tester', PASSWORD);
  c = new Client(srv.base);
  await c.login();
  nonce = await c.nonce();
  sharp = await loadSharp();
});
after(async () => { await srv.app.publisher.idle(); await srv.close(); fs.rmSync(site.root, { recursive: true, force: true }); });

const img = (w, h, fmt = 'jpeg') => sharp({ create: { width: w, height: h, channels: 3, background: '#88aacc' } })[fmt]().toBuffer();
const opts = () => ({ maxBytes: LIMIT, siteDir: site.siteDir });

async function upload(buf, filename, extra = {}) {
  const fd = new FormData();
  fd.append('_wpnonce', nonce);
  fd.append('async-upload', new Blob([buf], { type: extra.type || 'image/jpeg' }), filename);
  const r = await fetch(`${srv.base}/wp-admin/async-upload.php`, { method: 'POST', body: fd, headers: c.headers({ Accept: 'application/json' }) });
  return { status: r.status, body: await r.json() };
}

test('type is detected from content', async () => {
  assert.equal(sniffImage(await img(10, 10, 'jpeg')), 'jpeg');
  assert.equal(sniffImage(await img(10, 10, 'png')), 'png');
  assert.equal(sniffImage(await img(10, 10, 'webp')), 'webp');
  assert.equal(sniffImage(Buffer.from('<?php echo 1; ?>xxxxxxxx')), null);
  assert.equal(sniffImage(Buffer.from('GIF89a..........')), null);
});

test('SVG, scripts and HTML are refused whatever they are called', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const xml = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await assert.rejects(processUpload(svg, opts()), /SVG/);
  await assert.rejects(processUpload(xml, opts()), /SVG/);
  await assert.rejects(processUpload(Buffer.from('<?php system($_GET[0]); ?>aaaaaaaa'), opts()), UploadError);
  await assert.rejects(processUpload(Buffer.from('<html><script>1</script></html>'), opts()), UploadError);
  for (const name of ['x.jpg', 'x.png', 'x.svg', 'x.php']) {
    const r = await upload(svg, name);
    assert.equal(r.status, 422, name);
    assert.equal(r.body.files.length, 0);
  }
});

test('a file with a JPEG header but no image is refused', async () => {
  const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('nur text '.repeat(10))]);
  await assert.rejects(processUpload(fake, opts()), /kein lesbares Bild/);
});

test('polyglot: code after the image does not survive re-encoding', async () => {
  const good = await img(40, 40);
  const poly = Buffer.concat([good, Buffer.from('<?php system("id"); ?><script>alert(1)</script>')]);
  const r = await processUpload(poly, opts());
  assert.ok(!r.buffer.includes('<?php'));
  assert.ok(!r.buffer.includes('<script>'));
});

test('longest side is limited, small images are not enlarged', async () => {
  const big = await processUpload(await img(3000, 1500), { ...opts(), maxBytes: 50e6 });
  assert.equal(big.width, MAX_SIDE);
  assert.equal(big.height, 1200);
  const tall = await processUpload(await img(1000, 4000), { ...opts(), maxBytes: 50e6 });
  assert.equal(tall.height, MAX_SIDE);
  const small = await processUpload(await img(100, 80), opts());
  assert.equal(small.width, 100);
});

test('metadata (EXIF, GPS) is removed', async () => {
  const withExif = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#000' } }).withExif({ IFD0: { Copyright: 'GEHEIM-EXIF' } }).jpeg().toBuffer();
  assert.ok(withExif.includes('GEHEIM-EXIF'));
  const r = await processUpload(withExif, opts());
  assert.ok(!r.buffer.includes('GEHEIM-EXIF'));
});

test('size limit', async () => {
  await assert.rejects(processUpload(Buffer.alloc(LIMIT + 1, 0xff), opts()), /zu groß/);
  await assert.rejects(processUpload(Buffer.alloc(0), opts()), /Leere Datei/);
  const r = await upload(Buffer.alloc(LIMIT + 200 * 1024, 0xff), 'gross.jpg');
  assert.equal(r.status, 413);
});

test('random names; the uploaded name is never used', async () => {
  const a = randomName('jpg'); const b = randomName('jpg');
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{16}\.jpg$/);
  for (const name of ['../../../../evil.jpg', 'sehr geheim.jpg', 'x.php.jpg', '<script>.jpg']) {
    const r = await upload(await img(20, 20), name);
    assert.equal(r.status, 200, name);
    const f = r.body.files[0];
    assert.match(f.path, /^uploads\/[0-9a-f]{16}\.jpg$/);
    assert.ok(fs.existsSync(path.join(site.siteDir, 'src/assets/img', f.path)));
  }
  assert.equal(fs.existsSync(path.join(site.root, 'evil.jpg')), false);
});

test('the extension follows the content, not the name', async () => {
  const r = await upload(await img(20, 20, 'png'), 'bild.jpg');
  assert.match(r.body.files[0].path, /\.png$/);
  const w = await upload(await img(20, 20, 'webp'), 'bild.png');
  assert.match(w.body.files[0].path, /\.webp$/);
});

test('an upload lands in the library and in git', async () => {
  const r = await upload(await img(20, 20), 'neu.jpg');
  const p = r.body.files[0].path;
  assert.ok((await listImages(path.join(site.siteDir, 'src/assets/img'))).some((i) => i.path === p));
  assert.match(site.git('log', '-1', '--format=%an|%s'), /^tester\|Admin: Bild hochgeladen/);
  assert.equal((await c.get(`/wp-admin/upload.php?item=${encodeURIComponent(p)}`)).status, 200);
});

test('several files: good ones are kept, bad ones reported', async () => {
  const fd = new FormData();
  fd.append('_wpnonce', nonce);
  fd.append('async-upload', new Blob([await img(20, 20)]), 'gut.jpg');
  fd.append('async-upload', new Blob([Buffer.from('<svg></svg>')]), 'boese.svg');
  const r = await fetch(`${srv.base}/wp-admin/async-upload.php`, { method: 'POST', body: fd, headers: c.headers({ Accept: 'application/json' }) });
  const j = await r.json();
  assert.equal(j.files.length, 1);
  assert.equal(j.errors.length, 1);
  assert.match(j.errors[0].msg, /SVG/);
});

test('images in use and images imported by site code cannot be deleted', async () => {
  const del = (item) => c.post('/wp-admin/upload.php', { _wpnonce: nonce, action: 'delete', item });
  assert.equal((await del('team.jpg')).status, 409);
  assert.equal((await del('logo-mark.png')).status, 409);
  assert.ok(fs.existsSync(path.join(site.siteDir, 'src/assets/img/logo-mark.png')));
  assert.equal((await del('unbenutzt.webp')).status, 303);
  assert.equal(fs.existsSync(path.join(site.siteDir, 'src/assets/img/unbenutzt.webp')), false);
});

test('«verwendet auf» lists pages and collection entries', async () => {
  const r = await c.get('/wp-admin/upload.php?item=team.jpg');
  assert.match(r.text_, /Startseite/);
  assert.match(r.text_, /Erika Beispiel/);
  assert.match(r.text_, /Erster Beitrag/);
});

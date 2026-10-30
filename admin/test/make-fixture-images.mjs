// Generates the small placeholder images of the fixture site. No client material is used.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSharp } from '../lib/media.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'site', 'src', 'assets', 'img');
const sharp = await loadSharp();
const make = (w, h, c) => sharp({ create: { width: w, height: h, channels: 3, background: c } });
await make(320, 200, '#9ec5e8').jpeg({ quality: 70 }).toFile(path.join(dir, 'hero', 'start.jpg'));
await make(240, 160, '#e8d29e').jpeg({ quality: 70 }).toFile(path.join(dir, 'team.jpg'));
await make(64, 64, '#2271b1').png().toFile(path.join(dir, 'logo-mark.png'));
await make(200, 200, '#c3e8c9').webp({ quality: 70 }).toFile(path.join(dir, 'unbenutzt.webp'));

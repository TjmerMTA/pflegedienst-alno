#!/usr/bin/env node
// ALNO Admin — start with `npm run admin`. Configuration: see admin/README.md.
import http from 'node:http';
import { loadConfig } from './lib/config.js';
import { createApp } from './lib/app.js';

const cfg = loadConfig();
const app = createApp(cfg);
const server = http.createServer(app.handler);
server.headersTimeout = 30_000;
server.requestTimeout = 120_000;

server.listen(cfg.port, cfg.host, () => {
  console.log(`ALNO Admin: http://${cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host}:${cfg.port}/wp-admin/`);
  console.log(`  Website-Ordner: ${cfg.siteDir}`);
  console.log(`  Daten:          ${cfg.dataDir}`);
  console.log(`  Build:          ${cfg.buildCmd}`);
  console.log(`  Deploy:         ${cfg.deployCmd}${cfg.gitPush ? '  (+ git push)' : ''}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    // A running build finishes in its own process group; the queue notes the interruption on next start.
    setTimeout(() => process.exit(0), 300).unref();
  });
}

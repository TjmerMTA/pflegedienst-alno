// Stand-in for ./deploy.sh: records that it ran. It publishes nothing.
import fs from 'node:fs';

const log = process.env.FAKE_DEPLOY_LOG;
if (log) fs.appendFileSync(log, `deploy ${Date.now()}\n`);
if (process.env.FAKE_DEPLOY_FAIL) { console.error('[fake-deploy] failed'); process.exit(1); }
console.log('[fake-deploy] ok');

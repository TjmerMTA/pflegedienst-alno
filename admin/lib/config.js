// Configuration from the environment. Everything the admin needs to know about where it runs.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

function bool(v, dflt = false) {
  if (v === undefined || v === '') return dflt;
  return /^(1|true|yes|on)$/i.test(String(v));
}

export function loadConfig(env = process.env) {
  const siteDir = path.resolve(env.ADMIN_SITE_DIR || repoRoot);
  const dataDir = path.resolve(env.ADMIN_DATA_DIR || path.join(os.homedir(), '.alno-admin'));
  return {
    siteDir,
    dataDir,
    host: env.ADMIN_HOST || '127.0.0.1',
    port: Number(env.ADMIN_PORT || 4400),
    buildCmd: env.ADMIN_BUILD_CMD || 'npm run build',
    deployCmd: env.ADMIN_DEPLOY_CMD || './deploy.sh',
    gitPush: bool(env.ADMIN_GIT_PUSH, false),
    // Public address of the website, used for «Seite ansehen».
    siteUrl: (env.ADMIN_SITE_URL || env.SITE_URL || 'https://dev.siteboosty.com').replace(/\/+$/, ''),
    // Set when the admin runs behind an https reverse proxy (nginx): trusts X-Forwarded-Proto/-For.
    trustProxy: bool(env.ADMIN_TRUST_PROXY, false),
    cookieSecure: bool(env.ADMIN_COOKIE_SECURE, false),
    uploadMaxBytes: Number(env.ADMIN_UPLOAD_MAX_MB || 10) * 1024 * 1024,
    buildTimeoutMs: Number(env.ADMIN_BUILD_TIMEOUT_S || 900) * 1000,
    sessionIdleMs: Number(env.ADMIN_SESSION_HOURS || 8) * 3600 * 1000,
  };
}

// Paths inside the edited site (contract: docs/admin-content-format.md).
export function sitePaths(siteDir) {
  return {
    pages: path.join(siteDir, 'src', 'content', 'pages'),
    blog: path.join(siteDir, 'src', 'content', 'blog'),
    leistungen: path.join(siteDir, 'src', 'content', 'leistungen'),
    team: path.join(siteDir, 'src', 'content', 'team'),
    img: path.join(siteDir, 'src', 'assets', 'img'),
    uploads: path.join(siteDir, 'src', 'assets', 'img', 'uploads'),
  };
}

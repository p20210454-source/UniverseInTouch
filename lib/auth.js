const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const SESSION_COOKIE = 'rh_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REVOKED = 5000;

const revokedTokens = new Map();
let sessionEpoch = 1;

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();

function sessionSecret() {
  return process.env.SESSION_SECRET || '';
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function assertSecureConfig() {
  const hash = process.env.ADMIN_PASSWORD_HASH;
  const pwd = process.env.ADMIN_PASSWORD;
  if (!hash || !String(hash).trim()) {
    if (!pwd || !String(pwd).trim()) {
      console.error('FATAL: Set ADMIN_PASSWORD_HASH or ADMIN_PASSWORD in .env (see .env.example).');
      process.exit(1);
    }
    if (pwd === 'changeme') {
      console.error('FATAL: Change the default ADMIN_PASSWORD before running.');
      process.exit(1);
    }
    console.warn(
      'WARNING: Using plaintext ADMIN_PASSWORD. Prefer ADMIN_PASSWORD_HASH (bcrypt). ' +
        'Generate: node -e "require(\'bcryptjs\').hash(\'your-password\', 10).then(h=>console.log(h))"'
    );
  }

  const secret = sessionSecret();
  if (process.env.NODE_ENV === 'production') {
    if (!secret || secret.length < 32) {
      console.error('FATAL: Set SESSION_SECRET to a random string of at least 32 characters.');
      process.exit(1);
    }
  } else if (!secret) {
    console.warn(
      'WARNING: SESSION_SECRET not set; using a dev-only secret (sessions invalidate on restart).'
    );
  }
}

function effectiveSecret() {
  const env = sessionSecret();
  if (env) return env;
  return 'dev-only-insecure-secret-do-not-use-in-production';
}

function pruneRevoked() {
  const now = Date.now();
  for (const [jti, exp] of revokedTokens) {
    if (now > exp) revokedTokens.delete(jti);
  }
  while (revokedTokens.size > MAX_REVOKED) {
    const first = revokedTokens.keys().next().value;
    revokedTokens.delete(first);
  }
}

function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', effectiveSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySignedToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', effectiveSecret()).update(body).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.exp || Date.now() > payload.exp) return null;
    if (!payload.jti || !payload.csrf) return null;
    if (payload.epoch !== sessionEpoch) return null;
    pruneRevoked();
    if (revokedTokens.has(payload.jti)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function validateAdminCredentials(username, password) {
  const user = String(username || '').trim().toLowerCase();
  if (!safeEqual(user, ADMIN_USERNAME)) return false;

  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (hash && String(hash).trim()) {
    try {
      return await bcrypt.compare(String(password || ''), String(hash).trim());
    } catch {
      return false;
    }
  }
  return safeEqual(String(password || ''), process.env.ADMIN_PASSWORD);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return acc;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      acc[key] = decodeURIComponent(val);
    } catch {
      acc[key] = val;
    }
    return acc;
  }, {});
}

function createSession() {
  const csrf = crypto.randomBytes(32).toString('hex');
  const jti = crypto.randomBytes(16).toString('hex');
  const exp = Date.now() + SESSION_TTL_MS;
  const signed = signPayload({ exp, csrf, jti, epoch: sessionEpoch });
  return { token: signed, csrf };
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  return verifySignedToken(cookies[SESSION_COOKIE]);
}

function sessionValid(token) {
  return verifySignedToken(token) !== null;
}

function destroySession(token) {
  const payload = verifySignedToken(token);
  if (payload && payload.jti) {
    revokedTokens.set(payload.jti, payload.exp);
    pruneRevoked();
  }
}

function destroyAllSessions() {
  sessionEpoch += 1;
  revokedTokens.clear();
}

function requireAuth(req, res, next) {
  if (!getSessionFromRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function requireCsrf(req, res, next) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const header = req.headers['x-csrf-token'];
  if (!header || !safeEqual(header, session.csrf)) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}

const requireAuthWithCsrf = [requireAuth, requireCsrf];

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
  );
}

setInterval(pruneRevoked, 15 * 60 * 1000).unref();

module.exports = {
  SESSION_COOKIE,
  ADMIN_USERNAME,
  assertSecureConfig,
  validateAdminCredentials,
  parseCookies,
  createSession,
  getSession: getSessionFromRequest,
  sessionValid,
  destroySession,
  destroyAllSessions,
  requireAuth,
  requireCsrf,
  requireAuthWithCsrf,
  setSessionCookie,
  clearSessionCookie,
};

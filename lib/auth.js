const crypto = require('crypto');

const SESSION_COOKIE = 'rh_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map();

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function validateAdminCredentials(username, password) {
  const user = String(username || '').trim().toLowerCase();
  return safeEqual(user, ADMIN_USERNAME) && safeEqual(String(password || ''), ADMIN_PASSWORD);
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
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function sessionValid(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  if (!sessionValid(cookies[SESSION_COOKIE])) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

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

module.exports = {
  SESSION_COOKIE,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  validateAdminCredentials,
  parseCookies,
  createSession,
  sessionValid,
  destroySession,
  requireAuth,
  setSessionCookie,
  clearSessionCookie,
};

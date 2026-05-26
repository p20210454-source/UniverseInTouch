const { clientKey } = require('./rateLimit');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map();

function pruneFailures(now) {
  for (const [key, entry] of failures) {
    if (now > entry.reset) failures.delete(key);
  }
}

function recordLoginFailure(req) {
  const now = Date.now();
  pruneFailures(now);
  const key = clientKey(req);
  let entry = failures.get(key);
  if (!entry || now > entry.reset) {
    entry = { count: 0, reset: now + WINDOW_MS };
    failures.set(key, entry);
  }
  entry.count += 1;
  return entry.count;
}

function clearLoginFailures(req) {
  failures.delete(clientKey(req));
}

function isLoginLocked(req) {
  const now = Date.now();
  pruneFailures(now);
  const entry = failures.get(clientKey(req));
  if (!entry) return false;
  return entry.count >= MAX_FAILURES;
}

function loginLockoutMiddleware(req, res, next) {
  if (isLoginLocked(req)) {
    return res.status(429).json({ error: 'Too many failed login attempts. Try again later.' });
  }
  next();
}

setInterval(() => pruneFailures(Date.now()), 5 * 60 * 1000).unref();

module.exports = {
  recordLoginFailure,
  clearLoginFailures,
  isLoginLocked,
  loginLockoutMiddleware,
};

const { clientKey } = require('./rateLimit');

const VIEW_DEDUP_MS = 24 * 60 * 60 * 1000;
const MAX_VIEW_KEYS = 50000;
const viewed = new Map();

function pruneViews(now) {
  for (const [key, exp] of viewed) {
    if (now > exp) viewed.delete(key);
  }
  if (viewed.size <= MAX_VIEW_KEYS) return;
  const overflow = viewed.size - MAX_VIEW_KEYS;
  let removed = 0;
  for (const key of viewed.keys()) {
    viewed.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function shouldRecordView(req, paperId) {
  const now = Date.now();
  pruneViews(now);
  const key = `${clientKey(req)}:${paperId}`;
  if (viewed.has(key)) return false;
  viewed.set(key, now + VIEW_DEDUP_MS);
  return true;
}

setInterval(() => pruneViews(Date.now()), 10 * 60 * 1000).unref();

module.exports = { shouldRecordView };

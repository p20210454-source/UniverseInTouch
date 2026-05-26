const buckets = new Map();
const MAX_BUCKETS = 10000;

function clientKey(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function pruneBuckets(now) {
  for (const [key, bucket] of buckets) {
    if (now > bucket.reset) buckets.delete(key);
  }
  if (buckets.size <= MAX_BUCKETS) return;
  const overflow = buckets.size - MAX_BUCKETS;
  let removed = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const now = Date.now();
    pruneBuckets(now);

    const key = `${req.path}:${clientKey(req)}`;
    let bucket = buckets.get(key);
    if (!bucket || now > bucket.reset) {
      bucket = { count: 0, reset: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  };
}

setInterval(() => pruneBuckets(Date.now()), 5 * 60 * 1000).unref();

module.exports = { rateLimit, clientKey };

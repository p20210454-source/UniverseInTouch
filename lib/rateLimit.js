const buckets = new Map();

function clientKey(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = `${req.path}:${clientKey(req)}`;
    const now = Date.now();
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

module.exports = { rateLimit, clientKey };

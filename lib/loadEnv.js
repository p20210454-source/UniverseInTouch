const fs = require('fs');
const path = require('path');

/**
 * Minimal .env loader (no extra dependency). Call before reading process.env in other modules.
 */
function loadEnv(filePath) {
  const envPath = filePath || path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return false;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf('#');
      if (hash > 0 && !/\s/.test(value.slice(0, hash))) {
        value = value.slice(0, hash).trim();
      }
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return true;
}

module.exports = { loadEnv };

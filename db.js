const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.sqlite');

const parseJsonArray = (str) => {
  try {
    return JSON.parse(str || '[]');
  } catch {
    return [];
  }
};

const rowToPaper = (row) => ({
  ...row,
  featured: !!row.featured,
  tags: parseJsonArray(row.tags),
  refs: parseJsonArray(row.refs),
});

function openDatabase() {
  return new sqlite3.Database(DB_PATH);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

async function migratePapersColumns(db) {
  const cols = await all(db, 'PRAGMA table_info(papers)');
  const names = new Set(cols.map((c) => c.name));
  const addColumn = async (name, definition) => {
    if (!names.has(name)) {
      await run(db, `ALTER TABLE papers ADD COLUMN ${name} ${definition}`);
      names.add(name);
    }
  };

  await addColumn('featured', 'INTEGER DEFAULT 0');
  await addColumn('status', "TEXT DEFAULT 'published'");
  await addColumn('refs', "TEXT DEFAULT '[]'");
  await addColumn('created_at', 'TEXT');
  await addColumn('updated_at', 'TEXT');

  await run(
    db,
    `UPDATE papers SET created_at = COALESCE(NULLIF(created_at, ''), date, datetime('now'))
     WHERE created_at IS NULL OR created_at = ''`
  );
  await run(
    db,
    `UPDATE papers SET updated_at = COALESCE(NULLIF(updated_at, ''), NULLIF(created_at, ''), date, datetime('now'))
     WHERE updated_at IS NULL OR updated_at = ''`
  );
}

async function initDatabase(db) {
  await run(
    db,
    `CREATE TABLE IF NOT EXISTS papers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      featured INTEGER DEFAULT 0,
      title TEXT NOT NULL,
      authors TEXT NOT NULL,
      date TEXT,
      field TEXT DEFAULT 'math',
      access TEXT DEFAULT 'open',
      journal TEXT,
      doi TEXT,
      abstract TEXT,
      body TEXT,
      tags TEXT DEFAULT '[]',
      citations INTEGER DEFAULT 0,
      views INTEGER DEFAULT 0,
      status TEXT DEFAULT 'published',
      refs TEXT DEFAULT '[]',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await migratePapersColumns(db);

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#c0392b'
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`
  );

  const catCount = await get(db, 'SELECT COUNT(*) AS n FROM categories');
  if (!catCount || catCount.n === 0) {
    await run(db, 'INSERT INTO categories (slug, name, color) VALUES (?, ?, ?)', [
      'math',
      'Mathematics',
      '#e67e22',
    ]);
  }

  const defaults = {
    blogTitle: 'UniverseInTouch',
    tagline: 'Open Access Academic Repository',
    papersPerPage: '10',
    featuredPaperId: '',
    theme: 'paper-ink',
  };

  for (const [key, value] of Object.entries(defaults)) {
    await run(
      db,
      'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
      [key, value]
    );
  }

  await run(
    db,
    `UPDATE settings SET value = 'UniverseInTouch' WHERE key = 'blogTitle' AND value IN ('ResearchHub', 'CosmoCause')`
  );
}

module.exports = {
  DB_PATH,
  openDatabase,
  run,
  get,
  all,
  initDatabase,
  rowToPaper,
  parseJsonArray,
};

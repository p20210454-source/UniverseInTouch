require('./lib/loadEnv').loadEnv();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { body, param, query, validationResult } = require('express-validator');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');
const {
  openDatabase,
  run,
  get,
  all,
  initDatabase,
  rowToPaper,
} = require('./db');
const {
  ADMIN_USERNAME,
  assertSecureConfig,
  validateAdminCredentials,
  parseCookies,
  createSession,
  getSession,
  destroySession,
  destroyAllSessions,
  requireAuth,
  requireAuthWithCsrf,
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
} = require('./lib/auth');
const { rateLimit } = require('./lib/rateLimit');
const {
  recordLoginFailure,
  clearLoginFailures,
  loginLockoutMiddleware,
} = require('./lib/loginLockout');
const { shouldRecordView } = require('./lib/viewDedup');
const { createPlainTextSanitizer } = require('./lib/sanitizeText');
const {
  paperBodyValidators,
  normalizePaperInput,
  escapeLike,
} = require('./lib/validate');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);
const sanitizePlainText = createPlainTextSanitizer(DOMPurify);

assertSecureConfig();

const app = express();
const port = process.env.PORT || 3000;
const db = openDatabase();
const PUBLIC_DIR = path.join(__dirname, 'docs');

const ALLOWED_FIELDS = new Set(['math', 'all']);
const ALLOWED_PAGE_IDS = new Set([
  'home', 'search-page', 'about-page', 'paper-view', 'admin-page',
  'add-paper', 'manage', 'categories', 'analytics', 'install', 'settings',
]);

const writeLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 120 });
const viewLimit = rateLimit({ windowMs: 60 * 1000, max: 60 });
const subscribeLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
const authMeLimit = rateLimit({ windowMs: 60 * 1000, max: 120 });

const sendValidationErrors = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (process.env.NODE_ENV === 'production') {
      res.status(400).json({ error: 'Invalid request' });
    } else {
      res.status(400).json({ error: 'Invalid request', errors: errors.array() });
    }
    return true;
  }
  return false;
};

const sanitizePaper = (paper) => {
  const sanitized = { ...paper };
  ['title', 'authors', 'abstract', 'body', 'journal', 'doi'].forEach((field) => {
    if (sanitized[field]) sanitized[field] = DOMPurify.sanitize(String(sanitized[field]));
  });
  if (Array.isArray(sanitized.tags)) {
    sanitized.tags = sanitized.tags
      .map((t) => DOMPurify.sanitize(String(t)).trim())
      .filter(Boolean)
      .slice(0, 30);
  }
  if (Array.isArray(sanitized.refs)) {
    sanitized.refs = sanitized.refs
      .map((r) => DOMPurify.sanitize(String(r)).trim())
      .filter(Boolean)
      .slice(0, 100);
  }
  return sanitized;
};

const slugify = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'category';

const LEGACY_SITE_NAMES = new Set(['ResearchHub', 'CosmoCause']);
const SITE_NAME = 'UniverseInTouch';

function normalizeBlogTitle(value) {
  const title = String(value || '').trim();
  if (!title || LEGACY_SITE_NAMES.has(title)) return SITE_NAME;
  return title;
}

async function loadSettingsMap() {
  const rows = await all(db, 'SELECT key, value FROM settings');
  const settings = {};
  rows.forEach((r) => {
    settings[r.key] = r.value;
  });
  if (LEGACY_SITE_NAMES.has(settings.blogTitle)) {
    settings.blogTitle = SITE_NAME;
    await run(db, 'UPDATE settings SET value = ? WHERE key = ?', [SITE_NAME, 'blogTitle']);
  }
  return settings;
}

async function setFeaturedPaperById(paperId) {
  const id = parseInt(paperId, 10);
  if (!id || id < 1) return;
  await run(db, 'UPDATE papers SET featured = 0');
  await run(db, 'UPDATE papers SET featured = 1 WHERE id = ? AND status = ?', [
    id,
    'published',
  ]);
  await run(
    db,
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ['featuredPaperId', String(id)]
  );
}

async function resolveFeaturedPaper(field) {
  const settings = await loadSettingsMap();
  if (settings.featuredPaperId) {
    const id = parseInt(settings.featuredPaperId, 10);
    if (id > 0) {
      const row = await get(
        db,
        `SELECT * FROM papers WHERE id = ? AND status = 'published'`,
        [id]
      );
      if (row && (field === 'all' || row.field === field)) {
        return rowToPaper(row);
      }
    }
  }
  const featuredRow = await get(
    db,
    `SELECT * FROM papers WHERE featured = 1 AND status = 'published' LIMIT 1`
  );
  if (featuredRow) {
    const paper = rowToPaper(featuredRow);
    if (field === 'all' || featuredRow.field === field) {
      return paper;
    }
  }
  return null;
}

function buildPaperFilters(field, q, opts = {}) {
  const conditions = ["status = 'published'"];
  const params = [];

  if (field !== 'all') {
    conditions.push('field = ?');
    params.push(field);
  }

  if (opts.excludeFeatured) {
    conditions.push('featured = 0');
  }

  if (q) {
    const like = `%${escapeLike(q.toLowerCase())}%`;
    conditions.push(
      `(LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(authors) LIKE ? ESCAPE '\\' OR LOWER(abstract) LIKE ? ESCAPE '\\' OR LOWER(tags) LIKE ? ESCAPE '\\')`
    );
    params.push(like, like, like, like);
  }

  return { listWhere: conditions.join(' AND '), params };
}

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : [`http://localhost:${port}`, 'http://127.0.0.1:' + port];

if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

const isProduction = process.env.NODE_ENV === 'production';

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        styleSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        scriptSrc: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: isProduction
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '512kb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// ——— Auth ———

app.post(
  '/api/auth/login',
  loginLimit,
  loginLockoutMiddleware,
  [
    body('username').trim().notEmpty().isLength({ max: 64 }),
    body('password').notEmpty().isLength({ max: 128 }),
  ],
  async (req, res) => {
    if (sendValidationErrors(req, res)) return;
    const ok = await validateAdminCredentials(req.body.username, req.body.password);
    if (!ok) {
      recordLoginFailure(req);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    clearLoginFailures(req);
    destroyAllSessions();
    const { token, csrf } = createSession();
    setSessionCookie(res, token);
    res.json({ ok: true, csrfToken: csrf });
  }
);

app.post('/api/auth/logout', requireAuthWithCsrf, (req, res) => {
  const cookies = parseCookies(req);
  destroySession(cookies[SESSION_COOKIE]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', authMeLimit, (req, res) => {
  const session = getSession(req);
  res.json({
    authenticated: !!session,
    csrfToken: session ? session.csrf : null,
  });
});

// ——— Public read APIs ———

app.get('/api/papers', async (req, res) => {
  try {
    const rows = await all(
      db,
      `SELECT * FROM papers WHERE status = 'published' ORDER BY date DESC`
    );
    res.json(rows.map(rowToPaper));
  } catch {
    res.status(500).json({ error: 'Failed to load papers' });
  }
});

app.get(
  '/api/admin/papers',
  requireAuth,
  async (req, res) => {
    try {
      const rows = await all(db, 'SELECT * FROM papers ORDER BY date DESC');
      res.json(rows.map(rowToPaper));
    } catch {
      res.status(500).json({ error: 'Failed to load papers' });
    }
  }
);

app.get(
  '/api/papers/browse',
  query('field').optional().isString(),
  query('q').optional().isString().isLength({ max: 200 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('offset').optional().isInt({ min: 0 }),
  async (req, res) => {
    if (sendValidationErrors(req, res)) return;

    const field = (req.query.field || 'all').toString();
    const q = (req.query.q || '').toString().trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 5, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    if (!ALLOWED_FIELDS.has(field)) {
      return res.status(400).json({ error: 'Invalid field' });
    }

    try {
      const { listWhere, params } = buildPaperFilters(field, q, { excludeFeatured: true });
      const countRow = await get(
        db,
        `SELECT COUNT(*) AS total FROM papers WHERE ${listWhere}`,
        params
      );
      const rows = await all(
        db,
        `SELECT * FROM papers WHERE ${listWhere} ORDER BY date DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
      const featured = await resolveFeaturedPaper(field);

      res.json({
        papers: rows.map(rowToPaper),
        total: countRow.total,
        featured,
        field,
        limit,
        offset,
      });
    } catch {
      res.status(500).json({ error: 'Failed to load papers' });
    }
  }
);

app.get('/api/papers/trending', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 20);
  try {
    const rows = await all(
      db,
      `SELECT * FROM papers WHERE status = 'published' ORDER BY views DESC, date DESC LIMIT ?`,
      [limit]
    );
    res.json(rows.map(rowToPaper));
  } catch {
    res.status(500).json({ error: 'Failed to load trending' });
  }
});

app.get('/api/papers/tags', async (req, res) => {
  try {
    const rows = await all(
      db,
      `SELECT tags FROM papers WHERE status = 'published' AND tags IS NOT NULL`
    );
    const counts = {};
    rows.forEach((row) => {
      rowToPaper(row).tags.forEach((t) => {
        counts[t] = (counts[t] || 0) + 1;
      });
    });
    res.json(
      Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([name, count]) => ({ name, count }))
    );
  } catch {
    res.status(500).json({ error: 'Failed to load tags' });
  }
});

app.get(
  '/api/papers/:id',
  param('id').isInt({ min: 1 }),
  async (req, res) => {
    if (sendValidationErrors(req, res)) return;
    try {
      const row = await get(
        db,
        `SELECT * FROM papers WHERE id = ? AND status = 'published'`,
        [req.params.id]
      );
      if (!row) return res.status(404).json({ error: 'Paper not found' });
      res.json(rowToPaper(row));
    } catch {
      res.status(500).json({ error: 'Failed to load paper' });
    }
  }
);

app.get(
  '/api/admin/papers/:id',
  requireAuth,
  param('id').isInt({ min: 1 }),
  async (req, res) => {
    if (sendValidationErrors(req, res)) return;
    try {
      const row = await get(db, 'SELECT * FROM papers WHERE id = ?', [req.params.id]);
      if (!row) return res.status(404).json({ error: 'Paper not found' });
      res.json(rowToPaper(row));
    } catch {
      res.status(500).json({ error: 'Failed to load paper' });
    }
  }
);

// ——— Protected writes ———

const paperUpdateValidators = [
  body('title').optional().trim().notEmpty().isLength({ max: 500 }),
  body('authors').optional().trim().notEmpty().isLength({ max: 500 }),
  body('date').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
  body('field').optional().isIn(['math']),
  body('access').optional().isIn(['open', 'peer']),
  body('status').optional().isIn(['published', 'draft']),
  body('journal').optional().isLength({ max: 300 }),
  body('doi').optional().isLength({ max: 200 }),
  body('abstract').optional().isLength({ max: 50000 }),
  body('body').optional().isLength({ max: 200000 }),
  body('citations').optional().isInt({ min: 0, max: 1000000 }),
  body('tags').optional().isArray({ max: 30 }),
  body('tags.*').optional().isString().isLength({ max: 100 }),
  body('refs').optional().isArray({ max: 100 }),
  body('refs.*').optional().isString().isLength({ max: 500 }),
  body('featured').optional().isBoolean(),
];

app.post(
  '/api/papers',
  ...requireAuthWithCsrf,
  writeLimit,
  paperBodyValidators,
  async (req, res) => {
    if (sendValidationErrors(req, res)) return;

    try {
      const normalized = normalizePaperInput(req.body);
      const paper = sanitizePaper(normalized);

      const result = await run(
        db,
        `INSERT INTO papers (featured, title, authors, date, field, access, journal, doi, abstract, body, tags, citations, views, status, refs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          paper.featured ? 1 : 0,
          paper.title,
          paper.authors,
          paper.date || new Date().toISOString().slice(0, 10),
          paper.field,
          paper.access,
          paper.journal || 'Unpublished',
          paper.doi || '',
          paper.abstract || '',
          paper.body || '',
          JSON.stringify(paper.tags || []),
          paper.citations || 0,
          paper.status,
          JSON.stringify(paper.refs || []),
        ]
      );

      const row = await get(db, 'SELECT * FROM papers WHERE id = ?', [result.lastID]);
      if (paper.featured && paper.status === 'published') {
        await setFeaturedPaperById(result.lastID);
      }
      res.status(201).json(rowToPaper(row));
    } catch {
      res.status(500).json({ error: 'Failed to save paper' });
    }
  }
);

app.put(
  '/api/papers/:id',
  ...requireAuthWithCsrf,
  writeLimit,
  param('id').isInt({ min: 1 }),
  paperUpdateValidators,
  async (req, res) => {
    if (sendValidationErrors(req, res)) return;

    try {
      const existing = await get(db, 'SELECT * FROM papers WHERE id = ?', [req.params.id]);
      if (!existing) return res.status(404).json({ error: 'Paper not found' });

      const normalized = normalizePaperInput(req.body, existing);
      const merged = {
        ...existing,
        ...normalized,
        tags: normalized.tags !== undefined ? normalized.tags : rowToPaper(existing).tags,
        refs: normalized.refs !== undefined ? normalized.refs : rowToPaper(existing).refs,
      };
      const paper = sanitizePaper(merged);

      await run(
        db,
        `UPDATE papers SET featured=?, title=?, authors=?, date=?, field=?, access=?, journal=?, doi=?,
         abstract=?, body=?, tags=?, citations=?, status=?, refs=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [
          paper.featured ? 1 : 0,
          paper.title,
          paper.authors,
          paper.date,
          paper.field,
          paper.access,
          paper.journal,
          paper.doi,
          paper.abstract,
          paper.body,
          JSON.stringify(paper.tags || []),
          paper.citations ?? existing.citations ?? 0,
          paper.status,
          JSON.stringify(paper.refs || []),
          req.params.id,
        ]
      );

      const row = await get(db, 'SELECT * FROM papers WHERE id = ?', [req.params.id]);
      if (paper.featured && paper.status === 'published') {
        await setFeaturedPaperById(req.params.id);
      } else if (!paper.featured) {
        const settings = await loadSettingsMap();
        if (String(settings.featuredPaperId) === String(req.params.id)) {
          await run(
            db,
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            ['featuredPaperId', '']
          );
          await run(db, 'UPDATE papers SET featured = 0 WHERE id = ?', [req.params.id]);
        }
      }
      res.json(rowToPaper(row));
    } catch {
      res.status(500).json({ error: 'Failed to update paper' });
    }
  }
);

app.delete(
  '/api/papers/:id',
  ...requireAuthWithCsrf,
  writeLimit,
  param('id').isInt({ min: 1 }),
  async (req, res) => {
    if (sendValidationErrors(req, res)) return;
    try {
      const result = await run(db, 'DELETE FROM papers WHERE id = ?', [req.params.id]);
      res.json({ message: 'Deleted', changes: result.changes });
    } catch {
      res.status(500).json({ error: 'Failed to delete paper' });
    }
  }
);

app.post(
  '/api/papers/:id/view',
  viewLimit,
  param('id').isInt({ min: 1 }),
  async (req, res) => {
    if (sendValidationErrors(req, res)) return;
    try {
      if (!shouldRecordView(req, req.params.id)) {
        return res.json({ message: 'View already recorded' });
      }
      const result = await run(
        db,
        `UPDATE papers SET views = views + 1 WHERE id = ? AND status = 'published'`,
        [req.params.id]
      );
      if (!result.changes) return res.status(404).json({ error: 'Paper not found' });
      res.json({ message: 'View incremented' });
    } catch {
      res.status(500).json({ error: 'Failed to record view' });
    }
  }
);

// ——— Stats (public aggregates only) ———

app.get('/api/stats', async (req, res) => {
  try {
    const totalRow = await get(
      db,
      `SELECT COUNT(*) AS n FROM papers WHERE status = 'published'`
    );
    const viewsRow = await get(
      db,
      `SELECT COALESCE(SUM(views), 0) AS n FROM papers WHERE status = 'published'`
    );
    const citationsRow = await get(
      db,
      `SELECT COALESCE(SUM(citations), 0) AS n FROM papers WHERE status = 'published'`
    );
    const openRow = await get(
      db,
      `SELECT COUNT(*) AS n FROM papers WHERE status = 'published' AND access = 'open'`
    );
    const peerRow = await get(
      db,
      `SELECT COUNT(*) AS n FROM papers WHERE status = 'published' AND access = 'peer'`
    );
    const subRow = await get(db, 'SELECT COUNT(*) AS n FROM subscribers');
    const recent = await all(
      db,
      `SELECT * FROM papers WHERE status = 'published' ORDER BY created_at DESC LIMIT 6`
    );
    const topViewed = await get(
      db,
      `SELECT title, views FROM papers WHERE status = 'published' ORDER BY views DESC LIMIT 1`
    );
    const fieldRows = await all(
      db,
      `SELECT field, SUM(views) AS views FROM papers WHERE status = 'published' GROUP BY field`
    );

    const total = totalRow.n || 0;

    res.json({
      totalPapers: total,
      totalViews: viewsRow.n,
      totalCitations: citationsRow.n,
      openAccessPercent: total ? Math.round((openRow.n / total) * 100) : 0,
      peerReviewedPercent: total ? Math.round((peerRow.n / total) * 100) : 0,
      avgCitations: total ? (citationsRow.n / total).toFixed(1) : '0',
      subscribers: subRow.n,
      topPaper: topViewed ? { title: topViewed.title, views: topViewed.views } : null,
      viewsByField: fieldRows.map((r) => ({ field: r.field, views: r.views })),
      recentPapers: recent.map(rowToPaper),
    });
  } catch {
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ——— Admin dashboard ———

function buildDashboardActivity(paperRows) {
  const items = [];
  paperRows.forEach((row) => {
    const p = rowToPaper(row);
    const title = (p.title || '').slice(0, 60);
    const created = row.created_at ? new Date(row.created_at).getTime() : 0;
    const updated = row.updated_at ? new Date(row.updated_at).getTime() : created;
    const isNew =
      created &&
      (!updated || Math.abs(updated - created) < 120000);

    if (p.status === 'draft') {
      items.push({
        type: 'edit',
        text: `Draft: ${title}`,
        at: row.updated_at || row.created_at,
        paperId: p.id,
      });
      return;
    }

    if (isNew) {
      items.push({
        type: 'add',
        text: `New paper: ${title}`,
        at: row.created_at,
        paperId: p.id,
      });
    } else if (updated > created) {
      items.push({
        type: 'edit',
        text: `Updated: ${title}`,
        at: row.updated_at || row.created_at,
        paperId: p.id,
      });
    }
  });
  return items
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 8);
}

app.get('/api/admin/dashboard', requireAuth, async (req, res) => {
  try {
    const publishedRow = await get(
      db,
      `SELECT COUNT(*) AS n FROM papers WHERE status = 'published'`
    );
    const draftRow = await get(
      db,
      `SELECT COUNT(*) AS n FROM papers WHERE status = 'draft'`
    );
    const viewsRow = await get(
      db,
      `SELECT COALESCE(SUM(views), 0) AS n FROM papers WHERE status = 'published'`
    );
    const citationsRow = await get(
      db,
      `SELECT COALESCE(SUM(citations), 0) AS n FROM papers WHERE status = 'published'`
    );
    const openRow = await get(
      db,
      `SELECT COUNT(*) AS n FROM papers WHERE status = 'published' AND access = 'open'`
    );
    const peerRow = await get(
      db,
      `SELECT COUNT(*) AS n FROM papers WHERE status = 'published' AND access = 'peer'`
    );
    const subRow = await get(db, 'SELECT COUNT(*) AS n FROM subscribers');
    const catRow = await get(db, 'SELECT COUNT(*) AS n FROM categories');
    const recentPublished = await all(
      db,
      `SELECT * FROM papers WHERE status = 'published' ORDER BY date DESC LIMIT 8`
    );
    const recentAll = await all(
      db,
      `SELECT * FROM papers ORDER BY COALESCE(updated_at, created_at) DESC LIMIT 12`
    );
    const monthRow = await get(
      db,
      `SELECT COUNT(*) AS n FROM papers WHERE status = 'published' AND created_at >= datetime('now', '-30 days')`
    );
    const topViewed = await get(
      db,
      `SELECT * FROM papers WHERE status = 'published' ORDER BY views DESC LIMIT 1`
    );
    const featuredPaper = await resolveFeaturedPaper('all');
    const fieldRows = await all(
      db,
      `SELECT field, SUM(views) AS views, COUNT(*) AS count FROM papers WHERE status = 'published' GROUP BY field`
    );

    const published = publishedRow.n || 0;
    const drafts = draftRow.n || 0;

    res.json({
      publishedCount: published,
      draftCount: drafts,
      totalPapers: published + drafts,
      totalViews: viewsRow.n,
      totalCitations: citationsRow.n,
      openAccessPercent: published ? Math.round((openRow.n / published) * 100) : 0,
      peerReviewedPercent: published ? Math.round((peerRow.n / published) * 100) : 0,
      avgCitations: published ? (citationsRow.n / published).toFixed(1) : '0',
      subscribers: subRow.n,
      categoryCount: catRow.n,
      publishedThisMonth: monthRow.n || 0,
      topPaper: topViewed ? rowToPaper(topViewed) : null,
      featuredPaper,
      viewsByField: fieldRows.map((r) => ({
        field: r.field,
        views: r.views,
        count: r.count,
      })),
      recentPapers: recentPublished.map(rowToPaper),
      activity: buildDashboardActivity(recentAll),
    });
  } catch {
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ——— Categories ———

app.get('/api/categories', async (req, res) => {
  try {
    res.json(await all(db, 'SELECT * FROM categories ORDER BY name'));
  } catch {
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

app.post(
  '/api/categories',
  ...requireAuthWithCsrf,
  writeLimit,
  [
    body('name').trim().notEmpty().isLength({ max: 100 }),
    body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/),
  ],
  async (req, res) => {
    if (sendValidationErrors(req, res)) return;
    try {
      const name = DOMPurify.sanitize(req.body.name);
      const color = req.body.color || '#c0392b';
      const result = await run(
        db,
        'INSERT INTO categories (slug, name, color) VALUES (?, ?, ?)',
        [slugify(name), name, color]
      );
      const row = await get(db, 'SELECT * FROM categories WHERE id = ?', [result.lastID]);
      res.status(201).json(row);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return res.status(409).json({ error: 'Category already exists' });
      }
      res.status(500).json({ error: 'Failed to add category' });
    }
  }
);

app.delete(
  '/api/categories/:id',
  ...requireAuthWithCsrf,
  writeLimit,
  param('id').isInt({ min: 1 }),
  async (req, res) => {
    if (sendValidationErrors(req, res)) return;
    try {
      const result = await run(db, 'DELETE FROM categories WHERE id = ?', [req.params.id]);
      res.json({ message: 'Deleted', changes: result.changes });
    } catch {
      res.status(500).json({ error: 'Failed to delete category' });
    }
  }
);

// ——— Settings ———

const PUBLIC_SETTING_KEYS = ['blogTitle', 'tagline', 'papersPerPage', 'theme'];

app.get('/api/settings', async (req, res) => {
  try {
    const settings = await loadSettingsMap();
    const publicSettings = {};
    PUBLIC_SETTING_KEYS.forEach((k) => {
      if (settings[k] !== undefined) publicSettings[k] = settings[k];
    });
    res.json(publicSettings);
  } catch {
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

app.get('/api/admin/settings', requireAuth, async (req, res) => {
  try {
    res.json(await loadSettingsMap());
  } catch {
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

app.put(
  '/api/settings',
  ...requireAuthWithCsrf,
  writeLimit,
  [
    body('blogTitle').optional().isLength({ max: 200 }),
    body('tagline').optional().isLength({ max: 300 }),
    body('papersPerPage').optional().isInt({ min: 1, max: 50 }),
    body('featuredPaperId')
      .optional({ values: 'falsy' })
      .custom((val) => {
        if (val === '' || val === null || val === undefined) return true;
        const n = parseInt(val, 10);
        if (!Number.isFinite(n) || n < 0 || n > 999999999) {
          throw new Error('Invalid featured paper id');
        }
        return true;
      }),
    body('theme').optional().isIn(['paper-ink', 'dark-academia', 'clean-white']),
  ],
  async (req, res) => {
    if (sendValidationErrors(req, res)) return;
    const allowed = ['blogTitle', 'tagline', 'papersPerPage', 'featuredPaperId', 'theme'];
    try {
      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          let value = String(req.body[key]);
          if (key === 'blogTitle') value = sanitizePlainText(normalizeBlogTitle(value), 200);
          else if (key === 'tagline') value = sanitizePlainText(value, 300);
          await run(
            db,
            'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            [key, value]
          );
          if (key === 'featuredPaperId') {
            const fid = parseInt(req.body[key], 10);
            if (fid > 0) {
              await setFeaturedPaperById(fid);
            } else {
              await run(db, 'UPDATE papers SET featured = 0');
              await run(
                db,
                'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
                ['featuredPaperId', '']
              );
            }
          }
        }
      }
      res.json(await loadSettingsMap());
    } catch {
      res.status(500).json({ error: 'Failed to save settings' });
    }
  }
);

// ——— Newsletter ———

app.post(
  '/api/subscribers',
  subscribeLimit,
  [body('email').isEmail().normalizeEmail()],
  async (req, res) => {
    if (sendValidationErrors(req, res)) return;
    try {
      await run(db, 'INSERT INTO subscribers (email) VALUES (?)', [req.body.email]);
      res.status(201).json({ message: 'Subscribed successfully' });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return res.status(201).json({ message: 'Subscribed successfully' });
      }
      res.status(500).json({ error: 'Failed to subscribe' });
    }
  }
);

// ——— Unknown API (JSON 404, not HTML "Cannot GET") ———

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// ——— Static site ———

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/about', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'about.html'));
});

app.get('/search', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'search.html'));
});

app.get('/paper/:id', (req, res) => {
  res.redirect(301, `/paper.html?id=${encodeURIComponent(req.params.id)}`);
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.get('/research-blog.html', (req, res) => {
  res.redirect(301, '/');
});

app.use(express.static(PUBLIC_DIR, { index: false, dotfiles: 'deny' }));

initDatabase(db)
  .then(() => {
    app.listen(port, () => {
      console.log(`UniverseInTouch backend running at http://localhost:${port}`);
      console.log(`Admin login: username "${ADMIN_USERNAME}" (set ADMIN_PASSWORD in .env)`);
    });
  })
  .catch((err) => {
    console.error('Database init failed:', err);
    process.exit(1);
  });

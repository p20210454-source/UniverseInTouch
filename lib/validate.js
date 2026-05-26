const { body } = require('express-validator');

const ALLOWED_FIELDS = ['math'];
const ALLOWED_ACCESS = ['open', 'peer'];
const ALLOWED_STATUS = ['published', 'draft'];

const paperBodyValidators = [
  body('title').trim().notEmpty().isLength({ max: 500 }),
  body('authors').trim().notEmpty().isLength({ max: 500 }),
  body('date').optional().matches(/^\d{4}-\d{2}-\d{2}$/),
  body('field').optional().isIn(ALLOWED_FIELDS),
  body('access').optional().isIn(ALLOWED_ACCESS),
  body('status').optional().isIn(ALLOWED_STATUS),
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

function normalizePaperInput(body, existing = {}) {
  const field =
    ALLOWED_FIELDS.includes(body.field) ? body.field : existing.field || 'math';
  const access =
    ALLOWED_ACCESS.includes(body.access) ? body.access : existing.access || 'open';
  const status =
    ALLOWED_STATUS.includes(body.status) ? body.status : existing.status || 'published';

  return {
    featured: Boolean(body.featured),
    title: body.title ?? existing.title,
    authors: body.authors ?? existing.authors,
    date: body.date ?? existing.date,
    field,
    access,
    status,
    journal: body.journal ?? existing.journal,
    doi: body.doi ?? existing.doi,
    abstract: body.abstract ?? existing.abstract,
    body: body.body ?? existing.body,
    tags: Array.isArray(body.tags) ? body.tags.slice(0, 30) : undefined,
    refs: Array.isArray(body.refs) ? body.refs.slice(0, 100) : undefined,
    citations:
      body.citations !== undefined ? body.citations : existing.citations,
  };
}


function escapeLike(q) {
  return q.replace(/[%_\\]/g, '\\$&');
}

module.exports = {
  ALLOWED_FIELDS,
  ALLOWED_ACCESS,
  ALLOWED_STATUS,
  paperBodyValidators,
  normalizePaperInput,
  escapeLike,
};

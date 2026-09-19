/**
 * Shared pagination helpers: parse ?page/?pageSize query params (with sane caps), and build
 * the {page, pageSize, total, totalPages} envelope object every list endpoint must return.
 * Responsibility: single source of truth for pagination so all 15+ list endpoints stay consistent.
 */

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Parse ?page/?pageSize query params into Prisma-ready skip/take, clamping to sane bounds.
 * Never throws — invalid/missing input silently falls back to defaults so a list endpoint
 * is never broken by a malformed query string.
 * @param {object} query - typically req.query
 * @returns {{page:number, pageSize:number, skip:number, take:number}}
 */
function parsePagination(query = {}) {
  let page = parseInt(query.page, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;

  let pageSize = parseInt(query.pageSize, 10);
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = DEFAULT_PAGE_SIZE;
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * Build the pagination envelope returned alongside list data.
 * @param {{page:number, pageSize:number, total:number}} params
 * @returns {{page:number, pageSize:number, total:number, totalPages:number}}
 */
function buildPaginationMeta({ page, pageSize, total }) {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  return { page, pageSize, total, totalPages };
}

module.exports = { parsePagination, buildPaginationMeta, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };

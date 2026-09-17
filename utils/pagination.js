/**
 * utils/pagination.js
 * Generic pagination helper for Mongoose queries.
 */

/**
 * Paginate a Mongoose query.
 * @param {object} model - Mongoose model
 * @param {object} query - filter object
 * @param {object} options - { page, limit, sort, populate }
 * @returns {object} { docs, totalDocs, totalPages, currentPage, hasNext, hasPrev }
 */
const paginate = async (model, query = {}, options = {}) => {
  const page = Math.max(1, parseInt(options.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(options.limit) || 10));
  const skip = (page - 1) * limit;
  const sort = options.sort || { createdAt: -1 };

  let dbQuery = model.find(query).sort(sort).skip(skip).limit(limit);
  if (options.populate) dbQuery = dbQuery.populate(options.populate);

  const [docs, totalDocs] = await Promise.all([dbQuery, model.countDocuments(query)]);
  const totalPages = Math.ceil(totalDocs / limit);

  return {
    docs,
    totalDocs,
    totalPages,
    currentPage: page,
    limit,
    hasNext: page < totalPages,
    hasPrev: page > 1,
    nextPage: page < totalPages ? page + 1 : null,
    prevPage: page > 1 ? page - 1 : null,
  };
};

module.exports = { paginate };

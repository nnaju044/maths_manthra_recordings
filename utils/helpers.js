/**
 * utils/helpers.js
 * Shared helper functions.
 */

/**
 * Format a Date object as a readable string.
 * @param {Date} date
 * @returns {string}
 */
const formatDate = (date) => {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
};

/**
 * Format a Date as relative time ("2 days ago").
 * @param {Date} date
 * @returns {string}
 */
const timeAgo = (date) => {
  if (!date) return '';
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  const intervals = [
    [31536000, 'year'], [2592000, 'month'], [86400, 'day'],
    [3600, 'hour'], [60, 'minute'], [1, 'second'],
  ];
  for (const [secs, unit] of intervals) {
    const count = Math.floor(seconds / secs);
    if (count >= 1) return `${count} ${unit}${count > 1 ? 's' : ''} ago`;
  }
  return 'just now';
};

/**
 * Truncate text to a max length.
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
const truncate = (text, maxLen = 100) => {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
};

/**
 * Resolve the application base URL.
 *
 * Priority:
 *   1. APP_URL environment variable (set in Railway dashboard / .env)
 *   2. Derived from the Express request object (works for any host)
 *
 * Never returns a trailing slash, so callers can safely do:
 *   `${getBaseUrl(req)}/course/${slug}`
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
const getBaseUrl = (req) => {
  const raw = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  return raw.replace(/\/$/, '');
};

module.exports = { formatDate, timeAgo, truncate, getBaseUrl };

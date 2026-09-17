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

module.exports = { formatDate, timeAgo, truncate };

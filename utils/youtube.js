/**
 * utils/youtube.js
 * YouTube URL parser — extracts video ID from various YouTube URL formats.
 * The embed URL is generated server-side only; it is NEVER exposed to students
 * as a clickable link or raw string in rendered HTML.
 */

/**
 * Extract YouTube video ID from various URL formats:
 *   https://www.youtube.com/watch?v=VIDEO_ID
 *   https://youtu.be/VIDEO_ID
 *   https://www.youtube.com/embed/VIDEO_ID
 *   https://www.youtube.com/shorts/VIDEO_ID
 *   VIDEO_ID (raw 11-char ID)
 *
 * @param {string} input - YouTube URL or video ID
 * @returns {string|null} - 11-character video ID or null
 */
const extractYouTubeId = (input) => {
  if (!input || typeof input !== 'string') return null;

  const trimmed = input.trim();

  // Already a raw 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  // Regex covering all common YouTube URL patterns
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/.*[?&]v=([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) return match[1];
  }

  return null;
};

/**
 * Build a safe YouTube embed URL with privacy-enhanced mode and restricted controls.
 * Parameters used to minimise YouTube branding and hide related videos:
 *   - rel=0         : don't show related videos at end
 *   - modestbranding=1 : reduce YouTube logo size
 *   - iv_load_policy=3 : hide annotations
 *   - fs=1          : allow fullscreen
 *   - enablejsapi=1 : enable YouTube iframe API (for progress tracking)
 *   - origin        : restrict postMessage to our domain
 *
 * NOTE: YouTube does not allow complete removal of branding via embed parameters.
 * This is the best achievable within YouTube's Terms of Service.
 *
 * @param {string} videoId - 11-character YouTube video ID
 * @param {number} [startSeconds=0] - resume position
 * @returns {string} - safe embed URL
 */
const buildEmbedUrl = (videoId, startSeconds = 0, appUrl = '') => {
  if (!videoId) return '';
  const origin = appUrl || process.env.APP_URL || '';
  const params = new URLSearchParams({
    rel: '0',              // Do not show related videos from outside channel
    modestbranding: '1',   // Minimal YouTube branding
    iv_load_policy: '3',   // Hide video annotations
    showinfo: '0',         // Hide video title/uploader where supported
    controls: '1',         // Clean video controls
    fs: '1',               // Allow fullscreen
    playsinline: '1',      // Keep playback inline on mobile devices
    enablejsapi: '1',      // Secure API interface
    origin,                // Restrict origin
    ...(startSeconds > 0 ? { start: Math.floor(startSeconds) } : {}),
  });
  // Use privacy-enhanced youtube-nocookie domain
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
};

module.exports = { extractYouTubeId, buildEmbedUrl };

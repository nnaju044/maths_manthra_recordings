/**
 * main.js — Shared client-side scripts
 * Toast auto-dismiss
 */
document.addEventListener('DOMContentLoaded', () => {
  // Auto-remove toast items after animation
  document.querySelectorAll('.toast-item').forEach(toast => {
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4500);
  });
});

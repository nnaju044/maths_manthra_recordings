/**
 * admin.js — Admin panel client-side scripts
 * Sidebar toggle, AJAX toggle/regenerate, drag-and-drop reorder, copy-to-clipboard
 */
document.addEventListener('DOMContentLoaded', () => {
  // ── Mobile Sidebar Toggle ──
  const sidebar = document.getElementById('adminSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const toggleBtn = document.getElementById('sidebarToggle');

  if (toggleBtn && sidebar && overlay) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('open');
    });
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
    });
  }

  // ── Drag and Drop Video Reorder ──
  const videoList = document.getElementById('videoList');
  if (videoList) {
    let draggedItem = null;

    videoList.querySelectorAll('.video-item-admin').forEach(item => {
      const handle = item.querySelector('.drag-handle');

      handle.addEventListener('mousedown', () => {
        item.setAttribute('draggable', 'true');
      });

      item.addEventListener('dragstart', (e) => {
        draggedItem = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        item.setAttribute('draggable', 'false');
        draggedItem = null;
        // Remove all drag-over classes
        videoList.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        // Save new order
        saveVideoOrder();
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (item !== draggedItem) {
          item.classList.add('drag-over');
        }
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        if (draggedItem && draggedItem !== item) {
          const allItems = [...videoList.querySelectorAll('.video-item-admin')];
          const dragIndex = allItems.indexOf(draggedItem);
          const dropIndex = allItems.indexOf(item);

          if (dragIndex < dropIndex) {
            item.after(draggedItem);
          } else {
            item.before(draggedItem);
          }
        }
      });
    });
  }

  function saveVideoOrder() {
    const items = [...document.querySelectorAll('#videoList .video-item-admin')].map((el, i) => ({
      id: el.dataset.id,
      order: i,
    }));

    fetch('/admin/videos/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        showToast('Video order saved!', 'success');
      }
    })
    .catch(err => {
      console.error('Reorder failed:', err);
      showToast('Failed to save order', 'error');
    });
  }
});

// ── Toggle Course Active Status (AJAX) ──
async function toggleActive(courseId, btn) {
  try {
    const res = await fetch(`/admin/courses/${courseId}/toggle-active`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      btn.className = `badge-status-btn ${data.isActive ? 'active' : 'inactive'}`;
      btn.textContent = data.isActive ? 'Active' : 'Inactive';
      showToast(`Course ${data.isActive ? 'activated' : 'deactivated'}`, 'success');
    }
  } catch (err) {
    console.error('Toggle failed:', err);
    showToast('Failed to toggle status', 'error');
  }
}

// ── Regenerate Course Slug (AJAX) ──
async function regenerateSlug(courseId) {
  if (!confirm('Generate a new link? The old link will stop working!')) return;

  try {
    const res = await fetch(`/admin/courses/${courseId}/regenerate-slug`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      const urlEl = document.getElementById('courseUrl');
      if (urlEl) urlEl.textContent = data.url;
      showToast('New link generated!', 'success');
    }
  } catch (err) {
    console.error('Regenerate failed:', err);
    showToast('Failed to generate new link', 'error');
  }
}

// ── Copy to Clipboard ──
function copyLink(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = 'bi bi-check-lg';
      setTimeout(() => { icon.className = 'bi bi-clipboard'; }, 1500);
    }
    showToast('Link copied to clipboard!', 'success');
  }).catch(() => {
    // Fallback
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    showToast('Link copied!', 'success');
  });
}

// ── Toast Helper ──
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer') ||
    (() => {
      const div = document.createElement('div');
      div.id = 'toastContainer';
      div.className = 'toast-container-custom';
      document.body.appendChild(div);
      return div;
    })();

  const toast = document.createElement('div');
  toast.className = `toast-item ${type === 'error' ? 'error' : ''}`;
  toast.innerHTML = `<span class="icon">${type === 'error' ? '❌' : '✅'}</span><span class="msg">${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 4500);
}

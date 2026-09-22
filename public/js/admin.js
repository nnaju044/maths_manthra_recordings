/**
 * admin.js — Admin panel client-side scripts
 * Sidebar toggle, AJAX toggle/regenerate, drag-and-drop reorder, copy-to-clipboard
 */
document.addEventListener('DOMContentLoaded', () => {
  // ── Mobile / Tablet Navigation Drawer ──
  const sidebar = document.getElementById('adminSidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const toggleBtn = document.getElementById('sidebarToggle');
  const drawerCloseBtn = document.getElementById('drawerCloseBtn');

  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('sidebar-open');
  }

  function openSidebar() {
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('open');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('sidebar-open');
  }

  if (toggleBtn && sidebar && overlay) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sidebar.classList.contains('open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });

    if (drawerCloseBtn) {
      drawerCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeSidebar();
      });
    }

    // Close on outside click (clicking backdrop overlay)
    overlay.addEventListener('click', closeSidebar);

    // Close on outside click anywhere outside drawer when open
    document.addEventListener('click', (e) => {
      if (
        sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) &&
        !toggleBtn.contains(e.target)
      ) {
        closeSidebar();
      }
    });

    // Auto-close sidebar when a nav link is clicked on mobile/tablet
    sidebar.querySelectorAll('.sidebar-link').forEach(link => {
      link.addEventListener('click', () => {
        if (window.innerWidth <= 1024) {
          closeSidebar();
        }
      });
    });

    // Close sidebar on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.classList.contains('open')) {
        closeSidebar();
      }
    });

    // Close drawer when resizing to desktop
    window.addEventListener('resize', () => {
      if (window.innerWidth > 1024 && sidebar.classList.contains('open')) {
        closeSidebar();
      }
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

  // ── Copy Link Buttons ──
  document.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', function () {
      copyLink(this.dataset.link, this);
    });
  });

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
function copyLink(url, btn) {
  const icon = btn && btn.querySelector('i');

  function onSuccess() {
    if (icon) {
      icon.className = 'bi bi-check-lg';
      icon.style.color = '#22c55e';
      setTimeout(() => { icon.className = 'bi bi-clipboard'; icon.style.color = ''; }, 1500);
    }
    showToast('Link copied!', 'success');
  }

  function onError() {
    if (icon) {
      icon.className = 'bi bi-x-lg';
      icon.style.color = '#ef4444';
      setTimeout(() => { icon.className = 'bi bi-clipboard'; icon.style.color = ''; }, 1500);
    }
    showToast('Copy failed — please copy the link manually', 'error');
  }

  // execCommand fallback (synchronous, works everywhere within a user gesture)
  function execFallback() {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    try {
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? onSuccess() : onError();
    } catch (e) {
      document.body.removeChild(ta);
      onError();
    }
  }

  // Prefer the Clipboard API; fall back to execCommand if unavailable or denied
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(url).then(onSuccess).catch(execFallback);
  } else {
    execFallback();
  }
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

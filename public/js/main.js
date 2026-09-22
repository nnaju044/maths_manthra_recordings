/**
 * main.js — Maths Manthra Mobile-First Learning App & Shared Scripts
 * Features:
 * - LocalStorage-based Course Progress Tracker
 * - Day-wise Lesson Completion State
 * - Interactive "Mark as Completed" Toggle
 * - Bottom Navigation Quick Resume
 * - Toast Auto-Dismiss
 */

(function () {
  'use strict';

  // Progress Manager using LocalStorage
  const ProgressManager = {
    getKey(courseSlug) {
      return `mm_completed_${courseSlug}`;
    },

    getCompleted(courseSlug) {
      try {
        const data = localStorage.getItem(this.getKey(courseSlug));
        return data ? JSON.parse(data) : [];
      } catch (e) {
        console.warn('LocalStorage error:', e);
        return [];
      }
    },

    setCompleted(courseSlug, completedList) {
      try {
        localStorage.setItem(this.getKey(courseSlug), JSON.stringify(completedList));
      } catch (e) {
        console.warn('LocalStorage error:', e);
      }
    },

    isCompleted(courseSlug, videoId) {
      const list = this.getCompleted(courseSlug);
      return list.includes(String(videoId));
    },

    toggleCompleted(courseSlug, videoId) {
      const list = this.getCompleted(courseSlug);
      const strId = String(videoId);
      const index = list.indexOf(strId);
      let isNowCompleted = false;

      if (index > -1) {
        list.splice(index, 1);
        isNowCompleted = false;
      } else {
        list.push(strId);
        isNowCompleted = true;
      }

      this.setCompleted(courseSlug, list);
      return isNowCompleted;
    },

    markCompleted(courseSlug, videoId) {
      const list = this.getCompleted(courseSlug);
      const strId = String(videoId);
      if (!list.includes(strId)) {
        list.push(strId);
        this.setCompleted(courseSlug, list);
      }
      return true;
    }
  };

  // DOM Content Loaded Handler
  document.addEventListener('DOMContentLoaded', () => {
    // 1. Toast auto-dismiss
    document.querySelectorAll('.toast-item').forEach(toast => {
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 4500);
    });

    // 2. Course Videos Page: Progress & Card Status Sync
    const courseContainer = document.querySelector('[data-course-slug]');
    if (courseContainer) {
      const courseSlug = courseContainer.getAttribute('data-course-slug');
      const totalVideos = parseInt(courseContainer.getAttribute('data-total-videos') || '0', 10);

      const completed = ProgressManager.getCompleted(courseSlug);
      const completedCount = completed.length;
      const percent = totalVideos > 0 ? Math.min(100, Math.round((completedCount / totalVideos) * 100)) : 0;

      // Update progress bar & text
      const progressBar = document.getElementById('courseProgressBar');
      const progressPercentEl = document.getElementById('courseProgressPercent');
      const progressTextEl = document.getElementById('courseProgressCount');

      if (progressBar) {
        progressBar.style.width = `${percent}%`;
        progressBar.setAttribute('aria-valuenow', percent);
      }
      if (progressPercentEl) {
        progressPercentEl.textContent = `${percent}%`;
      }
      if (progressTextEl) {
        progressTextEl.textContent = `${completedCount} of ${totalVideos} Completed`;
      }

      // Update individual lesson cards
      const lessonCards = document.querySelectorAll('.lesson-app-card[data-video-id]');
      let firstUnwatchedHref = null;

      lessonCards.forEach(card => {
        const videoId = card.getAttribute('data-video-id');
        const isDone = completed.includes(videoId);
        const statusPill = card.querySelector('.lesson-status-pill');

        if (isDone) {
          card.classList.add('is-completed');
          if (statusPill) {
            statusPill.classList.add('completed');
            statusPill.innerHTML = '<i class="bi bi-check-circle-fill"></i> Completed';
          }
        } else {
          if (!firstUnwatchedHref) {
            firstUnwatchedHref = card.getAttribute('href');
          }
          if (statusPill) {
            statusPill.classList.remove('completed');
            statusPill.innerHTML = '<i class="bi bi-circle"></i> Unwatched';
          }
        }
      });

      // Update Resume Learning buttons (hero and bottom nav)
      if (firstUnwatchedHref) {
        const resumeBtn = document.getElementById('btnResumeLearning');
        const bottomNavResume = document.getElementById('bottomNavResume');
        if (resumeBtn) resumeBtn.setAttribute('href', firstUnwatchedHref);
        if (bottomNavResume) bottomNavResume.setAttribute('href', firstUnwatchedHref);
      }
    }

    // 3. Video Player Page: Completion Toggle & Bottom Nav
    const playerContainer = document.querySelector('[data-player-slug]');
    if (playerContainer) {
      const courseSlug = playerContainer.getAttribute('data-player-slug');
      const currentVideoId = playerContainer.getAttribute('data-current-video-id');
      const toggleBtn = document.getElementById('btnToggleComplete');
      const statusText = document.getElementById('completeStatusText');
      const statusIcon = document.getElementById('completeStatusIcon');

      function updatePlayerCompleteUI(isDone) {
        if (!toggleBtn) return;
        if (isDone) {
          toggleBtn.classList.add('completed');
          if (statusText) statusText.textContent = 'Completed';
          if (statusIcon) statusIcon.className = 'bi bi-check-circle-fill text-success';
        } else {
          toggleBtn.classList.remove('completed');
          if (statusText) statusText.textContent = 'Mark as Completed';
          if (statusIcon) statusIcon.className = 'bi bi-check-circle';
        }
      }

      // Initial check
      const initiallyDone = ProgressManager.isCompleted(courseSlug, currentVideoId);
      updatePlayerCompleteUI(initiallyDone);

      // Handle Toggle Click
      if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
          e.preventDefault();
          const isDone = ProgressManager.toggleCompleted(courseSlug, currentVideoId);
          updatePlayerCompleteUI(isDone);
        });
      }
    }
  });

  // Expose globally if needed
  window.MathsManthraProgress = ProgressManager;
})();

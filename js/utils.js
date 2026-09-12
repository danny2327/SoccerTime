'use strict';

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// Sort roster: numbered players ascending by number, un-numbered players last (by name).
function sortedRoster(players) {
  return [...players].sort((a, b) => {
    const an = a.number ? parseInt(a.number, 10) : null;
    const bn = b.number ? parseInt(b.number, 10) : null;
    if (an != null && bn != null) return an - bn;
    if (an != null) return -1;
    if (bn != null) return 1;
    return a.name.localeCompare(b.name);
  });
}

// A custom yes/no modal, used instead of window.confirm(). Native confirm() dialogs are
// unreliable mid-gesture on mobile browsers - some auto-suppress repeated dialogs after just a
// couple of uses ("Prevent this page from creating additional dialogs"), silently resolving to
// "cancelled" from then on with no visible box at all. This always renders the same way.
function showConfirm(message, confirmLabel) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-card">
        <p class="confirm-message"></p>
        <div class="confirm-actions">
          <button class="secondary-btn" id="confirm-no" type="button">Cancel</button>
          <button class="primary-btn" id="confirm-yes" type="button"></button>
        </div>
      </div>
    `;
    modal.querySelector('.confirm-message').textContent = message;
    modal.querySelector('#confirm-yes').textContent = confirmLabel || 'OK';
    document.body.appendChild(modal);

    function finish(result) {
      modal.remove();
      resolve(result);
    }
    modal.querySelector('#confirm-yes').addEventListener('click', () => finish(true));
    modal.querySelector('#confirm-no').addEventListener('click', () => finish(false));
    modal.addEventListener('click', (e) => { if (e.target === modal) finish(false); });
  });
}

// A brief, non-blocking notice (e.g. "field is full") - unlike alert()/confirm(), it doesn't
// interrupt the gesture the user is in the middle of.
function showToast(message, duration) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => {
    el.classList.remove('toast-visible');
    setTimeout(() => el.remove(), 300);
  }, duration || 2200);
}

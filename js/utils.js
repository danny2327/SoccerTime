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

// A brief in-app walkthrough, reachable before a match starts (the floating "?" button on the
// team/setup screens) and during one (Settings > Help). Built the same way as showConfirm -
// appended straight to document.body - so any screen can open it without needing its own
// dedicated modal container. The legend demos reuse the actual token/badge CSS classes rather
// than re-describing the colors in prose, so they can never drift from what the real tokens look
// like.
function showHelp() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-card help-card">
      <h2>How SoccerTime Works</h2>
      <div class="help-section">
        <h3>Field &amp; bench</h3>
        <p>Drag a bench player onto the field to bring them on, or drag a field player off the field to bench them. Drag a player onto the goal to make them goalie. Drag one field player onto another to swap their positions.</p>
      </div>
      <div class="help-section">
        <h3>Queue changes for later</h3>
        <p>Tap a bench player then a field player to queue a substitution, or tap two field players to queue a position swap - handy for planning ahead of a stoppage. Tap either one again to un-queue it. Queued changes wait in a list until you tap Apply.</p>
      </div>
      <div class="help-section">
        <h3>Badges &amp; colors</h3>
        <div class="help-legend">
          <div class="help-legend-item">
            <div class="help-legend-token token-needs-sub"><div class="token-circle-wrap"><div class="token-circle">9</div></div></div>
            <p>Orange ring - this player has the most time on the field (time spent as goalie doesn't count) and is due for a sub next. The number of players highlighted always matches how many are free on the bench.</p>
          </div>
          <div class="help-legend-item">
            <div class="help-legend-token"><div class="token-circle-wrap"><div class="token-circle">4</div><span class="sub-badge">&#8646;</span></div></div>
            <p>Blue badge - this player is part of a queued substitution.</p>
          </div>
          <div class="help-legend-item">
            <div class="help-legend-token"><div class="token-circle-wrap"><div class="token-circle">7</div><span class="sub-badge sub-badge-swap">&#8646;</span></div></div>
            <p>Green badge - this player is part of a queued position swap with another field player.</p>
          </div>
        </div>
      </div>
      <div class="help-section">
        <h3>Settings</h3>
        <p>Once the match is live, use Settings to adjust the clock (say, if kickoff started early), mark a player unavailable or hurt, or add someone who arrives late.</p>
      </div>
      <button class="primary-btn big" id="help-close" type="button">Got it</button>
    </div>
  `;
  document.body.appendChild(modal);
  function close() { modal.remove(); }
  modal.querySelector('#help-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}

// The floating "?" button shown on the pre-game screens (team list, roster, start game) so help
// is reachable before there's a live match with its own Settings menu to hold it.
function attachHelpFab() {
  const fab = document.createElement('button');
  fab.className = 'help-fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Help');
  fab.textContent = '?';
  fab.addEventListener('click', () => showHelp());
  App.root.appendChild(fab);
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

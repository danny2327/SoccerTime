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
// Pass danger=true for destructive actions (delete, end game) - the confirm button goes red.
function showConfirm(message, confirmLabel, danger) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-card">
        <p class="confirm-message"></p>
        <div class="confirm-actions">
          <button class="secondary-btn" id="confirm-no" type="button">Cancel</button>
          <button class="${danger ? 'danger-btn' : 'primary-btn'}" id="confirm-yes" type="button"></button>
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

// In-app replacement for window.prompt() for a line of text - same card as showConfirm. Resolves
// to the trimmed text, or null if cancelled (an empty entry counts as cancelled).
function showTextPrompt(title, opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <form class="modal-card prompt-card">
        <h2></h2>
        <input type="text" class="prompt-input" maxlength="60">
        <div class="confirm-actions">
          <button class="secondary-btn" id="prompt-no" type="button">Cancel</button>
          <button class="primary-btn" id="prompt-yes" type="submit"></button>
        </div>
      </form>
    `;
    modal.querySelector('h2').textContent = title;
    const input = modal.querySelector('.prompt-input');
    input.value = o.value || '';
    input.placeholder = o.placeholder || '';
    const yes = modal.querySelector('#prompt-yes');
    yes.textContent = o.confirmLabel || 'OK';
    const sync = () => { yes.disabled = !input.value.trim(); };
    input.addEventListener('input', sync);
    sync();
    document.body.appendChild(modal);
    input.focus();

    function finish(result) {
      modal.remove();
      resolve(result);
    }
    modal.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value.trim()) finish(input.value.trim());
    });
    modal.querySelector('#prompt-no').addEventListener('click', () => finish(null));
    modal.addEventListener('click', (e) => { if (e.target === modal) finish(null); });
  });
}

// In-app replacement for window.prompt() for a number within a range - a -/+ stepper, so there's
// no keyboard and nothing out of range can be entered. Resolves to the number, or null if cancelled.
function showNumberPrompt(title, opts) {
  const o = opts || {};
  const min = o.min != null ? o.min : 0;
  const max = o.max != null ? o.max : 99;
  const step = o.step || 1;
  let value = clamp(o.value != null ? o.value : min, min, max);
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-card prompt-card">
        <h2></h2>
        <p class="panel-hint prompt-hint"></p>
        <div class="stepper prompt-stepper">
          <button class="stepper-btn" id="num-minus" type="button" aria-label="Decrease">&minus;</button>
          <span class="stepper-value" id="num-value"></span>
          <button class="stepper-btn" id="num-plus" type="button" aria-label="Increase">+</button>
        </div>
        <div class="confirm-actions">
          <button class="secondary-btn" id="num-no" type="button">Cancel</button>
          <button class="primary-btn" id="num-yes" type="button"></button>
        </div>
      </div>
    `;
    modal.querySelector('h2').textContent = title;
    const hint = modal.querySelector('.prompt-hint');
    if (o.hint) hint.textContent = o.hint; else hint.remove();
    modal.querySelector('#num-yes').textContent = o.confirmLabel || 'Save';
    const valueEl = modal.querySelector('#num-value');
    const minus = modal.querySelector('#num-minus');
    const plus = modal.querySelector('#num-plus');
    const draw = () => {
      valueEl.textContent = value;
      minus.disabled = value <= min;
      plus.disabled = value >= max;
    };
    minus.addEventListener('click', () => { value = clamp(value - step, min, max); draw(); });
    plus.addEventListener('click', () => { value = clamp(value + step, min, max); draw(); });
    draw();
    document.body.appendChild(modal);

    function finish(result) {
      modal.remove();
      resolve(result);
    }
    modal.querySelector('#num-yes').addEventListener('click', () => finish(value));
    modal.querySelector('#num-no').addEventListener('click', () => finish(null));
    modal.addEventListener('click', (e) => { if (e.target === modal) finish(null); });
  });
}

// Small inline line icons, shared across screens so every button draws in one consistent style
// (emoji render differently on every phone). Each inherits the surrounding text color.
const ICON_PATHS = {
  goal: '<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 4.5h-5L8 10z"/>',
  players: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 010 7"/><path d="M18 14.3c2.1.7 3.5 2.8 3.5 5.7"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9.5 2h5"/>',
  field: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/><circle cx="12" cy="12" r="3"/>',
  addPerson: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20c0-3.6 2.9-6 6.5-6 1.4 0 2.6.3 3.6.9"/><path d="M18 14v6"/><path d="M15 17h6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 014.6 1.3c0 1.7-2.1 2-2.1 3.4"/><path d="M12 17.2v.1"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 016.5 3H20v16H6.5A2.5 2.5 0 004 21.5z"/><path d="M4 21.5v-16"/><path d="M9 8h7"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6l8.5 7 8.5-7"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
};

function icon(name, size) {
  const s = size || 18;
  return `<svg class="icon" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

const MORE_ICON = '<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

const FEEDBACK_EMAIL = 'dstrood@gmail.com';

// The walkthrough itself. Built the same way as showConfirm - appended straight to document.body
// - so any screen can open it without needing its own dedicated modal container. The legend
// demos reuse the actual token/badge CSS classes rather than re-describing the colors in prose,
// so they can never drift from what the real tokens look like.
function showGuide() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-card help-card">
      <div class="panel-header help-card-header">
        <h2>How to Use SoccerTime</h2>
        <button class="panel-close-btn" id="help-close" type="button" aria-label="Close">${icon('close', 20)}</button>
      </div>
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
            <p>Orange ring - this player has the most time on the field (time spent as goalie doesn't count) and is due for a sub next. It highlights as many players as are free on the bench (more if several are tied), and none while everyone has played the same amount.</p>
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
        <h3>Players &amp; the menu</h3>
        <p>Players shows everyone's time on the field and by position, plus the goal log. Tap a player there to mark them out (hurt or unavailable) or remove them. The &#8943; menu adjusts the clock (say, if kickoff started early), changes how many are on the field, or adds someone who arrives late.</p>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  function close() { modal.remove(); }
  modal.querySelector('#help-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}

// A mailto link that opens the user's email app with a message to the developer already started -
// the version and device go in the body so every report says what it was running on.
function feedbackMailtoUrl() {
  const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  const subject = `SoccerTime feedback (${APP_VERSION})`;
  const body = `\n\n\n---\nSoccerTime ${APP_VERSION}${standalone ? ' (installed)' : ''}\n${navigator.userAgent}`;
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// The Help & feedback sheet - reached from the "?" button on the pre-game screens and from the
// game screen's menu. Two choices: the walkthrough, or an email to the developer.
function showHelpMenu() {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-card help-menu-card">
      <div class="panel-header">
        <h2>Help &amp; feedback</h2>
        <button class="panel-close-btn" data-close type="button" aria-label="Close">${icon('close', 20)}</button>
      </div>
      <button class="help-option" data-guide type="button">
        <span class="help-option-icon">${icon('book', 22)}</span>
        <span class="help-option-text">
          <span class="help-option-title">How to use SoccerTime</span>
          <span class="help-option-sub">Moving players, queuing subs and swaps, and what the colors mean</span>
        </span>
        ${icon('chevron', 16)}
      </button>
      <a class="help-option" data-feedback href="${escapeHtml(feedbackMailtoUrl())}">
        <span class="help-option-icon">${icon('mail', 22)}</span>
        <span class="help-option-text">
          <span class="help-option-title">Send feedback</span>
          <span class="help-option-sub">Report a bug or suggest an idea - opens your email app</span>
        </span>
        ${icon('chevron', 16)}
      </a>
      <div class="feedback-fallback" hidden>
        <span>No email app opened? Send it to <strong>${escapeHtml(FEEDBACK_EMAIL)}</strong></span>
        <button class="secondary-btn small" data-copy-email type="button">Copy</button>
      </div>
      <div class="help-menu-version">SoccerTime ${escapeHtml(APP_VERSION)}</div>
    </div>
  `;
  document.body.appendChild(modal);
  function close() { modal.remove(); }
  modal.querySelector('[data-close]').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('[data-guide]').addEventListener('click', () => { close(); showGuide(); });
  // A real link (not a scripted navigation) is what phones - installed iOS apps especially -
  // reliably hand off to the email app. The sheet stays open afterwards: a device with no email
  // app set up just does nothing, so the address is revealed with a Copy button as a fallback.
  modal.querySelector('[data-feedback]').addEventListener('click', () => {
    modal.querySelector('.feedback-fallback').hidden = false;
  });
  modal.querySelector('[data-copy-email]').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const done = () => { btn.textContent = 'Copied'; };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(FEEDBACK_EMAIL).then(done, () => fallbackCopy(FEEDBACK_EMAIL) && done());
    } else if (fallbackCopy(FEEDBACK_EMAIL)) {
      done();
    }
  });
}

// Clipboard for plain-http pages (e.g. the local dev server opened by IP), where
// navigator.clipboard isn't available.
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
  ta.remove();
  return ok;
}

// The header "?" button on the pre-game screens (team list, roster, start game), where there's
// no game menu to hold Help & feedback. helpButtonHtml goes in the header markup; wireHelpButton
// hooks it up once it's rendered.
function helpButtonHtml() {
  return `<button id="help-btn" class="icon-btn icon-only" type="button" aria-label="Help and feedback">${icon('help', 20)}</button>`;
}

function wireHelpButton() {
  const btn = App.root.querySelector('#help-btn');
  if (btn) btn.addEventListener('click', () => showHelpMenu());
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

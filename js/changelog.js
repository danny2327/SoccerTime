'use strict';

// The release history shown in "What's new" - newest first. Add an entry at the top for every
// release, with RELEASE_VERSION (js/version.js) bumped to match. `build` is the internal build
// number (APP_VERSION) the release shipped as - APP_VERSION still goes up with every change, so
// while a release is in progress keep its `build` in step with it, and it ends up recording the
// build that actually shipped.
const CHANGELOG = [
  {
    version: '1.0.1',
    build: 'v65',
    date: '2026-10-16',
    changes: [
      '<b>Game notes</b> - Menu &rsaquo; Notes, saved as you type. <b>+ Time</b> stamps the half and minute.',
      '<b>Game summaries</b> - tap a game in Season History to see its goals, everyone&rsquo;s playing time and positions, and your notes. <b>Edit</b> changes them.',
      '<b>Past games</b> - add notes to games already played. Games from before this update show what they have, and note that player times weren&rsquo;t recorded.',
      '<b>Season history in game</b> - now in the Menu during a game. The game keeps running, and back returns to it.',
      '<b>Menu button</b> - the &#8943; button is now a labelled Menu button.',
      '<b>What&rsquo;s new</b> - this list, under Help &amp; Feedback.',
    ],
  },
  {
    version: '1.0.0',
    build: 'v58',
    date: '2026-10-03',
    changes: [
      '<b>Playing time</b> - live field, bench and goalie time for every player, plus time in each position (ST, AM, DM, DEF).',
      '<b>Moving players</b> - drag to sub someone in, swap positions or change the goalie. Undo any move.',
      '<b>Planning subs</b> - tap to queue subs and swaps, then apply them all at once. Each change shows the position the player is going to.',
      '<b>Who&rsquo;s due</b> - an orange ring marks the players with the most time on. Bench players show where they last played.',
      '<b>Extra time</b> - the half clock keeps running past full time until you tap End Half.',
      '<b>Goals</b> - log scorers and assists, or mark a scorer unknown and fill it in later.',
      '<b>Teams</b> - team and opponent colours, a quick who&rsquo;s-here list before each game, and team settings.',
      '<b>Season history</b> - your record, a goals and assists leaderboard, and editable past games.',
      '<b>Help</b> - an illustrated how-to guide. Works offline once installed.',
    ],
  },
];

const LAST_SEEN_RELEASE_KEY = 'soccertime:lastSeenRelease:v1';

function formatReleaseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

// The changelog sheet. With `entries` it shows just those (the "since you last looked" pop-up);
// otherwise the full history. Same sticky-header sheet as the how-to guide.
function showChangelog(entries, title) {
  const list = entries || CHANGELOG;
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-card help-card changelog-card">
      <div class="panel-header help-card-header">
        <h2>${title || 'What&rsquo;s new'}</h2>
        <button class="panel-close-btn" data-close type="button" aria-label="Close">${icon('close', 20)}</button>
      </div>
      ${list.map((r) => `
        <section class="changelog-entry">
          <h3>${r.version} <span class="changelog-build">(${r.build})</span></h3>
          <p class="changelog-date">${formatReleaseDate(r.date)}</p>
          <ul>${r.changes.map((c) => `<li>${c}</li>`).join('')}</ul>
        </section>`).join('')}
      ${entries && entries.length < CHANGELOG.length ? '<button class="secondary-btn changelog-all" data-all type="button">See all updates</button>' : ''}
      <button class="primary-btn big changelog-done" data-close type="button">Got it</button>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  const all = modal.querySelector('[data-all]');
  if (all) all.addEventListener('click', () => { close(); showChangelog(); });
}

// Called on every screen change: the first time someone opens the app after an update, show what
// changed since the release they last saw. Never over a game in progress - it waits for the next
// non-game screen. Brand-new users (no teams yet) skip it - the welcome card covers them - and
// just get marked as up to date.
function maybeShowWhatsNew(onGameScreen) {
  let lastSeen = null;
  try { lastSeen = localStorage.getItem(LAST_SEEN_RELEASE_KEY); } catch (e) { return; }
  if (lastSeen === RELEASE_VERSION) return;
  if (onGameScreen) return;
  const markSeen = () => { try { localStorage.setItem(LAST_SEEN_RELEASE_KEY, RELEASE_VERSION); } catch (e) { /* ignore */ } };
  if (DB.loadTeams().length === 0) { markSeen(); return; }
  const seenIdx = CHANGELOG.findIndex((r) => r.version === lastSeen);
  // Unknown or missing last-seen (e.g. used the app before there was a changelog): just the latest.
  const fresh = seenIdx > 0 ? CHANGELOG.slice(0, seenIdx) : CHANGELOG.slice(0, 1);
  markSeen();
  showChangelog(fresh, `Updated to ${RELEASE_VERSION}`);
}

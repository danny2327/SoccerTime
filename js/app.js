'use strict';

const App = {
  root: null,
  _tick: null,
  _cleanup: null,

  init() {
    this.root = document.getElementById('app');
    window.addEventListener('hashchange', () => this.route());
    this.registerSW();
    this.setupInstallPrompt();
    this.route();
  },

  route() {
    if (this._tick) { clearInterval(this._tick); this._tick = null; }
    if (this._cleanup) { this._cleanup(); this._cleanup = null; }
    // Sheets opened with document.body.appendChild (confirms, prompts, help, colour pickers) live
    // outside App.root, so a screen change - e.g. the phone's back button while one is open -
    // wouldn't clear them. Drop any leftovers so they can't sit over the next screen.
    document.querySelectorAll('body > .modal').forEach((m) => m.remove());

    const hash = location.hash.slice(1) || '/teams';
    const parts = hash.split('/').filter(Boolean);

    // A game in progress always wins: relaunching the app, or backing out of the game screen,
    // lands straight back in it rather than on a screen where starting a new game would
    // overwrite it. Only End Game (which clears the session) leaves for good. Season history
    // and the dev seed route stay reachable.
    if (parts[0] !== 'game' && parts[0] !== 'season' && parts[0] !== 'seed-demo' && DB.loadSession()) {
      history.replaceState(null, '', '#/game');
      return Screens.gameSession();
    }

    if (parts[0] === 'team' && parts[1] && parts[2] === 'roster') return Screens.teamEdit(parts[1]);
    if (parts[0] === 'team' && parts[1]) return Screens.teamHome(parts[1]);
    if (parts[0] === 'start' && parts[1]) {
      history.replaceState(null, '', `#/team/${parts[1]}`);
      return Screens.teamHome(parts[1]);
    }
    if (parts[0] === 'game') return Screens.gameSession();
    if (parts[0] === 'season' && parts[1] && parts[2] === 'game' && parts[3]) return Screens.editGame(parts[1], parts[3]);
    if (parts[0] === 'season' && parts[1]) return Screens.seasonHistory(parts[1]);
    if (parts[0] === 'seed-demo') return Screens.seedDemo();
    return Screens.teamsList();
  },

  registerSW() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        // Browsers apply a special caching rule to the service worker script itself - once
        // fetched, they can go up to 24h without re-checking it at all, no matter what
        // Cache-Control the server sends on a *later* request. That decision is locked in by
        // the URL, so the only reliable way to force a same-day re-fetch is to make the URL
        // itself different: appending the app version turns an update into a brand new
        // registration instead of a "check if this exact URL changed" that a browser can skip.
        navigator.serviceWorker.register(`./service-worker.js?v=${APP_VERSION}`).catch(() => {});
      });
    }
  },

  setupInstallPrompt() {
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      const btn = document.getElementById('install-btn');
      if (btn) btn.hidden = false;
    });
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('#install-btn');
      if (btn && deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt = null;
        btn.hidden = true;
      }
    });
  },
};

// Team colours. Most are dark enough for white text; the light ones (yellow, white - for teams
// in those jerseys) get dark text instead, via textOn/colorStyle below. Light colours sit at the
// end so new teams and opponent defaults still start on the dark ones. A team without a colour
// yet (created before colours existed) shows the first one, the app's own green.
const TEAM_COLORS = ['#1b5e20', '#1f5fa8', '#b3261e', '#6a3fa0', '#0f766e', '#a84a0c', '#1e3a5f', '#7f1d3f', '#333a2e', '#f5c400', '#ffffff'];

// True for colours light enough that white text on them would be hard to read.
function isLightColor(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 170;
}

function textOn(hex) {
  return isLightColor(hex) ? '#16210f' : '#fff';
}

// Inline style for anything filled with a team colour and carrying text on top.
function colorStyle(hex) {
  return `background:${hex};color:${textOn(hex)}`;
}

function teamColor(team) {
  return TEAM_COLORS.includes(team.color) ? team.color : TEAM_COLORS[0];
}

// The first color no other team is using yet, so each new team starts out distinct.
function nextTeamColor(teams) {
  const used = new Set(teams.map(teamColor));
  return TEAM_COLORS.find((c) => !used.has(c)) || TEAM_COLORS[teams.length % TEAM_COLORS.length];
}

// The opponent's default colour: the first one that isn't the coach's own team colour, so the
// two sides never start out looking the same.
function defaultOpponentColor(team) {
  return TEAM_COLORS.find((c) => c !== teamColor(team));
}

function setTeamColor(teamId, color) {
  const teams = DB.loadTeams();
  const team = teams.find((t) => t.id === teamId);
  if (!team) return;
  team.color = color;
  DB.saveTeams(teams);
}

// A row of color swatches; tapping one selects it and reports it through onPick.
function renderColorSwatches(container, selected, onPick) {
  let current = selected;
  const draw = () => {
    container.innerHTML = TEAM_COLORS.map((c) => `
      <button type="button" class="color-swatch ${c === current ? 'selected' : ''} ${isLightColor(c) ? 'light' : ''}" data-color="${c}"
        style="${colorStyle(c)}" aria-label="Colour ${c}" aria-pressed="${c === current}">
        ${c === current ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${textOn(c)}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>` : ''}
      </button>`).join('');
    container.querySelectorAll('[data-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        current = btn.getAttribute('data-color');
        onPick(current);
        draw();
      });
    });
  };
  draw();
}

const DEMO_TEAM_NAME = 'Demo Team';
const DEMO_PLAYERS = [
  { number: '1', name: 'Gio Ortiz' },
  { number: '2', name: 'Mason Lee' },
  { number: '3', name: 'Casey Nguyen' },
  { number: '4', name: 'Riley Chen' },
  { number: '5', name: 'Sam Rivera' },
  { number: '6', name: 'Alex Kim' },
  { number: '7', name: 'Jordan Patel' },
  { number: '8', name: 'Taylor Brooks' },
  { number: '9', name: 'Morgan Diaz' },
  { number: '10', name: 'Avery Wilson' },
  { number: '11', name: 'Quinn Foster' },
  { number: '12', name: 'Reese Adams' },
  { number: '', name: 'Drew Park' }, // deliberately missing a jersey number
];

// Creates a 13-player demo team to try the app out with, replacing any earlier demo team
// ("Dummy Team" was its old name). Asks first when one already exists, unless skipConfirm.
async function createDemoTeam(skipConfirm) {
  const isDemo = (t) => t.name === DEMO_TEAM_NAME || t.name === 'Dummy Team';
  const all = DB.loadTeams();
  if (!skipConfirm && all.some(isDemo)) {
    const ok = await showConfirm('Replace the existing demo team with a fresh one?', 'Replace');
    if (!ok) return;
  }
  const teams = all.filter((t) => !isDemo(t));
  const team = {
    id: uid(),
    name: DEMO_TEAM_NAME,
    color: nextTeamColor(teams),
    players: DEMO_PLAYERS.map((p) => ({ id: uid(), name: p.name, number: p.number })),
  };
  teams.push(team);
  DB.saveTeams(teams);
  DB.saveSession(null);
  location.hash = `#/team/${team.id}`;
}

const Screens = {
  teamsList() {
    const teams = DB.loadTeams();
    App.root.innerHTML = `
      <header class="topbar">
        <h1>My Teams</h1>
        <button id="install-btn" class="icon-btn" hidden title="Install app">Install</button>
        ${helpButtonHtml()}
      </header>
      <main class="list-page teams-page">
        ${teams.length === 0 ? `<p class="empty">No teams yet. Add one to get started.</p>` : ''}
        <ul class="team-list">
          ${teams.map((t) => {
            const games = DB.loadGames(t.id);
            let w = 0, d = 0, l = 0;
            games.forEach((g) => {
              if (g.finalScore.us > g.finalScore.opponent) w++;
              else if (g.finalScore.us < g.finalScore.opponent) l++;
              else d++;
            });
            return `
              <li class="team-card" style="${colorStyle(teamColor(t))}">
                <a href="#/team/${t.id}" class="team-card-link">
                  <span class="team-card-name">${escapeHtml(t.name)}</span>
                  <span class="team-card-meta">
                    ${t.players.length} player${t.players.length === 1 ? '' : 's'}${games.length ? ` &middot; ${w}-${d}-${l}` : ''}
                  </span>
                </a>
                <button class="team-card-menu" data-team-menu="${t.id}" type="button" aria-label="Colour for ${escapeHtml(t.name)}">&#8942;</button>
              </li>`;
          }).join('')}
        </ul>
        <div class="teams-bottom">
          <button id="new-team-btn" class="primary-btn big" type="button">${icon('plus')} New Team</button>
          <button id="demo-team-btn" class="secondary-btn demo-team-btn" type="button">Load demo team</button>
          <p class="app-version-footer">SoccerTime ${escapeHtml(APP_VERSION)}</p>
        </div>
      </main>
    `;

    App.root.querySelector('#new-team-btn').addEventListener('click', async () => {
      const name = await showTextPrompt('New team', { placeholder: 'Team name', confirmLabel: 'Create' });
      if (!name) return;
      const allTeams = DB.loadTeams();
      const team = { id: uid(), name, color: nextTeamColor(allTeams), players: [] };
      allTeams.push(team);
      DB.saveTeams(allTeams);
      location.hash = `#/team/${team.id}`;
    });

    App.root.querySelector('#demo-team-btn').addEventListener('click', () => { createDemoTeam(); });

    // Per-team color picker (deleting a team lives in that team's own ... menu, away from here).
    App.root.querySelectorAll('[data-team-menu]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-team-menu');
        const t = DB.loadTeams().find((x) => x.id === id);
        if (!t) return;
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
          <div class="modal-card">
            <div class="panel-header">
              <h2>${escapeHtml(t.name)}</h2>
              <button class="panel-close-btn" data-close type="button" aria-label="Close">${icon('close', 20)}</button>
            </div>
            <h3 class="goal-edit-label">Team colour</h3>
            <div class="color-swatches"></div>
            <button class="primary-btn big" data-close type="button">Done</button>
          </div>
        `;
        document.body.appendChild(modal);
        const close = () => { modal.remove(); Screens.teamsList(); };
        renderColorSwatches(modal.querySelector('.color-swatches'), teamColor(t), (color) => setTeamColor(t.id, color));
        modal.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
      });
    });

    wireHelpButton();
  },

  // Dev/testing route: visiting #/seed-demo creates the demo team directly (the Teams screen's
  // "Load demo team" button does the same, with a confirm if one already exists).
  seedDemo() {
    createDemoTeam(true);
  },

  teamEdit(teamId) {
    const teams = DB.loadTeams();
    const team = teams.find((t) => t.id === teamId);
    if (!team) { location.hash = '#/teams'; return; }

    // The full roster editor (rename, renumber, delete, add), reached from the team home's menu.
    // An empty roster starts with the entry form open; otherwise it stays tucked behind the
    // Add player row. Persists across re-renders within this screen.
    let addFormOpen = team.players.length === 0;

    const render = () => {
      const sorted = sortedRoster(team.players);
      App.root.innerHTML = `
        <header class="topbar">
          <a href="#/team/${team.id}" class="back-link" aria-label="Back to ${escapeHtml(team.name)}">${icon('back', 22)}</a>
          <h1>${escapeHtml(team.name)} Roster</h1>
          ${helpButtonHtml()}
        </header>
        <main class="list-page">
          <ul class="player-list" id="player-list">
            ${sorted.map((p) => `
              <li class="player-row" data-player-id="${p.id}">
                <span class="jersey-badge ${p.number ? '' : 'no-number'}">${escapeHtml(p.number || '?')}</span>
                <span class="player-name">${escapeHtml(p.name)}</span>
                <button class="player-menu-btn" data-player-menu="${p.id}" type="button" aria-label="Player options">&#8942;</button>
              </li>`).join('')}
          </ul>
          ${team.players.length === 0 ? '<p class="empty">Add your first player below.</p>' : ''}
          <button id="add-player-toggle-btn" class="add-row-btn" type="button" ${addFormOpen ? 'hidden' : ''}>${icon('plus')} Add player</button>
          <form id="add-player-form" class="add-player-form" ${addFormOpen ? '' : 'hidden'}>
            <input type="text" id="new-number" placeholder="#" inputmode="numeric" pattern="[0-9]*" maxlength="3" class="number-input">
            <input type="text" id="new-name" placeholder="Player name" class="name-input" required>
            <button type="submit" class="primary-btn small">Add</button>
          </form>
          <a href="#/team/${team.id}" class="primary-btn big roster-done-btn">Done</a>
        </main>
        <div id="player-modal" class="modal" hidden></div>
      `;

      App.root.querySelector('#add-player-toggle-btn').addEventListener('click', (e) => {
        addFormOpen = true;
        e.currentTarget.hidden = true;
        App.root.querySelector('#add-player-form').hidden = false;
        App.root.querySelector('#new-number').focus();
      });

      const playerModal = App.root.querySelector('#player-modal');
      function closePlayerModal() { playerModal.hidden = true; playerModal.innerHTML = ''; }
      playerModal.addEventListener('click', (e) => { if (e.target === playerModal) closePlayerModal(); });

      function openEditForm(player) {
        playerModal.innerHTML = `
          <div class="modal-card">
            <h2>Edit Player</h2>
            <div class="add-player-form">
              <input type="text" id="edit-number" class="number-input" value="${escapeHtml(player.number || '')}"
                inputmode="numeric" pattern="[0-9]*" maxlength="3" placeholder="#">
              <input type="text" id="edit-name" class="name-input" value="${escapeHtml(player.name)}" placeholder="Player name">
            </div>
            <div class="confirm-actions">
              <button class="secondary-btn" id="edit-cancel" type="button">Cancel</button>
              <button class="primary-btn" id="edit-save" type="button">Save</button>
            </div>
          </div>
        `;
        playerModal.querySelector('#edit-cancel').addEventListener('click', closePlayerModal);
        playerModal.querySelector('#edit-save').addEventListener('click', () => {
          const name = playerModal.querySelector('#edit-name').value.trim();
          if (!name) return;
          player.name = name;
          player.number = playerModal.querySelector('#edit-number').value.trim();
          DB.saveTeams(teams);
          closePlayerModal();
          render();
        });
      }

      function openPlayerMenu(player) {
        playerModal.innerHTML = `
          <div class="modal-card">
            <h2>${escapeHtml(player.name)}</h2>
            <div class="goal-team-picker">
              <button class="secondary-btn" id="player-menu-edit" type="button">Edit</button>
              <button class="danger-btn big" id="player-menu-delete" type="button">Delete</button>
              <button class="secondary-btn" id="player-menu-cancel" type="button">Cancel</button>
            </div>
          </div>
        `;
        playerModal.querySelector('#player-menu-cancel').addEventListener('click', closePlayerModal);
        playerModal.querySelector('#player-menu-edit').addEventListener('click', () => openEditForm(player));
        playerModal.querySelector('#player-menu-delete').addEventListener('click', async () => {
          closePlayerModal();
          const confirmed = await showConfirm(`Delete ${player.name} from the roster? This can't be undone.`, 'Delete');
          if (!confirmed) return;
          team.players = team.players.filter((p) => p.id !== player.id);
          DB.saveTeams(teams);
          render();
        });
      }

      App.root.querySelectorAll('[data-player-menu]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const pid = btn.getAttribute('data-player-menu');
          const player = team.players.find((p) => p.id === pid);
          if (!player) return;
          playerModal.hidden = false;
          openPlayerMenu(player);
        });
      });

      App.root.querySelector('#add-player-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const numberInp = App.root.querySelector('#new-number');
        const nameInp = App.root.querySelector('#new-name');
        const name = nameInp.value.trim();
        if (!name) return;
        team.players.push({ id: uid(), name, number: numberInp.value.trim() });
        DB.saveTeams(teams);
        render();
      });

      wireHelpButton();
    };

    render();
  },

  seasonHistory(teamId) {
    const teams = DB.loadTeams();
    const team = teams.find((t) => t.id === teamId);
    if (!team) { location.hash = '#/teams'; return; }
    const rosterById = Object.fromEntries(team.players.map((p) => [p.id, p]));

    const games = DB.loadGames(teamId).slice().sort((a, b) => b.date - a.date);

    let wins = 0, draws = 0, losses = 0;
    games.forEach((g) => {
      if (g.finalScore.us > g.finalScore.opponent) wins++;
      else if (g.finalScore.us < g.finalScore.opponent) losses++;
      else draws++;
    });

    // Goals/assists across every game recorded so far, oldest to newest.
    const leaderboard = {};
    function statFor(id) {
      if (!leaderboard[id]) leaderboard[id] = { goals: 0, assists: 0 };
      return leaderboard[id];
    }
    games.forEach((g) => {
      (g.goals || []).filter((goal) => goal.team === 'us').forEach((goal) => {
        if (goal.scorerId) statFor(goal.scorerId).goals++;
        (goal.assistIds || []).forEach((id) => statFor(id).assists++);
      });
    });
    const leaderboardRows = Object.entries(leaderboard)
      .map(([id, stats]) => ({ id, name: rosterById[id] ? rosterById[id].name : '(removed)', ...stats }))
      .filter((row) => row.goals > 0 || row.assists > 0)
      .sort((a, b) => b.goals - a.goals || b.assists - a.assists);

    App.root.innerHTML = `
      <header class="topbar">
        <a href="#/team/${team.id}" class="back-link" aria-label="Back to ${escapeHtml(team.name)}">${icon('back', 22)}</a>
        <h1>Season History</h1>
      </header>
      <main class="list-page">
        ${games.length === 0 ? '<p class="empty">No games played yet.</p>' : `
          <p class="season-record">${wins}-${draws}-${losses} <span class="panel-hint">(W-D-L)</span></p>
          <h2 class="section-label">Games</h2>
          <ul class="player-list">
            ${games.map((g) => {
              const result = g.finalScore.us > g.finalScore.opponent ? 'W' : (g.finalScore.us < g.finalScore.opponent ? 'L' : 'D');
              return `
                <li class="player-row season-game-row">
                  <a href="#/season/${team.id}/game/${g.id}" class="season-game-link" aria-label="Edit game vs ${escapeHtml(g.opponentName || 'Opponent')}">
                    <span class="result-badge result-${result}">${result}</span>
                    <span class="season-game-info">
                      <span class="season-game-opponent">${g.opponentColor ? `<span class="team-dot" style="${colorStyle(g.opponentColor)}"></span>` : ''}${escapeHtml(g.opponentName || 'Opponent')}</span>
                      <span class="panel-hint">${g.date ? new Date(g.date).toLocaleDateString() : 'No date'}</span>
                    </span>
                    <span class="season-game-score">${g.finalScore.us}&ndash;${g.finalScore.opponent}</span>
                    <span class="season-game-chevron">${icon('chevron', 16)}</span>
                  </a>
                </li>`;
            }).join('')}
          </ul>
        `}
        ${leaderboardRows.length > 0 ? `
          <h2 class="section-label">Goals &amp; Assists</h2>
          <ul class="player-list">
            ${leaderboardRows.map((row) => `
              <li class="player-row season-leaderboard-row">
                <span class="player-name">${escapeHtml(row.name)}</span>
                <span class="player-stat-detail"><span class="stat-chip">${row.goals} G</span> <span class="stat-chip">${row.assists} A</span></span>
              </li>`).join('')}
          </ul>
        ` : ''}
      </main>
    `;
  },

  // Edit a finished game from the season: date, opponent, and the goal list. The score isn't
  // typed in directly - it's derived from the goals (scoreFromGoals), so adding, removing or
  // re-crediting a goal keeps the score and the season leaderboard in step. All edits go into a
  // draft copy and only reach storage on Save.
  editGame(teamId, gameId) {
    const teams = DB.loadTeams();
    const team = teams.find((t) => t.id === teamId);
    if (!team) { location.hash = '#/teams'; return; }
    const original = DB.loadGames(teamId).find((g) => g.id === gameId);
    if (!original) { location.hash = `#/season/${teamId}`; return; }
    const rosterById = Object.fromEntries(team.players.map((p) => [p.id, p]));

    const draft = JSON.parse(JSON.stringify(original));
    draft.goals = draft.goals || [];
    // A record whose score is ahead of its goal list (shouldn't happen, but cheap to guard) gets
    // unknown goals padded in, so deriving the score from goals never silently lowers it.
    const saved = draft.finalScore || { us: 0, opponent: 0 };
    const counted = scoreFromGoals(draft.goals);
    for (let i = counted.us; i < saved.us; i++) draft.goals.push({ id: uid(), team: 'us', half: null, at: null, scorerId: null, assistIds: [] });
    for (let i = counted.opponent; i < saved.opponent; i++) draft.goals.push({ id: uid(), team: 'opponent', half: null, at: null });
    const startingJson = JSON.stringify(draft);

    const toDateInput = (ts) => {
      if (!ts) return '';
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const playerName = (id) => (rosterById[id] ? rosterById[id].name : '(removed player)');

    App.root.innerHTML = `
      <header class="topbar">
        <a href="#/season/${team.id}" class="back-link" id="eg-back" aria-label="Back to season">${icon('back', 22)}</a>
        <h1>Edit Game</h1>
      </header>
      <main class="list-page">
        <section class="field-count-picker">
          <label for="eg-date">Date</label>
          <input type="date" id="eg-date" class="opponent-input" value="${toDateInput(draft.date)}">
        </section>
        <section class="opponent-card">
          <div class="opponent-row">
            <label for="eg-opponent">Opponent</label>
            <input type="text" id="eg-opponent" class="opponent-input" placeholder="Opponent name" value="${escapeHtml(draft.opponentName || '')}">
          </div>
          <div class="color-swatches compact" id="eg-opponent-colors" aria-label="Opponent colour"></div>
        </section>
        <div class="edit-score" id="eg-score"></div>
        <h2 class="section-label">${escapeHtml(team.name)} goals</h2>
        <ul class="player-list" id="eg-goals"></ul>
        <button id="eg-add-goal" class="add-row-btn" type="button">${icon('plus')} Add goal</button>
        <h2 class="section-label">Opponent goals</h2>
        <section class="field-count-picker">
          <label>Goals conceded</label>
          <div class="stepper">
            <button id="eg-opp-minus" class="stepper-btn" type="button" aria-label="Remove opponent goal">&minus;</button>
            <span id="eg-opp-value" class="stepper-value"></span>
            <button id="eg-opp-plus" class="stepper-btn" type="button" aria-label="Add opponent goal">+</button>
          </div>
        </section>
        <div class="confirm-actions edit-game-actions">
          <button class="secondary-btn" id="eg-cancel" type="button">Cancel</button>
          <button class="primary-btn" id="eg-save" type="button">Save</button>
        </div>
      </main>
      <div id="eg-goal-modal" class="modal" hidden></div>
    `;

    const goalsList = App.root.querySelector('#eg-goals');
    const goalModal = App.root.querySelector('#eg-goal-modal');

    function render() {
      const score = scoreFromGoals(draft.goals);
      const opp = App.root.querySelector('#eg-opponent').value.trim() || 'Opponent';
      App.root.querySelector('#eg-score').innerHTML = `
        <span class="score-team-name team-pill" style="${colorStyle(teamColor(team))}">${escapeHtml(team.name)}</span>
        <span class="edit-score-value">${score.us} &ndash; ${score.opponent}</span>
        <span class="score-team-name team-pill" style="${colorStyle(draft.opponentColor || 'transparent')}">${escapeHtml(opp)}</span>`;
      App.root.querySelector('#eg-opp-value').textContent = score.opponent;

      const ours = draft.goals.filter((g) => g.team === 'us');
      goalsList.innerHTML = ours.length === 0
        ? '<li class="empty edit-goals-empty">No goals</li>'
        : ours.map((g) => {
            const assists = (g.assistIds || []).map(playerName);
            const label = g.scorerId
              ? escapeHtml(playerName(g.scorerId))
              : '<span class="goal-unknown">Unknown scorer</span>';
            return `
              <li class="player-row goal-log-row">
                <span class="goal-log-half">${g.half ? `H${g.half}` : '&ndash;'}</span>
                <span class="goal-log-label">${label}${assists.length ? ` <span class="goal-assist">(assist: ${escapeHtml(assists.join(', '))})</span>` : ''}</span>
                <button class="secondary-btn small" data-edit-goal="${g.id}" type="button">Edit</button>
                <button class="danger-btn small" data-remove-goal="${g.id}" type="button" aria-label="Remove goal">&times;</button>
              </li>`;
          }).join('');

      goalsList.querySelectorAll('[data-edit-goal]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const goal = draft.goals.find((g) => g.id === btn.getAttribute('data-edit-goal'));
          if (goal) openGoalEditor(goal);
        });
      });
      goalsList.querySelectorAll('[data-remove-goal]').forEach((btn) => {
        btn.addEventListener('click', () => {
          draft.goals = draft.goals.filter((g) => g.id !== btn.getAttribute('data-remove-goal'));
          render();
        });
      });
    }

    // One form for a goal - half, scorer and up to 2 assists - used for both editing an existing
    // goal and adding a new one (goal === null). Unlike the live game's step-by-step picker, a
    // past game is edited at leisure, so everything sits on one card.
    function openGoalEditor(goal) {
      const isNew = !goal;
      const state = {
        half: goal ? goal.half : 1,
        scorerId: goal ? goal.scorerId : null,
        assistIds: goal ? (goal.assistIds || []).slice() : [],
      };
      // Anyone already credited on this goal stays pickable even if they've since left the roster.
      const pickable = sortedRoster(team.players);
      [state.scorerId, ...state.assistIds].filter((id) => id && !rosterById[id])
        .forEach((id) => pickable.push({ id, name: '(removed player)', number: '' }));

      function close() { goalModal.hidden = true; goalModal.innerHTML = ''; }

      function draw() {
        const assistChoices = pickable.filter((p) => p.id !== state.scorerId);
        goalModal.innerHTML = `
          <div class="modal-card">
            <h2>${isNew ? 'Add goal' : 'Edit goal'}</h2>
            <div class="goal-edit-field">
              <span class="goal-edit-label">Half</span>
              <div class="segmented">
                ${[1, 2].map((h) => `<button type="button" class="segmented-btn ${state.half === h ? 'selected' : ''}" data-half="${h}">H${h}</button>`).join('')}
              </div>
            </div>
            <div class="goal-edit-field">
              <label class="goal-edit-label" for="ge-scorer">Scorer</label>
              <select id="ge-scorer" class="goal-edit-select">
                <option value="">Unknown scorer</option>
                ${pickable.map((p) => `<option value="${p.id}" ${p.id === state.scorerId ? 'selected' : ''}>${p.number ? `#${escapeHtml(p.number)} ` : ''}${escapeHtml(p.name)}</option>`).join('')}
              </select>
            </div>
            ${state.scorerId ? `
              <h3 class="goal-edit-label">Assists <span class="panel-hint">(up to 2)</span></h3>
              <ul class="player-list goal-edit-assists">
                ${assistChoices.map((p) => `
                  <li class="player-row selectable">
                    <label class="select-row">
                      <input type="checkbox" class="assist-check" value="${p.id}" ${state.assistIds.includes(p.id) ? 'checked' : ''}
                        ${!state.assistIds.includes(p.id) && state.assistIds.length >= 2 ? 'disabled' : ''}>
                      <span class="jersey-badge ${p.number ? '' : 'no-number'}">${escapeHtml(p.number || '?')}</span>
                      <span class="player-name">${escapeHtml(p.name)}</span>
                    </label>
                  </li>`).join('')}
              </ul>` : ''}
            <div class="confirm-actions">
              <button class="secondary-btn" id="ge-cancel" type="button">Cancel</button>
              <button class="primary-btn" id="ge-save" type="button">${isNew ? 'Add' : 'Done'}</button>
            </div>
          </div>
        `;
        goalModal.querySelectorAll('[data-half]').forEach((btn) => {
          btn.addEventListener('click', () => { state.half = Number(btn.getAttribute('data-half')); draw(); });
        });
        goalModal.querySelector('#ge-scorer').addEventListener('change', (e) => {
          state.scorerId = e.target.value || null;
          state.assistIds = state.assistIds.filter((id) => id !== state.scorerId);
          if (!state.scorerId) state.assistIds = [];
          draw();
        });
        goalModal.querySelectorAll('.assist-check').forEach((c) => {
          c.addEventListener('change', () => {
            state.assistIds = c.checked
              ? [...state.assistIds, c.value].slice(0, 2)
              : state.assistIds.filter((id) => id !== c.value);
            draw();
          });
        });
        goalModal.querySelector('#ge-cancel').addEventListener('click', close);
        goalModal.querySelector('#ge-save').addEventListener('click', () => {
          if (isNew) {
            draft.goals.push({ id: uid(), team: 'us', half: state.half, at: null, scorerId: state.scorerId, assistIds: state.assistIds });
          } else {
            goal.half = state.half;
            goal.scorerId = state.scorerId;
            goal.assistIds = state.assistIds;
          }
          close();
          render();
        });
      }

      goalModal.hidden = false;
      draw();
    }
    goalModal.addEventListener('click', (e) => { if (e.target === goalModal) { goalModal.hidden = true; goalModal.innerHTML = ''; } });

    App.root.querySelector('#eg-add-goal').addEventListener('click', () => openGoalEditor(null));
    renderColorSwatches(App.root.querySelector('#eg-opponent-colors'), draft.opponentColor || null, (color) => {
      draft.opponentColor = color;
      render();
    });
    App.root.querySelector('#eg-opponent').addEventListener('input', () => render());

    App.root.querySelector('#eg-opp-plus').addEventListener('click', () => {
      draft.goals.push({ id: uid(), team: 'opponent', half: null, at: null });
      render();
    });
    App.root.querySelector('#eg-opp-minus').addEventListener('click', () => {
      const lastIdx = draft.goals.map((g) => g.team).lastIndexOf('opponent');
      if (lastIdx === -1) return;
      draft.goals.splice(lastIdx, 1);
      render();
    });

    // Pulls the two plain fields into the draft. The date keeps the game's original time of day
    // (or noon, for a record that never had one) so re-saving doesn't shift it across midnight.
    function syncFields() {
      draft.opponentName = App.root.querySelector('#eg-opponent').value.trim();
      const dateVal = App.root.querySelector('#eg-date').value;
      if (dateVal) {
        const [y, m, d] = dateVal.split('-').map(Number);
        const base = draft.date ? new Date(draft.date) : new Date(y, m - 1, d, 12);
        base.setFullYear(y, m - 1, d);
        draft.date = base.getTime();
      }
    }

    async function leave() {
      syncFields();
      if (JSON.stringify(draft) !== startingJson) {
        const discard = await showConfirm('Discard your changes to this game?', 'Discard');
        if (!discard) return;
      }
      location.hash = `#/season/${team.id}`;
    }

    App.root.querySelector('#eg-back').addEventListener('click', (e) => { e.preventDefault(); leave(); });
    App.root.querySelector('#eg-cancel').addEventListener('click', () => leave());
    App.root.querySelector('#eg-save').addEventListener('click', () => {
      syncFields();
      draft.finalScore = scoreFromGoals(draft.goals);
      DB.updateGame(team.id, draft);
      showToast('Game saved');
      location.hash = `#/season/${team.id}`;
    });

    render();
  },

  // A team's home screen, where picking a team lands: who's here today, the opponent, and Begin
  // Game. Things that rarely change live behind the ... menu instead - the full roster editor,
  // and team settings (players on field, half length), which are also summarised in one tappable
  // line so the coach can see what the game will use without them taking up the screen.
  teamHome(teamId) {
    const teams = DB.loadTeams();
    const team = teams.find((t) => t.id === teamId);
    if (!team) { location.hash = '#/teams'; return; }

    // Players ticked off as absent, and the typed opponent - both kept across re-renders (adding a
    // player, changing settings) so nothing the coach already entered gets reset.
    const absentIds = new Set();
    let opponentName = '';
    let opponentColor = null; // null until picked - falls back to defaultOpponentColor
    const returned = App._returnState && App._returnState.teamId === teamId ? App._returnState : null;
    App._returnState = null;
    if (returned) {
      opponentName = returned.opponentName;
      opponentColor = returned.opponentColor || null;
      team.players.forEach((p) => { if (!returned.presentIds.includes(p.id)) absentIds.add(p.id); });
    }
    let addFormOpen = team.players.length === 0;

    function render() {
      const settings = DB.loadTeamSettings(teamId);
      const fieldCount = clamp(settings.fieldCount || 7, 3, 15);
      const halfLength = clamp(settings.halfLengthMinutes || 25, 5, 60);
      const sorted = sortedRoster(team.players);
      const presentCount = sorted.filter((p) => !absentIds.has(p.id)).length;

      App.root.innerHTML = `
        <header class="topbar has-menu">
          <a href="#/teams" class="back-link" aria-label="Back to teams">${icon('back', 22)}</a>
          <h1>${escapeHtml(team.name)}</h1>
          <a href="#/season/${team.id}" class="icon-btn">${icon('calendar')} Season</a>
          <button id="team-menu-btn" class="icon-btn icon-only" type="button" aria-label="Team menu" aria-haspopup="true">${MORE_ICON}</button>
          <div id="team-menu" class="menu-layer" hidden>
            <div class="menu-backdrop"></div>
            <div id="team-menu-card" class="settings-dropdown">
              <a href="#/team/${team.id}/roster" class="settings-item">${icon('players', 20)} Edit roster</a>
              <button id="team-settings-btn" class="settings-item" type="button">${icon('field', 20)} Team settings</button>
              <div class="menu-divider"></div>
              <button id="team-help-btn" class="settings-item" type="button">${icon('help', 20)} Help &amp; feedback</button>
              <div class="menu-divider"></div>
              <button id="team-delete-btn" class="settings-item settings-item-danger" type="button">${icon('trash', 20)} Delete team</button>
              <div class="settings-version">${escapeHtml(APP_VERSION)}</div>
            </div>
          </div>
        </header>
        <main class="list-page">
          <button id="settings-summary" class="settings-summary" type="button">
            ${icon('field')} <span>${fieldCount} on field &middot; ${halfLength} min halves</span>
            <span class="settings-summary-edit">Change</span>
          </button>
          <section class="opponent-card">
            <div class="opponent-row">
              <label for="opponent-name">Opponent<span class="field-count-sublabel">Optional - shown on the scoreboard</span></label>
              <input type="text" id="opponent-name" class="opponent-input" placeholder="Opponent name" value="${escapeHtml(opponentName)}">
            </div>
            <div class="color-swatches compact" id="opponent-colors" aria-label="Opponent colour"></div>
          </section>
          <h2 class="section-label section-label-row">
            <span>Who's here today?</span>
            ${sorted.length ? `<span class="section-count">${presentCount} of ${sorted.length}</span>` : ''}
          </h2>
          <ul class="player-list select-list" id="present-list">
            ${sorted.map((p) => `
              <li class="player-row selectable">
                <label class="select-row">
                  <input type="checkbox" class="present-check" value="${p.id}" ${absentIds.has(p.id) ? '' : 'checked'}>
                  <span class="jersey-badge ${p.number ? '' : 'no-number'}">${escapeHtml(p.number || '?')}</span>
                  <span class="player-name">${escapeHtml(p.name)}</span>
                </label>
              </li>`).join('')}
          </ul>
          ${team.players.length === 0 ? '<p class="empty">No players yet - add your roster below.</p>' : ''}
          <button id="add-player-toggle-btn" class="add-row-btn" type="button" ${addFormOpen ? 'hidden' : ''}>${icon('plus')} Add player</button>
          <form id="add-player-form" class="add-player-form" ${addFormOpen ? '' : 'hidden'}>
            <input type="text" id="new-number" placeholder="#" inputmode="numeric" pattern="[0-9]*" maxlength="3" class="number-input">
            <input type="text" id="new-name" placeholder="Player name" class="name-input" required>
            <button type="submit" class="primary-btn small">Add</button>
          </form>
          <button id="begin-btn" class="primary-btn big" type="button" ${presentCount === 0 ? 'disabled' : ''}>Begin Game &rarr;</button>
        </main>
        <div id="team-settings-modal" class="modal" hidden></div>
      `;

      // --- ... menu ---
      const menu = App.root.querySelector('#team-menu');
      const menuCard = App.root.querySelector('#team-menu-card');
      App.root.querySelector('#team-menu-btn').addEventListener('click', () => { menu.hidden = !menu.hidden; });
      menu.addEventListener('click', (e) => {
        if (!menuCard.contains(e.target) || e.target.closest('.settings-item')) menu.hidden = true;
      });
      App.root.querySelector('#team-help-btn').addEventListener('click', () => showHelpMenu());
      App.root.querySelector('#team-delete-btn').addEventListener('click', async () => {
        const games = DB.loadGames(team.id).length;
        const msg = `Delete "${team.name}", its roster${games ? ` and ${games} game${games === 1 ? '' : 's'} of season history` : ''}? This can't be undone.`;
        if (!await showConfirm(msg, 'Delete', true)) return;
        DB.saveTeams(DB.loadTeams().filter((x) => x.id !== team.id));
        DB.deleteGames(team.id);
        location.hash = '#/teams';
      });
      App.root.querySelector('#team-settings-btn').addEventListener('click', () => openTeamSettings());
      App.root.querySelector('#settings-summary').addEventListener('click', () => openTeamSettings());

      // --- Who's here ---
      App.root.querySelector('#opponent-name').addEventListener('input', (e) => { opponentName = e.target.value; });
      renderColorSwatches(App.root.querySelector('#opponent-colors'), opponentColor || defaultOpponentColor(team), (color) => {
        opponentColor = color;
      });
      App.root.querySelectorAll('.present-check').forEach((c) => {
        c.addEventListener('change', () => {
          if (c.checked) absentIds.delete(c.value); else absentIds.add(c.value);
          const count = sorted.filter((p) => !absentIds.has(p.id)).length;
          const countEl = App.root.querySelector('.section-count');
          if (countEl) countEl.textContent = `${count} of ${sorted.length}`;
          App.root.querySelector('#begin-btn').disabled = count === 0;
        });
      });

      // --- Quick add: a new player joins the roster and is marked as here ---
      App.root.querySelector('#add-player-toggle-btn').addEventListener('click', (e) => {
        addFormOpen = true;
        e.currentTarget.hidden = true;
        App.root.querySelector('#add-player-form').hidden = false;
        App.root.querySelector('#new-number').focus();
      });
      App.root.querySelector('#add-player-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = App.root.querySelector('#new-name').value.trim();
        if (!name) return;
        team.players.push({ id: uid(), name, number: App.root.querySelector('#new-number').value.trim() });
        DB.saveTeams(teams);
        render();
        App.root.querySelector('#new-number').focus();
      });

      App.root.querySelector('#begin-btn').addEventListener('click', () => {
        const presentIds = sorted.filter((p) => !absentIds.has(p.id)).map((p) => p.id);
        if (presentIds.length === 0) return;
        startSession(team, presentIds, fieldCount, halfLength, opponentName.trim(), opponentColor || defaultOpponentColor(team));
        location.hash = '#/game';
      });
    }

    // Team settings: the two per-team game defaults, saved as they're changed.
    function openTeamSettings() {
      const modal = App.root.querySelector('#team-settings-modal');
      const settings = DB.loadTeamSettings(teamId);
      let fieldCount = clamp(settings.fieldCount || 7, 3, 15);
      let halfLength = clamp(settings.halfLengthMinutes || 25, 5, 60);
      modal.innerHTML = `
        <div class="modal-card">
          <div class="panel-header">
            <h2>Team settings</h2>
            <button class="panel-close-btn" data-close type="button" aria-label="Close">${icon('close', 20)}</button>
          </div>
          <section class="field-count-picker">
            <label>Players on field<span class="field-count-sublabel">Total, including the goalie (e.g. 7v7 &rarr; 7)</span></label>
            <div class="stepper">
              <button id="fc-minus" class="stepper-btn" type="button" aria-label="Fewer players">&minus;</button>
              <span id="fc-value" class="stepper-value">${fieldCount}</span>
              <button id="fc-plus" class="stepper-btn" type="button" aria-label="More players">+</button>
            </div>
          </section>
          <section class="field-count-picker">
            <label>Half length<span class="field-count-sublabel">Minutes per half</span></label>
            <div class="stepper">
              <button id="hl-minus" class="stepper-btn" type="button" aria-label="Shorter halves">&minus;</button>
              <span id="hl-value" class="stepper-value">${halfLength}</span>
              <button id="hl-plus" class="stepper-btn" type="button" aria-label="Longer halves">+</button>
            </div>
          </section>
          <h3 class="goal-edit-label team-settings-color-label">Team colour</h3>
          <div class="color-swatches"></div>
          <button class="primary-btn big" data-close type="button">Done</button>
        </div>
      `;
      renderColorSwatches(modal.querySelector('.color-swatches'), teamColor(team), (color) => {
        team.color = color;
        setTeamColor(team.id, color);
      });
      modal.hidden = false;
      const close = () => { modal.hidden = true; modal.innerHTML = ''; render(); };
      modal.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
      modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
      const updateFC = (delta) => {
        fieldCount = clamp(fieldCount + delta, 3, 15);
        modal.querySelector('#fc-value').textContent = fieldCount;
        DB.saveTeamSettings(teamId, { fieldCount });
      };
      const updateHL = (delta) => {
        halfLength = clamp(halfLength + delta, 5, 60);
        modal.querySelector('#hl-value').textContent = halfLength;
        DB.saveTeamSettings(teamId, { halfLengthMinutes: halfLength });
      };
      modal.querySelector('#fc-minus').addEventListener('click', () => updateFC(-1));
      modal.querySelector('#fc-plus').addEventListener('click', () => updateFC(1));
      modal.querySelector('#hl-minus').addEventListener('click', () => updateHL(-5));
      modal.querySelector('#hl-plus').addEventListener('click', () => updateHL(5));
    }

    render();
  },

  gameSession() {
    const session = DB.loadSession();
    if (!session) { location.hash = '#/teams'; return; }
    const teams = DB.loadTeams();
    const team = teams.find((t) => t.id === session.teamId);
    if (!team) { DB.saveSession(null); location.hash = '#/teams'; return; }
    const rosterById = Object.fromEntries(team.players.map((p) => [p.id, p]));

    // Backfills for any session saved before goal/score tracking existed.
    if (!session.score) session.score = { us: 0, opponent: 0 };
    if (!session.goals) session.goals = [];
    if (session.opponentName == null) session.opponentName = '';
    if (!session.subQueue) session.subQueue = [];

    // A session already sitting past the last half (e.g. saved before this cap existed) has no
    // game screen to show - there's no half beyond TOTAL_HALVES to kick off, so finish it now.
    if (!session.live && (session.half || 1) > TOTAL_HALVES) {
      DB.appendGame(team.id, buildGameRecord(session));
      DB.saveSession(null);
      location.hash = `#/team/${team.id}`;
      return;
    }

    const half = session.half || 1;

    function halfClockLabel(now) {
      const label = `H${session.half || 1}`;
      if (!session.live || !session.halfStartedAt || !session.halfLengthMinutes) return label;
      const halfEndsAt = session.halfStartedAt + session.halfLengthMinutes * 60 * 1000;
      const remaining = Math.max(0, Math.round((halfEndsAt - now) / 1000));
      return `${label} · ${formatDuration(remaining)}`;
    }

    function totalOnField() {
      return Object.values(session.players).filter((p) => p.status === 'field').length;
    }

    function outfieldCount() {
      return Object.values(session.players).filter((p) => p.status === 'field' && !p.isGoalie).length;
    }

    // Used by anything that needs a full re-render of this screen (kickoff, half boundary,
    // changing field count) without going through the router - so it must do the router's
    // teardown itself (stop the tick, undo this screen's own listeners) before re-entering.
    function reloadGameScreen() {
      if (App._tick) { clearInterval(App._tick); App._tick = null; }
      if (App._cleanup) { App._cleanup(); App._cleanup = null; }
      Screens.gameSession();
    }

    // Shared by the manual "End Game" action and the automatic full-time finish below - files
    // the session away into the team's season history and drops the coach back on the team page.
    // Until the first kickoff nothing has been played, so backing out just throws the setup away
    // and returns to the team screen - with the same opponent and who's-here picks filled back
    // in (via App._returnState), so the coach can adjust and Begin Game again.
    const preKickoff = !session.kickoffAt;
    function cancelSetup() {
      App._returnState = {
        teamId: team.id,
        opponentName: session.opponentName || '',
        opponentColor: session.opponentColor || null,
        presentIds: Object.keys(session.players),
      };
      DB.saveSession(null);
      location.hash = `#/team/${team.id}`;
    }

    function finishGame() {
      DB.appendGame(team.id, buildGameRecord(session));
      DB.saveSession(null);
      location.hash = `#/team/${team.id}`;
    }

    App.root.innerHTML = `
      <header class="topbar game-header">
        ${preKickoff ? `<button id="cancel-setup-btn" class="back-link" type="button" aria-label="Back to ${escapeHtml(team.name)}">${icon('back', 22)}</button>` : ''}
        <button id="goal-btn" class="icon-btn goal-btn" type="button" ${session.live ? '' : 'disabled'}>${icon('goal')} Goal</button>
        <div class="header-center">
          ${session.live ? `<span id="half-clock" class="half-clock">${halfClockLabel(Date.now())}</span>` : ''}
        </div>
        <button id="info-panel-btn" class="icon-btn" type="button">${icon('players')}<span class="btn-label">Players</span></button>
        <button id="settings-btn" class="icon-btn icon-only" type="button" aria-label="Menu" aria-haspopup="true">${MORE_ICON}</button>
        <div id="settings-menu" class="menu-layer" hidden>
          <div class="menu-backdrop"></div>
          <div id="settings-dropdown" class="settings-dropdown">
            <div class="menu-label">Game</div>
            ${session.live ? `<button id="adjust-clock-btn" class="settings-item" type="button">${icon('clock', 20)} Adjust clock</button>` : ''}
            <button id="fc-edit-btn" class="settings-item" type="button">${icon('field', 20)} Players on field <span class="menu-value">${session.fieldCount} ${icon('chevron', 14)}</span></button>
            <div class="menu-label">Roster</div>
            <button id="add-late-btn" class="settings-item" type="button">${icon('addPerson', 20)} Add late player</button>
            <div class="menu-divider"></div>
            <button id="help-btn" class="settings-item" type="button">${icon('help', 20)} Help &amp; feedback</button>
            <div class="menu-divider"></div>
            <button id="end-game-btn" class="settings-item settings-item-danger" type="button">${icon('flag', 20)} End game</button>
            <div class="settings-version">${escapeHtml(APP_VERSION)}</div>
          </div>
        </div>
      </header>
      <div class="scoreboard" id="scoreboard"></div>
      <div id="kickoff-container"></div>
      <div id="sub-queue-container"></div>
      <main class="game-main">
        <div class="bench-strip" id="bench-strip"></div>
        <div class="field-wrap" id="field-wrap">
          ${FieldSVG.markup()}
          <div class="goal-zone-highlight" id="goal-zone-highlight" style="left:${FieldLayout.GOAL_ZONE.xMin}%; width:${FieldLayout.GOAL_ZONE.xMax - FieldLayout.GOAL_ZONE.xMin}%; top:${FieldLayout.GOAL_ZONE.yMin}%; height:${100 - FieldLayout.GOAL_ZONE.yMin}%;"></div>
          <div class="tokens-layer" id="tokens-layer"></div>
        </div>
        <div id="undo-banner" class="undo-banner" hidden></div>
        <div id="field-warning" class="field-warning" hidden></div>
      </main>
      <div id="late-modal" class="modal" hidden></div>
      <div id="goal-modal" class="modal" hidden></div>
      <div id="clock-modal" class="modal" hidden></div>
      <div id="info-panel" class="modal" hidden>
        <div class="modal-card">
          <div class="panel-header">
            <h2>Players</h2>
            <button id="info-panel-close" class="panel-close-btn" type="button" aria-label="Close">${icon('close', 20)}</button>
          </div>
          <section class="panel-section">
            <h3>Time by position</h3>
            <p class="panel-hint">ST = striker · AM = attacking mid · DM = defensive mid · DEF = defence</p>
            <div id="info-panel-content"></div>
          </section>
          <section class="panel-section">
            <h3>Goals</h3>
            <div id="goal-log-content"></div>
          </section>
        </div>
      </div>
    `;

    const tokensLayer = App.root.querySelector('#tokens-layer');
    const benchStrip = App.root.querySelector('#bench-strip');
    const fieldWrap = App.root.querySelector('#field-wrap');
    const goalZoneEl = App.root.querySelector('#goal-zone-highlight');
    const kickoffContainer = App.root.querySelector('#kickoff-container');
    const subQueueContainer = App.root.querySelector('#sub-queue-container');
    const scoreboard = App.root.querySelector('#scoreboard');

    function renderScoreboard() {
      scoreboard.innerHTML = `
        <span class="score-team-name team-pill" style="${colorStyle(teamColor(team))}">${escapeHtml(team.name)}</span>
        <span class="score-value">${session.score.us}</span>
        <span class="score-sep">&ndash;</span>
        <span class="score-value">${session.score.opponent}</span>
        <span class="score-team-name team-pill" style="${colorStyle(session.opponentColor || defaultOpponentColor(team))}">${escapeHtml(session.opponentName || 'Opponent')}</span>
      `;
    }

    // Re-rendered on every drag (not just full-screen reloads), since who's on the field - and
    // therefore whether kickoff is allowed - can change with any drag.
    function renderKickoffBar() {
      if (session.live) { kickoffContainer.innerHTML = ''; return; }
      const total = totalOnField();
      const label = (session.half || 1) > 1 ? `Start Half ${session.half}` : 'Kick Off';
      if (total === session.fieldCount) {
        kickoffContainer.innerHTML = `<button id="kickoff-btn" class="kickoff-bar" type="button">&#9654; ${label}</button>`;
        kickoffContainer.querySelector('#kickoff-btn').addEventListener('click', () => {
          kickoff(session);
          DB.saveSession(session);
          reloadGameScreen();
        });
      } else {
        const verb = (session.half || 1) > 1 ? `start half ${session.half}` : 'kick off';
        kickoffContainer.innerHTML = `<button class="kickoff-bar kickoff-bar-disabled" type="button" disabled>Need ${session.fieldCount} on field to ${verb} (have ${total})</button>`;
      }
    }

    // Re-rendered alongside the kickoff bar for the same reason - who's queued (and against
    // whom) can change on every tap, not just full-screen reloads.
    function renderSubQueue() {
      const queue = session.subQueue || [];
      if (queue.length === 0) { subQueueContainer.innerHTML = ''; return; }
      const isSwapPair = (pair) => (session.players[pair.offId] || {}).status === 'field'
        && (session.players[pair.onId] || {}).status === 'field';
      // Subs first, swaps pushed to the bottom - easier to call out who's actually coming off/on
      // at a glance when the on-field position swaps aren't mixed in between them. Array#sort is
      // stable, so relative order within each group is otherwise untouched.
      const ordered = [...queue].sort((a, b) => Number(isSwapPair(a)) - Number(isSwapPair(b)));
      // Big "coming off" callout - just the players actually leaving the field (swaps don't count),
      // as number + first name, for the coach to read out at a glance and shout across the field.
      const shortLabel = (rp) => (rp ? `#${rp.number || '?'} ${rp.name.split(/\s+/)[0]}` : '(removed)');
      const comingOff = ordered.filter((pair) => !isSwapPair(pair)).map((pair) => shortLabel(rosterById[pair.offId]));
      subQueueContainer.innerHTML = `
        <div class="sub-queue-bar">
          ${comingOff.length ? `
            <div class="coming-off">
              <span class="coming-off-label">Coming off</span>
              <span class="coming-off-names">${comingOff.map((n) => `<span class="coming-off-name">${escapeHtml(n)}</span>`).join('')}</span>
            </div>` : ''}
          <div class="sub-queue-chips">
            ${ordered.map((pair) => {
              const off = rosterById[pair.offId];
              const on = rosterById[pair.onId];
              const label = (rp) => rp ? `#${escapeHtml(rp.number || '?')} ${escapeHtml(rp.name)}` : '(removed)';
              const isSwap = isSwapPair(pair);
              const body = isSwap ? `${label(off)} &harr; ${label(on)}` : `${label(on)} &rarr; for ${label(off)}`;
              return `
                <span class="sub-queue-chip${isSwap ? ' sub-queue-chip-swap' : ''}">
                  ${body}
                  <button class="sub-queue-remove" data-unqueue="${pair.id}" type="button" aria-label="Remove">&times;</button>
                </span>`;
            }).join('')}
          </div>
          <button id="make-subs-btn" class="kickoff-bar sub-queue-execute" type="button">&#8646; Apply ${queue.length} Change${queue.length > 1 ? 's' : ''}</button>
        </div>
      `;
      subQueueContainer.querySelectorAll('[data-unqueue]').forEach((btn) => {
        btn.addEventListener('click', () => {
          unqueueSub(session, btn.getAttribute('data-unqueue'));
          DB.saveSession(session);
          renderSubQueue();
          rerender();
        });
      });
      subQueueContainer.querySelector('#make-subs-btn').addEventListener('click', () => {
        const count = queue.length;
        const beforeState = JSON.parse(JSON.stringify({ players: session.players, rows: session.rows, subQueue: session.subQueue }));
        applySubQueue(session, Date.now());
        DB.saveSession(session);
        rerender();
        lastMove = beforeState;
        showUndoBanner(`Applied ${count} change${count > 1 ? 's' : ''}`, undoLastMove);
      });
    }

    // Placed right after the field (not above it) specifically so it never shifts the position
    // of anything a coach might be mid-tap on - the header, sub-queue bar, bench strip, and the
    // field itself all stay put whether or not this is showing.
    function renderFieldWarning() {
      const el = App.root.querySelector('#field-warning');
      const short = session.fieldCount - totalOnField();
      if (short > 0) {
        el.textContent = `Short-handed: only ${totalOnField()} of ${session.fieldCount} on the field`;
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    }

    function timeLabelFor(p, now) {
      const base = formatDuration(p.status === 'field' ? getElapsedField(p, now, session.live) : getElapsedBench(p, now, session.live));
      if (p.isGoalie) return `${base} · GK ${formatDuration(getElapsedGoalie(p, now, session.live))}`;
      return base;
    }

    // Outfield time only (i.e. not counting any time spent playing keeper) - shown under a
    // benched player's name so the coach can compare overall playing time, not just how long
    // they've been sitting.
    function outfieldTimeLabelFor(p, now) {
      const field = getElapsedField(p, now, session.live);
      const goalie = getElapsedGoalie(p, now, session.live);
      return `Field ${formatDuration(Math.max(0, field - goalie))}`;
    }

    // Which on-field outfield players are "due" for a sub next: the N with the most outfield time
    // (goalie time excluded, same as outfieldTimeLabelFor), where N is however many available
    // (non-unavailable) players are waiting on the bench - that's how many could actually come
    // on right now. No bench, no candidates.
    // - The current goalie is left out entirely: their outfield time stands still while in goal,
    //   so counting them would make a field of evenly-played outfielders look uneven.
    // - If every outfielder has the same time (e.g. at kickoff) there's no meaningful "most
    //   time", so no candidates.
    // - Players tied with the Nth-highest time are all included - picking just some of a tie
    //   would single out whoever happens to come first in the list.
    // Compared in whole seconds, as displayed, so millisecond differences don't count.
    function computeSubCandidates(now) {
      const benchAvailableCount = Object.values(session.players)
        .filter((p) => p.status === 'bench' && !p.unavailable).length;
      if (benchAvailableCount === 0) return new Set();
      const fieldTimes = Object.entries(session.players)
        .filter(([, p]) => p.status === 'field' && !p.isGoalie)
        .map(([id, p]) => ({
          id,
          time: Math.floor(getElapsedField(p, now, session.live) - getElapsedGoalie(p, now, session.live)),
        }))
        .sort((a, b) => b.time - a.time);
      if (fieldTimes.length === 0 || fieldTimes[0].time === fieldTimes[fieldTimes.length - 1].time) return new Set();
      const cutoff = fieldTimes[Math.min(benchAvailableCount, fieldTimes.length) - 1].time;
      return new Set(fieldTimes.filter((x) => x.time >= cutoff).map((x) => x.id));
    }

    function createTokenEl(pid, p, isField, needsSub) {
      const rp = rosterById[pid];
      const el = document.createElement('div');
      const queuedPair = (session.subQueue || []).find((pair) => pair.offId === pid || pair.onId === pid);
      const isQueued = !!queuedPair;
      // A queued pair where both sides are already on the field is a position swap, not a
      // substitution - flagged green instead of the usual sub blue so it reads as a different
      // kind of pending change at a glance.
      const isSwapQueued = isQueued
        && (session.players[queuedPair.offId] || {}).status === 'field'
        && (session.players[queuedPair.onId] || {}).status === 'field';
      const classes = ['token', isField ? 'token-field' : 'token-bench'];
      if (pid === pendingSelectId) classes.push('token-pending-select');
      if (isQueued) classes.push('token-queued');
      if (isSwapQueued) classes.push('token-swap-queued');
      if (isField && needsSub) classes.push('token-needs-sub');
      el.className = classes.join(' ');
      el.dataset.playerId = pid;
      const number = rp ? rp.number : '';
      const name = rp ? rp.name : '(removed)';
      el.innerHTML = `
        <div class="token-time"></div>
        <div class="token-circle-wrap">
          <div class="token-circle ${number ? '' : 'no-number'} ${p.isGoalie ? 'is-goalie' : ''}">${escapeHtml(number || '?')}</div>
          ${p.isGoalie ? '<span class="goalie-badge">GK</span>' : ''}
          ${isQueued ? `<span class="sub-badge${isSwapQueued ? ' sub-badge-swap' : ''}">&#8646;</span>` : ''}
        </div>
        <div class="token-name">${escapeHtml(name)}</div>
        ${isField ? '' : '<div class="token-field-total"></div>'}
      `;
      return el;
    }

    function rerender() {
      const now = Date.now();
      tokensLayer.innerHTML = '';
      const positions = FieldLayout.computePositions(session.rows);
      const needsSubIds = computeSubCandidates(now);

      Object.entries(session.players).forEach(([pid, p]) => {
        if (p.status !== 'field') return;
        const pos = p.isGoalie ? FieldLayout.GOALIE_SPOT : (positions[pid] || { xPct: 50, yPct: 50 });
        const el = createTokenEl(pid, p, true, needsSubIds.has(pid));
        el.style.left = pos.xPct + '%';
        el.style.top = pos.yPct + '%';
        el.querySelector('.token-time').textContent = timeLabelFor(p, now);
        tokensLayer.appendChild(el);
      });

      const benchIds = Object.entries(session.players)
        .filter(([, p]) => p.status === 'bench' && !p.unavailable)
        .sort((a, b) => getElapsedBench(b[1], now, session.live) - getElapsedBench(a[1], now, session.live))
        .map(([id]) => id);

      benchStrip.innerHTML = '';
      if (benchIds.length === 0) {
        benchStrip.innerHTML = '<div class="bench-empty-hint">Everyone is on the field.</div>';
      } else {
        benchIds.forEach((pid) => {
          const p = session.players[pid];
          const el = createTokenEl(pid, p, false);
          el.querySelector('.token-time').textContent = timeLabelFor(p, now);
          el.querySelector('.token-field-total').textContent = outfieldTimeLabelFor(p, now);
          benchStrip.appendChild(el);
        });
      }

      renderKickoffBar();
      renderSubQueue();
      renderFieldWarning();
      attachDragHandlers();
    }

    function tick() {
      const now = Date.now();

      if (session.live && session.halfLengthMinutes && session.halfStartedAt) {
        const halfEndsAt = session.halfStartedAt + session.halfLengthMinutes * 60 * 1000;
        if (now >= halfEndsAt) {
          // Half's time is up: freeze everyone's clock exactly at the boundary, leave the
          // lineup untouched. If that was the last half, there's nothing left to kick off, so
          // the game ends itself here rather than reloading into a "Start Half 3" that doesn't
          // exist; otherwise reload the screen (brings back the Kick Off bar for the next half).
          endHalf(session, halfEndsAt);
          if (session.half > TOTAL_HALVES) {
            finishGame();
          } else {
            DB.saveSession(session);
            reloadGameScreen();
          }
          return;
        }
        const halfClockEl = App.root.querySelector('#half-clock');
        if (halfClockEl) halfClockEl.textContent = halfClockLabel(now);
      }

      const needsSubIds = computeSubCandidates(now);
      App.root.querySelectorAll('.token').forEach((el) => {
        const pid = el.dataset.playerId;
        const p = session.players[pid];
        if (!p) return;
        const timeEl = el.querySelector('.token-time');
        if (timeEl) timeEl.textContent = timeLabelFor(p, now);
        const totalEl = el.querySelector('.token-field-total');
        if (totalEl) totalEl.textContent = outfieldTimeLabelFor(p, now);
        if (p.status === 'field') el.classList.toggle('token-needs-sub', needsSubIds.has(pid));
      });
    }

    // --- Drag and drop (pointer events cover mouse + touch + pen uniformly) ---
    // A pointerdown doesn't commit to a drag right away: movement staying below DRAG_THRESHOLD
    // is treated as a harmless tap (no-op) on release, so an accidental brush of a token can't
    // change anything. Only an actual drag repositions a player, subs them, or - dropped onto
    // the goal - makes them goalie.
    const DRAG_THRESHOLD = 8;
    let dragState = null;
    // The token tapped first while building a queued substitution, awaiting its pair.
    let pendingSelectId = null;
    // A snapshot of players/rows from just before the last manual drag that actually changed
    // something - or the last Apply of the sub queue (which also snapshots the queue itself, so
    // undoing it puts the queued changes back) - offered back via the undo banner.
    let lastMove = null;
    let undoBannerTimer = null;

    function undoLastMove() {
      if (!lastMove) return;
      session.players = lastMove.players;
      session.rows = lastMove.rows;
      if (lastMove.subQueue) session.subQueue = lastMove.subQueue;
      lastMove = null;
      DB.saveSession(session);
      hideUndoBanner();
      rerender();
    }

    // An inline banner (not a fixed-position overlay) right below the field, next to the
    // short-handed warning - a floating "toast" turned out to render off-screen or behind the
    // browser's own chrome on at least one mobile browser, so this rides in the normal page flow
    // instead, which has no such viewport quirks to worry about.
    function showUndoBanner(label, onUndo) {
      const el = App.root.querySelector('#undo-banner');
      if (!el) return;
      if (undoBannerTimer) clearTimeout(undoBannerTimer);
      el.innerHTML = `<span></span><button type="button" class="undo-banner-btn">Undo</button>`;
      el.querySelector('span').textContent = label;
      el.hidden = false;
      el.querySelector('.undo-banner-btn').addEventListener('click', () => {
        clearTimeout(undoBannerTimer);
        onUndo();
      });
      undoBannerTimer = setTimeout(hideUndoBanner, 30000);
    }

    function hideUndoBanner() {
      const el = App.root.querySelector('#undo-banner');
      if (!el) return;
      el.hidden = true;
      el.innerHTML = '';
    }

    function attachDragHandlers() {
      App.root.querySelectorAll('.token').forEach((el) => {
        el.addEventListener('pointerdown', onPointerDown);
      });
    }

    function onPointerDown(e) {
      const el = e.currentTarget;
      e.preventDefault();
      dragState = {
        pid: el.dataset.playerId,
        sourceEl: el,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        ghost: null,
        offsetX: 0,
        offsetY: 0,
      };
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp, { once: true });
      window.addEventListener('pointercancel', onPointerCancel, { once: true });
    }

    function beginActualDrag(e) {
      // A real drag always wins over a half-made tap-to-pair attempt.
      pendingSelectId = null;
      const { sourceEl } = dragState;
      const rect = sourceEl.getBoundingClientRect();
      const ghost = sourceEl.cloneNode(true);
      ghost.classList.add('token-ghost');
      ghost.style.width = rect.width + 'px';
      document.body.appendChild(ghost);
      dragState.ghost = ghost;
      dragState.offsetX = e.clientX - rect.left;
      dragState.offsetY = e.clientY - rect.top;
      dragState.moved = true;
      sourceEl.classList.add('token-dragging-source');
      positionGhost(e.clientX, e.clientY);
    }

    function positionGhost(clientX, clientY) {
      if (!dragState || !dragState.ghost) return;
      dragState.ghost.style.left = (clientX - dragState.offsetX) + 'px';
      dragState.ghost.style.top = (clientY - dragState.offsetY) + 'px';
    }

    function fieldRelativePct(clientX, clientY) {
      const rect = fieldWrap.getBoundingClientRect();
      return {
        xPct: ((clientX - rect.left) / rect.width) * 100,
        yPct: ((clientY - rect.top) / rect.height) * 100,
      };
    }

    function onPointerMove(e) {
      if (!dragState) return;
      if (!dragState.moved) {
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        beginActualDrag(e);
        goalZoneEl.classList.add('zone-active');
      }
      positionGhost(e.clientX, e.clientY);
      const { xPct, yPct } = fieldRelativePct(e.clientX, e.clientY);
      goalZoneEl.classList.toggle('zone-hover', FieldLayout.isInGoalZone(xPct, yPct));
    }

    function endDrag() {
      window.removeEventListener('pointermove', onPointerMove);
      goalZoneEl.classList.remove('zone-active', 'zone-hover');
      if (dragState) {
        if (dragState.ghost) dragState.ghost.remove();
        dragState.sourceEl.classList.remove('token-dragging-source');
        dragState = null;
      }
    }

    function onPointerCancel() {
      endDrag();
    }

    // The browser still fires a "click" after a token's pointerup, at the same spot - and by then
    // the re-render may have moved something else under the finger. Queuing a sub adds the queue
    // bar above the bench strip, which puts its Apply button right where a bench token was, so
    // that stray click would apply the queue instantly. Swallow the one click that follows (or
    // give up after a moment, if none does).
    function swallowGhostClick() {
      const block = (e) => {
        e.stopPropagation();
        e.preventDefault();
        cleanup();
      };
      const cleanup = () => {
        document.removeEventListener('click', block, true);
        clearTimeout(timer);
      };
      document.addEventListener('click', block, true);
      const timer = setTimeout(cleanup, 400);
    }

    // Dropping a player onto the goal makes them goalie (bumping the previous one, with
    // confirmation). Cancelling snaps the dragged player back to exactly where they started
    // (see below). If the incoming goalie came from the bench, the old goalie goes to the
    // bench too (a straight substitution, count stays balanced); if they came from elsewhere on
    // the field, the old goalie just moves to a normal outfield spot (a role swap, nobody
    // actually leaves the field).
    async function placeAsGoalie(pid, now) {
      const incomingFromBench = session.players[pid].status === 'bench';
      const currentGoalieId = Object.keys(session.players).find((id) => session.players[id].isGoalie);

      if (currentGoalieId && currentGoalieId !== pid) {
        const goalieName = (rosterById[currentGoalieId] || {}).name || 'the current goalie';
        const draggedName = (rosterById[pid] || {}).name || 'this player';
        const confirmed = await showConfirm(`Make ${draggedName} the goalie instead of ${goalieName}?`, 'Make Goalie');
        if (!confirmed) {
          // Nothing about the dragged player has been touched yet at this point (status/row
          // are still exactly what they were before the drag started), so doing nothing here
          // snaps them right back to wherever they came from on the next rerender - the bench
          // strip, or their original spot on the field.
          return;
        }
        if (incomingFromBench) {
          setStatus(session, currentGoalieId, 'bench', now);
        } else {
          setGoalie(session, currentGoalieId, false, now);
          const rowIdx = FieldLayout.placeAtDrop(session.rows, currentGoalieId, FieldLayout.DISPLACED_GOALIE_SPOT.xPct, FieldLayout.DISPLACED_GOALIE_SPOT.yPct);
          setRow(session, currentGoalieId, rowIdx, now);
        }
      }

      setStatus(session, pid, 'field', now);
      FieldLayout.removeFromRows(session.rows, pid);
      setGoalie(session, pid, true, now);
    }

    async function onPointerUp(e) {
      if (!dragState) return;
      const { pid, moved } = dragState;
      const now = Date.now();
      const p = session.players[pid];
      const rect = fieldWrap.getBoundingClientRect();
      const inField = moved && e.clientX >= rect.left && e.clientX <= rect.right
        && e.clientY >= rect.top && e.clientY <= rect.bottom;
      const { xPct, yPct } = fieldRelativePct(e.clientX, e.clientY);
      const clampedX = clamp(xPct, 0, 100);
      const clampedY = clamp(yPct, 0, 100);

      // Clear the drag visuals immediately - don't leave the ghost/highlight hanging around
      // while a goalie-replacement confirmation is up.
      endDrag();
      swallowGhostClick();

      let undoOffer = null;
      const nameOf = (id) => (rosterById[id] || {}).name || 'that player';

      if (p && moved) {
        // Taken before any mutation, and only turned into an offered undo if something in it
        // actually ends up different below - a drag that gets rejected (field full) or cancelled
        // (declined goalie swap) leaves this unused.
        const beforeState = JSON.stringify({ players: session.players, rows: session.rows });
        let actionLabel = null;

        if (!inField) {
          setStatus(session, pid, 'bench', now);
          FieldLayout.removeFromRows(session.rows, pid);
          actionLabel = `Benched ${nameOf(pid)}`;
        } else if (FieldLayout.isInGoalZone(clampedX, clampedY)) {
          await placeAsGoalie(pid, now);
          actionLabel = `Made ${nameOf(pid)} goalie`;
        } else {
          if (p.isGoalie) setGoalie(session, pid, false, now);

          const targetPid = FieldLayout.findPlayerNear(session.rows, clampedX, clampedY, pid);
          if (targetPid) {
            if (p.status === 'field') {
              // Both already on the field near this spot - a straight swap of positions.
              FieldLayout.swapPlayers(session.rows, pid, targetPid);
              setRow(session, pid, FieldLayout.rowIndexOf(session.rows, pid), now);
              setRow(session, targetPid, FieldLayout.rowIndexOf(session.rows, targetPid), now);
              actionLabel = `Swapped ${nameOf(pid)} and ${nameOf(targetPid)}`;
            } else {
              // Coming from the bench onto an existing field player: a 1-for-1 substitution -
              // the target comes off, the dragged player takes their exact spot.
              const targetRowIdx = FieldLayout.rowIndexOf(session.rows, targetPid);
              setStatus(session, targetPid, 'bench', now);
              FieldLayout.replaceInRows(session.rows, targetPid, pid);
              setStatus(session, pid, 'field', now);
              setRow(session, pid, targetRowIdx, now);
              actionLabel = `${nameOf(pid)} in for ${nameOf(targetPid)}`;
            }
          } else if (p.status === 'bench' && outfieldCount() >= session.fieldCount - 1) {
            // Not dropped onto anyone in particular, and outfield is already at capacity for
            // this format - refuse the addition rather than silently going over.
            showToast(`Field is full (${session.fieldCount - 1} outfield allowed)`);
          } else {
            setStatus(session, pid, 'field', now);
            const rowIdx = FieldLayout.placeAtDrop(session.rows, pid, clampedX, clampedY);
            setRow(session, pid, rowIdx, now);
            actionLabel = `Added ${nameOf(pid)} to the field`;
          }
        }

        if (actionLabel && JSON.stringify({ players: session.players, rows: session.rows }) !== beforeState) {
          undoOffer = { label: actionLabel, snapshot: JSON.parse(beforeState) };
        }

        DB.saveSession(session);
      } else if (p && !moved) {
        handleTokenTap(pid, p);
      }

      // The actual lineup change is already saved and about to be rendered above this line -
      // everything below is just the (non-essential) undo affordance, kept last and defensive
      // so nothing about it can ever delay or block the real state update reaching the screen.
      rerender();

      if (undoOffer) {
        try {
          lastMove = undoOffer.snapshot;
          showUndoBanner(undoOffer.label, undoLastMove);
        } catch (err) {
          lastMove = null;
        }
      }
    }

    // A plain tap (no drag) builds the substitution queue: tap a bench player then a field
    // player (either order) to pair them; tap either token again to un-pair. Goalie changes stay
    // on the drag-to-goal-zone flow, so goalie taps are ignored here.
    function handleTokenTap(pid, p) {
      const existingPair = (session.subQueue || []).find((pair) => pair.offId === pid || pair.onId === pid);
      if (existingPair) {
        unqueueSub(session, existingPair.id);
        if (pendingSelectId === pid) pendingSelectId = null;
        DB.saveSession(session);
        return;
      }

      if (p.isGoalie) return;

      if (pendingSelectId === pid) {
        pendingSelectId = null;
        return;
      }

      if (pendingSelectId == null) {
        pendingSelectId = pid;
        return;
      }

      const otherId = pendingSelectId;
      const otherP = session.players[otherId];
      pendingSelectId = null;
      if (!otherP) return;
      if (otherP.status === 'bench' && p.status === 'bench') {
        showToast('Pick two field players to swap, or a bench and a field player to sub');
        return;
      }
      const offId = p.status === 'field' ? pid : otherId;
      const onId = p.status === 'field' ? otherId : pid;
      queueSub(session, offId, onId);
      DB.saveSession(session);
    }

    // --- Header actions ---
    // The menu layer (backdrop + card) is what's shown/hidden; any tap outside the card, or on
    // one of its items, closes it.
    const settingsMenu = App.root.querySelector('#settings-menu');
    const settingsDropdown = App.root.querySelector('#settings-dropdown');
    App.root.querySelector('#settings-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      settingsMenu.hidden = !settingsMenu.hidden;
    });
    function closeSettingsOnOutsideClick(e) {
      if (settingsMenu.hidden) return;
      if (!settingsDropdown.contains(e.target) || e.target.closest('.settings-item')) settingsMenu.hidden = true;
    }
    document.addEventListener('click', closeSettingsOnOutsideClick);

    App.root.querySelector('#end-game-btn').addEventListener('click', async () => {
      if (!await showConfirm('End this game? It will be saved to the season history.', 'End game', true)) return;
      finishGame();
    });

    App.root.querySelector('#help-btn').addEventListener('click', () => showHelpMenu());

    App.root.querySelector('#fc-edit-btn').addEventListener('click', async () => {
      const n = await showNumberPrompt('Players on field', {
        hint: 'Total, including the goalie (e.g. 7v7 \u2192 7)', value: session.fieldCount, min: 3, max: 15,
      });
      if (n === null || n === session.fieldCount) return;
      session.fieldCount = n;
      DB.saveTeamSettings(team.id, { fieldCount: n });
      DB.saveSession(session);
      // Reload rather than patch in place - the kickoff bar's enabled/disabled state and
      // message both depend on fieldCount too.
      reloadGameScreen();
    });


    const adjustClockBtn = App.root.querySelector('#adjust-clock-btn');
    if (adjustClockBtn) {
      const clockModal = App.root.querySelector('#clock-modal');

      function closeClockModal() {
        clockModal.hidden = true;
        clockModal.innerHTML = '';
      }
      clockModal.addEventListener('click', (e) => { if (e.target === clockModal) closeClockModal(); });

      // Actually mutates the session and reports back if the request got clamped (e.g. asking
      // to remove more time than has actually elapsed) - otherwise a coach who asked for -30s
      // but only 5s had passed would just see a barely-there change and reasonably assume
      // nothing happened at all. Deliberately doesn't go through reloadGameScreen() - a coach
      // correcting by more than 30s taps this repeatedly, and a full screen rebuild would also
      // tear down (and re-hide) the still-open Adjust Clock modal on every tap.
      function applyClockAdjustment(deltaMinutes, now) {
        const applied = adjustClock(session, deltaMinutes, now);
        DB.saveSession(session);
        const halfClockEl = App.root.querySelector('#half-clock');
        if (halfClockEl) halfClockEl.textContent = halfClockLabel(Date.now());
        rerender();
        if (Math.abs(applied - deltaMinutes) > 0.01) {
          showToast(`Could only adjust by ${formatDuration(Math.abs(applied) * 60)} - that's all the time that had elapsed on the clock.`);
        }
      }

      // Restart Half discards real elapsed playing time, so - unlike the small +/-30s nudges -
      // it goes through a confirmation step first. `computeDeltaMinutes` is a function of `now`
      // (not a fixed number) so a coach who takes a moment to confirm doesn't get a reset sized
      // off a slightly stale elapsed time.
      function confirmClockAdjustment(computeDeltaMinutes, message, confirmLabel) {
        closeClockModal();
        showConfirm(message, confirmLabel).then((confirmed) => {
          if (!confirmed) return;
          const now = Date.now();
          applyClockAdjustment(computeDeltaMinutes(now), now);
        });
      }

      adjustClockBtn.addEventListener('click', () => {
        clockModal.hidden = false;
        clockModal.innerHTML = `
          <div class="modal-card">
            <h2>Adjust Clock</h2>
            <div class="goal-team-picker">
              <button class="secondary-btn big" id="clock-restart" type="button">Restart Half</button>
              <button class="secondary-btn big" id="clock-minus30" type="button">&minus;30 seconds</button>
              <button class="secondary-btn big" id="clock-plus30" type="button">+30 seconds</button>
              <button class="secondary-btn" id="clock-cancel" type="button">Cancel</button>
            </div>
          </div>
        `;
        clockModal.querySelector('#clock-cancel').addEventListener('click', closeClockModal);
        clockModal.querySelector('#clock-restart').addEventListener('click', () => {
          confirmClockAdjustment(
            (now) => (session.halfStartedAt ? -(now - session.halfStartedAt) / (60 * 1000) : 0),
            'Restart the clock for this half? Elapsed time this half will reset to 0:00.',
            'Restart Half'
          );
        });
        // Left open (not closed on tap) - a coach correcting by more than 30 seconds needs to
        // hit this repeatedly. Backdrop tap or Cancel is the way out.
        clockModal.querySelector('#clock-minus30').addEventListener('click', () => {
          applyClockAdjustment(-0.5, Date.now());
        });
        clockModal.querySelector('#clock-plus30').addEventListener('click', () => {
          applyClockAdjustment(0.5, Date.now());
        });
      });
    }

    App.root.querySelector('#add-late-btn').addEventListener('click', () => {
      const availableIds = team.players.map((p) => p.id).filter((id) => !session.players[id]);
      const modal = App.root.querySelector('#late-modal');
      if (availableIds.length === 0) {
        modal.hidden = true;
        showToast("Everyone on the roster is already in today's game");
        return;
      }
      modal.hidden = false;
      modal.innerHTML = `
        <div class="modal-card">
          <h2>Add a player who just arrived</h2>
          <ul class="player-list">
            ${availableIds.map((id) => {
              const rp = rosterById[id];
              return `
                <li class="player-row selectable" data-add-id="${id}">
                  <label class="select-row">
                    <span class="jersey-badge ${rp.number ? '' : 'no-number'}">${escapeHtml(rp.number || '?')}</span>
                    <span class="player-name">${escapeHtml(rp.name)}</span>
                  </label>
                </li>`;
            }).join('')}
          </ul>
          <button id="late-cancel" class="secondary-btn" type="button">Cancel</button>
        </div>
      `;
      modal.querySelectorAll('[data-add-id]').forEach((li) => {
        li.addEventListener('click', () => {
          const id = li.getAttribute('data-add-id');
          const addedNow = Date.now();
          session.players[id] = {
            status: 'bench', fieldSeconds: 0, benchSeconds: 0, lastChange: addedNow,
            isGoalie: false, goalieSeconds: 0, lastGoalieChange: addedNow,
            rowSeconds: [0, 0, 0, 0], currentRowIndex: null, lastRowChange: addedNow,
          };
          DB.saveSession(session);
          modal.hidden = true;
          rerender();
        });
      });
      modal.querySelector('#late-cancel').addEventListener('click', () => { modal.hidden = true; });
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
    });

    // --- Info panel: a bottom sheet, hidden until opened. Currently just position/time
    // tracking, but built as a general container so future sections (e.g. settings) can be
    // added alongside without redoing the panel mechanism.
    // Which player's row in the Players panel is expanded to show its Mark Out / Remove actions -
    // one at a time, so the list stays a readable column of stats rather than a wall of buttons.
    let expandedPlayerId = null;

    function renderInfoPanel() {
      const now = Date.now();
      const content = App.root.querySelector('#info-panel-content');
      const rosterPlayers = Object.keys(session.players).map((id) => rosterById[id]).filter(Boolean);
      // Least to most field time - makes it easy to spot who needs more time at a glance.
      const sorted = rosterPlayers.slice().sort((a, b) => {
        return getElapsedField(session.players[a.id], now, session.live)
          - getElapsedField(session.players[b.id], now, session.live);
      });

      if (sorted.length === 0) {
        content.innerHTML = '<p class="empty">No players in this game yet.</p>';
        return;
      }

      const ROW_LABELS = ['ST', 'AM', 'DM', 'DEF'];

      content.innerHTML = sorted.map((rp) => {
        const p = session.players[rp.id];
        const fieldTotal = getElapsedField(p, now, session.live);
        const benchTotal = getElapsedBench(p, now, session.live);
        const goalieTotal = getElapsedGoalie(p, now, session.live);
        const grandTotal = fieldTotal + benchTotal;
        const fieldPct = grandTotal > 0 ? (fieldTotal / grandTotal) * 100 : null;

        const chips = [
          `<span class="stat-chip">Field ${formatDuration(fieldTotal)}</span>`,
          `<span class="stat-chip">Bench ${formatDuration(benchTotal)}</span>`,
        ];
        if (goalieTotal > 0) chips.push(`<span class="stat-chip">GK ${formatDuration(goalieTotal)}</span>`);
        for (let i = 0; i < FieldLayout.ROW_COUNT; i++) {
          const rowTotal = getElapsedRow(p, i, now, session.live);
          if (rowTotal > 0) chips.push(`<span class="stat-chip">${ROW_LABELS[i]} ${formatDuration(rowTotal)}</span>`);
        }

        const barHtml = fieldPct == null
          ? '<div class="time-bar time-bar-empty"></div>'
          : `<div class="time-bar">
               <div class="time-bar-field" style="width:${fieldPct}%"></div>
               <div class="time-bar-bench" style="width:${100 - fieldPct}%"></div>
               <div class="time-bar-thumb" style="left:${fieldPct}%"></div>
             </div>`;

        return `
          <div class="player-stat-row ${p.unavailable ? 'player-out' : ''} ${expandedPlayerId === rp.id ? 'expanded' : ''}">
            <button class="player-stat-name" data-expand-player="${rp.id}" type="button" aria-expanded="${expandedPlayerId === rp.id}">
              <span class="jersey-badge ${rp.number ? '' : 'no-number'}">${escapeHtml(rp.number || '?')}</span>${escapeHtml(rp.name)}
              ${p.unavailable ? '<span class="out-tag">Out</span>' : ''}
              <span class="player-stat-chevron">${icon('chevron', 16)}</span>
            </button>
            ${barHtml}
            <div class="player-stat-detail">${chips.join('')}</div>
            ${expandedPlayerId === rp.id ? `
            <div class="player-stat-actions">
              <button class="secondary-btn small" data-toggle-unavailable="${rp.id}" type="button">${p.unavailable ? 'Mark Available' : 'Mark Out'}</button>
              <button class="danger-btn small" data-remove-player="${rp.id}" type="button">Remove</button>
            </div>` : ''}
          </div>`;
      }).join('');

      content.querySelectorAll('[data-expand-player]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-expand-player');
          expandedPlayerId = expandedPlayerId === id ? null : id;
          renderInfoPanel();
        });
      });

      content.querySelectorAll('[data-toggle-unavailable]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-toggle-unavailable');
          const wasUnavailable = !!session.players[id].unavailable;
          setUnavailable(session, id, !wasUnavailable, Date.now());
          DB.saveSession(session);
          renderInfoPanel();
          rerender();
        });
      });

      content.querySelectorAll('[data-remove-player]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-remove-player');
          const rp = rosterById[id];
          showConfirm(`Remove ${rp ? rp.name : 'this player'} from today's game? Their time for this game will be lost.`, 'Remove').then((confirmed) => {
            if (!confirmed) return;
            removePlayerFromGame(session, id);
            DB.saveSession(session);
            renderInfoPanel();
            rerender();
          });
        });
      });
    }

    // Chronological log of every goal logged this game, each with an undo (delete) button - the
    // only way to correct a mis-tapped scorer/assist/team once it's been recorded.
    function renderGoalLog() {
      const content = App.root.querySelector('#goal-log-content');
      if (session.goals.length === 0) {
        content.innerHTML = '<p class="empty">No goals logged yet.</p>';
        return;
      }
      content.innerHTML = session.goals.map((g) => {
        const label = g.team === 'opponent'
          ? escapeHtml(session.opponentName || 'Opponent')
          : (() => {
              const scorer = g.scorerId ? rosterById[g.scorerId] : null;
              const assistNames = (g.assistIds || []).map((id) => rosterById[id]).filter(Boolean).map((p) => p.name);
              let text = g.scorerId
                ? escapeHtml(scorer ? scorer.name : '(removed)')
                : '<span class="goal-unknown">Unknown scorer</span>';
              if (assistNames.length) text += ` <span class="goal-assist">(assist: ${escapeHtml(assistNames.join(', '))})</span>`;
              return text;
            })();
        return `
          <div class="player-stat-row goal-log-row">
            <span class="goal-log-half">H${g.half}</span>
            <span class="goal-log-label">${label}</span>
            ${g.team === 'us' ? `<button class="secondary-btn small" data-edit-goal="${g.id}" type="button">Edit</button>` : ''}
            <button class="danger-btn small" data-remove-goal="${g.id}" type="button">&times;</button>
          </div>`;
      }).join('');

      content.querySelectorAll('[data-edit-goal]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const goal = session.goals.find((g) => g.id === btn.getAttribute('data-edit-goal'));
          if (goal) editGoalFlow(goal);
        });
      });

      content.querySelectorAll('[data-remove-goal]').forEach((btn) => {
        btn.addEventListener('click', () => {
          removeGoal(session, btn.getAttribute('data-remove-goal'));
          DB.saveSession(session);
          renderGoalLog();
          renderScoreboard();
        });
      });
    }

    const infoPanel = App.root.querySelector('#info-panel');
    App.root.querySelector('#info-panel-btn').addEventListener('click', () => {
      expandedPlayerId = null;
      renderInfoPanel();
      renderGoalLog();
      infoPanel.hidden = false;
    });
    App.root.querySelector('#info-panel-close').addEventListener('click', () => { infoPanel.hidden = true; });
    infoPanel.addEventListener('click', (e) => { if (e.target === infoPanel) infoPanel.hidden = true; });

    // --- Goal logging ---
    const goalModal = App.root.querySelector('#goal-modal');
    let cancelGoalStep = null;
    goalModal.addEventListener('click', (e) => {
      if (e.target === goalModal && cancelGoalStep) cancelGoalStep();
    });

    function closeGoalModal(result) {
      goalModal.hidden = true;
      goalModal.innerHTML = '';
      cancelGoalStep = null;
      return result;
    }

    function pickGoalTeam() {
      return new Promise((resolve) => {
        cancelGoalStep = () => resolve(closeGoalModal(null));
        goalModal.hidden = false;
        goalModal.innerHTML = `
          <div class="modal-card">
            <h2>Who scored?</h2>
            <div class="goal-team-picker">
              <button class="primary-btn big goal-team-btn" data-team="us" type="button" style="${colorStyle(teamColor(team))}">${escapeHtml(team.name)}</button>
              <button class="primary-btn big goal-team-btn" data-team="opponent" type="button" style="${colorStyle(session.opponentColor || defaultOpponentColor(team))}">${escapeHtml(session.opponentName || 'Opponent')}</button>
              <button class="secondary-btn" id="goal-team-cancel" type="button">Cancel</button>
            </div>
          </div>
        `;
        goalModal.querySelectorAll('[data-team]').forEach((btn) => {
          btn.addEventListener('click', () => resolve(closeGoalModal(btn.getAttribute('data-team'))));
        });
        goalModal.querySelector('#goal-team-cancel').addEventListener('click', () => resolve(closeGoalModal(null)));
      });
    }

    // Sentinel returned when the coach explicitly doesn't know who scored yet - distinct from
    // `null`, which means the whole flow was cancelled (nothing should be recorded at all).
    const UNKNOWN_SCORER = 'unknown-scorer';

    function pickScorer(currentScorerId) {
      return new Promise((resolve) => {
        cancelGoalStep = () => resolve(closeGoalModal(null));
        const players = sortedRoster(Object.keys(session.players).map((id) => rosterById[id]).filter(Boolean));
        goalModal.hidden = false;
        goalModal.innerHTML = `
          <div class="modal-card">
            <h2>Who scored?</h2>
            <ul class="player-list">
              ${players.map((p) => `
                <li class="player-row selectable" data-scorer-id="${p.id}">
                  <label class="select-row">
                    <span class="jersey-badge ${p.number ? '' : 'no-number'}">${escapeHtml(p.number || '?')}</span>
                    <span class="player-name">${escapeHtml(p.name)}</span>
                    ${p.id === currentScorerId ? '<span class="current-tag">current</span>' : ''}
                  </label>
                </li>`).join('')}
            </ul>
            <div class="confirm-actions">
              <button class="secondary-btn" id="goal-scorer-unknown" type="button">Unknown Scorer</button>
              <button class="secondary-btn" id="goal-scorer-cancel" type="button">Cancel</button>
            </div>
          </div>
        `;
        goalModal.querySelectorAll('[data-scorer-id]').forEach((li) => {
          li.addEventListener('click', () => resolve(closeGoalModal(li.getAttribute('data-scorer-id'))));
        });
        goalModal.querySelector('#goal-scorer-unknown').addEventListener('click', () => resolve(closeGoalModal(UNKNOWN_SCORER)));
        goalModal.querySelector('#goal-scorer-cancel').addEventListener('click', () => resolve(closeGoalModal(null)));
      });
    }

    function pickAssists(scorerId, preselectedIds) {
      return new Promise((resolve) => {
        cancelGoalStep = () => resolve(closeGoalModal(null));
        const preselected = preselectedIds || [];
        const players = sortedRoster(Object.keys(session.players).map((id) => rosterById[id]).filter(Boolean))
          .filter((p) => p.id !== scorerId);
        goalModal.hidden = false;
        goalModal.innerHTML = `
          <div class="modal-card">
            <h2>Any assists? <span class="panel-hint">(up to 2)</span></h2>
            <ul class="player-list">
              ${players.map((p) => `
                <li class="player-row selectable">
                  <label class="select-row">
                    <input type="checkbox" class="assist-check" value="${p.id}" ${preselected.includes(p.id) ? 'checked' : ''}>
                    <span class="jersey-badge ${p.number ? '' : 'no-number'}">${escapeHtml(p.number || '?')}</span>
                    <span class="player-name">${escapeHtml(p.name)}</span>
                  </label>
                </li>`).join('')}
            </ul>
            <div class="confirm-actions">
              <button class="secondary-btn" id="assist-skip" type="button">No Assist</button>
              <button class="primary-btn" id="assist-confirm" type="button">Confirm</button>
            </div>
            <button class="secondary-btn" id="goal-assist-cancel" type="button">Cancel</button>
          </div>
        `;
        const checks = Array.from(goalModal.querySelectorAll('.assist-check'));
        const updateDisabled = () => {
          const checkedCount = checks.filter((x) => x.checked).length;
          checks.forEach((x) => { if (!x.checked) x.disabled = checkedCount >= 2; });
        };
        checks.forEach((c) => c.addEventListener('change', updateDisabled));
        updateDisabled();
        goalModal.querySelector('#assist-skip').addEventListener('click', () => resolve(closeGoalModal([])));
        goalModal.querySelector('#assist-confirm').addEventListener('click', () => {
          const ids = checks.filter((c) => c.checked).map((c) => c.value);
          resolve(closeGoalModal(ids));
        });
        goalModal.querySelector('#goal-assist-cancel').addEventListener('click', () => resolve(closeGoalModal(null)));
      });
    }

    async function openGoalFlow() {
      const scoringTeam = await pickGoalTeam();
      if (!scoringTeam) return;
      if (scoringTeam === 'opponent') {
        recordGoal(session, { team: 'opponent' });
      } else {
        const scorerId = await pickScorer();
        if (scorerId === null) return; // cancelled - nothing was ever written
        if (scorerId === UNKNOWN_SCORER) {
          // Coach doesn't know who scored yet - log the goal anyway so the score stays right,
          // and fill in the scorer/assists later via the Edit button in the Goals list.
          recordGoal(session, { team: 'us', scorerId: null, assistIds: [] });
        } else {
          const assistIds = await pickAssists(scorerId);
          if (assistIds === null) return; // cancelled - nothing was ever written
          recordGoal(session, { team: 'us', scorerId, assistIds });
        }
      }
      DB.saveSession(session);
      renderScoreboard();
      showToast(`${session.score.us} - ${session.score.opponent}`);
    }

    // Fills in or corrects who scored/assisted a goal already on the board - same picker steps
    // as recording a fresh goal, but writes into the existing entry via editGoal instead of
    // adding a new one, so the score is untouched. Triggered from inside the (already open)
    // Stats panel, so the panel is hidden for the duration - both modals share the same
    // z-index and #info-panel sits later in the DOM, so it would otherwise paint over
    // #goal-modal and swallow every tap - then reopened, refreshed, once editing is done.
    async function editGoalFlow(goal) {
      infoPanel.hidden = true;
      try {
        const scorerId = await pickScorer(goal.scorerId);
        if (scorerId === null) return; // cancelled
        if (scorerId === UNKNOWN_SCORER) {
          editGoal(session, goal.id, { scorerId: null, assistIds: [] });
        } else {
          const assistIds = await pickAssists(scorerId, goal.assistIds || []);
          if (assistIds === null) return; // cancelled
          editGoal(session, goal.id, { scorerId, assistIds });
        }
        DB.saveSession(session);
      } finally {
        renderGoalLog();
        infoPanel.hidden = false;
      }
    }

    App.root.querySelector('#goal-btn').addEventListener('click', () => { openGoalFlow(); });
    if (preKickoff) App.root.querySelector('#cancel-setup-btn').addEventListener('click', cancelSetup);

    renderScoreboard();
    rerender();
    App._tick = setInterval(tick, 1000);

    // Back-button guard: keep an extra #/game history entry on top, so the phone's back button
    // pops that (same hash - no hashchange, no navigation) instead of leaving the game or, in the
    // installed app, closing it outright. Each time it's popped, push it straight back.
    if (!(history.state && history.state.gameGuard)) history.pushState({ gameGuard: true }, '', '#/game');
    function onPopState() {
      if (location.hash !== '#/game' || !DB.loadSession()) return;
      if (preKickoff) { cancelSetup(); return; }
      history.pushState({ gameGuard: true }, '', '#/game');
      showToast('Game in progress - use the ⋯ menu > End game to leave');
    }
    window.addEventListener('popstate', onPopState);

    App._cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('click', closeSettingsOnOutsideClick);
      window.removeEventListener('popstate', onPopState);
    };
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());

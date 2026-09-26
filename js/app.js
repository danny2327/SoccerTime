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

    const hash = location.hash.slice(1) || '/teams';
    const parts = hash.split('/').filter(Boolean);

    if (parts[0] === 'team' && parts[1]) return Screens.teamEdit(parts[1]);
    if (parts[0] === 'start' && parts[1]) return Screens.startGame(parts[1]);
    if (parts[0] === 'game') return Screens.gameSession();
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

const Screens = {
  teamsList() {
    const teams = DB.loadTeams();
    App.root.innerHTML = `
      <header class="topbar">
        <h1>My Teams</h1>
        <button id="install-btn" class="icon-btn" hidden title="Install app">Install</button>
      </header>
      <main class="list-page">
        ${teams.length === 0 ? `<p class="empty">No teams yet. Add one to get started.</p>` : ''}
        <ul class="team-list">
          ${teams.map((t) => `
            <li class="team-row">
              <a href="#/team/${t.id}" class="team-link">
                <span class="team-name">${escapeHtml(t.name)}</span>
                <span class="team-meta">${t.players.length} player${t.players.length === 1 ? '' : 's'}</span>
              </a>
              <button class="danger-btn small" data-delete-team="${t.id}">Delete</button>
            </li>`).join('')}
        </ul>
        <button id="new-team-btn" class="primary-btn big">+ New Team</button>
      </main>
    `;

    App.root.querySelector('#new-team-btn').addEventListener('click', () => {
      const name = prompt('Team name?');
      if (!name || !name.trim()) return;
      const allTeams = DB.loadTeams();
      const team = { id: uid(), name: name.trim(), players: [] };
      allTeams.push(team);
      DB.saveTeams(allTeams);
      location.hash = `#/team/${team.id}`;
    });

    App.root.querySelectorAll('[data-delete-team]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const id = btn.getAttribute('data-delete-team');
        const t = teams.find((x) => x.id === id);
        if (!confirm(`Delete "${t ? t.name : 'this team'}" and its roster? This can't be undone.`)) return;
        const remaining = DB.loadTeams().filter((x) => x.id !== id);
        DB.saveTeams(remaining);
        Screens.teamsList();
      });
    });

    attachHelpFab();
  },

  // Hidden dev/testing route: visiting #/seed-demo (re)creates a 13-player "Dummy Team" so a
  // roster doesn't need to be typed in by hand every time. Not linked from anywhere in the UI.
  seedDemo() {
    const DUMMY_PLAYERS = [
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
    const teams = DB.loadTeams().filter((t) => t.name !== 'Dummy Team');
    const team = {
      id: uid(),
      name: 'Dummy Team',
      players: DUMMY_PLAYERS.map((p) => ({ id: uid(), name: p.name, number: p.number })),
    };
    teams.push(team);
    DB.saveTeams(teams);
    DB.saveSession(null);
    location.hash = `#/team/${team.id}`;
  },

  teamEdit(teamId) {
    const teams = DB.loadTeams();
    const team = teams.find((t) => t.id === teamId);
    if (!team) { location.hash = '#/teams'; return; }

    // A brand-new team needs its whole roster typed in right away, so start with the entry
    // form open; an existing team rarely gets a single late addition, so keep it tucked away
    // behind the header button until asked for. Persists across re-renders within this screen.
    let addFormOpen = team.players.length === 0;

    const render = () => {
      const sorted = sortedRoster(team.players);
      App.root.innerHTML = `
        <header class="topbar">
          <a href="#/teams" class="back-link">&larr; Teams</a>
          <h1>${escapeHtml(team.name)}</h1>
          <button id="add-player-toggle-btn" class="icon-btn" type="button">&#43; Player</button>
          <a href="#/season/${team.id}" class="icon-btn">&#128197; Season</a>
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
          <form id="add-player-form" class="add-player-form" ${addFormOpen ? '' : 'hidden'}>
            <input type="text" id="new-number" placeholder="#" inputmode="numeric" pattern="[0-9]*" maxlength="3" class="number-input">
            <input type="text" id="new-name" placeholder="Player name" class="name-input" required>
            <button type="submit" class="primary-btn small">Add</button>
          </form>
          <button id="start-game-btn" class="primary-btn big" ${team.players.length === 0 ? 'disabled' : ''}>Start Game &rarr;</button>
        </main>
        <div id="player-modal" class="modal" hidden></div>
      `;

      App.root.querySelector('#add-player-toggle-btn').addEventListener('click', () => {
        addFormOpen = !addFormOpen;
        const form = App.root.querySelector('#add-player-form');
        form.hidden = !addFormOpen;
        if (addFormOpen) App.root.querySelector('#new-number').focus();
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

      App.root.querySelector('#start-game-btn').addEventListener('click', () => {
        location.hash = `#/start/${team.id}`;
      });

      attachHelpFab();
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
        <a href="#/team/${team.id}" class="back-link">&larr; ${escapeHtml(team.name)}</a>
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
                  <span class="result-badge result-${result}">${result}</span>
                  <span class="season-game-info">
                    <span class="season-game-opponent">${escapeHtml(g.opponentName || 'Opponent')}</span>
                    <span class="panel-hint">${new Date(g.date).toLocaleDateString()}</span>
                  </span>
                  <span class="season-game-score">${g.finalScore.us}&ndash;${g.finalScore.opponent}</span>
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

  startGame(teamId) {
    const teams = DB.loadTeams();
    const team = teams.find((t) => t.id === teamId);
    if (!team) { location.hash = '#/teams'; return; }

    const settings = DB.loadTeamSettings(teamId);
    let fieldCount = clamp(settings.fieldCount || 7, 3, 15);
    let halfLength = clamp(settings.halfLengthMinutes || 25, 5, 60);
    const sorted = sortedRoster(team.players);

    App.root.innerHTML = `
      <header class="topbar">
        <a href="#/team/${team.id}" class="back-link">&larr; ${escapeHtml(team.name)}</a>
        <h1>Start Game</h1>
      </header>
      <main class="list-page">
        <section class="field-count-picker">
          <label>Players on field<span class="field-count-sublabel">Total, including the goalie (e.g. 7v7 &rarr; 7)</span></label>
          <div class="stepper">
            <button id="fc-minus" class="stepper-btn" type="button">&minus;</button>
            <span id="fc-value" class="stepper-value">${fieldCount}</span>
            <button id="fc-plus" class="stepper-btn" type="button">+</button>
          </div>
        </section>
        <section class="field-count-picker">
          <label>Half length<span class="field-count-sublabel">Minutes per half</span></label>
          <div class="stepper">
            <button id="hl-minus" class="stepper-btn" type="button">&minus;</button>
            <span id="hl-value" class="stepper-value">${halfLength}</span>
            <button id="hl-plus" class="stepper-btn" type="button">+</button>
          </div>
        </section>
        <section class="field-count-picker">
          <label>Opponent<span class="field-count-sublabel">Optional - shown on the scoreboard</span></label>
          <input type="text" id="opponent-name" class="opponent-input" placeholder="Opponent name">
        </section>
        <h2 class="section-label">Who's here today?</h2>
        <ul class="player-list select-list" id="present-list">
          ${sorted.map((p) => `
            <li class="player-row selectable">
              <label class="select-row">
                <input type="checkbox" class="present-check" value="${p.id}" checked>
                <span class="jersey-badge ${p.number ? '' : 'no-number'}">${escapeHtml(p.number || '?')}</span>
                <span class="player-name">${escapeHtml(p.name)}</span>
              </label>
            </li>`).join('')}
        </ul>
        ${team.players.length === 0 ? '<p class="empty">This team has no players yet.</p>' : ''}
        <button id="begin-btn" class="primary-btn big">Begin Game</button>
      </main>
    `;

    const fcValue = App.root.querySelector('#fc-value');
    const updateFC = (delta) => {
      fieldCount = clamp(fieldCount + delta, 3, 15);
      fcValue.textContent = fieldCount;
      DB.saveTeamSettings(teamId, { fieldCount });
    };
    App.root.querySelector('#fc-minus').addEventListener('click', () => updateFC(-1));
    App.root.querySelector('#fc-plus').addEventListener('click', () => updateFC(1));

    const hlValue = App.root.querySelector('#hl-value');
    const updateHL = (delta) => {
      halfLength = clamp(halfLength + delta, 5, 60);
      hlValue.textContent = halfLength;
      DB.saveTeamSettings(teamId, { halfLengthMinutes: halfLength });
    };
    App.root.querySelector('#hl-minus').addEventListener('click', () => updateHL(-5));
    App.root.querySelector('#hl-plus').addEventListener('click', () => updateHL(5));

    App.root.querySelector('#begin-btn').addEventListener('click', () => {
      const presentIds = Array.from(App.root.querySelectorAll('.present-check:checked')).map((c) => c.value);
      if (presentIds.length === 0) { alert('Select at least one player who is here today.'); return; }
      const opponentName = App.root.querySelector('#opponent-name').value.trim();
      startSession(team, presentIds, fieldCount, halfLength, opponentName);
      location.hash = '#/game';
    });

    attachHelpFab();
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
    function finishGame() {
      DB.appendGame(team.id, buildGameRecord(session));
      DB.saveSession(null);
      location.hash = `#/team/${team.id}`;
    }

    App.root.innerHTML = `
      <header class="topbar game-header">
        <button id="goal-btn" class="icon-btn goal-btn" type="button" ${session.live ? '' : 'disabled'}>&#9917; Goal</button>
        ${session.live ? `<span id="half-clock" class="half-clock">${halfClockLabel(Date.now())}</span>` : ''}
        <div class="header-right">
          <button id="info-panel-btn" class="icon-btn">&#128202; Stats</button>
          <button id="settings-btn" class="icon-btn">&#9881; Settings</button>
        </div>
      </header>
      <div class="scoreboard" id="scoreboard"></div>
      <div id="settings-dropdown" class="settings-dropdown" hidden>
        <a href="#/team/${team.id}" class="settings-item settings-item-danger" id="end-game-btn">&times; End Game</a>
        <button id="fc-edit-btn" class="settings-item" type="button">${session.fieldCount} on field &#9998;</button>
        <button id="add-late-btn" class="settings-item" type="button">+ Add Player</button>
        ${session.live ? '<button id="adjust-clock-btn" class="settings-item" type="button">&#8986; Adjust Clock</button>' : ''}
        <button id="help-btn" class="settings-item" type="button">&#10067; Help</button>
        <div class="settings-item settings-version">${escapeHtml(APP_VERSION)}</div>
      </div>
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
        <p class="field-hint">Drag a player onto the goal to make them goalie, or onto another player to swap/replace them. Drag off the field to bench them. Tap two field players to queue a swap, or a bench and a field player to queue a substitution, for later.</p>
      </main>
      <div id="late-modal" class="modal" hidden></div>
      <div id="goal-modal" class="modal" hidden></div>
      <div id="clock-modal" class="modal" hidden></div>
      <div id="info-panel" class="modal" hidden>
        <div class="modal-card">
          <div class="panel-header">
            <h2>${escapeHtml(team.name)}</h2>
            <button id="info-panel-close" class="panel-close-btn" type="button" aria-label="Close">&times;</button>
          </div>
          <section class="panel-section">
            <h3>Time by position</h3>
            <p class="panel-hint">ST = striker · AM = attacking mid · DM = defensive mid · DEF = defense</p>
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
        <span class="score-team-name">${escapeHtml(team.name)}</span>
        <span class="score-value">${session.score.us}</span>
        <span class="score-sep">&ndash;</span>
        <span class="score-value">${session.score.opponent}</span>
        <span class="score-team-name">${escapeHtml(session.opponentName || 'Opponent')}</span>
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
      subQueueContainer.innerHTML = `
        <div class="sub-queue-bar">
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
        applySubQueue(session, Date.now());
        DB.saveSession(session);
        reloadGameScreen();
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

    // Which on-field players are "due" for a sub next: the N with the most outfield time
    // (goalie time excluded, same as outfieldTimeLabelFor), where N is however many available
    // (non-unavailable) players are waiting on the bench - that's how many could actually come
    // on right now. No bench, no candidates. If everyone on the field has the same time (e.g. at
    // kickoff) there's no meaningful "most time", so no candidates either - compared in whole
    // seconds, as displayed, so millisecond differences in when players went on don't count.
    function computeSubCandidates(now) {
      const benchAvailableCount = Object.values(session.players)
        .filter((p) => p.status === 'bench' && !p.unavailable).length;
      if (benchAvailableCount === 0) return new Set();
      const fieldTimes = Object.entries(session.players)
        .filter(([, p]) => p.status === 'field')
        .map(([id, p]) => ({
          id,
          time: Math.floor(getElapsedField(p, now, session.live) - getElapsedGoalie(p, now, session.live)),
        }));
      if (fieldTimes.every((x) => x.time === fieldTimes[0].time)) return new Set();
      const ranked = fieldTimes
        .sort((a, b) => b.time - a.time)
        .slice(0, benchAvailableCount)
        .map((x) => x.id);
      return new Set(ranked);
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
    // something, offered back via the undo banner - deliberately not touched by tap-to-queue
    // (handleTokenTap) or applySubQueue, since only manual drags should be undoable this way.
    let lastMove = null;
    let undoBannerTimer = null;

    function undoLastMove() {
      if (!lastMove) return;
      session.players = lastMove.players;
      session.rows = lastMove.rows;
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
    const settingsDropdown = App.root.querySelector('#settings-dropdown');
    App.root.querySelector('#settings-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      settingsDropdown.hidden = !settingsDropdown.hidden;
    });
    function closeSettingsOnOutsideClick(e) {
      if (!settingsDropdown.hidden && !settingsDropdown.contains(e.target) && e.target.id !== 'settings-btn') {
        settingsDropdown.hidden = true;
      }
    }
    document.addEventListener('click', closeSettingsOnOutsideClick);

    App.root.querySelector('#end-game-btn').addEventListener('click', (e) => {
      e.preventDefault();
      if (!confirm('End this game? The current session will be cleared.')) return;
      finishGame();
    });

    App.root.querySelector('#help-btn').addEventListener('click', () => showHelp());

    App.root.querySelector('#fc-edit-btn').addEventListener('click', () => {
      const val = prompt('Players on field, total including the goalie (3-15):', session.fieldCount);
      if (val === null) return;
      const n = clamp(parseInt(val, 10) || session.fieldCount, 3, 15);
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
        alert("Everyone on the roster is already in today's game.");
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
          <div class="player-stat-row ${p.unavailable ? 'player-out' : ''}">
            <div class="player-stat-name">
              <span class="jersey-badge ${rp.number ? '' : 'no-number'}">${escapeHtml(rp.number || '?')}</span>${escapeHtml(rp.name)}
              ${p.unavailable ? '<span class="out-tag">Out</span>' : ''}
            </div>
            ${barHtml}
            <div class="player-stat-detail">${chips.join('')}</div>
            <div class="player-stat-actions">
              <button class="secondary-btn small" data-toggle-unavailable="${rp.id}" type="button">${p.unavailable ? 'Mark Available' : 'Mark Out'}</button>
              <button class="danger-btn small" data-remove-player="${rp.id}" type="button">Remove</button>
            </div>
          </div>`;
      }).join('');

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
              <button class="primary-btn big" data-team="us" type="button">${escapeHtml(team.name)}</button>
              <button class="primary-btn big" data-team="opponent" type="button">${escapeHtml(session.opponentName || 'Opponent')}</button>
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

    renderScoreboard();
    rerender();
    App._tick = setInterval(tick, 1000);
    App._cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('click', closeSettingsOnOutsideClick);
    };
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());

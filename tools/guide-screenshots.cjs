// Regenerates the screenshots used by the in-app "How to use SoccerTime" guide (img/guide/*.jpg).
//
// Needs Playwright (not a dependency of the app itself) and the dev server running on :8080:
//   python dev-server.py
//   NODE_PATH=<folder containing playwright> node tools/guide-screenshots.cjs
//
// It drives the real app in a phone-sized browser, builds a realistic mid-game state, adds the
// numbered orange callouts the guide text refers to, and saves cropped 2x JPEGs. Rerun it after
// changing any screen the guide shows.

const path = require('path');
const { chromium, devices } = require('playwright');

const BASE = process.env.GUIDE_BASE || 'http://localhost:8080/';
const OUT = path.join(__dirname, '..', 'img', 'guide');

// In-page helpers: numbered callout markers and drag arrows, drawn over the real UI.
const HELPERS = () => {
  const layer = () => {
    let l = document.getElementById('guide-layer');
    if (!l) {
      l = document.createElement('div');
      l.id = 'guide-layer';
      l.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:0;z-index:9999;pointer-events:none';
      document.body.appendChild(l);
    }
    return l;
  };
  window.__clearMarks = () => { const l = document.getElementById('guide-layer'); if (l) l.remove(); };
  // Marker n centred at (x, y) in page coordinates.
  window.__mark = (x, y, n) => {
    const m = document.createElement('div');
    m.textContent = n;
    m.style.cssText = `position:absolute;left:${x - 14}px;top:${y - 14 + window.scrollY}px;width:28px;height:28px;border-radius:50%;
      background:#e8590c;color:#fff;font:800 16px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
      border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.45)`;
    layer().appendChild(m);
  };
  window.__markEl = (sel, n, dx, dy, idx) => {
    const els = document.querySelectorAll(sel);
    const el = els[idx || 0];
    if (!el) throw new Error('no element for ' + sel);
    const r = el.getBoundingClientRect();
    window.__mark(r.left + r.width / 2 + (dx || 0), r.top + r.height / 2 + (dy || 0), n);
  };
  window.__markRightOf = (sel, n, idx, gap) => {
    const r = document.querySelectorAll(sel)[idx || 0].getBoundingClientRect();
    window.__mark(r.right + (gap || 10) + 14, r.top + r.height / 2, n);
  };
  window.__markAfterText = (sel, n, idx, gap) => {
    const el = document.querySelectorAll(sel)[idx || 0];
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()];
    const right = Math.max(...rects.map((r) => r.right));
    const box = el.getBoundingClientRect();
    window.__mark(right + (gap || 10) + 14, box.top + box.height / 2, n);
  };
  // A curved dashed arrow from (x1, y1) to (x2, y2), with marker n at its start.
  window.__arrow = (x1, y1, x2, y2, n, bx, by) => {
    const sy = window.scrollY;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', document.documentElement.scrollWidth);
    svg.setAttribute('height', document.documentElement.scrollHeight);
    svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible';
    const id = 'ah' + Math.random().toString(36).slice(2);
    svg.innerHTML = `<defs><marker id="${id}" markerUnits="userSpaceOnUse" markerWidth="18" markerHeight="18" refX="12" refY="9" orient="auto">
      <path d="M1,1 L17,9 L1,17 z" fill="#e8590c" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></marker></defs>`;
    const mx = (x1 + x2) / 2 + (bx || 0), my = (y1 + y2) / 2 + (by || 0) + sy;
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', `M${x1},${y1 + sy} Q${mx},${my} ${x2},${y2 + sy}`);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', '#e8590c');
    p.setAttribute('stroke-width', '4');
    p.setAttribute('stroke-dasharray', '9 6');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('marker-end', `url(#${id})`);
    p.style.filter = 'drop-shadow(0 1px 1.5px rgba(0,0,0,.6))';
    svg.appendChild(p);
    layer().appendChild(svg);
    window.__mark(x1, y1, n);
  };
  window.__centre = (sel, idx) => {
    const el = document.querySelectorAll(sel)[idx || 0];
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  };
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['Pixel 7'], deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await ctx.addInitScript(HELPERS);
  const W = devices['Pixel 7'].viewport.width;

  const shot = async (name, top, bottom) => {
    await page.screenshot({
      path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 78,
      clip: { x: 0, y: Math.max(0, top), width: W, height: bottom - Math.max(0, top) },
    });
    console.log('saved', name);
    await page.evaluate(() => window.__clearMarks());
  };
  const rect = (sel, idx) => page.evaluate(([s, i]) => window.__centre(s, i), [sel, idx || 0]);
  const settle = () => page.waitForTimeout(350);
  const toTop = () => page.evaluate(() => window.scrollTo(0, 0));

  // --- Data: two teams, a few past games for the season screen ---
  await page.goto(BASE + '#/teams');
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '#/seed-demo');
  await settle();
  const teamId = await page.evaluate(() => {
    const teams = DB.loadTeams();
    const t = teams[0];
    t.name = 'Lightning U11';
    t.color = '#1f5fa8';
    teams.push({
      id: 'storm', name: 'Storm U9', color: '#b3261e',
      players: ['Ava', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivy', 'Jon'].map((n, i) => ({ id: 'st' + i, name: n + ' S.', number: String(i + 1) })),
    });
    DB.saveTeams(teams);
    const p = t.players;
    const day = 864e5;
    DB.appendGame(t.id, { id: 'g1', date: Date.now() - 14 * day, opponentName: 'Rockets', opponentColor: '#a84a0c', finalScore: { us: 3, opponent: 1 },
      goals: [{ id: 'a', team: 'us', half: 1, scorerId: p[8].id, assistIds: [p[4].id] }, { id: 'b', team: 'opponent', half: 1 },
        { id: 'c', team: 'us', half: 2, scorerId: p[8].id, assistIds: [] }, { id: 'd', team: 'us', half: 2, scorerId: p[2].id, assistIds: [p[4].id] }] });
    DB.appendGame(t.id, { id: 'g2', date: Date.now() - 7 * day, opponentName: 'United', opponentColor: '#ffffff', finalScore: { us: 1, opponent: 1 },
      goals: [{ id: 'e', team: 'opponent', half: 1 }, { id: 'f', team: 'us', half: 2, scorerId: p[5].id, assistIds: [p[8].id] }] });
    return t.id;
  });

  // --- 1. Teams screen ---
  await page.goto(BASE + '#/teams');
  await settle();
  {
    const last = await rect('.team-card', 1);
    await page.evaluate(() => { window.__markAfterText('.team-card-meta', 1, 0, 12); window.__markEl('.team-card-menu', 2, -34, 0, 0); });
    await shot('teams', 0, last.bottom + 14);
  }

  // --- 2. Team home: settings line, opponent + colour, who's here ---
  await page.goto(BASE + `#/team/${teamId}`);
  await settle();
  await page.fill('#opponent-name', 'Rockets');
  await page.tap('#opponent-colors .color-swatch >> nth=5');
  // 9 here today: 7 on the field, 2 on the bench - keeps the example field readable.
  for (const i of [9, 10, 11, 12]) await page.locator('.present-check').nth(i).uncheck();
  await page.locator('#opponent-name').blur();
  await toTop();
  await settle();
  {
    await page.evaluate(() => {
      window.__markAfterText('#settings-summary span', 1, 0, 14);
      window.__markRightOf('#opponent-colors .color-swatch', 2, 10, 10);
      window.__markAfterText('.section-label-row span', 3, 0, 14);
    });
    const row = await rect('.present-check', 3);
    await shot('team-home', 0, row.bottom + 14);
  }

  // --- 3. Moving players: drag arrows over a live field ---
  await page.evaluate(() => window.__clearMarks());
  await page.tap('#begin-btn');
  await settle();
  await page.tap('#kickoff-btn');
  await settle();
  // Realistic mid-half times: everyone a little different, two on the bench.
  await page.evaluate(() => {
    const s = DB.loadSession();
    const now = Date.now();
    s.halfStartedAt = now - (14 * 60 + 30) * 1000;
    s.kickoffAt = s.halfStartedAt;
    const field = Object.values(s.players).filter((p) => p.status === 'field' && !p.isGoalie);
    const mins = [14.2, 13.1, 9.7, 8.3, 6.2, 4.5];
    field.forEach((p, i) => { p.fieldSeconds = 0; p.lastChange = now - mins[i] * 60000; p.benchSeconds = (14.5 - mins[i]) * 60; });
    const gk = Object.values(s.players).find((p) => p.isGoalie);
    gk.fieldSeconds = 0; gk.lastChange = s.halfStartedAt; gk.lastGoalieChange = s.halfStartedAt; gk.goalieSeconds = 0;
    Object.values(s.players).filter((p) => p.status === 'bench').forEach((p, i) => {
      p.fieldSeconds = [5.1, 3.4][i] * 60; p.benchSeconds = 0; p.lastChange = now - [9.4, 11.1][i] * 60000;
    });
    s.score = { us: 1, opponent: 0 };
    DB.saveSession(s);
  });
  await page.reload();
  await settle();
  const gameTop = 0;
  {
    const bench0 = await rect('.token-bench .token-circle', 0);
    const f1 = await rect('.token-field .token-circle', 1);
    const f3 = await rect('.token-field .token-circle', 3);
    const f4 = await rect('.token-field .token-circle', 4);
    const f5 = await rect('.token-field .token-circle', 5);
    const goal = await rect('#goal-zone-highlight');
    const strip = await rect('#bench-strip');
    const f2 = await rect('.token-field .token-circle', 2);
    await page.evaluate(([b, a, casey, riley, sam, alex, g, st]) => {
      window.__arrow(b.x + 26, b.y + 14, a.x - 6, a.y - 26, 1, 10, -10);          // bench -> field player: sub
      window.__arrow(riley.x - 8, riley.y - 26, casey.x + 26, casey.y - 20, 2, 0, -40); // field -> field: swap
      window.__arrow(alex.x, alex.y + 26, g.x + 14, g.y - 30, 3, 40, 0);         // onto the goal: goalie
      window.__arrow(sam.x + 10, sam.y - 26, st.x + 90, st.y + 6, 4, 60, 10);   // off the field: bench
    }, [bench0, f1, f2, f3, f4, f5, goal, strip]);
    const field = await rect('#field-wrap');
    await shot('move', gameTop, field.bottom + 8);
    await page.evaluate(() => window.__clearMarks());
  }

  // --- 4. Reading the field: times, due-for-sub ring, goalie, bench totals ---
  {
    await page.evaluate(() => {
      window.__markRightOf('.token-field .token-time', 1, 3, 6);
      window.__markEl('.token-needs-sub .token-circle', 2, 30, 8, 0);
      window.__markEl('.token-field .token-circle.is-goalie', 3, 34, 0, 0);
      window.__markAfterText('.token-bench .token-field-total', 4, 1, 8);
    });
    const field = await rect('#field-wrap');
    await shot('field', gameTop, field.bottom + 8);
    await page.evaluate(() => window.__clearMarks());
  }

  // --- 5. Planning subs: two queued subs + a swap ---
  await page.tap('.token-bench >> nth=0'); await settle();
  await page.tap('.token-needs-sub >> nth=0'); await settle();
  await page.tap('.token-bench >> nth=1'); await settle();
  await page.tap('.token-needs-sub >> nth=1'); await settle();
  await page.tap('.token-field >> nth=2'); await settle();
  await page.tap('.token-field >> nth=5'); await settle();
  {
    await page.evaluate(() => {
      window.__markEl('.coming-off', 1, 170, 0);
      window.__markRightOf('.sub-queue-chip', 2, 0, 8);
      window.__markEl('#make-subs-btn', 3, 150, 0);
      window.__markRightOf('.token-bench .token-circle', 4, 1, 12);
    });
    const strip = await rect('#bench-strip');
    await shot('queue', 60, strip.bottom + 6);
    await page.evaluate(() => window.__clearMarks());
  }
  // Clear the queue again for the remaining shots.
  await page.evaluate(() => { const s = DB.loadSession(); s.subQueue = []; DB.saveSession(s); });
  await page.reload();
  await settle();

  // --- 6. Goals ---
  await page.tap('#goal-btn');
  await settle();
  {
    const card = await rect('#goal-modal .modal-card');
    await shot('goal', card.top - 10, card.bottom);
  }
  await page.tap('#goal-team-cancel');
  await settle();

  // --- 7. Players panel ---
  await page.tap('#info-panel-btn');
  await settle();
  await page.tap('[data-expand-player] >> nth=0');
  await settle();
  {
    const card = await rect('#info-panel .modal-card');
    const actions = await rect('.player-stat-actions');
    await page.evaluate(() => {
      window.__markEl('.time-bar', 1, 0, -12, 0);
      const chips = document.querySelectorAll('.player-stat-detail')[0].children;
      const last = chips[chips.length - 1].getBoundingClientRect();
      window.__mark(last.right + 24, last.top + last.height / 2, 2);
      window.__markRightOf('.player-stat-actions .danger-btn', 3, 0, 10);
    });
    const next = await rect('.player-stat-row', 2);
    await shot('players', card.top - 4, Math.max(actions.bottom, next.bottom) + 6);
    await page.evaluate(() => window.__clearMarks());
  }
  await page.tap('#info-panel-close');
  await settle();

  // --- 8. The ... menu ---
  await page.tap('#settings-btn');
  await settle();
  {
    const card = await rect('#settings-dropdown');
    await shot('menu', 0, card.bottom + 12);
  }
  await page.tap('#settings-btn');

  // --- 9. Season history ---
  await page.evaluate(() => { const s = DB.loadSession(); s.opponentName = 'Rockets'; DB.saveSession(s); });
  await page.goto(BASE + `#/season/${teamId}`);
  await settle();
  {
    await page.evaluate(() => {
      window.__markAfterText('.season-record', 1, 0, 12);
      window.__markAfterText('.season-game-opponent', 2, 0, 12);
      window.__markAfterText('.season-leaderboard-row .player-name', 3, 0, 12);
    });
    const lb = await page.evaluate(() => {
      const rows = document.querySelectorAll('.season-leaderboard-row');
      return rows[rows.length - 1].getBoundingClientRect().bottom;
    });
    await shot('season', 0, lb + 14);
  }

  await page.evaluate(() => localStorage.clear());
  await browser.close();
})();

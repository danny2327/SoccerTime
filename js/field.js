'use strict';

// Half-pitch markings, drawn in real-world-ish units (meters), goal at the bottom
// (y grows downward toward the goal line), halfway line along the top edge.
const FieldSVG = {
  markup() {
    return `
<svg viewBox="-2 -2 72 59" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <g fill="none" stroke="#ffffff" stroke-width="0.35" stroke-linecap="round">
    <rect x="0" y="0" width="68" height="52.5" />
    <path d="M 24.85 0 A 9.15 9.15 0 0 0 43.15 0" />
    <rect x="13.85" y="36" width="40.3" height="16.5" />
    <rect x="24.84" y="47" width="18.32" height="5.5" />
    <path d="M 26.69 36 A 9.15 9.15 0 0 1 41.31 36" />
    <rect x="30.34" y="52.5" width="7.32" height="2" />
    <path d="M 1 52.5 A 1 1 0 0 0 0 51.5" />
    <path d="M 67 52.5 A 1 1 0 0 1 68 51.5" />
  </g>
  <circle cx="34" cy="0" r="0.4" fill="#ffffff" />
  <circle cx="34" cy="41.5" r="0.4" fill="#ffffff" />
</svg>`;
  },
};

// Formation layout: the field has a fixed grid of (up to) 4 rows, north-south, each holding up
// to 4 players. Both the row positions and the count are fixed for the life of the session -
// dropping a player only ever changes which row's *membership list* they're in, never creates,
// removes, or repositions a row. That's deliberate: an earlier version derived each row's y from
// its index among however many rows currently existed, so picking a player up and putting them
// back down (which transiently changes the row count) visibly reshuffled the whole field. With
// permanent rows, nothing about any OTHER row ever changes just because one player moved.
//
// Within a row, players are always spread evenly across the full width: 1 sits dead centre, 2
// split to either side, 3 is centre-flanked, up to the 4-player cap.
const FieldLayout = {
  ROW_MARGIN_PCT: 9,
  ROW_COUNT: 4,
  MAX_PER_ROW: 4,

  // The goalie doesn't take part in the row layout at all - they get a fixed spot right on
  // the goal line. GOAL_ZONE is the drop target (percent of the field-wrap box) that assigns
  // the goalie role; it roughly covers the goal area/six-yard box, open-ended at the bottom
  // edge so dropping right on or past the goal line still counts.
  GOAL_ZONE: { xMin: 30, xMax: 70, yMin: 78 },
  GOALIE_SPOT: { xPct: 50, yPct: 91 },
  DISPLACED_GOALIE_SPOT: { xPct: 50, yPct: 58 },

  // The 4 fixed rows are spread evenly across this top band, leaving the goalie's reserved
  // space near the bottom clear.
  OUTFIELD_MAX_Y_PCT: 70,

  isInGoalZone(xPct, yPct) {
    const z = FieldLayout.GOAL_ZONE;
    return xPct >= z.xMin && xPct <= z.xMax && yPct >= z.yMin;
  },

  // The 4 permanent rows, all empty, each at its fixed y. Created once when a game starts.
  createEmptyRows() {
    const rows = [];
    for (let i = 0; i < FieldLayout.ROW_COUNT; i++) {
      const y = ((i + 0.5) / FieldLayout.ROW_COUNT) * FieldLayout.OUTFIELD_MAX_Y_PCT;
      rows.push({ y, players: [] });
    }
    return rows;
  },

  computePositions(rows) {
    const positions = {};
    rows.forEach((row) => {
      const m = row.players.length;
      const span = 100 - 2 * FieldLayout.ROW_MARGIN_PCT;
      row.players.forEach((pid, j) => {
        const xPct = m === 0 ? 50 : ((j + 0.5) / m) * span + FieldLayout.ROW_MARGIN_PCT;
        positions[pid] = { xPct, yPct: row.y };
      });
    });
    return positions;
  },

  removeFromRows(rows, playerId) {
    rows.forEach((row) => {
      const idx = row.players.indexOf(playerId);
      if (idx !== -1) row.players.splice(idx, 1);
    });
  },

  rowIndexOf(rows, playerId) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].players.includes(playerId)) return i;
    }
    return null;
  },

  // Is there already a player rendered close enough to this drop point to count as "dropped on
  // top of them"? Used to trigger a swap/replace instead of a plain insert.
  findPlayerNear(rows, dropXPct, dropYPct, excludePlayerId) {
    const positions = FieldLayout.computePositions(rows);
    const X_TOL = 9;
    const Y_TOL = 8;
    for (const [pid, pos] of Object.entries(positions)) {
      if (pid === excludePlayerId) continue;
      if (Math.abs(pos.xPct - dropXPct) <= X_TOL && Math.abs(pos.yPct - dropYPct) <= Y_TOL) return pid;
    }
    return null;
  },

  // Trade two on-field players' exact slots (rows + order within the row).
  swapPlayers(rows, idA, idB) {
    let posA = null;
    let posB = null;
    rows.forEach((row, ri) => {
      const ia = row.players.indexOf(idA);
      if (ia !== -1) posA = { ri, idx: ia };
      const ib = row.players.indexOf(idB);
      if (ib !== -1) posB = { ri, idx: ib };
    });
    if (!posA || !posB) return;
    rows[posA.ri].players[posA.idx] = idB;
    rows[posB.ri].players[posB.idx] = idA;
  },

  // Put newId exactly where oldId was (same row, same slot) - used when a bench player is
  // dropped onto an existing field player, substituting them 1-for-1.
  replaceInRows(rows, oldId, newId) {
    for (const row of rows) {
      const idx = row.players.indexOf(oldId);
      if (idx !== -1) { row.players[idx] = newId; return; }
    }
  },

  // Move a player into whichever fixed row is nearest the drop point and has room (falling
  // back to the next-nearest row with room, or - if every row is already full - the nearest
  // one anyway rather than silently failing). Returns the row index the player ended up in.
  placeAtDrop(rows, playerId, dropXPct, dropYPct) {
    FieldLayout.removeFromRows(rows, playerId);

    const byDistance = rows
      .map((row, i) => ({ i, dist: Math.abs(dropYPct - row.y) }))
      .sort((a, b) => a.dist - b.dist);

    let targetIdx = byDistance[0].i;
    for (const candidate of byDistance) {
      if (rows[candidate.i].players.length < FieldLayout.MAX_PER_ROW) {
        targetIdx = candidate.i;
        break;
      }
    }

    const row = rows[targetIdx];
    const m = row.players.length;
    const span = 100 - 2 * FieldLayout.ROW_MARGIN_PCT;
    let insertAt = m;
    for (let j = 0; j < m; j++) {
      const xCenter = ((j + 0.5) / m) * span + FieldLayout.ROW_MARGIN_PCT;
      if (dropXPct < xCenter) {
        insertAt = j;
        break;
      }
    }
    row.players.splice(insertAt, 0, playerId);
    return targetIdx;
  },
};

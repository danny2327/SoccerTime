'use strict';

// A "session" is one active game. It tracks, per selected player, whether they're on the
// field or on the bench, their accumulated seconds in each state, and the timestamp of their
// last status change (so elapsed time can be computed from Date.now() without a running
// timer needing to survive page reloads).
//
// A session starts in "setup" (session.live = false): the coach can arrange the lineup, sub
// players, and assign a goalie, but no clock runs - this covers setting things up several
// minutes before kickoff. Nothing accrues until kickoff() flips session.live to true and
// resets everyone's clock reference to that exact moment.

function getElapsedField(p, now, live) {
  return p.fieldSeconds + (live && p.status === 'field' ? (now - p.lastChange) / 1000 : 0);
}

function getElapsedBench(p, now, live) {
  return p.benchSeconds + (live && p.status === 'bench' ? (now - p.lastChange) / 1000 : 0);
}

function getElapsedGoalie(p, now, live) {
  return (p.goalieSeconds || 0) + (live && p.isGoalie ? (now - p.lastGoalieChange) / 1000 : 0);
}

function getElapsedRow(p, rowIndex, now, live) {
  const banked = (p.rowSeconds && p.rowSeconds[rowIndex]) || 0;
  return banked + (live && p.currentRowIndex === rowIndex ? (now - p.lastRowChange) / 1000 : 0);
}

// Tracks which of the 4 fixed rows a player has been occupying, and for how long - separate
// from (and in addition to) their overall field/bench/goalie time. Call whenever a player's row
// assignment changes: moving between rows, leaving the field (newRowIndex = null), or coming
// back onto the field into a row.
function setRow(session, playerId, newRowIndex, now) {
  const p = session.players[playerId];
  if (!p) return;
  if (p.currentRowIndex === newRowIndex) return;
  if (p.currentRowIndex != null && session.live) {
    if (!p.rowSeconds) p.rowSeconds = [0, 0, 0, 0];
    p.rowSeconds[p.currentRowIndex] = (p.rowSeconds[p.currentRowIndex] || 0) + (now - p.lastRowChange) / 1000;
  }
  p.currentRowIndex = newRowIndex;
  p.lastRowChange = now;
}

function setStatus(session, playerId, newStatus, now) {
  const p = session.players[playerId];
  if (!p || p.status === newStatus) return;
  if (session.live) {
    if (p.status === 'field') p.fieldSeconds += (now - p.lastChange) / 1000;
    else p.benchSeconds += (now - p.lastChange) / 1000;
  }
  p.status = newStatus;
  p.lastChange = now;
  // A player can only be "the goalie" while actually on the field, and only "in a row" while
  // an outfield player - both roles end the moment they leave the field.
  if (newStatus === 'bench') {
    if (p.isGoalie) setGoalie(session, playerId, false, now);
    setRow(session, playerId, null, now);
  }
}

// Only one goalie at a time: marking a new one automatically un-marks the previous one.
function setGoalie(session, playerId, makeGoalie, now) {
  const p = session.players[playerId];
  if (!p || !!p.isGoalie === !!makeGoalie) return;

  if (p.isGoalie && !makeGoalie) {
    if (session.live) p.goalieSeconds = (p.goalieSeconds || 0) + (now - p.lastGoalieChange) / 1000;
    p.isGoalie = false;
    return;
  }

  if (makeGoalie) {
    Object.keys(session.players).forEach((otherId) => {
      if (otherId !== playerId) setGoalie(session, otherId, false, now);
    });
    setRow(session, playerId, null, now); // leaving the row grid to take the goal
    p.isGoalie = true;
    p.lastGoalieChange = now;
  }
}

// Kickoff: flips the session live and resets every player's clock reference to this instant, so
// nothing from the setup period (however long it was) counts toward anyone's time. Also (re)used
// to start the 2nd (or any later) half - halfStartedAt is what the half's own countdown reads.
function kickoff(session) {
  const now = Date.now();
  session.live = true;
  session.halfStartedAt = now;
  if (!session.kickoffAt) session.kickoffAt = now;
  Object.values(session.players).forEach((p) => {
    p.lastChange = now;
    if (p.isGoalie) p.lastGoalieChange = now;
    if (p.currentRowIndex != null) p.lastRowChange = now;
  });
}

// Called when the half's length has elapsed: freezes every player's accumulated time as of
// `now` (same accrual logic as setStatus/setGoalie, just applied to everyone unconditionally),
// stops the clock, and advances to the next half. Positions/status/goalie are left untouched -
// only the clock stops, so the lineup is exactly as it was when the whistle would blow.
function endHalf(session, now) {
  if (session.live) {
    Object.values(session.players).forEach((p) => {
      if (p.status === 'field') p.fieldSeconds += (now - p.lastChange) / 1000;
      else p.benchSeconds += (now - p.lastChange) / 1000;
      if (p.isGoalie) p.goalieSeconds = (p.goalieSeconds || 0) + (now - p.lastGoalieChange) / 1000;
      if (p.currentRowIndex != null) {
        if (!p.rowSeconds) p.rowSeconds = [0, 0, 0, 0];
        p.rowSeconds[p.currentRowIndex] = (p.rowSeconds[p.currentRowIndex] || 0) + (now - p.lastRowChange) / 1000;
      }
    });
  }
  session.live = false;
  session.half = (session.half || 1) + 1;
  session.halfStartedAt = null;
}

// Distribute the starting on-field players across the fixed row grid (see FieldLayout in
// field.js), filling rows in order up to its per-row cap.
function buildInitialRows(ids) {
  const rows = FieldLayout.createEmptyRows();
  let idx = 0;
  ids.forEach((id) => {
    while (idx < rows.length - 1 && rows[idx].players.length >= FieldLayout.MAX_PER_ROW) idx++;
    rows[idx].players.push(id);
  });
  return rows;
}

// `fieldCount` is the total players on the field for this format (the same number used to
// describe a match, e.g. "7" for 7v7) - at most fieldCount-1 of them are outfield, the same cap
// enforced everywhere else, so the last present player (if there are enough) starts as the
// goalie rather than an over-the-cap 8th outfield player. If there aren't enough present
// players to fill the format, whatever's short just means kickoff stays blocked until the
// coach adds more people or lowers the field count - no different than after that point.
function startSession(team, presentIds, fieldCount, halfLengthMinutes, opponentName) {
  const now = Date.now();
  const outfieldIds = presentIds.slice(0, Math.max(0, fieldCount - 1));
  const goalieId = presentIds.length >= fieldCount ? presentIds[fieldCount - 1] : null;
  const onFieldIds = goalieId ? outfieldIds.concat([goalieId]) : outfieldIds;
  const benchIds = presentIds.slice(onFieldIds.length);
  const rows = buildInitialRows(outfieldIds);
  const players = {};
  outfieldIds.forEach((id) => {
    players[id] = {
      status: 'field', fieldSeconds: 0, benchSeconds: 0, lastChange: now,
      isGoalie: false, goalieSeconds: 0, lastGoalieChange: now,
      rowSeconds: [0, 0, 0, 0], currentRowIndex: FieldLayout.rowIndexOf(rows, id), lastRowChange: now,
    };
  });
  if (goalieId) {
    players[goalieId] = {
      status: 'field', fieldSeconds: 0, benchSeconds: 0, lastChange: now,
      isGoalie: true, goalieSeconds: 0, lastGoalieChange: now,
      rowSeconds: [0, 0, 0, 0], currentRowIndex: null, lastRowChange: now,
    };
  }
  benchIds.forEach((id) => {
    players[id] = {
      status: 'bench', fieldSeconds: 0, benchSeconds: 0, lastChange: now,
      isGoalie: false, goalieSeconds: 0, lastGoalieChange: now,
      rowSeconds: [0, 0, 0, 0], currentRowIndex: null, lastRowChange: now,
    };
  });
  const session = {
    teamId: team.id, fieldCount, halfLengthMinutes, startedAt: now, players, rows,
    live: false, kickoffAt: null, half: 1, halfStartedAt: null,
    opponentName: (opponentName || '').trim(), score: { us: 0, opponent: 0 }, goals: [],
  };
  DB.saveSession(session);
  return session;
}

// Logs one goal against the live session and updates the running score. `team` is 'us' or
// 'opponent'; `scorerId`/`assistIds` only apply to 'us' goals (assistIds capped at 2 - a player
// can only ever be credited with up to 2 assists on a single goal).
function recordGoal(session, { team, scorerId, assistIds }) {
  const goal = { id: uid(), team, half: session.half || 1, at: Date.now() };
  if (team === 'us') {
    goal.scorerId = scorerId || null;
    goal.assistIds = (assistIds || []).slice(0, 2);
  }
  session.score[team] += 1;
  session.goals.push(goal);
  return goal;
}

// Undo for a mis-tapped goal: removes the logged entry and gives back the point it added.
function removeGoal(session, goalId) {
  const idx = (session.goals || []).findIndex((g) => g.id === goalId);
  if (idx === -1) return;
  const [goal] = session.goals.splice(idx, 1);
  session.score[goal.team] = Math.max(0, session.score[goal.team] - 1);
}

// Shapes the finished-game summary appended to the team's season history when the coach ends
// the game (see DB.appendGame) - the session itself is discarded right after.
function buildGameRecord(session) {
  return {
    id: uid(),
    date: session.kickoffAt || session.startedAt,
    endedAt: Date.now(),
    opponentName: session.opponentName || '',
    finalScore: session.score || { us: 0, opponent: 0 },
    goals: session.goals || [],
    fieldCount: session.fieldCount,
    halfLengthMinutes: session.halfLengthMinutes,
  };
}

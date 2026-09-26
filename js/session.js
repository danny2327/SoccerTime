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

// This app only ever plays a standard 2-half game - once the 2nd half's clock runs out, there's
// nothing left to kick off, so the game screen ends the game itself instead of offering a
// nonexistent "Start Half 3".
const TOTAL_HALVES = 2;

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

// Corrects a mistimed kickoff (e.g. the coach hit Kick Off a few minutes early) by shifting
// every live timing reference by deltaMinutes: positive adds elapsed time (as if kickoff had
// been earlier), negative removes it (as if kickoff had been later). Already-banked seconds
// from before the current live stretch (past halves, past sub stints) are untouched - only the
// clock reference for whatever's accruing right now moves. Each shifted timestamp is clamped to
// `now` so a too-large correction can't push a reference into the future and produce a negative
// elapsed time - you can't remove more time than has actually elapsed. No-op before kickoff,
// since there's no running clock yet to correct. Returns the minutes actually applied to the
// half clock (per-player clamping can differ slightly, e.g. someone subbed on more recently
// than the half started), so the caller can tell the coach when a request got clamped.
function adjustClock(session, deltaMinutes, now) {
  if (!session.live || !session.halfStartedAt || !deltaMinutes) return 0;
  const deltaMs = deltaMinutes * 60 * 1000;
  const newHalfStartedAt = Math.min(now, session.halfStartedAt - deltaMs);
  const appliedMinutes = (session.halfStartedAt - newHalfStartedAt) / (60 * 1000);
  session.halfStartedAt = newHalfStartedAt;
  Object.values(session.players).forEach((p) => {
    p.lastChange = Math.min(now, p.lastChange - deltaMs);
    if (p.isGoalie) p.lastGoalieChange = Math.min(now, p.lastGoalieChange - deltaMs);
    if (p.currentRowIndex != null) p.lastRowChange = Math.min(now, p.lastRowChange - deltaMs);
  });
  return appliedMinutes;
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
    subQueue: [],
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

// Fills in (or changes) who scored/assisted an already-logged 'us' goal - e.g. the coach didn't
// see who scored in the moment and comes back to it later. Doesn't touch the score, since the
// goal itself was already counted when it was first recorded.
function editGoal(session, goalId, { scorerId, assistIds }) {
  const goal = (session.goals || []).find((g) => g.id === goalId);
  if (!goal || goal.team !== 'us') return;
  goal.scorerId = scorerId || null;
  goal.assistIds = (assistIds || []).slice(0, 2);
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

// Queues either a substitution (bench player onId coming on for field player offId) or, if both
// are currently on the field, a position swap between them - instead of making it immediately.
// Lets the coach prepare several changes ahead of a stoppage and fire them all at once with
// applySubQueue. Refuses to double-book either player into a second pending pair.
function queueSub(session, offId, onId) {
  if (!session.subQueue) session.subQueue = [];
  const alreadyQueued = session.subQueue.some((p) => (
    p.offId === offId || p.onId === offId || p.offId === onId || p.onId === onId
  ));
  if (alreadyQueued) return null;
  const pair = { id: uid(), offId, onId };
  session.subQueue.push(pair);
  return pair;
}

function unqueueSub(session, pairId) {
  session.subQueue = (session.subQueue || []).filter((p) => p.id !== pairId);
}

// Executes every queued pair at once (same steps the drag-based substitution/swap already
// perform in app.js), then clears the queue. Re-checks each pair's players are still in the
// statuses they were in when queued - a drag elsewhere could have moved either of them in the
// meantime - and silently skips any pair that's no longer valid rather than leaving the field in
// a broken state.
function applySubQueue(session, now) {
  (session.subQueue || []).forEach(({ offId, onId }) => {
    const offP = session.players[offId];
    const onP = session.players[onId];
    if (!offP || !onP) return;
    if (offP.status === 'field' && onP.status === 'field') {
      // Both already on the field - a position swap, not a sub. Goalie changes stay on the
      // dedicated drag-to-goal flow, so skip a pair that's since had either side made goalie.
      if (offP.isGoalie || onP.isGoalie) return;
      FieldLayout.swapPlayers(session.rows, offId, onId);
      setRow(session, offId, FieldLayout.rowIndexOf(session.rows, offId), now);
      setRow(session, onId, FieldLayout.rowIndexOf(session.rows, onId), now);
      return;
    }
    if (offP.status !== 'field' || onP.status !== 'bench') return;
    const targetRowIdx = FieldLayout.rowIndexOf(session.rows, offId);
    setStatus(session, offId, 'bench', now);
    FieldLayout.replaceInRows(session.rows, offId, onId);
    setStatus(session, onId, 'field', now);
    setRow(session, onId, targetRowIdx, now);
  });
  session.subQueue = [];
}

// Drops a player out of the game entirely - for someone selected by mistake at kickoff (e.g.
// wasn't actually there) who should never have counted at all. Unlike setUnavailable, nothing
// about them is preserved: whatever field/bench/goalie time they'd accrued is discarded and they
// vanish from every panel, same as if they'd never been added. Any goal they're credited with
// keeps their id - the roster lookup already renders "(removed)" for ids no longer present.
function removePlayerFromGame(session, playerId) {
  const p = session.players[playerId];
  if (!p) return;
  if (p.status === 'field') FieldLayout.removeFromRows(session.rows, playerId);
  session.subQueue = (session.subQueue || []).filter((pair) => pair.offId !== playerId && pair.onId !== playerId);
  delete session.players[playerId];
}

// Marks a player unavailable for the rest of the game (hurt, sent home) or brings them back.
// Unlike removePlayerFromGame, their accumulated time is kept exactly as-is - they just stop
// taking part in the field/bench rotation (and can't be queued for a sub) until, if ever, marked
// available again. Taking someone off the field this way benches them first, same as any normal
// substitution, so their field time is banked rather than lost.
function setUnavailable(session, playerId, unavailable, now) {
  const p = session.players[playerId];
  if (!p || !!p.unavailable === !!unavailable) return;
  if (unavailable) {
    if (p.status === 'field') {
      setStatus(session, playerId, 'bench', now);
      FieldLayout.removeFromRows(session.rows, playerId);
    }
    session.subQueue = (session.subQueue || []).filter((pair) => pair.offId !== playerId && pair.onId !== playerId);
  }
  p.unavailable = unavailable;
}

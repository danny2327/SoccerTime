'use strict';

const STORAGE_KEYS = {
  teams: 'soccertime:teams:v1',
  teamSettings: (teamId) => `soccertime:teamSettings:${teamId}:v1`,
  session: 'soccertime:session:v1',
  games: (teamId) => `soccertime:games:${teamId}:v1`,
};

const DB = {
  loadTeams() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.teams);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('loadTeams failed', e);
      return [];
    }
  },

  saveTeams(teams) {
    localStorage.setItem(STORAGE_KEYS.teams, JSON.stringify(teams));
  },

  loadTeamSettings(teamId) {
    const defaults = { fieldCount: 7, halfLengthMinutes: 25 };
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.teamSettings(teamId));
      return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
    } catch (e) {
      return defaults;
    }
  },

  // Merges into whatever's already saved, so e.g. changing just fieldCount doesn't wipe out a
  // separately-saved halfLengthMinutes (or vice versa).
  saveTeamSettings(teamId, settings) {
    const merged = { ...DB.loadTeamSettings(teamId), ...settings };
    localStorage.setItem(STORAGE_KEYS.teamSettings(teamId), JSON.stringify(merged));
  },

  loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.session);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  saveSession(session) {
    if (session) localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEYS.session);
  },

  // Completed games for a team's season, oldest first. Kept separate from the single live
  // `session` slot above, which only ever holds the game currently in progress.
  loadGames(teamId) {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.games(teamId));
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('loadGames failed', e);
      return [];
    }
  },

  appendGame(teamId, gameRecord) {
    const games = DB.loadGames(teamId);
    games.push(gameRecord);
    localStorage.setItem(STORAGE_KEYS.games(teamId), JSON.stringify(games));
  },
};

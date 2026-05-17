// ═══════════════════════════════════════════════════════════════════════════
//  STATE.JS — Stato condiviso dell'applicazione
// ═══════════════════════════════════════════════════════════════════════════

const State = {
  // ── Network ──────────────────────────────────────────────────────────
  peer: null,
  conn: null,          // guest → host connection
  conns: {},           // host: { peerId: conn }
  myId: null,
  isHost: false,
  roomCode: '',

  // ── Phase ────────────────────────────────────────────────────────────
  phase: 'home',       // home | setup | lobby | game | results

  // ── Players ──────────────────────────────────────────────────────────
  players: {},         // { peerId: { id, nickname, ready, isHost, joinOrder, score, ... } }

  // ── Playlist ─────────────────────────────────────────────────────────
  playlist: [],        // [{ videoId, title, cleanTitle }]

  // ── Game Settings (host configura) ───────────────────────────────────
  settings: {
    playSeconds: 3,    // secondi di ascolto
    mode: 'start',     // 'start' | 'random'
    numSongs: 10,      // 10, 15, 20, 0=tutte
  },

  // ── Round State ──────────────────────────────────────────────────────
  round: 0,
  totalRounds: 0,
  currentOptions: [],   // [{ title, videoId, isCorrect }]
  correctIdx: -1,
  answers: {},          // { peerId: { optionIdx, time, correct } }
  voteCounts: [0,0,0,0],
  roundStartTime: 0,
  usedSongs: new Set(),

  // ── Scores ───────────────────────────────────────────────────────────
  scores: {},           // { peerId: totalScore }
  roundScores: {},      // { peerId: roundScore }
  stats: {},            // { peerId: { correct, wrong, fastest, streak, ... } }

  // ── UI State ─────────────────────────────────────────────────────────
  myAnswer: -1,
  answered: false,
  musicPlaying: false,

  // ── Reset per nuova partita ──────────────────────────────────────────
  resetGame() {
    this.round = 0;
    this.totalRounds = 0;
    this.currentOptions = [];
    this.correctIdx = -1;
    this.answers = {};
    this.voteCounts = [0,0,0,0];
    this.roundStartTime = 0;
    this.usedSongs = new Set();
    this.scores = {};
    this.roundScores = {};
    this.stats = {};
    this.myAnswer = -1;
    this.answered = false;
    this.musicPlaying = false;
    for (const p of Object.values(this.players)) {
      p.score = 0;
      p.ready = false;
    }
  },

  resetRound() {
    this.currentOptions = [];
    this.correctIdx = -1;
    this.answers = {};
    this.voteCounts = [0,0,0,0];
    this.roundStartTime = 0;
    this.myAnswer = -1;
    this.answered = false;
    this.musicPlaying = false;
    this.roundScores = {};
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  CONFIG.JS — Configurazione globale MelodiQ
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // PeerJS
  peerPrefix: 'melodiq-room-',
  peerDebug: 0,

  // Lobby
  maxPlayers: 8,
  minPlaylistSongs: 10,

  // Game
  countdownSeconds: 3,
  answerGraceSeconds: 5,     // secondi extra dopo fine musica per rispondere
  resultDisplaySeconds: 5,   // secondi mostra risultato round
  maxPointsPerRound: 1000,
  minPointsPerRound: 100,

  // Opzioni numero canzoni
  songCountOptions: [10, 15, 20, 0],  // 0 = tutte

  // Volume defaults
  audio: {
    masterVol: 0.7,
    sfxVol: 0.6,
  },
};

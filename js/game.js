// ═══════════════════════════════════════════════════════════════════════════
//  GAME.JS — Logica di gioco MelodiQ
//  Gestisce round, punteggi, timing. L'host è l'autorità.
// ═══════════════════════════════════════════════════════════════════════════

const Game = {

  _roundTimer: null,
  _countdownTimer: null,
  _answerTimeout: null,

  // ═══════════════════════════════════════════════════════════════════════
  //  INIT — registra handler di rete
  // ═══════════════════════════════════════════════════════════════════════

  init() {
    // ── Host riceve risposte ──────────────────────────────────────────
    Net.on('PLAYER_ANSWER', (fromId, msg) => {
      if (!State.isHost) return;
      if (State.answers[fromId]) return;  // già risposto

      const correct = msg.optionIdx === State.correctIdx;
      const elapsed = msg.time;  // ms dal via
      const totalMs = (State.settings.playSeconds + CONFIG.answerGraceSeconds) * 1000;
      let points = 0;
      if (correct) {
        const ratio = Math.max(0, 1 - (elapsed / totalMs));
        points = Math.round(CONFIG.minPointsPerRound +
          ratio * (CONFIG.maxPointsPerRound - CONFIG.minPointsPerRound));
      }

      State.answers[fromId] = { optionIdx: msg.optionIdx, time: elapsed, correct, points };
      State.roundScores[fromId] = points;

      // Aggiorna punteggi globali
      if (!State.scores[fromId]) State.scores[fromId] = 0;
      State.scores[fromId] += points;

      // Aggiorna stats
      this._updateStats(fromId, correct, elapsed);

      // Aggiorna vote counts
      if (msg.optionIdx >= 0 && msg.optionIdx < 4) {
        State.voteCounts[msg.optionIdx]++;
      }

      // Broadcast vote counts aggiornati
      Net.broadcast({ type: 'VOTE_UPDATE', counts: [...State.voteCounts] });
      UI.updateVoteCounts(State.voteCounts);

      // Tutti hanno risposto?
      const playerIds = Object.keys(State.players);
      const allAnswered = playerIds.every(id => State.answers[id]);
      if (allAnswered) {
        this._endRound();
      }
    });

    // ── Guest riceve aggiornamento voti ───────────────────────────────
    Net.on('VOTE_UPDATE', (_, msg) => {
      State.voteCounts = msg.counts;
      UI.updateVoteCounts(msg.counts);
    });

    // ── Tutti: ricevono inizio round ──────────────────────────────────
    Net.on('ROUND_START', (_, msg) => {
      if (State.isHost) return;  // Host lo gestisce direttamente
      State.resetRound();
      State.round = msg.round;
      State.totalRounds = msg.totalRounds;
      State.currentOptions = msg.options;
      State.correctIdx = msg.correctIdx;
      this._playRound(msg.videoId, msg.startSeconds);
    });

    // ── Tutti: ricevono risultato round ───────────────────────────────
    Net.on('ROUND_RESULT', (_, msg) => {
      if (State.isHost) return;
      State.scores = msg.scores;
      State.answers = msg.answers;
      State.roundScores = msg.roundScores;
      State.stats = msg.stats;
      UI.showRoundResult(msg);
    });

    // ── Tutti: ricevono fine partita ──────────────────────────────────
    Net.on('GAME_END', (_, msg) => {
      if (State.isHost) return;
      State.scores = msg.scores;
      State.stats = msg.stats;
      State.phase = 'results';
      UI.showResults(msg);
    });

    // ── Guest: riceve inizio partita ──────────────────────────────────
    Net.on('GAME_START', async (_, msg) => {
      if (State.isHost) return;
      State.playlist = msg.playlist;
      State.settings = msg.settings;
      State.totalRounds = msg.totalRounds;
      State.phase = 'game';
      State.resetGame();
      State.totalRounds = msg.totalRounds;
      UI.showScreen('game');
      UI.showWaiting('Preparazione in corso...');
      // Pre-inizializza player YouTube per il guest
      await YouTube.initPlayer();
      UI.showWaiting('In attesa del primo round...');
    });

    // ── Lobby handlers ───────────────────────────────────────────────
    Net.on('LOBBY_STATE', (_, msg) => {
      State.players = msg.players;
      // Mantieni il proprio player
      if (!State.players[State.myId]) {
        State.players[State.myId] = {
          id: State.myId, nickname: '', ready: false, isHost: false,
          score: 0, joinOrder: 99,
        };
      }
      UI.updateLobby();
    });

    Net.on('PLAYER_JOINED', (_, msg) => {
      State.players[msg.player.id] = msg.player;
      Audio.play('player_join');
      UI.updateLobby();
    });

    Net.on('PLAYER_LEFT', (_, msg) => {
      delete State.players[msg.id];
      UI.updateLobby();
    });

    Net.on('NICKNAME', (fromId, msg) => {
      if (State.players[fromId]) {
        State.players[fromId].nickname = msg.nickname;
        if (State.isHost) {
          Net.broadcast({ type: 'NICKNAME_UPDATE', id: fromId, nickname: msg.nickname });
        }
        UI.updateLobby();
      }
    });

    Net.on('NICKNAME_UPDATE', (_, msg) => {
      if (State.players[msg.id]) {
        State.players[msg.id].nickname = msg.nickname;
        UI.updateLobby();
      }
    });

    Net.on('PLAYER_READY', (fromId, msg) => {
      if (State.players[fromId]) {
        State.players[fromId].ready = msg.ready;
        if (State.isHost) {
          Net.broadcast({ type: 'READY_UPDATE', id: fromId, ready: msg.ready });
        }
        Audio.play('player_ready');
        UI.updateLobby();
      }
    });

    Net.on('READY_UPDATE', (_, msg) => {
      if (State.players[msg.id]) {
        State.players[msg.id].ready = msg.ready;
        UI.updateLobby();
      }
    });

    Net.on('REJECTED', (_, msg) => {
      UI.showError(msg.reason);
      Net.disconnect();
    });

    Net.on('HOST_DISCONNECTED', () => {
      UI.showError('L\'host ha chiuso la partita.');
      Net.disconnect();
    });
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  START GAME (solo host)
  // ═══════════════════════════════════════════════════════════════════════

  startGame() {
    if (!State.isHost) return;

    State.resetGame();
    State.phase = 'game';

    // Calcola quanti round
    let numSongs = State.settings.numSongs;
    if (numSongs === 0 || numSongs > State.playlist.length) {
      numSongs = State.playlist.length;
    }
    State.totalRounds = numSongs;

    // Init scores e stats per tutti
    for (const id of Object.keys(State.players)) {
      State.scores[id] = 0;
      State.stats[id] = {
        correct: 0, wrong: 0, noAnswer: 0,
        fastestTime: Infinity, totalTime: 0,
        streak: 0, maxStreak: 0, answers: [],
      };
    }

    // Broadcast inizio partita
    Net.broadcast({
      type: 'GAME_START',
      playlist: State.playlist,
      settings: State.settings,
      totalRounds: State.totalRounds,
    });

    UI.showScreen('game');
    Audio.play('game_start');

    // Primo round dopo un po'
    setTimeout(() => this._startNextRound(), 2000);
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  ROUND MANAGEMENT (solo host orchestra, tutti eseguono)
  // ═══════════════════════════════════════════════════════════════════════

  _startNextRound() {
    if (!State.isHost) return;

    State.round++;
    State.resetRound();

    if (State.round > State.totalRounds) {
      this._endGame();
      return;
    }

    // Scegli canzone corretta (non già usata)
    const available = State.playlist.filter((_, i) => !State.usedSongs.has(i));
    if (available.length === 0) { this._endGame(); return; }

    const correctSong = available[Math.floor(Math.random() * available.length)];
    const correctGlobalIdx = State.playlist.indexOf(correctSong);
    State.usedSongs.add(correctGlobalIdx);

    // Scegli 3 distrattori
    const distractors = State.playlist
      .filter((s, i) => i !== correctGlobalIdx)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);

    // Mescola le 4 opzioni
    const options = [correctSong, ...distractors]
      .map(s => ({ title: s.cleanTitle, videoId: s.videoId }))
      .sort(() => Math.random() - 0.5);

    const correctIdx = options.findIndex(o => o.videoId === correctSong.videoId);

    State.currentOptions = options;
    State.correctIdx = correctIdx;

    // Calcola punto di inizio
    let startSeconds = 0;
    if (State.settings.mode === 'random') {
      startSeconds = 20 + Math.floor(Math.random() * 100); // tra 20s e 120s
    }

    // Broadcast round start
    const roundMsg = {
      type: 'ROUND_START',
      round: State.round,
      totalRounds: State.totalRounds,
      videoId: correctSong.videoId,
      startSeconds,
      playSeconds: State.settings.playSeconds,
      options,
      correctIdx,
    };

    Net.broadcast(roundMsg);

    // Host esegue anche localmente
    this._playRound(correctSong.videoId, startSeconds);
  },

  _playRound(videoId, startSeconds) {
    Audio.play('round_start');
    UI.showRoundInfo();

    // Countdown 3-2-1-GO
    let count = CONFIG.countdownSeconds;
    UI.showCountdown(count);
    Audio.play('countdown_tick');

    this._countdownTimer = setInterval(() => {
      count--;
      if (count > 0) {
        UI.showCountdown(count);
        Audio.play('countdown_tick');
      } else {
        clearInterval(this._countdownTimer);
        UI.showCountdown('🎵');
        Audio.play('countdown_go');

        // Avvia musica
        State.roundStartTime = Date.now();
        State.musicPlaying = true;
        UI.startVisualizer();

        YouTube.play(videoId, startSeconds, State.settings.playSeconds, () => {
          // Musica finita
          State.musicPlaying = false;
          UI.stopVisualizer();
        }).catch(() => {
          // Se YouTube fallisce, continua comunque il round
          console.warn('YouTube play failed');
        });

        // Timer per fine risposta (play + grace)
        const totalMs = (State.settings.playSeconds + CONFIG.answerGraceSeconds) * 1000;
        UI.startTimer(totalMs);

        this._answerTimeout = setTimeout(() => {
          if (State.isHost) this._endRound();
        }, totalMs);
      }
    }, 1000);
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  RISPONDI (lato giocatore)
  // ═══════════════════════════════════════════════════════════════════════

  submitAnswer(optionIdx) {
    if (State.answered) return;
    State.answered = true;
    State.myAnswer = optionIdx;

    const elapsed = Date.now() - State.roundStartTime;
    const correct = optionIdx === State.correctIdx;

    Audio.play('answer_select');

    // Mostra feedback immediato
    UI.showAnswerFeedback(optionIdx, correct);

    if (State.isHost) {
      // Host processa localmente
      const totalMs = (State.settings.playSeconds + CONFIG.answerGraceSeconds) * 1000;
      const ratio = Math.max(0, 1 - (elapsed / totalMs));
      let points = 0;
      if (correct) {
        points = Math.round(CONFIG.minPointsPerRound +
          ratio * (CONFIG.maxPointsPerRound - CONFIG.minPointsPerRound));
      }

      State.answers[State.myId] = { optionIdx, time: elapsed, correct, points };
      State.roundScores[State.myId] = points;
      State.scores[State.myId] = (State.scores[State.myId] || 0) + points;
      State.voteCounts[optionIdx]++;
      this._updateStats(State.myId, correct, elapsed);

      Net.broadcast({ type: 'VOTE_UPDATE', counts: [...State.voteCounts] });
      UI.updateVoteCounts(State.voteCounts);

      // Tutti hanno risposto?
      const allAnswered = Object.keys(State.players).every(id => State.answers[id]);
      if (allAnswered) this._endRound();

    } else {
      // Guest manda al host
      Net.send({ type: 'PLAYER_ANSWER', optionIdx, time: elapsed });
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  FINE ROUND (solo host)
  // ═══════════════════════════════════════════════════════════════════════

  _endRound() {
    if (this._answerTimeout) { clearTimeout(this._answerTimeout); this._answerTimeout = null; }

    YouTube.stop();
    State.musicPlaying = false;
    UI.stopVisualizer();
    UI.stopTimer();

    // Giocatori che non hanno risposto
    for (const id of Object.keys(State.players)) {
      if (!State.answers[id]) {
        State.answers[id] = { optionIdx: -1, time: 0, correct: false, points: 0 };
        State.roundScores[id] = 0;
        this._updateStats(id, false, 0, true);
      }
    }

    const resultMsg = {
      type: 'ROUND_RESULT',
      round: State.round,
      correctIdx: State.correctIdx,
      correctTitle: State.currentOptions[State.correctIdx]?.title,
      answers: State.answers,
      scores: { ...State.scores },
      roundScores: { ...State.roundScores },
      stats: JSON.parse(JSON.stringify(State.stats)),
    };

    Net.broadcast(resultMsg);
    UI.showRoundResult(resultMsg);

    // Prossimo round dopo la pausa
    setTimeout(() => {
      if (State.round >= State.totalRounds) {
        this._endGame();
      } else {
        this._startNextRound();
      }
    }, CONFIG.resultDisplaySeconds * 1000);
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  FINE PARTITA (solo host)
  // ═══════════════════════════════════════════════════════════════════════

  _endGame() {
    State.phase = 'results';

    const endMsg = {
      type: 'GAME_END',
      scores: { ...State.scores },
      stats: JSON.parse(JSON.stringify(State.stats)),
      players: State.players,
    };

    Net.broadcast(endMsg);
    UI.showResults(endMsg);
    Audio.play('fanfare');
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  STATS
  // ═══════════════════════════════════════════════════════════════════════

  _updateStats(playerId, correct, elapsed, noAnswer) {
    if (!State.stats[playerId]) {
      State.stats[playerId] = {
        correct: 0, wrong: 0, noAnswer: 0,
        fastestTime: Infinity, totalTime: 0,
        streak: 0, maxStreak: 0, answers: [],
      };
    }
    const s = State.stats[playerId];

    if (noAnswer) {
      s.noAnswer++;
      s.streak = 0;
      s.answers.push({ correct: false, time: 0, noAnswer: true });
    } else if (correct) {
      s.correct++;
      s.streak++;
      if (s.streak > s.maxStreak) s.maxStreak = s.streak;
      if (elapsed < s.fastestTime) s.fastestTime = elapsed;
      s.totalTime += elapsed;
      s.answers.push({ correct: true, time: elapsed });
    } else {
      s.wrong++;
      s.streak = 0;
      s.totalTime += elapsed;
      s.answers.push({ correct: false, time: elapsed });
    }
  },
};

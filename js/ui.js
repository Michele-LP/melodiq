// ═══════════════════════════════════════════════════════════════════════════
//  UI.JS — Rendering e interazione DOM per MelodiQ
// ═══════════════════════════════════════════════════════════════════════════

const UI = {

  _visualizerFrame: null,
  _timerFrame: null,
  _timerEnd: 0,

  // ── Utility DOM ──────────────────────────────────────────────────────
  $(id) { return document.getElementById(id); },

  // ═══════════════════════════════════════════════════════════════════════
  //  SCHERMATE
  // ═══════════════════════════════════════════════════════════════════════

  showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = this.$('screen-' + name);
    if (screen) screen.classList.add('active');
    State.phase = name === 'game' ? 'game' : name === 'results' ? 'results' : 'lobby';
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  HOME
  // ═══════════════════════════════════════════════════════════════════════

  initHome() {
    this.$('btn-create').onclick = () => {
      Audio.init();
      Audio.play('click');
      this.showScreen('setup');
    };

    this.$('btn-join').onclick = () => {
      Audio.init();
      Audio.play('click');
      const code = this.$('input-code').value.trim().toUpperCase();
      if (!code || code.length < 4) {
        this._shake(this.$('input-code'));
        return;
      }
      this._joinGame(code);
    };

    this.$('input-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.$('btn-join').click();
    });
  },

  async _joinGame(code) {
    this.$('btn-join').disabled = true;
    this.$('btn-join').textContent = 'Connessione...';
    try {
      await Net.joinRoom(code);
      Audio.init();
      Audio.play('player_join');
      this.showScreen('lobby');
      this._initLobbyGuest();
    } catch (err) {
      this.showError('Impossibile connettersi: ' + err);
    }
    this.$('btn-join').disabled = false;
    this.$('btn-join').textContent = 'Entra';
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  SETUP (Host)
  // ═══════════════════════════════════════════════════════════════════════

  initSetup() {
    const slider = this.$('slider-seconds');
    const sliderVal = this.$('slider-value');
    slider.oninput = () => { sliderVal.textContent = slider.value + 's'; };

    // Mode toggle
    this.$('btn-mode-start').onclick = () => {
      this.$('btn-mode-start').classList.add('selected');
      this.$('btn-mode-random').classList.remove('selected');
      State.settings.mode = 'start';
    };
    this.$('btn-mode-random').onclick = () => {
      this.$('btn-mode-random').classList.add('selected');
      this.$('btn-mode-start').classList.remove('selected');
      State.settings.mode = 'random';
    };

    // Song count buttons
    this.$('song-count-btns').querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        this.$('song-count-btns').querySelectorAll('button').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        State.settings.numSongs = parseInt(btn.dataset.count);
      };
    });

    // Validate playlist
    this.$('btn-validate').onclick = () => this._validatePlaylist();

    // Create lobby
    this.$('btn-create-lobby').onclick = () => this._createLobby();
  },

  async _validatePlaylist() {
    const url = this.$('input-playlist').value.trim();
    const status = this.$('playlist-status');
    const btnCreate = this.$('btn-create-lobby');

    if (!url) {
      status.textContent = '❌ Inserisci l\'URL della playlist YouTube';
      status.className = 'status-msg error';
      return;
    }

    const plId = YouTube.extractPlaylistId(url);
    if (!plId) {
      status.textContent = '❌ URL non valido. Deve contenere "list=..."';
      status.className = 'status-msg error';
      return;
    }

    status.textContent = '⏳ Caricamento playlist...';
    status.className = 'status-msg loading';
    this.$('btn-validate').disabled = true;

    const progressEl = this.$('playlist-progress');
    const result = await YouTube.loadPlaylist(url, (loaded, total) => {
      progressEl.textContent = `Caricamento titoli: ${loaded}/${total}`;
    });

    this.$('btn-validate').disabled = false;
    progressEl.textContent = '';

    if (result.error) {
      status.textContent = '❌ ' + result.error;
      status.className = 'status-msg error';
      return;
    }

    if (result.songs.length < CONFIG.minPlaylistSongs) {
      status.textContent = `❌ La playlist ha solo ${result.songs.length} brani. Servono almeno ${CONFIG.minPlaylistSongs}.`;
      status.className = 'status-msg error';
      return;
    }

    State.playlist = result.songs;
    status.textContent = `✅ Playlist caricata: ${result.songs.length} brani trovati!`;
    status.className = 'status-msg success';
    btnCreate.disabled = false;
    btnCreate.classList.add('pulse');

    // Aggiorna opzioni numero canzoni
    this.$('song-count-btns').querySelectorAll('button').forEach(btn => {
      const count = parseInt(btn.dataset.count);
      if (count > 0 && count > result.songs.length) {
        btn.disabled = true;
        btn.classList.remove('selected');
      }
    });
  },

  async _createLobby() {
    State.settings.playSeconds = parseInt(this.$('slider-seconds').value);

    try {
      const code = await Net.createRoom();
      const nickname = 'Host';
      State.players[State.myId].nickname = nickname;
      this.showScreen('lobby');
      this._initLobbyHost(code);
    } catch (err) {
      this.showError('Errore creazione stanza: ' + err);
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  LOBBY
  // ═══════════════════════════════════════════════════════════════════════

  _initLobbyHost(code) {
    this.$('lobby-code').textContent = code;
    this.$('lobby-host-controls').style.display = '';
    this.$('btn-start-game').onclick = () => {
      Audio.play('click');
      Game.startGame();
    };
    this._setupNickname();
    this.updateLobby();
  },

  _initLobbyGuest() {
    this.$('lobby-code').textContent = State.roomCode;
    this.$('lobby-host-controls').style.display = 'none';
    this._setupNickname();
    this.updateLobby();
  },

  _setupNickname() {
    const input = this.$('input-nickname');
    const btn = this.$('btn-ready');

    input.addEventListener('input', () => {
      const nick = input.value.trim().slice(0, 16);
      State.players[State.myId].nickname = nick;
      if (State.isHost) {
        Net.broadcast({ type: 'NICKNAME_UPDATE', id: State.myId, nickname: nick });
        this.updateLobby();
      } else {
        Net.send({ type: 'NICKNAME', nickname: nick });
      }
    });

    btn.onclick = () => {
      const nick = input.value.trim();
      if (!nick) {
        this._shake(input);
        return;
      }
      Audio.play('click');
      const ready = !State.players[State.myId].ready;
      State.players[State.myId].ready = ready;
      btn.textContent = ready ? '✅ Pronto!' : 'Pronto?';
      btn.classList.toggle('ready-active', ready);

      if (State.isHost) {
        Net.broadcast({ type: 'READY_UPDATE', id: State.myId, ready });
      } else {
        Net.send({ type: 'PLAYER_READY', ready });
      }
      this.updateLobby();
    };
  },

  updateLobby() {
    const list = this.$('player-list');
    if (!list) return;

    const sorted = Object.values(State.players).sort((a, b) => a.joinOrder - b.joinOrder);

    list.innerHTML = sorted.map(p => `
      <div class="player-card ${p.ready ? 'ready' : ''} ${p.id === State.myId ? 'me' : ''}">
        <span class="player-avatar">${p.nickname ? p.nickname[0].toUpperCase() : '?'}</span>
        <span class="player-name">${p.nickname || 'In attesa...'}</span>
        ${p.isHost ? '<span class="badge host-badge">HOST</span>' : ''}
        <span class="badge ${p.ready ? 'ready-badge' : 'waiting-badge'}">${p.ready ? '✅' : '⏳'}</span>
      </div>
    `).join('');

    // Abilita start solo se tutti pronti e almeno 2 giocatori
    if (State.isHost) {
      const players = Object.values(State.players);
      const allReady = players.every(p => p.ready);
      const enough = players.length >= 2;
      const btn = this.$('btn-start-game');
      btn.disabled = !(allReady && enough);
      if (!enough) {
        btn.textContent = 'Servono almeno 2 giocatori';
      } else if (!allReady) {
        btn.textContent = 'In attesa che tutti siano pronti...';
      } else {
        btn.textContent = '🎵 Inizia Partita!';
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  GAME SCREEN
  // ═══════════════════════════════════════════════════════════════════════

  showRoundInfo() {
    this.$('round-counter').textContent = `Round ${State.round}/${State.totalRounds}`;
    this.$('game-status').textContent = '';
    this.$('game-status').className = 'game-status';
    this.$('round-sidebar').classList.remove('visible');
    this.$('round-sidebar').innerHTML = '';

    // Mostra opzioni
    const grid = this.$('options-grid');
    grid.innerHTML = '';
    State.currentOptions.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.innerHTML = `
        <span class="option-title">${opt.title}</span>
        <span class="option-votes">0</span>
      `;
      btn.onclick = () => {
        if (!State.answered) {
          Game.submitAnswer(i);
        }
      };
      grid.appendChild(btn);
    });
  },

  showCountdown(val) {
    const el = this.$('countdown-display');
    el.textContent = val;
    el.className = 'countdown-display visible';
    if (val === '🎵') {
      setTimeout(() => el.classList.remove('visible'), 800);
    }
  },

  showWaiting(text) {
    this.$('game-status').textContent = text;
  },

  showAnswerFeedback(optionIdx, correct) {
    const buttons = this.$('options-grid').querySelectorAll('.option-btn');
    buttons.forEach((btn, i) => {
      if (i === optionIdx) {
        btn.classList.add(correct ? 'correct' : 'wrong');
        btn.classList.add('selected');
      }
      btn.classList.add('answered');
    });

    // Feedback sonoro dopo un piccolo delay
    setTimeout(() => {
      Audio.play(correct ? 'correct' : 'wrong');
    }, 200);
  },

  updateVoteCounts(counts) {
    const buttons = this.$('options-grid').querySelectorAll('.option-btn');
    buttons.forEach((btn, i) => {
      const voteEl = btn.querySelector('.option-votes');
      if (voteEl && counts[i] > 0) {
        voteEl.textContent = counts[i];
        voteEl.classList.add('has-votes');
      }
    });
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  ROUND RESULT
  // ═══════════════════════════════════════════════════════════════════════

  showRoundResult(msg) {
    YouTube.stop();

    // Evidenzia risposta corretta
    const buttons = this.$('options-grid').querySelectorAll('.option-btn');
    buttons.forEach((btn, i) => {
      btn.classList.remove('correct', 'wrong', 'selected');
      btn.classList.add('answered');
      if (i === (msg.correctIdx ?? State.correctIdx)) {
        btn.classList.add('correct', 'reveal');
      }
    });

    // Se il giocatore ha sbagliato, mostra anche la sua scelta
    if (State.myAnswer >= 0 && State.myAnswer !== (msg.correctIdx ?? State.correctIdx)) {
      buttons[State.myAnswer]?.classList.add('wrong', 'selected');
    }

    // Mostra mini-leaderboard
    const sidebar = this.$('round-sidebar');
    const players = Object.values(State.players).sort((a, b) =>
      (msg.scores[b.id] || 0) - (msg.scores[a.id] || 0)
    );

    let sidebarHtml = '<h3>Classifica</h3>';
    players.forEach((p, i) => {
      const answer = msg.answers[p.id];
      const roundPts = msg.roundScores?.[p.id] || 0;
      const totalPts = msg.scores[p.id] || 0;
      const icon = answer?.correct ? '✅' : (answer?.optionIdx === -1 ? '⏰' : '❌');

      sidebarHtml += `
        <div class="sidebar-player ${p.id === State.myId ? 'me' : ''}">
          <span class="sidebar-rank">${i + 1}.</span>
          <span class="sidebar-name">${p.nickname}</span>
          <span class="sidebar-result">${icon}</span>
          <span class="sidebar-pts">+${roundPts}</span>
          <span class="sidebar-total">${totalPts}</span>
        </div>
      `;
    });
    sidebar.innerHTML = sidebarHtml;
    sidebar.classList.add('visible');

    // Status
    const myAnswer = msg.answers[State.myId];
    if (myAnswer?.correct) {
      this.$('game-status').textContent = `Corretto! +${msg.roundScores[State.myId]} punti`;
      this.$('game-status').className = 'game-status correct-text';
    } else if (myAnswer?.optionIdx === -1) {
      this.$('game-status').textContent = 'Tempo scaduto!';
      this.$('game-status').className = 'game-status wrong-text';
    } else {
      this.$('game-status').textContent = `Sbagliato! Era: ${msg.correctTitle || State.currentOptions[State.correctIdx]?.title}`;
      this.$('game-status').className = 'game-status wrong-text';
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  FINAL RESULTS
  // ═══════════════════════════════════════════════════════════════════════

  showResults(msg) {
    State.phase = 'results';
    this.showScreen('results');

    const players = Object.values(msg.players || State.players)
      .sort((a, b) => (msg.scores[b.id] || 0) - (msg.scores[a.id] || 0));

    // Podio
    let html = '<div class="podium">';
    const medals = ['🥇', '🥈', '🥉'];
    players.forEach((p, i) => {
      const stats = msg.stats[p.id] || {};
      const score = msg.scores[p.id] || 0;
      html += `
        <div class="result-card ${i === 0 ? 'winner' : ''} ${p.id === State.myId ? 'me' : ''}">
          <div class="result-rank">${medals[i] || (i + 1) + '°'}</div>
          <div class="result-name">${p.nickname}</div>
          <div class="result-score">${score} pt</div>
          <div class="result-details">
            ✅ ${stats.correct || 0} &nbsp; ❌ ${stats.wrong || 0} &nbsp; ⏰ ${stats.noAnswer || 0}
          </div>
        </div>
      `;
    });
    html += '</div>';

    // Stats e premi
    html += '<div class="awards">';

    // Risposta più veloce
    let fastestId = null, fastestTime = Infinity;
    for (const [id, s] of Object.entries(msg.stats)) {
      if (s.fastestTime < fastestTime && s.fastestTime < Infinity) {
        fastestTime = s.fastestTime;
        fastestId = id;
      }
    }
    if (fastestId) {
      const p = State.players[fastestId];
      html += `<div class="award">⚡ <strong>Riflessi Fulminei</strong> — ${p?.nickname} (${(fastestTime / 1000).toFixed(2)}s)</div>`;
    }

    // Streak più lunga
    let streakId = null, maxStreak = 0;
    for (const [id, s] of Object.entries(msg.stats)) {
      if (s.maxStreak > maxStreak) {
        maxStreak = s.maxStreak;
        streakId = id;
      }
    }
    if (streakId && maxStreak > 1) {
      const p = State.players[streakId];
      html += `<div class="award">🔥 <strong>In Fiamme</strong> — ${p?.nickname} (${maxStreak} di fila)</div>`;
    }

    // Più risposte sbagliate
    let wrongId = null, maxWrong = 0;
    for (const [id, s] of Object.entries(msg.stats)) {
      if (s.wrong > maxWrong) {
        maxWrong = s.wrong;
        wrongId = id;
      }
    }
    if (wrongId && maxWrong > 0) {
      const p = State.players[wrongId];
      html += `<div class="award">🙉 <strong>Orecchie di Latta</strong> — ${p?.nickname} (${maxWrong} errori)</div>`;
    }

    // Shazam — più risposte corrette
    let shazamId = null, maxCorrect = 0;
    for (const [id, s] of Object.entries(msg.stats)) {
      if (s.correct > maxCorrect) {
        maxCorrect = s.correct;
        shazamId = id;
      }
    }
    if (shazamId) {
      const p = State.players[shazamId];
      html += `<div class="award">🎧 <strong>Shazam Umano</strong> — ${p?.nickname} (${maxCorrect}/${State.totalRounds})</div>`;
    }

    // Più timeout
    let timeoutId = null, maxTimeout = 0;
    for (const [id, s] of Object.entries(msg.stats)) {
      if ((s.noAnswer || 0) > maxTimeout) {
        maxTimeout = s.noAnswer;
        timeoutId = id;
      }
    }
    if (timeoutId && maxTimeout > 1) {
      const p = State.players[timeoutId];
      html += `<div class="award">😴 <strong>Sonnambulo</strong> — ${p?.nickname} (${maxTimeout} timeout)</div>`;
    }

    html += '</div>';

    // Bottone nuova partita
    html += `<button class="btn-primary btn-new-game" id="btn-new-game">🏠 Torna alla Home</button>`;

    this.$('results-content').innerHTML = html;
    this.$('btn-new-game').onclick = () => {
      window.location.reload();
    };
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  VISUALIZER (finto — barre animate casuali)
  // ═══════════════════════════════════════════════════════════════════════

  startVisualizer() {
    const container = this.$('visualizer');
    if (!container) return;
    container.classList.add('active');

    // Crea barre se non esistono
    if (!container.children.length) {
      for (let i = 0; i < 32; i++) {
        const bar = document.createElement('div');
        bar.className = 'viz-bar';
        container.appendChild(bar);
      }
    }

    const bars = container.querySelectorAll('.viz-bar');
    const animate = () => {
      if (!State.musicPlaying) return;
      bars.forEach(bar => {
        const h = Math.random() * 80 + 5;
        bar.style.height = h + '%';
      });
      this._visualizerFrame = requestAnimationFrame(animate);
    };
    animate();
  },

  stopVisualizer() {
    if (this._visualizerFrame) {
      cancelAnimationFrame(this._visualizerFrame);
      this._visualizerFrame = null;
    }
    const container = this.$('visualizer');
    if (container) {
      container.classList.remove('active');
      container.querySelectorAll('.viz-bar').forEach(bar => {
        bar.style.height = '5%';
      });
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  TIMER
  // ═══════════════════════════════════════════════════════════════════════

  startTimer(totalMs) {
    this._timerEnd = Date.now() + totalMs;
    const bar = this.$('timer-bar');
    const text = this.$('timer-text');
    if (!bar) return;

    const tick = () => {
      const remaining = Math.max(0, this._timerEnd - Date.now());
      const pct = (remaining / totalMs) * 100;
      bar.style.width = pct + '%';

      const secs = Math.ceil(remaining / 1000);
      text.textContent = secs + 's';

      if (pct < 20) bar.classList.add('critical');
      else bar.classList.remove('critical');

      if (secs === 3 && !bar.dataset.warned) {
        bar.dataset.warned = '1';
        Audio.play('time_warning');
      }

      if (remaining > 0) {
        this._timerFrame = requestAnimationFrame(tick);
      } else {
        text.textContent = '0s';
        bar.style.width = '0%';
      }
    };
    bar.dataset.warned = '';
    tick();
  },

  stopTimer() {
    if (this._timerFrame) {
      cancelAnimationFrame(this._timerFrame);
      this._timerFrame = null;
    }
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  UTILITY
  // ═══════════════════════════════════════════════════════════════════════

  showError(msg) {
    const el = this.$('global-error');
    el.textContent = msg;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 5000);
  },

  _shake(el) {
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 500);
  },
};

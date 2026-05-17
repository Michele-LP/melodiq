// ═══════════════════════════════════════════════════════════════════════════
//  NET.JS — Networking P2P con PeerJS per MelodiQ
//  Architettura: Host ↔ Guest star topology (host = authority)
// ═══════════════════════════════════════════════════════════════════════════

const Net = {

  _handlers: {},   // { msgType: [fn, fn, ...] }

  // ── Genera codice stanza ─────────────────────────────────────────────
  _genCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  CREA STANZA — HOST
  // ═══════════════════════════════════════════════════════════════════════
  createRoom() {
    return new Promise((resolve, reject) => {
      const code   = this._genCode();
      const peerId = CONFIG.peerPrefix + code.toLowerCase();

      State.isHost   = true;
      State.roomCode = code;
      State.peer     = new Peer(peerId, { debug: CONFIG.peerDebug });

      State.peer.on('open', () => {
        State.myId = peerId;
        State.players[State.myId] = {
          id: State.myId, nickname: '', ready: false, isHost: true,
          score: 0, joinOrder: 0,
        };
        resolve(code);
      });

      State.peer.on('connection', (conn) => {
        State.conns[conn.peer] = conn;
        this._setupGuestConn(conn);
      });

      State.peer.on('error', (e) => reject(e.type));
    });
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  ENTRA IN STANZA — GUEST
  // ═══════════════════════════════════════════════════════════════════════
  joinRoom(code) {
    return new Promise((resolve, reject) => {
      State.isHost   = false;
      State.roomCode = code.toUpperCase();
      State.peer     = new Peer({ debug: CONFIG.peerDebug });

      State.peer.on('open', (id) => {
        State.myId = id;
        State.players[State.myId] = {
          id: State.myId, nickname: '', ready: false, isHost: false,
          score: 0, joinOrder: 99,
        };

        const hostPeerId = CONFIG.peerPrefix + code.toLowerCase();
        State.conn = State.peer.connect(hostPeerId, { reliable: true });

        State.conn.on('open', () => {
          this._setupHostConn(State.conn);
          resolve();
        });

        State.conn.on('error', (e) => reject('Connessione fallita: ' + e));

        // Timeout connessione
        setTimeout(() => reject('Timeout: stanza non trovata'), 10000);
      });

      State.peer.on('error', (e) => reject(e.type));
    });
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  SETUP CONNESSIONE GUEST → lato HOST
  // ═══════════════════════════════════════════════════════════════════════
  _setupGuestConn(conn) {
    const guestId = conn.peer;

    conn.on('open', () => {
      // Se la partita è già in corso, rifiuta
      if (State.phase === 'game' || State.phase === 'results') {
        this.sendTo(guestId, { type: 'REJECTED', reason: 'Partita già in corso' });
        setTimeout(() => { conn.close(); delete State.conns[guestId]; }, 200);
        return;
      }

      // Lobby piena?
      if (Object.keys(State.players).length >= CONFIG.maxPlayers) {
        this.sendTo(guestId, { type: 'REJECTED', reason: 'Partita piena (max ' + CONFIG.maxPlayers + ')' });
        setTimeout(() => { conn.close(); delete State.conns[guestId]; }, 200);
        return;
      }

      // Accettato
      const newPlayer = {
        id: guestId, nickname: '', ready: false, isHost: false,
        score: 0, joinOrder: Object.keys(State.players).length,
      };
      State.players[guestId] = newPlayer;

      // Invia stato lobby al nuovo arrivato
      this.sendTo(guestId, { type: 'LOBBY_STATE', players: State.players });
      // Notifica gli altri
      this._relayExcept(guestId, { type: 'PLAYER_JOINED', player: newPlayer });
      // Dispatch locale
      this._dispatch(guestId, { type: 'PLAYER_JOINED', player: newPlayer });
    });

    conn.on('data', (msg) => {
      this._dispatch(guestId, msg);
      // Relay broadcast messages
      if (msg.relay) this._relayExcept(guestId, { ...msg, from: guestId });
    });

    conn.on('close', () => {
      delete State.conns[guestId];
      delete State.players[guestId];
      this._relayExcept(guestId, { type: 'PLAYER_LEFT', id: guestId });
      this._dispatch('system', { type: 'PLAYER_LEFT', id: guestId });
    });

    conn.on('error', (e) => console.warn('[Net] guest conn error', guestId, e));
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  SETUP CONNESSIONE HOST → lato GUEST
  // ═══════════════════════════════════════════════════════════════════════
  _setupHostConn(conn) {
    conn.on('data', (msg) => this._dispatch(msg.from ?? 'host', msg));
    conn.on('close', () => this._dispatch('system', { type: 'HOST_DISCONNECTED' }));
    conn.on('error', (e) => console.warn('[Net] host conn error', e));
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  INVIO MESSAGGI
  // ═══════════════════════════════════════════════════════════════════════
  sendTo(peerId, msg) {
    const c = State.conns[peerId];
    if (c && c.open) c.send(msg);
  },

  broadcast(msg) {
    for (const c of Object.values(State.conns)) {
      if (c.open) c.send(msg);
    }
  },

  _relayExcept(exceptId, msg) {
    for (const [id, c] of Object.entries(State.conns)) {
      if (id !== exceptId && c.open) c.send(msg);
    }
  },

  /** Guest → Host */
  send(msg) {
    if (State.conn && State.conn.open) State.conn.send(msg);
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  EVENT SYSTEM
  // ═══════════════════════════════════════════════════════════════════════

  on(msgType, fn) {
    if (!this._handlers[msgType]) this._handlers[msgType] = [];
    this._handlers[msgType].push(fn);
  },

  off(msgType, fn) {
    if (!this._handlers[msgType]) return;
    this._handlers[msgType] = this._handlers[msgType].filter(f => f !== fn);
  },

  _dispatch(fromId, msg) {
    const fns = this._handlers[msg.type];
    if (fns) fns.forEach(fn => fn(fromId, msg));
    // Anche handler wildcard
    const wild = this._handlers['*'];
    if (wild) wild.forEach(fn => fn(fromId, msg));
  },

  // ═══════════════════════════════════════════════════════════════════════
  //  CLEANUP
  // ═══════════════════════════════════════════════════════════════════════
  disconnect() {
    if (State.peer) {
      State.peer.destroy();
      State.peer = null;
    }
    State.conn = null;
    State.conns = {};
  },
};

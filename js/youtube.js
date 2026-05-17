// ═══════════════════════════════════════════════════════════════════════════
//  YOUTUBE.JS — Wrapper YouTube IFrame API
//  Gestisce caricamento playlist, estrazione titoli, riproduzione nascosta.
// ═══════════════════════════════════════════════════════════════════════════

const YouTube = (() => {
  let _player = null;
  let _ready = false;
  let _apiLoaded = false;
  let _onReadyCb = null;
  let _stopTimer = null;

  // ── Carica YouTube IFrame API ────────────────────────────────────────

  function _loadAPI() {
    return new Promise((resolve) => {
      if (_apiLoaded) { resolve(); return; }
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = () => {
        _apiLoaded = true;
        resolve();
      };
    });
  }

  // ── Estrai playlist ID da URL ────────────────────────────────────────

  function _extractPlaylistId(url) {
    const m = url.match(/[?&]list=([^&]+)/);
    return m ? m[1] : null;
  }

  // ── Pulisci titolo da suffissi comuni ─────────────────────────────────

  function _cleanTitle(title) {
    if (!title) return 'Sconosciuto';
    return title
      .replace(/\s*[\(\[](official\s*(video|audio|music\s*video|lyric\s*video|visualizer)|lyrics?|audio(\s*only)?|video|hd|hq|4k|remaster(ed)?|live|visuali[sz]er|clip\s*(ufficiale|officiel)|video\s*ufficiale|videoclip|explicit|clean|with\s*lyrics?)[\)\]]/gi, '')
      .replace(/\s*[\(\[]feat\.?\s*[^)\]]*[\)\]]/gi, '')
      .replace(/\s*[\(\[]ft\.?\s*[^)\]]*[\)\]]/gi, '')
      .replace(/\s*\|\s*.*$/, '')
      .replace(/\s*\/\/\s*.*$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // ── Fetch titolo via noembed (CORS-friendly) ─────────────────────────

  async function _fetchTitle(videoId) {
    try {
      const url = `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(resp.status);
      const data = await resp.json();
      const raw = data.title || '';
      return { videoId, title: raw, cleanTitle: _cleanTitle(raw) };
    } catch {
      return { videoId, title: '', cleanTitle: 'Brano sconosciuto' };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════

  return {

    /**
     * Carica una playlist YouTube e restituisce i dati dei brani.
     * @param {string} playlistUrl — URL della playlist
     * @param {function} onProgress — callback(loaded, total) per progresso
     * @returns {Promise<{songs: Array, error: string|null}>}
     */
    async loadPlaylist(playlistUrl, onProgress) {
      const playlistId = _extractPlaylistId(playlistUrl);
      if (!playlistId) {
        return { songs: [], error: 'URL playlist non valido. Assicurati che contenga "list=..."' };
      }

      await _loadAPI();

      // Crea player nascosto per caricare la playlist
      return new Promise((resolve) => {
        // Rimuovi player precedente
        if (_player) {
          try { _player.destroy(); } catch {}
          _player = null;
        }

        const container = document.getElementById('yt-player');
        if (!container) {
          resolve({ songs: [], error: 'Container YouTube non trovato (#yt-player)' });
          return;
        }

        // Crea un div fresco per il player
        container.innerHTML = '<div id="yt-player-inner"></div>';

        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve({ songs: [], error: 'Timeout caricamento playlist. Verifica che la playlist sia pubblica.' });
          }
        }, 20000);

        _player = new YT.Player('yt-player-inner', {
          height: '1',
          width: '1',
          playerVars: {
            listType: 'playlist',
            list: playlistId,
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
          },
          events: {
            onReady: () => {
              _ready = true;
              // Mute e play per caricare playlist
              _player.mute();
              _player.playVideo();
            },
            onStateChange: async (e) => {
              if (resolved) return;
              // Quando inizia a riprodurre, la playlist è caricata
              if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.CUED) {
                _player.pauseVideo();
                const videoIds = _player.getPlaylist();
                if (!videoIds || videoIds.length === 0) {
                  // Riprova dopo un po'
                  setTimeout(() => {
                    if (resolved) return;
                    const ids2 = _player.getPlaylist();
                    if (!ids2 || ids2.length === 0) {
                      resolved = true;
                      clearTimeout(timeout);
                      resolve({ songs: [], error: 'Impossibile leggere la playlist. Verifica che sia pubblica e non vuota.' });
                    }
                  }, 2000);
                  return;
                }

                clearTimeout(timeout);

                // Fetch titoli via noembed
                const total = videoIds.length;
                if (onProgress) onProgress(0, total);

                const songs = [];
                // Batch di 5 per non sovraccaricare noembed
                for (let i = 0; i < videoIds.length; i += 5) {
                  const batch = videoIds.slice(i, i + 5);
                  const results = await Promise.all(batch.map(id => _fetchTitle(id)));
                  songs.push(...results);
                  if (onProgress) onProgress(songs.length, total);
                }

                resolved = true;
                resolve({ songs, error: null });
              }
            },
            onError: (e) => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve({ songs: [], error: `Errore YouTube (${e.data}). La playlist potrebbe essere privata.` });
              }
            },
          },
        });
      });
    },

    /**
     * Riproduce un video per un tempo specifico.
     * Se il player non è pronto, lo inizializza automaticamente.
     */
    async play(videoId, startSeconds, playSeconds, onEnd) {
      if (!_player || !_ready) {
        await this.initPlayer();
      }
      if (!_player || !_ready) return;  // Fallback: impossibile inizializzare
      if (_stopTimer) clearTimeout(_stopTimer);

      _player.unMute();
      _player.setVolume(100);
      _player.loadVideoById({ videoId, startSeconds });

      _stopTimer = setTimeout(() => {
        _player.pauseVideo();
        if (onEnd) onEnd();
      }, playSeconds * 1000);
    },

    /** Ferma la riproduzione */
    stop() {
      if (_stopTimer) { clearTimeout(_stopTimer); _stopTimer = null; }
      if (_player && _ready) {
        try { _player.pauseVideo(); } catch {}
      }
    },

    /** Distruggi player */
    destroy() {
      this.stop();
      if (_player) {
        try { _player.destroy(); } catch {}
        _player = null;
        _ready = false;
      }
    },

    /**
     * Inizializza un player semplice (per guest, senza playlist).
     * Da chiamare prima di play() se non è stato fatto loadPlaylist().
     */
    async initPlayer() {
      if (_player && _ready) return;

      await _loadAPI();

      return new Promise((resolve) => {
        if (_player) {
          try { _player.destroy(); } catch {}
          _player = null;
          _ready = false;
        }

        const container = document.getElementById('yt-player');
        if (!container) { resolve(); return; }
        container.innerHTML = '<div id="yt-player-inner"></div>';

        _player = new YT.Player('yt-player-inner', {
          height: '1',
          width: '1',
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
          },
          events: {
            onReady: () => {
              _ready = true;
              resolve();
            },
            onError: () => resolve(),
          },
        });

        // Timeout di sicurezza
        setTimeout(resolve, 8000);
      });
    },

    /** True se il player è pronto per riprodurre */
    isReady() { return _player && _ready; },

    /** Helper per estrarre playlist ID (per validazione) */
    extractPlaylistId: _extractPlaylistId,
  };
})();

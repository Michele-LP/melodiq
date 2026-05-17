// ═══════════════════════════════════════════════════════════════════════════
//  APP.JS — Entry point MelodiQ
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  UI.initHome();
  UI.initSetup();
  Game.init();

  // Click iniziale per attivare audio
  document.addEventListener('click', () => Audio.init(), { once: true });
});

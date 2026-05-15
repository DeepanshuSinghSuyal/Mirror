/* ================================================
   MIRROR Bot — Main Application Controller
   Fixed: chat persists, click debounce, reliable reactivation
   ================================================ */
const MirrorApp = (() => {
  let isActive = false;
  let isBooted = false;
  let inactivityTimer = null;
  let clickDebounce = null;
  const INACTIVITY_TIMEOUT = 60000; // 60s auto-deactivate

  /* --- Boot the mirror --- */
  function boot() {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      document.body.classList.add('dev-mode');
    }
    MirrorAnimations.playBoot(() => {
      MirrorAnimations.revealUI();
      isBooted = true;
      MirrorClock.start();
      MirrorWeather.start();
      MirrorParticles.start();
    });
  }

  /* --- Activate Mirror --- */
  function activateMirror() {
    if (!isBooted || isActive) return;
    isActive = true;
    MirrorAnimations.activateTransition();
    setTimeout(() => MirrorVoice.startListening(), 1200);
    resetInactivityTimer();
  }

  /* --- Deactivate Mirror --- */
  function deactivateMirror() {
    if (!isActive) return;
    isActive = false;
    MirrorVoice.stopListening();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    MirrorAnimations.deactivateTransition();
    clearTimeout(inactivityTimer);
    // DON'T clear conversation — keep chat history visible on reactivation
  }

  /* --- Inactivity auto-deactivate --- */
  function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      if (isActive) deactivateMirror();
    }, INACTIVITY_TIMEOUT);
  }

  /* --- Event Listeners --- */
  function bindEvents() {
    // Single click → activate (with debounce to prevent double-click race)
    document.getElementById('mirror-body').addEventListener('click', (e) => {
      if (e.target.closest('#ai-conversation')) return;

      // Debounce: wait 250ms to check if it's a double-click
      clearTimeout(clickDebounce);
      clickDebounce = setTimeout(() => {
        if (!isActive) {
          activateMirror();
        }
        resetInactivityTimer();
      }, 250);
    });

    // Double click → deactivate (cancel the single-click debounce)
    document.getElementById('mirror-body').addEventListener('dblclick', (e) => {
      e.preventDefault();
      clearTimeout(clickDebounce); // cancel the pending single-click activate
      if (isActive) deactivateMirror();
    });

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (!isActive) activateMirror();
        resetInactivityTimer();
      }
      if (e.code === 'Escape' && isActive) deactivateMirror();
    });

    document.addEventListener('contextmenu', e => e.preventDefault());
  }

  /* --- Init --- */
  function init() {
    bindEvents();
    boot();
    console.log('[Mirror] MIRROR Bot initialized — Groq AI + Web Speech API');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { activateMirror, deactivateMirror, isActive: () => isActive };
})();

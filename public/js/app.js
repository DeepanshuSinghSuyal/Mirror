/* ================================================
   MIRROR Bot — Main Application Controller
   Wake Word Integration (Continuous Listening)
   ================================================ */
const MirrorApp = (() => {
  let isActive = false;
  let isBooted = false;
  let inactivityTimer = null;
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
      
      // Start passive voice monitoring (listening for "Mirror")
      if (typeof MirrorVoice !== 'undefined') {
        MirrorVoice.startPassiveListening();
      }
    });
  }

  /* --- Activate Mirror --- */
  function activateMirror() {
    if (!isBooted || isActive) return;
    isActive = true;
    MirrorAnimations.activateTransition();
    setTimeout(() => {
      if (typeof MirrorVoice !== 'undefined') {
        MirrorVoice.startActiveListening();
      }
    }, 1200);
    resetInactivityTimer();
  }

  /* --- Activate Mirror with Direct Query (Single Utterance) --- */
  function activateWithQuery(query) {
    if (!isBooted || isActive) return;
    isActive = true;
    MirrorAnimations.activateTransition();
    setTimeout(() => {
      if (typeof MirrorVoice !== 'undefined') {
        MirrorVoice.processVoiceQuery(query);
      }
    }, 600);
    resetInactivityTimer();
  }

  /* --- Deactivate Mirror --- */
  function deactivateMirror() {
    if (!isActive) return;
    isActive = false;
    if (typeof MirrorVoice !== 'undefined') {
      MirrorVoice.deactivate();
    }
    MirrorAnimations.deactivateTransition();
    clearTimeout(inactivityTimer);
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
    // Touch-to-activate removed per request. Click only resets inactivity if active.
    document.getElementById('mirror-body').addEventListener('click', (e) => {
      if (e.target.closest('#ai-conversation')) return;
      if (isActive) {
        resetInactivityTimer();
      }
    });

    // Double click → deactivate (emergency manual override/debug)
    document.getElementById('mirror-body').addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (isActive) deactivateMirror();
    });

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        // Keyboard debug activation
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
    console.log('[Mirror] MIRROR Bot initialized — Wake Word Listening Enabled');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    activateMirror,
    activateWithQuery,
    deactivateMirror,
    resetInactivityTimer,
    isActive: () => isActive
  };
})();

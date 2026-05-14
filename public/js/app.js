/* ================================================
   MIRROR Bot — Main Application Controller
   Orchestrates all modules
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
    });
  }

  /* --- Activate Mirror --- */
  function activateMirror() {
    if (!isBooted || isActive) return;
    isActive = true;
    MirrorAnimations.activateTransition();
    // Start real voice listening
    setTimeout(() => MirrorVoice.startListening(), 1200);
    resetInactivityTimer();
  }

  /* --- Deactivate Mirror --- */
  function deactivateMirror() {
    if (!isActive) return;
    isActive = false;
    MirrorVoice.stopListening();
    MirrorAnimations.deactivateTransition();
    clearTimeout(inactivityTimer);
    setTimeout(() => MirrorVoice.clearConversation(), 1500);
  }

  /* --- Toggle --- */
  function toggleMirror() {
    if (isActive) deactivateMirror();
    else activateMirror();
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
    document.getElementById('mirror-body').addEventListener('click', (e) => {
      // Don't toggle if clicking inside conversation panel
      if (e.target.closest('#ai-conversation')) return;
      toggleMirror();
      resetInactivityTimer();
    });

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        toggleMirror();
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

  return { activateMirror, deactivateMirror, toggleMirror, isActive: () => isActive };
})();

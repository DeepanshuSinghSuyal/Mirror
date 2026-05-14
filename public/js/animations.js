/* ================================================
   MIRROR Bot — GSAP Animations Module
   ================================================ */
const MirrorAnimations = (() => {

  /* --- Boot Sequence --- */
  function playBoot(onComplete){
    const tl = gsap.timeline({ onComplete });
    tl.to('#boot-logo', { opacity:1, duration:1.2, ease:'power2.out' })
      .to('#boot-bar-container', { opacity:1, duration:0.4 }, '-=0.3')
      .to('#boot-status', { opacity:1, duration:0.4 }, '-=0.2')
      .to('#boot-bar', { width:'100%', duration:2.5, ease:'power1.inOut' }, '-=0.2')
      .to('#boot-status', { opacity:0, duration:0.3 })
      .to('#boot-logo', { opacity:0, scale:1.05, duration:0.6, ease:'power2.in' }, '-=0.1')
      .to('#boot-bar-container', { opacity:0, duration:0.3 }, '-=0.4')
      .to('#boot-screen', { opacity:0, duration:0.5, ease:'power2.inOut' })
      .set('#boot-screen', { display:'none' });
    return tl;
  }

  /* --- Reveal UI after boot --- */
  function revealUI(){
    const tl = gsap.timeline();
    tl.to('#mirror-ui', { opacity:1, duration:0.8, ease:'power2.out' })
      .from('#clock-section', { opacity:0, x:-30, duration:0.7, ease:'power2.out' }, '-=0.3')
      .from('#weather-widget', { opacity:0, x:30, duration:0.7, ease:'power2.out' }, '-=0.5')
      .from('#ai-orb-container', { opacity:0, scale:0.8, duration:1, ease:'back.out(1.2)' }, '-=0.4')
      .from('#ai-idle-text', { opacity:0, y:10, duration:0.5 }, '-=0.3')
      .from('#touch-hint', { opacity:0, y:15, duration:0.5 }, '-=0.3')
      .from('#system-status', { opacity:0, x:-20, duration:0.5 }, '-=0.3')
      .from('#ai-system-status', { opacity:0, x:20, duration:0.5 }, '-=0.4');
    return tl;
  }

  /* --- Activate Mirror (Idle → Active) --- */
  function activateTransition(){
    const tl = gsap.timeline();
    // Darken overlay
    tl.to('#active-overlay', { opacity:1, duration:0.6, ease:'power2.out' })
    // Hide idle elements
      .to('#ai-idle-text', { opacity:0, y:-10, duration:0.3 }, '-=0.3')
      .to('#touch-hint', { opacity:0, y:10, duration:0.3 }, '-=0.3')
    // Animate orb smaller & up
      .to('#ai-orb-container', { scale:0.6, y:-80, duration:0.8, ease:'power2.inOut' }, '-=0.2')
    // Show waveform
      .call(() => {
        document.getElementById('waveform-container').classList.remove('hidden');
        document.getElementById('waveform-container').classList.add('flex');
      })
      .from('#waveform-container', { opacity:0, y:15, duration:0.5, ease:'power2.out' })
    // Show conversation panel
      .call(() => {
        document.getElementById('ai-conversation').classList.remove('hidden');
        document.getElementById('ai-conversation').classList.add('flex');
      })
      .from('#ai-conversation', { opacity:0, y:20, duration:0.5, ease:'power2.out' }, '-=0.2')
    // Orb glow active
      .call(() => { document.getElementById('ai-orb-container').classList.add('orb-active'); });
    return tl;
  }

  /* --- Deactivate Mirror (Active → Idle) --- */
  function deactivateTransition(){
    const tl = gsap.timeline();
    tl.call(() => { document.getElementById('ai-orb-container').classList.remove('orb-active'); })
      .to('#ai-conversation', { opacity:0, y:20, duration:0.4, ease:'power2.in' })
      .call(() => {
        const c = document.getElementById('ai-conversation');
        c.classList.add('hidden'); c.classList.remove('flex');
      })
      .to('#waveform-container', { opacity:0, y:15, duration:0.4, ease:'power2.in' }, '-=0.2')
      .call(() => {
        const w = document.getElementById('waveform-container');
        w.classList.add('hidden'); w.classList.remove('flex');
      })
      .to('#ai-orb-container', { scale:1, y:0, duration:0.8, ease:'power2.inOut' })
      .to('#ai-idle-text', { opacity:1, y:0, duration:0.4 }, '-=0.3')
      .to('#touch-hint', { opacity:1, y:0, duration:0.4 }, '-=0.3')
      .to('#active-overlay', { opacity:0, duration:0.6, ease:'power2.out' }, '-=0.3');
    return tl;
  }

  return { playBoot, revealUI, activateTransition, deactivateTransition };
})();

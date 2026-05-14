/* ================================================
   MIRROR Bot — Particles Module
   Lightweight ambient floating particles
   Optimized for RPi4 (max ~30 particles)
   ================================================ */
const MirrorParticles = (() => {
  const canvas = document.getElementById('particle-canvas');
  const ctx = canvas.getContext('2d');
  let particles = [];
  let animId = null;
  let w = 1920, h = 1080;
  const MAX = 25;

  function resize(){
    w = canvas.width = window.innerWidth || 1920;
    h = canvas.height = window.innerHeight || 1080;
  }

  function createParticle(){
    return {
      x: Math.random()*w,
      y: Math.random()*h,
      r: Math.random()*1.5 + 0.3,
      vx: (Math.random()-0.5)*0.15,
      vy: (Math.random()-0.5)*0.15,
      alpha: Math.random()*0.25 + 0.05,
      pulse: Math.random()*Math.PI*2
    };
  }

  function init(){
    resize();
    particles = [];
    for(let i=0;i<MAX;i++) particles.push(createParticle());
  }

  function draw(){
    ctx.clearRect(0,0,w,h);
    for(const p of particles){
      p.x += p.vx;
      p.y += p.vy;
      p.pulse += 0.008;
      const a = p.alpha * (0.6 + 0.4*Math.sin(p.pulse));
      // Wrap around
      if(p.x<-10) p.x=w+10;
      if(p.x>w+10) p.x=-10;
      if(p.y<-10) p.y=h+10;
      if(p.y>h+10) p.y=-10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(0,210,255,${a})`;
      ctx.fill();
    }
    animId = requestAnimationFrame(draw);
  }

  function start(){ init(); draw(); }
  function stop(){ if(animId) cancelAnimationFrame(animId); }

  return { start, stop };
})();

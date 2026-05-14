/* ================================================
   MIRROR Bot — Clock Module
   ================================================ */
const MirrorClock = (() => {
  const elTime = document.getElementById('clock-time');
  const elSec  = document.getElementById('clock-seconds');
  const elAmPm = document.getElementById('clock-ampm');
  const elDate = document.getElementById('clock-date');
  const USE24  = true;
  const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  let _iv = null;
  function pad(n){ return n < 10 ? '0'+n : ''+n; }
  function update(){
    const now = new Date();
    let h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
    if(USE24){ elTime.textContent = pad(h)+':'+pad(m); elAmPm.textContent=''; }
    else { const ap = h>=12?'PM':'AM'; h = h%12||12; elTime.textContent = pad(h)+':'+pad(m); elAmPm.textContent=ap; }
    elSec.textContent = pad(s);
    elDate.textContent = DAYS[now.getDay()]+', '+MONTHS[now.getMonth()]+' '+now.getDate()+', '+now.getFullYear();
  }
  function start(){ update(); _iv = setInterval(update, 1000); }
  function stop(){ if(_iv) clearInterval(_iv); }
  return { start, stop };
})();

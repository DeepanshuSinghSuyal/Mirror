/* ================================================
   MIRROR Bot — Voice UI Module
   STT: getUserMedia + Groq Whisper (works on Pi Chromium)
   TTS: Web Speech API (SpeechSynthesis — works everywhere)
   Wake Word: "Mirror" | States: IDLE/PASSIVE/ACTIVE/PROCESSING/SPEAKING
   ================================================ */
const MirrorVoice = (() => {
  const waveCanvas = document.getElementById('waveform-canvas');
  const waveCtx    = waveCanvas ? waveCanvas.getContext('2d') : null;
  const convPanel  = document.getElementById('ai-conversation');
  const stateLabel = document.getElementById('ai-state-label');

  const SYSTEM_PROMPT = `You are MIRROR Bot, a futuristic AI assistant embedded in a smart mirror. Respond in a warm, expressive, and interactive tone (showing natural empathy or enthusiasm, and occasionally asking a brief follow-up question). Keep your responses concise (strictly 1 to 2 sentences, around 20 to 35 words max). Never use markdown formatting — respond in plain text only.`;

  let chatHistory = [];

  // --- Voice States ---
  // IDLE: Not listening
  // PASSIVE: Listening for wake-word "mirror"
  // ACTIVE: Listening for user question
  // PROCESSING: API call in progress
  // SPEAKING: Reading out AI response
  let voiceState = 'IDLE';

  // --- MediaRecorder STT State ---
  let mediaStream     = null;
  let mediaRecorder   = null;
  let isListening     = false;   // true when mic loop is running
  let passiveLoopId   = null;    // setInterval id for passive chunked recording
  let activeRecording = false;   // true during a single active capture

  // --- Web Audio API Chimes ---
  function playChime(type) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      const now = ctx.currentTime;
      if (type === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.12);
        gainNode.gain.setValueAtTime(0.12, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
        osc.start(now); osc.stop(now + 0.35);
      } else if (type === 'cancel') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(392.00, now);
        osc.frequency.setValueAtTime(261.63, now + 0.12);
        gainNode.gain.setValueAtTime(0.12, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
        osc.start(now); osc.stop(now + 0.35);
      }
    } catch (e) {
      console.warn('[Voice] Chime failed:', e);
    }
  }

  // --- Mic Access ---
  async function getMicStream() {
    if (mediaStream && mediaStream.active) return mediaStream;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      console.log('[Voice] Mic stream acquired.');
      return mediaStream;
    } catch (e) {
      console.error('[Voice] Mic access denied:', e);
      setStateLabel('Microphone access denied');
      voiceState = 'IDLE';
      return null;
    }
  }

  // --- Send audio blob to /api/transcribe → Groq Whisper ---
  async function transcribeAudio(audioBlob) {
    try {
      const formData = new FormData();
      // Groq Whisper needs a filename with extension to detect format
      const ext = audioBlob.type.includes('ogg') ? 'ogg'
                : audioBlob.type.includes('mp4') ? 'mp4'
                : audioBlob.type.includes('webm') ? 'webm'
                : 'webm';
      formData.append('file', audioBlob, `audio.${ext}`);
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('language', 'en');
      formData.append('response_format', 'json');

      const res = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) return '';
      const data = await res.json();
      return (data.transcript || '').trim();
    } catch (e) {
      console.warn('[Voice] Transcribe error:', e);
      return '';
    }
  }

  // --- PASSIVE LISTENING: record 4s chunks, check for wake word ---
  function startPassiveLoop() {
    if (isListening) return;
    isListening = true;
    console.log('[Voice] Passive loop started.');

    async function doChunk() {
      if (!isListening || voiceState !== 'PASSIVE') return;

      const stream = await getMicStream();
      if (!stream) { isListening = false; return; }

      const chunks = [];
      let mr;
      try {
        mr = new MediaRecorder(stream);
      } catch (e) {
        console.error('[Voice] MediaRecorder failed:', e);
        isListening = false;
        return;
      }
      mediaRecorder = mr;

      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      mr.start();

      await new Promise(resolve => setTimeout(resolve, 3500)); // record 3.5s

      if (!isListening || voiceState !== 'PASSIVE') {
        try { mr.stop(); } catch (_) {}
        return;
      }

      await new Promise(resolve => {
        mr.onstop = resolve;
        try { mr.stop(); } catch (_) { resolve(); }
      });

      if (!isListening || voiceState !== 'PASSIVE') return;

      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      if (blob.size < 1000) { // skip near-silent chunks
        doChunk();
        return;
      }

      const transcript = await transcribeAudio(blob);
      console.log('[Voice][Passive] Heard:', transcript);

      if (voiceState !== 'PASSIVE' || !isListening) return;

      if (transcript) {
        const lower = transcript.toLowerCase();
        if (lower.includes('mirror')) {
          const idx = lower.indexOf('mirror');
          let after = transcript.substring(idx + 6).trim();
          after = after.replace(/^[,\.\s\-\?]+/, '').trim();
          console.log(`[Voice] Wake word! Query: "${after}"`);
          triggerWake(after);
          return; // don't loop — wake handles state
        }
      }

      // No wake word — loop again
      if (isListening && voiceState === 'PASSIVE') doChunk();
    }

    doChunk();
  }

  function stopPassiveLoop() {
    isListening = false;
    if (mediaRecorder) {
      try { mediaRecorder.stop(); } catch (_) {}
      mediaRecorder = null;
    }
    console.log('[Voice] Passive loop stopped.');
  }

  // --- ACTIVE LISTENING: record until silence (max 8s), then transcribe ---
  async function startActiveCapture() {
    if (activeRecording) return;
    activeRecording = true;
    setStateLabel('Listening...');
    startWaveform();

    const stream = await getMicStream();
    if (!stream) { activeRecording = false; return; }

    const chunks = [];
    let mr;
    try {
      mr = new MediaRecorder(stream);
    } catch (e) {
      console.error('[Voice] MediaRecorder failed:', e);
      activeRecording = false;
      stopWaveform();
      return;
    }
    mediaRecorder = mr;

    mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    mr.start();

    // Record for up to 8 seconds (user speaks their question)
    await new Promise(resolve => setTimeout(resolve, 8000));

    stopWaveform();

    if (voiceState !== 'ACTIVE') {
      try { mr.stop(); } catch (_) {}
      activeRecording = false;
      return;
    }

    await new Promise(resolve => {
      mr.onstop = resolve;
      try { mr.stop(); } catch (_) { resolve(); }
    });

    activeRecording = false;
    if (voiceState !== 'ACTIVE') return;

    const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
    setStateLabel('Recognising...');

    const transcript = await transcribeAudio(blob);
    console.log('[Voice][Active] Transcript:', transcript);

    if (voiceState !== 'ACTIVE') return;

    if (transcript && transcript.length > 1) {
      processVoiceQuery(transcript);
    } else {
      console.log('[Voice] No speech detected in active window.');
      // Return to passive
      voiceState = 'PASSIVE';
      setStateLabel('Ready');
      startPassiveLoop();
    }
  }

  // --- Wake Word Trigger ---
  function triggerWake(query) {
    playChime('success');
    stopPassiveLoop();

    if (query) {
      voiceState = 'PROCESSING';
      if (typeof MirrorApp !== 'undefined') MirrorApp.activateWithQuery(query);
    } else {
      voiceState = 'ACTIVE';
      if (typeof MirrorApp !== 'undefined') MirrorApp.activateMirror();
    }
  }

  // --- Call backend proxy /api/chat ---
  async function callAI(userMessage) {
    const now = new Date();
    const timeStr = now.toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' });
    let weatherStr = '';
    if (typeof MirrorWeather !== 'undefined') {
      weatherStr = ' Current weather: ' + MirrorWeather.getWeatherSummary() + '.';
    }

    chatHistory.push({ role: 'user', content: userMessage });
    const trimmed = chatHistory.slice(-10);

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + ` Current date/time: ${timeStr}.${weatherStr} Fact sheet: Current Prime Minister of India is Narendra Modi. Current Chief Minister of Delhi is Rekha Gupta (who took office in February 2025).` },
      ...trimmed
    ];

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const aiText = data.reply;
      chatHistory.push({ role: 'assistant', content: aiText });
      return aiText;
    } catch (e) {
      console.error('[AI] API error:', e);
      return 'I apologize, I\'m having trouble connecting right now. Please try again.';
    }
  }

  // --- Text-to-Speech ---
  const VOICE_PREFS = [
    'Google UK English Female',
    'Google US English',
    'Microsoft Zira',
    'Microsoft Jenny',
    'Samantha',
    'Karen',
    'Daniel',
    'Google UK English Male',
  ];

  let cachedVoice = null;

  function pickBestVoice() {
    if (cachedVoice) return cachedVoice;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    for (const pref of VOICE_PREFS) {
      const match = voices.find(v => v.name === pref);
      if (match) { cachedVoice = match; return match; }
    }
    const fallback = voices.find(v =>
      v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Microsoft'))
    ) || voices.find(v => v.lang.startsWith('en'));
    cachedVoice = fallback || null;
    return cachedVoice;
  }

  function speak(text, onDone) {
    if (!window.speechSynthesis) { if (onDone) onDone(); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.92;
    utter.pitch = 1.05;
    utter.volume = 0.9;
    const voice = pickBestVoice();
    if (voice) utter.voice = voice;
    utter.onend = () => { if (onDone) onDone(); };
    utter.onerror = () => { if (onDone) onDone(); };
    window.speechSynthesis.speak(utter);
  }

  // --- News Voice Commands ---
  const NEWS_COMMANDS = [
    { patterns: ['india news', 'indian news', 'show news', 'today news', "today's news"], action: () => MirrorNews.activate('general') },
    { patterns: ['tech news', 'technology news'], action: () => MirrorNews.activate('technology') },
    { patterns: ['ai news', 'science news'], action: () => MirrorNews.activate('science') },
    { patterns: ['world news', 'global news', 'international news'], action: () => MirrorNews.activate('world') },
    { patterns: ['business news', 'market news'], action: () => MirrorNews.activate('business') },
    { patterns: ['next headline', 'next news', 'next story'], action: () => MirrorNews.nextArticle() },
    { patterns: ['previous headline', 'previous news', 'go back'], action: () => MirrorNews.prevArticle() },
    { patterns: ['stop news', 'close news', 'exit news', 'hide news'], action: () => MirrorNews.deactivate() },
    { patterns: ['explain this', 'explain news', 'tell me more', 'what does this mean'], action: () => MirrorNews.explainCurrent() },
  ];

  function checkNewsCommand(text) {
    const lower = text.toLowerCase();
    for (const cmd of NEWS_COMMANDS) {
      if (cmd.patterns.some(p => lower.includes(p))) {
        cmd.action();
        return true;
      }
    }
    return false;
  }

  // --- Process user query ---
  async function processVoiceQuery(query) {
    voiceState = 'PROCESSING';
    stopPassiveLoop();

    const lowerText = query.toLowerCase().trim();
    if (lowerText.includes('bye mirror') || lowerText.includes('goodbye mirror')) {
      console.log('[Voice] Goodbye command triggered');
      playChime('cancel');
      if (typeof MirrorApp !== 'undefined') MirrorApp.deactivateMirror();
      return;
    }

    if (typeof MirrorNews !== 'undefined' && checkNewsCommand(query)) {
      addMessage('user', query);
      setStateLabel('Ready');
      setTimeout(() => {
        if (typeof MirrorApp !== 'undefined' && MirrorApp.isActive()) {
          startActiveListening();
          MirrorApp.resetInactivityTimer();
        }
      }, 2000);
      return;
    }

    addMessage('user', query);
    setStateLabel('Processing...');
    showTyping();

    const aiResponse = await callAI(query);

    removeTyping();
    addMessage('ai', aiResponse);
    setStateLabel('Speaking...');

    const glow = document.getElementById('border-glow');
    if (glow) glow.classList.add('active');

    voiceState = 'SPEAKING';
    speak(aiResponse, () => {
      if (glow) glow.classList.remove('active');
      if (voiceState === 'SPEAKING') {
        if (typeof MirrorApp !== 'undefined' && MirrorApp.isActive()) {
          startActiveListening();
          MirrorApp.resetInactivityTimer();
        } else {
          startPassiveListening();
        }
      }
    });
  }

  /* --- Waveform Visualization --- */
  let waveAnimId = null;
  let wavePhase = 0;
  let waveIntensity = 0.5;

  function drawWaveform() {
    if (!waveCtx) return;
    const W = waveCanvas.width, H = waveCanvas.height;
    waveCtx.clearRect(0, 0, W, H);
    const mid = H / 2;
    const bars = 60;
    const barW = W / bars;
    for (let i = 0; i < bars; i++) {
      const freq = Math.sin(wavePhase + i * 0.25) * 0.5 +
                   Math.sin(wavePhase * 1.7 + i * 0.18) * 0.3 +
                   Math.sin(wavePhase * 0.5 + i * 0.4) * 0.2;
      const amp = Math.abs(freq) * mid * waveIntensity;
      const x = i * barW;
      const alpha = 0.3 + Math.abs(freq) * 0.5;
      waveCtx.fillStyle = `rgba(0,210,255,${alpha})`;
      waveCtx.fillRect(x + 1, mid - amp, barW - 2, amp * 2);
    }
    wavePhase += 0.06;
    waveAnimId = requestAnimationFrame(drawWaveform);
  }

  function startWaveform() {
    waveIntensity = 0.7;
    if (!waveAnimId) drawWaveform();
  }

  function stopWaveform() {
    waveIntensity = 0;
    if (waveAnimId) { cancelAnimationFrame(waveAnimId); waveAnimId = null; }
    if (waveCtx) waveCtx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);
  }

  /* --- Conversation Messages --- */
  function addMessage(sender, text) {
    if (!convPanel) return;
    const msg = document.createElement('div');
    msg.className = 'chat-message ' + (sender === 'user' ? 'chat-user' : 'chat-ai');
    const label = document.createElement('div');
    label.className = 'chat-label';
    label.textContent = sender === 'user' ? 'You' : 'Mirror';
    const body = document.createElement('div');
    body.className = 'chat-text';
    body.textContent = text;
    msg.appendChild(label);
    msg.appendChild(body);
    convPanel.appendChild(msg);
    convPanel.scrollTop = convPanel.scrollHeight;
  }

  function showTyping() {
    if (!convPanel) return;
    const el = document.createElement('div');
    el.className = 'chat-message chat-ai';
    el.id = 'typing-msg';
    el.innerHTML = '<div class="chat-label">Mirror</div><div class="typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>';
    convPanel.appendChild(el);
    convPanel.scrollTop = convPanel.scrollHeight;
  }

  function removeTyping() {
    const el = document.getElementById('typing-msg');
    if (el) el.remove();
  }

  function clearConversation() {
    if (convPanel) convPanel.innerHTML = '';
    chatHistory = [];
  }

  function setStateLabel(text) {
    if (stateLabel) stateLabel.textContent = text;
  }

  // --- External Control Hooks ---
  function startPassiveListening() {
    voiceState = 'PASSIVE';
    setStateLabel('Ready');
    startPassiveLoop();
  }

  function startActiveListening() {
    voiceState = 'ACTIVE';
    startActiveCapture();
  }

  function stopListening() {
    stopPassiveLoop();
    activeRecording = false;
    if (mediaRecorder) {
      try { mediaRecorder.stop(); } catch (_) {}
      mediaRecorder = null;
    }
    stopWaveform();
  }

  function deactivate() {
    voiceState = 'PASSIVE';
    stopListening();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setTimeout(() => {
      if (voiceState === 'PASSIVE') startPassiveLoop();
    }, 500);
  }

  // Preload voices (Chrome/Chromium needs this trigger)
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }

  return {
    startPassiveListening,
    startActiveListening,
    stopListening,
    deactivate,
    processVoiceQuery,
    addMessage,
    clearConversation,
    setStateLabel,
    startWaveform,
    stopWaveform,
    showTyping,
    removeTyping,
    speak,
    playChime,
    getState: () => voiceState
  };
})();

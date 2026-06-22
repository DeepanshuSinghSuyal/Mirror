/* ================================================
   MIRROR Bot — Voice UI Module v3
   STT: Hybrid — webkitSpeechRecognition (Chrome) OR
        MediaRecorder + Groq Whisper (Pi/Firefox/any)
   Auto-fallback: if native SR fails → switches to Whisper
   VAD: Web Audio AnalyserNode for smart silence detection
   Wake Word: "Mirror" | States: IDLE/PASSIVE/ACTIVE/PROCESSING/SPEAKING
   ================================================ */
const MirrorVoice = (() => {
  const waveCanvas = document.getElementById('waveform-canvas');
  const waveCtx    = waveCanvas ? waveCanvas.getContext('2d') : null;
  const convPanel  = document.getElementById('ai-conversation');
  const stateLabel = document.getElementById('ai-state-label');

  const SYSTEM_PROMPT = `You are MIRROR Bot, a futuristic AI assistant embedded in a smart mirror. Respond in a warm, expressive, and interactive tone (showing natural empathy or enthusiasm, and occasionally asking a brief follow-up question). Keep your responses concise (strictly 1 to 2 sentences, around 20 to 35 words max). Never use markdown formatting — respond in plain text only.`;

  let chatHistory = [];

  // State machine: IDLE → PASSIVE → ACTIVE → PROCESSING → SPEAKING → PASSIVE
  let voiceState = 'IDLE';

  /* ─────────────────────────────────────────────
     STRATEGY DETECTION
     Tries native SR first. If it errors with service issues,
     automatically falls back to MediaRecorder + Groq Whisper.
  ───────────────────────────────────────────── */
  // Start assuming native SR is available if API exists
  let useNativeSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  let nativeSRFailed = false; // set true after confirmed failure

  function switchToWhisperFallback() {
    if (nativeSRFailed) return; // already switched
    nativeSRFailed = true;
    useNativeSR = false;
    console.warn('[Voice] Native SR failed — switching permanently to Groq Whisper fallback.');
    // Clean up any stale SR object
    recognition = null;
    isRecogActive = false;
    // Resume current state using Whisper
    if (voiceState === 'PASSIVE') startPassiveLoop();
    else if (voiceState === 'ACTIVE') startActiveCapture();
  }

  console.log(`[Voice] Initial STT strategy: ${useNativeSR ? 'Native SpeechRecognition' : 'MediaRecorder + Groq Whisper'}`);

  /* ─────────────────────────────────────────────
     CHIMES
  ───────────────────────────────────────────── */
  function playChime(type) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      const now = ctx.currentTime;
      if (type === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.12);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
        osc.start(now); osc.stop(now + 0.35);
      } else if (type === 'cancel') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(392.00, now);
        osc.frequency.setValueAtTime(261.63, now + 0.12);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
        osc.start(now); osc.stop(now + 0.35);
      }
    } catch (e) { console.warn('[Voice] Chime failed:', e); }
  }

  /* ════════════════════════════════════════════
     STRATEGY 1 — Native SpeechRecognition
     Creates a FRESH recognition object every time to avoid
     stale state bugs after multiple start/stop cycles.
  ════════════════════════════════════════════ */
  let recognition    = null;
  let isRecogActive  = false;
  let finalTranscript = '';
  let restartTimeout = null;
  let srQueryPending = false; // prevents double-fire of processVoiceQuery

  function createFreshRecognition() {
    // Always destroy old object — prevents trance state after multiple wake cycles
    if (recognition) {
      try { recognition.abort(); } catch (_) {}
      recognition = null;
    }
    isRecogActive = false;
    srQueryPending = false;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;

    const r = new SR();
    r.continuous      = false;
    r.interimResults  = true;
    r.lang            = 'en-IN';
    r.maxAlternatives = 1;

    r.onstart = () => {
      isRecogActive = true;
      console.log(`[SR] Mic on. State:${voiceState}`);
    };

    r.onresult = (event) => {
      let interim = '', final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        event.results[i].isFinal ? (final += t) : (interim += t);
      }
      const raw = (final + ' ' + interim).trim();
      if (!raw) return;

      if (voiceState === 'PASSIVE') {
        const lower = raw.toLowerCase();
        if (lower.includes('mirror')) {
          const idx = lower.indexOf('mirror');
          let after = raw.substring(idx + 6).trim().replace(/^[,\.\s\-\?]+/, '').trim();
          console.log(`[SR] Wake word! Query:"${after}"`);
          triggerWake(after);
        }
      } else if (voiceState === 'ACTIVE') {
        setStateLabel('\u201C' + raw + '\u201D');
        finalTranscript = raw;
      }
    };

    r.onend = () => {
      isRecogActive = false;
      console.log(`[SR] Mic off. State:${voiceState}`);

      if (voiceState === 'PASSIVE') {
        srScheduleRestart();
      } else if (voiceState === 'ACTIVE') {
        if (!srQueryPending && finalTranscript.trim()) {
          srQueryPending = true;
          processVoiceQuery(finalTranscript.trim());
        } else if (!srQueryPending) {
          srScheduleRestart(); // silence, retry
        }
      }
      // PROCESSING / SPEAKING / IDLE → do nothing, let those states drive next action
    };

    r.onerror = (event) => {
      console.warn(`[SR] Error [${event.error}] State:${voiceState}`);
      isRecogActive = false;

      // These mean Google's STT backend is unavailable (Pi Chromium, some Linux builds)
      if (event.error === 'service-not-allowed' || event.error === 'network') {
        console.warn('[SR] Backend unavailable — switching to Groq Whisper.');
        switchToWhisperFallback();
        return;
      }

      // Hard mic denial — stop everything
      if (event.error === 'not-allowed') {
        setStateLabel('Microphone access denied');
        voiceState = 'IDLE';
        return;
      }

      // Soft errors — retry
      if (voiceState === 'PASSIVE') srScheduleRestart();
      else if (voiceState === 'ACTIVE') {
        if (event.error === 'no-speech') {
          srScheduleRestart();
        } else {
          playChime('cancel');
          setStateLabel('Voice error: ' + event.error);
          if (typeof MirrorApp !== 'undefined') MirrorApp.deactivateMirror();
        }
      }
    };

    return r;
  }

  function srScheduleRestart() {
    if (restartTimeout) clearTimeout(restartTimeout);
    restartTimeout = setTimeout(() => {
      if ((voiceState === 'PASSIVE' || voiceState === 'ACTIVE') && !isRecogActive && useNativeSR) {
        srStart();
      }
    }, 400);
  }

  function srStart() {
    if (!useNativeSR) return;

    // Always create a fresh recognition object — fixes trance state bug
    recognition = createFreshRecognition();
    if (!recognition) { switchToWhisperFallback(); return; }

    try {
      recognition.continuous   = voiceState === 'PASSIVE';
      recognition.interimResults = true;
      finalTranscript = '';
      srQueryPending = false;

      if (voiceState === 'PASSIVE') setStateLabel('Ready');
      else { setStateLabel('Listening...'); startWaveform(); }

      recognition.start();
    } catch (e) {
      console.warn('[SR] Start failed:', e);
      srScheduleRestart();
    }
  }

  function srStop() {
    if (restartTimeout) clearTimeout(restartTimeout);
    if (recognition) {
      try { recognition.abort(); } catch (_) {}
      recognition = null;
    }
    isRecogActive = false;
    srQueryPending = false;
  }

  /* ════════════════════════════════════════════
     STRATEGY 2 — MediaRecorder + Groq Whisper
     (Pi Chromium, Firefox, or after native SR fails)
  ════════════════════════════════════════════ */

  let micStream    = null;
  let audioCtx     = null;
  let analyserNode = null;

  const VAD_SILENCE_THRESHOLD = 8;
  const VAD_SILENCE_MS        = 1200;
  const VAD_MAX_ACTIVE_MS     = 12000;

  let passiveLooping  = false;
  let passiveMR       = null;
  let activeRecording = false;
  let activeMR        = null;

  async function getMicStream() {
    if (micStream && micStream.active) return micStream;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      console.log('[Whisper] Mic stream acquired.');
      setupAnalyser(micStream);
      return micStream;
    } catch (e) {
      console.error('[Whisper] Mic denied:', e);
      setStateLabel('Microphone access denied');
      voiceState = 'IDLE';
      return null;
    }
  }

  function setupAnalyser(stream) {
    try {
      if (!audioCtx || audioCtx.state === 'closed') {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 512;
      const src = audioCtx.createMediaStreamSource(stream);
      src.connect(analyserNode);
    } catch (e) { console.warn('[Whisper] Analyser setup failed:', e); }
  }

  function getVolume() {
    if (!analyserNode) return 0;
    const data = new Uint8Array(analyserNode.frequencyBinCount);
    analyserNode.getByteFrequencyData(data);
    return data.reduce((a, b) => a + b, 0) / data.length;
  }

  function isSpeaking() { return getVolume() > VAD_SILENCE_THRESHOLD; }
  function chunkHasSpeech(blob) { return blob.size > 4000; }

  async function transcribeAudio(blob) {
    try {
      const ext = blob.type.includes('ogg') ? 'ogg'
                : blob.type.includes('mp4') ? 'mp4'
                : 'webm';
      const form = new FormData();
      form.append('file', blob, `audio.${ext}`);
      form.append('model', 'whisper-large-v3-turbo');
      form.append('language', 'en');
      form.append('response_format', 'json');
      const res = await fetch('/api/transcribe', { method: 'POST', body: form });
      if (!res.ok) return '';
      const data = await res.json();
      return (data.transcript || '').trim();
    } catch (e) { console.warn('[Whisper] Transcribe error:', e); return ''; }
  }

  /* --- PASSIVE LOOP --- */
  function startPassiveLoop() {
    if (passiveLooping) return;
    passiveLooping = true;
    console.log('[Whisper] Passive loop started.');
    runPassiveChunk();
  }

  async function runPassiveChunk() {
    if (!passiveLooping || voiceState !== 'PASSIVE') return;

    const stream = await getMicStream();
    if (!stream) { passiveLooping = false; return; }

    const chunks = [];
    let mr;
    try { mr = new MediaRecorder(stream); }
    catch (e) { console.error('[Whisper] MediaRecorder failed:', e); passiveLooping = false; return; }

    passiveMR = mr;
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    mr.start(100);

    await new Promise(r => setTimeout(r, 3500));

    if (!passiveLooping || voiceState !== 'PASSIVE') {
      try { mr.stop(); } catch (_) {}
      return;
    }

    await new Promise(resolve => { mr.onstop = resolve; try { mr.stop(); } catch (_) { resolve(); } });

    if (!passiveLooping || voiceState !== 'PASSIVE') return;

    const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
    if (!chunkHasSpeech(blob)) {
      if (passiveLooping && voiceState === 'PASSIVE') runPassiveChunk();
      return;
    }

    const transcript = await transcribeAudio(blob);
    console.log('[Whisper][Passive] Heard:', transcript);

    if (!passiveLooping || voiceState !== 'PASSIVE') return;

    if (transcript) {
      const lower = transcript.toLowerCase();
      if (lower.includes('mirror')) {
        const idx = lower.indexOf('mirror');
        let after = transcript.substring(idx + 6).trim().replace(/^[,\.\s\-\?]+/, '').trim();
        console.log(`[Whisper] Wake word! Query:"${after}"`);
        triggerWake(after);
        return;
      }
    }

    if (passiveLooping && voiceState === 'PASSIVE') runPassiveChunk();
  }

  function stopPassiveLoop() {
    passiveLooping = false;
    if (passiveMR) { try { passiveMR.stop(); } catch (_) {} passiveMR = null; }
    console.log('[Whisper] Passive loop stopped.');
  }

  /* --- ACTIVE CAPTURE with VAD --- */
  async function startActiveCapture() {
    if (activeRecording) return;
    activeRecording = true;
    setStateLabel('Listening...');
    startWaveform();

    const stream = await getMicStream();
    if (!stream) { activeRecording = false; stopWaveform(); return; }

    const chunks = [];
    let mr;
    try { mr = new MediaRecorder(stream); }
    catch (e) { console.error('[Whisper] MediaRecorder failed:', e); activeRecording = false; stopWaveform(); return; }

    activeMR = mr;
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    mr.start(100);

    await new Promise(resolve => {
      let silenceStart = null;
      let speechDetected = false;
      const startTime = Date.now();

      const vadInterval = setInterval(() => {
        if (Date.now() - startTime > VAD_MAX_ACTIVE_MS || !activeRecording || voiceState !== 'ACTIVE') {
          clearInterval(vadInterval); resolve(); return;
        }
        if (isSpeaking()) {
          speechDetected = true;
          silenceStart = null;
          setStateLabel('Listening... \uD83C\uDFA4');
        } else if (speechDetected) {
          if (!silenceStart) silenceStart = Date.now();
          const pct = Math.min(100, Math.round(((Date.now() - silenceStart) / VAD_SILENCE_MS) * 100));
          setStateLabel(`Done? ${pct}%`);
          if (Date.now() - silenceStart >= VAD_SILENCE_MS) { clearInterval(vadInterval); resolve(); }
        }
      }, 100);
    });

    stopWaveform();
    if (voiceState !== 'ACTIVE') { try { mr.stop(); } catch (_) {} activeRecording = false; return; }

    await new Promise(resolve => { mr.onstop = resolve; try { mr.stop(); } catch (_) { resolve(); } });
    activeRecording = false;
    if (voiceState !== 'ACTIVE') return;

    const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
    setStateLabel('Recognising...');
    const transcript = await transcribeAudio(blob);
    console.log('[Whisper][Active] Transcript:', transcript);

    if (voiceState !== 'ACTIVE') return;

    if (transcript && transcript.length > 1) processVoiceQuery(transcript);
    else {
      console.log('[Whisper] No speech detected, back to passive.');
      voiceState = 'PASSIVE';
      setStateLabel('Ready');
      startPassiveLoop();
    }
  }

  function stopActiveCapture() {
    activeRecording = false;
    if (activeMR) { try { activeMR.stop(); } catch (_) {} activeMR = null; }
    stopWaveform();
  }

  /* ════════════════════════════════════════════
     UNIFIED CONTROL
  ════════════════════════════════════════════ */
  function _startListening() {
    if (useNativeSR) srStart();
    else {
      if (voiceState === 'PASSIVE') startPassiveLoop();
      else if (voiceState === 'ACTIVE') startActiveCapture();
    }
  }

  function _stopListening() {
    if (restartTimeout) clearTimeout(restartTimeout);
    srStop();
    stopPassiveLoop();
    stopActiveCapture();
    stopWaveform();
  }

  /* ─────────────────────────────────────────────
     WAKE WORD TRIGGER
  ───────────────────────────────────────────── */
  function triggerWake(query) {
    playChime('success');
    _stopListening();

    if (query) {
      voiceState = 'PROCESSING';
      if (typeof MirrorApp !== 'undefined') MirrorApp.activateWithQuery(query);
    } else {
      voiceState = 'ACTIVE';
      if (typeof MirrorApp !== 'undefined') MirrorApp.activateMirror();
    }
  }

  /* ─────────────────────────────────────────────
     GROQ LLM
  ───────────────────────────────────────────── */
  async function callAI(userMessage) {
    const now = new Date();
    const timeStr = now.toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' });
    let weatherStr = '';
    if (typeof MirrorWeather !== 'undefined') weatherStr = ' Current weather: ' + MirrorWeather.getWeatherSummary() + '.';

    chatHistory.push({ role: 'user', content: userMessage });
    const trimmed = chatHistory.slice(-10);
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + ` Current date/time: ${timeStr}.${weatherStr} Fact sheet: Current Prime Minister of India is Narendra Modi. Current Chief Minister of Delhi is Rekha Gupta (who took office in February 2025).` },
      ...trimmed
    ];

    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages })
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`); }
      const data = await res.json();
      const aiText = data.reply;
      chatHistory.push({ role: 'assistant', content: aiText });
      return aiText;
    } catch (e) {
      console.error('[AI] Error:', e);
      return "I'm having trouble connecting right now. Please try again.";
    }
  }

  /* ─────────────────────────────────────────────
     TTS
  ───────────────────────────────────────────── */
  const VOICE_PREFS = [
    'Google UK English Female', 'Google US English',
    'Microsoft Zira', 'Microsoft Jenny',
    'Samantha', 'Karen', 'Daniel', 'Google UK English Male',
  ];
  let cachedVoice = null;

  function pickBestVoice() {
    if (cachedVoice) return cachedVoice;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    for (const pref of VOICE_PREFS) {
      const m = voices.find(v => v.name === pref);
      if (m) { cachedVoice = m; return m; }
    }
    cachedVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Microsoft')))
                  || voices.find(v => v.lang.startsWith('en')) || null;
    return cachedVoice;
  }

  function speak(text, onDone) {
    if (!window.speechSynthesis) { if (onDone) onDone(); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.92; utter.pitch = 1.05; utter.volume = 0.9;
    const v = pickBestVoice();
    if (v) utter.voice = v;
    utter.onend = () => { if (onDone) onDone(); };
    utter.onerror = () => { if (onDone) onDone(); };
    window.speechSynthesis.speak(utter);
  }

  /* ─────────────────────────────────────────────
     NEWS COMMANDS
  ───────────────────────────────────────────── */
  const NEWS_COMMANDS = [
    { patterns: ['india news', 'indian news', 'show news', 'today news', "today's news"], action: () => MirrorNews.activate('general') },
    { patterns: ['tech news', 'technology news'], action: () => MirrorNews.activate('technology') },
    { patterns: ['ai news', 'science news'],      action: () => MirrorNews.activate('science') },
    { patterns: ['world news', 'global news', 'international news'], action: () => MirrorNews.activate('world') },
    { patterns: ['business news', 'market news'], action: () => MirrorNews.activate('business') },
    { patterns: ['next headline', 'next news', 'next story'],        action: () => MirrorNews.nextArticle() },
    { patterns: ['previous headline', 'previous news', 'go back'],   action: () => MirrorNews.prevArticle() },
    { patterns: ['stop news', 'close news', 'exit news', 'hide news'], action: () => MirrorNews.deactivate() },
    { patterns: ['explain this', 'explain news', 'tell me more', 'what does this mean'], action: () => MirrorNews.explainCurrent() },
  ];

  function checkNewsCommand(text) {
    const lower = text.toLowerCase();
    for (const cmd of NEWS_COMMANDS) {
      if (cmd.patterns.some(p => lower.includes(p))) { cmd.action(); return true; }
    }
    return false;
  }

  /* ─────────────────────────────────────────────
     PROCESS VOICE QUERY — central handler
  ───────────────────────────────────────────── */
  async function processVoiceQuery(query) {
    // Guard: only process if we were in a valid pre-processing state
    if (voiceState === 'PROCESSING' || voiceState === 'SPEAKING') {
      console.warn(`[Voice] processVoiceQuery called in unexpected state: ${voiceState}. Ignoring.`);
      return;
    }

    voiceState = 'PROCESSING';
    _stopListening();

    const lower = query.toLowerCase().trim();

    if (lower.includes('bye mirror') || lower.includes('goodbye mirror') || lower.includes('bye bye mirror')) {
      console.log('[Voice] Goodbye command triggered');
      playChime('cancel');
      // Small delay so chime plays before deactivating
      setTimeout(() => {
        if (typeof MirrorApp !== 'undefined') MirrorApp.deactivateMirror();
      }, 400);
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

  /* ─────────────────────────────────────────────
     WAVEFORM
  ───────────────────────────────────────────── */
  let waveAnimId = null, wavePhase = 0, waveIntensity = 0.5;

  function drawWaveform() {
    if (!waveCtx) return;
    const W = waveCanvas.width, H = waveCanvas.height;
    waveCtx.clearRect(0, 0, W, H);
    const mid = H / 2, bars = 60, barW = W / bars;
    for (let i = 0; i < bars; i++) {
      const freq = Math.sin(wavePhase + i * 0.25) * 0.5 +
                   Math.sin(wavePhase * 1.7 + i * 0.18) * 0.3 +
                   Math.sin(wavePhase * 0.5 + i * 0.4) * 0.2;
      const amp = Math.abs(freq) * mid * waveIntensity;
      const alpha = 0.3 + Math.abs(freq) * 0.5;
      waveCtx.fillStyle = `rgba(0,210,255,${alpha})`;
      waveCtx.fillRect(i * barW + 1, mid - amp, barW - 2, amp * 2);
    }
    wavePhase += 0.06;
    waveAnimId = requestAnimationFrame(drawWaveform);
  }

  function startWaveform() { waveIntensity = 0.7; if (!waveAnimId) drawWaveform(); }
  function stopWaveform() {
    waveIntensity = 0;
    if (waveAnimId) { cancelAnimationFrame(waveAnimId); waveAnimId = null; }
    if (waveCtx) waveCtx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);
  }

  /* ─────────────────────────────────────────────
     CONVERSATION UI
  ───────────────────────────────────────────── */
  function addMessage(sender, text) {
    if (!convPanel) return;
    const msg = document.createElement('div');
    msg.className = 'chat-message ' + (sender === 'user' ? 'chat-user' : 'chat-ai');
    const label = document.createElement('div'); label.className = 'chat-label';
    label.textContent = sender === 'user' ? 'You' : 'Mirror';
    const body = document.createElement('div'); body.className = 'chat-text';
    body.textContent = text;
    msg.appendChild(label); msg.appendChild(body);
    convPanel.appendChild(msg);
    convPanel.scrollTop = convPanel.scrollHeight;
  }

  function showTyping() {
    if (!convPanel) return;
    const el = document.createElement('div');
    el.className = 'chat-message chat-ai'; el.id = 'typing-msg';
    el.innerHTML = '<div class="chat-label">Mirror</div><div class="typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>';
    convPanel.appendChild(el);
    convPanel.scrollTop = convPanel.scrollHeight;
  }

  function removeTyping() { const el = document.getElementById('typing-msg'); if (el) el.remove(); }
  function clearConversation() { if (convPanel) convPanel.innerHTML = ''; chatHistory = []; }
  function setStateLabel(text) { if (stateLabel) stateLabel.textContent = text; }

  /* ─────────────────────────────────────────────
     EXTERNAL API
  ───────────────────────────────────────────── */
  function startPassiveListening() {
    voiceState = 'PASSIVE';
    setStateLabel('Ready');
    _startListening();
  }

  function startActiveListening() {
    voiceState = 'ACTIVE';
    _startListening();
  }

  function stopListening() { _stopListening(); }

  function deactivate() {
    console.log('[Voice] Deactivating — returning to passive.');
    _stopListening();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    voiceState = 'PASSIVE';
    // Give system 600ms to settle before restarting passive
    setTimeout(() => {
      if (voiceState === 'PASSIVE') {
        setStateLabel('Ready');
        _startListening();
      }
    }, 600);
  }

  // Preload TTS voices
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => { cachedVoice = null; window.speechSynthesis.getVoices(); };
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

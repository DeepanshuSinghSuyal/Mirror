/* ================================================
   MIRROR Bot — Voice UI Module
   Calls /api/chat proxy (no API key in frontend)
   Text-only output (no TTS — no speaker)
   ================================================ */
const MirrorVoice = (() => {
  const waveCanvas = document.getElementById('waveform-canvas');
  const waveCtx    = waveCanvas ? waveCanvas.getContext('2d') : null;
  const convPanel  = document.getElementById('ai-conversation');
  const stateLabel = document.getElementById('ai-state-label');

  const SYSTEM_PROMPT = `You are MIRROR Bot, a futuristic AI assistant embedded in a smart mirror. You are helpful, concise, and speak in a calm, sophisticated tone. Keep responses brief (2-3 sentences max) since you're displayed on a mirror screen. You know the current date/time and can answer questions about weather, schedules, news, and general knowledge. Be warm but professional, like a luxury hotel concierge. Never use markdown formatting — respond in plain text only.`;

  let chatHistory = [];

  // --- Speech Recognition (Web Speech API) ---
  let recognition = null;
  let isListening = false;
  let finalTranscript = '';

  function initSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      console.warn('[Voice] Speech Recognition not supported');
      return false;
    }
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-IN';
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = '';
      finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (interim) setStateLabel('\u201C' + interim + '\u201D');
      if (finalTranscript) setStateLabel('\u201C' + finalTranscript + '\u201D');
    };

    recognition.onend = () => {
      isListening = false;
      if (finalTranscript.trim()) {
        processUserSpeech(finalTranscript.trim());
      } else {
        setStateLabel('No speech detected. Tap to try again.');
        stopWaveform();
      }
    };

    recognition.onerror = (event) => {
      console.warn('[Voice] Recognition error:', event.error);
      isListening = false;
      if (event.error === 'no-speech') setStateLabel('No speech detected');
      else if (event.error === 'not-allowed') setStateLabel('Microphone access denied');
      else setStateLabel('Voice error: ' + event.error);
      stopWaveform();
    };

    return true;
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
      { role: 'system', content: SYSTEM_PROMPT + ` Current date/time: ${timeStr}.${weatherStr}` },
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
  function speak(text, onDone) {
    if (!window.speechSynthesis) { if (onDone) onDone(); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.95;
    utter.pitch = 1.0;
    utter.volume = 0.85;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v =>
      v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Zira')
    );
    if (preferred) utter.voice = preferred;
    utter.onend = () => { if (onDone) onDone(); };
    utter.onerror = () => { if (onDone) onDone(); };
    window.speechSynthesis.speak(utter);
  }

  // --- Process user speech → AI response + speak it ---
  async function processUserSpeech(text) {
    stopWaveform();
    addMessage('user', text);
    setStateLabel('Processing...');
    showTyping();

    const aiResponse = await callAI(text);

    removeTyping();
    addMessage('ai', aiResponse);
    setStateLabel('Speaking...');

    // Speak the response, then auto-listen again
    speak(aiResponse, () => {
      setStateLabel('Ready');
      setTimeout(() => {
        if (document.getElementById('waveform-container') &&
            !document.getElementById('waveform-container').classList.contains('hidden')) {
          startListening();
        }
      }, 500);
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

  /* --- Public API --- */
  function startListening() {
    if (!recognition && !initSpeechRecognition()) {
      setStateLabel('Speech not supported');
      return;
    }
    isListening = true;
    finalTranscript = '';
    setStateLabel('Listening...');
    startWaveform();
    try { recognition.start(); } catch (e) { /* already started */ }
  }

  function stopListening() {
    isListening = false;
    if (recognition) { try { recognition.stop(); } catch (e) {} }
    setStateLabel('Processing...');
    stopWaveform();
  }

  function showAIResponse(userText, aiText) {
    removeTyping();
    if (userText) addMessage('user', userText);
    addMessage('ai', aiText);
    setStateLabel('Ready');
  }

  // Preload voices (Chrome needs this)
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
  }

  return {
    startListening, stopListening, showAIResponse,
    addMessage, clearConversation, setStateLabel,
    startWaveform, stopWaveform, showTyping, removeTyping,
    callAI, speak
  };
})();

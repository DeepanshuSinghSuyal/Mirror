/* ================================================
   MIRROR Bot — News Mode Module
   Cinematic ambient news experience
   Voice-activated, auto-rotating, AI-narrated
   ================================================ */
const MirrorNews = (() => {
  let articles = [];
  let currentIndex = 0;
  let rotationTimer = null;
  let isActive = false;
  let currentCategory = 'general';
  let isNarrating = false;
  let preloadedImg = null;

  const ROTATION_INTERVAL = 10000; // 10s per headline
  const CACHE = {};
  const CACHE_TTL = 900000; // 15 min client-side

  const CATEGORY_LABELS = {
    general: 'INDIA NEWS',
    technology: 'TECH NEWS',
    science: 'AI & SCIENCE',
    world: 'WORLD NEWS',
    business: 'BUSINESS',
    entertainment: 'ENTERTAINMENT'
  };

  // --- DOM References ---
  const els = {};
  function cacheDom() {
    els.overlay    = document.getElementById('news-overlay');
    els.bg         = document.getElementById('news-bg-image');
    els.category   = document.getElementById('news-category');
    els.headline   = document.getElementById('news-headline');
    els.summary    = document.getElementById('news-summary');
    els.source     = document.getElementById('news-source');
    els.image      = document.getElementById('news-image');
    els.imageFrame = document.getElementById('news-image-frame');
    els.counter    = document.getElementById('news-counter');
    els.progress   = document.getElementById('news-progress');
  }

  // --- Fetch News ---
  async function fetchNews(category = 'general') {
    // Check client cache
    if (CACHE[category] && Date.now() - CACHE[category].time < CACHE_TTL) {
      return CACHE[category].articles;
    }

    try {
      const res = await fetch(`/api/news?category=${category}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const arts = data.articles || [];
      CACHE[category] = { articles: arts, time: Date.now() };
      return arts;
    } catch (e) {
      console.warn('[News] Fetch failed:', e);
      return [];
    }
  }

  // --- Activate News Mode ---
  async function activate(category = 'general') {
    if (!els.overlay) cacheDom();
    currentCategory = category;
    currentIndex = 0;

    // Show loading state
    els.overlay.classList.remove('hidden');
    els.overlay.classList.add('flex');
    els.category.textContent = CATEGORY_LABELS[category] || 'NEWS';
    els.headline.textContent = 'Fetching headlines...';
    els.summary.textContent = '';
    els.source.textContent = '';

    // Fade in overlay
    gsap.fromTo(els.overlay, { opacity: 0 }, { opacity: 1, duration: 0.8, ease: 'power2.out' });

    // Fetch articles
    articles = await fetchNews(category);

    if (!articles.length) {
      els.headline.textContent = 'No headlines available right now.';
      return;
    }

    isActive = true;
    showArticle(0);
    startRotation();
  }

  // --- Deactivate News Mode ---
  function deactivate() {
    isActive = false;
    stopRotation();
    stopNarration();

    gsap.to(els.overlay, {
      opacity: 0, duration: 0.6, ease: 'power2.in',
      onComplete: () => {
        els.overlay.classList.add('hidden');
        els.overlay.classList.remove('flex');
        // Clear background
        gsap.set(els.bg, { opacity: 0 });
      }
    });
  }

  // --- Show Article ---
  function showArticle(index) {
    if (!articles.length) return;
    currentIndex = index % articles.length;
    const article = articles[currentIndex];

    // Update counter
    els.counter.textContent = `${currentIndex + 1} / ${articles.length}`;

    // Animate out current content
    const tl = gsap.timeline();

    tl.to([els.headline, els.summary, els.source], {
      opacity: 0, y: -10, duration: 0.3, ease: 'power2.in', stagger: 0.05
    })
    // Update background image
    .call(() => {
      if (article.image) {
        els.bg.style.backgroundImage = `url(${article.image})`;
        gsap.to(els.bg, { opacity: 1, duration: 1.2, ease: 'power2.out' });
      } else {
        gsap.to(els.bg, { opacity: 0, duration: 0.5 });
      }
    })
    // Update right-side image
    .call(() => {
      if (article.image) {
        els.image.src = article.image;
        els.image.alt = article.title;
        els.imageFrame.style.display = 'block';
        gsap.fromTo(els.imageFrame, { opacity: 0, scale: 0.95 },
          { opacity: 1, scale: 1, duration: 0.8, ease: 'power2.out' });
      } else {
        els.imageFrame.style.display = 'none';
      }
    })
    // Update text content
    .call(() => {
      els.category.textContent = CATEGORY_LABELS[currentCategory] || 'NEWS';
      els.headline.textContent = article.title;
      els.summary.textContent = article.description || '';
      const time = article.publishedAt ? timeAgo(article.publishedAt) : '';
      els.source.textContent = [article.source, time].filter(Boolean).join('  •  ');
    })
    // Animate in new content
    .fromTo([els.headline, els.summary, els.source],
      { opacity: 0, y: 15 },
      { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', stagger: 0.12 }
    )
    // Start progress bar
    .call(() => startProgress())
    // Narrate
    .call(() => { if (isActive) narrateHeadline(article.title); }, null, '+=0.3');

    // Preload next image
    preloadNext();
  }

  // --- Progress Bar ---
  function startProgress() {
    gsap.fromTo(els.progress,
      { scaleX: 0 },
      { scaleX: 1, duration: ROTATION_INTERVAL / 1000, ease: 'none' }
    );
  }

  // --- Rotation ---
  function startRotation() {
    stopRotation();
    rotationTimer = setInterval(() => {
      if (isActive && !isNarrating) nextArticle();
    }, ROTATION_INTERVAL);
  }

  function stopRotation() {
    if (rotationTimer) { clearInterval(rotationTimer); rotationTimer = null; }
  }

  function nextArticle() {
    if (!articles.length) return;
    stopNarration();
    showArticle(currentIndex + 1);
  }

  function prevArticle() {
    if (!articles.length) return;
    stopNarration();
    showArticle(currentIndex - 1 < 0 ? articles.length - 1 : currentIndex - 1);
  }

  // --- Voice Narration ---
  function narrateHeadline(text) {
    if (!window.speechSynthesis || !text) return;
    stopNarration();
    isNarrating = true;

    const glow = document.getElementById('border-glow');
    if (glow) glow.classList.add('active');

    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.90;
    utter.pitch = 1.05;
    utter.volume = 0.85;

    // Use the same voice picker from MirrorVoice if available
    if (typeof MirrorVoice !== 'undefined' && MirrorVoice.speak) {
      MirrorVoice.speak(text, () => {
        isNarrating = false;
        if (glow) glow.classList.remove('active');
      });
      return;
    }

    utter.onend = () => {
      isNarrating = false;
      if (glow) glow.classList.remove('active');
    };
    utter.onerror = () => {
      isNarrating = false;
      if (glow) glow.classList.remove('active');
    };
    window.speechSynthesis.speak(utter);
  }

  function stopNarration() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    isNarrating = false;
    const glow = document.getElementById('border-glow');
    if (glow) glow.classList.remove('active');
  }

  // --- Preload ---
  function preloadNext() {
    const nextIdx = (currentIndex + 1) % articles.length;
    const next = articles[nextIdx];
    if (next && next.image) {
      preloadedImg = new Image();
      preloadedImg.src = next.image;
    }
  }

  // --- AI Explain (uses Groq via /api/chat) ---
  async function explainCurrent() {
    if (!articles.length) return;
    const article = articles[currentIndex];
    stopRotation();
    stopNarration();

    els.summary.textContent = 'Analyzing...';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are a calm, intelligent AI news analyst on a smart mirror. Explain this news headline in 2-3 simple sentences. Be concise and insightful. No markdown.' },
            { role: 'user', content: `Explain this headline: "${article.title}"\nContext: ${article.description || 'No additional context.'}` }
          ]
        })
      });
      const data = await res.json();
      const explanation = data.reply || 'Unable to analyze this headline.';

      els.summary.textContent = explanation;
      gsap.fromTo(els.summary, { opacity: 0 }, { opacity: 1, duration: 0.5 });

      // Narrate explanation
      narrateHeadline(explanation);
    } catch (e) {
      els.summary.textContent = 'Analysis unavailable right now.';
    }
  }

  // --- Utility ---
  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  // --- Public API ---
  return {
    activate, deactivate, nextArticle, prevArticle,
    explainCurrent, stopNarration,
    isActive: () => isActive,
    getCategory: () => currentCategory
  };
})();

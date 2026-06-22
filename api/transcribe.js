/* ================================================
   MIRROR Bot — Groq Whisper Transcription Proxy
   Receives audio blob → Groq Whisper → returns text
   Works on any browser (Pi Chromium, Firefox, etc.)
   ================================================ */

export const config = {
  api: {
    bodyParser: false, // we read raw multipart/form-data
  },
};

// Simple in-memory rate limiter
const rateLimitMap = new Map();
const RATE_LIMIT = 60;
const RATE_WINDOW = 60000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

// Read raw body as a Buffer
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const clientIP = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  if (isRateLimited(clientIP)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    // Read raw multipart body
    const rawBody = await readBody(req);
    const contentType = req.headers['content-type'] || '';

    // Forward it directly to Groq Whisper as multipart/form-data
    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': contentType,
      },
      body: rawBody,
    });

    if (!groqRes.ok) {
      const err = await groqRes.json().catch(() => ({}));
      console.error('[Transcribe] Groq error:', err);
      return res.status(groqRes.status).json({ error: err.error?.message || 'Groq STT error' });
    }

    const data = await groqRes.json();
    return res.status(200).json({ transcript: data.text || '' });

  } catch (err) {
    console.error('[Transcribe] Error:', err);
    return res.status(500).json({ error: 'Transcription failed' });
  }
}

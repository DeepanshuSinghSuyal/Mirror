/* ================================================
   MIRROR Bot — Groq API Proxy (Vercel Serverless)
   Keeps API key safe on the server side
   Includes rate limiting & input validation
   ================================================ */

// Simple in-memory rate limiter (resets per cold start)
const rateLimitMap = new Map();
const RATE_LIMIT = 30;       // max requests
const RATE_WINDOW = 60000;   // per 60 seconds

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

export default async function handler(req, res) {
  // CORS headers for the frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting
  const clientIP = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  if (isRateLimited(clientIP)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { messages } = req.body;

    // Validate messages array
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid request: messages array required' });
    }

    // Cap messages to prevent abuse (system + max 12 user/assistant turns)
    const cappedMessages = messages.slice(0, 13);

    // Validate each message has role and content
    for (const msg of cappedMessages) {
      if (!msg.role || !msg.content || typeof msg.content !== 'string') {
        return res.status(400).json({ error: 'Invalid message format' });
      }
      // Limit individual message length
      if (msg.content.length > 2000) {
        msg.content = msg.content.slice(0, 2000);
      }
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: cappedMessages,
        temperature: 0.7,
        max_tokens: 200,
        stream: false
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: errData.error?.message || `Groq API error: ${response.status}`
      });
    }

    const data = await response.json();
    return res.status(200).json({
      reply: data.choices[0].message.content.trim()
    });

  } catch (error) {
    console.error('[API] Groq proxy error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

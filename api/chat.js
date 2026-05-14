/* ================================================
   MIRROR Bot — Groq API Proxy (Vercel Serverless)
   Keeps API key safe on the server side
   ================================================ */

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid request: messages array required' });
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: messages,
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

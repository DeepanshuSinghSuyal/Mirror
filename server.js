/* ================================================
   MIRROR Bot — Local Dev Server
   Serves static files + API proxy for local testing
   Run: node server.js
   ================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
}

const PORT = 3000;
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  // API route: /api/transcribe (Groq Whisper STT)
  if (req.method === 'POST' && req.url === '/api/transcribe') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'GROQ_API_KEY not set in .env' }));
        }
        const rawBody = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] || '';
        const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': contentType },
          body: rawBody,
        });
        const data = await groqRes.json();
        res.writeHead(groqRes.ok ? 200 : groqRes.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(groqRes.ok ? { transcript: data.text || '' } : { error: data.error?.message || 'Groq STT error' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // API route: /api/chat
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages } = JSON.parse(body);
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'GROQ_API_KEY not set in .env' }));
        }
        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, temperature: 0.7, max_tokens: 200 })
        });
        const data = await groqRes.json();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reply: data.choices[0].message.content.trim() }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // API route: /api/news
  if (req.method === 'GET' && req.url.startsWith('/api/news')) {
    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const category = urlObj.searchParams.get('category') || 'general';
    const apiKey = process.env.GNEWS_API_KEY;
    if (!apiKey) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'GNEWS_API_KEY not set in .env' }));
    }
    try {
      const gnewsUrl = `https://gnews.io/api/v4/top-headlines?category=${category}&lang=en&country=in&max=10&apikey=${apiKey}`;
      const gnewsRes = await fetch(gnewsUrl);
      const data = await gnewsRes.json();
      const articles = (data.articles || []).map(a => ({
        title: a.title || '', description: a.description || '',
        image: a.image || '', source: a.source?.name || '',
        url: a.url || '', publishedAt: a.publishedAt || ''
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ articles, category }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(PUBLIC, filePath);
  const ext = path.extname(filePath);

  if (fs.existsSync(filePath)) {
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  MIRROR Bot running at:\n  http://localhost:${PORT}\n`);
});

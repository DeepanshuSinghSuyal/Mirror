/* ================================================
   MIRROR Bot — GNews API Proxy (Vercel Serverless)
   Keeps API key safe, caches results
   ================================================ */

let cache = {};
const CACHE_TTL = 900000; // 15 min

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GNEWS_API_KEY not configured' });

  const category = req.query.category || 'general';
  const allowed = ['general', 'world', 'nation', 'business', 'technology', 'science', 'entertainment'];
  if (!allowed.includes(category)) return res.status(400).json({ error: 'Invalid category' });

  // Check cache
  const cacheKey = category;
  if (cache[cacheKey] && Date.now() - cache[cacheKey].time < CACHE_TTL) {
    return res.status(200).json(cache[cacheKey].data);
  }

  try {
    const url = `https://gnews.io/api/v4/top-headlines?category=${category}&lang=en&country=in&max=10&apikey=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.errors?.[0] || `GNews error: ${response.status}` });
    }

    const data = await response.json();
    const articles = (data.articles || []).map(a => ({
      title: a.title || '',
      description: a.description || '',
      image: a.image || '',
      source: a.source?.name || '',
      url: a.url || '',
      publishedAt: a.publishedAt || ''
    }));

    const result = { articles, category, fetchedAt: new Date().toISOString() };
    cache[cacheKey] = { data: result, time: Date.now() };

    return res.status(200).json(result);
  } catch (e) {
    console.error('[News API] Error:', e);
    return res.status(500).json({ error: 'Failed to fetch news' });
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured in Vercel environment variables.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        messages: req.body.messages
      })
    });

    // Safely parse — Anthropic may return non-JSON on 5xx errors
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({ error: 'Anthropic returned an unexpected response: ' + text.slice(0, 200) });
    }

    return res.status(response.status).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

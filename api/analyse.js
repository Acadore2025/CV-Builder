// Thin wrapper — routes to the shared scoring engine in full mode
const scoreHandler = require('./score');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // The analyser sends { messages: [{role:'user', content: prompt}] }
  // We extract the resume text + metadata from the body
  // Support both legacy message format and new direct format
  if (req.body.resume_text) {
    // New direct format from score panel
    req.body.mode = req.body.mode || 'full';
    return scoreHandler(req, res);
  }

  // Legacy format: messages array — pass through to Anthropic directly
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: req.body.max_tokens || 7000,
        temperature: 0,
        messages: req.body.messages
      })
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch { return res.status(500).json({ error: 'Unexpected Anthropic response: ' + text.slice(0,200) }); }
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

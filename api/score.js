module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  const { resume_text, market, experience_level, target_role, mode } = req.body;
  if (!resume_text) return res.status(400).json({ error: 'resume_text is required' });
  const isQuick = mode === 'quick';
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: isQuick ? 2000 : 16000,
        temperature: 0,
        messages: [{ role: 'user', content: buildPrompt(resume_text, market, experience_level, target_role, isQuick) }]
      })
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { return res.status(500).json({ error: 'Unexpected response: ' + text.slice(0,200) }); }
    if (data.error) return res.status(500).json({ error: data.error.message });
    const raw = data.content?.[0]?.text || '';
    let clean = raw.replace(/```json/g,'').replace(/```/g,'').trim();
    const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
    if (s<0||e<0) return res.status(500).json({ error: 'No JSON in response' });
    try { return res.status(200).json(JSON.parse(clean.slice(s,e+1))); }
    catch(err) {
      // Claude sometimes puts unescaped quotes/newlines in free-text fields — sanitize and retry
      try {
        let fixed = clean.slice(s,e+1);
        // Step 1: remove illegal control characters
        fixed = fixed.replace(/[

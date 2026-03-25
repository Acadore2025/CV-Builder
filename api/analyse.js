const scoreHandler = require('./score');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!req.body?.resume_text) return res.status(400).json({ error: 'resume_text is required' });
  // BUG-007 FIX: don't mutate req.body — use spread to create new object
  req.body = { ...req.body, mode: req.body.mode || 'full' };
  return scoreHandler(req, res);
};

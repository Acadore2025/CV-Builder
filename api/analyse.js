/**
 * analyse.js — Thin wrapper around score.js
 *
 * Kept for backwards compatibility with any direct /api/analyse calls.
 * Defaults mode to 'fast'. Frontend should call /api/score directly
 * with mode: 'fast' then mode: 'deep' for the two-call architecture.
 */

const scoreHandler = require('./score');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!req.body?.resume_text) return res.status(400).json({ error: 'resume_text is required' });

  // Default to 'fast' — full analysis now requires two calls from the frontend
  req.body = { ...req.body, mode: req.body.mode || 'fast' };
  return scoreHandler(req, res);
};

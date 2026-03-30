/**
 * save_session.js — Template quality tracker
 *
 * Stores ZERO personal content. Only:
 *   template, market, mode, all 7 dimension scores, knockout_count, timestamp.
 *
 * Purpose: internal quality review — see which templates score best,
 * which markets produce stronger resumes, spot AI regression over time.
 *
 * Env vars (same project as subscribe.js):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const VALID_TEMPLATES = new Set([
  'classic','harvard','modern','corporate',
  'executive','fresher','creative','iit','custom',
]);
const VALID_MARKETS = new Set(['india','us','gulf','europe']);
const VALID_MODES   = new Set(['form','ai']);

function clamp(v) {
  const n = parseInt(v, 10);
  return isNaN(n) ? 0 : Math.min(100, Math.max(0, n));
}

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Supabase env vars not configured' });
  }

  const b = req.body || {};

  const payload = {
    template:           VALID_TEMPLATES.has(b.template) ? b.template : 'unknown',
    market:             VALID_MARKETS.has(b.market)     ? b.market   : 'unknown',
    mode:               VALID_MODES.has(b.mode)         ? b.mode     : 'form',
    score_overall:      clamp(b.score_overall),
    score_ats:          clamp(b.score_ats),
    score_content:      clamp(b.score_content),
    score_skills:       clamp(b.score_skills),
    score_structure:    clamp(b.score_structure),
    score_narrative:    clamp(b.score_narrative),
    score_professional: clamp(b.score_professional),
    knockout_count:     Math.min(10, Math.max(0, parseInt(b.knockout_count, 10) || 0)),
    // created_at set by Supabase default
  };

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/resume_sessions`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(payload),
    });

    if (response.ok || response.status === 201) {
      return res.status(200).json({ ok: true });
    }

    const errBody = await response.text();
    console.error('Supabase save_session error:', response.status, errBody);
    return res.status(500).json({ error: 'Database write failed' });

  } catch (err) {
    console.error('save_session.js error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

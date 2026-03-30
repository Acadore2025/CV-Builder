/**
 * subscribe.js — Email capture + drop-off tracking
 *
 * Writes every submission to Supabase `subscribers` table.
 * Uses the Supabase REST API directly — no SDK needed (keeps bundle zero).
 *
 * Env vars required (set in Vercel dashboard):
 *   SUPABASE_URL   — e.g. https://xyzxyz.supabase.co
 *   SUPABASE_ANON_KEY — your project's anon/public key
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Supabase env vars not configured' });
  }

  const { email, dropoff_section, has_generated, template, market, source } = req.body || {};

  // Basic email validation server-side
  if (!email || !email.includes('@') || !email.includes('.')) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const payload = {
    email:           email.toLowerCase().trim(),
    dropoff_section: dropoff_section || 'unknown',
    has_generated:   has_generated   || false,
    template:        template        || 'classic',
    market:          market          || 'us',
    source:          source          || 'email_modal',
    // created_at handled automatically by Supabase default (now())
  };

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/subscribers`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':         SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        // ON CONFLICT DO NOTHING — re-submitting same email silently ignores
        'Prefer':        'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(payload),
    });

    // Supabase returns 201 on insert, 200 on ignored duplicate
    if (response.ok || response.status === 201 || response.status === 200) {
      return res.status(200).json({ ok: true });
    }

    const errBody = await response.text();
    console.error('Supabase insert error:', response.status, errBody);
    return res.status(500).json({ error: 'Database write failed' });

  } catch (err) {
    console.error('subscribe.js fetch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

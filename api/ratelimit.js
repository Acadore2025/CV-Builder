/**
 * _rateLimit.js — IP-based rate limiting via Supabase event log
 *
 * Strategy: sliding 1-hour window per (IP, endpoint) pair.
 * - Count check   → one Supabase SELECT (adds ~50-80ms per request)
 * - Event logging → fire-and-forget INSERT (zero added latency)
 *
 * Fails OPEN: if Supabase is unreachable the request proceeds.
 * This is intentional — a DB hiccup should not block your users.
 *
 * Required Supabase table (run once in your SQL editor):
 * ─────────────────────────────────────────────────────────────
 * CREATE TABLE rate_limit_events (
 *   id         BIGSERIAL   PRIMARY KEY,
 *   ip         TEXT        NOT NULL,
 *   endpoint   TEXT        NOT NULL,
 *   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 * );
 * CREATE INDEX idx_rle_lookup
 *   ON rate_limit_events (ip, endpoint, created_at DESC);
 *
 * Optional cleanup (Supabase Pro pg_cron — runs every hour):
 * SELECT cron.schedule('cleanup-rate-limits', '0 * * * *',
 *   $$DELETE FROM rate_limit_events WHERE created_at < NOW() - INTERVAL '24 hours'$$);
 * ─────────────────────────────────────────────────────────────
 *
 * Uses env vars already present: SUPABASE_URL, SUPABASE_ANON_KEY
 */

// Per-endpoint limits over a rolling 1-hour window
const LIMITS = {
  score:    { max: 8,  label: 'Resume analysis'   },   // full Sonnet analysis
  generate: { max: 5,  label: 'Resume generation' },   // most expensive route
  extract:  { max: 12, label: 'File extraction'   },   // Claude Vision PDF
};

const WINDOW_MS = 60 * 60 * 1000; // 1 hour in ms

/**
 * Extract the real client IP from Vercel's forwarded headers.
 * x-forwarded-for can be a comma-separated list — first entry is the client.
 */
function getIP(req) {
  const raw =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown';
  return raw.slice(0, 45); // guard against absurdly long values
}

/**
 * checkRateLimit(req, endpoint)
 *
 * Returns { ok: true } if the request is within limits.
 * Returns { ok: false, status: 429, error: string } if the limit is exceeded.
 */
async function checkRateLimit(req, endpoint) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;

  // Fail open if env vars not configured (local dev, staging without Supabase, etc.)
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { ok: true };

  const config = LIMITS[endpoint];
  if (!config) return { ok: true }; // unknown endpoint — not rate-limited

  const ip          = getIP(req);
  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  const baseHeaders = {
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type':  'application/json',
  };

  try {
    // ── 1. Count events in the rolling window ─────────────────────────────
    const countURL = new URL(`${SUPABASE_URL}/rest/v1/rate_limit_events`);
    countURL.searchParams.set('select',     'id');
    countURL.searchParams.set('ip',         `eq.${ip}`);
    countURL.searchParams.set('endpoint',   `eq.${endpoint}`);
    countURL.searchParams.set('created_at', `gt.${windowStart}`);

    const countRes = await fetch(countURL.toString(), {
      headers: { ...baseHeaders, 'Prefer': 'count=exact' },
    });

    // Supabase returns count in Content-Range: 0-N/total
    const contentRange = countRes.headers.get('content-range') || '0/0';
    const total = parseInt(contentRange.split('/')[1] || '0', 10);

    if (total >= config.max) {
      return {
        ok:     false,
        status: 429,
        error:  `${config.label} limit reached (${config.max} per hour). Please try again later.`,
      };
    }

    // ── 2. Log this request — fire-and-forget, never awaited ──────────────
    fetch(`${SUPABASE_URL}/rest/v1/rate_limit_events`, {
      method:  'POST',
      headers: { ...baseHeaders, 'Prefer': 'return=minimal' },
      body:    JSON.stringify({ ip, endpoint }),
    }).catch(() => {}); // intentionally swallowed

    return { ok: true, remaining: config.max - total - 1 };

  } catch (err) {
    // Supabase unreachable — fail open, log for visibility
    console.error('[rateLimit] check failed, failing open:', err.message);
    return { ok: true };
  }
}

module.exports = { checkRateLimit };

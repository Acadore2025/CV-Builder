/**
 * score.js — Resume Scoring Engine
 *
 * Two-call architecture — full quality, no timeouts:
 *
 *   mode: 'fast'  → Haiku  → ~15s → scores, knockout_flags, top_fixes, overview
 *   mode: 'deep'  → Sonnet → ~35s → section_feedback (with before/after), skills, hr_reasons, hr_mindset
 *
 * Frontend fires 'fast' first → user sees scores immediately.
 * Frontend fires 'deep' right after → deep analysis loads in background.
 *
 * Legacy modes: 'quick' aliased to 'fast'. 'full' aliased to 'fast'.
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { resume_text, experience_level, target_role, mode } = req.body;
  if (!resume_text?.trim()) return res.status(400).json({ error: 'resume_text is required' });

  const resolvedMode = (mode === 'quick' || mode === 'full' || !mode) ? 'fast' : mode;

  if (resolvedMode === 'deep') {
    return runDeep(res, apiKey, resume_text.trim(), experience_level, target_role);
  }
  return runFast(res, apiKey, resume_text.trim(), experience_level, target_role);
};

// ── FAST call — Haiku, 30s timeout ─────────────────────────────────────────

async function runFast(res, apiKey, resume, level, role) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        temperature: 0,
        system: 'Be concise. Fill required fields only. Keep all string values under 100 characters.',
        tools: [FAST_TOOL],
        tool_choice: { type: 'tool', name: FAST_TOOL.name },
        messages: [{ role: 'user', content: buildFastPrompt(resume, level, role) }],
      }),
    });

    clearTimeout(timeout);
    return handleResponse(res, response, FAST_TOOL.name);

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Scoring timed out. Please try again.' });
    }
    return res.status(500).json({ error: err.message });
  }
}

// ── DEEP call — Sonnet, 55s timeout ────────────────────────────────────────

async function runDeep(res, apiKey, resume, level, role) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        temperature: 0,
        system: 'Be detailed and actionable. Write clear before/after rewrites. Never copy resume text verbatim — paraphrase and improve.',
        tools: [DEEP_TOOL],
        tool_choice: { type: 'tool', name: DEEP_TOOL.name },
        messages: [{ role: 'user', content: buildDeepPrompt(resume, level, role) }],
      }),
    });

    clearTimeout(timeout);
    return handleResponse(res, response, DEEP_TOOL.name);

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Deep analysis timed out. Your scores above are still valid — try again.' });
    }
    return res.status(500).json({ error: err.message });
  }
}

// ── Shared response handler ─────────────────────────────────────────────────

async function handleResponse(res, response, toolName) {
  let envelope;
  const raw = await response.text();

  try {
    envelope = JSON.parse(raw);
  } catch {
    return res.status(500).json({ error: 'Unexpected response from AI service', preview: raw.slice(0, 300) });
  }

  if (envelope.error) return res.status(500).json({ error: envelope.error.message });

  const toolBlock = (envelope.content || []).find(b => b.type === 'tool_use' && b.name === toolName);
  if (!toolBlock) return res.status(500).json({ error: `Model did not invoke ${toolName}` });

  return res.status(200).json(toolBlock.input);
}

// ── Tool schemas ────────────────────────────────────────────────────────────

const SCORE_PROPS = {
  overall:                { type: 'integer', description: 'Weighted overall 0-100' },
  ats_compatibility:      { type: 'integer', description: 'ATS compatibility 0-100' },
  content_quality:        { type: 'integer', description: 'Content quality 0-100' },
  skills_relevance:       { type: 'integer', description: 'Skills relevance 0-100' },
  structure_readability:  { type: 'integer', description: 'Structure and readability 0-100' },
  career_narrative:       { type: 'integer', description: 'Career narrative 0-100' },
  professional_standards: { type: 'integer', description: 'Professional standards 0-100' },
};

const KNOCKOUT_ITEM = {
  type: 'object',
  properties: {
    type:      { type: 'string', enum: ['critical', 'major'] },
    dimension: { type: 'string' },
    reason:    { type: 'string' },
    cap:       { type: 'integer' },
  },
  required: ['type', 'dimension', 'reason', 'cap'],
};

const FIX_ITEM = {
  type: 'object',
  properties: {
    priority:         { type: 'integer' },
    fix:              { type: 'string' },
    dimension:        { type: 'string' },
    points_available: { type: 'integer' },
    why:              { type: 'string' },
  },
  required: ['priority', 'fix', 'dimension', 'points_available', 'why'],
};

// Call 1 — Haiku: scores + overview
const FAST_TOOL = {
  name: 'score_resume_fast',
  description: 'Score resume across 7 dimensions. Return scores, knockout flags, top fixes, and overview.',
  input_schema: {
    type: 'object',
    properties: {
      scores: {
        type: 'object',
        properties: SCORE_PROPS,
        required: Object.keys(SCORE_PROPS),
      },
      knockout_flags: {
        type: 'array',
        items: KNOCKOUT_ITEM,
      },
      top_fixes: {
        type: 'array',
        items: FIX_ITEM,
        maxItems: 3,
      },
      overview: {
        type: 'object',
        properties: {
          strengths: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              properties: {
                point:  { type: 'string' },
                detail: { type: 'string' },
              },
              required: ['point', 'detail'],
            },
          },
          critical_issues: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              properties: {
                issue:  { type: 'string' },
                impact: { type: 'string' },
              },
              required: ['issue', 'impact'],
            },
          },
        },
        required: ['strengths', 'critical_issues'],
      },
    },
    required: ['scores', 'knockout_flags', 'top_fixes', 'overview'],
  },
};

// Call 2 — Sonnet: full quality deep analysis, before/after preserved
const DEEP_TOOL = {
  name: 'score_resume_deep',
  description: 'Deep resume analysis with section rewrites, skills gap, HR rejection reasons, and recruiter mindset.',
  input_schema: {
    type: 'object',
    properties: {
      skills: {
        type: 'object',
        properties: {
          strong_skills: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 8,
          },
          missing_skills: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 8,
          },
          recommendations: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              properties: {
                skill: { type: 'string' },
                why:   { type: 'string' },
                how:   { type: 'string' },
              },
              required: ['skill', 'why', 'how'],
            },
          },
        },
        required: ['strong_skills', 'missing_skills', 'recommendations'],
      },
      section_feedback: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            section:  { type: 'string' },
            score:    { type: 'integer' },
            verdict:  { type: 'string', enum: ['Strong', 'Good', 'Needs Work', 'Missing'] },
            feedback: { type: 'string' },
            before:   { type: 'string', description: 'Paraphrase of current weak state — do not copy resume text verbatim' },
            after:    { type: 'string', description: 'Concrete improved rewrite of the same section' },
          },
          required: ['section', 'score', 'verdict', 'feedback', 'before', 'after'],
        },
      },
      hr_reasons: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            rank:   { type: 'integer' },
            reason: { type: 'string' },
            detail: { type: 'string' },
            fix:    { type: 'string' },
          },
          required: ['rank', 'reason', 'detail', 'fix'],
        },
      },
      hr_mindset: {
        type: 'string',
        description: '3-4 sentences. Exactly what a recruiter thinks during the first 6 seconds of reading this resume.',
      },
    },
    required: ['skills', 'section_feedback', 'hr_reasons', 'hr_mindset'],
  },
};

// ── Prompts ─────────────────────────────────────────────────────────────────

function buildFastPrompt(resume, level, role) {
  return `You are a professional resume scoring engine. Score the resume below using the rubric precisely.

RESUME:
${resume}

EXPERIENCE LEVEL: ${level || 'mid'}
TARGET ROLE: ${role || 'Not specified'}

SCORING WEIGHTS:
Content Quality 28% | ATS Compatibility 24% | Skills Relevance 22% | Professional Standards 10% | Structure 9% | Career Narrative 7%
FORMULA: overall = round((ats×0.24)+(content×0.28)+(skills×0.22)+(structure×0.09)+(narrative×0.07)+(professional_standards×0.10))

=== DIMENSION 1: ATS COMPATIBILITY ===
KNOCKOUT: Tables/multi-column → cap 35 critical | Non-standard headings → cap 60 major | Contact in header/footer only → cap 60 major
CHECKPOINTS: No tables/columns: 15 | Standard headings: 10 | No images: 10 | Consistent dates: 8 | Contact in body: 8 | No special bullets: 7 | Keywords match role (0-20): 20 | Clean LinkedIn URL: 5 | No "References available": -5 | No "Objective Statement": -5

=== DIMENSION 2: CONTENT QUALITY ===
Action verb + metric in same bullet → 8pts/bullet (best 5, max 40) | Action verb only → 2pts/bullet
Filler phrases (responsible for/helped/worked on/assisted): -3 each max -15 | Specific summary: 15 | Consistent tense: 10 | No pronouns: 8 | No spelling errors: 7

=== DIMENSION 3: SKILLS RELEVANCE ===
Core technical skills (0-30): 30 | Specific not vague: 20 | No outdated tools: 15 | Modern tools: 20 | Categorised: 15

=== DIMENSION 4: STRUCTURE & READABILITY ===
Appropriate length: 20 | Bullets per role 3-6: 20 | Avg bullet 12-20 words: 15 | Correct section order: 15 | No walls of text: 15 | Balance: 15

=== DIMENSION 5: CAREER NARRATIVE ===
Clear progression: 30 | No gaps >6 months (-10 each): 20 | Summary matches experience: 25 | Roles connect to target: 25

=== DIMENSION 6: PROFESSIONAL STANDARDS ===
Professional email: 25 | Complete contact: 25 | No personal data (DOB/religion/marital): 20 | Consistent dates: 15 | No grammar errors: 15

Write your own assessments — do not copy or quote phrases from the resume.`;
}

function buildDeepPrompt(resume, level, role) {
  return `You are an expert resume coach and senior hiring manager with 15 years of experience. Perform a deep analysis of the resume below.

RESUME:
${resume}

EXPERIENCE LEVEL: ${level || 'mid'}
TARGET ROLE: ${role || 'Not specified'}

Your analysis must cover four areas:

1. SKILLS GAP
   - List skills this candidate demonstrates strongly
   - List skills missing or weak vs the target role
   - Give 3 specific, actionable learning recommendations (skill + why it matters + how to acquire it)

2. SECTION-BY-SECTION FEEDBACK
   Analyse each major section (Summary, Experience, Skills, Education, and Projects if present):
   - Score 0-100
   - Verdict: Strong / Good / Needs Work / Missing
   - Specific feedback on what is weak and why
   - BEFORE: paraphrase the current weak version in your own words (never copy verbatim)
   - AFTER: write a concrete, meaningfully improved rewrite of that section

3. HR REJECTION REASONS
   The top 5 reasons a recruiter would reject this resume in the first screening pass, ranked by likelihood. For each: the reason, why it matters to a recruiter, and the specific fix.

4. RECRUITER MINDSET
   Write 3-4 sentences capturing exactly what goes through a recruiter's mind in the first 6 seconds of reading this resume — the gut reaction, what stands out, what raises red flags.

Be direct and specific. Generic observations like "improve your summary" are not acceptable — every point must reference something specific in this resume.`;
}

/**
 * score.js — Resume Scoring Engine
 * Uses Anthropic Tool Use API for guaranteed structured output.
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

  const isQuick = mode === 'quick';
  // BUG-001 FIX: correct model strings
  const model = isQuick ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';
  const tool  = isQuick ? QUICK_TOOL : FULL_TOOL;

  // BUG-002 FIX: AbortController with 55s timeout (under Vercel Pro 60s limit)
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
        model,
        max_tokens: isQuick ? 2000 : 6000,
        temperature: 0,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: buildPrompt(resume_text.trim(), experience_level, target_role) }],
      }),
    });

    clearTimeout(timeout);

    let envelope;
    const raw = await response.text();
    try { envelope = JSON.parse(raw); }
    catch { return res.status(500).json({ error: 'Unexpected response from AI service', preview: raw.slice(0, 300) }); }

    if (envelope.error) return res.status(500).json({ error: envelope.error.message });

    const toolBlock = (envelope.content || []).find(b => b.type === 'tool_use' && b.name === tool.name);
    if (!toolBlock) return res.status(500).json({ error: 'Model did not invoke the scoring tool' });

    return res.status(200).json(toolBlock.input);

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Analysis timed out. Try Quick mode for faster results.' });
    }
    return res.status(500).json({ error: err.message });
  }
};

// ── Tool definitions ────────────────────────────────────────────────────────

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

const QUICK_TOOL = {
  name: 'score_resume_quick',
  description: 'Score a resume quickly — return scores, knockout flags, and top 3 fixes.',
  input_schema: {
    type: 'object',
    properties: {
      scores:         { type: 'object', properties: SCORE_PROPS, required: Object.keys(SCORE_PROPS) },
      knockout_flags: { type: 'array', items: KNOCKOUT_ITEM },
      top_fixes:      { type: 'array', items: FIX_ITEM, maxItems: 3 },
    },
    required: ['scores', 'knockout_flags', 'top_fixes'],
  },
};

const FULL_TOOL = {
  name: 'score_resume_full',
  description: 'Full 7-dimension resume analysis.',
  input_schema: {
    type: 'object',
    properties: {
      scores:         { type: 'object', properties: SCORE_PROPS, required: Object.keys(SCORE_PROPS) },
      knockout_flags: { type: 'array', items: KNOCKOUT_ITEM },
      top_fixes:      { type: 'array', items: FIX_ITEM, maxItems: 5 },
      overview: {
        type: 'object',
        properties: {
          strengths:       { type: 'array', maxItems: 4, items: { type: 'object', properties: { point: { type: 'string' }, detail: { type: 'string' } }, required: ['point', 'detail'] } },
          critical_issues: { type: 'array', maxItems: 4, items: { type: 'object', properties: { issue: { type: 'string' }, impact: { type: 'string' } }, required: ['issue', 'impact'] } },
        },
        required: ['strengths', 'critical_issues'],
      },
      skills: {
        type: 'object',
        properties: {
          strong_skills:   { type: 'array', items: { type: 'string' }, maxItems: 8 },
          missing_skills:  { type: 'array', items: { type: 'string' }, maxItems: 8 },
          recommendations: { type: 'array', maxItems: 3, items: { type: 'object', properties: { skill: { type: 'string' }, why: { type: 'string' }, how: { type: 'string' } }, required: ['skill', 'why', 'how'] } },
        },
        required: ['strong_skills', 'missing_skills', 'recommendations'],
      },
      section_feedback: {
        type: 'array', maxItems: 5,
        items: {
          type: 'object',
          properties: {
            section:  { type: 'string' },
            score:    { type: 'integer' },
            verdict:  { type: 'string', enum: ['Strong', 'Good', 'Needs Work', 'Missing'] },
            feedback: { type: 'string' },
            before:   { type: 'string', description: 'Paraphrase of current state — do not copy resume text' },
            after:    { type: 'string', description: 'Paraphrase of improved version' },
          },
          required: ['section', 'score', 'verdict', 'feedback', 'before', 'after'],
        },
      },
      hr_reasons: {
        type: 'array', maxItems: 5,
        items: {
          type: 'object',
          properties: { rank: { type: 'integer' }, reason: { type: 'string' }, detail: { type: 'string' }, fix: { type: 'string' } },
          required: ['rank', 'reason', 'detail', 'fix'],
        },
      },
      hr_mindset: { type: 'string', description: '3-4 sentences. What the recruiter thinks in first 6 seconds.' },
    },
    required: ['scores', 'knockout_flags', 'top_fixes', 'overview', 'skills', 'section_feedback', 'hr_reasons', 'hr_mindset'],
  },
};

// ── Prompt ──────────────────────────────────────────────────────────────────
function buildPrompt(resume, level, role) {
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

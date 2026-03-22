/**
 * score.js — Resume Scoring Engine
 *
 * Uses the Anthropic Tool Use API to guarantee structured output.
 * The model fills typed parameters defined in a schema — the API serialises
 * them. There is no JSON.parse on model output, no repair function, no
 * sanitize workarounds. If the model call succeeds, the data is valid.
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
  const model   = isQuick ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-20250514';
  const tool    = isQuick ? QUICK_TOOL : FULL_TOOL;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
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
        messages: [{
          role: 'user',
          content: buildPrompt(resume_text.trim(), experience_level, target_role),
        }],
      }),
    });

    // Parse Anthropic envelope
    let envelope;
    const raw = await response.text();
    try { envelope = JSON.parse(raw); }
    catch { return res.status(500).json({ error: 'Unexpected response from AI service', preview: raw.slice(0, 300) }); }

    if (envelope.error) return res.status(500).json({ error: envelope.error.message });

    // Extract tool_use block — input is already a parsed JS object from the API
    const toolBlock = (envelope.content || []).find(b => b.type === 'tool_use' && b.name === tool.name);
    if (!toolBlock) return res.status(500).json({ error: 'Model did not invoke the scoring tool' });

    // toolBlock.input is valid structured data — no JSON.parse, no repair needed
    return res.status(200).json(toolBlock.input);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS
// The schema enforces types. The model cannot return a string where an
// integer is expected, cannot omit required fields, cannot embed raw
// newlines or unescaped quotes in string values — the API handles all of it.
// ══════════════════════════════════════════════════════════════════════════════

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

// Quick: scores + flags + top fixes only (Haiku)
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

// Full: complete 7-dimension analysis (Sonnet)
const FULL_TOOL = {
  name: 'score_resume_full',
  description: 'Full 7-dimension resume analysis.',
  input_schema: {
    type: 'object',
    properties: {

      scores: {
        type: 'object',
        properties: SCORE_PROPS,
        required: Object.keys(SCORE_PROPS),
      },

      knockout_flags: { type: 'array', items: KNOCKOUT_ITEM },

      top_fixes: { type: 'array', items: FIX_ITEM, maxItems: 5 },

      overview: {
        type: 'object',
        properties: {
          strengths: {
            type: 'array', maxItems: 4,
            items: {
              type: 'object',
              properties: { point: { type: 'string' }, detail: { type: 'string' } },
              required: ['point', 'detail'],
            },
          },
          critical_issues: {
            type: 'array', maxItems: 4,
            items: {
              type: 'object',
              properties: { issue: { type: 'string' }, impact: { type: 'string' } },
              required: ['issue', 'impact'],
            },
          },
        },
        required: ['strengths', 'critical_issues'],
      },

      skills: {
        type: 'object',
        properties: {
          strong_skills:   { type: 'array', items: { type: 'string' }, maxItems: 8 },
          missing_skills:  { type: 'array', items: { type: 'string' }, maxItems: 8 },
          recommendations: {
            type: 'array', maxItems: 3,
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
        type: 'array', maxItems: 5,
        items: {
          type: 'object',
          properties: {
            section:  { type: 'string' },
            score:    { type: 'integer' },
            verdict:  { type: 'string', enum: ['Strong', 'Good', 'Needs Work', 'Missing'] },
            feedback: { type: 'string' },
            before:   { type: 'string', description: 'Your paraphrase of current state — do not copy resume text' },
            after:    { type: 'string', description: 'Your paraphrase of improved version' },
          },
          required: ['section', 'score', 'verdict', 'feedback', 'before', 'after'],
        },
      },

      hr_reasons: {
        type: 'array', maxItems: 5,
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
        description: '3-4 sentences. What the recruiter thinks in first 6 seconds. Specific and direct.',
      },

    },
    required: ['scores', 'knockout_flags', 'top_fixes', 'overview', 'skills', 'section_feedback', 'hr_reasons', 'hr_mindset'],
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// PROMPT — no JSON schema block needed; the tool schema handles structure
// ══════════════════════════════════════════════════════════════════════════════
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
KNOCKOUT (apply before other scoring):
  Tables/multi-column/text-boxes detected → score cap 35, knockout critical
  Non-standard headings (My Journey etc) → score cap 60, knockout major
  Contact only in header/footer → score cap 60, knockout major
CHECKPOINTS:
  No tables/columns/text-boxes: 15pts
  Standard headings (Experience, Education, Skills, Summary, Certifications): 10pts
  No images/graphics: 10pts
  Consistent parseable dates: 8pts
  Contact in plain text body: 8pts
  No special char bullets: 7pts
  Keywords match role+seniority (0-20): 20pts
  Clean LinkedIn URL: 5pts
  No "References available": -5 if present
  No "Objective Statement": -5 if present

=== DIMENSION 2: CONTENT QUALITY ===
  Action verb + quantified metric in same bullet → 8pts/bullet (best 5, max 40pts)
  Action verb only, no metric → 2pts/bullet
  Filler phrases (responsible for/helped/worked on/assisted in): -3 each, max -15
  Specific summary (role+years+domain+achievement): 15pts
  Consistent tense: 10pts
  No personal pronouns: 8pts (-2 each, max -8)
  No spelling errors: 7pts

=== DIMENSION 3: SKILLS RELEVANCE ===
  Core technical skills for role (0-30): 30pts
  Specific not vague (Python not Programming): 20pts
  No outdated padding: 15pts
  Modern tools for the role: 20pts
  Skills categorised: 15pts

=== DIMENSION 4: STRUCTURE & READABILITY ===
  Appropriate length (1-2 pages): 20pts
  Bullets per role 3-6 (-10 if 1-2; -5 if 7+): 20pts
  Avg bullet 12-20 words: 15pts
  Sections in correct order: 15pts
  No walls of text: 15pts
  Visual balance: 15pts

=== DIMENSION 5: CAREER NARRATIVE ===
  Clear progression: 30pts
  No unexplained gaps >6 months (-10 each): 20pts
  Summary matches actual experience: 25pts
  Roles connect to target position: 25pts

=== DIMENSION 6: PROFESSIONAL STANDARDS ===
  Professional email address: 25pts
  Complete contact (email+phone+LinkedIn+location): 25pts
  No inappropriate personal data (DOB/religion/marital/ID): 20pts
  Consistent date format: 15pts
  No grammatical errors: 15pts

Write your own assessments — do not copy or quote phrases from the resume.`;
}

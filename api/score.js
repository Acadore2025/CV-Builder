module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { resume_text, experience_level, target_role, mode } = req.body;
  if (!resume_text) return res.status(400).json({ error: 'resume_text is required' });
  const isQuick = mode === 'quick';

  const safeResume = sanitizeResume(resume_text);
  const model = isQuick ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-20250514';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: isQuick ? 2000 : 6000,
        temperature: 0,
        messages: [{ role: 'user', content: buildPrompt(safeResume, experience_level, target_role, isQuick) }]
      })
    });

    const rawText = await response.text();
    let data;
    try { data = JSON.parse(rawText); }
    catch { return res.status(500).json({ error: 'Unexpected response from AI service: ' + rawText.slice(0, 200) }); }

    if (data.error) return res.status(500).json({ error: data.error.message });

    const raw = data.content?.[0]?.text || '';
    let clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    const s = clean.indexOf('{');
    const e = clean.lastIndexOf('}');
    if (s < 0 || e < 0) return res.status(500).json({ error: 'No JSON found in AI response' });
    clean = clean.slice(s, e + 1);

    try {
      return res.status(200).json(JSON.parse(clean));
    } catch (_) {
      const repaired = repairJSON(clean);
      try {
        return res.status(200).json(JSON.parse(repaired));
      } catch (err) {
        return res.status(500).json({ error: 'JSON parse error (after repair): ' + err.message });
      }
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ─── Sanitize ──────────────────────────────────────────────────────────────
function sanitizeResume(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[^\x20-\x7E\n]/g, ' ')
    .replace(/\\/g, '/')
    .replace(/"{2,}/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── JSON repair ───────────────────────────────────────────────────────────
function repairJSON(str) {
  str = str.replace(/,\s*([}\]])/g, '$1');
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\') { result += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString && ch === '\n') { result += '\\n'; continue; }
    if (inString && ch === '\r') { result += '\\r'; continue; }
    result += ch;
  }
  return result;
}

// ─── Prompt ────────────────────────────────────────────────────────────────
function buildPrompt(resume, level, role, isQuick) {

  const scores_schema = `"scores":{"overall":<0-100>,"ats_compatibility":<0-100>,"content_quality":<0-100>,"skills_relevance":<0-100>,"structure_readability":<0-100>,"career_narrative":<0-100>,"professional_standards":<0-100>}`;
  const knockout_schema = `"knockout_flags":[{"type":"critical|major","dimension":"ats|professional_standards|structure","reason":"exact reason","cap":<number>}]`;
  const fixes_schema = `"top_fixes":[{"priority":1,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":2,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":3,"fix":"action","dimension":"name","points_available":<n>,"why":"why"}]`;

  const quickJSON = `{${scores_schema},${knockout_schema},${fixes_schema}}`;

  // fullJSON contains ONLY fields that renderDashboard() in analyser/index.html actually reads.
  // Removed: dimension_breakdown, benchmark, rewrites, quick_wins, ats object, skills.categories
  const fullJSON = `{${scores_schema},${knockout_schema},${fixes_schema.replace(']', ',{"priority":4,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":5,"fix":"action","dimension":"name","points_available":<n>,"why":"why"}]')},"overview":{"strengths":[{"point":"title","detail":"explanation"},{"point":"title","detail":"explanation"}],"critical_issues":[{"issue":"title","impact":"consequence"},{"issue":"title","impact":"consequence"}]},"skills":{"strong_skills":["s1","s2","s3","s4","s5"],"missing_skills":["s1","s2","s3","s4","s5"],"recommendations":[{"skill":"skill","why":"why","how":"how"},{"skill":"skill","why":"why","how":"how"}]},"section_feedback":[{"section":"Summary","score":<n>,"verdict":"Strong|Good|Needs Work|Missing","feedback":"feedback","issues":["issue1"],"before":"paraphrase current state — do not copy verbatim","after":"paraphrase improved version"},{"section":"Work Experience","score":<n>,"verdict":"Strong|Good|Needs Work|Missing","feedback":"feedback","issues":["issue1"],"before":"paraphrase current state","after":"paraphrase improved version"},{"section":"Education","score":<n>,"verdict":"Strong|Good|Needs Work|Missing","feedback":"feedback","issues":["issue1"],"before":"paraphrase current state","after":"paraphrase improved version"},{"section":"Skills Section","score":<n>,"verdict":"Strong|Good|Needs Work|Missing","feedback":"feedback","issues":["issue1"],"before":"paraphrase current state","after":"paraphrase improved version"},{"section":"Certifications","score":<n>,"verdict":"Strong|Good|Needs Work|Missing","feedback":"feedback","issues":["issue1"],"before":"paraphrase current state","after":"paraphrase improved version"}],"hr_reasons":[{"rank":1,"reason":"reason","detail":"detail","fix":"fix"},{"rank":2,"reason":"reason","detail":"detail","fix":"fix"},{"rank":3,"reason":"reason","detail":"detail","fix":"fix"},{"rank":4,"reason":"reason","detail":"detail","fix":"fix"},{"rank":5,"reason":"reason","detail":"detail","fix":"fix"}],"hr_mindset":"3-4 sentences. Specific. Direct. Honest."}`;

  return `You are a professional resume scoring engine. Apply this rubric precisely.

=== STRICT JSON OUTPUT RULES ===
1. Respond with ONE valid JSON object and nothing else — no markdown, no backticks, no commentary.
2. NEVER copy text verbatim from the resume into any JSON string value.
   In "before", "after", "feedback", "detail" fields: write your OWN words. Do not paste resume text.
3. All string values: no double quotes, no backslashes, no raw newlines inside them.

=== RESUME ===
${resume}

EXPERIENCE LEVEL: ${level || 'mid'}
TARGET ROLE: ${role || 'Not specified'}

=== WEIGHTS ===
Content Quality 28% | ATS Compatibility 24% | Skills Relevance 22% | Professional Standards 10% | Structure 9% | Career Narrative 7%
FORMULA: overall = round( (ats×0.24)+(content×0.28)+(skills×0.22)+(structure×0.09)+(narrative×0.07)+(professional_standards×0.10) )

=== DIMENSION 1: ATS COMPATIBILITY ===
KNOCKOUT (apply before other scoring):
  Tables/multi-column/text-boxes → score=35 cap, knockout critical
  Non-standard headings (My Journey/Career Story etc) → score=60 cap, knockout major
  Contact in header/footer only → score=60 cap, knockout major
CHECKPOINTS:
  No tables/columns/text-boxes: 15pts
  Standard headings (Experience,Education,Skills,Summary,Certifications): 10pts
  No images/graphics: 10pts
  Consistent parseable dates: 8pts
  Contact in plain text body: 8pts
  No special char bullets: 7pts
  Plain text readable: 7pts
  Keywords match role+seniority (0-20): 20pts
  Clean LinkedIn URL: 5pts
  No "References available": -5pts if present
  No "Objective Statement": -5pts if present
  Keyword stuffing: -5 per keyword 5+ times (max -15)

=== DIMENSION 2: CONTENT QUALITY ===
  Action verb + quantified metric → 20pts/bullet (best 5, max 40pts)
  Action verb only → 5pts/bullet | No action verb → 0pts
  No filler phrases (responsible for/helped/worked on/assisted/involved in): 15pts (-3 each, max -15)
  Specific summary (role+years+domain+achievement): 15pts
  Consistent tense: 10pts
  No personal pronouns: 8pts (-2 each, max -8)
  Verb variety (-5 if same verb 3+ bullets; -10 if 4+)
  No spelling errors: 7pts

=== DIMENSION 3: SKILLS RELEVANCE ===
  Core technical skills for role (0-30): 30pts
  Specific not vague (Python not Programming): 20pts
  No outdated padding: 15pts
  Modern tools for role: 20pts
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

${isQuick ? quickJSON : fullJSON}`;
}

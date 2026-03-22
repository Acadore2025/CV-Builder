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

  // Sanitize resume — strip chars that cause JSON breakage when model re-embeds them
  const safeResume = sanitizeResume(resume_text);

  // Quick mode → Haiku (small JSON, low risk). Full mode → Sonnet (large JSON, reliable escaping).
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
        max_tokens: isQuick ? 2000 : 8000,
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

    // Extract JSON block
    let clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
    const s = clean.indexOf('{');
    const e = clean.lastIndexOf('}');
    if (s < 0 || e < 0) return res.status(500).json({ error: 'No JSON found in AI response' });
    clean = clean.slice(s, e + 1);

    // Try parsing as-is first
    try {
      return res.status(200).json(JSON.parse(clean));
    } catch (_) {
      // Apply repair and retry
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

// ─── Sanitize resume text ──────────────────────────────────────────────────
function sanitizeResume(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[^\x20-\x7E\n]/g, ' ')  // strip non-ASCII / non-printable
    .replace(/\\/g, '/')               // backslash → forward slash
    .replace(/"{2,}/g, '"')            // collapse consecutive quotes
    .replace(/\n{3,}/g, '\n\n')        // max two blank lines
    .trim();
}

// ─── JSON repair ──────────────────────────────────────────────────────────
// Fixes trailing commas and bare newlines/CRs inside string values.
// Does NOT attempt to fix unescaped quotes — those need model-level prevention.
function repairJSON(str) {
  // Remove trailing commas before } or ]
  str = str.replace(/,\s*([}\]])/g, '$1');

  // Escape bare newlines/CRs inside JSON strings
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

// ─── Prompt builder ────────────────────────────────────────────────────────
function buildPrompt(resume, level, role, isQuick) {
  const scores_schema = `"scores":{"overall":<0-100>,"ats_compatibility":<0-100>,"content_quality":<0-100>,"skills_relevance":<0-100>,"structure_readability":<0-100>,"career_narrative":<0-100>,"professional_standards":<0-100>}`;
  const knockout_schema = `"knockout_flags":[{"type":"critical|major","dimension":"ats|professional_standards|structure","reason":"exact reason","cap":<number>}]`;
  const fixes_schema = `"top_fixes":[{"priority":1,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":2,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":3,"fix":"action","dimension":"name","points_available":<n>,"why":"why"}]`;

  const quickJSON = `{${scores_schema},${knockout_schema},${fixes_schema}}`;

  // NOTE on before/after fields: model is told to PARAPHRASE, not copy verbatim,
  // to prevent unescaped quote characters from the source text breaking the JSON.
  const fullJSON = `{${scores_schema},${knockout_schema},"dimension_breakdown":{"ats_compatibility":{"score":<n>,"checkpoints":[{"check":"name","earned":<n>,"max":<n>,"detail":"finding"}]},"content_quality":{"score":<n>,"checkpoints":[{"check":"name","earned":<n>,"max":<n>,"detail":"finding"}]},"skills_relevance":{"score":<n>,"checkpoints":[{"check":"name","earned":<n>,"max":<n>,"detail":"finding"}]},"structure_readability":{"score":<n>,"checkpoints":[{"check":"name","earned":<n>,"max":<n>,"detail":"finding"}]},"career_narrative":{"score":<n>,"checkpoints":[{"check":"name","earned":<n>,"max":<n>,"detail":"finding"}]},"professional_standards":{"score":<n>,"checkpoints":[{"check":"name","earned":<n>,"max":<n>,"detail":"finding"}]}},"top_fixes":[{"priority":1,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":2,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":3,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":4,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":5,"fix":"action","dimension":"name","points_available":<n>,"why":"why"}],"quick_wins":[{"action":"action","impact":"impact","ats_pts":<n>,"skills_pts":<n>,"overall_pts":<n>},{"action":"action","impact":"impact","ats_pts":<n>,"skills_pts":<n>,"overall_pts":<n>},{"action":"action","impact":"impact","ats_pts":<n>,"skills_pts":<n>,"overall_pts":<n>}],"overview":{"strengths":[{"point":"title","detail":"explanation"}],"critical_issues":[{"issue":"title","impact":"consequence"}]},"ats":{"verdict":"2 sentences","parsing_risk":"low|medium|high","keywords_found":["k1","k2","k3","k4","k5","k6","k7","k8"],"keywords_missing":["k1","k2","k3","k4","k5","k6","k7","k8"],"parsing_issues":[{"issue":"problem","fix":"fix"}]},"skills":{"categories":[{"name":"Technical Skills","yours":<n>,"required":<n>},{"name":"Leadership","yours":<n>,"required":<n>},{"name":"Domain Knowledge","yours":<n>,"required":<n>},{"name":"Tools & Software","yours":<n>,"required":<n>},{"name":"Soft Skills","yours":<n>,"required":<n>}],"strong_skills":["s1","s2","s3","s4","s5"],"missing_skills":["s1","s2","s3","s4","s5"],"recommendations":[{"skill":"skill","why":"why","how":"how"}]},"section_feedback":[{"section":"Summary","score":<n>,"verdict":"Strong|Good|Needs Work|Missing","feedback":"feedback","issues":["i1"],"before":"paraphrased description of current state","after":"paraphrased improved version"},{"section":"Work Experience","score":<n>,"verdict":"...","feedback":"...","issues":["..."],"before":"paraphrased description of current state","after":"paraphrased improved version"},{"section":"Education","score":<n>,"verdict":"...","feedback":"...","issues":["..."],"before":"paraphrased description of current state","after":"paraphrased improved version"},{"section":"Skills Section","score":<n>,"verdict":"...","feedback":"...","issues":["..."],"before":"paraphrased description of current state","after":"paraphrased improved version"},{"section":"Certifications","score":<n>,"verdict":"...","feedback":"...","issues":["..."],"before":"paraphrased description of current state","after":"paraphrased improved version"}],"benchmark":{"dimensions":[{"label":"Years of experience","you":<n>,"avg_candidate":<n>,"top_10_pct":<n>},{"label":"Certifications","you":<n>,"avg_candidate":<n>,"top_10_pct":<n>},{"label":"Quantified achievements","you":<n>,"avg_candidate":<n>,"top_10_pct":<n>},{"label":"Skills breadth","you":<n>,"avg_candidate":<n>,"top_10_pct":<n>},{"label":"Resume quality","you":<n>,"avg_candidate":<n>,"top_10_pct":<n>},{"label":"ATS optimisation","you":<n>,"avg_candidate":<n>,"top_10_pct":<n>}],"gaps_vs_top":[{"gap":"gap","how_to_close":"action"}],"your_advantages":["a1","a2","a3"]},"rewrites":[{"section":"Summary","original":"paraphrased description of current state - do not copy verbatim","rewritten":"improved version written by you","why":"why"},{"section":"Experience Bullet 1","original":"paraphrased description of current state - do not copy verbatim","rewritten":"improved version written by you","why":"why"},{"section":"Experience Bullet 2","original":"paraphrased description of current state - do not copy verbatim","rewritten":"improved version written by you","why":"why"},{"section":"Skills Section","original":"paraphrased description of current state - do not copy verbatim","rewritten":"improved version written by you","why":"why"}],"hr_reasons":[{"rank":1,"reason":"reason","detail":"detail","fix":"fix"},{"rank":2,"reason":"...","detail":"...","fix":"..."},{"rank":3,"reason":"...","detail":"...","fix":"..."},{"rank":4,"reason":"...","detail":"...","fix":"..."},{"rank":5,"reason":"...","detail":"...","fix":"..."}],"hr_mindset":"3-4 sentences. Specific. Direct. Honest."}`;

  return `You are a professional resume scoring engine. Apply this rubric precisely.

=== STRICT JSON OUTPUT RULES ===
1. Respond with ONE valid JSON object and absolutely nothing else.
2. No markdown, no backticks, no commentary before or after the JSON.
3. NEVER copy text verbatim from the resume into any JSON field.
   - In "before", "original", "after", "rewritten" fields: write your OWN paraphrased description. Do not paste resume text.
   - This prevents quote characters in the source from breaking the JSON.
4. All string values must be safe plain text — no double quotes, no backslashes, no raw newlines inside them.

=== RESUME TO SCORE ===
${resume}

EXPERIENCE LEVEL: ${level || 'mid'}
TARGET ROLE: ${role || 'Not specified'}

=== SCORING WEIGHTS ===
Content Quality 28% | ATS Compatibility 24% | Skills Relevance 22% | Professional Standards 10% | Structure 9% | Career Narrative 7%
FORMULA: overall = round( (ats×0.24)+(content×0.28)+(skills×0.22)+(structure×0.09)+(narrative×0.07)+(professional_standards×0.10) )

=== DIMENSION 1: ATS COMPATIBILITY ===
KNOCKOUT (check first, apply caps before other scoring):
  Tables/multi-column/text-boxes detected → score=35 hard cap, knockout critical
  Non-standard headings (My Journey/Career Story etc) → score=60 cap, knockout major
  Contact in header/footer only → score=60 cap, knockout major
STANDARD CHECKPOINTS (if no critical knockout):
  No tables/columns/text-boxes: 15pts
  Standard headings (Experience,Education,Skills,Summary,Certifications): 10pts
  No images/graphics/logos: 10pts
  Consistent parseable dates: 8pts
  Contact details in plain text body: 8pts
  No special char bullets: 7pts
  Plain text readable: 7pts
  Keywords match role+seniority (0-20 scale): 20pts
  Clean LinkedIn vanity URL: 5pts
  No "References available upon request": 5pts (deduct 5 if present)
  No "Objective Statement" instead of Summary: 5pts (deduct 5 if present)
  Keyword stuffing: deduct 5 per keyword 5+ times (max -15)

=== DIMENSION 2: CONTENT QUALITY ===
  Action verb + quantified metric in same bullet → 20pts per bullet (best 5, scale to 40pts max)
  Action verb only, no metric → 5pts per bullet
  No action verb → 0pts
  No filler phrases (responsible for/helped with/worked on/assisted in/involved in): 15pts (deduct 3 each, max -15)
  Specific summary (role+years+domain+achievement): 15pts
  Consistent tense: 10pts
  No personal pronouns: 8pts (deduct 2 each, max -8)
  Verb variety (same verb 3+ bullets: -5; 4+: -10)
  No spelling errors: 7pts

=== DIMENSION 3: SKILLS RELEVANCE ===
  Core technical skills for role (0-30 scale): 30pts
  Specific not vague (Python not Programming): 20pts
  No padding with outdated tools: 15pts
  Modern tools for the role: 20pts
  Skills categorised (Technical/Tools/Soft): 15pts

=== DIMENSION 4: STRUCTURE & READABILITY ===
  Appropriate length (1-2 pages standard): 20pts
  Bullet count per role 3-6 (deduct 10 if 1-2; deduct 5 if 7+): 20pts
  Average bullet 12-20 words: 15pts
  Sections in correct order: 15pts
  No walls of text: 15pts
  Visual balance: 15pts

=== DIMENSION 5: CAREER NARRATIVE ===
  Clear progression: 30pts
  No unexplained gaps >6 months (deduct 10 each): 20pts
  Summary matches actual experience: 25pts
  Roles connect to target position: 25pts

=== DIMENSION 6: PROFESSIONAL STANDARDS ===
  Professional email address: 25pts
  Complete contact section (email+phone+LinkedIn+location): 25pts
  No inappropriate personal data (DOB/religion/marital/ID): 20pts
  Consistent date formatting: 15pts
  No grammatical errors: 15pts

${isQuick ? quickJSON : fullJSON}`;
}

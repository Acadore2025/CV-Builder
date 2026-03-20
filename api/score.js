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
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: isQuick ? 2000 : 8000,
        temperature: 0,
        messages: [{ role: 'user', content: buildPrompt(resume_text, experience_level, target_role, isQuick) }]
      })
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { return res.status(500).json({ error: 'Unexpected response: ' + text.slice(0,200) }); }
    if (data.error) return res.status(500).json({ error: data.error.message });
    const raw = data.content?.[0]?.text || '';
    let clean = raw.replace(/```json/g,'').replace(/```/g,'').trim();
    const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
    if (s<0||e<0) return res.status(500).json({ error: 'No JSON in response' });
    const jsonStr = clean.slice(s,e+1);
    try { return res.status(200).json(JSON.parse(jsonStr)); }
    catch(err) {
      // Attempt repair: fix unescaped quotes and control characters inside string values
      try {
        const repaired = repairJSON(jsonStr);
        return res.status(200).json(JSON.parse(repaired));
      } catch(err2) {
        return res.status(500).json({ error: 'Parse error: '+err.message+' | Repair failed: '+err2.message });
      }
    }
  } catch(err) { return res.status(500).json({ error: err.message }); }
};


function repairJSON(str) {
  // Remove actual newlines/tabs inside string values (between quotes)
  // Strategy: track if we're inside a string, escape problematic chars
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\') { escaped = true; result += ch; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString) {
      // Inside a string — escape any bare control chars
      if (ch === '\n') { result += '\\n'; continue; }
      if (ch === '\r') { result += '\\r'; continue; }
      if (ch === '\t') { result += '\\t'; continue; }
    }
    result += ch;
  }
  return result;
}

function buildPrompt(resume, level, role, isQuick) {


  const scores_schema = `"scores":{"overall":<0-100>,"ats_compatibility":<0-100>,"content_quality":<0-100>,"skills_relevance":<0-100>,"structure_readability":<0-100>,"career_narrative":<0-100>}`;
  const knockout_schema = `"knockout_flags":[{"type":"critical|major","dimension":"ats|structure|content|skills|narrative","reason":"exact reason","cap":<number>}]`;
  const fixes_schema = `"top_fixes":[{"priority":1,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":2,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":3,"fix":"action","dimension":"name","points_available":<n>,"why":"why"}]`;

  const quickJSON = `{${scores_schema},${knockout_schema},${fixes_schema}}`;

  const fullJSON = `{${scores_schema},${knockout_schema},"overview":{"strengths":[{"point":"title","detail":"explanation"}],"critical_issues":[{"issue":"title","impact":"consequence"}]},"top_fixes":[{"priority":1,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":2,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":3,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":4,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":5,"fix":"action","dimension":"name","points_available":<n>,"why":"why"}],"skills":{"strong_skills":["every skill tool technology and competency found on the resume"],"missing_skills":["skills prevalent in top job postings globally for this role absent from this resume — include soft skills like Communication Stakeholder Management Presentation"],"recommendations":[{"skill":"skill","why":"why this matters","how":"how to add or demonstrate it"}]},"section_feedback":[{"section":"Summary","score":<n>,"verdict":"Strong|Good|Needs Work|Missing","feedback":"specific feedback","issues":["issue"],"before":"original excerpt","after":"improved version"},{"section":"Work Experience","score":<n>,"verdict":"Strong|Good|Needs Work|Missing","feedback":"...","issues":["..."],"before":"...","after":"..."},{"section":"Education","score":<n>,"verdict":"Strong|Good|Needs Work|Missing","feedback":"...","issues":["..."],"before":"...","after":"..."},{"section":"Skills Section","score":<n>,"verdict":"Strong|Good|Needs Work|Missing","feedback":"...","issues":["..."],"before":"...","after":"..."}],"hr_reasons":[{"rank":1,"reason":"reason","detail":"specific detail","fix":"actionable fix"},{"rank":2,"reason":"...","detail":"...","fix":"..."},{"rank":3,"reason":"...","detail":"...","fix":"..."},{"rank":4,"reason":"...","detail":"...","fix":"..."},{"rank":5,"reason":"...","detail":"...","fix":"..."}],"hr_mindset":"3-4 sentences. Specific. Direct. Honest."}`;

  return `You are a professional resume scoring engine. Apply this rubric precisely. Temperature is 0 — be deterministic.

RESUME:
${resume}

EXPERIENCE LEVEL: ${level||'mid'}
TARGET ROLE: ${role||'Not specified'}

WEIGHTS: Content Quality 28% | ATS Compatibility 24% | Skills Relevance 22% | Structure 12% | Career Narrative 14%
FORMULA: overall = round( (ats×0.24)+(content×0.28)+(skills×0.22)+(structure×0.12)+(narrative×0.14) )

=== DIMENSION 1: ATS COMPATIBILITY ===
KNOCKOUT (check first, apply caps before other scoring):
  Tables/multi-column/text-boxes detected → score=35 hard cap, knockout critical
  Non-standard headings (My Journey/Career Story etc) → score=60 cap, knockout major
  Contact in header/footer → score=60 cap, knockout major
  Photo/headshot detected → note as informational only (some regions require it)
STANDARD CHECKPOINTS (if no critical knockout):
  No tables/columns/text-boxes: 15pts
  Standard headings (Experience,Education,Skills,Summary,Certifications): 10pts
  No images/graphics/logos: 10pts
  Consistent parseable dates: 8pts
  Contact in plain text body: 8pts
  No special char bullets (✦★◆): 7pts
  Plain text readable: 7pts
  Keywords match role+seniority (0-20 scale): 20pts
  Clean LinkedIn vanity URL: 5pts
  No "References available upon request": 5pts (deduct 5 if present)
  No "Objective Statement" instead of Summary: 5pts (deduct 5 if present)
  Keyword stuffing: deduct 5 per keyword appearing 5+ times (max -15)

=== DIMENSION 2: CONTENT QUALITY ===
PROXIMAL ACTION-RESULT (most important — check per bullet):
  Same sentence has strong action verb AND quantified metric → 20pts per bullet (score best 5, scale to 40pts max)
  Action verb present but no metric → 5pts per bullet
  No action verb → 0pts
OTHER:
  No filler phrases (responsible for/helped with/worked on/assisted in/involved in): 15pts (deduct 3 per instance, max -15)
  Summary specific (role+years+domain+achievement): 15pts
  Tense consistent (past=old roles, present=current): 10pts
  No personal pronouns (I/me/my/we): 8pts (deduct 2 per instance, max -8)
  Verb variety (same verb 3+ bullets: -5pts; 4+ bullets: -10pts)
  No spelling errors: 7pts
  Keyword stuffing in content: deduct 5 per keyword 5+ times (max -15)
  Bullet over 200 chars: deduct 2 per instance (max -10)

=== DIMENSION 3: SKILLS RELEVANCE ===
  Core technical skills for role present (0-30 scale): 30pts
  Skills specific not vague (Python not Programming): 20pts
  No padding with outdated/irrelevant tools: 15pts
  Modern tools present (AI tools, cloud platforms, current frameworks for role): 20pts
  Skills categorised (Technical/Tools/Soft): 15pts

=== DIMENSION 4: STRUCTURE & READABILITY ===
  Correct length (1-2 pages standard; 1 page acceptable for under 5 years experience): 20pts
  Bullet count per role 3-6 ideal (deduct 10 if 1-2; deduct 5 if 7+): 20pts
  Average bullet length 12-20 words: 15pts
  Sections in correct order: 15pts
  No walls of text (paragraph over 5 lines): 15pts
  Visual balance (no section over 60% of resume): 15pts

=== DIMENSION 5: CAREER NARRATIVE ===
  Summary claims match actual experience shown (years, domain, seniority): 50pts
  Roles connect logically to target position (career makes sense for the role applied): 50pts
  NOTE: Do NOT penalise for single employer or internal tenure. Do NOT penalise for employment gaps unless directly contradicts dates shown.

SKILLS INSTRUCTIONS (CRITICAL):
  strong_skills: Extract EVERY skill, tool, technology, and competency mentioned anywhere in the resume. Be exhaustive.
  missing_skills: Think globally — what skills appear in the top 20% of job postings worldwide for this role and experience level? List those absent from this resume. ALWAYS include role-relevant soft skills (Communication, Stakeholder Management, Presentation, Problem Solving) if not explicitly mentioned. Be specific — not "leadership" but "cross-functional team leadership".
  Do NOT make up skills the candidate has. Do NOT omit skills that are clearly stated.



Return ONLY valid JSON. No markdown. No explanation. No backticks.
${isQuick ? quickJSON : fullJSON}`;
}

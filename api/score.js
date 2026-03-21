module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  const { resume_text, market, experience_level, target_role, mode } = req.body;
  if (!resume_text) return res.status(400).json({ error: 'resume_text is required' });
  const isQuick = mode === 'quick';
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: isQuick ? 2000 : 7000,
        temperature: 0,
        messages: [{ role: 'user', content: buildPrompt(resume_text, market, experience_level, target_role, isQuick) }]
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
    try { return res.status(200).json(JSON.parse(clean.slice(s,e+1))); }
    catch(err) { return res.status(500).json({ error: 'Parse error: '+err.message }); }
  } catch(err) { return res.status(500).json({ error: err.message }); }
};

function buildPrompt(resume, market, level, role, isQuick) {
  const mctx = {
    India: 'India (Naukri/LinkedIn). No critical failures defined. Photo acceptable. CGPA expected. CTC/notice period expected.',
    US: 'US (Workday/Greenhouse). CRITICAL: photo=ATS cap 35+market 0. DOB=market cap 20. Nationality/religion=market cap 20. Over 1 page under 10yrs=structure cap 30.',
    'Gulf/UAE': 'Gulf/UAE (Bayt/GulfTalent). CRITICAL: no nationality=market cap 40. No visa=market cap 40. No photo=major failure. Languages required.',
    Europe: 'Europe (Europass). Work auth required. Language levels (A1-C2) required. No photo recommended (GDPR). 2-page standard.'
  }[market] || 'India (Naukri/LinkedIn). No critical failures. CGPA expected.';

  const scores_schema = `"scores":{"overall":<0-100>,"ats_compatibility":<0-100>,"content_quality":<0-100>,"skills_relevance":<0-100>,"structure_readability":<0-100>,"career_narrative":<0-100>,"market_fit":<0-100>}`;
  const knockout_schema = `"knockout_flags":[{"type":"critical|major","dimension":"ats|market_fit|structure","reason":"exact reason","cap":<number>}]`;
  const fixes_schema = `"top_fixes":[{"priority":1,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":2,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":3,"fix":"action","dimension":"name","points_available":<n>,"why":"why"}]`;

  const quickJSON = `{${scores_schema},${knockout_schema},${fixes_schema}}`;

  const fullJSON = `{${scores_schema},${knockout_schema},"dimension_breakdown":{"ats_compatibility":{"score":<n>,"checkpoints":[{"check":"name","earned":<n>,"max":<n>,"detail":"finding"}]},"content_quality":{"score":<n>,"checkpoints":[{"check":"name","earned":<n>,"max":<n>,"detail":"finding"}]},"skills_relevance":{"score":<n>,"checkpoints":[{"check":"name","earned":<n>,"max":<n>,"detail":"finding"}]},"structure_readability":{"score":<n>,"checkpoints":[{"check":"name","earned":<n>,"max":<n>,"detail":"finding"}]},"career_narrative":{"score":<n>,"checkpoints":[{"check":"name","earned":<n>,"max":<n>,"detail":"finding"}]},"market_fit":{"score":<n>,"checkpoints":[{"check":"name","earned":<n>,"max":<n>,"detail":"finding"}]}},"top_fixes":[{"priority":1,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":2,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":3,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":4,"fix":"action","dimension":"name","points_available":<n>,"why":"why"},{"priority":5,"fix":"action","dimension":"name","points_available":<n>,"why":"why"}],"quick_wins":[{"action":"action","impact":"impact","ats_pts":<n>,"skills_pts":<n>,"overall_pts":<n>},{"action":"action","impact":"impact","ats_pts":<n>,"skills_pts":<n>,"overall_pts":<n>},{"action":"action","impact":"impact","ats_pts":<n>,"skills_pts":<n>,"overall_pts":<n>}],"overview":{"strengths":[{"point":"title","detail":"explanation"}],"critical_issues":[{"issue":"title","impact":"consequence"}]},"ats":{"verdict":"2 sentences","parsing_risk":"low|medium|high","keywords_found":["k1","k2","k3","k4","k5","k6","k7","k8"],"keywords_missing":["k1","k2","k3","k4","k5","k6","k7","k8"],"parsing_issues":[{"issue":"problem","fix":"fix"}]},"skills":{"categories":[{"name":"Technical Skills","yours":<n>,"required":<n>},{"name":"Leadership","yours":<n>,"required":<n>},{"name":"Domain Knowledge","yours":<n>,"required":<n>},{"name":"Tools & Software","yours":<n>,"required":<n>},{"name":"Soft Skills","yours":<n>,"required":<n>}],"strong_skills":["s1","s2","s3","s4","s5"],"missing_skills":["s1","s2","s3","s4","s5"],"recommendations":[{"skill":"skill","why":"why","how":"how"}]},"section_feedback":[{"section":"Summary","score":<n>,"verdict":"Strong|Good|Needs Work|Missing","feedback":"feedback","issues":["i1"],"before":"excerpt","after":"improved"},{"section":"Work Experience","score":<n>,"verdict":"...","feedback":"...","issues":["..."],"before":"...","after":"..."},{"section":"Education","score":<n>,"verdict":"...","feedback":"...","issues":["..."],"before":"...","after":"..."},{"section":"Skills Section","score":<n>,"verdict":"...","feedback":"...","issues":["..."],"before":"...","after":"..."},{"section":"Certifications","score":<n>,"verdict":"...","feedback":"...","issues":["..."],"before":"...","after":"..."}],"benchmark":{"dimensions":[{"label":"Years of experience","you":<n>,"avg_candidate":<n>,"top_10_pct":<n>},{"label":"Certifications","you":<n>,"avg_candidate":<n>,"top_10_pct":<n>},{"label":"Quantified achievements","you":<n>,"avg_candidate":<n>,"top_10_pct":<n>},{"label":"Skills breadth","you":<n>,"avg_candidate":<n>,"top_10_pct":<n>},{"label":"Resume quality","you":<n>,"avg_candidate":<n>,"top_10_pct":<n>},{"label":"ATS optimisation","you":<n>,"avg_candidate":<n>,"top_10_pct":<n>}],"gaps_vs_top":[{"gap":"gap","how_to_close":"action"}],"your_advantages":["a1","a2","a3"]},"rewrites":[{"section":"Summary","original":"excerpt","rewritten":"improved","why":"why"},{"section":"Experience Bullet 1","original":"original","rewritten":"verb+metric","why":"why"},{"section":"Experience Bullet 2","original":"original","rewritten":"improved","why":"why"},{"section":"Skills Section","original":"original","rewritten":"improved","why":"why"}],"hr_reasons":[{"rank":1,"reason":"reason","detail":"detail","fix":"fix"},{"rank":2,"reason":"...","detail":"...","fix":"..."},{"rank":3,"reason":"...","detail":"...","fix":"..."},{"rank":4,"reason":"...","detail":"...","fix":"..."},{"rank":5,"reason":"...","detail":"...","fix":"..."}],"hr_mindset":"3-4 sentences. Specific. Direct. Honest."}`;

  return `You are a professional resume scoring engine. Apply this rubric precisely. Temperature is 0 — be deterministic.

RESUME:
${resume}

MARKET: ${market||'India'} — ${mctx}
EXPERIENCE LEVEL: ${level||'mid'}
TARGET ROLE: ${role||'Not specified'}

WEIGHTS: Content Quality 28% | ATS Compatibility 24% | Skills Relevance 22% | Market Fit 10% | Structure 9% | Career Narrative 7%
FORMULA: overall = round( (ats×0.24)+(content×0.28)+(skills×0.22)+(structure×0.09)+(narrative×0.07)+(market×0.10) )

=== DIMENSION 1: ATS COMPATIBILITY ===
KNOCKOUT (check first, apply caps before other scoring):
  Tables/multi-column/text-boxes detected → score=35 hard cap, knockout critical
  Non-standard headings (My Journey/Career Story etc) → score=60 cap, knockout major
  Contact in header/footer → score=60 cap, knockout major
  [US] Photo detected → ATS=35 cap + market_fit=0, knockout critical
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
  No padding with outdated tools: 15pts
  Market-specific skills present: 20pts
    India→AI tools (Claude/Copilot/ChatGPT listed)
    US→cloud cert or platform listed
    Gulf→languages with proficiency
    Europe→work auth + language levels
  Skills categorised (Technical/Tools/Soft): 15pts

=== DIMENSION 4: STRUCTURE & READABILITY ===
  Correct length for market (US 1pg <10yrs; India/Gulf/EU 1-2pg): 20pts
  Bullet count per role 3-6 ideal (deduct 10 if 1-2; deduct 5 if 7+): 20pts
  Average bullet length 12-20 words: 15pts
  Sections in correct order: 15pts
  No walls of text (paragraph over 5 lines): 15pts
  Visual balance (no section over 60% of resume): 15pts

=== DIMENSION 5: CAREER NARRATIVE ===
  Career progression clear (titles/responsibility increasing): 30pts
  No unexplained gaps over 6 months (deduct 10 per gap): 20pts
  Summary claims match actual experience shown: 25pts
  Roles connect logically to target position: 25pts

=== DIMENSION 6: MARKET FIT ===
India: CGPA present(20) + CTC/expected CTC(20) + notice period(20) + naukri headline(15) + valid phone format(15) + no foreign elements(10)
US: No photo(25) + no DOB(20) + no nationality/religion/marital(20) + 1-page if <10yrs(20) + GPA only if 3.5+(15)
Gulf: Photo present(20) + nationality(20) + visa status(20) + languages(20) + DOB(10) + driving license(10)
Europe: Work auth stated(25) + language levels shown(25) + no unnecessary personal data(25) + correct length(25)

Return ONLY valid JSON. No markdown. No explanation. No backticks.
${isQuick ? quickJSON : fullJSON}`;
}

/**
 * generate.js — Resume Generator
 *
 * Uses Tool Use API to guarantee a valid structured resume object.
 * The builder frontend receives a typed JS object directly — no JSON.parse,
 * no repair, no silent truncation risk.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const RESUME_TOOL = {
  name: 'build_resume',
  description: 'Generate a complete, polished, ATS-optimised resume from the candidate data provided.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Enhanced professional summary — compelling, results-focused, role-targeted.',
      },
      experience: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title:    { type: 'string' },
            company:  { type: 'string' },
            start:    { type: 'string' },
            end:      { type: 'string' },
            location: { type: 'string' },
            bullets:  { type: 'array', items: { type: 'string' }, minItems: 1 },
          },
          required: ['title', 'company', 'start', 'end', 'bullets'],
        },
      },
      education: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            degree:      { type: 'string' },
            institution: { type: 'string' },
            year:        { type: 'string' },
            cgpa:        { type: 'string' },
            location:    { type: 'string' },
          },
          required: ['degree', 'institution', 'year'],
        },
      },
      skills: {
        type: 'object',
        properties: {
          technical: { type: 'array', items: { type: 'string' } },
          soft:      { type: 'array', items: { type: 'string' } },
          tools:     { type: 'array', items: { type: 'string' } },
          ai:        { type: 'array', items: { type: 'string' } },
          languages: { type: 'array', items: { type: 'string' } },
        },
        required: ['technical', 'soft', 'tools'],
      },
      certs:       { type: 'array', items: { type: 'string' } },
      projects: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:        { type: 'string' },
            description: { type: 'string' },
            impact:      { type: 'string' },
          },
          required: ['name'],
        },
      },
      awards:       { type: 'array', items: { type: 'string' } },
      ats_keywords: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    },
    required: ['summary', 'experience', 'education', 'skills'],
  },
};

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  // Accept either a pre-built prompt string (from builder) or raw messages array
  const { messages, model, max_tokens } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'messages is required' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:       model || 'claude-sonnet-4-20250514',
        max_tokens:  max_tokens || 6000,
        temperature: 0.3,
        tools: [RESUME_TOOL],
        tool_choice: { type: 'tool', name: 'build_resume' },
        messages,
      }),
    });

    let envelope;
    const raw = await response.text();
    try { envelope = JSON.parse(raw); }
    catch { return res.status(500).json({ error: 'Unexpected response from AI service', preview: raw.slice(0, 300) }); }

    if (envelope.error) return res.status(500).json({ error: envelope.error.message });

    const toolBlock = (envelope.content || []).find(b => b.type === 'tool_use' && b.name === 'build_resume');
    if (!toolBlock) return res.status(500).json({ error: 'Model did not invoke the build_resume tool' });

    // Return structured resume data — already a valid JS object, no parsing needed
    // Wrap in content array to stay compatible with builder's result.content[0].text pattern
    return res.status(200).json({
      content: [{ type: 'tool_result', data: toolBlock.input }],
      _toolResult: toolBlock.input,  // direct access for new code
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

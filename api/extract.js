/**
 * extract.js — Document Text Extraction
 *
 * Accepts a base64-encoded PDF or DOCX and extracts clean text using Claude.
 * Claude reads the actual document visually — handles any layout (multi-column,
 * sidebars, tables), any font, embedded photos, and scanned pages.
 *
 * Why not pdf.js / mammoth on the frontend?
 *   - pdf.js scrambles multi-column layouts and fails on custom fonts
 *   - mammoth strips tables and images
 *   - Neither can handle scanned PDFs
 *   Claude Vision handles all of these correctly.
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

  const { file_data, file_type } = req.body;
  // file_data: base64 string | file_type: 'application/pdf' or 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

  if (!file_data) return res.status(400).json({ error: 'file_data (base64) is required' });

  const mediaType = file_type || 'application/pdf';
  const isPDF  = mediaType === 'application/pdf';
  const isDOCX = mediaType.includes('wordprocessingml') || mediaType === 'application/docx';

  if (!isPDF && !isDOCX) {
    return res.status(400).json({ error: 'Only PDF and DOCX files are supported' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', // Haiku is fast and cheap for extraction
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: file_data,
              },
            },
            {
              type: 'text',
              text: `Extract ALL text from this resume document. 

Rules:
- Preserve the logical reading order (name, contact, summary, experience, education, skills)
- Keep all dates, numbers, percentages, and metrics exactly as written
- For multi-column layouts, read the main content column first, then sidebar content
- Include section headings
- Do NOT add commentary, analysis, or formatting
- Do NOT skip any section even if it seems minor
- Output plain text only — no markdown, no bullet symbols, just the raw text content`,
            },
          ],
        }],
      }),
    });

    let envelope;
    const raw = await response.text();
    try { envelope = JSON.parse(raw); }
    catch { return res.status(500).json({ error: 'Unexpected response from AI service' }); }

    if (envelope.error) return res.status(500).json({ error: envelope.error.message });

    const extractedText = envelope.content?.[0]?.text || '';
    if (!extractedText.trim()) {
      return res.status(422).json({ error: 'Could not extract text from this document. The file may be corrupted or empty.' });
    }

    return res.status(200).json({ text: extractedText.trim() });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

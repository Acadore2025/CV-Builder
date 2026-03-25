/**
 * extract.js — Document Text Extraction
 *
 * PDF  → Claude Vision (handles any layout, fonts, photos, scanned pages)
 * DOCX → mammoth (server-side XML extraction — fast, free, no AI needed)
 */

const mammoth = require('mammoth');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 3MB decoded limit → ~4MB base64 → under Vercel 4.5MB body limit
const MAX_FILE_BYTES = 3 * 1024 * 1024;

module.exports = async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { file_data, file_type } = req.body;
  if (!file_data) return res.status(400).json({ error: 'file_data (base64) is required' });

  const isPDF  = file_type === 'application/pdf';
  const isDOCX = file_type?.includes('wordprocessingml') || file_type === 'application/docx';

  if (!isPDF && !isDOCX) {
    return res.status(400).json({ error: 'Only PDF and DOCX files are supported.' });
  }

  // File size check (applies to both types)
  const decodedBytes = Buffer.byteLength(file_data, 'base64');
  if (decodedBytes > MAX_FILE_BYTES) {
    return res.status(413).json({
      error: `File too large (${(decodedBytes / 1024 / 1024).toFixed(1)}MB). Maximum is 3MB. Compress at smallpdf.com and try again.`,
    });
  }

  // ── DOCX: extract with mammoth server-side ──────────────────────────────
  if (isDOCX) {
    try {
      const buffer = Buffer.from(file_data, 'base64');
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value?.trim();
      if (!text) {
        return res.status(422).json({ error: 'No readable text found in this DOCX. The file may be empty or corrupted.' });
      }
      return res.status(200).json({ text });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to read DOCX: ' + err.message });
    }
  }

  // ── PDF: extract with Claude Vision ────────────────────────────────────
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
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: file_data },
            },
            {
              type: 'text',
              text: `Extract ALL text from this resume document.
Rules:
- Preserve logical reading order (name, contact, summary, experience, education, skills)
- Keep all dates, numbers, percentages, and metrics exactly as written
- For multi-column layouts, read main content first, then sidebar
- Include all section headings
- Output plain text only — no markdown, no commentary`,
            },
          ],
        }],
      }),
    });

    clearTimeout(timeout);

    let envelope;
    const raw = await response.text();
    try { envelope = JSON.parse(raw); }
    catch { return res.status(500).json({ error: 'Unexpected response from AI service' }); }

    if (envelope.error) return res.status(500).json({ error: envelope.error.message });

    const text = envelope.content?.[0]?.text?.trim();
    if (!text) {
      return res.status(422).json({ error: 'Could not extract text from this PDF. It may be corrupted or empty.' });
    }

    return res.status(200).json({ text });

  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Extraction timed out. Try a smaller file.' });
    }
    return res.status(500).json({ error: err.message });
  }
};

# Vixo Resume 🧱

> AI-powered resume platform for India 🇮🇳 · US 🇺🇸 · Gulf/UAE 🇦🇪 · Europe 🇪🇺

## Features

- **Resume Builder** — Step-by-step form builder + AI rewrite mode. Exports PDF, DOCX, and ATS plain text.
- **Resume Analyser** — 7-dimension AI analysis: ATS score, skills gap, competitor benchmark, HR rejection reasons, and before/after rewrites.
- **4 Global Markets** — Market-specific fields (CGPA, CTC, photo, Europass, visa status, etc.)
- **Zero paywalls** — Free PDF + DOCX export

## Project Structure

```
resumeforge/
├── index.html          # Landing page
├── builder/
│   └── index.html      # Resume Builder
├── analyser/
│   └── index.html      # Resume Analyser
├── vercel.json         # Vercel routing config
└── README.md
```

## Deploy

### Vercel (recommended)
1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project**
3. Import your GitHub repo
4. Framework preset: **Other** (static site — no build step needed)
5. Click **Deploy** ✅

### GitHub Pages
1. Go to repo **Settings → Pages**
2. Source: **Deploy from a branch** → `main` / `root`
3. Your site will be live at `https://<username>.github.io/<repo-name>/`

## Tech Stack

- Pure HTML + CSS + Vanilla JS — no framework, no build step
- Google Fonts (Syne, DM Sans, Playfair Display)
- Anthropic Claude API (claude-sonnet-4-20250514) for AI features

## License

MIT

/**
 * UAEBrief — Agent + Dashboard Server
 * Uses Gemini with Google Search grounding to fetch UAE news
 * No RSS feeds needed — Gemini searches the web directly
 */

import fetch from "node-fetch";
import cron from "node-cron";
import http from "http";

// ─── Config ────────────────────────────────────────────────────────────────
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const PORT = process.env.PORT || 3000;

if (!GEMINI_API_KEY) {
  console.error("❌ Missing GEMINI_API_KEY — get one free at aistudio.google.com");
  process.exit(1);
}

const digestHistory = [];

// ─── Fetch & summarise using Gemini + Google Search grounding ──────────────
async function runGeminiWithSearch() {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "Asia/Dubai",
  });

  const prompt = `Today is ${today}. Search for the top UAE news stories from today using your search tool.

Focus on: UAE business, economy, government, real estate, and tech.
Use only publicly available news sources.

Return ONLY a valid JSON object with this exact structure, no markdown, no extra text:
{
  "date": "${today}",
  "stories": [
    {
      "emoji": "📈",
      "title": "Short punchy headline",
      "summary": "One clear sentence explaining what happened and why it matters.",
      "source": "Source Name"
    }
  ]
}

Pick exactly 5 stories. Keep summaries under 25 words each.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Gemini API error");

  const raw = data.candidates[0].content.parts
    .filter(p => p.text)
    .map(p => p.text)
    .join("")
    .trim()
    .replace(/```json|```/g, "")
    .trim();

  return JSON.parse(raw);
}

// ─── Send to Telegram (optional) ──────────────────────────────────────────
async function sendToTelegram(digestData) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const lines = [
    `🇦🇪 *UAEBrief — ${digestData.date}*\n`,
    ...digestData.stories.map(s => `${s.emoji} *${s.title}*\n${s.summary} _(${s.source})_`),
    `\n━━━━━━━━━━\n📬 UAEBrief | Automated Daily Digest`,
  ];
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: lines.join("\n\n"),
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  });
  const result = await res.json();
  if (result.ok) console.log("✅ Sent to Telegram");
  else console.warn("⚠️  Telegram error:", result.description);
}

// ─── Main agent run ────────────────────────────────────────────────────────
async function runAgent() {
  console.log(`\n🤖 UAEBrief running at ${new Date().toISOString()}`);
  console.log("🔍 Searching for UAE news via Gemini...");
  const digestData = await runGeminiWithSearch();
  digestData.generatedAt = new Date().toISOString();
  digestHistory.unshift(digestData);
  if (digestHistory.length > 7) digestHistory.pop();
  console.log("✅ Digest ready:", digestData.date);
  console.log("📰 Stories:", digestData.stories.map(s => s.title).join(" | "));
  await sendToTelegram(digestData);
}

// ─── Dashboard HTML ────────────────────────────────────────────────────────
function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>UAEBrief — Daily AI News Digest</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --sand: #F5F0E8; --sand-dark: #E8E0D0; --ink: #1A1611;
    --ink-mid: #4A4035; --ink-light: #8A7D6E;
    --gold: #C8922A; --gold-light: #F0D080; --white: #FDFCFA;
  }
  body { background: var(--sand); color: var(--ink); font-family: 'DM Sans', sans-serif; font-weight: 300; min-height: 100vh; }
  header { background: var(--ink); color: var(--sand); padding: 2rem 2.5rem; display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 1rem; }
  .header-left h1 { font-family: 'Instrument Serif', serif; font-size: clamp(2rem, 5vw, 3.2rem); font-weight: 400; line-height: 1; letter-spacing: -0.02em; }
  .header-left h1 span { color: var(--gold-light); }
  .header-left p { font-size: 13px; color: var(--ink-light); margin-top: 6px; font-family: 'DM Mono', monospace; letter-spacing: 0.04em; }
  .header-right { text-align: right; font-family: 'DM Mono', monospace; font-size: 12px; color: var(--ink-light); line-height: 1.8; }
  .status-dot { display: inline-block; width: 7px; height: 7px; background: #4CAF50; border-radius: 50%; margin-right: 6px; animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  .powered-bar { background: var(--white); border-bottom: 0.5px solid var(--sand-dark); padding: 0.6rem 2.5rem; display: flex; gap: 1.5rem; font-family: 'DM Mono', monospace; font-size: 11px; color: var(--ink-light); flex-wrap: wrap; align-items: center; }
  main { max-width: 820px; margin: 0 auto; padding: 3rem 2rem; }
  .digest-date { font-family: 'DM Mono', monospace; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-light); margin-bottom: 2rem; display: flex; align-items: center; gap: 12px; }
  .digest-date::after { content: ''; flex: 1; height: 0.5px; background: var(--sand-dark); }
  .story { display: grid; grid-template-columns: 48px 1fr; gap: 0 1.25rem; padding: 1.5rem 0; border-bottom: 0.5px solid var(--sand-dark); align-items: start; }
  .story:last-child { border-bottom: none; }
  .story-emoji { font-size: 28px; line-height: 1; padding-top: 3px; }
  .story-title { font-family: 'Instrument Serif', serif; font-size: 1.25rem; font-weight: 400; line-height: 1.3; color: var(--ink); margin-bottom: 6px; }
  .story-summary { font-size: 14px; color: var(--ink-mid); line-height: 1.65; font-weight: 300; }
  .story-source { display: inline-block; margin-top: 8px; font-family: 'DM Mono', monospace; font-size: 10.5px; letter-spacing: 0.05em; color: var(--gold); text-transform: uppercase; }
  .loading { text-align: center; padding: 4rem 2rem; color: var(--ink-light); font-family: 'DM Mono', monospace; font-size: 13px; }
  .spinner { width: 32px; height: 32px; border: 2px solid var(--sand-dark); border-top-color: var(--gold); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1rem; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .error { background: #FFF3F0; border: 0.5px solid #F5C0B0; border-radius: 8px; padding: 1.5rem; color: #8B3020; font-size: 14px; margin: 2rem 0; line-height: 1.6; }
  footer { text-align: center; padding: 2rem; font-family: 'DM Mono', monospace; font-size: 11px; color: var(--ink-light); border-top: 0.5px solid var(--sand-dark); margin-top: 2rem; }
  .refresh-btn { background: var(--ink); color: var(--sand); border: none; padding: 8px 18px; font-family: 'DM Mono', monospace; font-size: 12px; border-radius: 4px; cursor: pointer; margin-top: 1rem; transition: opacity 0.2s; }
  .refresh-btn:hover { opacity: 0.8; }
  .trigger-btn { background: var(--gold); color: white; border: none; padding: 12px 28px; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 500; border-radius: 4px; cursor: pointer; margin-top: 1.5rem; transition: opacity 0.2s; }
  .trigger-btn:hover { opacity: 0.85; }
  .trigger-btn:disabled, .refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .empty-state { text-align: center; padding: 4rem 2rem; color: var(--ink-light); }
  .empty-state h2 { font-family: 'Instrument Serif', serif; font-size: 1.5rem; font-weight: 400; margin-bottom: 0.75rem; color: var(--ink); }
  .empty-state p { font-size: 14px; line-height: 1.6; }
  .generating-msg { font-family: 'DM Mono', monospace; font-size: 12px; color: var(--ink-light); margin-top: 12px; }
</style>
</head>
<body>
<header>
  <div class="header-left">
    <h1>🇦🇪 UAE<span>Brief</span></h1>
    <p>AI-powered daily news digest · Public sources only</p>
  </div>
  <div class="header-right">
    <div><span class="status-dot"></span>Agent live</div>
    <div>Auto-runs: 08:00 GST daily</div>
    <div id="last-updated">—</div>
  </div>
</header>
<div class="powered-bar">
  <span>🔍 Powered by Gemini 2.0 Flash + Google Search</span>
  <span>📰 Public UAE news sources</span>
</div>
<main>
  <div id="content">
    <div class="loading"><div class="spinner"></div>Fetching latest digest...</div>
  </div>
</main>
<footer>UAEBrief · Agentic AI Challenge · May 2026 · Public data only</footer>
<script>
async function loadDigest() {
  const content = document.getElementById('content');
  try {
    const res = await fetch('/api/digest');
    const data = await res.json();
    if (!data || !data.stories || data.stories.length === 0) {
      content.innerHTML = \`<div class="empty-state">
        <h2>No digest yet today</h2>
        <p>The agent runs automatically at 08:00 GST.<br>Click below to generate right now — takes about 20 seconds.</p>
        <br><button class="trigger-btn" onclick="triggerNow(this)">⚡ Generate Now</button>
      </div>\`;
      return;
    }
    document.getElementById('last-updated').textContent = 'Updated ' +
      new Date(data.generatedAt).toLocaleTimeString('en-AE', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) + ' GST';
    content.innerHTML = \`
      <div class="digest-date">\${data.date}</div>
      \${data.stories.map(s => \`<div class="story">
        <div class="story-emoji">\${s.emoji}</div>
        <div>
          <div class="story-title">\${s.title}</div>
          <div class="story-summary">\${s.summary}</div>
          <span class="story-source">\${s.source}</span>
        </div>
      </div>\`).join('')}
      <div style="margin-top:2rem;text-align:right;">
        <button class="refresh-btn" onclick="triggerNow(this)">↻ Refresh digest</button>
      </div>\`;
  } catch (err) {
    content.innerHTML = \`<div class="error">⚠️ Could not load digest.<br><small>\${err.message}</small></div>\`;
  }
}

async function triggerNow(btn) {
  const content = document.getElementById('content');
  btn.disabled = true; btn.textContent = '⏳ Searching UAE news…';
  content.innerHTML = \`<div class="loading"><div class="spinner"></div>Gemini is searching for today's UAE news...<div class="generating-msg">This takes about 20–30 seconds</div></div>\`;
  try {
    await fetch('/api/run', { method: 'POST' });
    // Poll every 3 seconds until digest appears
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      const res = await fetch('/api/digest');
      const data = await res.json();
      if (data && data.stories && data.stories.length > 0) {
        clearInterval(poll);
        loadDigest();
      } else if (attempts > 20) {
        clearInterval(poll);
        content.innerHTML = \`<div class="error">⚠️ Took too long. Check Render logs and try again.</div>\`;
      }
    }, 3000);
  } catch (err) {
    content.innerHTML = \`<div class="error">⚠️ Error: \${err.message}</div>\`;
  }
}
loadDigest();
</script>
</body>
</html>`;
}

// ─── HTTP Server ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(getDashboardHTML());
  }
  if (req.method === "GET" && url.pathname === "/api/digest") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(digestHistory[0] || null));
  }
  if (req.method === "POST" && url.pathname === "/api/run") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    runAgent().catch(err => console.error("❌ Run error:", err));
    return;
  }
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "ok", digests: digestHistory.length }));
  }
  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => console.log(`🌐 Dashboard live at http://localhost:${PORT}`));

// ─── Cron: 08:00 GST = 04:00 UTC ──────────────────────────────────────────
cron.schedule("0 4 * * *", () => {
  runAgent().catch(err => console.error("❌ Cron error:", err));
}, { timezone: "UTC" });

console.log("🚀 UAEBrief started");
if (process.env.RUN_NOW === "true") {
  runAgent().catch(err => console.error("❌ Startup error:", err));
}

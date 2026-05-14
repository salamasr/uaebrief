/**
 * UAEBrief — Agent + Dashboard Server
 * - Fetches UAE news via NewsData.io free API (200 calls/day free)
 * - Summarises with Gemini 1.5 Flash (free tier)
 * - No google_search grounding needed
 */

import fetch from "node-fetch";
import cron from "node-cron";
import http from "http";

const GEMINI_API_KEY      = process.env.GEMINI_API_KEY;
const NEWSDATA_API_KEY    = process.env.NEWSDATA_API_KEY;
const TELEGRAM_BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID    = process.env.TELEGRAM_CHAT_ID;
const PORT = process.env.PORT || 3000;

if (!GEMINI_API_KEY)   { console.error("❌ Missing GEMINI_API_KEY");   process.exit(1); }
if (!NEWSDATA_API_KEY) { console.error("❌ Missing NEWSDATA_API_KEY"); process.exit(1); }

const digestHistory = [];

// ─── Fetch UAE news from NewsData.io (free tier) ───────────────────────────
async function fetchUAENews() {
  const url = `https://newsdata.io/api/1/news?country=ae&language=en&apikey=${NEWSDATA_API_KEY}&size=10`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const data = await res.json();
  if (!res.ok || data.status !== "success") {
    throw new Error(data.message || "NewsData.io error");
  }
  const articles = (data.results || []).map(a => ({
    title: a.title || "",
    description: (a.description || a.content || "").slice(0, 300).replace(/<[^>]*>/g, ""),
    source: a.source_name || a.source_id || "UAE News",
    link: a.link || "",
  }));
  console.log(`✅ Fetched ${articles.length} articles from NewsData.io`);
  return articles;
}

// ─── Summarise with Gemini 1.5 Flash (free tier) ──────────────────────────
async function summariseWithGemini(articles) {
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "Asia/Dubai",
  });

  const articleText = articles
    .map((a, i) => `[${i + 1}] Source: ${a.source}\nTitle: ${a.title}\nDetails: ${a.description}`)
    .join("\n\n");

  const prompt = `You are UAEBrief, an AI agent producing a daily UAE news digest.

Today is ${today}. Below are recent UAE news articles from public sources.

Return ONLY a valid JSON object, no markdown fences, no extra text:
{
  "date": "${today}",
  "stories": [
    {
      "emoji": "📈",
      "title": "Short punchy headline",
      "summary": "One clear sentence under 25 words explaining what happened.",
      "source": "Source Name"
    }
  ]
}

Pick the 5 most important stories. Focus on business, economy, government, real estate, tech.

Articles:
${articleText}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Gemini API error");

  const raw = data.candidates[0].content.parts[0].text
    .trim().replace(/```json|```/g, "").trim();
  return JSON.parse(raw);
}

// ─── Send to Telegram (optional) ──────────────────────────────────────────
async function sendToTelegram(d) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const text = [
    `🇦🇪 *UAEBrief — ${d.date}*\n`,
    ...d.stories.map(s => `${s.emoji} *${s.title}*\n${s.summary} _(${s.source})_`),
    `\n━━━━━━━━━━\n📬 UAEBrief | Automated Daily Digest`,
  ].join("\n\n");
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown", disable_web_page_preview: true }),
  });
  const r = await res.json();
  if (r.ok) console.log("✅ Sent to Telegram"); else console.warn("⚠️ Telegram:", r.description);
}

// ─── Main agent run ────────────────────────────────────────────────────────
async function runAgent() {
  console.log(`\n🤖 UAEBrief running at ${new Date().toISOString()}`);
  const articles = await fetchUAENews();
  if (articles.length === 0) { console.error("❌ No articles"); return; }
  console.log("🧠 Summarising with Gemini 1.5 Flash...");
  const digest = await summariseWithGemini(articles);
  digest.generatedAt = new Date().toISOString();
  digestHistory.unshift(digest);
  if (digestHistory.length > 7) digestHistory.pop();
  console.log("✅ Done:", digest.stories.map(s => s.title).join(" | "));
  await sendToTelegram(digest);
}

// ─── Dashboard HTML ────────────────────────────────────────────────────────
function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>UAEBrief — Daily AI News Digest</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --sand:#F5F0E8; --sand-dark:#E8E0D0; --ink:#1A1611; --ink-mid:#4A4035; --ink-light:#8A7D6E; --gold:#C8922A; --gold-light:#F0D080; --white:#FDFCFA; }
  body { background:var(--sand); color:var(--ink); font-family:'DM Sans',sans-serif; font-weight:300; min-height:100vh; }
  header { background:var(--ink); color:var(--sand); padding:2rem 2.5rem; display:flex; align-items:flex-end; justify-content:space-between; flex-wrap:wrap; gap:1rem; }
  .hl h1 { font-family:'Instrument Serif',serif; font-size:clamp(2rem,5vw,3.2rem); font-weight:400; line-height:1; letter-spacing:-0.02em; }
  .hl h1 span { color:var(--gold-light); }
  .hl p { font-size:13px; color:var(--ink-light); margin-top:6px; font-family:'DM Mono',monospace; }
  .hr { text-align:right; font-family:'DM Mono',monospace; font-size:12px; color:var(--ink-light); line-height:1.8; }
  .dot { display:inline-block; width:7px; height:7px; background:#4CAF50; border-radius:50%; margin-right:6px; animation:pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
  .bar { background:var(--white); border-bottom:0.5px solid var(--sand-dark); padding:0.6rem 2.5rem; font-family:'DM Mono',monospace; font-size:11px; color:var(--ink-light); }
  main { max-width:820px; margin:0 auto; padding:3rem 2rem; }
  .ddate { font-family:'DM Mono',monospace; font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:var(--ink-light); margin-bottom:2rem; display:flex; align-items:center; gap:12px; }
  .ddate::after { content:''; flex:1; height:0.5px; background:var(--sand-dark); }
  .story { display:grid; grid-template-columns:48px 1fr; gap:0 1.25rem; padding:1.5rem 0; border-bottom:0.5px solid var(--sand-dark); }
  .story:last-child { border-bottom:none; }
  .emoji { font-size:28px; line-height:1; padding-top:3px; }
  .stitle { font-family:'Instrument Serif',serif; font-size:1.25rem; font-weight:400; line-height:1.3; margin-bottom:6px; }
  .ssum { font-size:14px; color:var(--ink-mid); line-height:1.65; }
  .ssrc { display:inline-block; margin-top:8px; font-family:'DM Mono',monospace; font-size:10.5px; letter-spacing:0.05em; color:var(--gold); text-transform:uppercase; }
  .loading { text-align:center; padding:4rem 2rem; color:var(--ink-light); font-family:'DM Mono',monospace; font-size:13px; }
  .spin { width:32px; height:32px; border:2px solid var(--sand-dark); border-top-color:var(--gold); border-radius:50%; animation:spin 0.8s linear infinite; margin:0 auto 1rem; }
  @keyframes spin { to{transform:rotate(360deg)} }
  .error { background:#FFF3F0; border:0.5px solid #F5C0B0; border-radius:8px; padding:1.5rem; color:#8B3020; font-size:14px; margin:2rem 0; line-height:1.6; }
  .btn-dark { background:var(--ink); color:var(--sand); border:none; padding:8px 18px; font-family:'DM Mono',monospace; font-size:12px; border-radius:4px; cursor:pointer; margin-top:1rem; }
  .btn-gold { background:var(--gold); color:white; border:none; padding:12px 28px; font-family:'DM Sans',sans-serif; font-size:14px; font-weight:500; border-radius:4px; cursor:pointer; margin-top:1.5rem; }
  .btn-gold:disabled, .btn-dark:disabled { opacity:0.5; cursor:not-allowed; }
  .empty { text-align:center; padding:4rem 2rem; }
  .empty h2 { font-family:'Instrument Serif',serif; font-size:1.5rem; font-weight:400; margin-bottom:0.75rem; }
  .empty p { font-size:14px; line-height:1.6; color:var(--ink-mid); }
  footer { text-align:center; padding:2rem; font-family:'DM Mono',monospace; font-size:11px; color:var(--ink-light); border-top:0.5px solid var(--sand-dark); margin-top:2rem; }
</style>
</head>
<body>
<header>
  <div class="hl">
    <h1>🇦🇪 UAE<span>Brief</span></h1>
    <p>AI-powered daily news digest · Public sources only</p>
  </div>
  <div class="hr">
    <div><span class="dot"></span>Agent live</div>
    <div>Auto-runs: 08:00 GST daily</div>
    <div id="lu">—</div>
  </div>
</header>
<div class="bar">🔍 NewsData.io · Gemini 1.5 Flash · UAE public news</div>
<main><div id="content"><div class="loading"><div class="spin"></div>Loading...</div></div></main>
<footer>UAEBrief · Agentic AI Challenge · May 2026</footer>
<script>
async function load() {
  const c = document.getElementById('content');
  try {
    const r = await fetch('/api/digest');
    const d = await r.json();
    if (!d || !d.stories || !d.stories.length) {
      c.innerHTML = \`<div class="empty">
        <h2>No digest yet</h2>
        <p>Runs automatically at 08:00 GST.<br>Click below to generate now (~15 seconds).</p><br>
        <button class="btn-gold" onclick="run(this)">⚡ Generate Now</button>
      </div>\`;
      return;
    }
    document.getElementById('lu').textContent = 'Updated ' +
      new Date(d.generatedAt).toLocaleTimeString('en-AE',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Dubai'})+' GST';
    c.innerHTML = \`<div class="ddate">\${d.date}</div>
      \${d.stories.map(s=>\`<div class="story">
        <div class="emoji">\${s.emoji}</div>
        <div><div class="stitle">\${s.title}</div>
        <div class="ssum">\${s.summary}</div>
        <span class="ssrc">\${s.source}</span></div>
      </div>\`).join('')}
      <div style="margin-top:2rem;text-align:right">
        <button class="btn-dark" onclick="run(this)">↻ Refresh</button>
      </div>\`;
  } catch(e) {
    c.innerHTML = \`<div class="error">⚠️ \${e.message}</div>\`;
  }
}
async function run(btn) {
  const c = document.getElementById('content');
  btn.disabled=true; btn.textContent='⏳ Fetching news…';
  c.innerHTML='<div class="loading"><div class="spin"></div>Fetching UAE news and summarising…<br><small style="margin-top:8px;display:block">Takes about 15 seconds</small></div>';
  await fetch('/api/run',{method:'POST'});
  let tries=0;
  const t = setInterval(async()=>{
    tries++;
    try {
      const r=await fetch('/api/digest');
      const d=await r.json();
      if(d&&d.stories&&d.stories.length){clearInterval(t);load();}
      else if(tries>15){clearInterval(t);c.innerHTML='<div class="error">⚠️ Took too long. Check Render logs.</div>';}
    } catch(e){}
  },3000);
}
load();
</script>
</body>
</html>`;
}

// ─── HTTP Server ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method==="GET" && url.pathname==="/") { res.writeHead(200,{"Content-Type":"text/html"}); return res.end(getDashboardHTML()); }
  if (req.method==="GET" && url.pathname==="/api/digest") { res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify(digestHistory[0]||null)); }
  if (req.method==="POST" && url.pathname==="/api/run") { res.writeHead(200,{"Content-Type":"application/json"}); res.end(JSON.stringify({ok:true})); runAgent().catch(e=>console.error("❌",e.message)); return; }
  if (req.method==="GET" && url.pathname==="/health") { res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify({status:"ok"})); }
  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, ()=>console.log(`🌐 Dashboard at http://localhost:${PORT}`));
cron.schedule("0 4 * * *", ()=>runAgent().catch(e=>console.error("❌ Cron:",e.message)), {timezone:"UTC"});
console.log("🚀 UAEBrief started");
if (process.env.RUN_NOW==="true") runAgent().catch(e=>console.error("❌ Startup:",e.message));

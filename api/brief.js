/**
 * POST /api/brief
 * Body: { mode: 'morning' | 'aftermarket', marketState: { spot, rd, rf, ois5, basis } }
 * Returns: { brief: {...}, searchCount: N, generatedAt: ISO, cached: false }
 *
 * Calls Anthropic claude-sonnet with web_search tool enabled.
 * Runs server-side — no CORS issues from the browser.
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4000;
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// In-memory cache (persists across warm invocations on same instance)
const cache = { morning: null, aftermarket: null };

function buildSystemPrompt(mode, state) {
  const { spot, rd, rf, ois5, basis } = state;
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
  const rateDiff = (parseFloat(rd) - parseFloat(rf)).toFixed(2);

  const stateBlock = `Today: ${today} (IST)
USD/INR spot: ${spot ?? 'unknown'} | MIBOR proxy (r_d): ${rd}% | SOFR proxy (r_f): ${rf}%
INR OIS 5Y: ${ois5}% | USD/INR CCS basis: ${basis}bp | Rate differential: ${rateDiff}%

STRUCTURING CATALOGUE:
Forward Buy, Forward Sell, Long Call, Long Put, Call Spread, Put Spread,
Participating Forward, Range Forward, Importer Seagull, Exporter Seagull,
Knock-Out Forward, Knock-In Forward, IRS Pay Fixed, IRS Receive Fixed, Cross Currency Swap`;

  if (mode === 'morning') {
    return `You are a senior FX/rates structurer at an Indian bank writing the MORNING BRIEF before market open.

${stateBlock}

RESEARCH TASK — run ALL of these searches before synthesising:
1. "Indian rupee USD INR today" — overnight USD/INR move, RBI fixing, FII/FPI flows
2. "RBI monetary policy MIBOR OIS G-sec yield today" — domestic rates
3. "Fed FOMC dollar index US Treasury yield overnight" — global rates driving INR
4. "India inflation CPI RBI repo rate" — macro drivers
5. "Mint Economic Times India markets today" — Indian financial press coverage
6. "Zerodha Pulse markets today" — aggregated Indian markets view
7. Any RBI/SEBI circulars or policy announcements affecting FX derivatives

After researching, synthesise into a structuring desk brief. Use confident trader voice. Cite specific magnitudes from your search results. If a search returns nothing concrete, leave fewer items rather than inventing content.

Return ONLY this JSON object — no preamble, no markdown fences, no extra text:
{
  "headline": "<one-line market call 14-22 words. Use *italics* for the key driver>",
  "narrative": "<2-3 sentences: direction, key driver, structural implication for the desk. ~70 words with specific data points from your search>",
  "tags": [{"label": "<short tag>", "tone": "bullish|bearish|neutral"}],
  "impactScan": [
    {
      "severity": "high|med|low",
      "category": "REGULATORY|MARKET|POLICY|CREDIT|GEOPOLITICAL",
      "headline": "<5-9 word issue summary>",
      "description": "<2 sentences: what happened, structuring implication. ~40 words>",
      "products": ["<product name from catalogue>"],
      "action": "<concrete desk action this morning. ~25 words>",
      "sourceRef": "<e.g. 'Mint, today' or 'RBI press release 24 Apr'>"
    }
  ],
  "signals": [
    {
      "title": "<3-6 word signal>",
      "detail": "<15-20 words with specific magnitude>",
      "direction": "up|dn|neu",
      "mag": "<e.g. +18bp or -1.4% or wider>",
      "sourceRef": "<short citation>"
    }
  ],
  "sources": [
    {
      "label": "<publication name>",
      "title": "<article headline>",
      "url": "<full URL>",
      "date": "<publication date>"
    }
  ]
}

Rules: 3-4 tags, 3-4 impact scan items, 3-4 signals, 4-8 sources. Every item must trace to a search result. No padding.`;
  }

  // aftermarket
  return `You are a senior FX/rates structurer at an Indian bank writing the AFTER-MARKET REPORT after Indian markets close, in the style of Zerodha Aftermarket Report.

${stateBlock}

RESEARCH TASK — run ALL of these searches before synthesising:
1. "USD INR today close RBI reference rate" — today's exact INR close and move
2. "NIFTY SENSEX today close FII flows" — equity + flow context
3. "India G-sec yield MIBOR OIS today" — domestic rates today
4. "Zerodha aftermarket report today" — Zerodha's own daily wrap
5. "RBI OMO liquidity today" — central bank operations today
6. "dollar index crude oil gold today" — global drivers affecting INR
7. "India markets wrap Mint Economic Times today" — press coverage of today's session

After researching, write the after-market report. Be specific about today's actual moves with magnitudes. Set up the desk for tomorrow. Reflective, explanatory tone. If a search returns nothing concrete, leave fewer items.

Return ONLY this JSON object — no preamble, no markdown fences, no extra text:
{
  "headline": "<one-line session wrap 14-22 words. Use *italics* for the key driver>",
  "narrative": "<3 sentences: what moved today, why, what to watch tomorrow. ~80 words with specific magnitudes from your search>",
  "tags": [{"label": "<short tag>", "tone": "bullish|bearish|neutral"}],
  "impactScan": [
    {
      "severity": "high|med|low",
      "category": "REGULATORY|MARKET|POLICY|CREDIT|GEOPOLITICAL",
      "headline": "<5-9 word issue summary from today>",
      "description": "<2 sentences: today's event, implication going forward. ~40 words>",
      "products": ["<product name from catalogue>"],
      "action": "<desk action for tonight or tomorrow's open. ~25 words>",
      "sourceRef": "<citation>"
    }
  ],
  "signals": [
    {
      "title": "<3-6 word signal>",
      "detail": "<today's actual move with magnitude and driver, 15-20 words>",
      "direction": "up|dn|neu",
      "mag": "<actual move e.g. -34p or +12bp>",
      "sourceRef": "<citation>"
    }
  ],
  "sources": [
    {
      "label": "<publication>",
      "title": "<headline>",
      "url": "<full URL>",
      "date": "<date>"
    }
  ]
}

Rules: 3-4 tags, 3-4 impact items, 3-4 signals, 4-8 sources. Every claim must trace to a search result. No padding.`;
}

module.exports = async function handler(req, res){
  // CORS — allow all origins (lock this down to your domain in production)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY environment variable not set. Add it in Vercel dashboard → Settings → Environment Variables.',
    });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const mode = body?.mode === 'aftermarket' ? 'aftermarket' : 'morning';
  const marketState = body?.marketState || {};

  // Return cached if fresh
  const cached = cache[mode];
  const useFresh = body?.force !== true;
  if (useFresh && cached && (Date.now() - cached.generatedAt) < CACHE_TTL_MS) {
    return res.status(200).json({ ...cached, cached: true });
  }

  const systemPrompt = buildSystemPrompt(mode, marketState);

  let anthropicRes;
  try {
    anthropicRes = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Generate today's ${mode === 'morning' ? 'morning brief' : 'after-market report'}. Run all required searches first. Today is ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`,
          },
        ],
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 8,
          },
        ],
      }),
    });
  } catch (fetchErr) {
    return res.status(502).json({ error: 'Could not reach Anthropic API: ' + fetchErr.message });
  }

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text().catch(() => '');
    return res.status(502).json({
      error: `Anthropic API returned ${anthropicRes.status}`,
      detail: errText.slice(0, 500),
    });
  }

  const data = await anthropicRes.json();

  // Extract text blocks (final synthesis is in text blocks after tool calls)
  const textBlocks = (data.content || [])
    .filter(c => c.type === 'text')
    .map(c => c.text || '');
  const fullText = textBlocks.join('\n').trim();

  if (!fullText) {
    return res.status(502).json({
      error: 'Claude returned no text content. Web search may have returned no results.',
      rawContent: (data.content || []).map(c => c.type),
    });
  }

  // Parse JSON from response
  const cleaned = fullText.replace(/```json|```/g, '').trim();
  const fb = cleaned.indexOf('{');
  const lb = cleaned.lastIndexOf('}');
  if (fb < 0 || lb < 0) {
    return res.status(502).json({
      error: 'No JSON found in Claude response',
      snippet: fullText.slice(0, 400),
    });
  }

  let brief;
  try {
    brief = JSON.parse(cleaned.slice(fb, lb + 1));
  } catch (parseErr) {
    return res.status(502).json({
      error: 'JSON parse failed: ' + parseErr.message,
      snippet: cleaned.slice(fb, Math.min(fb + 500, lb + 1)),
    });
  }

  const searchCount = (data.content || []).filter(
    c => c.type === 'server_tool_use' && c.name === 'web_search'
  ).length;

  const result = {
    brief,
    searchCount,
    generatedAt: Date.now(),
    mode,
    usage: data.usage,
    cached: false,
  };

  // Cache
  cache[mode] = result;

  return res.status(200).json(result);
}

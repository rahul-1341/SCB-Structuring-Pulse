/**
 * POST /api/brief
 * Body: { mode: 'morning' | 'aftermarket', marketState: { spot, rd, rf, ois5, basis }, force: boolean }
 * Returns: { brief, searchCount, generatedAt, cached }
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

const cache = { morning: null, aftermarket: null };

function buildSystemPrompt(mode, state) {
  const { spot, rd, rf, ois5, basis } = state;
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
  const rateDiff = (parseFloat(rd) - parseFloat(rf)).toFixed(2);

  const stateBlock = `Today: ${today} (IST)
USD/INR spot: ${spot || 'unknown'} | MIBOR proxy (r_d): ${rd}% | SOFR proxy (r_f): ${rf}%
INR OIS 5Y: ${ois5}% | USD/INR CCS basis: ${basis}bp | Rate differential: ${rateDiff}%

STRUCTURING CATALOGUE:
Forward Buy, Forward Sell, Long Call, Long Put, Call Spread, Put Spread,
Participating Forward, Range Forward, Importer Seagull, Exporter Seagull,
Knock-Out Forward, Knock-In Forward, IRS Pay Fixed, IRS Receive Fixed, Cross Currency Swap`;

  if (mode === 'morning') {
    return `You are a senior FX/rates structurer at an Indian bank writing the MORNING BRIEF before market open.

${stateBlock}

RESEARCH TASK - run ALL of these searches before synthesising:
1. "Indian rupee USD INR today" - overnight USD/INR move, RBI fixing, FII flows
2. "RBI monetary policy MIBOR OIS G-sec yield today" - domestic rates
3. "Fed FOMC dollar index US Treasury yield overnight" - global rates
4. "India inflation CPI RBI repo rate" - macro drivers
5. "Mint Economic Times India markets today" - Indian press
6. "Zerodha Pulse markets today" - aggregated Indian markets view
7. Any RBI/SEBI circulars affecting FX derivatives

After researching, synthesise into a structuring desk brief. Use confident trader voice. Reference specific magnitudes from your search. Do not fabricate - if a search returns nothing for a slot, leave fewer items.

Return ONLY this JSON object - no preamble, no markdown fences, no extra text:
{
  "headline": "<one-line market call 14-22 words. Use *italics* for the key driver>",
  "narrative": "<2-3 sentences: direction, key driver, structural implication. ~70 words with specific data points>",
  "tags": [{"label": "<short tag>", "tone": "bullish|bearish|neutral"}],
  "impactScan": [
    {
      "severity": "high|med|low",
      "category": "REGULATORY|MARKET|POLICY|CREDIT|GEOPOLITICAL",
      "headline": "<5-9 word issue summary>",
      "description": "<2 sentences: what happened, structuring implication. ~40 words>",
      "products": ["<product name from catalogue>"],
      "action": "<concrete desk action. ~25 words>",
      "sourceRef": "<e.g. Mint today or RBI press release>"
    }
  ],
  "signals": [
    {
      "title": "<3-6 word signal>",
      "detail": "<15-20 words with specific magnitude>",
      "direction": "up|dn|neu",
      "mag": "<e.g. +18bp or -1.4%>",
      "sourceRef": "<short citation>"
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

Rules: 3-4 tags, 3-4 impact scan items, 3-4 signals, 4-8 sources. Every item must trace to a search result.`;
  }

  return `You are a senior FX/rates structurer at an Indian bank writing the AFTER-MARKET REPORT after Indian markets close, in the style of Zerodha Aftermarket Report.

${stateBlock}

RESEARCH TASK - run ALL of these searches:
1. "USD INR today close RBI reference rate" - today's INR close and move
2. "NIFTY SENSEX today close FII flows" - equity and flow context
3. "India G-sec yield MIBOR OIS today" - domestic rates today
4. "Zerodha aftermarket report today" - Zerodha daily wrap
5. "RBI OMO liquidity today" - central bank operations
6. "dollar index crude oil gold today" - global drivers
7. "India markets wrap Mint Economic Times today" - press coverage

Synthesise into a post-market report. Be specific about today's actual moves with magnitudes. Set up the desk for tomorrow. Do not fabricate.

Return ONLY this JSON object - no preamble, no markdown fences:
{
  "headline": "<one-line session wrap 14-22 words. Use *italics* for key driver>",
  "narrative": "<3 sentences: what moved today, why, what to watch tomorrow. ~80 words with magnitudes>",
  "tags": [{"label": "<short tag>", "tone": "bullish|bearish|neutral"}],
  "impactScan": [
    {
      "severity": "high|med|low",
      "category": "REGULATORY|MARKET|POLICY|CREDIT|GEOPOLITICAL",
      "headline": "<5-9 word issue summary>",
      "description": "<2 sentences: today event and implication. ~40 words>",
      "products": ["<product name>"],
      "action": "<desk action for tonight or tomorrow open. ~25 words>",
      "sourceRef": "<citation>"
    }
  ],
  "signals": [
    {
      "title": "<3-6 word signal>",
      "detail": "<today actual move with magnitude and driver, 15-20 words>",
      "direction": "up|dn|neu",
      "mag": "<actual move>",
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

Rules: 3-4 tags, 3-4 impact items, 3-4 signals, 4-8 sources. Every claim must trace to a search result.`;
}

module.exports = async function handler(req, res) {
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
      error: 'ANTHROPIC_API_KEY environment variable not set. Add it in Vercel dashboard > Settings > Environment Variables.',
    });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const mode = body && body.mode === 'aftermarket' ? 'aftermarket' : 'morning';
  const marketState = (body && body.marketState) || {};
  const force = body && body.force === true;

  const cached = cache[mode];
  if (!force && cached && (Date.now() - cached.generatedAt) < CACHE_TTL_MS) {
    return res.status(200).json(Object.assign({}, cached, { cached: true }));
  }

  const systemPrompt = buildSystemPrompt(mode, marketState);
  const today = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

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
        max_tokens: 4000,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: 'Generate today\'s ' + (mode === 'morning' ? 'morning brief' : 'after-market report') + '. Run all required searches first. Today is ' + today + '.',
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
    const errText = await anthropicRes.text().catch(function() { return ''; });
    return res.status(502).json({
      error: 'Anthropic API returned ' + anthropicRes.status,
      detail: errText.slice(0, 500),
    });
  }

  let data;
  try {
    data = await anthropicRes.json();
  } catch (e) {
    return res.status(502).json({ error: 'Failed to parse Anthropic response' });
  }

  const textBlocks = (data.content || [])
    .filter(function(c) { return c.type === 'text'; })
    .map(function(c) { return c.text || ''; });
  const fullText = textBlocks.join('\n').trim();

  if (!fullText) {
    return res.status(502).json({
      error: 'Claude returned no text content.',
      contentTypes: (data.content || []).map(function(c) { return c.type; }),
    });
  }

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

  const searchCount = (data.content || []).filter(function(c) {
    return c.type === 'server_tool_use' && c.name === 'web_search';
  }).length;

  const result = {
    brief: brief,
    searchCount: searchCount,
    generatedAt: Date.now(),
    mode: mode,
    usage: data.usage,
    cached: false,
  };

  cache[mode] = result;

  return res.status(200).json(result);
};
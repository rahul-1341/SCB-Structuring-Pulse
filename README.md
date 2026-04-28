# Pulse Backend — Vercel Deploy Guide

This is the backend for the Pulse structuring workbench market brief feature.
It proxies calls to the Anthropic API server-side, bypassing browser CORS restrictions.

## What's in this folder

```
api/brief.js     — the serverless function (one endpoint: POST /api/brief)
vercel.json      — Vercel configuration (60s timeout, CORS headers)
package.json     — no npm dependencies needed (uses Node built-in fetch)
README.md        — this file
```

---

## Step-by-step deploy

### Step 1 — Install the Vercel CLI

Open your terminal and run:

```bash
npm install -g vercel
```

Verify it installed:

```bash
vercel --version
```

---

### Step 2 — Create a Vercel account (if you don't have one)

Go to https://vercel.com and sign up with GitHub, GitLab, or email. Free tier is sufficient.

---

### Step 3 — Log in to Vercel from your terminal

```bash
vercel login
```

Follow the prompts — it will open a browser window to authenticate.

---

### Step 4 — Deploy the backend

Navigate to this folder in your terminal:

```bash
cd pulse-backend
```

Run the deploy command:

```bash
vercel
```

You will be asked a few questions. Answer them as follows:

```
Set up and deploy "pulse-backend"? → Y
Which scope? → (select your personal account or team)
Link to existing project? → N
What's your project's name? → pulse-backend
In which directory is your code located? → ./
Want to modify these settings? → N
```

Vercel will deploy and give you a URL like:
```
https://pulse-backend-xxxx.vercel.app
```

**Copy that URL — you will paste it into Pulse.**

---

### Step 5 — Add your Anthropic API key

1. Go to https://vercel.com/dashboard
2. Click on your **pulse-backend** project
3. Click **Settings** (top navigation)
4. Click **Environment Variables** (left sidebar)
5. Click **Add New**
6. Fill in:
   - **Key**: `ANTHROPIC_API_KEY`
   - **Value**: your Anthropic API key (starts with `sk-ant-...`)
   - **Environment**: check all three boxes (Production, Preview, Development)
7. Click **Save**

---

### Step 6 — Redeploy to pick up the environment variable

Back in your terminal:

```bash
vercel --prod
```

This deploys to production. Your endpoint is now live at:
```
https://pulse-backend-xxxx.vercel.app/api/brief
```

---

### Step 7 — Connect Pulse to your backend

1. Open `pulse.html` in your browser
2. Go to the **Market Brief** tab
3. Click the **Configure backend** button (grey, top right of the brief controls)
4. Paste your Vercel URL: `https://pulse-backend-xxxx.vercel.app`
5. Click **Save** — Pulse stores this in your browser's localStorage
6. Click **Generate brief** — it will now call your backend

---

## Verifying it works

Test the endpoint directly from your terminal:

```bash
curl -X POST https://pulse-backend-xxxx.vercel.app/api/brief \
  -H "Content-Type: application/json" \
  -d '{"mode":"morning","marketState":{"spot":"84.50","rd":6.70,"rf":5.25,"ois5":6.52,"basis":12}}'
```

A successful response looks like:
```json
{
  "brief": {
    "headline": "...",
    "narrative": "...",
    "tags": [...],
    "impactScan": [...],
    "signals": [...],
    "sources": [...]
  },
  "searchCount": 6,
  "generatedAt": 1714123456789,
  "cached": false
}
```

---

## Troubleshooting

**"ANTHROPIC_API_KEY environment variable not set"**
→ Re-do Step 5, then redeploy with `vercel --prod`

**"Anthropic API returned 401"**
→ Your API key is wrong or expired. Check at https://console.anthropic.com

**"Function timeout"**
→ Claude with web search can take 30-45 seconds. The `maxDuration: 60` in vercel.json handles this. If still timing out, check your Vercel plan (free tier has 60s limit — sufficient).

**CORS error in browser**
→ The `vercel.json` sets CORS headers for all `/api/*` routes. If you still see CORS errors, check your Vercel deployment picked up the `vercel.json` changes by running `vercel --prod` again.

**Response is cached**
→ The backend caches each brief for 4 hours per mode (morning/aftermarket). To force a fresh generation, click Refresh in Pulse — it sends `force: true` in the request body.

---

## Cost estimate

Each brief generation runs ~6-8 web searches and produces ~2000 tokens output.
Approximate Anthropic cost per brief: **$0.01–$0.02** (roughly 1-2 cents per generation).
At 2 briefs per day: ~$0.03/day → ~$1/month.

---

## Updating the backend

If the brief prompts need updating, edit `api/brief.js` and redeploy:

```bash
vercel --prod
```

No changes needed in `pulse.html` — it calls the same URL.

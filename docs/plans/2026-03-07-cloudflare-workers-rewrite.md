# FormRoute Cloudflare Workers Rewrite

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite FormRoute from Vercel serverless to Cloudflare Workers with D1 database, KV rate limiting, and REST-based email abstraction.

**Architecture:** Single CF Worker with itty-router handling all API routes. D1 for form config and submission storage. KV for rate limiting counters. Email via REST API calls to user-configured providers (Resend, SendGrid, Mailgun, Postmark). Static dashboard served from Worker.

**Tech Stack:** Cloudflare Workers, D1, KV, itty-router, Wrangler CLI, Vitest

---

## Task 1: Project Scaffolding

**Files:**
- Create: `wrangler.toml`
- Create: `package.json`
- Create: `migrations/0001_init.sql`
- Delete: `vercel.json`, `index.js`, `formroute.db`, `test.html`, `dashboard.html`
- Delete: `api/` directory, `lib/` directory, old `public/` directory

**Step 1: Create `wrangler.toml`**

```toml
name = "formroute"
main = "src/index.js"
compatibility_date = "2024-12-01"

[vars]
ENVIRONMENT = "production"

[[d1_databases]]
binding = "DB"
database_name = "formroute"
database_id = "placeholder-will-be-replaced-after-create"

[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "placeholder-will-be-replaced-after-create"

[site]
bucket = "./public"
```

**Step 2: Create `package.json`**

```json
{
  "name": "formroute",
  "version": "2.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "db:migrate": "wrangler d1 execute formroute --local --file=migrations/0001_init.sql",
    "db:migrate:prod": "wrangler d1 execute formroute --remote --file=migrations/0001_init.sql",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "itty-router": "^5.0.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.0",
    "vitest": "^3.0.0",
    "wrangler": "^4.0.0"
  }
}
```

**Step 3: Create `migrations/0001_init.sql`**

```sql
CREATE TABLE IF NOT EXISTS forms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email_template TEXT,
  redirect_url TEXT,
  success_message TEXT DEFAULT 'Thank you for your submission!',
  database_config TEXT NOT NULL DEFAULT '{"type":"d1"}',
  spam_protection TEXT DEFAULT '{"disabled":true}',
  email_config TEXT,
  api_key TEXT,
  allowed_domains TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  data TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  submitted_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
);

CREATE INDEX idx_submissions_form_id ON submissions(form_id);
CREATE INDEX idx_submissions_submitted_at ON submissions(submitted_at);
```

**Step 4: Delete old files**

```bash
rm -rf api/ lib/ node_modules/ package-lock.json
rm -f vercel.json index.js formroute.db test.html dashboard.html
rm -rf public/
rm -f .env.example
```

**Step 5: Create directory structure**

```bash
mkdir -p src/routes src/lib src/middleware public migrations
```

**Step 6: Install dependencies**

```bash
npm install
```

**Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold CF Workers project, remove Vercel structure"
```

---

## Task 2: Core Lib — Auth

**Files:**
- Create: `src/lib/auth.js`

**Step 1: Implement auth module**

Admin auth checks `Authorization: Bearer <ADMIN_API_KEY>` header against env var.
Per-form auth checks optional API key and domain whitelist.

```js
export function requireAdmin(request, env) {
  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return { success: false, status: 401, error: 'Authorization required' };
  }
  const token = header.slice(7);
  if (token !== env.ADMIN_API_KEY) {
    return { success: false, status: 403, error: 'Invalid admin key' };
  }
  return { success: true };
}

export function authenticateSubmission(request, form) {
  // API key check
  if (form.api_key) {
    const provided = request.headers.get('X-API-Key')
      || new URL(request.url).searchParams.get('api_key');
    if (!provided) {
      return { success: false, status: 401, error: 'API key required' };
    }
    if (provided !== form.api_key) {
      return { success: false, status: 403, error: 'Invalid API key' };
    }
  }

  // Domain check
  const allowedDomains = safeJsonParse(form.allowed_domains, []);
  if (allowedDomains.length > 0) {
    const origin = request.headers.get('Origin') || request.headers.get('Referer');
    if (!origin) {
      return { success: false, status: 403, error: 'Origin header required' };
    }
    try {
      const hostname = new URL(origin).hostname;
      if (!allowedDomains.includes(hostname)) {
        return { success: false, status: 403, error: 'Domain not allowed' };
      }
    } catch {
      return { success: false, status: 403, error: 'Invalid origin' };
    }
  }

  return { success: true };
}

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}
```

**Step 2: Commit**

```bash
git add src/lib/auth.js
git commit -m "feat: add auth module with admin and per-form authentication"
```

---

## Task 3: Core Lib — Rate Limiting (KV-backed)

**Files:**
- Create: `src/lib/rate-limit.js`

**Step 1: Implement KV-backed rate limiter**

Uses minute-bucket keys with TTL. Sliding window approximation.

```js
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS = 10;
const BUCKET_SIZE_MS = 60 * 1000; // 1-minute buckets

export async function checkRateLimit(ip, env) {
  const now = Date.now();
  const currentBucket = Math.floor(now / BUCKET_SIZE_MS);
  const bucketsInWindow = Math.ceil(WINDOW_MS / BUCKET_SIZE_MS);

  let totalCount = 0;

  // Read all bucket counts in parallel
  const keys = [];
  for (let i = 0; i < bucketsInWindow; i++) {
    keys.push(`rl:${ip}:${currentBucket - i}`);
  }

  const counts = await Promise.all(
    keys.map(key => env.RATE_LIMIT.get(key).then(v => parseInt(v) || 0))
  );
  totalCount = counts.reduce((sum, c) => sum + c, 0);

  if (totalCount >= MAX_REQUESTS) {
    return {
      limited: true,
      remaining: 0,
      retryAfter: Math.ceil(WINDOW_MS / 1000)
    };
  }

  // Increment current bucket
  const currentKey = `rl:${ip}:${currentBucket}`;
  const currentCount = counts[0] || 0;
  await env.RATE_LIMIT.put(currentKey, String(currentCount + 1), {
    expirationTtl: Math.ceil(WINDOW_MS / 1000) + 60
  });

  return {
    limited: false,
    remaining: MAX_REQUESTS - totalCount - 1
  };
}
```

**Step 2: Commit**

```bash
git add src/lib/rate-limit.js
git commit -m "feat: add KV-backed rate limiting with sliding window"
```

---

## Task 4: Core Lib — Spam Protection

**Files:**
- Create: `src/lib/spam.js`

**Step 1: Implement spam protection**

Same CAPTCHA verifiers (reCAPTCHA v2/v3, hCaptcha, Turnstile) + honeypot.
All use `fetch()` — works natively in Workers.

```js
async function verifyRecaptchaV2(token, secretKey) {
  const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(token)}`
  });
  const data = await response.json();
  return { success: data.success };
}

async function verifyRecaptchaV3(token, secretKey, minScore = 0.5) {
  const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(token)}`
  });
  const data = await response.json();
  return { success: data.success && data.score >= minScore, score: data.score };
}

async function verifyHcaptcha(token, secretKey) {
  const response = await fetch('https://hcaptcha.com/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(token)}`
  });
  const data = await response.json();
  return { success: data.success };
}

async function verifyTurnstile(token, secretKey) {
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(token)}`
  });
  const data = await response.json();
  return { success: data.success };
}

export async function verifySpamProtection(formData, spamConfig) {
  if (!spamConfig || spamConfig.disabled) {
    return { success: true };
  }

  // Honeypot check
  if (spamConfig.honeypot) {
    const field = spamConfig.honeypot.field || '_gotcha';
    if (formData[field] && formData[field].trim() !== '') {
      return { success: false, reason: 'Spam detected' };
    }
  }

  // CAPTCHA verification
  if (spamConfig.captcha) {
    const { type, secretKey, minScore } = spamConfig.captcha;
    const token = formData[spamConfig.captcha.field || 'captcha_token'];

    if (!token) {
      return { success: false, reason: 'CAPTCHA token missing' };
    }

    let result;
    switch (type) {
      case 'recaptcha_v2': result = await verifyRecaptchaV2(token, secretKey); break;
      case 'recaptcha_v3': result = await verifyRecaptchaV3(token, secretKey, minScore); break;
      case 'hcaptcha': result = await verifyHcaptcha(token, secretKey); break;
      case 'turnstile': result = await verifyTurnstile(token, secretKey); break;
      default: return { success: false, reason: 'Unknown CAPTCHA type' };
    }

    if (!result.success) {
      return {
        success: false,
        reason: `CAPTCHA verification failed${result.score != null ? ` (score: ${result.score})` : ''}`
      };
    }
  }

  return { success: true };
}
```

**Step 2: Commit**

```bash
git add src/lib/spam.js
git commit -m "feat: add spam protection with CAPTCHA and honeypot support"
```

---

## Task 5: Core Lib — Email Provider Abstraction

**Files:**
- Create: `src/lib/email.js`

**Step 1: Implement REST-based email providers**

Each provider is a simple `fetch()` call to their public API.

```js
const PROVIDERS = {
  resend: {
    url: 'https://api.resend.com/emails',
    buildRequest: (apiKey, from, to, subject, html) => ({
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to: [to], subject, html })
    })
  },
  sendgrid: {
    url: 'https://api.sendgrid.com/v3/mail/send',
    buildRequest: (apiKey, from, to, subject, html) => ({
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject,
        content: [{ type: 'text/html', value: html }]
      })
    })
  },
  mailgun: {
    buildRequest: (apiKey, from, to, subject, html, domain) => {
      const form = new URLSearchParams();
      form.append('from', from);
      form.append('to', to);
      form.append('subject', subject);
      form.append('html', html);
      return {
        url: `https://api.mailgun.net/v3/${domain}/messages`,
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`api:${apiKey}`)
        },
        body: form
      };
    }
  },
  postmark: {
    url: 'https://api.postmarkapp.com/email',
    buildRequest: (apiKey, from, to, subject, html) => ({
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ From: from, To: to, Subject: subject, HtmlBody: html })
    })
  }
};

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function generateEmailHtml(formData, formConfig, submissionId) {
  if (formConfig.email_template) {
    let template = formConfig.email_template;
    for (const [key, value] of Object.entries(formData)) {
      template = template.replaceAll(`{{${key}}}`, escapeHtml(value));
    }
    template = template.replaceAll('{{submissionId}}', submissionId);
    template = template.replaceAll('{{formName}}', escapeHtml(formConfig.name));
    return template;
  }

  const rows = Object.entries(formData)
    .map(([key, value]) =>
      `<tr><td style="padding:8px;font-weight:bold;background:#f5f5f5;border:1px solid #ddd">${escapeHtml(key)}</td><td style="padding:8px;border:1px solid #ddd">${escapeHtml(value)}</td></tr>`)
    .join('');

  return `<h2>New Form Submission</h2>
<p><strong>Form:</strong> ${escapeHtml(formConfig.name)}</p>
<p><strong>Submission ID:</strong> ${submissionId}</p>
<table style="border-collapse:collapse;width:100%">${rows}</table>
<p><small>Submitted at: ${new Date().toISOString()}</small></p>`;
}

export async function sendEmail(formData, formConfig, submissionId) {
  let emailConfig;
  try {
    emailConfig = typeof formConfig.email_config === 'string'
      ? JSON.parse(formConfig.email_config)
      : formConfig.email_config;
  } catch {
    return { success: false, reason: 'Invalid email configuration' };
  }

  if (!emailConfig || !emailConfig.provider || !emailConfig.api_key) {
    return { success: false, reason: 'Email not configured' };
  }

  const provider = PROVIDERS[emailConfig.provider];
  if (!provider) {
    return { success: false, reason: `Unknown email provider: ${emailConfig.provider}` };
  }

  const html = generateEmailHtml(formData, formConfig, submissionId);
  const subject = `New submission from ${formConfig.name}`;

  try {
    let url = provider.url;
    const reqInit = provider.buildRequest(
      emailConfig.api_key,
      emailConfig.from_email,
      emailConfig.to_email,
      subject,
      html,
      emailConfig.domain // for mailgun
    );

    // Mailgun returns url in the request init
    if (reqInit.url) {
      url = reqInit.url;
      delete reqInit.url;
    }

    const response = await fetch(url, reqInit);
    if (!response.ok) {
      const text = await response.text();
      console.error(`Email send failed (${emailConfig.provider}):`, text);
      return { success: false, reason: `Email send failed: ${response.status}` };
    }

    return { success: true };
  } catch (error) {
    console.error('Email error:', error);
    return { success: false, reason: error.message };
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/email.js
git commit -m "feat: add REST email abstraction for Resend, SendGrid, Mailgun, Postmark"
```

---

## Task 6: Core Lib — Database Adapters (D1 + Webhook)

**Files:**
- Create: `src/lib/database.js`

**Step 1: Implement D1 and webhook adapters**

```js
export class D1Adapter {
  constructor(db) {
    this.db = db;
  }

  async saveSubmission(formId, data, metadata) {
    const id = crypto.randomUUID();
    await this.db.prepare(
      'INSERT INTO submissions (id, form_id, data, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, formId, JSON.stringify(data), metadata.ip, metadata.userAgent).run();
    return { success: true, submissionId: id };
  }

  async getSubmissions(formId, limit = 100, offset = 0) {
    const result = await this.db.prepare(
      'SELECT * FROM submissions WHERE form_id = ? ORDER BY submitted_at DESC LIMIT ? OFFSET ?'
    ).bind(formId, limit, offset).run();
    return result.results.map(row => ({
      ...row,
      data: JSON.parse(row.data)
    }));
  }
}

export class WebhookAdapter {
  constructor(config) {
    this.webhookUrl = config.webhookUrl;
    this.headers = config.headers || {};
  }

  async saveSubmission(formId, data, metadata) {
    const submissionId = crypto.randomUUID();
    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.headers },
      body: JSON.stringify({
        formId,
        submissionId,
        data,
        metadata,
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status}`);
    }

    return { success: true, submissionId };
  }

  async getSubmissions() {
    throw new Error('Webhook adapter does not support reading submissions');
  }
}

export function createAdapter(config, db) {
  let parsed;
  try {
    parsed = typeof config === 'string' ? JSON.parse(config) : config;
  } catch {
    parsed = { type: 'd1' };
  }

  switch (parsed.type) {
    case 'webhook':
      return new WebhookAdapter(parsed);
    case 'd1':
    default:
      return new D1Adapter(db);
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/database.js
git commit -m "feat: add D1 and webhook database adapters"
```

---

## Task 7: CORS Middleware

**Files:**
- Create: `src/middleware/cors.js`

**Step 1: Implement CORS handler**

```js
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  'Access-Control-Max-Age': '86400'
};

export function corsHeaders() {
  return CORS_HEADERS;
}

export function handleOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

export function redirectResponse(url) {
  return new Response(null, {
    status: 302,
    headers: { Location: url, ...CORS_HEADERS }
  });
}
```

**Step 2: Commit**

```bash
git add src/middleware/cors.js
git commit -m "feat: add CORS middleware and response helpers"
```

---

## Task 8: Forms CRUD Route (Admin)

**Files:**
- Create: `src/routes/forms.js`

**Step 1: Implement forms CRUD**

All endpoints require admin auth via `ADMIN_API_KEY`.

```js
import { requireAdmin } from '../lib/auth.js';
import { jsonResponse } from '../middleware/cors.js';

export async function handleCreateForm(request, env) {
  const auth = requireAdmin(request, env);
  if (!auth.success) return jsonResponse({ error: auth.error }, auth.status);

  const body = await request.json();
  if (!body.name) return jsonResponse({ error: 'Form name is required' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO forms (id, name, email_template, redirect_url, success_message, database_config, spam_protection, email_config, api_key, allowed_domains, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    body.name,
    body.email_template || null,
    body.redirect_url || null,
    body.success_message || 'Thank you for your submission!',
    JSON.stringify(body.database || { type: 'd1' }),
    JSON.stringify(body.spam_protection || { disabled: true }),
    body.email_config ? JSON.stringify(body.email_config) : null,
    body.api_key || null,
    JSON.stringify(body.allowed_domains || []),
    now, now
  ).run();

  const submitUrl = new URL(`/api/submit/${id}`, request.url).toString();

  return jsonResponse({
    success: true,
    formId: id,
    submitUrl,
    form: { id, name: body.name, submitUrl }
  }, 201);
}

export async function handleListForms(request, env) {
  const auth = requireAdmin(request, env);
  if (!auth.success) return jsonResponse({ error: auth.error }, auth.status);

  const result = await env.DB.prepare(
    'SELECT id, name, created_at, updated_at FROM forms ORDER BY created_at DESC'
  ).all();

  return jsonResponse({ forms: result.results });
}

export async function handleGetForm(request, env, formId) {
  const auth = requireAdmin(request, env);
  if (!auth.success) return jsonResponse({ error: auth.error }, auth.status);

  const form = await env.DB.prepare('SELECT * FROM forms WHERE id = ?').bind(formId).first();
  if (!form) return jsonResponse({ error: 'Form not found' }, 404);

  return jsonResponse({ form });
}

export async function handleUpdateForm(request, env, formId) {
  const auth = requireAdmin(request, env);
  if (!auth.success) return jsonResponse({ error: auth.error }, auth.status);

  const existing = await env.DB.prepare('SELECT id FROM forms WHERE id = ?').bind(formId).first();
  if (!existing) return jsonResponse({ error: 'Form not found' }, 404);

  const body = await request.json();
  const fields = [];
  const values = [];

  const updatable = {
    name: body.name,
    email_template: body.email_template,
    redirect_url: body.redirect_url,
    success_message: body.success_message,
    api_key: body.api_key
  };

  for (const [key, value] of Object.entries(updatable)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  // JSON fields
  if (body.database !== undefined) { fields.push('database_config = ?'); values.push(JSON.stringify(body.database)); }
  if (body.spam_protection !== undefined) { fields.push('spam_protection = ?'); values.push(JSON.stringify(body.spam_protection)); }
  if (body.email_config !== undefined) { fields.push('email_config = ?'); values.push(body.email_config ? JSON.stringify(body.email_config) : null); }
  if (body.allowed_domains !== undefined) { fields.push('allowed_domains = ?'); values.push(JSON.stringify(body.allowed_domains)); }

  if (fields.length === 0) return jsonResponse({ error: 'No fields to update' }, 400);

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(formId);

  await env.DB.prepare(`UPDATE forms SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

  const updated = await env.DB.prepare('SELECT * FROM forms WHERE id = ?').bind(formId).first();
  return jsonResponse({ form: updated });
}

export async function handleDeleteForm(request, env, formId) {
  const auth = requireAdmin(request, env);
  if (!auth.success) return jsonResponse({ error: auth.error }, auth.status);

  const result = await env.DB.prepare('DELETE FROM forms WHERE id = ?').bind(formId).run();
  if (result.meta.changes === 0) return jsonResponse({ error: 'Form not found' }, 404);

  // Also delete submissions
  await env.DB.prepare('DELETE FROM submissions WHERE form_id = ?').bind(formId).run();

  return jsonResponse({ success: true });
}

export async function handleGetSubmissions(request, env, formId) {
  const auth = requireAdmin(request, env);
  if (!auth.success) return jsonResponse({ error: auth.error }, auth.status);

  const form = await env.DB.prepare('SELECT id FROM forms WHERE id = ?').bind(formId).first();
  if (!form) return jsonResponse({ error: 'Form not found' }, 404);

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit')) || 100, 500);
  const offset = parseInt(url.searchParams.get('offset')) || 0;

  const result = await env.DB.prepare(
    'SELECT * FROM submissions WHERE form_id = ? ORDER BY submitted_at DESC LIMIT ? OFFSET ?'
  ).bind(formId, limit, offset).all();

  const submissions = result.results.map(row => ({
    ...row,
    data: JSON.parse(row.data)
  }));

  return jsonResponse({ submissions, total: submissions.length, limit, offset });
}
```

**Step 2: Commit**

```bash
git add src/routes/forms.js
git commit -m "feat: add forms CRUD routes with admin auth"
```

---

## Task 9: Submit Route (Public)

**Files:**
- Create: `src/routes/submit.js`

**Step 1: Implement form submission handler**

```js
import { authenticateSubmission } from '../lib/auth.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { verifySpamProtection } from '../lib/spam.js';
import { createAdapter } from '../lib/database.js';
import { sendEmail } from '../lib/email.js';
import { jsonResponse, redirectResponse } from '../middleware/cors.js';

function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || '127.0.0.1';
}

function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try { return typeof str === 'string' ? JSON.parse(str) : str; } catch { return fallback; }
}

export async function handleSubmit(request, env, formId) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // Look up form
  const form = await env.DB.prepare('SELECT * FROM forms WHERE id = ?').bind(formId).first();
  if (!form) return jsonResponse({ error: 'Form not found' }, 404);

  // Rate limiting
  const clientIP = getClientIP(request);
  const rateResult = await checkRateLimit(clientIP, env);
  if (rateResult.limited) {
    return jsonResponse({ error: 'Too many requests', retryAfter: rateResult.retryAfter }, 429);
  }

  // Per-form auth (API key + domain)
  const authResult = authenticateSubmission(request, form);
  if (!authResult.success) {
    return jsonResponse({ error: authResult.error }, authResult.status);
  }

  // Parse body (support both JSON and form-urlencoded)
  let formData;
  const contentType = request.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    formData = await request.json();
  } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const fd = await request.formData();
    formData = Object.fromEntries(fd.entries());
  } else {
    // Try JSON, fall back to formData
    try {
      formData = await request.json();
    } catch {
      try {
        const fd = await request.formData();
        formData = Object.fromEntries(fd.entries());
      } catch {
        return jsonResponse({ error: 'Unable to parse request body' }, 400);
      }
    }
  }

  if (!formData || Object.keys(formData).length === 0) {
    return jsonResponse({ error: 'No form data provided' }, 400);
  }

  // Spam protection
  const spamConfig = safeJsonParse(form.spam_protection, { disabled: true });
  const spamResult = await verifySpamProtection(formData, spamConfig);
  if (!spamResult.success) {
    return jsonResponse({ error: 'Spam protection failed', reason: spamResult.reason }, 400);
  }

  // Remove spam-protection fields from stored data
  const cleanData = { ...formData };
  delete cleanData['captcha_token'];
  delete cleanData['g-recaptcha-response'];
  delete cleanData['h-captcha-response'];
  delete cleanData['cf-turnstile-response'];
  delete cleanData['_gotcha'];
  if (spamConfig.captcha?.field) delete cleanData[spamConfig.captcha.field];
  if (spamConfig.honeypot?.field) delete cleanData[spamConfig.honeypot.field];

  // Save submission
  const adapter = createAdapter(form.database_config, env.DB);
  const metadata = {
    ip: clientIP,
    userAgent: request.headers.get('User-Agent') || ''
  };

  let saveResult;
  try {
    saveResult = await adapter.saveSubmission(formId, cleanData, metadata);
  } catch (error) {
    console.error('Save error:', error);
    return jsonResponse({ error: 'Failed to save submission' }, 500);
  }

  // Send email notification (non-blocking — don't fail the submission if email fails)
  sendEmail(cleanData, form, saveResult.submissionId).catch(err => {
    console.error('Email send error:', err);
  });

  // Respond
  const accept = request.headers.get('Accept') || '';
  if (form.redirect_url && accept.includes('text/html')) {
    return redirectResponse(form.redirect_url);
  }

  return jsonResponse({
    success: true,
    message: form.success_message || 'Thank you for your submission!',
    submissionId: saveResult.submissionId
  });
}
```

**Step 2: Commit**

```bash
git add src/routes/submit.js
git commit -m "feat: add public form submission endpoint"
```

---

## Task 10: Worker Entry Point

**Files:**
- Create: `src/index.js`

**Step 1: Wire up router and all routes**

```js
import { AutoRouter } from 'itty-router';
import { handleOptions, jsonResponse } from './middleware/cors.js';
import { handleCreateForm, handleListForms, handleGetForm, handleUpdateForm, handleDeleteForm, handleGetSubmissions } from './routes/forms.js';
import { handleSubmit } from './routes/submit.js';

const router = AutoRouter({
  before: [(request) => {
    if (request.method === 'OPTIONS') return handleOptions();
  }],
  catch: (error) => {
    console.error('Unhandled error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  },
  finally: [(response) => {
    // Add CORS headers to all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key'
    };
    for (const [key, value] of Object.entries(corsHeaders)) {
      if (!response.headers.has(key)) {
        response.headers.set(key, value);
      }
    }
    return response;
  }]
});

// Public submission endpoint
router.post('/api/submit/:formId', (request, env) => handleSubmit(request, env, request.params.formId));

// Admin form management
router.post('/api/forms', (request, env) => handleCreateForm(request, env));
router.get('/api/forms', (request, env) => handleListForms(request, env));
router.get('/api/forms/:formId', (request, env) => handleGetForm(request, env, request.params.formId));
router.put('/api/forms/:formId', (request, env) => handleUpdateForm(request, env, request.params.formId));
router.delete('/api/forms/:formId', (request, env) => handleDeleteForm(request, env, request.params.formId));

// Submissions
router.get('/api/forms/:formId/submissions', (request, env) => handleGetSubmissions(request, env, request.params.formId));

// Health check
router.get('/api/health', () => jsonResponse({ status: 'ok', timestamp: new Date().toISOString() }));

// Dashboard - serve static HTML
router.get('/dashboard', async (request, env) => {
  // Served via Workers Sites from public/ directory
  // The [site] config in wrangler.toml handles this
  return env.ASSETS.fetch(new Request(new URL('/dashboard.html', request.url)));
});

// Catch-all 404
router.all('*', () => jsonResponse({ error: 'Not found' }, 404));

export default router;
```

**Step 2: Commit**

```bash
git add src/index.js
git commit -m "feat: add worker entry point with itty-router"
```

---

## Task 11: Dashboard HTML

**Files:**
- Create: `public/dashboard.html`

**Step 1: Create updated dashboard**

Simplified dashboard with:
- Admin API key login gate
- Form creation (name, email config with provider selection, webhook or D1 routing, spam protection)
- Form listing
- Removed: Google Sheets, Make.com, Turso, SMTP options

The dashboard HTML should be a single-page app that:
1. Prompts for admin API key on load (stores in sessionStorage)
2. Sends `Authorization: Bearer <key>` with all API calls
3. Shows form creation wizard with only D1 and Webhook as data routing options
4. Shows email provider selection (Resend, SendGrid, Mailgun, Postmark)
5. Lists existing forms with submission counts

**Step 2: Commit**

```bash
git add public/dashboard.html
git commit -m "feat: add dashboard with admin auth and updated options"
```

---

## Task 12: Configuration Files

**Files:**
- Create: `.dev.vars` (gitignored)
- Update: `.gitignore`

**Step 1: Create `.dev.vars` for local development**

```
ADMIN_API_KEY=dev-admin-key-change-me
```

**Step 2: Update `.gitignore`**

```
node_modules/
.dev.vars
.wrangler/
*.db
.DS_Store
```

**Step 3: Commit**

```bash
git add .gitignore wrangler.toml
git commit -m "chore: add wrangler config and update gitignore"
```

---

## Task 13: Final Cleanup and README

**Files:**
- Delete: `examples/` directory
- Update: `README.md`

**Step 1: Remove old examples**

```bash
rm -rf examples/
```

**Step 2: Update README with CF Workers setup instructions**

Cover: prerequisites, `wrangler d1 create`, KV namespace creation, updating wrangler.toml IDs, `npm run db:migrate`, `npm run dev`, `npm run deploy`.

**Step 3: Final commit**

```bash
git add -A
git commit -m "docs: update README for Cloudflare Workers deployment"
```

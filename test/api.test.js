import { env, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';

const BASE = 'https://formroute.test';
const ADMIN = { Authorization: 'Bearer test-admin-key', 'Content-Type': 'application/json' };
const RESEND = { provider: 'resend', api_key: 're_test', from_email: 'from@example.com', to_email: 'to@example.com' };

// Each submission gets its own address so tests don't trip the rate limit by accident.
let lastAddress = 0;
const nextIp = () => `203.0.113.${++lastAddress}`;

const call = (path, init) => exports.default.fetch(`${BASE}${path}`, init);

async function createForm(fields = {}) {
  const response = await call('/api/forms', { method: 'POST', headers: ADMIN, body: JSON.stringify({ name: 'Test form', ...fields }) });
  expect(response.status).toBe(201);
  return (await response.json()).formId;
}

const submit = (formId, body, headers = {}) =>
  call(`/api/submit/${formId}`, { method: 'POST', redirect: 'manual', headers: { 'CF-Connecting-IP': nextIp(), ...headers }, body });

const submitJson = (formId, data, headers = {}) =>
  submit(formId, JSON.stringify(data), { 'Content-Type': 'application/json', ...headers });

// A ReadableStream has no length up front, so the request goes out without Content-Length.
function streamOf(...chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
}

async function listSubmissions(formId, query = '') {
  const response = await call(`/api/forms/${formId}/submissions${query}`, { headers: ADMIN });
  expect(response.status).toBe(200);
  return response.json();
}

// Worker code shares this global, so this also catches the email and CAPTCHA calls.
const mockOutboundFetch = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('admin auth', () => {
  it('rejects a missing or wrong key on every admin path', async () => {
    expect((await call('/api/forms')).status).toBe(401);
    expect((await call('/api/forms/abc/submissions')).status).toBe(401);
    expect((await call('/api/forms', { headers: { Authorization: 'Bearer nope' } })).status).toBe(403);
  });

  it('accepts the right key', async () => {
    expect((await call('/api/forms', { headers: ADMIN })).status).toBe(200);
  });
});

describe('form management', () => {
  it('answers bad JSON with a 400', async () => {
    const created = await call('/api/forms', { method: 'POST', headers: ADMIN, body: '{not json' });
    expect(created.status).toBe(400);

    const formId = await createForm();
    const updated = await call(`/api/forms/${formId}`, { method: 'PUT', headers: ADMIN, body: '[1,2]' });
    expect(updated.status).toBe(400);
  });

  it('updates a form in one statement and reports unknown ids', async () => {
    const formId = await createForm();

    const updated = await call(`/api/forms/${formId}`, {
      method: 'PUT',
      headers: ADMIN,
      body: JSON.stringify({ name: 'Renamed', allowed_domains: ['example.com'], email_config: null })
    });
    expect(updated.status).toBe(200);
    const { form } = await updated.json();
    expect(form.name).toBe('Renamed');
    expect(form.allowed_domains).toBe('["example.com"]');
    expect(form.email_config).toBeNull();

    const empty = await call(`/api/forms/${formId}`, { method: 'PUT', headers: ADMIN, body: '{}' });
    expect(empty.status).toBe(400);

    const missing = await call('/api/forms/does-not-exist', { method: 'PUT', headers: ADMIN, body: '{"name":"x"}' });
    expect(missing.status).toBe(404);
  });

  it('deletes a form and its submissions together', async () => {
    const formId = await createForm();
    await submitJson(formId, { a: 'b' });

    expect((await call(`/api/forms/${formId}`, { method: 'DELETE', headers: ADMIN })).status).toBe(200);

    const { total } = await env.DB.prepare('SELECT COUNT(*) AS total FROM submissions WHERE form_id = ?').bind(formId).first();
    expect(total).toBe(0);
    expect((await call(`/api/forms/${formId}`, { method: 'DELETE', headers: ADMIN })).status).toBe(404);
  });

  it('pages submissions and reports the real total', async () => {
    const formId = await createForm();
    for (const n of [1, 2, 3]) await submitJson(formId, { n });

    const page = await listSubmissions(formId, '?limit=2');
    expect(page.submissions).toHaveLength(2);
    expect(page.total).toBe(3);

    const clamped = await listSubmissions(formId, '?limit=-5&offset=-1');
    expect(clamped.limit).toBe(1);
    expect(clamped.offset).toBe(0);

    expect((await call('/api/forms/does-not-exist/submissions', { headers: ADMIN })).status).toBe(404);
  });
});

describe('submitting', () => {
  it('stores JSON submissions and sets CORS headers', async () => {
    const formId = await createForm({ success_message: 'Got it' });

    const response = await submitJson(formId, { email: 'test@example.com' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await response.json()).message).toBe('Got it');

    const { submissions } = await listSubmissions(formId);
    expect(submissions[0].data).toEqual({ email: 'test@example.com' });
  });

  it('answers preflight requests', async () => {
    const response = await call('/api/submit/anything', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('keeps every value of a repeated field', async () => {
    const formId = await createForm();
    await submit(formId, 'name=Test&interest=a&interest=b', { 'Content-Type': 'application/x-www-form-urlencoded' });

    const { submissions } = await listSubmissions(formId);
    expect(submissions[0].data).toEqual({ name: 'Test', interest: ['a', 'b'] });
  });

  it('records an upload by its file name', async () => {
    const formId = await createForm();
    const body = new FormData();
    body.append('name', 'Test');
    body.append('resume', new File(['hello'], 'cv.pdf'));
    await call(`/api/submit/${formId}`, { method: 'POST', headers: { 'CF-Connecting-IP': nextIp() }, body });

    const { submissions } = await listSubmissions(formId);
    expect(submissions[0].data).toEqual({ name: 'Test', resume: 'cv.pdf' });
  });

  it('answers unusable bodies with a 400', async () => {
    const formId = await createForm();
    expect((await submit(formId, '{not json', { 'Content-Type': 'application/json' })).status).toBe(400);
    expect((await submitJson(formId, [1, 2])).status).toBe(400);
    expect((await submitJson(formId, 'text')).status).toBe(400);
    expect((await submitJson(formId, {})).status).toBe(400);
  });

  it('refuses oversized submissions', async () => {
    const formId = await createForm();
    const response = await submit(formId, 'x'.repeat(1024 * 1024 + 1), { 'Content-Type': 'application/json' });
    expect(response.status).toBe(413);
  });

  it('refuses oversized submissions sent without Content-Length', async () => {
    const formId = await createForm();
    // Valid JSON of 1 MB plus 1 byte, so only the cap keeps it out of the database.
    const json = `{"a":"${'x'.repeat(1024 * 1024 - 7)}"}`;
    const response = await submit(formId, streamOf(json), { 'Content-Type': 'application/json' });
    expect(response.status).toBe(413);
  });

  it('accepts a small streamed submission', async () => {
    const formId = await createForm();
    const response = await submit(formId, streamOf('{"name":', '"Test"}'), { 'Content-Type': 'application/json' });
    expect(response.status).toBe(200);

    const { submissions } = await listSubmissions(formId);
    expect(submissions[0].data).toEqual({ name: 'Test' });
  });

  it('redirects browsers when a redirect URL is set', async () => {
    const formId = await createForm({ redirect_url: 'https://example.com/thanks' });
    const response = await submitJson(formId, { a: 'b' }, { Accept: 'text/html' });
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('https://example.com/thanks');
  });

  it('rate limits by address', async () => {
    const formId = await createForm();
    const headers = { 'CF-Connecting-IP': '198.51.100.7' };

    let limited;
    for (let i = 0; i < 30 && !limited; i++) {
      const response = await submitJson(formId, { i }, headers);
      if (response.status === 429) limited = response;
    }

    expect(limited).toBeDefined();
    expect(limited.headers.get('Retry-After')).toBe('60');
  });
});

describe('per-form security', () => {
  it('checks the form API key', async () => {
    const formId = await createForm({ api_key: 'form-key' });
    expect((await submitJson(formId, { a: 'b' })).status).toBe(401);
    expect((await submitJson(formId, { a: 'b' }, { 'X-API-Key': 'wrong' })).status).toBe(403);
    expect((await submitJson(formId, { a: 'b' }, { 'X-API-Key': 'form-key' })).status).toBe(200);
  });

  it('matches allowed domains exactly, even when one is saved as a string', async () => {
    const formId = await createForm({ allowed_domains: 'example.com' });
    expect((await submitJson(formId, { a: 'b' }, { Origin: 'https://ample.com' })).status).toBe(403);
    expect((await submitJson(formId, { a: 'b' }, { Origin: 'https://example.com' })).status).toBe(200);
  });
});

describe('spam protection', () => {
  it('catches a honeypot filled with a non-string value', async () => {
    const formId = await createForm({ spam_protection: { honeypot: { field: '_gotcha' } } });
    const response = await submitJson(formId, { a: 'b', _gotcha: 1 });
    expect(response.status).toBe(400);
    expect((await response.json()).reason).toBe('Spam detected');
  });

  it('strips honeypot and CAPTCHA fields from what it stores', async () => {
    mockOutboundFetch().mockImplementation(async () => Response.json({ success: true }));
    const formId = await createForm({ spam_protection: { captcha: { type: 'turnstile', secretKey: 'secret' }, honeypot: {} } });

    expect((await submitJson(formId, { a: 'b', _gotcha: '', captcha_token: 'token' })).status).toBe(200);

    const { submissions } = await listSubmissions(formId);
    expect(submissions[0].data).toEqual({ a: 'b' });
  });

  it('fails closed when the CAPTCHA service is down', async () => {
    mockOutboundFetch().mockImplementation(async () => {
      throw new Error('network down');
    });
    const formId = await createForm({ spam_protection: { captcha: { type: 'turnstile', secretKey: 'secret' } } });

    const response = await submitJson(formId, { a: 'b', captcha_token: 'token' });
    expect(response.status).toBe(400);
    expect((await response.json()).reason).toBe('CAPTCHA verification failed');
  });

  it('applies the reCAPTCHA v3 minimum score', async () => {
    mockOutboundFetch().mockImplementation(async () => Response.json({ success: true, score: 0.2 }));
    const formId = await createForm({ spam_protection: { captcha: { type: 'recaptcha_v3', secretKey: 'secret', minScore: 0.5 } } });

    expect((await submitJson(formId, { a: 'b', captcha_token: 'token' })).status).toBe(400);
  });
});

describe('notification email', () => {
  async function sentHtml(formId, data) {
    const outbound = mockOutboundFetch();
    expect((await submitJson(formId, data)).status).toBe(200);
    await vi.waitFor(() => expect(outbound).toHaveBeenCalledOnce());
    const [url, request] = outbound.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    return JSON.parse(request.body).html;
  }

  it('is sent after the response, with non-string values escaped too', async () => {
    const formId = await createForm({ email_config: RESEND });
    const html = await sentHtml(formId, { name: '<b>Test</b>', tags: ['<script>x</script>', 'ok'], nested: { a: '<i>' } });

    expect(html).toContain('&lt;b&gt;Test&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;, ok');
    expect(html).toContain('&lt;i&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<i>');
  });

  it('fills a template in one pass', async () => {
    const formId = await createForm({
      email_config: RESEND,
      email_template: '<p>{{ name }}|{{other}}|{{missing}}|{{submissionId}}|{{formName}}</p>'
    });
    const html = await sentHtml(formId, { name: '$& {{other}}', other: 'value', submissionId: 'spoofed', formName: 'spoofed' });

    expect(html).toMatch(/^<p>\$&amp; \{\{other\}\}\|value\|\|[0-9a-f-]{36}\|Test form<\/p>$/);
  });

  it('never makes a request for a form without email', async () => {
    const outbound = mockOutboundFetch();
    const formId = await createForm();
    expect((await submitJson(formId, { a: 'b' })).status).toBe(200);
    expect(outbound).not.toHaveBeenCalled();
  });
});

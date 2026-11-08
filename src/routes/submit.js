import { authenticateSubmission } from '../lib/auth.js';
import { readBody, readSubmission, safeJsonParse } from '../lib/body.js';
import { verifySpamProtection } from '../lib/spam.js';
import { createAdapter } from '../lib/database.js';
import { sendEmail } from '../lib/email.js';
import { jsonResponse, redirectResponse } from '../middleware/cors.js';

const MAX_BODY_BYTES = 1024 * 1024;
const RETRY_AFTER_SECONDS = 60;
const CAPTCHA_FIELDS = ['captcha_token', 'g-recaptcha-response', 'h-captcha-response', 'cf-turnstile-response', '_gotcha'];

export async function handleSubmit(request, env, ctx) {
  const clientIP = request.headers.get('CF-Connecting-IP') || '127.0.0.1';

  // First, because it's free: floods are turned away before any database read.
  const { success: withinLimit } = await env.SUBMIT_LIMITER.limit({ key: clientIP });
  if (!withinLimit) {
    return jsonResponse({ error: 'Too many requests', retryAfter: RETRY_AFTER_SECONDS }, 429, {
      'Retry-After': String(RETRY_AFTER_SECONDS)
    });
  }

  // A fast path. readBody below enforces the cap on the bytes that actually arrive.
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'Submission too large' }, 413);
  }

  const formId = request.params.formId;
  const form = await env.DB.prepare('SELECT * FROM forms WHERE id = ?').bind(formId).first();
  if (!form) return jsonResponse({ error: 'Form not found' }, 404);

  const authResult = await authenticateSubmission(request, form);
  if (!authResult.success) {
    return jsonResponse({ error: authResult.error }, authResult.status);
  }

  const body = await readBody(request, MAX_BODY_BYTES);
  if (!body) {
    return jsonResponse({ error: 'Submission too large' }, 413);
  }

  const formData = await readSubmission(request, body);
  if (!formData) {
    return jsonResponse({ error: 'Unable to parse request body' }, 400);
  }
  if (Object.keys(formData).length === 0) {
    return jsonResponse({ error: 'No form data provided' }, 400);
  }

  const spamConfig = safeJsonParse(form.spam_protection, { disabled: true });
  const spamResult = await verifySpamProtection(formData, spamConfig);
  if (!spamResult.success) {
    return jsonResponse({ error: 'Spam protection failed', reason: spamResult.reason }, 400);
  }

  const cleanData = { ...formData };
  for (const field of [...CAPTCHA_FIELDS, spamConfig?.captcha?.field, spamConfig?.honeypot?.field]) {
    if (field) delete cleanData[field];
  }

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

  // waitUntil keeps the Worker alive after the response. Without it the runtime
  // can cancel the email once the visitor has their answer.
  ctx.waitUntil(
    sendEmail(cleanData, form, saveResult.submissionId).catch((error) => {
      console.error('Email send error:', error);
    })
  );

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

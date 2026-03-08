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

  const form = await env.DB.prepare('SELECT * FROM forms WHERE id = ?').bind(formId).first();
  if (!form) return jsonResponse({ error: 'Form not found' }, 404);

  const clientIP = getClientIP(request);
  const rateResult = await checkRateLimit(clientIP, env);
  if (rateResult.limited) {
    return jsonResponse({ error: 'Too many requests', retryAfter: rateResult.retryAfter }, 429);
  }

  const authResult = authenticateSubmission(request, form);
  if (!authResult.success) {
    return jsonResponse({ error: authResult.error }, authResult.status);
  }

  let formData;
  const contentType = request.headers.get('Content-Type') || '';
  if (contentType.includes('application/json')) {
    formData = await request.json();
  } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const fd = await request.formData();
    formData = Object.fromEntries(fd.entries());
  } else {
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

  const spamConfig = safeJsonParse(form.spam_protection, { disabled: true });
  const spamResult = await verifySpamProtection(formData, spamConfig);
  if (!spamResult.success) {
    return jsonResponse({ error: 'Spam protection failed', reason: spamResult.reason }, 400);
  }

  const cleanData = { ...formData };
  delete cleanData['captcha_token'];
  delete cleanData['g-recaptcha-response'];
  delete cleanData['h-captcha-response'];
  delete cleanData['cf-turnstile-response'];
  delete cleanData['_gotcha'];
  if (spamConfig.captcha?.field) delete cleanData[spamConfig.captcha.field];
  if (spamConfig.honeypot?.field) delete cleanData[spamConfig.honeypot.field];

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

  sendEmail(cleanData, form, saveResult.submissionId).catch(err => {
    console.error('Email send error:', err);
  });

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

import { jsonResponse } from '../middleware/cors.js';
import { safeJsonParse } from './body.js';

const encoder = new TextEncoder();

// timingSafeEqual needs equal lengths, which hashing both values guarantees.
async function safeEqual(a, b) {
  const [hashA, hashB] = await Promise.all(
    [a, b].map((value) => crypto.subtle.digest('SHA-256', encoder.encode(value)))
  );
  return crypto.subtle.timingSafeEqual(hashA, hashB);
}

export async function requireAdmin(request, env) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Authorization required' }, 401);
  }
  if (!env.ADMIN_API_KEY || !(await safeEqual(header.slice(7), env.ADMIN_API_KEY))) {
    return jsonResponse({ error: 'Invalid admin key' }, 403);
  }
}

export async function authenticateSubmission(request, form) {
  if (form.api_key) {
    const provided = request.headers.get('X-API-Key')
      || new URL(request.url).searchParams.get('api_key');
    if (!provided) {
      return { success: false, status: 401, error: 'API key required' };
    }
    if (!(await safeEqual(provided, form.api_key))) {
      return { success: false, status: 403, error: 'Invalid API key' };
    }
  }

  // concat keeps a single domain saved as a string from matching on a substring.
  const allowedDomains = [].concat(safeJsonParse(form.allowed_domains, []));
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

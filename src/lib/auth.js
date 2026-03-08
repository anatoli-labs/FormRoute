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

function verifyApiKey(req, form) {
  // If form doesn't require API key, allow access
  if (!form.apiKey) {
    return { success: true };
  }
  
  const providedKey = req.headers['x-api-key'] || req.query.api_key;
  
  if (!providedKey) {
    return { 
      success: false, 
      error: 'API key required',
      status: 401 
    };
  }
  
  if (providedKey !== form.apiKey) {
    return { 
      success: false, 
      error: 'Invalid API key',
      status: 403 
    };
  }
  
  return { success: true };
}

function verifyDomain(req, form) {
  // If no domain restrictions, allow all
  if (!form.allowedDomains || form.allowedDomains.length === 0) {
    return { success: true };
  }
  
  const origin = req.headers.origin || req.headers.referer;
  
  if (!origin) {
    return { 
      success: false, 
      error: 'Origin header required',
      status: 403 
    };
  }
  
  const domain = new URL(origin).hostname;
  
  if (!form.allowedDomains.includes(domain)) {
    return { 
      success: false, 
      error: 'Domain not allowed',
      status: 403 
    };
  }
  
  return { success: true };
}

function authenticate(req, form) {
  // Check API key first
  const apiKeyResult = verifyApiKey(req, form);
  if (!apiKeyResult.success) {
    return apiKeyResult;
  }
  
  // Check domain restrictions
  const domainResult = verifyDomain(req, form);
  if (!domainResult.success) {
    return domainResult;
  }
  
  return { success: true };
}

module.exports = {
  authenticate,
  verifyApiKey,
  verifyDomain
};
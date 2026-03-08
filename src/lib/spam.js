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

  if (spamConfig.honeypot) {
    const field = spamConfig.honeypot.field || '_gotcha';
    if (formData[field] && formData[field].trim() !== '') {
      return { success: false, reason: 'Spam detected' };
    }
  }

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

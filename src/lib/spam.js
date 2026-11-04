const TIMEOUT_MS = 10_000;

const VERIFY_URLS = {
  recaptcha_v2: 'https://www.google.com/recaptcha/api/siteverify',
  recaptcha_v3: 'https://www.google.com/recaptcha/api/siteverify',
  hcaptcha: 'https://hcaptcha.com/siteverify',
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
};

async function verifyCaptcha({ type, secretKey, minScore = 0.5 }, token) {
  const response = await fetch(VERIFY_URLS[type], {
    method: 'POST',
    body: new URLSearchParams({ secret: secretKey, response: String(token) }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const data = await response.json();
  return Boolean(data.success) && (type !== 'recaptcha_v3' || data.score >= minScore);
}

export async function verifySpamProtection(formData, spamConfig) {
  if (!spamConfig || spamConfig.disabled) {
    return { success: true };
  }

  if (spamConfig.honeypot) {
    const value = formData[spamConfig.honeypot.field || '_gotcha'];
    if (value != null && String(value).trim() !== '') {
      return { success: false, reason: 'Spam detected' };
    }
  }

  if (spamConfig.captcha) {
    if (!Object.hasOwn(VERIFY_URLS, spamConfig.captcha.type)) {
      return { success: false, reason: 'Unknown CAPTCHA type' };
    }

    const token = formData[spamConfig.captcha.field || 'captcha_token'];
    if (!token) {
      return { success: false, reason: 'CAPTCHA token missing' };
    }

    let verified = false;
    try {
      verified = await verifyCaptcha(spamConfig.captcha, token);
    } catch (error) {
      console.error('CAPTCHA verification error:', error);
    }
    if (!verified) {
      return { success: false, reason: 'CAPTCHA verification failed' };
    }
  }

  return { success: true };
}

async function verifyRecaptchaV2(token, secretKey) {
  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${secretKey}&response=${token}`
    });
    
    const data = await response.json();
    return { success: data.success, score: null };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function verifyRecaptchaV3(token, secretKey, minScore = 0.5) {
  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${secretKey}&response=${token}`
    });
    
    const data = await response.json();
    return { 
      success: data.success && data.score >= minScore, 
      score: data.score 
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function verifyHcaptcha(token, secretKey) {
  try {
    const response = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${secretKey}&response=${token}`
    });
    
    const data = await response.json();
    return { success: data.success, score: null };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function verifyTurnstile(token, secretKey) {
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${secretKey}&response=${token}`
    });
    
    const data = await response.json();
    return { success: data.success, score: null };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function checkHoneypot(formData, honeypotField = '_gotcha') {
  return !formData[honeypotField] || formData[honeypotField].trim() === '';
}

async function verifySpamProtection(formData, spamConfig) {
  if (!spamConfig || spamConfig.disabled) {
    return { success: true };
  }
  
  // Honeypot check (always enabled if configured)
  if (spamConfig.honeypot) {
    const honeypotValid = checkHoneypot(formData, spamConfig.honeypot.field);
    if (!honeypotValid) {
      return { success: false, reason: 'Honeypot triggered' };
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
      case 'recaptcha_v2':
        result = await verifyRecaptchaV2(token, secretKey);
        break;
      case 'recaptcha_v3':
        result = await verifyRecaptchaV3(token, secretKey, minScore);
        break;
      case 'hcaptcha':
        result = await verifyHcaptcha(token, secretKey);
        break;
      case 'turnstile':
        result = await verifyTurnstile(token, secretKey);
        break;
      default:
        return { success: false, reason: 'Unknown CAPTCHA type' };
    }
    
    if (!result.success) {
      return { 
        success: false, 
        reason: `CAPTCHA verification failed${result.score ? ` (score: ${result.score})` : ''}` 
      };
    }
  }
  
  return { success: true };
}

module.exports = {
  verifySpamProtection,
  checkHoneypot,
  verifyRecaptchaV2,
  verifyRecaptchaV3,
  verifyHcaptcha,
  verifyTurnstile
};
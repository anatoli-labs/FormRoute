const TIMEOUT_MS = 10_000;

// Each provider turns the form's email config into a [url, request] pair.
const PROVIDERS = {
  resend: ({ api_key, from_email, to_email }, subject, html) => ['https://api.resend.com/emails', {
    headers: { 'Authorization': `Bearer ${api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: from_email, to: [to_email], subject, html })
  }],
  sendgrid: ({ api_key, from_email, to_email }, subject, html) => ['https://api.sendgrid.com/v3/mail/send', {
    headers: { 'Authorization': `Bearer ${api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to_email }] }],
      from: { email: from_email },
      subject,
      content: [{ type: 'text/html', value: html }]
    })
  }],
  mailgun: ({ api_key, from_email, to_email, domain }, subject, html) => [`https://api.mailgun.net/v3/${domain}/messages`, {
    headers: { 'Authorization': 'Basic ' + btoa(`api:${api_key}`) },
    body: new URLSearchParams({ from: from_email, to: to_email, subject, html })
  }],
  postmark: ({ api_key, from_email, to_email }, subject, html) => ['https://api.postmarkapp.com/email', {
    headers: { 'X-Postmark-Server-Token': api_key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ From: from_email, To: to_email, Subject: subject, HtmlBody: html })
  }]
};

function toText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(toText).join(', ');
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function escapeHtml(value) {
  return toText(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function generateEmailHtml(formData, formConfig, submissionId) {
  if (formConfig.email_template) {
    // One pass, so a submitted value can't pull in another placeholder. The two
    // built-ins win over fields of the same name. Empty fields render as nothing.
    return formConfig.email_template.replace(/\{\{([^{}]+)\}\}/g, (_, placeholder) => {
      const key = placeholder.trim();
      if (key === 'submissionId') return submissionId;
      if (key === 'formName') return escapeHtml(formConfig.name);
      return Object.hasOwn(formData, key) ? escapeHtml(formData[key]) : '';
    });
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

  if (!Object.hasOwn(PROVIDERS, emailConfig.provider)) {
    return { success: false, reason: `Unknown email provider: ${emailConfig.provider}` };
  }

  const html = generateEmailHtml(formData, formConfig, submissionId);
  const subject = `New submission from ${formConfig.name}`;
  const [url, request] = PROVIDERS[emailConfig.provider](emailConfig, subject, html);

  try {
    const response = await fetch(url, { method: 'POST', ...request, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      console.error(`Email send failed (${emailConfig.provider}):`, await response.text());
      return { success: false, reason: `Email send failed: ${response.status}` };
    }
    return { success: true };
  } catch (error) {
    console.error('Email error:', error);
    return { success: false, reason: error.message };
  }
}

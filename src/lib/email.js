const PROVIDERS = {
  resend: {
    url: 'https://api.resend.com/emails',
    buildRequest: (apiKey, from, to, subject, html) => ({
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to: [to], subject, html })
    })
  },
  sendgrid: {
    url: 'https://api.sendgrid.com/v3/mail/send',
    buildRequest: (apiKey, from, to, subject, html) => ({
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from },
        subject,
        content: [{ type: 'text/html', value: html }]
      })
    })
  },
  mailgun: {
    buildRequest: (apiKey, from, to, subject, html, domain) => {
      const form = new URLSearchParams();
      form.append('from', from);
      form.append('to', to);
      form.append('subject', subject);
      form.append('html', html);
      return {
        url: `https://api.mailgun.net/v3/${domain}/messages`,
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(`api:${apiKey}`)
        },
        body: form
      };
    }
  },
  postmark: {
    url: 'https://api.postmarkapp.com/email',
    buildRequest: (apiKey, from, to, subject, html) => ({
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ From: from, To: to, Subject: subject, HtmlBody: html })
    })
  }
};

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function generateEmailHtml(formData, formConfig, submissionId) {
  if (formConfig.email_template) {
    let template = formConfig.email_template;
    for (const [key, value] of Object.entries(formData)) {
      template = template.replaceAll(`{{${key}}}`, escapeHtml(value));
    }
    template = template.replaceAll('{{submissionId}}', submissionId);
    template = template.replaceAll('{{formName}}', escapeHtml(formConfig.name));
    return template;
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

  const provider = PROVIDERS[emailConfig.provider];
  if (!provider) {
    return { success: false, reason: `Unknown email provider: ${emailConfig.provider}` };
  }

  const html = generateEmailHtml(formData, formConfig, submissionId);
  const subject = `New submission from ${formConfig.name}`;

  try {
    let url = provider.url;
    const reqInit = provider.buildRequest(
      emailConfig.api_key,
      emailConfig.from_email,
      emailConfig.to_email,
      subject,
      html,
      emailConfig.domain
    );

    if (reqInit.url) {
      url = reqInit.url;
      delete reqInit.url;
    }

    const response = await fetch(url, reqInit);
    if (!response.ok) {
      const text = await response.text();
      console.error(`Email send failed (${emailConfig.provider}):`, text);
      return { success: false, reason: `Email send failed: ${response.status}` };
    }

    return { success: true };
  } catch (error) {
    console.error('Email error:', error);
    return { success: false, reason: error.message };
  }
}

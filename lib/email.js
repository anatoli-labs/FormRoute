const nodemailer = require('nodemailer');

function createEmailTransporter(emailConfig = null) {
  // Use form-specific email config if provided, otherwise fall back to environment variables
  if (emailConfig && emailConfig.smtp_host) {
    return nodemailer.createTransport({
      host: emailConfig.smtp_host,
      port: emailConfig.smtp_port || 587,
      secure: emailConfig.smtp_secure === true || emailConfig.smtp_secure === 'true',
      auth: {
        user: emailConfig.smtp_user,
        pass: emailConfig.smtp_pass
      }
    });
  }
  
  // Fallback to environment variables (for backward compatibility)
  if (!process.env.SMTP_HOST) {
    return null;
  }
  
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function generateEmailTemplate(formData, formConfig, submissionId) {
  if (formConfig.emailTemplate) {
    // Replace template variables
    let template = formConfig.emailTemplate;
    Object.keys(formData).forEach(key => {
      template = template.replace(new RegExp(`{{${key}}}`, 'g'), formData[key] || '');
    });
    template = template.replace(/{{submissionId}}/g, submissionId);
    template = template.replace(/{{formName}}/g, formConfig.name);
    return template;
  }
  
  // Default template
  return `
    <h2>New Form Submission</h2>
    <p><strong>Form:</strong> ${formConfig.name}</p>
    <p><strong>Submission ID:</strong> ${submissionId}</p>
    <h3>Data:</h3>
    <table style="border-collapse: collapse; width: 100%;">
      ${Object.entries(formData).map(([key, value]) => `
        <tr style="border: 1px solid #ddd;">
          <td style="padding: 8px; font-weight: bold; background-color: #f5f5f5;">${key}</td>
          <td style="padding: 8px;">${value}</td>
        </tr>
      `).join('')}
    </table>
    <p><small>Submitted at: ${new Date().toLocaleString()}</small></p>
  `;
}

async function sendEmail(formData, formConfig, submissionId) {
  const emailConfig = formConfig.emailConfig;
  const transporter = createEmailTransporter(emailConfig);
  
  // Determine email addresses to use
  let fromEmail, toEmail;
  
  if (emailConfig) {
    fromEmail = emailConfig.from_email;
    toEmail = emailConfig.to_email;
  } else {
    // Fallback to environment variables
    fromEmail = process.env.FROM_EMAIL;
    toEmail = process.env.TO_EMAIL;
  }
  
  if (!transporter || !toEmail) {
    return { success: false, reason: 'Email not configured - missing SMTP settings or recipient email' };
  }
  
  try {
    const emailTemplate = generateEmailTemplate(formData, formConfig, submissionId);
    
    await transporter.sendMail({
      from: fromEmail,
      to: toEmail,
      subject: `New submission from ${formConfig.name}`,
      html: emailTemplate,
      replyTo: formData.email
    });
    
    return { success: true };
  } catch (error) {
    console.error('Email error:', error);
    return { success: false, reason: error.message };
  }
}

module.exports = {
  sendEmail,
  createEmailTransporter,
  generateEmailTemplate
};
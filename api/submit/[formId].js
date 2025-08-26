const { body, validationResult } = require('express-validator');
const { FormManager } = require('../../lib/forms');
const { createDatabaseAdapter } = require('../../lib/database');
const { sendEmail } = require('../../lib/email');
const { verifySpamProtection } = require('../../lib/spam-protection');
const { authenticate } = require('../../lib/auth');
const { isRateLimited } = require('../../lib/rate-limit');

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || 
         req.headers['x-real-ip'] || 
         req.connection?.remoteAddress || 
         '127.0.0.1';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { formId } = req.query;
    const form = FormManager.getForm(formId);
    
    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }
    
    // Rate limiting
    const clientIP = getClientIP(req);
    const rateLimitResult = isRateLimited(clientIP);
    
    if (rateLimitResult.limited) {
      return res.status(429).json({ 
        error: 'Too many requests',
        retryAfter: rateLimitResult.remainingTime
      });
    }
    
    // Authentication
    const authResult = authenticate(req, form);
    if (!authResult.success) {
      return res.status(authResult.status).json({ error: authResult.error });
    }
    
    // Basic validation
    const formData = req.body;
    if (!formData || Object.keys(formData).length === 0) {
      return res.status(400).json({ error: 'No form data provided' });
    }
    
    // Spam protection
    const spamResult = await verifySpamProtection(formData, form.spamProtection);
    if (!spamResult.success) {
      return res.status(400).json({ error: 'Spam protection failed', reason: spamResult.reason });
    }
    
    // Save to database
    const dbAdapter = createDatabaseAdapter(form.database);
    const metadata = {
      ip: clientIP,
      userAgent: req.headers['user-agent'] || '',
      timestamp: new Date().toISOString()
    };
    
    const saveResult = await dbAdapter.saveSubmission(form, formData, metadata);
    
    if (!saveResult.success) {
      throw new Error('Failed to save submission');
    }
    
    // Send email notification
    await sendEmail(formData, form, saveResult.submissionId);
    
    // Handle redirect vs JSON response
    if (form.redirectUrl && req.headers.accept?.includes('text/html')) {
      return res.redirect(302, form.redirectUrl);
    }
    
    res.json({
      success: true,
      message: form.successMessage,
      submissionId: saveResult.submissionId
    });
    
  } catch (error) {
    console.error('Form submission error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
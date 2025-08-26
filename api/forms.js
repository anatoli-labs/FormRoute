const { body, validationResult } = require('express-validator');
const { FormManager } = require('../lib/forms');

export default async function handler(req, res) {
  if (req.method === 'POST') {
    // Create new form
    try {
      const formData = req.body;
      
      if (!formData.name) {
        return res.status(400).json({ error: 'Form name is required' });
      }
      
      // Capture consent metadata
      const consentMetadata = {
        consentTimestamp: new Date().toISOString(),
        consentIp: req.headers['x-forwarded-for']?.split(',')[0] || 
                   req.headers['x-real-ip'] || 
                   req.connection?.remoteAddress || 
                   '127.0.0.1',
        termsVersion: 'v1.0-2025-08-25',
        privacyVersion: 'v1.0-2025-08-25'
      };
      
      const form = await FormManager.createForm(formData, consentMetadata);
      
      res.json({
        success: true,
        formId: form.id,
        submitUrl: `${req.headers.origin || 'http://localhost:3000'}/api/submit/${form.id}`,
        form: {
          id: form.id,
          name: form.name,
          successMessage: form.successMessage,
          redirectUrl: form.redirectUrl,
          database: form.database,
          spamProtection: form.spamProtection
        }
      });
    } catch (error) {
      console.error('Error creating form:', error);
      res.status(500).json({ error: 'Failed to create form' });
    }
  } else if (req.method === 'GET') {
    // List all forms
    try {
      const allForms = await FormManager.getAllForms();
      res.json({ forms: allForms });
    } catch (error) {
      console.error('Error fetching forms:', error);
      res.status(500).json({ error: 'Failed to fetch forms' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
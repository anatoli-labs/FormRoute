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
      
      const form = FormManager.createForm(formData);
      
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
      const allForms = FormManager.getAllForms();
      res.json({ forms: allForms });
    } catch (error) {
      console.error('Error fetching forms:', error);
      res.status(500).json({ error: 'Failed to fetch forms' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
const { v4: uuidv4 } = require('uuid');

// In-memory form storage for Vercel (could be replaced with external storage)
const forms = new Map();

// For production, you'd want to store forms in a database or external service
// This is a simple in-memory store for demonstration

class FormManager {
  static createForm(formData) {
    const formId = uuidv4();
    const form = {
      id: formId,
      name: formData.name,
      emailTemplate: formData.email_template,
      redirectUrl: formData.redirect_url,
      successMessage: formData.success_message || 'Thank you for your submission!',
      database: formData.database || { type: 'sqlite' },
      spamProtection: formData.spam_protection || { disabled: true },
      apiKey: formData.api_key,
      allowedDomains: formData.allowed_domains || [],
      createdAt: new Date().toISOString()
    };
    
    forms.set(formId, form);
    return form;
  }
  
  static getForm(formId) {
    return forms.get(formId);
  }
  
  static getAllForms() {
    return Array.from(forms.values());
  }
  
  static deleteForm(formId) {
    return forms.delete(formId);
  }
  
  static updateForm(formId, updates) {
    const form = forms.get(formId);
    if (!form) return null;
    
    const updatedForm = { ...form, ...updates };
    forms.set(formId, updatedForm);
    return updatedForm;
  }
}

// Load some example forms for testing
if (forms.size === 0) {
  FormManager.createForm({
    name: 'Contact Form',
    success_message: 'Thank you for contacting us!',
    database: { type: 'sqlite' }
  });
}

module.exports = { FormManager };
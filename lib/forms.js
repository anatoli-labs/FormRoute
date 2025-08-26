const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@libsql/client');

// Initialize Turso client
let tursoClient = null;

function getTursoClient() {
  if (!tursoClient && process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    tursoClient = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN
    });
  }
  return tursoClient;
}

class FormManager {
  static async createForm(formData, metadata = {}) {
    const formId = uuidv4();
    const form = {
      id: formId,
      name: formData.name,
      emailTemplate: formData.email_template,
      redirectUrl: formData.redirect_url,
      successMessage: formData.success_message || 'Thank you for your submission!',
      database: formData.database || { type: 'sqlite' },
      spamProtection: formData.spam_protection || { disabled: true },
      emailConfig: formData.email_config || null,
      apiKey: formData.api_key,
      allowedDomains: formData.allowed_domains || [],
      createdAt: new Date().toISOString(),
      consentTimestamp: metadata.consentTimestamp || new Date().toISOString(),
      consentIp: metadata.consentIp || null,
      termsVersion: metadata.termsVersion || 'v1.0-2025-08-25',
      privacyVersion: metadata.privacyVersion || 'v1.0-2025-08-25'
    };
    
    const client = getTursoClient();
    if (client) {
      // Save to Turso database
      await client.execute({
        sql: `INSERT INTO forms (
          id, name, email_template, redirect_url, success_message, 
          database_config, spam_protection, email_config, api_key, allowed_domains, 
          consent_timestamp, consent_ip, terms_version, privacy_version,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          formId,
          form.name,
          form.emailTemplate || null,
          form.redirectUrl || null,
          form.successMessage,
          JSON.stringify(form.database),
          JSON.stringify(form.spamProtection),
          form.emailConfig ? JSON.stringify(form.emailConfig) : null,
          form.apiKey || null,
          JSON.stringify(form.allowedDomains),
          form.consentTimestamp,
          form.consentIp,
          form.termsVersion,
          form.privacyVersion,
          form.createdAt,
          form.createdAt
        ]
      });
    } else {
      console.warn('Turso not configured, form created in memory only');
    }
    
    return form;
  }
  
  static async getForm(formId) {
    const client = getTursoClient();
    if (client) {
      const result = await client.execute({
        sql: 'SELECT * FROM forms WHERE id = ?',
        args: [formId]
      });
      
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          id: row.id,
          name: row.name,
          emailTemplate: row.email_template,
          redirectUrl: row.redirect_url,
          successMessage: row.success_message,
          database: JSON.parse(row.database_config),
          spamProtection: JSON.parse(row.spam_protection || '{"disabled": true}'),
          emailConfig: row.email_config ? JSON.parse(row.email_config) : null,
          apiKey: row.api_key,
          allowedDomains: JSON.parse(row.allowed_domains || '[]'),
          createdAt: row.created_at,
          consentTimestamp: row.consent_timestamp,
          consentIp: row.consent_ip,
          termsVersion: row.terms_version,
          privacyVersion: row.privacy_version
        };
      }
    }
    return null;
  }
  
  static async getAllForms() {
    const client = getTursoClient();
    if (client) {
      const result = await client.execute('SELECT * FROM forms ORDER BY created_at DESC');
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        emailTemplate: row.email_template,
        redirectUrl: row.redirect_url,
        successMessage: row.success_message,
        database: JSON.parse(row.database_config),
        spamProtection: JSON.parse(row.spam_protection || '{"disabled": true}'),
        emailConfig: row.email_config ? JSON.parse(row.email_config) : null,
        apiKey: row.api_key,
        allowedDomains: JSON.parse(row.allowed_domains || '[]'),
        createdAt: row.created_at,
        consentTimestamp: row.consent_timestamp,
        consentIp: row.consent_ip,
        termsVersion: row.terms_version,
        privacyVersion: row.privacy_version
      }));
    }
    return [];
  }
  
  static async deleteForm(formId) {
    const client = getTursoClient();
    if (client) {
      const result = await client.execute({
        sql: 'DELETE FROM forms WHERE id = ?',
        args: [formId]
      });
      return result.changes > 0;
    }
    return false;
  }
  
  static async updateForm(formId, updates) {
    const client = getTursoClient();
    if (client) {
      // Build update query dynamically based on provided updates
      const updateFields = [];
      const args = [];
      
      if (updates.name) {
        updateFields.push('name = ?');
        args.push(updates.name);
      }
      if (updates.email_template !== undefined) {
        updateFields.push('email_template = ?');
        args.push(updates.email_template);
      }
      if (updates.redirect_url !== undefined) {
        updateFields.push('redirect_url = ?');
        args.push(updates.redirect_url);
      }
      if (updates.success_message) {
        updateFields.push('success_message = ?');
        args.push(updates.success_message);
      }
      if (updates.database) {
        updateFields.push('database_config = ?');
        args.push(JSON.stringify(updates.database));
      }
      if (updates.spam_protection) {
        updateFields.push('spam_protection = ?');
        args.push(JSON.stringify(updates.spam_protection));
      }
      
      updateFields.push('updated_at = ?');
      args.push(new Date().toISOString());
      args.push(formId);
      
      await client.execute({
        sql: `UPDATE forms SET ${updateFields.join(', ')} WHERE id = ?`,
        args
      });
      
      return await FormManager.getForm(formId);
    }
    return null;
  }
}

module.exports = { FormManager };
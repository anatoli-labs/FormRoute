const { v4: uuidv4 } = require('uuid');

class DatabaseAdapter {
  async saveSubmission(formConfig, submissionData, metadata) {
    throw new Error('saveSubmission must be implemented');
  }
  
  async getSubmissions(formId) {
    throw new Error('getSubmissions must be implemented');
  }
}

class SQLiteAdapter extends DatabaseAdapter {
  constructor() {
    super();
    const sqlite3 = require('sqlite3').verbose();
    this.db = new sqlite3.Database('/tmp/formroute.db');
    this.initTables();
  }
  
  initTables() {
    this.db.serialize(() => {
      this.db.run(`CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        form_id TEXT,
        data TEXT,
        ip_address TEXT,
        user_agent TEXT,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
    });
  }
  
  async saveSubmission(formConfig, submissionData, metadata) {
    return new Promise((resolve, reject) => {
      const submissionId = uuidv4();
      this.db.run(
        'INSERT INTO submissions (id, form_id, data, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
        [submissionId, formConfig.id, JSON.stringify(submissionData), metadata.ip, metadata.userAgent],
        function(err) {
          if (err) reject(err);
          else resolve({ success: true, submissionId });
        }
      );
    });
  }
  
  async getSubmissions(formId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM submissions WHERE form_id = ? ORDER BY submitted_at DESC',
        [formId],
        (err, rows) => {
          if (err) reject(err);
          else {
            const submissions = rows.map(row => ({
              ...row,
              data: JSON.parse(row.data)
            }));
            resolve(submissions);
          }
        }
      );
    });
  }
}

class GoogleSheetsAdapter extends DatabaseAdapter {
  constructor(config) {
    super();
    this.sheetId = config.sheetId;
    this.credentials = config.credentials;
  }
  
  async saveSubmission(formConfig, submissionData, metadata) {
    try {
      const { GoogleSpreadsheet } = require('google-spreadsheet');
      const doc = new GoogleSpreadsheet(this.sheetId);
      
      if (this.credentials.type === 'service_account') {
        await doc.useServiceAccountAuth(this.credentials);
      }
      
      await doc.loadInfo();
      const sheet = doc.sheetsByIndex[0];
      
      const row = {
        ...submissionData,
        submitted_at: new Date().toISOString(),
        ip_address: metadata.ip,
        submission_id: uuidv4()
      };
      
      await sheet.addRow(row);
      
      return { success: true, submissionId: row.submission_id };
    } catch (error) {
      throw new Error(`Google Sheets error: ${error.message}`);
    }
  }
  
  async getSubmissions(formId) {
    throw new Error('Google Sheets adapter does not support reading submissions via API');
  }
}

class MakeWebhookAdapter extends DatabaseAdapter {
  constructor(config) {
    super();
    this.webhookUrl = config.webhookUrl;
  }
  
  async saveSubmission(formConfig, submissionData, metadata) {
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formId: formConfig.id,
          data: submissionData,
          metadata,
          timestamp: new Date().toISOString()
        })
      });
      
      if (!response.ok) {
        throw new Error(`Make webhook failed: ${response.status}`);
      }
      
      return { success: true, submissionId: uuidv4() };
    } catch (error) {
      throw new Error(`Make webhook error: ${error.message}`);
    }
  }
  
  async getSubmissions(formId) {
    throw new Error('Make webhook adapter does not support reading submissions');
  }
}

class TursoAdapter extends DatabaseAdapter {
  constructor(config) {
    super();
    this.client = require('@libsql/client').createClient({
      url: config.url,
      authToken: config.authToken
    });
    this.initTables();
  }
  
  async initTables() {
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        form_id TEXT,
        data TEXT,
        ip_address TEXT,
        user_agent TEXT,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
  
  async saveSubmission(formConfig, submissionData, metadata) {
    const submissionId = uuidv4();
    await this.client.execute({
      sql: 'INSERT INTO submissions (id, form_id, data, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
      args: [submissionId, formConfig.id, JSON.stringify(submissionData), metadata.ip, metadata.userAgent]
    });
    
    return { success: true, submissionId };
  }
  
  async getSubmissions(formId) {
    const result = await this.client.execute({
      sql: 'SELECT * FROM submissions WHERE form_id = ? ORDER BY submitted_at DESC',
      args: [formId]
    });
    
    return result.rows.map(row => ({
      id: row.id,
      form_id: row.form_id,
      data: JSON.parse(row.data),
      ip_address: row.ip_address,
      user_agent: row.user_agent,
      submitted_at: row.submitted_at
    }));
  }
}

class WebhookAdapter extends DatabaseAdapter {
  constructor(config) {
    super();
    this.webhookUrl = config.webhookUrl;
    this.headers = config.headers || {};
  }
  
  async saveSubmission(formConfig, submissionData, metadata) {
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...this.headers
        },
        body: JSON.stringify({
          formId: formConfig.id,
          data: submissionData,
          metadata,
          timestamp: new Date().toISOString()
        })
      });
      
      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.status}`);
      }
      
      return { success: true, submissionId: uuidv4() };
    } catch (error) {
      throw new Error(`Webhook error: ${error.message}`);
    }
  }
  
  async getSubmissions(formId) {
    throw new Error('Webhook adapter does not support reading submissions');
  }
}

function createDatabaseAdapter(config) {
  switch (config.type) {
    case 'sqlite':
      return new SQLiteAdapter();
    case 'google_sheets':
      return new GoogleSheetsAdapter(config);
    case 'make_webhook':
      return new MakeWebhookAdapter(config);
    case 'turso':
      return new TursoAdapter(config);
    case 'webhook':
      return new WebhookAdapter(config);
    default:
      return new SQLiteAdapter(); // Default fallback
  }
}

module.exports = {
  DatabaseAdapter,
  SQLiteAdapter,
  GoogleSheetsAdapter,
  MakeWebhookAdapter,
  TursoAdapter,
  WebhookAdapter,
  createDatabaseAdapter
};
export class D1Adapter {
  constructor(db) {
    this.db = db;
  }

  async saveSubmission(formId, data, metadata) {
    const id = crypto.randomUUID();
    await this.db.prepare(
      'INSERT INTO submissions (id, form_id, data, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, formId, JSON.stringify(data), metadata.ip, metadata.userAgent).run();
    return { success: true, submissionId: id };
  }

  async getSubmissions(formId, limit = 100, offset = 0) {
    const result = await this.db.prepare(
      'SELECT * FROM submissions WHERE form_id = ? ORDER BY submitted_at DESC LIMIT ? OFFSET ?'
    ).bind(formId, limit, offset).run();
    return result.results.map(row => ({
      ...row,
      data: JSON.parse(row.data)
    }));
  }
}

export class WebhookAdapter {
  constructor(config) {
    this.webhookUrl = config.webhookUrl;
    this.headers = config.headers || {};
  }

  async saveSubmission(formId, data, metadata) {
    const submissionId = crypto.randomUUID();
    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.headers },
      body: JSON.stringify({
        formId,
        submissionId,
        data,
        metadata,
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status}`);
    }

    return { success: true, submissionId };
  }

  async getSubmissions() {
    throw new Error('Webhook adapter does not support reading submissions');
  }
}

export function createAdapter(config, db) {
  let parsed;
  try {
    parsed = typeof config === 'string' ? JSON.parse(config) : config;
  } catch {
    parsed = { type: 'd1' };
  }

  switch (parsed.type) {
    case 'webhook':
      return new WebhookAdapter(parsed);
    case 'd1':
    default:
      return new D1Adapter(db);
  }
}

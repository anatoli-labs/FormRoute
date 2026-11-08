const WEBHOOK_TIMEOUT_MS = 10_000;

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
}

export class WebhookAdapter {
  constructor(config) {
    // The dashboard used to save the address as url, and those forms still have it there.
    this.webhookUrl = config.webhookUrl || config.url;
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
      }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status}`);
    }

    return { success: true, submissionId };
  }
}

export function createAdapter(config, db) {
  let parsed;
  try {
    parsed = typeof config === 'string' ? JSON.parse(config) : config;
  } catch {
    parsed = { type: 'd1' };
  }

  switch (parsed?.type) {
    case 'webhook':
      return new WebhookAdapter(parsed);
    case 'd1':
    default:
      return new D1Adapter(db);
  }
}

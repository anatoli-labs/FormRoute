import { readJsonObject } from '../lib/body.js';
import { jsonResponse } from '../middleware/cors.js';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const BAD_BODY = { error: 'Request body must be a JSON object' };

function jsonOrUndefined(value) {
  return value === undefined ? undefined : JSON.stringify(value);
}

export async function handleCreateForm(request, env) {
  const body = await readJsonObject(request);
  if (!body) return jsonResponse(BAD_BODY, 400);
  if (!body.name || typeof body.name !== 'string') return jsonResponse({ error: 'Form name is required' }, 400);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO forms (id, name, email_template, redirect_url, success_message, database_config, spam_protection, email_config, api_key, allowed_domains, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    body.name,
    body.email_template || null,
    body.redirect_url || null,
    body.success_message || 'Thank you for your submission!',
    JSON.stringify(body.database || { type: 'd1' }),
    JSON.stringify(body.spam_protection || { disabled: true }),
    body.email_config ? JSON.stringify(body.email_config) : null,
    body.api_key || null,
    JSON.stringify(body.allowed_domains || []),
    now, now
  ).run();

  const submitUrl = new URL(`/api/submit/${id}`, request.url).toString();

  return jsonResponse({
    success: true,
    formId: id,
    submitUrl,
    form: { id, name: body.name, submitUrl }
  }, 201);
}

export async function handleListForms(request, env) {
  const result = await env.DB.prepare(
    'SELECT id, name, created_at, updated_at FROM forms ORDER BY created_at DESC'
  ).all();

  return jsonResponse({ forms: result.results });
}

export async function handleGetForm(request, env) {
  const form = await env.DB.prepare('SELECT * FROM forms WHERE id = ?').bind(request.params.formId).first();
  if (!form) return jsonResponse({ error: 'Form not found' }, 404);

  return jsonResponse({ form });
}

export async function handleUpdateForm(request, env) {
  const body = await readJsonObject(request);
  if (!body) return jsonResponse(BAD_BODY, 400);

  const columns = Object.entries({
    name: body.name,
    email_template: body.email_template,
    redirect_url: body.redirect_url,
    success_message: body.success_message,
    api_key: body.api_key,
    database_config: jsonOrUndefined(body.database),
    spam_protection: jsonOrUndefined(body.spam_protection),
    email_config: body.email_config === undefined ? undefined : (body.email_config ? JSON.stringify(body.email_config) : null),
    allowed_domains: jsonOrUndefined(body.allowed_domains)
  }).filter(([, value]) => value !== undefined);

  if (columns.length === 0) return jsonResponse({ error: 'No fields to update' }, 400);

  const assignments = columns.map(([column]) => `${column} = ?`).join(', ');
  const form = await env.DB.prepare(`UPDATE forms SET ${assignments}, updated_at = ? WHERE id = ? RETURNING *`)
    .bind(...columns.map(([, value]) => value), new Date().toISOString(), request.params.formId)
    .first();
  if (!form) return jsonResponse({ error: 'Form not found' }, 404);

  return jsonResponse({ form });
}

export async function handleDeleteForm(request, env) {
  const { formId } = request.params;
  const [, deletedForm] = await env.DB.batch([
    env.DB.prepare('DELETE FROM submissions WHERE form_id = ?').bind(formId),
    env.DB.prepare('DELETE FROM forms WHERE id = ?').bind(formId)
  ]);
  if (deletedForm.meta.changes === 0) return jsonResponse({ error: 'Form not found' }, 404);

  return jsonResponse({ success: true });
}

export async function handleGetSubmissions(request, env) {
  const { formId } = request.params;
  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit')) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const offset = Math.max(parseInt(url.searchParams.get('offset')) || 0, 0);

  // One round trip to the database for all three.
  const [form, count, page] = await env.DB.batch([
    env.DB.prepare('SELECT id FROM forms WHERE id = ?').bind(formId),
    env.DB.prepare('SELECT COUNT(*) AS total FROM submissions WHERE form_id = ?').bind(formId),
    env.DB.prepare('SELECT * FROM submissions WHERE form_id = ? ORDER BY submitted_at DESC LIMIT ? OFFSET ?').bind(formId, limit, offset)
  ]);
  if (form.results.length === 0) return jsonResponse({ error: 'Form not found' }, 404);

  const submissions = page.results.map(row => ({
    ...row,
    data: JSON.parse(row.data)
  }));

  return jsonResponse({ submissions, total: count.results[0].total, limit, offset });
}

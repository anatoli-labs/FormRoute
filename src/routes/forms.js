import { requireAdmin } from '../lib/auth.js';
import { jsonResponse } from '../middleware/cors.js';

export async function handleCreateForm(request, env) {
  const auth = requireAdmin(request, env);
  if (!auth.success) return jsonResponse({ error: auth.error }, auth.status);

  const body = await request.json();
  if (!body.name) return jsonResponse({ error: 'Form name is required' }, 400);

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
  const auth = requireAdmin(request, env);
  if (!auth.success) return jsonResponse({ error: auth.error }, auth.status);

  const result = await env.DB.prepare(
    'SELECT id, name, created_at, updated_at FROM forms ORDER BY created_at DESC'
  ).all();

  return jsonResponse({ forms: result.results });
}

export async function handleGetForm(request, env, formId) {
  const auth = requireAdmin(request, env);
  if (!auth.success) return jsonResponse({ error: auth.error }, auth.status);

  const form = await env.DB.prepare('SELECT * FROM forms WHERE id = ?').bind(formId).first();
  if (!form) return jsonResponse({ error: 'Form not found' }, 404);

  return jsonResponse({ form });
}

export async function handleUpdateForm(request, env, formId) {
  const auth = requireAdmin(request, env);
  if (!auth.success) return jsonResponse({ error: auth.error }, auth.status);

  const existing = await env.DB.prepare('SELECT id FROM forms WHERE id = ?').bind(formId).first();
  if (!existing) return jsonResponse({ error: 'Form not found' }, 404);

  const body = await request.json();
  const fields = [];
  const values = [];

  const updatable = {
    name: body.name,
    email_template: body.email_template,
    redirect_url: body.redirect_url,
    success_message: body.success_message,
    api_key: body.api_key
  };

  for (const [key, value] of Object.entries(updatable)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (body.database !== undefined) { fields.push('database_config = ?'); values.push(JSON.stringify(body.database)); }
  if (body.spam_protection !== undefined) { fields.push('spam_protection = ?'); values.push(JSON.stringify(body.spam_protection)); }
  if (body.email_config !== undefined) { fields.push('email_config = ?'); values.push(body.email_config ? JSON.stringify(body.email_config) : null); }
  if (body.allowed_domains !== undefined) { fields.push('allowed_domains = ?'); values.push(JSON.stringify(body.allowed_domains)); }

  if (fields.length === 0) return jsonResponse({ error: 'No fields to update' }, 400);

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(formId);

  await env.DB.prepare(`UPDATE forms SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();

  const updated = await env.DB.prepare('SELECT * FROM forms WHERE id = ?').bind(formId).first();
  return jsonResponse({ form: updated });
}

export async function handleDeleteForm(request, env, formId) {
  const auth = requireAdmin(request, env);
  if (!auth.success) return jsonResponse({ error: auth.error }, auth.status);

  const result = await env.DB.prepare('DELETE FROM forms WHERE id = ?').bind(formId).run();
  if (result.meta.changes === 0) return jsonResponse({ error: 'Form not found' }, 404);

  await env.DB.prepare('DELETE FROM submissions WHERE form_id = ?').bind(formId).run();

  return jsonResponse({ success: true });
}

export async function handleGetSubmissions(request, env, formId) {
  const auth = requireAdmin(request, env);
  if (!auth.success) return jsonResponse({ error: auth.error }, auth.status);

  const form = await env.DB.prepare('SELECT id FROM forms WHERE id = ?').bind(formId).first();
  if (!form) return jsonResponse({ error: 'Form not found' }, 404);

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit')) || 100, 500);
  const offset = parseInt(url.searchParams.get('offset')) || 0;

  const result = await env.DB.prepare(
    'SELECT * FROM submissions WHERE form_id = ? ORDER BY submitted_at DESC LIMIT ? OFFSET ?'
  ).bind(formId, limit, offset).all();

  const submissions = result.results.map(row => ({
    ...row,
    data: JSON.parse(row.data)
  }));

  return jsonResponse({ submissions, total: submissions.length, limit, offset });
}

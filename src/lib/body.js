export function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try { return typeof str === 'string' ? JSON.parse(str) : str; } catch { return fallback; }
}

// Returns the parsed object, or null when the body is malformed or isn't a JSON object.
export async function readJsonObject(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

// Repeated fields (checkbox groups, multi-selects) become arrays. Files aren't
// stored, so an upload is recorded by its name.
async function readFormFields(request) {
  try {
    const formData = await request.formData();
    const fields = {};
    for (const key of new Set(formData.keys())) {
      const values = formData.getAll(key).map((value) => (value instanceof File ? value.name : value));
      fields[key] = values.length > 1 ? values : values[0];
    }
    return fields;
  } catch {
    return null;
  }
}

export function readSubmission(request) {
  const contentType = request.headers.get('Content-Type') || '';
  const isForm = contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data');
  return isForm ? readFormFields(request) : readJsonObject(request);
}

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

// Counts the bytes that actually arrive, so a body sent without Content-Length
// (chunked, or HTTP/2) can't get past the cap. Returns null as soon as the body
// goes over, without reading the rest.
export async function readBody(request, maxBytes) {
  const chunks = [];
  if (request.body) {
    const reader = request.body.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  }
  return new Blob(chunks);
}

// Parses a body readBody already buffered. A Response over those bytes has the
// same json() and formData() parsers the request had.
export function readSubmission(request, body) {
  const contentType = request.headers.get('Content-Type') || '';
  const isForm = contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data');
  const buffered = new Response(body, { headers: { 'Content-Type': contentType } });
  return isForm ? readFormFields(buffered) : readJsonObject(buffered);
}

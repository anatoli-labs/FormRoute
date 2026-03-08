import { AutoRouter } from 'itty-router';
import { handleOptions, jsonResponse } from './middleware/cors.js';
import { handleCreateForm, handleListForms, handleGetForm, handleUpdateForm, handleDeleteForm, handleGetSubmissions } from './routes/forms.js';
import { handleSubmit } from './routes/submit.js';

const router = AutoRouter({
  before: [(request) => {
    if (request.method === 'OPTIONS') return handleOptions();
  }],
  catch: (error) => {
    console.error('Unhandled error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  },
  finally: [(response) => {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key'
    };
    for (const [key, value] of Object.entries(corsHeaders)) {
      if (!response.headers.has(key)) {
        response.headers.set(key, value);
      }
    }
    return response;
  }]
});

// Public submission endpoint
router.post('/api/submit/:formId', (request, env) => handleSubmit(request, env, request.params.formId));

// Admin form management
router.post('/api/forms', (request, env) => handleCreateForm(request, env));
router.get('/api/forms', (request, env) => handleListForms(request, env));
router.get('/api/forms/:formId', (request, env) => handleGetForm(request, env, request.params.formId));
router.put('/api/forms/:formId', (request, env) => handleUpdateForm(request, env, request.params.formId));
router.delete('/api/forms/:formId', (request, env) => handleDeleteForm(request, env, request.params.formId));

// Submissions
router.get('/api/forms/:formId/submissions', (request, env) => handleGetSubmissions(request, env, request.params.formId));

// Health check
router.get('/api/health', () => jsonResponse({ status: 'ok', timestamp: new Date().toISOString() }));

// Catch-all 404
router.all('*', () => jsonResponse({ error: 'Not found' }, 404));

export default router;

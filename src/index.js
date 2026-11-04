import { AutoRouter } from 'itty-router';
import { addCorsHeaders, handlePreflight, jsonResponse } from './middleware/cors.js';
import { requireAdmin } from './lib/auth.js';
import { handleCreateForm, handleListForms, handleGetForm, handleUpdateForm, handleDeleteForm, handleGetSubmissions } from './routes/forms.js';
import { handleSubmit } from './routes/submit.js';

const router = AutoRouter({
  before: [handlePreflight],
  catch: (error) => {
    console.error('Unhandled error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500);
  },
  finally: [addCorsHeaders]
});

// Public submission endpoint
router.post('/api/submit/:formId', handleSubmit);

// Admin endpoints: requireAdmin only returns a response when auth fails
router.all('/api/forms/*', requireAdmin);
router.post('/api/forms', handleCreateForm);
router.get('/api/forms', handleListForms);
router.get('/api/forms/:formId', handleGetForm);
router.put('/api/forms/:formId', handleUpdateForm);
router.delete('/api/forms/:formId', handleDeleteForm);
router.get('/api/forms/:formId/submissions', handleGetSubmissions);

// Health check
router.get('/api/health', () => jsonResponse({ status: 'ok', timestamp: new Date().toISOString() }));

// Catch-all 404
router.all('*', () => jsonResponse({ error: 'Not found' }, 404));

export default router;

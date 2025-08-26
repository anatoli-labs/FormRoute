const { FormManager } = require('../../../lib/forms');
const { createDatabaseAdapter } = require('../../../lib/database');
const { authenticate } = require('../../../lib/auth');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { formId } = req.query;
    const form = FormManager.getForm(formId);
    
    if (!form) {
      return res.status(404).json({ error: 'Form not found' });
    }
    
    // Authentication required for viewing submissions
    const authResult = authenticate(req, form);
    if (!authResult.success) {
      return res.status(authResult.status).json({ error: authResult.error });
    }
    
    // Get submissions from database
    const dbAdapter = createDatabaseAdapter(form.database);
    const submissions = await dbAdapter.getSubmissions(formId);
    
    res.json({ submissions });
    
  } catch (error) {
    console.error('Error fetching submissions:', error);
    
    if (error.message.includes('does not support reading')) {
      return res.status(400).json({ 
        error: 'This database adapter does not support reading submissions',
        suggestion: 'Use SQLite or Turso adapter to view submissions via API'
      });
    }
    
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
}
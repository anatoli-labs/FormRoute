require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const nodemailer = require('nodemailer');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const submitLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: 'Too many form submissions, please try again later.'
});

const db = new sqlite3.Database('./formroute.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS forms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email_template TEXT,
    redirect_url TEXT,
    success_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    form_id TEXT,
    data TEXT,
    ip_address TEXT,
    user_agent TEXT,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (form_id) REFERENCES forms (id)
  )`);
});

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

app.post('/submit/:formId', submitLimit, [
  body('email').optional().isEmail().normalizeEmail(),
  body('name').optional().trim().escape(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid form data', details: errors.array() });
    }

    const { formId } = req.params;
    const formData = req.body;
    const submissionId = uuidv4();
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    db.get('SELECT * FROM forms WHERE id = ?', [formId], async (err, form) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }

      if (!form) {
        return res.status(404).json({ error: 'Form not found' });
      }

      db.run(
        'INSERT INTO submissions (id, form_id, data, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
        [submissionId, formId, JSON.stringify(formData), ipAddress, userAgent],
        async function(err) {
          if (err) {
            console.error('Error saving submission:', err);
            return res.status(500).json({ error: 'Failed to save submission' });
          }

          if (process.env.SMTP_HOST && formData.email) {
            try {
              const emailTemplate = form.email_template || `
                <h2>New Form Submission</h2>
                <p><strong>Form:</strong> ${form.name}</p>
                <p><strong>Submission ID:</strong> ${submissionId}</p>
                <h3>Data:</h3>
                <pre>${JSON.stringify(formData, null, 2)}</pre>
              `;

              await transporter.sendMail({
                from: process.env.FROM_EMAIL,
                to: process.env.TO_EMAIL || formData.email,
                subject: `New submission from ${form.name}`,
                html: emailTemplate
              });
            } catch (emailError) {
              console.error('Email error:', emailError);
            }
          }

          if (form.redirect_url) {
            return res.redirect(form.redirect_url);
          }

          res.json({
            success: true,
            message: form.success_message || 'Form submitted successfully',
            submissionId
          });
        }
      );
    });
  } catch (error) {
    console.error('Error processing form submission:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/forms', [
  body('name').notEmpty().trim().escape(),
  body('email_template').optional().trim(),
  body('redirect_url').optional().isURL(),
  body('success_message').optional().trim()
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Invalid form data', details: errors.array() });
  }

  const formId = uuidv4();
  const { name, email_template, redirect_url, success_message } = req.body;

  db.run(
    'INSERT INTO forms (id, name, email_template, redirect_url, success_message) VALUES (?, ?, ?, ?, ?)',
    [formId, name, email_template, redirect_url, success_message],
    function(err) {
      if (err) {
        console.error('Error creating form:', err);
        return res.status(500).json({ error: 'Failed to create form' });
      }

      res.json({
        success: true,
        formId,
        submitUrl: `${req.protocol}://${req.get('host')}/submit/${formId}`
      });
    }
  );
});

app.get('/forms/:formId/submissions', (req, res) => {
  const { formId } = req.params;
  
  db.all(
    'SELECT * FROM submissions WHERE form_id = ? ORDER BY submitted_at DESC',
    [formId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching submissions:', err);
        return res.status(500).json({ error: 'Failed to fetch submissions' });
      }

      const submissions = rows.map(row => ({
        ...row,
        data: JSON.parse(row.data)
      }));

      res.json({ submissions });
    }
  );
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`FormRoute server running on port ${PORT}`);
});
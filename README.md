# FormRoute

A privacy-first serverless form handling service that processes form submissions, sends email notifications, and routes data to your choice of external services. Perfect for static websites that need form functionality without storing user data.

## Features

- ✅ **Privacy-First** - No form data storage, pass-through architecture only
- ✅ **Per-Form SMTP** - Each form can use its own email configuration
- ✅ **Web Dashboard** - Easy form creation and management via web interface
- ✅ **Multiple Integrations** - Route to Google Sheets, Make.com, Zapier, or custom webhooks
- ✅ **Spam Protection** - reCAPTCHA, hCaptcha, Turnstile, honeypot fields
- ✅ **Serverless** - Deploy to Vercel, Netlify, or any serverless platform
- ✅ **Rate Limiting** - Built-in protection against abuse
- ✅ **Legal Compliance** - GDPR-ready with consent tracking and privacy policies

## Quick Start

### Option 1: Deploy to Vercel (Recommended)

1. **One-click deploy:**
   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/anatoli-labs/FormRoute)

2. **Or manual deployment:**
   ```bash
   npm install -g vercel
   vercel
   ```

3. **Access dashboard:**
   Visit your Vercel URL at `/dashboard` to create and manage forms

### Option 2: Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start development:**
   ```bash
   vercel dev
   ```

## Usage

### Option 1: Web Dashboard (Recommended)

1. **Visit the Dashboard:**
   - Go to `https://your-app.vercel.app/dashboard`
   - Fill out the form creation wizard
   - Configure SMTP settings for email notifications
   - Set up data routing (Google Sheets, Make.com, etc.)
   - Accept Terms of Service and Privacy Policy

2. **Get Your Form URL:**
   - Dashboard will provide your unique form submission URL
   - Copy the URL for use in your HTML forms

### Option 2: API (Advanced)

**POST** `/api/forms`

```json
{
  "name": "Contact Form",
  "email_template": "<h2>New Contact</h2><p>Name: {{name}}</p><p>Email: {{email}}</p>",
  "redirect_url": "https://yoursite.com/thank-you",
  "success_message": "Thank you for your message!",
  "email_config": {
    "smtp_host": "mail.smtp2go.com",
    "smtp_port": 587,
    "smtp_secure": true,
    "smtp_user": "your-username",
    "smtp_pass": "your-password",
    "from_email": "noreply@yoursite.com",
    "to_email": "admin@yoursite.com"
  },
  "database": {
    "type": "make_webhook",
    "webhookUrl": "https://hook.us1.make.com/your-webhook-url"
  },
  "spam_protection": {
    "captcha": {
      "type": "recaptcha_v3",
      "secretKey": "your-secret-key",
      "minScore": 0.5
    },
    "honeypot": {
      "field": "_gotcha"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "formId": "550e8400-e29b-41d4-a716-446655440000",
  "submitUrl": "https://your-app.vercel.app/api/submit/550e8400-e29b-41d4-a716-446655440000"
}
```

### HTML Form Integration

```html
<form action="https://your-app.vercel.app/api/submit/YOUR-FORM-ID" method="POST">
    <input type="text" name="name" placeholder="Your Name" required>
    <input type="email" name="email" placeholder="Your Email" required>
    <textarea name="message" placeholder="Your Message" required></textarea>
    
    <!-- Honeypot field (hidden) -->
    <input type="text" name="_gotcha" style="display:none">
    
    <!-- reCAPTCHA (if enabled) -->
    <div class="g-recaptcha" data-sitekey="your-site-key"></div>
    
    <button type="submit">Send Message</button>
</form>
```

## Data Routing Options

FormRoute doesn't store your form submissions - instead, it routes them to external services you control.

### Make.com Webhook (Recommended)
Route submissions to Make.com for powerful automation:
```json
{
  "database": {
    "type": "make_webhook",
    "webhookUrl": "https://hook.us1.make.com/your-webhook-url"
  }
}
```

### Google Sheets
Send submissions to Google Sheets:
```json
{
  "database": {
    "type": "google_sheets",
    "sheetId": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
    "credentials": {
      "type": "service_account",
      "client_email": "your-service@project.iam.gserviceaccount.com",
      "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
    }
  }
}
```

### Turso Database
Store in Turso (SQLite in the cloud) for later API access:
```json
{
  "database": {
    "type": "turso",
    "url": "libsql://your-db.turso.io",
    "authToken": "your-turso-token"
  }
}
```

### Custom Webhook (Client-Side Only)
Send to any API with your own credentials:

**Via Dashboard:** Select "Custom Webhook" and configure URL + headers. Your credentials are encoded in the form URL and never stored in our database.

**Manual Configuration:** Developers can add webhook functionality to any form:
```javascript
// Create webhook config
const webhookConfig = {
  type: "webhook",
  webhookUrl: "https://your-api.com/webhooks/forms",
  headers: {
    "Authorization": "Bearer your-token"
  }
};

// Encode and append to any FormRoute URL
const encoded = btoa(JSON.stringify(webhookConfig));
const formUrl = `https://form-route.vercel.app/api/submit/form-id?webhook=${encodeURIComponent(encoded)}`;
```

**Privacy:** Webhook credentials are never stored in FormRoute's database - they're encoded in your form URLs only.

## Email Configuration

### Per-Form SMTP
Each form can have its own email settings:

```json
{
  "email_config": {
    "smtp_host": "smtp.gmail.com",
    "smtp_port": 587,
    "smtp_secure": true,
    "smtp_user": "your-email@gmail.com",
    "smtp_pass": "your-app-password",
    "from_email": "noreply@yoursite.com",
    "to_email": "admin@yoursite.com"
  }
}
```

### Popular SMTP Providers
- **Gmail**: `smtp.gmail.com:587` (use app passwords)
- **SMTP2GO**: `mail.smtp2go.com:587`
- **SendGrid**: `smtp.sendgrid.net:587`
- **Mailgun**: `smtp.mailgun.org:587`

## Authentication & Security

### Spam Protection
Multiple CAPTCHA options:
```json
{
  "spam_protection": {
    "captcha": {
      "type": "recaptcha_v3",        // or "recaptcha_v2", "hcaptcha", "turnstile"
      "secretKey": "your-secret-key",
      "minScore": 0.5               // For reCAPTCHA v3 only
    },
    "honeypot": {
      "field": "_gotcha"            // Hidden field name
    }
  }
}
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/forms` | Create a new form |
| POST | `/api/submit/{formId}` | Submit form data |

## Deployment

### Vercel (Recommended)
```bash
npm install -g vercel
vercel
```

### Environment Variables
Only needed for form storage (not email - that's per-form):
```env
# Form storage (required)
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-turso-token
```

### Database Setup
1. Create a Turso database: `turso db create formroute`
2. Get connection details: `turso db show formroute`
3. Create auth token: `turso db tokens create formroute`
4. Run the schema:
```sql
CREATE TABLE forms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email_template TEXT,
  redirect_url TEXT,
  success_message TEXT DEFAULT 'Thank you for your submission!',
  database_config TEXT NOT NULL,
  spam_protection TEXT,
  email_config TEXT,
  api_key TEXT,
  allowed_domains TEXT,
  consent_timestamp TEXT,
  consent_ip TEXT,
  terms_version TEXT DEFAULT 'v1.0-2025-08-25',
  privacy_version TEXT DEFAULT 'v1.0-2025-08-25',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Security & Privacy

### Security Features
- Rate limiting (10 submissions per 15 minutes per IP)
- Input validation and sanitization
- Helmet.js security headers
- CORS protection
- SQL injection prevention
- Per-form SMTP credential encryption

### Privacy-First Architecture
- **No submission data storage** - FormRoute only stores form configurations
- **Pass-through processing** - Data is routed to your chosen services only
- **GDPR compliance** - Consent tracking and privacy policies included
- **User control** - Users choose where their data goes (Make.com, Google Sheets, etc.)

### Legal Compliance
- Terms of Service and Privacy Policy included
- Consent tracking for form creation
- Audit trail for compliance requirements
- Right to deletion (users can delete their forms)

## Contributing

FormRoute is open source! Visit our [GitHub repository](https://github.com/anatoli-labs/FormRoute) to contribute.

## License

ISC

---

**Built with ❤️ by [Anatoli Labs](https://anatolilabs.com)**
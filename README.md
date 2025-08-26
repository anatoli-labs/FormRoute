# FormRoute

A serverless form handling service that processes form submissions, sends email notifications, and stores data in your choice of database. Perfect for static websites that need form functionality.

## Features

- ✅ **Serverless** - Deploy to Vercel, Netlify, or any serverless platform
- ✅ **Multiple Databases** - SQLite, Google Sheets, Turso, Make.com, or custom webhooks
- ✅ **Spam Protection** - reCAPTCHA, hCaptcha, Turnstile, honeypot fields
- ✅ **Authentication** - API keys, domain restrictions, or public forms
- ✅ **Email Notifications** - Customizable HTML templates
- ✅ **Rate Limiting** - Built-in protection against abuse
- ✅ **Zero Config** - Works out of the box with SQLite, configure what you need

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
   Visit your Vercel URL - dashboard loads automatically

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

### 1. Create a Form

**POST** `/api/forms`

```json
{
  "name": "Contact Form",
  "email_template": "<h2>New Contact</h2><p>Name: {{name}}</p><p>Email: {{email}}</p>",
  "redirect_url": "https://yoursite.com/thank-you",
  "success_message": "Thank you for your message!",
  "database": {
    "type": "sqlite"
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

### 2. Use in Your HTML

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

### 3. View Submissions

**GET** `/api/forms/{formId}/submissions`

Returns all submissions for a specific form (requires API key if form is protected).

## Database Options

### SQLite (Default)
Works everywhere, no configuration needed:
```json
{
  "database": { "type": "sqlite" }
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

### Make.com Webhook
Trigger Make scenarios:
```json
{
  "database": {
    "type": "make_webhook",
    "webhookUrl": "https://hook.us1.make.com/your-webhook-url"
  }
}
```

### Turso (SQLite in the Cloud)
Scalable SQLite database:
```json
{
  "database": {
    "type": "turso",
    "url": "libsql://your-db.turso.io",
    "authToken": "your-turso-token"
  }
}
```

### Custom Webhook
Send to any API:
```json
{
  "database": {
    "type": "webhook",
    "webhookUrl": "https://your-api.com/webhooks/forms",
    "headers": {
      "Authorization": "Bearer your-token"
    }
  }
}
```

## Authentication & Security

### API Keys
Protect form creation/viewing with API keys:
```json
{
  "name": "Private Form",
  "api_key": "your-secret-key",
  "allowed_domains": ["yoursite.com", "www.yoursite.com"]
}
```

Access with API key:
```bash
curl -H "X-API-Key: your-secret-key" https://your-app.vercel.app/api/forms/form-id/submissions
```

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
| GET | `/api/forms/{formId}/submissions` | Get form submissions |

## Deployment

### Vercel (Recommended)
```bash
npm install -g vercel
vercel
```

### Environment Variables
Set in Vercel dashboard or `.env`:
```env
# Email (optional)
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
FROM_EMAIL=noreply@yoursite.com
TO_EMAIL=admin@yoursite.com

# Database credentials (as needed)
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token
GOOGLE_SERVICE_ACCOUNT_EMAIL=service@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
```

## Security Features

- Rate limiting (10 submissions per 15 minutes per IP)
- Input validation and sanitization
- Helmet.js security headers
- CORS protection
- SQL injection prevention

## License

ISC
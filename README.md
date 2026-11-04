# FormRoute

A serverless form handling service built on Cloudflare Workers. Accept form submissions, send email notifications, and route data to webhooks, like Formspree but self-hosted.

## Features

- **Cloudflare Workers**: runs at the edge in 300+ locations, no cold starts
- **D1 Database**: form config and submission storage at the edge
- **REST Email Providers**: Resend, SendGrid, Mailgun, Postmark (per-form config)
- **Spam Protection**: reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile, honeypot
- **Rate Limiting**: Cloudflare's rate limiting binding, 10 submissions per IP per minute
- **Admin Dashboard**: API key-protected web UI for form management
- **Custom Webhooks**: route submissions to any API endpoint

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) comes with `npm install`; run it with `npx wrangler`
- Cloudflare account

### Setup

```bash
# Clone and install
git clone https://github.com/anatoli-labs/FormRoute.git
cd FormRoute
npm install

# Authenticate with Cloudflare
npx wrangler login

# Create D1 database
npx wrangler d1 create formroute
# Copy the database_id from output into wrangler.toml

# Set admin API key
echo 'ADMIN_API_KEY=your-secure-key-here' > .dev.vars

# Run migrations
npm run db:migrate

# Start dev server
npm run dev
```

### Deploy

```bash
# Run migrations on production D1
npm run db:migrate:prod

# Set production admin key
npx wrangler secret put ADMIN_API_KEY

# Deploy
npm run deploy
```

## Usage

### Dashboard

Visit `https://your-worker.workers.dev/dashboard` and enter your admin API key.

From the dashboard you can:
- Create forms with email notifications and spam protection
- View existing forms and their submission URLs
- Delete forms

### API

All admin endpoints require `Authorization: Bearer <ADMIN_API_KEY>`.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/forms` | Admin | Create form |
| `GET` | `/api/forms` | Admin | List forms |
| `GET` | `/api/forms/:id` | Admin | Get form |
| `PUT` | `/api/forms/:id` | Admin | Update form |
| `DELETE` | `/api/forms/:id` | Admin | Delete form |
| `GET` | `/api/forms/:id/submissions` | Admin | View submissions |
| `POST` | `/api/submit/:id` | Public | Submit form data |
| `GET` | `/api/health` | None | Health check |

The submissions endpoint takes `limit` (default 100, up to 500) and `offset`, and returns `total` for the whole form.

### Create a Form

```bash
curl -X POST https://your-worker.workers.dev/api/forms \
  -H "Authorization: Bearer your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Contact Form",
    "redirect_url": "https://yoursite.com/thank-you",
    "success_message": "Thanks for reaching out!",
    "email_config": {
      "provider": "resend",
      "api_key": "re_xxxx",
      "from_email": "noreply@yoursite.com",
      "to_email": "admin@yoursite.com"
    }
  }'
```

### HTML Form Integration

```html
<form action="https://your-worker.workers.dev/api/submit/YOUR-FORM-ID" method="POST">
  <input type="text" name="name" required>
  <input type="email" name="email" required>
  <textarea name="message" required></textarea>
  <input type="text" name="_gotcha" style="display:none">
  <button type="submit">Send</button>
</form>
```

## Configuration

### Email Providers

Each form can use its own email provider. Supported providers:

| Provider | Config |
|----------|--------|
| Resend | `{ "provider": "resend", "api_key": "re_xxx", "from_email": "...", "to_email": "..." }` |
| SendGrid | `{ "provider": "sendgrid", "api_key": "SG.xxx", "from_email": "...", "to_email": "..." }` |
| Mailgun | `{ "provider": "mailgun", "api_key": "xxx", "domain": "mg.example.com", "from_email": "...", "to_email": "..." }` |
| Postmark | `{ "provider": "postmark", "api_key": "xxx", "from_email": "...", "to_email": "..." }` |

### Data Routing

- **D1 (default)**: stored in Cloudflare D1, readable via submissions API
- **Webhook**: POST to any URL with optional custom headers

```json
{
  "database": {
    "type": "webhook",
    "webhookUrl": "https://your-api.com/webhooks/forms",
    "headers": { "Authorization": "Bearer token" }
  }
}
```

### Spam Protection

```json
{
  "spam_protection": {
    "captcha": {
      "type": "turnstile",
      "secretKey": "0x...",
      "field": "cf-turnstile-response"
    },
    "honeypot": { "field": "_gotcha" }
  }
}
```

Supported CAPTCHA types: `recaptcha_v2`, `recaptcha_v3`, `hcaptcha`, `turnstile`

### Per-Form Security

Forms can optionally require an API key and restrict allowed domains:

```json
{
  "api_key": "form-specific-key",
  "allowed_domains": ["example.com", "www.example.com"]
}
```

## Project Structure

```
formroute/
├── src/
│   ├── index.js              # Worker entry point + router
│   ├── routes/
│   │   ├── forms.js          # Admin CRUD endpoints
│   │   └── submit.js         # Public submission endpoint
│   ├── lib/
│   │   ├── auth.js           # Admin + per-form authentication
│   │   ├── body.js           # Request body parsing
│   │   ├── database.js       # D1 + webhook adapters
│   │   ├── email.js          # REST email provider abstraction
│   │   └── spam.js           # CAPTCHA + honeypot verification
│   └── middleware/
│       └── cors.js           # CORS + response helpers
├── public/
│   └── dashboard.html        # Admin dashboard
├── migrations/
│   ├── 0001_init.sql         # D1 schema
│   └── 0002_submissions_form_date_index.sql
├── test/                     # Vitest suite, runs in the Workers runtime
├── wrangler.toml             # Workers config
└── package.json
```

## Tests

```bash
npm test
```

The suite runs inside the Workers runtime against a local D1 database, so nothing touches your Cloudflare account.

## License

ISC

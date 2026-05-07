# GTM Live Dashboard

Real-time dashboard for Go-To-Market teams. Ingests Clay webhooks and polls the Instantly API to show email and call activity live.

## Features

- **Real-time updates** via WebSocket (Socket.io)
- **Clay webhook receiver** — email sent/opened/replied/bounced + call logs with recordings
- **Instantly API polling** — campaign analytics, email stats, auto-refreshes every 30 s
- **Live activity feed** with event icons and source badges
- **Email stats**: Sent, Opened, Replied, Bounced, Clicked, Unsubscribed with rates
- **Call stats**: Total, Connected, Voicemail, No Answer with connection rate
- **Charts**: Email breakdown donut, call outcomes donut, live email timeline
- **Campaigns table** with per-campaign analytics
- **Call log table** with disposition, duration, recording playback link, notes

## Quick Start

```bash
cd dashboard
cp .env.example .env
# Edit .env and add your INSTANTLY_API_KEY
npm install
npm start
# Open http://localhost:3000
```

Click **Load Demo** to populate the dashboard with sample data instantly.

## Clay Webhook Setup

1. In Clay, go to your table → Webhooks → Add Webhook
2. Set the URL to: `http://your-server:3000/webhook/clay`
3. (Optional) Set a secret and add it as `CLAY_WEBHOOK_SECRET` in `.env`

Clay webhook payload is flexible — the server auto-detects event type from `event_type`, `type`, or `action` fields.

### Supported Clay event types
| Clay field value | Dashboard effect |
|-----------------|-----------------|
| `email_sent` / `sent` | Increments Sent |
| `reply` / `responded` | Increments Replied |
| `bounce` | Increments Bounced |
| `open` | Increments Opened |
| `unsubscribe` / `opt_out` | Increments Unsubscribed |
| `call` (any) | Adds to Call Log |

### Call payload fields
```json
{
  "event_type": "call",
  "disposition": "Connected",
  "duration": 312,
  "recording_url": "https://...",
  "notes": "Interested in Q3",
  "agent": "Alex Johnson",
  "contact": { "first_name": "Sarah", "last_name": "Chen", "phone": "+1-415-555-0101" }
}
```

## Instantly API Setup

1. Go to [Instantly Settings → Integrations](https://app.instantly.ai/app/settings/integrations)
2. Copy your API key
3. Add to `.env` as `INSTANTLY_API_KEY`

The server polls `/analytics/overview` and `/campaign/list` every 30 seconds.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `INSTANTLY_API_KEY` | — | Instantly.ai API key |
| `CLAY_WEBHOOK_SECRET` | — | Optional HMAC secret for Clay |
| `POLL_INTERVAL_MS` | `30000` | Instantly poll interval (ms) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhook/clay` | Clay webhook receiver |
| `GET`  | `/api/state` | Full dashboard state snapshot |
| `GET`  | `/api/call-logs` | Call log list (`?limit=N`) |
| `GET`  | `/api/activity` | Activity feed (`?limit=N`) |
| `POST` | `/api/refresh` | Force Instantly poll |
| `POST` | `/api/demo` | Load demo data |

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-memory state ───────────────────────────────────────────────────────────

const state = {
  emailStats: {
    sent: 0,
    opened: 0,
    replied: 0,
    bounced: 0,
    unsubscribed: 0,
    clicked: 0,
    openRate: 0,
    replyRate: 0,
    bounceRate: 0
  },
  callStats: {
    total: 0,
    connected: 0,
    voicemail: 0,
    noAnswer: 0,
    attempted: 0,
    connectionRate: 0
  },
  campaigns: [],
  callLogs: [],
  activityFeed: [],
  lastUpdated: null
};

const MAX_FEED_ITEMS = 100;
const MAX_CALL_LOGS = 200;

function addActivity(type, source, message, data = {}) {
  const item = {
    id: Date.now() + Math.random().toString(36).slice(2),
    type,       // 'email_sent' | 'email_reply' | 'email_bounce' | 'email_open' |
                // 'call_connected' | 'call_voicemail' | 'call_attempt' | 'system'
    source,     // 'instantly' | 'clay' | 'system'
    message,
    data,
    timestamp: new Date().toISOString()
  };
  state.activityFeed.unshift(item);
  if (state.activityFeed.length > MAX_FEED_ITEMS) {
    state.activityFeed.pop();
  }
  io.emit('activity', item);
  return item;
}

function recomputeRates() {
  const { sent, opened, replied, bounced } = state.emailStats;
  state.emailStats.openRate = sent > 0 ? +((opened / sent) * 100).toFixed(1) : 0;
  state.emailStats.replyRate = sent > 0 ? +((replied / sent) * 100).toFixed(1) : 0;
  state.emailStats.bounceRate = sent > 0 ? +((bounced / sent) * 100).toFixed(1) : 0;

  const { total, connected } = state.callStats;
  state.callStats.connectionRate = total > 0 ? +((connected / total) * 100).toFixed(1) : 0;
}

// ─── Clay Webhook Handler ──────────────────────────────────────────────────────

function verifyClaySignature(req) {
  const secret = process.env.CLAY_WEBHOOK_SECRET;
  if (!secret) return true; // skip if not configured
  const sig = req.headers['x-clay-signature'] || req.headers['x-webhook-signature'];
  if (!sig) return false;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(req.body));
  const expected = 'sha256=' + hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

app.post('/webhook/clay', (req, res) => {
  if (!verifyClaySignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = req.body;
  // Clay can send single events or arrays
  const events = Array.isArray(payload) ? payload : [payload];

  events.forEach(event => processClaySEvent(event));
  res.json({ received: true, count: events.length });
});

function processClaySEvent(event) {
  const eventType = (event.event_type || event.type || event.action || '').toLowerCase();
  const contact = event.contact || event.lead || event.person || {};
  const name = contact.first_name
    ? `${contact.first_name} ${contact.last_name || ''}`.trim()
    : contact.name || contact.email || 'Unknown';

  if (eventType.includes('email_sent') || eventType.includes('sent')) {
    state.emailStats.sent++;
    recomputeRates();
    addActivity('email_sent', 'clay', `Email sent to ${name}`, { contact, raw: event });
    io.emit('stats_update', { emailStats: state.emailStats });
  } else if (eventType.includes('reply') || eventType.includes('responded')) {
    state.emailStats.replied++;
    recomputeRates();
    addActivity('email_reply', 'clay', `Reply received from ${name}`, { contact, raw: event });
    io.emit('stats_update', { emailStats: state.emailStats });
  } else if (eventType.includes('bounce')) {
    state.emailStats.bounced++;
    recomputeRates();
    addActivity('email_bounce', 'clay', `Email bounced for ${name}`, { contact, raw: event });
    io.emit('stats_update', { emailStats: state.emailStats });
  } else if (eventType.includes('open')) {
    state.emailStats.opened++;
    recomputeRates();
    addActivity('email_open', 'clay', `Email opened by ${name}`, { contact, raw: event });
    io.emit('stats_update', { emailStats: state.emailStats });
  } else if (eventType.includes('unsubscribe') || eventType.includes('opt_out')) {
    state.emailStats.unsubscribed++;
    recomputeRates();
    addActivity('unsubscribe', 'clay', `${name} unsubscribed`, { contact, raw: event });
    io.emit('stats_update', { emailStats: state.emailStats });
  } else if (eventType.includes('call')) {
    processCallEvent(event, 'clay');
  } else {
    // Generic Clay event
    addActivity('system', 'clay', `Clay event: ${eventType || 'unknown'}`, { raw: event });
  }
}

function processCallEvent(event, source) {
  const disposition = (event.disposition || event.call_disposition || event.outcome || '').toLowerCase();
  const contact = event.contact || event.lead || event.person || {};
  const name = contact.first_name
    ? `${contact.first_name} ${contact.last_name || ''}`.trim()
    : contact.name || contact.phone || 'Unknown';

  const callLog = {
    id: event.id || Date.now().toString(),
    contact: name,
    phone: contact.phone || event.phone || '',
    disposition: event.disposition || event.outcome || 'Unknown',
    duration: event.duration || event.call_duration || 0,
    recordingUrl: event.recording_url || event.call_recording || null,
    notes: event.notes || event.call_notes || '',
    agent: event.agent || event.caller || '',
    timestamp: event.timestamp || event.created_at || new Date().toISOString(),
    source
  };

  state.callLogs.unshift(callLog);
  if (state.callLogs.length > MAX_CALL_LOGS) state.callLogs.pop();

  state.callStats.total++;
  state.callStats.attempted++;

  if (disposition.includes('connected') || disposition.includes('answered') || disposition.includes('conversation')) {
    state.callStats.connected++;
    addActivity('call_connected', source, `Call connected with ${name} (${formatDuration(callLog.duration)})`, callLog);
  } else if (disposition.includes('voicemail') || disposition.includes('vm')) {
    state.callStats.voicemail++;
    addActivity('call_voicemail', source, `Voicemail left for ${name}`, callLog);
  } else if (disposition.includes('no answer') || disposition.includes('no_answer')) {
    state.callStats.noAnswer++;
    addActivity('call_attempt', source, `No answer for ${name}`, callLog);
  } else {
    addActivity('call_attempt', source, `Call attempt: ${callLog.disposition} — ${name}`, callLog);
  }

  recomputeRates();
  io.emit('stats_update', { callStats: state.callStats });
  io.emit('call_log_new', callLog);
}

function formatDuration(seconds) {
  if (!seconds) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─── Instantly API Polling ─────────────────────────────────────────────────────

const INSTANTLY_BASE = 'https://api.instantly.ai/api/v1';

async function fetchInstantlyData() {
  const apiKey = process.env.INSTANTLY_API_KEY;
  if (!apiKey || apiKey === 'your_instantly_api_key_here') return;

  try {
    const [summaryRes, campaignsRes] = await Promise.allSettled([
      axios.get(`${INSTANTLY_BASE}/analytics/overview`, {
        params: { api_key: apiKey }
      }),
      axios.get(`${INSTANTLY_BASE}/campaign/list`, {
        params: { api_key: apiKey, limit: 20, skip: 0 }
      })
    ]);

    // Process overview/summary stats
    if (summaryRes.status === 'fulfilled') {
      const data = summaryRes.value.data;
      updateEmailStatsFromInstantly(data);
    }

    // Process campaigns list
    if (campaignsRes.status === 'fulfilled') {
      const campaigns = campaignsRes.value.data;
      await fetchCampaignAnalytics(apiKey, campaigns);
    }

    state.lastUpdated = new Date().toISOString();
    io.emit('full_state', getPublicState());
  } catch (err) {
    console.error('[Instantly] Fetch error:', err.message);
    addActivity('system', 'system', `Instantly sync error: ${err.message}`);
  }
}

async function fetchCampaignAnalytics(apiKey, campaigns) {
  if (!campaigns || !Array.isArray(campaigns)) return;

  const campaignData = await Promise.allSettled(
    campaigns.slice(0, 10).map(async (campaign) => {
      try {
        const res = await axios.get(`${INSTANTLY_BASE}/analytics/campaign/summary`, {
          params: { api_key: apiKey, id: campaign.id }
        });
        return { ...campaign, analytics: res.data };
      } catch {
        return campaign;
      }
    })
  );

  state.campaigns = campaignData
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  io.emit('campaigns_update', state.campaigns);
}

function updateEmailStatsFromInstantly(data) {
  if (!data) return;

  // Instantly v1 analytics overview fields
  const prev = { ...state.emailStats };

  state.emailStats.sent = data.total_sent || data.emails_sent || state.emailStats.sent;
  state.emailStats.opened = data.total_opened || data.emails_opened || state.emailStats.opened;
  state.emailStats.replied = data.total_replied || data.emails_replied || state.emailStats.replied;
  state.emailStats.bounced = data.total_bounced || data.emails_bounced || state.emailStats.bounced;
  state.emailStats.unsubscribed = data.total_unsubscribed || data.emails_unsubscribed || state.emailStats.unsubscribed;
  state.emailStats.clicked = data.total_clicked || data.emails_clicked || state.emailStats.clicked;

  recomputeRates();

  // Emit activity for new events since last poll
  const deltas = {
    sent: state.emailStats.sent - prev.sent,
    replied: state.emailStats.replied - prev.replied,
    bounced: state.emailStats.bounced - prev.bounced,
    opened: state.emailStats.opened - prev.opened
  };

  if (deltas.sent > 0) addActivity('email_sent', 'instantly', `${deltas.sent} new email(s) sent via Instantly`);
  if (deltas.replied > 0) addActivity('email_reply', 'instantly', `${deltas.replied} new reply(ies) from Instantly`);
  if (deltas.bounced > 0) addActivity('email_bounce', 'instantly', `${deltas.bounced} bounce(s) from Instantly`);
  if (deltas.opened > 0) addActivity('email_open', 'instantly', `${deltas.opened} new open(s) from Instantly`);

  io.emit('stats_update', { emailStats: state.emailStats });
}

// ─── REST endpoints ────────────────────────────────────────────────────────────

app.get('/api/state', (req, res) => res.json(getPublicState()));

app.get('/api/call-logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, MAX_CALL_LOGS);
  res.json(state.callLogs.slice(0, limit));
});

app.get('/api/activity', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, MAX_FEED_ITEMS);
  res.json(state.activityFeed.slice(0, limit));
});

// Manual Instantly refresh
app.post('/api/refresh', async (req, res) => {
  await fetchInstantlyData();
  res.json({ ok: true, lastUpdated: state.lastUpdated });
});

// Seed demo data for testing without real API keys
app.post('/api/demo', (req, res) => {
  seedDemoData();
  res.json({ ok: true });
});

function getPublicState() {
  return {
    emailStats: state.emailStats,
    callStats: state.callStats,
    campaigns: state.campaigns,
    callLogs: state.callLogs.slice(0, 50),
    activityFeed: state.activityFeed.slice(0, 50),
    lastUpdated: state.lastUpdated
  };
}

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log('[WS] Client connected:', socket.id);
  socket.emit('full_state', getPublicState());
  socket.on('disconnect', () => console.log('[WS] Client disconnected:', socket.id));
});

// ─── Demo data ────────────────────────────────────────────────────────────────

function seedDemoData() {
  const contacts = [
    { name: 'Sarah Chen', email: 'sarah@techcorp.io', phone: '+1-415-555-0101' },
    { name: 'Marcus Webb', email: 'marcus@startupco.com', phone: '+1-650-555-0192' },
    { name: 'Priya Sharma', email: 'priya@saas.dev', phone: '+1-408-555-0183' },
    { name: 'Jake Torres', email: 'jake@enterprise.net', phone: '+1-212-555-0174' },
    { name: 'Emma Liu', email: 'emma@growth.io', phone: '+1-617-555-0165' },
    { name: 'Raj Patel', email: 'raj@b2b.co', phone: '+1-737-555-0156' }
  ];

  // Reset stats
  state.emailStats = { sent: 0, opened: 0, replied: 0, bounced: 0, unsubscribed: 0, clicked: 0, openRate: 0, replyRate: 0, bounceRate: 0 };
  state.callStats = { total: 0, connected: 0, voicemail: 0, noAnswer: 0, attempted: 0, connectionRate: 0 };
  state.callLogs = [];
  state.activityFeed = [];

  // Seed historical stats
  state.emailStats.sent = 847;
  state.emailStats.opened = 312;
  state.emailStats.replied = 89;
  state.emailStats.bounced = 14;
  state.emailStats.unsubscribed = 6;
  state.emailStats.clicked = 201;
  recomputeRates();

  state.callStats.total = 156;
  state.callStats.connected = 61;
  state.callStats.voicemail = 48;
  state.callStats.noAnswer = 47;
  state.callStats.attempted = 156;
  recomputeRates();

  // Demo campaigns
  state.campaigns = [
    { id: 'c1', name: 'Q2 Enterprise Outreach', status: 'active', analytics: { emails_sent: 420, emails_opened: 168, emails_replied: 52, emails_bounced: 7 } },
    { id: 'c2', name: 'Mid-Market ABM — May', status: 'active', analytics: { emails_sent: 280, emails_opened: 98, emails_replied: 24, emails_bounced: 4 } },
    { id: 'c3', name: 'Re-engagement Wave 3', status: 'paused', analytics: { emails_sent: 147, emails_opened: 46, emails_replied: 13, emails_bounced: 3 } }
  ];

  // Demo call logs
  const dispositions = [
    { label: 'Connected', type: 'call_connected' },
    { label: 'Voicemail', type: 'call_voicemail' },
    { label: 'No Answer', type: 'call_attempt' },
    { label: 'Connected', type: 'call_connected' },
    { label: 'Connected', type: 'call_connected' }
  ];
  contacts.forEach((c, i) => {
    const d = dispositions[i % dispositions.length];
    state.callLogs.push({
      id: `demo_${i}`,
      contact: c.name,
      phone: c.phone,
      disposition: d.label,
      duration: d.label === 'Connected' ? Math.floor(Math.random() * 600 + 60) : 0,
      recordingUrl: d.label === 'Connected' ? '#demo-recording' : null,
      notes: d.label === 'Connected' ? 'Showed interest in Q3 expansion' : '',
      agent: 'Alex Johnson',
      timestamp: new Date(Date.now() - i * 900000).toISOString(),
      source: 'demo'
    });
  });

  // Demo activity feed
  addActivity('email_reply', 'instantly', 'Reply from Sarah Chen — "Interested, let\'s chat"');
  addActivity('call_connected', 'clay', 'Call connected with Marcus Webb (8m 22s)');
  addActivity('email_sent', 'instantly', '42 emails sent in Q2 Enterprise Outreach');
  addActivity('email_bounce', 'instantly', '2 emails bounced in Mid-Market ABM');
  addActivity('call_voicemail', 'clay', 'Voicemail left for Priya Sharma');
  addActivity('email_open', 'instantly', 'Email opened by Jake Torres');
  addActivity('system', 'system', 'Dashboard initialized with demo data');

  state.lastUpdated = new Date().toISOString();
  io.emit('full_state', getPublicState());
}

// ─── Polling ───────────────────────────────────────────────────────────────────

const POLL_MS = parseInt(process.env.POLL_INTERVAL_MS) || 30000;
let pollTimer = null;

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  fetchInstantlyData(); // immediate first fetch
  pollTimer = setInterval(fetchInstantlyData, POLL_MS);
  console.log(`[Instantly] Polling every ${POLL_MS / 1000}s`);
}

// ─── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 GTM Dashboard running at http://localhost:${PORT}`);
  console.log(`   Webhook endpoint: POST http://localhost:${PORT}/webhook/clay`);
  console.log(`   Demo data:        POST http://localhost:${PORT}/api/demo\n`);
  startPolling();
  addActivity('system', 'system', 'GTM Dashboard server started');
});

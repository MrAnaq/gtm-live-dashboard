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
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Per-client state ──────────────────────────────────────────────────────────
// Each client gets their own isolated data store keyed by client slug
// e.g. "acme-corp", "techstart-inc"

const clients = {};

function getClient(clientId) {
  const id = (clientId || 'default').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!clients[id]) {
    clients[id] = {
      id,
      emailStats:  { sent:0, opened:0, replied:0, bounced:0, unsubscribed:0, clicked:0, openRate:0, replyRate:0, bounceRate:0 },
      callStats:   { total:0, connected:0, voicemail:0, noAnswer:0, connectionRate:0 },
      callLogs:    [],
      activityFeed:[],
      campaigns:   [],
      lastUpdated: null
    };
  }
  return clients[id];
}

function recomputeRates(c) {
  const e = c.emailStats, ca = c.callStats;
  e.openRate   = e.sent > 0 ? +((e.opened  / e.sent) * 100).toFixed(1) : 0;
  e.replyRate  = e.sent > 0 ? +((e.replied / e.sent) * 100).toFixed(1) : 0;
  e.bounceRate = e.sent > 0 ? +((e.bounced / e.sent) * 100).toFixed(1) : 0;
  ca.connectionRate = ca.total > 0 ? +((ca.connected / ca.total) * 100).toFixed(1) : 0;
}

function addActivity(c, type, source, message, data = {}) {
  const item = {
    id: Date.now() + Math.random().toString(36).slice(2),
    type, source, message, data,
    timestamp: new Date().toISOString()
  };
  c.activityFeed.unshift(item);
  if (c.activityFeed.length > 100) c.activityFeed.pop();
  io.to(`client:${c.id}`).emit('activity', item);
  return item;
}

function broadcastStats(c) {
  io.to(`client:${c.id}`).emit('stats_update', {
    emailStats: c.emailStats,
    callStats:  c.callStats
  });
}

function clientState(c) {
  return {
    clientId:    c.id,
    emailStats:  c.emailStats,
    callStats:   c.callStats,
    callLogs:    c.callLogs.slice(0, 50),
    activityFeed:c.activityFeed.slice(0, 50),
    campaigns:   c.campaigns,
    lastUpdated: c.lastUpdated
  };
}

// ── Clay Webhook ──────────────────────────────────────────────────────────────
// URL format: POST /webhook/clay?client=acme-corp
//
// Clay field mapping (set these in your Clay HTTP action):
// {
//   "event_type":    "call" | "email_sent" | "reply" | "bounce" | "open",
//   "client":        "acme-corp",          ← Clay column or hardcoded per table
//   "contact": {
//     "first_name":  "{{First Name}}",
//     "last_name":   "{{Last Name}}",
//     "email":       "{{Email}}",
//     "phone":       "{{Phone}}"
//   },
//   "company":       "{{Company}}",
//   "disposition":   "{{Call Disposition}}",   ← Connected / Voicemail / No Answer
//   "duration":      "{{Call Duration}}",      ← seconds (number)
//   "recording_url": "{{Recording URL}}",
//   "notes":         "{{Call Notes}}",
//   "agent":         "{{Agent Name}}"
// }

app.post('/webhook/clay', (req, res) => {
  const payload = req.body;
  const events  = Array.isArray(payload) ? payload : [payload];
  let processed = 0;

  events.forEach(event => {
    // Client can come from query param OR body field
    const clientId = req.query.client || event.client || event.client_id || 'default';
    const c = getClient(clientId);
    processClaySEvent(c, event);
    processed++;
  });

  res.json({ ok: true, processed });
});

function processClaySEvent(c, event) {
  const eventType = (event.event_type || event.type || event.action || '').toLowerCase();
  const contact   = event.contact || {};
  const name = contact.first_name
    ? `${contact.first_name} ${contact.last_name || ''}`.trim()
    : contact.name || contact.email || event.contact_name || 'Unknown';

  if (eventType.includes('call')) {
    processCall(c, event, name);
  } else if (eventType.includes('reply') || eventType.includes('responded')) {
    c.emailStats.replied++; recomputeRates(c);
    addActivity(c, 'email_reply', 'clay', `Reply from ${name}`);
    broadcastStats(c);
  } else if (eventType.includes('bounce')) {
    c.emailStats.bounced++; recomputeRates(c);
    addActivity(c, 'email_bounce', 'clay', `Email bounced — ${name}`);
    broadcastStats(c);
  } else if (eventType.includes('open')) {
    c.emailStats.opened++; recomputeRates(c);
    addActivity(c, 'email_open', 'clay', `Email opened by ${name}`);
    broadcastStats(c);
  } else if (eventType.includes('sent') || eventType.includes('email_sent')) {
    c.emailStats.sent++; recomputeRates(c);
    addActivity(c, 'email_sent', 'clay', `Email sent to ${name}`);
    broadcastStats(c);
  } else {
    addActivity(c, 'system', 'clay', `Clay event: ${eventType || 'unknown'}`);
  }

  c.lastUpdated = new Date().toISOString();
}

function processCall(c, event, name) {
  const disp = (event.disposition || event.call_disposition || event.outcome || '').toLowerCase();

  const log = {
    id:           event.id || Date.now().toString(),
    contact:      name,
    company:      event.company || event.contact?.company || '',
    phone:        event.contact?.phone || event.phone || '',
    disposition:  event.disposition || event.outcome || 'Unknown',
    duration:     parseInt(event.duration || event.call_duration || 0),
    recordingUrl: event.recording_url || event.call_recording || null,
    notes:        event.notes || event.call_notes || event.summary || '',
    agent:        event.agent || event.agent_name || '',
    source:       event.source || 'clay',  // 'bland' | 'calltools' | 'clay'
    timestamp:    event.timestamp || event.created_at || new Date().toISOString()
  };

  c.callLogs.unshift(log);
  if (c.callLogs.length > 200) c.callLogs.pop();

  c.callStats.total++;
  if (disp.includes('connect') || disp.includes('answered') || disp.includes('conversation')) {
    c.callStats.connected++;
    addActivity(c, 'call_connected', 'clay', `Call connected — ${name} (${fmtDur(log.duration)})`, log);
  } else if (disp.includes('voicemail') || disp.includes('vm')) {
    c.callStats.voicemail++;
    addActivity(c, 'call_voicemail', 'clay', `Voicemail left for ${name}`, log);
  } else {
    c.callStats.noAnswer++;
    addActivity(c, 'call_attempt', 'clay', `No answer — ${name}`, log);
  }

  recomputeRates(c);
  broadcastStats(c);
  io.to(`client:${c.id}`).emit('call_log_new', log);
  c.lastUpdated = new Date().toISOString();
}

function fmtDur(s) {
  if (!s) return '0s';
  const m = Math.floor(s / 60), r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

// ── Instantly Webhook ─────────────────────────────────────────────────────────
// URL format: POST /webhook/instantly?client=acme-corp
// Instantly sends these event types: email_sent, email_opened, email_replied,
//   email_bounced, email_unsubscribed, email_link_clicked

app.post('/webhook/instantly', (req, res) => {
  const event    = req.body;
  const clientId = req.query.client || event.campaign_name || 'default';
  const c        = getClient(clientId);

  const type  = (event.event_type || event.type || '').toLowerCase();
  const email = event.to_address || event.email || event.lead_email || '';
  const campaign = event.campaign_name || event.campaign_id || '';

  if (type.includes('sent')) {
    c.emailStats.sent++; recomputeRates(c);
    addActivity(c, 'email_sent', 'instantly', `Email sent to ${email}${campaign ? ` — ${campaign}` : ''}`);
  } else if (type.includes('open')) {
    c.emailStats.opened++; recomputeRates(c);
    addActivity(c, 'email_open', 'instantly', `Email opened — ${email}`);
  } else if (type.includes('repl')) {
    c.emailStats.replied++; recomputeRates(c);
    addActivity(c, 'email_reply', 'instantly', `Reply from ${email}`);
  } else if (type.includes('bounc')) {
    c.emailStats.bounced++; recomputeRates(c);
    addActivity(c, 'email_bounce', 'instantly', `Bounce — ${email}`);
  } else if (type.includes('unsub')) {
    c.emailStats.unsubscribed++; recomputeRates(c);
    addActivity(c, 'unsubscribe', 'instantly', `Unsubscribed — ${email}`);
  } else if (type.includes('click')) {
    c.emailStats.clicked++; recomputeRates(c);
    addActivity(c, 'email_open', 'instantly', `Link clicked — ${email}`);
  }

  broadcastStats(c);
  c.lastUpdated = new Date().toISOString();
  res.json({ ok: true });
});

// ── REST API ──────────────────────────────────────────────────────────────────

// List all active clients
app.get('/api/clients', (req, res) => {
  res.json(Object.keys(clients));
});

// Full state for a client
app.get('/api/state/:clientId', (req, res) => {
  res.json(clientState(getClient(req.params.clientId)));
});

// Health check (Railway uses this)
app.get('/health', (req, res) => res.json({ ok: true, clients: Object.keys(clients).length }));

// ── Socket.io rooms ───────────────────────────────────────────────────────────
// Each browser joins a room for their client: "client:acme-corp"

io.on('connection', (socket) => {
  socket.on('join_client', (clientId) => {
    const c = getClient(clientId);
    socket.join(`client:${c.id}`);
    socket.emit('full_state', clientState(c));
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 GTM Dashboard running on port ${PORT}`);
  console.log(`   Clay webhook:     POST /webhook/clay?client=YOUR_CLIENT`);
  console.log(`   Instantly webhook: POST /webhook/instantly?client=YOUR_CLIENT`);
  console.log(`   Dashboard:        GET  /?client=YOUR_CLIENT\n`);
});

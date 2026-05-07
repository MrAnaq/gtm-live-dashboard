/* GTM Live Dashboard — client-side */
'use strict';

// ── Socket.io connection ──────────────────────────────────────────────────────
const socket = io({ transports: ['websocket', 'polling'] });

const $wsDot   = document.getElementById('ws-dot');
const $wsLabel = document.getElementById('ws-label');

socket.on('connect', () => {
  $wsDot.className = 'status-dot connected';
  $wsLabel.textContent = 'Live';
  toast('Connected to dashboard', 'success');
});
socket.on('disconnect', () => {
  $wsDot.className = 'status-dot error';
  $wsLabel.textContent = 'Disconnected';
  toast('Connection lost — reconnecting…', 'error');
});

// ── Charts ────────────────────────────────────────────────────────────────────
const CHART_DEFAULTS = {
  plugins: { legend: { display: false } },
  animation: { duration: 400 }
};

// Email donut
const emailDonut = new Chart(document.getElementById('email-donut'), {
  type: 'doughnut',
  data: {
    labels: ['Opened', 'Replied', 'Bounced', 'Sent (rest)'],
    datasets: [{
      data: [0, 0, 0, 0],
      backgroundColor: ['#22c55e', '#a855f7', '#ef4444', '#1e2535'],
      borderColor: '#13161e',
      borderWidth: 2,
      hoverOffset: 4
    }]
  },
  options: {
    cutout: '68%',
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { color: '#8892a4', font: { size: 10 }, padding: 8, boxWidth: 10 }
      },
      tooltip: {
        callbacks: {
          label: ctx => ` ${ctx.label}: ${ctx.raw.toLocaleString()}`
        }
      }
    },
    animation: { duration: 400 }
  }
});

// Call outcomes donut
const callDonut = new Chart(document.getElementById('call-donut'), {
  type: 'doughnut',
  data: {
    labels: ['Connected', 'Voicemail', 'No Answer'],
    datasets: [{
      data: [0, 0, 0],
      backgroundColor: ['#22c55e', '#f59e0b', '#ef4444'],
      borderColor: '#13161e',
      borderWidth: 2,
      hoverOffset: 4
    }]
  },
  options: {
    cutout: '68%',
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: { color: '#8892a4', font: { size: 10 }, padding: 8, boxWidth: 10 }
      }
    },
    animation: { duration: 400 }
  }
});

// Email timeline (last 20 data points)
const timelineLabels = [];
const timelineData = { sent: [], opened: [], replied: [], bounced: [] };
const emailTimeline = new Chart(document.getElementById('email-timeline'), {
  type: 'line',
  data: {
    labels: timelineLabels,
    datasets: [
      { label: 'Sent',    data: timelineData.sent,    borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.08)',  tension: .4, fill: true, pointRadius: 2 },
      { label: 'Opened',  data: timelineData.opened,  borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.08)',   tension: .4, fill: false, pointRadius: 2 },
      { label: 'Replied', data: timelineData.replied, borderColor: '#a855f7', backgroundColor: 'rgba(168,85,247,.08)', tension: .4, fill: false, pointRadius: 2 },
      { label: 'Bounced', data: timelineData.bounced, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,.08)',   tension: .4, fill: false, pointRadius: 2 }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { grid: { color: '#1a1e2a' }, ticks: { color: '#545e70', maxTicksLimit: 8, font: { size: 10 } } },
      y: { grid: { color: '#1a1e2a' }, ticks: { color: '#545e70', font: { size: 10 } }, beginAtZero: true }
    },
    plugins: {
      legend: {
        display: true,
        labels: { color: '#8892a4', font: { size: 10 }, padding: 12, boxWidth: 12, usePointStyle: true }
      }
    },
    animation: { duration: 300 }
  }
});

function pushTimelinePoint(stats) {
  const label = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  timelineLabels.push(label);
  timelineData.sent.push(stats.sent || 0);
  timelineData.opened.push(stats.opened || 0);
  timelineData.replied.push(stats.replied || 0);
  timelineData.bounced.push(stats.bounced || 0);
  if (timelineLabels.length > 20) {
    timelineLabels.shift();
    Object.values(timelineData).forEach(arr => arr.shift());
  }
  emailTimeline.update();
}

// ── Stat helpers ──────────────────────────────────────────────────────────────
function setStatValue(id, value, flash) {
  const el = document.getElementById(id);
  if (!el) return;
  const prev = parseInt(el.textContent.replace(/,/g, '')) || 0;
  el.textContent = value.toLocaleString();
  if (flash && value !== prev) {
    const cls = value > prev ? 'flash-up' : 'flash-down';
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 600);
  }
}

function updateEmailStats(stats) {
  setStatValue('stat-sent',         stats.sent,         true);
  setStatValue('stat-opened',       stats.opened,       true);
  setStatValue('stat-replied',      stats.replied,      true);
  setStatValue('stat-bounced',      stats.bounced,      true);
  setStatValue('stat-clicked',      stats.clicked || 0, true);
  setStatValue('stat-unsubscribed', stats.unsubscribed || 0, true);
  document.getElementById('rate-open').textContent   = `${stats.openRate}% open rate`;
  document.getElementById('rate-reply').textContent  = `${stats.replyRate}% reply rate`;
  document.getElementById('rate-bounce').textContent = `${stats.bounceRate}% bounce rate`;

  const rest = Math.max(0, stats.sent - stats.opened - stats.replied - stats.bounced);
  emailDonut.data.datasets[0].data = [stats.opened, stats.replied, stats.bounced, rest];
  emailDonut.update();
}

function updateCallStats(stats) {
  setStatValue('stat-calls-total',     stats.total,     true);
  setStatValue('stat-calls-connected', stats.connected, true);
  setStatValue('stat-calls-voicemail', stats.voicemail, true);
  setStatValue('stat-calls-noanswer',  stats.noAnswer,  true);
  document.getElementById('rate-connection').textContent = `${stats.connectionRate}% connection rate`;

  callDonut.data.datasets[0].data = [stats.connected, stats.voicemail, stats.noAnswer];
  callDonut.update();
}

// ── Activity Feed ─────────────────────────────────────────────────────────────
const ICONS = {
  email_sent:      '📤',
  email_reply:     '↩️',
  email_bounce:    '⚠️',
  email_open:      '👁️',
  unsubscribe:     '🚫',
  call_connected:  '✅',
  call_voicemail:  '📬',
  call_attempt:    '📵',
  system:          '⚙️'
};

const $feed = document.getElementById('activity-feed');

function renderFeedItem(item, prepend = true) {
  const icon    = ICONS[item.type] || '•';
  const srcCls  = `src-${item.source || 'system'}`;
  const time    = new Date(item.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const div = document.createElement('div');
  div.className = 'feed-item';
  div.innerHTML = `
    <span class="feed-icon">${icon}</span>
    <div class="feed-body">
      <div class="feed-msg">${escHtml(item.message)}</div>
      <div class="feed-meta">
        <span class="feed-source ${srcCls}">${escHtml(item.source || 'system')}</span>
        <span class="feed-time">${time}</span>
      </div>
    </div>`;

  const empty = $feed.querySelector('.feed-empty');
  if (empty) empty.remove();

  if (prepend) {
    $feed.insertBefore(div, $feed.firstChild);
    // trim to 100 items
    while ($feed.children.length > 100) $feed.removeChild($feed.lastChild);
  } else {
    $feed.appendChild(div);
  }
}

// ── Campaigns Table ───────────────────────────────────────────────────────────
const $campaignsBody = document.getElementById('campaigns-body');

function renderCampaigns(campaigns) {
  if (!campaigns || campaigns.length === 0) {
    $campaignsBody.innerHTML = '<tr><td colspan="6" class="empty-row">No campaigns — connect Instantly API</td></tr>';
    return;
  }
  $campaignsBody.innerHTML = campaigns.map(c => {
    const a = c.analytics || {};
    const sent    = a.emails_sent || a.total_sent || 0;
    const opened  = a.emails_opened || a.total_opened || 0;
    const replied = a.emails_replied || a.total_replied || 0;
    const bounced = a.emails_bounced || a.total_bounced || 0;
    const statusCls = c.status === 'active' ? 'pill-active' : c.status === 'paused' ? 'pill-paused' : 'pill-completed';
    return `
      <tr>
        <td><strong>${escHtml(c.name || 'Untitled')}</strong></td>
        <td><span class="pill ${statusCls}">${escHtml(c.status || '—')}</span></td>
        <td>${sent.toLocaleString()}</td>
        <td>${opened.toLocaleString()}</td>
        <td>${replied.toLocaleString()}</td>
        <td>${bounced.toLocaleString()}</td>
      </tr>`;
  }).join('');
}

// ── Call Logs Table ───────────────────────────────────────────────────────────
const $callsBody  = document.getElementById('calls-body');
const $callCount  = document.getElementById('call-count');

function renderCallLogs(logs, flash = false) {
  if (!logs || logs.length === 0) {
    $callsBody.innerHTML = '<tr><td colspan="8" class="empty-row">No calls yet</td></tr>';
    $callCount.textContent = '0 calls';
    return;
  }
  $callCount.textContent = `${logs.length} call${logs.length !== 1 ? 's' : ''}`;

  $callsBody.innerHTML = logs.map((log, i) => {
    const disp  = (log.disposition || '').toLowerCase();
    const pCls  = disp.includes('connect') || disp.includes('answer') ? 'pill-connected'
                : disp.includes('voicemail') || disp.includes('vm')   ? 'pill-voicemail'
                : 'pill-noanswer';
    const dur   = log.duration ? formatDur(log.duration) : '—';
    const rec   = log.recordingUrl
      ? `<a class="rec-link" href="${escHtml(log.recordingUrl)}" target="_blank">▶ Play</a>`
      : '<span style="color:var(--text3)">—</span>';
    const time  = log.timestamp ? new Date(log.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const rowCls = flash && i === 0 ? ' class="new-row"' : '';

    return `
      <tr${rowCls}>
        <td><strong>${escHtml(log.contact || '—')}</strong></td>
        <td style="color:var(--text2)">${escHtml(log.phone || '—')}</td>
        <td><span class="pill ${pCls}">${escHtml(log.disposition || '—')}</span></td>
        <td style="font-variant-numeric:tabular-nums">${dur}</td>
        <td style="color:var(--text2)">${escHtml(log.agent || '—')}</td>
        <td>${rec}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)" title="${escHtml(log.notes || '')}">${escHtml(log.notes || '—')}</td>
        <td style="color:var(--text3);white-space:nowrap">${time}</td>
      </tr>`;
  }).join('');
}

function prependCallLog(log) {
  const empty = $callsBody.querySelector('.empty-row');
  if (empty) $callsBody.innerHTML = '';

  const disp  = (log.disposition || '').toLowerCase();
  const pCls  = disp.includes('connect') ? 'pill-connected' : disp.includes('voicemail') ? 'pill-voicemail' : 'pill-noanswer';
  const dur   = log.duration ? formatDur(log.duration) : '—';
  const rec   = log.recordingUrl
    ? `<a class="rec-link" href="${escHtml(log.recordingUrl)}" target="_blank">▶ Play</a>`
    : '<span style="color:var(--text3)">—</span>';
  const time  = log.timestamp ? new Date(log.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  const tr = document.createElement('tr');
  tr.className = 'new-row';
  tr.innerHTML = `
    <td><strong>${escHtml(log.contact || '—')}</strong></td>
    <td style="color:var(--text2)">${escHtml(log.phone || '—')}</td>
    <td><span class="pill ${pCls}">${escHtml(log.disposition || '—')}</span></td>
    <td style="font-variant-numeric:tabular-nums">${dur}</td>
    <td style="color:var(--text2)">${escHtml(log.agent || '—')}</td>
    <td>${rec}</td>
    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text2)">${escHtml(log.notes || '—')}</td>
    <td style="color:var(--text3);white-space:nowrap">${time}</td>`;

  $callsBody.insertBefore(tr, $callsBody.firstChild);
  while ($callsBody.children.length > 100) $callsBody.removeChild($callsBody.lastChild);

  const cnt = parseInt($callCount.textContent) || 0;
  $callCount.textContent = `${cnt + 1} calls`;
}

// ── Socket events ─────────────────────────────────────────────────────────────
socket.on('full_state', (state) => {
  updateEmailStats(state.emailStats);
  updateCallStats(state.callStats);
  renderCampaigns(state.campaigns);
  renderCallLogs(state.callLogs);

  $feed.innerHTML = '';
  (state.activityFeed || []).slice().reverse().forEach(item => renderFeedItem(item, false));

  if (state.lastUpdated) {
    document.getElementById('last-updated').textContent =
      'Updated ' + new Date(state.lastUpdated).toLocaleTimeString();
  }

  pushTimelinePoint(state.emailStats);
});

socket.on('stats_update', (data) => {
  if (data.emailStats) {
    updateEmailStats(data.emailStats);
    pushTimelinePoint(data.emailStats);
  }
  if (data.callStats) updateCallStats(data.callStats);
});

socket.on('activity', (item) => renderFeedItem(item, true));

socket.on('campaigns_update', (campaigns) => renderCampaigns(campaigns));

socket.on('call_log_new', (log) => prependCallLog(log));

// ── Buttons ───────────────────────────────────────────────────────────────────
document.getElementById('btn-refresh').addEventListener('click', async function () {
  this.classList.add('spinning');
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      toast('Instantly data refreshed', 'success');
      if (data.lastUpdated) {
        document.getElementById('last-updated').textContent =
          'Updated ' + new Date(data.lastUpdated).toLocaleTimeString();
      }
    }
  } catch (e) {
    toast('Refresh failed: ' + e.message, 'error');
  } finally {
    this.classList.remove('spinning');
  }
});

document.getElementById('btn-demo').addEventListener('click', async function () {
  try {
    await fetch('/api/demo', { method: 'POST' });
    toast('Demo data loaded', 'info');
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
});

// ── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDur(seconds) {
  if (!seconds) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

# Security Audit — GTM Live Dashboard

Date: 2026-07-02
Scope: full repository (`server.js`, `public/`, root `index.html`, dependencies, deploy config)

## Summary

The app currently has **no authentication or authorization anywhere**. Anyone who knows
(or guesses) the deployed URL can read every client's data — including contact names,
emails, phone numbers, call notes, and call-recording URLs — and can inject fake data
into any client's dashboard. Combined with unsafe HTML rendering of webhook fields,
this also enables **stored XSS**: an attacker can run JavaScript in the browser of
anyone viewing a dashboard.

Severity legend: 🔴 Critical · 🟠 High · 🟡 Medium · ⚪ Low

---

## 🔴 C1. Full cross-tenant data exposure — no auth on any read path

**Where:** `server.js:234-241` (`GET /api/clients`, `GET /api/state/:clientId`), `server.js:249-255` (socket.io `join_client`)

- `GET /api/clients` lists **every client slug** on the server.
- `GET /api/state/:clientId` returns the full state for any client — email stats,
  call logs with contact names, phone numbers, notes, agent names, and recording URLs.
- The socket.io `join_client` event lets any browser join any client's room and
  receive live updates. There
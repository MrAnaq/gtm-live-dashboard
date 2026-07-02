# Provisioner Capacity Report — AnaqVisual (Gate 1 input)

**Date:** 2026-07-02
**Prepared by:** VP session (automated inventory pass)
**Status:** PARTIAL — hard numbers on mailbox/domain capacity are blocked by access, not by absence of infrastructure. Blockers and the exact unblock steps are listed below. Nothing in this report is estimated or assumed; every line is either verified or explicitly marked unreachable.

---

## What was verified

**HubSpot (CRM + booking)**
- Owner "Adam Alvarez" exists and is active — ownerId `350598203`. Deals can be logged to him per brief §6.
- Booking link per brief: https://meetings.hubspot.com/anaqvisuals/getting-to-know-each-other

**n8n automation stack** (instance: `https://n8n-1-6ry3.onrender.com`)
- **Instantly integration exists and is live.** Active workflows: "Push Sequence to Instantly", "Workflow 3: Auto-Deploy Approved Sequences to Instantly" (runs every 5 min), "Notion → Instantly Campaign Push". Instantly credentials live inside n8n.
- **Sequence Generator (Agent 8)** — active.
- **Serper scrapers** — "Scrape-google-places" and "Serper - Webpage Scrape" active.
- **List Builder (Agent 4, local_smb)** — exists, full pipeline (Notion intake → Claude ICP interpreter → Serper Maps → Outscraper enrichment + domain emails → ZeroBounce verify → Claude QC → CSV). **Not launch-ready** — see blockers.
- Call-tracking plumbing exists (CallTools → Clay → GHL sync, Dial Volume Ledger workflows) — currently inactive but built.

**Reporting surface**
- This repo (gtm-live-dashboard) supports per-client isolation. AnaqVisual daily one-liners can run off `POST /webhook/instantly?client=anaqvisual` and `POST /webhook/clay?client=anaqvisual` with zero code changes. Dashboard: `/?client=anaqvisual`.

## What is blocked (with unblock steps)

| # | Item | Finding | Unblock |
|---|------|---------|---------|
| 1 | **Instantly warm mailbox/domain counts** | No Instantly API access from this session. Credentials exist only inside n8n, and n8n credential listing requires interactive approval. | Either approve the n8n `list_credentials`/execute calls in an interactive session, or add `INSTANTLY_API_KEY` to this environment, or Adam reads Accounts → warmup status directly in the Instantly UI (5 min). |
| 2 | **Smartlead** | **Zero Smartlead footprint found anywhere** — no MCP connector, no n8n workflow, no credential reference. | If Smartlead seats actually exist, they're invisible to automation. Confirm or drop Smartlead from consideration. |
| 3 | **~132 domain registry** | Unverifiable — no reachable domain inventory (Supabase and n8n data-table reads are approval-gated in this session). | Approve read calls interactively, or export the registry to `clients/anaqvisual/` as CSV. |
| 4 | **Apollo linked mailboxes** | Apollo MCP connected but every call requires interactive approval — headless session can't grant it. | Run in an interactive session, or pre-approve Apollo read tools. |
| 5 | **Agent 4 List Builder** | All 9 Notion HTTP nodes contain the literal placeholder `REPLACE_WITH_NOTION_TOKEN`; Slack error node has `REPLACE_WITH_SLACK_WEBHOOK_URL`; workflow is inactive. Env keys it needs (`SERPER_API_KEY`, `OUTSCRAPER_API_KEY`, `ZEROBOUNCE_API_KEY`, `ANTHROPIC_API_KEY`) could not be verified. | ~15 min fix in n8n: paste real Notion token + Slack webhook, confirm the four env keys, activate. Then Segment 1 fires via the payloads in `segment1-list-build.md`. |
| 6 | **Unauthenticated MCP server** | One connected MCP server requires OAuth and can't be authorized from a headless session. | Authorize it in claude.ai connector settings (or `/mcp` in an interactive session) — if it's the Instantly connector, it resolves blocker #1 directly. |

## Provisioner recommendation (for Adam's gate 1 platform pick)

**Instantly.** It is the only platform with a verified, live integration path (three active n8n push workflows). Smartlead has no discoverable footprint — picking it would mean building integration from zero against a July 10 deadline. Per brief §6, do not delay launch for warm-up: launch on whatever existing warm Instantly capacity the UI shows, and order any new domains now so they mature during weeks 2–4.

**One number Adam must supply at gate 1:** available warm Instantly sends/day not committed to client campaigns. Everything in the strategy doc's volume plan keys off it.

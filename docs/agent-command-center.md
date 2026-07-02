# 🤖 Agent Command Center (Notion)

Single control table for the Outbound Machine agents — the VP orchestrator, Agents 1–8, and the Inbound Conversation Agent.

**Notion database:** https://app.notion.com/p/0018b254c7cd404a9d950c32940d4090

## What it tracks

| Column | Purpose |
|--------|---------|
| Status | 🟢 Live / 🟡 Building / ⚪ Scaffold / 🔵 Planned / ⏸️ Paused / 🔴 Broken / 🗄️ Retired |
| Enabled | Mirrors the n8n workflow active toggle |
| Health | ✅ / ⚠️ / ❌ / ❓ — the "is anything on fire" column |
| Feeds Into | Agent hand-off chain (1→5→6, 2→3, 4→8) |
| Goal / KPI + Current Metric | Target vs. actual per agent |
| n8n Workflow | Workflow name + ID for jumping into n8n |
| Last Run / Last Reviewed / Next Action | Operating cadence |

## Views

- **📋 All Agents** — full roster sorted by agent number
- **🎛️ Status Board** — kanban by status; drag cards as agents ship
- **⚠️ Needs Attention** — everything not ✅ Healthy, sorted by priority
- **🟢 Live Now** — only enabled agents, with KPIs and last-run

## VP agent contract

The table is designed to be the VP agent's memory: it reads every row
(status, health, metrics), cross-checks n8n execution logs and this
dashboard's stats, writes back `Health`, `Current Metric`, `Last Run`,
and `Last Reviewed`, and sends a daily digest. Humans and the VP agent
share the same table, so it always shows live truth.

## Related agent dashboards in Notion

- **Agent 4 — List Builds** — per-build tracking for the list-building pipeline
- **Agent 8 - Clients** — per-client sequence generation tracking

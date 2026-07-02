# Segment 1 List Build — Launch Package (Offer A, home services TX+MA)

**Status:** READY TO FIRE, blocked only on Agent 4 workflow fixes (see capacity-report.md blocker #5).
**Pipeline:** n8n "Agent 4 — List Builder (Phase 1 — local_smb) v2 FIXED" (`GRsHaSsInJLUr5ub`)
**Trigger:** `POST https://n8n-1-6ry3.onrender.com/webhook/agent4-list-builder`
**Target:** 1,500 verified owner contacts (email + phone), per brief §3.

## Prerequisites (do once, ~20 min)

1. Fix Agent 4: replace `REPLACE_WITH_NOTION_TOKEN` (9 nodes) and `REPLACE_WITH_SLACK_WEBHOOK_URL` (1 node); confirm `SERPER_API_KEY`, `OUTSCRAPER_API_KEY`, `ZEROBOUNCE_API_KEY`, `ANTHROPIC_API_KEY` are set on the n8n instance; activate the workflow.
2. Create one Notion ICP form page for this segment (the pipeline's Claude ICP interpreter reads it). Content = brief §3 Segment 1 spec verbatim, plus per-build industry + metro below. The build tracker database the cron polls is `248d0b46-1ea2-4bcb-a058-4b9ccbf3755a`.

## Run matrix

A single Serper Maps query returns ≤100 places, so one 1,500-volume build cannot fill in a single run — this is a known workflow limitation, not a spec change. Fire **one build per trade × metro cell**, `target_volume: 100` each:

| Trades (5) | Metros (8) |
|---|---|
| HVAC | Houston TX |
| Plumbing | Dallas–Fort Worth TX |
| Electrical | San Antonio TX |
| Roofing | Austin TX |
| Remodel / design-build | Boston MA |
| | Worcester MA |
| | Springfield MA |
| | Lowell / North Shore MA |

40 builds × ~100 places ≈ 4,000 raw → dedup → email verify → ~1,500–2,000 usable. Prioritize MA design-build and TX HVAC cells first (proof-story adjacency, summer season).

## Webhook payload template

```json
{
  "build_name": "anaqvisual-s1-{trade}-{metro}",
  "icp_type": "local_smb",
  "icp_form_link": "<Notion ICP form page URL>",
  "target_volume": 100,
  "budget_cap_usd": 5,
  "human_signoff_required": false
}
```

Cost model (the workflow's own pre-estimate): ~$1.90 per 100-contact build → **≈ $75–80 total for the full matrix.** Budget gate halts any build that estimates over its cap.

## Built-in quality gates (no action needed, just expectations)

- **Verify gate halts** if valid < 90% or catch-all > 30% of emails found.
- **QC gate** (Claude judge on a 20–30 row sample) halts to "Awaiting Approval" if >10% fail category/geo/data checks.
- Verifier is **ZeroBounce**. Brief calls for Bouncer on consumer-ISP-heavy lists — local trades skew Gmail/Yahoo, so spot-check the first two builds' catch-all/unknown rates; if unknowns > ~15%, swap the verify node to Bouncer before running the remaining matrix.

## Post-build steps

1. Merge CSVs, dedup across builds (workflow only dedups within a build).
2. Rank by review count/velocity → top ~200 become Adam's call list (20/day × 2 weeks, JP-skeleton script per brief §5).
3. Capture the brief's extra signals not covered by the pipeline (after-hours voicemail check, chat-widget presence) on the call-list slice only — 200 checks is an afternoon, 1,500 is not worth it pre-reply.
4. Load email-track contacts to the platform Adam picks at gate 1 (recommendation: Instantly).

# Hands-free drafting (autopilot)

The owner approved, on 31 Oct 2026, that their agents should do all drafting work and the owner only approves. The autopilot is the daily step that makes that happen.

## What a run does

A Vercel cron (`/api/autopilot`, 01:30 UTC = 07:00 IST, bearer `CRON_SECRET`) or an assistant-credential test run (POST) does at most one draft:

1. **Gates.** It needs a ready hosted owner-draft runtime, standing owner-cleared sources and calendar generation ON. It does at most 2 drafts per IST day.
2. **Slot.** It takes the next calendar slot 30 hours to 7 days ahead that has no source, task, dispatch job or GitHub grant. The hosted GitHub batch keeps priority on its own slots.
3. **Story agent.** It ranks unused owner stories: `owner-chat` sources imported under the standing consent, and Story Bank answers. The score counts concrete first-person episodes (tried, broke, fixed, learned…), plus recency. Stories with no episode are never chosen, and a story with any task is never reused.
4. **Draft.** It queues a manual task whose brief carries the slot's kind, audience and format. It then runs the existing capped one-shot draft (`runOwnerDraft`: 6 calls, about $0.13, no retries; monthly cap and accounting rechecked). An `autopilot_draft` event records that it ran under the owner's standing consent.
5. **Slot and alert.** After the six stages, it links the task to the slot and sends "Draft ready to approve" through ntfy, without any post text.

Nothing is confirmed, approved, scheduled or published by the autopilot. The owner's one-click approval remains the only route to publication.

# To do

Last updated: 2026-09-28

## Smartly leave integration (parked — pick up later)

Goal: when staff leave is approved in Smartly, it should automatically populate into
their weekly schedule in this app (as "Leave", colored per the existing scheme) instead
of them re-entering it by hand.

Sample "Leave request Approved" email confirmed (from `no-reply@smartly.co.nz`, sent to the
requester themselves) — structured, parseable fields: Leave Requested By, Type (e.g. "Lieu
Taken"), Start Date, End Date, Hours Requested, Status, Comments.

- [ ] **Confirm Smartly's own API access** — check Smartly admin → Settings for an
      Integrations/API/Developer section; if nothing there, contact Smartly support directly
      to ask whether third-party API/webhook access for leave approvals exists at all, and
      what it needs (API key, OAuth, paid tier). This decides whether the whole
      email-parsing path below is even necessary, or if there's a cleaner direct API path.
- [ ] **If going the Outlook/email route instead**: the sample email went to the requester,
      not a shared inbox — reading every staff member's own mailbox would need broad,
      privacy-sensitive tenant-wide Graph API mail permissions. Check whether Smartly can
      also CC/BCC a shared address, or set up an Outlook inbox rule forwarding a copy of
      these notifications to one dedicated mailbox — much simpler and lower-privilege than
      reading everyone's inbox individually.
- [ ] **Collect more sample emails** before building a parser — specifically: a leave type
      other than "Lieu Taken" (e.g. Annual Leave, Sick Leave) to confirm the field layout
      stays consistent, and a "Declined" one too, so a decline can't be misread as approved.
- [ ] **Decide the leave-type → location-text mapping** — does every Smartly leave type just
      become "Leave" in the schedule, or should some (e.g. Sick Leave) map to something more
      specific? Affects Team view's color coding (`locClass` already matches on "leave"
      generically, so this is a labeling choice, not a code blocker).
- [ ] **Decide how to match the Smartly requester to the right app user** — the email only
      has a display name ("Chang-Chien (Peter) Lin"), not an email address directly. Needs a
      reliable match against Firestore's `users` collection (`displayName`?), and a plan for
      what happens on a no-match (e.g. name spelled differently) — silently drop it, or flag
      it somewhere for a human to fix.
- [ ] **Resolve Entra ID admin consent** — whichever path (Graph Mail read, or a future direct
      Smartly API) will need a permission grant on the same Entra ID tenant used for sign-in.
      Peter to confirm whether he has Global Admin rights himself or needs to loop in IT.
- [ ] **Build the sync function** — a new serverless function (same pattern as
      `api/remind.js`) that reads new approved-leave notifications and writes `Leave` (or the
      mapped type) into that person's `schedules` doc for the affected day(s)/week(s).
- [ ] **Handle a leave request spanning a week boundary** — needs writing into more than one
      weekly `schedules` document if Start/End Date cross a Monday.
- [ ] **Decide conflict handling** — does approved leave overwrite whatever's already entered
      for that day, or only fill in blank days?
- [ ] **End-to-end test** with a real approved leave request once built.

## Excel sync (in progress)

Goal: both this app and the existing OneDrive/SharePoint Excel schedule stay editable and
in sync for now (not a one-way mirror yet — that's the eventual goal once people are fully
transitioned off Excel, but not yet).

File: `Cass & CHS SharePoint - Documents\CMCHS Files\Admin\Cass Admin\Staff Schedule\CMCHS Staff Schedule 2024.xlsx`
(a local, OneDrive/SharePoint-synced path — readable directly from this machine for
investigation, but the live sync itself will need Microsoft Graph API access since it must
work for everyone, not just from this one machine).

Structure found so far: **one sheet per week**, named after that week's start date (e.g.
`28-Sept`), going back to January 2024 — sheet-name date formatting is inconsistent across
~2 years of manual maintenance (`08-APR-24`, `15-April-24`, `2-Sep-24`, some missing the year
entirely), plus a `Template (don't use)` sheet used as the copy-source for new weeks. Each
sheet is heavily merged-cell based (AM/PM rows per person, merged into one cell when both
halves match, e.g. a whole day/week of Leave or Non-Working Days).

- [ ] Finish inspecting one current-week sheet's actual cell values/fill colors (in progress)
      to nail down the exact column layout and color-to-status mapping before writing any
      sync code.
- [ ] Design the write path (app → Excel) and read path (Excel → app), and how conflicts are
      detected/resolved when both change around the same time.
- [ ] Design how a new week's sheet gets created to match (copy `Template (don't use)`?) so
      the app doesn't have to assume a sheet already exists for an upcoming week.
- [ ] Set up Graph API `Files.ReadWrite` access (needs the same Entra ID admin consent step
      as above).

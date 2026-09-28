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

## Excel sync (built, needs the manual setup steps + real-world testing)

Confirmed with Peter: **one-way (app → Excel)** for now, not full two-way — Excel has no
reliable per-cell change timestamp to resolve a genuine conflict with. People can still edit
Excel directly; those edits just don't flow back into the app yet. Matches Peter's own
stated eventual goal (Excel becomes read-only once the transition is complete).

File: `Cass & CHS SharePoint - Documents\CMCHS Files\Admin\Cass Admin\Staff Schedule\CMCHS Staff Schedule 2024.xlsx`.
Full design + what was learned about the workbook's actual structure (one sheet per week,
~140 of them, inconsistent sheet-naming — matched by date instead — AM/PM rows, D–H = Mon–Fri,
I = per-person Comments) is in `C:\Users\PeterLin\.claude\plans\atomic-baking-noodle.md`.

Code is in: `api/sync-excel.js` (new), triggered fire-and-forget from `MySchedule.jsx`'s
`saveSchedule()`, using each user's new `excelName` field (Admin → Users) to find their row.

- [x] Inspect the actual workbook structure (sheets, columns, merged cells, comments column).
- [x] Design + build the sync function, the `excelName` admin field, and the save-time trigger.
- [ ] **Grant `Files.ReadWrite` (Application) + admin consent** on the existing Azure app
      registration, and generate a new client secret for it (`AZURE_CLIENT_SECRET`).
- [ ] **Resolve `SHAREPOINT_SITE_ID`** via Graph Explorer — confirm this file is actually on a
      SharePoint site (not a personal OneDrive) and get its site ID.
- [ ] Set `AZURE_CLIENT_ID`, `SHAREPOINT_SITE_ID`, `EXCEL_FILE_PATH` in Vercel env vars.
- [ ] Set `excelName` for at least one real test user in Admin → Users.
- [ ] End-to-end test: save that user's schedule for the *current* week and confirm the Excel
      file actually updates; also test a week with no existing sheet yet (should skip
      cleanly, not error) and a user with no `excelName` set (should also skip cleanly).
- [ ] Not yet built, deliberately deferred: auto-creating a new week's sheet when one doesn't
      exist yet (currently just skips) — a v2 once the read/write path is proven solid.

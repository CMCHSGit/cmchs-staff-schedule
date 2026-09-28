# To do

Last updated: 2026-09-29

Every item has a permanent number — refer to it by that (e.g. "#7"). Numbers never change
when items are ticked off; new items take the next unused number.

## v2 design (Staff-Schedule_v2) — integrated 2026-09-29

New CHS look plus Team week, Day, Leave calendar and On-call views, admin tap-to-edit and
"Copy last week".

- [ ] **#1** **Publish the updated `firestore.rules`** in Firebase Console → Firestore → Rules.
      Until then, admins can't save other people's entries or the on-call roster (the app
      says so instead of failing silently). Everyone's own My week keeps working regardless.
- [ ] **#2** Decide whether regional anniversary days (Wellington, Canterbury…) should show too —
      only national holidays + Auckland Anniversary are built in (`src/utils/holidays.js`).
- [ ] **#3** Matariki dates are listed to 2032 — extend the table in `holidays.js` before then.
- [ ] **#4** Excel sync still writes text only, not the Excel fill colours — possible follow-up once
      the sync is live and proven.

## Smartly leave integration (parked — pick up later)

Goal: when staff leave is approved in Smartly, it should automatically populate into
their weekly schedule in this app (as "Leave", colored per the existing scheme) instead
of them re-entering it by hand.

Sample "Leave request Approved" email confirmed (from `no-reply@smartly.co.nz`, sent to the
requester themselves) — structured, parseable fields: Leave Requested By, Type (e.g. "Lieu
Taken"), Start Date, End Date, Hours Requested, Status, Comments.

- [ ] **#5** **Confirm Smartly's own API access** — check Smartly admin → Settings for an
      Integrations/API/Developer section; if nothing there, contact Smartly support directly
      to ask whether third-party API/webhook access for leave approvals exists at all, and
      what it needs (API key, OAuth, paid tier). This decides whether the whole
      email-parsing path below is even necessary, or if there's a cleaner direct API path.
- [ ] **#6** **If going the Outlook/email route instead**: the sample email went to the requester,
      not a shared inbox — reading every staff member's own mailbox would need broad,
      privacy-sensitive tenant-wide Graph API mail permissions. Check whether Smartly can
      also CC/BCC a shared address, or set up an Outlook inbox rule forwarding a copy of
      these notifications to one dedicated mailbox — much simpler and lower-privilege than
      reading everyone's inbox individually.
- [ ] **#7** **Collect more sample emails** before building a parser — specifically: a leave type
      other than "Lieu Taken" (e.g. Annual Leave, Sick Leave) to confirm the field layout
      stays consistent, and a "Declined" one too, so a decline can't be misread as approved.
- [ ] **#8** **Decide the leave-type → location-text mapping** — does every Smartly leave type just
      become "Leave" in the schedule, or should some (e.g. Sick Leave) map to something more
      specific? Affects the colour coding (`statusOf` in `src/utils/status.js` already matches
      "leave" generically, so this is a labelling choice, not a code blocker).
- [ ] **#9** **Decide how to match the Smartly requester to the right app user** — the email only
      has a display name (in "First (Nickname) Last" form), not an email address directly. Needs a
      reliable match against Firestore's `users` collection (`displayName`?), and a plan for
      what happens on a no-match (e.g. name spelled differently) — silently drop it, or flag
      it somewhere for a human to fix.
- [ ] **#10** **Resolve Entra ID admin consent** — whichever path (Graph Mail read, or a future direct
      Smartly API) will need a permission grant on the same Entra ID tenant used for sign-in.
      Peter to confirm whether he has Global Admin rights himself or needs to loop in IT.
- [ ] **#11** **Build the sync function** — a new serverless function (same pattern as
      `api/remind.js`) that reads new approved-leave notifications and writes `Leave` (or the
      mapped type) into that person's `schedules` doc for the affected day(s)/week(s).
- [ ] **#12** **Handle a leave request spanning a week boundary** — needs writing into more than one
      weekly `schedules` document if Start/End Date cross a Monday.
- [ ] **#13** **Decide conflict handling** — does approved leave overwrite whatever's already entered
      for that day, or only fill in blank days?
- [ ] **#14** **End-to-end test** with a real approved leave request once built.

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

- [x] **#15** Inspect the actual workbook structure (sheets, columns, merged cells, comments column).
- [x] **#16** Design + build the sync function, the `excelName` admin field, and the save-time trigger.
- [x] **#17** **`Files.ReadWrite.All` (Application) permission added** to the Azure app registration
      (2026-09-28) — but **blocked on admin consent**: Peter isn't a Global Admin, and the IT
      person who is was away the day this was tried. Azure Portal → the app registration →
      API permissions shows it listed with Status "⚠ Not granted for Cass Medical Limited" —
      whoever has admin rights just needs to open that same page and click "Grant admin
      consent for Cass Medical Limited" (no need to re-add the permission, it's already
      there). Client secret not created yet either — do that at the same time (Certificates
      & secrets → New client secret → copy the Value into `AZURE_CLIENT_SECRET`).
- [ ] **#18** **IT to grant admin consent + create the client secret** (see #17) — the one
      step still blocking Excel sync going live.
- [x] **#19** **`SHAREPOINT_SITE_ID` resolved (2026-09-28)** via Graph Explorer — confirmed this file
      is on a SharePoint site (`cassmedical.sharepoint.com`, site `CassCHSDocument`), not a
      personal OneDrive. Real value isn't written here (public repo) — Peter has it, goes
      straight into Vercel's env vars, not this file.
- [x] **#20** **Switched to item-ID addressing (2026-09-28)**: rather than guessing the file's path
      within the document library, `EXCEL_ITEM_ID` (the file's own permanent ID, pulled from
      its SharePoint share link's `sourcedoc={...}` parameter) is more robust — survives the
      file being renamed/moved. `api/sync-excel.js`/`.env.example`/README updated to match;
      `EXCEL_FILE_PATH` no longer exists, superseded by this.
- [ ] **#21** Set `AZURE_CLIENT_ID`, `SHAREPOINT_SITE_ID`, `EXCEL_ITEM_ID` in Vercel env vars (values
      already in hand from the above — just needs typing into Vercel, and can happen before
      the admin-consent step below, since these three don't need it).
- [ ] **#22** Set `excelName` for at least one real test user in Admin → Users.
- [ ] **#23** End-to-end test: save that user's schedule for the *current* week and confirm the Excel
      file actually updates; also test a week with no existing sheet yet (should skip
      cleanly, not error) and a user with no `excelName` set (should also skip cleanly).
- [ ] **#24** Not yet built, deliberately deferred: auto-creating a new week's sheet when one doesn't
      exist yet (currently just skips) — a v2 once the read/write path is proven solid.

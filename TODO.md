# To do

Last updated: 2026-10-15

Every item has a permanent number — refer to it by that (e.g. "#7"). Numbers never change
when items are ticked off; new items take the next unused number.

## v2 design (Staff-Schedule_v2) — integrated 2026-09-29

New CHS look plus Team week, Day, Leave calendar and On-call views, admin tap-to-edit and
"Copy last week". Since then: Team week's Comments column is its own button, customer calls
are rostered per day on the On-call page instead of being ticked by each person, and tapping
a date in the Leave calendar books leave for a person over a date range. Tapping a day in
Team week now opens that person's whole week, not just the day tapped, and Team week's
desktop grid is Excel-style: click and type, drag or Shift-click to select a range, and
Ctrl+C/Ctrl+V to copy and paste a block — including to and from Excel itself. Click a
person's name for the whole-week panel (quick fills, clearing the week, their comment).
Team week is now the landing page — My week moved to `/my`, Team week took over `/` — and
its "things to check this week" conflicts banner is gone. The Thursday reminder's links now
point at `/my` specifically, so that call-to-action still lands people on their own schedule
rather than on Team week. Team week's desktop grid is noticeably more compact — tighter
rows and group headers — and each person's name is a small initials-avatar pill rather than
a plain label. Every schedule, leave, on-call and Admin change is now logged (who, when,
what) to Admin's new password-protected Activity log tab. Every page's top is more compact
too (tighter gaps between the title, week nav, filters and the leave pin). The Leave
calendar's booking panel groups a person's consecutive leave into one "Already booked" row
— covering the whole run, not just the day tapped — with its own edit (adjust the dates;
shrinking it clears what's no longer covered) and delete (clears the whole run in one go,
no longer one day at a time).

- [x] **#1** **Publish the updated `firestore.rules`** (done 2026-09-29) in Firebase Console → Firestore → Rules.
      Until then, admins can't save other people's entries, the on-call roster or the
      customer-calls cover that now lives on it, and can't book leave for anyone else (the
      app says so instead of failing silently). Everyone's own My week, their own comment
      and their own leave booking keep working regardless.
- [ ] **#2** Decide whether regional anniversary days (Wellington, Canterbury…) should show too —
      only national holidays + Auckland Anniversary are built in (`src/utils/holidays.js`).
- [ ] **#3** Matariki dates are listed to 2032 — extend the table in `holidays.js` before then.
- [ ] **#4** Excel sync still writes text only, not the Excel fill colours — possible follow-up once
      the sync is live and proven.
- [ ] **#31** **Publish the updated `firestore.rules`** again — the new `activity` collection
      (Admin → Activity log) needs its own rule. Until then, every save still works (logging
      fails silently in the background, per-action, the same way the Excel mirror does), but
      the log itself stays empty and Admin → Activity log shows a banner saying so.
      The same publish also covers `maintenance` (internal.chsnz.co.nz/maintenance/) and
      `serviceOrders` (internal.chsnz.co.nz/service-orders/), added 2026-10-12. Paste the
      **whole file** into the console, never a single block: publishing replaces every rule.

## Excel → app (built 2026-10-05; the automatic part needs IT)

**Admin → Excel** imports from the workbook on demand (see README §4b). Run it whenever the
Excel has changed. Everything below is about making it automatic.

- [ ] **#32** **Automatic Excel → app link, every 15 minutes.** Needs IT to let the app *read*
      the workbook from Microsoft: an Entra ID admin consent for `Files.Read.All`, or the
      narrower `Sites.Selected` (read) granted on that one SharePoint site only. Read-only is
      enough for this direction, so it's an easier ask than the read/write one in #18. Then
      the existing `scripts/sync-excel.mjs` job can download the workbook (`GET .../content`),
      read it with `src/utils/excelSchedule.js` and merge it with `src/utils/excelPlan.js` —
      the same code the Admin screen uses — and, if write access is granted too, copy app
      changes back using the same remembered-values (`excelBase`) idea, so neither side
      overwrites the other. Alternative with no IT involvement: run that job from your PC on a
      Windows schedule against the OneDrive-synced file (needs the PC on, and a Firebase
      service-account key kept on it).
      **Built 2026-10-15 in the hub repo** (`apps/schedule/scripts/excel-import.mjs`, setup in
      `apps/schedule/EXCEL-IMPORT.md`), tested against the real workbook read-only. To switch it on:
      create the Firebase key and the config file on the PC, do a dry run, then install the task.
      The Graph version above is still the better long-term home (no PC needed).
- [ ] **#33** The Excel's `19-Aug-24` tab has the wrong week typed in its header (it repeats the
      week before), so it's skipped when importing history. Fix the date in the Excel if that week matters.
- [ ] **#34** Known gap: when a "not signed in yet" person signs in, their schedules move across
      but on-call / customer-calls assignments pointing at the placeholder don't (those can only be
      changed by an admin). The On-call page still shows the name; re-pick them there if it matters.

## Move off Vercel to GitHub only (live on GitHub Pages since 2026-09-29)

Code is done (`.github/workflows/`, `scripts/`); these are the setup steps.

- [x] **#25** Add the Actions secrets (Settings → Secrets and variables → Actions) — see README §6.
- [x] **#26** Pages → Source "GitHub Actions", then Actions → "Deploy site" → Run workflow; check it goes green.
- [x] **#27** Pages custom domain `schedule.chsnz.co.nz` + DNS CNAME → `cmchsgit.github.io`.
- [ ] **#28** Test sign-in, saving, and a manual run of "Thursday reminder" on the new site.
- [ ] **#29** Delete the Vercel project once the new site has worked for a few days.
- [ ] **#30** Optional: email reminders — sign up at resend.com, verify `chsnz.co.nz` (DNS
      records, maybe with IT), then add `RESEND_API_KEY` + `RESEND_FROM` secrets. Until then
      the Thursday reminder is push-notification only.

## Retire schedule.chsnz.co.nz — the schedule's home is internal.chsnz.co.nz/schedule

Decided 2026-10-15: the app lives in the internal hub repo (`CMCHSGit/cmchs-internal-hub`, `apps/schedule`)
and `schedule.chsnz.co.nz` is to be retired. Until it is, this repo is only the rollback — **make new
changes in the hub repo**. The two copies are not synced and count versions separately. Both share the
same Firestore, so what people fill in shows on either address. The hub's README ("The schedule move is
mid-flight") has the reasoning behind the order below.

- [ ] **#35** **Move the Thursday reminder to the hub.** Copy `.github/workflows/remind.yml` and
      `scripts/remind.mjs` across (take the current `remind.mjs`, which now skips anyone switched off in the
      hub's Admin) with `APP_URL: https://internal.chsnz.co.nz/schedule` — **no trailing slash**, the script
      appends `/my`. Add the `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`
      secrets to the hub repo. Switch the old workflow off in the same step, so nobody is reminded twice.
- [ ] **#36** Watch two Thursdays from the hub. Read the printed `push N sent/M failed` line, not the green
      tick — the job's exit code only reflects email failures.
- [ ] **#37** Tell staff to switch: open `internal.chsnz.co.nz/schedule`, add it to the home screen again, and
      turn Thursday reminders on there (a phone's push registration belongs to the address the app was
      installed from, so everyone enrols again once).
- [ ] **#38** Retire the old site, **without removing its DNS**: ship a `sw.js` at the same path that unregisters
      itself and deletes its caches, plus a page pointing to the new address. Installed copies serve from their
      saved copy and write to the live database, so pulling the domain would leave people filling in an app
      we think is gone.
- [ ] **#39** Find the Firestore rules a home that outlasts this repo. They are `firestore.rules` at the root
      of this repo, published by pasting into the Firebase console. The hub's `CLAUDE.md` points at
      `chs-equipment/cmchs-staff-schedule/firestore.rules`, which doesn't exist — fix that pointer when
      they move. (Publishing the pending rules is #31.)
- [ ] **#40** Move the Excel job (`excel-sync.yml`, `scripts/sync-excel.mjs`) and the Excel items above
      (#4, #17–#24, #32) to wherever the schedule lives once the old repo goes.

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

Code is in `scripts/sync-excel.mjs`, run every 15 minutes by `.github/workflows/excel-sync.yml`.
Rows are matched by the name the app shows (first name, or full name where two share one).

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
      Tested 2026-10-15: the *delegated* (sign in as Peter) Files.ReadWrite.All was added too, but
      signing in gave "Need admin approval" — the tenant blocks user consent, so there is no
      way round IT for writing to the shared workbook. When IT is back, one click does it:
      "Grant admin consent for Cass Medical Limited" on the app's API permissions page, plus a
      new client secret.
- [x] **#19** **`SHAREPOINT_SITE_ID` resolved (2026-09-28)** via Graph Explorer — confirmed this file
      is on a SharePoint site (`cassmedical.sharepoint.com`, site `CassCHSDocument`), not a
      personal OneDrive. Real value isn't written here (public repo) — Peter has it, goes
      straight into Vercel's env vars, not this file.
- [x] **#20** **Switched to item-ID addressing (2026-09-28)**: rather than guessing the file's path
      within the document library, `EXCEL_ITEM_ID` (the file's own permanent ID, pulled from
      its SharePoint share link's `sourcedoc={...}` parameter) is more robust — survives the
      file being renamed/moved. `api/sync-excel.js`/`.env.example`/README updated to match;
      `EXCEL_FILE_PATH` no longer exists, superseded by this.
- [ ] **#21** Set `AZURE_CLIENT_ID`, `SHAREPOINT_SITE_ID`, `EXCEL_ITEM_ID` in GitHub Actions secrets (values
      already in hand from the above — just needs typing into Vercel, and can happen before
      the admin-consent step below, since these three don't need it).
- [x] **#22** ~~Set `excelName` for a test user~~ — no longer needed (2026-09-29): rows now match
      by the name the app shows, and the Excel name field was removed from Admin.
- [ ] **#23** End-to-end test: save that user's schedule for the *current* week and confirm the Excel
      file actually updates; also test a week with no existing sheet yet (should skip
      cleanly, not error) and someone whose name isn't in the sheet (should also skip cleanly).
- [ ] **#24** Not yet built, deliberately deferred: auto-creating a new week's sheet when one doesn't
      exist yet (currently just skips) — a v2 once the read/write path is proven solid.

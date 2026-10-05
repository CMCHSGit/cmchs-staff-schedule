# CMCHS Staff Schedule — Setup Guide

A PWA for team weekly location scheduling. Built with React + Firebase, hosted entirely on GitHub (Pages + Actions).

---

## Stack
- **Frontend**: React (Vite) — PWA, installable from browser
- **Auth**: Firebase Auth with Microsoft (Entra ID / Azure AD) as the provider
- **Database**: Firebase Firestore
- **Hosting**: GitHub Pages, built and published by GitHub Actions on every push to `main`
- **Background jobs**: GitHub Actions on a timer — Thursday reminder, Excel sync every 15 min
- **Reminders**: push notification (Firebase Cloud Messaging) + email (Resend), sent every Thursday morning NZ time
- **Excel sync**: one-way (app → Excel), mirrors saves into the existing company Excel schedule via Microsoft Graph

---

## 1. Firebase setup

1. Go to [Firebase Console](https://console.firebase.google.com) → New project
2. Add a **Web app** → copy the config values into your `.env` (the `VITE_FIREBASE_*` keys)
3. Enable **Firestore** (production mode)
4. Deploy the security rules: `firebase deploy --only firestore:rules`
5. Enable **Authentication** → Sign-in methods → **Microsoft** provider
6. Go to **Project Settings → Cloud Messaging → Web configuration → Generate key pair**
   → copy the value into `VITE_FIREBASE_VAPID_KEY` in your `.env`. This is what lets the app
   register a device for push notifications; it's a public key, safe to expose client-side.

---

## 2. Azure / Microsoft Entra ID setup

> This lets your company's Microsoft accounts sign in.

1. Go to [Azure Portal](https://portal.azure.com) → **Entra ID** → **App registrations** → New registration
2. Name: `CMCHS Staff Schedule`
3. Supported account types: **Accounts in this organizational directory only** (single tenant)
4. Redirect URI: `https://your-project.firebaseapp.com/__/auth/handler` (Web platform)
   - Also add `http://localhost:5173/__/auth/handler` for local dev
5. After creation, copy the **Directory (tenant) ID** → `VITE_AZURE_TENANT_ID` in `.env`
6. In Firebase Console → Authentication → Microsoft → paste in the **Application (client) ID** and a **Client Secret** (create one under Certificates & Secrets in Azure)
7. Copy the **Application (client) ID** into `AZURE_CLIENT_ID` too — Excel sync (below) reuses
   this same app registration rather than needing a second one

---

## 3. Resend setup (email reminders)

1. Sign up at [resend.com](https://resend.com) — free tier is plenty
2. Add and verify your company domain (follow their DNS instructions)
3. Create an API key → `RESEND_API_KEY`
4. Set `RESEND_FROM` to something like `CMCHS Staff Schedule <noreply@yourcompany.com>`

---

## 4. Excel sync setup (optional)

Mirrors every schedule save into the existing company Excel schedule — **one-way**
(app → Excel), so people can still edit that file directly and this never overwrites their
edits, it only ever fills in from the app's side. Skip this whole section if that file
doesn't exist for your deployment.

1. In the same Azure app registration from step 2 — **API permissions** → Add a permission →
   **Microsoft Graph** → **Application permissions** → `Files.ReadWrite.All` → have an admin
   grant consent (broader than strictly necessary — grants every site in the tenant, not just
   this one file. The narrower alternative is `Sites.Selected` + a separate per-site grant)
2. **Certificates & secrets** → New client secret → copy the value into `AZURE_CLIENT_SECRET`
   (a separate secret from whichever one Firebase Auth's sign-in uses — keeps them
   independently revocable)
3. Resolve the SharePoint site ID via [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer)
   (sign in with a real account first, not the sample one it defaults to):
   `GET https://graph.microsoft.com/v1.0/sites/{hostname}:/sites/{site-path}` → copy the
   returned `id` into `SHAREPOINT_SITE_ID`
4. Set `EXCEL_ITEM_ID` to the file's own item ID — open it in SharePoint, copy its share link,
   and pull the value out of the `sourcedoc={...}` parameter (strip the curly braces). More
   reliable than a folder path, since it still works even if the file gets renamed or moved.
5. Nothing to set per person: rows are matched by the name the app shows (first name, or full
   name where two people share one), which is how the sheet's Name column is written. Anyone
   whose name isn't in that week's sheet is simply skipped (not an error)

---

## 4b. Importing from the Excel schedule (Admin → Excel)

Fills the schedule from the company workbook, so people who still update the Excel show up
in the app. The admin chooses the `.xlsx` (e.g. the OneDrive-synced copy); it's read in the
browser, nothing is uploaded except the resulting entries, and **nothing is written until
Import is pressed** — the screen shows what would change first.

- **Reading** (`src/utils/excelSchedule.js`): finds each week from the Monday date in the
  sheet's header (sheet names are inconsistent), and each person from the AM/PM label column, so
  it copes with both layouts in the file (with and without the team-label column). An AM/PM
  split becomes one entry ("Waikato / Cass Office"); "Name - OnCall" sets that week's on-call.
- **People** (`excelPlan.js`): matched by an Excel name set on the person, else full name, else
  first name *within the same team* (so two people sharing a first name aren't confused).
  Anyone ambiguous is left for the admin to pick. A *close* name — Mike / Michael, Jess /
  Jessica, Jo-ann / Joann, Andy / Andrew — is marked **Check** with the likely person offered
  first in the dropdown: it's never matched on a guess, and never added as a duplicate. People
  on the newest sheet who aren't in the app at all are added as "not signed in yet"
  (switchable); people who only appear in old weeks have left, so they aren't.
- **Safe to run again and again.** Each imported entry remembers what the Excel said
  (`excelBase`). Next time: an app entry still equal to that is untouched in the app, so a
  change in the Excel flows in; an app entry that differs was edited in the app, so it's kept;
  only if both changed is it a conflict — listed, and the app wins unless "use the Excel's" is
  ticked. A blank Excel cell never clears an app entry.
- Imported entries don't set `submittedAt` ("saved in the app"), so the Excel copy job
  (`scripts/sync-excel.mjs`) doesn't write them straight back.
- Importing past weeks also fills in the **Out of town** report for those weeks.
- Real staff data never goes in this repo: the screen reads the file you choose, and tests use
  made-up workbooks and names. `npm test` runs them (`tests/excelImport.test.mjs`: reading both
  sheet layouts, name matching, and the merge rules).

---

## 4c. Out of town report (Out of town tab)

Works out the days the signed-in person spent out of Auckland from their schedule, and downloads
the **FBT vehicle unavailability report** the managers get: a plain-text file laid out exactly like
the one already being sent (`src/utils/fbtReport.js`; `tests/fbtReport.test.mjs` pins the layout,
including "Sept" for September). It is used by one person, so there's no person picker; the
vehicle is typed once and, like the list of Auckland places, remembered in the browser.

- **Out of town means out of Auckland** — that's where the person is based. A day at a site inside
  Auckland (NSH, Waitakere, Middlemore…) doesn't count. `AUCKLAND_PLACES` in
  `src/utils/outOfTown.js` lists Auckland-region names, and a place is in Auckland when one of them
  appears in it as whole words ("North Shore Hospital", "Middlemore Install"). Anything not listed
  — a new city, a customer in the Waikato — counts as out of town with no code change. The page
  shows the days it skipped, lets the list be edited, and has an "It's in Auckland" link on each
  record for a place the list missed. Franklin and Pukekohe are on the list (they're inside the
  Auckland Council area); take them off if those trips should count.
- **Quarters are the financial ones**: the year starts in April, so Jul-Sep is "Q2 (Jul-Sep) 2026"
  and Jan-Mar is Q4, as the report names them. The year is that of the months themselves.
- **Days are counted by their own date**, not by whichever quarter a week's Monday falls in. A
  week that crosses the start or end of a quarter is split between the two: Q2 begins on a
  Wednesday (1 Jul 2026), so Mon–Tue 29–30 Jun are in Q1 and 1–3 Jul in Q2. Every weekday lands in
  exactly one quarter, so reports for neighbouring quarters never drop or double-count a day
  (`npm test` checks that over several years).
- **What counts**: a day at a site or on a course outside Auckland. Office, remote, work from home,
  customer calls, non-working days, leave and public holidays don't. A public holiday is recognised
  however it's typed (`statusOf` in `src/utils/status.js`): left blank, "Public Holiday", by name
  ("Matariki Day", "Good Friday"), or shortened the way people do ("EASTER", "ANZAC", "Kings
  birthday NZ", "PH"). Names that can't be a place count wherever they appear; a word that could be
  one ("Waitangi", "Labour ward") is only the holiday on that holiday's own date (`namesHoliday` in
  `src/utils/holidays.js`), so a ward is still a ward. A place typed on a holiday still counts —
  someone was working there.
- **Records**: consecutive weekdays in the same place become one record (the place is its Notes
  line, then each date); a different place, or a day somewhere else in between, starts another.
  Each record can be unticked or have its notes edited before downloading; edits are dropped when
  the quarter changes. The page also previews the report text exactly as it will be saved.
- **Read the way Team week reads**: the person's weeks are found by the `uid` saved inside each
  schedule, not by guessing the document id, so the two pages always agree; if a week were ever
  stored twice, the most recently saved copy is used and a warning says so. **What was read from
  your schedule** lists every weekday as found and how it was counted (out of town / in Auckland /
  not out of town / blank), which is the quickest way to see why a day isn't on the report.

---

## 5. Local development

```bash
npm install
cp .env.example .env.local   # fill in your values
npm run dev
```

---

## 6. Deploy (GitHub Pages + Actions)

Everything runs from this GitHub repo — no other host.

1. **Settings → Secrets and variables → Actions → Secrets**: add every value from
   `.env.example` except `CRON_SECRET` and `APP_URL` (not needed any more). The `VITE_*` ones
   are used to build the site; the rest by the background jobs.
2. **Settings → Pages → Source: "GitHub Actions"**, custom domain `schedule.chsnz.co.nz`,
   Enforce HTTPS on. DNS: `schedule` is a CNAME to `cmchsgit.github.io`.
3. Push to `main` (or Actions → Deploy site → Run workflow) — `.github/workflows/deploy.yml`
   builds and publishes it.

Background jobs (`.github/workflows/`):
- **remind.yml** — Wednesday 20:00 UTC (= Thursday 08:00 NZST, the day the schedule is due):
  push + email to everyone who hasn't confirmed next week. Runs `scripts/remind.mjs`.
- **excel-sync.yml** — every 15 minutes, copies schedules saved since the last run into the
  Excel file (`scripts/sync-excel.mjs`). Off until the repo **variable**
  `EXCEL_SYNC_ENABLED` is set to `true`.
- GitHub's timer can run late at busy times, and pauses timed jobs after 60 days with no repo
  activity — each job re-enables itself on every run to prevent that.
- The repo is public, so **Action logs are public**: the scripts only ever print counts.
  Both jobs can be run by hand from the Actions tab (Run workflow) to test.

Push notifications need one opt-in per device: on **My week**, tap "Turn on" under "Get Thursday reminders" (Android:
works straight from the browser; iOS: only works once the app has been added to the Home
Screen, iOS 16.4+ — a banner walks people through that first). Email keeps going regardless, as
a fallback for anyone who hasn't opted in yet or whose device token has expired.

---

## 7. First-time admin setup

After deploying:

1. Sign in with your Microsoft account
2. In Firebase Console → Firestore → `users` collection → find your document → set `role` to `"admin"`
3. You'll now see the **Admin** tab in the app
4. Go to **Admin → Locations** and add your standard locations
5. Go to **Admin → Users** and assign everyone to their teams

---

## Data model

```
/users/{uid}
  displayName, email, team, role (user|admin), createdAt
  fcmTokens: [ ... ]           — optional, one per device with push enabled
  excelName                    — optional override for the name shown and matched in Excel;
                                  no longer editable in Admin (older records may still have it)
  pending: true                — added by an admin (Admin → People → Add a person) before they
                                  signed in; adopted automatically on their first sign-in

/locations/{id}
  name, order, active, createdAt

/schedules/{weekStart_uid}
  uid, displayName, email, team, weekStart (YYYY-MM-DD)
  days: [ { location }, × 5 ]   — Mon through Fri (default varies by team)
  comments                      — optional notes for the week, edited from Team week's
                                  Comments column or the box on My week
  submittedAt

/oncall/{weekStart}             — one doc per week, id = that Monday
  uid, displayName              — the engineer on call all week (null = unassigned)
  calls: [ uid, × 5 ]           — who covers customer calls each weekday ('' = nobody).
                                  Set on the On-call page, not by each person; days also
                                  carry a legacy onCall flag from before the roster existed
  updatedBy, updatedAt

Teams: Admin, Management, Engineers, Sales, Application (chosen on first sign-in, stored on user profile)
```

---

## Adding to home screen

**iOS**: Safari → Share button → "Add to Home Screen"
**Android**: Chrome → 3-dot menu → "Add to Home Screen" (or install banner appears automatically)

The app will open full-screen without browser chrome, like a native app.

---

## How phones get new versions

The app is saved on each device (a service worker, `src/sw.js`) so it opens instantly and works
offline. Left alone, a phone only looks for a new version when the app is freshly launched and
shows it one launch later — and an iPhone pauses the app moments after it leaves the screen,
which can cut the download short. So a phone could sit on an old version for days. To avoid that,
`src/utils/appUpdates.js`:

- asks for a newer version whenever the app comes back to the front, when the phone comes back
  online, and hourly while it's open;
- once a newer version has taken over, an **untouched** page reloads itself; a page that has been
  used shows an **"A new version is ready — Update"** banner (`UpdateBanner.jsx`), because a reload
  mid-edit would lose unsaved changes;
- **Account menu (initials) → Check for updates** does it on demand: it compares the page's script
  with the live site's and, if they differ and the automatic route is stuck, clears the saved copy
  of the app and reloads. It never unregisters the service worker — doing that would also cancel
  that device's push reminders.

The version number (bottom-right of every page) is the quickest way to tell which copy a device is
running. A phone on a version from before this existed (v56 or earlier) has none of the above: close
the app completely and reopen it twice, or delete the icon and add it to the Home Screen again.

---

## Cron reminder timing

Edit `.github/workflows/remind.yml` to change when reminders fire. Uses UTC cron syntax.

| NZT target | UTC cron |
|---|---|
| Thursday 8am NZT (NZST, UTC+12) | `0 20 * * 3` |
| Thursday 8am NZDT (UTC+13, daylight saving) | `0 19 * * 3` |

NZ observes daylight saving Oct–Apr. You may want to update this seasonally,
or send the cron at a time that's reasonable in both (e.g. 9am which is `0 20 * * 3` NZST or `0 21 * * 3` NZDT — pick the one that matters most).

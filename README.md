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
5. In the app, **Admin → Users**, set each person's **Excel name** — the first name exactly as
   it appears in that sheet's Name column. Anyone left blank is simply skipped (not an error)

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
  excelName                    — optional, first name as it appears in the Excel schedule;
                                  unset means this person is skipped by Excel sync

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

## Cron reminder timing

Edit `.github/workflows/remind.yml` to change when reminders fire. Uses UTC cron syntax.

| NZT target | UTC cron |
|---|---|
| Thursday 8am NZT (NZST, UTC+12) | `0 20 * * 3` |
| Thursday 8am NZDT (UTC+13, daylight saving) | `0 19 * * 3` |

NZ observes daylight saving Oct–Apr. You may want to update this seasonally,
or send the cron at a time that's reasonable in both (e.g. 9am which is `0 20 * * 3` NZST or `0 21 * * 3` NZDT — pick the one that matters most).

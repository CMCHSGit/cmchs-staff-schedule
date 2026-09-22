# Where This Week — Setup Guide

A PWA for team weekly location scheduling. Built with React + Firebase + Vercel.

---

## Stack
- **Frontend**: React (Vite) — PWA, installable from browser
- **Auth**: Firebase Auth with Microsoft (Entra ID / Azure AD) as the provider
- **Database**: Firebase Firestore
- **Hosting**: Vercel
- **Reminders**: push notification (Firebase Cloud Messaging) + email (Resend), sent every Thursday morning NZ time

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
2. Name: `Where This Week`
3. Supported account types: **Accounts in this organizational directory only** (single tenant)
4. Redirect URI: `https://your-project.firebaseapp.com/__/auth/handler` (Web platform)
   - Also add `http://localhost:5173/__/auth/handler` for local dev
5. After creation, copy the **Directory (tenant) ID** → `VITE_AZURE_TENANT_ID` in `.env`
6. In Firebase Console → Authentication → Microsoft → paste in the **Application (client) ID** and a **Client Secret** (create one under Certificates & Secrets in Azure)

---

## 3. Resend setup (email reminders)

1. Sign up at [resend.com](https://resend.com) — free tier is plenty
2. Add and verify your company domain (follow their DNS instructions)
3. Create an API key → `RESEND_API_KEY`
4. Set `RESEND_FROM` to something like `Where This Week <noreply@yourcompany.com>`

---

## 4. Local development

```bash
npm install
cp .env.example .env.local   # fill in your values
npm run dev
```

---

## 5. Deploy to Vercel

1. Push to GitHub
2. Import repo in [Vercel](https://vercel.com)
3. Add all env vars from `.env.example` under **Settings → Environment Variables**
   - The `VITE_*` vars go to **Production + Preview + Development**
   - The server-only vars (`FIREBASE_*`, `RESEND_*`, `CRON_SECRET`) go to **Production** only
4. Deploy

The cron job in `vercel.json` runs every Wednesday at 20:00 UTC (= Thursday 08:00 NZT — the
day the schedule is due). It pushes a notification and sends an email to everyone who hasn't
submitted their schedule for the coming week.

Push notifications need one opt-in per device: on **My schedule**, tap "🔔 Enable" (Android:
works straight from the browser; iOS: only works once the app has been added to the Home
Screen, iOS 16.4+ — a banner walks people through that first). Email keeps going regardless, as
a fallback for anyone who hasn't opted in yet or whose device token has expired.

---

## 6. First-time admin setup

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

/locations/{id}
  name, order, active, createdAt

/schedules/{weekStart_uid}
  uid, displayName, email, team, weekStart (YYYY-MM-DD)
  days: [ { location }, × 5 ]   — Mon through Fri (default varies by team)
  comments                      — optional notes for the week
  submittedAt

Teams: Admin, Management, Engineers, Sales, Application (chosen on first sign-in, stored on user profile)
```

---

## Adding to home screen

**iOS**: Safari → Share button → "Add to Home Screen"
**Android**: Chrome → 3-dot menu → "Add to Home Screen" (or install banner appears automatically)

The app will open full-screen without browser chrome, like a native app.

---

## Cron reminder timing

Edit `vercel.json` to change when reminders fire. Uses UTC cron syntax.

| NZT target | UTC cron |
|---|---|
| Thursday 8am NZT (NZST, UTC+12) | `0 20 * * 3` |
| Thursday 8am NZDT (UTC+13, daylight saving) | `0 19 * * 3` |

NZ observes daylight saving Oct–Apr. You may want to update this seasonally,
or send the cron at a time that's reasonable in both (e.g. 9am which is `0 20 * * 3` NZST or `0 21 * * 3` NZDT — pick the one that matters most).

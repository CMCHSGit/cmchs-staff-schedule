/**
 * api/remind.js — Vercel Serverless Function
 *
 * Triggered by Vercel Cron (see vercel.json).
 * Runs every Thursday at 08:00 NZ time (Wed 20:00 UTC) — the day the schedule is due.
 *
 * Logic:
 *  1. Fetch all users from Firestore
 *  2. Find the upcoming Monday (next week's start)
 *  3. Check who has NOT yet submitted a schedule for that week
 *  4. Send a reminder to each via push (FCM) AND email (Resend) — push is the
 *     immediate phone alert, email is the fallback if push isn't set up on
 *     their device or a token has gone stale
 *
 * Required env vars (set in Vercel project settings):
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY
 *   RESEND_API_KEY
 *   RESEND_FROM          e.g. "Where This Week <noreply@yourcompany.com>"
 *   CRON_SECRET          a random secret to protect the endpoint
 *   APP_URL              e.g. "https://wherethisweek.vercel.app"
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue }      from 'firebase-admin/firestore'
import { getMessaging }                  from 'firebase-admin/messaging'

function initFirebase() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    })
  }
}

function getDB() {
  initFirebase()
  return getFirestore()
}

function nextMonday() {
  const d = new Date()
  const day = d.getDay()
  const daysUntilMonday = day === 0 ? 1 : 8 - day
  d.setDate(d.getDate() + daysUntilMonday)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function formatWeekLabel(weekStart) {
  const weekDate = new Date(weekStart + 'T00:00:00')
  const end = new Date(weekDate)
  end.setDate(end.getDate() + 4)
  const fmt = (d) => d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'long' })
  return `${fmt(weekDate)} – ${fmt(end)}`
}

async function sendReminderEmail(to, name, weekStart) {
  const weekLabel = formatWeekLabel(weekStart)

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from:    process.env.RESEND_FROM,
      to:      [to],
      subject: `Where are you next week? (${weekLabel})`,
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
          <h2 style="font-size: 20px; margin-bottom: 8px;">Hi ${name || 'there'} 👋</h2>
          <p style="color: #555; line-height: 1.6; margin-bottom: 24px;">
            You haven't filled out your location schedule for <strong>${weekLabel}</strong> yet.
            It only takes a minute — let the team know where you'll be each day.
          </p>
          <a href="${process.env.APP_URL}"
             style="display: inline-block; background: #111; color: #fff; text-decoration: none;
                    padding: 12px 24px; border-radius: 8px; font-size: 15px; font-weight: 500;">
            Fill out my schedule →
          </a>
          <p style="color: #999; font-size: 13px; margin-top: 32px;">
            You're receiving this because you're part of the Where This Week team tracker.
          </p>
        </div>
      `,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Resend error for ${to}: ${err}`)
  }
}

const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
])

/** Pushes to every token on file for a user, pruning any that have gone stale. */
async function sendPushToUser(db, user, weekStart) {
  const tokens = user.fcmTokens || []
  if (tokens.length === 0) return { sent: 0, failed: 0 }

  const weekLabel = formatWeekLabel(weekStart)
  const response = await getMessaging().sendEachForMulticast({
    tokens,
    notification: {
      title: 'Where are you next week?',
      body:  `You haven't filled out your schedule for ${weekLabel} yet.`,
    },
    data: { url: process.env.APP_URL },
  })

  const deadTokens = response.responses
    .map((r, i) => (!r.success && DEAD_TOKEN_CODES.has(r.error?.code) ? tokens[i] : null))
    .filter(Boolean)

  if (deadTokens.length > 0) {
    await db.collection('users').doc(user.uid).update({
      fcmTokens: FieldValue.arrayRemove(...deadTokens),
    })
  }

  return { sent: response.successCount, failed: response.failureCount }
}

export default async function handler(req, res) {
  // Protect the endpoint — Vercel passes the secret automatically for cron
  const authHeader = req.headers['authorization']
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const db        = getDB()
    const weekStart = nextMonday()

    // Load all users
    const usersSnap = await db.collection('users').get()
    const users = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }))

    // Load submitted schedules for next week
    const schedulesSnap = await db.collection('schedules')
      .where('weekStart', '==', weekStart)
      .get()
    const submittedUids = new Set(schedulesSnap.docs.map(d => d.data().uid))

    // Filter to users who haven't submitted
    const pending = users.filter(u => u.email && !submittedUids.has(u.uid))

    const emailResults = await Promise.allSettled(
      pending.map(u => sendReminderEmail(u.email, u.displayName?.split(' ')[0], weekStart))
    )
    const pushResults = await Promise.allSettled(
      pending.map(u => sendPushToUser(db, u, weekStart))
    )

    const sent   = emailResults.filter(r => r.status === 'fulfilled').length
    const failed = emailResults.filter(r => r.status === 'rejected').length

    const pushSent   = pushResults.reduce((n, r) => n + (r.status === 'fulfilled' ? r.value.sent : 0), 0)
    const pushFailed = pushResults.reduce((n, r) => n + (r.status === 'fulfilled' ? r.value.failed : 1), 0)

    console.log(`Reminders for week ${weekStart}: email ${sent} sent/${failed} failed, push ${pushSent} sent/${pushFailed} failed`)
    return res.status(200).json({ weekStart, sent, failed, pushSent, pushFailed, total: pending.length })

  } catch (err) {
    console.error('Reminder job failed:', err)
    return res.status(500).json({ error: err.message })
  }
}

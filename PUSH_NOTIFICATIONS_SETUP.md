# Push Notifications — Live Setup (Vercel Hobby-compatible)

This makes real, scheduled push notifications work on your actual live
site, entirely on free tiers. Three things need setting up: a Firebase
service account, environment variables in Vercel, and a free external
cron pinger.

## 1. Get a Firebase service account key (free)
1. Firebase console → your project → ⚙️ Project Settings → **Service Accounts** tab.
2. Click **Generate new private key**. This downloads a `.json` file.
3. Keep this file secret — it grants full admin access to your Firebase project. Never commit it to GitHub.

## 2. Set environment variables in Vercel
Go to your Vercel project → **Settings → Environment Variables** and add:

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | `BCtdAjE98ju0YYyGr3NvvIPERSaTxTX_Q1-ctML7w6Zuel8bt2WadSduzeH2S6BXBzP3LdpWq6N7NwCl6LJ-3e0` |
| `VAPID_PRIVATE_KEY` | `GtYUkeSDAYa4uoKtc06bv97uw4YytsqINo83chkEf7E` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | the ENTIRE contents of the service account `.json` file from step 1, pasted as one line |
| `CRON_SECRET` | any long random string you make up (e.g. `openssl rand -hex 32`, or just mash your keyboard) — this stops random people from triggering your send endpoint |

These VAPID keys are a real, working key pair generated specifically for
this project — you can use them as-is, or generate your own fresh pair if
you'd rather (any `web-push` VAPID key generator works the same way).

Redeploy after adding the environment variables — Vercel only picks them up on a new deployment.

## 3. Set up the free cron pinger
1. Go to **cron-job.org** and create a free account.
2. Create a new cron job:
   - **URL:** `https://x-musk.vercel.app/api/check-scheduled-pushes?secret=YOUR_CRON_SECRET` (use the same value you set for `CRON_SECRET`)
   - **Schedule:** every 1 minute
3. Save it. That's it — cron-job.org will now hit that URL every minute, and your endpoint checks Firestore for anything due and sends it.

## How it works end-to-end
1. A user clicks the 🔔 bell icon in the nav bar → `enablePushNotifications()` in `push.js` runs → browser asks for permission → subscribes → the subscription is saved to Firestore (`pushSubscriptions/{id}`).
2. Something schedules a reminder — right now this happens automatically when someone RSVPs to an event (1 hour before start) via `maybeScheduleEventReminder()` in `feed.js`. This just writes a plain record to `scheduledPushes/{id}`.
3. Once a minute, cron-job.org calls `/api/check-scheduled-pushes`. That function (using the Firebase Admin SDK + your service account) checks for anything due, sends it via `web-push`, and marks it sent.
4. The browser's service worker (`sw.js`) receives the push and shows the notification — even if every tab is closed.

## Adding your own "schedule a notification" moments
Anywhere else in the app, just call:
```js
schedulePushNotification(title, body, sendAtMs, url);
```
- `sendAtMs` — a future timestamp in milliseconds (`Date.now() + ...`)
- `url` — optional, the in-app path to open when the notification is tapped

It silently does nothing if the current user hasn't enabled notifications, so it's always safe to call.

## Notes / limits
- Firestore Spark (free) plan limits: 50K reads / 20K writes per day. A once-a-minute check that finds nothing due is still 1 read — 1,440 reads/day just from the cron job, which is nowhere near the free limit.
- `check-scheduled-pushes.js` processes up to 50 due notifications per run to stay well inside Vercel's function time limit — fine for normal use, but if you ever have bursts of hundreds scheduled for the exact same minute, some would roll to the next run instead.
- If a subscription becomes invalid (user cleared browser data, uninstalled, etc.), the send fails with a 404/410 and the code automatically deletes that subscription — no manual cleanup needed.

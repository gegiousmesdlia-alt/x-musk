/* push.js — X Club — Web Push subscribe + schedule
 *
 * How this fits together:
 *  - enablePushNotifications() registers the service worker, subscribes
 *    via the browser's Push API, and saves the subscription to Firestore
 *    (pushSubscriptions/{id}) using the app's normal client-side write —
 *    same as any other user data.
 *  - schedulePushNotification(...) just writes a plain record to
 *    scheduledPushes/{id}: { subscriptionId, title, body, sendAt, sent:false }.
 *    Nothing sends anything at this point — it's just a row sitting in
 *    Firestore, same as a scheduled post.
 *  - The actual SENDING happens entirely server-side, in
 *    api/check-scheduled-pushes.js, triggered once a minute by an external
 *    free cron service. This file never calls that endpoint directly —
 *    it doesn't need to, and doesn't have the credentials to.
 */

'use strict';

// Public key only — safe to ship in client code, this is what it's for.
const VAPID_PUBLIC_KEY = 'BCtdAjE98ju0YYyGr3NvvIPERSaTxTX_Q1-ctML7w6Zuel8bt2WadSduzeH2S6BXBzP3LdpWq6N7NwCl6LJ-3e0';

function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

function isPushEnabled() {
  return !!localStorage.getItem('xclub_push_sub_id');
}

async function enablePushNotifications() {
  if (!pushSupported()) { showToast('Push notifications aren\'t supported on this browser/device'); return false; }
  if (!currentUser) { requireVerified('enable notifications'); return false; }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') { showToast('Notification permission was not granted'); return false; }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const ref = await window.XF.push('pushSubscriptions', {
      uid: currentUser.uid,
      subscription: JSON.parse(JSON.stringify(subscription)),
      createdAt: Date.now(),
    });
    localStorage.setItem('xclub_push_sub_id', ref.key);
    showToast('Notifications enabled!');
    return true;
  } catch (err) {
    console.error('[push] enable failed:', err);
    showToast('Could not enable notifications — try again');
    return false;
  }
}

async function disablePushNotifications() {
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
  } catch (e) {}
  const subId = localStorage.getItem('xclub_push_sub_id');
  if (subId) { window.XF.remove('pushSubscriptions/' + subId).catch(() => {}); }
  localStorage.removeItem('xclub_push_sub_id');
  showToast('Notifications turned off');
}

// title/body: strings. sendAtMs: epoch ms in the future. url: optional
// in-app path to open when the notification is clicked.
async function schedulePushNotification(title, body, sendAtMs, url) {
  const subId = localStorage.getItem('xclub_push_sub_id');
  if (!subId) return false; // not subscribed — nothing to schedule against
  try {
    await window.XF.push('scheduledPushes', {
      subscriptionId: subId,
      title, body,
      sendAt: sendAtMs,
      url: url || '/feed.html',
      sent: false,
      createdAt: Date.now(),
    });
    return true;
  } catch (err) {
    console.error('[push] schedule failed:', err);
    return false;
  }
}

/* ── Nav bell button ─────────────────────────────────────────────────── */
function updatePushNavIcon() {
  const icon = document.getElementById('pushToggleIcon');
  if (icon) icon.textContent = isPushEnabled() ? '🔔' : '🔕';
}

async function togglePushFromNav() {
  if (isPushEnabled()) {
    await disablePushNotifications();
  } else {
    await enablePushNotifications();
  }
  updatePushNavIcon();
}

document.addEventListener('DOMContentLoaded', updatePushNavIcon);

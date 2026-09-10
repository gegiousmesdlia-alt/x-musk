// api/profile.js — Vercel Serverless Function
// Serves a dynamic Open Graph preview page for ?user=HANDLE links.
// When WhatsApp / iMessage / Twitter / Discord scrapes the URL, they hit
// this endpoint and get a proper preview card instead of a blank page.
//
// URL pattern:  /api/profile?user=HANDLE  (or /u/HANDLE via vercel.json rewrite)

const https = require('https');

const FIREBASE_DB_URL = 'https://x-club-413fa-default-rtdb.europe-west1.firebasedatabase.app';
const SITE_NAME       = 'X-Musk Financial Club';
const SITE_URL        = 'https://x-club-one.vercel.app';
const SITE_TAGLINE    = 'The Ultra-Premium Investor Network';

// Fetch JSON from Firebase REST API (no auth needed for public read rules)
function fbGet(path) {
  return new Promise((resolve, reject) => {
    const url = `${FIREBASE_DB_URL}/${path}.json`;
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(null); }
      });
    }).on('error', reject);
  });
}

// Proxy a remote image through this function so crawlers (WhatsApp, Facebook,
// Discord) can fetch it — they often block Firebase Storage URLs directly.
function proxyImage(req, res) {
  const imgUrl = req.query.__img;
  if (!imgUrl) { res.statusCode = 400; res.end(); return; }
  try {
    const parsed = new URL(imgUrl);
    const allowed = ['firebasestorage.googleapis.com', 'lh3.googleusercontent.com'];
    if (!allowed.some(h => parsed.hostname.endsWith(h))) {
      res.statusCode = 403; res.end(); return;
    }
    https.get(imgUrl, imgRes => {
      res.statusCode = 200;
      res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      imgRes.pipe(res);
    }).on('error', () => { res.statusCode = 502; res.end(); });
  } catch (e) {
    res.statusCode = 400; res.end();
  }
}

function formatCount(n) {
  if (!n || isNaN(n)) return '0';
  n = Number(n);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// FIX: use pure Node http style throughout — mixing res.setHeader() with
// res.status().send() (Express style) crashes Vercel serverless functions.
function sendHtml(res, html) {
  const buf = Buffer.from(html, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
  });
  res.end(buf);
}

module.exports = async (req, res) => {
  // ── Image proxy mode ─────────────────────────────────────────────────────
  if (req.query.__img) { proxyImage(req, res); return; }

  const handle   = (req.query.user || '').toLowerCase().trim();
  const uidParam = (req.query.uid  || '').trim();

  // ── Resolve UID from handle ──────────────────────────────────────────────
  let uid = uidParam;
  if (!uid && handle) {
    uid = await fbGet(`handles/${handle}`);
  }

  // ── Load user profile ────────────────────────────────────────────────────
  let profile = null;
  if (uid && typeof uid === 'string') {
    profile = await fbGet(`users/${uid}`);
  }

  // ── Fallback if user not found ───────────────────────────────────────────
  if (!profile || typeof profile !== 'object') {
    res.writeHead(302, { Location: SITE_URL });
    res.end();
    return;
  }

  const displayName  = escapeHtml(profile.displayName || 'Member');
  const userHandle   = escapeHtml(profile.handle || handle || '');
  const photoURL     = profile.photoURL || '';
  const followers    = formatCount(profile.followersCount || 0);
  const following    = formatCount(profile.followingCount || 0);
  const isVerified   = profile.verified === true;
  const verifiedMark = isVerified ? ' ✓' : '';

  // The link the user will actually open in the browser
  const profileAppURL = `${SITE_URL}/index.html?user=${encodeURIComponent(userHandle || uid)}`;

  // FIX: ogImage was defined but NEVER used in the OG meta tags (template used
  // bare photoURL directly, so users without a photo got no og:image at all).
  // Now always set — avatar is proxied so crawlers can actually fetch it.
  const ogImage = photoURL
    ? `${SITE_URL}/api/profile?__img=${encodeURIComponent(photoURL)}`
    : `${SITE_URL}/og-default.png`;

  const title       = `${displayName}${verifiedMark} — ${SITE_NAME}`;
  const description = `${followers} followers · ${following} following${profile.bio ? ' · ' + profile.bio.slice(0, 100) : ''} · Follow ${profile.displayName || 'them'} on ${SITE_NAME}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>

  <!-- ── Primary Meta ── -->
  <meta name="description" content="${escapeHtml(description)}">

  <!-- ── Open Graph (Facebook, WhatsApp, iMessage, LinkedIn, Discord) ── -->
  <meta property="og:type"         content="profile">
  <meta property="og:site_name"    content="${escapeHtml(SITE_NAME)}">
  <meta property="og:url"          content="${escapeHtml(profileAppURL)}">
  <meta property="og:title"        content="${escapeHtml(title)}">
  <meta property="og:description"  content="${escapeHtml(description)}">
  <meta property="og:image"        content="${escapeHtml(ogImage)}">
  <meta property="og:image:width"  content="400">
  <meta property="og:image:height" content="400">
  <meta property="profile:username" content="${escapeHtml(userHandle)}">

  <!-- ── Twitter / X Card ── -->
  <meta name="twitter:card"        content="summary">
  <meta name="twitter:site"        content="@XMuskClub">
  <meta name="twitter:title"       content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image"       content="${escapeHtml(ogImage)}">

  <!-- ── Redirect to the SPA (bots won't follow this) ── -->
  <meta http-equiv="refresh" content="0;url=${escapeHtml(profileAppURL)}">
  <link rel="canonical" href="${escapeHtml(profileAppURL)}">

  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#000;color:#e7e9ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .card{background:#111;border:1px solid #2f3336;border-radius:16px;padding:32px;
      max-width:400px;width:100%;text-align:center}
    .avatar{width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid #1d9bf0;margin-bottom:16px}
    .avatar-placeholder{width:80px;height:80px;border-radius:50%;background:#1d9bf0;
      display:inline-flex;align-items:center;justify-content:center;font-size:2rem;
      color:#fff;margin-bottom:16px}
    .name{font-size:1.3rem;font-weight:800;margin-bottom:4px}
    .handle{color:#71767b;font-size:0.9rem;margin-bottom:10px}
    .verified{color:#1d9bf0;font-size:0.85rem;margin-bottom:12px}
    .bio{color:#e7e9ea;font-size:0.9rem;line-height:1.5;margin-bottom:16px}
    .stats{display:flex;gap:24px;justify-content:center;margin-bottom:20px}
    .stat strong{display:block;font-size:1.1rem;font-weight:800}
    .stat span{font-size:0.78rem;color:#71767b}
    .cta{display:inline-block;background:#1d9bf0;color:#fff;padding:10px 28px;
      border-radius:9999px;font-weight:700;font-size:0.95rem;text-decoration:none;
      transition:background 0.15s}
    .cta:hover{background:#1a8cd8}
    .brand{margin-top:20px;font-size:0.75rem;color:#71767b}
  </style>
</head>
<body>
  <div class="card">
    ${photoURL
      ? `<img class="avatar" src="${escapeHtml(photoURL)}" alt="${displayName}" onerror="this.style.display='none'">`
      : `<div class="avatar-placeholder">${(profile.displayName || 'M')[0].toUpperCase()}</div>`
    }
    <div class="name">${displayName}${isVerified ? ' <span style="color:#1d9bf0">✓</span>' : ''}</div>
    <div class="handle">@${escapeHtml(userHandle)}</div>
    ${isVerified ? '<div class="verified">✓ Verified Member</div>' : ''}
    ${profile.bio ? `<div class="bio">${escapeHtml(profile.bio)}</div>` : ''}
    <div class="stats">
      <div class="stat"><strong>${followers}</strong><span>Followers</span></div>
      <div class="stat"><strong>${following}</strong><span>Following</span></div>
    </div>
    <a class="cta" href="${escapeHtml(profileAppURL)}">Follow ${displayName} →</a>
    <div class="brand">${escapeHtml(SITE_NAME)}</div>
  </div>
  <script>window.location.replace(${JSON.stringify(profileAppURL)});</script>
</body>
</html>`;

  sendHtml(res, html);
};

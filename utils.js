// utils.js — X Club v7 — Helpers, Theme, Lightbox, PWA, Particles, Loader
'use strict';

/* ─── DOM HELPER ─── */
function $(id) { return document.getElementById(id); }

/* ─── TIME ─── */
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

/* ─── AVATAR ─── */
function avatarHTML(p, size = 'md') {
  if (p?.photoURL) return `<img class="avatar avatar-${size}" src="${p.photoURL}" alt="">`;
  return `<div class="avatar avatar-${size}">${p?.displayName ? p.displayName.charAt(0).toUpperCase() : '?'}</div>`;
}

/* ─── VERIFIED BADGE ─── */
function verifiedBadge(v, lg = false) {
  if (!v) return '';
  return `<span class="verified-badge${lg ? ' lg' : ''}" title="Verified"><svg viewBox="0 0 12 12" fill="none" style="width:60%;height:60%"><polyline points="2,6 5,9 10,3" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
}

/* ─── TOAST ─── */
function showToast(msg) {
  const c = $('toastContainer'); if (!c) return;
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; c.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 3000);
}

/* ─── HTML ESCAPE ─── */
function escapeHTML(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ─── FORMAT COUNT ─── */
function formatCount(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

/* ─── CURRENCY SYMBOL ─── */
function currencySymbol(c) {
  return { NGN: '₦', USD: '$', GBP: '£', EUR: '€', GHS: '₵', KES: 'KSh', ZAR: 'R', TZS: 'TSh', UGX: 'USh', RWF: 'RF' }[c] || c || '€';
}

/* ─── REQUIRE AUTH ─── shows a sign-in/register popup instead of a hard
   redirect, so a guest browsing a shared profile/post isn't yanked away —
   they just get prompted the moment they try to DO something. ─────────── */
function requireVerified(action) {
  if (currentUser) return true;
  showAuthPrompt(action);
  return false;
}

function showAuthPrompt(action) {
  let modal = document.getElementById('authPromptModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'authPromptModal';
    modal.className = 'modal-overlay';
    modal.setAttribute('onclick', "if(event.target===this)this.classList.remove('open')");
    modal.innerHTML = `
      <div class="modal-card" style="max-width:360px;text-align:center;padding:32px 24px">
        <div style="font-size:2rem;margin-bottom:12px">🔒</div>
        <div id="authPromptText" style="font-weight:700;font-size:1.05rem;margin-bottom:8px">Sign in to continue</div>
        <div style="color:var(--text-dim);font-size:0.9rem;margin-bottom:24px">You'll need an account for that.</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <button class="btn btn-primary" onclick="document.getElementById('authPromptModal').classList.remove('open'); showPage('login')">Sign in</button>
          <button class="btn btn-outline" onclick="document.getElementById('authPromptModal').classList.remove('open'); showPage('register')">Create account</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  const textEl = document.getElementById('authPromptText');
  if (textEl) textEl.textContent = action ? `Sign in to ${action}` : 'Sign in to continue';
  modal.classList.add('open');
}

/* ─── LOADER ─── */
function hideLoader() {
  const l = $('appLoader');
  if (l) {
    l.classList.add('gone');
    setTimeout(() => { if (l && l.parentNode) l.remove(); }, 600);
    // Hard fallback — force gone if still in DOM after transition
    setTimeout(() => { if (l && l.parentNode) { l.style.display = 'none'; l.remove(); } }, 800);
  }
  // For pages that use #app wrapper
  const a = $('app');
  if (a) a.classList.add('visible');
  // For landing page specifically
  const lp = document.getElementById('page-landing');
  if (lp) lp.classList.add('active');
}

/* ─── PWA INSTALL ─── */
let _deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); _deferredInstall = e;
  const b = $('pwaInstallBtn'); if (b) b.style.display = 'flex';
});
window.addEventListener('appinstalled', () => {
  _deferredInstall = null;
  const b = $('pwaInstallBtn'); if (b) b.style.display = 'none';
  showToast('X-Musk Financial Club installed!');
});
function triggerPwaInstall() {
  if (!_deferredInstall) { showToast('Open in your browser to install'); return; }
  _deferredInstall.prompt();
  _deferredInstall.userChoice.then(r => { if (r.outcome === 'accepted') showToast('Installing…'); _deferredInstall = null; });
}

/* ─── LANDING PARTICLES ─── */
function initLandingParticles() {
  const container = document.getElementById('landingParticles');
  if (!container) return;
  container.innerHTML = '';
  const count = window.innerWidth < 480 ? 18 : 30;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'landing-particle';
    p.style.cssText = `left:${Math.random() * 100}%;top:${20 + Math.random() * 75}%;--dur:${4 + Math.random() * 8}s;--delay:${Math.random() * 8}s;width:${1 + Math.random() * 2}px;height:${1 + Math.random() * 2}px;opacity:0;`;
    container.appendChild(p);
  }
}

/* ─── THEME ─── */
function toggleTheme() {
  const isLight = document.body.classList.toggle('theme-light');
  localStorage.setItem('xclub_theme', isLight ? 'light' : 'dark');
  ['themeToggleIcon', 'mobileThemeIcon'].forEach(id => { const el = $(id); if (el) el.textContent = isLight ? '🌙' : '☀'; });
}
function applyStoredTheme() {
  const t = localStorage.getItem('xclub_theme');
  if (t === 'light') {
    document.body.classList.add('theme-light');
    ['themeToggleIcon', 'mobileThemeIcon'].forEach(id => { const el = $(id); if (el) el.textContent = '🌙'; });
  }
}

/* ─── LIGHTBOX ─── */
function openLightbox(url) {
  if (!url) return;
  const lb = document.createElement('div'); lb.className = 'photo-lightbox';
  lb.innerHTML = `<div class="photo-lightbox-close" onclick="this.parentElement.remove()">✕</div><img src="${escapeHTML(url)}" alt="Photo">`;
  lb.onclick = function (e) { if (e.target === lb) lb.remove(); };
  document.body.appendChild(lb);
}

/* ─── MODAL CLOSE ─── */
function closeModal(id) { const m = $(id); if (m) m.classList.remove('open'); }

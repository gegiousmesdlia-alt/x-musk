// router.js — Circlet — Single-Page App Router
// showPage() swaps which .page section is visible — no browser reload.
// Real, bookmarkable URLs are maintained via the History API, so deep
// links (including push notification taps) still land on the exact
// right view.
'use strict';

// ⚠️ Once the separate admin app is deployed (a future pass), point this
// at its real URL. Until then, admin.html still lives in this same app.
const ADMIN_APP_URL = '/admin.html';

const PAGE_ROUTES = {
  landing:        '/',
  login:          '/login',
  register:       '/register',
  reset:          '/reset',
  feed:           '/feed',
  discover:       '/discover',
  reels:          '/reels',
  notifications:  '/notifications',
  messages:       '/messages',
  profile:        '/profile',
  'user-profile': '/profile-view',
  'post-detail':  '/post',
};
const ROUTE_TO_PAGE = Object.fromEntries(Object.entries(PAGE_ROUTES).map(([k, v]) => [v, k]));
const AUTH_PAGES = new Set(['landing', 'login', 'register', 'reset']);

function pageFromLocation() {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const name = ROUTE_TO_PAGE[path];
  if (!name) return null;
  const params = new URLSearchParams(window.location.search);
  const opts = {};
  if (params.get('uid')) opts.uid = params.get('uid');
  if (params.get('postId')) opts.postId = params.get('postId');
  return { name, opts };
}

function showPage(name, opts = {}) {
  if (name === 'admin') { window.location.href = ADMIN_APP_URL; return; }

  const target = document.getElementById('page-' + name);
  if (!target) { console.error('[router] no page found for', name); return; }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  target.classList.add('active');
  window.__PAGE__ = name;

  const isAuthPage = AUTH_PAGES.has(name);
  const appShell = document.getElementById('app');
  const mobileNav = document.querySelector('.mobile-nav');
  const pushFab = document.getElementById('navPushBtnMobile');
  if (appShell)  appShell.style.display  = isAuthPage ? 'none' : '';
  if (mobileNav) mobileNav.style.display = isAuthPage ? 'none' : '';
  if (pushFab)   pushFab.style.display   = isAuthPage ? 'none' : '';

  let url = PAGE_ROUTES[name] || '/';
  const params = new URLSearchParams();
  if (opts.uid) params.set('uid', opts.uid);
  if (opts.postId) params.set('postId', opts.postId);
  const qs = params.toString();
  if (qs) url += '?' + qs;

  if (window.location.pathname + window.location.search !== url) {
    history.pushState({ page: name, opts }, '', url);
  }

  updateNavActive();
  window.scrollTo(0, 0);

  if (typeof onPageActivated === 'function') onPageActivated(name, opts);
}

window.addEventListener('popstate', (e) => {
  const state = e.state;
  if (state?.page) { showPage(state.page, state.opts || {}); return; }
  const loc = pageFromLocation();
  if (loc) showPage(loc.name, loc.opts);
});

function goBack() {
  if (window.history.length > 1) window.history.back();
  else showPage('feed');
}

function updateNavActive() {
  const current = window.__PAGE__ || 'landing';
  document.querySelectorAll('.nav-link, .mobile-nav-link').forEach(l => {
    const page = l.dataset.page;
    const match =
      (page === 'feed' && (current === 'feed' || current === 'index')) ||
      page === current;
    l.classList.toggle('active', match);
  });
}

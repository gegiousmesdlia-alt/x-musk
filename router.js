// router.js — X Club — True Multi-Page Navigation
// showPage() does a real browser navigation to the correct .html file.
// Each HTML file sets window.__PAGE__ so auth.js knows which page it's on.
'use strict';

const PAGE_MAP = {
  landing:        '/index.html',
  login:          '/login.html',
  register:       '/register.html',
  reset:          '/reset.html',
  feed:           '/feed.html',
  discover:       '/discover.html',
  notifications:  '/notifications.html',
  messages:       '/messages.html',
  profile:        '/profile.html',
  'user-profile': '/user-profile.html',
  'post-detail':  '/post-detail.html',
  admin:          '/admin.html',
};

function showPage(name, opts = {}) {
  // Don't navigate if we're already on the right page with no params needed
  const current = window.__PAGE__;
  if (current === name && !opts.uid && !opts.postId) return;

  const file = PAGE_MAP[name];
  if (!file) return;

  let qs = '';
  if (name === 'user-profile' && opts.uid)   qs = '?uid='    + encodeURIComponent(opts.uid);
  if (name === 'post-detail' && opts.postId) qs = '?postId=' + encodeURIComponent(opts.postId);

  window.location.href = file + qs;
}

function goBack() {
  if (document.referrer && new URL(document.referrer).origin === window.location.origin) {
    window.history.back();
  } else {
    window.location.href = '/feed.html';
  }
}

function updateNavActive() {
  const current = window.__PAGE__ || window.location.pathname.replace(/^\//, '').replace('.html', '') || 'index';
  document.querySelectorAll('.nav-link, .mobile-nav-link').forEach(l => {
    const page = l.dataset.page;
    const match =
      (page === 'feed' && (current === 'feed' || current === 'index')) ||
      page === current;
    l.classList.toggle('active', match);
  });
}

// auth.js — X Club — Auth, Session, Deep Links (multi-page)
'use strict';

/* ── Shared nav/head snippets are injected by each page's boot ── */

async function handleLogin(e) {
  e.preventDefault();
  const btn = $('loginBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
  try {
    await window.XF.signIn($('loginEmail').value.trim(), $('loginPass').value);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
    showToast(friendlyError(err.code));
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = $('regBtn'); if (btn) { btn.disabled = true; btn.textContent = 'Creating account…'; }
  const name   = $('regName')?.value.trim();
  const handle = $('regHandle')?.value.trim().toLowerCase().replace(/[^a-z0-9_]/g,'');
  const email  = $('regEmail')?.value.trim();
  const pass   = $('regPass')?.value;
  if (!name || !handle || !email || !pass) { showToast('Fill in all fields'); if (btn) { btn.disabled = false; btn.textContent = 'Create account'; } return; }
  if (pass.length < 8) { showToast('Password must be at least 8 characters'); if (btn) { btn.disabled = false; btn.textContent = 'Create account'; } return; }
  try {
    const snap = await window.XF.get('handles/' + handle);
    if (snap.exists()) { showToast('@' + handle + ' is already taken'); if (btn) { btn.disabled = false; btn.textContent = 'Create account'; } return; }
    const cred = await window.XF.register(email, pass);
    await window.XF.set('users/' + cred.user.uid, { uid: cred.user.uid, displayName: name, handle, email, bio: '', photoURL: '', verified: false, followersCount: 0, followingCount: 0, postsCount: 0, joinedAt: window.XF.ts() });
    await window.XF.set('handles/' + handle, cred.user.uid);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Create account'; }
    showToast(friendlyError(err.code));
  }
}

async function handleGoogleAuth() {
  try {
    const cred = await window.XF.googleSignIn();
    const snap = await window.XF.get('users/' + cred.user.uid);
    if (!snap.exists()) {
      const handle = (cred.user.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g,'') + '_' + Date.now().toString(36);
      await window.XF.set('users/' + cred.user.uid, { uid: cred.user.uid, displayName: cred.user.displayName || 'Member', handle, email: cred.user.email || '', bio: '', photoURL: cred.user.photoURL || '', verified: false, followersCount: 0, followingCount: 0, postsCount: 0, joinedAt: window.XF.ts() });
      await window.XF.set('handles/' + handle, cred.user.uid);
    }
  } catch (err) { showToast(friendlyError(err.code)); }
}

async function handleLogout() {
  await window.XF.signOut(); window.location.href = "/index.html";
}

function friendlyError(code) {
  return ({
    'auth/user-not-found': 'No account found with that email',
    'auth/wrong-password': 'Incorrect password',
    'auth/invalid-credential': 'Incorrect email or password',
    'auth/email-already-in-use': 'Email already registered',
    'auth/weak-password': 'Password is too weak',
    'auth/invalid-email': 'Invalid email address',
    'auth/popup-closed-by-user': 'Sign-in was cancelled',
    'auth/network-request-failed': 'Network error — check your connection'
  }[code]) || 'Something went wrong. Please try again.';
}

/* ══════════════════════════════════════════════
   AUTH STATE CHANGE
   Each page calls this. Each page knows what it needs.
══════════════════════════════════════════════ */
async function onAuthChange(user) {
  currentUser = user;
  const page = window.__PAGE__; // set by each HTML file before boot.js loads

  if (user) {
    if (user.email === ADMIN_EMAIL) {
      isAdmin = true;
      const snap = await window.XF.get('users/' + user.uid);
      currentProfile = snap.exists() ? snap.val() : { displayName: 'Admin', uid: user.uid };
      hideLoader();
      if (page === 'admin') { loadAdminUsers(); setTimeout(injectAdminTools, 400); }
      else { showPage('admin'); }
      return;
    }
    isAdmin = false;
    const snap = await window.XF.get('users/' + user.uid);
    currentProfile = snap.exists() ? snap.val() : null;
    updateNavUser(); updateComposerAvatar && updateComposerAvatar();
    loadSuggested && loadSuggested();
    startNotifWatch && startNotifWatch();
    startMsgWatch && startMsgWatch();
    updateSidebarVerifyBtn && updateSidebarVerifyBtn();
    _updateMsgRequestBadge && _updateMsgRequestBadge();
    _initPresence && _initPresence(user.uid);

    hideLoader();

    // Check for pending session profile redirect
    if (!window._pendingProfileUid) {
      try { window._pendingProfileUid = sessionStorage.getItem('_pendingProfileUid') || null; } catch(e) {}
    }
    if (window._pendingProfileUid) {
      const pendingUid = window._pendingProfileUid;
      window._pendingProfileUid = null;
      try { sessionStorage.removeItem('_pendingProfileUid'); } catch(e) {}
      if (pendingUid === user.uid) showPage('profile');
      else showPage('user-profile', { uid: pendingUid });
      return;
    }

    // If we're on an auth page, redirect to feed
    if (['landing','login','register','reset'].includes(page)) { showPage('feed'); return; }

    // Page-specific initialisation
    if (page === 'feed')          { renderFeed(); setTimeout(loadBizFeed, 1500); setTimeout(runScheduledPosts, 5000); }
    if (page === 'discover')      renderDiscover();
    if (page === 'notifications') renderNotifications();
    if (page === 'messages')      renderConversations();
    if (page === 'profile')       renderOwnProfile();
    if (page === 'user-profile') {
      const uid = new URLSearchParams(window.location.search).get('uid');
      if (uid) renderUserProfile(uid); else showPage('feed');
    }
    if (page === 'post-detail') {
      const postId = new URLSearchParams(window.location.search).get('postId');
      if (postId) renderPostDetail(postId); else showPage('feed');
    }

  } else {
    isAdmin = false; currentProfile = null;
    updateNavUser && updateNavUser();
    updateSidebarVerifyBtn && updateSidebarVerifyBtn();
    hideLoader();

    // Pages that require auth — send to landing
    const authRequired = ['feed','discover','notifications','messages','profile','user-profile','post-detail','admin'];
    if (authRequired.includes(page)) { showPage('landing'); }
    // Otherwise stay (landing, login, register, reset)
  }
}

function updateNavUser() {
  const wrap = $('navUserWrap'); if (!wrap) return;
  if (currentUser && currentProfile) {
    wrap.style.display = 'flex';
    const nameEl = $('navUserName'); const handleEl = $('navUserHandle'); const avatarEl = $('navUserAvatar');
    if (nameEl) nameEl.textContent = currentProfile.displayName || '';
    if (handleEl) handleEl.textContent = '@' + (currentProfile.handle || '');
    if (avatarEl) {
      if (currentProfile.photoURL) avatarEl.innerHTML = `<img class="avatar avatar-md" src="${currentProfile.photoURL}" alt="">`;
      else avatarEl.textContent = (currentProfile.displayName || '?').charAt(0).toUpperCase();
    }
  } else {
    wrap.style.display = 'none';
  }
}

/* ══════════════════════════════════════════════
   DEEP LINK  (?post=ID)  — used by share button in feed.js
══════════════════════════════════════════════ */
function checkDeepLink() {
  const params = new URLSearchParams(window.location.search); const postId = params.get('post');
  if (postId && currentUser) { setTimeout(() => showPage('post-detail', { postId }), 800); }
}

/* ══════════════════════════════════════════════
   RESET PASSWORD
══════════════════════════════════════════════ */
async function sendReset() {
  const email = $('resetEmail').value.trim(); if (!email) return showToast('Enter your email');
  try { await window.XF.resetPw(email); showToast('Reset link sent — check your inbox'); showPage('login'); }
  catch (err) { showToast('Could not send reset link'); }
}

/* ══════════════════════════════════════════════
   PAYMENT / VERIFICATION
══════════════════════════════════════════════ */
function showPaywall() {
  const m = $('paywallModal'); if (m) m.classList.add('open');
}
function closePaywall() {
  const m = $('paywallModal'); if (m) m.classList.remove('open');
}
function initiatePayment() {
  if (!currentUser || !currentProfile) { showToast('Sign in first'); return; }
  const settings = window._appSettings || {};
  const price = settings.membershipPrice || MEMBERSHIP_PRICE;
  const currency = settings.membershipCurrency || MEMBERSHIP_CURRENCY;
  FlutterwaveCheckout({
    public_key: FLW_PUBLIC_KEY,
    tx_ref: 'xclub-' + currentUser.uid + '-' + Date.now(),
    amount: price, currency,
    customer: { email: currentUser.email, name: currentProfile.displayName },
    customizations: { title: 'X-Musk Financial Club', description: 'Verified Membership', logo: '' },
    callback: async function(data) {
      if (data.status === 'successful' || data.status === 'completed') {
        try {
          await window.XF.update('users/' + currentUser.uid, { verified: true, verifiedAt: window.XF.ts(), paymentRef: data.transaction_id || data.tx_ref });
          currentProfile.verified = true; closePaywall(); showToast('✦ You are now a verified member!');
          updateNavUser(); renderOwnProfile && renderOwnProfile();
        } catch (err) { showToast('Payment confirmed but update failed — contact support'); }
      } else showToast('Payment was not completed');
    },
    onclose: function () {}
  });
}

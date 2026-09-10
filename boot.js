// boot.js — X Club — App Initialisation (fires on DOMContentLoaded)
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  applyStoredTheme();
  if (typeof initLandingParticles === 'function') initLandingParticles();
  updateNavActive();

  // Activate landing page immediately if we're on it
  const landingPage = document.getElementById('page-landing');
  if (landingPage) landingPage.classList.add('active');

  // Safety net: if Firebase auth never fires within 4s, just hide loader
  const loaderFailsafe = setTimeout(() => { hideLoader(); }, 4000);

  try {
    // Guard against duplicate init (bfcache / hot reload)
    if (!firebase.apps.length) {
      await window.XFire.load();
    } else {
      // Re-attach XF to existing app
      window.XFire._reattach && window.XFire._reattach();
    }

    let authFired = false;
    window.XF.onAuth(user => {
      if (authFired) return;
      authFired = true;
      clearTimeout(loaderFailsafe);
      onAuthChange(user);
    });
    if (typeof loadBizFeed === 'function') setTimeout(loadBizFeed, 3000);
  } catch (err) {
    clearTimeout(loaderFailsafe);
    console.error('Firebase failed:', err);
    hideLoader();
  }
});

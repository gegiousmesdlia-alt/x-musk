// business.js — X Club v7 — Business / Investment Posts & Flutterwave
'use strict';

/* ══════════════════════════════════════════════
   FLUTTERWAVE LAUNCHER
══════════════════════════════════════════════ */
function launchFlutterwave(post, amount) {
  const c = post.bizCurrency || 'EUR', ref = 'xclub_' + post.id + '_' + currentUser?.uid + '_' + Date.now();
  if (typeof FlutterwaveCheckout === 'undefined') { showToast('Payment system loading — please try again'); return; }
  FlutterwaveCheckout({
    public_key: FLW_PUBLIC_KEY, tx_ref: ref, amount, currency: c, payment_options: 'card,banktransfer,ussd',
    customer: { email: currentUser?.email || '', name: currentProfile?.displayName || 'Investor' },
    customizations: { title: post.bizTitle || 'Investment', description: 'Investment via X-Musk Financial Club', logo: '' },
    callback: async function (data) {
      if (data.status === 'successful' || data.status === 'completed') {
        try {
          await window.XF.set('investments/' + post.id + '/' + currentUser.uid, { uid: currentUser.uid, name: currentProfile?.displayName, email: currentUser.email, amount, currency: c, status: 'paid', txRef: data.tx_ref || ref, transactionId: data.transaction_id || '', paidAt: window.XF.ts() });
          const postSnap = await window.XF.get('posts/' + post.id);
          const invSnap = await window.XF.get('investments/' + post.id);
          let totalRaised = 0, investorCount = 0;
          if (invSnap.exists()) invSnap.forEach(c => { const v = c.val(); if (v.status === 'paid') { totalRaised += (v.amount || 0); investorCount++; } });
          await window.XF.update('posts/' + post.id, { bizRaised: totalRaised, investorCount });
          showToast('✅ Payment confirmed! Thank you for investing.'); renderFeed();
        } catch (err) { showToast('Payment confirmed but update failed — contact support'); }
      } else showToast('Payment was not completed');
    },
    onclose: function () {}
  });
}

/* ══════════════════════════════════════════════
   BUSINESS POST HTML
══════════════════════════════════════════════ */
function businessPostHTML(post, author) {
  const isOwner = currentUser && post.authorUid === currentUser.uid;
  const raised = post.bizRaised || 0, target = post.bizTarget || 1;
  const pct = Math.min(100, Math.round((raised / target) * 100));
  const isLiked = currentUser && post.likes && post.likes[currentUser.uid];
  const likeCount = post.likes ? Object.keys(post.likes).length : 0;
  return `<div class="post" data-id="${post.id}">
    <div onclick="openUserProfile('${post.authorUid}',event)">${avatarHTML(author, 'md')}</div>
    <div class="post-body">
      <div class="post-header">
        <span class="post-name">${escapeHTML(author?.displayName || 'Unknown')}</span>${verifiedBadge(author?.verified)}
        <span class="post-handle">@${escapeHTML(author?.handle || 'unknown')}</span>
        <span class="post-time">· ${timeAgo(post.createdAt)}</span>
        ${isOwner ? `<span onclick="event.stopPropagation();deletePost('${post.id}')" style="margin-left:auto;color:var(--text-dim);cursor:pointer;font-size:0.8rem;padding:2px 8px" onmouseover="this.style.color='var(--danger)'" onmouseout="this.style.color='var(--text-dim)'">✕</span>` : ''}
      </div>
      <div class="post-text">${escapeHTML(post.text || '')}</div>
      <div class="post-invest-card">
        <div class="post-invest-header"><span class="post-invest-badge">▣ INVESTMENT OPPORTUNITY</span>${post.bizSector ? `<span style="font-size:0.75rem;color:var(--text-dim)">${escapeHTML(post.bizSector)}</span>` : ''}</div>
        <div class="post-invest-title">${escapeHTML(post.bizTitle || '')}</div>
        <div class="post-invest-target">Target: ${currencySymbol(post.bizCurrency)}${Number(target).toLocaleString()} ${post.bizCurrency || 'EUR'}</div>
        <div class="invest-progress-bar"><div class="invest-progress-fill" style="width:${pct}%"></div></div>
        <div class="invest-stats"><span>${pct}% funded</span><span>${post.investorCount || 0} investors</span></div>
        <div class="invest-raised">${currencySymbol(post.bizCurrency)}${Number(raised).toLocaleString()} raised</div>
        <div class="invest-actions" style="margin-top:12px">
          ${!isOwner ? `<div class="invest-btn" onclick="openInvestModal('${post.id}')">◈ Invest Now</div>` : ''}
          ${isOwner ? `<button class="invest-manage-btn" onclick="openManageInvest('${post.id}')">⊞ Manage Investment</button>` : ''}
        </div>
      </div>
      <div class="post-actions" onclick="event.stopPropagation()">
        <div class="post-action like${isLiked ? ' liked' : ''}" onclick="toggleLike('${post.id}',this)"><svg width="18" height="18" viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>${likeCount > 0 ? ' ' + formatCount(likeCount) : ''}</div>
        <div class="post-action share" onclick="sharePost('${post.id}')"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></div>
      </div>
    </div>
  </div>`;
}

async function openInvestModal(postId) {
  if (!requireVerified('invest')) return;
  const snap = await window.XF.get('posts/' + postId); if (!snap.exists()) return;
  const post = snap.val(); const raised = post.bizRaised || 0, target = post.bizTarget || 1;
  const pct = Math.min(100, Math.round((raised / target) * 100));
  const currency = post.bizCurrency || 'EUR', sym = currencySymbol(currency);
  const isLarge = ['NGN', 'TZS', 'UGX', 'RWF'].includes(currency);
  const amts = isLarge ? [50000, 100000, 250000, 500000, 1000000, 2500000] : [500, 1000, 2500, 5000, 10000, 25000];
  const body = $('investModalBody'); $('investModalTitle').textContent = post.bizTitle || 'Invest';
  body.innerHTML = `
    <div class="invest-modal-raised">${sym}${Number(raised).toLocaleString()}</div>
    <div class="invest-modal-target">raised of ${sym}${Number(target).toLocaleString()} target · ${pct}% funded</div>
    <div class="invest-progress-bar" style="margin-bottom:20px"><div class="invest-progress-fill" style="width:${pct}%"></div></div>
    <div style="font-size:0.88rem;color:var(--text-dim);margin-bottom:12px;font-weight:600">Choose an amount (${currency}):</div>
    <div class="invest-amount-grid">${amts.map(a => `<div class="invest-amount-btn" onclick="selectInvestAmount(this,${a})">${sym}${a.toLocaleString()}</div>`).join('')}</div>
    <div class="form-group" style="margin-bottom:16px"><input id="customInvestAmt" class="form-input" type="number" placeholder="Or enter custom amount (${currency})" min="1"></div>
    <button class="btn btn-primary btn-block" onclick="confirmInvestment('${postId}')">Pay via Flutterwave →</button>
    <div style="font-size:0.76rem;color:var(--text-muted);margin-top:12px;text-align:center">You'll be taken to Flutterwave's secure checkout.</div>`;
  $('investModal').classList.add('open');
}

function selectInvestAmount(el, amount) {
  document.querySelectorAll('.invest-amount-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected'); selectedInvestAmount = amount; $('customInvestAmt').value = '';
}

async function confirmInvestment(postId) {
  const customVal = parseFloat($('customInvestAmt').value); const amount = customVal > 0 ? customVal : selectedInvestAmount;
  if (!amount || amount <= 0) return showToast('Please select or enter an amount');
  const snap = await window.XF.get('posts/' + postId); if (!snap.exists()) return;
  const post = { id: postId, ...snap.val() };
  const existingInv = await window.XF.get('investments/' + postId + '/' + currentUser.uid);
  if (existingInv.exists() && existingInv.val().status === 'paid') { showToast('You have already invested in this opportunity'); return; }
  closeModal('investModal'); showToast('Redirecting to payment…');
  setTimeout(() => launchFlutterwave(post, amount), 600);
}

async function openManageInvest(postId) {
  const snap = await window.XF.get('posts/' + postId); if (!snap.exists()) return; const post = snap.val();
  const body = $('manageInvestBody');
  body.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-size:0.85rem;color:var(--text-dim);margin-bottom:6px">Current amount raised</div>
      <div style="font-size:2rem;font-weight:800;color:var(--success)">${currencySymbol(post.bizCurrency)}${Number(post.bizRaised || 0).toLocaleString()} ${post.bizCurrency || 'EUR'}</div>
      <div style="font-size:0.8rem;color:var(--text-dim)">${post.investorCount || 0} investors · target ${currencySymbol(post.bizCurrency)}${Number(post.bizTarget || 0).toLocaleString()}</div>
    </div>
    <div class="form-group"><label class="form-label">Set raised amount manually</label><input id="manageRaisedInput" class="form-input" type="number" value="${post.bizRaised || 0}" min="0"></div>
    <div class="form-group"><label class="form-label">Set investor count manually</label><input id="manageCountInput" class="form-input" type="number" value="${post.investorCount || 0}" min="0"></div>
    <button class="btn btn-primary btn-block" onclick="saveManageInvest('${postId}')">Save Changes</button>`;
  $('manageInvestModal').classList.add('open');
}

async function saveManageInvest(postId) {
  const raised = parseInt($('manageRaisedInput').value) || 0, count = parseInt($('manageCountInput').value) || 0;
  try { await window.XF.update('posts/' + postId, { bizRaised: raised, investorCount: count }); closeModal('manageInvestModal'); showToast('Investment updated!'); renderFeed(); }
  catch (err) { showToast('Failed to update'); }
}

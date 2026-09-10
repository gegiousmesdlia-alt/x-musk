// config.js — X Club v7 — App-wide constants & shared state
// Load order: 1st (before everything else)
'use strict';

/* ══════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════ */
const ADMIN_EMAIL = 'admin@gmail.com';
const MEMBERSHIP_PRICE = 1999;
const MEMBERSHIP_CURRENCY = 'EUR';
const CLAUDE_ENGINEER_UID = 'claude_engineer_bot';
let FLW_PUBLIC_KEY = 'FLWPUBK-9b3e74ad491f4e5e52d93bd09e3da203-X';

/* ══════════════════════════════════════════════
   SHARED STATE
══════════════════════════════════════════════ */
let currentUser = null;
let currentProfile = null;
let activePage = 'feed';
let feedTab = 'for-you';
let activeConvUid = null;
let msgUnsubscribe = null;
let _postDateMode = 'now';
let selectedInvestAmount = 0;
let isAdmin = false;
let allUsersCache = [];

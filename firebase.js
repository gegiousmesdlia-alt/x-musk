/* firebase.js — X Club v8 — RTDB → Firestore dual-read/write bridge
 *
 * MIGRATION STRATEGY (lazy / non-destructive):
 *
 *  - All NEW data (new posts, comments, messages, notifications, etc. created
 *    via XF.push) is written ONLY to Firestore from now on.
 *  - All READS (XF.get / XF.on) merge Firestore + the old Realtime Database,
 *    so nothing that already exists in RTDB "disappears" from the app.
 *  - Single-entity records (a user, a post, a message, a connection...) are
 *    "self-migrating": the first time one is read and found only in RTDB, it
 *    is copied into Firestore automatically. From then on Firestore is the
 *    source of truth for that record; updates go to Firestore.
 *  - Nothing is deleted from RTDB by this migration. Explicit delete actions
 *    (adminDeleteUser, deletePost, deleteComment, etc.) remove from BOTH
 *    stores so deletes actually take effect everywhere.
 *  - `typing/...` presence data is intentionally left on RTDB only — it's
 *    throwaway, doesn't need migrating, and RTDB is a better fit for it.
 *
 * All public XF.* function signatures are UNCHANGED from the RTDB-only
 * version, so feed.js / profile.js / messages.js / etc. do not need to be
 * rewritten — only the two spots that talked to RTDB directly for paginated
 * queries (feed pagination, DM pagination) gained new XF helper methods.
 */

'use strict';

const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyCaG3mOPftbb4OwxL3qA4TZkZpife5SXbM',
  authDomain:        'x-club-413fa.firebaseapp.com',
  databaseURL:       'https://x-club-413fa-default-rtdb.europe-west1.firebasedatabase.app',
  projectId:         'x-club-413fa',
  storageBucket:     'x-club-413fa.firebasestorage.app',
  messagingSenderId: '1035750007609',
  appId:             '1:1035750007609:web:11ffcef313674785a77ee8'
};

let _auth, _rtdb, _fs;

/* ═══════════════════════════════════════════════════════════════════════
   FakeSnapshot — mimics the RTDB DataSnapshot API (.exists/.val/.forEach)
   so every existing call site (feed.js, profile.js, admin.js, ...) keeps
   working unmodified regardless of which backend the data came from.
   ═══════════════════════════════════════════════════════════════════════ */
class FakeSnapshot {
  constructor(data, isList) {
    this._data = data;
    this._isList = isList;
  }
  exists() {
    if (this._isList) return !!this._data && Object.keys(this._data).length > 0;
    return this._data !== null && this._data !== undefined;
  }
  val() { return this._data; }
  forEach(cb) {
    if (!this._isList || !this._data) return;
    const entries = Object.entries(this._data);
    entries.sort((a, b) => {
      const ca = (a[1] && a[1].createdAt) || 0;
      const cb_ = (b[1] && b[1].createdAt) || 0;
      if (ca !== cb_) return ca - cb_;
      return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0);
    });
    for (const [key, val] of entries) cb({ key, val: () => val });
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   Path router — translates the app's existing RTDB-style path strings
   ("users/uid123", "comments/postId/commentId", ...) into the equivalent
   Firestore location, per the agreed data model:
     comments/{postId}[/{id}]      -> posts/{postId}/comments[/{id}]
     connections/{uid}[/{id}]      -> users/{uid}/connections[/{id}]
     blocks/{uid}[/{id}]           -> users/{uid}/blocks[/{id}]
     dms/{convId}[/{id}]           -> conversations/{convId}/messages[/{id}]
     messageRequests/{uid}[/{id}]  -> users/{uid}/messageRequests[/{id}]
     notifications/{uid}[/{id}]    -> users/{uid}/notifications[/{id}]
     investments/{postId}[/{id}]   -> posts/{postId}/investments[/{id}]
     profileViews/{uid}[/{id}]     -> users/{uid}/profileViews[/{id}]
   Anything not in this table (e.g. "typing/...") falls back to RTDB-only,
   unchanged, safety-net behaviour.
   ═══════════════════════════════════════════════════════════════════════ */
const SIMPLE_ROOTS = new Set(['users', 'posts', 'handles', 'scheduledPosts', 'connectionRequests']);
const FIXED_DOC_ROOTS = { appConfig: 'appConfig', config: 'config' }; // -> settings/{fixedDocId}
const SUB_ROOTS = {
  comments:        { parentColl: 'posts', sub: 'comments' },
  connections:     { parentColl: 'users', sub: 'connections' },
  blocks:          { parentColl: 'users', sub: 'blocks' },
  dms:             { parentColl: 'conversations', sub: 'messages' },
  messageRequests: { parentColl: 'users', sub: 'messageRequests' },
  notifications:   { parentColl: 'users', sub: 'notifications' },
  investments:     { parentColl: 'posts', sub: 'investments' },
  profileViews:    { parentColl: 'users', sub: 'profileViews' },
};

function _resolve(path) {
  const segs = String(path).split('/').filter(Boolean);
  const root = segs[0];

  if (SIMPLE_ROOTS.has(root)) {
    const fsColl = _fs.collection(root);
    if (segs.length === 1) return { kind: 'list', fsColl, rtdbPath: path };
    if (segs.length === 2) return { kind: 'doc', fsRef: fsColl.doc(segs[1]), rtdbPath: path };
    return { kind: 'field', fsRef: fsColl.doc(segs[1]), fieldPath: segs.slice(2).join('.'), rtdbPath: path };
  }

  if (FIXED_DOC_ROOTS[root]) {
    const fsRef = _fs.collection('settings').doc(FIXED_DOC_ROOTS[root]);
    if (segs.length === 1) return { kind: 'doc', fsRef, rtdbPath: path };
    return { kind: 'field', fsRef, fieldPath: segs.slice(1).join('.'), rtdbPath: path };
  }

  const subMeta = SUB_ROOTS[root];
  if (subMeta && segs.length >= 2) {
    const parentDoc = _fs.collection(subMeta.parentColl).doc(segs[1]);
    const subColl = parentDoc.collection(subMeta.sub);
    if (segs.length === 2) return { kind: 'list', fsColl: subColl, rtdbPath: path };
    if (segs.length === 3) return { kind: 'doc', fsRef: subColl.doc(segs[2]), rtdbPath: path };
    return { kind: 'field', fsRef: subColl.doc(segs[2]), fieldPath: segs.slice(3).join('.'), rtdbPath: path };
  }

  return null; // unmapped — caller falls back to raw RTDB
}

function _getByFieldPath(obj, fieldPath) {
  if (!obj) return null;
  return fieldPath.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), obj);
}

// Firestore documents must be objects; a few RTDB paths (e.g. handles/{handle})
// store a bare primitive (a uid string). Wrap on write, unwrap on read.
function _wrapPrimitive(val) {
  return (val !== null && typeof val === 'object' && !Array.isArray(val)) ? val : { value: val };
}
function _unwrapPrimitive(val) {
  if (val && typeof val === 'object' && Object.keys(val).length === 1 && 'value' in val) return val.value;
  return val;
}

/* ── Ref cache for raw RTDB fallback (unchanged behaviour) ──────────────── */
const _refCache = new Map();
function _ref(path) {
  if (!_refCache.has(path)) _refCache.set(path, _rtdb.ref(path));
  return _refCache.get(path);
}

const _listeners = new Map();
let _listenerSeq = 0;
function _listenerKey(path, event) { return `${path}::${event}::${++_listenerSeq}`; }

function _write(label, promise) {
  return promise.catch(err => { console.error(`[XF] ${label} failed:`, err); throw err; });
}

/* ═══════════════════════════════════════════════════════════════════════
   Core read helpers
   ═══════════════════════════════════════════════════════════════════════ */

// Single-entity read with self-migration: Firestore wins if present;
// otherwise fall back to RTDB and copy the record into Firestore.
async function _getDoc(r) {
  const fsSnap = await r.fsRef.get();
  if (fsSnap.exists) return new FakeSnapshot(_unwrapPrimitive(fsSnap.data()), false);

  const rtdbSnap = await _rtdb.ref(r.rtdbPath).once('value');
  if (rtdbSnap.exists()) {
    const val = rtdbSnap.val();
    r.fsRef.set(_wrapPrimitive(val), { merge: true }).catch(err =>
      console.error(`[XF] auto-migrate failed for ${r.rtdbPath}:`, err));
    return new FakeSnapshot(val, false);
  }
  return new FakeSnapshot(null, false);
}

// List read: union of Firestore + RTDB children, Firestore wins on id clash.
async function _getList(r) {
  const [fsSnap, rtdbSnap] = await Promise.all([
    r.fsColl.get(),
    _rtdb.ref(r.rtdbPath).once('value'),
  ]);
  const merged = {};
  if (rtdbSnap.exists()) rtdbSnap.forEach(c => { merged[c.key] = c.val(); });
  fsSnap.forEach(d => { merged[d.id] = d.data(); });
  return new FakeSnapshot(merged, true);
}

async function _getField(r) {
  const parentSegs = r.rtdbPath.split('/');
  const parentPath = parentSegs.slice(0, parentSegs.length - r.fieldPath.split('.').length).join('/');
  const docSnap = await _getDoc({ fsRef: r.fsRef, rtdbPath: parentPath });
  const val = _getByFieldPath(docSnap.val(), r.fieldPath);
  return new FakeSnapshot(val, false);
}

/* ═══════════════════════════════════════════════════════════════════════ */

async function loadFirebase() {
  if (!window.firebase) throw new Error('[XF] Firebase SDK not loaded');

  if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
  _auth = firebase.auth();
  _rtdb = firebase.database();
  _fs   = firebase.firestore();

  function _db_getLastRaw(path, n) { return _rtdb.ref(path).limitToLast(n).once('value'); }

  window.XF = {
    auth: _auth,
    db:   _rtdb,   // kept raw for the typing-indicator feature (RTDB-only, by design)
    fs:   _fs,

    /* ── Auth (unchanged) ─────────────────────────────────────────────── */
    onAuth:        (cb)      => _auth.onAuthStateChanged(cb),
    signIn:        (e, p)    => _auth.signInWithEmailAndPassword(e, p),
    signUp:        (e, p)    => _auth.createUserWithEmailAndPassword(e, p),
    signOut:       ()        => { window.XF.offAll(); return _auth.signOut(); },
    resetPw:       (e)       => _auth.sendPasswordResetEmail(e),
    googleAuth:    ()        => _auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()),
    register:      (e, p)    => _auth.createUserWithEmailAndPassword(e, p),
    googleSignIn:  ()        => _auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()),
    updateProfile: (data)    => _auth.currentUser.updateProfile(data),
    currentUser:   ()        => _auth.currentUser,

    /* ── One-shot reads: merge Firestore + RTDB ──────────────────────── */
    async get(path) {
      const r = _resolve(path);
      if (!r) return _ref(path).once('value'); // unmapped path -> raw RTDB fallback
      if (r.kind === 'doc')  return _getDoc(r);
      if (r.kind === 'list') return _getList(r);
      return _getField(r);
    },

    async getLast(path, n = 1) {
      const r = _resolve(path);
      if (!r || r.kind !== 'list') return _db_getLastRaw(path, n);
      const snap = await _getList(r);
      const entries = Object.entries(snap.val() || {})
        .sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0))
        .slice(-n);
      return new FakeSnapshot(Object.fromEntries(entries), true);
    },

    /* ── Feed pagination helper (replaces direct XF.db.ref('posts')...) ── */
    async getPostsPage(limit, beforeTs) {
      const [fsQ, rtdbQ] = await Promise.all([
        (beforeTs
          ? _fs.collection('posts').orderBy('createdAt', 'desc').where('createdAt', '<', beforeTs).limit(limit)
          : _fs.collection('posts').orderBy('createdAt', 'desc').limit(limit)
        ).get(),
        (beforeTs
          ? _rtdb.ref('posts').orderByChild('createdAt').endAt(beforeTs - 1).limitToLast(limit)
          : _rtdb.ref('posts').orderByChild('createdAt').limitToLast(limit)
        ).once('value'),
      ]);
      const merged = {};
      if (rtdbQ.exists()) rtdbQ.forEach(c => { merged[c.key] = c.val(); });
      fsQ.forEach(d => { merged[d.id] = d.data(); });
      return new FakeSnapshot(merged, true);
    },

    /* ── DM pagination helper (replaces direct XF.db.ref(dmPath)...) ───── */
    async getDmMessages(convId, limit = 100) {
      const [fsQ, rtdbQ] = await Promise.all([
        _fs.collection('conversations').doc(convId).collection('messages')
          .orderBy('createdAt', 'desc').limit(limit).get(),
        _rtdb.ref('dms/' + convId).limitToLast(limit).once('value'),
      ]);
      const merged = {};
      if (rtdbQ.exists()) rtdbQ.forEach(c => { merged[c.key] = c.val(); });
      fsQ.forEach(d => { merged[d.id] = d.data(); });
      return new FakeSnapshot(merged, true);
    },

    query: (path) => _rtdb.ref(path), // legacy raw handle, kept for safety

    /* ── Writes: NEW records go to Firestore only; existing records
           (updates/deletes) act on whichever store currently owns them ─── */
    async set(path, val) {
      const r = _resolve(path);
      if (!r) return _write(`set(${path})`, _ref(path).set(val));
      if (r.kind === 'field') {
        return _write(`set(${path})`, r.fsRef.set({ [r.fieldPath]: val }, { merge: true }));
      }
      return _write(`set(${path})`, r.fsRef.set(_wrapPrimitive(val)));
    },

    async update(path, val) {
      const r = _resolve(path);
      if (!r) return _write(`update(${path})`, _ref(path).update(val));
      if (r.kind === 'field') {
        return _write(`update(${path})`, r.fsRef.set({ [r.fieldPath]: val }, { merge: true }));
      }
      return _write(`update(${path})`, r.fsRef.set(val, { merge: true }));
    },

    // Creating something NEW (a post, comment, message, notification...)
    // always writes to Firestore only, per the migration plan.
    async push(path, val) {
      const r = _resolve(path);
      if (!r || r.kind !== 'list') {
        return _write(`push(${path})`, _ref(path).push(val));
      }
      const docRef = r.fsColl.doc();
      await _write(`push(${path})`, docRef.set(val));
      return { key: docRef.id };
    },

    // Deletes act on BOTH stores so removals actually take effect regardless
    // of whether the record has been auto-migrated yet.
    async remove(path) {
      const r = _resolve(path);
      const rtdbRemove = _rtdb.ref(path).remove().catch(() => {});
      if (!r) return _write(`remove(${path})`, rtdbRemove);
      if (r.kind === 'field') {
        const fsRemove = r.fsRef.update({ [r.fieldPath]: firebase.firestore.FieldValue.delete() }).catch(() => {});
        return _write(`remove(${path})`, Promise.all([fsRemove, rtdbRemove]));
      }
      if (r.kind === 'doc') {
        const fsRemove = r.fsRef.delete().catch(() => {});
        return _write(`remove(${path})`, Promise.all([fsRemove, rtdbRemove]));
      }
      const fsRemove = r.fsColl.get().then(qs => Promise.all(qs.docs.map(d => d.ref.delete()))).catch(() => {});
      return _write(`remove(${path})`, Promise.all([fsRemove, rtdbRemove]));
    },

    // Multi-path atomic-ish update (used for DM readBy/deliveredTo fan-out).
    async multiUpdate(updates) {
      const rtdbFallback = _rtdb.ref().update(updates).catch(() => {});
      const byDoc = new Map();
      for (const [path, val] of Object.entries(updates)) {
        const r = _resolve(path);
        if (!r || r.kind !== 'field') continue;
        if (!byDoc.has(r.fsRef)) byDoc.set(r.fsRef, {});
        byDoc.get(r.fsRef)[r.fieldPath] = val;
      }
      const fsWrites = [...byDoc.entries()].map(([ref, fields]) => ref.set(fields, { merge: true }));
      return _write('multiUpdate', Promise.all([rtdbFallback, ...fsWrites]));
    },

    ts: () => firebase.firestore.FieldValue.serverTimestamp(),

    /* ── Realtime listener: merges live Firestore + live RTDB ──────────── */
    on(path, cb) {
      const key = _listenerKey(path, 'value');
      if (_listeners.has(key)) return _listeners.get(key).unsub;

      const r = _resolve(path);
      if (!r) {
        const rr = _ref(path);
        rr.on('value', cb);
        const unsub = () => { rr.off('value', cb); _listeners.delete(key); };
        _listeners.set(key, { unsub });
        return unsub;
      }

      let rtdbState = {}, fsState = {}, fsDocState;
      const emitList = () => cb(new FakeSnapshot({ ...rtdbState, ...fsState }, true));
      const emitDoc  = () => cb(new FakeSnapshot(fsDocState !== undefined ? fsDocState : rtdbState, false));

      let offRtdb = () => {}, offFs = () => {};

      if (r.kind === 'list') {
        const rr = _rtdb.ref(r.rtdbPath);
        const rtdbCb = snap => {
          rtdbState = {};
          if (snap.exists()) snap.forEach(c => { rtdbState[c.key] = c.val(); });
          emitList();
        };
        rr.on('value', rtdbCb);
        offRtdb = () => rr.off('value', rtdbCb);

        offFs = r.fsColl.onSnapshot(qs => {
          fsState = {};
          qs.forEach(d => { fsState[d.id] = d.data(); });
          emitList();
        }, err => console.error(`[XF] onSnapshot(${path}) failed:`, err));
      } else {
        const rr = _rtdb.ref(r.rtdbPath);
        const rtdbCb = snap => { rtdbState = snap.exists() ? snap.val() : null; if (fsDocState === undefined) emitDoc(); };
        rr.on('value', rtdbCb);
        offRtdb = () => rr.off('value', rtdbCb);

        offFs = r.fsRef.onSnapshot(doc => {
          if (doc.exists) {
            fsDocState = doc.data();
          } else {
            fsDocState = null;
            if (rtdbState) r.fsRef.set(rtdbState, { merge: true }).catch(() => {});
          }
          emitDoc();
        }, err => console.error(`[XF] onSnapshot(${path}) failed:`, err));
      }

      const unsub = () => { offRtdb(); offFs(); _listeners.delete(key); };
      _listeners.set(key, { unsub });
      return unsub;
    },

    onChild(path, event, cb) {
      const key = _listenerKey(path, event);
      if (_listeners.has(key)) return _listeners.get(key).unsub;

      let prevKeys = new Set();
      const unsubList = window.XF.on(path, snap => {
        const data = snap.val() || {};
        const keys = new Set(Object.keys(data));
        if (event === 'child_added') {
          keys.forEach(k => { if (!prevKeys.has(k)) cb({ key: k, val: () => data[k] }); });
        } else if (event === 'child_removed') {
          prevKeys.forEach(k => { if (!keys.has(k)) cb({ key: k, val: () => data[k] }); });
        } else if (event === 'child_changed') {
          keys.forEach(k => { if (prevKeys.has(k)) cb({ key: k, val: () => data[k] }); });
        }
        prevKeys = keys;
      });
      const unsub = () => { unsubList(); _listeners.delete(key); };
      _listeners.set(key, { unsub });
      return unsub;
    },

    onceChild(path, event, cb) {
      const r = _ref(path);
      const wrapped = (snap) => { r.off(event, wrapped); cb(snap); };
      r.on(event, wrapped);
    },

    offAll() {
      _listeners.forEach(({ unsub }) => { try { unsub(); } catch (_) {} });
      _listeners.clear();
    },
  };
}

window.XFire = {
  load: loadFirebase,
  _reattach: function() {
    _auth = firebase.auth();
    _rtdb = firebase.database();
    _fs   = firebase.firestore();
    loadFirebase._buildXF && loadFirebase._buildXF();
  }
};

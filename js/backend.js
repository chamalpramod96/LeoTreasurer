// Auth + data layer. Uses Firebase (Auth + Firestore) when js/config.js has a config,
// otherwise a demo backend that keeps sample data in this browser's localStorage.
//
// Both backends expose the same methods, and report auth state to onAuthChange(cb) as one of:
//   { state: 'signed-out' } | { state: 'unverified', email } | { state: 'not-member', email }
//   { state: 'error', email, error } | { state: 'ready', user: { email, name, position } }
import { firebaseConfig } from './config.js';
import { canEdit, computeMonth, currentMonthId, isAdmin, isSuper, shiftMonth } from './lib.js';

const FIREBASE_VERSION = '10.12.2';
export const normEmail = (e) => String(e || '').trim().toLowerCase();

export function createBackend() {
  return firebaseConfig.apiKey ? createFirebaseBackend() : Promise.resolve(createDemoBackend());
}

// ---- Firebase ----------------------------------------------------------------

async function createFirebaseBackend() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);

  let me = null;
  let listener = () => {};
  const millis = (ts) => (ts && ts.toMillis ? ts.toMillis() : 0);
  const stamp = () => ({ updatedBy: me, updatedAt: F.serverTimestamp() });

  async function handle(user) {
    if (!user) {
      me = null;
      return listener({ state: 'signed-out' });
    }
    const email = normEmail(user.email);
    if (!user.emailVerified) return listener({ state: 'unverified', email });
    me = email;
    try {
      const snap = await F.getDoc(F.doc(db, 'members', email));
      if (!snap.exists()) return listener({ state: 'not-member', email });
      const { name, position } = snap.data();
      listener({ state: 'ready', user: { email, name, position } });
    } catch (error) {
      listener({ state: 'error', email, error });
    }
  }

  return {
    mode: 'firebase',
    onAuthChange(cb) {
      listener = cb;
      A.onAuthStateChanged(auth, handle);
    },
    signIn: (email, password) => A.signInWithEmailAndPassword(auth, normEmail(email), password),
    async signUp(email, password) {
      const cred = await A.createUserWithEmailAndPassword(auth, normEmail(email), password);
      await A.sendEmailVerification(cred.user);
      await handle(cred.user);
    },
    resetPassword: (email) => A.sendPasswordResetEmail(auth, normEmail(email)),
    resendVerification: () => A.sendEmailVerification(auth.currentUser),
    // After the user clicks the verification link: refresh the account and its token, then re-check access.
    async recheck() {
      const user = auth.currentUser;
      if (!user) return;
      await user.reload();
      await user.getIdToken(true);
      await handle(auth.currentUser);
    },
    signOut: () => A.signOut(auth),

    async getMonth(id) {
      const snap = await F.getDoc(F.doc(db, 'months', id));
      return snap.exists() ? { id, ...snap.data(), updatedAt: millis(snap.get('updatedAt')) } : null;
    },
    saveMonth: (id, data) => F.setDoc(F.doc(db, 'months', id), { ...data, ...stamp() }, { merge: true }),

    async listTransactions(monthId) {
      const snap = await F.getDocs(F.collection(db, 'months', monthId, 'transactions'));
      return snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        createdAt: millis(d.get('createdAt')),
        updatedAt: millis(d.get('updatedAt')),
      }));
    },
    // proof: a JPEG data URL to attach, null to remove, undefined to leave unchanged.
    // Proof images live in months/{id}/proofs/{txId} so the cash book list stays small.
    async addTransaction(monthId, tx, proof) {
      const ref = F.doc(F.collection(db, 'months', monthId, 'transactions'));
      const batch = F.writeBatch(db);
      batch.set(ref, { ...tx, hasProof: !!proof, createdBy: me, createdAt: F.serverTimestamp(), ...stamp() });
      if (proof) batch.set(F.doc(db, 'months', monthId, 'proofs', ref.id), { data: proof, ...stamp() });
      await batch.commit();
    },
    async updateTransaction(monthId, id, tx, proof) {
      const batch = F.writeBatch(db);
      const patch = { ...tx, ...stamp() };
      if (proof !== undefined) patch.hasProof = !!proof;
      batch.update(F.doc(db, 'months', monthId, 'transactions', id), patch);
      const proofRef = F.doc(db, 'months', monthId, 'proofs', id);
      if (proof) batch.set(proofRef, { data: proof, ...stamp() });
      else if (proof === null) batch.delete(proofRef);
      await batch.commit();
    },
    async deleteTransaction(monthId, id) {
      const batch = F.writeBatch(db);
      batch.delete(F.doc(db, 'months', monthId, 'transactions', id));
      batch.delete(F.doc(db, 'months', monthId, 'proofs', id));
      await batch.commit();
    },
    async getProof(monthId, id) {
      const snap = await F.getDoc(F.doc(db, 'months', monthId, 'proofs', id));
      return snap.exists() ? snap.get('data') : null;
    },

    async listMembers() {
      const snap = await F.getDocs(F.collection(db, 'members'));
      return snap.docs.map((d) => ({ email: d.id, name: d.get('name'), position: d.get('position') }));
    },
    async saveMember(email, { name, position }, prevEmail) {
      const batch = F.writeBatch(db);
      batch.set(F.doc(db, 'members', email), { name, position, ...stamp() });
      if (prevEmail && prevEmail !== email) batch.delete(F.doc(db, 'members', prevEmail));
      await batch.commit();
    },
    removeMember: (email) => F.deleteDoc(F.doc(db, 'members', email)),
  };
}

// ---- Demo (localStorage) -------------------------------------------------------

function createDemoBackend() {
  const DATA_KEY = 'leoTreasurer.demo.v1';
  const SESSION_KEY = 'leoTreasurer.demo.session';
  const store = {
    get(k) {
      try { return localStorage.getItem(k); } catch { return null; }
    },
    set(k, v) {
      try { localStorage.setItem(k, v); } catch { /* storage blocked: data lives in memory for this tab */ }
    },
    del(k) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    },
  };

  let data = null;
  let session = store.get(SESSION_KEY);
  let listener = () => {};
  let seq = 0;

  const persist = () => store.set(DATA_KEY, JSON.stringify(data));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const deny = () => Object.assign(new Error('Permission denied'), { code: 'permission-denied' });

  function db() {
    if (!data) {
      try { data = JSON.parse(store.get(DATA_KEY)); } catch { data = null; }
      if (!data || !data.members) {
        data = seedDemo();
        persist();
      }
    }
    return data;
  }
  function currentUser() {
    const m = session && db().members[session];
    return m ? { email: session, ...m } : null;
  }
  function emit() {
    const user = currentUser();
    listener(user ? { state: 'ready', user } : { state: 'signed-out' });
  }
  function setProof(monthId, id, proof) {
    const proofs = (db().proofs ||= {});
    if (proof) proofs[`${monthId}/${id}`] = proof;
    else delete proofs[`${monthId}/${id}`];
  }
  // Only the Super Admin may write to months other than the current one (same as firestore.rules).
  const dateAllowed = (monthId) => isSuper(currentUser()) || monthId === currentMonthId();
  function requireOpenMonth(monthId) {
    const month = db().months[monthId];
    if (!canEdit(currentUser()) || !month || month.locked || !dateAllowed(monthId)) throw deny();
  }

  return {
    mode: 'demo',
    onAuthChange(cb) {
      listener = cb;
      emit();
    },
    demoAccounts: () => Object.entries(db().members).map(([email, m]) => ({ email, ...m })),
    async signIn(email) {
      session = email;
      store.set(SESSION_KEY, email);
      emit();
    },
    async signOut() {
      session = null;
      store.del(SESSION_KEY);
      emit();
    },
    async resetDemo() {
      data = seedDemo();
      persist();
      emit();
    },

    async getMonth(id) {
      const m = db().months[id];
      return m ? { id, ...clone(m) } : null;
    },
    async saveMonth(id, patch) {
      const user = currentUser();
      const cur = db().months[id];
      if (!canEdit(user)) throw deny();
      const lockChange = 'locked' in patch && patch.locked !== (cur ? cur.locked : false);
      if ((lockChange || (cur && cur.locked)) && !isAdmin(user)) throw deny();
      const onlyLock = Object.keys(patch).every((k) => k === "locked");
      if (!onlyLock && !dateAllowed(id)) throw deny();
      db().months[id] = { locked: false, ...cur, ...patch, updatedBy: user.email, updatedAt: Date.now() };
      persist();
    },

    async listTransactions(monthId) {
      return clone(db().tx[monthId] || []);
    },
    async addTransaction(monthId, tx, proof) {
      requireOpenMonth(monthId);
      const by = currentUser().email;
      const now = Date.now();
      const id = newId();
      (db().tx[monthId] ||= []).push({ id, ...tx, hasProof: !!proof, createdBy: by, createdAt: now, updatedBy: by, updatedAt: now });
      if (proof) setProof(monthId, id, proof);
      persist();
    },
    async updateTransaction(monthId, id, tx, proof) {
      requireOpenMonth(monthId);
      const list = db().tx[monthId] || [];
      const i = list.findIndex((t) => t.id === id);
      if (i < 0) throw new Error('That entry no longer exists.');
      list[i] = { ...list[i], ...tx, updatedBy: currentUser().email, updatedAt: Date.now() };
      if (proof !== undefined) {
        list[i].hasProof = !!proof;
        setProof(monthId, id, proof);
      }
      persist();
    },
    async deleteTransaction(monthId, id) {
      requireOpenMonth(monthId);
      db().tx[monthId] = (db().tx[monthId] || []).filter((t) => t.id !== id);
      setProof(monthId, id, null);
      persist();
    },
    async getProof(monthId, id) {
      return (db().proofs || {})[`${monthId}/${id}`] || null;
    },

    async listMembers() {
      return Object.entries(db().members).map(([email, m]) => ({ email, ...clone(m) }));
    },
    async saveMember(email, { name, position }, prevEmail) {
      const members = db().members;
      const touchesSuper = [position, members[email]?.position, members[prevEmail]?.position].includes('super_admin');
      if (!isAdmin(currentUser()) || (touchesSuper && !isSuper(currentUser()))) throw deny();
      if (prevEmail && prevEmail !== email) delete members[prevEmail];
      members[email] = { name, position };
      persist();
    },
    async removeMember(email) {
      const target = db().members[email];
      if (!isAdmin(currentUser()) || (target?.position === 'super_admin' && !isSuper(currentUser()))) throw deny();
      delete db().members[email];
      persist();
    },
  };
}

// Four months of sample entries ending last month; the newest is a draft, older ones are finalized.
function seedDemo() {
  const members = {
    'admin@demo.leo': { name: 'Club Super Admin', position: 'super_admin' },
    'president@demo.leo': { name: 'Leo Nethmi Perera', position: 'president' },
    'ipp@demo.leo': { name: 'Leo Ravindu Silva', position: 'ipp' },
    'vp@demo.leo': { name: 'Leo Tharushi Fernando', position: 'vice_president' },
    'secretary@demo.leo': { name: 'Leo Kasun Jayawardena', position: 'secretary' },
    'treasurer@demo.leo': { name: 'Leo Dilan Wickramasinghe', position: 'treasurer' },
    'asst1@demo.leo': { name: 'Leo Sachini Herath', position: 'asst_treasurer_1' },
    'asst2@demo.leo': { name: 'Leo Pasindu Gunawardena', position: 'asst_treasurer_2' },
    'asst3@demo.leo': { name: 'Leo Imesha Rajapaksha', position: 'asst_treasurer_3' },
  };
  // [day, type, account, project, details, ref, amount]
  const sample = [
    [
      [3, 'income', 'cash', 'Membership dues', 'Annual dues — 12 members', 'R-101', 6000],
      [8, 'expense', 'cash', 'Installation ceremony', 'Hall decorations', 'V-201', 4500],
      [9, 'expense', 'bank', 'Installation ceremony', 'Catering advance', 'V-202', 25000],
      [15, 'income', 'bank', 'Installation ceremony', 'Sponsorship — local business', 'R-102', 30000],
      [20, 'transfer', 'cash', 'Cash deposited to bank', '', '', 5000],
      [27, 'expense', 'bank', 'District dues', 'Leo district dues', 'V-203', 7500],
    ],
    [
      [2, 'income', 'cash', 'Membership dues', 'Dues — 6 members', 'R-103', 3000],
      [10, 'expense', 'cash', 'Tree planting', 'Saplings & transport', 'V-204', 6200],
      [17, 'income', 'cash', 'Food stall fundraiser', 'Stall sales', 'R-104', 18500],
      [17, 'expense', 'cash', 'Food stall fundraiser', 'Ingredients', 'V-205', 7800],
      [21, 'transfer', 'cash', 'Cash deposited to bank', '', '', 10000],
      [28, 'expense', 'bank', 'Bank charges', 'Monthly service charge', '', 150],
    ],
    [
      [5, 'expense', 'cash', 'Blood donation campaign', 'Refreshments for donors', 'V-206', 8400],
      [5, 'income', 'bank', 'Blood donation campaign', 'Sponsorship', 'R-105', 15000],
      [14, 'expense', 'bank', "Elders' home visit", 'Dry rations', 'V-207', 12600],
      [22, 'transfer', 'bank', 'Cash withdrawn from bank', 'Petty cash', '', 5000],
      [28, 'expense', 'bank', 'Bank charges', 'Monthly service charge', '', 150],
    ],
    [
      [4, 'income', 'cash', 'Membership dues', 'Dues — 3 members', 'R-106', 1500],
      [8, 'transfer', 'bank', 'Cash withdrawn from bank', 'Petty cash', '', 5000],
      [11, 'expense', 'cash', 'World Sight Day awareness', 'Leaflet printing', 'V-208', 3200],
      [18, 'income', 'bank', 'Charity walk', 'Registration fees', 'R-107', 22000],
      [18, 'expense', 'bank', 'Charity walk', 'T-shirts & water', 'V-209', 9600],
      [25, 'income', 'cash', 'Charity walk', 'Donations on the day', 'R-108', 4300],
    ],
  ];

  const now = currentMonthId();
  const months = {};
  const tx = {};
  let opening = { openingCash: 12500, openingBank: 85000 };
  sample.forEach((entries, i) => {
    const id = shiftMonth(now, i - sample.length);
    const month = { ...opening, locked: i < sample.length - 1, updatedBy: 'treasurer@demo.leo', updatedAt: Date.now() };
    const list = entries.map(([day, type, account, project, description, ref, amount], j) => {
      const by = j % 3 === 1 ? 'asst1@demo.leo' : 'treasurer@demo.leo';
      return { id: `${id}-${j}`, date: `${id}-${String(day).padStart(2, '0')}`, type, account, project, description, ref, amount, createdBy: by, createdAt: j, updatedBy: by, updatedAt: j };
    });
    months[id] = month;
    tx[id] = list;
    const { closing } = computeMonth(month, list);
    opening = { openingCash: closing.cash / 100, openingBank: closing.bank / 100 };
  });
  return { members, months, tx };
}

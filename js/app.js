// Leo Treasurer UI: sign-in, Leo-year month picker, monthly cash book, committee access list.
import { settings } from './config.js';
import { createBackend, normEmail } from './backend.js';
import {
  POSITIONS, canEdit, computeMonth, currentMonthId, esc, fmt, fmtDate, isAdmin, isSuper, lastDayIso, leoYearLabel,
  leoYearMonths, leoYearOf, money, monthLabel, monthName, parseAmount, parseMonthId, positionInfo, shiftMonth,
  todayIso, total,
} from './lib.js';

const app = document.getElementById('app');
const dialog = document.getElementById('dialog');
const toastEl = document.getElementById('toast');

const state = {
  be: null,
  auth: { state: 'loading' },
  authView: 'signin', // signin | signup | reset
  authNote: '',
  user: null,
  nav: 0, // bumps on every navigation so stale loads don't overwrite the screen
  month: null, // { id, month, txs, calc, prev }
  members: [],
  projects: new Set(),
};

// ---- Icons -------------------------------------------------------------------

const svg = (d) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const icon = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  left: svg('<path d="m15 18-6-6 6-6"/>'),
  right: svg('<path d="m9 18 6-6-6-6"/>'),
  back: svg('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
  print: svg('<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  lock: svg('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  unlock: svg('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  logout: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
  calendar: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  alert: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>'),
  cash: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>'),
  bank: svg('<path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/>'),
  funds: svg('<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"/>'),
  up: svg('<path d="M7 17 17 7M7 7h10v10"/>'),
  down: svg('<path d="M17 7 7 17M17 17H7V7"/>'),
  swap: svg('<path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/>'),
  camera: svg('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>'),
  clip: svg('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
  users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
};

// ---- Small view helpers ----------------------------------------------------------

const sym = esc(settings.currencySymbol);
const moneyHtml = (c) => `<span class="cur">${sym}</span>${c < 0 ? `<span class="neg">${fmt(c)}</span>` : fmt(c)}`;
const signed = (c) => (c > 0 ? `+${fmt(c)}` : c < 0 ? `−${fmt(-c)}` : fmt(0));
const accessPill = (p) => (p.edit ? '<span class="pill edit">Can edit</span>' : '<span class="pill view">View only</span>');
const loading = () => '<div class="loading"><div class="spinner"></div></div>';

function monthStatus(month) {
  if (!month) return 'none';
  return month.locked ? 'final' : 'draft';
}
function statusPill(status) {
  if (status === 'final') return `<span class="pill final">${icon.lock}Finalized</span>`;
  if (status === 'draft') return '<span class="pill draft">Draft</span>';
  return '<span class="pill none">Not started</span>';
}
const TYPE_LABEL = { income: 'Income', expense: 'Expense', transfer: 'Transfer' };
const typePill = (type) => `<span class="pill ${type}">${TYPE_LABEL[type] || esc(type)}</span>`;
function viaLabel(tx) {
  if (tx.type !== 'transfer') return tx.account === 'bank' ? 'Bank' : 'Cash';
  return tx.account === 'bank' ? 'Bank → Cash' : 'Cash → Bank';
}
function kpi(label, value, note, tone = '', ic = '') {
  return `<div class="kpi ${tone}">
    <div class="kpi-label">${ic}<span>${label}</span></div>
    <div class="kpi-value">${value}</div>
    ${note ? `<div class="kpi-note">${note}</div>` : ''}
  </div>`;
}

let toastTimer;
function toast(message, kind = 'ok') {
  toastEl.textContent = message;
  toastEl.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = ''), 3200);
}

const ERRORS = {
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/invalid-login-credentials': 'Email or password is incorrect.',
  'auth/wrong-password': 'Email or password is incorrect.',
  'auth/user-not-found': 'Email or password is incorrect.',
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/missing-password': 'Enter your password.',
  'auth/email-already-in-use': 'An account already exists for this email. Sign in, or use “Forgot password?”.',
  'auth/weak-password': 'Choose a stronger password (at least 8 characters).',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'Network problem — check your internet connection.',
  'auth/operation-not-allowed': 'Email/password sign-in isn’t enabled in Firebase yet.',
  'auth/admin-restricted-operation': 'Creating accounts is turned off. Ask the Treasurer.',
  'permission-denied': 'You don’t have permission to do that. The month may be finalized.',
  unavailable: 'Can’t reach the server — check your internet connection.',
};
const errorText = (err) => ERRORS[err && err.code] || (err && err.message) || 'Something went wrong.';

// ---- Auth screens ------------------------------------------------------------------

function authLayout(inner) {
  return `<div class="auth">
    <div class="auth-inner">
      <img class="auth-logo" src="assets/logo.webp" alt="Leo Treasurer">
      <div class="auth-card">${inner}</div>
      <p class="auth-foot">${esc(settings.clubName)}</p>
    </div>
  </div>`;
}

function authNote() {
  const note = state.authNote;
  state.authNote = '';
  return note ? `<p class="notice ok">${icon.check}<span>${esc(note)}</span></p>` : '';
}

const authViews = {
  signin: () => `
    <h1 class="auth-title">Sign in</h1>
    <p class="auth-sub">Monthly treasurer report</p>
    ${authNote()}
    <form data-form="signin" class="stack" novalidate>
      <label class="field"><span>Email</span><input type="email" name="email" autocomplete="username" required autofocus></label>
      <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Sign in</button>
    </form>
    <div class="auth-links">
      <button class="link" data-action="auth-view" data-view="reset">Forgot password?</button>
      <button class="link" data-action="auth-view" data-view="signup">First time? Set up your account</button>
    </div>`,

  signup: () => `
    <h1 class="auth-title">Set up your account</h1>
    <p class="auth-sub">Use the email the Treasurer added for your position. We’ll send a link to verify it.</p>
    <form data-form="signup" class="stack" novalidate>
      <label class="field"><span>Email</span><input type="email" name="email" autocomplete="username" required autofocus></label>
      <label class="field"><span>Choose a password</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
      <label class="field"><span>Confirm password</span><input type="password" name="confirm" autocomplete="new-password" minlength="8" required></label>
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Create account</button>
    </form>
    <div class="auth-links"><button class="link" data-action="auth-view" data-view="signin">${icon.back} Back to sign-in</button></div>`,

  reset: () => `
    <h1 class="auth-title">Reset password</h1>
    <p class="auth-sub">We’ll email you a link to choose a new password.</p>
    <form data-form="reset" class="stack" novalidate>
      <label class="field"><span>Email</span><input type="email" name="email" autocomplete="username" required autofocus></label>
      <p class="form-error" hidden></p>
      <button class="btn primary block" type="submit">Send reset link</button>
    </form>
    <div class="auth-links"><button class="link" data-action="auth-view" data-view="signin">${icon.back} Back to sign-in</button></div>`,

  demo: () => `
    <h1 class="auth-title">Demo sign-in</h1>
    <p class="auth-sub">Firebase isn’t connected yet, so this is a demo with sample data stored only in this browser. Pick a position to see what they can do.</p>
    <div class="demo-list">
      ${POSITIONS.map((p) => {
        const m = state.be.demoAccounts().find((a) => a.position === p.id);
        if (!m) return '';
        return `<button class="demo-btn" data-action="demo-signin" data-email="${esc(m.email)}">
          <span><b>${esc(p.label)}</b><small>${esc(m.name)}</small></span>${accessPill(p)}
        </button>`;
      }).join('')}
    </div>`,

  unverified: (email) => `
    <h1 class="auth-title">Verify your email</h1>
    <p class="auth-sub">We sent a verification link to <b>${esc(email)}</b>. Open it, then come back here. Check your spam folder if it isn’t in your inbox.</p>
    <div class="stack">
      <button class="btn primary block" data-action="recheck">I’ve verified — continue</button>
      <button class="btn block" data-action="resend-verification">Send the link again</button>
      <button class="link center" data-action="sign-out">Use a different account</button>
    </div>`,

  notMember: (email) => `
    <h1 class="auth-title">Access not granted</h1>
    <p class="auth-sub"><b>${esc(email)}</b> isn’t on the committee list. Ask the Treasurer to add this email for your position, then sign in again.</p>
    <button class="btn block" data-action="sign-out">${icon.logout} Sign out</button>`,

  error: (email, error) => `
    <h1 class="auth-title">Couldn’t load your access</h1>
    <p class="auth-sub">Signed in as <b>${esc(email)}</b>, but the committee list couldn’t be read: ${esc(errorText(error))}</p>
    <div class="stack">
      <button class="btn primary block" data-action="recheck">Try again</button>
      <button class="link center" data-action="sign-out">Sign out</button>
    </div>`,
};

function renderAuth() {
  const a = state.auth;
  let inner;
  if (a.state === 'loading') inner = loading();
  else if (a.state === 'unverified') inner = authViews.unverified(a.email);
  else if (a.state === 'not-member') inner = authViews.notMember(a.email);
  else if (a.state === 'error') inner = authViews.error(a.email, a.error);
  else if (state.be.mode === 'demo') inner = authViews.demo();
  else inner = authViews[state.authView]();
  app.innerHTML = authLayout(inner);
  app.querySelector('[autofocus]')?.focus();
}

// ---- App shell + routing -----------------------------------------------------------

function shell(content, active) {
  const u = state.user;
  const p = positionInfo(u.position);
  const demo = state.be.mode === 'demo'
    ? `<div class="demo-banner no-print">${icon.alert}<span><b>Demo mode</b> — sample data saved only in this browser. Add your Firebase settings in <code>js/config.js</code> to go live.</span><button class="link" data-action="demo-reset">Reset demo data</button></div>`
    : '';
  return `${demo}
  <header class="topbar no-print">
    <a class="brand" href="#/"><img src="assets/logo.webp" alt=""><span><b>Leo Treasurer</b><small>${esc(settings.clubName)}</small></span></a>
    <nav class="tabs" aria-label="Main">
      <a href="#/" class="${active === 'months' ? 'active' : ''}">${icon.calendar}Months</a>
      <a href="#/committee" class="${active === 'committee' ? 'active' : ''}">${icon.users}Committee</a>
    </nav>
    <div class="me">
      <div class="me-text"><b>${esc(u.name)}</b><small>${esc(p.label)} · ${p.edit ? 'Can edit' : 'View only'}</small></div>
      <button class="btn icon ghost" data-action="sign-out" title="Sign out" aria-label="Sign out">${icon.logout}</button>
    </div>
  </header>
  <main class="page">${content}</main>
  <footer class="foot no-print">Leo Treasurer · ${esc(settings.clubName)}</footer>`;
}

const render = (content, active) => (app.innerHTML = shell(content, active));

function errorPanel(err) {
  return `<section class="card empty-state">${icon.alert}<h2>Couldn’t load this page</h2><p>${esc(errorText(err))}</p>
    <button class="btn" data-action="retry">Try again</button></section>`;
}

function route() {
  if (!state.user) return;
  if (dialog.open) dialog.close();
  const [, page = '', arg = ''] = (location.hash.slice(1) || '/').split('/');
  if (page === 'month' && /^\d{4}-(0[1-9]|1[0-2])$/.test(arg)) return showMonth(arg);
  if (page === 'committee') return showCommittee();
  if (page === 'year' && /^\d{4}$/.test(arg)) return showYear(Number(arg));
  return showYear(leoYearOf(currentMonthId()));
}
window.addEventListener('hashchange', route);

async function loadMonth(id) {
  const month = await state.be.getMonth(id);
  if (!month) return { id, month: null, txs: [], calc: null };
  const txs = await state.be.listTransactions(id);
  for (const tx of txs) if (tx.type !== 'transfer' && tx.project) state.projects.add(tx.project.trim());
  return { id, month, txs, calc: computeMonth(month, txs) };
}

// ---- Leo year (month picker) -----------------------------------------------------

async function showYear(y) {
  const nav = ++state.nav;
  render(loading(), 'months');
  window.scrollTo(0, 0);
  let months;
  try {
    months = await Promise.all(leoYearMonths(y).map(loadMonth));
  } catch (err) {
    if (nav === state.nav) render(errorPanel(err), 'months');
    return;
  }
  if (nav === state.nav) render(yearView(y, months), 'months');
}

function yearView(y, months) {
  const now = currentMonthId();
  const started = months.filter((m) => m.calc);
  const latest = started[started.length - 1];
  const sum = (key) => started.reduce((s, m) => s + total(m.calc[key]), 0);
  const asAt = latest ? `End of ${monthLabel(latest.id)}` : 'No months started';
  return `
  <section class="page-head">
    <div>
      <p class="eyebrow">Leo year</p>
      <h1 class="title">${leoYearLabel(y)}</h1>
      <p class="sub">Pick a month to open its cash book.</p>
    </div>
    <div class="actions">
      <a class="btn icon" href="#/year/${y - 1}" title="Previous Leo year" aria-label="Previous Leo year">${icon.left}</a>
      ${y === leoYearOf(now) ? '' : '<a class="btn" href="#/">This year</a>'}
      <a class="btn icon" href="#/year/${y + 1}" title="Next Leo year" aria-label="Next Leo year">${icon.right}</a>
    </div>
  </section>
  <section class="kpis">
    ${kpi('Cash in hand', latest ? moneyHtml(latest.calc.closing.cash) : '—', asAt, 'gold', icon.cash)}
    ${kpi('Bank balance', latest ? moneyHtml(latest.calc.closing.bank) : '—', asAt, 'gold', icon.bank)}
    ${kpi('Income this year', moneyHtml(sum('income')), `${started.length} of 12 months recorded`, 'income', icon.up)}
    ${kpi('Expenses this year', moneyHtml(sum('expense')), `Net ${signed(sum('income') - sum('expense'))}`, 'expense', icon.down)}
  </section>
  <h2 class="section-title">Months</h2>
  <div class="month-grid">${months.map((m) => monthCard(m, now)).join('')}</div>`;
}

function monthCard({ id, month, calc }, now) {
  const isNow = id === now;
  const body = calc
    ? `<dl class="mc-vals">
        <div><dt>Cash in hand</dt><dd>${fmt(calc.closing.cash)}</dd></div>
        <div><dt>Bank</dt><dd>${fmt(calc.closing.bank)}</dd></div>
      </dl>
      <div class="mc-flow">
        <span class="in">${icon.up}${fmt(total(calc.income))}</span>
        <span class="out">${icon.down}${fmt(total(calc.expense))}</span>
        <span class="cnt">${calc.rows.length} ${calc.rows.length === 1 ? 'entry' : 'entries'}</span>
      </div>`
    : `<p class="mc-empty">${id > now ? 'Upcoming' : 'Not started yet'}</p>`;
  return `<a class="month-card${isNow ? ' current' : ''}${month ? '' : ' empty'}" href="#/month/${id}">
    <div class="mc-top">
      <div><div class="mc-name">${monthName(id)}</div><div class="mc-year">${parseMonthId(id).y}${isNow ? ' · This month' : ''}</div></div>
      ${statusPill(monthStatus(month))}
    </div>
    ${body}
  </a>`;
}

// ---- Month cash book ---------------------------------------------------------------

async function showMonth(id, { keepScroll = false } = {}) {
  const nav = ++state.nav;
  if (!keepScroll) {
    render(loading(), 'months');
    window.scrollTo(0, 0);
  }
  let cur, prev;
  try {
    [cur, prev] = await Promise.all([loadMonth(id), loadMonth(shiftMonth(id, -1))]);
  } catch (err) {
    if (nav === state.nav) render(errorPanel(err), 'months');
    return;
  }
  if (nav !== state.nav) return;
  state.month = { ...cur, prev };
  render(monthView(state.month), 'months');
}
const reloadMonth = () => showMonth(state.month.id, { keepScroll: true });

function monthView(m) {
  const { id, month, calc, prev } = m;
  const editor = canEdit(state.user);
  const admin = isAdmin(state.user);
  const status = monthStatus(month);
  const locked = status === 'final';
  const writable = editor && month && !locked;
  const y = leoYearOf(id);

  const head = `
  <section class="page-head">
    <div>
      <a class="back no-print" href="#/year/${y}">${icon.back}Leo year ${leoYearLabel(y)}</a>
      <h1 class="title">${monthLabel(id)}</h1>
      <p class="sub">Monthly treasurer report ${statusPill(status)}</p>
    </div>
    <div class="actions no-print">
      <a class="btn icon" href="#/month/${shiftMonth(id, -1)}" title="Previous month" aria-label="Previous month">${icon.left}</a>
      <a class="btn icon" href="#/month/${shiftMonth(id, 1)}" title="Next month" aria-label="Next month">${icon.right}</a>
      ${month ? `<button class="btn" data-action="print">${icon.print}Print</button><button class="btn" data-action="export-csv">${icon.download}CSV</button>` : ''}
      ${admin && month ? (locked
        ? `<button class="btn" data-action="unlock-month">${icon.unlock}Reopen</button>`
        : `<button class="btn" data-action="lock-month">${icon.lock}Finalize</button>`) : ''}
      ${writable ? `<button class="btn primary" data-action="add-entry">${icon.plus}Add entry</button>` : ''}
    </div>
  </section>`;

  if (!month) return head + notStartedView(m, editor);

  const printHead = `<div class="print-only print-head">
    <img src="assets/logo.webp" alt="">
    <div><h1>${esc(settings.clubName)}</h1><p>Treasurer’s Report — ${monthLabel(id)}</p></div>
  </div>`;

  const notices = [];
  if (locked) {
    notices.push(`<p class="notice">${icon.lock}<span>This month is finalized. ${admin ? 'Reopen it to make changes.' : 'Only the Treasurer or Super Admin can reopen it.'}</span></p>`);
  }
  const pc = prev.calc && prev.calc.closing;
  if (pc && (pc.cash !== calc.opening.cash || pc.bank !== calc.opening.bank)) {
    notices.push(`<p class="notice warn">${icon.alert}<span>Opening balances don’t match the closing balances of ${monthLabel(prev.id)}
      (cash ${money(pc.cash)} · bank ${money(pc.bank)}).</span>${writable ? '<button class="btn sm" data-action="carry-forward">Use those</button>' : ''}</p>`);
  }

  const net = total(calc.income) - total(calc.expense);
  const kpis = `<section class="kpis">
    ${kpi('Cash in hand', moneyHtml(calc.closing.cash), `Closing · ${fmtDate(lastDayIso(id))}`, 'gold', icon.cash)}
    ${kpi('Bank balance', moneyHtml(calc.closing.bank), `Closing · ${fmtDate(lastDayIso(id))}`, 'gold', icon.bank)}
    ${kpi('Total funds', moneyHtml(total(calc.closing)), `Opening ${fmt(total(calc.opening))}`, '', icon.funds)}
    ${kpi('Net for the month', `<span class="${net < 0 ? 'neg' : 'pos'}">${signed(net)}</span>`, `In ${fmt(total(calc.income))} · Out ${fmt(total(calc.expense))}`, net < 0 ? 'expense' : 'income', net < 0 ? icon.down : icon.up)}
  </section>`;

  const c = calc;
  const summary = `<section class="card">
    <div class="card-head"><h2>Balance summary</h2>${writable ? `<button class="btn sm no-print" data-action="edit-opening">${icon.edit}Opening balances</button>` : ''}</div>
    <div class="table-wrap"><table class="recon">
      <thead><tr><th></th><th class="num">Cash in hand</th><th class="num">Bank</th><th class="num">Total</th></tr></thead>
      <tbody>
        <tr><th scope="row">Opening balance <small>${fmtDate(`${id}-01`)}</small></th><td class="num">${fmt(c.opening.cash)}</td><td class="num">${fmt(c.opening.bank)}</td><td class="num">${fmt(total(c.opening))}</td></tr>
        <tr class="in"><th scope="row">Add: income received</th><td class="num">${signed(c.income.cash)}</td><td class="num">${signed(c.income.bank)}</td><td class="num">${signed(total(c.income))}</td></tr>
        <tr class="out"><th scope="row">Less: expenses paid</th><td class="num">${signed(-c.expense.cash)}</td><td class="num">${signed(-c.expense.bank)}</td><td class="num">${signed(-total(c.expense))}</td></tr>
        <tr class="xfer"><th scope="row">Transfers cash ⇄ bank</th><td class="num">${signed(c.transfer.cash)}</td><td class="num">${signed(c.transfer.bank)}</td><td class="num">${fmt(0)}</td></tr>
      </tbody>
      <tfoot><tr><th scope="row">Closing balance <small>${fmtDate(lastDayIso(id))}</small></th><td class="num">${moneyHtml(c.closing.cash)}</td><td class="num">${moneyHtml(c.closing.bank)}</td><td class="num">${moneyHtml(total(c.closing))}</td></tr></tfoot>
    </table></div>
  </section>`;

  const cols = writable ? 9 : 8;
  const entries = c.rows.length
    ? c.rows.map((tx) => {
        const sign = tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : '';
        const details = [
          tx.description ? esc(tx.description) : '',
          tx.ref ? `<span class="ref">${esc(tx.ref)}</span>` : '',
          tx.hasProof ? `<button class="proof-link" data-action="view-proof" data-id="${esc(tx.id)}" title="View proof image">${icon.clip}Proof</button>` : '',
        ].filter(Boolean).join(' ');
        return `<tr title="Entered by ${esc(tx.createdBy || '')}">
          <td class="nowrap">${fmtDate(tx.date)}</td>
          <td class="proj">${esc(tx.project)}</td>
          <td class="details">${details || '<span class="faint">—</span>'}</td>
          <td>${typePill(tx.type)}</td>
          <td class="nowrap via">${viaLabel(tx)}</td>
          <td class="num amt ${tx.type}">${sign}${fmt(tx.amt)}</td>
          <td class="num bal${tx.cashBal < 0 ? ' neg' : ''}">${fmt(tx.cashBal)}</td>
          <td class="num bal${tx.bankBal < 0 ? ' neg' : ''}">${fmt(tx.bankBal)}</td>
          ${writable ? `<td class="row-actions no-print">
            <button class="btn icon sm ghost" data-action="edit-entry" data-id="${esc(tx.id)}" title="Edit" aria-label="Edit entry">${icon.edit}</button>
            <button class="btn icon sm ghost danger" data-action="delete-entry" data-id="${esc(tx.id)}" title="Delete" aria-label="Delete entry">${icon.trash}</button>
          </td>` : ''}
        </tr>`;
      }).join('')
    : `<tr><td colspan="${cols}"><div class="empty-row">No entries yet.${writable ? ' Use <b>Add entry</b> to record money received or paid.' : ''}</div></td></tr>`;

  const ledger = `<section class="card">
    <div class="card-head"><h2>Cash book</h2><span class="muted">${c.rows.length} ${c.rows.length === 1 ? 'entry' : 'entries'}</span>
      ${writable ? `<button class="btn sm primary no-print" data-action="add-entry">${icon.plus}Add entry</button>` : ''}</div>
    <div class="table-wrap"><table class="ledger">
      <thead><tr><th>Date</th><th>Project</th><th>Details / ref</th><th>Type</th><th>Via</th><th class="num">Amount</th><th class="num">Cash in hand</th><th class="num">Bank</th>${writable ? '<th class="no-print"><span class="sr">Actions</span></th>' : ''}</tr></thead>
      <tbody>
        <tr class="bal-row"><td class="nowrap">${fmtDate(`${id}-01`)}</td><td colspan="5">Opening balance</td><td class="num">${fmt(c.opening.cash)}</td><td class="num">${fmt(c.opening.bank)}</td>${writable ? '<td class="no-print"></td>' : ''}</tr>
        ${entries}
      </tbody>
      <tfoot><tr class="bal-row"><td class="nowrap">${fmtDate(lastDayIso(id))}</td><td colspan="5">Closing balance</td><td class="num">${fmt(c.closing.cash)}</td><td class="num">${fmt(c.closing.bank)}</td>${writable ? '<td class="no-print"></td>' : ''}</tr></tfoot>
    </table></div>
  </section>`;

  const projects = c.projects.length
    ? `<section class="card">
        <div class="card-head"><h2>By project</h2><span class="muted">Transfers excluded</span></div>
        <div class="table-wrap"><table class="compact">
          <thead><tr><th>Project</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Net</th></tr></thead>
          <tbody>${c.projects.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${p.income ? fmt(p.income) : '—'}</td><td class="num">${p.expense ? fmt(p.expense) : '—'}</td><td class="num ${p.income - p.expense < 0 ? 'neg' : 'pos'}">${signed(p.income - p.expense)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th scope="row">Total</th><td class="num">${fmt(total(c.income))}</td><td class="num">${fmt(total(c.expense))}</td><td class="num">${signed(net)}</td></tr></tfoot>
        </table></div>
      </section>`
    : '';

  const signatures = `<section class="print-only signatures">
    <div><span></span>Treasurer</div><div><span></span>President</div><div><span></span>Date</div>
  </section>`;

  return head + printHead + notices.join('') + kpis + summary + ledger + projects + signatures;
}

function notStartedView({ id, prev }, editor) {
  if (!editor) {
    return `<section class="card empty-state">${icon.calendar}<h2>Not started yet</h2>
      <p>The treasurer hasn’t opened the ${monthLabel(id)} cash book yet.</p></section>`;
  }
  const pc = prev.calc && prev.calc.closing;
  return `<section class="card start-card">
    <h2>Start ${monthLabel(id)}</h2>
    <p class="muted">Enter the cash in hand and bank balance at the start of the month.
      ${pc ? `Pre-filled from the ${monthLabel(prev.id)} closing balances.` : 'There’s no previous month on record, so enter them from your cash count and bank statement.'}</p>
    <form data-form="start" class="stack" novalidate>
      <div class="grid2">
        <label class="field"><span>Opening cash in hand (${sym})</span><input type="number" name="openingCash" step="0.01" inputmode="decimal" required value="${pc ? (pc.cash / 100).toFixed(2) : ''}" autofocus></label>
        <label class="field"><span>Opening bank balance (${sym})</span><input type="number" name="openingBank" step="0.01" inputmode="decimal" required value="${pc ? (pc.bank / 100).toFixed(2) : ''}"></label>
      </div>
      <p class="form-error" hidden></p>
      <div><button class="btn primary" type="submit">${icon.check}Start month</button></div>
    </form>
  </section>`;
}

// ---- Dialogs -----------------------------------------------------------------------

function openDialog(html) {
  dialog.innerHTML = html;
  dialog.showModal();
  dialog.querySelector('[autofocus]')?.focus();
}

function entryDialog(tx) {
  const { id } = state.month;
  const t = tx || { type: 'income', account: 'cash', date: todayIso().startsWith(id) ? todayIso() : `${id}-01`, project: '', description: '', ref: '', amount: '' };
  const radio = (name, value, label, sub) =>
    `<label><input type="radio" name="${name}" value="${value}"${t[name] === value ? ' checked' : ''}><span><b data-label="${name}-${value}">${label}</b>${sub ? `<small data-sub="${name}-${value}">${sub}</small>` : ''}</span></label>`;
  openDialog(`<form data-form="entry" class="dlg" novalidate>
    <input type="hidden" name="id" value="${tx ? esc(tx.id) : ''}">
    <header class="dlg-head"><div><h2>${tx ? 'Edit entry' : 'Add entry'}</h2><p class="muted">${monthLabel(id)}</p></div>
      <button type="button" class="btn icon ghost" data-action="close-dialog" aria-label="Close">${icon.x}</button></header>
    <div class="dlg-body stack">
      <div class="seg three type-seg" role="radiogroup" aria-label="Type">
        ${radio('type', 'income', 'Income', 'Money received')}
        ${radio('type', 'expense', 'Expense', 'Money paid')}
        ${radio('type', 'transfer', 'Transfer', 'Cash ⇄ bank')}
      </div>
      <div class="field"><span id="acct-label">Received into</span>
        <div class="seg two" role="radiogroup" aria-labelledby="acct-label">
          ${radio('account', 'cash', 'Cash in hand')}
          ${radio('account', 'bank', 'Bank')}
        </div>
      </div>
      <div class="grid2">
        <label class="field"><span>Date</span><input type="date" name="date" min="${id}-01" max="${lastDayIso(id)}" value="${esc(t.date)}" required></label>
        <label class="field"><span>Amount (${sym})</span><input type="number" name="amount" step="0.01" min="0.01" inputmode="decimal" value="${t.amount === '' ? '' : esc(t.amount)}" required autofocus></label>
      </div>
      <label class="field"><span>Project <i class="opt" data-opt-project hidden>(optional)</i></span>
        <input name="project" list="project-list" maxlength="120" value="${esc(t.project)}" placeholder="e.g. Blood donation campaign" required></label>
      <datalist id="project-list">${[...state.projects].sort().map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      <div class="grid2">
        <label class="field"><span>Details <i class="opt">(optional)</i></span><input name="description" maxlength="300" value="${esc(t.description || '')}" placeholder="What was it for?"></label>
        <label class="field"><span>Receipt / voucher no. <i class="opt">(optional)</i></span><input name="ref" maxlength="40" value="${esc(t.ref || '')}"></label>
      </div>
      <div class="field"><span>Proof image <i class="opt">(optional — receipt, bill or bank slip)</i></span>
        <div class="proof-box">
          <img class="proof-thumb" alt="Proof preview" hidden>
          <span class="proof-status muted">${tx && tx.hasProof ? 'Loading attached image…' : 'No image attached'}</span>
          <label class="btn sm">${icon.camera}<span class="proof-pick">${tx && tx.hasProof ? 'Replace' : 'Attach image'}</span><input type="file" accept="image/*" data-proof-input hidden></label>
          <button type="button" class="btn sm ghost danger" data-action="remove-proof"${tx && tx.hasProof ? '' : ' hidden'}>Remove</button>
        </div>
      </div>
      <p class="form-error" hidden></p>
    </div>
    <footer class="dlg-foot">
      <button type="button" class="btn ghost" data-action="close-dialog">Cancel</button>
      <button type="submit" class="btn primary">${tx ? 'Save changes' : 'Add entry'}</button>
    </footer>
  </form>`);
  const form = dialog.querySelector('form');
  syncEntryForm(form);
  state.proofDraft = undefined; // undefined = unchanged, string = new image, null = remove
  if (tx && tx.hasProof) {
    state.be.getProof(id, tx.id).then((src) => {
      if (form.isConnected && state.proofDraft === undefined) showProof(form, src, src ? 'Image attached' : 'No image attached');
    });
  }
}

function showProof(form, src, status) {
  const img = form.querySelector('.proof-thumb');
  img.hidden = !src;
  if (src) img.src = src;
  else img.removeAttribute('src');
  form.querySelector('.proof-status').textContent = status;
  form.querySelector('.proof-pick').textContent = src ? 'Replace' : 'Attach image';
  form.querySelector('[data-action="remove-proof"]').hidden = !src;
}

// Shrink a photo to a JPEG small enough to store in the database (~700 KB max).
async function compressImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (JPG or PNG).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('This image format can’t be read here. Try a JPG or PNG (or a screenshot of it).'));
      el.src = url;
    });
    for (const [side, quality] of [[1600, 0.75], [1280, 0.7], [1024, 0.6], [800, 0.55]]) {
      const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length < 700000) return data;
    }
    throw new Error('That image is too large even after shrinking. Try a smaller photo.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function viewProof(tx) {
  openDialog(`<div class="dlg">
    <header class="dlg-head"><div><h2>Proof</h2><p class="muted">${fmtDate(tx.date)} · ${esc(tx.project)} · ${money(tx.amt)}</p></div>
      <button type="button" class="btn icon ghost" data-action="close-dialog" aria-label="Close">${icon.x}</button></header>
    <div class="dlg-body proof-view">${loading()}</div>
    <footer class="dlg-foot"><button type="button" class="btn ghost" data-action="close-dialog">Close</button></footer>
  </div>`);
  const body = dialog.querySelector('.proof-view');
  try {
    const src = await state.be.getProof(state.month.id, tx.id);
    if (!body.isConnected) return;
    body.innerHTML = src
      ? `<img src="${src}" alt="Proof for ${esc(tx.project)}"><a class="btn sm" href="${src}" download="proof-${tx.date}-${esc(tx.id)}.jpg">${icon.download}Download</a>`
      : '<p class="muted">No image found for this entry.</p>';
  } catch (err) {
    body.innerHTML = `<p class="form-error">${esc(errorText(err))}</p>`;
  }
}

// Relabel the account choice to match the entry type (e.g. "Paid from", "Cash → Bank").
function syncEntryForm(form) {
  const type = form.elements.type.value;
  const labels = {
    income: ['Received into', 'Cash in hand', 'Bank', '', ''],
    expense: ['Paid from', 'Cash in hand', 'Bank', '', ''],
    transfer: ['Direction', 'Cash → Bank', 'Bank → Cash', 'Deposit', 'Withdrawal'],
  }[type];
  form.querySelector('#acct-label').textContent = labels[0];
  form.querySelector('[data-label="account-cash"]').textContent = labels[1];
  form.querySelector('[data-label="account-bank"]').textContent = labels[2];
  form.querySelectorAll('.seg.two small').forEach((s) => s.remove());
  if (labels[3]) {
    form.querySelector('[data-label="account-cash"]').insertAdjacentHTML('afterend', `<small>${labels[3]}</small>`);
    form.querySelector('[data-label="account-bank"]').insertAdjacentHTML('afterend', `<small>${labels[4]}</small>`);
  }
  form.elements.project.required = type !== 'transfer';
  form.querySelector('[data-opt-project]').hidden = type !== 'transfer';
}

function openingDialog() {
  const { id, calc, prev } = state.month;
  const pc = prev.calc && prev.calc.closing;
  openDialog(`<form data-form="opening" class="dlg" novalidate>
    <header class="dlg-head"><div><h2>Opening balances</h2><p class="muted">${monthLabel(id)} · as at ${fmtDate(`${id}-01`)}</p></div>
      <button type="button" class="btn icon ghost" data-action="close-dialog" aria-label="Close">${icon.x}</button></header>
    <div class="dlg-body stack">
      <div class="grid2">
        <label class="field"><span>Cash in hand (${sym})</span><input type="number" name="openingCash" step="0.01" inputmode="decimal" value="${(calc.opening.cash / 100).toFixed(2)}" required autofocus></label>
        <label class="field"><span>Bank balance (${sym})</span><input type="number" name="openingBank" step="0.01" inputmode="decimal" value="${(calc.opening.bank / 100).toFixed(2)}" required></label>
      </div>
      ${pc ? `<button type="button" class="btn sm" data-action="fill-prev" data-cash="${(pc.cash / 100).toFixed(2)}" data-bank="${(pc.bank / 100).toFixed(2)}">
        Use ${monthLabel(prev.id)} closing (${fmt(pc.cash)} · ${fmt(pc.bank)})</button>` : ''}
      <p class="form-error" hidden></p>
    </div>
    <footer class="dlg-foot">
      <button type="button" class="btn ghost" data-action="close-dialog">Cancel</button>
      <button type="submit" class="btn primary">Save</button>
    </footer>
  </form>`);
}

function readOpening(d) {
  const openingCash = parseAmount(d.openingCash);
  const openingBank = parseAmount(d.openingBank);
  if (Number.isNaN(openingCash) || Number.isNaN(openingBank) || d.openingCash === '' || d.openingBank === '') {
    throw new Error('Enter both opening balances (use 0 if there is none).');
  }
  return { openingCash, openingBank };
}

// ---- CSV export ----------------------------------------------------------------------

function exportCsv() {
  const { id, calc: c } = state.month;
  const n = (v) => (v / 100).toFixed(2);
  const lines = [
    [settings.clubName, `Treasurer's report - ${monthLabel(id)}`],
    [],
    ['', 'Cash in hand', 'Bank', 'Total'],
    ['Opening balance', n(c.opening.cash), n(c.opening.bank), n(total(c.opening))],
    ['Income received', n(c.income.cash), n(c.income.bank), n(total(c.income))],
    ['Expenses paid', n(-c.expense.cash), n(-c.expense.bank), n(-total(c.expense))],
    ['Transfers', n(c.transfer.cash), n(c.transfer.bank), n(0)],
    ['Closing balance', n(c.closing.cash), n(c.closing.bank), n(total(c.closing))],
    [],
    ['Date', 'Project', 'Details', 'Receipt/voucher', 'Type', 'Via', 'Amount', 'Cash in hand balance', 'Bank balance', 'Proof image', 'Entered by'],
    ...c.rows.map((tx) => [tx.date, tx.project, tx.description || '', tx.ref || '', TYPE_LABEL[tx.type], viaLabel(tx).replace('→', 'to'), n(tx.type === 'expense' ? -tx.amt : tx.amt), n(tx.cashBal), n(tx.bankBal), tx.hasProof ? 'Yes' : '', tx.createdBy || '']),
  ];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = `﻿${lines.map((r) => r.map(q).join(',')).join('\r\n')}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `treasurer-report-${id}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- Committee ---------------------------------------------------------------------------

async function showCommittee() {
  const nav = ++state.nav;
  render(loading(), 'committee');
  window.scrollTo(0, 0);
  let members;
  try {
    members = await state.be.listMembers();
  } catch (err) {
    if (nav === state.nav) render(errorPanel(err), 'committee');
    return;
  }
  if (nav !== state.nav) return;
  state.members = members;
  render(committeeView(members), 'committee');
}

function committeeView(members) {
  const admin = isAdmin(state.user);
  const byPos = new Map(members.map((m) => [m.position, m]));
  const rows = POSITIONS.map((p) => {
    const m = byPos.get(p.id);
    const you = m && m.email === state.user.email ? ' <span class="you">You</span>' : '';
    // Only the Super Admin can change the Super Admin slot.
    if (!admin || (p.super && !isSuper(state.user))) {
      return `<div class="member-row read">
        <div class="mr-pos"><b>${esc(p.label)}</b>${accessPill(p)}</div>
        <div class="mr-name">${m ? esc(m.name) + you : '<span class="faint">Vacant</span>'}</div>
        <div class="mr-email">${m ? esc(m.email) : ''}</div>
      </div>`;
    }
    return `<form class="member-row" data-form="member" novalidate>
      <input type="hidden" name="position" value="${p.id}">
      <input type="hidden" name="prevEmail" value="${m ? esc(m.email) : ''}">
      <div class="mr-pos"><b>${esc(p.label)}</b>${accessPill(p)}${you}</div>
      <label class="field"><span>Name</span><input name="name" maxlength="80" value="${m ? esc(m.name) : ''}" placeholder="Full name"></label>
      <label class="field"><span>Email</span><input type="email" name="email" value="${m ? esc(m.email) : ''}" placeholder="name@example.com"></label>
      <div class="mr-actions">
        <button class="btn sm" type="submit">${icon.check}Save</button>
        ${m ? `<button class="btn sm ghost danger" type="button" data-action="remove-member" data-email="${esc(m.email)}">Remove</button>` : ''}
      </div>
      <p class="form-error" hidden></p>
    </form>`;
  }).join('');

  const how = admin
    ? `<section class="card how">
        <h2>How access works</h2>
        <ol>
          <li>Enter the person’s name and email for their position and press <b>Save</b>.</li>
          <li>They open this site and choose <b>First time? Set up your account</b>, using that same email.</li>
          <li>They click the verification link we email them, then sign in.</li>
        </ol>
        <p class="muted">Anyone not on this list can’t see any data, even with an account. When the committee changes, just replace the email here.</p>
      </section>`
    : '';

  return `<section class="page-head">
      <div>
        <p class="eyebrow">Access</p>
        <h1 class="title">Committee</h1>
        <p class="sub">Only these positions can sign in. The Super Admin, Treasurer and Assistant Treasurers can edit; everyone else can view.</p>
      </div>
    </section>
    <section class="card member-list">${rows}</section>
    ${how}`;
}

// ---- Forms ---------------------------------------------------------------------------------

const forms = {
  async signin({ email, password }) {
    if (!email.trim() || !password) throw new Error('Enter your email and password.');
    await state.be.signIn(email, password);
  },
  async signup({ email, password, confirm }) {
    if (!email.trim()) throw new Error('Enter your email.');
    if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
    if (password !== confirm) throw new Error('The two passwords don’t match.');
    await state.be.signUp(email, password);
  },
  async reset({ email }) {
    if (!email.trim()) throw new Error('Enter your email.');
    await state.be.resetPassword(email);
    state.authView = 'signin';
    state.authNote = `If an account exists for ${email.trim()}, a reset link is on its way.`;
    renderAuth();
  },
  async start(d) {
    await state.be.saveMonth(state.month.id, { ...readOpening(d), locked: false });
    toast(`${monthLabel(state.month.id)} started`);
    await reloadMonth();
  },
  async opening(d) {
    await state.be.saveMonth(state.month.id, readOpening(d));
    dialog.close();
    toast('Opening balances saved');
    await reloadMonth();
  },
  async entry(d) {
    const monthId = state.month.id;
    const amount = parseAmount(d.amount);
    if (!(amount > 0)) throw new Error('Enter an amount greater than zero.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date) || !d.date.startsWith(`${monthId}-`)) throw new Error(`Pick a date in ${monthLabel(monthId)}.`);
    if (!['income', 'expense', 'transfer'].includes(d.type) || !['cash', 'bank'].includes(d.account)) throw new Error('Choose a type and account.');
    let project = d.project.trim();
    if (!project) {
      if (d.type !== 'transfer') throw new Error('Enter the project this belongs to.');
      project = d.account === 'cash' ? 'Cash deposited to bank' : 'Cash withdrawn from bank';
    }
    const tx = { date: d.date, type: d.type, account: d.account, project, description: d.description.trim(), ref: d.ref.trim(), amount };
    if (d.id) await state.be.updateTransaction(monthId, d.id, tx, state.proofDraft);
    else await state.be.addTransaction(monthId, tx, state.proofDraft || undefined);
    dialog.close();
    toast(d.id ? 'Entry updated' : 'Entry added');
    await reloadMonth();
  },
  async member(d) {
    const email = normEmail(d.email);
    const name = d.name.trim();
    const label = positionInfo(d.position).label;
    if (!name) throw new Error('Enter a name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
    const clash = state.members.find((m) => m.email === email && m.position !== d.position);
    if (clash) throw new Error(`${email} is already listed as ${positionInfo(clash.position).label}.`);
    const replacingSelf = d.prevEmail === state.user.email && email !== d.prevEmail;
    if (replacingSelf && !confirm(`You’re replacing your own email as ${label}. You will lose access when you save. Continue?`)) return;
    await state.be.saveMember(email, { name, position: d.position }, d.prevEmail || null);
    if (replacingSelf) return state.be.signOut();
    if (email === state.user.email) state.user.name = name;
    toast(`${label} saved`);
    await showCommittee();
  },
};

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const btn = form.querySelector('[type=submit]');
  const errEl = form.querySelector('.form-error');
  if (errEl) errEl.hidden = true;
  if (btn) btn.disabled = true;
  try {
    await forms[form.dataset.form](Object.fromEntries(new FormData(form)), form);
  } catch (err) {
    console.error(err);
    if (errEl && errEl.isConnected) {
      errEl.textContent = errorText(err);
      errEl.hidden = false;
    } else toast(errorText(err), 'error');
  } finally {
    if (btn && btn.isConnected) btn.disabled = false;
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.name === 'type' && e.target.closest('form[data-form="entry"]')) syncEntryForm(e.target.form);
  if (e.target.matches('[data-proof-input]')) {
    const input = e.target;
    const form = input.closest('form');
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    form.querySelector('.proof-status').textContent = 'Preparing image…';
    try {
      const data = await compressImage(file);
      state.proofDraft = data;
      showProof(form, data, `${file.name} · ${Math.round((data.length * 0.75) / 1024)} KB`);
    } catch (err) {
      form.querySelector('.proof-status').textContent = '';
      toast(errorText(err), 'error');
    }
  }
});

// ---- Actions ---------------------------------------------------------------------------------

const findTx = (id) => state.month.txs.find((t) => t.id === id);

const actions = {
  'auth-view': (el) => {
    state.authView = el.dataset.view;
    renderAuth();
  },
  'demo-signin': (el) => state.be.signIn(el.dataset.email),
  'demo-reset': async () => {
    if (!confirm('Reset the demo back to its sample data?')) return;
    state.projects.clear();
    await state.be.resetDemo();
    toast('Demo data reset');
  },
  'sign-out': () => {
    state.authView = 'signin';
    return state.be.signOut();
  },
  recheck: async () => {
    await state.be.recheck();
    if (state.auth.state === 'unverified') toast('Not verified yet — open the link in your email first.', 'error');
  },
  'resend-verification': async () => {
    await state.be.resendVerification();
    toast('Verification email sent');
  },
  retry: () => route(),
  print: () => window.print(),
  'export-csv': () => exportCsv(),
  'close-dialog': () => dialog.close(),
  'add-entry': () => entryDialog(),
  'edit-entry': (el) => entryDialog(findTx(el.dataset.id)),
  'view-proof': (el) => viewProof(state.month.calc.rows.find((t) => t.id === el.dataset.id)),
  'remove-proof': (el) => {
    state.proofDraft = null;
    showProof(el.closest('form'), null, 'Image will be removed when you save');
  },
  'delete-entry': async (el) => {
    const tx = findTx(el.dataset.id);
    if (!tx || !confirm(`Delete this entry?\n\n${fmtDate(tx.date)} · ${tx.project} · ${money(Math.round(tx.amount * 100))}`)) return;
    await state.be.deleteTransaction(state.month.id, tx.id);
    toast('Entry deleted');
    await reloadMonth();
  },
  'edit-opening': () => openingDialog(),
  'fill-prev': (el) => {
    const form = el.closest('form');
    form.elements.openingCash.value = el.dataset.cash;
    form.elements.openingBank.value = el.dataset.bank;
  },
  'carry-forward': async () => {
    const pc = state.month.prev.calc.closing;
    await state.be.saveMonth(state.month.id, { openingCash: pc.cash / 100, openingBank: pc.bank / 100 });
    toast('Opening balances updated');
    await reloadMonth();
  },
  'lock-month': async () => {
    const label = monthLabel(state.month.id);
    if (!confirm(`Finalize ${label}?\n\nAssistant treasurers won’t be able to change it until you reopen it.`)) return;
    await state.be.saveMonth(state.month.id, { locked: true });
    toast(`${label} finalized`);
    await reloadMonth();
  },
  'unlock-month': async () => {
    await state.be.saveMonth(state.month.id, { locked: false });
    toast(`${monthLabel(state.month.id)} reopened`);
    await reloadMonth();
  },
  'remove-member': async (el) => {
    const email = el.dataset.email;
    const self = email === state.user.email;
    if (!confirm(self ? 'Remove yourself? You will lose access immediately.' : `Remove ${email}? They will lose access immediately.`)) return;
    await state.be.removeMember(email);
    if (self) return state.be.signOut();
    toast('Removed');
    await showCommittee();
  },
};

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  e.preventDefault();
  try {
    await actions[el.dataset.action](el);
  } catch (err) {
    console.error(err);
    toast(errorText(err), 'error');
  }
});

// Click on the dim backdrop closes a dialog.
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
});

// ---- Start -------------------------------------------------------------------------------------

async function init() {
  try {
    state.be = await createBackend();
  } catch (err) {
    console.error(err);
    app.innerHTML = authLayout(`<h1 class="auth-title">Can’t start</h1><p class="auth-sub">Firebase couldn’t be loaded. Check your internet connection and the settings in <code>js/config.js</code>.</p>`);
    return;
  }
  state.be.onAuthChange((auth) => {
    state.nav++;
    state.auth = auth;
    state.user = auth.state === 'ready' ? auth.user : null;
    if (state.user) route();
    else {
      if (dialog.open) dialog.close();
      renderAuth();
    }
  });
}

init();

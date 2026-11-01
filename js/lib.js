// Shared helpers: committee positions, month/date maths, money formatting and the balance calculation.
import { settings } from './config.js';

// The only positions that can sign in. Treasurer + assistants can edit; the treasurer also manages the list.
// The Super Admin can do everything, including managing the Super Admin slot itself.
export const POSITIONS = [
  { id: 'super_admin', label: 'Super Admin', edit: true, admin: true, super: true },
  { id: 'president', label: 'President' },
  { id: 'ipp', label: 'Immediate Past President' },
  { id: 'vice_president', label: 'Vice President' },
  { id: 'secretary', label: 'Secretary' },
  { id: 'treasurer', label: 'Treasurer', edit: true, admin: true },
  { id: 'asst_treasurer_1', label: 'Assistant Treasurer', edit: true },
  { id: 'asst_treasurer_2', label: 'Assistant Treasurer', edit: true },
  { id: 'asst_treasurer_3', label: 'Assistant Treasurer', edit: true },
];

export const positionInfo = (id) => POSITIONS.find((p) => p.id === id) || { id, label: 'Unknown position' };
export const canEdit = (user) => !!user && !!positionInfo(user.position).edit;
export const isAdmin = (user) => !!user && !!positionInfo(user.position).admin;
export const isSuper = (user) => !!user && !!positionInfo(user.position).super;

// ---- Months ("2026-10") ---------------------------------------------------

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n) => String(n).padStart(2, '0');

export const monthId = (y, m) => `${y}-${pad(m)}`;
export function parseMonthId(id) {
  const [y, m] = id.split('-').map(Number);
  return { y, m };
}
export function shiftMonth(id, delta) {
  const { y, m } = parseMonthId(id);
  const i = y * 12 + (m - 1) + delta;
  return monthId(Math.floor(i / 12), (i % 12) + 1);
}
export const monthName = (id) => MONTH_NAMES[parseMonthId(id).m - 1];
export const monthLabel = (id) => `${monthName(id)} ${parseMonthId(id).y}`;
export function currentMonthId() {
  const d = new Date();
  return monthId(d.getFullYear(), d.getMonth() + 1);
}
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function lastDayIso(id) {
  const { y, m } = parseMonthId(id);
  return `${id}-${pad(new Date(y, m, 0).getDate())}`;
}
export function fmtDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${pad(d)} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}

// Leo year: starts in settings.leoYearStartMonth (July) and is named after the year it starts in.
export function leoYearOf(id) {
  const { y, m } = parseMonthId(id);
  return m >= settings.leoYearStartMonth ? y : y - 1;
}
export function leoYearLabel(y) {
  return settings.leoYearStartMonth === 1 ? String(y) : `${y}/${pad((y + 1) % 100)}`;
}
export function leoYearMonths(y) {
  const first = monthId(y, settings.leoYearStartMonth);
  return Array.from({ length: 12 }, (_, i) => shiftMonth(first, i));
}

// ---- Money (all maths in integer cents to avoid floating-point drift) ------

export const toCents = (n) => Math.round((Number(n) || 0) * 100);
const nf = new Intl.NumberFormat(settings.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt = (c) => nf.format(c / 100 + 0);
export const money = (c) => `${settings.currencySymbol} ${fmt(c)}`;
export const total = (pair) => pair.cash + pair.bank;

export function parseAmount(value) {
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// ---- Balance calculation ---------------------------------------------------
//
// tx.type: 'income' | 'expense' | 'transfer'
// tx.account: 'cash' | 'bank' — for a transfer this is the account the money leaves.

export function computeMonth(month, txs) {
  const opening = { cash: toCents(month.openingCash), bank: toCents(month.openingBank) };
  const income = { cash: 0, bank: 0 };
  const expense = { cash: 0, bank: 0 };
  const transfer = { cash: 0, bank: 0 };
  const bal = { ...opening };
  const projects = new Map();

  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
  const rows = sorted.map((tx) => {
    const amt = toCents(tx.amount);
    const from = tx.account === 'bank' ? 'bank' : 'cash';
    const to = from === 'cash' ? 'bank' : 'cash';
    if (tx.type === 'income') {
      income[from] += amt;
      bal[from] += amt;
    } else if (tx.type === 'expense') {
      expense[from] += amt;
      bal[from] -= amt;
    } else {
      transfer[from] -= amt;
      transfer[to] += amt;
      bal[from] -= amt;
      bal[to] += amt;
    }
    if (tx.type !== 'transfer') {
      const key = tx.project.trim().toLowerCase();
      const p = projects.get(key) || { name: tx.project.trim(), income: 0, expense: 0 };
      p[tx.type] += amt;
      projects.set(key, p);
    }
    return { ...tx, amt, cashBal: bal.cash, bankBal: bal.bank };
  });

  return {
    opening,
    income,
    expense,
    transfer,
    closing: { ...bal },
    rows,
    projects: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

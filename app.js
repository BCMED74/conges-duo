/* Congés Duo — PWA de suivi des congés pour deux personnes.
   Aucune donnée personnelle dans ce fichier : les données sont stockées sur le téléphone
   (localStorage) et synchronisées dans un repo GitHub privé, configuré dans Réglages. */
'use strict';

const STORE_KEY = 'congesDuo.v1';
const P = ['a', 'b'];
const DOW = ['di', 'lu', 'ma', 'me', 'je', 've', 'sa'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const TYPES = { conge: 'Congé', extra: 'Travail en plus', otdone: 'Heures sup faites', otrecup: 'Récup heures sup' };
const PARTS = { full: 'Journée', am: 'Matin', pm: 'Après-midi' };

/* ---------- Dates (chaînes AAAA-MM-JJ, calculs en UTC) ---------- */
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function fmt(dt) { return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
function addDays(s, n) { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); }
const dow = s => parse(s).getUTCDay();
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
function todayISO() { const d = new Date(); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
function frDate(s) { const [y, m, d] = s.split('-'); return `${DOW[dow(s)]} ${d}.${m}.${y}`; }
function short(s) { const [, m, d] = s.split('-'); return `${DOW[dow(s)]} ${d}.${m}`; }
const autoStatus = s => (s <= todayISO() ? 'pris' : 'prevu');

/* ---------- Jours fériés du canton de Vaud ---------- */
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
    f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31),
    da = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, mo, da);
}
const holCache = {};
function holidays(y) {
  if (holCache[y]) return holCache[y];
  const e = easter(y);
  const sep1 = iso(y, 9, 1);
  const firstSunday = addDays(sep1, (7 - dow(sep1)) % 7);
  const list = [
    [iso(y, 1, 1), 'Nouvel An'],
    [iso(y, 1, 2), '2 janvier'],
    [addDays(e, -2), 'Vendredi-Saint'],
    [addDays(e, 1), 'Lundi de Pâques'],
    [addDays(e, 39), 'Ascension'],
    [addDays(e, 50), 'Lundi de Pentecôte'],
    [iso(y, 8, 1), 'Fête nationale'],
    [addDays(firstSunday, 15), 'Lundi du Jeûne fédéral'],
    [iso(y, 12, 25), 'Noël'],
  ].sort((x, z) => x[0].localeCompare(z[0]));
  const map = {};
  list.forEach(([d, n]) => { map[d] = n; });
  return (holCache[y] = { list, map });
}
const holidayName = s => holidays(+s.slice(0, 4)).map[s] || null;

/* ---------- Données ---------- */
function defaultPerson(name, droit, bloc, ot) {
  return {
    name, rest: [6, 0], droit, report: {},
    bloc: { enabled: bloc, official: 10, periods: {} },
    ot: { enabled: ot, startDate: '', startHours: 0, hoursPerDay: 8.4 },
  };
}
function defaultData() {
  return { version: 1, su: 0, persons: { a: defaultPerson('Personne 1', 20, true, false), b: defaultPerson('Personne 2', 25, false, true) }, entries: [], deleted: {} };
}
function deepMerge(base, over) {
  const out = { ...base };
  for (const k in over) {
    const bv = base[k], ov = over[k];
    if (ov && typeof ov === 'object' && !Array.isArray(ov) && bv && typeof bv === 'object' && !Array.isArray(bv)) out[k] = deepMerge(bv, ov);
    else out[k] = ov;
  }
  return out;
}
function migrate(d) {
  const def = defaultData();
  const out = { version: 1, su: +d.su || 0, persons: {}, entries: Array.isArray(d.entries) ? d.entries : [],
    deleted: d.deleted && typeof d.deleted === 'object' && !Array.isArray(d.deleted) ? d.deleted : {} };
  for (const p of P) out.persons[p] = deepMerge(def.persons[p], (d.persons && d.persons[p]) || {});
  return out;
}
let DB = defaultData();
function load() {
  try { const raw = localStorage.getItem(STORE_KEY); DB = raw ? migrate(JSON.parse(raw)) : defaultData(); }
  catch (e) { DB = defaultData(); }
}
function saveLocal() { if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(DB)); }
function save() {
  saveLocal();
  if (typeof localStorage === 'undefined') return;
  SY.dirty = true; saveSync(); setSyncState(); scheduleSync();
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const val = e => (e.part === 'full' ? 1 : 0.5);

function buildIdx() {
  const idx = {};
  for (const e of DB.entries) (idx[e.date] = idx[e.date] || []).push(e);
  return idx;
}

/* ---------- Statut d'une journée pour une personne ---------- */
function blocYearOf(p, s) {
  const b = DB.persons[p].bloc;
  if (!b.enabled) return null;
  for (const y in b.periods) {
    const pr = b.periods[y];
    if (pr && pr.start && pr.end && s >= pr.start && s <= pr.end) return y;
  }
  return null;
}
const isRest = (p, s) => DB.persons[p].rest.includes(dow(s));
function baseKind(p, s) { if (isRest(p, s)) return 'rest'; if (holidayName(s)) return 'hol'; return 'work'; }
const isWorkday = (p, s) => baseKind(p, s) === 'work' && blocYearOf(p, s) === null;

function dayInfo(p, s, idx) {
  const base = baseKind(p, s);
  const bloc = base === 'work' && blocYearOf(p, s) !== null;
  const start = bloc ? { k: 'bloc', st: autoStatus(s) } : { k: base, st: null };
  const half = { am: { ...start }, pm: { ...start } };
  let ot = false;
  for (const e of (idx[s] || [])) {
    if (e.person !== p) continue;
    if (e.type === 'otdone') { ot = true; continue; }
    const k = e.type === 'conge' ? 'conge' : e.type === 'otrecup' ? 'recup' : 'extra';
    for (const h of (e.part === 'full' ? ['am', 'pm'] : [e.part])) half[h] = { k, st: e.status, id: e.id };
  }
  const off = h => ['rest', 'hol', 'bloc', 'conge', 'recup'].includes(half[h].k);
  return { base, bloc, am: half.am, pm: half.pm, amOff: off('am'), pmOff: off('pm'), ot };
}
const offFrac = (p, s, idx) => { const i = dayInfo(p, s, idx); return (i.amOff ? 0.5 : 0) + (i.pmOff ? 0.5 : 0); };

/* ---------- Compteurs ---------- */
function counters(p, y) {
  const per = DB.persons[p], ys = String(y), t = todayISO();
  let pris = 0, prevu = 0, extraP = 0, extraV = 0;
  for (const e of DB.entries) {
    if (e.person !== p || e.date.slice(0, 4)

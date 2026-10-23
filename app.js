/* Congés Duo — PWA de suivi des congés pour deux personnes.
   Aucune donnée personnelle dans ce fichier : les données sont stockées sur le téléphone
   (localStorage) et synchronisées dans un repo GitHub privé, configuré dans Réglages. */
'use strict';

const STORE_KEY = 'congesDuo.v1';
const APP_VERSION = '2026-10-23 n°15';
const P = ['a', 'b'];
const DOW = ['di', 'lu', 'ma', 'me', 'je', 've', 'sa'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const TYPES = { conge: 'Congé', extra: 'Travail en plus', otdone: 'Heures sup faites', otrecup: 'Congé sur heures sup', otbal: 'Réserve d\u2019heures notée' };
const TYPE_FORM = { conge: 'Congé (sur le droit annuel)', otrecup: 'Congé sur heures sup (pris sur la réserve)', extra: 'Travail en plus (jour de repos travaillé)', otdone: 'Heures sup faites (en heures)' };
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
const autoStatus = s => (s <= todayISO() ? 'pris' : 'demande');
const STATUS = { demande: 'À valider', prevu: 'Validé', pris: 'Pris' };
const tagHtml = st => st === 'demande'
  ? '<span class="tag prevu" style="color:var(--star);border-color:var(--star)">À valider</span>'
  : `<span class="tag ${st}">${STATUS[st] || st}</span>`;

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
    name, rest: [6, 0], droit, report: {}, contractStart: '', taux: 100,
    bloc: { enabled: bloc, official: 10, periods: {} },
    ot: { enabled: ot, startDate: '', startHours: 0, hoursPerDay: 8.4 },
    sched: {
      enabled: false,
      summer: { wkStart: '08:00', lunchStart: '12:00', lunchEnd: '14:00', wkEnd: '18:30', satStart: '08:00', satEnd: '17:00', satPause: 30 },
      winter: { wkStart: '08:00', lunchStart: '12:00', lunchEnd: '14:00', wkEnd: '18:00', satStart: '09:00', satEnd: '17:00', satPause: 30 },
    },
  };
}
function defaultData() {
  return { version: 1, su: 0, persons: { a: defaultPerson('Personne 1', 20, true, false), b: defaultPerson('Personne 2', 25, false, true) }, entries: [], trips: [], appts: [], subs: {}, push: {}, deleted: {} };
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
  const out = { version: 1, su: +d.su || 0, sup: d.sup && typeof d.sup === 'object' ? d.sup : {}, persons: {}, entries: Array.isArray(d.entries) ? d.entries : [], trips: Array.isArray(d.trips) ? d.trips : [], appts: Array.isArray(d.appts) ? d.appts : [],
    subs: d.subs && typeof d.subs === 'object' ? d.subs : {}, push: d.push && typeof d.push === 'object' ? d.push : {},
    deleted: d.deleted && typeof d.deleted === 'object' && !Array.isArray(d.deleted) ? d.deleted : {} };
  for (const p of P) out.persons[p] = deepMerge(def.persons[p], (d.persons && d.persons[p]) || {});
  for (const p of P) if (!out.sup[p]) out.sup[p] = out.su;
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
// Horodatage des réglages, personne par personne (évite qu'une modification en écrase une autre).
function touch(p) { DB.sup = DB.sup || {}; DB.sup[p] = Date.now(); DB.su = Date.now(); }
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
    if (e.type === 'otdone' || e.type === 'otbal') { ot = true; continue; }
    const k = e.type === 'conge' ? 'conge' : e.type === 'otrecup' ? 'recup' : 'extra';
    for (const h of (e.part === 'full' ? ['am', 'pm'] : [e.part])) half[h] = { k, st: e.status, id: e.id };
  }
  const off = h => ['rest', 'hol', 'bloc', 'conge', 'recup'].includes(half[h].k);
  return { base, bloc, am: half.am, pm: half.pm, amOff: off('am'), pmOff: off('pm'), ot };
}
const offFrac = (p, s, idx) => { const i = dayInfo(p, s, idx); return (i.amOff ? 0.5 : 0) + (i.pmOff ? 0.5 : 0); };

/* ---------- Horaires de travail (été / hiver) ---------- */
function lastSunday(y, m) { const d = new Date(Date.UTC(y, m, 0)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return fmt(d); }
const isSummer = s => { const y = +s.slice(0, 4); return s >= lastSunday(y, 3) && s < lastSunday(y, 10); };
const tmin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const hm = m => { const sg = m < 0 ? '−' : '+'; m = Math.abs(Math.round(m)); return `${sg}${Math.floor(m / 60)} h ${pad(m % 60)}`; };
const SEASON = { summer: 'Horaire d\u2019été', winter: 'Horaire d\u2019hiver' };
function planned(p, s) {
  const w = dow(s); if (w === 0) return null;
  const season = isSummer(s) ? 'summer' : 'winter', c = DB.persons[p].sched[season];
  if (w === 6) return { season, sat: true, start: c.satStart, end: c.satEnd, pause: +c.satPause || 0, min: tmin(c.satEnd) - tmin(c.satStart) - (+c.satPause || 0) };
  return { season, sat: false, start: c.wkStart, l1: c.lunchStart, l2: c.lunchEnd, end: c.wkEnd, min: (tmin(c.lunchStart) - tmin(c.wkStart)) + (tmin(c.wkEnd) - tmin(c.lunchEnd)) };
}
const workedMin = (pl, t) => (pl.sat ? tmin(t.out) - tmin(t.in) - (+t.pause || 0) : (tmin(t.l1) - tmin(t.in)) + (tmin(t.out) - tmin(t.l2)));
const timesText = t => (t.l1 ? `${t.in}–${t.l1} / ${t.l2}–${t.out}` : `${t.in}–${t.out}, pause ${t.pause} min`);
function schedText(p, season) {
  const c = DB.persons[p].sched[season];
  return `semaine ${c.wkStart}–${c.wkEnd} (pause ${c.lunchStart}–${c.lunchEnd}), samedi ${c.satStart}–${c.satEnd} (pause ${c.satPause} min)`;
}
function dstChanges(from) {
  const y = +from.slice(0, 4), list = [];
  for (const yy of [y, y + 1]) list.push({ date: lastSunday(yy, 3), to: 'summer' }, { date: lastSunday(yy, 10), to: 'winter' });
  return list.filter(c => c.date >= addDays(from, -1)).sort((a, b) => a.date.localeCompare(b.date));
}
const dstLabel = c => (c.to === 'winter' ? 'heure d\u2019hiver' : 'heure d\u2019été');
function gcalUrl(c) {
  const details = `Dès le lundi, ${SEASON[c.to].toLowerCase()}. Rappel créé par Congés Duo.`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Changement d\u2019horaire : ' + dstLabel(c))}&dates=${c.date.replace(/-/g, '')}/${addDays(c.date, 1).replace(/-/g, '')}&details=${encodeURIComponent(details)}`;
}

/* ---------- Droit de l'année (prorata du contrat et taux d'activité) ---------- */
function droitInfo(p, y) {
  const per = DB.persons[p], base = +per.droit || 0, taux = (+per.taux || 100) / 100;
  let frac = 1;
  if (per.contractStart) {
    const [sy, sm, sd] = per.contractStart.split('-').map(Number);
    if (y < sy) frac = 0;
    else if (y === sy) { const dim = new Date(Date.UTC(sy, sm, 0)).getUTCDate(); frac = ((12 - sm) + (dim - sd + 1) / dim) / 12; }
  }
  const value = Math.round(base * taux * frac * 100) / 100;
  const parts = [];
  if (frac < 1) parts.push(`${n(Math.round(frac * 12 * 100) / 100)} mois sur 12`);
  if (taux !== 1) parts.push(`${n(taux * 100)} %`);
  return { value, frac, taux, base, text: parts.length ? `${n(base)} j × ${parts.join(' × ')}` : '' };
}

/* ---------- Compteurs ---------- */
function counters(p, y) {
  const per = DB.persons[p], ys = String(y), t = todayISO();
  let pris = 0, prevu = 0, demande = 0, extraP = 0, extraV = 0;
  for (const e of DB.entries) {
    if (e.person !== p || e.date.slice(0, 4) !== ys) continue;
    if (e.type === 'conge') { if (e.status === 'pris') pris += val(e); else { prevu += val(e); if (e.status === 'demande') demande += val(e); } }
    else if (e.type === 'extra') { if (e.status === 'pris') extraP += val(e); else extraV += val(e); }
  }
  const droit = droitInfo(p, +y).value, report = +(per.report[ys] || 0);
  let bloc = null;
  if (per.bloc.enabled) {
    const pr = per.bloc.periods[ys];
    if (pr && pr.start && pr.end && pr.start <= pr.end) {
      let work = 0, used = 0;
      for (let s = pr.start; s <= pr.end; s = addDays(s, 1)) if (baseKind(p, s) === 'work') { work++; if (s <= t) used++; }
      bloc = { start: pr.start, end: pr.end, work, used, official: +per.bloc.official || 0 };
    } else bloc = { missing: true };
  }
  const total = droit + report + extraP;
  return { droit, report, pris, prevu, demande, total, restant: total - pris - prevu, restantPris: total - pris, extraP, extraV, bloc };
}
function otBaseline(p, until) {
  const o = DB.persons[p].ot;
  let b = { date: o.startDate || '0000-00-00', hours: +o.startHours || 0 };
  for (const e of DB.entries) if (e.person === p && e.type === 'otbal' && e.date <= until && e.date >= b.date) b = { date: e.date, hours: +e.hours || 0 };
  return b;
}
function otBalance(p, until, withPrevu) {
  const o = DB.persons[p].ot, base = otBaseline(p, until);
  let h = base.hours;
  const from = base.date;
  for (const e of DB.entries) {
    if (e.person !== p || e.date <= from || e.date > until) continue;
    if (!withPrevu && e.status !== 'pris') continue;
    if (e.type === 'otdone') h += +e.hours || 0;
    else if (e.type === 'otrecup') h -= val(e) * (+o.hoursPerDay || 0);
  }
  return h;
}

/* ---------- Ponts ---------- */
const CLUSTER_TITLES = { 'Vendredi-Saint': 'Pâques', 'Noël': 'Noël et Nouvel An', 'Lundi de Pentecôte': 'Pentecôte', 'Lundi du Jeûne fédéral': 'Jeûne fédéral', 'Fête nationale': '1er Août' };
function clusters(y) {
  const all = [...holidays(y - 1).list, ...holidays(y).list, ...holidays(y + 1).list];
  const cl = [];
  for (const [d, n] of all) {
    const last = cl[cl.length - 1];
    if (last && daysBetween(last.end, d) <= 7) { last.end = d; last.days.push(d); }
    else cl.push({ start: d, end: d, days: [d], title: CLUSTER_TITLES[n] || n });
  }
  return cl.filter(c => c.start.slice(0, 4) === String(y));
}
function bridgeOptions(c, idx) {
  const RANGE = 9, MAXLEN = 16;
  const both = s => offFrac('a', s, idx) === 1 && offFrac('b', s, idx) === 1;
  const res = [];
  for (let s = addDays(c.start, -RANGE); s <= c.start; s = addDays(s, 1)) {
    if (both(addDays(s, -1))) continue;
    for (let e = c.end; e <= addDays(c.end, RANGE); e = addDays(e, 1)) {
      const len = daysBetween(s, e) + 1;
      if (len > MAXLEN) break;
      if (both(addDays(e, 1))) continue;
      const cost = { a: 0, b: 0 }, days = { a: [], b: [] };
      for (let d = s; d <= e; d = addDays(d, 1)) for (const p of P) {
        const f = 1 - offFrac(p, d, idx);
        if (f > 0) { cost[p] += f; days[p].push(d); }
      }
      res.push({ s, e, len, cost, days, total: cost.a + cost.b });
    }
  }
  res.sort((x, z) => x.total - z.total || z.len - x.len);
  const out = []; let best = 0;
  for (const r of res) if (r.len > best && r.total <= 12) { out.push(r); best = r.len; }
  return out.slice(0, 4);
}

/* ---------- Saisies ---------- */
function blockReason(p, s, type, part, exceptId) {
  const per = DB.persons[p];
  if ((type === 'otdone' || type === 'otrecup') && !per.ot.enabled) return 'heures sup non activées';
  const work = isWorkday(p, s);
  if ((type === 'conge' || type === 'otrecup') && !work)
    return blocYearOf(p, s) !== null && baseKind(p, s) === 'work' ? 'bloc de fin d\u2019année' : baseKind(p, s) === 'hol' ? 'jour férié' : 'jour de repos';
  if (type === 'extra' && work) return 'jour de travail normal';
  if (type !== 'otdone' && DB.entries.some(e => e.id !== exceptId && e.person === p && e.date === s && e.type !== 'otdone' &&
    (e.part === 'full' || part === 'full' || e.part === part))) return 'déjà une saisie ce jour';
  return null;
}
function addEntries({ persons, type, part, status, date, end, hours, note }) {
  const created = [], skipped = [];
  const last = end && end > date ? end : date;
  const range = last !== date;
  for (let s = date; s <= last; s = addDays(s, 1)) for (const p of persons) {
    if (range && type === 'otdone' && !isWorkday(p, s)) continue;
    const r = blockReason(p, s, type, type === 'otdone' ? 'full' : part, null);
    if (r) { if (!range || r.startsWith('déjà') || r.startsWith('heures')) skipped.push({ p, s, r }); continue; }
    const e = { id: uid(), person: p, date: s, type, part: type === 'otdone' ? 'full' : part, status: status === 'auto' ? autoStatus(s) : status, u: Date.now() };
    if (type === 'otdone') e.hours = +hours || 0;
    if (note) e.note = note;
    created.push(e);
  }
  DB.entries.push(...created);
  save();
  return { created, skipped };
}

/* ================= Interface ================= */
const S = { view: 'home', year: new Date().getFullYear(), calM: new Date().getMonth() + 1, filter: 'all', open: new Set() };
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = x => String(Math.round(x * 100) / 100).replace('.', ',');
const pc = p => 'p' + p;
const nm = p => esc(DB.persons[p].name);

function toast(msg, actLabel, actFn) {
  const t = $('toast');
  t.innerHTML = esc(msg) + (actLabel ? ` <button type="button" class="toastbtn" data-act="toastAct">${esc(actLabel)}</button>` : '');
  t.classList.toggle('act', !!actLabel); S.toastFn = actFn || null; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.classList.remove('on'); S.toastFn = null; }, actLabel ? 6000 : 3200);
}
// Suppression avec « Annuler » pendant 6 secondes, au lieu d'une confirmation.
function undoable(label, fn) {
  const before = JSON.stringify(DB), prevDel = { ...DB.deleted };
  fn(); save(); render();
  toast(label, 'Annuler', () => {
    const removed = Object.keys(DB.deleted).filter(id => !(id in prevDel)), now = Date.now();
    DB = migrate(JSON.parse(before));
    [DB.entries, DB.trips, DB.appts].forEach(coll => coll.forEach(x => { if (removed.includes(x.id)) x.u = now; }));
    removed.forEach(id => { delete DB.deleted[id]; });
    save(); if ($('dlg').open) $('dlg').close(); render(); toast('Suppression annulée');
  });
}
function row(label, value, cls) { return `<div class="row${cls ? ' ' + cls : ''}"><span>${label}</span><b>${value}</b></div>`; }

function render() {
  $('yearLbl').textContent = S.year;
  const sub = ['ponts', 'list', 'set'].includes(S.view);
  document.querySelectorAll('nav.tabs button[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === (sub ? 'more' : S.view)));
  const v = famOnly() ? ({ home: renderFamHome, cal: renderFamCal, trips: renderFamAgenda }[S.view] || renderFamMore)
    : { home: renderHome, cal: renderCal, ponts: renderPonts, list: renderList, trips: renderAgenda, set: renderSet, more: renderMore }[S.view];
  $('view').innerHTML = (sub && !famOnly() ? '<button type="button" class="back" data-act="tab" data-v="more">‹ Plus</button>' : '') + v();
  setSyncState();
  const sv = $('swver');
  if (sv && typeof caches !== 'undefined') caches.keys().then(k => { sv.textContent = 'cache ' + (k.filter(x => x.startsWith('conges-duo')).join(', ') || 'aucun'); }).catch(() => {});
}

/* ----- Accueil ----- */
function iosHint() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  let off = false; try { off = localStorage.getItem('congesDuo.iosHint') === '1'; } catch (e) { /* ignore */ }
  if (!ios || standalone || off) return '';
  return `<section class="card hint-ios"><b>Installer l’app sur iPhone</b><br>Dans <b>Safari</b>, touchez le bouton Partager (carré avec une flèche vers le haut), puis <b>« Sur l’écran d’accueil »</b> et <b>Ajouter</b>.
    <div class="btns"><button class="btn sm" data-act="hideHint">Compris</button></div></section>`;
}
function dstCard() {
  const t = todayISO(), next = dstChanges(t)[0]; if (!next) return '';
  const d = daysBetween(t, next.date); if (d > 14 || d < -1) return '';
  const ps = P.filter(p => DB.persons[p].sched.enabled);
  const canNotif = typeof Notification !== 'undefined' && Notification.permission === 'default';
  return `<section class="card dst"><b>🕑 Changement d\u2019horaire ${d > 1 ? `dans ${d} jours` : d === 1 ? 'demain' : d === 0 ? 'aujourd\u2019hui' : 'hier'}</b><br>
    Dimanche ${frDate(next.date).slice(3)} : passage à l\u2019${dstLabel(next)}.${ps.map(p => `<br><b>${nm(p)}</b>, dès le lundi : ${schedText(p, next.to)}.`).join('')}
    <div class="btns"><a class="btn sm" href="${gcalUrl(next)}" target="_blank" rel="noopener">Ajouter à Google Agenda</a>
    <button class="btn sm" data-act="dstIcs">Agenda iPhone (.ics)</button>
    ${canNotif ? '<button class="btn sm" data-act="notifOn">Activer les notifications</button>' : ''}</div></section>`;
}
/* ----- Accueil « Aujourd'hui » ----- */
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
function longDate(s) { const d = parse(s); return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; }
const ICON = {
  sun: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18"></path><path d="M4 11a8 8 0 0 1 16 0z"></path></svg>',
  pin: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"></path><circle cx="12" cy="9.5" r="2.5"></circle></svg>',
  clock: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l2.5 2.5M9 2h6"></path></svg>',
  beach: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18"></path><path d="M4 11a8 8 0 0 1 16 0z"></path></svg>',
  plane: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 16l20-8-3-2-6 2-6-4-2 1 4 5-4 2-2-1-1 1z"></path><path d="M3 21h18"></path></svg>',
  bridge: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 16c4-7 14-7 18 0"></path><path d="M3 16h18M7 12v4M12 10v6M17 12v4"></path></svg>',
  list: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"></path></svg>',
  gear: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path></svg>',
  chart: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"></path></svg>',
};
function todayStatus(p, s, idx) {
  const i = dayInfo(p, s, idx), k = i.am.k === i.pm.k ? i.am.k : 'half';
  const label = { rest: 'Repos', hol: 'Férié', bloc: 'Fermeture', conge: 'En congé', recup: 'Récup heures sup', extra: 'Travail en plus', work: 'Au travail', half: 'Demi-journée' }[k] || 'Au travail';
  let sub = '';
  if (k === 'work' || k === 'extra') {
    const pl = DB.persons[p].sched.enabled ? planned(p, s) : null;
    if (pl) sub = `${pl.start} – ${pl.end} · ${pl.season === 'summer' ? 'été' : 'hiver'}`;
  } else if (i.am.st === 'demande') sub = 'à valider';
  if (!sub) { const ti = dayInfo(p, addDays(s, 1), idx); sub = ti.amOff && ti.pmOff ? 'demain : off' : 'demain : au travail'; }
  return { label, sub };
}
function nextTogether(idx) {
  const t = todayISO(); let run = null;
  for (let i = -15; i < 400; i++) {
    const d = addDays(t, i), both = offFrac('a', d, idx) === 1 && offFrac('b', d, idx) === 1;
    if (both) { if (!run) run = { start: d, end: d }; else run.end = d; }
    else if (run) { if (run.end >= t && daysBetween(run.start, run.end) >= 2) break; run = null; }
  }
  if (!run || run.end < t || daysBetween(run.start, run.end) < 2) return null;
  const len = daysBetween(run.start, run.end) + 1;
  const trip = (DB.trips || []).find(x => x.start && x.start <= run.end && (x.end || x.start) >= run.start);
  const ent = DB.entries.find(e => e.note && e.date >= run.start && e.date <= run.end && ['conge', 'otrecup'].includes(e.type));
  const cl = clusters(+run.start.slice(0, 4)).concat(clusters(+run.start.slice(0, 4) - 1)).find(c => c.days.some(d => d >= run.start && d <= run.end));
  return { ...run, len, inDays: daysBetween(t, run.start), label: trip ? trip.title : cl ? cl.title : ent ? ent.note : 'Vacances' };
}
function ringCard(p, y) {
  const c = counters(p, y), C = 276.46, used = c.pris + c.prevu, tot = c.total || 1;
  const frac = Math.min(1, used / tot), over = Math.max(0, -c.restant), ofr = Math.min(1, over / tot);
  const col = p === 'a' ? 'var(--a)' : 'var(--b)';
  return `<button type="button" class="ring ${pc(p)}" data-act="openDet" data-p="${p}">
    <span class="ringwrap"><svg width="104" height="104" viewBox="0 0 104 104" role="img" aria-label="${nm(p)} : ${over ? `${n(over)} jours en trop` : `${n(c.restant)} jours restants sur ${n(c.total)}`}">
      <circle cx="52" cy="52" r="44" fill="none" stroke="var(--track)" stroke-width="10"></circle>
      <circle class="arc" cx="52" cy="52" r="44" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C * frac).toFixed(1)} ${C}" transform="rotate(-90 52 52)"></circle>
      ${over ? `<circle class="arc" cx="52" cy="52" r="44" fill="none" stroke="var(--warn)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C * ofr).toFixed(1)} ${C}" transform="rotate(-90 52 52)"></circle>` : ''}
    </svg><span class="ringval${over ? ' over' : ''}">${over ? '−' + n(over) : n(c.restant)} j</span></span>
    <b>${nm(p)}</b><small>${over ? 'jours en trop en ' + y : `restants sur ${n(c.total)} en ${y}`}</small></button>`;
}
// Chacun ne valide que ses propres demandes (c'est son chef à lui qui décide).
const canValidate = person => !SY.me || person === SY.me;
function pendingGroups() {
  const g = {};
  DB.entries.filter(e => e.status === 'demande' && ['conge', 'otrecup', 'extra'].includes(e.type)).sort((a, b) => a.date.localeCompare(b.date)).forEach(e => {
    const k = e.person + '|' + (e.note || e.id);
    if (!g[k]) g[k] = { id: e.id, person: e.person, label: e.note || TYPES[e.type], start: e.date, end: e.date, days: 0 };
    g[k].end = e.date; g[k].days += val(e);
  });
  return Object.values(g).sort((a, b) => a.start.localeCompare(b.start));
}
function renderHome() {
  if (S.invite && !isStandalone()) return inviteGuide();
  const t = todayISO(), idx = buildIdx(), order = SY.me === 'b' ? ['b', 'a'] : ['a', 'b'], me = SY.me || 'a';
  let h = (S.invite ? '' : iosHint());
  h += `<header class="hello"><span class="muted">${longDate(t)}</span><h2>Bonjour ${nm(me)}</h2></header>`;
  h += `<div class="today">${order.map(p => { const st = todayStatus(p, t, idx); return `<div class="tcard ${pc(p)}"><span class="tname"><span class="dot"></span>${p === SY.me ? 'Toi' : nm(p)}</span><b>${st.label}</b><small>${esc(st.sub)}</small></div>`; }).join('')}</div>`;
  h += homeSetup() + (famOn() ? famRequests() : '') + dstCard();
  const nt = nextTogether(idx);
  if (nt) {
    const bars = Array.from({ length: Math.min(nt.len, 14) }, (_, i) => `<span class="${i % 2 ? 'pb' : 'pa'}"></span>`).join('');
    h += `<section class="hero"><span class="herot">${ICON.sun} ${nt.inDays > 0 ? 'Prochaines vacances ensemble' : 'Vacances ensemble en ce moment'}</span>
      ${nt.inDays > 0 ? `<div class="herobig"><b>${nt.inDays}</b><span>jour${nt.inDays > 1 ? 's' : ''}</span></div>` : `<div class="herobig"><b>${daysBetween(t, nt.end) + 1}</b><span>jour(s) restant(s)</span></div>`}
      <span class="herosub">${esc(nt.label)} · du ${short(nt.start).slice(3)} au ${short(nt.end).slice(3)} · ${nt.len} jours à deux</span>
      <div class="herobars" aria-hidden="true">${bars}</div></section>`;
  }
  h += `<div class="rings">${order.map(p => ringCard(p, S.year)).join('')}</div>`;
  const pend = pendingGroups();
  if (pend.length) {
    h += `<section class="card pend"><div class="pendh"><h2>${pend.length} demande${pend.length > 1 ? 's' : ''} à valider</h2><button type="button" class="linkbtn" data-act="tab" data-v="list">Tout voir</button></div>
      ${pend.slice(0, 4).map(g => `<div class="pendrow ${pc(g.person)}"><span class="dot"></span><div class="grow"><b>${esc(g.label)}</b><small>${nm(g.person)} · ${short(g.start).slice(3)}${g.end !== g.start ? ' → ' + short(g.end).slice(3) : ''} · ${n(g.days)} j</small></div>
        ${canValidate(g.person) ? `<button type="button" class="vbtn" data-act="validate" data-id="${g.id}">Valider</button>` : '<span class="waitlbl">en attente</span>'}</div>`).join('')}</section>`;
  }
  const na = (DB.appts || []).filter(a => a.date && a.date >= t).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))[0];
  if (na) h += `<button type="button" class="card nextappt" data-act="editAppt" data-id="${na.id}"><span class="napi">${ICON.pin}</span><span class="grow"><small>Prochain rendez-vous</small><b>${esc(na.title)} · ${short(na.date)}${na.time ? ' à ' + na.time : ''}</b><small>${esc(na.place || '')}${na.place ? ' · ' : ''}${na.who === 'both' || !na.who ? 'vous deux' : nm(na.who)}</small></span></button>`;
  h += order.map(p => sect('det-' + p, `<span class="dot"></span><span class="grow">Détails ${nm(p)} ${S.year}</span>`, personCard(p, S.year), pc(p))).join('');
  return h + '<p class="muted center">Fériés vaudois calculés automatiquement.</p>';
}
function renderMore() {
  const me = SY.me || 'a';
  const item = (act, v, icon, title, sub) => `<button type="button" class="moreitem" data-act="${act}" ${v}><span class="moreic">${icon}</span><span class="grow"><b>${title}</b><small>${sub}</small></span><span aria-hidden="true">›</span></button>`;
  return `<h2 class="pagetitle">Plus</h2><div class="morelist">
    ${item('tab', 'data-v="ponts"', ICON.bridge, 'Ponts', 'Les jours à poser pour être off ensemble')}
    ${item('tab', 'data-v="list"', ICON.list, 'Saisies et demandes', 'Tout ce qui est noté, à valider ou pris')}
    ${DB.persons[me].ot.enabled ? item('recap', `data-p="${me}"`, ICON.chart, 'Récap des heures sup', 'Mois par mois, avec export')  : ''}
    ${item('tab', 'data-v="set"', ICON.gear, 'Réglages', 'Contrat, horaires, notifications, sauvegarde')}
  </div>`;
}

function personCard(p, y) {
  const per = DB.persons[p], c = counters(p, y), tot = c.total;
  const over = Math.max(0, -c.restant), overPris = Math.max(0, -c.restantPris);
  const wP = tot > 0 ? Math.min(100, c.pris / tot * 100) : 0;
  const wV = tot > 0 ? Math.min(100 - wP, c.prevu / tot * 100) : 0;
  let kpi;
  if (!over) {
    kpi = `<span class="big">${n(c.restant)}</span><span class="kl">jours restants en ${y}<br><small>${n(tot)} au total, ${n(c.pris)} pris, ${n(c.prevu)} prévus</small></span>`;
  } else {
    const detail = !overPris ? `${n(over)} j prévus en trop : à retirer ou à prendre sans solde`
      : over > overPris ? `${n(overPris)} j déjà pris en trop (sans solde) et ${n(over - overPris)} j prévus en trop (à retirer ou sans solde)`
      : `${n(overPris)} j déjà pris en trop : à prendre sans solde`;
    kpi = `<span class="big neg">${n(over)}</span><span class="kl">jours manquants en ${y}<br><small>${detail}</small></span>`;
  }
  let h = `<section class="card person ${pc(p)}">
    <div class="phead"><span class="dot"></span><h2>${nm(p)}</h2></div>
    <div class="kpi">${kpi}</div>
    <div class="bar"><i class="p" style="width:${wP}%"></i><i class="v" style="width:${wV}%"></i></div>
    ${row(`Droit ${y}`, n(c.droit) + ' j' + (droitInfo(p, +y).text ? `<br><small class="muted">${droitInfo(p, +y).text}</small>` : ''))}${row('Report / ajustement', n(c.report) + ' j')}
    ${row('Jours travaillés en plus', '+ ' + n(c.extraP) + ' j' + (c.extraV ? `<br><small class="muted">+ ${n(c.extraV)} prévus, comptés une fois faits</small>` : ''))}
    ${row('Pris', n(c.pris) + ' j')}${row('Prévu', n(c.prevu) + ' j' + (c.demande ? `<br><small style="color:var(--star)">dont ${n(c.demande)} j à valider</small>` : ''))}`;
  if (over) h += row('Sans solde', `<span style="color:var(--hol)">${n(over)} j</span>` + (overPris && over > overPris ? `<br><small class="muted">dont ${n(overPris)} déjà pris</small>` : ''));
  if (c.bloc) {
    h += c.bloc.missing
      ? row('Bloc fin d\u2019année', `<span class="muted">dates ${y} à saisir dans Réglages</span>`)
      : row(`Bloc fin d\u2019année<br><small class="muted">${short(c.bloc.start)} au ${short(c.bloc.end)}</small>`,
        `${c.bloc.official} j officiels<br><small class="muted">${c.bloc.work} jours de travail couverts, ${c.bloc.used} écoulés</small>`, 'tall');
  }
  if (per.ot.enabled) {
    const t = todayISO(), hpd = +per.ot.hoursPerDay || 1;
    const bal = otBalance(p, t, false), proj = otBalance(p, '9999-12-31', true);
    const base = otBaseline(p, t);
    h += row(`Réserve d\u2019heures sup au ${short(t)}`, `${n(bal)} h <small class="muted">= ${n(bal / hpd)} j</small>` +
      (base.date > '0000-00-00' ? `<br><small class="muted">dernier relevé : ${n(base.hours)} h le ${short(base.date)}</small>` : '<br><small class="muted">aucun relevé noté</small>'));
    if (Math.abs(proj - bal) > 1e-9) h += row('Après les congés prévus', `${n(proj)} h <small class="muted">= ${n(proj / hpd)} j</small>`);
  }
  const td = todayISO(), bt = [];
  if (per.sched.enabled && isWorkday(p, td) && y === +td.slice(0, 4)) bt.push(`<button class="btn sm" data-act="hours" data-p="${p}" data-d="${td}">⏱ Mes horaires d’aujourd’hui</button>`);
  if (per.ot.enabled) bt.push(`<button class="btn sm" data-act="reserve" data-p="${p}">✎ Noter ma réserve</button>`, `<button class="btn sm" data-act="recap" data-p="${p}">📊 Récap ${y}</button>`);
  if (bt.length) h += `<div class="btns">${bt.join('')}</div>`;
  return h + '</section>';
}

/* ----- Calendrier ----- */
function half(x) {
  const st = x.st === 'demande' ? 'prevu' : (x.st || 'x');
  return `<i class="h k-${x.k} s-${st}"${x.st === 'demande' ? ' style="opacity:.45"' : ''}></i>`;
}
function lane(p, i) { return `<span class="lane ${pc(p)}">${half(i.am)}${half(i.pm)}</span>`; }
function renderCal() {
  const y = S.year, m = S.calM, idx = buildIdx(), t = todayISO();
  const first = iso(y, m, 1), offset = (dow(first) + 6) % 7, dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let g = `<div class="monthbar"><button class="iconbtn" data-act="month" data-d="-1" aria-label="Mois précédent">‹</button>
    <strong>${MONTHS[m - 1]} ${y}</strong><button class="iconbtn" data-act="month" data-d="1" aria-label="Mois suivant">›</button></div>
    <div class="who"><span class="pa"><span class="dot"></span>${nm('a')} : ligne du haut</span><span class="pb"><span class="dot"></span>${nm('b')} : ligne du bas</span></div>
    <div class="grid">${['lu', 'ma', 'me', 'je', 've', 'sa', 'di'].map(d => `<div class="dow">${d}</div>`).join('')}`;
  for (let i = 0; i < offset; i++) g += '<div class="day empty"></div>';
  const hols = [], trips = (DB.trips || []).filter(x => x.start);
  for (let d = 1; d <= dim; d++) {
    const s = iso(y, m, d), hol = holidayName(s), ia = dayInfo('a', s, idx), ib = dayInfo('b', s, idx);
    const trip = trips.some(x => s >= x.start && s <= (x.end || x.start)), appt = (DB.appts || []).some(x => x.date === s) || (famOn() && famApptsOn(s).length > 0);
    const kid = famOn() && (gardeAt(s) || {}).with === 'p1';
    if (hol) hols.push(`${short(s)} : ${hol}`);
    const both = ia.amOff && ia.pmOff && ib.amOff && ib.pmOff;
    g += `<button class="day${hol ? ' hol' : ''}${s === t ? ' today' : ''}${both ? ' both' : ''}${kid ? ' kid' : ''}" data-act="day" data-d="${s}">
      <span class="num">${d}${trip || appt ? `<small class="mk">${trip ? '✈' : ''}${appt ? '📌' : ''}</small>` : ''}</span>${both ? '<span class="star" title="Off tous les deux">★</span>' : ''}${ia.ot || ib.ot ? '<span class="otm">h</span>' : ''}
      ${lane('a', ia)}${lane('b', ib)}</button>`;
  }
  g += '</div>';
  if (hols.length) g += `<p class="hols">${hols.map(esc).join('<br>')}</p>`;
  const sw = (k, st, p = 'a') => `<span class="lane ${pc(p)} sw"><i class="h k-${k} s-${st}"></i></span>`;
  g += `<div class="legend">
    <span>${sw('conge', 'pris')}${sw('conge', 'pris', 'b')} Congé pris</span>
    <span>${sw('conge', 'prevu')}${sw('conge', 'prevu', 'b')} Congé validé</span>
    <span><span class="lane pa sw" style="opacity:.45"><i class="h k-conge s-prevu"></i></span><span class="lane pb sw" style="opacity:.45"><i class="h k-conge s-prevu"></i></span> À valider</span>
    <span><span class="lane pa sw"><i class="h k-conge s-pris"></i><i class="h k-work s-x"></i></span> Demi-journée</span>
    <span>${sw('recup', 'pris', 'b')} Récup heures sup</span>
    <span>${sw('bloc', 'pris')} Bloc fin d\u2019année</span>
    <span>${sw('extra', 'pris')} Travail en plus</span>
    <span>${sw('rest', 'x')} Repos</span>
    <span>${sw('hol', 'x')} Férié</span>
    <span><b class="starl">★</b> Off tous les deux</span>
    <span><b class="otl">h</b> Heures sup</span>
    <span><b>✈</b> Voyage</span>
    <span><b>📌</b> Rendez-vous</span>
    ${famOn() ? `<span><span class="kidsw"></span> Garde chez ${parentName('p1')}</span>` : ''}</div>`;
  return g;
}

/* ----- Ponts ----- */
function renderPonts() {
  const idx = buildIdx();
  let h = `<p class="muted">Pour chaque férié de ${S.year} : les jours que chacun doit poser pour être off ensemble. Les congés déjà saisis et le bloc de fin d\u2019année comptent comme déjà posés.</p>`;
  for (const c of clusters(S.year)) {
    const opts = bridgeOptions(c, idx);
    h += `<section class="card"><h2>${esc(c.title)}</h2><p class="muted">${c.days.map(d => `${short(d)} ${esc(holidayName(d))}`).join(', ')}</p>`;
    opts.forEach((o, i) => {
      h += `<div class="opt"><div class="opt-h"><b>${o.len} jours ensemble</b><span class="muted">du ${short(o.s)} au ${short(o.e)}</span></div>` +
        P.map(p => `<div class="opt-p ${pc(p)}"><span class="dot"></span><span><b>${nm(p)}</b> : ${o.cost[p] ? `${n(o.cost[p])} j à poser (${o.days[p].map(short).join(', ')})` : 'rien à poser'}</span></div>`).join('') +
        (o.total > 0 ? `<button class="btn sm" data-act="plan" data-c="${c.start}" data-i="${i}">Ajouter ces jours (à valider)</button>` : '<span class="tag ok">Déjà en place</span>') + '</div>';
    });
    h += '</section>';
  }
  return h;
}
function planOption(cStart, i) {
  const idx = buildIdx();
  const c = clusters(S.year).find(x => x.start === cStart); if (!c) return;
  const o = bridgeOptions(c, idx)[i]; if (!o) return;
  let k = 0;
  for (const p of P) for (const d of o.days[p]) {
    const inf = dayInfo(p, d, idx);
    const parts = !inf.amOff && !inf.pmOff ? ['full'] : [!inf.amOff ? 'am' : 'pm'];
    for (const part of parts) {
      if (blockReason(p, d, 'conge', part, null)) continue;
      DB.entries.push({ id: uid(), person: p, date: d, type: 'conge', part, status: autoStatus(d), u: Date.now() });
      k += part === 'full' ? 1 : 0.5;
    }
  }
  save(); render(); toast(`${n(k)} jour(s) de congé ajoutés`);
}

/* ----- Liste ----- */
function renderList() {
  const ys = String(S.year), t = todayISO(), f = S.filter;
  const es = DB.entries.filter(e => e.date.slice(0, 4) === ys && (f === 'all' || e.person === f))
    .sort((a, b) => b.date.localeCompare(a.date) || a.person.localeCompare(b.person));
  const stale = DB.entries.filter(e => e.status === 'prevu' && e.date <= t).length;
  const pending = DB.entries.filter(e => e.status === 'demande' && e.date.slice(0, 4) === ys && (f === 'all' || e.person === f)).length;
  let h = `<div class="chips">${[['all', 'Tous'], ['a', nm('a')], ['b', nm('b')]].map(([k, l]) =>
    `<button class="chip${f === k ? ' on' : ''}" data-act="filter" data-v="${k}">${l}</button>`).join('')}</div>`;
  if (stale) h += `<button class="btn wide" data-act="stale">Passer en « pris » les ${stale} saisie(s) validée(s) déjà passée(s)</button>`;
  if (pending) h += `<p class="muted">${pending} jour(s) en attente de validation. « Valider » ou « Refuser » s\u2019applique à toute la demande (même personne, même nom).</p>`;
  if (!es.length) return h + `<p class="muted center">Aucune saisie en ${ys}. Touchez + pour en ajouter.</p>`;
  h += '<section class="card list">';
  const shown = new Set();
  for (const e of es) {
    const gk = e.person + '|' + (e.note || e.id);
    const btns = e.status === 'demande' && !shown.has(gk) && canValidate(e.person);
    if (btns) shown.add(gk);
    const detail = e.type === 'otbal' ? `${n(e.hours || 0)} h en réserve` : e.type === 'otdone' ? `${n(e.hours || 0)} h${e.times ? ` (${timesText(e.times)})` : ''}` : PARTS[e.part];
    h += `<div class="entry ${pc(e.person)}"><span class="dot"></span><div class="grow"><b>${frDate(e.date)}</b> <span class="muted">${nm(e.person)}</span><br>
      ${TYPES[e.type]}, ${detail} ${tagHtml(e.status)}${e.note ? `<br><small class="muted">${esc(e.note)}</small>` : ''}
      ${btns ? `<div class="btns" style="margin:6px 0 0"><button class="btn sm" data-act="validate" data-id="${e.id}">Valider la demande</button><button class="btn sm danger" data-act="refuse" data-id="${e.id}">Refuser</button></div>` : ''}</div>
      <button class="iconbtn" data-act="edit" data-id="${e.id}" aria-label="Modifier">✎</button>
      <button class="iconbtn" data-act="del" data-id="${e.id}" aria-label="Supprimer">✕</button></div>`;
  }
  return h + '</section>';
}

/* ----- Réglages ----- */
const field = (label, input, cls = '') => `<label class="field ${cls}"><span class="lbl">${label}</span>${input}</label>`;
const sect = (k, title, body, cls = '') => `<details class="sect ${cls}" data-k="${k}"${S.open.has(k) ? ' open' : ''}>
  <summary>${title}<span class="plus" aria-hidden="true"></span></summary><div class="sect-b">${body}</div></details>`;
function schedFields(p, season) {
  const c = DB.persons[p].sched[season];
  const f = (k, l, type = 'time') => field(l, `<input type="${type}"${type === 'number' ? ' inputmode="numeric"' : ''} data-set="${p}.sched.${season}.${k}" value="${c[k]}">`);
  return `<h4>${SEASON[season]} ${season === 'summer' ? '(fin mars → fin octobre)' : '(fin octobre → fin mars)'}</h4>
    <div class="two">${f('wkStart', 'Semaine : début')}${f('wkEnd', 'Semaine : fin')}</div>
    <div class="two">${f('lunchStart', 'Pause de midi : de')}${f('lunchEnd', 'Pause de midi : à')}</div>
    <div class="two">${f('satStart', 'Samedi : début')}${f('satEnd', 'Samedi : fin')}</div>
    ${f('satPause', 'Samedi : pause (minutes)', 'number')}`;
}
function dstSettings() {
  const ch = dstChanges(todayISO()).slice(0, 2);
  return sect('dst', '<span class="grow">Changements d’horaire</span>', `
    <p class="muted">Calculés automatiquement chaque année (dernier dimanche de mars et d’octobre). Un rappel s’affiche sur l’accueil 14 jours avant.</p>
    ${ch.map(c => `<div class="row"><span>${frDate(c.date)}</span><b>${dstLabel(c)}</b></div>
      <div class="btns" style="margin:4px 0 8px"><a class="btn sm" href="${gcalUrl(c)}" target="_blank" rel="noopener">Ajouter à Google Agenda</a></div>`).join('')}
    <div class="btns"><button class="btn sm" data-act="dstIcs">Les deux dans l’agenda iPhone (.ics)</button>
    ${typeof Notification !== 'undefined' && Notification.permission === 'default' ? '<button class="btn sm" data-act="notifOn">Activer les notifications</button>' : ''}</div>
    <p class="muted">Les notifications de l’app s’affichent quand vous l’ouvrez dans les 3 jours avant le changement. Pour une alarme garantie, ajoutez le rappel à l’agenda.</p>`);
}
function droitCalcText(p) {
  const y = S.year, d = droitInfo(p, y);
  return `Droit ${y} calculé : <b>${n(d.value)} j</b>${d.text ? ` (${d.text})` : ''}`;
}
const isAdmin = () => SY.me !== 'b';
function renderSet() {
  const y = S.year, admin = isAdmin();
  let h = `<p class="muted">Réglages de l\u2019année <b>${y}</b> : change l\u2019année en haut pour régler une autre année.</p>`;
  for (const p of (admin ? P : [SY.me])) {
    const per = DB.persons[p], pr = per.bloc.periods[y] || {};
    const body = `
      ${field('Nom affiché', `<input data-set="${p}.name" value="${esc(per.name)}">`)}
      <div class="field"><span class="lbl">Jours de repos de base</span><div class="days7">${[1, 2, 3, 4, 5, 6, 0].map(d =>
        `<label><input type="checkbox" data-rest="${p}" value="${d}"${per.rest.includes(d) ? ' checked' : ''}>${DOW[d]}</label>`).join('')}</div></div>
      <h4>Contrat</h4>
      <div class="two">${field('Début du contrat', `<input type="date" data-set="${p}.contractStart" value="${per.contractStart || ''}">`)}
      ${field('Taux d\u2019activité (%)', `<input type="number" inputmode="decimal" step="5" min="0" max="100" data-set="${p}.taux" value="${per.taux}">`)}</div>
      ${field('Droit annuel à plein temps (jours)', `<input type="number" inputmode="decimal" step="0.5" data-set="${p}.droit" value="${per.droit}">`)}
      <p class="muted">Laissez le début du contrat vide s\u2019il est antérieur. L\u2019année du début, le droit est calculé au prorata des mois travaillés.</p>
      <h4>Année ${y}</h4>
      <p class="calc" id="calc-${p}">${droitCalcText(p)}</p>
      ${field(`Report ou ajustement ${y} (jours, + ou −)`, `<input type="number" inputmode="decimal" step="any" data-set="${p}.report.${y}" value="${per.report[y] || 0}">`)}
      <p class="muted">Positif : jours reportés de l\u2019année précédente. Négatif : correction demandée par l\u2019employeur.</p>
      <label class="check"><input type="checkbox" data-set="${p}.bloc.enabled"${per.bloc.enabled ? ' checked' : ''}> Bloc de fin d\u2019année (compteur séparé)</label>
      ${per.bloc.enabled ? `<div class="sub">${field('Jours officiels du bloc', `<input type="number" step="0.5" data-set="${p}.bloc.official" value="${per.bloc.official}">`)}
        <div class="two">${field(`Début du bloc ${y}`, `<input type="date" data-set="${p}.bloc.periods.${y}.start" value="${pr.start || ''}">`)}
        ${field('Fin du bloc', `<input type="date" data-set="${p}.bloc.periods.${y}.end" value="${pr.end || ''}">`)}</div></div>` : ''}
      <label class="check"><input type="checkbox" data-set="${p}.ot.enabled"${per.ot.enabled ? ' checked' : ''}> Heures supplémentaires</label>
      ${per.ot.enabled ? `<div class="sub"><div class="two">${field('Solde de départ (heures)', `<input type="number" inputmode="decimal" step="0.25" data-set="${p}.ot.startHours" value="${per.ot.startHours}">`)}
        ${field('Solde arrêté au soir du', `<input type="date" data-set="${p}.ot.startDate" value="${per.ot.startDate}">`)}</div>
        ${field('Heures par jour (conversion)', `<input type="number" inputmode="decimal" step="0.1" data-set="${p}.ot.hoursPerDay" value="${per.ot.hoursPerDay}">`)}</div>` : ''}
      <label class="check"><input type="checkbox" data-set="${p}.sched.enabled"${per.sched.enabled ? ' checked' : ''}> Suivi des horaires (calcule les heures sup)</label>
      ${per.sched.enabled ? `<div class="sub"><p class="muted">En ce moment : <b>${SEASON[isSummer(todayISO()) ? 'summer' : 'winter']}</b>. Le changement se fait automatiquement au passage à l’heure d’été et d’hiver.</p>
        ${schedFields(p, 'summer')}${schedFields(p, 'winter')}</div>` : ''}`;
    h += sect('p-' + p, `<span class="dot"></span><span class="grow">${nm(p)}</span>`, body, pc(p));
  }
  h += sect('device', '<span class="grow">Cet appareil</span>', `
    ${admin ? `<div class="field"><span class="lbl">Ce téléphone est celui de</span>${radios('me', [['a', nm('a')], ['b', nm('b')]], SY.me)}</div>` : `<p>Ce téléphone est celui de <b>${nm(SY.me)}</b>.</p>`}
    <p class="muted">Sa carte s\u2019affiche en premier et les rappels qui le concernent arrivent ici. Ce réglage reste sur ce téléphone.</p>
    <p class="muted">Version de l\u2019app : ${APP_VERSION}, <span id="swver">…</span></p>
    ${admin ? `<div class="btns"><button class="btn sm" data-act="invite">Inviter ${SY.me ? nm(SY.me === 'a' ? 'b' : 'a') : 'l\u2019autre personne'} sur son téléphone</button></div>` : ''}`);
  const subs = Object.entries(DB.subs || {}).filter(([, v]) => v && v.sub);
  h += sect('notif', '<span class="grow">Notifications</span>', `
    <p class="muted">Les rappels de rendez-vous et de changement d\u2019horaire sont envoyés par une tâche automatique de votre repo privé, toutes les 30 minutes.</p>
    <div class="row"><span>Clés de notification</span><b>${DB.push && DB.push.publicKey ? 'créées' : 'à créer'}</b></div>
    <div class="row"><span>Ce téléphone</span><b>${pushOk() ? 'activé' : 'non activé'}</b></div>
    ${admin ? subs.map(([k, v]) => `<div class="row"><span>${esc(v.name || '')} (${esc((DB.persons[v.person] || {}).name || '')})</span><b><button class="btn sm danger" data-act="delSub" data-id="${k}">Retirer</button></b></div>`).join('') : ''}
    <div class="btns"><button class="btn sm pri" data-act="pushOn">Activer sur ce téléphone</button>
    ${admin ? `<button class="btn sm" data-act="genKeys">${DB.push && DB.push.publicKey ? 'Recréer les clés' : 'Créer les clés'}</button>` : ''}</div>`);
  h += famSettings();
  h += dstSettings();
  const hist = SY.owner && SY.repo ? `https://github.com/${encodeURIComponent(SY.owner)}/${encodeURIComponent(SY.repo)}/commits/main/${SY.path.split('/').map(encodeURIComponent).join('/')}` : '';
  if (!admin) h += sect('sync', '<span class="grow">Sauvegarde</span>', `<p class="syncline" id="syncStatus">${syncText()}</p>
    <div class="btns"><button class="btn pri" data-act="sync">Synchroniser maintenant</button></div>`);
  else h += sect('sync', '<span class="grow">Sauvegarde privée sur GitHub</span>', `
    <p class="muted">Après chaque modification, les données sont envoyées dans votre repo privé. Chaque envoi devient une version dans l\u2019historique du repo. La clé reste sur ce téléphone et n\u2019est jamais exportée.</p>
    <div class="two">${field('Compte GitHub', `<input data-sync="owner" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="nom du compte" value="${esc(SY.owner)}">`)}
    ${field('Repo privé', `<input data-sync="repo" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(SY.repo)}">`)}</div>
    <div class="two">${field('Fichier', `<input data-sync="path" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(SY.path)}">`)}
    ${field('Nom de cet appareil', `<input data-sync="device" placeholder="ex. mon téléphone" value="${esc(SY.device)}">`)}</div>
    ${field('Clé d\u2019accès (fine-grained token)', `<input type="password" data-sync="token" autocomplete="off" placeholder="github_pat_…" value="${esc(SY.token)}">`)}
    <p class="syncline" id="syncStatus">${syncText()}</p>
    <div class="btns"><button class="btn pri" data-act="sync">Synchroniser maintenant</button>
    ${hist ? `<a class="btn" href="${hist}" target="_blank" rel="noopener">Voir l\u2019historique</a>` : ''}
    ${SY.token ? '<button class="btn danger" data-act="forget">Retirer la clé de ce téléphone</button>' : ''}</div>`);
  h += sect('file', '<span class="grow">Fichier de sauvegarde</span>', `
    <p class="muted">Copie manuelle, en plus de GitHub : pour archiver un état précis ou repartir d\u2019un fichier. L\u2019import remplace tout, ici et sur GitHub.</p>
    <div class="btns"><button class="btn pri" data-act="export">Exporter la sauvegarde (JSON)</button>
    ${admin ? '<button class="btn" data-act="import">Importer une sauvegarde</button>' : ''}
    <button class="btn" data-act="csv">Exporter en CSV</button></div>
    <p class="muted">Effacer ne touche qu\u2019à ce téléphone : la sauvegarde GitHub reste intacte, et remettre la clé récupère tout.</p>
    <div class="btns"><button class="btn danger" data-act="reset">Effacer les données de ce téléphone</button></div>`);
  return h;
}
function setPath(path, value) {
  const keys = path.split('.'); let o = DB.persons;
  for (let i = 0; i < keys.length - 1; i++) { if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = value;
}

/* ----- Voyages ----- */
const ITEM_TYPES = { vol: ['✈️', 'Vol'], train: ['🚆', 'Train'], hotel: ['🏨', 'Hébergement'], voiture: ['🚗', 'Voiture'], activite: ['🎟️', 'Activité'], autre: ['📎', 'Autre'] };
const whoList = w => (w === 'both' ? P.slice() : [w]);
const whoDots = w => whoList(w).map(p => `<span class="${pc(p)}" style="display:inline-flex;align-items:center;gap:4px"><span class="dot"></span>${nm(p)}</span>`).join(' ');
function tripCard(t) {
  const items = (t.items || []).slice().sort((a, b) => (a.date || '9').localeCompare(b.date || '9') || (a.time || '').localeCompare(b.time || ''));
  const nd = t.start && t.end ? daysBetween(t.start, t.end) + 1 : 0;
  let h = `<section class="card trip"><div class="trip-h"><div class="grow"><h2>${esc(t.title)}</h2>
    <div class="muted">${t.place ? '📍 ' + esc(t.place) + '<br>' : ''}${t.start ? `du ${frDate(t.start)} au ${frDate(t.end || t.start)}${nd ? ` (${nd} jours)` : ''}` : 'dates à définir'}</div>
    <div class="who-l">${whoDots(t.who || 'both')}</div></div>
    <button class="iconbtn" data-act="editTrip" data-id="${t.id}" aria-label="Modifier le voyage">✎</button></div>
    ${t.notes ? `<p class="tnotes">${esc(t.notes)}</p>` : ''}`;
  for (const it of items) {
    const [ico, lab] = ITEM_TYPES[it.kind] || ITEM_TYPES.autre;
    const when = [it.date ? frDate(it.date) : '', it.time || '', it.end && it.end !== it.date ? `→ ${frDate(it.end)}` : ''].filter(Boolean).join(' ');
    h += `<div class="item"><span class="ico">${ico}</span><div class="grow"><b>${esc(it.title || lab)}</b>
      ${when ? `<br><small>${when}</small>` : ''}${it.ref ? `<br><small>Réf. <b>${esc(it.ref)}</b></small>` : ''}${it.price ? ` <small class="muted">· ${esc(it.price)}</small>` : ''}
      ${it.notes ? `<br><small class="muted">${esc(it.notes)}</small>` : ''}
      <div class="btns" style="margin:6px 0 0">${safeUrl(it.link) ? `<a class="btn sm" href="${esc(safeUrl(it.link))}" target="_blank" rel="noopener noreferrer">Ouvrir le lien</a>` : ''}
      ${it.file ? `<button class="btn sm" data-act="getFile" data-t="${t.id}" data-id="${it.id}">📄 ${esc(it.file.name)}</button>` : ''}</div>
      <div id="dl-${it.id}"></div></div>
      <button class="iconbtn" data-act="editItem" data-t="${t.id}" data-id="${it.id}" aria-label="Modifier">✎</button></div>`;
  }
  h += `<div class="btns"><button class="btn sm pri" data-act="addItem" data-t="${t.id}">+ Réservation, billet…</button>
    ${t.start ? `<button class="btn sm" data-act="tripLeave" data-id="${t.id}">Poser les congés de ce voyage</button>` : ''}</div></section>`;
  return h;
}
function renderTrips() {
  const t = todayISO(), all = DB.trips || [];
  const up = all.filter(x => !x.end || x.end >= t).sort((a, b) => (a.start || '9').localeCompare(b.start || '9'));
  const past = all.filter(x => x.end && x.end < t).sort((a, b) => b.start.localeCompare(a.start));
  let h = `<p class="muted">Destination, programme, billets, réservations d\u2019hôtel. Les fichiers joints sont rangés dans votre repo privé.</p>`;
  if (!all.length) return h + '<p class="muted">Aucun voyage pour l\u2019instant.</p>';
  h += up.map(tripCard).join('');
  if (past.length) h += sect('past', `<span class="grow">Voyages passés (${past.length})</span>`, past.map(tripCard).join(''));
  return h;
}
function openTrip(id) {
  const t = (DB.trips || []).find(x => x.id === id) || { who: 'both' };
  showDialog(`<h2>${id ? 'Modifier le voyage' : 'Nouveau voyage'}</h2>
    ${field('Nom du voyage', `<input name="t_title" value="${esc(t.title || '')}" placeholder="ex. Crète">`)}
    ${field('Destination', `<input name="t_place" value="${esc(t.place || '')}" placeholder="ex. Héraklion, Grèce">`)}
    <div class="two">${field('Du', `<input type="date" name="t_start" value="${t.start || ''}">`)}${field('Au', `<input type="date" name="t_end" value="${t.end || ''}">`)}</div>
    <div class="field"><span class="lbl">Qui part</span>${radios('t_who', [['a', nm('a')], ['b', nm('b')], ['both', 'Les deux']], t.who || 'both')}</div>
    ${field('Programme, idées, notes', `<textarea name="t_notes" rows="4">${esc(t.notes || '')}</textarea>`)}
    <div class="btns end">${id ? `<button class="btn danger" data-act="delTrip" data-id="${id}">Supprimer</button>` : ''}
    <button class="btn" data-act="close">Annuler</button><button class="btn pri" data-act="saveTrip" data-id="${id || ''}">Enregistrer</button></div>`);
}
function saveTrip(id) {
  const q = k => document.querySelector(`[name=${k}]`);
  const title = q('t_title').value.trim(); if (!title) return toast('Donnez un nom au voyage.');
  const start = q('t_start').value, end = q('t_end').value || start;
  if (start && end < start) return toast('La date de fin est avant le début.');
  DB.trips = DB.trips || [];
  let t = DB.trips.find(x => x.id === id);
  if (!t) { t = { id: uid(), items: [] }; DB.trips.push(t); }
  Object.assign(t, { title, place: q('t_place').value.trim(), start, end, who: (document.querySelector('[name=t_who]:checked') || {}).value || 'both', notes: q('t_notes').value.trim(), u: Date.now() });
  save(); $('dlg').close(); render(); toast('Voyage enregistré');
}
function openItem(tid, id) {
  const t = DB.trips.find(x => x.id === tid); if (!t) return;
  const it = (t.items || []).find(x => x.id === id) || { kind: 'vol', date: t.start || '' };
  showDialog(`<h2>${id ? 'Modifier' : 'Ajouter'} : ${esc(t.title)}</h2>
    ${field('Type', `<select name="i_kind">${Object.entries(ITEM_TYPES).map(([k, [ico, l]]) => `<option value="${k}"${k === it.kind ? ' selected' : ''}>${ico} ${l}</option>`).join('')}</select>`)}
    ${field('Intitulé', `<input name="i_title" value="${esc(it.title || '')}" placeholder="ex. Genève → Héraklion, Hôtel Minos">`)}
    <div class="two">${field('Date', `<input type="date" name="i_date" value="${it.date || ''}">`)}${field('Heure', `<input type="time" name="i_time" value="${it.time || ''}">`)}</div>
    ${field('Jusqu\u2019au (hôtel, location)', `<input type="date" name="i_end" value="${it.end || ''}">`)}
    <div class="two">${field('N° de réservation', `<input name="i_ref" value="${esc(it.ref || '')}" autocapitalize="characters">`)}${field('Prix', `<input name="i_price" value="${esc(it.price || '')}" placeholder="ex. 420 CHF">`)}</div>
    ${field('Lien (Booking, compagnie…)', `<input type="url" name="i_link" value="${esc(it.link || '')}" placeholder="https://…">`)}
    ${field('Note', `<input name="i_notes" value="${esc(it.notes || '')}">`)}
    ${field(`Fichier : billet, confirmation (PDF ou photo)${it.file ? `<br>Actuel : ${esc(it.file.name)}` : ''}`, '<input type="file" name="i_file" accept="application/pdf,image/*">')}
    ${syncOn() ? '' : '<p class="muted">Pour joindre un fichier, configurez d\u2019abord la sauvegarde GitHub dans Réglages.</p>'}
    <div class="btns end">${id ? `<button class="btn danger" data-act="delItem" data-t="${tid}" data-id="${id}">Supprimer</button>` : ''}
    <button class="btn" data-act="close">Annuler</button><button class="btn pri" data-act="saveItem" data-t="${tid}" data-id="${id || ''}">Enregistrer</button></div>`);
}
const safeUrl = u => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '').trim()) ? String(u).trim() : '');
const safeName = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
const readB64 = f => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(f); });
const fileApi = path => `${repoUrl()}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
async function deleteRepoFile(path) {
  try {
    const g = await gh('GET', fileApi(path));
    if (g.ok && g.data && g.data.sha) await gh('DELETE', fileApi(path), { message: `Congés Duo : fichier supprimé (${SY.device || 'appareil'})`, sha: g.data.sha });
  } catch (e) { /* le fichier reste dans l'historique */ }
}
async function saveItem(tid, id) {
  const t = DB.trips.find(x => x.id === tid); if (!t) return;
  const q = k => document.querySelector(`[name=${k}]`);
  const file = q('i_file').files[0];
  if (q('i_link').value.trim() && !safeUrl(q('i_link').value)) return toast('Le lien doit commencer par https://');
  if (file && !syncOn()) return toast('Configurez d\u2019abord la sauvegarde GitHub pour joindre un fichier.');
  if (file && file.size > 20e6) return toast('Fichier trop lourd (20 Mo maximum).');
  t.items = t.items || [];
  let it = t.items.find(x => x.id === id);
  if (!it) { it = { id: uid() }; t.items.push(it); }
  Object.assign(it, { kind: q('i_kind').value, title: q('i_title').value.trim(), date: q('i_date').value, time: q('i_time').value,
    end: q('i_end').value, ref: q('i_ref').value.trim(), price: q('i_price').value.trim(), link: q('i_link').value.trim(), notes: q('i_notes').value.trim() });
  t.u = Date.now(); save(); $('dlg').close(); render();
  if (!file) return toast('Enregistré');
  toast('Envoi du fichier vers le repo privé…');
  try {
    const path = `fichiers/${tid}/${it.id}-${safeName(file.name)}`;
    const old = it.file && it.file.path !== path ? it.file.path : null;
    const ex = await gh('GET', fileApi(path));
    const r = await gh('PUT', fileApi(path), { message: `Congés Duo : fichier ajouté (${SY.device || 'appareil'})`, content: await readB64(file), ...(ex.ok && ex.data && ex.data.sha ? { sha: ex.data.sha } : {}) });
    if (!r.ok) throw syncError(r.status, r.status === 404);
    it.file = { path, name: file.name, type: file.type || '', size: file.size };
    t.u = Date.now(); save(); render(); toast('Fichier joint');
    if (old) deleteRepoFile(old);
  } catch (err) { toast(err instanceof TypeError ? 'Pas de connexion : fichier non envoyé.' : err.message); }
}
async function getFile(tid, id) {
  const t = DB.trips.find(x => x.id === tid), it = t && (t.items || []).find(x => x.id === id);
  if (!it || !it.file) return;
  if (!syncOn()) return toast('Ajoutez la clé GitHub dans Réglages pour ouvrir les fichiers.');
  const box = $('dl-' + id); if (box) box.innerHTML = '<small class="muted">Chargement…</small>';
  try {
    const res = await fetch('https://api.github.com' + fileApi(it.file.path), { cache: 'no-store', headers: { Accept: 'application/vnd.github.raw', Authorization: `Bearer ${SY.token}` } });
    if (!res.ok) throw syncError(res.status, false);
    const blob = new Blob([await res.arrayBuffer()], { type: it.file.type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    if (box) box.innerHTML = (blob.type.startsWith('image/') ? `<img src="${url}" alt="" style="max-width:100%;border-radius:8px;margin-top:6px">` : '') +
      `<a class="btn sm pri" style="margin-top:6px" href="${url}" download="${esc(it.file.name)}" target="_blank">Ouvrir ${esc(it.file.name)}</a>`;
  } catch (err) { if (box) box.innerHTML = ''; toast(err instanceof TypeError ? 'Pas de connexion.' : err.message); }
}

/* ----- Horaires du jour ----- */
function openHours(p, s) {
  const pl = planned(p, s); if (!pl) return toast('Pas d\u2019horaire le dimanche : choisissez un autre jour.');
  const ex = DB.entries.find(e => e.person === p && e.date === s && e.type === 'otdone' && e.times);
  const t = ex ? ex.times : (pl.sat ? { in: pl.start, out: pl.end, pause: pl.pause } : { in: pl.start, l1: pl.l1, l2: pl.l2, out: pl.end });
  const inp = (k, lab) => field(lab, `<input type="time" name="h_${k}" value="${t[k] || ''}" data-hours="1">`);
  showDialog(`<h2>Horaires : ${nm(p)}</h2>
    ${field('Jour', `<input type="date" name="h_date" value="${s}" data-hdate="${p}">`)}
    <p class="muted">${SEASON[pl.season]} prévu : ${pl.sat ? `${pl.start}–${pl.end}, pause ${pl.pause} min` : `${pl.start}–${pl.l1} et ${pl.l2}–${pl.end}`}</p>
    ${pl.sat ? `<div class="two">${inp('in', 'Arrivée')}${inp('out', 'Départ')}</div>${field('Pause prise (minutes)', `<input type="number" inputmode="numeric" name="h_pause" value="${t.pause}" data-hours="1">`)}`
      : `<div class="two">${inp('in', 'Arrivée')}${inp('l1', 'Départ à midi')}</div><div class="two">${inp('l2', 'Reprise')}${inp('out', 'Départ le soir')}</div>`}
    <p class="calc" id="h_res"></p>
    <div class="btns end">${ex ? `<button class="btn danger" data-act="del" data-id="${ex.id}">Supprimer</button>` : ''}
    <button class="btn" data-act="close">Annuler</button><button class="btn pri" data-act="saveHours" data-p="${p}" data-d="${s}">Enregistrer</button></div>`);
  hoursCalc();
}
function readHours() {
  const g = k => { const el = document.querySelector(`[name=h_${k}]`); return el ? el.value : undefined; };
  return { in: g('in'), l1: g('l1'), l2: g('l2'), out: g('out'), pause: g('pause') };
}
function hoursCalc() {
  const b = document.querySelector('[data-act=saveHours]'); if (!b) return;
  const pl = planned(b.dataset.p, b.dataset.d), diff = workedMin(pl, readHours()) - pl.min, el = $('h_res');
  if (el) el.innerHTML = diff ? `Écart : <b>${hm(diff)}</b> ${diff > 0 ? '(heures sup)' : '(en moins)'}` : 'Horaire normal : rien à compter.';
}
function saveHours(p, s) {
  const pl = planned(p, s), times = readHours();
  if (pl.sat) { delete times.l1; delete times.l2; times.pause = +times.pause || 0; } else delete times.pause;
  const diff = workedMin(pl, times) - pl.min;
  let ex = DB.entries.find(e => e.person === p && e.date === s && e.type === 'otdone' && e.times);
  if (!diff && !ex) { $('dlg').close(); return toast('Horaire normal : rien à compter.'); }
  if (!ex) { ex = { id: uid(), person: p, date: s, type: 'otdone', part: 'full', note: 'Horaires' }; DB.entries.push(ex); }
  Object.assign(ex, { hours: Math.round(diff / 60 * 100) / 100, times, status: 'pris', u: Date.now() });
  if (!DB.persons[p].ot.enabled || !DB.persons[p].sched.enabled) { DB.persons[p].ot.enabled = true; DB.persons[p].sched.enabled = true; touch(p); }
  save(); $('dlg').close(); render(); toast(diff ? `${hm(diff)} enregistré` : 'Horaire normal enregistré');
}
function dstIcs() {
  const ev = dstChanges(todayISO()).slice(0, 2).map(c => {
    const d = c.date.replace(/-/g, ''), d2 = addDays(c.date, 1).replace(/-/g, '');
    return ['BEGIN:VEVENT', `UID:dst-${d}@conges-duo`, `DTSTAMP:${d}T000000Z`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${d2}`,
      `SUMMARY:Changement d'horaire : ${dstLabel(c)}`, `DESCRIPTION:Dès le lundi ${SEASON[c.to].toLowerCase()}.`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Changement d\'horaire', 'TRIGGER:-PT36H', 'END:VALARM', 'END:VEVENT'].join('\r\n');
  });
  download('changements-horaire.ics', ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Conges Duo//FR', ...ev, 'END:VCALENDAR'].join('\r\n'), 'text/calendar');
}
function dstNotify() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const t = todayISO(), next = dstChanges(t)[0]; if (!next) return;
  const d = daysBetween(t, next.date); if (d < 0 || d > 3) return;
  const key = 'congesDuo.dstNotif.' + next.date;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (e) { return; }
  const title = 'Changement d\u2019horaire', body = `Dimanche ${frDate(next.date).slice(3)} : passage à l\u2019${dstLabel(next)}.`;
  if (navigator.serviceWorker) navigator.serviceWorker.ready.then(r => r.showNotification(title, { body, icon: 'icon-192.png' })).catch(() => {});
  else { try { new Notification(title, { body }); } catch (e) { /* ignore */ } }
}

/* ----- Réserve et récap des heures sup ----- */
const fh = h => { const m = Math.round(Math.abs(h) * 60); return `${h < 0 ? '−' : ''}${Math.floor(m / 60)} h ${pad(m % 60)}`; };
function openReserve(p, id) {
  const ex = DB.entries.find(e => e.id === id);
  const d = ex ? ex.date : todayISO(), hpd = +DB.persons[p].ot.hoursPerDay || 1;
  const cur = ex ? ex.hours : Math.round(otBalance(p, d, false) * 100) / 100;
  showDialog(`<h2>Réserve d\u2019heures sup : ${nm(p)}</h2>
    <p class="muted">Notez la réserve indiquée par votre employeur (fiche de salaire, décompte). Les heures et congés sur heures sup saisis ensuite partent de ce chiffre.</p>
    <div class="two">${field('Réserve au soir du', `<input type="date" name="r_date" value="${d}">`)}
    ${field('Heures en réserve', `<input type="number" inputmode="decimal" step="0.25" name="r_hours" value="${cur}" data-res="${hpd}">`)}</div>
    <p class="calc" id="r_conv">= ${n(cur / hpd)} jour(s) de ${n(hpd)} h</p>
    <div class="btns end">${ex ? `<button class="btn danger" data-act="del" data-id="${ex.id}">Supprimer</button>` : ''}
    <button class="btn" data-act="close">Annuler</button><button class="btn pri" data-act="saveReserve" data-p="${p}" data-id="${ex ? ex.id : ''}">Enregistrer</button></div>`);
}
function saveReserve(p, id) {
  const d = document.querySelector('[name=r_date]').value, hrs = parseFloat(String(document.querySelector('[name=r_hours]').value).replace(',', '.'));
  if (!d || isNaN(hrs)) return toast('Indiquez la date et le nombre d\u2019heures.');
  let e = DB.entries.find(x => x.id === id) || DB.entries.find(x => x.person === p && x.type === 'otbal' && x.date === d);
  if (!e) { e = { id: uid(), person: p, type: 'otbal', part: 'full', status: 'pris' }; DB.entries.push(e); }
  Object.assign(e, { date: d, hours: hrs, u: Date.now() });
  if (!DB.persons[p].ot.enabled) { DB.persons[p].ot.enabled = true; touch(p); }
  save(); $('dlg').close(); render(); toast(`Réserve notée : ${n(hrs)} h`);
}
function recapData(p, y) {
  const hpd = +DB.persons[p].ot.hoursPerDay || 1, t = todayISO(), rows = [];
  for (let m = 1; m <= 12; m++) {
    const a = iso(y, m, 1), z = iso(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
    let plus = 0, minus = 0, rec = 0, days = 0;
    for (const e of DB.entries) {
      if (e.person !== p || e.date < a || e.date > z || e.status !== 'pris') continue;
      if (e.type === 'otdone') { const h = +e.hours || 0; if (h >= 0) plus += h; else minus += h; days++; }
      else if (e.type === 'otrecup') rec += val(e) * hpd;
    }
    rows.push({ m, plus, minus, rec, days, bal: a <= t ? otBalance(p, z < t ? z : t, false) : null });
  }
  return rows;
}
function openRecap(p) {
  const y = S.year, rows = recapData(p, y), hpd = +DB.persons[p].ot.hoursPerDay || 1;
  const tot = rows.reduce((a, r) => ({ plus: a.plus + r.plus, minus: a.minus + r.minus, rec: a.rec + r.rec, days: a.days + r.days }), { plus: 0, minus: 0, rec: 0, days: 0 });
  const td = 'style="padding:6px 4px;border-top:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap"';
  const tdl = 'style="padding:6px 4px;border-top:1px solid var(--line);text-align:left"';
  const th = 'style="padding:6px 4px;text-align:right;font-size:12px;color:var(--mute);font-weight:500"';
  const body = rows.map(r => `<tr${!r.days && !r.rec ? ' style="color:var(--mute)"' : ''}><td ${tdl}>${MONTHS[r.m - 1]}</td>
    <td ${td}>${r.plus ? '+' + fh(r.plus) : '–'}</td><td ${td}>${r.minus ? fh(r.minus) : '–'}</td><td ${td}>${r.rec ? '−' + fh(r.rec) : '–'}</td>
    <td ${td}>${r.bal === null ? '' : `<b>${fh(r.bal)}</b>`}</td></tr>`).join('');
  showDialog(`<h2>Heures sup ${y} : ${nm(p)}</h2>
    <p class="muted">Heures sup : dépassements notés (⏱ Horaires ou « Heures sup faites »). Récup : congés pris sur la réserve. Solde : réserve en fin de mois.</p>
    <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr><th style="padding:6px 4px;text-align:left;font-size:12px;color:var(--mute);font-weight:500">Mois</th><th ${th}>Heures sup</th><th ${th}>En moins</th><th ${th}>Récup</th><th ${th}>Solde</th></tr></thead>
    <tbody>${body}<tr><td ${tdl}><b>Total ${y}</b></td><td ${td}><b>+${fh(tot.plus)}</b></td><td ${td}><b>${tot.minus ? fh(tot.minus) : '–'}</b></td><td ${td}><b>${tot.rec ? '−' + fh(tot.rec) : '–'}</b></td><td ${td}></td></tr></tbody></table></div>
    <p class="calc">Net ${y} : <b>${fh(tot.plus + tot.minus)}</b> (${n((tot.plus + tot.minus) / hpd)} j), sur ${tot.days} jour(s) saisis.</p>
    <div class="btns end"><button class="btn" data-act="recapCsv" data-p="${p}">Exporter en CSV</button><button class="btn pri" data-act="close">Fermer</button></div>`);
}
function recapCsv(p) {
  const y = S.year, lines = ['mois;heures sup (h);en moins (h);récup (h);solde fin de mois (h);jours saisis'];
  const f = x => String(Math.round(x * 100) / 100).replace('.', ',');
  recapData(p, y).forEach(r => lines.push([`${MONTHS[r.m - 1]} ${y}`, f(r.plus), f(r.minus), f(r.rec), r.bal === null ? '' : f(r.bal), r.days].join(';')));
  download(`heures-sup-${safeName(DB.persons[p].name)}-${y}.csv`, '\ufeff' + lines.join('\r\n'), 'text/csv');
}

/* ----- Agenda : rendez-vous communs ----- */
const REM_UNITS = { m: 'minute(s)', h: 'heure(s)', d: 'jour(s)' };
const remText = r => `${r.n} ${r.u === 'd' ? (r.n > 1 ? 'jours' : 'jour') : r.u === 'h' ? 'h' : 'min'} avant`;
function apptWarn(a) {
  if (!a.date) return [];
  const idx = buildIdx();
  return whoList(a.who || 'both').filter(p => isWorkday(p, a.date) && offFrac(p, a.date, idx) < 1).map(p => `${nm(p)} travaille ce jour-là`);
}
function apptCard(a) {
  const warn = apptWarn(a), rems = (a.reminders || []).map(remText).join(', ');
  return `<section class="card appt"><div class="trip-h"><div class="grow"><h2>📌 ${esc(a.title)}</h2>
    <div class="muted">${a.date ? frDate(a.date) : 'date à définir'}${a.time ? ` à ${a.time}${a.end ? `–${a.end}` : ''}` : ''}${a.place ? `<br>📍 ${esc(a.place)}` : ''}</div>
    <div class="who-l">${whoDots(a.who || 'both')}</div>
    ${warn.map(w => `<div class="warn">⚠ ${w} : pensez à poser un congé.</div>`).join('')}
    <div class="muted">🔔 ${rems || 'aucun rappel'}</div></div>
    <button class="iconbtn" data-act="editAppt" data-id="${a.id}" aria-label="Modifier le rendez-vous">✎</button></div>
    ${a.notes ? `<p class="tnotes">${esc(a.notes)}</p>` : ''}
    <div class="btns">${a.date ? `<a class="btn sm" href="${apptGcal(a)}" target="_blank" rel="noopener">Google Agenda</a><button class="btn sm" data-act="apptIcs" data-id="${a.id}">Agenda iPhone (.ics)</button>` : ''}</div></section>`;
}
function renderAgenda() {
  const t = todayISO(), ap = (DB.appts || []).concat(famOn() ? FY.appts.filter(a => a.repeat !== 'weekly') : []);
  const up = ap.filter(a => !a.date || a.date >= t).sort((a, b) => ((a.date || '9') + (a.time || '')).localeCompare((b.date || '9') + (b.time || '')));
  const past = ap.filter(a => a.date && a.date < t).sort((a, b) => b.date.localeCompare(a.date));
  let h = `<div class="btns"><button class="btn pri" data-act="newAppt">+ Rendez-vous</button><button class="btn" data-act="newTrip">+ Voyage</button></div>
    <h3 class="sec">Rendez-vous</h3>`;
  const card = a => (Array.isArray(a.who) ? famApptCard(a) : apptCard(a));
  h += up.length ? up.map(card).join('') : '<p class="muted">Aucun rendez-vous à venir.</p>';
  if (past.length) h += sect('pastAppt', `<span class="grow">Rendez-vous passés (${past.length})</span>`, past.map(card).join(''));
  const acts = famOn() ? FY.appts.filter(a => a.repeat === 'weekly' && (!a.until || a.until >= t)) : [];
  return h + (acts.length ? `<h3 class="sec">Activités chaque semaine</h3>${acts.map(famApptCard).join('')}` : '') + (famOn() ? gardeSection() + FY.members.filter(m => m.role === 'enfant').map(m => packList(m.id)).join('') : '') + `<h3 class="sec">Voyages</h3>` + renderTrips();
}
function remRow(r) {
  return `<div class="two rem" style="grid-template-columns:minmax(0,1fr) minmax(0,1.4fr) auto;align-items:end">
    ${field('Rappel', `<input type="number" inputmode="numeric" min="1" name="rm_n" value="${r.n}">`)}
    ${field('&nbsp;', `<select name="rm_u">${Object.entries(REM_UNITS).map(([k, l]) => `<option value="${k}"${k === r.u ? ' selected' : ''}>${l} avant</option>`).join('')}</select>`)}
    <button class="iconbtn" data-act="delRem" aria-label="Retirer ce rappel" style="margin-bottom:2px">✕</button></div>`;
}
function openAppt(id, date) {
  const fa = FY.appts.find(x => x.id === id);
  const a = (DB.appts || []).find(x => x.id === id) || fa || { who: famOnly() ? [FSY.me] : S.addWho || 'both', date: date || todayISO(), reminders: [{ n: 2, u: 'h' }, { n: 45, u: 'm' }] };
  const fam = famOnly() || !!fa || !!S.famNew;
  const rep0 = a.repeat === 'weekly' || (!id && S.famRepeat);
  const famWhoHtml = famOn() ? `<div data-row="famwho"${fam ? '' : ' hidden'}><div class="field"><span class="lbl">Qui est concerné</span><div class="chips2 wrap">${FY.members.map(m => `<label class="chip2 ck"><input type="checkbox" name="a_fwho" value="${m.id}"${(Array.isArray(a.who) ? a.who : [FSY.me]).includes(m.id) ? ' checked' : ''}><span>${esc(m.name)}</span></label>`).join('')}</div></div>
    ${field('Qui emmène ?', `<select name="a_ride"><option value="">—</option>${['p1', 'p2', 'seule', 'bus'].map(k => `<option value="${k}"${a.ride === k ? ' selected' : ''}>${k === 'p1' || k === 'p2' ? esc(FY.parents[k]) : RIDES[k]}</option>`).join('')}</select>`)}
    <label class="check"><input type="checkbox" name="a_rep" data-reptoggle="1"${rep0 ? ' checked' : ''}> Répéter chaque semaine (activité)</label>
    <div data-row="until"${rep0 ? '' : ' hidden'}>${field('Jusqu\u2019au (optionnel)', `<input type="date" name="a_until" value="${a.until || ''}">`)}</div></div>` : '';
  showDialog(`<h2>${id ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous'}</h2>
    ${field('Titre', `<input name="a_title" value="${esc(a.title || '')}" placeholder="ex. Notaire, mariage, rendez-vous banque">`)}
    <div class="two">${field('Date', `<input type="date" name="a_date" value="${a.date || ''}">`)}${field('Lieu', `<input name="a_place" value="${esc(a.place || '')}">`)}</div>
    <div class="two">${field('Heure', `<input type="time" name="a_time" value="${a.time || ''}">`)}${field('Fin (optionnel)', `<input type="time" name="a_end" value="${a.end || ''}">`)}</div>
    ${famOn() && !famOnly() ? `<label class="check"><input type="checkbox" name="a_fam" data-famtoggle="1"${fam ? ' checked' : ''}> Partager avec l\u2019espace famille</label>` : ''}
    ${famOnly() ? '' : `<div class="field" data-row="mainwho"${fam ? ' hidden' : ''}><span class="lbl">Qui doit être présent</span>${radios('a_who', [['a', nm('a')], ['b', nm('b')], ['both', 'Les deux']], typeof a.who === 'string' ? a.who : 'both')}</div>`}
    ${famWhoHtml}
    <div id="rems">${(a.reminders || []).map(remRow).join('')}</div>
    <div class="btns"><button class="btn sm" data-act="addRem">+ Ajouter un rappel</button></div>
    <p class="muted">Les rappels arrivent en notification sur le téléphone de chaque personne concernée (à 30 minutes près).</p>
    ${field('Notes', `<textarea name="a_notes" rows="3">${esc(a.notes || '')}</textarea>`)}
    <div class="btns end">${id ? `<button class="btn danger" data-act="delAppt" data-id="${id}">Supprimer</button>` : ''}
    <button class="btn" data-act="close">Annuler</button><button class="btn pri" data-act="saveAppt" data-id="${id || ''}">Enregistrer</button></div>`);
}
function saveAppt(id) {
  const q = k => document.querySelector(`[name=${k}]`);
  const title = q('a_title').value.trim(); if (!title) return toast('Donnez un titre au rendez-vous.');
  const ns = [...document.querySelectorAll('[name=rm_n]')], us = [...document.querySelectorAll('[name=rm_u]')];
  const reminders = ns.map((el, i) => ({ n: Math.max(1, parseInt(el.value, 10) || 0), u: us[i].value })).filter(r => r.n > 0);
  const fam = famOnly() || !!(q('a_fam') && q('a_fam').checked);
  const fields = { title, date: q('a_date').value, time: q('a_time').value, end: q('a_end').value, place: q('a_place').value.trim(), notes: q('a_notes').value.trim(), reminders, u: Date.now() };
  DB.appts = DB.appts || [];
  const inMain = DB.appts.find(x => x.id === id), inFam = FY.appts.find(x => x.id === id);
  S.famNew = false;
  if (fam) {
    const who = [...document.querySelectorAll('[name=a_fwho]:checked')].map(x => x.value);
    if (!who.length) return toast('Cochez au moins une personne concernée.');
    if (inMain) { DB.appts = DB.appts.filter(x => x.id !== id); DB.deleted[id] = Date.now(); save(); }
    let a = inFam; if (!a) { a = { id: id || 'f' + uid() }; FY.appts.push(a); }
    const repeat = q('a_rep') && q('a_rep').checked ? 'weekly' : '';
    Object.assign(a, fields, { who, ride: (q('a_ride') || {}).value || '', repeat, until: repeat ? (q('a_until') || {}).value || '' : '' });
    S.famRepeat = false; famSave(); $('dlg').close(); render(); toast(repeat ? 'Activité enregistrée (chaque semaine)' : 'Rendez-vous partagé avec la famille');
    return;
  }
  if (inFam) { FY.appts = FY.appts.filter(x => x.id !== id); FY.deleted[id] = Date.now(); famSave(); }
  let a = inMain;
  if (!a) { a = { id: id || uid() }; DB.appts.push(a); }
  Object.assign(a, fields, { who: (document.querySelector('[name=a_who]:checked') || {}).value || 'both' });
  save(); $('dlg').close(); render();
  const w = apptWarn(a); toast(w.length ? `Enregistré. Attention : ${w.join(', ')}.` : 'Rendez-vous enregistré');
}
const ymd = s => s.replace(/-/g, '');
// Heure par défaut 9 h et durée 1 h quand rien n'est saisi.
function apptTimes(a) {
  const st = a.time || '09:00';
  let en = a.end;
  if (!en || en <= st) { const m = tmin(st) + 60; en = `${pad(Math.min(23, Math.floor(m / 60)))}:${pad(m >= 1440 ? 59 : m % 60)}`; }
  return { st: st.replace(':', '') + '00', en: en.replace(':', '') + '00' };
}
function apptGcal(a) {
  const d = ymd(a.date);
  const t = apptTimes(a), dates = `${d}T${t.st}/${d}T${t.en}`;
  const rr = a.repeat === 'weekly' ? `&recur=${encodeURIComponent('RRULE:FREQ=WEEKLY' + (a.until ? ';UNTIL=' + ymd(a.until) + 'T235959Z' : ''))}` : '';
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(a.title)}&dates=${dates}${rr}&ctz=Europe/Zurich&location=${encodeURIComponent(a.place || '')}&details=${encodeURIComponent(a.notes || '')}`;
}
function apptIcs(id) {
  const a = (DB.appts || []).find(x => x.id === id) || FY.appts.find(x => x.id === id); if (!a || !a.date) return;
  const d = ymd(a.date), clean = s => String(s || '').replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const t = apptTimes(a), start = `DTSTART:${d}T${t.st}`, end = `DTEND:${d}T${t.en}`;
  const alarms = (a.reminders || []).map(r => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${clean(a.title)}`,
    `TRIGGER:-P${r.u === 'd' ? `${r.n}D` : `T${r.n}${r.u === 'h' ? 'H' : 'M'}`}`, 'END:VALARM'].join('\r\n'));
  download(`rendez-vous-${d}.ics`, ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Conges Duo//FR', 'BEGIN:VEVENT', `UID:${a.id}@conges-duo`,
    `DTSTAMP:${d}T000000Z`, start, end, a.repeat === 'weekly' ? 'RRULE:FREQ=WEEKLY' + (a.until ? ';UNTIL=' + ymd(a.until) + 'T235959Z' : '') : '', `SUMMARY:${clean(a.title)}`, a.place ? `LOCATION:${clean(a.place)}` : '', a.notes ? `DESCRIPTION:${clean(a.notes)}` : '',
    ...alarms, 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n'), 'text/calendar');
}

/* ----- Notifications push (envoyées par la tâche du repo privé) ----- */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ub64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
const pushOk = () => !!(DB.push && DB.push.publicKey && SY.deviceId && DB.subs && DB.subs[SY.deviceId] && DB.subs[SY.deviceId].sub && SY.pushKey === DB.push.publicKey
  && typeof Notification !== 'undefined' && Notification.permission === 'granted');
async function genVapid() {
  if (DB.push && DB.push.publicKey && !confirm('Des clés existent déjà. En créer de nouvelles ? Il faudra mettre à jour les secrets GitHub et réactiver les notifications sur chaque téléphone.')) return;
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), priv = (await crypto.subtle.exportKey('jwk', kp.privateKey)).d;
  DB.push = { ...(DB.push || {}), publicKey: pub, u: Date.now() }; save();
  if (famOn() && !famOnly()) { FY.push = { publicKey: pub, dst: false, u: Date.now() }; famSave(); }
  showDialog(`<h2>Clés de notification créées</h2>
    <p class="muted">Copiez ces deux clés dans les secrets du repo privé (voir la procédure). La clé privée n\u2019est affichée qu\u2019une fois et n\u2019est enregistrée nulle part dans l\u2019app.</p>
    ${field('VAPID_PUBLIC_KEY', `<textarea readonly rows="3" id="k_pub">${pub}</textarea>`)}
    <div class="btns"><button class="btn sm" data-act="copy" data-src="k_pub">Copier la clé publique</button></div>
    ${field('VAPID_PRIVATE_KEY', `<textarea readonly rows="2" id="k_priv">${priv}</textarea>`)}
    <div class="btns"><button class="btn sm" data-act="copy" data-src="k_priv">Copier la clé privée</button></div>
    <div class="btns end"><button class="btn pri" data-act="close">J\u2019ai copié les deux clés</button></div>`);
}
async function enablePush() {
  if (isIOS() && !isStandalone()) return toast('Installez d\u2019abord l\u2019app : Safari › Partager › « Sur l\u2019écran d\u2019accueil », puis ouvrez-la depuis son icône.');
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return toast('Ce navigateur ne gère pas les notifications.');
  if (!DB.push || !DB.push.publicKey) return toast('Les clés de notification ne sont pas encore créées (Réglages › Notifications).');
  if (!SY.me) return toast('Choisissez d\u2019abord à qui appartient ce téléphone (Réglages › Cet appareil).');
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast('Notifications refusées : autorisez-les dans les réglages du téléphone.');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub && SY.pushKey !== DB.push.publicKey) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: ub64u(DB.push.publicKey) });
    SY.deviceId = SY.deviceId || uid(); SY.pushKey = DB.push.publicKey; saveSync();
    DB.subs = DB.subs || {};
    DB.subs[SY.deviceId] = { person: SY.me, name: SY.device || DB.persons[SY.me].name, sub: sub.toJSON(), u: Date.now() };
    save(); render(); toast('Notifications activées sur ce téléphone');
    reg.showNotification('Congés Duo', { body: 'Les rappels arriveront ici.', icon: 'icon-192.png' });
  } catch (err) { toast('Activation impossible : ' + (err && err.message ? err.message : 'erreur inconnue')); }
}
function inviteCode() {
  if (!syncOn()) return toast('Configurez d\u2019abord la sauvegarde GitHub sur ce téléphone.');
  const other = SY.me === 'a' ? 'b' : SY.me === 'b' ? 'a' : null;
  if (!other) return toast('Choisissez d\u2019abord à qui appartient ce téléphone.');
  const code = 'CD1.' + b64u(new TextEncoder().encode(JSON.stringify({ o: SY.owner, r: SY.repo, p: SY.path, t: SY.token, me: other, dev: 'Téléphone ' + DB.persons[other].name })));
  const link = location.origin + location.pathname.replace(/index\.html$/, '') + '#invite=' + code;
  showDialog(`<h2>Invitation pour ${nm(other)}</h2>
    <p class="muted">Envoyez ce lien à ${nm(other)} (WhatsApp, SMS…). En l\u2019ouvrant, son téléphone affiche un guide d\u2019installation pas à pas. Supprimez ensuite le message : le lien contient la clé d\u2019accès à vos données.</p>
    <textarea readonly rows="4" id="inv">${link}</textarea>
    <div class="btns">${navigator.share ? '<button class="btn sm pri" data-act="shareInv">Envoyer le lien…</button>' : ''}<button class="btn sm" data-act="copy" data-src="inv">Copier le lien</button></div>
    <div class="btns end"><button class="btn" data-act="close">Fermer</button></div>`);
}
function joinWithCode() {
  const raw = ($('joinCode') || {}).value || '';
  try {
    const f = raw.trim().match(/CDF1\.([A-Za-z0-9_-]+)/);
    if (f) {
      const j = JSON.parse(new TextDecoder().decode(ub64u(f[1])));
      Object.assign(FSY, { owner: j.o, repo: j.r, path: j.p, token: j.t, me: j.me, famOnly: true, error: '', dirty: false }); famSaveSync();
      FY = famDefault(); famSaveLocal(); S.view = 'home'; render(); toast('Connexion…'); famSync(true); return;
    }
    const m = raw.trim().match(/CD1\.([A-Za-z0-9_-]+)/); if (!m) throw new Error();
    const j = JSON.parse(new TextDecoder().decode(ub64u(m[1])));
    Object.assign(SY, { owner: j.o, repo: j.r, path: j.p, token: j.t, me: j.me, device: j.dev, error: '', force: false, dirty: false }); saveSync();
    DB = defaultData(); saveLocal(); render(); toast('Connexion…'); syncNow(true);
  } catch (e) { toast('Code non reconnu : copiez-le en entier.'); }
}
function openAdd() {
  const w = S.addWho || SY.me || 'a';
  const chip = (v, label, dot) => `<button type="button" class="chip2${w === v ? ' on' : ''}" data-act="addWho" data-v="${v}">${dot ? `<span class="dot ${pc(v)}"></span>` : ''}${label}</button>`;
  const tile = (act, icon, title, sub) => `<button type="button" class="tile" data-act="${act}">${icon}<b>${title}</b><small>${sub}</small></button>`;
  showDialog(`<h2>Ajouter</h2>
    <span class="lbl">Pour qui</span>
    <div class="chips2">${chip('a', SY.me === 'a' ? 'Moi' : nm('a'), 1)}${chip('b', SY.me === 'b' ? 'Moi' : nm('b'), 1)}${chip('both', 'Les deux')}</div>
    <span class="lbl">Quoi</span>
    <div class="tiles">${tile('addLeave', ICON.beach, 'Congé', 'absence, travail en plus')}${tile('addHours', ICON.clock, 'Horaires', 'arrivée, départ, midi')}${tile('newAppt', ICON.pin.replace(/20/g, '24'), 'Rendez-vous', 'avec rappels')}${tile('newTrip', ICON.plane, 'Voyage', 'billets, hôtel')}${famOn() ? tile('famAppt', ICON.pin.replace(/20/g, '24'), 'Rendez-vous famille', 'partagé avec l\u2019ado') + tile('newGarde', ICON.list, 'Garde', 'période chez un parent') : ''}</div>`);
}
function showNotif(t, b) {
  showDialog(`<h2>${esc(t || 'Congés Duo')}</h2><p style="font-size:16px">${esc(b || '')}</p>
    <div class="btns end"><button class="btn" data-act="tab" data-v="trips">Voir l\u2019agenda</button><button class="btn pri" data-act="close">OK</button></div>`);
}
function loadLastNotif() {
  if (typeof caches === 'undefined') return;
  caches.open('cd-notifs').then(c => c.match('./__derniere-notification')).then(r => (r ? r.json() : null)).then(d => {
    const was = JSON.stringify(S.lastNotif || null);
    S.lastNotif = d && d.at > Date.now() - 7 * 864e5 ? d : null;
    if (JSON.stringify(S.lastNotif) !== was && S.view === 'home') render();
  }).catch(() => {});
}
function lastNotifCard() {
  const d = S.lastNotif; if (!d) return '';
  const min = Math.round((Date.now() - d.at) / 60000);
  const ago = min < 1 ? 'à l\u2019instant' : min < 60 ? `il y a ${min} min` : min < 1440 ? `il y a ${Math.round(min / 60)} h` : `il y a ${Math.round(min / 1440)} j`;
  return `<section class="card dst"><b>🔔 ${esc(d.title)}</b><br>${esc(d.body)}<br><small class="muted">Dernier rappel reçu ${ago}</small>
    <div class="btns"><button class="btn sm" data-act="tab" data-v="trips">Voir l\u2019agenda</button><button class="btn sm" data-act="notifSeen">OK, lu</button></div></section>`;
}
function inviteGuide() {
  const ios = isIOS(), n = (() => { try { return JSON.parse(new TextDecoder().decode(ub64u(S.invite.split('.')[1]))).dev.replace('Téléphone ', ''); } catch (e) { return ''; } })();
  return `<section class="card hint-ios" style="font-size:16px"><h2>Bienvenue${n ? ' ' + esc(n) : ''} 👋</h2>
    <p>Trois étapes pour installer Congés Duo et retrouver vos congés et rendez-vous.</p>
    <p><b>1.</b> Copiez votre code personnel :</p>
    <div class="btns"><button class="btn pri" data-act="copyInvite">${S.inviteCopied ? '✓ Code copié' : 'Copier mon code'}</button></div>
    <p><b>2.</b> ${ios ? 'Touchez le bouton <b>Partager</b> de Safari (le carré avec une flèche ⬆️, en bas de l\u2019écran), puis <b>« Sur l\u2019écran d\u2019accueil »</b> et <b>Ajouter</b>.<br><small class="muted">Si vous ne voyez pas ce bouton (lien ouvert depuis WhatsApp), touchez d\u2019abord l\u2019icône Safari 🧭 en bas à droite.</small>'
      : 'Ouvrez le menu ⋮ du navigateur, puis <b>« Installer l\u2019application »</b> ou <b>« Ajouter à l\u2019écran d\u2019accueil »</b>.'}</p>
    <p><b>3.</b> Ouvrez <b>Congés Duo</b> depuis la nouvelle icône, touchez <b>« Coller mon code et rejoindre »</b>, puis <b>Activer les notifications</b>.</p></section>`;
}
function homeSetup() {
  if (S.invite && !isStandalone()) return inviteGuide();
  if (isIOS() && !isStandalone()) return '';
  let h = lastNotifCard();
  if (!syncOn() && !famOn() && !DB.entries.length) h += `<section class="card hint-ios"><b>Rejoindre avec un code d\u2019invitation</b><br><span class="muted">Collez le code reçu, l\u2019app récupère toutes vos données.</span>
    <div class="btns"><button class="btn pri" data-act="pasteJoin">Coller mon code et rejoindre</button></div>
    <textarea id="joinCode" rows="3" placeholder="ou collez le code ici : CD1.…" style="margin-top:8px"></textarea><div class="btns"><button class="btn" data-act="join">Rejoindre</button></div></section>`;
  if (famOnly()) { if (FY.push.publicKey && !famPushOk()) h += `<section class="card hint-ios"><b>🔔 Notifications</b><br>Active-les pour recevoir les rappels et les changements de garde.
    <div class="btns"><button class="btn pri" data-act="famPushOn">Activer les notifications</button></div></section>`; }
  else if (DB.push && DB.push.publicKey && SY.me && !pushOk()) h += `<section class="card hint-ios"><b>🔔 Notifications</b><br>Activez-les pour recevoir les rappels de rendez-vous sur ce téléphone.
    <div class="btns"><button class="btn pri" data-act="pushOn">Activer les notifications</button></div></section>`;
  return h;
}

/* ----- Périodes (plusieurs jours de la même demande) ----- */
function periodOf(e) {
  if (!e || !['conge', 'otrecup', 'extra'].includes(e.type)) return [e];
  const same = x => x.person === e.person && x.type === e.type && (x.note || '') === (e.note || '') && x.status === e.status;
  const byDate = {};
  DB.entries.forEach(x => { if (same(x)) byDate[x.date] = x; });
  const out = [e];
  for (const dir of [-1, 1]) {
    let d = e.date, gap = 0;
    while (gap < 10) {
      d = addDays(d, dir);
      if (byDate[d]) { out.push(byDate[d]); gap = 0; }
      else if (!isWorkday(e.person, d)) gap++;
      else break;
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
function openPeriod(id) {
  const e = DB.entries.find(x => x.id === id); if (!e) return;
  const per = periodOf(e), first = per[0].date, last = per[per.length - 1].date;
  const days = per.reduce((t, x) => t + val(x), 0);
  const tOpts = (e.type === 'extra' ? [['extra', TYPE_FORM.extra]] : [['conge', TYPE_FORM.conge], ['otrecup', TYPE_FORM.otrecup]])
    .map(([k, l]) => `<option value="${k}"${k === e.type ? ' selected' : ''}>${l}</option>`).join('');
  showDialog(`<h2>${esc(e.note || TYPES[e.type])}</h2>
    <p class="muted">${nm(e.person)} : du ${frDate(first)} au ${frDate(last)}, ${n(days)} jour(s) ${tagHtml(e.status)}</p>
    ${e.status === 'demande' && canValidate(e.person) ? `<div class="btns"><button class="btn pri" data-act="perValidate" data-id="${id}">✓ Valider toute la période</button></div>` : ''}
    <h3>Modifier la période</h3>
    <div class="two">${field('Du', `<input type="date" name="pe_start" value="${first}">`)}${field('Au', `<input type="date" name="pe_end" value="${last}">`)}</div>
    ${field('Type', `<select name="pe_type">${tOpts}</select>`)}
    ${field('Statut', `<select name="pe_status"${canValidate(e.person) ? '' : ' disabled'}>${['demande', 'prevu', 'pris'].map(k => `<option value="${k}"${k === e.status ? ' selected' : ''}>${{ demande: 'À valider (demandé au chef)', prevu: 'Validé (à venir)', pris: 'Pris' }[k]}</option>`).join('')}</select>`)}
    ${field('Nom de la demande', `<input name="pe_note" value="${esc(e.note || '')}">`)}
    <p class="muted hint">Seuls les jours de travail sont décomptés. Les demi-journées de la période sont conservées.</p>
    <div class="btns end"><button class="btn danger" data-act="perDelete" data-id="${id}">Supprimer la période</button>
    <button class="btn" data-act="close">Annuler</button><button class="btn pri" data-act="perSave" data-id="${id}">Enregistrer</button></div>`);
}
function periodRemove(per) {
  const ids = new Set(per.map(x => x.id)), now = Date.now();
  DB.entries = DB.entries.filter(x => !ids.has(x.id)); ids.forEach(i => { DB.deleted[i] = now; });
}
function periodSave(id) {
  const e = DB.entries.find(x => x.id === id); if (!e) return;
  const q = k => document.querySelector(`[name=${k}]`);
  const start = q('pe_start').value, end = q('pe_end').value || start, type = q('pe_type').value, status = canValidate(e.person) ? q('pe_status').value : e.status, note = q('pe_note').value.trim();
  if (!start || end < start) return toast('Vérifiez les dates.');
  const per = periodOf(e), parts = {}; per.forEach(x => { parts[x.date] = x.part; });
  const old = per.slice(); periodRemove(per);
  const created = [], skipped = [];
  for (let s = start; s <= end; s = addDays(s, 1)) {
    const part = parts[s] || 'full', r = blockReason(e.person, s, type, part, null);
    if (r) { if (r.startsWith('déjà') || r.startsWith('heures')) skipped.push(`${short(s)} (${r})`); continue; }
    created.push({ id: uid(), person: e.person, date: s, type, part, status, u: Date.now(), ...(note ? { note } : {}) });
  }
  if (!created.length) { DB.entries.push(...old); old.forEach(x => { delete DB.deleted[x.id]; }); return toast('Aucun jour de travail dans ces dates : rien n\u2019a été changé.'); }
  DB.entries.push(...created); save(); $('dlg').close(); render();
  toast(`${n(created.reduce((t, x) => t + val(x), 0))} jour(s) enregistrés` + (skipped.length ? `, ignorés : ${skipped.join(', ')}` : ''));
}

/* ================= Espace famille (repo privé séparé) =================
   Les données partagées avec les enfants vivent dans un AUTRE repo privé, avec une AUTRE clé.
   Un téléphone qui n'a que la clé « famille » ne peut techniquement rien lire d'autre. */
const FAM_KEY = 'congesDuo.famille.v1', FSYNC_KEY = 'congesDuo.famsync';
const famDefault = () => ({ version: 1, su: 0, members: [], parents: { p1: 'Papa', p2: 'Maman' }, appts: [], garde: [], items: [], subs: {}, push: {}, deleted: {} });
let FY = famDefault();
let FSY = { owner: '', repo: 'conges-duo-famille', path: 'donnees.json', token: '', me: '', lastSync: '', dirty: false, error: '', famOnly: false };
let famTimer = null, famBusy = false, famAgain = false;
function famMigrate(d) {
  const def = famDefault(); d = d || {};
  const arr = k => (Array.isArray(d[k]) ? d[k] : []), obj = k => (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k]) ? d[k] : {});
  return { version: 1, su: +d.su || 0, members: arr('members'), parents: { ...def.parents, ...obj('parents') }, appts: arr('appts'), garde: arr('garde'), items: arr('items'), subs: obj('subs'), push: obj('push'), deleted: obj('deleted') };
}
function famLoad() {
  try { FY = famMigrate(JSON.parse(localStorage.getItem(FAM_KEY) || '{}')); } catch (e) { FY = famDefault(); }
  try { FSY = { ...FSY, ...JSON.parse(localStorage.getItem(FSYNC_KEY) || '{}') }; } catch (e) { /* défaut */ }
}
function famSaveLocal() { if (typeof localStorage !== 'undefined') localStorage.setItem(FAM_KEY, JSON.stringify(FY)); }
function famSaveSync() { if (typeof localStorage !== 'undefined') localStorage.setItem(FSYNC_KEY, JSON.stringify(FSY)); }
function famSave() { famSaveLocal(); if (typeof localStorage === 'undefined') return; FSY.dirty = true; famSaveSync(); setSyncState(); famSchedule(); }
const famOn = () => !!(FSY.owner && FSY.repo && FSY.token);
const famOnly = () => !!FSY.famOnly && famOn();
const famName = id => ((FY.members.find(m => m.id === id) || {}).name || '');
const famMe = () => FY.members.find(m => m.id === FSY.me) || null;
const famAdult = () => !famOnly() || (famMe() && famMe().role === 'adulte');
function famMerge(local, remote) {
  const L = famMigrate(local), R = famMigrate(remote), N = R.su > L.su ? R : L;
  const out = { version: 1, su: Math.max(L.su, R.su), members: N.members, parents: N.parents, appts: [], garde: [], items: [], subs: { ...R.subs }, push: (+L.push.u || 0) >= (+R.push.u || 0) ? L.push : R.push, deleted: {} };
  for (const src of [L.deleted, R.deleted]) for (const id in src) out.deleted[id] = Math.max(out.deleted[id] || 0, +src[id] || 0);
  for (const k of ['appts', 'garde', 'items']) {
    const m = {};
    for (const x of [...R[k], ...L[k]]) { const c = m[x.id]; if (!c || (+x.u || 0) > (+c.u || 0)) m[x.id] = x; }
    out[k] = Object.values(m).filter(x => !(out.deleted[x.id] >= (+x.u || 0))).sort((a, b) => a.id.localeCompare(b.id));
  }
  for (const k in L.subs) if (!out.subs[k] || (+L.subs[k].u || 0) > (+out.subs[k].u || 0)) out.subs[k] = L.subs[k];
  return out;
}
function famSchedule(delay = 2500) { if (!famOn()) return; clearTimeout(famTimer); famTimer = setTimeout(() => famSync(false), delay); }
const famRepoUrl = () => `/repos/${encodeURIComponent(FSY.owner)}/${encodeURIComponent(FSY.repo)}`;
const famFileUrl = () => `${famRepoUrl()}/contents/${FSY.path.split('/').map(encodeURIComponent).join('/')}`;
async function famSync(manual) {
  if (!famOn()) return;
  if (famBusy) { famAgain = true; return; }
  if (navigator.onLine === false) { if (manual) toast('Pas de connexion.'); return; }
  famBusy = true;
  try {
    let done = false;
    for (let i = 0; i < 3 && !done; i++) {
      const g = await gh('GET', famFileUrl(), null, FSY.token);
      let remote = null, sha;
      if (g.status === 200 && g.data && g.data.content != null) { remote = JSON.parse(b64dec(g.data.content)); sha = g.data.sha; }
      else if (g.status === 404) { const r = await gh('GET', famRepoUrl(), null, FSY.token); if (r.status !== 200) throw syncError(r.status, true); }
      else throw syncError(g.status, false);
      const before = JSON.stringify(FY);
      const next = remote ? famMerge(FY, remote) : famMerge(FY, FY);
      FY = next; famSaveLocal();
      if (JSON.stringify(FY) !== before && S.view !== 'set') render();
      if (remote && JSON.stringify(next) === JSON.stringify(famMerge(remote, remote))) { done = true; break; }
      const p = await gh('PUT', famFileUrl(), { message: `Congés Duo famille : mise à jour (${famName(FSY.me) || 'appareil'})`, content: b64enc(JSON.stringify(next, null, 1)), ...(sha ? { sha } : {}) }, FSY.token);
      if (p.ok) done = true; else if (p.status !== 409 && p.status !== 422) throw syncError(p.status, p.status === 404);
    }
    if (!done) throw new Error('Conflit avec une autre modification : réessayez.');
    FSY.dirty = false; FSY.error = ''; FSY.lastSync = new Date().toISOString(); famSaveSync();
    if (manual) toast('Espace famille synchronisé');
  } catch (err) {
    FSY.error = err instanceof TypeError ? 'Pas de connexion : la synchro se fera au retour du réseau.' : err.message; famSaveSync();
    if (manual) toast(FSY.error);
  } finally { famBusy = false; setSyncState(); if (famAgain) { famAgain = false; famSchedule(400); } }
}
// Première connexion d'un adulte : crée son profil et recopie la clé de notification.
async function famConnect() {
  if (!famOn()) return;
  FSY.famOnly = false; famSaveSync();
  await famSync(true);
  if (FSY.error) return;
  let me = FY.members.find(m => m.id === FSY.me);
  if (!me) {
    const myName = DB.persons[SY.me || 'a'].name;
    me = FY.members.find(m => m.role === 'adulte' && m.name === myName);
    if (!me) { me = { id: 'm' + uid(), name: myName, role: 'adulte', u: Date.now() }; FY.members.push(me); FY.su = Date.now(); }
    FSY.me = me.id; famSaveSync();
  }
  if (DB.push && DB.push.publicKey && FY.push.publicKey !== DB.push.publicKey) FY.push = { publicKey: DB.push.publicKey, dst: false, u: Date.now() };
  famSave(); render();
}

/* ----- Garde ----- */
function gardeAt(s) {
  let best = null;
  for (const g of FY.garde) if (g.status !== 'demande' && g.start <= s && s <= (g.end || g.start) && (!best || g.start > best.start || (g.start === best.start && (g.end || g.start) < (best.end || best.start)))) best = g;
  return best;
}
const parentName = w => esc(FY.parents[w] || w);
function gardeRuns(from, days) {
  const out = []; let cur = null;
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i), g = gardeAt(d), w = g ? g.with : null, note = g && g.note ? g.note : '';
    if (cur && cur.w === w && cur.note === note) cur.end = d;
    else { if (cur) out.push(cur); cur = { w, note, start: d, end: d }; }
  }
  if (cur) out.push(cur);
  return out.filter(r => r.w);
}
function gardeCard() {
  const t = todayISO(), runs = gardeRuns(t, 60), now = runs[0] && runs[0].start === t ? runs[0] : null, next = runs.find(r => r.start > t);
  if (!runs.length) return '';
  const kidNames = FY.members.filter(m => m.role === 'enfant').map(m => esc(m.name)).join(', ');
  return `<section class="card garde"><span class="muted">${famOnly() ? 'Où je suis' : 'Garde · ' + kidNames}</span>
    ${now ? `<b class="gnow g-${now.w}">${famOnly() ? 'Chez ' : 'Chez '}${parentName(now.w)}</b><small>jusqu\u2019au ${short(now.end)}${now.note ? ' · ' + esc(now.note) : ''}</small>` : '<b>Pas de garde notée aujourd\u2019hui</b>'}
    ${next ? `<div class="gnext"><span class="gdot g-${next.w}"></span>Ensuite : chez ${parentName(next.w)} dès le ${short(next.start)}${next.note ? ' · ' + esc(next.note) : ''}</div>` : ''}</section>`;
}
function openGarde(id) {
  const g = FY.garde.find(x => x.id === id) || { with: 'p1', start: todayISO(), end: addDays(todayISO(), 6) };
  showDialog(`<h2>${id ? 'Modifier la période' : 'Période de garde'}</h2>
    <div class="field"><span class="lbl">Chez</span>${radios('g_with', [['p1', parentName('p1')], ['p2', parentName('p2')]], g.with)}</div>
    <div class="two">${field('Du', `<input type="date" name="g_start" value="${g.start}">`)}${field('Au (inclus)', `<input type="date" name="g_end" value="${g.end || g.start}">`)}</div>
    ${field('Note (vacances, activité…)', `<input name="g_note" value="${esc(g.note || '')}" placeholder="ex. Vacances au ski">`)}
    <p class="muted">Une période plus courte posée par-dessus une autre (vacances, échange) la remplace pendant ses dates.</p>
    <div class="btns end">${id ? `<button class="btn danger" data-act="delGarde" data-id="${id}">Supprimer</button>` : ''}<button class="btn" data-act="close">Annuler</button><button class="btn pri" data-act="saveGarde" data-id="${id || ''}">Enregistrer</button></div>`);
}
function saveGarde(id) {
  const q = k => document.querySelector(`[name=${k}]`), start = q('g_start').value, end = q('g_end').value || start;
  if (!start || end < start) return toast('Vérifiez les dates.');
  let g = FY.garde.find(x => x.id === id);
  if (!g) { g = { id: 'g' + uid() }; FY.garde.push(g); }
  Object.assign(g, { with: (document.querySelector('[name=g_with]:checked') || {}).value || 'p1', start, end, note: q('g_note').value.trim(), u: Date.now() });
  famSave(); $('dlg').close(); render(); toast('Garde enregistrée');
}
function openAlternate() {
  showDialog(`<h2>Semaines alternées</h2>
    <p class="muted">Crée une semaine sur deux chez chaque parent. Le jour de début est le jour du changement (par exemple un vendredi).</p>
    <div class="field"><span class="lbl">La première semaine, chez</span>${radios('al_first', [['p1', parentName('p1')], ['p2', parentName('p2')]], 'p1')}</div>
    <div class="two">${field('À partir du', `<input type="date" name="al_start" value="${todayISO()}">`)}${field('Jusqu\u2019au', `<input type="date" name="al_end" value="${addDays(todayISO(), 180)}">`)}</div>
    <div class="btns end"><button class="btn" data-act="close">Annuler</button><button class="btn pri" data-act="saveAlternate">Créer</button></div>`);
}
function saveAlternate() {
  const q = k => document.querySelector(`[name=${k}]`), start = q('al_start').value, end = q('al_end').value;
  if (!start || !end || end < start) return toast('Vérifiez les dates.');
  const series = 's' + uid(); let w = (document.querySelector('[name=al_first]:checked') || {}).value || 'p1', k = 0;
  for (let s = start; s <= end; s = addDays(s, 7)) {
    const e = addDays(s, 6) < end ? addDays(s, 6) : end;
    FY.garde.push({ id: 'g' + uid() + k++, with: w, start: s, end: e, series, u: Date.now() });
    w = w === 'p1' ? 'p2' : 'p1';
  }
  famSave(); $('dlg').close(); render(); toast(`${k} semaines créées`);
}

/* ----- Rendez-vous et activités famille ----- */
// Dates d'un rendez-vous (ou d'une activité hebdomadaire) entre deux dates incluses.
function famOccurrences(a, from, to) {
  if (!a.date) return [];
  if (a.repeat !== 'weekly') return a.date >= from && a.date <= to ? [a.date] : [];
  const out = []; let d = a.date;
  if (d < from) d = addDays(d, 7 * Math.ceil(daysBetween(d, from) / 7));
  for (; d <= to && (!a.until || d <= a.until); d = addDays(d, 7)) out.push(d);
  return out;
}
const famApptsOn = s => FY.appts.filter(a => famOccurrences(a, s, s).length);
const nextOcc = a => famOccurrences(a, todayISO(), addDays(todayISO(), 400))[0] || null;
const RIDES = { p1: '', p2: '', seule: 'Seule / à pied', bus: 'Bus / train' };
const rideText = r => (!r ? '' : r === 'p1' || r === 'p2' ? `${FY.parents[r]} emmène` : RIDES[r] || '');
const DOWL = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const famWho = a => (Array.isArray(a.who) ? a.who : []);
function famApptCard(a) {
  const rems = (a.reminders || []).map(remText).join(', ');
  const warn = !famOnly() && SY.me && famWho(a).includes(FSY.me) && a.date && isWorkday(SY.me, a.date) && offFrac(SY.me, a.date, buildIdx()) < 1;
  const nx = a.repeat === 'weekly' ? nextOcc(a) : null;
  return `<section class="card appt"><div class="trip-h"><div class="grow"><h2>${a.repeat === 'weekly' ? '🔁' : '📌'} ${esc(a.title)} ${famOnly() ? '' : '<span class="famtag">Famille</span>'}</h2>
    <div class="muted">${a.repeat === 'weekly' ? `Chaque ${DOWL[dow(a.date)]}${a.time ? ` à ${a.time}${a.end ? `–${a.end}` : ''}` : ''}${nx ? ` · prochaine fois ${short(nx)}` : ' · terminé'}` : `${a.date ? frDate(a.date) : 'date à définir'}${a.time ? ` à ${a.time}${a.end ? `–${a.end}` : ''}` : ''}`}${a.place ? `<br>📍 ${esc(a.place)}` : ''}</div>
    ${a.ride ? `<div class="ride">🚗 ${esc(rideText(a.ride))}</div>` : ''}
    <div class="who-l">${famWho(a).map(id => `<span class="fchip">${esc(famName(id))}</span>`).join('')}</div>
    ${warn ? `<div class="warn">⚠ Tu travailles ce jour-là : pense à poser un congé.</div>` : ''}
    <div class="muted">🔔 ${rems || 'aucun rappel'}</div></div>
    <button class="iconbtn" data-act="editAppt" data-id="${a.id}" aria-label="Modifier le rendez-vous">✎</button></div>
    ${a.notes ? `<p class="tnotes">${esc(a.notes)}</p>` : ''}
    <div class="btns">${a.date ? `<a class="btn sm" href="${apptGcal(a)}" target="_blank" rel="noopener">Google Agenda</a><button class="btn sm" data-act="apptIcs" data-id="${a.id}">Agenda iPhone (.ics)</button>` : ''}</div></section>`;
}
function famRequests() {
  const req = FY.garde.filter(g => g.status === 'demande').sort((a, b) => a.start.localeCompare(b.start));
  if (!req.length) return '';
  const adult = famAdult();
  return `<section class="card pend"><div class="pendh"><h2>${adult ? 'Demandes de garde' : 'Mes demandes'}</h2></div>
    ${req.map(g => `<div class="pendrow"><span class="gdot g-${g.with}"></span><div class="grow"><b>Chez ${parentName(g.with)}</b><small>${esc(famName(g.by) || '?')} · du ${short(g.start)} au ${short(g.end || g.start)}${g.note ? ' · ' + esc(g.note) : ''}</small></div>
      ${adult ? `<button type="button" class="vbtn" data-act="gReqOk" data-id="${g.id}">Accepter</button><button type="button" class="iconbtn" data-act="gReqNo" data-id="${g.id}" aria-label="Refuser">✕</button>` : `<span class="waitlbl">en attente</span><button type="button" class="iconbtn" data-act="gReqNo" data-id="${g.id}" aria-label="Annuler la demande">✕</button>`}</div>`).join('')}</section>`;
}
function openGardeRequest() {
  showDialog(`<h2>Demander un changement</h2>
    <p class="muted">Ta demande est envoyée aux adultes, qui l\u2019acceptent ou non.</p>
    <div class="field"><span class="lbl">Je voudrais être chez</span>${radios('gr_with', [['p1', parentName('p1')], ['p2', parentName('p2')]], 'p1')}</div>
    <div class="two">${field('Du', `<input type="date" name="gr_start" value="${todayISO()}">`)}${field('Au (inclus)', `<input type="date" name="gr_end" value="${todayISO()}">`)}</div>
    ${field('Pourquoi (optionnel)', '<input name="gr_note" placeholder="ex. anniversaire de Zoé samedi">')}
    <div class="btns end"><button class="btn" data-act="close">Annuler</button><button class="btn pri" data-act="saveGReq">Envoyer la demande</button></div>`);
}
function packList(kidId) {
  const items = FY.items.filter(i => i.who === kidId);
  const me = famOnly() && kidId === FSY.me;
  return `<section class="card"><h2>🎒 À emporter${me ? '' : ' · ' + esc(famName(kidId))}</h2>
    <p class="muted">Rappelé la veille de chaque changement de maison.</p>
    ${items.map(i => `<div class="entry"><div class="grow">${esc(i.text)}</div><button class="iconbtn" data-act="delItemPack" data-id="${i.id}" aria-label="Retirer">✕</button></div>`).join('') || '<p class="muted">Rien pour l\u2019instant.</p>'}
    <div class="two" style="grid-template-columns:minmax(0,1fr) auto;align-items:end">${field('Ajouter', `<input name="pk_text" data-kid="${kidId}" placeholder="ex. sac de sport, chargeur">`)}<button class="btn" data-act="addPack" data-kid="${kidId}" style="margin-bottom:10px">+</button></div></section>`;
}
function gardeSection() {
  const t = todayISO(), list = FY.garde.filter(g => g.status !== 'demande' && (g.end || g.start) >= t).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 12);
  return `<h3 class="sec">Garde</h3>${gardeCard()}${famRequests()}
    ${famAdult() ? `<div class="btns"><button class="btn sm pri" data-act="newGarde">+ Période</button><button class="btn sm" data-act="newAlternate">+ Semaines alternées</button></div>` : '<div class="btns"><button class="btn sm pri" data-act="gReq">Demander un changement</button></div>'}
    ${list.length ? `<section class="card list">${list.map(g => `<div class="entry"><span class="gdot g-${g.with}"></span><div class="grow"><b>Chez ${parentName(g.with)}</b> <small class="muted">du ${short(g.start)} au ${short(g.end || g.start)}</small>${g.note ? `<br><small>${esc(g.note)}</small>` : ''}</div>
      ${famAdult() ? `<button class="iconbtn" data-act="editGarde" data-id="${g.id}" aria-label="Modifier">✎</button>` : ''}</div>`).join('')}</section>` : ''}`;
}

/* ----- Écrans du mode famille (téléphone de l'enfant ou de l'autre parent) ----- */
function renderFamHome() {
  if (S.invite && !isStandalone()) return inviteGuide();
  const t = todayISO(), me = famMe(), kid = me && me.role === 'enfant';
  let h = (S.invite ? '' : iosHint());
  h += `<header class="hello"><span class="muted">${longDate(t)}</span><h2>Bonjour ${esc(me ? me.name : '')}</h2></header>`;
  h += homeSetup() + gardeCard() + famRequests();
  if (kid) h += '<div class="btns"><button class="btn pri" data-act="gReq">Demander un changement de garde</button></div>';
  const week = [];
  for (let i = 0; i < 7; i++) { const d = addDays(t, i); famApptsOn(d).forEach(a => week.push({ a, d })); }
  week.sort((x, y) => (x.d + (x.a.time || '')).localeCompare(y.d + (y.a.time || '')));
  h += `<h3 class="sec">Ces 7 prochains jours</h3>` + (week.length ? `<section class="card list">${week.map(({ a, d }) => `<button type="button" class="entry rowbtn" data-act="editAppt" data-id="${a.id}"><span>${a.repeat === 'weekly' ? '🔁' : '📌'}</span><div class="grow"><b>${esc(a.title)}</b><br><small class="muted">${short(d)}${a.time ? ' à ' + a.time : ''}${a.ride ? ' · 🚗 ' + esc(rideText(a.ride)) : ''}</small></div></button>`).join('')}</section>` : '<p class="muted">Rien de prévu.</p>');
  if (kid) h += packList(me.id);
  return h;
}
function renderFamCal() {
  const y = S.year, m = S.calM, t = todayISO(), first = iso(y, m, 1), offset = (dow(first) + 6) % 7, dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let g = `<div class="monthbar"><button class="iconbtn" data-act="month" data-d="-1" aria-label="Mois précédent">‹</button><strong>${MONTHS[m - 1]} ${y}</strong><button class="iconbtn" data-act="month" data-d="1" aria-label="Mois suivant">›</button></div>
    <div class="who"><span><span class="gdot g-p1"></span>chez ${parentName('p1')}</span><span><span class="gdot g-p2"></span>chez ${parentName('p2')}</span><span>📌 rendez-vous</span></div>
    <div class="grid">${['lu', 'ma', 'me', 'je', 've', 'sa', 'di'].map(d => `<div class="dow">${d}</div>`).join('')}`;
  for (let i = 0; i < offset; i++) g += '<div class="day empty"></div>';
  for (let d = 1; d <= dim; d++) {
    const s = iso(y, m, d), gd = gardeAt(s), ap = famApptsOn(s).length > 0, hol = holidayName(s);
    g += `<button class="day${hol ? ' hol' : ''}${s === t ? ' today' : ''}" data-act="famDay" data-d="${s}"><span class="num">${d}${ap ? '<small class="mk">📌</small>' : ''}</span>
      <span class="lane"><i class="h ${gd ? 'g-' + gd.with + 'bg' : ''}"></i></span></button>`;
  }
  return g + '</div>';
}
function openFamDay(s) {
  const gd = gardeAt(s), ap = famApptsOn(s);
  showDialog(`<h2>${frDate(s)}</h2>${holidayName(s) ? `<p class="holname">${esc(holidayName(s))}</p>` : ''}
    <p>${gd ? `<span class="gdot g-${gd.with}"></span> Chez <b>${parentName(gd.with)}</b>${gd.note ? ' · ' + esc(gd.note) : ''}` : '<span class="muted">Pas de garde notée</span>'}</p>
    ${ap.map(a => `<div class="entry"><div class="grow">${a.repeat === 'weekly' ? '🔁' : '📌'} <b>${esc(a.title)}</b>${a.time ? ` à ${a.time}` : ''}${a.ride ? `<br><small class="muted">🚗 ${esc(rideText(a.ride))}</small>` : ''}</div><button class="iconbtn" data-act="editAppt" data-id="${a.id}" aria-label="Modifier">✎</button></div>`).join('')}
    <div class="btns end"><button class="btn" data-act="close">Fermer</button><button class="btn pri" data-act="newAppt" data-date="${s}">+ Rendez-vous</button></div>`);
}
function renderFamAgenda() {
  const t = todayISO();
  const acts = FY.appts.filter(a => a.repeat === 'weekly' && (!a.until || a.until >= t)).sort((a, b) => (dow(a.date) + (a.time || '')).localeCompare(dow(b.date) + (b.time || '')));
  const up = FY.appts.filter(a => a.repeat !== 'weekly' && (!a.date || a.date >= t)).sort((a, b) => ((a.date || '9') + (a.time || '')).localeCompare((b.date || '9') + (b.time || '')));
  return `<div class="btns"><button class="btn pri" data-act="newAppt">+ Rendez-vous</button><button class="btn" data-act="newActivity">+ Activité</button></div>${gardeSection()}
    ${acts.length ? `<h3 class="sec">Activités chaque semaine</h3>${acts.map(famApptCard).join('')}` : ''}
    <h3 class="sec">Rendez-vous</h3>${up.length ? up.map(famApptCard).join('') : '<p class="muted">Aucun rendez-vous à venir.</p>'}
    ${famOnly() && famMe() && famMe().role === 'enfant' ? '' : FY.members.filter(m => m.role === 'enfant').map(m => packList(m.id)).join('')}`;
}
function renderFamMore() {
  const me = famMe();
  return `<h2 class="pagetitle">Réglages</h2>
    <section class="card"><p>Ce téléphone est celui de <b>${esc(me ? me.name : '?')}</b>.</p>
    <div class="row"><span>Notifications</span><b>${famPushOk() ? 'activées' : 'non activées'}</b></div>
    <div class="btns"><button class="btn sm pri" data-act="famPushOn">Activer les notifications</button></div></section>
    <section class="card"><h2>Sauvegarde</h2><p class="syncline">${FSY.error ? esc(FSY.error) : FSY.dirty ? 'Modifications en attente d\u2019envoi.' : 'À jour.'}</p>
    <div class="btns"><button class="btn pri" data-act="sync">Synchroniser maintenant</button></div>
    <p class="muted">Effacer ne touche qu\u2019à ce téléphone.</p><div class="btns"><button class="btn danger" data-act="famReset">Effacer ce téléphone</button></div></section>
    <p class="muted center">Version de l\u2019app : ${APP_VERSION}</p>`;
}

/* ----- Réglages « Espace famille » (adulte principal) ----- */
function famSettings() {
  if (!isAdmin()) return '';
  if (!famOn()) return sect('famille', '<span class="grow">Espace famille (ado, garde)</span>', `
    <p class="muted">Un espace séparé, dans un autre repo privé, pour partager la garde et des rendez-vous avec ton ado (et éventuellement son autre parent). Ils ne voient <b>que</b> cet espace : jamais vos congés, vos heures sup ni vos autres rendez-vous.</p>
    <div class="two">${field('Compte GitHub', `<input data-fsync="owner" autocapitalize="off" spellcheck="false" value="${esc(FSY.owner || SY.owner)}">`)}${field('Repo privé famille', `<input data-fsync="repo" autocapitalize="off" spellcheck="false" value="${esc(FSY.repo)}">`)}</div>
    ${field('Clé d\u2019accès famille (uniquement ce repo)', `<input type="password" data-fsync="token" autocomplete="off" placeholder="github_pat_…" value="">`)}
    <div class="btns"><button class="btn pri" data-act="famConnect">Connecter l\u2019espace famille</button></div>`);
  const subs = Object.entries(FY.subs).filter(([, v]) => v && v.sub);
  return sect('famille', '<span class="grow">Espace famille</span>', `
    <p class="syncline">${FSY.error ? esc(FSY.error) : FSY.dirty ? 'Modifications en attente d\u2019envoi.' : 'Synchronisé.'} · ${esc(FSY.repo)}</p>
    <h4>Membres</h4>
    ${FY.members.map(m => `<div class="row"><span>${esc(m.name)} <small class="muted">${m.role}${m.id === FSY.me ? ' · toi' : ''}</small></span><b>${m.id !== FSY.me ? `<button class="btn sm" data-act="famInvite" data-id="${m.id}">Inviter</button> <button class="btn sm danger" data-act="famDelMember" data-id="${m.id}">Retirer</button>` : ''}</b></div>`).join('')}
    <div class="two">${field('Prénom', '<input name="fm_name" placeholder="ex. le prénom de ta fille">')}${field('Rôle', '<select name="fm_role"><option value="enfant">enfant / ado</option><option value="adulte">adulte</option></select>')}</div>
    <div class="btns"><button class="btn sm" data-act="famAddMember">+ Ajouter ce membre</button></div>
    <h4>Garde : noms des deux foyers</h4>
    <div class="two">${field('Foyer 1', `<input data-fpar="p1" value="${esc(FY.parents.p1)}">`)}${field('Foyer 2', `<input data-fpar="p2" value="${esc(FY.parents.p2)}">`)}</div>
    <h4>Notifications famille sur ce téléphone</h4>
    <div class="row"><span>Ce téléphone</span><b>${famPushOk() ? 'activé' : 'non activé'}</b></div>
    ${subs.map(([k, v]) => `<div class="row"><span>${esc(v.name || '')}</span><b>${esc(famName(v.person))}</b></div>`).join('')}
    <div class="btns"><button class="btn sm pri" data-act="famPushOn">Recevoir les rappels famille ici</button></div>
    <div class="btns"><button class="btn sm danger" data-act="famDisconnect">Déconnecter l\u2019espace famille de ce téléphone</button></div>`);
}
function famInvite(id) {
  const m = FY.members.find(x => x.id === id); if (!m) return;
  const code = 'CDF1.' + b64u(new TextEncoder().encode(JSON.stringify({ o: FSY.owner, r: FSY.repo, p: FSY.path, t: FSY.token, me: m.id, dev: m.name })));
  const link = location.origin + location.pathname.replace(/index\.html$/, '') + '#invite=' + code;
  showDialog(`<h2>Invitation pour ${esc(m.name)}</h2>
    <p class="muted">Ce lien donne accès <b>uniquement</b> à l\u2019espace famille. Envoyez-le en privé, puis supprimez le message.</p>
    <textarea readonly rows="4" id="inv">${link}</textarea>
    <div class="btns">${navigator.share ? '<button class="btn sm pri" data-act="shareInv">Envoyer le lien…</button>' : ''}<button class="btn sm" data-act="copy" data-src="inv">Copier le lien</button></div>
    <div class="btns end"><button class="btn" data-act="close">Fermer</button></div>`);
}
const famPushOk = () => !!(FY.push && FY.push.publicKey && SY.deviceId && FY.subs[SY.deviceId] && FY.subs[SY.deviceId].sub && typeof Notification !== 'undefined' && Notification.permission === 'granted');
async function famEnablePush() {
  if (isIOS() && !isStandalone()) return toast('Installez d\u2019abord l\u2019app : Safari › Partager › « Sur l\u2019écran d\u2019accueil ».');
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return toast('Ce téléphone ne gère pas les notifications.');
  if (!FY.push || !FY.push.publicKey) return toast('Les notifications famille ne sont pas encore prêtes (à activer par l\u2019adulte principal).');
  try {
    if (await Notification.requestPermission() !== 'granted') return toast('Notifications refusées : autorisez-les dans les réglages du téléphone.');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub && SY.pushKey && SY.pushKey !== FY.push.publicKey) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: ub64u(FY.push.publicKey) });
    SY.deviceId = SY.deviceId || uid(); SY.pushKey = FY.push.publicKey; saveSync();
    FY.subs[SY.deviceId] = { person: FSY.me, name: famName(FSY.me), sub: sub.toJSON(), u: Date.now() };
    famSave(); render(); toast('Notifications famille activées');
  } catch (err) { toast('Activation impossible : ' + (err && err.message ? err.message : 'erreur')); }
}

/* ----- Fenêtre de saisie ----- */
function dayStateText(p, s) {
  const k = baseKind(p, s);
  if (k === 'work' && blocYearOf(p, s) !== null) return 'bloc de fin d\u2019année';
  return { work: 'jour de travail', rest: 'repos', hol: 'férié' }[k];
}
function radios(name, opts, cur) {
  return `<div class="seg">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${v}"${v === cur ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
}
function entryForm(e, isEdit) {
  const otOn = P.some(p => DB.persons[p].ot.enabled);
  const typeOpts = Object.entries(TYPE_FORM).filter(([k]) => otOn || (k !== 'otdone' && k !== 'otrecup'))
    .map(([k, l]) => `<option value="${k}"${k === e.type ? ' selected' : ''}>${l}</option>`).join('');
  const resHint = P.filter(p => DB.persons[p].ot.enabled).map(p => { const b = otBalance(p, '9999-12-31', true), hpd = +DB.persons[p].ot.hoursPerDay || 1; return `${nm(p)} : ${n(b)} h = ${n(b / hpd)} j`; }).join(', ');
  const who = isEdit ? radios('f_who', [['a', nm('a')], ['b', nm('b')]], e.person)
    : radios('f_who', [['a', nm('a')], ['b', nm('b')], ['both', 'Les deux']], e.person);
  return `<div class="field"><span class="lbl">Pour qui</span>${who}</div>
    <div class="two">${field('Date', `<input type="date" name="f_date" value="${e.date}">`)}
    ${isEdit ? '' : field('Jusqu\u2019au (optionnel)', '<input type="date" name="f_end" value="">')}</div>
    ${field('Type', `<select name="f_type">${typeOpts}</select>`)}
    <p class="muted hide" data-row="reshint">Réserve disponible (après congés prévus) : ${resHint}</p>
    <div class="field" data-row="part"><span class="lbl">Durée</span>${radios('f_part', Object.entries(PARTS), e.part || 'full')}</div>
    ${isEdit ? '' : '<div class="preview" id="lvPrev" aria-live="polite"></div>'}
    ${field('Heures faites', `<input type="number" inputmode="decimal" step="0.25" name="f_hours" value="${e.hours || ''}">`, 'hide" data-row="hours')}
    ${field('Statut', `<select name="f_status">${isEdit ? '' : '<option value="auto">Auto : passé = pris, futur = à valider</option>'}
      ${['demande', 'prevu', 'pris'].map(k => `<option value="${k}"${isEdit && e.status === k ? ' selected' : ''}>${{ demande: 'À valider (demandé au chef)', prevu: 'Validé (à venir)', pris: 'Pris' }[k]}</option>`).join('')}</select>`)}
    ${field('Note (optionnel)', `<input name="f_note" value="${esc(e.note || '')}">`)}
    <p class="muted hint">Sur une plage de dates, seuls les jours de travail de chacun sont décomptés.</p>`;
}
function openDay(s) {
  const idx = buildIdx(), hol = holidayName(s);
  const list = (idx[s] || []).map(e => { const per = periodOf(e), multi = per.length > 1; return `<div class="entry ${pc(e.person)}"><span class="dot"></span><div class="grow">${nm(e.person)} : ${TYPES[e.type]}, ${e.type === 'otbal' ? n(e.hours || 0) + ' h' : e.type === 'otdone' ? n(e.hours || 0) + ' h' + (e.times ? ` (${timesText(e.times)})` : '') : PARTS[e.part]} ${tagHtml(e.status)}${e.note ? ` <small class="muted">${esc(e.note)}</small>` : ''}
    ${multi ? `<br><small class="muted">Période du ${short(per[0].date)} au ${short(per[per.length - 1].date)} (${per.length} j)</small><div class="btns" style="margin:6px 0 0">${e.status === 'demande' && canValidate(e.person) ? `<button class="btn sm pri" data-act="perValidate" data-id="${e.id}">✓ Valider la période</button>` : ''}<button class="btn sm" data-act="period" data-id="${e.id}">Modifier la période</button></div>` : ''}</div>
    <button class="iconbtn" data-act="edit" data-id="${e.id}" aria-label="Modifier">✎</button><button class="iconbtn" data-act="del" data-id="${e.id}" aria-label="Supprimer">✕</button></div>`; }).join('');
  showDialog(`<h2>${frDate(s)}</h2>${hol ? `<p class="holname">${esc(hol)}</p>` : ''}
    <p class="muted">${P.map(p => `${nm(p)} : ${dayStateText(p, s)}`).join('<br>')}</p>
    ${list ? `<div class="existing">${list}</div>` : ''}
    ${famOn() && gardeAt(s) ? `<p><span class="gdot g-${gardeAt(s).with}"></span> Garde : chez <b>${parentName(gardeAt(s).with)}</b>${gardeAt(s).note ? ' · ' + esc(gardeAt(s).note) : ''}</p>` : ''}
    ${(DB.appts || []).filter(x => x.date === s).concat(famOn() ? famApptsOn(s) : []).map(x => `<div class="entry"><div class="grow">📌 <b>${esc(x.title)}</b>${x.time ? ` à ${x.time}` : ''}</div><button class="iconbtn" data-act="editAppt" data-id="${x.id}" aria-label="Modifier">✎</button></div>`).join('')}
    ${P.filter(p => DB.persons[p].sched.enabled && isWorkday(p, s)).map(p => `<button class="btn sm ${pc(p)}" data-act="hours" data-p="${p}" data-d="${s}">⏱ Horaires de ${nm(p)}</button>`).join(' ')}
    <h3>Nouvelle saisie</h3>${entryForm({ date: s, person: S.addWho || SY.me || 'both', type: 'conge', part: 'full' }, false)}
    <div class="btns end"><button class="btn" data-act="close">Annuler</button><button class="btn pri" data-act="saveAdd">Enregistrer</button></div>`);
}
function openEdit(id) {
  const e = DB.entries.find(x => x.id === id); if (!e) return;
  showDialog(`<h2>Modifier la saisie</h2>${entryForm(e, true)}
    <div class="btns end"><button class="btn" data-act="close">Annuler</button><button class="btn pri" data-act="saveEdit" data-id="${id}">Enregistrer</button></div>`);
}
function showDialog(html) { $('dlgBody').innerHTML = html; syncForm(); leavePreview(); const d = $('dlg'); if (!d.open) d.showModal(); }
function syncForm() {
  const t = document.querySelector('[name=f_type]'); if (!t) return;
  const ot = t.value === 'otdone';
  document.querySelector('[data-row=part]').classList.toggle('hide', ot);
  document.querySelector('[data-row=hours]').classList.toggle('hide', !ot);
  const rh = document.querySelector('[data-row=reshint]'); if (rh) rh.classList.toggle('hide', t.value !== 'otrecup');
}
function leavePreview() {
  const el = $('lvPrev'); if (!el) return;
  const f = readForm();
  if (!f.date || f.type === 'otdone') { el.innerHTML = ''; return; }
  const persons = f.who === 'both' ? P : [f.who], last = f.end && f.end > f.date ? f.end : f.date;
  el.innerHTML = persons.map(p => {
    let cnt = 0, skip = 0;
    for (let s = f.date; s <= last; s = addDays(s, 1)) { if (blockReason(p, s, f.type, f.part, null)) skip++; else cnt += f.part === 'full' ? 1 : 0.5; }
    let after = '';
    if (f.type === 'conge') after = ` · il restera ${n(counters(p, +f.date.slice(0, 4)).restant - cnt)} j`;
    if (f.type === 'otrecup') { const hpd = +DB.persons[p].ot.hoursPerDay || 0; after = ` · réserve après : ${n(otBalance(p, '9999-12-31', true) - cnt * hpd)} h`; }
    return `<div><span class="dot ${pc(p)}"></span> <b>${nm(p)}</b> : <b class="big2">${n(cnt)} j</b> ${f.type === 'extra' ? 'en plus' : 'décomptés'}${after}${skip ? `<br><small>${skip} jour(s) non comptés : repos, fériés ou déjà saisis</small>` : ''}</div>`;
  }).join('');
}
function readForm() {
  const q = nme => document.querySelector(`[name=${nme}]`), r = nme => (document.querySelector(`[name=${nme}]:checked`) || {}).value;
  return { who: r('f_who'), date: q('f_date').value, end: q('f_end') ? q('f_end').value : '', type: q('f_type').value,
    part: r('f_part') || 'full', hours: parseFloat(String(q('f_hours').value).replace(',', '.')), status: q('f_status').value, note: q('f_note').value.trim() };
}
function saveAdd() {
  const f = readForm();
  if (!f.date) return toast('Choisissez une date.');
  if (f.type === 'otdone' && !(f.hours > 0)) return toast('Indiquez le nombre d\u2019heures faites.');
  let persons = f.who === 'both' ? P.slice() : [f.who];
  if (f.type === 'otdone' || f.type === 'otrecup') persons = persons.filter(p => DB.persons[p].ot.enabled);
  if (!persons.length) return toast('Les heures sup ne sont activées pour personne ici.');
  const { created, skipped } = addEntries({ persons, ...f });
  if (!created.length) return toast(skipped.length ? `Rien ajouté : ${skipped.map(x => `${DB.persons[x.p].name}, ${x.r}`).join(' ; ')}` : 'Aucun jour à décompter sur cette période.');
  $('dlg').close(); render();
  const tot = created.reduce((a, e) => a + (e.type === 'otdone' ? 0 : val(e)), 0);
  toast(f.type === 'otdone' ? `${created.length} saisie(s) d\u2019heures enregistrée(s)` : `${n(tot)} jour(s) enregistré(s)` + (skipped.length ? `, ${skipped.length} ignoré(s)` : ''));
}
function saveEdit(id) {
  const e = DB.entries.find(x => x.id === id); if (!e) return;
  const f = readForm();
  if (!f.date) return toast('Choisissez une date.');
  if (f.type === 'otdone' && !(f.hours > 0)) return toast('Indiquez le nombre d\u2019heures faites.');
  const part = f.type === 'otdone' ? 'full' : f.part;
  const r = blockReason(f.who, f.date, f.type, part, id);
  if (r) return toast(`Impossible : ${r}.`);
  const status = canValidate(e.person) || f.status === e.status || f.status === 'demande' ? f.status : e.status;
  Object.assign(e, { person: f.who, date: f.date, type: f.type, part, status, u: Date.now() });
  if (f.type === 'otdone') e.hours = f.hours; else delete e.hours;
  if (f.note) e.note = f.note; else delete e.note;
  save(); $('dlg').close(); render(); toast('Saisie modifiée');
}

/* ----- Export / import ----- */
function download(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function exportCSV() {
  const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const lines = ['date;personne;type;durée;valeur (j);heures;statut;note'];
  [...DB.entries].sort((a, b) => a.date.localeCompare(b.date)).forEach(e => lines.push([
    e.date, q(DB.persons[e.person].name), q(TYPES[e.type]), q(PARTS[e.part]),
    e.type === 'otdone' || e.type === 'otbal' ? '' : String(val(e)).replace('.', ','), e.hours != null ? String(e.hours).replace('.', ',') : '',
    STATUS[e.status] || e.status, q(e.note)].join(';')));
  download(`conges-duo-${todayISO()}.csv`, '\ufeff' + lines.join('\r\n'), 'text/csv');
}
function importFile(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const obj = JSON.parse(rd.result);
      if (!obj || !obj.persons || !Array.isArray(obj.entries)) throw new Error('format');
      if (!confirm(`Importer ce fichier (${obj.entries.length} saisies) ? Les données actuelles seront remplacées, ici et sur GitHub si la synchro est active.`)) return;
      DB = migrate(obj); DB.su = Date.now(); DB.sup = { a: Date.now(), b: Date.now() }; SY.force = true; save(); render(); toast('Sauvegarde importée');
    } catch (err) { toast('Fichier non reconnu : choisissez une sauvegarde Congés Duo (.json).'); }
  };
  rd.readAsText(file);
}


/* ----- Synchronisation avec un repo GitHub privé ----- */
const SYNC_KEY = 'congesDuo.sync';
let SY = { owner: '', repo: 'conges-duo-data', path: 'donnees.json', token: '', device: '', lastSync: '', dirty: false, force: false, error: '', me: '', deviceId: '', pushKey: '' };
let syncTimer = null, syncBusy = false, syncAgain = false, syncState = 'off';
function loadSync() { try { SY = { ...SY, ...JSON.parse(localStorage.getItem(SYNC_KEY) || '{}') }; } catch (e) { /* réglages par défaut */ } }
function saveSync() { if (typeof localStorage !== 'undefined') localStorage.setItem(SYNC_KEY, JSON.stringify(SY)); }
const syncOn = () => !!(SY.owner && SY.repo && SY.path && SY.token);
function scheduleSync(delay = 2500) {
  if (!syncOn()) return;
  clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(false), delay);
}

/* Fusion de deux versions : la saisie modifiée le plus récemment gagne,
   les suppressions sont gardées en mémoire pour ne pas réapparaître. */
function mergeData(local, remote) {
  const L = migrate(local), R = migrate(remote);
  const ts = (D, p) => +(D.sup[p] || 0);
  const out = { version: 1, su: Math.max(L.su, R.su), sup: {}, persons: {}, entries: [], trips: [], deleted: {} };
  for (const p of P) { const r = ts(R, p) > ts(L, p); out.persons[p] = r ? R.persons[p] : L.persons[p]; out.sup[p] = Math.max(ts(L, p), ts(R, p)); }
  for (const src of [L.deleted, R.deleted]) for (const id in src) out.deleted[id] = Math.max(out.deleted[id] || 0, +src[id] || 0);
  const map = {};
  for (const e of [...R.entries, ...L.entries]) { const cur = map[e.id]; if (!cur || (+e.u || 0) > (+cur.u || 0)) map[e.id] = e; }
  out.entries = Object.values(map).filter(e => !(out.deleted[e.id] >= (+e.u || 0)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.person.localeCompare(b.person) || a.id.localeCompare(b.id));
  const tm = {};
  for (const t of [...R.trips, ...L.trips]) { const cur = tm[t.id]; if (!cur || (+t.u || 0) > (+cur.u || 0)) tm[t.id] = t; }
  out.trips = Object.values(tm).filter(t => !(out.deleted[t.id] >= (+t.u || 0))).sort((a, b) => a.id.localeCompare(b.id));
  const am = {};
  for (const t of [...R.appts, ...L.appts]) { const cur = am[t.id]; if (!cur || (+t.u || 0) > (+cur.u || 0)) am[t.id] = t; }
  out.appts = Object.values(am).filter(t => !(out.deleted[t.id] >= (+t.u || 0))).sort((a, b) => a.id.localeCompare(b.id));
  out.subs = { ...R.subs };
  for (const k in L.subs) if (!out.subs[k] || (+L.subs[k].u || 0) > (+out.subs[k].u || 0)) out.subs[k] = L.subs[k];
  out.push = (+L.push.u || 0) >= (+R.push.u || 0) ? L.push : R.push;
  return out;
}

function b64enc(str) { const bytes = new TextEncoder().encode(str); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); }
function b64dec(b64) { const bin = atob(String(b64).replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }
const repoUrl = () => `/repos/${encodeURIComponent(SY.owner)}/${encodeURIComponent(SY.repo)}`;
const fileUrl = () => `${repoUrl()}/contents/${SY.path.split('/').map(encodeURIComponent).join('/')}`;
async function gh(method, url, body, token) {
  const res = await fetch('https://api.github.com' + url, {
    method, cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token || SY.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* réponse vide */ }
  return { status: res.status, ok: res.ok, data };
}
function syncError(status, repo) {
  if (status === 401) return new Error('Clé refusée par GitHub : vérifiez-la, elle a peut-être expiré.');
  if (status === 403) return new Error('Accès refusé : la clé doit avoir « Contents : Read and write » sur ce repo.');
  if (status === 404 && repo) return new Error('Repo introuvable : vérifiez le compte, le nom du repo et l\u2019accès de la clé.');
  return new Error(`Erreur GitHub ${status}.`);
}
async function syncNow(manual) {
  if (!syncOn()) { if (manual) toast('Renseignez le compte, le repo et la clé.'); return; }
  if (syncBusy) { syncAgain = true; return; }
  if (navigator.onLine === false) { setSyncState('offline'); if (manual) toast('Pas de connexion : la synchro se fera au retour du réseau.'); return; }
  syncBusy = true; setSyncState('busy');
  try {
    let done = false;
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      const g = await gh('GET', fileUrl());
      let remote = null, sha;
      if (g.status === 200 && g.data && g.data.content != null) { remote = JSON.parse(b64dec(g.data.content)); sha = g.data.sha; }
      else if (g.status === 404) { const r = await gh('GET', repoUrl()); if (r.status !== 200) throw syncError(r.status, true); }
      else throw syncError(g.status, g.status === 404);
      const before = JSON.stringify(DB);
      const next = remote && !SY.force ? mergeData(DB, remote) : mergeData(DB, DB);
      DB = next; saveLocal();
      if (JSON.stringify(DB) !== before && S.view !== 'set') render();
      const needPush = !remote || SY.force || JSON.stringify(next) !== JSON.stringify(mergeData(remote, remote));
      if (!needPush) { done = true; break; }
      const p = await gh('PUT', fileUrl(), {
        message: `Congés Duo : mise à jour (${SY.device || 'appareil sans nom'})`,
        content: b64enc(JSON.stringify(next, null, 1)), ...(sha ? { sha } : {}),
      });
      if (p.ok) done = true;
      else if (p.status !== 409 && p.status !== 422) throw syncError(p.status, p.status === 404);
    }
    if (!done) throw new Error('Conflit avec une autre modification : réessayez.');
    SY.force = false; SY.dirty = false; SY.error = ''; SY.lastSync = new Date().toISOString(); saveSync();
    setSyncState('ok');
    if (manual) toast('Synchronisé avec GitHub');
  } catch (err) {
    const offline = err instanceof TypeError;
    SY.error = offline ? 'Pas de connexion : la synchro se fera au retour du réseau.' : err.message;
    saveSync(); setSyncState(offline ? 'offline' : 'error');
    if (manual) toast(SY.error);
  } finally {
    syncBusy = false;
    if (syncAgain) { syncAgain = false; scheduleSync(400); }
  }
}
function syncText() {
  if (!syncOn()) return 'Synchro inactive : renseignez le compte, le repo et la clé.';
  if (syncState === 'busy') return 'Synchronisation en cours…';
  if (SY.error) return SY.error;
  const last = SY.lastSync ? new Date(SY.lastSync).toLocaleString('fr-CH', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais';
  return (SY.dirty ? 'Modifications en attente d\u2019envoi. ' : 'À jour. ') + `Dernière synchro : ${last}.`;
}
function setSyncState(state) {
  if (state) syncState = state;
  if (typeof document === 'undefined') return;
  const st = !syncOn() ? (famOn() ? (FSY.error ? 'err' : FSY.dirty ? 'wait' : 'ok') : 'off') : syncState === 'busy' ? 'busy' : SY.error ? (syncState === 'offline' ? 'wait' : 'err') : SY.dirty ? 'wait' : 'ok';
  const dot = $('syncDot');
  if (dot) { dot.className = 'syncdot s-' + st; dot.title = syncText(); }
  const line = $('syncStatus');
  if (line) line.textContent = syncText();
}

/* ----- Événements ----- */
function onClick(ev) {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'tab') { if ($('dlg').open) $('dlg').close(); S.view = b.dataset.v; render(); window.scrollTo(0, 0); }
  else if (a === 'year') { S.year += +b.dataset.d; render(); }
  else if (a === 'month') {
    S.calM += +b.dataset.d;
    if (S.calM < 1) { S.calM = 12; S.year--; } else if (S.calM > 12) { S.calM = 1; S.year++; }
    render();
  }
  else if (a === 'day') openDay(b.dataset.d);
  else if (a === 'add' && famOnly()) {
    const tile = (act, icon, title, sub) => `<button type="button" class="tile" data-act="${act}">${icon}<b>${title}</b><small>${sub}</small></button>`;
    showDialog(`<h2>Ajouter</h2><div class="tiles">${tile('newAppt', ICON.pin.replace(/20/g, '24'), 'Rendez-vous', 'une fois')}${tile('newActivity', ICON.clock, 'Activité', 'chaque semaine')}${famAdult() ? tile('newGarde', ICON.list, 'Garde', 'période chez un parent') : tile('gReq', ICON.list, 'Changement', 'demander à être chez…')}${tile('tab', ICON.beach, 'À emporter', 'ma liste')}</div>`);
    const last = document.querySelector('#dlgBody .tile:last-child'); if (last) last.dataset.v = 'home';
  }
  else if (a === 'add') openAdd();
  else if (a === 'addWho') { S.addWho = b.dataset.v; openAdd(); }
  else if (a === 'addHours') { const p = S.addWho && S.addWho !== 'both' ? S.addWho : (SY.me || 'a'); openHours(p, todayISO()); }
  else if (a === 'toastAct') { const f = S.toastFn; S.toastFn = null; $('toast').classList.remove('on'); if (f) f(); }
  else if (a === 'openDet') { S.open.add('det-' + b.dataset.p); render(); const el = document.querySelector(`details[data-k="det-${b.dataset.p}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  else if (a === 'addLeave') openDay(S.view === 'cal' && S.year === new Date().getFullYear() && S.calM === new Date().getMonth() + 1 ? todayISO()
    : S.view === 'cal' ? iso(S.year, S.calM, 1) : todayISO());
  else if (a === 'edit') { const e = DB.entries.find(x => x.id === b.dataset.id); if (e && e.times) openHours(e.person, e.date); else if (e && e.type === 'otbal') openReserve(e.person, e.id); else openEdit(b.dataset.id); }
  else if (a === 'hours') openHours(b.dataset.p, b.dataset.d);
  else if (a === 'reserve') openReserve(b.dataset.p);
  else if (a === 'saveReserve') saveReserve(b.dataset.p, b.dataset.id);
  else if (a === 'recap') openRecap(b.dataset.p);
  else if (a === 'recapCsv') recapCsv(b.dataset.p);
  else if (a === 'saveHours') saveHours(b.dataset.p, b.dataset.d);
  else if (a === 'dstIcs') dstIcs();
  else if (a === 'notifOn') { if (typeof Notification !== 'undefined') Notification.requestPermission().then(() => { render(); dstNotify(); }); }
  else if (a === 'del') {
    const e = DB.entries.find(x => x.id === b.dataset.id); if (!e) return;
    const wasOpen = $('dlg').open && !document.querySelector('[data-act=saveHours],[data-act=saveReserve]');
    undoable(`${TYPES[e.type]} du ${short(e.date)} supprimé`, () => { DB.entries = DB.entries.filter(x => x.id !== e.id); DB.deleted[e.id] = Date.now(); });
    if (wasOpen) openDay(e.date); else if ($('dlg').open) $('dlg').close();
  }
  else if (a === 'close') $('dlg').close();
  else if (a === 'saveAdd') saveAdd();
  else if (a === 'saveEdit') saveEdit(b.dataset.id);
  else if (a === 'plan') planOption(b.dataset.c, +b.dataset.i);
  else if (a === 'filter') { S.filter = b.dataset.v; render(); }
  else if (a === 'validate' || a === 'refuse') {
    const e = DB.entries.find(x => x.id === b.dataset.id); if (!e) return;
    if (!canValidate(e.person)) return toast(`Seul(e) ${DB.persons[e.person].name} peut valider ses demandes.`);
    const grp = DB.entries.filter(x => x.status === 'demande' && x.person === e.person && (e.note ? x.note === e.note : x.id === e.id));
    const days = grp.reduce((t, x) => t + (x.type === 'otdone' ? 0 : val(x)), 0);
    const label = e.note ? ` « ${e.note} »` : '';
    if (a === 'validate') {
      grp.forEach(x => { x.status = x.date <= todayISO() ? 'pris' : 'prevu'; x.u = Date.now(); });
      save(); render(); toast(`${n(days)} jour(s) validé(s)${label}`);
    } else {
      const ids = new Set(grp.map(x => x.id));
      undoable(`Demande refusée : ${n(days)} j supprimé(s)`, () => { DB.entries = DB.entries.filter(x => !ids.has(x.id)); ids.forEach(id => { DB.deleted[id] = Date.now(); }); });
    }
  }
  else if (a === 'editTrip') openTrip(b.dataset.id);
  else if (a === 'newTrip') openTrip();
  else if (a === 'newAppt') openAppt(undefined, b.dataset.date);
  else if (a === 'editAppt') openAppt(b.dataset.id);
  else if (a === 'saveAppt') saveAppt(b.dataset.id);
  else if (a === 'delAppt') {
    const fx = FY.appts.find(y => y.id === b.dataset.id);
    if (fx) { if (!confirm(`Supprimer le rendez-vous « ${fx.title} » de l\u2019espace famille ?`)) return; FY.appts = FY.appts.filter(y => y.id !== fx.id); FY.deleted[fx.id] = Date.now(); famSave(); $('dlg').close(); render(); toast('Rendez-vous supprimé'); return; }
    const x = (DB.appts || []).find(y => y.id === b.dataset.id); if (!x) return;
    $('dlg').close();
    undoable(`Rendez-vous « ${x.title} » supprimé`, () => { DB.appts = DB.appts.filter(y => y.id !== x.id); DB.deleted[x.id] = Date.now(); });
  }
  else if (a === 'addRem') { const box = $('rems'); if (box) box.insertAdjacentHTML('beforeend', remRow({ n: 1, u: 'h' })); }
  else if (a === 'delRem') { const r = b.closest('.rem'); if (r) r.remove(); }
  else if (a === 'apptIcs') apptIcs(b.dataset.id);
  else if (a === 'genKeys') genVapid();
  else if (a === 'pushOn') enablePush();
  else if (a === 'delSub') {
    if (!confirm('Retirer cet appareil des notifications ?')) return;
    DB.subs[b.dataset.id] = { ...DB.subs[b.dataset.id], sub: null, u: Date.now() }; save(); render();
  }
  else if (a === 'invite') inviteCode();
  else if (a === 'shareInv') { navigator.share({ text: `Installe Congés Duo (nos congés et rendez-vous) : ouvre ce lien dans Safari et suis le guide.\n${$('inv').value}` }).catch(() => {}); }
  else if (a === 'copyInvite') { const c = S.invite; (navigator.clipboard ? navigator.clipboard.writeText(c) : Promise.reject()).then(() => { S.inviteCopied = true; render(); toast('Code copié'); }, () => toast('Copie impossible : gardez cette page ouverte.')); }
  else if (a === 'pasteJoin') { (navigator.clipboard && navigator.clipboard.readText ? navigator.clipboard.readText() : Promise.reject()).then(t => { $('joinCode').value = t; joinWithCode(); }, () => toast('Collez le code à la main dans le champ (appui long › Coller).')); }
  else if (a === 'copy') { const el = $(b.dataset.src); if (el) { (navigator.clipboard ? navigator.clipboard.writeText(el.value) : Promise.reject()).then(() => toast('Copié'), () => { el.select(); document.execCommand('copy'); toast('Copié'); }); } }
  else if (a === 'join') joinWithCode();
  else if (a === 'famConnect') {
    document.querySelectorAll('[data-fsync]').forEach(i => { if (i.value.trim()) FSY[i.dataset.fsync] = i.value.trim(); }); famSaveSync();
    if (!FSY.token) return toast('Collez la clé d\u2019accès famille.'); famConnect();
  }
  else if (a === 'famInvite') famInvite(b.dataset.id);
  else if (a === 'famAddMember') {
    const nmv = (document.querySelector('[name=fm_name]') || {}).value || '', role = (document.querySelector('[name=fm_role]') || {}).value || 'enfant';
    if (!nmv.trim()) return toast('Indiquez un prénom.');
    FY.members.push({ id: 'm' + uid(), name: nmv.trim(), role, u: Date.now() }); FY.su = Date.now(); famSave(); render(); toast(`${nmv.trim()} ajouté(e)`);
  }
  else if (a === 'famDelMember') {
    const m = FY.members.find(x => x.id === b.dataset.id); if (!m) return;
    if (!confirm(`Retirer ${m.name} de l\u2019espace famille ? Pour lui couper l\u2019accès, il faudra aussi changer la clé famille.`)) return;
    FY.members = FY.members.filter(x => x.id !== m.id); FY.su = Date.now(); famSave(); render();
  }
  else if (a === 'famPushOn') famEnablePush();
  else if (a === 'famDisconnect') {
    if (!confirm('Déconnecter l\u2019espace famille de ce téléphone ? Les données restent dans le repo famille.')) return;
    FSY = { ...FSY, token: '', famOnly: false, error: '' }; famSaveSync(); FY = famDefault(); famSaveLocal(); render();
  }
  else if (a === 'famReset') {
    if (!confirm('Effacer les données de ce téléphone ?') || !confirm('Confirmer ? Il faudra le lien d\u2019invitation pour revenir.')) return;
    FSY = { owner: '', repo: 'conges-duo-famille', path: 'donnees.json', token: '', me: '', lastSync: '', dirty: false, error: '', famOnly: false }; famSaveSync(); FY = famDefault(); famSaveLocal(); render();
  }
  else if (a === 'famAppt') { S.famNew = true; openAppt(); }
  else if (a === 'newActivity') { S.famNew = true; S.famRepeat = true; openAppt(); }
  else if (a === 'gReq') openGardeRequest();
  else if (a === 'saveGReq') {
    const q = k => document.querySelector(`[name=${k}]`), start = q('gr_start').value, end = q('gr_end').value || start;
    if (!start || end < start) return toast('Vérifiez les dates.');
    FY.garde.push({ id: 'g' + uid(), with: (document.querySelector('[name=gr_with]:checked') || {}).value || 'p1', start, end, note: q('gr_note').value.trim(), status: 'demande', by: FSY.me, u: Date.now() });
    famSave(); $('dlg').close(); render(); toast('Demande envoyée');
  }
  else if (a === 'gReqOk') {
    const g = FY.garde.find(x => x.id === b.dataset.id); if (!g || !famAdult()) return;
    delete g.status; g.u = Date.now(); famSave(); render(); toast('Changement accepté');
  }
  else if (a === 'gReqNo') {
    const g = FY.garde.find(x => x.id === b.dataset.id); if (!g) return;
    FY.garde = FY.garde.filter(x => x.id !== g.id); FY.deleted[g.id] = Date.now(); famSave(); render(); toast(famAdult() ? 'Demande refusée' : 'Demande annulée');
  }
  else if (a === 'addPack') {
    const el = document.querySelector(`[name=pk_text][data-kid="${b.dataset.kid}"]`), v = el ? el.value.trim() : '';
    if (!v) return; FY.items.push({ id: 'i' + uid(), who: b.dataset.kid, text: v, u: Date.now() }); famSave(); render();
  }
  else if (a === 'delItemPack') { FY.items = FY.items.filter(x => x.id !== b.dataset.id); FY.deleted[b.dataset.id] = Date.now(); famSave(); render(); }
  else if (a === 'famDay') openFamDay(b.dataset.d);
  else if (a === 'newGarde') openGarde();
  else if (a === 'editGarde') openGarde(b.dataset.id);
  else if (a === 'saveGarde') saveGarde(b.dataset.id);
  else if (a === 'delGarde') {
    const g = FY.garde.find(x => x.id === b.dataset.id); if (!g) return;
    const serie = g.series ? FY.garde.filter(x => x.series === g.series) : [g];
    const all = serie.length > 1 && confirm(`Supprimer toute la série de semaines alternées (${serie.length} périodes) ? Annuler = seulement cette période.`);
    (all ? serie : [g]).forEach(x => { FY.deleted[x.id] = Date.now(); });
    const ids = new Set((all ? serie : [g]).map(x => x.id)); FY.garde = FY.garde.filter(x => !ids.has(x.id));
    famSave(); $('dlg').close(); render(); toast('Garde supprimée');
  }
  else if (a === 'newAlternate') openAlternate();
  else if (a === 'saveAlternate') saveAlternate();
  else if (a === 'period') openPeriod(b.dataset.id);
  else if (a === 'perSave') periodSave(b.dataset.id);
  else if (a === 'perValidate') {
    const e = DB.entries.find(x => x.id === b.dataset.id); if (!e) return;
    if (!canValidate(e.person)) return toast(`Seul(e) ${DB.persons[e.person].name} peut valider ses demandes.`);
    const per = periodOf(e).filter(x => x.status === 'demande'), t = todayISO();
    per.forEach(x => { x.status = x.date <= t ? 'pris' : 'prevu'; x.u = Date.now(); });
    save(); if ($('dlg').open) $('dlg').close(); render(); toast(`${n(per.reduce((s2, x) => s2 + val(x), 0))} jour(s) validé(s)`);
  }
  else if (a === 'perDelete') {
    const e = DB.entries.find(x => x.id === b.dataset.id); if (!e) return;
    const per = periodOf(e);
    $('dlg').close();
    undoable(`Période supprimée (${per.length} j)`, () => periodRemove(per));
  }
  else if (a === 'notifSeen') { S.lastNotif = null; if (typeof caches !== 'undefined') caches.open('cd-notifs').then(c => c.delete('./__derniere-notification')).catch(() => {}); render(); }
  else if (a === 'saveTrip') saveTrip(b.dataset.id);
  else if (a === 'delTrip') {
    const t = DB.trips.find(x => x.id === b.dataset.id); if (!t) return;
    if (!confirm(`Supprimer le voyage « ${t.title} » et ses réservations ? Les congés posés ne sont pas touchés.`)) return;
    (t.items || []).forEach(it => { if (it.file && syncOn()) deleteRepoFile(it.file.path); });
    DB.trips = DB.trips.filter(x => x.id !== t.id); DB.deleted[t.id] = Date.now();
    save(); $('dlg').close(); render(); toast('Voyage supprimé');
  }
  else if (a === 'addItem') openItem(b.dataset.t);
  else if (a === 'editItem') openItem(b.dataset.t, b.dataset.id);
  else if (a === 'saveItem') saveItem(b.dataset.t, b.dataset.id);
  else if (a === 'delItem') {
    const t = DB.trips.find(x => x.id === b.dataset.t), it = t && t.items.find(x => x.id === b.dataset.id); if (!it) return;
    if (!confirm(`Supprimer « ${it.title || ITEM_TYPES[it.kind][1]} » ?`)) return;
    if (it.file && syncOn()) deleteRepoFile(it.file.path);
    t.items = t.items.filter(x => x.id !== it.id); t.u = Date.now();
    save(); $('dlg').close(); render(); toast('Supprimé');
  }
  else if (a === 'getFile') getFile(b.dataset.t, b.dataset.id);
  else if (a === 'tripLeave') {
    const t = DB.trips.find(x => x.id === b.dataset.id); if (!t || !t.start) return;
    const { created } = addEntries({ persons: whoList(t.who || 'both'), type: 'conge', part: 'full', status: 'auto', date: t.start, end: t.end, note: t.title });
    render(); toast(created.length ? `${created.length} jour(s) de congé ajoutés (« ${t.title} »)` : 'Aucun jour à poser : déjà posés, repos ou fériés.');
  }
  else if (a === 'hideHint') { try { localStorage.setItem('congesDuo.iosHint', '1'); } catch (e) { /* ignore */ } render(); }
  else if (a === 'stale') {
    const t = todayISO(); let k = 0;
    DB.entries.forEach(e => { if (e.status === 'prevu' && e.date <= t) { e.status = 'pris'; e.u = Date.now(); k++; } });
    save(); render(); toast(`${k} saisie(s) passée(s) en « pris »`);
  }
  else if (a === 'export') { download(`conges-duo-${todayISO()}.json`, JSON.stringify(DB, null, 1), 'application/json'); toast('Sauvegarde exportée'); }
  else if (a === 'import') $('importFile').click();
  else if (a === 'csv') exportCSV();
  else if (a === 'sync') { if (syncOn()) syncNow(true); if (famOn()) famSync(true); if (!syncOn() && !famOn()) { S.view = 'set'; render(); toast('Configurez la sauvegarde GitHub en bas des réglages.'); } }
  else if (a === 'forget') {
    if (!confirm('Retirer la clé GitHub de ce téléphone ? La synchro s\u2019arrête ici. Vos données restent sur ce téléphone et dans le repo privé.')) return;
    if (!confirm('Confirmer : retirer la clé ? Il faudra la recoller pour resynchroniser.')) return;
    SY.token = ''; SY.error = ''; saveSync(); render(); toast('Clé retirée de ce téléphone');
  }
  else if (a === 'reset') {
    if (!confirm('Effacer les données de CE téléphone ? La sauvegarde GitHub n\u2019est pas touchée, et la clé est retirée de ce téléphone.')) return;
    if (!confirm('Confirmer l\u2019effacement ? Pour tout récupérer ensuite, il suffira de recoller la clé GitHub.')) return;
    DB = defaultData(); saveLocal(); SY.token = ''; SY.force = false; SY.dirty = false; SY.error = ''; saveSync(); render(); toast('Données effacées de ce téléphone');
  }
}
function onChange(ev) {
  const t = ev.target;
  if (t.dataset.set) {
    let v;
    if (t.type === 'checkbox') v = t.checked;
    else if (t.type === 'number') v = parseFloat(String(t.value).replace(',', '.')) || 0;
    else v = t.value;
    setPath(t.dataset.set, v);
    if (t.dataset.set.endsWith('.sched.enabled') && v) DB.persons[t.dataset.set.split('.')[0]].ot.enabled = true;
    touch(t.dataset.set.split('.')[0]); save();
    if (t.type === 'checkbox' || t.dataset.set.endsWith('.name')) render();
    else P.forEach(p => { const el = $('calc-' + p); if (el) el.innerHTML = droitCalcText(p); });
  } else if (t.dataset.rest) {
    const p = t.dataset.rest;
    DB.persons[p].rest = [...document.querySelectorAll(`[data-rest="${p}"]:checked`)].map(x => +x.value);
    touch(p); save();
  } else if (t.dataset.sync) {
    SY[t.dataset.sync] = t.value.trim(); SY.error = ''; saveSync(); setSyncState();
    if (syncOn() && (t.dataset.sync === 'token' || t.dataset.sync === 'repo' || t.dataset.sync === 'owner')) syncNow(true);
  } else if (t.name === 'me' && t.closest('.sect')) {
    SY.me = t.value; saveSync();
    if (SY.deviceId && DB.subs && DB.subs[SY.deviceId] && DB.subs[SY.deviceId].sub) { DB.subs[SY.deviceId].person = SY.me; DB.subs[SY.deviceId].u = Date.now(); save(); }
    render(); toast(`Ce téléphone est celui de ${DB.persons[SY.me].name}`);
  } else if (t.id === 'importFile') {
    if (t.files[0]) importFile(t.files[0]); t.value = '';
  } else if (t.dataset.fsync) { FSY[t.dataset.fsync] = t.value.trim(); famSaveSync();
  } else if (t.dataset.fpar) { FY.parents[t.dataset.fpar] = t.value.trim() || FY.parents[t.dataset.fpar]; FY.su = Date.now(); famSave();
  } else if (t.dataset.reptoggle) { const u = document.querySelector('[data-row=until]'); if (u) u.hidden = !t.checked;
  } else if (t.dataset.famtoggle) {
    const on = t.checked, mw = document.querySelector('[data-row=mainwho]'), fw = document.querySelector('[data-row=famwho]');
    if (mw) mw.hidden = on; if (fw) fw.hidden = !on;
  } else if (t.dataset.hdate) { if (t.value) openHours(t.dataset.hdate, t.value);
  } else if (t.name === 'f_type') { syncForm(); leavePreview(); }
  else if (t.name && t.name.startsWith('f_')) leavePreview();
}
function autoPris() {
  const t = todayISO(); let k = 0;
  DB.entries.forEach(e => { if (e.status === 'prevu' && e.date <= t) { e.status = 'pris'; e.u = Date.now(); k++; } });
  if (k) save();
}
function init() {
  load();
  loadSync();
  famLoad();
  autoPris();
  const inv = (location.hash.match(/invite=(CDF?1\.[A-Za-z0-9_-]+)/) || [])[1];
  if (inv) {
    history.replaceState(null, '', location.pathname + location.search);
    if (isStandalone() && !syncOn() && !famOn()) setTimeout(() => { const el = $('joinCode'); if (el) { el.value = inv; joinWithCode(); } }, 0);
    else if (!isStandalone()) S.invite = inv;
  }
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', e => {
    if (e.target.dataset && e.target.dataset.hours) hoursCalc();
    if (e.target.name && e.target.name.startsWith('f_')) leavePreview();
    if (e.target.dataset && e.target.dataset.res) { const v = parseFloat(String(e.target.value).replace(',', '.')) || 0, h = +e.target.dataset.res || 1, el = $('r_conv'); if (el) el.textContent = `= ${n(v / h)} jour(s) de ${n(h)} h`; }
  });
  document.addEventListener('toggle', e => { const d = e.target; if (d && d.dataset && d.dataset.k) { if (d.open) S.open.add(d.dataset.k); else S.open.delete(d.dataset.k); } }, true);
  $('dlg').addEventListener('click', e => { if (e.target === $('dlg')) $('dlg').close(); });
  render();
  const nq = new URLSearchParams(location.search).get('notif');
  if (nq) { try { const j = JSON.parse(nq); showNotif(j.t, j.b); } catch (e) { /* ignore */ } history.replaceState(null, '', location.pathname); }
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'notif') showNotif(e.data.title, e.data.body); });
  setSyncState(SY.dirty ? 'wait' : 'ok');
  scheduleSync(600);
  dstNotify();
  window.addEventListener('online', () => scheduleSync(300));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { scheduleSync(300); famSchedule(500); loadLastNotif(); } });
  window.addEventListener('online', () => famSchedule(500));
  famSchedule(900);
  loadLastNotif();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { famOccurrences, famMerge, gardeAt, gardeRuns, getFY: () => FY, setFY: d => { FY = famMigrate(d); }, nextTogether, pendingGroups, apptTimes, periodOf, safeUrl, remText, recapData, otBaseline, planned, workedMin, dstChanges, isSummer, droitInfo, mergeData, easter, holidays, counters, clusters, bridgeOptions, buildIdx, addEntries, otBalance, dayInfo, defaultData,
    getDB: () => DB, setDB: d => { DB = migrate(d); } };
}
if (typeof document !== 'undefined') init();

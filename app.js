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
    if (e.person !== p || e.date.slice(0, 4) !== ys) continue;
    if (e.type === 'conge') { if (e.status === 'pris') pris += val(e); else prevu += val(e); }
    else if (e.type === 'extra') { if (e.status === 'pris') extraP += val(e); else extraV += val(e); }
  }
  const droit = +per.droit || 0, report = +(per.report[ys] || 0);
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
  return { droit, report, pris, prevu, total, restant: total - pris - prevu, restantPris: total - pris, extraP, extraV, bloc };
}
function otBalance(p, until, withPrevu) {
  const o = DB.persons[p].ot;
  let h = +o.startHours || 0;
  const from = o.startDate || '0000-00-00';
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
const S = { view: 'home', year: new Date().getFullYear(), calM: new Date().getMonth() + 1, filter: 'all' };
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = x => String(Math.round(x * 100) / 100).replace('.', ',');
const pc = p => 'p' + p;
const nm = p => esc(DB.persons[p].name);

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 3200);
}
function row(label, value, cls) { return `<div class="row${cls ? ' ' + cls : ''}"><span>${label}</span><b>${value}</b></div>`; }

function render() {
  $('yearLbl').textContent = S.year;
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
  $('fab').classList.toggle('hide', S.view === 'set' || S.view === 'ponts');
  const v = { home: renderHome, cal: renderCal, ponts: renderPonts, list: renderList, set: renderSet }[S.view];
  $('view').innerHTML = v();
  setSyncState();
}

/* ----- Accueil ----- */
function renderHome() {
  return P.map(p => personCard(p, S.year)).join('') +
    `<p class="muted center">Fériés vaudois calculés automatiquement. Touchez un jour du calendrier ou + pour saisir.</p>`;
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
    ${row(`Droit ${y}`, n(c.droit) + ' j')}${row('Report', n(c.report) + ' j')}
    ${row('Jours travaillés en plus', '+ ' + n(c.extraP) + ' j' + (c.extraV ? `<br><small class="muted">+ ${n(c.extraV)} prévus, comptés une fois faits</small>` : ''))}
    ${row('Pris', n(c.pris) + ' j')}${row('Prévu', n(c.prevu) + ' j')}`;
  if (over) h += row('Sans solde', `<span style="color:var(--hol)">${n(over)} j</span>` + (overPris && over > overPris ? `<br><small class="muted">dont ${n(overPris)} déjà pris</small>` : ''));
  if (c.bloc) {
    h += c.bloc.missing
      ? row('Bloc fin d\u2019année', `<span class="muted">dates ${y} à saisir dans Réglages</span>`)
      : row(`Bloc fin d\u2019année<br><small class="muted">${short(c.bloc.start)} au ${short(c.bloc.end)}</small>`,
        `${c.bloc.official} j officiels<br><small class="muted">${c.bloc.work} jours de travail couverts, ${c.bloc.used} écoulés</small>`, 'tall');
  }
  if (per.ot.enabled) {
    if (!per.ot.startDate) h += row('Heures sup', '<span class="muted">solde de départ à saisir dans Réglages</span>');
    else {
      const t = todayISO(), hpd = +per.ot.hoursPerDay || 1;
      const bal = otBalance(p, t, false), proj = otBalance(p, '9999-12-31', true);
      h += row(`Heures sup au ${short(t)}`, `${n(bal)} h <small class="muted">= ${n(bal / hpd)} j</small>`);
      if (Math.abs(proj - bal) > 1e-9) h += row('Avec les prévus', `${n(proj)} h <small class="muted">= ${n(proj / hpd)} j</small>`);
    }
  }
  return h + '</section>';
}

/* ----- Calendrier ----- */
function lane(p, i) {
  return `<span class="lane ${pc(p)}"><i class="h k-${i.am.k} s-${i.am.st || 'x'}"></i><i class="h k-${i.pm.k} s-${i.pm.st || 'x'}"></i></span>`;
}
function renderCal() {
  const y = S.year, m = S.calM, idx = buildIdx(), t = todayISO();
  const first = iso(y, m, 1), offset = (dow(first) + 6) % 7, dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let g = `<div class="monthbar"><button class="iconbtn" data-act="month" data-d="-1" aria-label="Mois précédent">‹</button>
    <strong>${MONTHS[m - 1]} ${y}</strong><button class="iconbtn" data-act="month" data-d="1" aria-label="Mois suivant">›</button></div>
    <div class="who"><span class="pa"><span class="dot"></span>${nm('a')} : ligne du haut</span><span class="pb"><span class="dot"></span>${nm('b')} : ligne du bas</span></div>
    <div class="grid">${['lu', 'ma', 'me', 'je', 've', 'sa', 'di'].map(d => `<div class="dow">${d}</div>`).join('')}`;
  for (let i = 0; i < offset; i++) g += '<div class="day empty"></div>';
  const hols = [];
  for (let d = 1; d <= dim; d++) {
    const s = iso(y, m, d), hol = holidayName(s), ia = dayInfo('a', s, idx), ib = dayInfo('b', s, idx);
    if (hol) hols.push(`${short(s)} : ${hol}`);
    const both = ia.amOff && ia.pmOff && ib.amOff && ib.pmOff;
    g += `<button class="day${hol ? ' hol' : ''}${s === t ? ' today' : ''}${both ? ' both' : ''}" data-act="day" data-d="${s}">
      <span class="num">${d}</span>${both ? '<span class="star" title="Off tous les deux">★</span>' : ''}${ia.ot || ib.ot ? '<span class="otm">h</span>' : ''}
      ${lane('a', ia)}${lane('b', ib)}</button>`;
  }
  g += '</div>';
  if (hols.length) g += `<p class="hols">${hols.map(esc).join('<br>')}</p>`;
  const sw = (k, st, p = 'a') => `<span class="lane ${pc(p)} sw"><i class="h k-${k} s-${st}"></i></span>`;
  g += `<div class="legend">
    <span>${sw('conge', 'pris')}${sw('conge', 'pris', 'b')} Congé pris</span>
    <span>${sw('conge', 'prevu')}${sw('conge', 'prevu', 'b')} Congé prévu</span>
    <span><span class="lane pa sw"><i class="h k-conge s-pris"></i><i class="h k-work s-x"></i></span> Demi-journée</span>
    <span>${sw('recup', 'pris', 'b')} Récup heures sup</span>
    <span>${sw('bloc', 'pris')} Bloc fin d\u2019année</span>
    <span>${sw('extra', 'pris')} Travail en plus</span>
    <span>${sw('rest', 'x')} Repos</span>
    <span>${sw('hol', 'x')} Férié</span>
    <span><b class="starl">★</b> Off tous les deux</span>
    <span><b class="otl">h</b> Heures sup</span></div>`;
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
        (o.total > 0 ? `<button class="btn sm" data-act="plan" data-c="${c.start}" data-i="${i}">Ajouter ces jours en prévu</button>` : '<span class="tag ok">Déjà en place</span>') + '</div>';
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
  let h = `<div class="chips">${[['all', 'Tous'], ['a', nm('a')], ['b', nm('b')]].map(([k, l]) =>
    `<button class="chip${f === k ? ' on' : ''}" data-act="filter" data-v="${k}">${l}</button>`).join('')}</div>`;
  if (stale) h += `<button class="btn wide" data-act="stale">Passer en « pris » les ${stale} saisie(s) prévue(s) déjà passée(s)</button>`;
  if (!es.length) return h + `<p class="muted center">Aucune saisie en ${ys}. Touchez + pour en ajouter.</p>`;
  h += '<section class="card list">';
  for (const e of es) {
    const detail = e.type === 'otdone' ? `${n(e.hours || 0)} h` : PARTS[e.part];
    h += `<div class="entry ${pc(e.person)}"><span class="dot"></span><div class="grow"><b>${frDate(e.date)}</b> <span class="muted">${nm(e.person)}</span><br>
      ${TYPES[e.type]}, ${detail} <span class="tag ${e.status}">${e.status === 'pris' ? 'Pris' : 'Prévu'}</span>${e.note ? `<br><small class="muted">${esc(e.note)}</small>` : ''}</div>
      <button class="iconbtn" data-act="edit" data-id="${e.id}" aria-label="Modifier">✎</button>
      <button class="iconbtn" data-act="del" data-id="${e.id}" aria-label="Supprimer">✕</button></div>`;
  }
  return h + '</section>';
}

/* ----- Réglages ----- */
const field = (label, input, cls = '') => `<label class="field ${cls}"><span class="lbl">${label}</span>${input}</label>`;
function renderSet() {
  const y = S.year;
  let h = '';
  for (const p of P) {
    const per = DB.persons[p], pr = per.bloc.periods[y] || {};
    h += `<section class="card ${pc(p)}"><div class="phead"><span class="dot"></span><h2>${nm(p)}</h2></div>
      ${field('Nom affiché', `<input data-set="${p}.name" value="${esc(per.name)}">`)}
      <div class="field"><span class="lbl">Jours de repos de base</span><div class="days7">${[1, 2, 3, 4, 5, 6, 0].map(d =>
        `<label><input type="checkbox" data-rest="${p}" value="${d}"${per.rest.includes(d) ? ' checked' : ''}>${DOW[d]}</label>`).join('')}</div></div>
      <div class="two">${field('Droit annuel (jours)', `<input type="number" inputmode="decimal" step="0.5" data-set="${p}.droit" value="${per.droit}">`)}
      ${field(`Report sur ${y} (jours)`, `<input type="number" inputmode="decimal" step="0.5" data-set="${p}.report.${y}" value="${per.report[y] || 0}">`)}</div>
      <label class="check"><input type="checkbox" data-set="${p}.bloc.enabled"${per.bloc.enabled ? ' checked' : ''}> Bloc de fin d\u2019année (compteur séparé)</label>
      ${per.bloc.enabled ? `<div class="sub">${field('Jours officiels du bloc', `<input type="number" step="0.5" data-set="${p}.bloc.official" value="${per.bloc.official}">`)}
        <div class="two">${field(`Début du bloc ${y}`, `<input type="date" data-set="${p}.bloc.periods.${y}.start" value="${pr.start || ''}">`)}
        ${field('Fin du bloc', `<input type="date" data-set="${p}.bloc.periods.${y}.end" value="${pr.end || ''}">`)}</div></div>` : ''}
      <label class="check"><input type="checkbox" data-set="${p}.ot.enabled"${per.ot.enabled ? ' checked' : ''}> Heures supplémentaires</label>
      ${per.ot.enabled ? `<div class="sub"><div class="two">${field('Solde de départ (heures)', `<input type="number" inputmode="decimal" step="0.25" data-set="${p}.ot.startHours" value="${per.ot.startHours}">`)}
        ${field('Solde arrêté au soir du', `<input type="date" data-set="${p}.ot.startDate" value="${per.ot.startDate}">`)}</div>
        ${field('Heures par jour (conversion)', `<input type="number" inputmode="decimal" step="0.1" data-set="${p}.ot.hoursPerDay" value="${per.ot.hoursPerDay}">`)}</div>` : ''}
    </section>`;
  }
  const hist = SY.owner && SY.repo ? `https://github.com/${encodeURIComponent(SY.owner)}/${encodeURIComponent(SY.repo)}/commits/main/${SY.path.split('/').map(encodeURIComponent).join('/')}` : '';
  h += `<section class="card"><h2>Sauvegarde privée sur GitHub</h2>
    <p class="muted">Après chaque modification, les données sont envoyées dans votre repo privé. Chaque envoi devient une version dans l\u2019historique du repo. La clé reste sur ce téléphone et n\u2019est jamais exportée.</p>
    <div class="two">${field('Compte GitHub', `<input data-sync="owner" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="nom du compte" value="${esc(SY.owner)}">`)}
    ${field('Repo privé', `<input data-sync="repo" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(SY.repo)}">`)}</div>
    <div class="two">${field('Fichier', `<input data-sync="path" autocapitalize="off" autocorrect="off" spellcheck="false" value="${esc(SY.path)}">`)}
    ${field('Nom de cet appareil', `<input data-sync="device" placeholder="ex. mon téléphone" value="${esc(SY.device)}">`)}</div>
    ${field('Clé d\u2019accès (fine-grained token)', `<input type="password" data-sync="token" autocomplete="off" placeholder="github_pat_…" value="${esc(SY.token)}">`)}
    <p class="syncline" id="syncStatus">${syncText()}</p>
    <div class="btns"><button class="btn pri" data-act="sync">Synchroniser maintenant</button>
    ${hist ? `<a class="btn" href="${hist}" target="_blank" rel="noopener">Voir l\u2019historique</a>` : ''}
    ${SY.token ? '<button class="btn danger" data-act="forget">Retirer la clé</button>' : ''}</div></section>`;
  h += `<section class="card"><h2>Fichier de sauvegarde</h2>
    <p class="muted">Copie manuelle, en plus de GitHub : pour archiver un état précis ou repartir d\u2019un fichier. L\u2019import remplace tout.</p>
    <div class="btns"><button class="btn pri" data-act="export">Exporter la sauvegarde (JSON)</button>
    <button class="btn" data-act="import">Importer une sauvegarde</button>
    <button class="btn" data-act="csv">Exporter en CSV</button>
    <button class="btn danger" data-act="reset">Tout effacer</button></div>
    <p class="muted">Le report et le bloc de fin d\u2019année se règlent pour l\u2019année affichée en haut (${y}).</p></section>`;
  return h;
}
function setPath(path, value) {
  const keys = path.split('.'); let o = DB.persons;
  for (let i = 0; i < keys.length - 1; i++) { if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = value;
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
  const typeOpts = Object.entries(TYPES).filter(([k]) => otOn || (k !== 'otdone' && k !== 'otrecup'))
    .map(([k, l]) => `<option value="${k}"${k === e.type ? ' selected' : ''}>${l}</option>`).join('');
  const who = isEdit ? radios('f_who', [['a', nm('a')], ['b', nm('b')]], e.person)
    : radios('f_who', [['a', nm('a')], ['b', nm('b')], ['both', 'Les deux']], e.person);
  return `<div class="field"><span class="lbl">Pour qui</span>${who}</div>
    <div class="two">${field('Date', `<input type="date" name="f_date" value="${e.date}">`)}
    ${isEdit ? '' : field('Jusqu\u2019au (optionnel)', '<input type="date" name="f_end" value="">')}</div>
    ${field('Type', `<select name="f_type">${typeOpts}</select>`)}
    <div class="field" data-row="part"><span class="lbl">Durée</span>${radios('f_part', Object.entries(PARTS), e.part || 'full')}</div>
    ${field('Heures faites', `<input type="number" inputmode="decimal" step="0.25" name="f_hours" value="${e.hours || ''}">`, 'hide" data-row="hours')}
    ${field('Statut', `<select name="f_status">${isEdit ? '' : '<option value="auto">Auto : passé = pris, futur = prévu</option>'}
      <option value="pris"${isEdit && e.status === 'pris' ? ' selected' : ''}>Pris</option><option value="prevu"${isEdit && e.status === 'prevu' ? ' selected' : ''}>Prévu</option></select>`)}
    ${field('Note (optionnel)', `<input name="f_note" value="${esc(e.note || '')}">`)}
    <p class="muted hint">Sur une plage de dates, seuls les jours de travail de chacun sont décomptés.</p>`;
}
function openDay(s) {
  const idx = buildIdx(), hol = holidayName(s);
  const list = (idx[s] || []).map(e => `<div class="entry ${pc(e.person)}"><span class="dot"></span><div class="grow">${nm(e.person)} : ${TYPES[e.type]}, ${e.type === 'otdone' ? n(e.hours || 0) + ' h' : PARTS[e.part]} <span class="tag ${e.status}">${e.status === 'pris' ? 'Pris' : 'Prévu'}</span></div>
    <button class="iconbtn" data-act="edit" data-id="${e.id}" aria-label="Modifier">✎</button><button class="iconbtn" data-act="del" data-id="${e.id}" aria-label="Supprimer">✕</button></div>`).join('');
  showDialog(`<h2>${frDate(s)}</h2>${hol ? `<p class="holname">${esc(hol)}</p>` : ''}
    <p class="muted">${P.map(p => `${nm(p)} : ${dayStateText(p, s)}`).join('<br>')}</p>
    ${list ? `<div class="existing">${list}</div>` : ''}
    <h3>Nouvelle saisie</h3>${entryForm({ date: s, person: 'both', type: 'conge', part: 'full' }, false)}
    <div class="btns end"><button class="btn" data-act="close">Annuler</button><button class="btn pri" data-act="saveAdd">Enregistrer</button></div>`);
}
function openEdit(id) {
  const e = DB.entries.find(x => x.id === id); if (!e) return;
  showDialog(`<h2>Modifier la saisie</h2>${entryForm(e, true)}
    <div class="btns end"><button class="btn" data-act="close">Annuler</button><button class="btn pri" data-act="saveEdit" data-id="${id}">Enregistrer</button></div>`);
}
function showDialog(html) { $('dlgBody').innerHTML = html; syncForm(); const d = $('dlg'); if (!d.open) d.showModal(); }
function syncForm() {
  const t = document.querySelector('[name=f_type]'); if (!t) return;
  const ot = t.value === 'otdone';
  document.querySelector('[data-row=part]').classList.toggle('hide', ot);
  document.querySelector('[data-row=hours]').classList.toggle('hide', !ot);
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
  Object.assign(e, { person: f.who, date: f.date, type: f.type, part, status: f.status, u: Date.now() });
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
    e.type === 'otdone' ? '' : String(val(e)).replace('.', ','), e.hours != null ? String(e.hours).replace('.', ',') : '',
    e.status === 'pris' ? 'Pris' : 'Prévu', q(e.note)].join(';')));
  download(`conges-duo-${todayISO()}.csv`, '\ufeff' + lines.join('\r\n'), 'text/csv');
}
function importFile(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const obj = JSON.parse(rd.result);
      if (!obj || !obj.persons || !Array.isArray(obj.entries)) throw new Error('format');
      if (!confirm(`Importer ce fichier (${obj.entries.length} saisies) ? Les données actuelles seront remplacées, ici et sur GitHub si la synchro est active.`)) return;
      DB = migrate(obj); DB.su = Date.now(); SY.force = true; save(); render(); toast('Sauvegarde importée');
    } catch (err) { toast('Fichier non reconnu : choisissez une sauvegarde Congés Duo (.json).'); }
  };
  rd.readAsText(file);
}


/* ----- Synchronisation avec un repo GitHub privé ----- */
const SYNC_KEY = 'congesDuo.sync';
let SY = { owner: '', repo: 'conges-duo-data', path: 'donnees.json', token: '', device: '', lastSync: '', dirty: false, force: false, error: '' };
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
  const out = { version: 1, su: Math.max(L.su, R.su), persons: R.su > L.su ? R.persons : L.persons, entries: [], deleted: {} };
  for (const src of [L.deleted, R.deleted]) for (const id in src) out.deleted[id] = Math.max(out.deleted[id] || 0, +src[id] || 0);
  const map = {};
  for (const e of [...R.entries, ...L.entries]) { const cur = map[e.id]; if (!cur || (+e.u || 0) > (+cur.u || 0)) map[e.id] = e; }
  out.entries = Object.values(map).filter(e => !(out.deleted[e.id] >= (+e.u || 0)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.person.localeCompare(b.person) || a.id.localeCompare(b.id));
  return out;
}

function b64enc(str) { const bytes = new TextEncoder().encode(str); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin); }
function b64dec(b64) { const bin = atob(String(b64).replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }
const repoUrl = () => `/repos/${encodeURIComponent(SY.owner)}/${encodeURIComponent(SY.repo)}`;
const fileUrl = () => `${repoUrl()}/contents/${SY.path.split('/').map(encodeURIComponent).join('/')}`;
async function gh(method, url, body) {
  const res = await fetch('https://api.github.com' + url, {
    method, cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${SY.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
  const st = !syncOn() ? 'off' : syncState === 'busy' ? 'busy' : SY.error ? (syncState === 'offline' ? 'wait' : 'err') : SY.dirty ? 'wait' : 'ok';
  const dot = $('syncDot');
  if (dot) { dot.className = 'syncdot s-' + st; dot.title = syncText(); }
  const line = $('syncStatus');
  if (line) line.textContent = syncText();
}

/* ----- Événements ----- */
function onClick(ev) {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'tab') { S.view = b.dataset.v; render(); window.scrollTo(0, 0); }
  else if (a === 'year') { S.year += +b.dataset.d; render(); }
  else if (a === 'month') {
    S.calM += +b.dataset.d;
    if (S.calM < 1) { S.calM = 12; S.year--; } else if (S.calM > 12) { S.calM = 1; S.year++; }
    render();
  }
  else if (a === 'day') openDay(b.dataset.d);
  else if (a === 'add') openDay(S.view === 'cal' && S.year === new Date().getFullYear() && S.calM === new Date().getMonth() + 1 ? todayISO()
    : S.view === 'cal' ? iso(S.year, S.calM, 1) : todayISO());
  else if (a === 'edit') openEdit(b.dataset.id);
  else if (a === 'del') {
    const e = DB.entries.find(x => x.id === b.dataset.id); if (!e) return;
    if (!confirm(`Supprimer : ${DB.persons[e.person].name}, ${TYPES[e.type]} du ${frDate(e.date)} ?`)) return;
    DB.entries = DB.entries.filter(x => x.id !== e.id); DB.deleted[e.id] = Date.now(); save();
    if ($('dlg').open) openDay(e.date); render(); toast('Saisie supprimée');
  }
  else if (a === 'close') $('dlg').close();
  else if (a === 'saveAdd') saveAdd();
  else if (a === 'saveEdit') saveEdit(b.dataset.id);
  else if (a === 'plan') planOption(b.dataset.c, +b.dataset.i);
  else if (a === 'filter') { S.filter = b.dataset.v; render(); }
  else if (a === 'stale') {
    const t = todayISO(); let k = 0;
    DB.entries.forEach(e => { if (e.status === 'prevu' && e.date <= t) { e.status = 'pris'; e.u = Date.now(); k++; } });
    save(); render(); toast(`${k} saisie(s) passée(s) en « pris »`);
  }
  else if (a === 'export') { download(`conges-duo-${todayISO()}.json`, JSON.stringify(DB, null, 1), 'application/json'); toast('Sauvegarde exportée'); }
  else if (a === 'import') $('importFile').click();
  else if (a === 'csv') exportCSV();
  else if (a === 'sync') { if (syncOn()) syncNow(true); else { S.view = 'set'; render(); toast('Configurez la sauvegarde GitHub en bas des réglages.'); } }
  else if (a === 'forget') {
    if (!confirm('Retirer la clé GitHub de ce téléphone ? Les données restent ici et sur GitHub.')) return;
    SY.token = ''; SY.error = ''; saveSync(); render(); toast('Clé retirée de ce téléphone');
  }
  else if (a === 'reset') {
    if (confirm('Effacer toutes les données ? Si la synchro est active, la copie GitHub est aussi vidée (les anciennes versions restent dans l\u2019historique).') && confirm('Vraiment tout effacer ?')) {
      DB = defaultData(); DB.su = Date.now(); SY.force = true; save(); render(); toast('Données effacées');
    }
  }
}
function onChange(ev) {
  const t = ev.target;
  if (t.dataset.set) {
    let v;
    if (t.type === 'checkbox') v = t.checked;
    else if (t.type === 'number') v = parseFloat(String(t.value).replace(',', '.')) || 0;
    else v = t.value;
    setPath(t.dataset.set, v); DB.su = Date.now(); save();
    if (t.type === 'checkbox' || t.dataset.set.endsWith('.name')) render();
  } else if (t.dataset.rest) {
    const p = t.dataset.rest;
    DB.persons[p].rest = [...document.querySelectorAll(`[data-rest="${p}"]:checked`)].map(x => +x.value);
    DB.su = Date.now(); save();
  } else if (t.dataset.sync) {
    SY[t.dataset.sync] = t.value.trim(); SY.error = ''; saveSync(); setSyncState();
    if (syncOn() && (t.dataset.sync === 'token' || t.dataset.sync === 'repo' || t.dataset.sync === 'owner')) syncNow(true);
  } else if (t.id === 'importFile') {
    if (t.files[0]) importFile(t.files[0]); t.value = '';
  } else if (t.name === 'f_type') syncForm();
}
function init() {
  load();
  loadSync();
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  $('dlg').addEventListener('click', e => { if (e.target === $('dlg')) $('dlg').close(); });
  render();
  setSyncState(SY.dirty ? 'wait' : 'ok');
  scheduleSync(600);
  window.addEventListener('online', () => scheduleSync(300));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(300); });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mergeData, easter, holidays, counters, clusters, bridgeOptions, buildIdx, addEntries, otBalance, dayInfo, defaultData,
    getDB: () => DB, setDB: d => { DB = migrate(d); } };
}
if (typeof document !== 'undefined') init();

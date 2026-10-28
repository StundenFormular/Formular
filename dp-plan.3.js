'use strict';
/* Handy-Dienstplan für Chef und Gruppenleiter. Ein Code für beide Zugänge:
   - Chef: Link plan.html#CODE + Chef-Passwort (Rechte stellt der Admin in der Konsole ein)
   - Konto: plan.html mit Benutzername und Passwort oder Admin-PIN
   Alle Rechte werden im Server geprüft. Die Oberfläche blendet nur aus, was nicht erlaubt ist.
   Texte aus Daten werden nie als HTML eingesetzt. */
(function () {
  if (!window.DP) return;
  const H = DP.h;
  let root = null;
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const WDL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const S = { mode: 'konto', vt: '', session: '', me: null, month: '', today: '', data: null, ix: null, err: '', tab: 'today', day: '', place: '', q: '', dauer: 15, reqs: null, reqErr: '', gridMode: 'grid', gridDay: '', feed: null, feedErr: '', feedWho: '' };
  const GRANT_KEY = 'ansicht_chef_grant';
  const store = DP.sessionStore('plan_session');

  // ---------- kleine Helfer ----------
  const p2 = function (n) { return String(n).padStart(2, '0'); };
  const utc = function (iso) { return new Date(iso + 'T00:00:00Z'); };
  const isoOf = function (d) { return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()); };
  const addDays = function (iso, n) { return isoOf(new Date(utc(iso).getTime() + n * 86400000)); };
  const dow = function (iso) { return utc(iso).getUTCDay(); };
  const monIdx = function (iso) { return (dow(iso) + 6) % 7; };
  const monthLabel = function (m) { return MON[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4); };
  const monthAdd = function (m, n) { const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1)); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1); };
  const daysIn = function (m) { return new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate(); };
  const dm = function (iso) { return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.'; };
  const dmw = function (iso) { return WD[dow(iso)] + ' ' + dm(iso); };
  const fh = function (x) { return String(Math.round(x * 10) / 10).replace('.', ','); };
  const hmMin = function (t) { return +t.slice(0, 2) * 60 + +t.slice(3, 5); };
  const isNight = function (s) { const a = hmMin(s.start), b = hmMin(s.end); return b <= a || a >= 18 * 60; };
  const perm = function (k) { return !!(S.me && S.me.perms && S.me.perms[k]); };
  const initials = function (n) { return String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase() || '?'; };
  // Sichere Kinder-Helfer: die eingebauten append/replaceChildren machen aus Listen und null Text ("[object HTMLElement]", "null")
  function kidsOf(a, out) { (Array.isArray(a) ? a : [a]).forEach(function (x) { if (Array.isArray(x)) kidsOf(x, out); else if (x !== null && x !== undefined && x !== false) out.push(x); }); return out; }
  function setKids(el) { el.replaceChildren.apply(el, kidsOf(Array.prototype.slice.call(arguments, 1), [])); }
  function add(el) { el.append.apply(el, kidsOf(Array.prototype.slice.call(arguments, 1), [])); }
  const chip = function (t, cls) { return H('span', { class: 'pl-chip' + (cls ? ' ' + cls : ''), text: t }); };
  const when = function (ts) { if (!ts) return ''; const d = new Date(ts); return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '. ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const nameOf = function (pin) { return (S.ix && S.ix.names[pin]) || (pin === '00' ? 'Offene Schicht' : 'PIN ' + pin); };
  function canAddAt(place) { return perm('p_add') && (!S.me.scope.places || !place || S.me.scope.places.indexOf(place) !== -1); }
  function myPlaces() { const all = S.data ? S.data.places : []; return S.me.scope.places ? all.filter(function (p) { return S.me.scope.places.indexOf(p) !== -1; }) : all; }
  function svgArrow(d) {
    const NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '20'); s.setAttribute('height', '20'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2.6'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); p.setAttribute('d', d); s.append(p); return s;
  }
  let toastEl = null, toastTimer = 0;
  function toast(msg, kind) {
    if (toastEl) toastEl.remove();
    toastEl = H('div', { class: 'pl-toast' + (kind === 'error' ? ' error' : ''), role: 'status', text: msg });
    document.body.append(toastEl); clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { if (toastEl) { toastEl.remove(); toastEl = null; } }, 3800);
  }

  // ---------- Server ----------
  function getGrant() { try { return sessionStorage.getItem(GRANT_KEY) || ''; } catch (e) { return ''; } }
  function setGrant(g) { try { if (g) sessionStorage.setItem(GRANT_KEY, g); else sessionStorage.removeItem(GRANT_KEY); } catch (e) { /* gesperrt */ } }
  async function call(action, payload) {
    const body = Object.assign({}, payload || {});
    if (S.mode === 'chef') { body.vt = S.vt; body.grant = getGrant(); } else { body.adminSession = S.session; }
    const r = await DP.api(action, body);
    if (r && r.code === 'PLAN_LOCKED') { S.me = null; S.data = null; if (root) showMessage('Dienstplan gesperrt', r.message || 'Der Dienstplan ist zurzeit gesperrt. Bitte wende dich an den Admin.', false); return r; }
    if (r && (r.code === 'ADMIN_AUTH' || r.code === 'VIEW_CHEF_AUTH')) {
      if (S.mode === 'chef') setGrant(''); else { store.clear(); S.session = ''; }
      S.me = null; showLogin(r.message);
    }
    return r;
  }

  // ---------- Sheets (die Zurück-Taste schließt sie) ----------
  const stack = [];
  let ignorePop = 0, waiters = [];
  function idle() { return ignorePop ? new Promise(function (res) { waiters.push(res); }) : Promise.resolve(); }
  function openSheet(title, body, opts) {
    if (ignorePop) { idle().then(function () { openSheet(title, body, opts); }); return null; }   // erst nach dem Ende eines programmgesteuerten „Zurück“
    const ov = H('div', { class: 'pl-ov' });
    const sheet = H('div', { class: 'pl-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      H('div', { class: 'pl-sh' }, H('b', { text: title }), H('button', { class: 'pl-ib', type: 'button', 'aria-label': 'Schließen', text: '✕', onclick: function () { closeSheet(); } })),
      H('div', { class: 'pl-sb' }, body));
    ov.append(sheet);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeSheet(); });
    document.body.append(ov); document.body.classList.add('sheet-open');
    const entry = { el: ov, onClose: opts && opts.onClose, nohist: false };
    stack.push(entry);
    try { history.pushState({ ub: 'plan', plSheet: stack.length }, '', location.href); } catch (e) { entry.nohist = true; }
    return entry;
  }
  function removeTop() { const e = stack.pop(); if (!e) return; e.el.remove(); document.body.classList.toggle('sheet-open', stack.length > 0); if (e.onClose) e.onClose(); }
  function closeSheet() { const t = stack[stack.length - 1]; if (!t) return; removeTop(); if (!t.nohist) { ignorePop++; try { history.back(); } catch (e) { ignorePop--; } } }
  function closeAll() {
    const n = stack.filter(function (e) { return !e.nohist; }).length;
    while (stack.length) removeTop();
    if (n) { ignorePop++; try { history.go(-n); } catch (e) { ignorePop--; } }
    return idle();
  }
  window.addEventListener('popstate', function () {
    if (ignorePop) { ignorePop--; if (!ignorePop) { const w = waiters; waiters = []; w.forEach(function (f) { f(); }); } return; }
    if (stack.length) removeTop();
  });
  function confirmSheet(title, intro, lines, okLabel, danger) {
    return new Promise(function (resolve) {
      let done = false;
      const body = H('div', {}, intro ? H('p', { class: 'pl-hint', text: intro }) : null,
        lines && lines.length ? H('div', { class: 'pl-msg warn' }, H('ul', {}, lines.map(function (l) { return H('li', { text: l }); }))) : null,
        H('div', { class: 'pl-btns' },
          H('button', { class: 'pl-btn' + (danger ? ' danger' : ''), type: 'button', text: okLabel || 'Ja', onclick: function () { done = true; resolve(true); closeSheet(); } }),
          H('button', { class: 'pl-btn ghost', type: 'button', text: 'Abbrechen', onclick: function () { closeSheet(); } })));
      openSheet(title, body, { onClose: function () { if (!done) resolve(false); } });
    });
  }

  // ---------- Daten ----------
  function buildIx(d) {
    const ix = { byDate: {}, byPin: {}, names: { '00': 'Offene Schicht' }, abs: {}, un: {}, gaps: {} };
    d.employees.forEach(function (e) { ix.names[e.pin] = e.name; });
    d.shifts.forEach(function (s) { (ix.byDate[s.date] = ix.byDate[s.date] || []).push(s); (ix.byPin[s.pin] = ix.byPin[s.pin] || []).push(s); });
    Object.keys(ix.byDate).forEach(function (k) { ix.byDate[k].sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; }); });
    const spread = function (list, target) {
      list.forEach(function (q) {
        let t = q.from, g = 0;
        while (t <= q.to && g++ < 400) { if (t.slice(0, 7) === d.month) target[q.pin + '|' + t] = q.type; t = addDays(t, 1); }
      });
    };
    spread(d.absences || [], ix.abs); spread(d.unavail || [], ix.un);
    (d.gaps || []).forEach(function (g) { (ix.gaps[g.date] = ix.gaps[g.date] || []).push(g); });
    return ix;
  }
  function pickPlace() {
    const d = S.data, cnt = {};
    d.shifts.forEach(function (s) { cnt[s.place] = (cnt[s.place] || 0) + 1; });
    const list = myPlaces().length ? myPlaces() : d.places;
    return list.slice().sort(function (a, b) { return (cnt[b] || 0) - (cnt[a] || 0); })[0] || '';
  }
  async function loadMonth() {
    const r = await call('planMonth', { month: S.month });
    if (r.status !== 'success') {
      if (r.code !== 'ADMIN_AUTH' && r.code !== 'VIEW_CHEF_AUTH') { S.data = null; S.ix = null; S.err = r.message || 'Der Dienstplan konnte nicht geladen werden.'; render(); }
      return r;
    }
    S.err = ''; S.data = r; S.ix = buildIx(r); S.me = r.me; S.centerStrip = S.centerStrip || S.lastMonth !== S.month; S.lastMonth = S.month;
    if (!S.day || S.day.slice(0, 7) !== S.month) S.day = S.today.slice(0, 7) === S.month ? S.today : S.month + '-01';
    if (!S.place || r.places.indexOf(S.place) === -1 || !r.shifts.some(function (x) { return x.place === S.place; })) S.place = pickPlace() || S.place;
    render();
    return r;
  }
  async function reload(msg) { S.feed = null; await closeAll(); await loadMonth(); if (S.tab === 'reqs') await loadReqs(); if (msg) toast(msg); }

  // ---------- Anmeldung ----------
  function field(label, input) { return H('div', { class: 'pl-field' }, H('label', { text: label }), input); }
  function showLogin(msg) {
    closeAll();
    const err = H('div', { class: 'pl-msg', text: msg || '' }); if (!msg) err.style.display = 'none';
    const fail = function (t) { err.textContent = t; err.style.display = 'block'; };
    let box;
    if (S.mode === 'chef') {
      const pw = H('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Chef-Passwort' });
      const go = H('button', { class: 'pl-btn', type: 'button', text: 'Öffnen' });
      const submit = async function () {
        if (!pw.value) return; go.disabled = true;
        const r = await DP.api('viewChefUnlock', { vt: S.vt, password: pw.value }); go.disabled = false;
        if (r.status === 'success') { setGrant(r.grant); start(); } else fail(r.message || 'Das hat nicht geklappt.');
      };
      go.addEventListener('click', submit); pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
      box = H('div', { class: 'pl-login' }, H('h1', { text: 'Dienstplan' }), H('p', { text: 'Bitte gib das Chef-Passwort ein.' }), err, field('Passwort', pw), H('div', { class: 'pl-btns' }, go));
    } else {
      let pinMode = false;
      const form = H('div', {});
      const draw = function () {
        const user = H('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Benutzername' });
        const pw = H('input', { type: pinMode ? 'password' : 'password', autocomplete: pinMode ? 'off' : 'current-password', 'aria-label': pinMode ? 'Admin-PIN' : 'Passwort' });
        const go = H('button', { class: 'pl-btn', type: 'button', text: 'Anmelden' });
        const toggle = H('button', { class: 'pl-btn ghost', type: 'button', text: pinMode ? 'Mit Benutzername anmelden' : 'Mit Admin-PIN anmelden', onclick: function () { pinMode = !pinMode; draw(); } });
        const submit = async function () {
          if (!pw.value || (!pinMode && !user.value)) return; go.disabled = true;
          const r = pinMode ? await DP.api('adminLogin', { pin: pw.value.trim() }) : await DP.api('accLogin', { username: user.value.trim(), password: pw.value, console: true });
          go.disabled = false;
          if (r.status === 'success' && r.session) {
            if (r.mustChange) { fail('Bitte ändere zuerst in der Admin-Konsole dein Passwort. Danach kannst du dich hier anmelden.'); return; }
            S.session = r.session; store.save(r.session, r.expires, false); start();
          } else fail(r.message || 'Anmeldung fehlgeschlagen.');
        };
        go.addEventListener('click', submit); pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
        setKids(form, pinMode ? null : field('Benutzername', user), field(pinMode ? 'Admin-PIN' : 'Passwort', pw), H('div', { class: 'pl-btns' }, go, toggle));
      };
      draw();
      box = H('div', { class: 'pl-login' }, H('h1', { text: 'Dienstplan' }), H('p', { text: 'Melde dich mit deinem Admin-Konto an.' }), err, form);
    }
    if (root) setKids(root, box);
  }
  function showMessage(title, text, withLogout) {
    if (root) setKids(root, H('div', { class: 'pl-login' }, H('h1', { text: title }), H('p', { text: text }),
      withLogout ? H('div', { class: 'pl-btns' }, H('button', { class: 'pl-btn ghost', type: 'button', text: 'Abmelden', onclick: logout })) : null));
  }
  function logout() { if (S.mode === 'chef') setGrant(''); else { store.clear(); S.session = ''; } S.me = null; S.data = null; showLogin(''); }

  // ---------- Kopf, Tabs, Hinweise ----------
  function tabList() {
    const t = [];
    if (perm('v_plan')) { t.push(['today', 'Heute'], ['grid', 'Standorte'], ['people', 'Mitarbeiter']); if (perm('v_longterm')) t.push(['long', 'Dauerplätze']); if (perm('v_gaps')) t.push(['gaps', 'Lücken']); }
    if (perm('v_requests')) t.push(['reqs', 'Anträge']);
    if (perm('v_log')) t.push(['feed', 'Verlauf']);
    return t;
  }
  function openCount() { return S.data ? S.data.shifts.filter(function (s) { return s.pin === '00'; }).length : 0; }
  function header(tabs) {
    const d = S.data, mo = H('select', { 'aria-label': 'Monat wählen' });
    const base = S.today.slice(0, 7), opts = [];
    for (let i = -12; i <= 12; i++) opts.push(monthAdd(base, i));
    if (opts.indexOf(S.month) === -1) opts.push(S.month);
    opts.sort().forEach(function (m) { const o = H('option', { text: monthLabel(m) }); o.value = m; add(mo, o); });
    mo.value = S.month; mo.addEventListener('change', function () { S.month = mo.value; S.day = ''; loadMonth(); });
    const step = function (n) { S.month = monthAdd(S.month, n); S.day = ''; loadMonth(); };
    const badge = function (k) { const n = k === 'gaps' ? (d ? (d.gaps || []).length + openCount() : 0) : k === 'reqs' ? (d && d.pending) || 0 : 0; return n ? H('em', { text: String(n) }) : null; };
    return H('header', { class: 'pl-head' },
      H('div', { class: 'pl-top' }, H('div', { class: 'pl-title' }, H('b', { text: 'Dienstplan' }), H('span', { text: S.me ? S.me.label : '' })),
        H('button', { class: 'pl-ib', type: 'button', 'aria-label': 'Menü', text: '⋯', style: 'font-size:26px', onclick: openMenu })),
      H('div', { class: 'pl-month' }, H('button', { class: 'pl-arr', type: 'button', 'aria-label': 'Vorheriger Monat', onclick: function () { step(-1); } }, svgArrow('M14.5 6l-6 6 6 6')),
        H('div', { class: 'pl-mname' }, H('b', { text: monthLabel(S.month) }), H('span', { text: d ? d.shifts.length + ' Schichten' + (perm('v_drafts') && d.drafts ? ' · ' + d.drafts + ' Entwürfe' : '') : '…' }), mo),
        H('button', { class: 'pl-arr', type: 'button', 'aria-label': 'Nächster Monat', onclick: function () { step(1); } }, svgArrow('M9.5 6l6 6-6 6'))),
      H('nav', { class: 'pl-tabs', role: 'tablist' }, tabs.map(function (t) {
        return H('button', { class: 'pl-tab' + (S.tab === t[0] ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': S.tab === t[0] ? 'true' : 'false', onclick: function () { S.tab = t[0]; if (t[0] === 'reqs') loadReqs(); render(); window.scrollTo(0, 0); } }, t[1], badge(t[0]));
      })));
  }
  function banners(main) {
    const me = S.me, d = S.data;
    if (me.killed) add(main, H('div', { class: 'pl-banner bad' }, H('span', { text: 'Der Notaus ist aktiv. Änderungen sind zurzeit gesperrt, Ansehen geht weiter.' })));
    else if (me.expired) add(main, H('div', { class: 'pl-banner bad' }, H('span', { text: 'Deine Berechtigung ist am ' + dm(me.scope.expires) + me.scope.expires.slice(0, 4) + ' abgelaufen. Du kannst nur noch ansehen.' })));
    else if (me.scope && me.scope.places && (perm('p_add') || perm('p_bulk'))) add(main, H('div', { class: 'pl-banner info' }, H('span', { text: 'Planen darfst du nur an: ' + me.scope.places.join(', ') + '.' })));
    if (me.planApp === false && (perm('r_create') || perm('p_add') || perm('r_decide'))) add(main, H('div', { class: 'pl-banner info' }, H('span', { text: 'Mein Dienstplan ist für die Mitarbeiter ausgeschaltet. Sie sehen ihren Plan nicht und können sich nicht selbst abmelden. Meldungen trägst du über „Meldung eintragen“ ein.' })));
    if (d && perm('v_drafts') && d.drafts) add(main, H('div', { class: 'pl-banner' }, H('span', { text: d.drafts + (d.drafts === 1 ? ' Schicht ist' : ' Schichten sind') + ' noch ein Entwurf (Mitarbeiter sehen sie nicht).' }), perm('p_publish') ? H('button', { type: 'button', text: 'Veröffentlichen', onclick: openPublish }) : null));
  }
  function fab() {
    if (!(perm('p_add') || perm('p_bulk') || perm('r_create') || perm('p_reset'))) return null;
    return H('button', { class: 'pl-fab', type: 'button', 'aria-label': 'Planen', text: '+', onclick: openAddMenu });
  }
  function render() {
    if (!root || !S.me) return;
    const gw = root.querySelector('.pl-gridwrap'), ds = root.querySelector('.pl-days');
    const sx = gw ? [gw.scrollLeft, gw.scrollTop] : null, dsx = ds ? ds.scrollLeft : null, wy = window.scrollY;
    const tabs = tabList();
    if (!tabs.length) { showMessage('Kein Zugriff', 'Für diesen Zugang sind noch keine Rechte eingestellt. Bitte den Admin fragen.', true); return; }
    if (!tabs.some(function (t) { return t[0] === S.tab; })) S.tab = tabs[0][0];
    const main = H('main', { class: 'pl-main' });
    banners(main);
    if (S.err) add(main, H('div', { class: 'pl-msg', text: S.err }));
    else if (!S.data) add(main, H('div', { class: 'pl-boot', text: 'Wird geladen …' }));
    else add(main, (VIEWS[S.tab] || VIEWS.today)());
    setKids(root, header(tabs), main, fab());
    const g2 = root.querySelector('.pl-gridwrap'), d2 = root.querySelector('.pl-days');
    if (g2 && sx) { g2.scrollLeft = sx[0]; g2.scrollTop = sx[1]; }
    if (d2) { if (dsx !== null && !S.centerStrip) d2.scrollLeft = dsx; else { const on = d2.querySelector('.on'); if (on) d2.scrollLeft = Math.max(0, on.offsetLeft - 120); } S.centerStrip = false; }
    window.scrollTo(0, wy);
  }

  // ---------- Ansicht: Heute ----------
  function avatar(nm, night, open) { return H('div', { class: 'pl-av' + (open ? ' open' : night ? '' : ' day'), text: open ? '!' : initials(nm) }); }
  function shiftRow(s) {
    const open = s.pin === '00', abs = S.ix.abs[s.pin + '|' + s.date], nm = nameOf(s.pin);
    return H('button', { class: 'pl-row', type: 'button', onclick: function () { openShift(s); } }, avatar(nm, isNight(s), open),
      H('div', { class: 'pl-rt' }, H('b', { text: nm }), H('span', { text: s.start + '–' + s.end + ' · ' + fh(s.hours) + ' Std' }),
        s.note ? H('div', { class: 'pl-note', text: s.note }) : null, s.byLabel ? H('em', { text: 'eingetragen von ' + s.byLabel }) : null),
      H('div', {}, s.status === 'entwurf' ? chip('Entwurf', 'draft') : null, open ? chip('Offen', 'open') : null, abs ? chip(abs === 'krank' ? 'Krank' : 'Urlaub', abs) : null));
  }
  function dayStrip() {
    const m = S.month, n = daysIn(m), strip = H('div', { class: 'pl-days' });
    for (let i = 1; i <= n; i++) {
      const iso = m + '-' + p2(i), w = dow(iso), gaps = S.ix.gaps[iso], draft = (S.ix.byDate[iso] || []).some(function (s) { return s.status === 'entwurf'; });
      add(strip, H('button', { class: 'pl-dc' + (w === 0 || w === 6 ? ' we' : '') + (iso === S.today ? ' today' : '') + (iso === S.day ? ' on' : '') + (draft && !gaps ? ' draft' : ''), type: 'button', 'data-day': iso,
        onclick: function () { S.day = iso; render(); } }, H('small', { text: WD[w] }), H('b', { text: String(i) }), gaps || draft ? H('i') : null));
    }
    return strip;
  }
  function placeCard(p, day, list, need) {
    const have = list.filter(function (s) { return s.pin !== '00' && !S.ix.abs[s.pin + '|' + day]; }).length;
    const cnt = need ? H('span', { class: 'pl-cnt' + (have < need ? ' low' : ''), text: have + ' von ' + need }) : H('span', { class: 'pl-cnt na', text: String(list.length) });
    return H('section', { class: 'pl-card' },
      H('div', { class: 'pl-ch' }, H('div', {}, H('b', { text: p + ' ' }), cnt), canAddAt(p) ? H('button', { class: 'pl-add', type: 'button', text: '+ Schicht', onclick: function () { openEditor({ date: day, place: p }); } }) : null),
      list.length ? list.map(shiftRow) : H('div', { class: 'pl-empty', text: 'Niemand eingeplant.' }));
  }
  function absenceLine(day) {
    const d = S.data, parts = [], by = { krank: [], urlaub: [], un: [] };
    (d.absences || []).forEach(function (q) { if (q.from <= day && day <= q.to && by[q.type]) by[q.type].push(nameOf(q.pin)); });
    (d.unavail || []).forEach(function (q) { if (q.from <= day && day <= q.to) by.un.push(nameOf(q.pin)); });
    [['krank', 'Krank'], ['urlaub', 'Urlaub'], ['un', 'Nicht verfügbar']].forEach(function (x) { if (by[x[0]].length) parts.push(H('div', {}, H('b', { text: x[1] + ': ' }), by[x[0]].join(', '))); });
    return parts.length ? H('div', { class: 'pl-card' }, H('div', { class: 'pl-abs' }, parts)) : null;
  }
  function viewToday() {
    const d = S.data, day = S.day, wrap = H('div', {}), wdi = monIdx(day), list = S.ix.byDate[day] || [];
    add(wrap, dayStrip());
    add(wrap, H('div', { class: 'pl-h2', text: WDL[dow(day)] + ', ' + dm(day) + day.slice(0, 4) }));
    const places = d.places.filter(function (p) { return list.some(function (s) { return s.place === p; }) || (d.coverage[p] && d.coverage[p][wdi]) || (canAddAt(p) && false); });
    places.forEach(function (p) { add(wrap, placeCard(p, day, list.filter(function (s) { return s.place === p; }), d.coverage[p] ? d.coverage[p][wdi] : 0)); });
    if (!places.length) add(wrap, H('div', { class: 'pl-card' }, H('div', { class: 'pl-empty', text: 'Für diesen Tag ist nichts geplant.' })));
    const ab = absenceLine(day); if (ab) add(wrap, ab);
    return wrap;
  }

  // ---------- Ansicht: Standorte (Raster und Tage) ----------
  function timeCell(sh, onclick) {
    return H('button', { class: 'pl-cell ' + (isNight(sh) ? 'night' : 'day') + (sh.status === 'entwurf' ? ' draft' : ''), type: 'button', title: sh.start + '–' + sh.end, onclick: onclick },
      H('span', { class: 't1', text: sh.start }), H('span', { class: 't2', text: sh.end }));
  }
  function viewGrid() {
    const d = S.data, ix = S.ix, m = S.month, n = daysIn(m), wrap = H('div', {});
    add(wrap, H('div', { class: 'pl-chips' }, d.places.map(function (p) { return H('button', { class: 'pl-pill' + (p === S.place ? ' on' : ''), type: 'button', text: p, onclick: function () { S.place = p; render(); } }); })));
    const here = d.shifts.filter(function (x) { return x.place === S.place; }), need = d.coverage[S.place];
    const people = Object.keys(here.reduce(function (o, x) { if (x.pin !== '00') o[x.pin] = 1; return o; }, {})).length;
    add(wrap, H('div', { class: 'pl-card' }, H('div', { class: 'pl-ch' }, H('div', {}, H('b', { text: S.place })), H('div', { class: 'pl-sum', text: here.length + ' Schichten · ' + people + ' Mitarbeiter' })),
      H('div', { class: 'pl-seg' }, [['grid', 'Raster'], ['days', 'Tage']].map(function (x) { return H('button', { class: S.gridMode === x[0] ? 'on' : '', type: 'button', text: x[1], onclick: function () { S.gridMode = x[0]; render(); } }); }))));
    if (S.gridMode === 'days') { add(wrap, daysList(here, need)); return wrap; }
    if (!S.gridDay || S.gridDay.slice(0, 7) !== m) S.gridDay = S.day && S.day.slice(0, 7) === m ? S.day : m + '-01';
    const cell = {}, pins = [], seen = {};
    here.forEach(function (x) { cell[x.pin + '|' + x.date] = x; if (!seen[x.pin]) { seen[x.pin] = true; pins.push(x.pin); } });
    pins.sort(function (a, b) { return (a === '00') - (b === '00') || nameOf(a).localeCompare(nameOf(b), 'de'); });
    const head = H('tr', {}, H('th', { class: 'nm', text: 'Name' })), cnt = H('tr', { class: 'cnt' }, H('td', { class: 'nm', text: 'Besetzt' }));
    for (let i = 1; i <= n; i++) {
      const iso = m + '-' + p2(i), w = dow(iso);
      head.append(H('th', { class: (w === 0 || w === 6 ? 'we ' : '') + (iso === S.today ? 'today ' : '') + (iso === S.gridDay ? 'sel' : '') },
        H('button', { class: 'pl-dh', type: 'button', 'aria-label': WDL[w] + ' ' + dm(iso), onclick: function () { S.gridDay = iso; render(); } }, H('span', { text: WD[w] }), H('b', { text: String(i) }))));
      const have = here.filter(function (x) { return x.date === iso && x.pin !== '00' && !ix.abs[x.pin + '|' + iso]; }).length, want = need ? need[monIdx(iso)] : 0;
      cnt.append(H('td', { class: (want && have < want ? 'low ' : '') + (iso === S.gridDay ? 'sel' : ''), text: have || want ? String(have) : '' }));
    }
    const body = H('tbody', {}, cnt);
    pins.forEach(function (pin) {
      const tr = H('tr', {}, H('td', { class: 'nm', text: nameOf(pin) }));
      for (let i = 1; i <= n; i++) {
        const iso = m + '-' + p2(i), x = cell[pin + '|' + iso], a = ix.abs[pin + '|' + iso], u = ix.un[pin + '|' + iso];
        const other = !x && (ix.byPin[pin] || []).filter(function (y) { return y.date === iso && y.place !== S.place; })[0];
        let b;
        if (x) b = timeCell(x, function () { openShift(x); });
        else if (a) b = H('button', { class: 'pl-cell ' + a, type: 'button', text: a === 'krank' ? 'Krank' : 'Urlaub' });
        else if (other) b = H('button', { class: 'pl-cell other', type: 'button', title: 'Schicht an ' + other.place, onclick: function () { openShift(other); } }, H('span', { class: 't1', text: 'woanders' }));
        else if (u) b = H('button', { class: 'pl-cell un', type: 'button', text: 'nicht verf.' });
        else b = H('button', { class: 'pl-cell', type: 'button', 'aria-label': 'Frei am ' + dm(iso), onclick: canAddAt(S.place) ? function () { openEditor({ date: iso, place: S.place, pin: pin === '00' ? '' : pin }); } : null });
        tr.append(H('td', { class: iso === S.gridDay ? 'sel' : '' }, b));
      }
      body.append(tr);
    });
    add(wrap, H('div', { class: 'pl-gridwrap' }, H('table', { class: 'pl-grid' }, H('thead', {}, head), body)));
    if (!pins.length) add(wrap, H('div', { class: 'pl-empty', text: 'In diesem Monat ist niemand für ' + S.place + ' eingeplant.' }));
    add(wrap, H('div', { class: 'pl-legend' }, H('span', { text: 'In jedem Feld steht oben der Beginn und unten das Ende der Schicht.' }), H('span', {}, H('i', { style: 'background:#E9E8F8' }), 'Nacht'), H('span', {}, H('i', { style: 'background:#FFF1D6' }), 'Tag'), H('span', {}, H('i', { style: 'background:#fff;border:2px dashed #E8A33D' }), 'Entwurf')));
    add(wrap, H('div', { class: 'pl-h2', text: WDL[dow(S.gridDay)] + ', ' + dm(S.gridDay) + S.gridDay.slice(0, 4) + ' (Datum oben im Raster antippen)' }));
    add(wrap, placeCard(S.place, S.gridDay, (ix.byDate[S.gridDay] || []).filter(function (x) { return x.place === S.place; }), need ? need[monIdx(S.gridDay)] : 0));
    if (canAddAt(S.place)) add(wrap, H('div', { class: 'pl-btns' }, H('button', { class: 'pl-btn ghost', type: 'button', text: '+ Mitarbeiter für ' + S.place + ' eintragen', onclick: function () { openEditor({ place: S.place }); } })));
    return wrap;
  }
  function daysList(here, need) {
    const ix = S.ix, m = S.month, n = daysIn(m), card = H('div', { class: 'pl-card' });
    for (let i = 1; i <= n; i++) {
      const iso = m + '-' + p2(i), w = dow(iso), list = here.filter(function (x) { return x.date === iso; }).sort(function (a, b) { return a.start < b.start ? -1 : 1; });
      const want = need ? need[monIdx(iso)] : 0, have = list.filter(function (x) { return x.pin !== '00' && !ix.abs[x.pin + '|' + iso]; }).length;
      add(card, H('div', { class: 'pl-dr' + (iso === S.today ? ' today' : '') },
        H('div', { class: 'dd' + (w === 0 || w === 6 ? ' we' : '') }, H('small', { text: WD[w] }), H('b', { text: String(i) })),
        H('div', { class: 'dn' },
          want ? H('span', { class: 'pl-cnt' + (have < want ? ' low' : ''), text: have + ' von ' + want }) : null,
          list.length ? list.map(function (x) {
            const open = x.pin === '00', ab = ix.abs[x.pin + '|' + iso];
            return H('button', { class: 'pl-pp ' + (open ? 'open' : isNight(x) ? 'night' : 'day') + (x.status === 'entwurf' ? ' draft' : ''), type: 'button', onclick: function () { openShift(x); } },
              H('b', { text: (open ? 'Offen' : nameOf(x.pin)) + (ab ? ' (' + (ab === 'krank' ? 'krank' : 'Urlaub') + ')' : '') }), H('span', { text: x.start + '–' + x.end }));
          }) : H('span', { class: 'pl-none', text: want ? 'Niemand eingeplant' : 'keine Schicht' }),
          canAddAt(S.place) ? H('button', { class: 'pl-plus', type: 'button', 'aria-label': 'Schicht hinzufügen am ' + dm(iso), text: '+', onclick: function () { openEditor({ date: iso, place: S.place }); } }) : null)));
    }
    return card;
  }

  const VIEWS = { today: viewToday, grid: viewGrid };

  // ---------- Ansicht: Mitarbeiter ----------
  function personStats(pin) {
    const l = S.ix.byPin[pin] || [], pl = {};
    l.forEach(function (s) { pl[s.place] = (pl[s.place] || 0) + 1; });
    return { n: l.length, hours: l.reduce(function (a, s) { return a + s.hours; }, 0), pl: pl, days: Object.keys(l.reduce(function (m, s) { m[s.date] = 1; return m; }, {})).length };
  }
  VIEWS.people = function () {
    const wrap = H('div', {});
    const list = H('div', { class: 'pl-card' });
    const fill = function () {
      const q = S.q.trim().toLowerCase(), rows = S.data.employees.filter(function (e) { return !q || e.name.toLowerCase().indexOf(q) !== -1; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
      setKids(list);
      if (!rows.length) { add(list, H('div', { class: 'pl-empty', text: 'Niemand gefunden.' })); return; }
      rows.forEach(function (e) {
        const st = personStats(e.pin), ab = Object.keys(S.ix.abs).filter(function (k) { return k.indexOf(e.pin + '|') === 0; }).length;
        add(list, H('button', { class: 'pl-row', type: 'button', onclick: function () { openPerson(e.pin); } }, avatar(e.name, true, false),
          H('div', { class: 'pl-rt' }, H('b', { text: e.name }), H('span', { text: st.n ? st.n + ' Schichten · ' + fh(st.hours) + ' Std' : 'Keine Schichten in diesem Monat' + (ab ? ' · ' + ab + ' Tage abwesend' : '') })),
          H('div', {}, Object.keys(st.pl).sort().slice(0, 2).map(function (p) { return chip(p + ' ' + st.pl[p]); }))));
      });
    };
    const q = H('input', { class: 'pl-search', type: 'search', placeholder: 'Mitarbeiter suchen', 'aria-label': 'Mitarbeiter suchen', value: S.q });
    q.addEventListener('input', function () { S.q = q.value; fill(); });
    add(wrap, q, list); fill();
    return wrap;
  };

  // ---------- Ansicht: Dauerplätze ----------
  VIEWS.long = function () {
    const n = daysIn(S.month), wrap = H('div', {}), groups = {};
    add(wrap, H('div', { class: 'pl-chips' }, [[15, 'Ab 15 Tagen'], [-1, 'Jeden Tag']].map(function (x) { return H('button', { class: 'pl-pill' + (S.dauer === x[0] ? ' on' : ''), type: 'button', text: x[1], onclick: function () { S.dauer = x[0]; render(); } }); })));
    Object.keys(S.ix.byPin).forEach(function (pin) {
      if (pin === '00') return;
      const l = S.ix.byPin[pin], places = Object.keys(l.reduce(function (m, s) { m[s.place] = 1; return m; }, {}));
      if (places.length !== 1) return;
      const st = personStats(pin), absent = Object.keys(S.ix.abs).filter(function (k) { return k.indexOf(pin + '|') === 0; }).length, need = S.dauer === -1 ? Math.max(1, n - absent) : S.dauer;
      if (st.days < need) return;
      (groups[places[0]] = groups[places[0]] || []).push({ pin: pin, days: st.days, hours: st.hours, full: st.days >= n - absent });
    });
    const keys = Object.keys(groups).sort();
    keys.forEach(function (p) {
      const list = groups[p].sort(function (a, b) { return b.days - a.days || nameOf(a.pin).localeCompare(nameOf(b.pin), 'de'); });
      add(wrap, H('section', { class: 'pl-card' }, H('div', { class: 'pl-ch' }, H('div', {}, H('b', { text: p + ' ' }), H('span', { class: 'pl-cnt na', text: String(list.length) }))),
        list.map(function (x) {
          return H('button', { class: 'pl-row', type: 'button', onclick: function () { openPerson(x.pin); } }, avatar(nameOf(x.pin), true, false),
            H('div', { class: 'pl-rt' }, H('b', { text: nameOf(x.pin) }), H('span', { text: x.days + ' von ' + n + ' Tagen · ' + fh(x.hours) + ' Std' })), x.full ? chip('Ganzer Monat', 'ok') : null);
        })));
    });
    if (!keys.length) add(wrap, H('div', { class: 'pl-card' }, H('div', { class: 'pl-empty', text: S.dauer === -1 ? 'Niemand ist in diesem Monat an jedem Tag am selben Standort eingeplant.' : 'Niemand ist in diesem Monat durchgängig an einem einzigen Standort eingeplant.' })));
    add(wrap, H('p', { class: 'pl-hint', text: 'Gezählt werden Mitarbeiter, deren Schichten in diesem Monat alle am selben Standort liegen. Krank- und Urlaubstage zählen bei „Jeden Tag“ nicht als Lücke.' }));
    return wrap;
  };

  // ---------- Ansicht: Lücken ----------
  VIEWS.gaps = function () {
    const d = S.data, wrap = H('div', {});
    const open = d.shifts.filter(function (s) { return s.pin === '00'; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.start < b.start ? -1 : 1; });
    add(wrap, H('div', { class: 'pl-h2', text: 'Offene Schichten' + (open.length ? ' (' + open.length + ')' : '') }));
    add(wrap, H('div', { class: 'pl-card' }, open.length ? open.map(function (s) { return H('button', { class: 'pl-row', type: 'button', onclick: function () { openShift(s); } }, avatar('', true, true),
      H('div', { class: 'pl-rt' }, H('b', { text: dmw(s.date) + ' · ' + s.place }), H('span', { text: s.start + '–' + s.end + ' · ' + fh(s.hours) + ' Std' }), s.byLabel ? H('em', { text: 'angelegt von ' + s.byLabel }) : null), chip('Besetzen', 'open')); }) : H('div', { class: 'pl-empty', text: 'Keine offenen Schichten.' })));
    add(wrap, H('div', { class: 'pl-h2', text: 'Zu wenig Besetzung' }));
    const gaps = d.gaps || [], byDay = {};
    gaps.forEach(function (g) { (byDay[g.date] = byDay[g.date] || []).push(g); });
    const days = Object.keys(byDay).sort();
    if (!Object.keys(d.coverage || {}).length) add(wrap, H('div', { class: 'pl-card' }, H('div', { class: 'pl-empty', text: 'Es ist noch keine Soll-Besetzung eingestellt (Admin-Konsole, Standorte). Ohne Soll kann die Übersicht keine Lücken berechnen.' })));
    else if (!days.length) add(wrap, H('div', { class: 'pl-card' }, H('div', { class: 'pl-empty', text: 'In diesem Monat sind alle Standorte nach Soll besetzt. ✓' })));
    days.forEach(function (day) {
      add(wrap, H('section', { class: 'pl-card' }, H('div', { class: 'pl-ch' }, H('b', { text: WDL[dow(day)] + ', ' + dm(day) })),
        byDay[day].map(function (g) {
          return H('div', { class: 'pl-row' }, H('div', { class: 'pl-rt' }, H('b', { text: g.place }), H('span', { text: g.have + ' von ' + g.need + ' besetzt, es fehlen ' + (g.need - g.have) })),
            canAddAt(g.place) ? H('button', { class: 'pl-add', type: 'button', text: '+ Besetzen', style: 'padding:7px 12px;border:1px solid #D9DCEC;border-radius:9px;background:#F8F9FD;color:#3D3A87;font-weight:700;font-size:12.5px', onclick: function () { openEditor({ date: g.date, place: g.place }); } }) : null);
        })));
    });
    return wrap;
  };

  // ---------- Ansicht: Anträge ----------
  let reqLoading = false;
  async function loadReqs() {
    if (reqLoading) return; reqLoading = true;
    const r = await call('planRequests'); reqLoading = false;
    if (r.status === 'success') { S.reqs = r; S.reqErr = ''; } else { S.reqs = null; S.reqErr = r.message || 'Die Anträge konnten nicht geladen werden.'; }
    if (S.me) render();
  }
  function reqLine(q) {
    if (q.decidedBy) return (q.decidedAction === 'eingetragen' ? 'Eingetragen von ' : q.status === 'genehmigt' ? 'Genehmigt von ' : 'Abgelehnt von ') + q.decidedBy + (q.decidedAt ? ' · ' + when(q.decidedAt) : '');
    if (q.type === 'verfuegbar' && q.source === 'mitarbeiter') return 'Vom Mitarbeiter gemeldet, keine Genehmigung nötig';
    if (q.status === 'genehmigt') return 'Genehmigt von Admin (älterer Eintrag)';
    if (q.status === 'abgelehnt') return 'Abgelehnt von Admin (älterer Eintrag)';
    return '';
  }
  async function openClearDone(n) {
    const ok = await confirmSheet('Erledigte Anträge entfernen?', 'Alle ' + n + ' erledigten Anträge verschwinden aus dieser Liste. Krank- und Urlaubstage bleiben im Plan erhalten, es wird nichts rückgängig gemacht. Offene Anträge bleiben stehen.', null, 'Liste leeren', true);
    if (!ok) return;
    const r = await call('planRequestClear', {});
    if (r.status === 'success') { await loadReqs(); toast((r.hidden || 0) + ' erledigte Anträge entfernt'); } else toast(r.message || 'Nicht möglich.', 'error');
  }
  function reqRow(q) {
    const range = q.from === q.to ? dmw(q.from) : dmw(q.from) + ' – ' + dmw(q.to), line = reqLine(q);
    const st = q.status === 'offen' ? chip('Offen', 'draft') : q.status === 'genehmigt' ? chip('Genehmigt', 'ok') : chip('Abgelehnt', 'open');
    return H('div', { class: 'pl-rq' }, H('h4', {}, q.name, chip(q.label || q.type), st),
      H('p', { text: range + (q.shift ? ' · ' + q.shift.place + ' ' + q.shift.start + '–' + q.shift.end : '') }),
      q.text ? H('p', { text: '„' + q.text + '“' }) : null, q.reply ? H('p', { text: 'Antwort: ' + q.reply }) : null,
      line ? H('div', { class: 'by' + (q.status === 'abgelehnt' ? ' no' : ''), text: line }) : null,
      q.status === 'offen' ? (perm('r_decide') ? H('div', { class: 'pl-rqb' }, H('button', { class: 'ok', type: 'button', text: 'Genehmigen', onclick: function () { openDecide(q, 'genehmigt'); } }),
        q.type === 'krank' ? null : H('button', { type: 'button', text: 'Ablehnen', onclick: function () { openDecide(q, 'abgelehnt'); } })) : H('p', { text: 'Wartet auf die Entscheidung des Admins oder Gruppenleiters.' })) : null);
  }
  VIEWS.reqs = function () {
    const wrap = H('div', {});
    if (perm('r_create')) add(wrap, H('div', { class: 'pl-btns' }, H('button', { class: 'pl-btn ghost', type: 'button', text: '+ Meldung für einen Mitarbeiter eintragen', onclick: openRequestCreate })));
    if (!S.reqs && !S.reqErr) { loadReqs(); add(wrap, H('div', { class: 'pl-boot', text: 'Wird geladen …' })); return wrap; }
    if (S.reqErr) { add(wrap, H('div', { class: 'pl-msg', text: S.reqErr })); return wrap; }
    const all = S.reqs.requests, open = all.filter(function (q) { return q.status === 'offen'; }), done = all.filter(function (q) { return q.status !== 'offen'; });
    add(wrap, H('div', { class: 'pl-h2', text: 'Offen (' + open.length + ')' }));
    add(wrap, H('div', { class: 'pl-card' }, open.length ? open.map(reqRow) : H('div', { class: 'pl-empty', text: 'Keine offenen Anträge.' })));
    add(wrap, H('div', { class: 'pl-h2 pl-h2row' }, H('span', { text: 'Zuletzt erledigt (' + done.length + ')' }), perm('r_delete') && done.length ? H('button', { class: 'pl-link', type: 'button', text: 'Liste leeren', onclick: function () { openClearDone(done.length); } }) : null));
    add(wrap, H('div', { class: 'pl-card' }, done.length ? done.slice(0, 40).map(reqRow) : H('div', { class: 'pl-empty', text: 'Noch nichts erledigt.' })));
    return wrap;
  };

  // ---------- Ansicht: Verlauf (wer hat was gemacht) ----------
  let feedLoading = false;
  async function loadFeed() {
    if (feedLoading) return; feedLoading = true;
    const r = await call('planFeed', { limit: 200 }); feedLoading = false;
    if (r.status === 'success') { S.feed = r; S.feedErr = ''; } else { S.feed = null; S.feedErr = r.message || 'Der Verlauf konnte nicht geladen werden.'; }
    if (S.me) render();
  }
  function dayLabel(ts) {
    const d = new Date(ts), t = new Date(), y = new Date(t.getTime() - 86400000), k = function (x) { return x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate(); };
    return k(d) === k(t) ? 'Heute' : k(d) === k(y) ? 'Gestern' : WD[d.getDay()] + ' ' + p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.';
  }
  VIEWS.feed = function () {
    const wrap = H('div', {});
    if (!S.feed && !S.feedErr) { loadFeed(); add(wrap, H('div', { class: 'pl-boot', text: 'Wird geladen …' })); return wrap; }
    if (S.feedErr) { add(wrap, H('div', { class: 'pl-msg', text: S.feedErr })); return wrap; }
    const F = S.feed, who = S.feedWho && F.actors.indexOf(S.feedWho) !== -1 ? S.feedWho : '';
    add(wrap, H('div', { class: 'pl-chips' }, [''].concat(F.actors).map(function (a) { return H('button', { class: 'pl-pill' + (a === who ? ' on' : ''), type: 'button', text: a || 'Alle', onclick: function () { S.feedWho = a; render(); } }); })));
    const items = F.items.filter(function (x) { return !who || x.who === who; });
    if (!items.length) { add(wrap, H('div', { class: 'pl-card' }, H('div', { class: 'pl-empty', text: 'Noch nichts im Verlauf.' }))); return wrap; }
    let last = '', card = null;
    items.forEach(function (x) {
      const lab = dayLabel(x.ts);
      if (lab !== last) { last = lab; add(wrap, H('div', { class: 'pl-h2', text: lab })); card = H('div', { class: 'pl-card' }); add(wrap, card); }
      add(card, H('div', { class: 'pl-fe' }, H('div', { class: 'pl-fh' }, H('b', { text: x.who }), H('span', { text: new Date(x.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) })),
        H('div', { class: 'pl-fa', text: x.action }), x.text ? H('div', { class: 'pl-ft', text: x.text }) : null));
    });
    add(wrap, H('p', { class: 'pl-hint', text: 'Zeigt die letzten Änderungen am Dienstplan und an Anträgen, mit dem Namen dessen, der sie gemacht hat.' }));
    return wrap;
  };

  // ---------- Sheets: Schicht ansehen, eintragen, ändern, tauschen ----------
  function kv(k, v) { return H('div', { class: 'pl-kv' }, H('span', { text: k }), H('b', { text: v })); }
  function btn(text, cls, fn) { return H('button', { class: 'pl-btn' + (cls ? ' ' + cls : ''), type: 'button', text: text, onclick: fn }); }
  function placeAllowed(p) { return !S.me.scope.places || S.me.scope.places.indexOf(p) !== -1; }
  function msgBox(host) { const b = H('div', { class: 'pl-msg' }); b.style.display = 'none'; host.append(b); return function (t, kind) { b.textContent = t; b.className = 'pl-msg' + (kind ? ' ' + kind : ''); b.style.display = t ? 'block' : 'none'; }; }
  function openShift(s) {
    const body = H('div', {}), open = s.pin === '00', abs = S.ix.abs[s.pin + '|' + s.date];
    add(body, kv('Datum', WDL[dow(s.date)] + ', ' + dm(s.date) + s.date.slice(0, 4)), kv('Standort', s.place), kv('Zeit', s.start + '–' + s.end + ' (' + fh(s.hours) + ' Std)'), kv('Mitarbeiter', open ? 'Offene Schicht (noch nicht vergeben)' : nameOf(s.pin)));
    if (s.status === 'entwurf') add(body, kv('Status', 'Entwurf, Mitarbeiter sehen sie noch nicht'));
    if (abs) add(body, kv('Hinweis', abs === 'krank' ? 'Ist krank gemeldet' : 'Ist im Urlaub'));
    if (s.note) add(body, H('div', { class: 'pl-note pl-rt', style: 'margin:10px 0' }, H('div', { class: 'pl-note', text: s.note })));
    add(body, H('p', { class: 'pl-by', text: 'Zuletzt geändert von ' + (s.byLabel || 'Admin') + (s.updated ? ' am ' + when(s.updated) : '') }));
    const btns = H('div', { class: 'pl-btns' });
    const editable = placeAllowed(s.place);
    if (open && editable && (perm('p_add') || perm('p_edit'))) add(btns, btn('Ersatz finden und besetzen', '', function () { openReplace(s); }));
    if (editable && perm('p_edit')) add(btns, btn('Bearbeiten', open ? 'ghost' : '', function () { openEditor({ shift: s }); }));
    if (editable && perm('p_note')) add(btns, btn(s.note ? 'Bemerkung ändern' : 'Bemerkung schreiben', 'ghost', function () { openNote(s); }));
    if (editable && perm('p_swap') && !open) add(btns, btn('Mit anderem Mitarbeiter tauschen', 'ghost', function () { openSwap(s); }));
    if (editable && perm('p_delete')) add(btns, btn(s.status === 'entwurf' ? 'Löschen' : 'Absagen', 'danger', async function () {
      const ok = await confirmSheet(s.status === 'entwurf' ? 'Schicht löschen?' : 'Schicht absagen?', dmw(s.date) + ' · ' + s.place + ' · ' + s.start + '–' + s.end + (open ? '' : ' · ' + nameOf(s.pin)) + (s.status === 'entwurf' ? '' : '. Der Mitarbeiter bekommt eine Nachricht.'), null, s.status === 'entwurf' ? 'Löschen' : 'Absagen', true);
      if (!ok) return;
      const r = await call('planShiftDelete', { id: s.id });
      if (r.status === 'success') reload(r.result === 'abgesagt' ? 'Schicht abgesagt' : 'Schicht gelöscht'); else toast(r.message || 'Nicht möglich.', 'error');
    }));
    add(body, btns);
    openSheet(open ? 'Offene Schicht' : nameOf(s.pin), body);
  }
  function openNote(s) {
    const body = H('div', {}), ta = H('textarea', { maxlength: '300', 'aria-label': 'Bemerkung', placeholder: 'Bemerkung zur Schicht (für den Chef und die Planung)' }); ta.value = s.note || '';
    const say = msgBox(body);
    add(body, field('Bemerkung', ta), H('div', { class: 'pl-btns' }, btn('Speichern', '', async function () {
      const r = await call('planNote', { id: s.id, text: ta.value });
      if (r.status === 'success') reload('Bemerkung gespeichert'); else say(r.message || 'Nicht gespeichert.');
    })));
    openSheet('Bemerkung', body);
  }
  function tplFor(place) { return (S.data.templates || []).filter(function (t) { return t.place === place; }); }
  function openEditor(o) {
    const sh = o.shift || null, d = S.data, body = H('div', {}), say = msgBox(body), places = myPlaces();
    const emp = d.employees.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    const pinSel = H('select', { 'aria-label': 'Mitarbeiter' }, H('option', { value: '', text: '– bitte wählen –' }), H('option', { value: '00', text: 'Offene Schicht (noch zu vergeben)' }), emp.map(function (e) { return H('option', { value: e.pin, text: e.name }); }));
    pinSel.value = sh ? sh.pin : (o.pin || '');
    const dateIn = H('input', { type: 'date', 'aria-label': 'Datum' }); dateIn.value = sh ? sh.date : (o.date || S.day || S.month + '-01');
    const placeSel = H('select', { 'aria-label': 'Standort' }, places.map(function (p) { return H('option', { value: p, text: p }); }));
    const place0 = sh ? sh.place : (o.place || places[0] || ''); if (places.indexOf(place0) === -1) placeSel.append(H('option', { value: place0, text: place0 })); placeSel.value = place0;
    const startIn = H('input', { type: 'time', 'aria-label': 'Beginn' }), endIn = H('input', { type: 'time', 'aria-label': 'Ende' });
    const tpls = H('div', { class: 'pl-tpl' });
    const info = H('p', { class: 'pl-hint' });
    const calc = function () {
      if (!startIn.value || !endIn.value) { info.textContent = ''; return; }
      let m = hmMin(endIn.value) - hmMin(startIn.value); if (m <= 0) m += 1440; info.textContent = 'Dauer: ' + fh(m / 60) + ' Std' + (m > 600 ? ' (länger als 10 Std.)' : '');
    };
    const drawTpl = function () {
      setKids(tpls, tplFor(placeSel.value).map(function (t) {
        const on = startIn.value === t.start && endIn.value === t.end;
        return H('button', { class: 'pl-pill' + (on ? ' on' : ''), type: 'button', text: t.start + '–' + t.end, onclick: function () { startIn.value = t.start; endIn.value = t.end; calc(); drawTpl(); } });
      }));
    };
    const first = tplFor(place0)[0];
    startIn.value = sh ? sh.start : (first ? first.start : '22:00'); endIn.value = sh ? sh.end : (first ? first.end : '08:00');
    placeSel.addEventListener('change', function () { const t = tplFor(placeSel.value)[0]; if (t && !sh) { startIn.value = t.start; endIn.value = t.end; } calc(); drawTpl(); });
    startIn.addEventListener('input', function () { calc(); drawTpl(); }); endIn.addEventListener('input', function () { calc(); drawTpl(); });
    calc(); drawTpl();
    const note = H('textarea', { maxlength: '300', 'aria-label': 'Bemerkung', placeholder: 'Optional, zum Beispiel „Schlüssel holen“' }); note.value = sh ? sh.note || '' : '';
    add(body, field('Mitarbeiter', pinSel), field('Datum', dateIn), field('Standort', placeSel), H('div', { class: 'pl-hint', text: 'Typische Zeiten für diesen Standort:' }), tpls,
      H('div', { class: 'pl-two' }, field('Beginn', startIn), field('Ende', endIn)), info, field('Bemerkung', note));
    if (sh) add(body, H('p', { class: 'pl-by', text: 'Zuletzt geändert von ' + (sh.byLabel || 'Admin') + (sh.updated ? ' am ' + when(sh.updated) : '') }));
    const save = btn(sh ? 'Speichern' : 'Eintragen', '', function () { send(false); });
    const send = async function (confirm) {
      if (!pinSel.value) { say('Bitte einen Mitarbeiter wählen.'); return; }
      say(''); save.disabled = true;
      const r = await call('planShiftSave', Object.assign({ date: dateIn.value, place: placeSel.value, start: startIn.value, end: endIn.value, pin: pinSel.value, note: note.value }, sh ? { id: sh.id } : {}, confirm ? { confirm: true } : {}));
      save.disabled = false;
      if (r.status === 'success') { reload(sh ? 'Gespeichert' : 'Schicht eingetragen'); return; }
      if (r.status === 'warning') { const ok = await confirmSheet('Trotzdem speichern?', 'Bitte beachte:', (r.warnings || []).map(function (w) { return w.message; }), 'Trotzdem speichern'); if (ok) send(true); return; }
      say(r.message || 'Nicht gespeichert.');
    };
    add(body, H('div', { class: 'pl-btns' }, save));
    openSheet(sh ? 'Schicht bearbeiten' : 'Schicht eintragen', body);
  }
  function openSwap(a) {
    const body = H('div', {}), say = msgBox(body);
    const cand = S.data.employees.filter(function (e) { return e.pin !== a.pin && (S.ix.byPin[e.pin] || []).some(function (s) { return placeAllowed(s.place); }); }).sort(function (x, y) { return x.name.localeCompare(y.name, 'de'); });
    if (!cand.length) { add(body, H('div', { class: 'pl-empty', text: 'Es gibt in diesem Monat keinen anderen Mitarbeiter mit einer Schicht zum Tauschen.' })); openSheet('Tauschen', body); return; }
    const who = H('select', { 'aria-label': 'Tauschen mit' }, cand.map(function (e) { return H('option', { value: e.pin, text: e.name }); }));
    const which = H('select', { 'aria-label': 'Seine Schicht' });
    const fill = function () {
      const l = (S.ix.byPin[who.value] || []).filter(function (s) { return placeAllowed(s.place); });
      setKids(which, l.map(function (s) { return H('option', { value: s.id, text: dmw(s.date) + ' · ' + s.place + ' ' + s.start + '–' + s.end }); }));
      const same = l.filter(function (s) { return s.date === a.date; })[0]; if (same) which.value = same.id;
    };
    who.addEventListener('change', fill); fill();
    add(body, H('p', { class: 'pl-hint', text: nameOf(a.pin) + ' · ' + dmw(a.date) + ' · ' + a.place + ' ' + a.start + '–' + a.end + ' wird getauscht gegen:' }), field('Mit wem?', who), field('Welche Schicht?', which));
    const go = btn('Tauschen', '', function () { send(false); });
    const send = async function (confirm) {
      say(''); go.disabled = true;
      const r = await call('planSwap', Object.assign({ idA: a.id, idB: which.value }, confirm ? { confirm: true } : {}));
      go.disabled = false;
      if (r.status === 'success') { reload('Schichten getauscht'); return; }
      if (r.status === 'warning') { const ok = await confirmSheet('Trotzdem tauschen?', 'Bitte beachte:', (r.warnings || []).map(function (w) { return w.message; }), 'Trotzdem tauschen'); if (ok) send(true); return; }
      say(r.message || 'Nicht möglich.');
    };
    add(body, H('div', { class: 'pl-btns' }, go));
    openSheet('Schichten tauschen', body);
  }
  async function openReplace(s) {
    const body = H('div', {}, H('div', { class: 'pl-boot', text: 'Suche passende Mitarbeiter …' }));
    openSheet('Ersatz für ' + dmw(s.date), body);
    const r = await call('planReplace', { shiftId: s.id });
    if (r.status !== 'success') { setKids(body, H('div', { class: 'pl-msg', text: r.message || 'Nicht möglich.' })); return; }
    const list = H('div', { class: 'pl-list' });
    (r.candidates || []).slice(0, 25).forEach(function (c) {
      add(list, H('button', { class: 'pl-row', type: 'button', disabled: c.verdict === 'blockiert' ? true : null, onclick: async function () {
        const ok = await confirmSheet('Besetzen?', c.name + ' übernimmt ' + dmw(s.date) + ' · ' + s.place + ' ' + s.start + '–' + s.end + '.', c.reasons && c.reasons.length ? c.reasons : null, 'Besetzen');
        if (!ok) return;
        const x = await call('planShiftSave', { id: s.id, date: s.date, place: s.place, start: s.start, end: s.end, pin: c.pin, note: s.note || '', confirm: true });
        if (x.status === 'success') reload(c.name + ' ist eingeteilt'); else toast(x.message || 'Nicht möglich.', 'error');
      } }, avatar(c.name, true, false),
        H('div', { class: 'pl-rt' }, H('b', { text: c.name }), H('span', { text: 'Woche: ' + fh(c.weekHours) + ' Std' + (c.phone ? ' · ' + c.phone : '') }), (c.reasons || []).length ? H('em', { text: c.reasons.join(' · ') }) : null),
        chip(c.verdict === 'frei' ? 'Frei' : c.verdict === 'warnung' ? 'Mit Hinweis' : 'Nicht möglich', c.verdict === 'frei' ? 'ok' : c.verdict === 'warnung' ? 'draft' : 'open')));
    });
    setKids(body, H('p', { class: 'pl-hint', text: s.place + ' · ' + s.start + '–' + s.end + '. Sortiert nach Eignung (frei zuerst).' }), (r.candidates || []).length ? list : H('div', { class: 'pl-empty', text: 'Es wurden keine Mitarbeiter gefunden.' }));
  }
  function openPerson(pin) {
    const st = personStats(pin), body = H('div', {}), l = (S.ix.byPin[pin] || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    add(body, kv('Schichten', String(st.n)), kv('Stunden (geplant)', fh(st.hours) + ' Std'), kv('Standorte', Object.keys(st.pl).map(function (p) { return p + ' ' + st.pl[p]; }).join(', ') || '–'));
    const ab = Object.keys(S.ix.abs).filter(function (k) { return k.indexOf(pin + '|') === 0; }).map(function (k) { return k.slice(3); }).sort();
    if (ab.length) add(body, kv('Abwesend', ab.map(function (i) { return dm(i).slice(0, 5); }).join(', ')));
    if (canAddAt(S.place) || perm('p_add')) add(body, H('div', { class: 'pl-btns', style: 'margin:10px 0 12px' }, btn('+ Schicht für ' + nameOf(pin) + ' eintragen', 'ghost', function () { openEditor({ pin: pin }); }), perm('p_reset') && st.n ? btn('Alle Schichten von ' + nameOf(pin) + ' zurücksetzen', 'danger', function () { closeSheet(); openReset(pin); }) : null));
    add(body, H('div', { class: 'pl-list' }, l.length ? l.map(function (s) {
      return H('button', { class: 'pl-row', type: 'button', onclick: function () { openShift(s); } }, avatar(nameOf(pin), isNight(s), false),
        H('div', { class: 'pl-rt' }, H('b', { text: dmw(s.date) + ' · ' + s.place }), H('span', { text: s.start + '–' + s.end + ' · ' + fh(s.hours) + ' Std' })), s.status === 'entwurf' ? chip('Entwurf', 'draft') : null);
    }) : H('div', { class: 'pl-empty', text: 'Keine Schichten in diesem Monat.' })));
    openSheet(nameOf(pin), body);
  }

  // ---------- Plan zurücksetzen ----------
  function openReset(pin0) {
    const body = H('div', {}), say = msgBox(body), m = S.month;
    const emp = S.data.employees.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    const who = H('select', { 'aria-label': 'Für wen?' }, H('option', { value: '', text: 'Alle Mitarbeiter (ganzer Monat)' }), emp.map(function (e) { return H('option', { value: e.pin, text: e.name }); }));
    who.value = pin0 || '';
    const all = H('input', { type: 'checkbox', id: 'plRa' });
    const info = H('p', { class: 'pl-hint' });
    const upd = function () {
      const l = S.data.shifts.filter(function (x) { return (!who.value || x.pin === who.value) && placeAllowed(x.place); }), dr = l.filter(function (x) { return x.status === 'entwurf'; }).length;
      info.textContent = monthLabel(m) + (who.value ? ' · ' + nameOf(who.value) : ' · alle Mitarbeiter') + ': ' + dr + (dr === 1 ? ' Entwurf' : ' Entwürfe') + ' und ' + (l.length - dr) + (l.length - dr === 1 ? ' veröffentlichte Schicht' : ' veröffentlichte Schichten') + '.';
    };
    who.addEventListener('change', upd); upd();
    add(body, H('p', { class: 'pl-hint', text: 'Entfernt alle Schichten eines Mitarbeiters oder des ganzen Monats. Krank- und Urlaubstage bleiben bestehen. Danach kannst du es rückgängig machen.' }), field('Für wen?', who), info,
      H('label', { class: 'pl-hint', style: 'display:flex;gap:10px;align-items:flex-start;margin:4px 0 10px' }, all, H('span', { text: 'Auch veröffentlichte Schichten absagen (die Mitarbeiter bekommen eine Nachricht). Ohne Haken werden nur Entwürfe gelöscht.' })));
    const go = btn('Zurücksetzen', 'danger', async function () {
      const ok = await confirmSheet('Wirklich zurücksetzen?', info.textContent + (all.checked ? ' Alles wird entfernt, veröffentlichte Schichten werden abgesagt.' : ' Es werden nur Entwürfe gelöscht.'), null, 'Ja, zurücksetzen', true);
      if (!ok) return;
      go.disabled = true;
      const r = await call('planClear', { scope: who.value ? 'person' : 'month', pin: who.value, month: m, what: all.checked ? 'all' : 'drafts' });
      go.disabled = false;
      if (r.status !== 'success') { say(r.message || 'Nicht möglich.'); return; }
      await closeAll(); await loadMonth();
      const rb = H('div', {}, H('div', { class: 'pl-msg ok', text: r.removed + (r.removed === 1 ? ' Schicht' : ' Schichten') + ' entfernt' + (r.cancelled ? ', davon ' + r.cancelled + ' veröffentlichte abgesagt' : '') + '.' }));
      const bb = H('div', { class: 'pl-btns' });
      if (perm('p_undo') && r.undo && r.undo.length) add(bb, btn('Rückgängig machen', 'danger', async function () { const u = await call('planUndo', { undo: r.undo }); if (u.status === 'success') reload('Rückgängig gemacht'); else toast(u.message || 'Nicht möglich.', 'error'); }));
      add(bb, btn('Fertig', 'ghost', function () { closeSheet(); })); add(rb, bb);
      openSheet('Zurückgesetzt', rb);
    });
    add(body, H('div', { class: 'pl-btns' }, go));
    openSheet('Plan zurücksetzen', body);
  }

  // ---------- Sheets: Monat planen, kopieren, veröffentlichen ----------
  function openMonthFill() {
    const d = S.data, m = S.month, n = daysIn(m), body = H('div', {}), say = msgBox(body), places = myPlaces();
    const F = { pins: {}, days: {}, overwrite: false };
    for (let i = 1; i <= n; i++) F.days[m + '-' + p2(i)] = true;
    const emp = d.employees.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    const sum = H('p', { class: 'pl-hint' });
    const update = function () {
      const np = Object.keys(F.pins).length, nd = Object.keys(F.days).filter(function (k) { return F.days[k]; }).length;
      sum.textContent = np + (np === 1 ? ' Mitarbeiter' : ' Mitarbeiter') + ' × ' + nd + (nd === 1 ? ' Tag' : ' Tage') + ' = ' + np * nd + ' Schichten (als Entwurf)';
    };
    const search = H('input', { class: 'pl-search', type: 'search', placeholder: 'Mitarbeiter suchen', 'aria-label': 'Mitarbeiter suchen' });
    const list = H('div', { class: 'pl-list', style: 'max-height:240px;overflow:auto' });
    const drawList = function () {
      const q = search.value.trim().toLowerCase();
      setKids(list, emp.filter(function (e) { return !q || e.name.toLowerCase().indexOf(q) !== -1; }).map(function (e) {
        return H('button', { class: 'pl-row' + (F.pins[e.pin] ? ' sel' : ''), type: 'button', onclick: function () { if (F.pins[e.pin]) delete F.pins[e.pin]; else F.pins[e.pin] = true; drawList(); update(); } },
          H('div', { class: 'pl-check', text: F.pins[e.pin] ? '✓' : '' }), H('div', { class: 'pl-rt' }, H('b', { text: e.name })));
      }));
    };
    search.addEventListener('input', drawList);
    const placeSel = H('select', { 'aria-label': 'Standort' }, places.map(function (p) { return H('option', { value: p, text: p }); }));
    const startIn = H('input', { type: 'time', 'aria-label': 'Beginn' }), endIn = H('input', { type: 'time', 'aria-label': 'Ende' });
    const tpls = H('div', { class: 'pl-tpl' });
    const drawTpl = function () { setKids(tpls, tplFor(placeSel.value).map(function (t) { return H('button', { class: 'pl-pill' + (startIn.value === t.start && endIn.value === t.end ? ' on' : ''), type: 'button', text: t.start + '–' + t.end, onclick: function () { startIn.value = t.start; endIn.value = t.end; drawTpl(); } }); })); };
    const setTpl = function () { const t = tplFor(placeSel.value)[0]; startIn.value = t ? t.start : '22:00'; endIn.value = t ? t.end : '08:00'; drawTpl(); };
    placeSel.value = places.indexOf(S.place) !== -1 ? S.place : places[0]; placeSel.addEventListener('change', setTpl); setTpl();
    startIn.addEventListener('input', drawTpl); endIn.addEventListener('input', drawTpl);
    const cal = H('div', { class: 'pl-cal' });
    const drawCal = function () {
      setKids(cal, ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(function (w) { return H('b', { text: w }); }));
      for (let k = 0; k < monIdx(m + '-01'); k++) add(cal, H('span'));
      for (let i = 1; i <= n; i++) { const iso = m + '-' + p2(i); add(cal, H('button', { class: 'pl-cd' + (F.days[iso] ? ' on' : ''), type: 'button', text: String(i), onclick: function () { F.days[iso] = !F.days[iso]; drawCal(); update(); } })); }
    };
    const quick = function (fn) { for (let i = 1; i <= n; i++) { const iso = m + '-' + p2(i); F.days[iso] = fn(dow(iso), iso); } drawCal(); update(); };
    const chips = H('div', { class: 'pl-chips' }, [['Alle Tage', function () { return true; }], ['Mo–Fr', function (w) { return w >= 1 && w <= 5; }], ['Sa + So', function (w) { return w === 0 || w === 6; }], ['Ab heute', function (w, iso) { return iso >= S.today; }], ['Keine', function () { return false; }]].map(function (x) { return H('button', { class: 'pl-pill', type: 'button', text: x[0], onclick: function () { quick(x[1]); } }); }));
    const ow = H('input', { type: 'checkbox', id: 'plOw' }); ow.addEventListener('change', function () { F.overwrite = ow.checked; });
    const owRow = H('label', { class: 'pl-hint', style: 'display:flex;gap:10px;align-items:flex-start;margin:4px 0 10px' }, ow, H('span', { text: 'Bestehende Schichten dieser Mitarbeiter an diesen Tagen überschreiben (sonst bleiben sie unverändert)' }));
    drawList(); drawCal(); update();
    add(body, H('p', { class: 'pl-hint', text: 'Wähle Mitarbeiter, Standort, Zeit und die Tage. Es entsteht ein Entwurf, den du danach veröffentlichst. Krank- und Urlaubstage werden automatisch übersprungen.' }),
      H('div', { class: 'pl-h2', text: '1 · Mitarbeiter' }), search, list, H('div', { class: 'pl-h2', text: '2 · Standort und Zeit' }), field('Standort', placeSel), tpls, H('div', { class: 'pl-two' }, field('Beginn', startIn), field('Ende', endIn)),
      H('div', { class: 'pl-h2', text: '3 · Tage' }), chips, cal, owRow, sum);
    const go = btn('Planen', '', async function () {
      const pins = Object.keys(F.pins), days = Object.keys(F.days).filter(function (k) { return F.days[k]; }).sort();
      if (!pins.length) { say('Bitte mindestens einen Mitarbeiter wählen.'); return; }
      if (!days.length) { say('Bitte mindestens einen Tag wählen.'); return; }
      const ops = []; let kept = 0;
      pins.forEach(function (pin) { days.forEach(function (iso) {
        if (!F.overwrite && (S.ix.byPin[pin] || []).some(function (s) { return s.date === iso; })) { kept++; return; }
        ops.push({ op: 'set', pin: pin, date: iso, place: placeSel.value, start: startIn.value, end: endIn.value });
      }); });
      if (!ops.length) { say('Alle gewählten Tage sind schon belegt. Schalte „überschreiben“ ein, wenn du sie ersetzen willst.'); return; }
      say(''); go.disabled = true; go.textContent = 'Plane … bitte warten';
      const tot = { created: 0, updated: 0, unchanged: 0, skipped: [], undo: [] };
      for (let i = 0; i < ops.length; i += 500) {
        const r = await call('planBatch', { ops: ops.slice(i, i + 500) });
        if (r.status !== 'success') { go.disabled = false; go.textContent = 'Planen'; say(r.message || 'Nicht möglich.'); if (tot.created + tot.updated) { await loadMonth(); } return; }
        tot.created += r.created || 0; tot.updated += r.updated || 0; tot.unchanged += r.unchanged || 0; tot.skipped = tot.skipped.concat(r.skipped || []); tot.undo = tot.undo.concat(r.undo || []);
      }
      await closeAll(); await loadMonth(); showBatchResult('Monat geplant', tot, kept);
    });
    add(body, H('div', { class: 'pl-btns' }, go));
    openSheet('Monat planen', body);
  }
  function showBatchResult(title, tot, kept) {
    const body = H('div', {}), reasons = {};
    (tot.skipped || []).forEach(function (x) { reasons[x.reason] = (reasons[x.reason] || 0) + 1; });
    add(body, H('div', { class: 'pl-msg ok', text: (tot.created || 0) + ' neu · ' + (tot.updated || 0) + ' geändert' + (tot.unchanged ? ' · ' + tot.unchanged + ' unverändert' : '') + (kept ? ' · ' + kept + ' schon belegt (nicht angefasst)' : '') + (tot.skipped && tot.skipped.length ? ' · ' + tot.skipped.length + ' übersprungen' : '') }));
    if (tot.skipped && tot.skipped.length) add(body, H('div', { class: 'pl-msg warn' }, 'Übersprungen:', H('ul', {}, Object.keys(reasons).map(function (k) { return H('li', { text: reasons[k] + '× ' + k }); }))));
    add(body, H('p', { class: 'pl-hint', text: 'Das sind Entwürfe. Mitarbeiter sehen sie erst, wenn du veröffentlichst.' }));
    const btns = H('div', { class: 'pl-btns' });
    if (perm('p_undo') && tot.undo && tot.undo.length) add(btns, btn('Rückgängig machen', 'danger', async function () { const r = await call('planUndo', { undo: tot.undo }); if (r.status === 'success') reload('Rückgängig gemacht'); else toast(r.message || 'Nicht möglich.', 'error'); }));
    if (perm('p_publish')) add(btns, btn('Jetzt veröffentlichen', 'ghost', function () { closeSheet(); openPublish(); }));
    add(btns, btn('Fertig', 'ghost', function () { closeSheet(); }));
    add(body, btns);
    openSheet(title, body);
  }
  function openCopy() {
    const m = S.month, body = H('div', {}), say = msgBox(body);
    const first = addDays(m + '-01', -monIdx(m + '-01'));
    const from = H('input', { type: 'date', 'aria-label': 'Von' }), to = H('input', { type: 'date', 'aria-label': 'Nach' }), len = H('select', { 'aria-label': 'Länge' }, [7, 14, 21, 28, 35, 42].map(function (x) { return H('option', { value: String(x), text: x / 7 + (x === 7 ? ' Woche' : ' Wochen') }); }));
    from.value = addDays(first, -28); to.value = first; len.value = '28';
    add(body, H('p', { class: 'pl-hint', text: 'Kopiert die Schichten eines Zeitraums auf einen anderen. Beginne am besten mit einem Montag, dann passen die Wochentage. Die Kopien sind Entwürfe. Wer in dieser Zeit krank oder im Urlaub ist, wird übersprungen.' }),
      field('Von (Montag)', from), field('Nach (Montag)', to), field('Länge', len));
    const go = btn('Kopieren', '', async function () {
      say(''); go.disabled = true;
      const r = await call('planCopy', { fromStart: from.value, toStart: to.value, days: +len.value });
      go.disabled = false;
      if (r.status !== 'success') { say(r.message || 'Nicht möglich.'); return; }
      await closeAll(); await loadMonth();
      showBatchResult('Kopiert', { created: r.copied || 0, updated: 0, unchanged: 0, skipped: (r.conflicts || []).map(function (c) { return { reason: c.message || 'Konflikt' }; }), undo: r.undo || [] }, r.duplicates || 0);
    });
    add(body, H('div', { class: 'pl-btns' }, go));
    openSheet('Wochen kopieren', body);
  }
  async function openPublish() {
    const m = S.month, n = daysIn(m), cnt = S.data.drafts;
    const ok = await confirmSheet('Veröffentlichen?', cnt + (cnt === 1 ? ' Entwurf' : ' Entwürfe') + ' im ' + monthLabel(m) + '. Die Mitarbeiter sehen die Schichten danach in „Mein Dienstplan“ und bekommen eine Nachricht.', null, 'Veröffentlichen');
    if (!ok) return;
    const r = await call('planPublish', { from: m + '-01', to: m + '-' + p2(n) });
    if (r.status === 'success') reload((r.published || 0) + ' Schichten veröffentlicht'); else toast(r.message || 'Nicht möglich.', 'error');
  }

  // ---------- Sheets: Anträge ----------
  function openDecide(q, decision) {
    const body = H('div', {}), say = msgBox(body), ta = H('textarea', { maxlength: '300', 'aria-label': 'Antwort', placeholder: 'Optional: Antwort an den Mitarbeiter' });
    const eff = decision === 'abgelehnt' ? 'Der Antrag wird abgelehnt. Der Mitarbeiter bleibt wie geplant eingeteilt.' : q.type === 'tausch' ? 'Die Schicht wird zur offenen Schicht und verschwindet aus dem Plan des Mitarbeiters.' : q.type === 'krank' || q.type === 'urlaub' ? 'Seine Schichten in diesem Zeitraum werden abgesagt.' : q.type === 'aenderung' ? 'Die gewünschte Änderung wird in die Schicht übernommen.' : 'Der Antrag wird genehmigt.';
    add(body, kv('Mitarbeiter', q.name), kv('Art', q.label || q.type), kv('Zeitraum', q.from === q.to ? dmw(q.from) : dmw(q.from) + ' – ' + dmw(q.to)), q.text ? kv('Begründung', q.text) : null,
      H('p', { class: 'pl-hint', style: 'margin-top:10px', text: eff }), field('Antwort', ta), H('p', { class: 'pl-by', text: 'Dein Name steht danach beim Antrag: „' + (decision === 'genehmigt' ? 'Genehmigt von ' : 'Abgelehnt von ') + S.me.label + '“.' }));
    const go = btn(decision === 'genehmigt' ? 'Genehmigen' : 'Ablehnen', decision === 'genehmigt' ? 'ok' : 'danger', async function () {
      say(''); go.disabled = true;
      const r = await call('planRequestDecide', Object.assign({ id: q.id, decision: decision, reply: ta.value }, decision === 'genehmigt' && q.type === 'aenderung' && q.wish ? { apply: q.wish } : {}));
      go.disabled = false;
      if (r.status === 'success') {
        const bits = []; if (r.cancelled) bits.push(r.cancelled + ' abgesagt'); if (r.opened) bits.push(r.opened + ' offen'); if (r.assigned) bits.push(r.assigned + ' übergeben'); if (r.changed) bits.push(r.changed + ' geändert');
        await closeAll(); await loadMonth(); await loadReqs(); toast((decision === 'genehmigt' ? 'Genehmigt' : 'Abgelehnt') + (bits.length ? ': ' + bits.join(', ') : ''));
      } else say(r.message || 'Nicht möglich.');
    });
    add(body, H('div', { class: 'pl-btns' }, go));
    openSheet(decision === 'genehmigt' ? 'Genehmigen' : 'Ablehnen', body);
  }
  function openRequestCreate() {
    const body = H('div', {}), say = msgBox(body), emp = S.data.employees.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    const who = H('select', { 'aria-label': 'Mitarbeiter' }, H('option', { value: '', text: '– bitte wählen –' }), emp.map(function (e) { return H('option', { value: e.pin, text: e.name }); }));
    const type = H('select', { 'aria-label': 'Art' }, H('option', { value: 'krank', text: 'Krank' }), H('option', { value: 'urlaub', text: 'Urlaub' }), H('option', { value: 'verfuegbar', text: 'Nicht verfügbar' }));
    const from = H('input', { type: 'date', 'aria-label': 'Von' }), to = H('input', { type: 'date', 'aria-label': 'Bis' }), text = H('textarea', { maxlength: '300', 'aria-label': 'Notiz', placeholder: 'Optional, zum Beispiel „telefonisch gemeldet“' });
    from.value = to.value = S.day || S.today;
    from.addEventListener('change', function () { if (to.value < from.value) to.value = from.value; });
    add(body, H('p', { class: 'pl-hint', text: 'Zum Beispiel für eine Krankmeldung per Telefon. Sie gilt sofort. Dein Name steht als „eingetragen von“ dabei.' }), field('Mitarbeiter', who), field('Art', type), H('div', { class: 'pl-two' }, field('Von', from), field('Bis', to)), field('Notiz', text));
    const go = btn('Eintragen', '', async function () {
      if (!who.value) { say('Bitte einen Mitarbeiter wählen.'); return; }
      say(''); go.disabled = true;
      const r = await call('planRequestCreate', { pin: who.value, type: type.value, from: from.value, to: to.value, text: text.value });
      go.disabled = false;
      if (r.status === 'success') { await closeAll(); await loadMonth(); await loadReqs(); toast('Eingetragen'); } else say(r.message || 'Nicht möglich.');
    });
    add(body, H('div', { class: 'pl-btns' }, go));
    openSheet('Meldung eintragen', body);
  }

  // ---------- Menü ----------
  function openMenu() {
    const body = H('div', {}), me = S.me;
    add(body, kv('Angemeldet als', me.label), kv('Zugang', me.kind === 'chef' ? 'Chef' : me.kind === 'owner' ? 'Voll-Admin' : 'Admin-Konto'));
    const btns = H('div', { class: 'pl-btns', style: 'margin-top:12px' });
    add(btns, btn('Aktualisieren', 'ghost', function () { closeAll().then(loadMonth).then(function () { toast('Aktualisiert'); }); }));
    if (perm('p_bulk')) add(btns, btn('Monat planen', 'ghost', function () { closeSheet(); openMonthFill(); }));
    if (perm('p_copy')) add(btns, btn('Wochen kopieren', 'ghost', function () { closeSheet(); openCopy(); }));
    if (perm('p_reset')) add(btns, btn('Plan zurücksetzen', 'ghost', function () { closeSheet(); openReset(''); }));
    if (perm('p_publish') && S.data && S.data.drafts) add(btns, btn('Veröffentlichen (' + S.data.drafts + ')', 'ghost', function () { closeSheet(); openPublish(); }));
    add(btns, btn('Abmelden', 'danger', function () { closeAll(); logout(); }));
    add(body, btns);
    openSheet('Menü', body);
  }
  function openAddMenu() {
    const body = H('div', {}), btns = H('div', { class: 'pl-btns' });
    if (perm('p_add')) add(btns, btn('Eine Schicht eintragen', '', function () { closeSheet(); openEditor({ date: S.day }); }));
    if (perm('p_bulk')) add(btns, btn('Monat planen (mehrere Mitarbeiter und Tage)', 'ghost', function () { closeSheet(); openMonthFill(); }));
    if (perm('p_copy')) add(btns, btn('Wochen kopieren', 'ghost', function () { closeSheet(); openCopy(); }));
    if (perm('p_reset')) add(btns, btn('Plan zurücksetzen (Mitarbeiter oder ganzer Monat)', 'ghost', function () { closeSheet(); openReset(''); }));
    if (perm('r_create')) add(btns, btn('Meldung eintragen (krank, Urlaub, nicht verfügbar)', 'ghost', function () { closeSheet(); openRequestCreate(); }));
    add(body, btns);
    openSheet('Was möchtest du tun?', body);
  }

  // ---------- Start ----------
  async function start() {
    setKids(root, H('div', { class: 'pl-boot', text: 'Wird geladen …' }));
    const b = await call('planBoot');
    if (!root) return;
    if (b.status !== 'success') { if (b.code === 'ADMIN_AUTH' || b.code === 'VIEW_CHEF_AUTH') return; showMessage('Nicht geladen', b.message || 'Bitte versuche es später noch einmal.', false); return; }
    S.me = b.me; S.today = b.today; if (!S.month) S.month = b.today.slice(0, 7);
    if (!tabList().length) { showMessage('Kein Zugriff', 'Für diesen Zugang sind noch keine Rechte eingestellt. Bitte den Admin fragen.', true); return; }
    await loadMonth();
  }
  function mount(el, opts) {
    root = el; opts = opts || {}; root.classList.add('pl-app');   // Farben und Maße gelten auch eingebettet
    S.mode = opts.mode === 'chef' ? 'chef' : 'konto'; S.vt = opts.vt || '';
    S.me = null; S.data = null; S.err = ''; S.reqs = null; S.feed = null; S.tab = 'today';
    if (S.mode === 'chef') { if (getGrant()) start(); else showLogin(''); return; }
    const ss = store.load();
    if (ss) { S.session = ss.token; start(); } else showLogin('');
  }
  function unmount() { while (stack.length) removeTop(); root = null; S.me = null; S.data = null; }
  window.DPPlan = { mount: mount, unmount: unmount };
  // Eigene Seite (plan.html): startet von selbst
  const app = document.getElementById('app');
  if (app && document.body.classList.contains('pl-page')) {
    const h = (location.hash || '').replace(/^#/, '').replace(/[^0-9a-f]/gi, '').slice(0, 64);
    mount(app, h.length >= 16 ? { mode: 'chef', vt: h } : { mode: 'konto' });
  }
})();

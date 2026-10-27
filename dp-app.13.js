'use strict';
/* Dienstplan: Mitarbeiter-App (Version 1: Konto, Anmeldung, Passwort) */
(function () {
  const h = DP.h;
  const root = document.getElementById('root');
  const store = DP.sessionStore('dp_session_v1');
  const state = { session: null, profile: null, remember: false };
  const PD = DP.dates;
  let refreshTimer = null;

  function view(node) {
    if (state.planOff && !(node && node.__off)) return;
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    root.replaceChildren(node);
    window.scrollTo(0, 0);
  }
  function logoMark() { return h('div', { class: 'logo' }, DP.icon('calendar')); }
  function alertBox(kind, text, id) {
    return h('div', { class: 'alert ' + kind, role: kind === 'error' ? 'alert' : 'status', id: id || null }, DP.icon(kind === 'success' ? 'check' : 'alert', 'sm'), h('div', { text: text }));
  }
  function setBusy(btn, busy, label) {
    btn.disabled = busy;
    btn.replaceChildren(...(busy ? [h('span', { class: 'spinner' }), 'Bitte warten …'] : [label]));
  }
  function passwordField(id, label, autocomplete) {
    const input = h('input', { class: 'input', id: id, name: id, type: 'password', autocomplete: autocomplete, required: true, maxlength: '128', autocapitalize: 'none', spellcheck: 'false' });
    const reveal = h('button', { type: 'button', class: 'reveal', 'aria-label': 'Passwort anzeigen' }, DP.icon('eye'));
    reveal.addEventListener('click', function () {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      reveal.replaceChildren(DP.icon(show ? 'eyeoff' : 'eye'));
      reveal.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
    });
    return { input: input, node: h('div', { class: 'field' }, h('label', { for: id, text: label }), h('div', { class: 'input-wrap' }, input, reveal)) };
  }
  function errorText(r) {
    if (r.code === 'RATE_LIMIT') return { kind: 'warn', text: r.message };
    return { kind: 'error', text: r.message || 'Das hat nicht geklappt. Bitte versuche es erneut.' };
  }

  // ---------- Anmeldung ----------
  function showLogin(notice) {
    const user = h('input', { class: 'input', id: 'username', name: 'username', type: 'text', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: true, maxlength: '32' });
    const pw = passwordField('password', 'Passwort', 'current-password');
    const remember = h('input', { type: 'checkbox', id: 'remember' });
    const msg = h('div', { id: 'msg' });
    if (notice) msg.append(alertBox('info', notice));
    const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Anmelden');
    const form = h('form', { class: 'stack', novalidate: true, autocomplete: 'on' },
      h('div', { class: 'field' }, h('label', { for: 'username', text: 'Benutzername' }), user),
      pw.node,
      h('label', { class: 'check' }, remember, h('span', {}, 'Angemeldet bleiben', h('div', { class: 'hint', text: 'Bis zu 30 Tage. Nur auf deinem eigenen Handy verwenden.' }))),
      msg, submit);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      const u = user.value.trim(), p = pw.input.value;
      msg.replaceChildren();
      if (!u || !p) { msg.append(alertBox('error', 'Bitte Benutzername und Passwort eingeben.')); return; }
      setBusy(submit, true);
      const r = await DP.api('accLogin', { username: u, password: p, remember: remember.checked });
      pw.input.value = '';
      if (r.status === 'success') {
        state.remember = remember.checked;
        store.save(r.session, r.expires, remember.checked);
        state.session = { token: r.session, expires: r.expires };
        state.profile = r.profile;
        return r.mustChange ? showChangePassword(true) : showHome();
      }
      setBusy(submit, false, 'Anmelden');
      if (r.code === 'MAINTENANCE') return showMaintenance(r.message);
      const e2 = errorText(r);
      msg.append(alertBox(e2.kind, e2.text));
    });
    view(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
      h('div', { class: 'head' }, logoMark(), h('div', {}, h('h1', { text: 'Dienstplan' }), h('p', { class: 'muted', text: 'Melde dich mit deinen Zugangsdaten an.' }))),
      h('div', { class: 'card' }, form),
      h('p', { class: 'center muted small' }, 'Zugangsdaten vergessen? Der Admin kann sie dir neu ausstellen.'),
      h('p', { class: 'center muted small' }, DP.icon('shield', 'sm'), ' Verschlüsselte Verbindung'))));
    user.focus();
  }

  // ---------- Passwort ändern ----------
  function checkRules(pw, username, oldPw) {
    const unique = new Set(pw.split('')).size;
    return [
      { ok: pw.length >= 12, text: 'Mindestens 12 Zeichen' },
      { ok: unique >= 6, text: 'Mindestens 6 verschiedene Zeichen' },
      { ok: pw.length > 0 && !(username.length >= 3 && pw.toLowerCase().includes(username)), text: 'Enthält nicht deinen Benutzernamen' },
      { ok: pw.length > 0 && pw !== oldPw, text: 'Unterscheidet sich vom bisherigen Passwort' }
    ];
  }
  function showChangePassword(forced) {
    const username = (state.profile && state.profile.username) || '';
    const oldF = passwordField('oldpw', forced ? 'Vorläufiges Passwort (vom Admin)' : 'Aktuelles Passwort', 'current-password');
    const newF = passwordField('newpw', 'Neues Passwort', 'new-password');
    const repF = passwordField('reppw', 'Neues Passwort wiederholen', 'new-password');
    const msg = h('div', { id: 'msg' });
    const list = h('ul', { class: 'rules', 'aria-live': 'polite' });
    const bar = h('i');
    const meter = h('div', { class: 'meter', 'aria-hidden': 'true' }, bar);
    const submit = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Passwort speichern');
    function refresh() {
      const rules = checkRules(newF.input.value, username, oldF.input.value);
      list.replaceChildren(...rules.map(function (r) { return h('li', { class: r.ok ? 'ok' : '' }, DP.icon(r.ok ? 'check' : 'circle'), r.text); }));
      const score = rules.filter(function (r) { return r.ok; }).length + (newF.input.value.length >= 16 ? 1 : 0);
      bar.style.width = (score / 5 * 100) + '%';
      bar.style.background = score >= 5 ? 'var(--success)' : score >= 4 ? 'var(--accent)' : 'var(--danger)';
    }
    [oldF.input, newF.input].forEach(function (i) { i.addEventListener('input', refresh); });
    refresh();
    const form = h('form', { class: 'stack', novalidate: true }, oldF.node, newF.node, meter, list, repF.node, msg, submit);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      msg.replaceChildren();
      if (newF.input.value !== repF.input.value) { msg.append(alertBox('error', 'Die beiden neuen Passwörter stimmen nicht überein.')); return; }
      setBusy(submit, true);
      const r = await DP.api('accChangePassword', { session: state.session.token, oldPassword: oldF.input.value, newPassword: newF.input.value, remember: state.remember });
      if (r.status === 'success') {
        store.save(r.session, r.expires, state.remember);
        state.session = { token: r.session, expires: r.expires };
        DP.toast('Passwort gespeichert. Alle anderen Geräte wurden abgemeldet.');
        return showHome();
      }
      setBusy(submit, false, 'Passwort speichern');
      if (r.code === 'AUTH') return expired();
      const e2 = errorText(r);
      msg.append(alertBox(e2.kind, e2.text));
    });
    const back = forced ? h('button', { type: 'button', class: 'btn btn-ghost btn-block' }, DP.icon('logout', 'sm'), 'Abmelden') : h('button', { type: 'button', class: 'btn btn-ghost btn-block' }, 'Abbrechen');
    back.addEventListener('click', forced ? logout : showHome);
    view(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
      h('div', { class: 'head' }, logoMark(), h('div', {}, h('h1', { text: forced ? 'Neues Passwort festlegen' : 'Passwort ändern' }),
        h('p', { class: 'muted', text: forced ? 'Aus Sicherheitsgründen musst du das vorläufige Passwort jetzt durch dein eigenes ersetzen.' : 'Nach dem Ändern werden alle anderen Geräte abgemeldet.' }))),
      h('div', { class: 'card' }, form), h('div', { style: null }, back))));
    oldF.input.focus();
  }

  // ---------- Startseite ----------
  function greeting() {
    const hr = new Date().getHours();
    return hr < 11 ? 'Guten Morgen' : hr < 18 ? 'Guten Tag' : 'Guten Abend';
  }
  function tile(icon, title, sub, onClick) {
    const subEl = h('p', { class: 'small muted', text: sub });
    const badge = h('span', { class: 'badge info hidden' });
    const el = h('div', { class: 'tile tile-link t-' + icon, role: 'button', tabindex: '0', 'aria-label': title + ' öffnen' },
      h('div', { class: 'ico' }, DP.icon(icon)), h('div', { class: 'grow' }, h('h3', { text: title }), subEl, badge), DP.icon('chevright', 'chev'));
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
    return { el: el, sub: subEl, badge: badge };
  }
  function showBadge(badge, text, kind) { badge.textContent = text; badge.className = 'badge ' + (kind || 'info'); }
  function showHome() {
    navDepth = 0;
    const p = state.profile || {};
    const first = String(p.name || p.username || '').split(/\s+/)[0] || 'Kollege';
    const logoutBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Abmelden' }, DP.icon('logout', 'sm'), 'Abmelden');
    logoutBtn.addEventListener('click', logout);
    const tPlan = tile('calendar', 'Mein Dienstplan', 'Lädt …', showShifts);
    const tSick = tile('pluscircle', 'Krankmeldung', 'Direkt an den Admin melden', showSick);
    const tReq = tile('swap', 'Anträge', 'Urlaub, Tausch oder Änderung', showRequests);
    const tHours = tile('clock', 'Meine Stunden', 'Gesendete und korrigierte Stunden', showHours);
    const tMsg = tile('chat', 'Nachrichten', 'Schreibe dem Admin', showMessages);
    const tOpen = tile('plus', 'Offene Schichten', 'Zusätzliche Schichten übernehmen', showOpen);
    const offlineBox = h('div', {});
    const changeBtn = h('button', { type: 'button', class: 'btn btn-secondary' }, DP.icon('key', 'sm'), 'Passwort ändern');
    changeBtn.addEventListener('click', function () { showChangePassword(false); });
    const allBtn = h('button', { type: 'button', class: 'btn btn-secondary' }, DP.icon('logout', 'sm'), 'Auf allen Geräten abmelden');
    allBtn.addEventListener('click', async function () {
      if (!(await DP.confirm('Auf allen Geräten abmelden?', 'Du wirst überall abgemeldet, auch auf diesem Gerät. Danach musst du dich neu anmelden.', 'Überall abmelden', 'danger'))) return;
      await DP.api('accLogoutAll', { session: state.session.token });
      clearCaches();
      store.clear();
      showLogin('Du wurdest auf allen Geräten abgemeldet.');
    });
    const heroLab = h('div', { class: 'lab', text: 'Nächste Schicht' });
    const heroBig = h('div', { class: 'big', text: 'Lädt …' });
    const heroSub = h('div', { class: 'sub' });
    view(h('div', {},
      h('div', { class: 'top-gradient' },
        h('header', { class: 'app-top wide' }, h('div', { class: 'inner' }, h('div', { class: 'brand' }, h('div', { class: 'mark' }, DP.icon('calendar')), 'Dienstplan'), h('div', { class: 'grow' }), logoutBtn)),
        h('section', { class: 'hero' }, h('div', { class: 'inner' },
          h('div', { class: 'row hero-id' }, h('div', { class: 'avatar lg', text: DP.initials(p.name || p.username) }),
            h('div', {}, h('h2', { text: greeting() + ', ' + first + '!' }), h('p', { class: 'dateline', text: PD.long(PD.today()) }))),
          h('div', { class: 'hero-next' }, heroLab, heroBig, heroSub)))),
      h('main', { class: 'page wide stack' }, offlineBox,
        h('div', { class: 'tiles' }, tPlan.el, tSick.el, tReq.el, tHours.el, tMsg.el, tOpen.el),
        h('section', { class: 'card stack-sm' }, h('h3', { text: 'Dein Zugang' }),
          h('dl', { class: 'kv' },
            h('dt', { text: 'Benutzername' }), h('dd', { class: 'mono', text: p.username || '' }),
            p.pwChanged ? [h('dt', { text: 'Passwort geändert' }), h('dd', { text: DP.fmtDate(p.pwChanged) })] : null),
          h('div', { class: 'row wrap' }, changeBtn, allBtn)))));
    loadHome().then(function (r) {
      if (!r) return;
      if (r.status !== 'success') { tPlan.sub.textContent = 'Der Dienstplan konnte nicht geladen werden.'; heroBig.textContent = 'Nicht verfügbar'; return; }
      if (r.offlineAt) offlineBox.replaceChildren(offlineBanner(r.offlineAt));
      tPlan.sub.textContent = planPreview(r);
      const nx = nextShift(r.shifts || []);
      if (nx) {
        const running = shiftStart(nx) <= new Date();
        heroLab.textContent = running ? 'Läuft gerade' : 'Nächste Schicht';
        heroBig.textContent = running ? 'Bis ' + nx.end + ' Uhr' : relDay(nx.date) + ' · ' + nx.start + ' Uhr';
        heroSub.textContent = nx.place + ' · ' + PD.long(nx.date) + ' · ' + PD.fmtHours(nx.hours) + ' Std.';
      } else {
        heroBig.textContent = 'Noch keine Schicht';
        heroSub.textContent = 'Sobald der Admin deinen Plan veröffentlicht, steht er hier.';
      }
      const n = newCount(r);
      if (n > 0) showBadge(tPlan.badge, n + ' neu / geändert');
      if (r.decidedRequests > 0) showBadge(tReq.badge, r.decidedRequests + (r.decidedRequests === 1 ? ' Antwort' : ' Antworten') + ' vom Admin', 'success');
      else if (r.openRequests > 0) tReq.sub.textContent = r.openRequests + (r.openRequests === 1 ? ' Antrag offen' : ' Anträge offen');
      if (r.unreadMessages > 0) showBadge(tMsg.badge, r.unreadMessages + ' neue Nachricht' + (r.unreadMessages === 1 ? '' : 'en'));
      DP.api('accMyHours', { session: state.session.token }).then(function (hr) {
        if (!hr || hr.status !== 'success' || !(hr.summaries || []).length) return;
        let seen = null; try { seen = localStorage.getItem(hoursSigKey()); } catch (e) { /* ignorieren */ }
        const sig = hoursSignature(hr);
        if (seen === null) { try { localStorage.setItem(hoursSigKey(), sig); } catch (e) { /* ignorieren */ } return; }   // erster Besuch: nichts als neu markieren
        if (seen !== sig) showBadge(tHours.badge, 'Neu / geändert');
      });
      const sick = (r.absences || []).filter(function (x) { return x.type === 'krank' && x.to >= PD.today(); })[0];
      if (sick) tSick.sub.textContent = 'Aktuell gemeldet bis ' + PD.short(sick.to);
      if (r.decidedSick > 0) showBadge(tSick.badge, 'Vom Admin bestätigt', 'success');
    });
    call('accOpenShifts').then(function (o) {
      if (!o || o.status !== 'success' || o.offlineAt) return;
      const n = (o.shifts || []).filter(function (s) { return s.fits; }).length;
      if (n) { tOpen.sub.textContent = n + (n === 1 ? ' Schicht ist frei' : ' Schichten sind frei'); showBadge(tOpen.badge, n + ' frei'); }
    });
  }

  // ---------- Offene Schichten ----------
  function showOpen() {
    const list = h('div', { class: 'stack-sm' }, spinnerCard());
    async function load() {
      const r = await call('accOpenShifts');
      if (!r) return;
      if (r.status !== 'success') { list.replaceChildren(alertBox('error', r.message || 'Die offenen Schichten konnten nicht geladen werden.')); return; }
      curPlaceInfo = r.placeInfo || {};
      const nodes = [];
      if (r.offlineAt) nodes.push(offlineBanner(r.offlineAt));
      if (!r.shifts.length) nodes.push(h('div', { class: 'card empty-card' }, h('div', { class: 'ico' }, DP.icon('plus')), h('h3', { text: 'Gerade keine offenen Schichten' }), h('p', { class: 'small', text: 'Wenn der Planer zusätzliche Schichten ausschreibt, findest du sie hier. Du bekommst dann auch eine Nachricht.' })));
      r.shifts.forEach(function (s) {
        const btn = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, DP.icon('plus', 'sm'), 'Übernehmen');
        btn.disabled = !!r.offlineAt;
        btn.addEventListener('click', async function () {
          if (!(await DP.confirm('Schicht übernehmen?', PD.short(s.date) + ' · ' + s.start + '–' + s.end + ' Uhr · ' + s.place + '. Sie steht danach in deinem Dienstplan.', 'Übernehmen', 'primary'))) return;
          const x = await call('accClaimShift', { id: s.id });
          if (x && x.status === 'success') DP.toast('Schicht übernommen. Sie steht jetzt in deinem Dienstplan.');
          else if (x) DP.toast(x.message || 'Das hat nicht geklappt.', 'error');
          load();
        });
        nodes.push(h('div', { class: 'openwrap stack-sm' }, shiftCard(s, 0, false), s.fits ? h('div', {}, btn) : h('div', { class: 'small muted', text: s.reason || 'Passt nicht zu deinem Plan.' })));
      });
      list.replaceChildren(...nodes);
    }
    screen('Offene Schichten', [h('p', { class: 'muted small', text: 'Diese Schichten sind noch frei. Wenn du eine übernimmst, ist sie sofort deine.' }), list]);
    load();
  }

  // ---------- Dienstplan ----------
  function seenKey() { return 'dp_shifts_seen_v1:' + ((state.profile && state.profile.username) || ''); }
  function getSeen() { try { return Number(localStorage.getItem(seenKey())) || 0; } catch (e) { return 0; } }
  function setSeen(ts) { try { localStorage.setItem(seenKey(), String(ts)); } catch (e) { /* ignorieren */ } }
  function shiftStart(s) { return PD.startDate(s.date, s.start); }
  function shiftEnd(s) { return new Date(shiftStart(s).getTime() + Math.round(s.hours * 60) * 60000); }
  function relDay(date) {
    const d = PD.diff(PD.today(), date);
    return d === 0 ? 'Heute' : d === 1 ? 'Morgen' : d === 2 ? 'Übermorgen' : d > 0 ? 'In ' + d + ' Tagen' : 'Vor ' + (-d) + ' Tagen';
  }
  function nextShift(list) {
    const now = new Date();
    return list.filter(function (s) { return s.status !== 'abgesagt' && shiftEnd(s) > now; })[0] || null;
  }
  function newCount(r) {
    const seen = getSeen();
    if (!seen) return 0;
    const now = new Date();
    return r.shifts.filter(function (s) { return s.updated > seen && shiftEnd(s) > now; }).length;
  }
  function planPreview(r) {
    if (r.status !== 'success') return 'Der Dienstplan konnte nicht geladen werden.';
    const n = nextShift(r.shifts);
    if (!n) return 'Noch keine Schichten veröffentlicht.';
    return (shiftStart(n) <= new Date() ? 'Läuft gerade: ' : 'Nächste Schicht: ') + PD.short(n.date) + ' ' + n.start + '–' + n.end + ' · ' + n.place;
  }
  // Offline: der zuletzt geladene Plan bleibt lesbar (nur auf diesem Gerät, wird beim Abmelden gelöscht)
  const CACHE_ACTIONS = { accHome: 1, accMyShifts: 1, accOpenShifts: 1 };
  function cacheKey(action) { return 'dp_cache_' + action + '_v1:' + ((state.profile && state.profile.username) || ''); }
  function clearCaches() { try { Object.keys(localStorage).filter(function (k) { return k.indexOf('dp_cache_') === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* ignorieren */ } }
  function offlineBanner(ts) { return alertBox('info', 'Keine Verbindung. Du siehst den Stand von ' + DP.fmtDate(ts) + '.'); }
  async function call(action, payload) {
    const r = await DP.api(action, Object.assign({ session: state.session.token }, payload || {}));
    if (CACHE_ACTIONS[action]) {
      if (r.status === 'success') { try { localStorage.setItem(cacheKey(action), JSON.stringify({ ts: Date.now(), r: r })); } catch (e) { /* ignorieren */ } }
      else if (r.code === 'NETWORK') {
        try { const c = JSON.parse(localStorage.getItem(cacheKey(action))); if (c && c.r && c.r.status === 'success') return Object.assign({}, c.r, { offlineAt: c.ts }); } catch (e) { /* ignorieren */ }
      }
    }
    if (r.code === 'AUTH') { expired(); return null; }
    if (r.code === 'MUST_CHANGE') { showChangePassword(true); return null; }
    if (r.code === 'MAINTENANCE') { showMaintenance(r.message); return null; }
    return r;
  }
  function seenKeyFor(kind) { return kind === 'shifts' ? seenKey() : 'dp_seen_' + kind + '_v1:' + ((state.profile && state.profile.username) || ''); }
  function seenGet(kind) { try { return Number(localStorage.getItem(seenKeyFor(kind))) || 0; } catch (e) { return 0; } }
  function seenSet(kind, ts) { try { localStorage.setItem(seenKeyFor(kind), String(ts || Date.now())); } catch (e) { /* ignorieren */ } }
  async function loadShifts(range) { return call('accMyShifts', range ? { from: range.from, to: range.to } : undefined); }
  async function loadHome() {
    ['requests', 'messages'].forEach(function (k) { if (!seenGet(k)) seenSet(k, Date.now()); });   // erster Besuch: nichts als "neu" markieren
    const r = await call('accHome', { sinceRequests: seenGet('requests'), sinceMessages: seenGet('messages') });
    if (r && r.status === 'success') state.shifts = r;
    return r;
  }
  let curPlaceInfo = {};
  function placeInfoNode(place) {
    const i = curPlaceInfo && curPlaceInfo[place];
    if (!i) return null;
    const rows = [['Adresse', i.address], ['Ansprechpartner', i.contact], ['Hinweis', i.note]].filter(function (x) { return x[1]; });
    return rows.length ? h('details', { class: 'pinfo' }, h('summary', { text: 'Infos zum Standort' }), h('dl', { class: 'kv' }, rows.map(function (x) { return [h('dt', { text: x[0] }), h('dd', { text: x[1] })]; }))) : null;
  }
  function shiftCard(s, seen, past) {
    const d = PD.parse(s.date), cancelled = s.status === 'abgesagt', isToday = s.date === PD.today();
    const isNew = !cancelled && seen && s.updated > seen;
    return h('div', { class: 'shift' + (isToday ? ' today' : '') + (cancelled ? ' cancelled' : '') + (past ? ' past' : '') + DP.placeClass(s.place) },
      h('div', { class: 'dbadge' }, h('div', { class: 'wd', text: PD.WD[PD.weekday(s.date)] }), h('div', { class: 'dn', text: String(d.getUTCDate()) })),
      h('div', { class: 'grow' },
        h('div', { class: 'row wrap' }, h('span', { class: 'what', text: s.place }),
          cancelled ? h('span', { class: 'badge danger', text: 'Abgesagt' }) : null,
          isNew ? h('span', { class: 'badge info', text: 'Neu / geändert' }) : null,
          isToday && !cancelled ? h('span', { class: 'badge success', text: 'Heute' }) : null),
        h('div', { class: 'when', text: s.start + ' – ' + s.end + ' Uhr · ' + PD.fmtHours(s.hours) + ' Std.' }),
        s.note ? h('div', { class: 'note' }, DP.icon('sticky', 'sm'), h('span', { text: s.note })) : null,
        cancelled ? null : placeInfoNode(s.place)));
  }
  function showShifts() {
    pushScreen();
    const seen0 = getSeen();
    let showPast = false, showCancelled = false, last = null, range = null;   // range: { from, to } beim Blättern
    const body = h('div', {}, h('div', { class: 'empty-card' }, h('span', { class: 'spinner' })));
    const back = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Zurück zur Startseite' }, DP.icon('chevleft', 'sm'), 'Zurück');
    const refreshBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Aktualisieren' }, DP.icon('refresh', 'sm'));
    back.addEventListener('click', backHome);
    refreshBtn.addEventListener('click', function () { load(); });
    function render(r) {
      const nodes = [];
      if (r.status !== 'success') {
        const retry = h('button', { type: 'button', class: 'btn btn-primary' }, DP.icon('refresh', 'sm'), 'Erneut versuchen');
        retry.addEventListener('click', function () { load(); });
        body.replaceChildren(h('div', { class: 'stack' }, alertBox('error', r.message || 'Der Dienstplan konnte nicht geladen werden.'), retry));
        return;
      }
      curPlaceInfo = r.placeInfo || {};
      if (r.offlineAt) nodes.push(offlineBanner(r.offlineAt));
      const now = new Date();
      const upcoming = r.shifts.filter(function (s) { return shiftEnd(s) > now; });
      const past = r.shifts.filter(function (s) { return shiftEnd(s) <= now; }).reverse();
      const n = nextShift(r.shifts);
      if (n) {
        const running = shiftStart(n) <= now;
        nodes.push(h('div', { class: 'next' }, h('div', { class: 'lab', text: running ? 'Läuft gerade' : 'Nächste Schicht' }),
          h('div', { class: 'big', text: (running ? 'Bis ' + n.end + ' Uhr' : relDay(n.date)) + ' · ' + PD.long(n.date) }),
          h('div', { class: 'sub', text: n.start + ' – ' + n.end + ' Uhr · ' + n.place + ' · ' + PD.fmtHours(n.hours) + ' Std.' }),
          n.note ? h('div', { class: 'sub', text: 'Hinweis: ' + n.note }) : null));
      }
      (r.absences || []).filter(function (x) { return x.to >= PD.today(); }).forEach(function (x) {
        const when = x.from === x.to ? PD.short(x.from) : PD.short(x.from) + ' – ' + PD.short(x.to);
        nodes.push(h('div', { class: 'abscard' + (x.type === 'krank' ? ' krank' : '') }, DP.icon(x.type === 'krank' ? 'pluscircle' : 'sun'),
          h('span', { text: (x.type === 'krank' ? 'Krank gemeldet' : x.status === 'genehmigt' ? 'Urlaub (genehmigt)' : 'Urlaub (beantragt)') + ' · ' + when })));
      });
      const live = upcoming.filter(function (s) { return s.status !== 'abgesagt'; });
      const cancelled = upcoming.filter(function (s) { return s.status === 'abgesagt'; });
      if (!upcoming.length) {
        nodes.push(h('div', { class: 'card empty-card' }, h('div', { class: 'ico' }, DP.icon('calendar')), h('h3', { text: 'Noch keine Schichten' }),
          h('p', { class: 'small', text: 'Sobald der Admin deinen Plan veröffentlicht, erscheinen deine Schichten hier.' })));
      }
      let month = '';
      live.forEach(function (s) {
        const m = PD.monthLabel(s.date);
        if (m !== month) { month = m; nodes.push(h('div', { class: 'month-h', text: m })); }
        nodes.push(shiftCard(s, seen0, false));
      });
      if (cancelled.length) {
        // Abgesagte Schichten stehen gesammelt am Ende, damit sie den Plan nicht zuschütten.
        const tg = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, showCancelled ? 'Abgesagte ausblenden' : cancelled.length + (cancelled.length === 1 ? ' abgesagte Schicht anzeigen' : ' abgesagte Schichten anzeigen'));
        tg.addEventListener('click', function () { showCancelled = !showCancelled; render(last); });
        nodes.push(h('div', { class: 'center' }, tg));
        if (showCancelled) cancelled.forEach(function (s) { nodes.push(shiftCard(s, seen0, false)); });
      }
      if (past.length) {
        const tg = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, showPast ? 'Frühere Schichten ausblenden' : 'Frühere Schichten anzeigen (' + past.length + ')');
        tg.addEventListener('click', function () { showPast = !showPast; render(last); });
        nodes.push(h('div', { class: 'center' }, tg));
        if (showPast) past.forEach(function (s) { nodes.push(shiftCard(s, 0, true)); });
      }
      const ics = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, DP.icon('download', 'sm'), 'In Kalender übernehmen (.ics)');
      ics.addEventListener('click', function () { downloadIcs(live); });
      if (live.length) nodes.push(h('div', { class: 'stack-sm' }, ics));
      // Monate blättern, wenn der Admin es freigegeben hat
      if (r.monthView) {
        const cur = range ? range.from.slice(0, 7) : PD.today().slice(0, 7);
        const jump = function (n) {
          const m = PD.monthAdd(cur + '-01', n).slice(0, 7);
          const first = m + '-01', lastD = PD.add(PD.monthAdd(first, 1), -1);
          range = (m === PD.today().slice(0, 7) && n === 0) ? null : { from: first, to: lastD };
          load();
        };
        const prev = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'aria-label': 'Voriger Monat' }, DP.icon('chevleft', 'sm'));
        const next = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'aria-label': 'Nächster Monat' }, DP.icon('chevright', 'sm'));
        const now2 = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Aktuell' });
        const pick = function (m) { const d = m + '-01'; range = (m === PD.today().slice(0, 7)) ? null : { from: d, to: PD.add(PD.monthAdd(d, 1), -1) }; load(); };
        const jumpInp = monthJumpBtn(cur, pick);
        prev.addEventListener('click', function () { jump(-1); }); next.addEventListener('click', function () { jump(1); });
        now2.addEventListener('click', function () { range = null; load(); });
        nodes.push(h('div', { class: 'monthnav' }, prev, h('strong', { text: range ? PD.monthLabel(range.from) : 'Nächste Wochen' }), next, jumpInp, range ? now2 : null));
      }
      const sum = live.reduce(function (a, s) { return a + (Number(s.hours) || 0); }, 0);
      if (live.length) nodes.push(h('p', { class: 'center muted small', text: live.length + (live.length === 1 ? ' Schicht' : ' Schichten') + ' · zusammen ' + PD.fmtHours(sum) + ' Std.' }));
      const t = new Date(r.now || Date.now());
      nodes.push(h('p', { class: 'center muted small', text: 'Aktualisiert um ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ' Uhr' }));
      body.replaceChildren(...nodes);
    }
    async function load() {
      const r = await loadShifts(range);
      if (!r) return;
      if (r.status !== 'success' && range) { range = null; const r2 = await loadShifts(null); if (r2) { last = r2; render(r2); return; } }
      last = r; render(r);
      if (r.status === 'success') setSeen(Date.now());
    }
    view(h('div', {},
      h('header', { class: 'app-top' }, h('div', { class: 'inner' }, back, h('div', { class: 'grow center' }, h('strong', { text: 'Mein Dienstplan' })), refreshBtn)),
      h('main', { class: 'page' }, body)));
    refreshTimer = setInterval(function () { if (document.visibilityState === 'visible') load(); }, 60000);
    load();
  }

  // ---------- Kalender-Export ----------
  function icsEscape(t) { return String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function icsStamp(d) { const p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + 'T' + p(d.getHours()) + p(d.getMinutes()) + '00'; }
  function buildIcs(list) {
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dienstplan//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Mein Dienstplan'];
    list.forEach(function (s) {
      const st = shiftStart(s), en = shiftEnd(s);
      lines.push('BEGIN:VEVENT', 'UID:' + s.id + '@dienstplan', 'DTSTAMP:' + stamp, 'DTSTART:' + icsStamp(st), 'DTEND:' + icsStamp(en),
        'SUMMARY:' + icsEscape('Schicht: ' + s.place), 'LOCATION:' + icsEscape(s.place));
      if (s.note) lines.push('DESCRIPTION:' + icsEscape(s.note));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }
  function downloadIcs(list) {
    const blob = new Blob([buildIcs(list)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'dienstplan.ics' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    DP.toast('Kalenderdatei erstellt.');
  }

  // ---------- Gemeinsames Gerüst für Unterseiten ----------
  // Der Zurück-Knopf des Handys und des Browsers soll zur Startseite führen, nicht aus der App heraus.
  let navDepth = 0;
  function pushScreen() { if (!navDepth) { try { history.pushState({ dp: 1 }, ''); navDepth = 1; } catch (e) { /* nicht möglich */ } } }
  function backHome() { if (navDepth) { try { history.back(); return; } catch (e) { navDepth = 0; } } showHome(); }   // showHome kommt über popstate
  window.addEventListener('popstate', function () { if (navDepth) { navDepth = 0; showHome(); } });
  // Eigene Monatsauswahl: funktioniert in jedem Browser gleich (kein verstecktes Browser-Feld).
  let monthPopEl = null, monthPopOff = null;
  function closeMonthPop() {
    if (monthPopEl) { monthPopEl.remove(); monthPopEl = null; }
    if (monthPopOff) { document.removeEventListener('mousedown', monthPopOff, true); document.removeEventListener('keydown', monthPopOff, true); monthPopOff = null; }
  }
  function openMonthPop(anchor, valueMonth, onPick) {
    closeMonthPop();
    const cur = /^\d{4}-\d{2}$/.test(valueMonth) ? valueMonth : PD.today().slice(0, 7);
    let year = Number(cur.slice(0, 4));
    const pop = h('div', { class: 'monthpop', role: 'dialog', 'aria-label': 'Monat wählen' });
    const draw = function () {
      const prev = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Vorjahr' }, DP.icon('chevleft', 'sm'));
      const next = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Nächstes Jahr' }, DP.icon('chevright', 'sm'));
      prev.addEventListener('click', function () { year -= 1; draw(); });
      next.addEventListener('click', function () { year += 1; draw(); });
      const grid = PD.MONTHS.map(function (name, i) {
        const m = year + '-' + String(i + 1).padStart(2, '0');
        const b = h('button', { type: 'button', class: 'monthpop-m' + (m === cur ? ' on' : ''), text: name.slice(0, 3), title: name + ' ' + year });
        b.addEventListener('click', function () { closeMonthPop(); onPick(m); });
        return b;
      });
      pop.replaceChildren(h('div', { class: 'monthpop-head' }, prev, h('strong', { text: String(year) }), next), h('div', { class: 'monthpop-grid' }, grid));
    };
    draw();
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = Math.min(r.bottom + 6, window.innerHeight - 250) + 'px';
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 248)) + 'px';
    monthPopEl = pop;
    monthPopOff = function (e) {
      if (e.type === 'keydown') { if (e.key === 'Escape') closeMonthPop(); return; }
      if (!pop.contains(e.target) && !anchor.contains(e.target)) closeMonthPop();
    };
    document.addEventListener('mousedown', monthPopOff, true);
    document.addEventListener('keydown', monthPopOff, true);
  }
  function monthJumpBtn(valueMonth, onPick) {
    const btn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm monthjump', 'aria-label': 'Zu einem Monat springen', title: 'Zu einem Monat springen', 'aria-haspopup': 'dialog' }, DP.icon('calendar', 'sm'));
    btn.addEventListener('click', function () { if (monthPopEl) closeMonthPop(); else openMonthPop(btn, valueMonth, onPick); });
    return btn;
  }
  function screen(title, body, opts) {
    opts = opts || {};
    pushScreen();
    const back = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Zurück zur Startseite' }, DP.icon('chevleft', 'sm'), 'Zurück');
    back.addEventListener('click', backHome);
    view(h('div', {},
      h('header', { class: 'app-top' }, h('div', { class: 'inner' }, back, h('div', { class: 'grow center' }, h('strong', { text: title })), opts.right || h('span', { class: 'btn btn-sm hidden' }))),
      h('main', { class: 'page stack' }, body)));
  }
  function spinnerCard() { return h('div', { class: 'empty-card' }, h('span', { class: 'spinner' })); }
  function chipBtn(label, active, fn) { const b = h('button', { type: 'button', class: 'chip' + (active ? ' active' : ''), text: label }); b.addEventListener('click', fn); return b; }
  function field(label, input, id, hint) { return h('div', { class: 'field' }, h('label', { for: id, text: label }), input, hint ? h('div', { class: 'hint', text: hint }) : null); }

  // ---------- Anträge und Krankmeldungen: Karten ----------
  const REQ_ICON = { krank: 'pluscircle', urlaub: 'sun', tausch: 'swap', aenderung: 'clock', verfuegbar: 'x' };
  function statusOf(q) {
    if (q.type === 'verfuegbar') return q.status === 'genehmigt' ? ['Eingetragen', 'success'] : ['Zurückgezogen', 'neutral'];
    if (q.type === 'krank') return q.status === 'offen' ? ['Gemeldet', 'info'] : q.status === 'genehmigt' ? ['Bestätigt', 'success'] : ['Zurückgezogen', 'neutral'];
    return ({ offen: ['Offen', 'info'], genehmigt: ['Genehmigt', 'success'], abgelehnt: ['Abgelehnt', 'danger'], zurueckgezogen: ['Zurückgezogen', 'neutral'] })[q.status] || [q.status, 'neutral'];
  }
  function requestCard(q, seen, onChange) {
    const st = statusOf(q);
    const when = q.from === q.to ? PD.short(q.from) : PD.short(q.from) + ' – ' + PD.short(q.to);
    const isNew = seen && q.status !== 'offen' && q.status !== 'zurueckgezogen' && q.updated > seen && q.source === 'mitarbeiter';
    const body = h('div', { class: 'grow stack-sm' },
      h('div', { class: 'row wrap' }, h('span', { class: 't', text: q.label }), h('span', { class: 'badge ' + st[1], text: st[0] }), isNew ? h('span', { class: 'badge success', text: 'Neu' }) : null),
      h('div', { class: 'sub', text: when + (q.shift ? ' · ' + q.shift.start + '–' + q.shift.end + ' · ' + q.shift.place : '') }),
      q.text ? h('div', { class: 'note' }, DP.icon('sticky', 'sm'), h('span', { text: q.text })) : null,
      q.wish ? h('div', { class: 'note' }, DP.icon('clock', 'sm'), h('span', { text: 'Dein Wunsch: ' + [q.wish.start || q.wish.end ? (q.wish.start || '…') + '–' + (q.wish.end || '…') + ' Uhr' : '', q.wish.place || ''].filter(Boolean).join(' · ') })) : null,
      q.reply ? h('div', { class: 'note reply' }, DP.icon('chat', 'sm'), h('span', { text: 'Antwort vom Admin: ' + q.reply })) : null,
      q.affected && q.affected.length && q.status !== 'zurueckgezogen' ? h('div', { class: 'sub', text: 'Betrifft ' + q.affected.length + (q.affected.length === 1 ? ' Schicht' : ' Schichten') + ': ' + q.affected.map(function (x) { return PD.short(x.date); }).join(', ') }) : null);
    if (q.status === 'offen' || (q.type === 'verfuegbar' && q.status === 'genehmigt')) {
      const w = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, DP.icon('x', 'sm'), q.type === 'verfuegbar' ? 'Eintrag löschen' : 'Zurückziehen');
      w.addEventListener('click', async function () {
        const un = q.type === 'verfuegbar';
        if (!(await DP.confirm(un ? 'Eintrag löschen?' : 'Zurückziehen?', un ? 'Du bist an diesen Tagen danach wieder einplanbar.' : 'Der Admin sieht deinen Eintrag danach nicht mehr als offen.', un ? 'Löschen' : 'Zurückziehen', 'danger'))) return;
        const r = await call('accRequestWithdraw', { id: q.id });
        if (r && r.status === 'success') { DP.toast(un ? 'Eintrag gelöscht.' : 'Zurückgezogen.'); onChange(); } else if (r) DP.toast(r.message || 'Das hat nicht geklappt.', 'error');
      });
      body.append(h('div', {}, w));
    }
    return h('div', { class: 'reqcard ' + q.type }, h('div', { class: 'ico' }, DP.icon(REQ_ICON[q.type] || 'file')), body);
  }

  // ---------- Krankmeldung ----------
  function showSick() {
    const today = PD.today();
    const from = h('input', { class: 'input', id: 'sk_from', type: 'date', value: today });
    const to = h('input', { class: 'input', id: 'sk_to', type: 'date', value: today });
    const note = h('input', { class: 'input', id: 'sk_note', type: 'text', maxlength: '300', placeholder: 'Optional, zum Beispiel Rückrufnummer' });
    const msg = h('div', {});
    const list = h('div', { class: 'stack-sm' });
    const submit = h('button', { type: 'button', class: 'btn btn-primary btn-block' }, 'Krank melden');
    const quick = h('div', { class: 'quick' }, [['Heute', 0], ['2 Tage', 1], ['3 Tage', 2], ['1 Woche', 6]].map(function (q) {
      return chipBtn(q[0], false, function () { to.value = PD.add(from.value || today, q[1]); });
    }));
    async function refreshList() {
      const r = await call('accRequests');
      if (!r || r.status !== 'success') return;
      const sick = r.requests.filter(function (q) { return q.type === 'krank'; });
      list.replaceChildren(...(sick.length ? [h('h3', { text: 'Deine Meldungen' })].concat(sick.map(function (q) { return requestCard(q, 0, refreshList); })) : []));
    }
    submit.addEventListener('click', async function () {
      msg.replaceChildren();
      if (!from.value || !to.value || to.value < from.value) { msg.append(alertBox('error', 'Bitte gib einen gültigen Zeitraum an. Das Ende darf nicht vor dem Beginn liegen.')); return; }
      setBusy(submit, true);
      const r = await call('accRequestCreate', { type: 'krank', from: from.value, to: to.value, text: note.value });
      if (!r) return;
      setBusy(submit, false, 'Krank melden');
      if (r.status !== 'success') { msg.append(alertBox(r.code === 'RATE_LIMIT' ? 'warn' : 'error', r.message || 'Das hat nicht geklappt.')); return; }
      note.value = '';
      const aff = (r.request.affected || []);
      msg.append(alertBox('success', 'Deine Krankmeldung ist beim Admin angekommen. Gute Besserung!' + (aff.length ? ' Betroffen: ' + aff.map(function (x) { return PD.short(x.date) + ' ' + x.start + '–' + x.end; }).join(', ') + '.' : '')));
      refreshList();
    });
    seenSet('requests', Date.now());
    screen('Krankmeldung', [
      h('div', { class: 'alert info' }, DP.icon('shield', 'sm'), h('div', { text: 'Teile dem Admin mit, dass du ausfällst. Bitte nenne keine Diagnose, es reicht der Zeitraum.' })),
      h('div', { class: 'card stack' }, h('div', { class: 'grid2' }, field('Von', from, 'sk_from'), field('Bis (einschließlich)', to, 'sk_to')), quick, field('Hinweis (optional)', note, 'sk_note'), msg, submit),
      list]);
    refreshList();
  }

  // ---------- Anträge ----------
  function showRequests() {
    const seen0 = seenGet('requests');
    const list = h('div', { class: 'stack-sm' }, spinnerCard());
    const newBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block' }, DP.icon('plus', 'sm'), 'Neuer Antrag');
    newBtn.addEventListener('click', function () { openTypePicker(load); });
    async function load() {
      const r = await call('accRequests');
      if (!r) return;
      if (r.status !== 'success') { list.replaceChildren(alertBox('error', r.message || 'Die Anträge konnten nicht geladen werden.')); return; }
      const items = r.requests.filter(function (q) { return q.type !== 'krank'; });
      list.replaceChildren(...(items.length ? items.map(function (q) { return requestCard(q, seen0, load); })
        : [h('div', { class: 'card empty-card' }, h('div', { class: 'ico' }, DP.icon('swap')), h('h3', { text: 'Noch keine Anträge' }), h('p', { class: 'small', text: 'Hier kannst du Urlaub beantragen, eine Schicht tauschen oder eine Änderung anfragen.' }))]));
      seenSet('requests', Date.now());
    }
    screen('Anträge', [newBtn, list]);
    load();
  }
  function openTypePicker(onDone) {
    const opts = [['urlaub', 'sun', 'Urlaub / freier Tag', 'Für einen oder mehrere Tage'], ['verfuegbar', 'x', 'Nicht verfügbar', 'Tage, an denen du nicht arbeiten kannst. Der Planer sieht es sofort'], ['tausch', 'swap', 'Schicht tauschen oder abgeben', 'Eine deiner Schichten abgeben'], ['aenderung', 'clock', 'Zeit oder Standort ändern', 'Zum Beispiel später anfangen']];
    let picker;
    const nodes = opts.map(function (o) {
      const b = h('button', { type: 'button', class: 'pick' }, h('div', { class: 'ico' }, DP.icon(o[1])), h('div', {}, h('div', { class: 't', text: o[2] }), h('div', { class: 's', text: o[3] })));
      b.addEventListener('click', function () { picker.close(); openRequestForm(o[0], onDone); });
      return b;
    });
    picker = DP.modal({ title: 'Was möchtest du beantragen?', body: h('div', { class: 'stack-sm' }, nodes), actions: [{ label: 'Abbrechen', kind: 'secondary' }] });
  }
  function openRequestForm(type, onDone) {
    const today = PD.today();
    const msg = h('div', {});
    const text = h('textarea', { class: 'input textarea', id: 'rq_text', maxlength: '300', placeholder: type === 'urlaub' || type === 'verfuegbar' ? 'Optional, zum Beispiel Grund' : type === 'tausch' ? 'Optional, zum Beispiel „Tausch mit Karl wäre möglich“' : 'Was soll geändert werden? Zum Beispiel „ab 23:00 statt 22:00“' });
    const nodes = [];
    let from, to, pick;
    if (type === 'urlaub' || type === 'verfuegbar') {
      from = h('input', { class: 'input', id: 'rq_from', type: 'date', value: PD.add(today, 1) });
      to = h('input', { class: 'input', id: 'rq_to', type: 'date', value: PD.add(today, 1) });
      from.addEventListener('change', function () { if (to.value < from.value) to.value = from.value; });
      nodes.push(h('div', { class: 'grid2' }, field('Von', from, 'rq_from'), field('Bis (einschließlich)', to, 'rq_to')));
    } else {
      const shifts = ((state.shifts && state.shifts.shifts) || []).filter(function (s) { return s.status === 'veroeffentlicht' && s.date >= today; });
      if (!shifts.length) nodes.push(alertBox('info', 'Du hast keine anstehenden Schichten, für die ein Antrag möglich ist.'));
      pick = h('select', { class: 'input', id: 'rq_shift' }, shifts.map(function (s) { return h('option', { value: s.id, text: PD.short(s.date) + ' · ' + s.start + '–' + s.end + ' · ' + s.place }); }));
      nodes.push(field('Welche Schicht?', pick, 'rq_shift'));
    }
    let wStart, wEnd, wPlace;
    if (type === 'aenderung') {
      const cur = function () { const sh = ((state.shifts && state.shifts.shifts) || []).filter(function (s) { return s.id === (pick && pick.value); })[0]; return sh || {}; };
      wStart = h('input', { class: 'input', id: 'rq_wstart', type: 'time' });
      wEnd = h('input', { class: 'input', id: 'rq_wend', type: 'time' });
      wPlace = h('select', { class: 'input', id: 'rq_wplace' }, [h('option', { value: '', text: 'Standort bleibt gleich' })].concat(DP.PLACES.map(function (p) { return h('option', { value: p, text: p }); })));
      const prefill = function () { const c = cur(); wStart.value = c.start || ''; wEnd.value = c.end || ''; wPlace.value = ''; };
      pick.addEventListener('change', prefill); prefill();
      nodes.push(h('div', { class: 'grid2' }, field('Neuer Beginn', wStart, 'rq_wstart'), field('Neues Ende', wEnd, 'rq_wend')), field('Neuer Standort', wPlace, 'rq_wplace'),
        h('p', { class: 'hint', text: 'Ändere nur, was sich ändern soll. Das macht es für den Admin ein Klick. Du kannst zusätzlich etwas dazuschreiben.' }));
    }
    nodes.push(field(type === 'aenderung' ? 'Hinweis (optional)' : 'Hinweis (optional)', text, 'rq_text'), msg);
    const titles = { verfuegbar: 'Nicht verfügbar eintragen', urlaub: 'Urlaub / freier Tag', tausch: 'Schicht tauschen oder abgeben', aenderung: 'Zeit oder Standort ändern' };
    DP.modal({
      title: titles[type], wide: true, body: h('div', { class: 'stack' }, nodes),
      actions: [{ label: 'Abbrechen', kind: 'secondary' }, {
        label: 'Antrag senden', kind: 'primary', closes: false,
        onClick: async function (api) {
          msg.replaceChildren();
          const payload = { type: type, text: text.value };
          if (type === 'urlaub' || type === 'verfuegbar') { if (!from.value || !to.value || to.value < from.value) { msg.append(alertBox('error', 'Bitte gib einen gültigen Zeitraum an.')); return; } payload.from = from.value; payload.to = to.value; }
          else {
            if (!pick.value) { msg.append(alertBox('error', 'Bitte wähle eine Schicht.')); return; }
            payload.shiftId = pick.value;
            if (type === 'aenderung') {
              const c = ((state.shifts && state.shifts.shifts) || []).filter(function (s) { return s.id === pick.value; })[0] || {};
              const w = {};
              if (wStart.value && wStart.value !== c.start) w.start = wStart.value;
              if (wEnd.value && wEnd.value !== c.end) w.end = wEnd.value;
              if (wPlace.value && wPlace.value !== c.place) w.place = wPlace.value;
              if (Object.keys(w).length) payload.wish = w;
              else if (!text.value.trim()) { msg.append(alertBox('error', 'Bitte ändere die Zeit oder den Standort, oder schreibe kurz dazu, was geändert werden soll.')); return; }
            }
          }
          const r = await call('accRequestCreate', payload);
          if (!r) { api.close(); return; }
          if (r.status !== 'success') { msg.append(alertBox(r.code === 'RATE_LIMIT' ? 'warn' : 'error', r.message || 'Das hat nicht geklappt.')); return; }
          api.close();
          DP.toast('Antrag gesendet.');
          if (onDone) onDone();
        }
      }]
    });
  }

  // ---------- Meine Stunden ----------
  function numDe(n) { const v = Number(n); return isFinite(v) ? String(Math.round(v * 100) / 100).replace('.', ',') : '–'; }
  function monthName(m) { const x = /^(\d{4})-(\d{2})$/.exec(String(m || '')); return x ? PD.MONTHS[+x[2] - 1] + ' ' + x[1] : String(m || ''); }
  function hoursSigKey() { return 'dp_hours_sig_v1:' + ((state.profile && state.profile.username) || ''); }
  // Kurzer Fingerabdruck dessen, was der Admin an den Stunden ändern kann (Summe, Freigabe, Kommentar, Korrekturen, Dokumente, Vermerke)
  function hoursSignature(r) {
    const sums = (r.summaries || []).map(function (s) { return [s.monat, s.freigegeben ? 1 : 0, s.summeOffiziell, s.kommentar || ''].join('~'); }).sort().join('|');
    const corr = (r.hours || []).filter(function (x) { return x.geaendert || x.geloescht; }).map(function (x) { return x.monat + x.datum + x.stunden; }).sort().join(',');
    return [sums, corr, (r.documents || []).length, (r.vermerke || []).length].join('#');
  }
  async function showHours() {
    const body = h('div', { class: 'stack' }, spinnerCard());
    screen('Meine Stunden', body);
    const r = await call('accMyHours');
    if (!r) return;
    if (r.status !== 'success') { body.replaceChildren(alertBox('error', r.message || 'Die Stunden konnten nicht geladen werden.')); return; }
    const sums = (r.summaries || []).slice().sort(function (x, y) { return x.monat < y.monat ? 1 : -1; });
    const toApp = h('a', { class: 'btn btn-secondary btn-block', href: 'index.html' }, DP.icon('external', 'sm'), 'Zur Stunden-App (Stunden senden)');
    if (!sums.length) {
      body.replaceChildren(h('div', { class: 'card empty-card' }, h('div', { class: 'ico' }, DP.icon('clock')), h('h3', { text: 'Noch keine Stunden' }), h('p', { class: 'small', text: 'Sobald du Stunden in der Stunden-App sendest, siehst du sie hier.' })), toApp);
      return;
    }
    seenSet('hours', Date.now());
    try { localStorage.setItem(hoursSigKey(), hoursSignature(r)); } catch (e) { /* ignorieren */ }
    const extras = [];
    if ((r.documents || []).length) extras.push(h('div', { class: 'card stack-sm' }, h('h3', { text: 'Dokumente vom Admin' }), (r.documents || []).slice().reverse().map(function (d) {
      const url = String(d.link || '');
      return h('div', { class: 'row between' }, url.indexOf('https://') === 0 ? h('a', { class: 'btn btn-secondary btn-sm', href: url, target: '_blank', rel: 'noopener noreferrer' }, DP.icon('file', 'sm'), String(d.dateiname || 'Dokument')) : h('span', { text: String(d.dateiname || 'Dokument') }), h('span', { class: 'muted small', text: d.zeitstempel ? DP.fmtDate(Date.parse(d.zeitstempel)) : '' }));
    })));
    if ((r.vermerke || []).length) extras.push(h('div', { class: 'card stack-sm' }, h('h3', { text: 'Vermerke vom Admin' }), (r.vermerke || []).slice().reverse().map(function (v) {
      return h('div', { class: 'note reply' }, DP.icon('sticky', 'sm'), h('span', {}, h('strong', { text: String(v.zeitstempel || '') + ': ' }), String(v.text || '')));
    })));
    let sel = sums[0].monat, showAll = false;
    function ackBox(sm) {
      if (!sm.freigegeben) return h('div', { class: 'note', text: 'Der Admin hat diesen Monat noch nicht freigegeben. Danach kannst du ihn hier bestätigen.' });
      const a = sm.ack;
      if (a && a.status === 'bestaetigt') {
        return h('div', { class: 'note ok' }, DP.icon('check', 'sm'), h('span', { text: 'Du hast bestätigt, am ' + DP.fmtDateTime(a.ts) + '.' }));
      }
      if (a && a.status === 'abgelehnt') {
        const again = h('button', { type: 'button', class: 'btn btn-primary btn-block', text: 'Stimmt jetzt, bestätigen' });
        again.addEventListener('click', function () { doAck(sm.monat, 'bestaetigt'); });
        return h('div', { class: 'stack-sm' }, h('div', { class: 'note warn' }, DP.icon('alert', 'sm'), h('span', {}, h('strong', { text: 'Du hast widersprochen am ' + DP.fmtDateTime(a.ts) + '. ' }), 'Der Admin prüft das. Dein Hinweis: „' + a.text + '“')), again);
      }
      const yes = h('button', { type: 'button', class: 'btn btn-primary', text: 'Stimmt so, bestätigen' });
      const no = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Stimmt nicht' });
      yes.addEventListener('click', function () { doAck(sm.monat, 'bestaetigt'); });
      no.addEventListener('click', function () { disputeDialog(sm.monat); });
      return h('div', { class: 'stack-sm' }, h('p', { class: 'small', text: 'Bitte prüfe die Stunden. Stimmen sie, bestätige sie kurz.' }), h('div', { class: 'row2' }, yes, no));
    }
    async function doAck(monat, decision, text) {
      const res = await call('accHoursAck', { monat: monat, decision: decision, text: text || '' });
      if (!res) return null;
      if (res.status !== 'success') { DP.toast(res.message || 'Das hat nicht geklappt.', 'error'); return null; }
      const fresh = await call('accMyHours');
      if (fresh && fresh.status === 'success') { r.summaries = fresh.summaries; r.hours = fresh.hours; sums.length = 0; (fresh.summaries || []).slice().sort(function (x, y) { return x.monat < y.monat ? 1 : -1; }).forEach(function (x) { sums.push(x); }); }
      render();
      if (decision === 'bestaetigt') DP.toast('Bestätigt.');
      else DP.toast('Dein Hinweis ist beim Admin.');
      return res;
    }
    function disputeDialog(monat) {
      const ta = h('textarea', { class: 'input textarea', id: 'dsp_t', rows: '4', maxlength: '500', placeholder: 'Zum Beispiel: Am 5. war ich bis 07:00 da, nicht bis 06:00.' });
      const err = h('div', {});
      DP.modal({ title: 'Was stimmt nicht?', body: h('div', { class: 'stack-sm' }, h('p', { class: 'small', text: 'Schreib kurz, welcher Tag nicht stimmt und wie es richtig wäre. Der Admin sieht das und meldet sich.' }), ta, err),
        actions: [{ label: 'Abbrechen', kind: 'secondary' }, { label: 'An den Admin senden', kind: 'primary', closes: false, onClick: async function (api) {
          err.replaceChildren();
          if (ta.value.trim().length < 5) { err.append(alertBox('error', 'Bitte schreibe kurz, was nicht stimmt.')); return; }
          const res = await doAck(monat, 'abgelehnt', ta.value);
          if (res) api.close();
        } }] });
    }

    function render() {
      const sm = sums.filter(function (x) { return x.monat === sel; })[0];
      const days = (r.hours || []).filter(function (x) { return x.monat === sel; }).sort(function (x, y) { return x.sortKey < y.sortKey ? -1 : 1; });
      const official = sm.summeOffiziell !== '' && sm.summeOffiziell !== undefined ? sm.summeOffiziell : days.reduce(function (t, x) { return t + (Number(x.stunden) || 0); }, 0);
      const diff = sm.summeEingereicht !== '' && sm.summeEingereicht !== undefined && Math.abs(Number(sm.summeEingereicht) - Number(official)) > 0.001;
      const chips = h('div', { class: 'quick' }, sums.map(function (x) { return chipBtn(monthName(x.monat), x.monat === sel, function () { sel = x.monat; showAll = false; render(); }); }));
      const changed = days.filter(function (d) { return d.geaendert || d.geloescht; });
      const row = function (d) {
        const was = d.geloescht ? 'gestrichen · du hattest ' + numDe(d.eingereicht) + ' Std. gesendet'
          : (d.geaendert && d.origKnown ? 'vorher ' + [d.origStandort !== d.standort ? d.origStandort : '', (d.origBeginn || '') + '–' + (d.origEnde || '')].filter(Boolean).join(' · ') : (d.geaendert && d.eingereicht === 0 ? 'vom Admin ergänzt · du hattest nichts gesendet' : ''));
        return h('div', { class: 'hrow' + (d.geloescht ? ' del' : '') + (d.geaendert && !d.geloescht ? ' chg' : '') },
          h('div', { class: 'd', text: String(d.datum).slice(0, 5) }),
          h('div', { class: 'grow' }, h('div', { class: 'tt', text: (d.standort || '–') + ' · ' + (d.beginn || '') + '–' + (d.ende || '') }), was ? h('div', { class: 'm', text: was }) : null, d.kommentar ? h('div', { class: 'm', text: d.kommentar }) : null),
          h('div', { class: 'h', text: d.geloescht ? '0' : numDe(d.stunden) }));
      };
      const list = showAll || !changed.length ? days : changed;
      const toggle = changed.length && changed.length < days.length ? (function () {
        const b = h('button', { type: 'button', class: 'btn btn-ghost btn-sm btn-block', text: showAll ? 'Nur Änderungen zeigen (' + changed.length + ')' : 'Alle ' + days.length + ' Tage zeigen' });
        b.addEventListener('click', function () { showAll = !showAll; render(); });
        return b;
      })() : null;
      body.replaceChildren(chips,
        h('div', { class: 'card stack-sm' }, h('div', { class: 'row between' }, h('h3', { text: monthName(sel) }), h('span', { class: 'badge ' + (sm.freigegeben ? 'success' : 'neutral'), text: sm.freigegeben ? 'Freigegeben' : 'Noch offen' })),
          h('div', { class: 'bigsum', text: numDe(official) + ' Std.' }),
          diff ? h('div', { class: 'note warn' }, DP.icon('alert', 'sm'), h('span', { text: 'Gesendet ' + numDe(sm.summeEingereicht) + ' Std., vom Admin auf ' + numDe(official) + ' Std. geändert. Unten stehen die betroffenen Tage.' })) : null,
          sm.kommentar ? h('div', { class: 'note reply' }, DP.icon('chat', 'sm'), h('span', { text: 'Admin: ' + sm.kommentar })) : null,
          ackBox(sm)),
        h('div', { class: 'card stack-sm' }, h('div', { class: 'row between' }, h('h3', { text: changed.length && !showAll ? 'Vom Admin geändert (' + changed.length + ')' : 'Alle Tage (' + days.length + ')' }), h('span', { class: 'muted small', text: 'Std.' })),
          h('div', { class: 'hlist' }, list.length ? list.map(row) : h('p', { class: 'muted small', text: 'Keine Tage in diesem Monat.' })), toggle),
        ...extras, toApp);
    }
    render();
  }

  // ---------- Nachrichten ----------
  function showMessages() {
    const chat = h('div', { class: 'chat' }, spinnerCard());
    const input = h('input', { class: 'input', type: 'text', maxlength: '1000', placeholder: 'Nachricht an den Admin …', 'aria-label': 'Nachricht' });
    const send = h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Senden' }, DP.icon('send', 'sm'));
    const msg = h('div', {});
    screen('Nachrichten', [chat, msg, h('div', { class: 'composer' }, input, send)]);
    function render(list) {
      chat.replaceChildren(...(list.length ? list.map(function (m) {
        return h('div', { class: 'bubble ' + (m.from === 'ich' ? 'me' : 'admin') }, m.text, h('span', { class: 'ts', text: DP.fmtDateTime(m.ts) }));
      }) : [h('div', { class: 'card empty-card' }, h('div', { class: 'ico' }, DP.icon('chat')), h('h3', { text: 'Noch keine Nachrichten' }), h('p', { class: 'small', text: 'Schreibe dem Admin, wenn du eine Frage hast.' }))]));
      window.scrollTo(0, document.body.scrollHeight);
    }
    async function load() {
      const r = await call('accMessages');
      if (!r || r.status !== 'success') return;
      render(r.messages);
      seenSet('messages', Date.now());
    }
    async function doSend() {
      const t = input.value.trim();
      msg.replaceChildren();
      if (!t) return;
      send.disabled = true;
      const r = await call('accSendMessage', { text: t });
      send.disabled = false;
      if (!r) return;
      if (r.status !== 'success') { msg.append(alertBox(r.code === 'RATE_LIMIT' ? 'warn' : 'error', r.message || 'Die Nachricht konnte nicht gesendet werden.')); return; }
      input.value = '';
      await load();
    }
    send.addEventListener('click', doSend);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });
    refreshTimer = setInterval(function () { if (document.visibilityState === 'visible') load(); }, 30000);
    load();
  }

  // ---------- Sonderfälle ----------
  function showMaintenance(message) {
    view(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card center stack' }, logoMark(),
      h('h1', { text: 'Kurze Pause' }), h('p', { class: 'muted', text: message || 'Der Dienstplan wird gerade gewartet. Bitte versuche es später noch einmal.' }),
      (function () { const b = h('button', { type: 'button', class: 'btn btn-primary' }, DP.icon('refresh', 'sm'), 'Erneut versuchen'); b.addEventListener('click', boot); return b; })())));
  }
  function showOffline() {
    const b = h('button', { type: 'button', class: 'btn btn-primary' }, DP.icon('refresh', 'sm'), 'Erneut versuchen');
    b.addEventListener('click', boot);
    view(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card center stack' }, h('div', { class: 'logo' }, DP.icon('wifioff')),
      h('h1', { text: 'Keine Verbindung' }), h('p', { class: 'muted', text: 'Der Server ist gerade nicht erreichbar. Prüfe dein Internet.' }), b)));
  }
  function expired() {
    clearCaches();
    store.clear();
    state.session = null;
    showLogin('Deine Sitzung ist abgelaufen. Bitte melde dich neu an.');
  }
  function logout() {
    clearCaches();
    store.clear();
    state.session = null; state.profile = null;
    showLogin();
  }

  // ---------- Start ----------
  // Ist „Mein Dienstplan“ vom Admin ausgeschaltet, steht hier nur ein Hinweis (die Daten bleiben erhalten)
  function showPlanOff() {
    state.planOff = true;
    const n = h('div', { class: 'auth-wrap' }, h('div', { class: 'center stack' }, h('h2', { text: 'Dienstplan zurzeit nicht verfügbar' }), h('p', { class: 'muted', text: 'Der Dienstplan ist im Moment nicht freigeschaltet. Das Stundenformular funktioniert wie gewohnt.' }), h('a', { class: 'btn btn-primary', href: 'index.html', text: 'Zum Stundenformular' })));
    n.__off = true; view(n);
  }
  function checkPlanFlag() {
    let was = false; try { was = localStorage.getItem('dp_plan_off') === '1'; } catch (e) { /* egal */ }
    if (was) showPlanOff();
    DP.api('appConfig').then(function (r) {
      if (r.status !== 'success') return;
      const off = r.dienstplan === false;
      try { localStorage.setItem('dp_plan_off', off ? '1' : '0'); } catch (e) { /* egal */ }
      if (off && !state.planOff) showPlanOff();
      if (!off && was) location.reload();
    });
  }
  async function boot() {
    checkPlanFlag();
    const s = store.load();
    if (!s) return showLogin();
    state.session = s; state.remember = s.remember;
    view(h('div', { class: 'auth-wrap' }, h('div', { class: 'center' }, h('span', { class: 'spinner' }))));
    const r = await DP.api('accMe', { session: s.token });
    if (r.status === 'success') {
      state.profile = r.profile;
      try { localStorage.setItem('dp_cache_profile_v1', JSON.stringify(r.profile)); } catch (e) { /* ignorieren */ }
      return r.mustChange ? showChangePassword(true) : showHome();
    }
    if (r.code === 'NETWORK') {
      let cp = null; try { cp = JSON.parse(localStorage.getItem('dp_cache_profile_v1')); } catch (e) { cp = null; }
      if (cp && cp.username) { state.profile = cp; return showHome(); }   // offline: Startseite mit dem letzten Stand
      return showOffline();
    }
    if (r.code === 'MAINTENANCE') return showMaintenance(r.message);
    expired();
  }
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { /* ohne Offline-Hilfe weiterarbeiten */ }); } catch (e) { /* ignorieren */ }
  boot();
})();

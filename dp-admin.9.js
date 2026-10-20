'use strict';
/* Dienstplan: Admin-Konsole (Version 1: Zugänge und Protokoll) */
(function () {
  const h = DP.h;
  const root = document.getElementById('root');
  const store = DP.sessionStore('dpa_session_v1');   // nur in diesem Browser-Tab, nie dauerhaft
  const PD = DP.dates;
  const state = { session: null, tab: 'plan', report: { month: DP.dates.today().slice(0, 7), data: null, open: {} }, employees: [], audit: [], filter: 'all', query: '', auditFilter: 'all', lastLoad: 0, serverNow: 0, error: false,
    plan: { weekStart: PD.weekStart(PD.today()), view: 'week', monthStart: PD.monthStart(PD.today()), brush: null, wd: [true, true, true, true, true, true, true], mode: 'emp', data: null, error: false },
    settings: { rules: false },
    dash: null, req: { filter: 'open', data: null }, msg: { pin: null, data: null } };
  let pollTimer = null, tickTimer = null;

  const AUDIT_LABELS = {
    login: ['Angemeldet', 'success'], login_fehlgeschlagen: ['Fehlgeschlagene Anmeldung', 'warn'],
    konto_voruebergehend_gesperrt: ['Konto vorübergehend gesperrt (zu viele Fehlversuche)', 'danger'],
    konto_angelegt: ['Zugang angelegt', 'info'], passwort_zurueckgesetzt: ['Passwort zurückgesetzt', 'info'], passwort_geaendert: ['Passwort geändert', 'success'],
    ueberall_abgemeldet: ['Überall abgemeldet', 'neutral'], sitzungen_beendet: ['Sitzungen beendet', 'neutral'],
    konto_status_aktiv: ['Zugang aktiviert / entsperrt', 'success'], konto_status_gesperrt: ['Zugang gesperrt', 'danger'], konto_status_deaktiviert: ['Zugang deaktiviert', 'neutral']
  };
  const WARN_ACTIONS = ['login_fehlgeschlagen', 'konto_voruebergehend_gesperrt', 'konto_status_gesperrt'];

  function view(node) { root.replaceChildren(node); }
  function byName(x, y) { if (x.pin === '00') return -1; if (y.pin === '00') return 1; return x.name.localeCompare(y.name, 'de'); }
  function alertBox(kind, text) { return h('div', { class: 'alert ' + kind, role: kind === 'error' ? 'alert' : 'status' }, DP.icon(kind === 'success' ? 'check' : 'alert', 'sm'), h('div', { text: text })); }

  async function adm(action, payload) {
    const r = await DP.api(action, Object.assign({ adminSession: state.session && state.session.token }, payload || {}));
    if (r.code === 'ADMIN_AUTH' && state.session) { sessionEnded('Die Sitzung ist abgelaufen. Bitte neu anmelden.'); }
    return r;
  }

  // ---------- Anmeldung ----------
  function showLogin(notice) { showLoginPin(notice); }
  function showLoginPin(notice) {
    stopLive();
    const pin = h('input', { class: 'input', id: 'pin', name: 'pin', type: 'password', inputmode: 'numeric', autocomplete: 'off', required: true, maxlength: '40', 'aria-label': 'Admin-PIN' });
    const msg = h('div', {});
    if (notice) msg.append(alertBox('info', notice));
    const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Anmelden');
    const form = h('form', { class: 'stack', novalidate: true }, h('div', { class: 'field' }, h('label', { for: 'pin', text: 'Admin-PIN' }), pin), msg, btn);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      msg.replaceChildren();
      const v = pin.value.trim();
      if (!v) { msg.append(alertBox('error', 'Bitte die Admin-PIN eingeben.')); return; }
      btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner' }), 'Bitte warten …');
      const r = await DP.api('adminLogin', { pin: v });
      pin.value = '';
      if (r.status === 'success' && r.session) {
        state.session = { token: r.session };
        store.save(r.session, Date.now() + 8 * 3600 * 1000, false);
        bridgeSession(r.session);
        state.role = 'voll'; state.who = '';
        return startConsole();
      }
      btn.disabled = false; btn.replaceChildren('Anmelden');
      msg.append(alertBox(r.code === 'LOCKED' ? 'warn' : 'error', r.message || 'Anmeldung fehlgeschlagen.'));
    });
    view(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
      h('div', { class: 'head' }, h('div', { class: 'logo' }, DP.icon('shield')), h('div', {}, h('h1', { text: 'Admin-Konsole' }), h('p', { class: 'muted', text: 'Dienstplan verwalten' }))),
      h('div', { class: 'card stack-sm' }, form, (function () { const b = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'toUser', text: 'Mit Benutzername anmelden' }); b.addEventListener('click', function () { showLoginUser(notice); }); return b; })()))));
    pin.focus();
  }
  // Die eingebetteten Bereiche (alte Admin-Seite) nutzen dieselbe Anmeldung: sie wird im Tab-Speicher unter dem alten Namen bereitgestellt
  function bridgeSession(token) { try { sessionStorage.setItem('adm_session', token); } catch (e) { /* ignorieren */ } }
  function sessionEnded(notice) {
    store.clear(); state.session = null; state.role = null; state.who = '';
    state.tab = 'plan'; state.plan.data = null; state.plan.brush = null; state.plan.undo = null; state.users = null; state.dash = null; state.employees = [];   // nichts vom letzten Benutzer bleibt stehen
    try { sessionStorage.removeItem('adm_session'); } catch (e) { /* ignorieren */ }
    Object.keys(embedFrames).forEach(function (k) { delete embedFrames[k]; });
    document.title = 'Dienstplan – Admin';
    document.querySelectorAll('.overlay').forEach(function (o) { o.remove(); });
    showLogin(notice);
  }

  // ---------- Daten laden ("Live") ----------
  async function refresh(manual) {
    if (!state.session) return;
    // Alles gleichzeitig abfragen (früher nacheinander): das Öffnen dauert nur noch so lang wie die langsamste Abfrage
    const jobs = [
      adm('adminAccList').then(function (r) {
        if (r.status === 'success') {
          state.employees = r.employees || [];
          state.serverNow = r.now || Date.now();
          state.lastLoad = Date.now();
          state.error = false;
        } else if (r.code === 'NETWORK') {
          state.error = true;
        }
      }),
      loadDash()
    ];
    if (state.tab === 'audit' || state.tab === 'overview') jobs.push(loadAudit());
    if (state.tab === 'plan') jobs.push(loadPlan());
    if (state.tab === 'requests') jobs.push(loadRequests());
    if (state.tab === 'messages') jobs.push(loadMessages());
    if (state.tab === 'report') jobs.push(loadReport());
    if (state.tab === 'users') jobs.push(loadUsers());
    if (state.tab === 'staff') jobs.push(loadStaff());
    if (state.tab === 'places') jobs.push(loadPlaces());
    if (state.tab === 'overview') jobs.push(loadSettings());
    await Promise.all(jobs);
    renderChrome();
    renderTab();
    if (manual && !state.error) DP.toast('Aktualisiert.');
  }
  async function loadAudit() {
    if (state.role && state.role !== 'voll') return;
    const r = await adm('adminAudit', { limit: 200 });
    if (r.status === 'success') state.audit = r.items || [];
  }
  function startLive() {
    stopLive();
    pollTimer = setInterval(function () { if (document.visibilityState === 'visible' && !document.querySelector('.overlay')) refresh(); }, 15000);
    tickTimer = setInterval(updateLiveLabel, 1000);
  }
  function stopLive() { clearInterval(pollTimer); clearInterval(tickTimer); pollTimer = tickTimer = null; }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.session && Date.now() - state.lastLoad > 5000) refresh();
  });
  function updateLiveLabel() {
    const el = document.getElementById('liveLabel');
    if (!el) return;
    const s = Math.max(0, Math.round((Date.now() - state.lastLoad) / 1000));
    el.textContent = state.error ? 'Verbindung unterbrochen' : (s < 5 ? 'Live · gerade aktualisiert' : 'Live · vor ' + s + ' s');
    const dot = document.getElementById('liveDot');
    if (dot) dot.className = 'dot' + (state.error ? '' : ' live');
    if (dot) dot.style.color = state.error ? 'var(--danger)' : '';
  }

  // ---------- Hilfen ----------
  function statusOf(emp) {
    const a = emp.account;
    if (!a) return { kind: 'neutral', text: 'Kein Zugang', key: 'none' };
    if (a.status === 'deaktiviert') return { kind: 'neutral', text: 'Deaktiviert', key: 'off' };
    if (a.status === 'gesperrt') return { kind: 'danger', text: 'Gesperrt', key: 'locked' };
    if (a.lockedUntil > Date.now()) return { kind: 'warn', text: 'Vorübergehend gesperrt', key: 'locked' };
    if (a.mustChange && !a.lastLogin) return { kind: 'info', text: 'Wartet auf erste Anmeldung', key: 'active' };
    if (a.mustChange) return { kind: 'info', text: 'Muss Passwort ändern', key: 'active' };
    return { kind: 'success', text: 'Aktiv', key: 'active' };
  }
  function counts() {
    const c = { total: state.employees.length, active: 0, none: 0, locked: 0 };
    state.employees.forEach(function (e) { const k = statusOf(e).key; if (k === 'none') c.none++; else if (k === 'locked') c.locked++; else if (k === 'active') c.active++; });
    return c;
  }
  function badge(s) { return h('span', { class: 'badge ' + s.kind }, s.key === 'active' && s.kind === 'success' ? h('span', { class: 'dot' }) : null, s.text); }

  // Kleines "⋯"-Menü für seltene Aktionen
  function moreMenu(items) {
    const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-haspopup': 'menu', 'aria-label': 'Weitere Aktionen', title: 'Weitere Aktionen' }, DP.icon('more', 'sm'));
    const list = h('div', { class: 'menu hidden', role: 'menu' }, items.map(function (i) {
      const b = h('button', { type: 'button', role: 'menuitem', class: 'menu-item' + (i.danger ? ' danger' : '') }, DP.icon(i.icon, 'sm'), i.label);
      b.addEventListener('click', function () { close(); i.fn(); });
      return b;
    }));
    const wrap = h('div', { class: 'menu-wrap' }, btn, list);
    function outside(e) { if (!wrap.contains(e.target)) close(); }
    function esc(e) { if (e.key === 'Escape') close(); }
    function close() { list.classList.add('hidden'); document.removeEventListener('click', outside, true); document.removeEventListener('keydown', esc, true); }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!list.classList.contains('hidden')) { close(); return; }
      document.querySelectorAll('.menu').forEach(function (m) { m.classList.add('hidden'); });
      list.classList.remove('hidden');
      setTimeout(function () { document.addEventListener('click', outside, true); document.addEventListener('keydown', esc, true); }, 0);
    });
    return wrap;
  }

  // ---------- Zugangsdaten anzeigen / drucken ----------
  function showCredentials(res, headline) {
    const portal = new URL('dienstplan.html', location.href).href;
    const row = function (label, value) {
      const copy = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': label + ' kopieren' }, DP.icon('copy', 'sm'));
      copy.addEventListener('click', async function () { DP.toast((await DP.copyText(value)) ? label + ' kopiert.' : 'Kopieren nicht möglich. Bitte markieren und kopieren.', 'x'); });
      return h('div', { class: 'cred' }, h('div', { class: 'grow' }, h('div', { class: 'lab', text: label }), h('div', { class: 'val', text: value })), copy);
    };
    const body = h('div', { class: 'stack' },
      h('div', { class: 'alert warn' }, DP.icon('alert', 'sm'), h('div', { text: 'Das Passwort wird nur jetzt angezeigt und nirgends gespeichert. Gib es sicher weiter, am besten persönlich oder ausgedruckt. ' + res.name + ' muss es bei der ersten Anmeldung ändern.' })),
      row('Benutzername', res.username), row('Passwort', res.password));
    DP.modal({
      title: headline + ' ' + res.name, body: body, dismissable: false,
      actions: [
        { label: 'Zugangsdaten drucken', icon: 'printer', kind: 'secondary', closes: false, onClick: function () { printSheet(res, portal); } },
        { label: 'Fertig', kind: 'primary' }
      ]
    });
  }
  function printSheet(res, portal) {
    const old = document.getElementById('printSheet');
    if (old) old.remove();
    const sheet = h('div', { id: 'printSheet', class: 'print-only' },
      h('h1', { text: 'Zugangsdaten Dienstplan' }), h('p', { text: 'Für: ' + res.name }),
      h('div', { class: 'pcard' }, h('div', { class: 'plab', text: 'Benutzername' }), h('div', { class: 'pval', text: res.username }), h('div', { class: 'plab', text: 'Vorläufiges Passwort' }), h('div', { class: 'pval', text: res.password })),
      h('ol', {}, h('li', { text: 'Seite öffnen: ' + portal }), h('li', { text: 'Mit Benutzername und Passwort anmelden.' }), h('li', { text: 'Direkt ein eigenes, neues Passwort festlegen (mindestens 12 Zeichen).' }), h('li', { text: 'Dieses Blatt danach vernichten. Das Passwort niemandem weitergeben.' })));
    document.body.append(sheet);
    document.body.classList.add('printing-sheet');
    const cleanup = function () { sheet.remove(); document.body.classList.remove('printing-sheet'); window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  // ---------- Aktionen ----------
  async function act(label, fn, okText) {
    const r = await fn();
    if (r.status === 'success') { if (okText) DP.toast(okText); await refresh(); return r; }
    if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || (label + ' hat nicht geklappt.'), 'error');
    return r;
  }
  async function createAccount(emp) {
    const r = await adm('adminAccCreate', { pin: emp.pin });
    if (r.status === 'success') { showCredentials(r, 'Zugangsdaten für'); await refresh(); }
    else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Zugang konnte nicht angelegt werden.', 'error');
  }
  async function resetPassword(emp) {
    if (!(await DP.confirm('Passwort zurücksetzen?', 'Für ' + emp.name + ' wird ein neues vorläufiges Passwort erzeugt. Alle angemeldeten Geräte werden sofort abgemeldet.', 'Zurücksetzen', 'danger'))) return;
    const r = await adm('adminAccReset', { id: emp.account.id });
    if (r.status === 'success') { showCredentials(r, 'Neues Passwort für'); await refresh(); }
    else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Zurücksetzen hat nicht geklappt.', 'error');
  }
  async function setStatus(emp, status) {
    if (status !== 'aktiv') {
      const txt = status === 'gesperrt' ? 'Der Zugang von ' + emp.name + ' wird gesperrt, laufende Sitzungen enden sofort.' : 'Der Zugang von ' + emp.name + ' wird deaktiviert (z. B. nach dem Ausscheiden). Laufende Sitzungen enden sofort.';
      if (!(await DP.confirm(status === 'gesperrt' ? 'Zugang sperren?' : 'Zugang deaktivieren?', txt, status === 'gesperrt' ? 'Sperren' : 'Deaktivieren', 'danger'))) return;
    }
    await act('Statusänderung', function () { return adm('adminAccSetStatus', { id: emp.account.id, status: status }); }, status === 'aktiv' ? 'Zugang aktiviert.' : status === 'gesperrt' ? 'Zugang gesperrt.' : 'Zugang deaktiviert.');
  }
  async function revoke(emp) {
    if (!(await DP.confirm('Sitzungen beenden?', emp.name + ' wird auf allen Geräten abgemeldet. Das Passwort bleibt gleich.', 'Sitzungen beenden', 'danger'))) return;
    await act('Sitzungen beenden', function () { return adm('adminAccRevoke', { id: emp.account.id }); }, 'Alle Sitzungen von ' + emp.name + ' beendet.');
  }

  // ---------- Ansichten ----------
  function renderChrome() {
    const c = counts(), D = state.dash || {};
    const n = (D.openRequests || 0) + (D.unansweredMessages || 0) + c.locked;
    document.title = (n ? '(' + n + ') ' : '') + 'Dienstplan – Admin';
    const nav = document.getElementById('nav');
    if (nav) {
      nav.querySelectorAll('.nav').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === state.tab); });
      const setCount = function (tab, num, kind, title) {
        const el = document.getElementById('navCount_' + tab);
        if (!el) return;
        el.replaceChildren();
        if (num) el.append(h('span', { class: 'badge ' + kind, text: String(num), title: title }));
      };
      setCount('accounts', c.none, 'info', c.none + ' Mitarbeiter ohne Zugang');
      setCount('requests', D.openRequests, 'warn', D.openRequests + ' offene Anträge');
      setCount('messages', D.unansweredMessages, 'warn', D.unansweredMessages + ' unbeantwortete Nachrichten');
      setCount('plan', D.drafts14, 'neutral', D.drafts14 + ' Entwürfe in den nächsten 14 Tagen (noch nicht veröffentlicht)');
    }
    updateLiveLabel();
  }
  // Bereiche der bisherigen Admin-Seite, eingebettet: [Bereich in der alten Seite, Beschriftung, Symbol]
  const EMB = { e_hours: ['overview', 'Stunden', 'clock'], e_docs: ['upload', 'Dokumente', 'file'], e_devices: ['employees', 'Handys', 'key'], e_help: ['help', 'Hilfe', 'alert'], e_maint: ['maint', 'Wartung', 'wifioff'] };
  const embedFrames = {};   // pro Bereich ein Rahmen, er bleibt beim Wechseln erhalten (nichts lädt neu, nichts geht verloren)
  function syncEmbed(box) {
    let host = document.getElementById('embedHost');
    if (!host) { host = h('div', { id: 'embedHost', class: 'embed-host' }); box.parentNode.insertBefore(host, box.nextSibling); }
    const e = EMB[state.tab];
    if (!e) { host.style.display = 'none'; box.style.display = ''; return false; }
    box.style.display = 'none'; host.style.display = 'block'; setTitle(e[1]);
    Object.keys(embedFrames).forEach(function (k) { embedFrames[k].style.display = k === state.tab ? '' : 'none'; });
    if (!embedFrames[state.tab]) {
      const f = h('iframe', { class: 'embed', title: e[1], src: 'admin-nachrichten.html?embed=1&tab=' + e[0], referrerpolicy: 'no-referrer' });
      embedFrames[state.tab] = f; host.append(f);
    }
    return true;
  }
  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin || !ev.data || ev.data.dpAdmin !== 'auth-expired' || !state.session) return;
    if (!Object.keys(embedFrames).some(function (k) { return embedFrames[k].contentWindow === ev.source; })) return;
    sessionEnded('Die Sitzung ist abgelaufen. Bitte neu anmelden.');
  });
  function renderTab() {
    const box = document.getElementById('content');
    if (!box) return;
    if (syncEmbed(box)) return;
    const f = state.tab === 'plan' ? planView : state.tab === 'staff' ? staffView : state.tab === 'places' ? placesView : state.tab === 'requests' ? requestsView : state.tab === 'messages' ? messagesView : state.tab === 'report' ? reportView : state.tab === 'accounts' ? accountsView : state.tab === 'users' ? usersView : state.tab === 'audit' ? auditView : overviewView;
    const old = box.querySelector('.grid-wrap'), sl = old ? old.scrollLeft : 0, sy = window.scrollY;
    const el = f();
    if (state.role === 'lesen' && el && el.prepend) el.prepend(alertBox('info', 'Du hast nur Lesezugriff. Änderungen sind nicht möglich.'));
    if (state.tab === 'plan' && state.plan.data && state.plan.data.conflict00 && el && el.prepend) el.prepend(h('div', { class: 'warnbar' }, DP.icon('alert', 'sm'), h('div', {}, h('strong', { text: 'Die PIN 00 ist für „Offene Schichten“ reserviert. ' }), state.plan.data.conflict00 + ' hat diese PIN und wird hier nicht angezeigt. Bitte unter Mitarbeiter die PIN ändern.')));
    box.replaceChildren(el);
    const nw = box.querySelector('.grid-wrap');
    if (nw && sl) nw.scrollLeft = sl;
    if (sy) window.scrollTo(0, sy);
  }
  async function startConsole() {
    if (!state.role) {
      const r = await adm('adminMe');
      if (!state.session) return;
      state.role = r.status === 'success' ? r.role : 'voll'; state.who = r.name || r.user || '';
    }
    startConsoleReal();
  }
  function startConsoleReal() {
    const tabsAll = [['plan', 'calendar', 'Dienstplan'], ['staff', 'user', 'Mitarbeiter'], ['places', 'circle', 'Standorte'], ['overview', 'home', 'Übersicht'], ['requests', 'swap', 'Anträge'], ['messages', 'chat', 'Nachrichten'], ['report', 'chart', 'Auswertung'], ['accounts', 'users', 'Zugänge'], ['audit', 'list', 'Protokoll']];
    const ROLE_TABS = { voll: null, planer: ['plan', 'staff', 'places', 'overview', 'requests', 'messages', 'report'], lesen: ['plan', 'staff', 'places', 'overview', 'requests', 'report'] };
    const roleTabs = ROLE_TABS[state.role] || null;
    const tabs = tabsAll.filter(function (t) { return !roleTabs || roleTabs.indexOf(t[0]) !== -1; }).concat(state.role === 'voll' ? [['users', 'shield', 'Admins']] : []);
    const whoNote = h('div', { class: 'who-note' }, h('div', { class: 'wn', text: state.who || 'Hauptzugang' }), h('div', { class: 'muted small', text: ROLE_LABEL[state.role] || '' }));
    const nav = h('nav', { id: 'nav', class: 'side', 'aria-label': 'Hauptmenü' }, h('div', { class: 'brand' }, h('div', { class: 'mark' }, DP.icon('calendar')), 'Dienstplan'),
      tabs.concat((state.role === 'voll' ? Object.keys(EMB) : []).map(function (k) { return [k, EMB[k][2], EMB[k][1]]; })).map(function (t, i) {
        const b = h('button', { type: 'button', class: 'nav', dataset: { tab: t[0] } }, DP.icon(t[1]), t[2], h('span', { id: 'navCount_' + t[0], class: 'count' }));
        b.addEventListener('click', function () { state.tab = t[0]; loadForTab(t[0]).then(function () { renderChrome(); renderTab(); }); renderChrome(); renderTab(); });
        return i === tabs.length ? [h('div', { class: 'navgroup', text: 'Stunden & Geräte' }), b] : b;
      }), h('div', { class: 'grow' }), whoNote);
    const refreshBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, DP.icon('refresh', 'sm'), 'Aktualisieren');
    refreshBtn.addEventListener('click', function () {
      const f = embedFrames[state.tab];
      if (f) { try { f.contentWindow.location.reload(); } catch (e) { /* ignorieren */ } return; }
      refresh(true);
    });
    const out = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, DP.icon('logout', 'sm'), 'Abmelden');
    out.addEventListener('click', async function () { sessionEnded('Du wurdest abgemeldet.'); });
    view(h('div', { class: 'console' }, nav, h('div', { class: 'main' },
      h('div', { class: 'topbar' }, h('h2', { id: 'title', text: 'Admin-Konsole' }), h('div', { class: 'grow' }),
        h('span', { class: 'row small muted' }, h('span', { id: 'liveDot', class: 'dot live' }), h('span', { id: 'liveLabel', text: 'Lädt …' })), refreshBtn, out),
      h('main', { id: 'content', class: 'content' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' }))))));
    startLive();
    refresh();
  }

  function setTitle(t) { const el = document.getElementById('title'); if (el) el.textContent = t; }

  function overviewView() {
    setTitle('Übersicht');
    const c = counts(), D = state.dash;
    const goTab = function (tab) { state.tab = tab; loadForTab(tab).then(function () { renderChrome(); renderTab(); }); renderChrome(); renderTab(); };
    const stat = function (num, lab, kind, tab) {
      const el = h(tab ? 'button' : 'div', { type: tab ? 'button' : null, class: 'card stat' + (tab ? ' statlink' : '') }, h('div', { class: 'num', text: String(num) }), h('div', { class: 'lab', text: lab }), kind ? h('span', { class: 'badge ' + kind, text: kind === 'warn' ? 'Prüfen' : kind === 'info' ? 'Offen' : '' }) : null);
      if (tab) el.addEventListener('click', function () { goTab(tab); });
      return el;
    };
    const person = function (x, sub) { return h('div', { class: 'row between' }, h('div', { class: 'row' }, h('div', { class: 'avatar small', text: DP.initials(x.name) }), h('div', {}, h('div', { class: 'nm', text: x.name }), h('div', { class: 'muted small', text: sub }))), x.draft ? h('span', { class: 'badge neutral', text: 'Entwurf' }) : null); };
    const recent = state.employees.filter(function (e) { return e.account && e.account.lastLogin; }).sort(function (x, y) { return y.account.lastLogin - x.account.lastLogin; }).slice(0, 6);
    const warn = state.audit.filter(function (x) { return WARN_ACTIONS.indexOf(x.action) !== -1; }).slice(0, 5);
    const goAudit = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, 'Alle ansehen');
    goAudit.addEventListener('click', function () { state.auditFilter = 'warn'; goTab('audit'); });
    const nowCard = h('section', { class: 'card stack-sm board' }, h('div', { class: 'row between' }, h('h3', { text: 'Jetzt im Dienst' }), h('span', { class: 'badge success', text: D ? String(D.onDuty.length) : '…' })),
      !D ? h('span', { class: 'spinner' }) : D.onDuty.length ? D.onDuty.map(function (x) { return person(x, x.place + ' · ' + x.start + '–' + x.end); }) : h('p', { class: 'muted small', text: 'Gerade ist niemand im Dienst.' }),
      D && D.later.length ? h('h3', { class: 'later', text: 'Später heute' }) : null, D ? D.later.map(function (x) { return person(x, x.place + ' · ' + x.start + '–' + x.end); }) : null);
    const absCard = h('section', { class: 'card stack-sm' }, h('div', { class: 'row between' }, h('h3', { text: 'Heute abwesend' }), h('span', { class: 'badge ' + (D && D.absent.length ? 'warn' : 'neutral'), text: D ? String(D.absent.length) : '…' })),
      !D ? h('span', { class: 'spinner' }) : D.absent.length ? D.absent.map(function (x) { return person(x, (x.type === 'krank' ? 'Krank' : x.status === 'genehmigt' ? 'Urlaub' : 'Urlaub (beantragt)') + ' bis ' + PD.short(x.to)); }) : h('p', { class: 'muted small', text: 'Niemand ist abwesend.' }));
    return h('div', { class: 'stack' },
      h('div', { class: 'stats' }, stat(D ? D.openRequests : '…', 'Offene Anträge', D && D.openRequests ? 'info' : null, 'requests'), stat(D ? D.unansweredMessages : '…', 'Unbeantwortete Nachrichten', D && D.unansweredMessages ? 'info' : null, 'messages'),
        stat(D ? D.drafts14 : '…', 'Entwürfe (nächste 14 Tage)', D && D.drafts14 ? 'info' : null, 'plan'), stat(c.locked, 'Gesperrte Zugänge', c.locked ? 'warn' : null, 'accounts')),
      h('div', { class: 'grid2' }, nowCard, absCard),
      h('div', { class: 'grid2' },
        h('section', { class: 'card stack-sm' }, h('h3', { text: 'Zuletzt angemeldet' }),
          recent.length ? recent.map(function (e) { return h('div', { class: 'row between' }, h('span', { text: e.name }), h('span', { class: 'muted small', text: DP.relTime(e.account.lastLogin) })); }) : h('p', { class: 'muted small', text: 'Noch niemand hat sich angemeldet.' })),
        h('section', { class: 'card stack-sm' }, h('div', { class: 'row between' }, h('h3', { text: 'Sicherheitshinweise' }), goAudit),
          warn.length ? warn.map(function (x) { const l = AUDIT_LABELS[x.action] || [x.action, 'neutral']; return h('div', { class: 'stack-sm' }, h('div', { class: 'row between' }, h('span', { class: 'badge ' + l[1], text: l[0] }), h('span', { class: 'muted small', text: DP.relTime(x.ts) })), h('div', { class: 'small muted', text: x.target })); }) : h('p', { class: 'muted small', text: 'Keine auffälligen Ereignisse.' }))));
  }

  function accountsView() {
    setTitle('Zugänge');
    const c = counts();
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Name, PIN oder Benutzername suchen …', 'aria-label': 'Suchen', value: state.query });
    search.style.maxWidth = '340px';
    const chips = [['all', 'Alle ' + c.total], ['none', 'Ohne Zugang ' + c.none], ['active', 'Aktiv ' + c.active], ['locked', 'Gesperrt ' + c.locked]].map(function (f) {
      const b = h('button', { type: 'button', class: 'chip' + (state.filter === f[0] ? ' active' : ''), text: f[1] });
      b.addEventListener('click', function () { state.filter = f[0]; renderTab(); });
      return b;
    });
    const tbody = h('tbody');
    function fill() {
      const q = search.value.trim().toLowerCase();
      state.query = search.value;
      const list = state.employees.filter(function (e) {
        const s = statusOf(e);
        if (state.filter !== 'all' && s.key !== state.filter) return false;
        return !q || e.name.toLowerCase().indexOf(q) !== -1 || e.pin.indexOf(q) !== -1 || (e.account && e.account.username.indexOf(q) !== -1);
      });
      tbody.replaceChildren(...(list.length ? list.map(row) : [h('tr', {}, h('td', { colspan: '5' }, h('div', { class: 'empty', text: 'Keine Mitarbeiter gefunden.' })))]));
    }
    function row(e) {
      const s = statusOf(e), a = e.account;
      const btn = function (label, icon, kind, fn) { const b = h('button', { type: 'button', class: 'btn btn-sm btn-' + kind }, DP.icon(icon, 'sm'), label); b.addEventListener('click', fn); return b; };
      const acts = [];
      if (!a) acts.push(btn('Zugang anlegen', 'plus', 'primary', function () { createAccount(e); }));
      else {
        const more = [];
        if (s.key === 'locked') acts.push(btn('Entsperren', 'check', 'secondary', function () { setStatus(e, 'aktiv'); }));
        else if (a.status === 'deaktiviert') acts.push(btn('Aktivieren', 'check', 'secondary', function () { setStatus(e, 'aktiv'); }));
        const reset = btn('Neues Passwort', 'key', 'secondary', function () { resetPassword(e); }); reset.title = 'Passwort zurücksetzen (neues vorläufiges Passwort erzeugen)'; acts.push(reset);
        if (a.status === 'aktiv' && s.key !== 'locked') { more.push({ label: 'Geräte abmelden', icon: 'logout', fn: function () { revoke(e); } }); more.push({ label: 'Zugang sperren', icon: 'lock', fn: function () { setStatus(e, 'gesperrt'); } }); }
        if (a.status !== 'deaktiviert') more.push({ label: 'Zugang deaktivieren', icon: 'alert', danger: true, fn: function () { setStatus(e, 'deaktiviert'); } });
        if (more.length) acts.push(moreMenu(more));
      }
      const until = a && a.lockedUntil > Date.now() ? ' bis ' + new Date(a.lockedUntil).toTimeString().slice(0, 5) : '';
      return h('tr', {},
        h('td', { 'data-l': 'Mitarbeiter' }, h('div', { class: 'name-cell' }, h('div', { class: 'avatar', text: DP.initials(e.name) }), h('div', {}, h('div', { class: 'nm', text: e.name }), h('div', { class: 'muted small', text: 'PIN ' + e.pin })))),
        h('td', { 'data-l': 'Benutzername' }, a ? h('span', { class: 'mono', text: a.username }) : h('span', { class: 'muted', text: '–' })),
        h('td', { 'data-l': 'Status' }, badge(s), until ? h('div', { class: 'small muted', text: 'gesperrt' + until }) : null),
        h('td', { 'data-l': 'Zuletzt angemeldet' }, h('span', { class: 'muted', text: a ? DP.relTime(a.lastLogin) : '–' })),
        h('td', {}, h('div', { class: 'acts' }, acts)));
    }
    search.addEventListener('input', fill);
    fill();
    return h('div', {},
      h('div', { class: 'toolbar' }, search, h('div', { class: 'row wrap' }, chips)),
      h('div', { class: 'card tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Mitarbeiter', 'Benutzername', 'Status', 'Zuletzt angemeldet', ''].map(function (t) { return h('th', { text: t }); }))), tbody)));
  }

  function auditView() {
    setTitle('Protokoll');
    const items = state.audit.filter(function (a) { return state.auditFilter === 'all' || WARN_ACTIONS.indexOf(a.action) !== -1; });
    const chips = [['all', 'Alle Ereignisse'], ['warn', 'Nur Sicherheitswarnungen']].map(function (f) {
      const b = h('button', { type: 'button', class: 'chip' + (state.auditFilter === f[0] ? ' active' : ''), text: f[1] });
      b.addEventListener('click', function () { state.auditFilter = f[0]; renderTab(); });
      return b;
    });
    return h('div', {},
      h('div', { class: 'toolbar' }, chips, h('span', { class: 'muted small', text: 'Die letzten 200 Ereignisse. Passwörter werden hier nie gespeichert.' })),
      h('div', { class: 'card tbl-wrap' }, items.length ? items.map(function (a) {
        const l = AUDIT_LABELS[a.action] || [a.action, 'neutral'];
        return h('div', { class: 'log-item' }, h('div', { class: 'muted small', text: DP.fmtDateTime(a.ts) }),
          h('div', {}, h('div', { class: 'row wrap' }, h('span', { class: 'badge ' + l[1], text: l[0] }), a.target ? h('span', { class: 'mono small', text: a.target }) : null), a.details ? h('div', { class: 'small muted', text: a.details }) : null));
      }) : h('div', { class: 'empty', text: 'Keine Einträge.' })));
  }

  // ---------- Dienstplan ----------
  function planRange() {
    const P = state.plan;
    return P.view === 'month' ? [P.monthStart, PD.monthEnd(P.monthStart)] : [P.weekStart, PD.add(P.weekStart, 6)];
  }
  async function loadPlan() {
    const P = state.plan, rg = planRange(), key = P.view + rg[0];
    const r = await adm('adminShiftList', { from: rg[0], to: rg[1] });
    if (key !== P.view + planRange()[0]) return;   // inzwischen anderer Zeitraum gewählt
    if (r.status === 'success') { const c0 = (r.employees || []).filter(function (e) { return e.pin === '00'; })[0]; r.conflict00 = c0 ? c0.name : ''; r.employees = [{ pin: '00', name: 'Offene Schichten' }].concat((r.employees || []).filter(function (e) { return e.pin !== '00'; })); P.data = r; P.error = false; }
    else if (r.code === 'NETWORK') P.error = true;
  }
  async function changeMonth(ms) {
    state.plan.monthStart = ms; state.plan.data = null; state.plan.undo = null;
    renderTab();
    await loadPlan();
    renderTab();
  }
  async function setPlanView(v) {
    const P = state.plan;
    if (P.view === v) return;
    P.view = v; P.data = null; P.brush = null; P.undo = null;
    renderTab();
    await loadPlan();
    renderTab();
  }
  async function changeWeek(ws) {
    state.plan.weekStart = ws; state.plan.data = null;
    renderTab();
    await loadPlan();
    renderTab();
  }
  function draftCount() { const D = state.plan.data; return D ? D.shifts.filter(function (s) { return s.status === 'entwurf'; }).length : 0; }
  const STATUS_TEXT = { entwurf: 'Entwurf (für Mitarbeiter unsichtbar)', veroeffentlicht: 'Veröffentlicht', abgesagt: 'Abgesagt' };

  function viewSeg() {
    const P = state.plan;
    const b = function (key, label) { const x = h('button', { type: 'button', class: P.view === key ? 'active' : '', text: label }); x.addEventListener('click', function () { setPlanView(key); }); return x; };
    return h('div', { class: 'seg', role: 'group', 'aria-label': 'Zeitraum' }, b('week', 'Woche'), b('month', 'Monat'));
  }

  function planView() {
    setTitle('Dienstplan');
    if (state.plan.view === 'month') return monthPlanView();
    const P = state.plan, D = P.data, ws = P.weekStart, today = PD.today();
    const iconBtn = function (icon, label, fn) { const b = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'aria-label': label, title: label }, DP.icon(icon, 'sm')); b.addEventListener('click', fn); return b; };
    const todayBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Heute' });
    todayBtn.addEventListener('click', function () { changeWeek(PD.weekStart(PD.today())); });
    const modeBtn = function (key, label) { const b = h('button', { type: 'button', class: P.mode === key ? 'active' : '', text: label }); b.addEventListener('click', function () { P.mode = key; renderTab(); }); return b; };
    const drafts = draftCount();
    const copyBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, DP.icon('copy', 'sm'), 'Vorwoche kopieren');
    copyBtn.addEventListener('click', copyPrevWeek);
    const pubBtn = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, DP.icon('send', 'sm'), drafts ? 'Veröffentlichen (' + drafts + ')' : 'Veröffentlichen');
    pubBtn.disabled = !drafts;
    pubBtn.addEventListener('click', publishWeek);
    const printBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', title: 'Wochenplan drucken' }, DP.icon('printer', 'sm'), 'Drucken');
    printBtn.addEventListener('click', function () { window.print(); });
    const toolbar = h('div', { class: 'plan-toolbar' }, viewSeg(),
      iconBtn('chevleft', 'Vorherige Woche', function () { changeWeek(PD.add(ws, -7)); }),
      h('div', { class: 'weeklabel', text: 'KW ' + PD.isoWeek(ws) + ' · ' + PD.rangeLabel(ws) }),
      iconBtn('chevright', 'Nächste Woche', function () { changeWeek(PD.add(ws, 7)); }), todayBtn, h('div', { class: 'grow' }),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Ansicht' }, modeBtn('emp', 'Nach Mitarbeiter'), modeBtn('place', 'Nach Standort')), printBtn, copyBtn, pubBtn);
    const legend = h('div', { class: 'legend' },
      h('span', {}, h('span', { class: 'sw' }), 'Veröffentlicht (Mitarbeiter sieht sie)'), h('span', {}, h('span', { class: 'sw draft' }), 'Entwurf (noch unsichtbar)'), h('span', {}, h('span', { class: 'sw cancel' }), 'Abgesagt'), h('span', {}, h('span', { class: 'sw krank' }), 'Krank'), h('span', {}, h('span', { class: 'sw urlaub' }), 'Urlaub (gestrichelt = beantragt)'));
    if (!D) return h('div', { class: 'stack' }, toolbar, h('div', { class: 'empty' }, P.error ? 'Verbindung unterbrochen. Es wird automatisch erneut versucht.' : h('span', { class: 'spinner' })));

    const days = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return PD.add(ws, i); });
    const nameByPin = {}, acctByPin = {};
    D.employees.forEach(function (e) { nameByPin[e.pin] = e.name; });
    state.employees.forEach(function (e) { acctByPin[e.pin] = e.account; });
    const idx = {};
    D.shifts.forEach(function (s) { const k = (P.mode === 'emp' ? s.pin : s.place) + '|' + s.date; (idx[k] = idx[k] || []).push(s); });
    const absByPin = {};
    (D.absences || []).forEach(function (x) { (absByPin[x.pin] = absByPin[x.pin] || []).push(x); });
    const unavByPin = {};
    (D.unavail || []).forEach(function (x) { (unavByPin[x.pin] = unavByPin[x.pin] || []).push(x); });
    const unavChip = function (x) { return h('div', { class: 'unavchip', title: 'Nicht verfügbar' + (x.text ? ': ' + x.text : '') }, 'Nicht verfügbar'); };
    const absChip = function (x) {
      const label = x.type === 'krank' ? 'Krank' : x.status === 'genehmigt' ? 'Urlaub' : 'Urlaub?';
      return h('div', { class: 'abs ' + x.type + (x.status === 'offen' && x.type === 'urlaub' ? ' pending' : ''), title: (x.type === 'krank' ? 'Krank gemeldet' : x.status === 'genehmigt' ? 'Urlaub (genehmigt)' : 'Urlaub beantragt, noch nicht entschieden') + ' · ' + PD.short(x.from) + (x.from !== x.to ? ' – ' + PD.short(x.to) : ''), text: label });
    };
    const chip = function (s) {
      const name = nameByPin[s.pin] || ('PIN ' + s.pin);
      const b = h('button', { type: 'button', class: 'cs' + (s.status === 'entwurf' ? ' draft' : '') + (s.status === 'abgesagt' ? ' cancelled' : '') + DP.placeClass(s.place),
        title: name + ' · ' + s.place + ' · ' + s.start + '–' + s.end + ' (' + PD.fmtHours(s.hours) + ' Std.) · ' + STATUS_TEXT[s.status] + (s.note ? ' · Hinweis: ' + s.note : '') },
        h('span', { class: 'pl', text: P.mode === 'emp' ? s.place : name }), h('span', { class: 'tm', text: s.start + '–' + s.end }));
      b.addEventListener('click', function () { openShiftModal({ shift: s }); });
      return b;
    };
    const rows = [];
    if (P.mode === 'emp') {
      D.employees.slice().sort(byName).forEach(function (e) {
        let sum = 0;
        D.shifts.forEach(function (s) { if (s.pin === e.pin && s.status !== 'abgesagt') sum += s.hours; });
        const acct = acctByPin[e.pin];
        const cells = days.map(function (d) {
          const add = h('button', { type: 'button', class: 'add-cell', 'aria-label': 'Schicht für ' + e.name + ' am ' + PD.short(d) + ' hinzufügen' }, DP.icon('plus', 'sm'));
          add.addEventListener('click', function () { openShiftModal({ pin: e.pin, date: d }); });
          const abs = (absByPin[e.pin] || []).filter(function (x) { return x.from <= d && d <= x.to; });
          const un = (unavByPin[e.pin] || []).filter(function (x) { return x.from <= d && d <= x.to; });
          return h('td', { class: (d === today ? 'today' : '') + (abs.length ? ' absent' : '') + (un.length ? ' unav' : '') }, abs.map(absChip), un.map(unavChip), (idx[e.pin + '|' + d] || []).map(chip), add);
        });
        rows.push(h('tr', {}, h('td', { class: 'who' }, h('div', { class: 'whocell' }, h('div', { class: 'avatar', text: DP.initials(e.name) }),
          h('div', {}, h('div', { class: 'nm', text: e.name, dataset: { pin: e.pin } }), e.pin === '00' ? h('span', { class: 'badge info', text: 'für alle' }) : !acct ? h('span', { class: 'badge neutral', text: 'kein Zugang', title: 'Hat noch keinen Zugang und sieht den Plan nicht.' }) : null))),
          cells, h('td', { class: 'sum' + (D.rulesOn && sum > D.limits.weekHours ? ' warn' : ''), title: 'Summe der Woche (ohne abgesagte)', text: sum ? PD.fmtHours(sum) + ' Std.' : '–' })));
      });
    } else {
      D.places.forEach(function (pl) {
        let n = 0;
        D.shifts.forEach(function (s) { if (s.place === pl && s.status !== 'abgesagt') n++; });
        const cells = days.map(function (d) {
          const add = h('button', { type: 'button', class: 'add-cell', 'aria-label': 'Schicht am Standort ' + pl + ' am ' + PD.short(d) + ' hinzufügen' }, DP.icon('plus', 'sm'));
          add.addEventListener('click', function () { openShiftModal({ place: pl, date: d }); });
          return h('td', { class: d === today ? 'today' : '' }, (idx[pl + '|' + d] || []).map(chip), add);
        });
        rows.push(h('tr', {}, h('td', { class: 'who' }, h('div', { class: 'nm', text: pl })), cells, h('td', { class: 'sum', title: 'Schichten in dieser Woche', text: n ? String(n) : '–' })));
      });
    }
    const head = h('tr', {}, h('th', { text: P.mode === 'emp' ? 'Mitarbeiter' : 'Standort' }),
      days.map(function (d) { return h('th', { class: d === today ? 'today' : '', text: PD.short(d) }); }), h('th', { text: P.mode === 'emp' ? 'Σ Woche' : 'Schichten' }));
    const placeLegend = P.mode === 'emp' ? h('div', { class: 'legend places' }, D.places.map(function (pl) { return h('span', { class: 'plg' + DP.placeClass(pl) }, h('i', { class: 'dotc' }), pl); })) : null;
    return h('div', { class: 'stack' }, h('div', { class: 'print-only print-title', text: 'Dienstplan KW ' + PD.isoWeek(ws) + ' · ' + PD.rangeLabel(ws) }), toolbar, legend, placeLegend,
      h('div', { class: 'card grid-wrap' }, rows.length ? h('table', { class: 'plan' }, h('thead', {}, head), h('tbody', {}, rows)) : h('div', { class: 'empty', text: 'Keine Mitarbeiter vorhanden.' })),
      h('p', { class: 'muted small', text: 'Klicke auf eine Schicht zum Bearbeiten oder auf das Plus in einem Feld zum Anlegen. Neue Schichten sind zuerst Entwürfe. Erst „Veröffentlichen“ macht sie für die Mitarbeiter sichtbar.' }));
  }

  function field(label, input, id, hint) { return h('div', { class: 'field' }, h('label', { for: id, text: label }), input, hint ? h('div', { class: 'hint', text: hint }) : null); }
  function confirmWarnings(warnings) {
    return new Promise(function (resolve) {
      let go = false;
      DP.modal({
        title: 'Bitte prüfen', onClose: function () { resolve(go); },
        body: h('div', { class: 'stack-sm' }, h('p', { text: warnings.every(function (w) { return w.code === 'UNAVAILABLE'; }) ? 'Bitte kurz prüfen:' : 'Diese Schicht überschreitet empfohlene Grenzen:' }),
          h('ul', { class: 'warn-list' }, warnings.map(function (w) { return h('li', { text: w.message }); })),
          h('p', { class: 'hint', text: warnings.every(function (w) { return w.code === 'UNAVAILABLE'; }) ? 'Der Mitarbeiter hat sich für diesen Tag abgemeldet. Du entscheidest, ob du ihn trotzdem einplanst.' : 'Du entscheidest, ob du sie trotzdem einplanst. Verantwortlich für die Einhaltung der Arbeitszeitregeln bleibt die Firma.' })),
        actions: [{ label: 'Zurück', kind: 'secondary' }, { label: 'Trotzdem speichern', kind: 'primary', onClick: function () { go = true; } }]
      });
    });
  }

  function openShiftModal(init) {
    const D = state.plan.data, ed = init.shift || null;
    const emps = D.employees.slice().sort(byName);
    if (ed && ed.status === 'abgesagt') {
      DP.modal({
        title: 'Abgesagte Schicht', wide: true,
        body: h('div', { class: 'stack-sm' }, h('p', { text: (ed.pin && (emps.filter(function (e) { return e.pin === ed.pin; })[0] || {}).name || 'Mitarbeiter') + ' · ' + PD.short(ed.date) + ' · ' + ed.place + ' · ' + ed.start + '–' + ed.end }),
          h('p', { class: 'muted small', text: 'Diese Schicht wurde abgesagt. Der Mitarbeiter sieht sie als „abgesagt“. Du kannst sie endgültig entfernen, damit sie auch dort verschwindet.' })),
        actions: [{ label: 'Schließen', kind: 'secondary' }, { label: 'Endgültig entfernen', kind: 'danger', closes: false, onClick: function (api) { return removeShift(ed, api); } }]
      });
      return;
    }
    const emp = h('select', { class: 'input', id: 'sh_emp' }, emps.map(function (e) { return h('option', { value: e.pin, text: e.name }); }));
    const dateIn = h('input', { class: 'input', id: 'sh_date', type: 'date' });
    const placeSel = h('select', { class: 'input', id: 'sh_place' }, D.places.map(function (p) { return h('option', { value: p, text: p }); }));
    const startIn = h('input', { class: 'input', id: 'sh_start', type: 'time', step: '300' });
    const endIn = h('input', { class: 'input', id: 'sh_end', type: 'time', step: '300' });
    const noteIn = h('input', { class: 'input', id: 'sh_note', type: 'text', maxlength: '200', placeholder: 'z. B. Schlüssel bei der Zentrale abholen' });
    const dur = h('span', { class: 'hint' });
    const presets = h('div', { class: 'presets' });
    const err = h('div', {});
    emp.value = ed ? ed.pin : (init.pin || (emps[0] && emps[0].pin) || '');
    dateIn.value = ed ? ed.date : (init.date || PD.today());
    placeSel.value = ed ? ed.place : (init.place || D.places[0]);
    noteIn.value = ed ? (ed.note || '') : '';
    let touched = !!ed;
    function updDur() { const x = PD.hours(startIn.value, endIn.value); dur.textContent = x === null ? '' : 'Dauer: ' + PD.fmtHours(x) + ' Std.'; }
    function renderPresets(apply) {
      const list = D.templates.filter(function (t) { return t.place === placeSel.value; });
      presets.replaceChildren(...list.map(function (t) {
        const b = h('button', { type: 'button', class: 'chip', text: t.start + '–' + t.end + ' (' + t.typ + ')' });
        b.addEventListener('click', function () { startIn.value = t.start; endIn.value = t.end; touched = true; updDur(); });
        return b;
      }));
      if (apply && !touched && list[0]) { startIn.value = list[0].start; endIn.value = list[0].end; }
      updDur();
    }
    if (ed) { startIn.value = ed.start; endIn.value = ed.end; }
    renderPresets(!ed);
    placeSel.addEventListener('change', function () { renderPresets(true); });
    [startIn, endIn].forEach(function (i) { i.addEventListener('input', function () { touched = true; updDur(); }); });
    const body = h('div', { class: 'stack' }, h('div', { class: 'form-grid' },
      field('Mitarbeiter', emp, 'sh_emp'), field('Datum', dateIn, 'sh_date'),
      h('div', { class: 'full' }, field('Standort', placeSel, 'sh_place')),
      h('div', { class: 'full field' }, h('label', { text: 'Zeit-Vorlagen' }), presets),
      field('Beginn', startIn, 'sh_start'), field('Ende', endIn, 'sh_end'), h('div', { class: 'full' }, dur),
      h('div', { class: 'full' }, field('Hinweis für den Mitarbeiter (optional)', noteIn, 'sh_note'))),
      ed ? h('p', { class: 'muted small', text: 'Status: ' + STATUS_TEXT[ed.status] + (ed.status === 'veroeffentlicht' ? '. Änderungen sind für den Mitarbeiter sofort sichtbar.' : '') }) : h('p', { class: 'muted small', text: 'Wird als Entwurf gespeichert und ist erst nach „Veröffentlichen“ sichtbar.' }), err);
    async function save(api, confirm) {
      err.replaceChildren();
      const payload = { pin: emp.value, date: dateIn.value, place: placeSel.value, start: startIn.value, end: endIn.value, note: noteIn.value };
      if (ed) payload.id = ed.id;
      if (confirm) payload.confirm = true;
      const r = await adm('adminShiftSave', payload);
      if (r.status === 'success') {
        api.close();
        DP.toast(ed ? (ed.status === 'veroeffentlicht' ? 'Änderung gespeichert. Der Mitarbeiter sieht sie sofort.' : 'Entwurf gespeichert.') : 'Als Entwurf gespeichert.');
        await loadPlan(); renderTab();
        return;
      }
      if (r.status === 'warning') { if (await confirmWarnings(r.warnings)) await save(api, true); return; }
      if (r.code === 'ADMIN_AUTH') return;
      err.append(alertBox('error', r.message || 'Speichern fehlgeschlagen.'));
    }
    const actions = [{ label: 'Abbrechen', kind: 'secondary' }];
    if (ed) actions.push({ label: 'Ersatz finden', kind: 'secondary', icon: 'users', closes: false, onClick: function (api) { return openReplacement(ed, api); } });
    if (ed) actions.push({ label: ed.status === 'veroeffentlicht' ? 'Schicht absagen' : 'Entwurf löschen', kind: 'danger', closes: false, onClick: function (api) { return removeShift(ed, api); } });
    actions.push({ label: ed ? 'Änderung speichern' : 'Als Entwurf speichern', kind: 'primary', closes: false, onClick: function (api) { return save(api, false); } });
    DP.modal({ title: ed ? 'Schicht bearbeiten' : 'Neue Schicht', body: body, actions: actions, wide: true });
  }
  async function removeShift(s, api) {
    const t = s.status === 'veroeffentlicht'
      ? ['Schicht absagen?', 'Der Mitarbeiter sieht die Schicht danach als „abgesagt“.', 'Absagen']
      : s.status === 'abgesagt' ? ['Endgültig entfernen?', 'Die abgesagte Schicht verschwindet auch beim Mitarbeiter.', 'Entfernen'] : ['Entwurf löschen?', 'Der Entwurf wird gelöscht. Der Mitarbeiter hat ihn nie gesehen.', 'Löschen'];
    if (!(await DP.confirm(t[0], t[1], t[2], 'danger'))) return;
    const r = await adm('adminShiftDelete', { id: s.id });
    if (r.status === 'success') {
      api.close();
      DP.toast(r.result === 'abgesagt' ? 'Schicht abgesagt. Der Mitarbeiter sieht sie als „abgesagt“.' : 'Entfernt.');
      await loadPlan(); renderTab();
    } else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Das hat nicht geklappt.', 'error');
  }
  async function publishWeek() {
    const n = draftCount(), P = state.plan;
    if (!n) return;
    if (!(await DP.confirm('Dienstplan veröffentlichen?', n + (n === 1 ? ' Entwurf' : ' Entwürfe') + ' in KW ' + PD.isoWeek(P.weekStart) + ' werden für die Mitarbeiter sofort sichtbar. Wer noch keinen Zugang hat, sieht den Plan erst nach der Einrichtung.', 'Veröffentlichen', 'primary'))) return;
    const r = await adm('adminShiftPublish', { from: P.weekStart, to: PD.add(P.weekStart, 6) });
    if (r.status === 'success') { DP.toast(r.published + (r.published === 1 ? ' Schicht veröffentlicht.' : ' Schichten veröffentlicht.')); await loadPlan(); renderTab(); }
    else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Veröffentlichen hat nicht geklappt.', 'error');
  }
  async function copyPrevWeek() {
    const P = state.plan, from = PD.add(P.weekStart, -7);
    if (!(await DP.confirm('Vorwoche kopieren?', 'Alle Schichten aus KW ' + PD.isoWeek(from) + ' werden als Entwürfe in KW ' + PD.isoWeek(P.weekStart) + ' kopiert. Schon vorhandene Schichten bleiben unverändert.', 'Kopieren', 'primary'))) return;
    const r = await adm('adminShiftCopyWeek', { fromStart: from, toStart: P.weekStart });
    if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Kopieren hat nicht geklappt.', 'error'); return; }
    await loadPlan(); renderTab();
    const parts = [h('p', { text: r.copied + (r.copied === 1 ? ' Schicht kopiert' : ' Schichten kopiert') + ' (als Entwürfe).' })];
    if (r.duplicates) parts.push(h('p', { class: 'muted small', text: r.duplicates + ' waren schon vorhanden und wurden nicht doppelt angelegt.' }));
    if (r.conflictCount) parts.push(h('div', { class: 'alert warn' }, DP.icon('alert', 'sm'), h('div', {}, h('strong', { text: r.conflictCount + ' übersprungen (Überschneidung):' }), h('ul', { class: 'warn-list' }, r.conflicts.map(function (c) { return h('li', { text: c }); })))));
    if (r.warnings && r.warnings.length) parts.push(h('div', { class: 'alert info' }, DP.icon('alert', 'sm'), h('div', {}, h('strong', { text: 'Bitte prüfen:' }), h('ul', { class: 'warn-list' }, r.warnings.map(function (c) { return h('li', { text: c }); })))));
    DP.modal({ title: 'Woche kopiert', body: h('div', { class: 'stack-sm' }, parts), actions: [{ label: 'OK', kind: 'primary' }] });
  }

  // ---------- Daten für Dashboard, Anträge, Nachrichten ----------
  async function loadDash() { const r = await adm('adminDashboard'); if (r.status === 'success') state.dash = r; }
  async function loadRequests() { const r = await adm('adminRequestList'); if (r.status === 'success') state.req.data = r; }
  async function loadMessages() { const r = await adm('adminListMessages'); if (r.status === 'success') state.msg.data = r.messages || []; }
  async function loadForTab(tab) {
    if (tab === 'plan') await loadPlan();
    else if (tab === 'requests') await Promise.all([loadRequests(), loadDash()]);
    else if (tab === 'messages') await Promise.all([loadMessages(), loadDash()]);
    else if (tab === 'report') await loadReport();
    else if (tab === 'staff') await loadStaff();
    else if (tab === 'places') await loadPlaces();
    else if (tab === 'users') await loadUsers();
    else if (tab === 'audit' || tab === 'overview') await Promise.all([loadAudit(), loadDash(), tab === 'overview' ? loadSettings() : null]);
  }

  // ---------- Anträge ----------
  const REQ_ICON = { krank: 'pluscircle', urlaub: 'sun', tausch: 'swap', aenderung: 'clock', verfuegbar: 'x' };
  function reqStatus(q) {
    if (q.type === 'krank') return q.status === 'offen' ? ['Gemeldet', 'warn'] : q.status === 'genehmigt' ? ['Bestätigt', 'success'] : ['Zurückgezogen', 'neutral'];
    return ({ offen: ['Offen', 'warn'], genehmigt: ['Genehmigt', 'success'], abgelehnt: ['Abgelehnt', 'danger'], zurueckgezogen: ['Zurückgezogen', 'neutral'] })[q.status] || [q.status, 'neutral'];
  }
  async function afterRequestChange() { await Promise.all([loadRequests(), loadDash(), loadPlan()]); renderChrome(); renderTab(); }

  function requestsView() {
    setTitle('Anträge');
    const R = state.req, D = R.data;
    const open = D ? D.openCount : 0;
    const chips = [['open', 'Offen' + (D ? ' ' + open : '')], ['all', 'Alle']].map(function (f) {
      const b = h('button', { type: 'button', class: 'chip' + (R.filter === f[0] ? ' active' : ''), text: f[1] });
      b.addEventListener('click', function () { R.filter = f[0]; renderTab(); });
      return b;
    });
    const absBtn = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, DP.icon('plus', 'sm'), 'Abwesenheit eintragen');
    absBtn.addEventListener('click', openAbsenceModal);
    const toolbar = h('div', { class: 'toolbar' }, chips, h('div', { class: 'grow' }), absBtn);
    if (!D) return h('div', {}, toolbar, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    const list = D.requests.filter(function (q) { return R.filter === 'all' || q.status === 'offen'; });
    return h('div', {}, toolbar, list.length ? h('div', { class: 'stack-sm' }, list.map(adminRequestCard))
      : h('div', { class: 'card empty' }, R.filter === 'open' ? 'Alles erledigt: Es gibt keine offenen Anträge.' : 'Noch keine Anträge.'));
  }
  function adminRequestCard(q) {
    const st = reqStatus(q);
    const when = q.from === q.to ? PD.short(q.from) : PD.short(q.from) + ' – ' + PD.short(q.to);
    const btn = function (label, kind, icon, fn) { const b = h('button', { type: 'button', class: 'btn btn-sm btn-' + kind }, DP.icon(icon, 'sm'), label); b.addEventListener('click', fn); return b; };
    const acts = [];
    if (q.status === 'offen') {
      acts.push(btn(q.type === 'krank' ? 'Bestätigen' : 'Genehmigen', 'primary', 'check', function () { decide(q, 'genehmigt'); }));
      if (q.type !== 'krank') acts.push(btn('Ablehnen', 'danger', 'x', function () { decide(q, 'abgelehnt'); }));
      if (q.shiftId && q.shift) acts.push(btn('Schicht öffnen', 'secondary', 'calendar', function () { openShiftFromRequest(q); }));
    }
    const aff0 = (q.affected || []).filter(function (x) { return x.status !== 'abgesagt'; });
    if (aff0.length && q.status !== 'zurueckgezogen' && q.status !== 'abgelehnt' && (q.type === 'krank' || q.type === 'urlaub')) {
      acts.push(btn('Ersatz finden' + (aff0.length > 1 ? ' (' + aff0.length + ')' : ''), 'secondary', 'users', function () { pickAffected(aff0); }));
    }
    acts.push(btn('Entfernen', 'ghost', 'trash', async function () {
      if (!(await DP.confirm('Eintrag entfernen?', 'Der Eintrag verschwindet auch beim Mitarbeiter. Das lässt sich nicht rückgängig machen.', 'Entfernen', 'danger'))) return;
      const r = await adm('adminRequestDelete', { id: q.id });
      if (r.status === 'success') { DP.toast('Entfernt.'); afterRequestChange(); } else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Das hat nicht geklappt.', 'error');
    }));
    const aff = q.affected || [];
    return h('div', { class: 'reqcard ' + q.type },
      h('div', { class: 'ico' }, DP.icon(REQ_ICON[q.type] || 'file')),
      h('div', { class: 'grow stack-sm' },
        h('div', { class: 'row wrap' }, h('span', { class: 't', text: q.name }), h('span', { class: 'muted', text: q.label }), h('span', { class: 'badge ' + st[1], text: st[0] }),
          q.source === 'admin' ? h('span', { class: 'badge neutral', text: 'vom Admin eingetragen' }) : null, h('span', { class: 'muted small', text: 'eingegangen ' + DP.relTime(q.created) })),
        h('div', { class: 'sub', text: when + (q.shift ? ' · ' + q.shift.start + '–' + q.shift.end + ' · ' + q.shift.place : '') }),
        q.text ? h('div', { class: 'note' }, DP.icon('sticky', 'sm'), h('span', { text: q.text })) : null,
        q.wish ? h('div', { class: 'note wish' }, DP.icon('clock', 'sm'), h('span', { text: 'Wunsch: ' + wishText(q.wish) })) : null,
        q.reply ? h('div', { class: 'note reply' }, DP.icon('chat', 'sm'), h('span', { text: 'Deine Antwort: ' + q.reply })) : null,
        aff.length && q.status !== 'zurueckgezogen' ? h('div', { class: 'row wrap small' }, h('span', { class: 'muted', text: 'Betroffene Schichten:' }), aff.map(function (x) { return h('span', { class: 'badge ' + (x.status === 'entwurf' ? 'neutral' : 'info'), text: PD.short(x.date) + ' ' + x.start + '–' + x.end + (x.status === 'entwurf' ? ' (Entwurf)' : '') }); })) : null,
        h('div', { class: 'row wrap' }, acts)));
  }
  // ---------- Antrag entscheiden: bestätigen UND umsetzen in einem Schritt ----------
  function wishText(w) {
    return [w.start || w.end ? 'Zeit ' + (w.start || '…') + '–' + (w.end || '…') : '', w.place ? 'Standort ' + w.place : ''].filter(Boolean).join(' · ');
  }
  const QUICK = {
    genehmigt: { krank: ['Gute Besserung!', 'Gute Besserung, melde dich bitte rechtzeitig zurück.'], urlaub: ['Genehmigt, schönen Urlaub!', 'Passt, viel Erholung!'], tausch: ['Passt, ist geregelt.', 'Genehmigt, der Kollege übernimmt.'], aenderung: ['Passt, ist geändert.', 'Genehmigt, ich habe es im Plan angepasst.'] },
    abgelehnt: { urlaub: ['Leider nicht möglich, wir sind in dem Zeitraum zu knapp besetzt.', 'Zu kurzfristig, bitte früher beantragen.'], tausch: ['Leider findet sich kein Ersatz.', 'Das lässt sich leider nicht tauschen.'], aenderung: ['Leider nicht möglich, die Schicht muss so bleiben.', 'Das passt leider nicht in den Plan.'], krank: [] }
  };
  async function decide(q, decision) {
    const quick = (QUICK[decision] || {})[q.type] || [];
    const reply = h('textarea', { class: 'input textarea', id: 'dc_reply', maxlength: '300', placeholder: decision === 'abgelehnt' ? 'Begründung für den Mitarbeiter (empfohlen)' : 'Antwort an den Mitarbeiter (optional)' });
    if (decision === 'genehmigt' && quick[0]) reply.value = quick[0];
    const chips = h('div', { class: 'presets' }, quick.map(function (t) { const b = h('button', { type: 'button', class: 'chip', text: t }); b.addEventListener('click', function () { reply.value = t; }); return b; }));
    const err = h('div', {});
    const head = h('p', { class: 'muted', text: q.name + ' · ' + q.label + ' · ' + (q.from === q.to ? PD.short(q.from) : PD.short(q.from) + ' – ' + PD.short(q.to)) });
    const nodes = [head];
    const choices = [];   // { shift, select }
    let applyBox = null;
    if (decision === 'genehmigt') {
      const pv = await adm('adminRequestPreview', { id: q.id });
      if (pv.status !== 'success') { if (pv.code !== 'ADMIN_AUTH') DP.toast(pv.message || 'Das hat nicht geklappt.', 'error'); return; }
      if (pv.items.length && (q.type === 'krank' || q.type === 'urlaub' || q.type === 'tausch')) {
        nodes.push(h('h3', { text: q.type === 'tausch' ? 'Wer übernimmt die Schicht?' : 'Was passiert mit den ' + pv.items.length + (pv.items.length === 1 ? ' Schicht' : ' Schichten') + '?' }));
        pv.items.forEach(function (it) {
          const sel = h('select', { class: 'input', 'aria-label': 'Ersatz für ' + PD.short(it.shift.date) });
          sel.append(h('option', { value: 'cancel', text: 'Schicht absagen (kein Ersatz)' }));
          sel.append(h('option', { value: 'keep', text: q.type === 'tausch' ? 'Nur genehmigen, Plan nicht ändern' : 'Schicht lassen (später entscheiden)' }));
          it.candidates.forEach(function (c) {
            const label = c.name + ' · ' + (c.verdict === 'frei' ? 'frei' : c.verdict === 'warnung' ? 'mit Hinweis' : 'nicht möglich') + (c.verdict === 'blockiert' ? (c.reasons[0] ? ' (' + c.reasons[0].replace(/\.$/, '') + ')' : '') : ' · ' + PD.fmtHours(c.weekHours) + ' Std./Woche');
            const o = h('option', { value: 'assign:' + c.pin, text: label });
            if (c.verdict === 'blockiert') o.disabled = true;
            sel.append(o);
          });
          sel.value = it.bestPin ? 'assign:' + it.bestPin : (q.type === 'tausch' ? 'keep' : 'cancel');
          choices.push({ shift: it.shift, select: sel });
          nodes.push(h('div', { class: 'decrow' }, h('div', { class: 'grow' }, h('strong', { text: PD.short(it.shift.date) + ' · ' + it.shift.start + '–' + it.shift.end }), h('div', { class: 'muted small', text: it.shift.place + (it.shift.status === 'entwurf' ? ' (Entwurf)' : '') })), sel));
        });
        nodes.push(h('p', { class: 'hint', text: 'Voreingestellt ist der beste freie Kollege (am wenigsten Stunden in der Woche). Du kannst jede Zeile ändern.' }));
      }
      if (q.type === 'aenderung' && pv.items.length) {
        const s = pv.items[0].shift, w = q.wish || {};
        const pl = h('select', { class: 'input', id: 'ap_place' }, (state.plan.data ? state.plan.data.places : DP.PLACES).map(function (p) { return h('option', { value: p, text: p }); }));
        pl.value = w.place || s.place;
        const st = h('input', { class: 'input', id: 'ap_start', type: 'time', value: w.start || s.start });
        const en = h('input', { class: 'input', id: 'ap_end', type: 'time', value: w.end || s.end });
        const use = h('input', { type: 'checkbox', id: 'ap_use' });
        use.checked = !!q.wish;
        applyBox = { use: use, pl: pl, st: st, en: en };
        nodes.push(h('h3', { text: 'Änderung direkt in den Plan übernehmen?' }),
          h('p', { class: 'muted small', text: 'Aktuell: ' + PD.short(s.date) + ' · ' + s.start + '–' + s.end + ' · ' + s.place + (q.wish ? '. Wunsch: ' + wishText(q.wish) : '') }),
          h('label', { class: 'check' }, use, h('span', {}, 'Ja, jetzt in den Plan eintragen', h('div', { class: 'hint', text: 'Der Mitarbeiter sieht die Schicht dann sofort mit „Neu / geändert“.' }))),
          h('div', { class: 'form-grid' }, field('Beginn', st, 'ap_start'), field('Ende', en, 'ap_end'), h('div', { class: 'full' }, field('Standort', pl, 'ap_place'))));
      }
    }
    nodes.push(field('Antwort', reply, 'dc_reply'), chips, err);
    const verb = decision === 'abgelehnt' ? 'Ablehnen' : q.type === 'krank' ? 'Bestätigen' : 'Genehmigen';
    DP.modal({
      title: decision === 'abgelehnt' ? 'Antrag ablehnen' : q.type === 'krank' ? 'Krankmeldung bestätigen' : 'Antrag genehmigen', wide: true, body: h('div', { class: 'stack' }, nodes),
      actions: [{ label: 'Abbrechen', kind: 'secondary' }, {
        label: decision === 'abgelehnt' ? 'Ablehnen' : choices.length || applyBox ? verb + ' und umsetzen' : verb, kind: decision === 'abgelehnt' ? 'danger' : 'primary', closes: false,
        onClick: async function (api) {
          const payload = { id: q.id, decision: decision, reply: reply.value };
          if (decision === 'genehmigt') {
            if (choices.length) payload.plan = choices.map(function (c) { const v = c.select.value; return v.indexOf('assign:') === 0 ? { shiftId: c.shift.id, action: 'assign', pin: v.slice(7) } : { shiftId: c.shift.id, action: v }; });
            if (applyBox && applyBox.use.checked) payload.apply = { place: applyBox.pl.value, start: applyBox.st.value, end: applyBox.en.value };
          }
          const r = await adm('adminRequestDecide', payload);
          if (r.status === 'success') {
            api.close();
            const parts = [];
            if (r.assigned) parts.push(r.assigned + (r.assigned === 1 ? ' Schicht übergeben' : ' Schichten übergeben'));
            if (r.cancelled) parts.push(r.cancelled + (r.cancelled === 1 ? ' Schicht abgesagt' : ' Schichten abgesagt'));
            if (r.changed) parts.push('Schicht geändert');
            DP.toast((decision === 'abgelehnt' ? 'Abgelehnt.' : q.type === 'krank' ? 'Bestätigt.' : 'Genehmigt.') + (parts.length ? ' ' + parts.join(', ') + '.' : ''));
            if (r.skipped && r.skipped.length) DP.modal({ title: 'Nicht alles ließ sich umsetzen', body: h('div', { class: 'stack-sm' }, h('p', { text: 'Der Antrag ist bearbeitet, aber diese Punkte musst du selbst im Plan erledigen:' }), h('ul', { class: 'warn-list' }, r.skipped.map(function (x) { return h('li', { text: x }); }))), actions: [{ label: 'OK', kind: 'primary' }] });
            afterRequestChange();
          } else if (r.code !== 'ADMIN_AUTH') err.replaceChildren(alertBox('error', r.message || 'Das hat nicht geklappt.'));
        }
      }]
    });
  }
  async function openShiftFromRequest(q) {
    state.plan.weekStart = PD.weekStart(q.shift.date); state.plan.data = null; state.tab = 'plan';
    renderChrome(); renderTab();
    await loadPlan(); renderTab();
    const s = state.plan.data && state.plan.data.shifts.filter(function (x) { return x.id === q.shiftId; })[0];
    if (s) openShiftModal({ shift: s });
  }
  function openAbsenceModal() {
    const emps = state.employees.slice().sort(byName);
    const emp = h('select', { class: 'input', id: 'ab_emp' }, emps.map(function (e) { return h('option', { value: e.pin, text: e.name }); }));
    const type = h('select', { class: 'input', id: 'ab_type' }, h('option', { value: 'krank', text: 'Krank' }), h('option', { value: 'urlaub', text: 'Urlaub / frei' }));
    const from = h('input', { class: 'input', id: 'ab_from', type: 'date', value: PD.today() });
    const to = h('input', { class: 'input', id: 'ab_to', type: 'date', value: PD.today() });
    from.addEventListener('change', function () { if (to.value < from.value) to.value = from.value; });
    const note = h('input', { class: 'input', id: 'ab_note', type: 'text', maxlength: '300', placeholder: 'Optional, keine Diagnose' });
    const err = h('div', {});
    DP.modal({
      title: 'Abwesenheit eintragen', wide: true,
      body: h('div', { class: 'stack' }, h('p', { class: 'muted small', text: 'Zum Beispiel eine Krankmeldung per Telefon. Der Eintrag gilt sofort und erscheint im Dienstplan.' }),
        h('div', { class: 'form-grid' }, field('Mitarbeiter', emp, 'ab_emp'), field('Art', type, 'ab_type'), field('Von', from, 'ab_from'), field('Bis (einschließlich)', to, 'ab_to'), h('div', { class: 'full' }, field('Hinweis (optional)', note, 'ab_note'))), err),
      actions: [{ label: 'Abbrechen', kind: 'secondary' }, {
        label: 'Eintragen', kind: 'primary', closes: false,
        onClick: async function (api) {
          const r = await adm('adminRequestCreate', { pin: emp.value, type: type.value, from: from.value, to: to.value, text: note.value });
          if (r.status === 'success') {
            api.close();
            const n = (r.request.affected || []).length;
            DP.toast('Eingetragen.' + (n ? ' ' + n + (n === 1 ? ' geplante Schicht betroffen.' : ' geplante Schichten betroffen.') : ''));
            afterRequestChange();
          } else if (r.code !== 'ADMIN_AUTH') err.replaceChildren(alertBox('error', r.message || 'Das hat nicht geklappt.'));
        }
      }]
    });
  }

  // ---------- Nachrichten ----------
  function messagesView() {
    setTitle('Nachrichten');
    const M = state.msg, all = M.data;
    if (!all) return h('div', { class: 'empty' }, h('span', { class: 'spinner' }));
    const threads = {};
    all.forEach(function (m) { (threads[m.pin] = threads[m.pin] || []).push(Object.assign({ ts: Date.parse(m.zeitstempel) || 0 }, m)); });
    const people = {};
    state.employees.forEach(function (e) { people[e.pin] = e.name; });
    Object.keys(threads).forEach(function (p) { if (!people[p]) people[p] = threads[p][0].name; });
    const items = Object.keys(people).map(function (p) {
      const t = threads[p] || [], last = t[t.length - 1];
      return { pin: p, name: people[p], last: last, unanswered: !!last && last.absender === 'Mitarbeiter', ts: last ? last.ts : 0 };
    }).sort(function (x, y) { return (y.unanswered - x.unanswered) || (y.ts - x.ts) || x.name.localeCompare(y.name, 'de'); });
    const listEl = h('div', { class: 'card tbl-wrap thread-list' }, items.map(function (it) {
      const b = h('button', { type: 'button', class: 'thread-item' + (M.pin === it.pin ? ' active' : '') },
        h('div', { class: 'avatar small', text: DP.initials(it.name) }),
        h('div', { class: 'grow' }, h('div', { class: 'nm', text: it.name }), h('div', { class: 'muted small clip', text: it.last ? (it.last.absender === 'Admin' ? 'Du: ' : '') + it.last.text : 'Noch keine Nachrichten' })),
        it.unanswered ? h('span', { class: 'badge warn', text: 'Neu' }) : null);
      b.addEventListener('click', function () { M.pin = it.pin; renderTab(); });
      return b;
    }));
    let pane;
    if (!M.pin) pane = h('div', { class: 'card empty thread-pane' }, 'Wähle links einen Mitarbeiter, um die Unterhaltung zu sehen oder eine Nachricht zu schreiben.');
    else {
      const t = threads[M.pin] || [];
      const input = h('input', { class: 'input', type: 'text', maxlength: '1000', placeholder: 'Nachricht an ' + (people[M.pin] || '') + ' …', 'aria-label': 'Nachricht' });
      const send = h('button', { type: 'button', class: 'btn btn-primary', 'aria-label': 'Senden' }, DP.icon('send', 'sm'));
      const err = h('div', {});
      const go = async function () {
        const text = input.value.trim();
        if (!text) return;
        send.disabled = true;
        const r = await adm('adminReply', { pin: M.pin, text: text });
        send.disabled = false;
        if (r.status === 'success') { input.value = ''; await Promise.all([loadMessages(), loadDash()]); renderChrome(); renderTab(); }
        else if (r.code !== 'ADMIN_AUTH') err.replaceChildren(alertBox('error', r.message || 'Senden hat nicht geklappt.'));
      };
      send.addEventListener('click', go);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      const chat = h('div', { class: 'chat' }, t.length ? t.map(function (m) { return h('div', { class: 'bubble ' + (m.absender === 'Admin' ? 'me' : 'admin') }, m.text, h('span', { class: 'ts', text: DP.fmtDateTime(m.ts) })); }) : h('p', { class: 'muted small', text: 'Noch keine Nachrichten. Schreibe die erste.' }));
      pane = h('div', { class: 'card thread-pane stack-sm' }, h('h3', { text: people[M.pin] || '' }), chat, err, h('div', { class: 'row' }, input, send));
      setTimeout(function () { chat.scrollTop = chat.scrollHeight; }, 0);
    }
    return h('div', { class: 'msgs' }, listEl, pane);
  }

  // ---------- Ersatz finden ----------
  function pickAffected(list) {
    if (list.length === 1) { openReplacement(list[0], null); return; }
    let m;
    const buttons = list.map(function (x) {
      const b = h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, PD.short(x.date) + ' · ' + x.start + '–' + x.end + ' · ' + x.place + (x.status === 'entwurf' ? ' (Entwurf)' : ''));
      b.addEventListener('click', function () { m.close(); openReplacement(x, null); });
      return b;
    });
    m = DP.modal({ title: 'Für welche Schicht?', body: h('div', { class: 'picklist' }, buttons), actions: [{ label: 'Schließen', kind: 'secondary' }] });
  }
  async function openReplacement(shift, parentApi) {
    const r = await adm('adminFindReplacement', { shiftId: shift.id });
    if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Das hat nicht geklappt.', 'error'); return; }
    const s = r.shift;
    const VERD = { frei: ['Frei', 'success'], warnung: ['Mit Hinweis', 'warn'], blockiert: ['Nicht möglich', 'danger'] };
    let m;
    const rows = r.candidates.map(function (c) {
      const v = VERD[c.verdict];
      const take = h('button', { type: 'button', class: 'btn btn-sm ' + (c.verdict === 'frei' ? 'btn-primary' : 'btn-secondary'), text: 'Übernehmen' });
      take.disabled = c.verdict === 'blockiert';
      take.addEventListener('click', async function () {
        if (c.verdict === 'warnung' && !(await confirmWarnings(c.reasons.map(function (x) { return { message: x }; })))) return;
        take.disabled = true;
        const res = await adm('adminShiftSave', { id: s.id, pin: c.pin, date: s.date, place: s.place, start: s.start, end: s.end, note: s.note || '', confirm: true });
        if (res.status === 'success') {
          m.close(); if (parentApi) parentApi.close();
          DP.toast('Schicht an ' + c.name + ' übergeben.' + (s.status === 'veroeffentlicht' ? ' Der bisherige Mitarbeiter sieht sie als abgesagt.' : ''));
          await afterRequestChange();
        } else { take.disabled = false; if (res.code !== 'ADMIN_AUTH') DP.toast(res.message || 'Übergabe hat nicht geklappt.', 'error'); }
      });
      return h('div', { class: 'cand' + (c.verdict === 'blockiert' ? ' off' : '') }, h('div', { class: 'avatar', text: DP.initials(c.name) }),
        h('div', { class: 'grow' }, h('div', { class: 'row wrap' }, h('strong', { text: c.name }), h('span', { class: 'badge ' + v[1], text: v[0] }),
          !c.hasAccount ? h('span', { class: 'badge neutral', text: 'kein Zugang', title: 'Hat noch keinen Zugang und sieht den Plan nicht.' }) : null),
          h('div', { class: 'muted small' }, PD.fmtHours(c.weekHours) + ' Std. in dieser Woche', c.home ? ' · zu Hause: ' + c.home : '', c.phone ? [' · ', telLink(c.phone)] : null),
          c.reasons.length ? h('ul', {}, c.reasons.map(function (x) { return h('li', { text: x }); })) : null), take);
    });
    m = DP.modal({
      title: 'Ersatz finden', wide: true,
      body: h('div', { class: 'stack-sm' }, h('p', { class: 'muted small', text: PD.short(s.date) + ' · ' + s.start + '–' + s.end + ' · ' + s.place + '. Wer am Standort zu Hause ist und wer weniger Stunden in der Woche hat, steht bei den Freien weiter oben.' }), h('div', { class: 'rep-list' }, rows.length ? rows : h('div', { class: 'empty', text: 'Keine anderen Mitarbeiter vorhanden.' }))),
      actions: [{ label: 'Schließen', kind: 'secondary' }]
    });
  }

  // ---------- Auswertung ----------
  async function loadReport() { const R = state.report, mo = R.month; const r = await adm('adminReport', { month: mo }); if (mo === R.month && r.status === 'success') R.data = r; }
  function monthAdd(mo, n) { const p = mo.split('-').map(Number); const d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); }
  const ISSUE_LABEL = { fehlt: ['Nicht gesendet', 'danger'], abweichung: ['Abweichung', 'warn'], ungeplant: ['Ungeplant', 'info'] };
  function num(x) { return String(Math.round(x * 10) / 10).replace('.', ','); }
  function csvText(v) { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  // Nacht-/Sonntagsstunden: gesendete Stunden, solange vorhanden, sonst die geplanten (gedämpft)
  function premTd(label, e, plan, sent) {
    return h('td', { class: 'num' + (e.submitted ? '' : ' muted'), 'data-l': label, title: e.submitted ? 'aus den gesendeten Stunden' : 'geplant (noch keine Stunden gesendet)', text: e.submitted ? (sent ? num(sent) : '–') : (plan ? num(plan) : '–') });
  }
  function downloadReportCsv() {
    const R = state.report, D = R.data;
    if (!D) return;
    const lines = [['Mitarbeiter', 'PIN', 'Schichten', 'Plan-Stunden', 'Gesendete Stunden', 'Differenz', 'Nacht-Std. (Plan)', 'Nacht-Std. (gesendet)', 'Sonntags-Std. (Plan)', 'Sonntags-Std. (gesendet)', 'Krankheitstage', 'Urlaubstage', 'Beanstandungen'].join(';')];
    D.employees.slice().sort(byName).forEach(function (e) {
      const diff = e.submitted ? num(e.actualHours - e.pastHours) : '';
      lines.push([csvText(e.name), csvText(e.pin), e.shifts, num(e.plannedHours), e.submitted ? num(e.actualHours) : '', diff, num(e.nightHours), e.submitted ? num(e.sentNightHours) : '', num(e.sundayHours), e.submitted ? num(e.sentSundayHours) : '', e.sickDays, e.vacationDays, csvText(e.issues.map(function (i) { return PD.short(i.date) + ' ' + ISSUE_LABEL[i.kind][0]; }).join(', '))].join(';'));
    });
    const blob = new Blob(['\ufeff' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'auswertung-' + R.month + '.csv' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    DP.toast('CSV-Datei erstellt.');
  }
  function reportView() {
    setTitle('Auswertung');
    const R = state.report, D = R.data, label = PD.monthLabel(R.month + '-01');
    const go = async function (mo) { R.month = mo; R.data = null; R.open = {}; renderTab(); await loadReport(); renderTab(); };
    const iconBtn = function (icon, text, fn) { const b = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'aria-label': text, title: text }, DP.icon(icon, 'sm')); b.addEventListener('click', fn); return b; };
    const nowBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Dieser Monat' });
    nowBtn.addEventListener('click', function () { go(PD.today().slice(0, 7)); });
    const csv = h('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, DP.icon('download', 'sm'), 'CSV herunterladen');
    csv.addEventListener('click', downloadReportCsv); csv.disabled = !D;
    const prn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, DP.icon('printer', 'sm'), 'Drucken');
    prn.addEventListener('click', function () { window.print(); }); prn.disabled = !D;
    const toolbar = h('div', { class: 'plan-toolbar rep-toolbar' }, iconBtn('chevleft', 'Vorheriger Monat', function () { go(monthAdd(R.month, -1)); }), h('div', { class: 'weeklabel', text: label }),
      iconBtn('chevright', 'Nächster Monat', function () { go(monthAdd(R.month, 1)); }), nowBtn, h('div', { class: 'grow' }), csv, prn);
    const title = h('div', { class: 'print-only print-title', text: 'Auswertung ' + label });
    if (!D) return h('div', { class: 'stack' }, toolbar, h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    const emps = D.employees.slice().sort(byName);
    const tot = { shifts: 0, plan: 0, act: 0, sick: 0, vac: 0, issues: 0 };
    const rows = [];
    emps.forEach(function (e) {
      tot.shifts += e.shifts; tot.plan += e.plannedHours; tot.act += e.actualHours; tot.sick += e.sickDays; tot.vac += e.vacationDays; tot.issues += e.issues.length;
      const diff = e.actualHours - e.pastHours;
      const hint = e.issues.length ? h('button', { type: 'button', class: 'btn btn-sm btn-secondary', text: e.issues.length + (e.issues.length === 1 ? ' Hinweis' : ' Hinweise') }) : h('span', { class: 'muted', text: '–' });
      if (e.issues.length) hint.addEventListener('click', function () { R.open[e.pin] = !R.open[e.pin]; renderTab(); });
      rows.push(h('tr', {},
        h('td', { 'data-l': 'Mitarbeiter' }, h('div', { class: 'name-cell' }, h('div', { class: 'avatar', text: DP.initials(e.name) }), h('div', {}, h('div', { class: 'nm', text: e.name }), e.drafts ? h('div', { class: 'muted small', text: e.drafts + ' Entwurf' + (e.drafts > 1 ? 'e' : '') + ' (nicht gezählt)' }) : null))),
        h('td', { class: 'num', 'data-l': 'Schichten', text: String(e.shifts) }), h('td', { class: 'num', 'data-l': 'Plan-Std.', text: e.shifts ? num(e.plannedHours) : '–' }),
        h('td', { class: 'num', 'data-l': 'Gesendet', text: e.submitted ? num(e.actualHours) : (e.shifts ? 'nicht gesendet' : '–') }),
        h('td', { class: 'num', 'data-l': 'Differenz' }, e.submitted ? h('span', { class: 'diff ' + (Math.abs(diff) >= 0.5 ? 'warn' : 'ok'), title: 'Gesendet minus geplante Stunden der Tage, die schon vorbei sind (' + num(e.pastHours) + ' Std.)', text: (diff > 0 ? '+' : diff < 0 ? '−' : '') + num(Math.abs(diff)) }) : h('span', { class: 'muted', text: '–' })),
        premTd('Nacht', e, e.nightHours, e.sentNightHours), premTd('Sonntag', e, e.sundayHours, e.sentSundayHours),
        h('td', { class: 'num', 'data-l': 'Krank', text: e.sickDays ? String(e.sickDays) : '–' }), h('td', { class: 'num', 'data-l': 'Urlaub', text: e.vacationDays ? String(e.vacationDays) : '–' }),
        h('td', { 'data-l': 'Hinweise' }, hint)));
      if (R.open[e.pin] && e.issues.length) {
        rows.push(h('tr', { class: 'detail' }, h('td', { colspan: '10' }, e.issues.map(function (i) {
          const l = ISSUE_LABEL[i.kind];
          return h('div', { class: 'issue' }, h('span', { class: 'd', text: PD.short(i.date) }), h('span', { class: 'badge ' + l[1], text: l[0] }), h('span', { text: i.text }));
        }))));
      }
    });
    const head = h('tr', {}, ['Mitarbeiter', 'Schichten', 'Plan-Std.', 'Gesendet', 'Differenz', 'Nacht', 'Sonntag', 'Krank', 'Urlaub', 'Hinweise'].map(function (t, i) { return h('th', { class: i > 0 && i < 9 ? 'num' : '', title: t === 'Nacht' ? 'Stunden zwischen 23 und 6 Uhr' : t === 'Sonntag' ? 'Stunden am Sonntag (0 bis 24 Uhr)' : '', text: t }); }));
    const foot = h('tr', {}, h('td', { text: 'Summe' }), h('td', { class: 'num', text: String(tot.shifts) }), h('td', { class: 'num', text: num(tot.plan) }), h('td', { class: 'num', text: num(tot.act) }), h('td', { class: 'num', text: '' }), h('td', { class: 'num', text: num(D.employees.reduce(function (s, e) { return s + (e.submitted ? e.sentNightHours : e.nightHours); }, 0)) }), h('td', { class: 'num', text: num(D.employees.reduce(function (s, e) { return s + (e.submitted ? e.sentSundayHours : e.sundayHours); }, 0)) }), h('td', { class: 'num', text: String(tot.sick) }), h('td', { class: 'num', text: String(tot.vac) }), h('td', { text: tot.issues ? tot.issues + ' offen' : '' }));
    return h('div', { class: 'stack' }, toolbar, title,
      h('div', { class: 'card tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, head), h('tbody', {}, rows), h('tfoot', {}, foot))),
      h('p', { class: 'muted small', text: 'Plan = veröffentlichte Schichten des Monats. Gesendet = von der Stunden-App eingereichte Stunden (nach Korrekturen des Admins). Die Differenz vergleicht nur Tage, die schon vorbei sind. Schichten, die noch kommen, zählen zum Plan, aber nicht zur Differenz.' }));
  }

  // ---------- Einstellungen (Übersicht) ----------
  function settingsCard() {
    const box = h('input', { type: 'checkbox', id: 'st_rules' });
    box.checked = state.settings.rules;
    box.addEventListener('change', async function () {
      const want = box.checked;
      const r = await adm('adminSetSettings', { rules: want });
      if (r.status === 'success') { state.settings.rules = !!r.rules; DP.toast(r.rules ? 'Arbeitszeit-Warnungen sind AN.' : 'Arbeitszeit-Warnungen sind AUS.'); }
      else { box.checked = !want; if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Das hat nicht geklappt.', 'error'); }
    });
    return h('section', { class: 'card stack-sm' }, h('h3', { text: 'Einstellungen' }),
      h('label', { class: 'check' }, box, h('span', {}, 'Arbeitszeit-Warnungen beim Planen', h('div', { class: 'hint', text: 'Warnt vor weniger als 11 Std. Ruhezeit, mehr als 10 Std. am Tag und mehr als 48 Std. pro Woche. Standard ist AUS (Pilotbetrieb). Eine Doppelbelegung bleibt immer gesperrt.' }))));
  }
  const overviewViewBase = overviewView;

  // ---------- Monatsansicht mit Pinsel ----------
  let brushDrag = null;
  function brushLabel(b) { return !b ? 'kein Pinsel' : b.kind === 'erase' ? 'Radierer' : b.place + ' ' + b.start + '–' + b.end; }
  async function commitBrush(pin, dates) {
    const P = state.plan, D = P.data, b = P.brush;
    if (!b || !D || !dates.length) return;
    const ok = dates.filter(function (d) { return P.wd[PD.weekday(d)]; });
    if (!ok.length) { DP.toast('An diesen Wochentagen ist der Pinsel ausgeschaltet.', 'error'); return; }
    const ops = ok.map(function (d) { return b.kind === 'erase' ? { op: 'clear', pin: pin, date: d } : { op: 'set', pin: pin, date: d, place: b.place, start: b.start, end: b.end }; });
    const live = D.shifts.filter(function (s) { return s.pin === pin && s.status === 'veroeffentlicht' && ok.indexOf(s.date) !== -1 && (b.kind === 'erase' || s.place !== b.place || s.start !== b.start || s.end !== b.end); }).length;
    if (live && !(await DP.confirm('Veröffentlichte Schichten ändern?', live + (live === 1 ? ' veröffentlichte Schicht wird ' : ' veröffentlichte Schichten werden ') + (b.kind === 'erase' ? 'abgesagt. Der Mitarbeiter sieht sie als „abgesagt“.' : 'geändert. Der Mitarbeiter sieht die Änderung sofort.'), b.kind === 'erase' ? 'Absagen' : 'Ändern', b.kind === 'erase' ? 'danger' : 'primary'))) return;
    const r = await adm('adminShiftBatch', { ops: ops });
    if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Das hat nicht geklappt.', 'error'); return; }
    const parts = [];
    if (r.created) parts.push(r.created + ' neu');
    if (r.updated) parts.push(r.updated + ' geändert');
    if (r.cleared) parts.push(r.cleared + ' entfernt');
    if (r.unchanged && !parts.length) parts.push('nichts zu ändern');
    if (r.skippedCount) parts.push(r.skippedCount + ' übersprungen');
    if (r.unavailable) parts.push(r.unavailable + (r.unavailable === 1 ? ' Tag' : ' Tage') + ' trotz „nicht verfügbar“');
    DP.toast(parts.join(', ') + '.');
    P.undo = r.undo && r.undo.length ? { list: r.undo, label: parts.join(', ') } : null;
    if (r.skippedCount) {
      const groups = {};
      r.skipped.forEach(function (x) { (groups[x.reason] = groups[x.reason] || []).push(PD.short(x.date)); });
      DP.modal({ title: 'Übersprungene Tage', body: h('div', { class: 'stack-sm' }, Object.keys(groups).map(function (k) { return h('p', {}, h('strong', { text: k }), h('br'), groups[k].join(', ')); })), actions: [{ label: 'OK', kind: 'primary' }] });
    }
    await loadPlan(); renderTab();
  }
  async function copyRhythm() {
    const P = state.plan, ms = P.monthStart, len = PD.diff(ms, PD.add(PD.monthEnd(ms), 1));
    const from = PD.add(ms, -28);
    if (!(await DP.confirm('Rhythmus fortsetzen?', 'Die 28 Tage vor dem ' + PD.short(ms) + ' (ab ' + PD.short(from) + ') werden als Muster für ' + PD.monthLabel(ms) + ' wiederholt. Alles wird als Entwurf angelegt. Krank- und Urlaubstage werden übersprungen, vorhandene Schichten bleiben.', 'Fortsetzen', 'primary'))) return;
    const r = await adm('adminShiftCopyRange', { fromStart: from, toStart: ms, days: len });
    if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Das hat nicht geklappt.', 'error'); return; }
    let copied = r.copied, absent = r.absent, conflicts = r.conflictCount, undoList = (r.undo || []).slice();
    if (len > 28) {   // die letzten 1–3 Tage des Monats aus den ersten Tagen desselben Monats fortsetzen
      const r2 = await adm('adminShiftCopyRange', { fromStart: ms, toStart: PD.add(ms, 28), days: len - 28 });
      if (r2.status === 'success') { copied += r2.copied; absent += r2.absent; conflicts += r2.conflictCount; undoList = undoList.concat(r2.undo || []); }
    }
    P.undo = undoList.length ? { list: undoList, label: copied + ' Schichten kopiert' } : null;
    DP.toast(copied + ' Schichten als Entwurf angelegt' + (absent ? ', ' + absent + ' wegen Krank/Urlaub übersprungen' : '') + (conflicts ? ', ' + conflicts + ' Überschneidungen ausgelassen' : '') + '.');
    await loadPlan(); renderTab();
  }
  async function publishMonth() {
    const P = state.plan, n = draftCount();
    if (!n) return;
    if (!(await DP.confirm('Monat veröffentlichen?', n + (n === 1 ? ' Entwurf' : ' Entwürfe') + ' im ' + PD.monthLabel(P.monthStart) + ' werden für die Mitarbeiter sofort sichtbar.', 'Veröffentlichen', 'primary'))) return;
    const r = await adm('adminShiftPublish', { from: P.monthStart, to: PD.monthEnd(P.monthStart) });
    if (r.status === 'success') { DP.toast(r.published + (r.published === 1 ? ' Schicht veröffentlicht.' : ' Schichten veröffentlicht.')); await loadPlan(); renderTab(); }
    else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Veröffentlichen hat nicht geklappt.', 'error');
  }
  document.addEventListener('mouseup', function () {
    if (!brushDrag) return;
    const d = brushDrag; brushDrag = null;
    d.cells.forEach(function (td) { td.classList.remove('sel'); });
    commitBrush(d.pin, d.dates());
  });
  function monthPlanView() {
    const P = state.plan, D = P.data, ms = P.monthStart, today = PD.today();
    const iconBtn = function (icon, label, fn) { const b = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'aria-label': label, title: label }, DP.icon(icon, 'sm')); b.addEventListener('click', fn); return b; };
    const nowBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Dieser Monat' });
    nowBtn.addEventListener('click', function () { changeMonth(PD.monthStart(PD.today())); });
    const drafts = draftCount();
    const rhythm = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', title: 'Die letzten 28 Tage als Muster für diesen Monat wiederholen' }, DP.icon('copy', 'sm'), 'Rhythmus fortsetzen');
    rhythm.addEventListener('click', copyRhythm);
    const pub = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, DP.icon('send', 'sm'), drafts ? 'Veröffentlichen (' + drafts + ')' : 'Veröffentlichen');
    pub.disabled = !drafts; pub.addEventListener('click', publishMonth);
    const prn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, DP.icon('printer', 'sm'), 'Drucken');
    prn.addEventListener('click', function () { window.print(); });
    const toolbar = h('div', { class: 'plan-toolbar' }, viewSeg(), iconBtn('chevleft', 'Vorheriger Monat', function () { changeMonth(PD.monthAdd(ms, -1)); }), h('div', { class: 'weeklabel', text: PD.monthLabel(ms) }),
      iconBtn('chevright', 'Nächster Monat', function () { changeMonth(PD.monthAdd(ms, 1)); }), nowBtn, h('div', { class: 'grow' }), prn, rhythm, pub);
    if (!D) return h('div', { class: 'stack' }, toolbar, h('div', { class: 'empty' }, P.error ? 'Verbindung unterbrochen. Es wird automatisch erneut versucht.' : h('span', { class: 'spinner' })));
    const n = PD.diff(ms, PD.add(PD.monthEnd(ms), 1));
    const days = []; for (let i = 0; i < n; i++) days.push(PD.add(ms, i));
    const gapDays = {}; (D.gaps || []).forEach(function (g) { (gapDays[g.date] = gapDays[g.date] || []).push(g.place); });
    const brushBtn = function (b, cls, label, title) {
      const on = P.brush && P.brush.kind === b.kind && P.brush.place === b.place && P.brush.start === b.start && P.brush.end === b.end;
      const x = h('button', { type: 'button', class: 'brush' + cls + (on ? ' active' : ''), title: title || label, 'aria-pressed': on ? 'true' : 'false' }, label);
      x.addEventListener('click', function () { P.brush = on ? null : b; renderTab(); });
      return x;
    };
    const brushes = D.templates.map(function (t) { return brushBtn({ kind: 'tpl', place: t.place, start: t.start, end: t.end }, DP.placeClass(t.place), t.place + ' ' + t.start + '–' + t.end, t.typ); });
    brushes.push(brushBtn({ kind: 'erase' }, ' erase', 'Radierer', 'Schichten entfernen: Entwürfe werden gelöscht, veröffentlichte abgesagt'));
    const wdChips = PD.WD.map(function (w, i) { const c = h('button', { type: 'button', class: 'chip' + (P.wd[i] ? ' active' : ''), text: w, 'aria-pressed': P.wd[i] ? 'true' : 'false' }); c.addEventListener('click', function () { P.wd[i] = !P.wd[i]; renderTab(); }); return c; });
    const brushBar = h('div', { class: 'card stack-sm brushbar' },
      h('div', { class: 'row wrap' }, h('strong', { text: 'Pinsel' }), h('span', { class: 'muted small', text: P.brush ? 'Gewählt: ' + brushLabel(P.brush) + '. Ziehe mit gedrückter Maustaste über die Tage einer Zeile, oder tippe auf einen Tag.' : 'Wähle eine Schicht als Pinsel. Dann ziehst du über die Tage, und alle werden auf einmal gefüllt.' })),
      h('div', { class: 'row wrap' }, brushes),
      h('div', { class: 'row wrap' }, h('span', { class: 'muted small', text: 'Nur an diesen Wochentagen:' }), wdChips));
    const nameByPin = {}, acctByPin = {};
    D.employees.forEach(function (e) { nameByPin[e.pin] = e.name; });
    state.employees.forEach(function (e) { acctByPin[e.pin] = e.account; });
    const absByPin = {};
    (D.absences || []).forEach(function (x) { (absByPin[x.pin] = absByPin[x.pin] || []).push(x); });
    const unavByPin = {};
    (D.unavail || []).forEach(function (x) { (unavByPin[x.pin] = unavByPin[x.pin] || []).push(x); });
    const unavChip = function (x) { return h('div', { class: 'unavchip', title: 'Nicht verfügbar' + (x.text ? ': ' + x.text : '') }, 'Nicht verfügbar'); };
    const idx = {};
    D.shifts.forEach(function (s) { if (s.status !== 'abgesagt') { const k = s.pin + '|' + s.date; (idx[k] = idx[k] || []).push(s); } });
    const rows = [];
    D.employees.slice().sort(byName).forEach(function (e) {
      let sum = 0;
      D.shifts.forEach(function (s) { if (s.pin === e.pin && s.status !== 'abgesagt') sum += s.hours; });
      const fill = h('button', { type: 'button', class: 'rowfill', 'aria-label': 'Ganze Zeile für ' + e.name + ' mit dem Pinsel füllen', title: 'Ganze Zeile mit dem Pinsel füllen' }, DP.icon('chevright', 'sm'));
      fill.disabled = !P.brush;
      fill.addEventListener('click', function () { commitBrush(e.pin, days); });
      const cells = days.map(function (d) {
        const list = idx[e.pin + '|' + d] || [];
        const abs = (absByPin[e.pin] || []).filter(function (x) { return x.from <= d && d <= x.to; })[0];
        const un = (unavByPin[e.pin] || []).filter(function (x) { return x.from <= d && d <= x.to; })[0];
        const wd = PD.weekday(d);
        const cls = 'mcell' + (d === today ? ' today' : '') + (wd >= 5 ? ' we' : '') + (abs ? ' absent ' + abs.type : '') + (un ? ' unav' : '');
        const inner = abs && !list.length ? h('div', { class: 'mabs', text: abs.type === 'krank' ? 'K' : 'U' })
          : list.length ? h('div', { class: 'mc' + DP.placeClass(list[0].place) + (list[0].status === 'entwurf' ? ' draft' : ''), text: DP.placeShort(list[0].place) + ' ' + list[0].start.slice(0, 2) + (list.length > 1 ? '+' : '') }) : un ? h('div', { class: 'mun', text: 'N' }) : null;
        return h('td', { class: cls, dataset: { pin: e.pin, date: d }, title: nameByPin[e.pin] + ' · ' + PD.short(d) + (list.length ? ' · ' + list.map(function (s) { return s.place + ' ' + s.start + '–' + s.end + (s.status === 'entwurf' ? ' (Entwurf)' : ''); }).join(', ') : '') + (abs ? ' · ' + (abs.type === 'krank' ? 'krank' : 'Urlaub') : '') + (un ? ' · nicht verfügbar' + (un.text ? ': ' + un.text : '') : '') }, inner);
      });
      rows.push(h('tr', {}, h('td', { class: 'who' }, h('div', { class: 'whocell' }, h('div', { class: 'avatar', text: DP.initials(e.name) }), h('div', { class: 'grow' }, h('div', { class: 'nm', text: e.name, dataset: { pin: e.pin } }), e.pin === '00' ? h('span', { class: 'badge info', text: 'für alle' }) : !acctByPin[e.pin] ? h('span', { class: 'badge neutral', text: 'kein Zugang' }) : null), fill)), cells,
        h('td', { class: 'sum', title: 'Summe im Monat (ohne abgesagte)', text: sum ? PD.fmtHours(sum) : '–' })));
    });
    const head = h('tr', {}, h('th', { text: 'Mitarbeiter' }), days.map(function (d) { const wd = PD.weekday(d); return h('th', { class: (d === today ? 'today' : '') + (wd >= 5 ? ' we' : '') + (gapDays[d] ? ' gap' : ''), title: PD.short(d) + (gapDays[d] ? ' · Lücke: ' + gapDays[d].join(', ') : '') }, h('div', { text: String(+d.slice(8)) }), h('div', { class: 'wdl', text: PD.WD[wd] })); }), h('th', { text: 'Σ Std.' }));
    const table = h('table', { class: 'plan month' + (P.brush ? ' brushing' : '') }, h('thead', {}, head), h('tbody', {}, rows));
    const cellOf = function (e) { return e.target.closest ? e.target.closest('td.mcell') : null; };
    table.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      const td = cellOf(e);
      if (!td || !P.brush) return;
      e.preventDefault();
      brushDrag = { pin: td.dataset.pin, first: td.dataset.date, cells: [td], dates: function () { return this.cells.map(function (c) { return c.dataset.date; }); } };
      td.classList.add('sel');
    });
    table.addEventListener('mouseover', function (e) {
      if (!brushDrag) return;
      const td = cellOf(e);
      if (!td || td.dataset.pin !== brushDrag.pin) return;
      const a = brushDrag.first, b = td.dataset.date, lo = a < b ? a : b, hi = a < b ? b : a;
      brushDrag.cells.forEach(function (c) { c.classList.remove('sel'); });
      brushDrag.cells = Array.prototype.filter.call(td.parentElement.querySelectorAll('td.mcell'), function (c) { return c.dataset.date >= lo && c.dataset.date <= hi; });
      brushDrag.cells.forEach(function (c) { c.classList.add('sel'); });
    });
    table.addEventListener('click', function (e) {
      const td = cellOf(e);
      if (!td || P.brush) return;
      const list = (idx[td.dataset.pin + '|' + td.dataset.date] || []);
      openShiftModal(list.length ? { shift: list[0] } : { pin: td.dataset.pin, date: td.dataset.date });
    });
    const touchCell = function (e) { const t = e.touches && e.touches[0]; const el = t ? document.elementFromPoint(t.clientX, t.clientY) : null; return el && el.closest ? el.closest('td.mcell') : null; };
    table.addEventListener('touchstart', function (e) {
      if (!P.brush) return;
      const td = touchCell(e);
      if (!td) return;
      e.preventDefault();
      brushDrag = { pin: td.dataset.pin, first: td.dataset.date, cells: [td], dates: function () { return this.cells.map(function (c) { return c.dataset.date; }); } };
      td.classList.add('sel');
    }, { passive: false });
    table.addEventListener('touchmove', function (e) {
      if (!brushDrag) return;
      e.preventDefault();
      const td = touchCell(e);
      if (!td || td.dataset.pin !== brushDrag.pin) return;
      const a1 = brushDrag.first, b1 = td.dataset.date, lo = a1 < b1 ? a1 : b1, hi = a1 < b1 ? b1 : a1;
      brushDrag.cells.forEach(function (c) { c.classList.remove('sel'); });
      brushDrag.cells = Array.prototype.filter.call(td.parentElement.querySelectorAll('td.mcell'), function (c) { return c.dataset.date >= lo && c.dataset.date <= hi; });
      brushDrag.cells.forEach(function (c) { c.classList.add('sel'); });
    }, { passive: false });
    table.addEventListener('touchend', function (e) {
      if (!brushDrag) return;
      e.preventDefault();
      const d = brushDrag; brushDrag = null;
      d.cells.forEach(function (c) { c.classList.remove('sel'); });
      commitBrush(d.pin, d.dates());
    }, { passive: false });
    const placeLegend = h('div', { class: 'legend places' }, D.places.map(function (pl) { return h('span', { class: 'plg' + DP.placeClass(pl) }, h('i', { class: 'dotc' }), DP.placeShort(pl) + ' = ' + pl); }), h('span', { class: 'plg' }, h('i', { class: 'dotc dashed' }), 'gestrichelt = Entwurf'), h('span', { class: 'plg' }, h('i', { class: 'dotc ab' }), 'K = krank, U = Urlaub'), h('span', { class: 'plg' }, h('i', { class: 'dotc unv' }), 'N = nicht verfügbar (Wunsch)'));
    return h('div', { class: 'stack' }, h('div', { class: 'print-only print-title', text: 'Dienstplan ' + PD.monthLabel(ms) }), toolbar, gapsCard(), undoBar(), brushBar, placeLegend,
      h('div', { class: 'card grid-wrap' }, rows.length ? table : h('div', { class: 'empty', text: 'Keine Mitarbeiter vorhanden.' })),
      h('p', { class: 'muted small', text: 'Ohne Pinsel öffnet ein Klick auf einen Tag die Schicht zum Bearbeiten. Neue Schichten sind Entwürfe, erst „Veröffentlichen“ macht sie für die Mitarbeiter sichtbar.' }));
  }

  // ---------- Rückgängig, Lücken, Mindestbesetzung, Sicherung, Zugangs-Zettel ----------
  function undoBar() {
    const P = state.plan;
    if (!P.undo) return null;
    const b = h('button', { type: 'button', class: 'btn btn-secondary btn-sm' }, DP.icon('swap', 'sm'), 'Rückgängig');
    b.addEventListener('click', undoLast);
    return h('div', { class: 'card undobar' }, h('span', { class: 'grow', text: 'Letzte Änderung: ' + P.undo.label + '.' }), b, h('span', { class: 'muted small', text: 'Strg+Z' }));
  }
  async function undoLast() {
    const P = state.plan;
    if (!P.undo) return;
    const u = P.undo; P.undo = null;
    const r = await adm('adminShiftUndo', { undo: u.list });
    if (r.status === 'success') {
      DP.toast(r.restored + (r.restored === 1 ? ' Änderung' : ' Änderungen') + ' zurückgenommen' + (r.skipped ? ', ' + r.skipped + ' nicht mehr möglich' : '') + '.');
      await loadPlan(); renderTab();
    } else if (r.code !== 'ADMIN_AUTH') { DP.toast(r.message || 'Rückgängig hat nicht geklappt.', 'error'); renderTab(); }
  }
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || String(e.key).toLowerCase() !== 'z') return;
    const P = state.plan;
    if (state.tab !== 'plan' || P.view !== 'month' || !P.undo || (DP._stack && DP._stack.length)) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
    e.preventDefault(); undoLast();
  });

  function gapsCard() {
    const D = state.plan.data;
    if (!D || !D.coverage || !Object.keys(D.coverage).length) return null;
    const gaps = D.gaps || [];
    if (!gaps.length) return h('div', { class: 'card okline', text: '✓ Alle Standorte sind in diesem Zeitraum wie vorgegeben besetzt.' });
    const chips = gaps.slice(0, 14).map(function (g) {
      const b = h('button', { type: 'button', class: 'chip gapchip', title: 'Schicht für diese Lücke anlegen', text: PD.short(g.date) + ' · ' + g.place + ' · ' + g.have + ' von ' + g.need });
      b.addEventListener('click', function () { openShiftModal({ date: g.date, place: g.place }); });
      return b;
    });
    return h('div', { class: 'card stack-sm gaps' }, h('div', { class: 'row wrap' }, DP.icon('alert', 'sm'), h('strong', { text: 'Besetzungslücken (' + gaps.length + ')' }), h('span', { class: 'muted small', text: 'Ein Klick legt dort eine Schicht an.' })),
      h('div', { class: 'row wrap' }, chips), gaps.length > 14 ? h('div', { class: 'muted small', text: '… und ' + (gaps.length - 14) + ' weitere' }) : null);
  }
  const planViewWeek = planView;
  planView = function () {
    const el = planViewWeek(), D = state.plan.data;
    if (state.plan.view === 'week' && D && el && el.querySelector) {
      const card = gapsCard(), tb = el.querySelector('.plan-toolbar');
      if (card && tb) tb.insertAdjacentElement('afterend', card);
    }
    return el;
  };

  async function loadSettings() {
    const rs = await Promise.all([adm('adminGetSettings'), adm('adminGetCoverage'), adm('adminBackupStatus'), adm('adminGetPlaceInfo')]);
    if (rs[3] && rs[3].status === 'success') state.settings.placeInfo = rs[3].info || {};
    if (rs[0].status === 'success') state.settings.rules = !!rs[0].rules;
    if (rs[1].status === 'success') { state.settings.coverage = rs[1].coverage || {}; state.settings.places = rs[1].places || []; }
    if (rs[2].status === 'success') state.settings.backup = { last: rs[2].last, scheduled: rs[2].scheduled };
  }
  function coverageCard() {
    const places = state.settings.places && state.settings.places.length ? state.settings.places : DP.PLACES, cov = state.settings.coverage || {}, inputs = {};
    const rows = places.map(function (p) {
      const vals = cov[p] || [0, 0, 0, 0, 0, 0, 0];
      inputs[p] = vals.map(function (v, i) { return h('input', { class: 'input covin', type: 'number', min: '0', max: '20', step: '1', value: String(v), 'aria-label': p + ' ' + PD.WD[i] }); });
      return h('tr', {}, h('td', { text: p }), inputs[p].map(function (x) { return h('td', {}, x); }));
    });
    const save = h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Speichern' });
    save.addEventListener('click', async function () {
      const out = {};
      for (const p of places) {
        const a = inputs[p].map(function (x) { return Number(x.value === '' ? 0 : x.value); });
        if (!a.every(function (n) { return Number.isInteger(n) && n >= 0 && n <= 20; })) { DP.toast('Bitte nur ganze Zahlen von 0 bis 20 eintragen (' + p + ').', 'error'); return; }
        if (a.some(function (n) { return n > 0; })) out[p] = a;
      }
      const r = await adm('adminSetCoverage', { coverage: out });
      if (r.status === 'success') { state.settings.coverage = r.coverage; DP.toast('Mindestbesetzung gespeichert.'); await loadDash(); renderTab(); }
      else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Speichern hat nicht geklappt.', 'error');
    });
    return h('section', { class: 'card stack-sm' }, h('h3', { text: 'Mindestbesetzung' }),
      h('p', { class: 'muted small', text: 'Wie viele Mitarbeiter pro Standort und Wochentag mindestens eingeplant sein sollen. 0 heißt keine Vorgabe. Lücken zeigt der Plan automatisch an. Krank oder im Urlaub Gemeldete zählen nicht mit.' }),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl covtbl' }, h('thead', {}, h('tr', {}, h('th', { text: 'Standort' }), PD.WD.map(function (w) { return h('th', { class: 'num', text: w }); }))), h('tbody', {}, rows))), save);
  }
  function backupCard() {
    const b = state.settings.backup || {};
    const last = b.last ? new Date(b.last).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : null;
    const btn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Jetzt sichern' });
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      const r = await adm('adminBackupNow');
      if (r.status === 'success') { DP.toast('Sicherung angelegt.'); await loadSettings(); renderTab(); }
      else { btn.disabled = false; if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Die Sicherung ist fehlgeschlagen.', 'error'); }
    });
    return h('section', { class: 'card stack-sm' }, h('h3', { text: 'Sicherung der Daten' }),
      h('p', { text: 'Letzte Sicherung: ' + (last || 'noch keine') }),
      h('p', { class: 'muted small', text: b.scheduled ? 'Automatisch jeden Sonntag: eingerichtet. Es bleiben die letzten 8 Sicherungen im Drive-Ordner „Sicherungen“.' : 'Automatisch: noch nicht eingerichtet. Führe dazu einmalig im Apps-Script-Editor die Funktion „sicherungEinrichten“ aus.' }), btn);
  }
  function dashGapsCard() {
    const cov = state.settings.coverage || {};
    if (!Object.keys(cov).length || !state.dash) return null;
    const g = state.dash.gaps || [];
    return h('section', { class: 'card stack-sm' }, h('h3', { text: 'Besetzung der nächsten 7 Tage' }),
      g.length ? h('div', { class: 'row wrap' }, g.map(function (x) { return h('span', { class: 'chip gapchip', text: PD.short(x.date) + ' · ' + x.place + ' · ' + x.have + ' von ' + x.need }); })) : h('p', { class: 'okline', text: '✓ Alles wie vorgegeben besetzt.' }));
  }
  overviewView = function () { const el = overviewViewBase(); (state.role === 'voll' ? [dashOpenCard(), dashGapsCard(), settingsCard(), coverageCard(), placeInfoCard(), backupCard()] : [dashOpenCard(), dashGapsCard()]).forEach(function (c) { if (c) el.append(c); }); return el; };

  // Alle Zugänge auf einmal anlegen und als Zettel ausdrucken
  async function bulkCreate() {
    const todo = state.employees.filter(function (e) { return !e.account; });
    if (!todo.length) return;
    if (!(await DP.confirm('Zugänge für ' + todo.length + ' Mitarbeiter anlegen?', 'Jeder bekommt ein vorläufiges Passwort, danach kannst du alle Zugangsdaten als Zettel ausdrucken. Das dauert etwa ' + Math.max(2, todo.length * 2) + ' Sekunden. Bitte das Fenster nicht schließen.', 'Anlegen', 'primary'))) return;
    const prog = h('p', { text: '0 von ' + todo.length + ' angelegt …' });
    const m = DP.modal({ title: 'Zugänge werden angelegt', dismissable: false, body: h('div', { class: 'stack-sm' }, prog, h('span', { class: 'spinner' })), actions: [] });
    const done = [], failed = [];
    for (const e of todo) {
      const r = await adm('adminAccCreate', { pin: e.pin });
      if (r.status === 'success') done.push({ name: e.name, username: r.username, password: r.password });
      else { failed.push(e.name); if (r.code === 'ADMIN_AUTH') break; }
      prog.textContent = done.length + ' von ' + todo.length + ' angelegt …';
    }
    m.close();
    await refresh();
    if (done.length) showSlips(done, failed);
    else if (failed.length) DP.toast('Es konnten keine Zugänge angelegt werden.', 'error');
  }
  function showSlips(list, failed) {
    const portal = new URL('dienstplan.html', location.href).href;
    const host = h('div', { id: 'slips' }, list.map(function (x) {
      return h('div', { class: 'slip' }, h('div', { class: 'slip-h', text: 'Dienstplan-Zugang' }), h('div', { class: 'slip-n', text: x.name }),
        h('div', { class: 'slip-r' }, h('span', { text: 'Adresse' }), h('b', { text: portal })), h('div', { class: 'slip-r' }, h('span', { text: 'Benutzername' }), h('b', { text: x.username })),
        h('div', { class: 'slip-r' }, h('span', { text: 'Vorläufiges Passwort' }), h('b', { class: 'mono', text: x.password })),
        h('div', { class: 'slip-f', text: 'Beim ersten Anmelden wählst du ein eigenes Passwort. Bitte diesen Zettel danach vernichten.' }));
    }));
    document.body.append(host);
    const cleanup = function () { host.remove(); document.body.classList.remove('slips-printing'); };
    DP.modal({
      title: list.length + (list.length === 1 ? ' Zugang angelegt' : ' Zugänge angelegt'), wide: true, dismissable: false,
      body: h('div', { class: 'stack-sm' }, failed.length ? alertBox('warn', 'Nicht angelegt: ' + failed.join(', ')) : null,
        h('div', { class: 'alert warn' }, DP.icon('alert', 'sm'), h('div', { text: 'Die Passwörter werden nur jetzt angezeigt und nirgends gespeichert. Drucke die Zettel jetzt aus.' })),
        h('p', { text: 'Jeder Zettel enthält Adresse, Benutzername und vorläufiges Passwort. Beim ersten Anmelden wählt jeder Mitarbeiter ein eigenes Passwort.' })),
      actions: [{ label: 'Schließen', kind: 'secondary', onClick: cleanup }, { label: 'Zettel drucken', kind: 'primary', closes: false, onClick: function () { document.body.classList.add('slips-printing'); window.print(); setTimeout(function () { document.body.classList.remove('slips-printing'); }, 500); } }]
    });
  }
  const accountsViewBase = accountsView;
  accountsView = function () {
    const el = accountsViewBase();
    if (state.employees.some(function (e) { return !e.account; }) && el && el.querySelector) {
      const b = h('button', { type: 'button', class: 'btn btn-primary btn-sm', id: 'bulkBtn', text: 'Alle ohne Zugang anlegen (' + state.employees.filter(function (e) { return !e.account; }).length + ')' });
      b.addEventListener('click', bulkCreate);
      const chip = el.querySelector('.chip');
      if (chip && chip.parentNode) chip.parentNode.append(b);
    }
    return el;
  };

  // ---------- Anmeldung mit Benutzername (Admin-Konten) ----------
  function enterWithSession(token, expires) {
    state.session = { token: token };
    state.role = null; state.who = '';   // wird beim Start mit "adminMe" geladen
    store.save(token, expires || Date.now() + 8 * 3600 * 1000, false);
    bridgeSession(token);
    return startConsole();
  }
  function authCard(title, sub, body) {
    view(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
      h('div', { class: 'head' }, h('div', { class: 'logo' }, DP.icon('shield')), h('div', {}, h('h1', { text: title }), h('p', { class: 'muted', text: sub }))),
      h('div', { class: 'card stack-sm' }, body))));
  }
  function showLoginUser(notice) {
    stopLive();
    const user = h('input', { class: 'input', id: 'cu_user', name: 'username', type: 'text', autocomplete: 'username', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', required: true });
    const pw = h('input', { class: 'input', id: 'cu_pw', name: 'password', type: 'password', autocomplete: 'current-password', required: true });
    const msg = h('div', {});
    if (notice) msg.append(alertBox('info', notice));
    const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Anmelden');
    const form = h('form', { class: 'stack', novalidate: true }, field('Benutzername', user, 'cu_user'), field('Passwort', pw, 'cu_pw'), msg, btn);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      msg.replaceChildren();
      const u = user.value.trim(), p = pw.value;
      if (!u || !p) { msg.append(alertBox('error', 'Bitte Benutzername und Passwort eingeben.')); return; }
      btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner' }), 'Bitte warten …');
      const r = await DP.api('accLogin', { username: u, password: p, console: true });
      pw.value = '';
      if (r.status === 'success' && r.session) return r.mustChange ? forceNewPassword(r.session, p, u) : enterWithSession(r.session, r.expires);
      btn.disabled = false; btn.replaceChildren('Anmelden');
      msg.append(alertBox(r.code === 'RATE_LIMIT' ? 'warn' : 'error', r.message || 'Anmeldung fehlgeschlagen.'));
    });
    const back = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'toPin', text: 'Mit Admin-PIN anmelden' });
    back.addEventListener('click', function () { showLoginPin(); });
    authCard('Admin-Konsole', 'Anmeldung mit Benutzername', [form, back]);
    user.focus();
  }
  function forceNewPassword(session, oldPw) {
    const a = h('input', { class: 'input', id: 'np1', type: 'password', autocomplete: 'new-password', required: true });
    const b = h('input', { class: 'input', id: 'np2', type: 'password', autocomplete: 'new-password', required: true });
    const msg = h('div', {});
    const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Passwort speichern');
    const form = h('form', { class: 'stack', novalidate: true }, h('p', { class: 'muted', text: 'Bitte lege jetzt dein eigenes Passwort fest (mindestens 10 Zeichen). Das Startpasswort gilt danach nicht mehr.' }), field('Neues Passwort', a, 'np1'), field('Noch einmal', b, 'np2'), msg, btn);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      msg.replaceChildren();
      if (a.value !== b.value) { msg.append(alertBox('error', 'Die beiden Passwörter sind nicht gleich.')); return; }
      btn.disabled = true;
      const r = await DP.api('accChangePassword', { session: session, oldPassword: oldPw, newPassword: a.value });
      if (r.status === 'success' && r.session) return enterWithSession(r.session, r.expires);
      btn.disabled = false;
      msg.append(alertBox('error', r.message || 'Das Passwort konnte nicht geändert werden.'));
    });
    authCard('Neues Passwort', 'Erste Anmeldung', [form]);
    a.focus();
  }
  // ---------- Admin-Konten (nur Vollzugriff) ----------
  const ROLE_LABEL = { voll: 'Vollzugriff', planer: 'Planer', lesen: 'Nur ansehen', admin: 'Vollzugriff' };
  async function loadUsers() { const r = await adm('adminUsersList'); if (r.status === 'success') state.users = r.users || []; }
  async function userReset(u) {
    if (!(await DP.confirm('Passwort zurücksetzen?', 'Für ' + u.name + ' wird ein neues vorläufiges Passwort erzeugt. Alle angemeldeten Geräte werden sofort abgemeldet.', 'Zurücksetzen', 'danger'))) return;
    const r = await adm('adminAccReset', { id: u.id });
    if (r.status === 'success') { r.name = u.name; showCredentials(r, 'Neues Passwort für'); await loadUsers(); renderTab(); }
    else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Zurücksetzen hat nicht geklappt.', 'error');
  }
  async function userStatus(u, status) {
    if (status !== 'aktiv' && !(await DP.confirm(status === 'gesperrt' ? 'Konto sperren?' : 'Konto deaktivieren?', u.name + ' kann sich danach nicht mehr anmelden, bestehende Sitzungen enden sofort.', status === 'gesperrt' ? 'Sperren' : 'Deaktivieren', 'danger'))) return;
    const r = await adm('adminAccSetStatus', { id: u.id, status: status });
    if (r.status === 'success') { DP.toast(status === 'aktiv' ? 'Konto aktiviert.' : 'Konto ' + status + '.'); await loadUsers(); renderTab(); }
    else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Das hat nicht geklappt.', 'error');
  }
  function usersView() {
    setTitle('Admins');
    const U = state.users || [];
    const name = h('input', { class: 'input', id: 'au_name', type: 'text', maxlength: '40', placeholder: 'Vor- und Nachname', autocomplete: 'off' });
    const role = h('select', { class: 'input', id: 'au_role' }, [['planer', 'Planer: Plan, Anträge und Nachrichten bearbeiten'], ['lesen', 'Nur ansehen: nichts ändern'], ['admin', 'Vollzugriff: wie du']].map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    const err = h('div', {});
    const add = h('button', { type: 'button', class: 'btn btn-primary' }, DP.icon('plus', 'sm'), 'Konto anlegen');
    add.addEventListener('click', async function () {
      err.replaceChildren();
      if (!name.value.trim()) { err.append(alertBox('error', 'Bitte einen Namen eingeben.')); return; }
      add.disabled = true;
      const r = await adm('adminUserCreate', { name: name.value, role: role.value });
      add.disabled = false;
      if (r.status === 'success') { name.value = ''; showCredentials(r, 'Zugangsdaten für'); await loadUsers(); renderTab(); }
      else if (r.code !== 'ADMIN_AUTH') err.append(alertBox('error', r.message || 'Das Konto konnte nicht angelegt werden.'));
    });
    const rows = U.map(function (u) {
      const act = [];
      const btn = function (label, fn) { const b = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: label }); b.addEventListener('click', fn); return b; };
      act.push(btn('Passwort zurücksetzen', function () { userReset(u); }));
      act.push(u.status === 'aktiv' ? btn('Sperren', function () { userStatus(u, 'gesperrt'); }) : btn('Aktivieren', function () { userStatus(u, 'aktiv'); }));
      return h('tr', {}, h('td', { 'data-l': 'Name' }, h('div', { class: 'nm', text: u.name }), h('div', { class: 'muted small mono', text: u.username })),
        h('td', { 'data-l': 'Rolle', text: ROLE_LABEL[u.role] || u.role }), h('td', { 'data-l': 'Status' }, h('span', { class: 'badge ' + (u.status === 'aktiv' ? 'success' : 'neutral'), text: u.status }), u.mustChange ? h('div', { class: 'muted small', text: 'Passwort noch nicht geändert' }) : null),
        h('td', { 'data-l': 'Letzte Anmeldung', text: u.lastLogin ? DP.fmtDate(new Date(u.lastLogin).getTime()) : '–' }), h('td', { 'data-l': 'Aktionen' }, h('div', { class: 'row wrap' }, act)));
    });
    return h('div', { class: 'stack' },
      h('section', { class: 'card stack-sm' }, h('h3', { text: 'Weitere Admin-Konten' }),
        h('p', { class: 'muted small', text: 'Jede Person bekommt ein eigenes Konto, damit im Protokoll steht, wer was geändert hat. Die Admin-PIN bleibt immer als Vollzugang bestehen. Anmelden geht auf der Anmeldeseite unter „Mit Benutzername anmelden“.' }),
        h('div', { class: 'form-grid' }, field('Name', name, 'au_name'), field('Rolle', role, 'au_role')), err, h('div', {}, add)),
      h('div', { class: 'card tbl-wrap' }, U.length ? h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Name', 'Rolle', 'Status', 'Letzte Anmeldung', 'Aktionen'].map(function (t) { return h('th', { text: t }); }))), h('tbody', {}, rows)) : h('div', { class: 'empty', text: 'Noch keine weiteren Admin-Konten.' })));
  }

  // ---------- Standort-Infos ----------
  function placeInfoCard() {
    const places = state.settings.places && state.settings.places.length ? state.settings.places : DP.PLACES, info = state.settings.placeInfo || {}, inputs = {};
    const rows = places.map(function (p) {
      const v = info[p] || {};
      inputs[p] = ['address', 'contact', 'note'].map(function (k) { return h('input', { class: 'input', type: 'text', maxlength: '160', value: v[k] || '', 'aria-label': p + ' ' + k }); });
      return h('tr', {}, h('td', { text: p }), inputs[p].map(function (x) { return h('td', {}, x); }));
    });
    const save = h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Speichern' });
    save.addEventListener('click', async function () {
      const out = {};
      places.forEach(function (p) { out[p] = { address: inputs[p][0].value, contact: inputs[p][1].value, note: inputs[p][2].value }; });
      const r = await adm('adminSetPlaceInfo', { info: out });
      if (r.status === 'success') { state.settings.placeInfo = r.info; DP.toast('Standort-Infos gespeichert.'); }
      else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Speichern hat nicht geklappt.', 'error');
    });
    return h('section', { class: 'card stack-sm' }, h('h3', { text: 'Standort-Infos für Mitarbeiter' }),
      h('p', { class: 'muted small', text: 'Adresse, Ansprechpartner und ein Hinweis (zum Beispiel „Schlüssel beim Pförtner“). Mitarbeiter sehen das bei ihrer Schicht unter „Infos zum Standort“.' }),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl covtbl' }, h('thead', {}, h('tr', {}, ['Standort', 'Adresse', 'Ansprechpartner', 'Hinweis'].map(function (t) { return h('th', { text: t }); }))), h('tbody', {}, rows))), save);
  }
  function dashOpenCard() {
    const n = state.dash && state.dash.openShifts;
    if (!n) return null;
    const go = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Im Dienstplan ansehen' });
    go.addEventListener('click', function () { state.tab = 'plan'; loadForTab('plan').then(function () { renderChrome(); renderTab(); }); renderChrome(); renderTab(); });
    return h('section', { class: 'card stack-sm' }, h('h3', { text: 'Offene Schichten' }), h('p', { text: n + (n === 1 ? ' Schicht wartet' : ' Schichten warten') + ' darauf, von einem Mitarbeiter übernommen zu werden.' }), h('div', {}, go));
  }

  // ===================== Mitarbeiter und Standorte =====================
  const MON3 = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  state.staff = { list: null, q: '', filter: 'all', pin: null, month: PD.today().slice(0, 7), detail: null, error: false };
  state.places = { month: PD.today().slice(0, 7), overview: null, place: null, detail: null, error: false };
  const isVoll = function () { return state.role === 'voll'; };
  function lineBadge(place, extra) { return h('span', { class: 'lineb' + DP.placeClass(place) + (extra ? ' ' + extra : ''), title: place, text: DP.placeShort(place) }); }
  function kpi(v, label, cls, unit) { return h('div', { class: 'kpi' + (cls ? ' ' + cls : '') }, h('div', { class: 'v' }, String(v), unit ? h('small', { text: unit }) : null), h('div', { class: 'l', text: label })); }
  function nz(n) { return Math.round((Number(n) || 0) * 10) / 10; }
  function dec(n) { return String(nz(n)).replace('.', ','); }
  function monthNav(month, onChange) {
    const ms = month + '-01';
    const mk = function (icon, label, to) { const b = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'aria-label': label }, DP.icon(icon, 'sm')); b.addEventListener('click', function () { onChange(to); }); return b; };
    const now = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Dieser Monat' });
    now.addEventListener('click', function () { onChange(PD.today().slice(0, 7)); });
    return h('div', { class: 'row wrap' }, mk('chevleft', 'Vorheriger Monat', PD.monthAdd(ms, -1).slice(0, 7)), h('strong', { class: 'weeklabel', style: 'min-width:170px;text-align:center', text: PD.monthLabel(ms) }), mk('chevright', 'Nächster Monat', PD.monthAdd(ms, 1).slice(0, 7)), now);
  }
  function telLink(phone) {
    if (!phone) return h('span', { class: 'muted', text: '–' });
    const a = h('a', { href: 'tel:' + String(phone).replace(/[^0-9+]/g, ''), class: 'who-link', text: phone });
    a.addEventListener('click', function (e) { e.stopPropagation(); });
    return a;
  }

  async function loadStaff() {
    const S = state.staff;
    if (S.pin) {
      const key = S.pin + S.month;
      const r = await adm('adminEmployeeDetail', { pin: S.pin, month: S.month });
      if (key !== S.pin + S.month) return;
      if (r.status === 'success') { S.detail = r; S.error = false; }
      else if (r.code === 'NETWORK') S.error = true;
      else if (r.code !== 'ADMIN_AUTH') { S.pin = null; S.detail = null; DP.toast(r.message || 'Mitarbeiter nicht gefunden.', 'error'); }
    } else {
      const r = await adm('adminEmployeeList');
      if (r.status === 'success') { S.list = r; S.error = false; } else if (r.code === 'NETWORK') S.error = true;
    }
  }
  async function openEmployee(pin, month) {
    const S = state.staff;
    S.pin = pin; S.detail = null; if (month) S.month = month; state.tab = 'staff';
    renderChrome(); renderTab();
    await loadStaff(); renderTab();
  }
  async function closeEmployee() { const S = state.staff; S.pin = null; S.detail = null; renderTab(); await loadStaff(); renderTab(); }
  document.addEventListener('click', function (e) {
    const n = e.target && e.target.closest ? e.target.closest('.nm[data-pin]') : null;
    if (!n || !state.session) return;
    const pin = n.dataset.pin;
    if (pin && pin !== '00') { e.stopPropagation(); openEmployee(pin); }
  }, true);

  // ---- Liste ----
  function staffListView() {
    setTitle('Mitarbeiter');
    const S = state.staff, L = S.list;
    if (!L) return h('div', { class: 'empty' }, S.error ? 'Verbindung unterbrochen. Es wird automatisch erneut versucht.' : h('span', { class: 'spinner' }));
    const all = L.employees;
    const cnt = { all: all.length, noacc: all.filter(function (e) { return !e.account; }).length, nodev: all.filter(function (e) { return !e.devices; }).length, locked: all.filter(function (e) { return e.account && e.account.status !== 'aktiv'; }).length };
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Name, PIN oder Telefon suchen …', 'aria-label': 'Suchen', value: S.q });
    search.style.maxWidth = '250px';
    const chips = [['all', 'Alle ' + cnt.all], ['noacc', 'Ohne Zugang ' + cnt.noacc], ['nodev', 'Ohne Handy ' + cnt.nodev], ['locked', 'Gesperrt ' + cnt.locked]].map(function (f) {
      const b = h('button', { type: 'button', class: 'chip' + (S.filter === f[0] ? ' active' : ''), text: f[1] });
      b.addEventListener('click', function () { S.filter = f[0]; renderTab(); });
      return b;
    });
    const tbody = h('tbody');
    function fill() {
      S.q = search.value;
      const q = S.q.trim().toLowerCase();
      const rows = all.filter(function (e) {
        if (S.filter === 'noacc' && e.account) return false;
        if (S.filter === 'nodev' && e.devices) return false;
        if (S.filter === 'locked' && !(e.account && e.account.status !== 'aktiv')) return false;
        return !q || (e.name + ' ' + e.pin + ' ' + e.phone).toLowerCase().indexOf(q) !== -1;
      });
      tbody.replaceChildren(...(rows.length ? rows.map(function (e) {
        const tr = h('tr', { class: 'clickrow', tabindex: '0' },
          h('td', { 'data-l': 'Name' }, h('div', { class: 'name-cell' }, h('div', { class: 'avatar', text: DP.initials(e.name) }), h('div', {}, h('div', { class: 'nm who-link', text: e.name }), h('div', { class: 'muted small mono', text: 'PIN ' + e.pin })))),
          h('td', { 'data-l': 'Stammstandort' }, e.home ? h('span', { class: 'row' }, lineBadge(e.home), h('span', { text: e.home })) : h('span', { class: 'muted', text: '–' })),
          h('td', { 'data-l': 'Zugang' }, e.account ? h('span', { class: 'badge ' + (e.account.status === 'aktiv' ? 'success' : 'warn'), text: e.account.status }) : h('span', { class: 'badge neutral', text: 'kein Zugang' })),
          h('td', { 'data-l': 'Handys', class: 'num', text: e.devices ? String(e.devices) : '–' }),
          h('td', { 'data-l': 'Telefon' }, telLink(e.phone)),
          h('td', {}, DP.icon('chevright', 'sm')));
        tr.addEventListener('click', function () { openEmployee(e.pin); });
        tr.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') openEmployee(e.pin); });
        return tr;
      }) : [h('tr', {}, h('td', { colspan: '6' }, h('div', { class: 'empty', text: 'Keine Treffer.' })))]));
    }
    search.addEventListener('input', fill);
    fill();
    const add = isVoll() ? h('button', { type: 'button', class: 'btn btn-primary', id: 'addEmpBtn' }, DP.icon('plus', 'sm'), 'Mitarbeiter hinzufügen') : null;
    if (add) add.addEventListener('click', function () { employeeForm(null); });
    const warn = L.conflict00 ? h('div', { class: 'warnbar' }, DP.icon('alert', 'sm'), h('div', {}, h('strong', { text: 'Die PIN 00 ist für „Offene Schichten“ reserviert. ' }), L.conflict00 + ' hat diese PIN und kann so nicht eingeplant werden. Bitte die PIN ändern: Mitarbeiter öffnen, „PIN ändern“.')) : null;
    return h('div', { class: 'stack' }, warn,
      h('div', { class: 'row wrap' }, search, chips, h('div', { class: 'grow' }), add),
      h('div', { class: 'card tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Name', 'Stammstandort', 'Zugang', 'Handys', 'Telefon', ''].map(function (t, i) { return h('th', { class: i === 3 ? 'num' : '', text: t }); }))), tbody)),
      h('p', { class: 'muted small', text: L.employees.length + ' Mitarbeiter. Ein Klick auf einen Namen zeigt Stunden, Fehltage, Krankheit und Verlauf. Neue Mitarbeiter tragen in der Stunden-App „Ich habe schon eine PIN“ ein und geben PIN und Namen ein.' + (L.archived ? ' ' + L.archived + ' PIN(s) sind archiviert und werden nie neu vergeben.' : '') }));
  }

  // ---- Anlegen und Bearbeiten ----
  function employeeForm(emp) {
    const places = (state.staff.list && state.staff.list.places) || DP.PLACES;
    const name = h('input', { class: 'input', id: 'ef_name', type: 'text', maxlength: '60', value: emp ? emp.name : '', autocomplete: 'off', placeholder: 'Vor- und Nachname' });
    const pin = h('input', { class: 'input', id: 'ef_pin', type: 'text', inputmode: 'numeric', maxlength: '2', placeholder: 'automatisch', autocomplete: 'off' });
    const home = h('select', { class: 'input', id: 'ef_home' }, [h('option', { value: '', text: 'Kein fester Standort' })].concat(places.map(function (p) { return h('option', { value: p, text: p }); })));
    home.value = emp ? emp.home || '' : '';
    const phone = h('input', { class: 'input', id: 'ef_phone', type: 'tel', maxlength: '25', value: emp ? emp.phone : '', placeholder: 'Für den schnellen Anruf bei Ausfall', autocomplete: 'off' });
    const note = h('textarea', { class: 'input textarea', id: 'ef_note', maxlength: '160', placeholder: 'Zum Beispiel „Führerschein Klasse D“ oder „nur Nachtdienst“' });
    note.value = emp ? emp.note : '';
    const err = h('div', {});
    const fields = [field('Name', name, 'ef_name')];
    if (!emp) fields.push(field('PIN (leer lassen für automatisch)', pin, 'ef_pin', 'Zwei Ziffern. Die PIN 00 ist für offene Schichten reserviert.'));
    fields.push(field('Stammstandort', home, 'ef_home', 'Wird beim Ersatz-Vorschlag bevorzugt.'), field('Telefon', phone, 'ef_phone'), field('Notiz', note, 'ef_note'), err);
    DP.modal({
      title: emp ? 'Mitarbeiter bearbeiten' : 'Mitarbeiter hinzufügen', wide: true, body: h('div', { class: 'stack-sm' }, fields),
      actions: [{ label: 'Abbrechen', kind: 'secondary' }, {
        label: emp ? 'Speichern' : 'Anlegen', kind: 'primary', closes: false,
        onClick: async function (api) {
          err.replaceChildren();
          const r = emp ? await adm('adminEmployeeUpdate', { pin: emp.pin, name: name.value, phone: phone.value, home: home.value, note: note.value })
            : await adm('adminEmployeeCreate', { name: name.value, pin: pin.value.trim(), phone: phone.value, home: home.value, note: note.value });
          if (r.status === 'success') {
            api.close();
            await loadStaff(); renderTab();
            if (!emp) {
              DP.toast(name.value.trim() + ' angelegt, PIN ' + r.pin + '.');
              DP.modal({ title: 'PIN ' + r.pin + ' für ' + r.name, body: h('div', { class: 'stack-sm' }, h('p', { text: 'Gib ' + r.name.split(' ')[0] + ' diese PIN. In der Stunden-App wählt die Person „Ich habe schon eine PIN“ und gibt die PIN ' + r.pin + ' sowie den Namen „' + r.name + '“ ein. Für den Dienstplan im Portal legst du außerdem einen Zugang an.' })),
                actions: [{ label: 'Fertig', kind: 'secondary' }, { label: 'Zugang fürs Portal anlegen', kind: 'primary', onClick: function () { return createAccount({ pin: r.pin, name: r.name }); } }] });
            } else DP.toast('Gespeichert.');
          } else if (r.code !== 'ADMIN_AUTH') err.append(alertBox('error', r.message || 'Das hat nicht geklappt.'));
        }
      }]
    });
  }
  function changePinDialog(emp) {
    const np = h('input', { class: 'input', id: 'cp_pin', type: 'text', inputmode: 'numeric', maxlength: '2', placeholder: 'zwei Ziffern', autocomplete: 'off' });
    const err = h('div', {});
    DP.modal({
      title: 'PIN von ' + emp.name + ' ändern', body: h('div', { class: 'stack-sm' }, h('p', { text: 'Alle Daten der Person (Schichten, Stunden, Anträge, Nachrichten, Handys, Zugang) wandern mit zur neuen PIN. Sag ' + emp.name.split(' ')[0] + ' danach die neue PIN.' }), field('Neue PIN', np, 'cp_pin', 'Aktuell: ' + emp.pin), err),
      actions: [{ label: 'Abbrechen', kind: 'secondary' }, {
        label: 'PIN ändern', kind: 'primary', closes: false, onClick: async function (api) {
          err.replaceChildren();
          const r = await adm('adminEmployeeChangePin', { pin: emp.pin, newPin: np.value.trim() });
          if (r.status === 'success') { api.close(); DP.toast('PIN geändert: ' + r.pin + '.'); state.staff.pin = r.pin; await loadStaff(); renderTab(); }
          else if (r.code !== 'ADMIN_AUTH') err.append(alertBox('error', r.message || 'Das hat nicht geklappt.'));
        }
      }]
    });
  }
  function deleteDialog(emp) {
    const mode = { v: 'archive' };
    const conf = h('input', { class: 'input', id: 'dl_name', type: 'text', autocomplete: 'off', placeholder: emp.name });
    const err = h('div', {});
    let m = null;
    const opt = function (val, title, text) {
      const r = h('input', { type: 'radio', name: 'dl_mode', value: val, id: 'dl_' + val });
      if (val === mode.v) r.checked = true;
      r.addEventListener('change', function () { mode.v = val; const b = m && m.el.querySelector('.actions .btn-danger'); if (b) b.textContent = val === 'purge' ? 'Alles löschen' : 'Entfernen'; });
      return h('label', { class: 'check', for: 'dl_' + val }, r, h('span', {}, h('strong', { text: title }), h('div', { class: 'hint', text: text })));
    };
    const body = h('div', { class: 'stack-sm' },
      opt('archive', 'Entfernen und archivieren (empfohlen)', 'Die Person verschwindet aus der Liste, Zugang und Handys werden gelöscht, künftige Schichten entfallen. Stunden und vergangene Schichten bleiben für die Aufbewahrung in der Tabelle erhalten, erscheinen aber nicht mehr in Auswertung und Standort-Statistik. Die PIN wird nie wieder vergeben.'),
      opt('purge', 'Alle Daten unwiderruflich löschen', 'Zusätzlich werden alle Schichten, Anträge, Nachrichten, Vermerke, Dokumente (auch in Google Drive) und alle gesendeten Stunden gelöscht. Das lässt sich nicht rückgängig machen. Beachte gesetzliche Aufbewahrungsfristen für Stunden.'),
      field('Zur Sicherheit den vollen Namen eingeben', conf, 'dl_name', emp.name), err);
    m = DP.modal({
      title: emp.name + ' entfernen', wide: true, body: body,
      actions: [{ label: 'Abbrechen', kind: 'secondary' }, {
        label: 'Entfernen', kind: 'danger', closes: false,
        onClick: async function (api) {
          err.replaceChildren();
          if (conf.value.replace(/\s+/g, ' ').trim().toLowerCase() !== emp.name.replace(/\s+/g, ' ').trim().toLowerCase()) { err.append(alertBox('error', 'Der Name stimmt nicht. Bitte „' + emp.name + '“ eingeben.')); return; }
          const r = await adm('adminEmployeeDelete', { pin: emp.pin, mode: mode.v, confirmName: conf.value });
          if (r.status === 'success') { api.close(); DP.toast(emp.name + (mode.v === 'purge' ? ' wurde komplett gelöscht.' : ' wurde entfernt.')); state.staff.pin = null; state.staff.detail = null; await Promise.all([loadStaff(), refresh()]); renderTab(); }
          else if (r.code !== 'ADMIN_AUTH') err.append(alertBox('error', r.message || 'Das hat nicht geklappt.'));
        }
      }]
    });
  }

  // ---- Detail ----
  function employeeDetailView() {
    setTitle('Mitarbeiter');
    const S = state.staff, D = S.detail;
    const back = h('button', { type: 'button', class: 'crumb' }, DP.icon('chevleft', 'sm'), 'Alle Mitarbeiter');
    back.addEventListener('click', closeEmployee);
    if (!D) return h('div', { class: 'stack' }, back, h('div', { class: 'empty' }, S.error ? 'Verbindung unterbrochen. Es wird automatisch erneut versucht.' : h('span', { class: 'spinner' })));
    const p = D.profile, sm = D.summary, today = PD.today();
    const emp = { pin: p.pin, name: p.name, phone: p.phone, home: p.home, note: p.note, account: D.account ? { id: D.account.id || null } : null };
    const rosterEmp = ((S.list && S.list.employees) || []).filter(function (e) { return e.pin === p.pin; })[0] || emp;
    const act = [];
    if (isVoll()) {
      const b = function (label, kind, fn) { const x = h('button', { type: 'button', class: 'btn btn-sm ' + kind, text: label }); x.addEventListener('click', fn); return x; };
      act.push(b('Bearbeiten', 'btn-secondary', function () { employeeForm(rosterEmp); }), b('PIN ändern', 'btn-secondary', function () { changePinDialog(rosterEmp); }));
      if (!D.account) act.push(b('Zugang anlegen', 'btn-secondary', function () { createAccount(rosterEmp); }));
      else if (rosterEmp.account && rosterEmp.account.id) act.push(b('Passwort zurücksetzen', 'btn-secondary', function () { resetPassword(rosterEmp); }));
      act.push(b('Entfernen …', 'btn-secondary', function () { deleteDialog(rosterEmp); }));
    }
    const head = h('div', { class: 'dhead' }, h('div', { class: 'avatar', text: DP.initials(p.name) }),
      h('div', {}, h('h2', { class: 'dtitle', text: p.name }),
        h('div', { class: 'dmeta' }, h('span', { class: 'badge neutral mono', text: 'PIN ' + p.pin }), p.home ? h('span', { class: 'row' }, lineBadge(p.home), h('span', { text: p.home })) : null,
          D.account ? h('span', { class: 'badge ' + (D.account.status === 'aktiv' ? 'success' : 'warn'), text: 'Zugang ' + D.account.status }) : h('span', { class: 'badge neutral', text: 'kein Zugang' }),
          h('span', { class: 'badge neutral', text: D.devices.length + (D.devices.length === 1 ? ' Handy' : ' Handys') }), p.phone ? telLink(p.phone) : null),
        p.note ? h('div', { class: 'muted', style: 'margin-top:6px', text: p.note }) : null),
      h('div', { class: 'dact' }, act));
    const diff = (sm.submitted && sm.pastHours > 0) ? nz(sm.sentHours - sm.pastHours) : null;
    const kpis = h('div', { class: 'kpis' }, kpi(dec(sm.plannedHours), 'Plan-Stunden', null, 'Std.'), kpi(sm.submitted ? dec(sm.sentHours) : '–', sm.submitted ? (sm.approved ? 'Gesendet, freigegeben' : 'Gesendet') : 'Noch nichts gesendet', null, sm.submitted ? 'Std.' : ''),
      kpi(diff === null ? '–' : (diff > 0 ? '+' : diff < 0 ? '−' : '') + dec(Math.abs(diff)), diff === null && sm.submitted ? 'Differenz (kein Plan)' : 'Differenz (vergangene Tage)', diff !== null && Math.abs(diff) >= 0.5 ? 'bad' : null), kpi(dec(sm.submitted ? sm.sentNightHours : sm.nightHours), 'Nachtstunden', null, 'Std.'), kpi(dec(sm.submitted ? sm.sentSundayHours : sm.sundayHours), 'Sonntagsstunden', null, 'Std.'),
      kpi(sm.sickDays, 'Krank im Monat', sm.sickDays ? 'bad' : null, sm.sickDays === 1 ? 'Tag' : 'Tage'), kpi(D.year.sickDays, 'Krank im Jahr (' + D.year.sickCases + (D.year.sickCases === 1 ? ' Fall' : ' Fälle') + ')', null, D.year.sickDays === 1 ? 'Tag' : 'Tage'), kpi(sm.vacationDays, 'Urlaub im Monat', null, sm.vacationDays === 1 ? 'Tag' : 'Tage'));
    const kindOf = function (d) {
      const pub = d.plan.filter(function (x) { return x.status === 'veroeffentlicht'; });
      if (d.sent) return 'work';
      if (d.absent === 'krank') return 'krank';
      if (d.absent) return 'urlaub';
      if (pub.length) return d.date < today ? 'miss' : 'future';
      return d.plan.length ? 'future' : 'free';
    };
    const cnt = { work: 0, miss: 0, krank: 0, urlaub: 0, future: 0, free: 0 };
    const cells = D.days.map(function (d) {
      const pl = d.plan[0] || null, sent = d.sent, kind = kindOf(d);
      cnt[kind]++;
      const cls = 'dcell ' + kind + (d.wd >= 5 ? ' we' : '') + (d.date === today ? ' today' : '') + (pl ? ' plan' + DP.placeClass(pl.place) : '') + (d.unavailable ? ' unav' : '');
      const mid = kind === 'work' ? dec(sent.stunden) + ' h' : kind === 'krank' ? 'krank' : kind === 'urlaub' ? (d.absent === 'urlaub?' ? 'Urlaub?' : 'Urlaub') : kind === 'miss' ? 'fehlt' : pl ? pl.start : '';
      const mk = [];
      if (kind === 'work') mk.push(h('span', { class: 'ok', text: '✓' }));
      if (kind === 'miss') mk.push(h('span', { class: 'no', text: '✗' }));
      if (kind === 'work' && d.absent) mk.push(h('span', { text: d.absent === 'krank' ? 'K' : 'U' }));
      if (d.unavailable) mk.push(h('span', { text: 'N' }));
      return h('div', { class: cls, title: PD.short(d.date) + (pl ? ' · Plan ' + d.plan.map(function (x) { return x.place + ' ' + x.start + '–' + x.end; }).join(', ') : '') + (sent ? ' · gesendet ' + sent.standort + ' ' + sent.beginn + '–' + sent.ende + ' (' + dec(sent.stunden) + ' Std.)' : '') + (d.absent ? ' · ' + (d.absent === 'krank' ? 'krank' : 'Urlaub') : '') + (d.unavailable ? ' · nicht verfügbar' : '') },
        h('div', { class: 'dn', text: String(+d.date.slice(8)) }), h('div', { class: 'dw', text: PD.WD[d.wd] }), mid ? h('div', { class: 'tm', text: mid }) : null, h('div', { class: 'mk' }, mk));
    });
    const tile = function (kind, n, one, many) { return h('div', { class: 'dtile ' + kind + (n ? '' : ' zero') }, h('div', { class: 'n', text: String(n) }), h('div', { class: 't', text: n === 1 ? one : many })); };
    const sum = h('div', { class: 'dsum' }, tile('work', cnt.work, 'Tag gearbeitet', 'Tage gearbeitet'), tile('miss', cnt.miss, 'Tag nicht gesendet', 'Tage nicht gesendet'), tile('krank', cnt.krank, 'Tag krank', 'Tage krank'), tile('urlaub', cnt.urlaub, 'Tag Urlaub', 'Tage Urlaub'), tile('free', cnt.free, 'Tag frei', 'Tage frei'), cnt.future ? tile('future', cnt.future, 'Tag geplant, noch offen', 'Tage geplant, noch offen') : null);
    const strip = h('div', {}, sum, h('div', { class: 'daystrip' }, cells), h('div', { class: 'blegend lgline' }, h('span', {}, 'Grün = gearbeitet (Stunden stehen im Feld)'), h('span', {}, 'Rot ✗ = geplant, aber nichts gesendet'), h('span', {}, 'Orange = krank'), h('span', {}, 'Blau = Urlaub'), h('span', {}, 'Grau = frei'), h('span', {}, 'Oberer Rand = Standortfarbe'), h('span', {}, 'N nicht verfügbar' + (sm.unavailableDays ? ' (' + sm.unavailableDays + ' Tage)' : ''))));
    const maxV = Math.max(1, ...D.history.map(function (x) { return Math.max(x.plannedHours, x.sentHours || 0); }));
    const bars = h('div', {}, h('div', { class: 'bars' }, D.history.map(function (x) {
      const ph = Math.round(x.plannedHours / maxV * 100), sh = x.sentHours === null ? 0 : Math.round(x.sentHours / maxV * 100);
      return h('div', { class: 'bcol', title: PD.monthLabel(x.month + '-01') + ': geplant ' + dec(x.plannedHours) + ' Std., gesendet ' + (x.sentHours === null ? 'nichts' : dec(x.sentHours) + ' Std.') + ', krank ' + x.sickDays + ' Tage' },
        h('div', { class: 'bpair' }, h('div', { class: 'bar plan', style: 'height:' + ph + '%' }, x.plannedHours ? h('span', { class: 'bv', text: dec(x.plannedHours) }) : null), h('div', { class: 'bar sent', style: 'height:' + sh + '%' })),
        h('div', { class: 'bl', text: MON3[+x.month.slice(5) - 1] }), h('div', { class: 'bs', text: x.sickDays ? x.sickDays + ' krank' : '' }));
    })), h('div', { class: 'blegend' }, h('span', {}, h('i', { style: 'background:var(--ink)' }), 'geplant'), h('span', {}, h('i', { style: 'background:var(--signal)' }), 'gesendet')));
    const issues = D.issues.length ? D.issues.map(function (i) { const l = ISSUE_LABEL[i.kind]; return h('div', { class: 'issue' }, h('span', { class: 'd', text: PD.short(i.date) }), h('span', { class: 'badge ' + l[1], text: l[0] }), h('span', { text: i.text })); }) : [h('p', { class: 'muted', text: sm.noPlan && sm.submitted ? 'Für diesen Monat gibt es keinen veröffentlichten Plan. Die gesendeten Stunden (' + dec(sm.sentHours) + ' Std.) lassen sich deshalb nicht mit dem Plan vergleichen.' : sm.submitted || sm.plannedShifts ? 'Keine Beanstandungen in diesem Monat.' : 'Für diesen Monat liegt nichts vor.' })];
    const places = D.places.length ? D.places.map(function (x) { return h('div', { class: 'prow' }, lineBadge(x.place), h('div', { class: 'grow' }, h('div', { class: 't', text: x.place }), h('div', { class: 's', text: x.days + (x.days === 1 ? ' Tag' : ' Tage') })), h('strong', { class: 'mono', text: dec(x.hours) + ' Std.' })); }) : [h('p', { class: 'muted', text: 'Noch keine gesendeten Stunden.' })];
    const reqs = D.requests.length ? D.requests.map(function (q) {
      const st = q.status === 'genehmigt' ? (q.type === 'krank' ? 'bestätigt' : q.type === 'verfuegbar' ? 'eingetragen' : 'genehmigt') : q.status === 'offen' ? 'offen' : q.status === 'abgelehnt' ? 'abgelehnt' : 'zurückgezogen';
      return h('div', { class: 'prow' }, h('div', { class: 'grow' }, h('div', { class: 't', text: q.label }), h('div', { class: 's', text: (q.from === q.to ? PD.short(q.from) : PD.short(q.from) + ' – ' + PD.short(q.to)) + (q.text ? ' · ' + q.text : '') + (q.reply ? ' · Antwort: ' + q.reply : '') })), h('span', { class: 'badge ' + (q.status === 'abgelehnt' ? 'danger' : q.status === 'offen' ? 'info' : 'neutral'), text: st }));
    }) : [h('p', { class: 'muted', text: 'Keine Anträge.' })];
    const up = D.upcoming.length ? D.upcoming.map(function (s) { return h('div', { class: 'prow' }, lineBadge(s.place), h('div', { class: 'grow' }, h('div', { class: 't', text: PD.short(s.date) + ' · ' + s.start + '–' + s.end }), h('div', { class: 's', text: s.place + (s.status === 'entwurf' ? ' (Entwurf)' : '') })), h('span', { class: 'mono', text: dec(s.hours) + ' Std.' })); }) : [h('p', { class: 'muted', text: 'In den nächsten 14 Tagen nichts geplant.' })];
    const devs = D.devices.length ? D.devices.map(function (x) { return h('div', { class: 'prow' }, h('div', { class: 'grow' }, h('div', { class: 't', text: x.info || 'Handy' }), h('div', { class: 's', text: 'Kennung ' + x.id + (x.last ? ' · zuletzt aktiv ' + DP.fmtDate(x.last) : '') }))); }) : [h('p', { class: 'muted', text: 'Noch kein Handy verbunden.' })];
    return h('div', { class: 'stack' }, back, head,
      h('div', { class: 'row wrap' }, monthNav(S.month, function (m) { S.month = m; S.detail = null; renderTab(); loadStaff().then(renderTab); })),
      kpis,
      h('section', { class: 'dsec' }, h('h3', {}, 'Der Monat im Überblick'), strip),
      h('div', { class: 'dgrid dsec' }, h('div', { class: 'stack' }, h('section', {}, h('h3', {}, 'Hinweise zu Stunden und Plan', h('small', { text: D.issues.length ? D.issues.length + ' Punkte' : '' })), issues), h('section', {}, h('h3', {}, 'Letzte sechs Monate'), bars), h('section', {}, h('h3', {}, 'Anträge und Meldungen'), reqs)),
        h('div', { class: 'stack' }, h('section', {}, h('h3', {}, 'Stunden nach Standort'), places), h('section', {}, h('h3', {}, 'Nächste 14 Tage'), up), h('section', {}, h('h3', {}, 'Handys und Zugang'), devs, D.account ? h('p', { class: 'muted small', style: 'margin-top:8px', text: 'Benutzername ' + D.account.username + (D.account.lastLogin ? ' · zuletzt angemeldet ' + DP.fmtDate(new Date(D.account.lastLogin).getTime()) : '') + (D.account.mustChange ? ' · Passwort noch nicht geändert' : '') }) : null))));
  }
  function staffView() { return state.staff.pin ? employeeDetailView() : staffListView(); }

  // ===================== Standorte =====================
  async function loadPlaces() {
    const P = state.places;
    if (P.place) {
      const key = P.place + P.month;
      const r = await adm('adminPlaceDetail', { place: P.place, month: P.month });
      if (key !== P.place + P.month) return;
      if (r.status === 'success') { P.detail = r; P.error = false; } else if (r.code === 'NETWORK') P.error = true;
    } else {
      const mo = P.month;
      const r = await adm('adminPlaceOverview', { month: mo });
      if (mo !== P.month || P.place) return;
      if (r.status === 'success') { P.overview = r; P.error = false; } else if (r.code === 'NETWORK') P.error = true;
    }
  }
  async function openPlace(place) { const P = state.places; P.place = place; P.detail = null; renderTab(); await loadPlaces(); renderTab(); }
  async function closePlace() { const P = state.places; P.place = null; P.detail = null; renderTab(); await loadPlaces(); renderTab(); }
  async function setPlacesMonth(m) { const P = state.places; P.month = m; P.overview = null; P.detail = null; renderTab(); await loadPlaces(); renderTab(); }
  function placesOverview() {
    setTitle('Standorte');
    const P = state.places, O = P.overview;
    const nav = monthNav(P.month, setPlacesMonth);
    if (!O) return h('div', { class: 'stack' }, nav, h('div', { class: 'empty' }, P.error ? 'Verbindung unterbrochen. Es wird automatisch erneut versucht.' : h('span', { class: 'spinner' })));
    const cards = O.places.map(function (p) {
      const b = h('button', { type: 'button', class: 'pcard' + DP.placeClass(p.place) }, h('div', { class: 'row' }, lineBadge(p.place), h('div', { class: 'pname', text: p.place })),
        h('div', { class: 'pk' }, h('div', {}, h('div', { class: 'v', text: dec(p.plannedHours) }), h('div', { class: 'l', text: 'Std. geplant' })), h('div', {}, h('div', { class: 'v', text: p.sentDays ? dec(p.sentHours) : '–' }), h('div', { class: 'l', text: 'Std. gesendet' })),
          h('div', {}, h('div', { class: 'v' + (p.gaps ? ' bad' : ''), text: p.requirement ? String(p.gaps) : '–' }), h('div', { class: 'l', text: 'Lücken' })), h('div', {}, h('div', { class: 'v', text: String(p.openShifts) }), h('div', { class: 'l', text: 'offen' }))),
        h('div', { class: 'muted small', text: p.shifts + (p.shifts === 1 ? ' Schicht' : ' Schichten') + ', ' + p.staff + (p.staff === 1 ? ' Mitarbeiter' : ' Mitarbeiter') + (p.absentShifts ? ', ' + p.absentShifts + ' Ausfall(e) durch Krank/Urlaub' : '') }));
      b.addEventListener('click', function () { openPlace(p.place); });
      return b;
    });
    return h('div', { class: 'stack' }, nav, h('div', { class: 'pgrid' }, cards), h('p', { class: 'muted small', text: 'Ein Klick auf einen Standort zeigt die Besetzung Tag für Tag, die Mitarbeiter, Ausfälle und die Entwicklung. „Lücken“ gibt es nur, wenn du unter Übersicht eine Mindestbesetzung festgelegt hast.' }));
  }
  function placeDetailView() {
    setTitle('Standorte');
    const P = state.places, D = P.detail;
    const back = h('button', { type: 'button', class: 'crumb' }, DP.icon('chevleft', 'sm'), 'Alle Standorte');
    back.addEventListener('click', closePlace);
    if (!D) return h('div', { class: 'stack' }, back, h('div', { class: 'empty' }, P.error ? 'Verbindung unterbrochen. Es wird automatisch erneut versucht.' : h('span', { class: 'spinner' })));
    const info = D.info ? [D.info.address, D.info.contact, D.info.note].filter(Boolean).join(' · ') : '';
    const head = h('div', { class: 'dhead' }, lineBadge(D.place), h('div', {}, h('h2', { class: 'dtitle', text: D.place }), info ? h('div', { class: 'muted', style: 'margin-top:8px', text: info }) : h('div', { class: 'muted small', style: 'margin-top:8px', text: 'Noch keine Standort-Infos hinterlegt (Übersicht, Standort-Infos).' })));
    const kpis = h('div', { class: 'kpis' }, kpi(D.shifts, 'Schichten'), kpi(dec(D.plannedHours), 'Plan-Stunden', null, 'Std.'), kpi(D.sentDays ? dec(D.sentHours) : '–', 'Gesendete Stunden', null, D.sentDays ? 'Std.' : ''), kpi(D.openShifts, 'Offene Schichten', D.openShifts ? 'bad' : null),
      kpi(D.requirement ? D.gaps : '–', 'Tage mit Lücke', D.gaps ? 'bad' : (D.requirement ? 'good' : null)), kpi(D.absentShifts, 'Ausfälle durch Krank/Urlaub', D.absentShifts ? 'bad' : null), kpi(dec(D.nightHours), 'Nachtstunden', null, 'Std.'), kpi(dec(D.sundayHours), 'Sonntagsstunden', null, 'Std.'));
    const today = PD.today();
    const cells = D.days.map(function (d) {
      const cls = 'dcell' + (d.wd >= 5 ? ' we' : '') + (d.date === today ? ' today' : '') + (d.need ? (d.have >= d.need ? ' fine' : ' gap') : ' nogoal');
      return h('div', { class: cls, title: PD.short(d.date) + ': ' + d.have + (d.need ? ' von ' + d.need + ' nötig' : ' eingeplant') + (d.names.length ? ' (' + d.names.join(', ') + ')' : '') + (d.open ? ', ' + d.open + ' offen' : '') },
        h('div', { class: 'dn', text: String(+d.date.slice(8)) }), h('div', { class: 'dw', text: PD.WD[d.wd] }), h('div', { class: 'tm', style: 'font-size:1.05rem', text: d.need ? d.have + '/' + d.need : String(d.have) }), h('div', { class: 'mk' }, d.open ? h('span', { text: '+' + d.open + ' offen' }) : null));
    });
    const strip = h('div', {}, h('div', { class: 'daystrip' }, cells), h('div', { class: 'blegend' }, h('span', {}, 'Zahl = eingeplant' + (D.requirement ? ' / nötig' : '')), h('span', {}, h('i', { style: 'background:var(--success)' }), 'erfüllt'), h('span', {}, h('i', { style: 'background:var(--danger)' }), 'Lücke'), h('span', {}, 'Krank oder im Urlaub Gemeldete zählen nicht mit')));
    const wmax = Math.max(1, ...D.weekday);
    const wd = h('div', {}, h('div', { class: 'wdbars' }, D.weekday.map(function (n, i) { return h('div', { class: 'bcol', title: PD.WD[i] + ': ' + n + ' Schichten' }, h('div', { class: 'bpair' }, h('div', { class: 'bar', style: 'height:' + Math.round(n / wmax * 100) + '%' }, n ? h('span', { class: 'bv', text: String(n) }) : null)), h('div', { class: 'bl', text: PD.WD[i] })); })));
    const tmax = Math.max(1, ...D.trend.map(function (x) { return x.plannedHours; }));
    const trend = h('div', { class: 'bars' }, D.trend.map(function (x) { return h('div', { class: 'bcol', title: PD.monthLabel(x.month + '-01') + ': ' + dec(x.plannedHours) + ' Std., ' + x.shifts + ' Schichten' }, h('div', { class: 'bpair' }, h('div', { class: 'bar plan', style: 'height:' + Math.round(x.plannedHours / tmax * 100) + '%' }, x.plannedHours ? h('span', { class: 'bv', text: dec(x.plannedHours) }) : null)), h('div', { class: 'bl', text: MON3[+x.month.slice(5) - 1] })); }));
    const emps = D.employees.length ? h('div', { class: 'card tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Mitarbeiter', 'Schichten', 'Plan-Std.', 'Gesendet'].map(function (t, i) { return h('th', { class: i ? 'num' : '', text: t }); }))),
      h('tbody', {}, D.employees.map(function (e) { const tr = h('tr', { class: 'clickrow' }, h('td', {}, e.archived ? h('span', {}, h('span', { text: e.name }), ' ', h('span', { class: 'badge neutral', text: 'archiviert' })) : h('span', { class: 'nm who-link', text: e.name, dataset: { pin: e.pin } })), h('td', { class: 'num', text: String(e.shifts) }), h('td', { class: 'num', text: dec(e.plannedHours) }), h('td', { class: 'num', text: e.sentDays ? dec(e.sentHours) + ' (' + e.sentDays + ' Tage)' : '–' })); return tr; })))) : h('p', { class: 'muted', text: 'In diesem Monat ist hier niemand eingeplant.' });
    const abs = D.absent.length ? D.absent.map(function (a) { return h('div', { class: 'prow' }, h('span', { class: 'mono', text: PD.short(a.date) }), h('div', { class: 'grow' }, h('span', { class: 'nm who-link', text: a.name, dataset: { pin: a.pin } })), h('span', { class: 'badge danger', text: 'krank / Urlaub' })); }) : [h('p', { class: 'muted', text: 'Keine Ausfälle durch Krank oder Urlaub.' })];
    return h('div', { class: 'stack' }, back, head, monthNav(P.month, setPlacesMonth), kpis,
      h('section', { class: 'dsec' }, h('h3', {}, 'Besetzung Tag für Tag', h('small', { text: D.requirement ? 'Mindestbesetzung ist festgelegt' : 'Keine Mindestbesetzung festgelegt' })), strip),
      h('div', { class: 'dgrid dsec' }, h('div', { class: 'stack' }, h('section', {}, h('h3', {}, 'Mitarbeiter an diesem Standort'), emps), h('section', {}, h('h3', {}, 'Entwicklung der Plan-Stunden'), trend)),
        h('div', { class: 'stack' }, h('section', {}, h('h3', {}, 'Schichten nach Wochentag'), wd), h('section', {}, h('h3', {}, 'Ausfälle'), abs))));
  }
  function placesView() { return state.places.place ? placeDetailView() : placesOverview(); }

  // ---------- Start ----------
  const s = store.load();
  if (s) { state.session = { token: s.token }; bridgeSession(s.token); startConsole(); } else showLogin();
})();

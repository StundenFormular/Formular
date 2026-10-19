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
  function alertBox(kind, text) { return h('div', { class: 'alert ' + kind, role: kind === 'error' ? 'alert' : 'status' }, DP.icon(kind === 'success' ? 'check' : 'alert', 'sm'), h('div', { text: text })); }

  async function adm(action, payload) {
    const r = await DP.api(action, Object.assign({ adminSession: state.session && state.session.token }, payload || {}));
    if (r.code === 'ADMIN_AUTH') { sessionEnded('Die Sitzung ist abgelaufen. Bitte neu anmelden.'); }
    return r;
  }

  // ---------- Anmeldung ----------
  function showLogin(notice) {
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
        return startConsole();
      }
      btn.disabled = false; btn.replaceChildren('Anmelden');
      msg.append(alertBox(r.code === 'LOCKED' ? 'warn' : 'error', r.message || 'Anmeldung fehlgeschlagen.'));
    });
    view(h('div', { class: 'auth-wrap' }, h('div', { class: 'auth-card' },
      h('div', { class: 'head' }, h('div', { class: 'logo' }, DP.icon('shield')), h('div', {}, h('h1', { text: 'Admin-Konsole' }), h('p', { class: 'muted', text: 'Dienstplan verwalten' }))),
      h('div', { class: 'card' }, form))));
    pin.focus();
  }
  // Die eingebetteten Bereiche (alte Admin-Seite) nutzen dieselbe Anmeldung: sie wird im Tab-Speicher unter dem alten Namen bereitgestellt
  function bridgeSession(token) { try { sessionStorage.setItem('adm_session', token); } catch (e) { /* ignorieren */ } }
  function sessionEnded(notice) {
    store.clear(); state.session = null;
    try { sessionStorage.removeItem('adm_session'); } catch (e) { /* ignorieren */ }
    Object.keys(embedFrames).forEach(function (k) { delete embedFrames[k]; });
    document.title = 'Dienstplan – Admin';
    document.querySelectorAll('.overlay').forEach(function (o) { o.remove(); });
    showLogin(notice);
  }

  // ---------- Daten laden ("Live") ----------
  async function refresh(manual) {
    if (!state.session) return;
    const r = await adm('adminAccList');
    if (r.status === 'success') {
      state.employees = r.employees || [];
      state.serverNow = r.now || Date.now();
      state.lastLoad = Date.now();
      state.error = false;
    } else if (r.code === 'NETWORK') {
      state.error = true;
    }
    if (state.tab === 'audit' || state.tab === 'overview') await loadAudit();
    await loadDash();
    if (state.tab === 'plan') await loadPlan();
    if (state.tab === 'requests') await loadRequests();
    if (state.tab === 'messages') await loadMessages();
    if (state.tab === 'report') await loadReport();
    if (state.tab === 'overview') await loadSettings();
    renderChrome();
    renderTab();
    if (manual && !state.error) DP.toast('Aktualisiert.');
  }
  async function loadAudit() {
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
    const f = state.tab === 'plan' ? planView : state.tab === 'requests' ? requestsView : state.tab === 'messages' ? messagesView : state.tab === 'report' ? reportView : state.tab === 'accounts' ? accountsView : state.tab === 'audit' ? auditView : overviewView;
    const old = box.querySelector('.grid-wrap'), sl = old ? old.scrollLeft : 0, sy = window.scrollY;
    box.replaceChildren(f());
    const nw = box.querySelector('.grid-wrap');
    if (nw && sl) nw.scrollLeft = sl;
    if (sy) window.scrollTo(0, sy);
  }
  function startConsole() {
    const tabs = [['plan', 'calendar', 'Dienstplan'], ['overview', 'home', 'Übersicht'], ['requests', 'swap', 'Anträge'], ['messages', 'chat', 'Nachrichten'], ['report', 'chart', 'Auswertung'], ['accounts', 'users', 'Zugänge'], ['audit', 'list', 'Protokoll']];
    const nav = h('nav', { id: 'nav', class: 'side', 'aria-label': 'Hauptmenü' }, h('div', { class: 'brand' }, h('div', { class: 'mark' }, DP.icon('calendar')), 'Dienstplan'),
      tabs.concat(Object.keys(EMB).map(function (k) { return [k, EMB[k][2], EMB[k][1]]; })).map(function (t, i) {
        const b = h('button', { type: 'button', class: 'nav', dataset: { tab: t[0] } }, DP.icon(t[1]), t[2], h('span', { id: 'navCount_' + t[0], class: 'count' }));
        b.addEventListener('click', function () { state.tab = t[0]; loadForTab(t[0]).then(function () { renderChrome(); renderTab(); }); renderChrome(); renderTab(); });
        return i === tabs.length ? [h('div', { class: 'navgroup', text: 'Stunden & Geräte' }), b] : b;
      }), h('div', { class: 'grow' }));
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
    const nowCard = h('section', { class: 'card stack-sm' }, h('div', { class: 'row between' }, h('h3', { text: 'Jetzt im Dienst' }), h('span', { class: 'badge success', text: D ? String(D.onDuty.length) : '…' })),
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
    if (r.status === 'success') { P.data = r; P.error = false; }
    else if (r.code === 'NETWORK') P.error = true;
  }
  async function changeMonth(ms) {
    state.plan.monthStart = ms; state.plan.data = null;
    renderTab();
    await loadPlan();
    renderTab();
  }
  async function setPlanView(v) {
    const P = state.plan;
    if (P.view === v) return;
    P.view = v; P.data = null; P.brush = null;
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
      D.employees.slice().sort(function (x, y) { return x.name.localeCompare(y.name, 'de'); }).forEach(function (e) {
        let sum = 0;
        D.shifts.forEach(function (s) { if (s.pin === e.pin && s.status !== 'abgesagt') sum += s.hours; });
        const acct = acctByPin[e.pin];
        const cells = days.map(function (d) {
          const add = h('button', { type: 'button', class: 'add-cell', 'aria-label': 'Schicht für ' + e.name + ' am ' + PD.short(d) + ' hinzufügen' }, DP.icon('plus', 'sm'));
          add.addEventListener('click', function () { openShiftModal({ pin: e.pin, date: d }); });
          const abs = (absByPin[e.pin] || []).filter(function (x) { return x.from <= d && d <= x.to; });
          return h('td', { class: (d === today ? 'today' : '') + (abs.length ? ' absent' : '') }, abs.map(absChip), (idx[e.pin + '|' + d] || []).map(chip), add);
        });
        rows.push(h('tr', {}, h('td', { class: 'who' }, h('div', { class: 'whocell' }, h('div', { class: 'avatar', text: DP.initials(e.name) }),
          h('div', {}, h('div', { class: 'nm', text: e.name }), !acct ? h('span', { class: 'badge neutral', text: 'kein Zugang', title: 'Hat noch keinen Zugang und sieht den Plan nicht.' }) : null))),
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

  function field(label, input, id) { return h('div', { class: 'field' }, h('label', { for: id, text: label }), input); }
  function confirmWarnings(warnings) {
    return new Promise(function (resolve) {
      let go = false;
      DP.modal({
        title: 'Bitte prüfen', onClose: function () { resolve(go); },
        body: h('div', { class: 'stack-sm' }, h('p', { text: 'Diese Schicht überschreitet empfohlene Grenzen:' }),
          h('ul', { class: 'warn-list' }, warnings.map(function (w) { return h('li', { text: w.message }); })),
          h('p', { class: 'hint', text: 'Du entscheidest, ob du sie trotzdem einplanst. Verantwortlich für die Einhaltung der Arbeitszeitregeln bleibt die Firma.' })),
        actions: [{ label: 'Zurück', kind: 'secondary' }, { label: 'Trotzdem speichern', kind: 'primary', onClick: function () { go = true; } }]
      });
    });
  }

  function openShiftModal(init) {
    const D = state.plan.data, ed = init.shift || null;
    const emps = D.employees.slice().sort(function (x, y) { return x.name.localeCompare(y.name, 'de'); });
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
    else if (tab === 'requests') { await loadRequests(); await loadDash(); }
    else if (tab === 'messages') { await loadMessages(); await loadDash(); }
    else if (tab === 'report') await loadReport();
    else if (tab === 'audit' || tab === 'overview') { await loadAudit(); await loadDash(); if (tab === 'overview') await loadSettings(); }
  }

  // ---------- Anträge ----------
  const REQ_ICON = { krank: 'pluscircle', urlaub: 'sun', tausch: 'swap', aenderung: 'clock' };
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
    const emps = state.employees.slice().sort(function (x, y) { return x.name.localeCompare(y.name, 'de'); });
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
          h('div', { class: 'muted small', text: PD.fmtHours(c.weekHours) + ' Std. in dieser Woche' }),
          c.reasons.length ? h('ul', {}, c.reasons.map(function (x) { return h('li', { text: x }); })) : null), take);
    });
    m = DP.modal({
      title: 'Ersatz finden', wide: true,
      body: h('div', { class: 'stack-sm' }, h('p', { class: 'muted small', text: PD.short(s.date) + ' · ' + s.start + '–' + s.end + ' · ' + s.place + '. Wer weniger Stunden in der Woche hat, steht bei den Freien weiter oben.' }), h('div', { class: 'rep-list' }, rows.length ? rows : h('div', { class: 'empty', text: 'Keine anderen Mitarbeiter vorhanden.' }))),
      actions: [{ label: 'Schließen', kind: 'secondary' }]
    });
  }

  // ---------- Auswertung ----------
  async function loadReport() { const R = state.report, mo = R.month; const r = await adm('adminReport', { month: mo }); if (mo === R.month && r.status === 'success') R.data = r; }
  function monthAdd(mo, n) { const p = mo.split('-').map(Number); const d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); }
  const ISSUE_LABEL = { fehlt: ['Nicht gesendet', 'danger'], abweichung: ['Abweichung', 'warn'], ungeplant: ['Ungeplant', 'info'] };
  function num(x) { return String(Math.round(x * 10) / 10).replace('.', ','); }
  function csvText(v) { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function downloadReportCsv() {
    const R = state.report, D = R.data;
    if (!D) return;
    const lines = [['Mitarbeiter', 'PIN', 'Schichten', 'Plan-Stunden', 'Gesendete Stunden', 'Differenz', 'Krankheitstage', 'Urlaubstage', 'Beanstandungen'].join(';')];
    D.employees.slice().sort(function (x, y) { return x.name.localeCompare(y.name, 'de'); }).forEach(function (e) {
      const diff = e.submitted ? num(e.actualHours - e.pastHours) : '';
      lines.push([csvText(e.name), csvText(e.pin), e.shifts, num(e.plannedHours), e.submitted ? num(e.actualHours) : '', diff, e.sickDays, e.vacationDays, csvText(e.issues.map(function (i) { return PD.short(i.date) + ' ' + ISSUE_LABEL[i.kind][0]; }).join(', '))].join(';'));
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
    const emps = D.employees.slice().sort(function (x, y) { return x.name.localeCompare(y.name, 'de'); });
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
        h('td', { class: 'num', 'data-l': 'Krank', text: e.sickDays ? String(e.sickDays) : '–' }), h('td', { class: 'num', 'data-l': 'Urlaub', text: e.vacationDays ? String(e.vacationDays) : '–' }),
        h('td', { 'data-l': 'Hinweise' }, hint)));
      if (R.open[e.pin] && e.issues.length) {
        rows.push(h('tr', { class: 'detail' }, h('td', { colspan: '8' }, e.issues.map(function (i) {
          const l = ISSUE_LABEL[i.kind];
          return h('div', { class: 'issue' }, h('span', { class: 'd', text: PD.short(i.date) }), h('span', { class: 'badge ' + l[1], text: l[0] }), h('span', { text: i.text }));
        }))));
      }
    });
    const head = h('tr', {}, ['Mitarbeiter', 'Schichten', 'Plan-Std.', 'Gesendet', 'Differenz', 'Krank', 'Urlaub', 'Hinweise'].map(function (t, i) { return h('th', { class: i > 0 && i < 7 ? 'num' : '', text: t }); }));
    const foot = h('tr', {}, h('td', { text: 'Summe' }), h('td', { class: 'num', text: String(tot.shifts) }), h('td', { class: 'num', text: num(tot.plan) }), h('td', { class: 'num', text: num(tot.act) }), h('td', { class: 'num', text: '' }), h('td', { class: 'num', text: String(tot.sick) }), h('td', { class: 'num', text: String(tot.vac) }), h('td', { text: tot.issues ? tot.issues + ' offen' : '' }));
    return h('div', { class: 'stack' }, toolbar, title,
      h('div', { class: 'card tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, head), h('tbody', {}, rows), h('tfoot', {}, foot))),
      h('p', { class: 'muted small', text: 'Plan = veröffentlichte Schichten des Monats. Gesendet = von der Stunden-App eingereichte Stunden (nach Korrekturen des Admins). Die Differenz vergleicht nur Tage, die schon vorbei sind. Schichten, die noch kommen, zählen zum Plan, aber nicht zur Differenz.' }));
  }

  // ---------- Einstellungen (Übersicht) ----------
  async function loadSettings() { const r = await adm('adminGetSettings'); if (r.status === 'success') state.settings = { rules: !!r.rules }; }
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
  overviewView = function () { const el = overviewViewBase(); el.append(settingsCard()); return el; };

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
    DP.toast(parts.join(', ') + '.');
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
    let copied = r.copied, absent = r.absent, conflicts = r.conflictCount;
    if (len > 28) {   // die letzten 1–3 Tage des Monats aus den ersten Tagen desselben Monats fortsetzen
      const r2 = await adm('adminShiftCopyRange', { fromStart: ms, toStart: PD.add(ms, 28), days: len - 28 });
      if (r2.status === 'success') { copied += r2.copied; absent += r2.absent; conflicts += r2.conflictCount; }
    }
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
    const idx = {};
    D.shifts.forEach(function (s) { if (s.status !== 'abgesagt') { const k = s.pin + '|' + s.date; (idx[k] = idx[k] || []).push(s); } });
    const rows = [];
    D.employees.slice().sort(function (x, y) { return x.name.localeCompare(y.name, 'de'); }).forEach(function (e) {
      let sum = 0;
      D.shifts.forEach(function (s) { if (s.pin === e.pin && s.status !== 'abgesagt') sum += s.hours; });
      const fill = h('button', { type: 'button', class: 'rowfill', 'aria-label': 'Ganze Zeile für ' + e.name + ' mit dem Pinsel füllen', title: 'Ganze Zeile mit dem Pinsel füllen' }, DP.icon('chevright', 'sm'));
      fill.disabled = !P.brush;
      fill.addEventListener('click', function () { commitBrush(e.pin, days); });
      const cells = days.map(function (d) {
        const list = idx[e.pin + '|' + d] || [];
        const abs = (absByPin[e.pin] || []).filter(function (x) { return x.from <= d && d <= x.to; })[0];
        const wd = PD.weekday(d);
        const cls = 'mcell' + (d === today ? ' today' : '') + (wd >= 5 ? ' we' : '') + (abs ? ' absent ' + abs.type : '');
        const inner = abs && !list.length ? h('div', { class: 'mabs', text: abs.type === 'krank' ? 'K' : 'U' })
          : list.length ? h('div', { class: 'mc' + DP.placeClass(list[0].place) + (list[0].status === 'entwurf' ? ' draft' : ''), text: DP.placeShort(list[0].place) + ' ' + list[0].start.slice(0, 2) + (list.length > 1 ? '+' : '') }) : null;
        return h('td', { class: cls, dataset: { pin: e.pin, date: d }, title: nameByPin[e.pin] + ' · ' + PD.short(d) + (list.length ? ' · ' + list.map(function (s) { return s.place + ' ' + s.start + '–' + s.end + (s.status === 'entwurf' ? ' (Entwurf)' : ''); }).join(', ') : '') + (abs ? ' · ' + (abs.type === 'krank' ? 'krank' : 'Urlaub') : '') }, inner);
      });
      rows.push(h('tr', {}, h('td', { class: 'who' }, h('div', { class: 'whocell' }, h('div', { class: 'avatar', text: DP.initials(e.name) }), h('div', { class: 'grow' }, h('div', { class: 'nm', text: e.name }), !acctByPin[e.pin] ? h('span', { class: 'badge neutral', text: 'kein Zugang' }) : null), fill)), cells,
        h('td', { class: 'sum', title: 'Summe im Monat (ohne abgesagte)', text: sum ? PD.fmtHours(sum) : '–' })));
    });
    const head = h('tr', {}, h('th', { text: 'Mitarbeiter' }), days.map(function (d) { const wd = PD.weekday(d); return h('th', { class: (d === today ? 'today' : '') + (wd >= 5 ? ' we' : ''), title: PD.short(d) }, h('div', { text: String(+d.slice(8)) }), h('div', { class: 'wdl', text: PD.WD[wd] })); }), h('th', { text: 'Σ Std.' }));
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
    const placeLegend = h('div', { class: 'legend places' }, D.places.map(function (pl) { return h('span', { class: 'plg' + DP.placeClass(pl) }, h('i', { class: 'dotc' }), DP.placeShort(pl) + ' = ' + pl); }), h('span', { class: 'plg' }, h('i', { class: 'dotc dashed' }), 'gestrichelt = Entwurf'), h('span', { class: 'plg' }, h('i', { class: 'dotc ab' }), 'K = krank, U = Urlaub'));
    return h('div', { class: 'stack' }, h('div', { class: 'print-only print-title', text: 'Dienstplan ' + PD.monthLabel(ms) }), toolbar, brushBar, placeLegend,
      h('div', { class: 'card grid-wrap' }, rows.length ? table : h('div', { class: 'empty', text: 'Keine Mitarbeiter vorhanden.' })),
      h('p', { class: 'muted small', text: 'Ohne Pinsel öffnet ein Klick auf einen Tag die Schicht zum Bearbeiten. Neue Schichten sind Entwürfe, erst „Veröffentlichen“ macht sie für die Mitarbeiter sichtbar.' }));
  }

  // ---------- Start ----------
  const s = store.load();
  if (s) { state.session = { token: s.token }; bridgeSession(s.token); startConsole(); } else showLogin();
})();

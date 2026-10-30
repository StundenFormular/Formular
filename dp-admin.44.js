'use strict';
/* Dienstplan: Admin-Konsole (Version 1: Zugänge und Protokoll) */
(function () {
  const h = DP.h;
  const root = document.getElementById('root');
  const store = DP.sessionStore('dpa_session_v1');   // nur in diesem Browser-Tab, nie dauerhaft
  const PD = DP.dates;
  const state = { session: null, tab: 'plan', report: { month: DP.dates.today().slice(0, 7), data: null, open: {} }, employees: [], audit: [], filter: 'all', query: '', auditFilter: 'all', lastLoad: 0, serverNow: 0, error: false,
    plan: { weekStart: PD.weekStart(PD.today()), view: 'week', monthStart: PD.monthStart(PD.today()), brush: null, wd: [true, true, true, true, true, true, true], mode: 'emp', data: null, error: false },
    settings: { rules: false, teamPlan: false, monthView: true },
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
      const r = await DP.api('adminLogin', { pin: v, cid: admCid() });   // Gerätekennung: Fehlversuche anderer Geräte sperren dich nicht aus
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
    view(h('div', { class: 'auth-wrap split' }, authArt(), h('div', { class: 'auth-card' },
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
  function stateSig() { try { return JSON.stringify(state, function (k, v) { return (k === 'lastLoad' || k === 'serverNow' || k === 'loaded' || k === 'now' || k === 'updated') ? undefined : v; }); } catch (e) { return String(Math.random()); } }
  async function refresh(manual) {
    if (!state.session) return;
    state.lastFull = Date.now();
    adm('adminPulse').then(function (pr) { if (pr && pr.status === 'success') state.pulse = pr.seq; });   // Kennung vor dem Laden merken: was danach passiert, erkennt der nächste Takt
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
      loadDash(),
      loadFeed()
    ];
    if (state.tab === 'audit' || state.tab === 'overview') jobs.push(loadAudit());
    if (state.tab === 'plan') jobs.push(loadPlan());
    if (state.tab === 'attend' && manual) jobs.push(loadAtt(undefined, true));   // „Aktualisieren“ lädt das Brett neu
    if (state.tab === 'requests') jobs.push(loadRequests());
    if (state.tab === 'messages') jobs.push(loadMessages());
    if (state.tab === 'report') jobs.push(loadReport());
    if (state.tab === 'users') jobs.push(loadUsers());
    if (state.tab === 'rights') jobs.push(loadRights());
    if (state.tab === 'chef' && !cfHold() && (manual || Date.now() - state.cf.loaded > 40000)) jobs.push(cfReload(true));
    if (state.tab === 'viewlink' && !vlHold() && (manual || Date.now() - state.vl.loaded > 40000)) jobs.push(vlReload(true));
    if (state.tab === 'staff') jobs.push(loadStaff());
    if (state.tab === 'places') jobs.push(loadPlaces());
    if (state.tab === 'overview') jobs.push(loadSettings(), loadExpiry(), loadAcks());
    const before = manual ? '' : stateSig();
    await Promise.all(jobs);
    renderChrome();
    if (manual || stateSig() !== before) renderTab();   // unverändert: nichts neu aufbauen (weniger Ruckeln beim Klicken)
    if (manual && !state.error) DP.toast('Aktualisiert.');
  }
  async function loadAudit() {
    if (state.role && state.role !== 'voll') return;
    const r = await adm('adminAudit', { limit: 200 });
    if (r.status === 'success') state.audit = r.items || [];
  }
  // Alle 20 s nur eine winzige Frage „hat sich etwas geändert?“ (Zeilenzahlen). Die schweren Abfragen laufen nur bei einer Änderung, sonst höchstens jede Minute.
  async function poll() {
    const vis = document.visibilityState === 'visible';
    if (vis && (document.querySelector('.overlay') || attBusy())) return;
    const r = await adm('adminPulse'), ok = !!r && r.status === 'success', same = ok && r.seq === state.pulse, stale = Date.now() - (state.lastFull || 0) > 60000;
    if (same && !stale) return;
    if (vis) { if (ok) state.pulse = r.seq; state.lastFull = Date.now(); refresh(); }
    else if (!same) { if (ok) state.pulse = r.seq; loadFeed(); }
  }
  function startLive() {
    stopLive();
    pollTimer = setInterval(function () { poll(); }, 20000);
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
    refreshTitle();
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
      const f = h('iframe', { class: 'embed', title: e[1], src: 'admin-nachrichten.html?embed=1&tab=' + e[0] + '&v=' + Date.now(), referrerpolicy: 'no-referrer' });   // v=... verhindert, dass der Browser eine alte, zwischengespeicherte Fassung zeigt
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
    if (state.tab === 'viewlink') { if (!vlHold()) vlRender(); return; }
    if (state.tab === 'chef') { if (!cfHold()) cfRender(); return; }
    const f = state.tab === 'plan' ? planView : state.tab === 'staff' ? staffView : state.tab === 'places' ? placesView : state.tab === 'requests' ? requestsView : state.tab === 'messages' ? messagesView : state.tab === 'report' ? reportView : state.tab === 'accounts' ? accountsView : state.tab === 'users' ? usersView : state.tab === 'rights' ? rightsView : state.tab === 'attend' ? attendView : state.tab === 'chef' ? chefView : state.tab === 'viewlink' ? viewLinkView : state.tab === 'audit' ? auditView : overviewView;
    const old = box.querySelector('.grid-wrap'), sl = old ? old.scrollLeft : 0, sy = window.scrollY;
    const el = f();
    if (state.role === 'lesen' && el && el.prepend) el.prepend(alertBox('info', 'Du hast nur Lesezugriff. Änderungen sind nicht möglich.'));
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
    const tabsAll = [['plan', 'calendar', 'Dienstplan'], ['attend', 'clock', 'Anwesenheit'], ['staff', 'user', 'Mitarbeiter'], ['places', 'circle', 'Standorte'], ['overview', 'home', 'Übersicht'], ['requests', 'swap', 'Anträge'], ['messages', 'chat', 'Nachrichten'], ['report', 'chart', 'Auswertung'], ['accounts', 'users', 'Zugänge'], ['audit', 'list', 'Protokoll']];
    const ROLE_TABS = { voll: null, planer: ['plan', 'staff', 'places', 'overview', 'requests', 'messages', 'report'], lesen: ['plan', 'staff', 'places', 'overview', 'requests', 'report'] };
    const roleTabs = ROLE_TABS[state.role] || null;
    const tabs = tabsAll.filter(function (t) { return !roleTabs || roleTabs.indexOf(t[0]) !== -1; }).concat(state.role === 'voll' ? [['users', 'shield', 'Admins'], ['rights', 'key', 'Rechte'], ['viewlink', 'eye', 'Übersichtslink'], ['chef', 'file', 'Chef-Bericht']] : []);
    if (!state.hashDone) {
      state.hashDone = true;
      const h0 = (location.hash || '').replace('#', '');
      if (h0 && (tabs.some(function (t) { return t[0] === h0; }) || (state.role === 'voll' && EMB[h0]))) state.tab = h0;
    }
    const whoNote = h('div', { class: 'who-note' }, DP.avatar(state.who || 'Hauptzugang', 'avatar small'), h('div', {}, h('div', { class: 'wn', text: state.who || 'Hauptzugang' }), h('div', { class: 'muted small', text: ROLE_LABEL[state.role] || '' })));
    const nav = h('nav', { id: 'nav', class: 'side', 'aria-label': 'Hauptmenü' }, h('div', { class: 'brand' }, h('div', { class: 'mark' }, DP.icon('calendar')), 'Dienstplan'),
      tabs.concat((state.role === 'voll' ? Object.keys(EMB) : []).map(function (k) { return [k, EMB[k][2], EMB[k][1]]; })).map(function (t, i) {
        const b = h('button', { type: 'button', class: 'nav', dataset: { tab: t[0] } }, DP.icon(t[1]), t[2], h('span', { id: 'navCount_' + t[0], class: 'count' }));
        b.addEventListener('click', function () { const changed = t[0] !== state.tab; state.tab = t[0]; if (changed) pushTabState(t[0]); loadForTab(t[0]).then(function () { renderChrome(); renderTab(); }); renderChrome(); renderTab(); });
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
        h('span', { class: 'row small muted' }, h('span', { id: 'liveDot', class: 'dot live' }), h('span', { id: 'liveLabel', text: 'Lädt …' })), searchBtn(), bellBtn(), refreshBtn, out),
      h('main', { id: 'content', class: 'content' }, h('div', { class: 'empty' }, h('span', { class: 'spinner' }))))));
    startLive();
    refresh();
    // Wer das Anwesenheits-Brett benutzt, bekommt es sofort: der Monat wird still im Hintergrund vorgeladen, sobald der Start durch ist
    if (state.role === 'voll') setTimeout(function () { if (!state.session) return; adm('adminSecurityStatus').then(function (r) { if (r && r.status === 'success') { state.sec = r; if (!r.pinCustom && !state.secHint) { state.secHint = true; DP.toast('Sicherheit: Es ist noch keine eigene Admin-PIN gesetzt. Bitte im Reiter Admins setzen.', 'error'); } } }); }, 4000);
    try { if (state.role === 'voll' && state.tab !== 'attend' && localStorage.getItem('att_used') === '1') setTimeout(function () { if (state.session && !(state.att && state.att.cache)) loadAtt(undefined, false, 15000).catch(function () { /* egal */ }); }, 2500); } catch (e) { /* egal */ }
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
    const person = function (x, sub) { return h('div', { class: 'row between' }, h('div', { class: 'row' }, DP.avatar(x.name, 'avatar small'), h('div', {}, nameLink(x.name, pinFor(x)), h('div', { class: 'muted small', text: sub }))), x.draft ? h('span', { class: 'badge neutral', text: 'Entwurf' }) : null); };
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
          recent.length ? recent.map(function (e) { return h('div', { class: 'row between' }, nameLink(e.name, e.pin, 'nm'), h('span', { class: 'muted small', text: DP.relTime(e.account.lastLogin) })); }) : h('p', { class: 'muted small', text: 'Noch niemand hat sich angemeldet.' })),
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
        h('td', { 'data-l': 'Mitarbeiter' }, h('div', { class: 'name-cell' }, DP.avatar(e.name, 'avatar'), h('div', {}, nameLink(e.name, e.pin), h('div', { class: 'muted small', text: 'PIN ' + e.pin })))),
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
    if (r.status === 'success') { if (r.autoFixed) DP.toast(r.autoFixed.name + ' hat jetzt die PIN ' + r.autoFixed.pin + ', denn 00 ist für offene Schichten reserviert. Bitte teile sie mit.'); r.employees = [{ pin: '00', name: 'Offene Schichten' }].concat((r.employees || []).filter(function (e) { return e.pin !== '00'; })); P.data = r; P.error = false; }
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
    const pen = h('button', { type: 'button', class: P.view === 'month' && P.brush ? 'active' : '', title: 'Mehrere Tage auf einmal eintragen: Stift wählen, dann auf die Tage tippen oder ziehen', text: '✏️ Stift' });
    pen.addEventListener('click', function () {
      if (P.view !== 'month') { P.autoPen = true; setPlanView('month'); return; }
      const t = P.data && P.data.templates && P.data.templates[0];
      P.brush = P.brush || !t ? null : { kind: 'tpl', place: t.place, start: t.start, end: t.end };
      renderTab();
    });
    return h('div', { class: 'seg', role: 'group', 'aria-label': 'Zeitraum' }, b('week', 'Woche'), b('month', 'Monat'), pen);
  }

  function planView() {
    setTitle('Dienstplan');
    if (state.plan.view === 'month') return monthPlanView();
    const P = state.plan, D = P.data, ws = P.weekStart, today = PD.today();
    const small = !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
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
    const seriesBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', id: 'seriesBtn' }, DP.icon('refresh', 'sm'), 'Serie …');
    seriesBtn.addEventListener('click', function () { seriesDialog(null); });
    const printBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', title: 'Wochenplan drucken' }, DP.icon('printer', 'sm'), 'Drucken');
    printBtn.addEventListener('click', function () { window.print(); });
    const toolbarDesktop = small ? null : h('div', { class: 'plan-toolbar' }, viewSeg(),
      iconBtn('chevleft', 'Vorherige Woche', function () { changeWeek(PD.add(ws, -7)); }),
      h('div', { class: 'weeklabel', text: 'KW ' + PD.isoWeek(ws) + ' · ' + PD.rangeLabel(ws) }),
      iconBtn('chevright', 'Nächste Woche', function () { changeWeek(PD.add(ws, 7)); }), monthJumpBtn(ws.slice(0, 7), function (m) { changeWeek(PD.weekStart(m + '-01')); }), todayBtn, h('div', { class: 'grow' }),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Ansicht' }, modeBtn('emp', 'Nach Mitarbeiter'), modeBtn('place', 'Nach Standort')), seriesBtn, printBtn, copyBtn, pubBtn);
    const mobileToolbar = !small ? null : h('div', { class: 'plan-toolbar mtool' },
      h('div', { class: 'mrow nav' }, iconBtn('chevleft', 'Vorherige Woche', function () { changeWeek(PD.add(ws, -7)); }), monthJumpBtn(ws.slice(0, 7), function (m) { changeWeek(PD.weekStart(m + '-01')); }), h('div', { class: 'weeklabel', text: 'KW ' + PD.isoWeek(ws) + ' · ' + PD.rangeLabel(ws) }), iconBtn('chevright', 'Nächste Woche', function () { changeWeek(PD.add(ws, 7)); }), todayBtn),
      h('div', { class: 'mrow' }, viewSeg(), h('div', { class: 'seg', role: 'group', 'aria-label': 'Ansicht' }, modeBtn('emp', 'Nach Person'), modeBtn('place', 'Nach Standort'))),
      drafts ? pubBtn : null,
      h('details', { class: 'more' }, h('summary', { text: 'Mehr' }), h('div', { class: 'row wrap' }, seriesBtn, printBtn, copyBtn, drafts ? null : pubBtn)));
    const toolbar = small ? mobileToolbar : toolbarDesktop;
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
        rows.push(h('tr', {}, h('td', { class: 'who' }, h('div', { class: 'whocell' }, DP.avatar(e.name, 'avatar'),
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
    const dayPins = {}, openN = {}, gapOn = {};
    D.shifts.forEach(function (s) {
      if (s.status === 'abgesagt') return;
      if (s.pin === '00') { openN[s.date] = (openN[s.date] || 0) + 1; return; }
      if ((absByPin[s.pin] || []).some(function (x) { return x.from <= s.date && s.date <= x.to; })) return;
      (dayPins[s.date] = dayPins[s.date] || {})[s.pin] = 1;
    });
    (D.gaps || []).forEach(function (g) { gapOn[g.date] = (gapOn[g.date] || 0) + 1; });
    const foot = P.mode === 'emp' ? h('tfoot', {}, h('tr', {}, h('th', { text: 'Im Dienst' }), days.map(function (d) {
      const n = Object.keys(dayPins[d] || {}).length;
      return h('td', { class: 'footc' + (d === today ? ' today' : '') + (gapOn[d] ? ' gap' : '') }, h('strong', { text: String(n) }), openN[d] ? h('span', { class: 'foto', text: '+' + openN[d] + ' offen' }) : null, gapOn[d] ? h('span', { class: 'fotg', text: gapOn[d] + (gapOn[d] === 1 ? ' Lücke' : ' Lücken') }) : null);
    }), h('td', { class: 'footc' }))) : null;
    const head = h('tr', {}, h('th', { text: P.mode === 'emp' ? 'Mitarbeiter' : 'Standort' }),
      days.map(function (d) { return h('th', { class: d === today ? 'today' : '', text: PD.short(d) }); }), h('th', { text: P.mode === 'emp' ? 'Σ Woche' : 'Schichten' }));
    const dayView = function () {
      if (!P.day || days.indexOf(P.day) === -1) P.day = days.indexOf(today) !== -1 ? today : days[0];
      const sel = P.day, nameOf = {};
      D.employees.forEach(function (e) { nameOf[e.pin] = e.name; });
      const live = D.shifts.filter(function (s) { return s.status !== 'abgesagt'; });
      const cnt = {}; live.forEach(function (s) { if (s.pin !== '00') cnt[s.date] = (cnt[s.date] || 0) + 1; });
      const go = function (d) { P.day = d; renderTab(); };
      const gapDay = {}; (D.gaps || []).forEach(function (g) { gapDay[g.date] = true; });
      const strip = h('div', { class: 'dstrip', role: 'tablist', 'aria-label': 'Wochentag wählen' }, days.map(function (d) {
        const b = h('button', { type: 'button', role: 'tab', 'aria-selected': d === sel ? 'true' : 'false', class: 'dchip' + (d === sel ? ' on' : '') + (d === today ? ' today' : '') + (gapDay[d] ? ' hasgap' : ''), 'aria-label': PD.short(d) + (gapDay[d] ? ', Besetzungslücke' : '') },
          h('span', { class: 'dw', text: PD.short(d).slice(0, 2) }), h('span', { class: 'dn', text: String(+d.slice(8)) }), h('span', { class: 'dc' + (cnt[d] ? '' : ' none'), text: cnt[d] ? String(cnt[d]) : '·' }));
        b.addEventListener('click', function () { go(d); });
        return b;
      }));
      const mine = live.filter(function (s) { return s.date === sel; }).sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
      const open = mine.filter(function (s) { return s.pin === '00'; }), crew = mine.filter(function (s) { return s.pin !== '00'; });
      const gaps = (D.gaps || []).filter(function (g) { return g.date === sel; });
      const absent = D.employees.filter(function (e) { return e.pin !== '00' && (absByPin[e.pin] || []).some(function (x) { return x.from <= sel && sel <= x.to; }); });
      const card = function (s) {
        const nm = s.pin === '00' ? 'Offene Schicht' : (nameOf[s.pin] || s.pin);
        return h('div', { class: 'dcard' }, s.pin === '00' ? h('div', { class: 'avatar small open', text: '?' }) : DP.avatar(nm, 'avatar small'), h('div', { class: 'grow' }, h('div', { class: 'nm' + (s.pin === '00' ? '' : ' who-link'), text: nm, dataset: s.pin === '00' ? {} : { pin: s.pin } }), chip(s)));
      };
      const body = [];
      if (gaps.length) body.push(h('div', { class: 'dgaps' }, gaps.map(function (g) { const b = h('button', { type: 'button', class: 'gapchip' }, 'Lücke · ' + g.place + ' · ' + g.have + ' von ' + g.need); b.addEventListener('click', function () { openShiftModal({ place: g.place, date: sel }); }); return b; })));
      if (open.length) body.push(h('section', { class: 'dgroup' }, h('h4', { text: 'Offene Schichten' }), open.map(card)));
      if (P.mode === 'place') {
        const byPlace = {}; crew.forEach(function (s) { (byPlace[s.place] = byPlace[s.place] || []).push(s); });
        Object.keys(byPlace).forEach(function (pl) { body.push(h('section', { class: 'dgroup' }, h('h4', {}, lineBadge(pl), ' ' + pl), byPlace[pl].map(card))); });
      } else if (crew.length) body.push(h('section', { class: 'dgroup' }, h('h4', { text: 'Im Dienst (' + crew.length + ')' }), crew.map(card)));
      if (absent.length) body.push(h('section', { class: 'dgroup' }, h('h4', { text: 'Krank oder im Urlaub' }), absent.map(function (e) { return h('div', { class: 'dcard abs' }, DP.avatar(e.name, 'avatar small'), h('div', { class: 'grow' }, nameLink(e.name, e.pin), (absByPin[e.pin] || []).filter(function (x) { return x.from <= sel && sel <= x.to; }).map(absChip))); })));
      if (!mine.length && !absent.length) body.push(h('div', { class: 'empty', text: 'Keine Schichten an diesem Tag.' }));
      const add = h('button', { type: 'button', class: 'btn btn-primary dadd' }, DP.icon('plus', 'sm'), 'Schicht für ' + PD.short(sel) + ' anlegen');
      add.addEventListener('click', function () { openShiftModal({ date: sel }); });
      const box = h('div', { class: 'dayview' }, strip, h('div', { class: 'dtitle2' }, PD.short(sel) + (sel === today ? ' · heute' : ''), h('span', { class: 'muted small', text: ' ' + crew.length + ' im Dienst' + (open.length ? ' · ' + open.length + ' offen' : '') })), body, add);
      let x0 = null, y0 = null;
      box.addEventListener('touchstart', function (e) { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
      box.addEventListener('touchend', function (e) { if (x0 === null) return; const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0; x0 = null; if (Math.abs(dx) > 70 && Math.abs(dy) < 45) { const i = days.indexOf(sel) + (dx < 0 ? 1 : -1); if (i >= 0 && i < days.length) go(days[i]); } }, { passive: true });
      return box;
    };
    const placeLegend = null;
    return h('div', { class: 'stack' }, h('div', { class: 'print-only print-title', text: 'Dienstplan KW ' + PD.isoWeek(ws) + ' · ' + PD.rangeLabel(ws) }), toolbar, small ? h('details', { class: 'legend-fold' }, h('summary', { text: 'Legende' }), legend, placeLegend) : [legend, placeLegend],
      small ? dayView() : h('div', { class: 'card grid-wrap' }, rows.length ? h('table', { class: 'plan' }, h('thead', {}, head), h('tbody', {}, rows), foot) : h('div', { class: 'empty', text: 'Keine Mitarbeiter vorhanden.' })),
      h('p', { class: 'muted small', text: 'Klicke auf eine Schicht zum Bearbeiten oder auf das Plus in einem Feld zum Anlegen. Neue Schichten sind zuerst Entwürfe. Erst „Veröffentlichen“ macht sie für die Mitarbeiter sichtbar.' }));
  }

  function svgEl(tag, attrs) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.keys(attrs || {}).forEach(function (k) { if (k === 'style') e.style.cssText = attrs[k]; else e.setAttribute(k, attrs[k]); }); for (let i = 2; i < arguments.length; i++) { const a = arguments[i]; if (Array.isArray(a)) a.forEach(function (x) { e.append(x); }); else if (a) e.append(a); } return e; }
  function authArt() {
    const lines = [['M20 250 H150 L200 200 H500', 'var(--c1)'], ['M20 120 H120 L170 170 H300 L350 220 H500', 'var(--c3)'], ['M250 20 V100 L300 150 V340', 'var(--c2)'], ['M20 330 H120 L170 280 H500', 'var(--c5)']];
    const st = [[60, 250], [150, 250], [250, 200], [420, 200], [70, 120], [120, 120], [235, 170], [420, 220], [250, 60], [300, 250], [300, 320], [70, 330], [220, 280], [400, 280], [300, 200, 1], [300, 170, 1], [300, 280, 1]];
    const svg = svgEl('svg', { viewBox: '0 0 520 360', width: '100%', class: 'auth-map', role: 'presentation', focusable: 'false' },
      lines.map(function (l) { return svgEl('path', { d: l[0], fill: 'none', style: 'stroke:' + l[1] + ';stroke-width:9;stroke-linecap:round;stroke-linejoin:round' }); }),
      st.map(function (s) { return svgEl('circle', { cx: s[0], cy: s[1], r: s[2] ? 9 : 7, style: 'fill:#fff;stroke:#0D1B2A;stroke-width:' + (s[2] ? 4 : 3) }); }));
    return h('aside', { class: 'auth-art', 'aria-hidden': 'true' }, h('div', { class: 'auth-art-in' },
      h('div', { class: 'auth-art-brand' }, h('div', { class: 'mark' }, DP.icon('calendar')), 'Dienstplan'),
      h('h2', { text: 'Jeder Dienst. Jeder Standort. Ein Plan.' }), h('p', { text: 'Schichten planen, Stunden prüfen, Ausfälle auffangen.' }), svg,
      h('div', { class: 'auth-art-places' }, DP.PLACES.map(function (p) { return h('span', { class: DP.placeClass(p).trim() }, h('i', {}), p); }))));
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
    else if (tab === 'overview') await Promise.all([loadSettings(), loadExpiry(), loadAcks()]);
    else if (tab === 'places') await loadPlaces();
    else if (tab === 'users') await loadUsers();
    else if (tab === 'rights') await loadRights();
    else if (tab === 'attend') { try { localStorage.setItem('att_used', '1'); } catch (e) { /* egal */ } await loadAtt(undefined, false, 15000); }   // zurück auf den Reiter: bei altem Stand im Hintergrund auffrischen
    else if (tab === 'viewlink') await loadViewLink();
    else if (tab === 'chef') await loadChef();
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
        h('div', { class: 'row wrap' }, nameLink(q.name, q.pin, 't nm'), h('span', { class: 'muted', text: q.label }), h('span', { class: 'badge ' + st[1], text: st[0] }),
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
    let applyBox = null, warnBox = null, updateWarn = null;
    if (decision === 'genehmigt') {
      const pv = await adm('adminRequestPreview', { id: q.id });
      if (pv.status !== 'success') { if (pv.code !== 'ADMIN_AUTH') DP.toast(pv.message || 'Das hat nicht geklappt.', 'error'); return; }
      if (pv.items.length && (q.type === 'krank' || q.type === 'urlaub' || q.type === 'tausch')) {
        nodes.push(h('h3', { text: q.type === 'tausch' ? 'Wer übernimmt die Schicht?' : 'Was passiert mit den ' + pv.items.length + (pv.items.length === 1 ? ' Schicht' : ' Schichten') + '?' }));
        pv.items.forEach(function (it) {
          const sel = h('select', { class: 'input', 'aria-label': 'Ersatz für ' + PD.short(it.shift.date) });
          sel.append(h('option', { value: 'cancel', text: 'Schicht absagen (kein Ersatz)' }));
          sel.append(h('option', { value: 'assign:00', text: 'Als offene Schicht anbieten (alle können sie übernehmen)' }));
          sel.append(h('option', { value: 'keep', text: q.type === 'tausch' ? 'Nichts ändern: die Schicht bleibt bei ' + q.name : 'Schicht lassen (später entscheiden)' }));
          it.candidates.forEach(function (c) {
            const label = c.name + ' · ' + (c.verdict === 'frei' ? 'frei' : c.verdict === 'warnung' ? 'mit Hinweis' : 'nicht möglich') + (c.verdict === 'blockiert' ? (c.reasons[0] ? ' (' + c.reasons[0].replace(/\.$/, '') + ')' : '') : ' · ' + PD.fmtHours(c.weekHours) + ' Std./Woche');
            const o = h('option', { value: 'assign:' + c.pin, text: label });
            if (c.verdict === 'blockiert') o.disabled = true;
            sel.append(o);
          });
          sel.value = it.bestPin ? 'assign:' + it.bestPin : (q.type === 'tausch' ? 'assign:00' : 'cancel');
          sel.addEventListener('change', function () { if (typeof updateWarn === 'function') updateWarn(); });
          choices.push({ shift: it.shift, select: sel });
          nodes.push(h('div', { class: 'decrow' }, h('div', { class: 'grow' }, h('strong', { text: PD.short(it.shift.date) + ' · ' + it.shift.start + '–' + it.shift.end }), h('div', { class: 'muted small', text: it.shift.place + (it.shift.status === 'entwurf' ? ' (Entwurf)' : '') })), sel));
        });
        warnBox = h('div', {});
        updateWarn = function () {
          const keep = choices.filter(function (c) { return c.select.value === 'keep'; }).length;
          const cancel = choices.filter(function (c) { return c.select.value === 'cancel'; }).length;
          const parts = [];
          if (keep) parts.push(keep === 1 ? 'Eine Schicht bleibt bei ' + q.name + '. Sie oder er sieht sie weiter im Plan.' : keep + ' Schichten bleiben bei ' + q.name + '. Sie werden weiter im Plan angezeigt.');
          if (cancel) parts.push(cancel === 1 ? 'Eine Schicht wird ersatzlos abgesagt: dieser Dienst ist dann unbesetzt.' : cancel + ' Schichten werden ersatzlos abgesagt: diese Dienste sind dann unbesetzt.');
          warnBox.replaceChildren(...(parts.length ? [alertBox('warn', parts.join(' '))] : []));
        };
        nodes.push(h('p', { class: 'hint', text: 'Voreingestellt ist der beste freie Kollege (am wenigsten Stunden in der Woche). Findet sich keiner, wird die Schicht als offene Schicht angeboten. Du kannst jede Zeile ändern.' }), warnBox);
        updateWarn();
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
            if (r.opened) parts.push(r.opened + (r.opened === 1 ? ' Schicht als offene Schicht angeboten' : ' Schichten als offene Schichten angeboten'));
            if (r.remaining) parts.push(r.remaining + (r.remaining === 1 ? ' Schicht steht noch im Plan' : ' Schichten stehen noch im Plan'));
            if (r.kept) parts.push(r.kept + (r.kept === 1 ? ' Schicht bleibt unverändert' : ' Schichten bleiben unverändert'));
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
  function messagesViewBase() {
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
        DP.avatar(it.name, 'avatar small'),
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
      return h('div', { class: 'cand' + (c.verdict === 'blockiert' ? ' off' : '') }, DP.avatar(c.name, 'avatar'),
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
      iconBtn('chevright', 'Nächster Monat', function () { go(monthAdd(R.month, 1)); }), monthJumpBtn(R.month, go), nowBtn, h('div', { class: 'grow' }), csv, prn);
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
        h('td', { 'data-l': 'Mitarbeiter' }, h('div', { class: 'name-cell' }, DP.avatar(e.name, 'avatar'), h('div', {}, nameLink(e.name, e.pin), e.drafts ? h('div', { class: 'muted small', text: e.drafts + ' Entwurf' + (e.drafts > 1 ? 'e' : '') + ' (nicht gezählt)' }) : null))),
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
    const team = h('input', { type: 'checkbox', id: 'st_team' });
    team.checked = !!state.settings.teamPlan;
    team.addEventListener('change', async function () {
      const want = team.checked;
      const r = await adm('adminSetSettings', { teamPlan: want });
      if (r.status === 'success') { state.settings.teamPlan = !!r.teamPlan; DP.toast(r.teamPlan ? 'Mitarbeiter sehen jetzt den Monatsplan des Teams.' : 'Der Monatsplan des Teams ist wieder gesperrt.'); }
      else { team.checked = !want; if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Das hat nicht geklappt.', 'error'); }
    });
    const mv = h('input', { type: 'checkbox', id: 'st_month' });
    mv.checked = state.settings.monthView !== false;
    mv.addEventListener('change', async function () {
      const want = mv.checked;
      const r = await adm('adminSetSettings', { monthView: want });
      if (r.status === 'success') { state.settings.monthView = r.monthView !== false; DP.toast(r.monthView ? 'Mitarbeiter dürfen jetzt in ihrem Plan blättern.' : 'Das Blättern im eigenen Plan ist gesperrt.'); }
      else { mv.checked = !want; if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Das hat nicht geklappt.', 'error'); }
    });
    const pa = h('input', { type: 'checkbox', id: 'st_planapp' });
    pa.checked = state.settings.planApp !== false;
    pa.addEventListener('change', async function () {
      const want = pa.checked;
      const r = await adm('adminSetSettings', { planApp: want });
      if (r.status === 'success') { state.settings.planApp = r.planApp !== false; DP.toast(r.planApp ? '„Mein Dienstplan“ ist in der Mitarbeiter-App wieder sichtbar.' : '„Mein Dienstplan“ ist in der Mitarbeiter-App ausgeblendet. Alle Daten und Funktionen bleiben erhalten.'); }
      else { pa.checked = !want; if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Das hat nicht geklappt.', 'error'); }
    });
    const vb = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', id: 'verifyBtn' }, DP.icon('shield', 'sm'), 'Bestätigung prüfen');
    vb.addEventListener('click', verifyDialog);
    return h('section', { class: 'card stack-sm' }, h('div', { class: 'row between' }, h('h3', { text: 'Einstellungen' }), vb),
      h('label', { class: 'check' }, pa, h('span', {}, '„Mein Dienstplan“ in der Mitarbeiter-App anzeigen', h('div', { class: 'hint', text: 'Ausgeschaltet ist der Eintrag in der Startauswahl und die Dienstplan-Seite für Mitarbeiter nicht erreichbar. Pläne, Anträge und alle Daten bleiben erhalten, nach dem Einschalten ist alles wieder da.' }))),
      h('label', { class: 'check' }, mv, h('span', {}, 'Mitarbeiter dürfen ihren eigenen Plan monatsweise ansehen', h('div', { class: 'hint', text: 'In „Mein Dienstplan“ erscheinen Pfeile zum Blättern, auch in vergangene Monate. Es sind immer nur die eigenen Schichten zu sehen.' }))),
      h('label', { class: 'check' }, box, h('span', {}, 'Arbeitszeit-Warnungen beim Planen', h('div', { class: 'hint', text: 'Warnt vor weniger als 11 Std. Ruhezeit, mehr als 10 Std. am Tag und mehr als 48 Std. pro Woche. Standard ist AUS (Pilotbetrieb). Eine Doppelbelegung bleibt immer gesperrt.' }))),
      h('label', { class: 'check' }, team, h('span', {}, 'Mitarbeiter dürfen den Monatsplan des Teams sehen', h('div', { class: 'hint', text: 'In der App erscheint dann „Monatsplan des Teams“: wer wann wo arbeitet, nur veröffentlichte Schichten, ohne Telefonnummern und interne Notizen.' }))));
  }
  const overviewViewBase = overviewView;

  // ---------- Plan zurücksetzen (Version 39) ----------
  async function resetPlanDialog(pin) {
    const P = state.plan, D = P.data;
    if (!D) return;
    const ms = P.monthStart.slice(0, 7);
    const list = D.shifts.filter(function (s) { return s.status !== 'abgesagt' && s.date.slice(0, 7) === ms && (!pin || s.pin === pin); });
    const drafts = list.filter(function (s) { return s.status === 'entwurf'; }).length, pub = list.length - drafts;
    const who = pin ? ((D.employees.filter(function (e) { return e.pin === pin; })[0] || {}).name || 'diesen Mitarbeiter') : 'alle Mitarbeiter';
    if (!list.length) { DP.toast('Da ist nichts eingeplant.', 'x'); return; }
    const run = async function (what) {
      const r = await adm('planClear', { scope: pin ? 'person' : 'month', pin: pin || '', month: ms, what: what });
      if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Das hat nicht geklappt.', 'error'); return; }
      P.undo = r.undo && r.undo.length ? { list: r.undo, label: r.removed + ' Schichten entfernt' } : null;
      DP.toast(r.removed + (r.removed === 1 ? ' Schicht' : ' Schichten') + ' entfernt' + (r.cancelled ? ' (' + r.cancelled + ' veröffentlichte abgesagt)' : '') + '.');
      await loadPlan(); renderTab();
    };
    DP.modal({ title: 'Plan zurücksetzen', body: h('div', { class: 'stack-sm' },
      h('p', {}, h('strong', { text: PD.monthLabel(P.monthStart) }), ' · ' + who + ': ' + drafts + (drafts === 1 ? ' Entwurf' : ' Entwürfe') + ' und ' + pub + (pub === 1 ? ' veröffentlichte Schicht' : ' veröffentlichte Schichten') + '.'),
      h('p', { class: 'muted small', text: 'Entwürfe werden gelöscht. Veröffentlichte Schichten werden abgesagt, die Mitarbeiter bekommen eine Nachricht. Krank- und Urlaubstage bleiben bestehen. Direkt danach kannst du es rückgängig machen.' })),
      actions: [{ label: 'Abbrechen' }, { label: 'Nur Entwürfe löschen (' + drafts + ')', onClick: function () { return drafts ? run('drafts') : DP.toast('Es gibt keine Entwürfe.', 'x'); } }, { label: 'Alles zurücksetzen (' + list.length + ')', kind: 'danger', onClick: function () { return run('all'); } }] });
  }

  // ---------- Monatsansicht mit Stift ----------
  let brushDrag = null;
  function brushLabel(b) { return !b ? 'kein Stift' : b.kind === 'erase' ? 'Radierer' : b.place + ' ' + b.start + '–' + b.end; }
  async function commitBrush(pin, dates) {
    const P = state.plan, D = P.data, b = P.brush;
    if (!b || !D || !dates.length) return;
    const ok = dates.filter(function (d) { return P.wd[PD.weekday(d)]; });
    if (!ok.length) { DP.toast('An diesen Wochentagen ist der Stift ausgeschaltet.', 'error'); return; }
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
    const resetAll = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', title: 'Alle Schichten dieses Monats entfernen' }, DP.icon('trash', 'sm'), 'Monat zurücksetzen');
    resetAll.addEventListener('click', function () { resetPlanDialog(''); });
    const toolbar = h('div', { class: 'plan-toolbar' }, viewSeg(), iconBtn('chevleft', 'Vorheriger Monat', function () { changeMonth(PD.monthAdd(ms, -1)); }), h('div', { class: 'weeklabel', text: PD.monthLabel(ms) }),
      iconBtn('chevright', 'Nächster Monat', function () { changeMonth(PD.monthAdd(ms, 1)); }), monthJumpBtn(ms.slice(0, 7), function (m) { changeMonth(m + '-01'); }), nowBtn, h('div', { class: 'grow' }), prn, resetAll, rhythm, pub);
    if (!D) return h('div', { class: 'stack' }, toolbar, h('div', { class: 'empty' }, P.error ? 'Verbindung unterbrochen. Es wird automatisch erneut versucht.' : h('span', { class: 'spinner' })));
    const n = PD.diff(ms, PD.add(PD.monthEnd(ms), 1));
    const days = []; for (let i = 0; i < n; i++) days.push(PD.add(ms, i));
    const gapDays = {}; (D.gaps || []).forEach(function (g) { (gapDays[g.date] = gapDays[g.date] || []).push(g.place); });
    if (P.autoPen && D.templates.length) { const t0 = D.templates[0]; P.brush = { kind: 'tpl', place: t0.place, start: t0.start, end: t0.end }; P.autoPen = false; } else if (P.autoPen) P.autoPen = false;
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
      h('div', { class: 'row wrap' }, h('strong', { text: 'Stift' }), h('span', { class: 'muted small', text: P.brush ? 'Gewählt: ' + brushLabel(P.brush) + '. Ziehe mit gedrückter Maustaste über die Tage einer Zeile, oder tippe auf einen Tag.' : 'Wähle eine Schicht als Stift. Dann ziehst du über die Tage, und alle werden auf einmal gefüllt.' })),
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
      const fill = h('button', { type: 'button', class: 'rowfill', 'aria-label': 'Ganze Zeile für ' + e.name + ' mit dem Stift füllen', title: 'Ganze Zeile mit dem Stift füllen' }, DP.icon('chevright', 'sm'));
      fill.disabled = !P.brush;
      fill.addEventListener('click', function () { commitBrush(e.pin, days); });
      const clr = h('button', { type: 'button', class: 'rowfill', 'aria-label': 'Alle Schichten von ' + e.name + ' in diesem Monat entfernen', title: 'Alle Schichten dieses Mitarbeiters in diesem Monat entfernen' }, DP.icon('trash', 'sm'));
      clr.addEventListener('click', function () { resetPlanDialog(e.pin); });
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
      rows.push(h('tr', {}, h('td', { class: 'who' }, h('div', { class: 'whocell' }, DP.avatar(e.name, 'avatar'), h('div', { class: 'grow' }, h('div', { class: 'nm', text: e.name, dataset: { pin: e.pin } }), e.pin === '00' ? h('span', { class: 'badge info', text: 'für alle' }) : !acctByPin[e.pin] ? h('span', { class: 'badge neutral', text: 'kein Zugang' }) : null), h('div', { style: 'display:flex;flex-direction:column;gap:3px;flex:none' }, fill, clr))), cells,
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
      h('p', { class: 'muted small', text: 'Ohne Stift öffnet ein Klick auf einen Tag die Schicht zum Bearbeiten. Neue Schichten sind Entwürfe, erst „Veröffentlichen“ macht sie für die Mitarbeiter sichtbar.' }));
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
      const isSmall = !!(window.matchMedia && window.matchMedia('(max-width: 760px)').matches) && state.plan.view !== 'month';
      if (card && tb && !isSmall) tb.insertAdjacentElement('afterend', card);
    }
    return el;
  };

  async function loadSettings() {
    const rs = await Promise.all([adm('adminGetSettings'), adm('adminGetCoverage'), adm('adminBackupStatus'), adm('adminGetPlaceInfo')]);
    if (rs[3] && rs[3].status === 'success') state.settings.placeInfo = rs[3].info || {};
    if (rs[0].status === 'success') { state.settings.rules = !!rs[0].rules; state.settings.teamPlan = !!rs[0].teamPlan; state.settings.monthView = rs[0].monthView !== false; state.settings.planApp = rs[0].planApp !== false; }
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
  overviewView = function () { const el = overviewViewBase(); (state.role === 'voll' ? [uncoveredCard(), acksCard(), expiryCard(), dashOpenCard(), dashGapsCard(), settingsCard(), coverageCard(), placeInfoCard(), backupCard()] : [uncoveredCard(), acksCard(), expiryCard(), dashOpenCard(), dashGapsCard()]).forEach(function (c) { if (c) el.append(c); }); return el; };

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
    view(h('div', { class: 'auth-wrap split' }, authArt(), h('div', { class: 'auth-card' },
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
  // ---------- Sicherheit: Admin-PIN und Sitzungsschlüssel ----------
  function admCid() {   // zufällige Kennung dieses Browsers (nur zum Zählen von Fehlversuchen, keine persönlichen Daten)
    try {
      let c = localStorage.getItem('adm_cid');
      if (!c || !/^[A-Za-z0-9_-]{16,40}$/.test(c)) { const a = new Uint8Array(18); (window.crypto || window.msCrypto).getRandomValues(a); c = Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); localStorage.setItem('adm_cid', c); }
      return c;
    } catch (e) { return ''; }
  }
  function securityCard() {
    const S = state.sec;
    const line = function (okv, title, hint) { return h('div', { class: 'row wrap' }, h('span', { class: 'badge ' + (okv ? 'success' : 'warn'), text: okv ? 'in Ordnung' : 'bitte ändern' }), h('b', { text: title }), h('span', { class: 'muted small', text: hint })); };
    const pinB = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Admin-PIN ändern …' }), keyB = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Sitzungsschlüssel erneuern …' });
    pinB.addEventListener('click', secPinDialog); keyB.addEventListener('click', secKeyDialog);
    return h('section', { class: 'card stack-sm', id: 'sec_card' }, h('h3', { text: 'Sicherheit' }),
      S ? line(S.pinCustom, 'Admin-PIN', S.pinCustom ? 'Du hast eine eigene PIN gesetzt.' : 'Es ist noch keine eigene Admin-PIN gesetzt.') : h('div', { class: 'muted small', text: 'Status wird geladen …' }),
      S ? line(S.keyCustom, 'Sitzungsschlüssel', S.keyCustom ? 'Ein eigener Schlüssel ist gesetzt.' : 'Es ist noch kein eigener Schlüssel gesetzt.') : null,
      S ? h('div', { class: 'muted small', text: 'Bekannte Geräte: ' + S.trustedAdmin + ' für die Admin-Anmeldung, ' + S.trustedChef + ' für das Chef-Passwort. Sie werden bei einem Angriff mit vielen Fehlversuchen nie ausgesperrt.' }) : null,
      h('div', { class: 'row wrap' }, pinB, keyB));
  }
  function secPinDialog() {
    const cur = h('input', { class: 'input', id: 'sec_cur', type: 'password', autocomplete: 'current-password' }), n1 = h('input', { class: 'input', id: 'sec_n1', type: 'password', autocomplete: 'new-password' }), n2 = h('input', { class: 'input', id: 'sec_n2', type: 'password', autocomplete: 'new-password' });
    DP.modal({ title: 'Admin-PIN ändern', body: h('div', { class: 'stack-sm' },
      h('p', { class: 'muted small', text: 'Mindestens 8 Zeichen (Ziffern und Buchstaben sind möglich), nicht zu einfach. Danach melden sich alle Admin-Sitzungen ab und du meldest dich mit der neuen PIN an. Bitte schreib sie dir auf.' }),
      field('Aktuelle Admin-PIN', cur, 'sec_cur'), field('Neue Admin-PIN', n1, 'sec_n1'), field('Neue PIN wiederholen', n2, 'sec_n2')),
      actions: [{ label: 'Abbrechen' }, { label: 'PIN ändern', kind: 'primary', closes: false, onClick: async function (api) {
        if (n1.value !== n2.value) { DP.toast('Die beiden neuen PINs sind nicht gleich.', 'error'); return; }
        const r = await adm('adminSecuritySetPin', { currentPin: cur.value, newPin: n1.value });
        if (r.status === 'success') { api.close(); sessionEnded('Die Admin-PIN wurde geändert. Bitte melde dich mit der neuen PIN an.'); }
        else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Nicht geändert.', 'error');
      } }] });
  }
  function secKeyDialog() {
    const cur = h('input', { class: 'input', id: 'sec_cur', type: 'password', autocomplete: 'current-password' });
    DP.modal({ title: 'Sitzungsschlüssel erneuern', body: h('div', { class: 'stack-sm' },
      h('p', { class: 'muted small', text: 'Erzeugt einen neuen geheimen Schlüssel für Admin-Sitzungen. Alle Anmeldungen mit der Admin-PIN enden (auch deine, du meldest dich danach neu an). Das Chef-Passwort, die Monatspasswörter, die Konten und die Handys der Mitarbeiter bleiben unberührt.' }),
      field('Aktuelle Admin-PIN zur Bestätigung', cur, 'sec_cur')),
      actions: [{ label: 'Abbrechen' }, { label: 'Schlüssel erneuern', kind: 'primary', closes: false, onClick: async function (api) {
        const r = await adm('adminSecurityNewKey', { currentPin: cur.value });
        if (r.status === 'success') { api.close(); sessionEnded('Der Sitzungsschlüssel wurde erneuert. Bitte melde dich neu an.'); }
        else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Nicht erneuert.', 'error');
      } }] });
  }
  async function loadUsers() {
    const rs = await Promise.all([adm('adminUsersList'), state.role === 'voll' ? adm('adminSecurityStatus') : Promise.resolve(null)]);
    if (rs[0].status === 'success') state.users = rs[0].users || [];
    if (rs[1] && rs[1].status === 'success') state.sec = rs[1];
  }
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
  // ---------- Übersichtslink: nur lesen, ein einziger Link ----------
  // Aufbau: Jede Antwort des Servers bringt den vollen neuen Stand mit. Aktionen laufen nacheinander (Warteschlange).
  // Beim Neuzeichnen bleiben Scroll-Position, Fokus und eingetippter Text erhalten, und der Stand wird nie zwischendurch geleert.
  state.vl = { cfg: null, month: null, detail: null, err: false, exOpen: true, imOpen: false, hidOpen: false, pending: 0, loaded: 0, msg: null, draft: { name: '', list: '' } };
  let vlChain = Promise.resolve();
  function vlEditing() {
    const V = state.vl, a = document.activeElement;
    if (V.draft.name || V.draft.list) return true;
    return !!(a && a.closest && a.closest('#content') && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type === 'text' && a.value)));
  }
  function vlHold() { return state.vl.pending > 0 || vlEditing(); }
  function vlBusyUI() {
    const V = state.vl, el = document.getElementById('vl_status');
    document.body.classList.toggle('vlbusy', V.pending > 0);
    if (el && V.pending > 0) { el.className = 'vlstatus busy'; el.textContent = 'Speichere … (' + V.pending + ')'; }
  }
  function vlRender() {
    const box = document.getElementById('content');
    if (!box || state.tab !== 'viewlink') return;
    document.body.classList.toggle('vlbusy', state.vl.pending > 0);
    const sy = window.scrollY, ae = document.activeElement, aid = ae && ae.id, ss = ae && ae.selectionStart, se = ae && ae.selectionEnd;
    box.replaceChildren(viewLinkView());
    window.scrollTo(0, sy); requestAnimationFrame(function () { window.scrollTo(0, sy); });
    if (aid) { const n = document.getElementById(aid); if (n) { n.focus(); try { if (ss != null) n.setSelectionRange(ss, se); } catch (e) { /* kein Textfeld */ } } }
  }
  function vlApply(r) {
    const V = state.vl;
    if (r.persons) {                                   // Antwort mit Monatsdetails
      if (!V.month || r.month === V.month) { V.detail = r; V.month = r.month; }
      if (r.cfg) V.cfg = r.cfg;
    } else if (r.token !== undefined) {                // Antwort mit Link-Einstellungen
      V.cfg = { token: r.token, locked: r.locked, def: r.def, defFixed: r.defFixed, opens: r.opens, last: r.last, months: r.months };
      const known = V.cfg.months.some(function (m) { return m.month === V.month; });
      if (r.detail && (!V.month || r.detail.month === V.month || !known)) { V.detail = r.detail; V.month = r.detail.month; }
      else if (!known) { V.detail = null; V.month = null; }
    }
    V.loaded = Date.now(); V.err = false;
  }
  async function vlReload(silent) {
    const V = state.vl, r = await adm('adminViewGet', V.month ? { month: V.month } : {});
    if (r.status !== 'success') { if (!silent) V.err = true; return false; }
    vlApply(r); return true;
  }
  async function loadViewLink() { return vlReload(false); }
  // okMsg: Text oder Funktion(antwort) -> Text. Gibt die Antwort zurück oder null bei Fehler.
  function vlAct(action, payload, okMsg) {
    const V = state.vl;
    V.pending++; vlBusyUI();
    const run = async function () {
      const r = await adm(action, payload);
      V.pending--;
      if (r.status === 'success') {
        vlApply(r);
        const mm = ((V.cfg && V.cfg.months) || []).filter(function (x) { return x.month === V.month; })[0];
        const txt = (typeof okMsg === 'function' ? okMsg(r) : okMsg);
        if (txt) { const full = txt + (mm ? ' · Übersichtsseite: ' + mm.sent + ' von ' + mm.total + ' gesendet' : ''); V.msg = { kind: 'ok', text: full }; DP.toast(full); }
        if (V.pending === 0) vlRender(); else vlBusyUI();
        return r;
      }
      if (r.code !== 'ADMIN_AUTH') {
        const t = r.code === 'NETWORK' ? 'Keine Verbindung. Das wurde NICHT gespeichert.' : (r.message || 'Das hat nicht geklappt.');
        V.msg = { kind: 'err', text: t }; DP.toast(t, 'error');
      }
      if (V.pending === 0) { await vlReload(true); vlRender(); }   // Stand vom Server holen, damit die Ansicht stimmt
      return null;
    };
    const p = vlChain.then(run, run); vlChain = p.catch(function () { /* Kette bleibt am Laufen */ }); return p;
  }
  async function vlSelectMonth(m) {
    const V = state.vl; if (V.month === m) return;
    V.month = m; V.detail = null; vlRender();
    const r = await adm('adminViewGet', { month: m });
    if (r.status === 'success') vlApply(r); else { V.msg = { kind: 'err', text: r.message || 'Der Monat konnte nicht geladen werden.' }; }
    vlRender();
  }
  // Text pro Monat auf der Übersichtsseite („wird am Tag xx freigegeben“), auf Wunsch auch für einen noch nicht freigegebenen Monat
  function vlNoteDialog(m) {
    const t = h('textarea', { class: 'input', id: 'vl_note', rows: '4', maxlength: '300', placeholder: 'Zum Beispiel: Dieser Monat wird vom Admin am Tag xx freigegeben.' }); t.value = m.note || '';
    const cb = h('input', { type: 'checkbox', id: 'vl_ann' }); cb.checked = !!m.announce;
    DP.modal({ title: 'Text für ' + m.label, wide: true, body: h('div', { class: 'stack-sm' },
      h('p', { class: 'muted small', text: 'Besucher sehen diesen Text, wenn sie auf den Monat tippen. Bei einem freigegebenen Monat steht er über den Zahlen. Du entscheidest selbst, was dort steht.' }),
      field('Text (bis 300 Zeichen, leer = kein Text)', t, 'vl_note'),
      h('label', { class: 'check', for: 'vl_ann' }, cb, h('span', { text: 'Auch zeigen, wenn der Monat noch nicht freigegeben ist (Besucher sehen dann nur den Text, keine Zahlen und Namen)' }))),
      actions: [{ label: 'Abbrechen' }, { label: 'Speichern', kind: 'primary', closes: false, onClick: async function (api) {
        const r = await vlAct('adminViewMonthSet', { month: m.month, note: t.value, announce: cb.checked }, 'Text gespeichert'); if (r) api.close();
      } }] });
  }
  function vlPasswordDialog(m) {
    const inp = h('input', { class: 'input', id: 'vl_pw', type: 'text', autocomplete: 'off', placeholder: 'Neues Passwort, mindestens 6 Zeichen' });
    const err = h('div', {});
    const acts = [{ label: 'Abbrechen', kind: 'secondary' }];
    if (m.hasPw) acts.push({ label: 'Passwort entfernen', kind: 'secondary', closes: false, onClick: async function (api) { const r = await vlAct('adminViewMonthSet', { month: m.month, clearPassword: true }, 'Passwort entfernt. Der Monat ist jetzt offen'); if (r) api.close(); else err.replaceChildren(alertBox('error', state.vl.msg ? state.vl.msg.text : 'Das hat nicht geklappt.')); } });
    acts.push({ label: 'Speichern', kind: 'primary', closes: false, onClick: async function (api) {
      err.replaceChildren();
      const r = await vlAct('adminViewMonthSet', { month: m.month, password: inp.value }, 'Passwort gesetzt');
      if (r) api.close(); else err.replaceChildren(alertBox('error', state.vl.msg ? state.vl.msg.text : 'Das hat nicht geklappt.'));
    } });
    DP.modal({ title: 'Passwort für ' + m.label, body: h('div', { class: 'stack-sm' }, h('p', { class: 'muted small', text: m.hasPw ? 'Dieser Monat hat ein Passwort. Du kannst es ersetzen oder entfernen. Bisherige Freischaltungen verfallen dabei.' : 'Ohne Passwort kann jeder mit dem Link diesen Monat sehen.' }), field('Passwort', inp, 'vl_pw'), err), actions: acts });
  }
  // Gesendete Stunden einer Person: ansehen, als CSV herunterladen oder drucken (nur in der Konsole, nie auf der öffentlichen Seite)
  function vlDownload(filename, text) {
    const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename }); document.body.append(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 600000);   // der Link „Datei speichern“ bleibt 10 Minuten gültig
    return url;
  }
  async function vlHours(name, pin) {
    const V = state.vl, r = await adm('adminViewHours', { month: V.month, pin: pin });
    if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Keine Stunden gefunden.', 'error'); return; }
    const de = function (x) { return (x === '' || x == null) ? '' : String(x).replace('.', ','); };
    const day = function (iso) { return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4); };
    const rows = r.days.map(function (d) { return [day(d.iso), d.geloescht ? 'vom Admin gelöscht' : d.standort, d.beginn, d.ende, d.geloescht ? '' : de(d.stunden), d.geaendert && !d.geloescht ? 'korrigiert (eingereicht ' + de(d.eingereicht) + ')' : '']; });
    const head = ['Datum', 'Standort', 'Beginn', 'Ende', 'Stunden', 'Hinweis'];
    const sumLine = 'Summe: ' + de(r.summe) + ' Std.' + (r.eingereicht !== '' && r.eingereicht !== r.summe ? ' (eingereicht: ' + de(r.eingereicht) + ' Std.)' : '');
    const mkTable = function () { return h('table', { class: 'table vlhours' }, h('thead', {}, h('tr', {}, head.map(function (t) { return h('th', { text: t }); }))), h('tbody', {}, rows.map(function (row) { return h('tr', {}, row.map(function (c) { return h('td', { text: c }); })); }))); };
    const csvText = [head].concat(rows).concat([['Summe', '', '', '', de(r.summe), r.eingereicht !== '' && r.eingereicht !== r.summe ? 'eingereicht ' + de(r.eingereicht) : '']]).map(function (row) { return row.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(';'); }).join('\r\n');
    const fname = 'Stunden_' + r.name.replace(/[^A-Za-z0-9ÄÖÜäöüß]+/g, '_') + '_' + r.month + '.csv';
    const print = function () {
      const box = h('div', { class: 'hoursprint' }, h('h2', { text: 'Stunden von ' + r.name + ', ' + r.label }), mkTable(), h('p', { text: sumLine }));
      document.body.append(box); document.body.classList.add('hp');
      const done = function () { document.body.classList.remove('hp'); box.remove(); window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done); window.print(); done();
    };
    const dlNote = h('p', { class: 'small', id: 'vl_dlnote' });
    DP.modal({ title: 'Stunden von ' + r.name + ', ' + r.label, body: h('div', { class: 'stack-sm' }, h('div', { class: 'vlscroll' }, mkTable()), dlNote, h('p', { class: 'small' }, h('strong', { text: sumLine })), h('p', { class: 'muted small', text: r.freigegeben ? 'Diese Stunden sind freigegeben.' : 'Diese Stunden sind noch nicht freigegeben.' })),
      actions: [{ label: 'Schließen', kind: 'secondary' }, { label: 'CSV herunterladen', kind: 'secondary', closes: false, onClick: function () { const url = vlDownload(fname, csvText); DP.toast('Heruntergeladen: ' + fname); dlNote.replaceChildren(document.createTextNode('✔ Datei erstellt. Startet der Download nicht von selbst: '), h('a', { href: url, download: fname, text: 'Datei speichern' }), document.createTextNode(' (' + fname + ').')); } }, { label: 'Drucken / als PDF', kind: 'primary', closes: false, onClick: print }] });
  }
  function vlSelfTest() {
    return adm('adminViewSelfTest').then(function (r) {
      if (r.status !== 'success') { DP.toast(r.message || 'Der Selbsttest ist nicht möglich.', 'error'); return; }
      DP.modal({ title: r.ok ? 'Selbsttest: alles in Ordnung' : 'Selbsttest: Fehler gefunden',
        body: h('div', { class: 'stack-sm' }, h('p', { class: 'muted small', text: 'Das System prüft sich hier selbst: Schreiben und Lesen im Blatt, PIN-Format, Sperre, Zwischenspeicher, Geschwindigkeit.' }),
          r.checks.map(function (c) { return h('div', { class: 'row between vlcheck' }, h('span', { text: (c.ok ? '✔ ' : '✖ ') + c.name, class: c.ok ? '' : 'vlbad' }), h('span', { class: 'muted small', text: c.info })); })),
        actions: [{ label: 'Schließen', kind: 'primary' }] });
    });
  }
  function viewLinkView() {
    setTitle('Übersichtslink');
    const V = state.vl, C = V.cfg;
    const bt = function (label, cls, fn) { const b = h('button', { type: 'button', class: 'btn btn-sm ' + cls, text: label }); b.addEventListener('click', fn); return b; };
    if (!C) return h('div', {}, V.err ? alertBox('error', 'Der Übersichtslink konnte nicht geladen werden. Bitte oben auf „Aktualisieren“ klicken.') : h('span', { class: 'spinner' }));
    const status = h('div', { id: 'vl_status', class: 'vlstatus' + (V.pending > 0 ? ' busy' : (V.msg ? ' ' + V.msg.kind : '')), role: 'status', 'aria-live': 'polite' });
    if (V.pending > 0) status.textContent = 'Speichere … (' + V.pending + ')'; else if (V.msg) status.textContent = (V.msg.kind === 'ok' ? '✔ ' : '✖ ') + V.msg.text;
    const url = new URL('uebersicht.html', location.href).href.split('#')[0] + '#' + C.token;
    // 1) Der Link
    const urlIn = h('input', { class: 'input', id: 'vl_url', type: 'text', readonly: 'readonly', value: url, 'aria-label': 'Übersichtslink' });
    urlIn.addEventListener('focus', function () { urlIn.select(); });
    const copy = bt('Link kopieren', 'btn-primary', async function () { try { await navigator.clipboard.writeText(url); } catch (e) { urlIn.select(); try { document.execCommand('copy'); } catch (e2) { /* markiert genügt */ } } DP.toast('Link kopiert.'); });
    const look = h('a', { class: 'btn btn-secondary btn-sm', href: url, target: '_blank', rel: 'noopener noreferrer', text: 'Ansehen' });
    const lockB = bt(C.locked ? 'Link freigeben' : 'Link sperren', C.locked ? 'btn-primary' : 'btn-secondary', function () { vlAct('adminViewSet', { locked: !C.locked, month: V.month }, C.locked ? 'Der Link ist wieder freigegeben' : 'Der Link ist gesperrt'); });
    const newB = bt('Neuen Link erzeugen', 'btn-secondary', async function () {
      if (!(await DP.confirm('Neuen Link erzeugen?', 'Der bisherige Link funktioniert danach nicht mehr. Du musst den neuen Link wieder verteilen.', 'Neuen Link erzeugen', 'danger'))) return;
      vlAct('adminViewNewToken', { month: V.month }, 'Neuer Link erzeugt. Der alte ist ungültig');
    });
    const card1 = h('section', { class: 'card stack-sm' },
      h('div', { class: 'row between' }, h('h3', { text: 'Der Link' }), h('span', { class: 'badge ' + (C.locked ? 'danger' : 'success'), text: C.locked ? 'gesperrt' : 'aktiv' })),
      h('p', { class: 'muted small', text: 'Eine Seite nur zum Ansehen, fürs Handy gemacht. Niemand kann dort etwas ändern. Sie zeigt immer den aktuellen Stand.' }),
      urlIn, h('div', { class: 'row wrap' }, copy, look, lockB, newB, bt('Selbsttest', 'btn-ghost', vlSelfTest)),
      h('p', { class: 'muted small', text: C.opens ? C.opens + (C.opens === 1 ? ' Aufruf' : ' Aufrufe') + ' bisher, zuletzt am ' + DP.fmtDateTime(C.last) + '. Jeden Aufruf siehst du auch in der Glocke. „Ansehen“ zählt ebenfalls als Aufruf.' : 'Noch nicht aufgerufen. Jeden Aufruf siehst du in der Glocke.' }));
    // 2) Monate
    const newestOn = (C.months.filter(function (x) { return x.on; })[0] || {}).month;   // ohne feste Wahl öffnet sich dieser Monat zuerst
    const rows = C.months.map(function (m) {
      const cb = h('input', { type: 'checkbox', id: 'vl_on_' + m.month }); cb.checked = m.on;
      cb.addEventListener('change', function () { vlAct('adminViewMonthSet', { month: m.month, on: cb.checked }, m.label + (cb.checked ? ' ist freigegeben' : ' ist versteckt')); });
      const ho = h('input', { type: 'checkbox', id: 'vl_ho_' + m.month }); ho.checked = !m.hideOpen;
      ho.addEventListener('change', function () { vlAct('adminViewMonthSet', { month: m.month, hideOpen: !ho.checked }, ho.checked ? 'Die Liste „Noch offen“ ist wieder sichtbar' : 'Besucher sehen nur noch „Gesendet“'); });
      const acts = h('div', { class: 'row wrap' }, h('label', { class: 'check', for: 'vl_on_' + m.month }, cb, h('span', { text: 'freigegeben' })), h('label', { class: 'check', for: 'vl_ho_' + m.month }, ho, h('span', { text: 'Liste „Noch offen“ zeigen' })), bt(m.hasPw ? 'Passwort ändern' : 'Passwort setzen', 'btn-secondary', function () { vlPasswordDialog(m); }));
      if (m.on && !(C.defFixed && m.month === C.def)) acts.append(bt('Als Startmonat', 'btn-ghost', function () { vlAct('adminViewSet', { def: m.month, month: V.month }, m.label + ' öffnet sich immer zuerst'); }));
      acts.append(bt(m.note ? 'Text ändern' : 'Text …', 'btn-secondary', function () { vlNoteDialog(m); }));
      acts.append(bt('Entfernen', 'btn-ghost', async function () { if (await DP.confirm('Monat entfernen?', m.label + ' verschwindet aus der Liste. Zusatzpersonen und Ausnahmen dieses Monats bleiben gespeichert.', 'Entfernen', 'danger')) vlAct('adminViewMonthDelete', { month: m.month }, m.label + ' entfernt'); }));
      return h('div', { class: 'vlrow' + (m.on ? '' : ' off') }, h('div', { class: 'row between' }, h('strong', { text: m.label }),
        h('span', { class: 'row wrap' }, (C.defFixed ? m.month === C.def : m.month === newestOn) ? h('span', { class: 'badge neutral', text: C.defFixed ? 'Startmonat' : 'Startmonat (automatisch)' }) : null, (!m.on && m.announce && m.note) ? h('span', { class: 'badge warn', text: 'angekündigt' }) : null, m.note ? h('span', { class: 'badge neutral', text: 'Text', title: m.note }) : null, m.hideOpen ? h('span', { class: 'badge warn', text: 'nur Gesendete' }) : null, m.viaChef ? h('span', { class: 'badge neutral', text: 'mit Chef-Freigabe', title: 'Verschwindet wieder, wenn du die Chef-Freigabe zurücknimmst' }) : null, h('span', { class: 'badge ' + (m.hasPw ? 'warn' : 'neutral'), text: m.hasPw ? 'Passwort' : 'ohne Passwort' }))),
        h('div', { class: 'muted small', text: m.sent + ' von ' + m.total + ' haben gesendet' + (m.on ? '' : (m.announce && m.note ? ' · angekündigt: Besucher sehen nur den Text' : ' · versteckt, für Besucher nicht sichtbar')) }), acts);
    });
    const autoB = C.defFixed ? bt('Startmonat: automatisch (neuester)', 'btn-ghost', function () { vlAct('adminViewSet', { defAuto: true, month: V.month }, 'Es öffnet sich immer der neueste freigegebene Monat'); }) : null;
    const addM = h('div', { class: 'row wrap' }, autoB, h('span', { class: 'muted small', text: 'Monat hinzufügen:' }), monthJumpBtn(PD.today().slice(0, 7), function (m) { V.month = m; V.detail = null; vlAct('adminViewMonthSet', { month: m, on: true }, PD.monthLabel(m + '-01') + ' ist freigegeben'); }));
    const card2 = h('section', { class: 'card stack-sm' }, h('h3', { text: 'Welche Monate sind zu sehen?' }), rows.length ? h('div', { class: 'stack-sm' }, rows) : h('p', { class: 'muted', text: 'Noch kein Monat. Füge einen hinzu.' }), addM);
    // 3) Wer wird erwartet?
    const D = V.detail;
    const chips = h('div', { class: 'row wrap' }, C.months.map(function (m) { const c = h('button', { type: 'button', class: 'chip' + (m.month === V.month ? ' active' : ''), text: m.label }); c.addEventListener('click', function () { vlSelectMonth(m.month); }); return c; }));
    let body = V.month ? h('div', { class: 'vlloading' }, h('span', { class: 'spinner' }), h('span', { class: 'muted', text: ' Monat wird geladen …' })) : h('p', { class: 'muted', text: 'Füge oben einen Monat hinzu.' });
    if (D) {
      const byName = function (a, b) { return a.name.localeCompare(b.name, 'de'); };
      const mark = function (r) {
        const note = h('input', { class: 'input', id: 'vl_note', type: 'text', maxlength: '40', placeholder: 'Hinweis, z. B. per E-Mail (freiwillig)', autocomplete: 'off' });
        DP.modal({ title: r.name + ' als gesendet eintragen', body: h('div', { class: 'stack-sm' }, h('p', { class: 'muted small', text: 'Für Stunden, die auf anderem Weg ankamen, zum Beispiel per E-Mail. Auf der Übersichtsseite zählt die Person dann als gesendet. Der Hinweis bleibt intern und ist dort nicht zu sehen.' }), field('Hinweis', note, 'vl_note')),
          actions: [{ label: 'Abbrechen', kind: 'secondary' }, { label: 'Als gesendet eintragen', kind: 'primary', closes: false, onClick: async function (api) {
            const payload = { month: V.month, sent: true, note: note.value }; if (r.pin) payload.pin = r.pin; else payload.extraId = r.extraId;
            const res = await vlAct('adminViewMarkSent', payload, r.name + ' ist als gesendet eingetragen'); if (res) api.close();
          } }] });
        setTimeout(function () { note.focus(); }, 50);
      };
      const takeOut = function (r) { if (r.pin) vlAct('adminViewPersonExpect', { month: V.month, pin: r.pin, expected: false }, r.name + ' ist aus der Liste genommen'); else vlAct('adminViewExtraHide', { id: r.extraId, hidden: true }, r.name + ' ist aus der Liste genommen'); };
      const modeBtn = function (listOnly, label) { const b = h('button', { type: 'button', class: !!D.listOnly === listOnly ? 'active' : '', text: label }); b.addEventListener('click', function () { if (!!D.listOnly !== listOnly) vlAct('adminViewMonthSet', { month: V.month, listOnly: listOnly }, listOnly ? 'Es wird nur noch die Liste erwartet' : 'Es werden wieder alle im System erwartet'); }); return b; };
      const modeBox = h('div', { class: 'stack-sm' }, h('div', { class: 'seg', role: 'group', 'aria-label': 'Wer wird erwartet' }, modeBtn(false, 'Alle im System'), modeBtn(true, 'Nur meine Liste')),
        h('p', { class: 'muted small', text: D.listOnly ? 'Erwartet wird nur, wer auf deiner Liste steht. Wer nicht draufsteht und trotzdem seine Stunden schickt, erscheint trotzdem bei „gesendet“, fehlt aber nie. Hake unten Personen an oder füge deine Liste ein.' : 'Erwartet werden alle Personen im System plus deine Zusatzpersonen. Mit den Haken unten nimmst du einzelne heraus.' }));
      // Vorschau: genau das, was Besucher sehen
      const pv = D.preview || { total: 0, sentCount: 0, sent: [], missing: [] };
      const pvDet = h('details', { class: 'vlex' });
      pvDet.append(h('summary', { text: 'Namen zeigen' }), h('p', { class: 'small' }, h('strong', { text: 'Noch offen (' + pv.missing.length + '): ' }), document.createTextNode(pv.missing.join(', ') || '–')), h('p', { class: 'small' }, h('strong', { text: 'Gesendet (' + pv.sent.length + '): ' }), document.createTextNode(pv.sent.join(', ') || '–')));
      const preview = h('div', { class: 'vlpreview' }, h('div', { class: 'row between' }, h('strong', { text: 'So sieht die Übersichtsseite jetzt aus' }), h('span', { class: 'badge ' + (pv.total && pv.sentCount === pv.total ? 'success' : 'neutral'), id: 'vl_pv_count', text: pv.sentCount + ' von ' + pv.total + ' gesendet' })), pvDet);
      // Noch offen
      const openRows = [];
      if (!D.listOnly) D.persons.filter(function (p) { return !p.sent && !p.excluded && !p.claimed; }).forEach(function (p) { openRows.push({ name: p.name, pin: p.pin }); });
      D.extras.filter(function (e) { return !e.sent; }).forEach(function (e) { openRows.push({ name: e.name, extraId: e.id }); });
      openRows.sort(byName);
      const openList = h('div', { class: 'stack-sm' }, openRows.length ? openRows.map(function (r) { return h('div', { class: 'vlrow' }, h('div', { class: 'row between' }, h('strong', { text: r.name }), h('span', { class: 'row wrap' }, bt('Als gesendet eintragen', 'btn-secondary', function () { mark(r); }), bt('Aus Liste nehmen', 'btn-ghost', function () { takeOut(r); })))); }) : h('p', { class: 'muted small', text: 'Niemand mehr offen. Alle haben gesendet.' }));
      // Von dir eingetragen
      const manuals = [];
      D.persons.filter(function (p) { return p.manual; }).forEach(function (p) { manuals.push({ name: p.name, pin: p.pin, m: p.manual }); });
      D.extras.filter(function (e) { return e.manual; }).forEach(function (e) { manuals.push({ name: e.name, extraId: e.id, m: e.manual }); });
      manuals.sort(byName);
      const manualList = manuals.length ? h('div', { class: 'stack-sm' }, h('h4', { text: 'Von dir als gesendet eingetragen (' + manuals.length + ')' }), manuals.map(function (r) {
        return h('div', { class: 'vlrow' }, h('div', { class: 'row between' }, h('strong', { text: r.name }), bt('Zurücknehmen', 'btn-ghost', function () { const p = { month: V.month, sent: false }; if (r.pin) p.pin = r.pin; else p.extraId = r.extraId; vlAct('adminViewMarkSent', p, r.name + ': Eintrag zurückgenommen'); })),
          h('div', { class: 'muted small', text: (r.m.note ? r.m.note + ' · ' : '') + 'eingetragen am ' + DP.fmtDateTime(r.m.ts) }));
      })) : null;
      // Personen der Liste und Zusatzpersonen
      const candidates = D.persons.filter(function (p) { return !p.claimed && !D.extras.some(function (x) { return x.linkedPin === p.pin; }); });
      const normN = function (s) { return String(s || '').toLowerCase().replace(/[^a-zà-ÿ]/g, ''); };
      const extraOnly = D.extras.filter(function (e) { return !(e.linkedPin && e.linkedName && normN(e.name) === normN(e.linkedName)); });
      const exs = extraOnly.map(function (e) {
        let badge, note = null; const acts = h('div', { class: 'row wrap' });
        if (e.sent) { badge = h('span', { class: 'badge success', text: 'gesendet' }); if (e.manual) note = 'von dir eingetragen' + (e.manual.note ? ' (' + e.manual.note + ')' : ''); else if (e.linkedName) note = 'über „' + e.linkedName + '“' + (e.auto ? ', automatisch zugeordnet' : ', von dir bestätigt');
          if (e.auto) acts.append(bt('Passt nicht', 'btn-ghost', function () { vlAct('adminViewExtraLink', { id: e.id, mode: 'reject', pin: e.linkedPin }, 'Zuordnung aufgehoben'); }));
          else if (e.linkedPin) acts.append(bt('Lösen', 'btn-ghost', function () { vlAct('adminViewExtraLink', { id: e.id, mode: 'reset' }, 'Zuordnung gelöst'); })); }
        else if (e.suggestion) { badge = h('span', { class: 'badge warn', text: 'Vorschlag' }); note = '„' + e.suggestion.name + '“ hat gesendet (' + Math.round(e.suggestion.score * 100) + ' % ähnlich). Ist das die Person?';
          acts.append(bt('Ja, ist sie', 'btn-primary', function () { vlAct('adminViewExtraLink', { id: e.id, mode: 'confirm', pin: e.suggestion.pin }, 'Zugeordnet'); }), bt('Nein', 'btn-ghost', function () { vlAct('adminViewExtraLink', { id: e.id, mode: 'reject', pin: e.suggestion.pin }, 'Vorschlag verworfen'); })); }
        else { badge = h('span', { class: 'badge neutral', text: e.linkedPin ? 'wartet (verknüpft)' : 'wartet' }); if (e.linkedName) note = 'verknüpft mit „' + e.linkedName + '“, sobald diese Person sendet, zählt es.'; }
        if (!e.sent && !e.linkedPin && candidates.length) {
          const sel = h('select', { class: 'input vlsel', 'aria-label': 'Mit einer Person im System verknüpfen' }, [h('option', { value: '', text: 'Mit Person im System verknüpfen …' })].concat(candidates.map(function (p) { return h('option', { value: p.pin, text: p.name + (p.sent ? ' (hat gesendet)' : '') }); })));
          sel.addEventListener('change', function () { if (sel.value) vlAct('adminViewExtraLink', { id: e.id, mode: 'confirm', pin: sel.value }, 'Zugeordnet'); });
          acts.append(sel);
        }
        acts.append(bt('Aus Liste nehmen', 'btn-ghost', function () { vlAct('adminViewExtraHide', { id: e.id, hidden: true }, e.name + ' ist aus der Liste genommen'); }), bt('Endgültig löschen', 'btn-ghost', async function () { if (await DP.confirm('Endgültig löschen?', e.name + ' wird samt allen Einträgen für diesen Monat gelöscht. Zum bloßen Ausblenden nimmst du „Aus Liste nehmen“.', 'Löschen', 'danger')) vlAct('adminViewExtraDelete', { id: e.id }, e.name + ' gelöscht'); }));
        return h('div', { class: 'vlrow' }, h('div', { class: 'row between' }, h('strong', { text: e.name }), badge), note ? h('div', { class: 'muted small', text: note }) : null, acts);
      });
      // Aus der Liste genommen
      const hidden = D.hiddenExtras || [];
      const hidDet = hidden.length ? h('details', { class: 'vlex' }) : null;
      if (hidDet) { hidDet.open = !!V.hidOpen; hidDet.addEventListener('toggle', function () { V.hidOpen = hidDet.open; });
        hidDet.append(h('summary', { text: 'Aus der Liste genommen (' + hidden.length + ')' }), h('p', { class: 'muted small', text: 'Diese Personen zählen in diesem Monat nicht, sind aber nicht gelöscht. „Wieder aufnehmen“ holt sie samt allen Einträgen zurück.' }),
          h('div', { class: 'stack-sm' }, hidden.slice().sort(byName).map(function (x) { return h('div', { class: 'vlrow' }, h('div', { class: 'row between' }, h('strong', { text: x.name + (x.linkedName && x.linkedName !== x.name ? ' (' + x.linkedName + ')' : '') }), bt('Wieder aufnehmen', 'btn-secondary', function () { vlAct('adminViewExtraHide', { id: x.id, hidden: false }, x.name + ' ist wieder auf der Liste'); }))); }))); }
      // Eingabe: Person hinzufügen (Entwurf bleibt erhalten)
      const nameIn = h('input', { class: 'input', id: 'vl_name', type: 'text', maxlength: '60', placeholder: 'Name der Person, z. B. Jonas Weber', autocomplete: 'off' });
      nameIn.value = V.draft.name; nameIn.addEventListener('input', function () { V.draft.name = nameIn.value; });
      const addB = bt('Hinzufügen', 'btn-primary', async function () {
        const val = nameIn.value; if (!val.trim()) { nameIn.focus(); return; }
        V.draft.name = ''; nameIn.value = '';
        const r = await vlAct('adminViewExtraAdd', { month: V.month, name: val }, val.trim() + ' steht jetzt bei „Noch offen“');
        if (!r) { V.draft.name = val; vlRender(); }
      });
      nameIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addB.click(); } });
      // Liste einfügen (Entwurf bleibt erhalten, Ergebnis steht dauerhaft da)
      const ta = h('textarea', { class: 'input', id: 'vl_list', rows: '8', placeholder: 'Ein Name pro Zeile, zum Beispiel:\nMax Mustermann\nErika Beispiel' });
      ta.value = V.draft.list; ta.addEventListener('input', function () { V.draft.list = ta.value; });
      const imp = bt('Als Erwartungsliste übernehmen', 'btn-primary', async function () {
        const val = ta.value; if (!val.trim()) { ta.focus(); return; }
        V.draft.list = ''; ta.value = '';
        const r = await vlAct('adminViewListImport', { month: V.month, text: val }, function (r) { return r.added + ' neu übernommen' + (r.restored ? ', ' + r.restored + ' wieder aufgenommen' : '') + (r.existing ? ', ' + r.existing + ' schon vorhanden' : '') + (r.skipped.length ? ', ' + r.skipped.length + ' übersprungen (' + r.skipped.join(', ') + ')' : '') + '. Erwartet wird jetzt nur diese Liste'; });
        if (!r) { V.draft.list = val; vlRender(); }
      });
      const imDet = h('details', { class: 'vlex' }); imDet.open = !!V.imOpen; imDet.addEventListener('toggle', function () { V.imOpen = imDet.open; });
      imDet.append(h('summary', { text: 'Liste für ' + D.label + ' einfügen' }), h('p', { class: 'muted small', text: 'Füge die Namen ein, die in diesem Monat erwartet werden, einen pro Zeile (auch aus Excel kopiert). Das System ordnet sie den Personen im System zu, sobald diese ihre Stunden schicken, auch bei kleinen Schreibabweichungen. Wer nicht auf der Liste steht, fehlt nie, erscheint aber bei „gesendet“, wenn er schickt. Früher aus der Liste genommene Namen werden wieder aufgenommen.' }), ta, h('div', { class: 'row' }, imp));
      // Auswahl per Klick
      const nExp = D.persons.filter(function (p) { return p.expected; }).length;
      const bulk = function (mode, label, okMsg) { return bt(label, 'btn-secondary', function () { vlAct('adminViewExpectBulk', { month: V.month, mode: mode }, function (r) { return okMsg + (r.added !== undefined ? ' (' + r.added + ' Personen)' : ''); }); }); };
      const det = h('details', { class: 'vlex' }); det.open = V.exOpen !== false; det.addEventListener('toggle', function () { V.exOpen = det.open; });
      det.append(h('summary', { text: 'Wer wird in ' + D.label + ' erwartet? ' + nExp + ' von ' + D.persons.length + ' angehakt' }),
        h('p', { class: 'muted small', text: 'Hake an, wer in diesem Monat seine Stunden schicken soll. Wer angehakt ist, steht sofort bei „Noch offen“, bis du ihn als gesendet einträgst oder er schickt. Wer nicht angehakt ist, fehlt nie, erscheint aber bei „gesendet“, sobald er schickt. Abgehakte sind nicht gelöscht, du kannst sie jederzeit wieder anhaken. Jeder Monat hat seine eigene Auswahl.' }),
        h('div', { class: 'row wrap' }, bulk('all', 'Alle auswählen', 'Alle sind angehakt'), bulk('none', 'Niemanden', 'Niemand ist angehakt'), bulk('prev', 'Aus Vormonat übernehmen', 'Auswahl vom Vormonat übernommen')),
        h('div', { class: 'vlpersons' }, D.persons.map(function (p) {
          const cb = h('input', { type: 'checkbox', id: 'vl_p_' + p.pin }); cb.checked = !!p.expected;
          cb.addEventListener('change', function () { vlAct('adminViewPersonExpect', { month: V.month, pin: p.pin, expected: cb.checked }, p.name + (cb.checked ? ' wird erwartet' : ' wird nicht erwartet')); });
          return h('label', { class: 'check', for: 'vl_p_' + p.pin }, cb, h('span', { text: p.name }), p.sent ? h('span', { class: 'badge success', text: 'gesendet' }) : null);
        })));
      const dupBanner = D.duplicates > 0 ? h('div', { class: 'vlwarn' }, h('div', {}, h('strong', { text: D.duplicates + (D.duplicates === 1 ? ' doppelte Zeile' : ' doppelte Zeilen') + ' gefunden. ' }), document.createTextNode('Das sind Reste von früheren Klicks. Sie zählen schon jetzt nur einmal. „Doppelte bereinigen“ löscht sie, Hand-Einträge und Verknüpfungen bleiben erhalten.')), bt('Doppelte bereinigen', 'btn-primary', function () { vlAct('adminViewCleanup', { month: V.month }, function (r) { return r.removed + ' doppelte Zeilen gelöscht'; }); })) : null;
      const sentItems = (D.preview && D.preview.sentItems) || [];
      const sentDet = h('details', { class: 'vlex' });
      sentDet.append(h('summary', { text: 'Gesendet (' + sentItems.length + '): Stunden ansehen und herunterladen' }),
        h('p', { class: 'muted small', text: 'Ein Klick auf „Stunden ansehen“ zeigt die gesendeten Stunden der Person mit Datum, Standort und Zeiten. Dort kannst du sie als CSV herunterladen oder drucken (auch als PDF speichern).' }),
        h('div', { class: 'stack-sm' }, sentItems.slice().sort(byName).map(function (x) {
          const b = bt('Stunden ansehen', 'btn-secondary', function () { if (x.pin) vlHours(x.name, x.pin); else DP.toast(x.name + ': Diese Person ist keiner Person im System zugeordnet, es gibt keine Stunden zum Ansehen.', 'error'); });
          return h('div', { class: 'vlrow' }, h('div', { class: 'row between' }, h('strong', { text: x.name }), h('span', { class: 'row wrap' }, x.ts ? h('span', { class: 'muted small', text: DP.fmtDateTime(x.ts) }) : null, b)));
        })));
      const danger = h('div', { class: 'vldanger' }, h('h4', { text: 'Monat zurücksetzen' }), h('p', { class: 'muted small', text: 'Löscht für ' + D.label + ' alles, was du hier eingestellt hast: Liste, Zusatzpersonen, Haken, Ausnahmen und „als gesendet eingetragen“. Danach ist nichts angehakt, und du hakst neu an. Die Stunden der Mitarbeiter bleiben unberührt, wer schon gesendet hat, zählt weiter als gesendet.' }),
        bt('Monat zurücksetzen', 'btn-secondary', async function () {
          if (!(await DP.confirm('Monat zurücksetzen?', 'Alles, was du für ' + D.label + ' eingestellt hast, wird gelöscht (Liste, Haken, Ausnahmen, Zusatzpersonen, Hand-Einträge). Die gesendeten Stunden bleiben. Das lässt sich nicht rückgängig machen.', 'Zurücksetzen', 'danger'))) return;
          vlAct('adminViewMonthReset', { month: V.month }, function (r) { return D.label + ' zurückgesetzt (' + r.removed + ' Zeilen gelöscht). Jetzt neu anhaken'; });
        }));
      body = h('div', { class: 'stack-sm' }, modeBox, dupBanner, preview,
        h('h4', { text: 'Noch offen (' + openRows.length + ')' }), openList, manualList, sentDet,
        h('h4', { text: 'Weitere Person hinzufügen (noch nicht im System)' }), h('p', { class: 'muted small', text: 'Trage einen Namen ein. Die Person steht sofort bei „Noch offen“, bis du sie als gesendet einträgst oder sie ihre Stunden schickt (nach „Neu hier“ genügt ein ähnlicher Name). Bei unsicheren Treffern fragt dich das System.' }),
        exs.length ? h('div', { class: 'stack-sm' }, exs) : h('p', { class: 'muted small', text: 'Keine weiteren Personen in diesem Monat.' }),
        h('div', { class: 'row' }, nameIn, addB), hidDet, imDet, det, danger);
    }
    const card3 = h('section', { class: 'card stack-sm' }, h('h3', { text: 'Personen pro Monat' }), chips, body);
    return h('div', { class: 'stack' }, status, card1, card2, card3);
  }
  // ---------- Chef-Bericht ----------
  state.cf = { data: null, month: null, pending: 0, msg: null, sel: null, ref: null, err: false, loaded: 0, imp: null, csv: null, copyText: null, mode: 'sum', days: null, draft: { rem: '', remIso: '', remType: 'late', tot: null, totNote: null } };
  let cfChain = Promise.resolve();
  const cfH = function (x) { return x === '' || x == null ? '' : String(Math.round(Number(x) * 100) / 100).replace('.', ','); };
  const cfNum = function (v) { return Number(String(v).replace(',', '.')); };
  const cfDm = function (iso) { return iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.'; };
  const cfCell = function (c) { return c ? (c.ort || '–') + (c.beginn && c.ende ? ' · ' + c.beginn + '–' + c.ende : '') + ' · ' + cfH(c.stunden) + ' Std.' : '–'; };
  const cfShort = function (label) { return label.slice(0, 3) + ' ' + label.slice(-4); };
  function cfEditing() { const a = document.activeElement; return !!(a && a.closest && a.closest('#content') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'file'); }
  function cfHold() { const F = state.cf; return F.pending > 0 || cfEditing() || !!(F.imp && F.imp.busy); }
  function cfRender() {
    const box = document.getElementById('content'); if (!box || state.tab !== 'chef') return;
    document.body.classList.toggle('vlbusy', state.cf.pending > 0);
    const sy = window.scrollY, ae = document.activeElement, aid = ae && ae.id, ss = ae && ae.selectionStart, se = ae && ae.selectionEnd;
    box.replaceChildren(chefView());
    window.scrollTo(0, sy); requestAnimationFrame(function () { window.scrollTo(0, sy); });
    if (aid) { const n = document.getElementById(aid); if (n) { n.focus(); try { if (ss != null) n.setSelectionRange(ss, se); } catch (e) { /* kein Textfeld */ } } }
  }
  function cfApply(r) {
    const F = state.cf;
    if (r.cfg !== undefined && r.months !== undefined) { F.data = r; F.month = r.month; }
    else if (r.cfg !== undefined && F.data) { F.data.cfg = r.cfg; }                                             // Einstellungen: kleine Antwort
    else if (r.pdf !== undefined && F.data && F.data.report && r.month === F.data.report.month) { F.data.report.pdf = r.pdf; }   // Standort-PDF
    else if (r.days !== undefined && r.totals !== undefined) { F.ref = r; if (!F.days || F.days.pin !== r.pin || F.days.month !== r.month) F.days = cfDaysFrom(r); cfPatchPerson(r); }
    F.loaded = Date.now(); F.err = false;
  }
  // Die Personenliste aus der Antwort der Personenseite nachführen, statt den ganzen Bericht neu zu laden
  function cfPatchPerson(r) {
    const R = state.cf.data && state.cf.data.report; if (!R || R.month !== r.month || r.loading) return;
    const p = R.persons.find(function (x) { return x.pin === r.pin; }); if (!p) return;
    p.state = r.state; p.label = r.stateLabel; p.released = r.released; p.total = r.listTotal || 0; p.shown = !!(r.hasBlock || r.hasTotal);
    p.hasRef = !!r.hasRef; p.hasNachtrag = !!r.hasNachtrag; p.manual = !!r.manual; p.sumOnly = !!(r.hasTotal && !r.hasBlock); p.source = r.source || '';
    p.remarkItems = (r.remarks || []).map(function (x) { return { id: x.id, iso: x.iso, text: x.text }; }); p.remarks = p.remarkItems.map(function (x) { return { iso: x.iso, text: x.text }; });
    p.remarkText = p.remarkItems.map(function (x) { return (x.iso ? 'Am ' + cfDm(x.iso) + ' ' : '') + x.text; }).join(' | ');
    p.days = r.hasBlock ? r.days.filter(function (d) { return d.final; }).map(function (d) { return { iso: d.iso, ort: d.final.ort, beginn: d.final.beginn, ende: d.final.ende, stunden: d.final.stunden }; }) : undefined;
    R.counts.released = R.persons.filter(function (x) { return x.released; }).length; R.total = Math.round(R.persons.reduce(function (a, x) { return a + (x.total || 0); }, 0) * 100) / 100;
  }
  // Tage zum Bearbeiten: der Endstand, wenn er vom Admin stammt (oder leer)
  function cfDaysFrom(r) { return { pin: r.pin, month: r.month, rows: r.days.filter(function (d) { return d.final; }).map(function (d) { return { iso: d.iso, ort: d.final.ort, beginn: d.final.beginn, ende: d.final.ende, stunden: d.final.stunden }; }) }; }
  // Welche Mitarbeiter der Chef sieht: aus deiner Liste wählen, einige weglassen oder eine Namensliste einfügen
  function cfPeopleDialog() {
    const F = state.cf, C = F.data.cfg, all = (state.employees || []).filter(function (e) { return e.pin && e.pin !== '00'; }).map(function (e) { return { pin: e.pin, name: e.name }; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    const pick = {}; all.forEach(function (e) { pick[e.pin] = (C.hide || []).indexOf(e.pin) === -1; });
    const info = h('div', { class: 'att-picknote' }), box = h('div', { class: 'att-picklist' }), q = h('input', { class: 'input', type: 'search', placeholder: 'Suchen …', 'aria-label': 'Mitarbeiter suchen' });
    const count = function () { info.textContent = all.filter(function (e) { return pick[e.pin]; }).length + ' von ' + all.length + ' sieht der Chef'; };
    const draw = function () {
      const s = q.value.trim().toLowerCase(); box.textContent = '';
      all.filter(function (e) { return !s || e.name.toLowerCase().indexOf(s) !== -1; }).forEach(function (e) {
        const cb = h('input', { type: 'checkbox', id: 'cfp_' + e.pin }); cb.checked = !!pick[e.pin]; cb.addEventListener('change', function () { pick[e.pin] = cb.checked; count(); });
        box.append(h('label', { class: 'att-pickrow', for: 'cfp_' + e.pin }, cb, h('span', { text: e.name })));
      });
      count();
    };
    const set = function (fn) { all.forEach(function (e) { pick[e.pin] = fn(e); }); draw(); };
    const keyOf = function (s) { return String(s).toLowerCase().replace(/[.,;:()]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).sort().join(' '); };   // „Nachname Vorname“ zählt wie „Vorname Nachname“
    const txt = h('textarea', { class: 'input', id: 'cfp_txt', rows: '5', placeholder: 'Eine Namensliste einfügen, ein Name pro Zeile' });
    const res = h('div', { class: 'muted small' });
    const apply = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Liste übernehmen' });
    apply.addEventListener('click', function () {
      const lines = txt.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); if (!lines.length) { DP.toast('Bitte zuerst eine Liste einfügen.', 'error'); return; }
      const byKey = {}; all.forEach(function (e) { byKey[keyOf(e.name)] = e; });
      const hit = {}, miss = []; lines.forEach(function (l) { const e = byKey[keyOf(l)]; if (e) hit[e.pin] = true; else miss.push(l); });
      set(function (e) { return !!hit[e.pin]; });
      res.textContent = Object.keys(hit).length + ' Namen gefunden und angehakt, alle anderen sind abgehakt.' + (miss.length ? ' Nicht im System: ' + miss.join(', ') + ' (sie können nicht angezeigt werden).' : '');
    });
    q.addEventListener('input', draw); draw();
    DP.modal({ title: 'Mitarbeiter für den Chef', wide: true, body: h('div', { class: 'stack-sm' },
      h('p', { class: 'muted small', text: 'Hake an, wen der Chef sehen soll. Wer abgehakt ist, fehlt in seiner Liste und in seiner Summe. Du siehst weiter alle, mit dem Hinweis „für Chef weg“.' }),
      h('div', { class: 'row wrap' }, q, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Alle', onclick: function () { set(function () { return true; }); } }), h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Keine', onclick: function () { set(function () { return false; }); } })), info, box,
      field('Oder die aktuelle Mitarbeiterliste einfügen', txt, 'cfp_txt'), h('div', { class: 'row wrap' }, apply), res),
      actions: [{ label: 'Abbrechen' }, { label: 'Speichern', kind: 'primary', closes: false, onClick: async function (api) {
        const hidePins = all.filter(function (e) { return !pick[e.pin]; }).map(function (e) { return e.pin; });
        const r = await cfAct('adminChefSet', { hidePins: hidePins, viewMonth: F.month }, hidePins.length ? 'Der Chef sieht jetzt ' + (all.length - hidePins.length) + ' von ' + all.length + ' Mitarbeitern' : 'Der Chef sieht alle Mitarbeiter');
        if (r) { api.close(); await cfReload(true); cfRender(); }   // Personenliste neu laden, damit „für Chef weg“ gleich stimmt
      } }] });
  }
  async function cfReload(silent) {
    const F = state.cf, r = await adm('adminChefGet', F.month ? { month: F.month } : {});
    if (r.status !== 'success') { if (!silent) F.err = true; return false; }
    cfApply(r);
    if (F.sel) { const x = await adm('adminRefGet', { month: F.data.month, pin: F.sel }); if (x.status === 'success') { F.days = null; cfApply(x); } }
    return true;
  }
  async function loadChef() { return cfReload(false); }
  function cfAct(action, payload, okMsg, keepDays) {
    const F = state.cf; F.pending++; document.body.classList.add('vlbusy');
    const run = async function () {
      const r = await adm(action, payload); F.pending--;
      if (r.status === 'success') {
        if (r.days !== undefined && !keepDays) F.days = null;
        cfApply(r);
        const txt = typeof okMsg === 'function' ? okMsg(r) : okMsg; if (txt) { F.msg = { kind: 'ok', text: txt }; DP.toast(txt); }
        if (F.pending === 0) cfRender();
        return r;
      }
      if (r.code !== 'ADMIN_AUTH') { const t = r.code === 'NETWORK' ? 'Keine Verbindung. Das wurde NICHT gespeichert.' : (r.message || 'Das hat nicht geklappt.'); F.msg = { kind: 'err', text: t }; DP.toast(t, 'error'); }
      if (F.pending === 0) { await cfReload(true); cfRender(); }
      return null;
    };
    const p = cfChain.then(run, run); cfChain = p.catch(function () { /* Kette läuft weiter */ }); return p;
  }
  async function cfSelectMonth(m) { const F = state.cf; F.month = m; F.sel = null; F.ref = null; F.days = null; await cfReload(true); cfRender(); }
  function cfProvisional(R, p) {
    const hasBlock = p.source === 'mitarbeiter' || p.source === 'admin';
    return { status: 'success', loading: true, month: R.month, label: R.label, pin: p.pin, name: p.name, hasBlock: hasBlock, source: p.source, released: p.released, state: p.state, stateLabel: p.label, hasNachtrag: !!p.hasNachtrag, manual: !!p.manual, hasTotal: !!p.sumOnly, totalHours: p.sumOnly ? p.total : '', totalNote: '', hasRef: !!p.hasRef, listTotal: p.total,
      days: (p.days || []).map(function (d) { return { iso: d.iso, sent: null, ref: null, diffSR: null, diffFR: null, same: false, final: { ort: d.ort, beginn: d.beginn, ende: d.ende, stunden: d.stunden } }; }), totals: { sent: 0, ref: 0, final: p.total }, remarks: p.remarkItems || [] };
  }
  async function cfOpenPerson(pin) {
    const F = state.cf, R = F.data && F.data.report, p = R && R.persons.find(function (x) { return x.pin === pin; }); if (!p) return;
    F.sel = pin; F.days = null; F.draft.tot = null; F.draft.totNote = null; F.mode = p.sumOnly ? 'sum' : (p.source === 'admin' ? 'days' : 'sum');
    F.ref = cfProvisional(R, p); F.days = cfDaysFrom(F.ref); pushTabState('chef'); cfRender(); window.scrollTo(0, 0);   // sofort sichtbar
    const x = await adm('adminRefGet', { month: R.month, pin: pin });                                                   // Vergleich und Details im Hintergrund
    if (F.sel !== pin) return;
    if (x.status !== 'success') { F.ref.loading = false; DP.toast(x.message || 'Der Vergleich konnte nicht geladen werden.', 'error'); cfRender(); return; }
    F.days = null; cfApply(x); cfRender();
  }
  function cfClosePerson() { const F = state.cf; F.sel = null; F.ref = null; F.days = null; cfRender(); window.scrollTo(0, 0); }
  function cfB64(file) { return new Promise(function (res, rej) { const r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1] || ''); }; r.onerror = function () { rej(new Error('Nicht lesbar')); }; r.readAsDataURL(file); }); }

  // ---------- PDFs einlesen ----------
  async function cfImportRun(files) {
    const F = state.cf; F.imp = { busy: true, msg: 'Lese …', items: null, roster: [] }; cfRender();
    const out = [];
    try {
      for (let i = 0; i < files.length; i++) {
        F.imp.msg = 'Lese Datei ' + (i + 1) + ' von ' + files.length + ': ' + files[i].name; cfRender();
        try { out.push({ file: files[i], x: await DP.pdfExtract(files[i]) }); } catch (e) { out.push({ file: files[i], x: { name: files[i].name, pages: [] }, error: e && e.message ? e.message : 'Nicht lesbar' }); }
      }
      F.imp.msg = 'Prüfe …'; cfRender();
      const ok = out.filter(function (o) { return !o.error; }).map(function (o) { return o.x; });
      const r = ok.length ? await adm('adminPdfAnalyze', { files: ok }) : { status: 'success', items: [], roster: [] };
      if (r.status !== 'success') { F.imp = { busy: false, msg: '', error: r.code === 'NETWORK' ? 'Keine Verbindung.' : (r.message || 'Das hat nicht geklappt.'), items: null, roster: [] }; cfRender(); return; }
      const items = []; let k = 0;
      out.forEach(function (o) { if (o.error) items.push({ kind: 'unbekannt', file: o.file.name, warnings: ['Die Datei konnte nicht gelesen werden: ' + o.error], ready: false }); else { const it = r.items[k++]; it._file = o.file; items.push(it); } });
      items.forEach(function (it) { it._on = !!it.ready && (it.kind !== 'nachweis' || !!it.pin); it._pin = it.pin || ''; it._month = it.month || F.month; (it.persons || []).forEach(function (p) { p._pin = p.pin || ''; p._on = !!p.pin; }); });
      F.imp = { busy: false, msg: '', items: items, roster: r.roster };
    } catch (e) { F.imp = { busy: false, msg: '', error: 'Das PDF-Lesen hat nicht geklappt. Bitte die Seite neu laden (Strg+Shift+R).', items: null, roster: [] }; }
    cfRender();
  }
  async function cfImportApply() {
    const F = state.cf, I = F.imp, payload = [], pdfs = [];
    I.items.forEach(function (it) {
      if (it.kind === 'nachweis' && it._on && it._pin) payload.push({ kind: 'nachweis', month: it.month, pin: it._pin, person: it.person, rows: it.rows, remarks: it.remarks });
      else if (it.kind === 'zusammenfassung') { const ps = it.persons.filter(function (p) { return p._on && p._pin; }).map(function (p) { return { pin: p._pin, remarks: p.remarks }; }); if (ps.length) payload.push({ kind: 'zusammenfassung', month: it.month, persons: ps }); }
      else if (it.kind === 'standorte' && it._on) pdfs.push(it);
    });
    if (!payload.length && !pdfs.length) { DP.toast('Es ist nichts ausgewählt.', 'error'); return; }
    F.imp = null; let sum = [];
    if (payload.length) { const r = await cfAct('adminPdfApply', { items: payload, month: F.month }, function (x) { return 'Übernommen: ' + x.result.reference + ' Stundennachweis(e), ' + x.result.remarks + ' Anmerkung(en)' + (x.result.skipped.length ? ' · übersprungen: ' + x.result.skipped.join('; ') : ''); }); if (r) sum.push('Nachweise'); }
    for (let i = 0; i < pdfs.length; i++) {
      const it = pdfs[i];
      if (it._file.size > 1000000) { DP.toast('Die Standort-Übersicht ist größer als 1 MB.', 'error'); continue; }
      let b64 = ''; try { b64 = await cfB64(it._file); } catch (e) { DP.toast('Die Datei konnte nicht gelesen werden.', 'error'); continue; }
      await cfAct('adminReportPdfSave', { month: it._month, kind: 'standorte', name: it.file, data: b64 }, 'Standort-Übersicht für ' + (F.data.months.find(function (m) { return m.month === it._month; }) || { label: it._month }).label + ' gespeichert, der Chef kann sie ansehen und laden');
    }
  }
  function cfImportCard(bt) {
    const F = state.cf, I = F.imp, D = F.data, card = h('section', { class: 'card cfc stack-sm', id: 'cf_imp' });
    card.append(h('div', { class: 'cfh', text: 'PDFs einlesen' }), h('p', { class: 'muted small', text: 'Stundennachweise, Zusammenfassung und Standort-Übersicht. Alles wird nur in deinem Browser gelesen, zum Server geht nur der erkannte Text. Vor dem Übernehmen siehst du eine Vorschau.' }));
    const inp = h('input', { type: 'file', id: 'cf_pdf', accept: 'application/pdf,.pdf', multiple: 'multiple', 'aria-label': 'PDF-Dateien auswählen' }); inp.style.display = 'none';
    inp.addEventListener('change', function () { const fl = Array.from(inp.files || []); if (fl.length) cfImportRun(fl.slice(0, 40)); });
    const drop = h('button', { type: 'button', class: 'cfdrop', text: 'PDFs hierher ziehen oder auswählen' }); drop.addEventListener('click', function () { inp.click(); });
    ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('on'); }); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('on'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('on'); const fl = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter(function (f) { return /pdf$/i.test(f.name); }); if (fl.length) cfImportRun(fl.slice(0, 40)); });
    card.append(inp, drop);
    if (I && I.busy) card.append(h('p', { class: 'small', id: 'cf_impmsg', text: I.msg }));
    if (I && I.error) card.append(alertBox('error', I.error));
    if (I && I.items) {
      const roster = I.roster.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
      const sel = function (cur, onChange) { const s = h('select', { class: 'input cfin' }, [h('option', { value: '', text: '– Person wählen –' })].concat(roster.map(function (r) { return h('option', { value: r.pin, text: r.name }); }))); s.value = cur || ''; s.addEventListener('change', function () { onChange(s.value); }); return s; };
      const chk = function (on, fn, label) { const cb = h('input', { type: 'checkbox' }); cb.checked = !!on; cb.addEventListener('change', function () { fn(cb.checked); }); return h('label', { class: 'check' }, cb, h('span', { text: label || 'Übernehmen' })); };
      const warn = function (a) { return a && a.length ? h('ul', { class: 'small cfwarn' }, a.map(function (w) { return h('li', { text: w }); })) : null; };
      const lbl = function (m) { return m ? (D.months.find(function (x) { return x.month === m; }) || { label: m }).label : 'Monat unbekannt'; };
      I.items.forEach(function (it) {
        const box = h('div', { class: 'cfimp' });
        const kindTxt = it.kind === 'nachweis' ? 'Stundennachweis' : it.kind === 'zusammenfassung' ? 'Zusammenfassung' : it.kind === 'standorte' ? 'Standort-Übersicht' : 'Nicht erkannt';
        box.append(h('div', { class: 'row between' }, h('strong', { class: 'cfname', text: it.file }), h('span', { class: 'badge ' + (it.ready ? 'success' : 'danger'), text: kindTxt + (it.month ? ' · ' + lbl(it.month) : '') })));
        if (it.kind === 'nachweis') {
          box.append(h('div', { class: 'row wrap' }, h('span', { class: 'small muted', text: 'Im PDF: „' + it.person + '“ →' }), sel(it._pin, function (v) { it._pin = v; it._on = !!v && it.ready; cfRender(); })));
          box.append(h('p', { class: 'small', text: it.rows.length + ' Arbeitstage · ' + cfH(it.total) + ' Std.' + (it.stated !== '' && it.stated != null ? ' (Summe im PDF: ' + cfH(it.stated) + ')' : '') + (it.corrected ? ' · ' + it.corrected + ' von dir korrigiert (*)' : '') + (it.noWork ? ' · ' + it.noWork + ' ohne Einsatz' : '') + (it.remarks && it.remarks.length ? ' · ' + it.remarks.length + ' Bemerkung(en)' : '') }));
          const det = h('details', { class: 'cfdet' }); det.append(h('summary', { text: 'Tage ansehen' }), h('div', { class: 'vlscroll' }, h('table', { class: 'cft' }, h('tbody', {}, it.rows.map(function (r) { return h('tr', {}, h('td', { text: cfDm(r.iso) }), h('td', { text: r.ort }), h('td', { text: r.beginn && r.ende ? r.beginn + '–' + r.ende : '' }), h('td', { class: 'r', text: cfH(r.stunden) + (r.star ? ' *' : '') })); })))));
          if (it.rows.length) box.append(det);
          if (it.remarks && it.remarks.length) box.append(h('div', { class: 'small cfrem', text: it.remarks.map(function (x) { return (x.iso ? 'Am ' + cfDm(x.iso) + ' ' : '') + x.text; }).join(' | ') }));
        } else if (it.kind === 'zusammenfassung') {
          it.persons.forEach(function (p) {
            const row = h('div', { class: 'cfprow' }); row.append(h('div', { class: 'row between wrap' }, h('span', { class: 'row wrap' }, h('strong', { text: p.name }), h('span', { class: 'muted small', text: p.hours !== '' ? cfH(p.hours) + ' Std.' : '' })), h('span', { class: 'row wrap' }, sel(p._pin, function (v) { p._pin = v; p._on = !!v; cfRender(); }), chk(p._on, function (v) { p._on = v && !!p._pin; if (v && !p._pin) cfRender(); }))));
            if (p.remarks.length) row.append(h('div', { class: 'small cfrem', text: p.remarks.map(function (x) { return (x.iso ? 'Am ' + cfDm(x.iso) + ' ' : '') + x.text; }).join(' | ') }));
            const w = warn(p.warnings); if (w) row.append(w); box.append(row);
          });
          box.append(h('p', { class: 'muted small', text: 'Übernommen werden die Bemerkungen als Anmerkungen für den Chef (gleiche werden nicht doppelt angelegt).' }));
        } else if (it.kind === 'standorte') {
          const ms = h('select', { class: 'input cfin' }, D.months.map(function (m) { return h('option', { value: m.month, text: m.label }); })); ms.value = it._month; ms.addEventListener('change', function () { it._month = ms.value; cfRender(); });
          box.append(h('div', { class: 'row wrap' }, h('span', { class: 'small muted', text: 'Für den Chef bereitstellen im Monat:' }), ms));
          box.append(h('p', { class: 'muted small', text: 'Die Datei wird so, wie sie ist, für den Chef sichtbar und zum Herunterladen gespeichert.' + (D.report && D.report.month === it._month && D.report.pdf && D.report.pdf.standorte ? ' Ersetzt „' + D.report.pdf.standorte.name + '“.' : '') }));
        }
        const w0 = warn(it.warnings); if (w0) box.append(w0);
        if (it.kind === 'nachweis' || it.kind === 'standorte') box.append(chk(it._on, function (v) { it._on = v && it.ready && (it.kind !== 'nachweis' || !!it._pin); if (v && !it._on) DP.toast('Bitte zuerst eine Person wählen.', 'error'); cfRender(); }));
        card.append(box);
      });
      const n = I.items.reduce(function (a, it) { return a + (it.kind === 'zusammenfassung' ? (it.persons.some(function (p) { return p._on; }) ? 1 : 0) : (it._on ? 1 : 0)); }, 0);
      card.append(h('div', { class: 'row wrap' }, bt('Ausgewählte übernehmen (' + n + ')', 'btn-primary', cfImportApply), bt('Verwerfen', 'btn-ghost', function () { F.imp = null; cfRender(); })));
    }
    const sp = D.report && D.report.pdf && D.report.pdf.standorte;
    card.append(h('div', { class: 'cfpdf' }, h('span', { class: 'small', text: 'Standort-Übersicht ' + D.report.label + ': ' }), sp ? h('strong', { class: 'small', text: sp.name }) : h('span', { class: 'small muted', text: 'noch keine Datei' }), sp ? bt('Entfernen', 'btn-ghost', async function () { if (await DP.confirm('Standort-Übersicht entfernen?', 'Der Chef sieht sie danach nicht mehr.', 'Entfernen', 'danger')) cfAct('adminReportPdfDelete', { month: D.report.month, kind: 'standorte' }, 'Standort-Übersicht entfernt'); }) : null));
    return card;
  }
  // ---------- Basics: CSV, Säumige ----------
  function cfCsv(R) {
    const q = function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }, rows = [['Name', 'Status', 'Datum', 'Einsatzort', 'Beginn', 'Ende', 'Stunden']];
    R.persons.forEach(function (p) {
      if (p.days && p.days.length) p.days.forEach(function (d) { rows.push([p.name, p.label, d.iso.slice(8, 10) + '.' + d.iso.slice(5, 7) + '.' + d.iso.slice(0, 4), d.ort, d.beginn, d.ende, cfH(d.stunden)]); });
      else rows.push([p.name, p.label, '', '', '', '', p.total ? cfH(p.total) : '']);
    });
    const name = 'Stunden_' + R.month + '.csv', url = vlDownload(name, rows.map(function (r) { return r.map(q).join(';'); }).join('\r\n'));
    state.cf.csv = { url: url, name: name }; DP.toast('Heruntergeladen: ' + name); cfRender();
  }
  async function cfMissing(R) {
    const names = R.persons.filter(function (p) { return p.state === 'none' || p.state === 'admin_open' || p.state === 'manual'; }).map(function (p) { return p.name; });
    if (!names.length) { DP.toast('Es fehlt niemand.'); return; }
    const txt = 'Für ' + R.label + ' fehlen noch die Stunden von:\n' + names.map(function (n) { return '- ' + n; }).join('\n');
    try { await navigator.clipboard.writeText(txt); DP.toast(names.length + ' Name(n) kopiert'); state.cf.copyText = null; } catch (e) { state.cf.copyText = txt; }
    cfRender();
  }
  // ---------- Hauptansicht ----------
  function chefView() {
    setTitle('Chef-Bericht');
    const F = state.cf, D = F.data;
    const bt = function (label, cls, fn) { const b = h('button', { type: 'button', class: 'btn btn-sm ' + cls, text: label }); b.addEventListener('click', fn); return b; };
    if (!D) return h('div', {}, F.err ? alertBox('error', 'Der Chef-Bericht konnte nicht geladen werden. Bitte oben auf „Aktualisieren“ klicken.') : h('span', { class: 'spinner' }));
    const R = D.report, status = h('div', { id: 'cf_status', class: 'vlstatus' + (F.pending > 0 ? ' busy' : (F.msg ? ' ' + F.msg.kind : '')), role: 'status' });
    status.textContent = F.pending > 0 ? 'Speichere … (' + F.pending + ')' : (F.msg ? (F.msg.kind === 'ok' ? '✔ ' : '✖ ') + F.msg.text : '');
    if (F.sel && F.ref && F.ref.pin === F.sel) return h('div', { class: 'stack' }, status, cfPersonView(F.ref, bt));
    const C = D.cfg;
    const chk = function (id, label, on, fn) { const cb = h('input', { type: 'checkbox', id: id }); cb.checked = !!on; cb.addEventListener('change', function () { fn(cb.checked); }); return h('label', { class: 'check', for: id }, cb, h('span', { text: label })); };
    const sw = h('label', { class: 'cfsw', for: 'cf_en' }); const swi = h('input', { type: 'checkbox', id: 'cf_en' }); swi.checked = C.enabled; swi.addEventListener('change', function () { cfAct('adminChefSet', { enabled: swi.checked, viewMonth: F.month }, swi.checked ? 'Chef-Ansicht eingeschaltet' : 'Chef-Ansicht ausgeschaltet'); }); sw.append(swi, h('span', { class: 'cfsl' }), h('span', { text: C.enabled ? 'aktiv' : 'aus' }));
    const pwIn = h('input', { class: 'input', id: 'cf_pw', type: 'text', autocomplete: 'off', placeholder: C.hasPw ? 'Neues Passwort (zum Ändern)' : 'Passwort, mindestens 6 Zeichen' });
    const alsoCb = h('input', { type: 'checkbox', id: 'cf_view' }); alsoCb.checked = F.alsoView !== false; alsoCb.addEventListener('change', function () { F.alsoView = alsoCb.checked; });
    const chips = h('div', { class: 'cfchips' }, D.months.map(function (m) { const on = C.months.indexOf(m.month) !== -1, b = h('button', { type: 'button', class: 'cfmon' + (on ? ' on' : ''), text: (on ? '✓ ' : '') + cfShort(m.label), title: m.label + (on ? ': freigegeben, tippen zum Zurücknehmen' : ': tippen zum Freigeben'), 'aria-pressed': on ? 'true' : 'false' }); b.addEventListener('click', function () { cfAct('adminChefSet', { releaseMonth: { month: m.month, on: !on, view: !on && alsoCb.checked }, viewMonth: F.month }, on ? m.label + ' ist für den Chef nicht mehr sichtbar' : m.label + ' ist für den Chef freigegeben' + (alsoCb.checked ? ' und steht auf der Übersichtsseite' : '')); }); return b; }));
    const card1 = h('section', { class: 'card cfc stack-sm' }, h('div', { class: 'row between' }, h('div', { class: 'cfh', text: 'Chef-Ansicht' }), sw),
      h('p', { class: 'muted small', text: 'Der Chef öffnet den Übersichtslink, tippt auf „Chef-Ansicht“ und gibt das Passwort ein. Jeder Zugriff erscheint in der Glocke.' }),
      h('div', { class: 'row' }, pwIn, bt(C.hasPw ? 'Ändern' : 'Setzen', 'btn-secondary', function () { const v = pwIn.value; if (!v) { pwIn.focus(); return; } pwIn.value = ''; cfAct('adminChefSet', { password: v, viewMonth: F.month }, 'Passwort gesetzt'); })),
      h('div', { class: 'cfh2', text: 'Für den Chef freigegebene Monate' }), chips,
      h('label', { class: 'check', for: 'cf_view' }, alsoCb, h('span', { text: 'Beim Freigeben den Monat auch auf der Übersichtsseite zeigen' })),
      h('p', { class: 'muted small', text: C.months.length ? 'Der Chef kann zwischen diesen ' + C.months.length + ' Monat(en) wählen.' : 'Noch kein Monat freigegeben, der Chef sieht nichts.' }),
      h('div', { class: 'cfh2', text: 'Mitarbeiter für den Chef' }),
      h('div', { class: 'row between wrap' }, h('span', { class: 'muted small', text: (C.hide && C.hide.length ? C.hide.length + ' Mitarbeiter sind für den Chef weggelassen.' : 'Der Chef sieht alle Mitarbeiter.') }), bt('Liste bearbeiten …', 'btn-secondary', cfPeopleDialog)),
      h('div', { class: 'cfh2', text: 'Was der Chef sehen darf' }),
      h('div', { class: 'cfperm' },
        chk('cf_s1', 'Liste (Zusammenfassung)', C.sections.summary, function (v) { cfAct('adminChefSet', { sections: { summary: v }, viewMonth: F.month }, 'Gespeichert'); }),
        chk('cf_s2', 'Einzelseite pro Mitarbeiter (Tag für Tag)', C.sections.persons, function (v) { cfAct('adminChefSet', { sections: { persons: v }, viewMonth: F.month }, 'Gespeichert'); }),
        chk('cf_s3', 'Standort-Übersicht (PDF)', C.sections.locations, function (v) { cfAct('adminChefSet', { sections: { locations: v }, viewMonth: F.month }, 'Gespeichert'); }),
        chk('cf_h1', 'Anmerkungen vom Admin', C.show.remarks, function (v) { cfAct('adminChefSet', { show: { remarks: v }, viewMonth: F.month }, 'Gespeichert'); }),
        chk('cf_h6', 'Bemerkungen der Mitarbeiter', C.show.empNotes, function (v) { cfAct('adminChefSet', { show: { empNotes: v }, viewMonth: F.month }, 'Gespeichert'); }),
        chk('cf_h2', 'Arbeitszeiten', C.show.times, function (v) { cfAct('adminChefSet', { show: { times: v }, viewMonth: F.month }, 'Gespeichert'); }),
        chk('cf_h3', 'Einsatzorte', C.show.places, function (v) { cfAct('adminChefSet', { show: { places: v }, viewMonth: F.month }, 'Gespeichert'); }),
        chk('cf_h4', 'Nicht freigegebene Personen', C.show.unreleased, function (v) { cfAct('adminChefSet', { show: { unreleased: v }, viewMonth: F.month }, v ? 'Nicht freigegebene werden mit Kennzeichnung gezeigt' : 'Nicht freigegebene werden nur mit Status gezeigt'); }),
        chk('cf_h5', 'Drucken / PDF', C.show.print, function (v) { cfAct('adminChefSet', { show: { print: v }, viewMonth: F.month }, 'Gespeichert'); })));
    // Personen
    const mSel = h('select', { class: 'input cfin', id: 'cf_pmonth', 'aria-label': 'Monat' }, D.months.map(function (m) { return h('option', { value: m.month, text: m.label }); })); mSel.value = R.month; mSel.addEventListener('change', function () { cfSelectMonth(mSel.value); });
    const closedAt = C.closed[R.month];
    const SHORT = { released: 'Freigegeben', sent_open: 'Gesendet · prüfen', admin_open: 'Von mir erfasst · offen', admin_released: 'Von mir erfasst · frei', sum_open: 'Summe · offen', sum_released: 'Summe · frei', manual: 'Gemeldet · Stunden fehlen', none: 'Keine Stunden' };
    const pill = function (p) { if (p.hiddenForChef) return h('span', { class: 'cfpill no', title: 'Der Chef sieht diese Person nicht', text: 'für Chef weg' }); const cls = p.released ? 'ok' : (p.state === 'none' ? 'no' : (p.state === 'admin_open' || p.state === 'sum_open' ? 'info' : 'wait')); return h('span', { class: 'cfpill ' + cls, title: p.label, text: SHORT[p.state] || p.label }); };
    const tbody = h('tbody', {}, R.persons.map(function (p) {
      const tr = h('tr', { class: 'cftr' }); if (p.pin) { tr.tabIndex = 0; tr.setAttribute('role', 'button'); tr.addEventListener('click', function () { cfOpenPerson(p.pin); }); tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') cfOpenPerson(p.pin); }); }
      tr.append(h('td', {}, h('strong', { text: p.name })), h('td', {}, pill(p)), h('td', { class: 'r', text: p.shown || p.total ? cfH(p.total) : '–' }),
        h('td', { class: 'cfhints' }, p.manual ? h('span', { class: 'badge warn', text: 'Stunden fehlen' }) : null, p.hasRef ? h('span', { class: 'badge neutral', text: 'Unterlagen' }) : null, p.hasNachtrag ? h('span', { class: 'badge warn', text: 'Mitarbeiter hat gesendet' }) : null, p.remarkItems && p.remarkItems.length ? h('span', { class: 'badge neutral', text: p.remarkItems.length + ' Anm.' }) : null),
        h('td', { class: 'r' }, p.pin ? h('span', { class: 'cfgo', text: 'Öffnen ›' }) : null));
      return tr;
    }));
    const extra = h('div', { class: 'row wrap' }, bt('CSV exportieren', 'btn-ghost', function () { cfCsv(R); }), bt('Säumige kopieren', 'btn-ghost', function () { cfMissing(R); }), closedAt ? h('span', { class: 'badge success', text: 'abgeschlossen am ' + DP.fmtDateTime(closedAt) }) : null,
      bt(closedAt ? 'Monat öffnen' : 'Monat abschließen', 'btn-ghost', function () { cfAct('adminChefClose', { month: R.month, closed: !closedAt }, closedAt ? R.label + ' ist wieder offen' : R.label + ' ist abgeschlossen. Später gesendete Stunden ändern den Endstand nicht mehr'); }));
    const card3 = h('section', { class: 'card cfc stack-sm' }, h('div', { class: 'row between wrap' }, h('div', { class: 'cfh', text: 'Personen und Status' }), mSel),
      h('div', { class: 'cfkpi' }, h('div', {}, h('b', { text: R.counts.released + ' / ' + R.counts.total }), h('small', { text: 'freigegeben' })), h('div', {}, h('b', { text: cfH(R.total) }), h('small', { text: 'Stunden gesamt' })), h('div', {}, h('b', { text: String(R.persons.filter(function (p) { return p.manual || p.state === 'none'; }).length) }), h('small', { text: 'ohne Stunden' }))), extra,
      F.csv ? h('p', { class: 'small' }, document.createTextNode('✔ Datei erstellt. Startet der Download nicht von selbst: '), h('a', { href: F.csv.url, download: F.csv.name, text: 'Datei speichern' }), document.createTextNode(' (' + F.csv.name + ').')) : null,
      F.copyText ? h('textarea', { class: 'input', rows: '5', readonly: 'readonly', id: 'cf_copy', text: F.copyText }) : null,
      h('div', { class: 'vlscroll cftw' }, h('table', { class: 'cft cftp' }, h('thead', {}, h('tr', {}, ['Name', 'Status', 'Std.', 'Hinweise', ''].map(function (t, i) { return h('th', { class: i === 2 || i === 4 ? 'r' : '', text: t }); }))), tbody)));
    return h('div', { class: 'stack' }, status, h('div', { class: 'cfgrid' }, card1, cfImportCard(bt)), card3);
  }
  // ---------- Eine Person: Stunden von Hand, Vergleich, Anmerkungen ----------
  const CF_REM = [
    { k: 'late', label: 'Zu spät (Minuten)', input: 'number', ph: 'Minuten', build: function (v) { const m = Math.round(cfNum(v)); if (!(m > 0)) return ''; const hh = Math.floor(m / 60), mm = m % 60; return (hh ? hh + ' Std. ' : '') + (mm ? mm + ' min ' : '') + 'zu spät'; } },
    { k: 'noreg', label: 'Nicht angemeldet', build: function () { return 'nicht angemeldet'; } },
    { k: 'noregc', label: 'Nicht angemeldet – kritisch', build: function () { return 'nicht angemeldet! kritisch'; } },
    { k: 'nologin', label: 'Ohne Anmeldung – sehr kritisch', build: function () { return 'ohne Anmeldung!! Sehr kritisch'; } },
    { k: 'start', label: 'Später angefangen (Uhrzeit)', input: 'time', build: function (v) { return v ? 'hat um ' + v + ' Uhr angefangen' : ''; } },
    { k: 'stay', label: 'Weiter in … gearbeitet', input: 'text', ph: 'Ort', build: function (v) { return v.trim() ? 'weiter in ' + v.trim() + ' gearbeitet' : ''; } },
    { k: 'free', label: 'Freitext', input: 'text', ph: 'Text', build: function (v) { return v.replace(/\r\n?/g, '\n').trim(); } }];
  function cfCalcH(b, e) { if (!/^\d{2}:\d{2}$/.test(b) || !/^\d{2}:\d{2}$/.test(e)) return ''; const bm = +b.slice(0, 2) * 60 + +b.slice(3), em0 = +e.slice(0, 2) * 60 + +e.slice(3), em = em0 <= bm ? em0 + 1440 : em0; return Math.round((em - bm) / 60 * 100) / 100; }
  function cfPlaceGroups(days) { const m = {}; (days || []).forEach(function (d) { const k = d.ort || '–', g = m[k] || (m[k] = { ort: k, days: 0, hours: 0 }); g.days++; g.hours += Number(d.stunden) || 0; }); return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.hours - a.hours; }); }
  const CF_COL = ['#D6336C', '#2F9E8F', '#E8A33D', '#3D3A87', '#2557C4', '#0F7A55', '#BF2F23', '#7048E8'];
  function cfColor(s) { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return CF_COL[x % CF_COL.length]; }
  function cfInitials(s) { const w = String(s).split(/[\s\/]+/).filter(Boolean); return (w.length > 1 ? w.map(function (x) { return x[0]; }).join('') : (w[0] || '?').slice(0, 1)).toUpperCase().slice(0, 2); }
  function cfPlacesCard(days) {
    const g = cfPlaceGroups(days); if (!g.length) return null;
    return h('section', { class: 'card cfc stack-sm' }, h('div', { class: 'cfh', text: 'Stunden nach Standort' }), h('div', { class: 'cfplaces' }, g.map(function (x) { const ic = h('span', { class: 'cfpi', text: cfInitials(x.ort) }); ic.style.background = cfColor(x.ort); return h('div', { class: 'cfplace' }, ic, h('div', { class: 'cfpn' }, h('strong', { text: x.ort }), h('small', { text: x.days + (x.days === 1 ? ' Tag' : ' Tage') })), h('b', { text: cfH(Math.round(x.hours * 100) / 100) + ' Std.' })); })));
  }
  function cfPersonView(P, bt) {
    const F = state.cf, D = F.data, month = P.month, dim = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate(), wrap = h('div', { class: 'cfp stack' });
    const ok = P.state === 'released' || P.state === 'admin_released' || P.state === 'sum_released';
    const canRelease = P.hasBlock || P.hasTotal;
    wrap.append(h('div', { class: 'cfphead' }, bt('‹ Zurück', 'btn-ghost', function () { if (history.state && history.state.dpTab === 'chef') history.back(); else cfClosePerson(); }),
      h('div', { class: 'cfpt' }, h('strong', { text: P.name }), h('span', { class: 'cfpill ' + (ok ? 'ok' : (P.state === 'none' ? 'no' : (P.state === 'admin_open' || P.state === 'sum_open' ? 'info' : 'wait'))), text: P.stateLabel }), h('span', { class: 'muted small', text: P.label })),
      canRelease ? bt(P.released ? 'Freigabe zurücknehmen' : 'Freigeben', P.released ? 'btn-secondary' : 'btn-primary', function () { cfAct('adminChefRelease', { month: month, pin: P.pin, value: !P.released }, P.released ? 'Freigabe zurückgenommen' : P.name + ' ist freigegeben', true); }) : h('span', { class: 'muted small', text: 'Freigabe möglich, sobald Stunden da sind' })));
    // 1) Stunden von Hand
    const emp = P.hasBlock && P.source === 'mitarbeiter', sec1 = h('section', { class: 'card cfc stack-sm' }, h('div', { class: 'cfh', text: 'Stunden von Hand eintragen' }));
    if (P.manual) sec1.append(h('p', { class: 'cfnote', text: P.name + ' ist als gesendet eingetragen, aber es sind noch keine Stunden hinterlegt. Trage unten die Summe oder die Tage ein.' }));
    if (emp) sec1.append(h('p', { class: 'muted small', text: P.name + ' hat die Stunden selbst gesendet. Einzelne Tage änderst du im Bereich „Stunden“, oder du nutzt unten den Vergleich mit deinen PDF-Unterlagen.' }));
    else {
      const seg = h('div', { class: 'cfseg' }, [['sum', 'Nur Summe'], ['days', 'Tag für Tag']].map(function (m) { const b = h('button', { type: 'button', class: F.mode === m[0] ? 'on' : '', text: m[1] }); b.addEventListener('click', function () { F.mode = m[0]; cfRender(); }); return b; }));
      sec1.append(seg);
      if (F.mode === 'sum') {
        const tot = h('input', { class: 'input', id: 'cf_tot', type: 'text', inputmode: 'decimal', placeholder: 'Stunden, z. B. 174,5' }); tot.value = F.draft.tot != null ? F.draft.tot : (P.hasTotal ? cfH(P.totalHours) : ''); tot.addEventListener('input', function () { F.draft.tot = tot.value; });
            const note = h('input', { class: 'input', id: 'cf_totn', type: 'text', maxlength: '200', placeholder: 'Notiz (optional)' }); note.value = F.draft.totNote != null ? F.draft.totNote : (P.totalNote || ''); note.addEventListener('input', function () { F.draft.totNote = note.value; });
        sec1.append(h('div', { class: 'row wrap' }, tot, note), h('div', { class: 'row wrap' }, bt('Summe speichern', 'btn-primary', function () { const v = tot.value.trim(); if (!v) { tot.focus(); return; } F.draft.tot = null; F.draft.totNote = null; cfAct('adminTotalSet', { month: month, pin: P.pin, hours: v, note: note.value }, 'Summe gespeichert: ' + v + ' Std.', true); }), P.hasTotal ? bt('Summe entfernen', 'btn-ghost', function () { F.draft.tot = null; cfAct('adminTotalSet', { month: month, pin: P.pin, hours: '' }, 'Summe entfernt', true); }) : null));
      } else {
        const rows = F.days ? F.days.rows : [], places = Array.from(new Set(D.report.persons.reduce(function (a, p) { return a.concat((p.days || []).map(function (d) { return d.ort; })); }, []).filter(Boolean))).sort();
        const dl = h('datalist', { id: 'cf_places' }, places.map(function (p) { return h('option', { value: p }); }));
        const num = function (id, ph, v) { const x = h('input', { class: 'input cfin', id: id, type: 'number', min: '1', max: String(dim), placeholder: ph }); x.style.maxWidth = '84px'; if (v != null) x.value = v; return x; };
        const fd = num('cf_f1', 'von Tag', 1), ft = num('cf_f2', 'bis Tag', dim), fo = h('input', { class: 'input cfin', id: 'cf_fo', list: 'cf_places', placeholder: 'Einsatzort', maxlength: '60' }), fb = h('input', { class: 'input cfin', id: 'cf_fb', type: 'time' }), fe = h('input', { class: 'input cfin', id: 'cf_fe', type: 'time' }), fh = h('input', { class: 'input cfin', id: 'cf_fh', type: 'text', inputmode: 'decimal', placeholder: 'Std.' }); fh.style.maxWidth = '78px';
        const autoH = function () { const c = cfCalcH(fb.value, fe.value); if (c !== '') fh.value = cfH(c); }; fb.addEventListener('change', autoH); fe.addEventListener('change', autoH);
        sec1.append(dl, h('p', { class: 'muted small', text: 'Schnell füllen: Zeitraum, Ort und Zeiten angeben, die Stunden rechnet das System. Danach einzelne Tage anpassen und speichern.' }),
          h('div', { class: 'row wrap' }, fd, ft, fo, fb, fe, fh, bt('Auf Tage anwenden', 'btn-secondary', function () {
            const a = Math.max(1, Math.round(cfNum(fd.value) || 1)), z = Math.min(dim, Math.round(cfNum(ft.value) || dim)), hh = cfNum(fh.value);
            if (!fo.value.trim() || isNaN(hh)) { DP.toast('Bitte Einsatzort und Stunden angeben.', 'error'); return; }
            const map = {}; rows.forEach(function (r) { map[r.iso] = r; });
            for (let d = a; d <= z; d++) { const iso = month + '-' + String(d).padStart(2, '0'); map[iso] = { iso: iso, ort: fo.value.trim(), beginn: fb.value, ende: fe.value, stunden: hh }; }
            F.days.rows = Object.keys(map).sort().map(function (k) { return map[k]; }); cfRender();
          })));
        const tb = h('tbody', {}, rows.map(function (r, i) {
          const o = h('input', { class: 'input cfin', value: r.ort, list: 'cf_places' }), b = h('input', { class: 'input cfin', type: 'time', value: r.beginn || '' }), e = h('input', { class: 'input cfin', type: 'time', value: r.ende || '' }), s = h('input', { class: 'input cfin', type: 'text', inputmode: 'decimal', value: cfH(r.stunden) }); s.style.maxWidth = '70px';
          o.addEventListener('input', function () { r.ort = o.value; }); b.addEventListener('change', function () { r.beginn = b.value; const c = cfCalcH(r.beginn || '', r.ende || ''); if (c !== '') { r.stunden = c; s.value = cfH(c); } }); e.addEventListener('change', function () { r.ende = e.value; const c = cfCalcH(r.beginn || '', r.ende || ''); if (c !== '') { r.stunden = c; s.value = cfH(c); } }); s.addEventListener('input', function () { r.stunden = cfNum(s.value); });
          return h('tr', {}, h('td', { text: cfDm(r.iso) }), h('td', {}, o), h('td', {}, b), h('td', {}, e), h('td', {}, s), h('td', {}, bt('✕', 'btn-ghost', function () { F.days.rows.splice(i, 1); cfRender(); })));
        }));
        sec1.append(rows.length ? h('div', { class: 'vlscroll' }, h('table', { class: 'cft' }, h('thead', {}, h('tr', {}, ['Tag', 'Einsatzort', 'Beginn', 'Ende', 'Std.', ''].map(function (t) { return h('th', { text: t }); }))), tb)) : h('p', { class: 'muted small', text: 'Noch keine Tage. Oben den Zeitraum füllen oder deine PDF-Unterlagen im Vergleich übernehmen.' }),
          h('div', { class: 'row wrap' }, bt('Tage speichern (' + rows.length + ' Tage, ' + cfH(Math.round(rows.reduce(function (a, r) { return a + (Number(r.stunden) || 0); }, 0) * 100) / 100) + ' Std.)', 'btn-primary', function () { if (!rows.length) { DP.toast('Bitte mindestens einen Tag eintragen.', 'error'); return; } cfAct('adminHoursSet', { month: month, pin: P.pin, rows: rows.map(function (r) { return { iso: r.iso, ort: r.ort, beginn: r.beginn || '', ende: r.ende || '', stunden: r.stunden }; }) }, 'Tage gespeichert'); })));
      }
    }
    const pc = cfPlacesCard(P.days.filter(function (d) { return d.final; }).map(function (d) { return d.final; })); if (pc) wrap.append(pc);
    wrap.append(sec1);
    // 2) Vergleich
    const hasCmp = P.days.length > 0;
    if (P.loading && (P.hasBlock || P.hasRef)) wrap.append(h('section', { class: 'card cfc' }, h('div', { class: 'cfh', text: 'Vergleich' }), h('p', { class: 'muted small', text: 'Der Vergleich mit Gesendet und deinen PDF-Unterlagen wird geladen …' })));
    else if (hasCmp && (P.hasBlock || P.days.some(function (d) { return d.ref; }))) {
      const days = h('div', { class: 'vlscroll' }, h('table', { class: 'cft cfcmp' }, h('thead', {}, h('tr', {}, ['Tag', 'Gesendet', 'Deine Unterlagen', 'Endstand', 'Bemerkung'].map(function (t) { return h('th', { text: t }); }))),
        h('tbody', {}, P.days.map(function (d) { const bad = d.final && d.ref && !d.same, srBad = d.diffSR && (d.diffSR.ort || d.diffSR.zeit || d.diffSR.std); return h('tr', { class: d.same ? 'cfok' : (bad || srBad ? 'cfbad' : '') }, h('td', { text: cfDm(d.iso) }), h('td', { class: srBad ? 'cfd' : '', text: cfCell(d.sent) }), h('td', { text: cfCell(d.ref) }), h('td', { class: bad ? 'cfd' : '', text: cfCell(d.final) }), h('td', { class: 'cfrem', text: (P.remarks || []).filter(function (x) { return x.iso === d.iso; }).map(function (x) { return 'Am ' + cfDm(x.iso) + ' ' + x.text; }).join(' · ') })); })),
        h('tfoot', {}, h('tr', {}, h('th', { text: 'Summe' }), h('th', { text: cfH(P.totals.sent) + ' Std.' }), h('th', { text: cfH(P.totals.ref) + ' Std.' }), h('th', { text: cfH(P.totals.final) + ' Std.' }), h('th', { text: '' })))));
      const acts = h('div', { class: 'row wrap' });
      if (P.days.some(function (d) { return d.ref; })) acts.append(bt('Abweichungen übernehmen', 'btn-primary', function () { cfAct('adminRefApply', { month: month, pin: P.pin, mode: 'diff' }, function (r) { return 'Abweichungen übernommen. Endstand: ' + cfH(r.totals.final) + ' Std.'; }); }),
        bt('Alles als Endstand übernehmen', 'btn-secondary', async function () { if (await DP.confirm('Alles übernehmen?', 'Alle Tage deiner Unterlagen werden zum Endstand.' + (P.hasBlock && P.source === 'mitarbeiter' ? ' Abweichungen zu den gesendeten Stunden gelten dann als von dir korrigiert (das Original bleibt sichtbar).' : ' Für ' + P.name + ' wird der Monat als „vom Admin erfasst“ angelegt.'), 'Übernehmen')) cfAct('adminRefApply', { month: month, pin: P.pin, mode: 'all' }, function (r) { return 'Übernommen. Endstand: ' + cfH(r.totals.final) + ' Std.'; }); }));
      if (P.hasNachtrag) acts.append(bt('Stunden des Mitarbeiters übernehmen', 'btn-secondary', async function () { if (await DP.confirm('Stunden des Mitarbeiters übernehmen?', P.name + ' hat nach deiner Erfassung gesendet. Sein Stand ersetzt deinen Endstand.', 'Übernehmen')) cfAct('adminNachtragAccept', { month: month, pin: P.pin }, 'Stunden des Mitarbeiters übernommen'); }));
      wrap.append(h('section', { class: 'card cfc stack-sm' }, h('div', { class: 'cfh', text: 'Vergleich' }), h('p', { class: 'muted small', text: 'Orange: Abweichung zwischen Gesendet, deinen PDF-Unterlagen und dem Endstand. Der Chef sieht nur den Endstand.' }), days, acts));
    }
    // 3) Anmerkungen
    const typ = F.draft.remType, T = CF_REM.find(function (x) { return x.k === typ; }) || CF_REM[0];
    const tSel = h('select', { class: 'input cfin', id: 'cf_remt', 'aria-label': 'Art der Anmerkung' }, CF_REM.map(function (x) { return h('option', { value: x.k, text: x.label }); })); tSel.value = T.k; tSel.addEventListener('change', function () { F.draft.remType = tSel.value; F.draft.rem = ''; cfRender(); });
    const iso = h('select', { class: 'input cfin', id: 'cf_remiso', 'aria-label': 'Datum' }, [h('option', { value: '', text: 'Ohne Datum' })].concat(Array.from({ length: dim }, function (_, i) { const d = String(i + 1).padStart(2, '0'); return h('option', { value: month + '-' + d, text: d + '.' + month.slice(5, 7) + '.' }); }))); iso.value = F.draft.remIso || ''; iso.addEventListener('change', function () { F.draft.remIso = iso.value; });
    const isFree = T.k === 'free';
    const val = T.input ? (isFree ? h('textarea', { class: 'input cfin cfta', id: 'cf_rem', rows: '4', placeholder: 'Text eingeben. Mehrere Zeilen sind möglich (Enter = neue Zeile), die Länge ist nicht beschränkt.' }) : h('input', { class: 'input cfin', id: 'cf_rem', type: T.input, placeholder: T.ph || '', maxlength: '200', autocomplete: 'off' })) : null;
    const grow = function () { if (val && isFree) { val.style.height = 'auto'; val.style.height = Math.min(val.scrollHeight + 2, 420) + 'px'; } };
    if (val) { val.value = F.draft.rem; val.addEventListener('input', function () { F.draft.rem = val.value; grow(); }); setTimeout(grow, 0); }
    const prev = h('span', { class: 'small cfrem cfpre', id: 'cf_prev' }); const upd = function () { const t = T.build(val ? val.value : ''); prev.textContent = t ? '→ ' + (iso.value ? 'Am ' + cfDm(iso.value) + ' ' : '') + t : ''; }; if (val) val.addEventListener('input', upd); iso.addEventListener('change', upd); upd();
    const add = bt('Hinzufügen', 'btn-secondary', function () { const t = T.build(val ? val.value : ''); if (!t) { if (val) val.focus(); return; } const d = iso.value; F.draft.rem = ''; if (val) val.value = ''; cfAct('adminRemarkAdd', { month: month, pin: P.pin, iso: d, text: t }, 'Anmerkung gespeichert', true); });
    if (val) val.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (!isFree || e.ctrlKey || e.metaKey)) { e.preventDefault(); add.click(); } });   // Freitext: Enter = neue Zeile, Strg+Enter = hinzufügen
    const addRow = isFree ? [h('div', { class: 'row wrap' }, iso, tSel), val, h('div', { class: 'row wrap' }, add, h('span', { class: 'muted small', text: 'Strg + Enter fügt hinzu' }))] : [h('div', { class: 'row wrap' }, iso, tSel, val, add)];
    wrap.append(h('section', { class: 'card cfc stack-sm' }, h('div', { class: 'row between' }, h('div', { class: 'cfh', text: 'Anmerkungen vom Admin (Verspätungen u. a.)' }), P.remarks.length ? bt('Alle ' + P.remarks.length + ' löschen', 'btn-ghost', async function () { if (await DP.confirm('Alle Anmerkungen löschen?', 'Alle ' + P.remarks.length + ' Anmerkungen von ' + P.name + ' für ' + P.label + ' werden gelöscht. Das lässt sich nicht rückgängig machen.', 'Alle löschen', 'danger')) cfAct('adminRemarkClear', { month: month, pin: P.pin }, 'Alle Anmerkungen gelöscht', true); }) : null),
      P.empNote ? h('div', { class: 'cfempnote' }, h('div', { class: 'cfh2', text: 'Bemerkung vom Mitarbeiter (beim Senden geschrieben)' }), h('div', { class: 'cfpre', text: P.empNote })) : null,
      h('div', { class: 'stack-sm' }, P.remarks.length ? P.remarks.map(function (x) { return h('div', { class: 'cfremrow' }, h('span', { class: 'cfpre' }, h('b', { class: 'cfrd', text: x.iso ? 'Am ' + cfDm(x.iso) + ' ' : '' }), document.createTextNode(x.text)), bt('Löschen', 'btn-ghost', function () { cfAct('adminRemarkDelete', { id: x.id }, 'Anmerkung gelöscht', true); })); }) : [h('p', { class: 'muted small', text: 'Noch keine Anmerkungen.' })]),
      ...addRow, prev));
    return wrap;
  }
  // ---------- Rechte (Version 37): was Chef und Gruppenleiter dürfen ----------
  async function loadRights() {
    state.rt = state.rt || { data: null, edit: null, draft: null, token: '' };
    const r = await adm('adminRightsGet');
    if (r.status === 'success') state.rt.data = r;
    const v = await adm('adminViewGet');
    if (v.status === 'success') state.rt.token = v.token || '';
  }
  function rtBase() { return location.origin + location.pathname.replace(/[^/]*$/, ''); }
  function rtStart(e) {
    state.rt.edit = e.key;
    state.rt.draft = { key: e.key, title: e.title || '', preset: e.preset || 'angepasst', rights: Object.assign({}, e.rights), allPlaces: !e.places, places: (e.places || []).slice(), pastLock: !!e.pastLock, expires: e.expires || '' };
    renderTab();
  }
  async function rtSave() {
    const d = state.rt.draft, R = state.rt.data;
    const any = Object.keys(d.rights).some(function (k) { return d.rights[k] && k !== 'v_plan'; });
    if (any && !d.rights.v_plan) { d.rights.v_plan = true; DP.toast('„Dienstplan ansehen“ wurde mit eingeschaltet, alle Ansichten brauchen es.'); }
    if (!d.allPlaces && !d.places.length) { DP.toast('Bitte mindestens einen Standort wählen oder „Alle Standorte“.', 'error'); return; }
    const r = await adm('adminRightsSet', { key: d.key, title: d.title, preset: d.preset, rights: d.rights, places: d.allPlaces ? null : d.places, pastLock: d.pastLock, expires: d.expires });
    if (r.status === 'success') { state.rt.data = r; state.rt.edit = null; state.rt.draft = null; DP.toast('Rechte gespeichert. Sie gelten sofort.'); renderTab(); }
    else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Nicht gespeichert.', 'error');
  }
  function rtEditor(R) {
    const d = state.rt.draft, entry = R.entries.filter(function (x) { return x.key === d.key; })[0];
    const order = ['aus', 'ansehen', 'planen', 'schichtleiter', 'planer', 'lesen', 'voll'].filter(function (k) { return R.presets[k]; });
    const preset = h('select', { class: 'input', id: 'rt_preset' }, order.map(function (k) { return h('option', { value: k, text: R.presets[k].label }); }), h('option', { value: 'angepasst', text: 'Angepasst (eigene Auswahl)' }));
    preset.value = d.preset;
    const boxes = [];
    const setPreset = function () { preset.value = d.preset; };
    preset.addEventListener('change', function () {
      if (preset.value !== 'angepasst') { const keys = R.presets[preset.value].keys; R.defs.forEach(function (x) { d.rights[x.k] = keys.indexOf(x.k) !== -1; }); }
      d.preset = preset.value; renderTab();
    });
    const groups = []; R.defs.forEach(function (x) { if (groups.indexOf(x.g) === -1) groups.push(x.g); });
    const gcards = groups.map(function (g) {
      return h('div', { class: 'stack-sm' }, h('div', { class: 'small', style: 'font-weight:700;margin-top:6px', text: g }),
        R.defs.filter(function (x) { return x.g === g; }).map(function (x) {
          const cb = h('input', { type: 'checkbox', id: 'rt_' + x.k }); cb.checked = !!d.rights[x.k];
          cb.addEventListener('change', function () { d.rights[x.k] = cb.checked; d.preset = 'angepasst'; setPreset(); });
          return h('label', { class: 'row', for: 'rt_' + x.k, style: 'gap:10px;align-items:flex-start;padding:5px 0;cursor:pointer' }, cb, h('span', { text: x.l }));
        }));
    });
    const title = h('input', { class: 'input', id: 'rt_title', type: 'text', maxlength: '40', placeholder: entry && entry.kind === 'chef' ? 'zum Beispiel Betriebsleiter' : 'zum Beispiel Gruppenleiter', value: d.title });
    title.addEventListener('input', function () { d.title = title.value; });
    const allP = h('input', { type: 'checkbox', id: 'rt_allp' }); allP.checked = d.allPlaces;
    allP.addEventListener('change', function () { d.allPlaces = allP.checked; renderTab(); });
    const pl = d.allPlaces ? null : h('div', { class: 'stack-sm' }, R.places.map(function (p) {
      const cb = h('input', { type: 'checkbox', id: 'rtp_' + p }); cb.checked = d.places.indexOf(p) !== -1;
      cb.addEventListener('change', function () { const i = d.places.indexOf(p); if (cb.checked && i === -1) d.places.push(p); if (!cb.checked && i !== -1) d.places.splice(i, 1); });
      return h('label', { class: 'row', for: 'rtp_' + p, style: 'gap:10px;cursor:pointer' }, cb, h('span', { text: p }));
    }));
    const lock = h('input', { type: 'checkbox', id: 'rt_lock' }); lock.checked = d.pastLock; lock.addEventListener('change', function () { d.pastLock = lock.checked; });
    const exp = h('input', { class: 'input', id: 'rt_exp', type: 'date', value: d.expires }); exp.addEventListener('input', function () { d.expires = exp.value; });
    const save = h('button', { type: 'button', class: 'btn btn-primary', text: 'Speichern', onclick: rtSave });
    const cancel = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Abbrechen', onclick: function () { state.rt.edit = null; state.rt.draft = null; renderTab(); } });
    return h('section', { class: 'card stack-sm', id: 'rt_editor' }, h('h3', { text: 'Rechte: ' + (entry ? entry.label : '') }),
      h('p', { class: 'muted small', text: 'Änderungen gelten sofort. Konten und PINs verwalten, Rechte ändern, den Notaus und „alles löschen“ bleiben immer bei dir.' }),
      h('div', { class: 'form-grid' }, field('Bezeichnung (steht bei „eingetragen von“)', title, 'rt_title'), field('Vorlage', preset, 'rt_preset')),
      gcards,
      h('div', { class: 'small', style: 'font-weight:700;margin-top:10px', text: 'Einschränkungen' }),
      h('label', { class: 'row', for: 'rt_allp', style: 'gap:10px;cursor:pointer' }, allP, h('span', { text: 'Alle Standorte (sonst nur die gewählten; Veröffentlichen und Kopieren brauchen alle Standorte)' })), pl,
      h('label', { class: 'row', for: 'rt_lock', style: 'gap:10px;cursor:pointer' }, lock, h('span', { text: 'Vergangene Monate sperren (nichts mehr in früheren Monaten ändern)' })),
      field('Gültig bis (danach nur noch ansehen, leer = unbefristet)', exp, 'rt_exp'),
      h('div', { class: 'row wrap' }, save, cancel));
  }
  function rtSummary(e) {
    const on = Object.keys(e.rights).filter(function (k) { return e.rights[k]; }).length, parts = [];
    parts.push(on + ' von ' + Object.keys(e.rights).length + ' Rechten');
    parts.push(e.places ? 'nur ' + e.places.join(', ') : 'alle Standorte');
    if (e.pastLock) parts.push('vergangene Monate gesperrt');
    if (e.expires) parts.push((e.expired ? 'abgelaufen am ' : 'gültig bis ') + e.expires.slice(8, 10) + '.' + e.expires.slice(5, 7) + '.' + e.expires.slice(0, 4));
    return parts.join(' · ');
  }
  function rtPassphrase() {
    const w = ['Birne', 'Wolke', 'Tiger', 'Mond', 'Fluss', 'Stern', 'Anker', 'Pfeffer', 'Lampe', 'Berg', 'Segel', 'Wiese', 'Kiesel', 'Falke', 'Nebel', 'Zimt'], a = new Uint32Array(5);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return w[a[0] % w.length] + '-' + w[a[1] % w.length] + '-' + w[a[2] % w.length] + '-' + String(10 + (a[3] % 90)) + String(a[4] % 10);
  }
  function rtPwBlock(e, edit) {
    const btns = h('div', { class: 'row wrap' }, edit, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Passwort setzen', onclick: function () { state.rt.pwFor = e.key; renderTab(); } }));
    if (state.rt.pwFor !== e.key) return btns;
    const pw = h('input', { class: 'input mono', id: 'rtpw_' + e.key, type: 'text', autocomplete: 'off', placeholder: 'mindestens 12 Zeichen' });
    const gen = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Vorschlag', onclick: function () { pw.value = rtPassphrase(); } });
    const save = h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Speichern' });
    save.addEventListener('click', async function () {
      if (!pw.value) { DP.toast('Bitte ein Passwort eingeben.', 'error'); return; }
      const r = await adm('adminUserSetPassword', { id: e.key, password: pw.value });
      if (r.status === 'success') { state.rt.pwFor = null; showCredentials({ username: r.username, password: pw.value, name: e.label }, 'Neues Passwort für'); renderTab(); }
      else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Nicht gespeichert.', 'error');
    });
    const cancel = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Abbrechen', onclick: function () { state.rt.pwFor = null; renderTab(); } });
    return h('div', { class: 'stack-sm' }, btns, field('Neues Passwort für ' + e.label + ' (alle angemeldeten Geräte werden abgemeldet)', pw, 'rtpw_' + e.key), h('div', { class: 'row wrap' }, save, gen, cancel));
  }
  function rtCreateCard(R) {
    const name = h('input', { class: 'input', id: 'gl_name', type: 'text', maxlength: '40', placeholder: 'Vor- und Nachname', autocomplete: 'off' });
    const user = h('input', { class: 'input', id: 'gl_user', type: 'text', maxlength: '30', placeholder: 'zum Beispiel sabine.leiter (leer = automatisch)', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
    const pw = h('input', { class: 'input mono', id: 'gl_pw', type: 'text', placeholder: 'mindestens 12 Zeichen (leer = automatisch)', autocomplete: 'off' });
    const gen = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Vorschlag', onclick: function () { pw.value = rtPassphrase(); } });
    const title = h('input', { class: 'input', id: 'gl_title', type: 'text', maxlength: '40', value: 'Gruppenleiter' });
    const preset = h('select', { class: 'input', id: 'gl_preset' }, [['schichtleiter', 'Schichtleiter: planen, tauschen, genehmigen'], ['planen', 'Ansehen und planen'], ['ansehen', 'Nur ansehen']].map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    const err = h('div', {}), go = h('button', { type: 'button', class: 'btn btn-primary' }, DP.icon('plus', 'sm'), 'Zugang anlegen');
    go.addEventListener('click', async function () {
      err.replaceChildren();
      if (!name.value.trim()) { err.append(alertBox('error', 'Bitte einen Namen eingeben.')); return; }
      go.disabled = true;
      const r = await adm('adminUserCreate', { name: name.value, role: 'planer', username: user.value.trim(), password: pw.value, title: title.value, preset: preset.value });
      go.disabled = false;
      if (r.status === 'success') { showCredentials(r, 'Zugangsdaten für'); await loadRights(); renderTab(); }
      else if (r.code !== 'ADMIN_AUTH') err.append(alertBox('error', r.message || 'Das Konto konnte nicht angelegt werden.'));
    });
    return h('section', { class: 'card stack-sm' }, h('h3', { text: 'Gruppenleiter-Zugang anlegen' }),
      h('p', { class: 'muted small', text: 'Lege für jeden Gruppenleiter einen eigenen Zugang an. Benutzername und Passwort kannst du selbst festlegen, sonst erzeugt das System sie. Danach stellst du die Rechte in der Karte des Kontos weiter unten fein ein. Der Chef sieht im Verlauf, was jeder Gruppenleiter gemacht hat.' }),
      h('div', { class: 'form-grid' }, field('Name', name, 'gl_name'), field('Benutzername', user, 'gl_user'), field('Bezeichnung', title, 'gl_title'), field('Rechte-Vorlage', preset, 'gl_preset')),
      field('Passwort', pw, 'gl_pw', 'Mindestens 12 Zeichen, darf den Benutzernamen nicht enthalten.'), h('div', { class: 'row wrap' }, gen), err, h('div', {}, go));
  }

  function rightsView() {
    setTitle('Rechte');
    const R = state.rt && state.rt.data;
    if (!R) return h('div', { class: 'stack' }, h('div', { class: 'muted', text: 'Wird geladen …' }));
    const kill = h('button', { type: 'button', class: 'btn ' + (R.killed ? 'btn-primary' : 'btn-danger'), text: R.killed ? 'Notaus beenden' : 'Notaus: alle Schreibrechte sofort aus' });
    kill.addEventListener('click', async function () {
      if (!R.killed && !(await DP.confirm('Notaus einschalten?', 'Chef und alle Konten können sofort nichts mehr ändern (Ansehen geht weiter). Du kannst es jederzeit wieder beenden.', 'Notaus', 'danger'))) return;
      const r = await adm('adminRightsKill', { on: !R.killed });
      if (r.status === 'success') { state.rt.data = r; DP.toast(r.killed ? 'Notaus ist an.' : 'Notaus ist beendet.'); renderTab(); } else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Nicht möglich.', 'error');
    });
    const link = rtBase() + 'uebersicht.html' + (state.rt.token ? '#' + state.rt.token : '');
    const linkIn = h('input', { class: 'input mono', id: 'rt_link', type: 'text', readonly: true, value: link });
    const copy = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Kopieren' });
    copy.addEventListener('click', function () { try { navigator.clipboard.writeText(link).then(function () { DP.toast('Link kopiert.'); }, function () { linkIn.select(); }); } catch (e) { linkIn.select(); } });
    const chefLockBtn = h('button', { type: 'button', class: 'btn btn-sm ' + (R.chefLock ? 'btn-primary' : 'btn-secondary'), text: R.chefLock ? 'Dienstplan für den Chef freigeben' : 'Dienstplan für den Chef sperren' });
    chefLockBtn.addEventListener('click', async function () {
      const r = await adm('adminRightsLock', { on: !R.chefLock });
      if (r.status === 'success') { state.rt.data = r; DP.toast(r.chefLock ? 'Der Dienstplan ist für den Chef gesperrt.' : 'Der Dienstplan ist für den Chef wieder frei.'); renderTab(); } else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Nicht möglich.', 'error');
    });
    const cards = R.entries.map(function (e) {
      const edit = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Rechte bearbeiten', onclick: function () { rtStart(e); } });
      const label = e.kind === 'chef' ? 'Chef-Zugang' : e.label;
      const sub = e.kind === 'chef' ? (e.enabled ? 'Link und Passwort sind eingeschaltet' : 'Der Chef-Zugang ist ausgeschaltet (Reiter „Chef-Bericht“)') + (R.chefLock ? ' · Dienstplan GESPERRT: der Chef sieht ihn grau und soll sich an dich wenden' : '') : e.username + ' · ' + (e.role === 'admin' ? 'Voll-Admin' : e.role === 'planer' ? 'Planer' : 'Nur lesen') + (e.status !== 'aktiv' ? ' · ' + e.status : '');
      return h('section', { class: 'card stack-sm' }, h('div', { class: 'row between' }, h('div', {}, h('div', { class: 'nm', text: label + (e.title ? ' · ' + e.title : '') }), h('div', { class: 'muted small', text: sub })),
        e.full ? h('span', { class: 'badge success', text: 'Alle Rechte' }) : h('span', { class: 'badge ' + (e.preset === 'aus' ? 'neutral' : 'success'), text: (R.presets[e.preset] ? R.presets[e.preset].label : 'Angepasst') })),
        e.full ? h('p', { class: 'muted small', text: 'Ein Voll-Admin-Konto hat immer alle Rechte.' }) : h('p', { class: 'muted small', text: rtSummary(e) }),
        e.kind === 'konto' ? rtPwBlock(e, edit) : h('div', { class: 'row wrap' }, edit, e.kind === 'chef' ? chefLockBtn : null));
    });
    return h('div', { class: 'stack' },
      h('section', { class: 'card stack-sm' }, h('h3', { text: 'Notaus' }), h('p', { class: 'muted small', text: R.killed ? 'Der Notaus ist AN. Chef und Konten können nichts ändern, nur ansehen.' : 'Sperrt alle Schreibrechte von Chef und Konten auf einmal. Ansehen bleibt möglich.' }), h('div', {}, kill)),
      h('section', { class: 'card stack-sm' }, h('h3', { text: 'Ein Link für Chef und Gruppenleiter' }),
        h('p', { class: 'muted small', text: 'Das ist der Übersichtslink. Dort tippt man auf „Chef- und Gruppenleiter-Zugang“. Der Chef gibt sein Chef-Passwort ein und sieht oben „Stunden | Dienstplan“. Gruppenleiter tippen auf „Gruppenleiter-Anmeldung“ und melden sich mit Benutzername und Passwort an, sie sehen nur den Dienstplan. Was jeder sehen und tun darf, stellst du unten ein. Ohne Einstellung sieht der Chef den Dienstplan nicht.' }),
        h('div', { class: 'row wrap' }, linkIn, copy)),
      rtCreateCard(R), state.rt.edit ? rtEditor(R) : null, cards);
  }

  // ---------- Anwesenheit (Version 40): das Brett ----------
  // Jeder Eintrag geht sofort in die eigene Erfassung („Deine Unterlagen“) des Mitarbeiters. Nur du siehst sie,
  // bis du pro Mitarbeiter und Monat für den Chef freigibst.
  // ---------- Anwesenheit: Zwischenspeicher und Speichern im Hintergrund ----------
  // Der ganze Monat wird einmal geladen, Tageswechsel gehen ohne Wartezeit. Eintragen wirkt sofort,
  // gespeichert wird im Hintergrund (mehrere Züge werden zu einem Aufruf gebündelt).
  const attHrs = function (a, c) { let m = (+c.slice(0, 2) * 60 + +c.slice(3, 5)) - (+a.slice(0, 2) * 60 + +a.slice(3, 5)); if (m <= 0) m += 1440; return Math.round(m / 60 * 100) / 100; };
  const attQ = function () { const A = state.att; return A.q = A.q || { items: [], timer: null, run: null, okAt: 0 }; };
  function attBusy() { const A = state.att; if (!A || state.tab !== 'attend') return false; const Q = A.q; const R = A.rq; return !!(A.dragging || A.colDrag || (Q && (Q.items.length || Q.run)) || (R && (R.items.length || R.run))); }
  function attSyncText() { const A = state.att, Q = A && A.q, R = A && A.rq; if (A && A.loading) return 'lädt …'; if ((Q && (Q.items.length || Q.run)) || (R && (R.items.length || R.run))) return 'Speichert …'; if ((Q && Date.now() - Q.okAt < 2500) || (R && Date.now() - R.okAt < 2500)) return '✓ Gespeichert'; return ''; }
  function attStatus() {
    const A = state.att, Q = A && A.q, R = A && A.rq, busy = !!((Q && (Q.items.length || Q.run)) || (R && (R.items.length || R.run))), t = attSyncText(), el = document.querySelector('.att-sync');
    if (el) { el.textContent = t; el.className = 'att-sync' + (busy || (A && A.loading) ? ' busy' : t ? ' done' : ''); }
    window.onbeforeunload = busy ? function (e) { e.preventDefault(); e.returnValue = ''; return ''; } : null;
  }
  function attBuildDay() {
    const A = state.att, C = A.cache; if (!C) return;
    const date = A.date, day = C.segs[date] = C.segs[date] || {}, used = {}, full = C.cfgAll;
    Object.keys(day).forEach(function (p) { day[p].forEach(function (s) { used[s.ort] = true; }); });
    const order = full.order.filter(function (pl) { const p = full.places[pl]; return !(p.hidden || p.unknown) || used[pl]; });
    A.data = Object.assign({}, C.base, { date: date, entries: day, counts: C.counts, absences: C.absAll.filter(function (a) { return a.from <= date && date <= a.to; }), cfg: { mode: full.mode, hidden: full.hidden, places: full.places, order: order } });
  }
  function attFetch(date) {   // läuft für diesen Monat schon eine Abfrage (zum Beispiel das Vorladen), wartet ein zweiter Aufruf darauf, statt noch einmal zu fragen
    const A = state.att, mo = String(date).slice(0, 7);
    if (A.inflight && A.inflightMo === mo) return A.inflight;
    A.inflightMo = mo;
    A.inflight = attFetchRun(date).then(function (v) { A.inflight = null; return v; }, function (e) { A.inflight = null; throw e; });
    return A.inflight;
  }
  async function attFetchRun(date) {
    const A = state.att; A.loading = true; attStatus();
    try {
      const r = await adm('adminAttGet', { date: date });
      if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Das Brett konnte nicht geladen werden.', 'error'); return false; }
      const segs = {}, counts = {};
      r.all.forEach(function (x) { const d = segs[x[0]] = segs[x[0]] || {}; (d[x[1]] = d[x[1]] || []).push({ ort: x[2], beginn: x[3], ende: x[4], stunden: x[5] }); });
      Object.keys(segs).forEach(function (iso) { counts[iso] = Object.keys(segs[iso]).length; });
      const base = Object.assign({}, r); ['all', 'absAll', 'entries', 'counts', 'absences', 'cfg', 'rems', 'presets'].forEach(function (k) { delete base[k]; });
      A.cache = { month: r.month, at: Date.now(), segs: segs, counts: counts, absAll: r.absAll || [], cfgAll: r.cfgAll || r.cfg, rems: r.rems || [], presets: r.presets || [], base: base };
      return true;
    } finally { A.loading = false; attStatus(); }
  }
  async function loadAtt(date, force, ttl) {
    const A = state.att = state.att || { date: '', data: null, sel: {}, last: '', search: '', dragging: false, dragPins: [], el: null };
    if (date) A.date = date;
    if (!A.date) A.date = PD.today();
    const C = A.cache;
    if (C && C.month === A.date.slice(0, 7) && !force) {   // Tageswechsel im selben Monat: ohne Server, ohne Warten
      attBuildDay(); A.sel = {};
      if (Date.now() - C.at > (ttl || 120000) && !A.refreshing) {   // im Hintergrund auffrischen, ohne zu warten
        A.refreshing = true;
        attFetch(A.date).then(function (ok) { A.refreshing = false; const Q = attQ(); if (ok && !Q.items.length && !Q.run) { attBuildDay(); if (state.tab === 'attend') renderTab(); } }, function () { A.refreshing = false; });
      }
      return;
    }
    await attFlushAll();   // nur vor einem echten Laden vom Server: erst fertig speichern, sonst überholt der alte Stand den neuen
    if (await attFetch(A.date)) { attBuildDay(); A.sel = {}; }
  }
  function attApply(date, entries) {   // genau wie der Server: sofort sichtbar, bevor gespeichert ist
    const A = state.att, C = A.cache; if (!C) return;
    const places = C.cfgAll.places, day = C.segs[date] = C.segs[date] || {}, next = {};
    entries.forEach(function (e) {
      const pin = String(e.pin), ort = String(e.ort == null ? '' : e.ort).trim(), from = String(e.from == null ? '' : e.from).trim();
      let s = next[pin] !== undefined ? next[pin] : (day[pin] || []).map(function (x) { return { ort: x.ort, beginn: x.beginn, ende: x.ende, stunden: x.stunden }; });
      if (from) s = s.filter(function (x) { return x.ort !== from; }); else if (!ort || e.mode !== 'add') s = [];
      if (ort) { const p = places[ort] || {}, st = e.beginn || p.start || '22:00', en = e.ende || p.end || '08:00'; s = s.filter(function (x) { return x.ort !== ort; }); s.push({ ort: ort, beginn: st, ende: en, stunden: attHrs(st, en) }); }
      next[pin] = s;
    });
    Object.keys(next).forEach(function (p) { if (next[p].length) day[p] = next[p]; else delete day[p]; });
    C.counts[date] = Object.keys(day).length;
  }
  function attEnqueue(date, entries) {
    const A = state.att, Q = attQ(); Q.items.push({ date: date, entries: entries }); A.dirty = true;
    if (Q.timer) clearTimeout(Q.timer);
    Q.timer = setTimeout(function () { Q.timer = null; attFlush(); }, 450); attStatus();
  }
  function attFlush() {
    const A = state.att; if (!A) return Promise.resolve();
    const Q = attQ(); if (Q.timer) { clearTimeout(Q.timer); Q.timer = null; }
    if (Q.run) return Q.run;
    if (!Q.items.length) return Promise.resolve();
    Q.run = (async function () {
      let failed = false;
      try {
        while (Q.items.length) {
          const date = Q.items[0].date, batch = [];
          while (Q.items.length && Q.items[0].date === date && batch.length + Q.items[0].entries.length <= 60) Array.prototype.push.apply(batch, Q.items.shift().entries);
          attStatus();
          const r = await adm('adminAttSet', { date: date, entries: batch });
          if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Nicht gespeichert.', 'error'); failed = true; Q.items = []; break; }
          if (!Q.items.length && A.cache) {   // nur übernehmen, wenn nichts Neueres wartet
            const day = A.cache.segs[date] = A.cache.segs[date] || {};
            r.pins.forEach(function (p) { if (r.day[p]) day[p] = r.day[p]; else delete day[p]; });
            A.cache.counts[date] = r.count;
          }
        }
      } finally { Q.run = null; }
      if (failed) { A.cache = null; if (await attFetch(A.date)) attBuildDay(); } else Q.okAt = Date.now();
      attStatus();
      if (state.tab === 'attend' && !A.dragging && !A.colDrag) { attBuildDay(); renderTab(); }
      setTimeout(attStatus, 2600);
    })();
    return Q.run;
  }
  // ---------- Anwesenheit: Bemerkungen (feste Sätze und Freitext, automatisch am gewählten Tag) ----------
  const attRQ = function () { const A = state.att; return A.rq = A.rq || { items: [], timer: null, run: null, map: {}, okAt: 0 }; };
  const attFmtDur = function (m) { const hh = Math.floor(m / 60), r = m % 60; return (hh ? hh + ' Std' : '') + (hh && r ? ' ' : '') + (r ? r + ' Min' : ''); };
  function attFlushAll() { return Promise.all([attFlush(), attRFlush()]); }
  function attRSchedule() { const Q = attRQ(); if (Q.timer) clearTimeout(Q.timer); Q.timer = setTimeout(function () { Q.timer = null; attRFlush(); }, 450); attStatus(); }
  function attRemAdd(pin, iso, text) {
    const A = state.att, tmp = 'tmp' + (A.rseq = (A.rseq || 0) + 1);
    A.cache.rems.push({ id: tmp, pin: pin, iso: iso, text: text }); attRQ().items.push({ op: 'add', tmp: tmp, pin: pin, iso: iso, text: text }); A.dirty = true; attRSchedule();
  }
  function attRemDel(id) {
    const A = state.att, Q = attRQ(); A.cache.rems = A.cache.rems.filter(function (x) { return x.id !== id; }); A.dirty = true;
    if (id.indexOf('tmp') === 0) {
      const i = Q.items.findIndex(function (o) { return o.op === 'add' && o.tmp === id; });
      if (i >= 0) { Q.items.splice(i, 1); attStatus(); return; }   // noch nicht gesendet: einfach zurücknehmen
      Q.items.push({ op: 'del', tmp: id });
    } else Q.items.push({ op: 'del', id: id });
    attRSchedule();
  }
  function attRFlush() {
    const A = state.att; if (!A) return Promise.resolve();
    const Q = attRQ(); if (Q.timer) { clearTimeout(Q.timer); Q.timer = null; }
    if (Q.run) return Q.run;
    if (!Q.items.length) return Promise.resolve();
    Q.run = (async function () {
      let failed = false;
      try {
        while (Q.items.length) {
          const ops = []; Q.items.splice(0, 30).forEach(function (o) { if (o.op === 'add' || o.id) ops.push(o); else if (Q.map[o.tmp]) ops.push({ op: 'del', id: Q.map[o.tmp] }); });
          if (!ops.length) continue;
          attStatus();
          const r = await adm('adminAttRemark', { ops: ops });
          if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Bemerkung nicht gespeichert.', 'error'); failed = true; Q.items = []; break; }
          (r.added || []).forEach(function (a) { Q.map[a.tmp] = a.id; const it = A.cache && A.cache.rems.find(function (x) { return x.id === a.tmp; }); if (it) it.id = a.id; });
        }
      } finally { Q.run = null; }
      if (failed) { A.cache = null; if (await attFetch(A.date)) attBuildDay(); } else Q.okAt = Date.now();
      attStatus();
      if (state.tab === 'attend' && !A.dragging && !A.colDrag) renderTab();
      setTimeout(attStatus, 2600);
    })();
    return Q.run;
  }
  function attRemDialog(pin) {
    const A = state.att; if (!A.cache) return;
    const emp = A.data.employees.find(function (e) { return e.pin === pin; }), who = emp ? emp.name : pin, st = { iso: A.date };
    const cache = function () { return state.att.cache; };
    const listBox = h('div', { class: 'att-rmlist' }), title = h('p', { class: 'muted small' });
    const draw = function () {
      title.textContent = 'Gilt für ' + PD.short(st.iso) + ' ' + st.iso.slice(0, 4) + ' und ist nur für dich sichtbar, bis du den Mitarbeiter für den Chef freigibst.';
      listBox.textContent = '';
      const items = cache().rems.filter(function (x) { return x.pin === pin && x.iso === st.iso; });
      if (!items.length) listBox.append(h('div', { class: 'muted small', text: 'An diesem Tag noch keine Bemerkung.' }));
      items.forEach(function (x) {
        listBox.append(h('div', { class: 'att-rmitem' }, h('span', { class: 'att-rmdate', text: 'Am ' + x.iso.slice(8, 10) + '.' + x.iso.slice(5, 7) + '.' }), h('span', { class: 'att-rmtext', text: x.text }),
          h('button', { type: 'button', class: 'att-rmdel', title: 'Löschen', 'aria-label': 'Bemerkung löschen', text: '✕', onclick: function () { attRemDel(x.id); draw(); renderTab(); } })));
      });
    };
    const add = function (text) { text = String(text || '').trim(); if (!text) return false; attRemAdd(pin, st.iso, text); draw(); renderTab(); return true; };
    const durRow = function (label, suffix) {
      const mins = h('input', { class: 'input att-min', type: 'number', min: '1', max: '1440', placeholder: 'Min', 'aria-label': label + ': eigene Minuten' });
      const go = h('button', { type: 'button', class: 'att-pre', text: 'OK', 'aria-label': label + ': eigene Minuten übernehmen' });
      go.addEventListener('click', function () { const m = Math.round(Number(mins.value)); if (!(m >= 1 && m <= 1440)) { DP.toast('Bitte Minuten von 1 bis 1440 eingeben.', 'error'); return; } mins.value = ''; add(attFmtDur(m) + ' ' + suffix); });
      return h('div', { class: 'att-prerow' }, h('b', { text: label }), h('div', { class: 'att-chips2' }, [15, 30, 45, 60, 90, 120].map(function (m) { return h('button', { type: 'button', class: 'att-pre', text: attFmtDur(m), onclick: function () { add(attFmtDur(m) + ' ' + suffix); } }); }), mins, go));
    };
    const others = h('div', { class: 'att-prerow' }, h('b', { text: 'Sonstiges' }));
    const chipsBox = h('div', { class: 'att-chips2' }); others.append(chipsBox);
    const savePresets = function (list) { cache().presets = list; adm('adminAttPresetSet', { presets: list }).then(function (r) { if (r.status !== 'success' && r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Vorlage nicht gespeichert.', 'error'); }); drawChips(); };
    const drawChips = function () {
      chipsBox.textContent = '';
      ['Nicht abgemeldet', 'Nicht angemeldet', 'Nicht erschienen'].forEach(function (t) { chipsBox.append(h('button', { type: 'button', class: 'att-pre', text: t, onclick: function () { add(t); } })); });
      cache().presets.forEach(function (t) {
        chipsBox.append(h('span', { class: 'att-pre own' }, h('button', { type: 'button', class: 'att-prebtn', text: t, onclick: function () { add(t); } }), h('button', { type: 'button', class: 'att-prex', title: 'Vorlage löschen', 'aria-label': 'Vorlage ' + t + ' löschen', text: '✕', onclick: function () { savePresets(cache().presets.filter(function (x) { return x !== t; })); } })));
      });
    };
    const dateIn = h('input', { class: 'input', id: 'att_rm_date', type: 'date', value: st.iso }); dateIn.addEventListener('change', function () { if (dateIn.value) { st.iso = dateIn.value; draw(); } });
    const txt = h('textarea', { class: 'input', id: 'att_rm_text', rows: '3', maxlength: '5000', placeholder: 'Freitext, zum Beispiel „Hat angerufen, kommt später“' });
    const tpl = h('input', { type: 'checkbox', id: 'att_rm_tpl' });
    const addBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Hinzufügen' });
    addBtn.addEventListener('click', function () {
      const t = txt.value.trim(); if (!t) { DP.toast('Bitte einen Text eingeben.', 'error'); return; }
      if (tpl.checked) { if (t.length > 60 || t.indexOf('\n') !== -1) DP.toast('Als Vorlage nur kurze Sätze (bis 60 Zeichen, eine Zeile).', 'error'); else if (cache().presets.length >= 12) DP.toast('Es sind schon 12 eigene Vorlagen gespeichert.', 'error'); else if (cache().presets.map(function (x) { return x.toLowerCase(); }).indexOf(t.toLowerCase()) === -1) savePresets(cache().presets.concat([t])); }
      add(t); txt.value = ''; tpl.checked = false;
    });
    draw(); drawChips();
    DP.modal({ title: 'Bemerkung · ' + who, wide: true, body: h('div', { class: 'stack-sm' }, title, field('Datum', dateIn, 'att_rm_date'), listBox,
      durRow('Zu spät', 'zu spät'), durRow('Früher gegangen', 'früher gegangen'), others,
      field('Freitext', txt, 'att_rm_text'), h('div', { class: 'row wrap' }, h('label', { class: 'att-tplbox', for: 'att_rm_tpl' }, tpl, ' Als Vorlage merken'), h('div', { class: 'grow' }), addBtn)),
      actions: [{ label: 'Fertig', kind: 'primary' }] });
  }
  const ATT_STATE = { released: 'für Chef freigegeben', admin_released: 'für Chef freigegeben', sent_open: 'hat schon gesendet', admin_open: 'übernommen, noch nicht freigegeben', manual: 'nur Summe vorhanden', none: 'noch nicht übernommen' };
  const attHm = function (t) { return +String(t).slice(0, 2) * 60 + +String(t).slice(3, 5); };
  function attCheck(list) {   // Summe und Warnungen für mehrere Abschnitte eines Tages
    const iv = list.map(function (s) { const a = attHm(s.beginn); let e = attHm(s.ende); if (e <= a) e += 1440; return [a, e]; });
    let sum = 0; iv.forEach(function (x) { sum += x[1] - x[0]; });
    const warn = [], hit = function (p, q) { return p[0] < q[1] && q[0] < p[1]; };
    let over = false;
    for (let i = 0; i < iv.length; i++) for (let j = i + 1; j < iv.length; j++) if (hit(iv[i], iv[j]) || hit(iv[i], [iv[j][0] + 1440, iv[j][1] + 1440]) || hit([iv[i][0] + 1440, iv[i][1] + 1440], iv[j])) over = true;
    if (over) warn.push('Die Zeiten überschneiden sich.');
    if (sum > 14 * 60) warn.push('Zusammen mehr als 14 Stunden (' + String(Math.round(sum / 6) / 10).replace('.', ',') + ' Std).');
    return { hours: Math.round(sum / 6) / 10, warn: warn };
  }
  // Mitarbeiter ist an dem Tag schon irgendwo eingetragen: du entscheidest
  function attTwoPlaces(pin, where, D) {
    return new Promise(function (resolve) {
      let done = false; const fin = function (v) { if (!done) { done = true; resolve(v); } };
      const who = (D.employees.filter(function (e) { return e.pin === pin; })[0] || {}).name || pin, cur = D.entries[pin];
      DP.modal({ title: 'Zwei Standorte am selben Tag?', body: h('div', { class: 'stack-sm' },
        h('p', {}, h('b', { text: who }), ' ist an diesem Tag schon eingetragen: ' + cur.map(function (s) { return s.ort + ' (' + s.beginn + '–' + s.ende + ')'; }).join(', ') + '.'),
        h('p', { class: 'muted small', text: 'Zusätzlich an „' + where + '“ eintragen: dann legst du beide Uhrzeiten fest, die Stunden werden zusammengezählt. Oder nur dorthin verschieben, oder abbrechen.' })),
        actions: [{ label: 'Abbrechen', onClick: function () { fin(null); } }, { label: 'Verschieben', onClick: function () { fin([{ pin: pin, ort: where }]); } },
          { label: 'Zusätzlich eintragen', kind: 'primary', closes: false, onClick: function (api) { api.close(); attSplit(pin, where, D).then(fin); } }] });
    });
  }
  function attSplit(pin, where, D) {
    return new Promise(function (resolve) {
      const cfg = D.cfg, who = (D.employees.filter(function (e) { return e.pin === pin; })[0] || {}).name || pin;
      const rows = D.entries[pin].map(function (s) { return { ort: s.ort, a: s.beginn, e: s.ende, old: true }; }).concat([{ ort: where, a: cfg.places[where].start, e: cfg.places[where].end, old: false }]);
      const info = h('div', { class: 'att-warn' });
      const upd = function () {
        const c = attCheck(rows.map(function (r) { return { beginn: r.ia.value || '00:00', ende: r.ie.value || '00:00' }; }));
        info.replaceChildren.apply(info, [h('b', { text: 'Zusammen ' + String(c.hours).replace('.', ',') + ' Std' })].concat(c.warn.map(function (w) { return h('div', { class: 'att-wl', text: '⚠ ' + w + ' Du kannst trotzdem speichern.' }); })));
      };
      const lines = rows.map(function (r, i) {
        r.ia = h('input', { class: 'input', type: 'time', value: r.a, 'aria-label': r.ort + ' Beginn' }); r.ie = h('input', { class: 'input', type: 'time', value: r.e, 'aria-label': r.ort + ' Ende' });
        r.ia.addEventListener('input', upd); r.ie.addEventListener('input', upd);
        return h('div', { class: 'att-splitrow' + DP.placeClass(r.ort) }, h('span', { class: 'att-dot' }), h('b', { text: r.ort }), r.old ? h('small', { class: 'muted', text: 'schon eingetragen' }) : h('small', { class: 'muted', text: 'neu' }), h('div', { class: 'row' }, r.ia, ' – ', r.ie));
      });
      upd();
      DP.modal({ title: who + ': zwei Standorte', wide: true, body: h('div', { class: 'stack-sm' }, h('p', { class: 'muted small', text: 'Lege fest, von wann bis wann er an welchem Standort war. In „Deine Unterlagen“ steht der Tag dann mit beiden Standorten und der Summe der Stunden.' }), lines, info),
        actions: [{ label: 'Abbrechen', onClick: function () { resolve(null); } }, { label: 'Speichern', kind: 'primary', closes: false, onClick: function (api) {
          if (rows.some(function (r) { return !r.ia.value || !r.ie.value; })) { DP.toast('Bitte alle Uhrzeiten angeben.', 'error'); return; }
          api.close();
          resolve(rows.map(function (r) { return r.old ? { pin: pin, from: r.ort, ort: r.ort, beginn: r.ia.value, ende: r.ie.value } : { pin: pin, ort: r.ort, mode: 'add', beginn: r.ia.value, ende: r.ie.value }; }));
        } }] });
    });
  }
  // Namensliste im Blatt: Mitarbeiter ausblenden oder wieder einblenden (nur hier, die Mitarbeiterliste des Systems bleibt unberührt)
  function attListDialog() {
    const A = state.att, all = (A.data && A.data.allEmployees) || [], pick = {};
    all.forEach(function (e) { pick[e.pin] = !e.hidden; });
    const info = h('div', { class: 'att-picknote' }), box = h('div', { class: 'att-picklist' }), q = h('input', { class: 'input', type: 'search', placeholder: 'Suchen …', 'aria-label': 'Mitarbeiter suchen' });
    const draw = function () {
      const s = q.value.trim().toLowerCase(); box.textContent = '';
      all.filter(function (e) { return !s || e.name.toLowerCase().indexOf(s) !== -1; }).forEach(function (e) {
        const cb = h('input', { type: 'checkbox', id: 'attl_' + e.pin }); cb.checked = !!pick[e.pin];
        cb.addEventListener('change', function () { pick[e.pin] = cb.checked; count(); });
        box.append(h('label', { class: 'att-pickrow', for: 'attl_' + e.pin }, cb, h('span', { text: e.name })));
      });
      count();
    };
    const count = function () { const n = all.filter(function (e) { return pick[e.pin]; }).length; info.textContent = n + ' von ' + all.length + ' stehen im Blatt'; };
    const set = function (fn) { all.forEach(function (e) { pick[e.pin] = fn(e); }); draw(); };
    q.addEventListener('input', draw); draw();
    DP.modal({ title: 'Namen im Blatt', wide: true, body: h('div', { class: 'stack-sm' },
      h('p', { class: 'muted small', text: 'Hake an, wer im Anwesenheits-Blatt stehen soll. Das gilt nur hier: die Mitarbeiter bleiben im System. Wer in diesem Monat schon Einträge oder Bemerkungen hat, bleibt sichtbar, damit keine Stunden verloren gehen.' }),
      h('div', { class: 'row wrap' }, q, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Alle', onclick: function () { set(function () { return true; }); } }), h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Keine', onclick: function () { set(function () { return false; }); } })), info, box),
      actions: [{ label: 'Abbrechen' }, { label: 'Speichern', kind: 'primary', closes: false, onClick: async function (api) {
        const r = await adm('adminAttHideSet', { pins: all.filter(function (e) { return !pick[e.pin]; }).map(function (e) { return e.pin; }) });
        if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Nicht gespeichert.', 'error'); return; }
        api.close(); A.cache = null; await loadAtt(A.date, true); renderTab(); DP.toast('Gespeichert.');
      } }] });
  }
  async function attTeamDialog() {
    const A = state.att, month = A.date.slice(0, 7);
    if (!A.data.team && A.data.prevTeam == null && A.cache) {   // das Team des Vormonats wird erst jetzt geholt, nicht bei jedem Laden
      const pr = await adm('adminAttPrevTeam', { month: month });
      if (pr.status === 'success') { A.cache.base.prevTeam = pr.prevTeam; A.data.prevTeam = pr.prevTeam; }
    }
    const D = A.data, base = D.team || D.prevTeam || [], pick = {};
    D.employees.forEach(function (e) { pick[e.pin] = base.indexOf(e.pin) !== -1; });
    const q = h('input', { class: 'input', type: 'search', placeholder: 'Suchen …', 'aria-label': 'Mitarbeiter suchen' }), list = h('div', { class: 'att-teamlist' });
    const count = h('b', {});
    const draw = function () {
      const s = q.value.trim().toLowerCase();
      list.replaceChildren.apply(list, D.employees.filter(function (e) { return !s || e.name.toLowerCase().indexOf(s) !== -1; }).map(function (e) {
        const cb = h('input', { type: 'checkbox', id: 'attt_' + e.pin }); cb.checked = !!pick[e.pin]; cb.addEventListener('change', function () { pick[e.pin] = cb.checked; upd(); });
        return h('label', { class: 'row', for: 'attt_' + e.pin, style: 'gap:10px;padding:6px 4px;cursor:pointer' }, cb, h('span', { text: e.name }));
      }));
      upd();
    };
    const upd = function () { count.textContent = Object.keys(pick).filter(function (p) { return pick[p]; }).length + ' von ' + D.employees.length + ' ausgewählt'; };
    q.addEventListener('input', draw);
    const set = function (fn) { D.employees.forEach(function (e) { pick[e.pin] = fn(e.pin); }); draw(); };
    const prev = D.prevTeam && D.prevTeam.length ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Vormonat übernehmen (' + D.prevTeam.length + ')', onclick: function () { set(function (p) { return D.prevTeam.indexOf(p) !== -1; }); } }) : null;
    draw();
    DP.modal({ title: 'Team für ' + PD.monthLabel(month + '-01'), wide: true, body: h('div', { class: 'stack-sm' },
      h('p', { class: 'muted small', text: 'Wähle die Mitarbeiter, die in diesem Monat arbeiten. Die Liste im Brett zeigt dann nur sie (mit einem Schalter „Alle zeigen“). Wer an einem Tag schon eingetragen ist, bleibt immer sichtbar.' }),
      h('div', { class: 'row wrap' }, prev, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Alle', onclick: function () { set(function () { return true; }); } }), h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Keine', onclick: function () { set(function () { return false; }); } }), count), q, list),
      actions: [{ label: 'Abbrechen' }, { label: 'Team aufheben', closes: false, onClick: async function (api) { const r = await adm('adminAttTeamSet', { month: month, pins: null }); if (r.status === 'success') { api.close(); A.showAll = false; A.cache = null; await loadAtt(A.date, true); renderTab(); } } },
        { label: 'Speichern', kind: 'primary', closes: false, onClick: async function (api) {
          const pins = Object.keys(pick).filter(function (p) { return pick[p]; });
          if (!pins.length) { DP.toast('Bitte mindestens einen Mitarbeiter wählen (oder „Team aufheben“).', 'error'); return; }
          const r = await adm('adminAttTeamSet', { month: month, pins: pins });
          if (r.status === 'success') { api.close(); A.showAll = false; A.cache = null; await loadAtt(A.date, true); renderTab(); } else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Nicht gespeichert.', 'error');
        } }] });
  }
  function attendView() {
    setTitle('Anwesenheit');
    const A = state.att;
    if (!A || !A.data) return h('div', { class: 'empty' }, h('span', { class: 'spinner' }));
    if ((A.dragging || A.colDrag) && A.el) return A.el;   // während des Ziehens nicht neu aufbauen
    if (A.view === 'places') return attPlacesView();
    if (A.view === 'people') return attPeopleView();
    const D = A.data, cfg = D.cfg, emps = D.employees, date = A.date;
    const nm = {}; emps.forEach(function (e) { nm[e.pin] = e.name; });
    const absOf = {}; D.absences.forEach(function (a) { absOf[a.pin] = a; });
    const segs = function (pin) { return D.entries[pin] || []; };
    const hasAt = function (pin, pl) { return segs(pin).some(function (s) { return s.ort === pl; }); };
    const selPins = function () { return Object.keys(A.sel).filter(function (p) { return A.sel[p]; }); };
    const go = function (iso) { A.sel = {}; loadAtt(iso).then(function () { renderTab(); }); };
    const refetch = async function () { A.cache = null; await loadAtt(date, true); renderTab(); };
    const reload = async function () { /* save() hat schon neu gezeichnet */ };

    // --- Aktionen ---
    const save = async function (entries) {   // wirkt sofort, der Server speichert im Hintergrund
      attApply(date, entries); attBuildDay(); attEnqueue(date, entries); renderTab(); return true;
    };
    const place = async function (items, where) {
      const pc = cfg.places[where];
      items = items.filter(function (it) { return it.from !== where && !(!it.from && hasAt(it.pin, where)); });
      if (!items.length) return;
      const here = emps.filter(function (e) { return hasAt(e.pin, where); }).length, incoming = items.filter(function (it) { return !hasAt(it.pin, where); }).length, free = Math.max(0, pc.slots - here);
      if (incoming > free) {
        if (cfg.mode === 'block') { DP.toast(where + ' hat nur ' + pc.slots + ' Plätze (' + free + ' frei).', 'error'); return; }
        if (cfg.mode === 'ask' && !(await DP.confirm('Mehr als ' + pc.slots + ' Plätze?', where + ' hat ' + pc.slots + ' Plätze, davon ' + free + ' frei. Trotzdem ' + incoming + (incoming === 1 ? ' Mitarbeiter' : ' Mitarbeiter') + ' eintragen?', 'Trotzdem eintragen'))) return;
      }
      const away = items.filter(function (it) { return !it.from && absOf[it.pin]; });
      if (away.length && !(await DP.confirm('Krank oder im Urlaub?', away.map(function (it) { return nm[it.pin]; }).join(', ') + (away.length === 1 ? ' ist' : ' sind') + ' an diesem Tag ' + (away.length === 1 ? (absOf[away[0].pin].type === 'krank' ? 'krank' : 'im Urlaub') : 'krank oder im Urlaub') + ' gemeldet. Trotzdem eintragen?', 'Trotzdem eintragen'))) return;
      A.sel = {};
      const out = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.from) { out.push({ pin: it.pin, from: it.from, ort: where }); continue; }
        if (segs(it.pin).length) { const x = await attTwoPlaces(it.pin, where, D); if (x === null) continue; Array.prototype.push.apply(out, x); continue; }
        out.push({ pin: it.pin, ort: where });
      }
      if (!out.length) { renderTab(); return; }
      if (await save(out)) await reload();
    };
    const remove = async function (items) {
      items = items.filter(function (it) { return it.from; });
      if (!items.length) return;
      if (await save(items.map(function (it) { return { pin: it.pin, from: it.from, ort: '' }; }))) await reload();
    };
    const editSeg = function (pin, seg) {
      const sel = h('select', { class: 'input', id: 'att_ort' }, cfg.order.map(function (o) { return h('option', { value: o, text: o }); })); sel.value = seg.ort;
      const a = h('input', { class: 'input', id: 'att_a', type: 'time', value: seg.beginn }), c = h('input', { class: 'input', id: 'att_c', type: 'time', value: seg.ende });
      DP.modal({ title: nm[pin], body: h('div', { class: 'stack-sm' }, field('Standort', sel, 'att_ort'), h('div', { class: 'form-grid' }, field('Beginn', a, 'att_a'), field('Ende', c, 'att_c')),
        segs(pin).length > 1 ? h('p', { class: 'muted small', text: 'Dieser Mitarbeiter hat an diesem Tag zwei Standorte. Das ändert nur diesen Abschnitt.' }) : null, h('p', { class: 'muted small', text: PD.short(date) + ' · nur in deiner Erfassung, bis du für den Chef freigibst.' })),
        actions: [{ label: 'Abbrechen' }, { label: 'Entfernen', kind: 'danger', onClick: function () { return remove([{ pin: pin, from: seg.ort }]); } },
          { label: 'Speichern', kind: 'primary', closes: false, onClick: async function (api) { if (!a.value || !c.value) { DP.toast('Bitte beide Uhrzeiten angeben.', 'error'); return; } api.close(); if (await save([{ pin: pin, from: seg.ort, ort: sel.value, beginn: a.value, ende: c.value }])) await reload(); } }] });
    };

    // --- Ziehen und Ablegen ---
    const draggable = function (el, getItems) {
      el.draggable = true;
      el.addEventListener('dragstart', function (e) {
        A.dragPins = getItems(); A.dragging = true; A.el = root;
        e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', A.dragPins.map(function (x) { return x.pin; }).join(',')); } catch (err) { /* egal */ }
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', function () { A.dragging = false; root.querySelectorAll('.att-over').forEach(function (x) { x.classList.remove('att-over'); }); renderTab(); });
    };
    const target = function (el, fn) {
      el.addEventListener('dragover', function (e) { if (A.dragging) { e.preventDefault(); el.classList.add('att-over'); } });
      el.addEventListener('dragleave', function (e) { if (!el.contains(e.relatedTarget)) el.classList.remove('att-over'); });
      el.addEventListener('drop', function (e) { e.preventDefault(); el.classList.remove('att-over'); const items = A.dragPins.slice(); A.dragging = false; fn(items); });
    };
    const dots = function (pin) { return segs(pin).map(function (s) { return h('i', { class: 'att-dot' + DP.placeClass(s.ort), title: s.ort }); }); };
    const remN = {}; ((A.cache && A.cache.rems) || []).forEach(function (x) { if (x.iso === date) (remN[x.pin] = remN[x.pin] || []).push('Am ' + x.iso.slice(8, 10) + '.' + x.iso.slice(5, 7) + '. ' + x.text); });
    const remBtn = function (pin) {
      const t = remN[pin] || [], b = h('button', { type: 'button', class: 'att-rm' + (t.length ? ' has' : ''), title: t.length ? t.join('\n') : 'Bemerkung (zu spät, nicht abgemeldet, Freitext)', 'aria-label': 'Bemerkung für ' + (nm[pin] || pin) }, t.length ? '💬 ' + t.length : '💬');
      b.draggable = false; b.addEventListener('click', function (ev) { ev.stopPropagation(); attRemDialog(pin); }); return b;
    };
    const poolCard = function (pin) {
      const on = !!A.sel[pin], done = segs(pin).length || absOf[pin];
      const c = h('div', { class: 'att-card' + (on ? ' sel' : '') + (done ? ' done' : ''), dataset: { pin: pin }, title: 'Klicken = auswählen, ziehen = eintragen' }, h('span', { class: 'att-nm', text: nm[pin] || pin }), dots(pin));
      if (absOf[pin]) c.append(h('i', { class: 'att-tag ' + absOf[pin].type, text: absOf[pin].type === 'krank' ? 'krank' : 'Urlaub' }));
      c.append(remBtn(pin));
      draggable(c, function () { if (!A.sel[pin]) A.sel = {}; return (A.sel[pin] ? selPins() : [pin]).map(function (p) { return { pin: p, from: '' }; }); });
      c.addEventListener('click', function (ev) {
        if (segs(pin).length && !ev.ctrlKey && !ev.shiftKey && !ev.metaKey) { editSeg(pin, segs(pin)[0]); return; }
        const order = Array.prototype.map.call(root.querySelectorAll('.att-pool .att-card'), function (x) { return x.dataset.pin; });
        if (ev.shiftKey && A.last && order.indexOf(A.last) !== -1) { const i = order.indexOf(A.last), j = order.indexOf(pin); order.slice(Math.min(i, j), Math.max(i, j) + 1).forEach(function (p) { if (!segs(p).length && !absOf[p]) A.sel[p] = true; }); }
        else A.sel[pin] = !A.sel[pin];
        A.last = pin; renderTab();
      });
      return c;
    };
    const slotCard = function (pin, seg, pl, extra) {
      const def = cfg.places[pl], odd = segs(pin).length > 1 || (def && (seg.beginn !== def.start || seg.ende !== def.end));
      const c = h('div', { class: 'att-card' + (extra ? ' extra' : ''), dataset: { pin: pin, ort: pl }, title: 'Klicken = Zeit ändern, ziehen = verschieben' }, h('span', { class: 'att-nm', text: nm[pin] || pin }), odd ? h('small', { class: 'att-sub', text: seg.beginn + '–' + seg.ende }) : null, remBtn(pin), h('u', { class: 'att-x', title: 'Zurück in die Liste', text: '✕' }));
      draggable(c, function () { return [{ pin: pin, from: pl }]; });
      c.addEventListener('click', function (ev) { if (ev.target.classList.contains('att-x')) { remove([{ pin: pin, from: pl }]); return; } editSeg(pin, seg); });
      return c;
    };

    // --- Werkzeugleiste ---
    const iso = date, di = D.days;
    const prev = h('button', { type: 'button', class: 'btn btn-secondary btn-icon', 'aria-label': 'Vorheriger Tag', text: '‹' }), next = h('button', { type: 'button', class: 'btn btn-secondary btn-icon', 'aria-label': 'Nächster Tag', text: '›' });
    prev.addEventListener('click', function () { go(PD.add(iso, -1)); }); next.addEventListener('click', function () { go(PD.add(iso, 1)); });
    const picker = h('input', { class: 'input att-picker', type: 'date', value: iso, 'aria-label': 'Datum wählen' }); picker.addEventListener('change', function () { if (picker.value) go(picker.value); });
    const clear = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Tag leeren' });
    clear.addEventListener('click', async function () {
      const pins = Object.keys(D.entries).filter(function (p) { return segs(p).length; }); if (!pins.length) { DP.toast('An diesem Tag ist nichts eingetragen.', 'x'); return; }
      if (!(await DP.confirm('Tag leeren?', 'Alle Einträge von ' + pins.length + (pins.length === 1 ? ' Mitarbeiter' : ' Mitarbeitern') + ' am ' + PD.short(iso) + ' werden aus der Erfassung entfernt.', 'Tag leeren', 'danger'))) return;
      if (await save(pins.map(function (p) { return { pin: p, ort: '' }; }))) await reload();
    });
    const settings = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Einstellung' }); settings.addEventListener('click', function () { attSettings(); });
    const rel = h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Für Chef freigeben …' }); rel.addEventListener('click', function () { attRelease(); });
    const bar = h('div', { class: 'att-bar' }, attSwitch(), prev, h('div', { class: 'att-date', text: PD.short(iso) + ' ' + iso.slice(0, 4) }), next, picker, h('span', { class: 'att-badge', text: 'Entwurf · nur für dich sichtbar' }), h('span', { class: 'att-sync', text: attSyncText() }), h('div', { class: 'grow' }), clear, settings, rel);

    // --- Mitarbeiter-Liste mit Team und Gruppen ---
    const team = D.team, teamOn = !!team && !A.showAll;
    const visible = emps.filter(function (e) { return !teamOn || team.indexOf(e.pin) !== -1 || segs(e.pin).length || A.sel[e.pin]; });
    const q = (A.search || '').trim().toLowerCase();
    const shown = visible.filter(function (e) { return !q || e.name.toLowerCase().indexOf(q) !== -1; });
    shown.sort(function (a, b) { return ((segs(a.pin).length || absOf[a.pin]) ? 1 : 0) - ((segs(b.pin).length || absOf[b.pin]) ? 1 : 0) || a.name.localeCompare(b.name, 'de'); });
    const open = visible.filter(function (e) { return !segs(e.pin).length && !absOf[e.pin]; });
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Suchen …', 'aria-label': 'Mitarbeiter suchen', value: A.search || '' });
    search.addEventListener('input', function () { A.search = search.value; renderTab(); const s = document.querySelector('.att-pool input[type=search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } });
    const list = h('div', { class: 'att-list' }, shown.map(function (e) { return poolCard(e.pin); }));
    target(list, function (items) { remove(items); });
    list.addEventListener('mousedown', function (e) {   // Rechteck aufziehen
      if (e.button !== 0 || e.target.closest('.att-card, .att-group')) return;
      const x0 = e.clientX, y0 = e.clientY, box = h('div', { class: 'att-marquee' }); document.body.appendChild(box);
      const move = function (m) {
        const l = Math.min(x0, m.clientX), t = Math.min(y0, m.clientY), w = Math.abs(m.clientX - x0), hh = Math.abs(m.clientY - y0);
        box.style.cssText = 'left:' + l + 'px;top:' + t + 'px;width:' + w + 'px;height:' + hh + 'px';
        list.querySelectorAll('.att-card').forEach(function (c) { const r = c.getBoundingClientRect(), hit = r.right > l && r.left < l + w && r.bottom > t && r.top < t + hh && !c.classList.contains('done'); c.classList.toggle('sel', hit); });
      };
      const up = function () { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); box.remove(); A.sel = {}; list.querySelectorAll('.att-card.sel').forEach(function (c) { A.sel[c.dataset.pin] = true; }); renderTab(); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); e.preventDefault();
    });
    const n = selPins().length;
    const saveGroups = async function (groups) { const r = await adm('adminAttGroupSet', { groups: groups }); if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Nicht gespeichert.', 'error'); return false; } await refetch(); return true; };
    const makeGroup = function () {
      const pins = selPins(), name = h('input', { class: 'input', id: 'attg_name', type: 'text', maxlength: '24', placeholder: 'zum Beispiel Farmsen-Team (kann leer bleiben)' });
      DP.modal({ title: 'Gruppe bilden', body: h('div', { class: 'stack-sm' }, h('p', { class: 'muted small', text: pins.map(function (p) { return nm[p]; }).join(', ') + '. Die Gruppe erscheint als Kasten in der Liste. Du ziehst sie auf einen Standort, und alle sind drin.' }), field('Name der Gruppe', name, 'attg_name')),
        actions: [{ label: 'Abbrechen' }, { label: 'Gruppe bilden', kind: 'primary', onClick: function () {
          const rest = (D.groups || []).map(function (g) { return { name: g.name, pins: g.pins.filter(function (p) { return pins.indexOf(p) === -1; }) }; }).filter(function (g) { return g.pins.length >= 2; });
          return saveGroups(rest.concat([{ name: name.value, pins: pins }]));
        } }] });
    };
    const groupBox = function (g) {
      const members = g.pins.filter(function (p) { return nm[p]; }), todo = members.filter(function (p) { return !segs(p).length && !absOf[p]; });
      const gx = h('u', { class: 'att-gx', title: 'Gruppe auflösen', text: '✕' });
      const box = h('div', { class: 'att-group', title: 'Ganze Gruppe ziehen, oder antippen zum Auswählen' }, h('div', { class: 'att-gh' }, h('b', { text: g.name || members.map(function (p) { return nm[p].split(' ')[0]; }).join(' + ') }), gx),
        members.map(function (p) { return h('div', { class: 'att-gm' + (segs(p).length ? ' done' : ''), text: nm[p] }); }), h('small', { class: 'muted', text: todo.length ? todo.length + ' noch offen' : 'alle eingetragen' }));
      draggable(box, function () { A.sel = {}; return members.map(function (p) { return { pin: p, from: '' }; }); });
      box.addEventListener('click', function (ev) {
        if (ev.target === gx) { DP.confirm('Gruppe auflösen?', 'Die Mitarbeiter bleiben, nur der Kasten verschwindet.', 'Auflösen').then(function (ok) { if (ok) saveGroups((D.groups || []).filter(function (x) { return x.id !== g.id; }).map(function (x) { return { name: x.name, pins: x.pins }; })); }); return; }
        A.sel = {}; todo.forEach(function (p) { A.sel[p] = true; }); renderTab();
      });
      return box;
    };
    const groups = (D.groups || []).filter(function (g) { return g.pins.some(function (p) { return nm[p]; }); });
    const teamLine = team ? h('div', { class: 'att-teamline' }, h('span', { text: 'Team ' + team.length + ' von ' + emps.length }), h('button', { type: 'button', class: 'att-link', text: A.showAll ? 'Nur Team zeigen' : 'Alle zeigen', onclick: function () { A.showAll = !A.showAll; renderTab(); } }), h('button', { type: 'button', class: 'att-link', text: 'ändern', onclick: attTeamDialog }))
      : h('div', { class: 'att-teamline' }, h('button', { type: 'button', class: 'att-link', text: 'Team des Monats wählen', title: 'Nur die Mitarbeiter anzeigen, die in diesem Monat arbeiten', onclick: attTeamDialog }));
    teamLine.append(h('button', { type: 'button', class: 'att-link', text: 'Liste bearbeiten', title: 'Mitarbeiter nur in diesem Blatt aus- oder einblenden (das System bleibt unberührt)', onclick: attListDialog }));
    const pool = h('div', { class: 'att-pool' }, h('div', { class: 'att-ph' }, h('strong', { text: 'Mitarbeiter' }), h('span', { class: 'att-n', text: String(visible.length) })),
      teamLine, h('div', { class: 'att-open', text: open.length ? open.length + ' noch offen' : 'alle eingetragen' }), search,
      h('div', { class: 'att-hint' }, h('b', { text: 'Strg / Shift' }), ' = mehrere wählen, oder mit der Maus ein Rechteck aufziehen. Dann auf einen Standort ziehen.'),
      n ? h('div', { class: 'att-selbar' }, h('b', { text: n + ' ausgewählt' }), h('div', { class: 'row wrap' }, n >= 2 ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Gruppe bilden', onclick: makeGroup }) : null, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Aufheben', onclick: function () { A.sel = {}; renderTab(); } }))) : null,
      groups.length ? h('div', { class: 'att-groups' }, groups.map(groupBox)) : null, list);

    // --- Spalten ---
    // Standorte per Maus umsortieren: die Spalte an der Kopfzeile ziehen und neben eine andere fallen lassen
    const reorder = function (from, to, after) {
      const full = A.cache && A.cache.cfgAll; if (!full || from === to) { renderTab(); return; }
      const ord = full.order.filter(function (n) { return n !== from; }), k = ord.indexOf(to); if (k === -1) { renderTab(); return; }
      ord.splice(after ? k + 1 : k, 0, from);
      if (ord.join('|') === full.order.join('|')) { renderTab(); return; }
      full.order = ord; A.dirty = true; attBuildDay(); renderTab();
      const real = ord.filter(function (n) { return !full.places[n].unknown; });
      A.orderP = (A.orderP || Promise.resolve()).then(async function () {
        const r = await adm('adminAttPlaceOrder', { order: real });
        if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Reihenfolge nicht gespeichert.', 'error'); A.cache = null; await loadAtt(A.date, true); renderTab(); }
      });
    };
    const cols = cfg.order.map(function (pl) {
      const pc = cfg.places[pl], inHere = emps.filter(function (e) { return hasAt(e.pin, pl); }), cnt = inHere.length, slots = [];
      inHere.forEach(function (e, i) { slots.push(slotCard(e.pin, segs(e.pin).filter(function (s) { return s.ort === pl; })[0], pl, i >= pc.slots)); });
      for (let i = cnt; i < pc.slots; i++) slots.push(h('div', { class: 'att-free', text: 'Platz frei' }));
      const head = h('div', { class: 'att-ch att-colh', draggable: 'true', title: 'Zum Umsortieren ziehen' }, h('b', { text: pl }), h('small', { text: pc.start + '–' + pc.end + (pc.hidden ? ' · ausgeblendet' : '') }), h('span', { class: 'att-grip', 'aria-hidden': 'true', text: '⠿' }));
      const col = h('section', { class: 'att-col' + DP.placeClass(pl), dataset: { place: pl } },
        head,
        h('div', { class: 'att-cb' }, h('span', { class: 'att-cnt' + (cnt < pc.slots ? ' low' : cnt > pc.slots ? ' over' : ' full'), text: cnt + ' von ' + pc.slots }), slots,
          n ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm att-here', text: '+ Auswahl hierher (' + n + ')', onclick: function () { place(selPins().map(function (p) { return { pin: p, from: '' }; }), pl); } }) : null));
      target(col, function (items) { place(items, pl); });
      head.addEventListener('dragstart', function (e) {
        A.colDrag = pl; A.el = root; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'spalte:' + pl); } catch (err) { /* egal */ }
        col.classList.add('att-colmove');
      });
      head.addEventListener('dragend', function () { A.colDrag = null; root.querySelectorAll('.att-dropL,.att-dropR,.att-colmove').forEach(function (x) { x.classList.remove('att-dropL', 'att-dropR', 'att-colmove'); }); renderTab(); });
      col.addEventListener('dragover', function (e) {
        if (!A.colDrag || A.colDrag === pl) return; e.preventDefault();
        const r = col.getBoundingClientRect(), right = e.clientX > r.left + r.width / 2; col.classList.toggle('att-dropR', right); col.classList.toggle('att-dropL', !right);
      });
      col.addEventListener('dragleave', function (e) { if (!col.contains(e.relatedTarget)) col.classList.remove('att-dropL', 'att-dropR'); });
      col.addEventListener('drop', function (e) {
        if (!A.colDrag) return; e.preventDefault();
        const from = A.colDrag, right = col.classList.contains('att-dropR'); col.classList.remove('att-dropL', 'att-dropR'); A.colDrag = null; reorder(from, pl, right);
      });
      return col;
    });

    // --- Monatsstreifen ---
    const strip = h('div', { class: 'att-strip' }); let filled = 0;
    for (let i = 1; i <= di; i++) {
      const d = iso.slice(0, 8) + String(i).padStart(2, '0'), c = D.counts[d] || 0; if (c) filled++;
      const b = h('button', { type: 'button', class: 'att-day' + (c ? ' on' : '') + (d === iso ? ' cur' : '') + (d === PD.today() ? ' today' : ''), title: PD.short(d) + (c ? ': ' + c + ' eingetragen' : ': noch nichts') }, String(i));
      b.addEventListener('click', function () { go(d); }); strip.append(b);
    }
    const root = h('div', { class: 'att' }, bar, h('div', { class: 'att-main' }, pool, h('div', { class: 'att-board' }, cols)),
      h('div', { class: 'att-month' }, strip, h('div', { class: 'att-leg muted small', text: PD.monthLabel(iso.slice(0, 8) + '01') + ': ' + filled + ' von ' + di + ' Tagen erfasst' })),
      h('p', { class: 'muted small', text: 'Alles, was du hier einträgst, steht in der Spalte „Deine Unterlagen“ des Mitarbeiters und ist nur für dich sichtbar. Erst „Für Chef freigeben“ macht es zum Endstand für den Chef (pro Mitarbeiter und Monat). Hat ein Mitarbeiter schon selbst gesendet, vergleichst du im Chef-Bericht. Krank und Urlaub trägst du im Dienstplan ein, sie erscheinen hier als Hinweis an der Karte.' }));
    A.el = root;
    return root;
  }

  // ---------- Anwesenheit: Standort-Übersicht und Mitarbeiter-Blätter ----------
  function attSwitch() {
    const A = state.att, cur = A.view || 'board';
    return h('div', { class: 'seg', role: 'group', 'aria-label': 'Ansicht' }, [['board', 'Brett'], ['places', 'Standorte'], ['people', 'Mitarbeiter']].map(function (x) {
      const b = h('button', { type: 'button', class: cur === x[0] ? 'active' : '', text: x[1] });
      b.addEventListener('click', function () {
        A.view = x[0]; A.rmonth = A.rmonth || A.date.slice(0, 7);
        if (x[0] === 'board') { renderTab(); return; }
        if (A.report && !A.dirty && A.report.month === A.rmonth) { renderTab(); return; }
        A.report = null; renderTab(); attLoadReport().then(function () { renderTab(); });
      });
      return b;
    }));
  }
  async function attLoadReport() {
    const A = state.att; A.rmonth = A.rmonth || A.date.slice(0, 7);
    await attFlushAll();
    const r = await adm('adminAttReport', { month: A.rmonth });
    if (r.status === 'success') { A.report = r; A.dirty = false; } else if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Nicht geladen.', 'error');
  }
  function attIndex(R) {
    const nm = {}, byDay = {}, byPin = {}, abs = {}, rem = {}, recorded = {};
    R.employees.forEach(function (e) { nm[e.pin] = e.name; });
    R.rows.forEach(function (x) { (byDay[x.iso] = byDay[x.iso] || []).push(x); const bp = byPin[x.pin] = byPin[x.pin] || {}; (bp[x.iso] = bp[x.iso] || []).push(x); recorded[x.iso] = (recorded[x.iso] || 0) + 1; });
    R.absences.forEach(function (a) { let t = a.from, g = 0; while (t <= a.to && g++ < 400) { if (t.slice(0, 7) === R.month) (abs[a.pin] = abs[a.pin] || {})[t] = a.type; t = PD.add(t, 1); } });
    R.remarks.forEach(function (x) { (rem[x.iso] = rem[x.iso] || []).push(x); });
    return { nm: nm, byDay: byDay, byPin: byPin, abs: abs, rem: rem, recorded: recorded };
  }
  function attReportBar(title, extra) {
    const A = state.att, m = A.rmonth + '-01';
    const mv = function (n) { A.rmonth = PD.monthAdd(m, n).slice(0, 7); A.report = null; renderTab(); attLoadReport().then(function () { renderTab(); }); };
    const prev = h('button', { type: 'button', class: 'btn btn-secondary btn-icon', 'aria-label': 'Vorheriger Monat', text: '‹' }), next = h('button', { type: 'button', class: 'btn btn-secondary btn-icon', 'aria-label': 'Nächster Monat', text: '›' });
    prev.addEventListener('click', function () { mv(-1); }); next.addEventListener('click', function () { mv(1); });
    return h('div', { class: 'att-bar' }, attSwitch(), prev, h('div', { class: 'att-date', text: PD.monthLabel(m) }), next, h('span', { class: 'att-badge', text: 'nur für dich sichtbar' }), h('div', { class: 'grow' }), extra || null);
  }
  function attPrint(content) {
    const root = h('div', { class: 'att-printroot' }, content); document.body.appendChild(root); document.body.classList.add('att-printing');
    const done = function () { window.removeEventListener('afterprint', done); document.body.classList.remove('att-printing'); root.remove(); };
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); }, 60);
  }
  const attTimes = function (list) {
    const seen = {}; list.forEach(function (x) { seen[x.beginn + '–' + x.ende] = true; });
    const k = Object.keys(seen); return k.length === 1 ? k[0] : null;
  };
  function attPlaceTable(R, X, pl, print) {
    const pc = R.cfg.places[pl], N0 = pc.slots; let N = N0;
    const dayList = function (iso) { return (X.byDay[iso] || []).filter(function (r) { return r.ort === pl; }).sort(function (a, c) { return (X.nm[a.pin] || '').localeCompare(X.nm[c.pin] || '', 'de'); }); };
    for (let i = 1; i <= R.days; i++) N = Math.max(N, dayList(R.month + '-' + String(i).padStart(2, '0')).length);
    const head = h('tr', {}, h('th', { text: 'Datum' }), Array.from({ length: N }, function (_, k) { return h('th', { text: 'Mitarbeiter ' + (k + 1) }); }), h('th', { text: 'Arbeitszeit' }), h('th', { text: 'Bemerkungen' }));
    let shifts = 0, hours = 0, reds = 0; const body = h('tbody', {});
    for (let i = 1; i <= R.days; i++) {
      const iso = R.month + '-' + String(i).padStart(2, '0'), list = dayList(iso), rec = !!X.recorded[iso], we = PD.weekday(iso) >= 5;
      const tds = [h('td', { class: 'd', text: PD.short(iso) })];
      for (let k = 0; k < N; k++) {
        const x = list[k];
        if (x) { shifts++; hours += x.stunden; tds.push(h('td', {}, print ? h('span', { text: X.nm[x.pin] || x.pin }) : h('button', { type: 'button', class: 'att-nmb', text: X.nm[x.pin] || x.pin, title: 'Blatt öffnen', onclick: function () { attSheet(x.pin); } }))); }
        else if (k < N0 && rec) { reds++; tds.push(h('td', { class: 'red', title: 'Platz an diesem Tag nicht besetzt', text: 'nicht besetzt' })); }
        else tds.push(h('td', { class: 'na' }));
      }
      const one = attTimes(list), tm = !list.length ? '' : one ? one : list.map(function (x) { return (X.nm[x.pin] || x.pin).split(' ')[0] + ' ' + x.beginn + '–' + x.ende; }).join('\n');
      tds.push(h('td', { class: 'tm', text: tm }));
      tds.push(h('td', { class: 'bm', text: (X.rem[iso] || []).filter(function (r) { return list.some(function (l) { return l.pin === r.pin; }); }).map(function (r) { return (X.nm[r.pin] || r.pin) + ': ' + r.text; }).join('; ') }));
      body.append(h('tr', { class: we ? 'we' : '' }, tds));
    }
    const foot = h('tfoot', {}, h('tr', {}, h('td', { colspan: String(N + 3), text: shifts + ' Einträge · ' + String(Math.round(hours * 100) / 100).replace('.', ',') + ' Std' + (reds ? ' · ' + reds + ' Plätze nicht besetzt' : '') })));
    return h('div', { class: 'att-sheetpage' }, h('div', { class: 'att-doc' }, h('b', { text: pl }), ' · ' + PD.monthLabel(R.month + '-01') + ' · Schicht ' + pc.start + '–' + pc.end + ' · ' + pc.slots + ' Plätze'), h('div', { class: 'att-tw' }, h('table', { class: 'att-tbl' }, h('thead', {}, head), body, foot)));
  }
  function attAllTable(R, X, print) {
    const head = h('tr', {}, h('th', { text: 'Datum' }), R.cfg.order.map(function (pl) { return h('th', { class: 'att-pth' + DP.placeClass(pl), text: pl }); }));
    const body = h('tbody', {}); let reds = 0;
    for (let i = 1; i <= R.days; i++) {
      const iso = R.month + '-' + String(i).padStart(2, '0'), rec = !!X.recorded[iso], tds = [h('td', { class: 'd', text: PD.short(iso) })];
      R.cfg.order.forEach(function (pl) {
        const list = (X.byDay[iso] || []).filter(function (r) { return r.ort === pl; }), slots = R.cfg.places[pl].slots, low = rec && list.length < slots;
        if (low) reds++;
        tds.push(h('td', { class: !rec ? 'na' : low ? 'redsoft' : '' }, list.map(function (x) { return h('div', {}, print ? (X.nm[x.pin] || x.pin) : h('button', { type: 'button', class: 'att-nmb', text: X.nm[x.pin] || x.pin, onclick: function () { attSheet(x.pin); } })); }), low ? h('div', { class: 'att-lack', text: list.length + ' von ' + slots }) : null));
      });
      body.append(h('tr', { class: PD.weekday(iso) >= 5 ? 'we' : '' }, tds));
    }
    return h('div', { class: 'att-sheetpage' }, h('div', { class: 'att-doc' }, h('b', { text: 'Alle Standorte' }), ' · ' + PD.monthLabel(R.month + '-01') + (reds ? ' · ' + reds + ' Standort-Tage nicht voll besetzt' : '')), h('div', { class: 'att-tw' }, h('table', { class: 'att-tbl' }, h('thead', {}, head), body)));
  }
  function attPlacesView() {
    setTitle('Anwesenheit');
    const A = state.att, R = A.report;
    if (!R || R.month !== A.rmonth) return h('div', { class: 'att' }, attReportBar(), h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    const X = attIndex(R); if (!A.rplace || (A.rplace !== '*' && !R.cfg.places[A.rplace])) A.rplace = '*';
    const chips = h('div', { class: 'att-chips' }, ['*'].concat(R.cfg.order).map(function (pl) {
      const b = h('button', { type: 'button', class: 'att-chip' + (A.rplace === pl ? ' on' : '') + (pl === '*' ? '' : DP.placeClass(pl)), text: pl === '*' ? 'Alle Standorte' : pl });
      b.addEventListener('click', function () { A.rplace = pl; renderTab(); }); return b;
    }));
    const content = () => A.rplace === '*' ? attAllTable(R, X, true) : attPlaceTable(R, X, A.rplace, true);
    const pr = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Drucken / PDF' }); pr.addEventListener('click', function () { attPrint(content()); });
    const prAll = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Alle Standorte drucken' }); prAll.addEventListener('click', function () { attPrint(R.cfg.order.map(function (pl) { return attPlaceTable(R, X, pl, true); })); });
    return h('div', { class: 'att' }, attReportBar('Standorte', h('div', { class: 'row wrap' }, pr, prAll)), chips,
      A.rplace === '*' ? attAllTable(R, X, false) : attPlaceTable(R, X, A.rplace, false),
      h('p', { class: 'muted small', text: 'Rot = der Platz war an diesem Tag nicht besetzt. Grau = an diesem Tag ist noch nichts eingetragen. Auf einen Namen tippen öffnet sein Blatt.' }));
  }
  function attSheetNode(pin, R, X, print) {
    const rows = X.byPin[pin] || {}, ab = X.abs[pin] || {}; let hours = 0, days = 0, k = 0, u = 0; const body = h('tbody', {});
    for (let i = 1; i <= R.days; i++) {
      const iso = R.month + '-' + String(i).padStart(2, '0'), xs = rows[iso] || [], a = ab[iso], rm = (X.rem[iso] || []).filter(function (r) { return r.pin === pin; }).map(function (r) { return 'Am ' + iso.slice(8, 10) + '.' + iso.slice(5, 7) + '. ' + r.text; }).join('; ');
      if (xs.length) days++; xs.forEach(function (x) { hours += x.stunden; }); if (!xs.length && a === 'krank') k++; if (!xs.length && a === 'urlaub') u++;
      if (print && !xs.length && !a) continue;   // im Ausdruck nur Tage mit Eintrag
      const make = function (x, first) {
        const tr = h('tr', { class: (PD.weekday(iso) >= 5 ? 'we ' : '') + (x ? '' : 'att-emptyrow') },
          h('td', { class: 'd', text: first ? PD.short(iso) : '' }), h('td', {}, x ? h('span', { class: 'att-pdot' + DP.placeClass(x.ort) }, '') : null, x ? ' ' + x.ort : a ? h('i', { class: 'att-tag ' + a, text: a === 'krank' ? 'krank' : 'Urlaub' }) : ''),
          h('td', { text: x ? x.beginn : '' }), h('td', { text: x ? x.ende : '' }), h('td', { class: 'num', text: x ? String(x.stunden).replace('.', ',') : '' }), h('td', { class: 'bm', text: first ? rm : '' }));
        if (!print) { tr.classList.add('att-click'); tr.addEventListener('click', function () { attEditRow(pin, iso, x); }); tr.title = 'Klicken zum Ändern'; }
        return tr;
      };
      if (xs.length) xs.forEach(function (x, j) { body.append(make(x, j === 0)); }); else body.append(make(null, true));
    }
    const foot = h('tfoot', {}, h('tr', {}, h('td', { colspan: '4', text: 'Summe · ' + days + (days === 1 ? ' Tag' : ' Tage') + (k ? ' · ' + k + ' krank' : '') + (u ? ' · ' + u + ' Urlaub' : '') }), h('td', { class: 'num', text: String(Math.round(hours * 100) / 100).replace('.', ',') }), h('td', { text: 'Std' })));
    return h('div', { class: 'att-sheetpage' }, h('div', { class: 'att-doc' }, h('b', { text: X.nm[pin] || pin }), ' · ' + PD.monthLabel(R.month + '-01')), h('div', { class: 'att-tw' }, h('table', { class: 'att-tbl' }, h('thead', {}, h('tr', {}, ['Datum', 'Standort', 'Beginn', 'Ende', 'Stunden', 'Bemerkung'].map(function (t) { return h('th', { text: t }); }))), body, foot)));
  }
  function attSheet(pin) {
    const A = state.att, R = A.report; if (!R) return;
    const X = attIndex(R);
    A.sheetApi = DP.modal({ title: (X.nm[pin] || pin) + ' · ' + PD.monthLabel(R.month + '-01'), wide: true, body: h('div', { class: 'att-modalbody' }, attSheetNode(pin, R, X, false)),
      actions: [{ label: 'Schließen' }, { label: 'Drucken / PDF', kind: 'primary', closes: false, onClick: function () { attPrint(attSheetNode(pin, R, X, true)); } }] });
  }
  function attEditRow(pin, iso, seg) {
    const A = state.att, R = A.report, X = attIndex(R), cfg = R.cfg, visible = cfg.order.filter(function (o) { return !cfg.places[o].hidden || (seg && seg.ort === o); });
    const sel = h('select', { class: 'input', id: 'attr_ort' }, [h('option', { value: '', text: '– kein Eintrag –' })].concat(visible.map(function (o) { return h('option', { value: o, text: o }); }))); sel.value = seg ? seg.ort : '';
    const a = h('input', { class: 'input', id: 'attr_a', type: 'time', value: seg ? seg.beginn : '' }), c = h('input', { class: 'input', id: 'attr_c', type: 'time', value: seg ? seg.ende : '' });
    sel.addEventListener('change', function () { const p = cfg.places[sel.value]; if (p && !seg) { a.value = p.start; c.value = p.end; } });
    DP.modal({ title: (X.nm[pin] || pin) + ' · ' + PD.short(iso), body: h('div', { class: 'stack-sm' }, field('Standort', sel, 'attr_ort'), h('div', { class: 'form-grid' }, field('Beginn', a, 'attr_a'), field('Ende', c, 'attr_c')), h('p', { class: 'muted small', text: (seg ? 'Ändert diesen Abschnitt. ' : 'Trägt einen Eintrag ein. ') + 'Nur in deiner Erfassung, für den Chef unsichtbar.' })),
      actions: [{ label: 'Abbrechen' }, { label: 'Speichern', kind: 'primary', closes: false, onClick: async function (api) {
        if (!sel.value && !seg) { DP.toast('Bitte einen Standort wählen.', 'error'); return; }
        const e = { pin: pin, ort: sel.value };
        if (seg) e.from = seg.ort;
        if (sel.value) { e.beginn = a.value || undefined; e.ende = c.value || undefined; }
        const r = await adm('adminAttSet', { date: iso, entries: [e] });
        if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Nicht gespeichert.', 'error'); return; }
        api.close(); if (A.sheetApi) A.sheetApi.close(); A.cache = null; await attLoadReport(); renderTab(); attSheet(pin);
      } }] });
  }
  function attPeopleView() {
    setTitle('Anwesenheit');
    const A = state.att, R = A.report;
    if (!R || R.month !== A.rmonth) return h('div', { class: 'att' }, attReportBar(), h('div', { class: 'empty' }, h('span', { class: 'spinner' })));
    const X = attIndex(R), stat = {};
    R.employees.forEach(function (e) { stat[e.pin] = { d: 0, h: 0, k: 0, u: 0 }; });
    R.rows.forEach(function (x) { if (stat[x.pin]) stat[x.pin].h += x.stunden; });
    R.employees.forEach(function (e) { stat[e.pin].d = Object.keys(X.byPin[e.pin] || {}).length; });
    Object.keys(X.abs).forEach(function (p) { Object.keys(X.abs[p]).forEach(function (d) { if (stat[p] && !(X.byPin[p] || {})[d]) stat[p][X.abs[p][d] === 'krank' ? 'k' : 'u']++; }); });
    const body = h('tbody', {}, R.employees.map(function (e) {
      const s = stat[e.pin], tr = h('tr', { class: 'att-click' + (s.d ? '' : ' att-emptyrow'), title: 'Blatt öffnen' }, h('td', {}, h('b', { text: e.name })), h('td', { class: 'num', text: s.d ? String(s.d) : '–' }), h('td', { class: 'num', text: s.d ? String(Math.round(s.h * 100) / 100).replace('.', ',') : '–' }), h('td', { class: 'num', text: s.k ? String(s.k) : '' }), h('td', { class: 'num', text: s.u ? String(s.u) : '' }));
      tr.addEventListener('click', function () { attSheet(e.pin); }); return tr;
    }));
    const prAll = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Alle Blätter drucken' });
    prAll.addEventListener('click', function () { const w = R.employees.filter(function (e) { return stat[e.pin].d; }); if (!w.length) { DP.toast('Es gibt noch keine Einträge in diesem Monat.', 'x'); return; } attPrint(w.map(function (e) { return attSheetNode(e.pin, R, X, true); })); });
    return h('div', { class: 'att' }, attReportBar('Mitarbeiter', prAll),
      h('div', { class: 'att-tw' }, h('table', { class: 'att-tbl att-people' }, h('thead', {}, h('tr', {}, ['Mitarbeiter', 'Tage', 'Stunden', 'Krank', 'Urlaub'].map(function (t) { return h('th', { text: t }); }))), body)),
      h('p', { class: 'muted small', text: 'Auf einen Mitarbeiter tippen öffnet sein Blatt mit allen Tagen, Standorten und Stunden. Dort kannst du einen Tag anklicken und ändern.' }));
  }

  function attSettings() {
    const A = state.att, cfg = A.data.cfg, vis = cfg.order.filter(function (pl) { return !cfg.places[pl].hidden; }), draft = JSON.parse(JSON.stringify(cfg));
    let m = null;
    const again = async function () { if (m) m.close(); A.cache = null; await loadAtt(A.date, true); renderTab(); attSettings(); };
    const saveDraft = function () { return adm('adminAttCfgSet', { mode: draft.mode, places: draft.places }); };
    const rows = vis.map(function (pl) {
      const p = draft.places[pl], num = h('b', { class: 'att-stepn', text: String(p.slots) });
      const minus = h('button', { type: 'button', class: 'btn btn-secondary btn-icon', text: '−', 'aria-label': pl + ': ein Platz weniger' }), plus = h('button', { type: 'button', class: 'btn btn-secondary btn-icon', text: '+', 'aria-label': pl + ': ein Platz mehr' });
      minus.addEventListener('click', function () { if (p.slots > 1) { p.slots--; num.textContent = String(p.slots); } }); plus.addEventListener('click', function () { if (p.slots < 12) { p.slots++; num.textContent = String(p.slots); } });
      const a = h('input', { class: 'input', type: 'time', value: p.start, 'aria-label': pl + ' Beginn' }), c = h('input', { class: 'input', type: 'time', value: p.end, 'aria-label': pl + ' Ende' });
      a.addEventListener('input', function () { p.start = a.value; }); c.addEventListener('input', function () { p.end = c.value; });
      const del = h('button', { type: 'button', class: 'btn btn-secondary btn-icon', 'aria-label': pl + ' entfernen', title: 'Standort entfernen', text: '🗑' });
      del.addEventListener('click', async function () {
        if (!(await DP.confirm('„' + pl + '“ entfernen?', 'Nur im Anwesenheits-Brett, der Dienstplan bleibt unberührt. Hat der Standort schon Einträge, wird er nur ausgeblendet, damit die Stunden und alten Monate vollständig bleiben. Sonst wird er gelöscht.', 'Entfernen', 'danger'))) return;
        await saveDraft(); const r = await adm('adminAttPlaceRemove', { name: pl });
        if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Nicht möglich.', 'error'); return; }
        DP.toast(r.removed === 'hidden' ? '„' + pl + '“ ist ausgeblendet (hat Einträge).' : '„' + pl + '“ ist gelöscht.'); again();
      });
      return h('tr', {}, h('td', {}, h('span', { class: 'dotc' + DP.placeClass(pl) }), ' ', h('b', { text: pl })), h('td', {}, h('div', { class: 'att-step' }, minus, num, plus)), h('td', {}, h('div', { class: 'row' }, a, ' – ', c)), h('td', {}, del));
    });
    const newName = h('input', { class: 'input', id: 'att_new', type: 'text', maxlength: '40', placeholder: 'Neuer Standort, zum Beispiel Ochsenzoll Nacht', 'aria-label': 'Name des neuen Standorts' });
    const add = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: '+ Standort hinzufügen' });
    add.addEventListener('click', async function () {
      if (!newName.value.trim()) { DP.toast('Bitte einen Namen eingeben.', 'error'); return; }
      await saveDraft(); const r = await adm('adminAttPlaceAdd', { name: newName.value });
      if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Nicht möglich.', 'error'); return; }
      DP.toast('„' + newName.value.trim() + '“ ist da. Plätze und Zeit stellst du hier ein.'); again();
    });
    const hiddenOnes = cfg.hidden.filter(function (n) { return vis.indexOf(n) === -1; });
    const mode = h('select', { class: 'input', id: 'att_mode' }, [['ask', 'Nachfragen'], ['block', 'Sperren'], ['allow', 'Erlauben']].map(function (o) { return h('option', { value: o[0], text: o[1] }); })); mode.value = draft.mode; mode.addEventListener('change', function () { draft.mode = mode.value; });
    m = DP.modal({ title: 'Anwesenheit: Standorte, Plätze und Zeiten', wide: true, body: h('div', { class: 'stack-sm' },
      h('p', { class: 'muted small', text: 'Diese Liste gilt nur für das Anwesenheits-Brett, nicht für den Dienstplan. Lege fest, wie viele Mitarbeiter höchstens an einem Standort sind und welche Zeit dort normalerweise gilt. Ist weniger los, bleibt das Feld in der Farbe des Standorts stehen.' }),
      h('table', { class: 'att-set' }, h('thead', {}, h('tr', {}, h('th', { text: 'Standort' }), h('th', { text: 'Plätze' }), h('th', { text: 'Standardzeit' }), h('th', {}))), h('tbody', {}, rows)),
      h('div', { class: 'row wrap' }, newName, add),
      hiddenOnes.length ? h('div', { class: 'stack-sm' }, h('div', { class: 'small', style: 'font-weight:700', text: 'Ausgeblendet (haben alte Einträge)' }), hiddenOnes.map(function (n) { return h('div', { class: 'row' }, h('span', { text: n }), h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'wieder einblenden', onclick: async function () { const r = await adm('adminAttPlaceShow', { name: n }); if (r.status === 'success') again(); } })); })) : null,
      field('Wenn ein Standort voll ist und du ziehst noch jemanden dazu', mode, 'att_mode')),
      actions: [{ label: 'Abbrechen' }, { label: 'Speichern', kind: 'primary', closes: false, onClick: async function (api) {
        const r = await saveDraft();
        if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Nicht gespeichert.', 'error'); return; }
        api.close(); DP.toast('Gespeichert.'); A.cache = null; await loadAtt(A.date, true); renderTab(); } }] });
  }
  async function attRelease() {
    const A = state.att, month = A.date.slice(0, 7);
    await attFlushAll();
    const r = await adm('adminAttMonth', { month: month });
    if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') DP.toast(r.message || 'Nicht möglich.', 'error'); return; }
    const pick = {}, rows = r.employees.map(function (e) {
      const can = e.days > 0 && !e.released && e.state !== 'sent_open'; pick[e.pin] = can;
      const cb = h('input', { type: 'checkbox', id: 'attr_' + e.pin }); cb.checked = can; cb.disabled = e.days === 0 || e.released; cb.addEventListener('change', function () { pick[e.pin] = cb.checked; upd(); });
      return h('tr', { class: e.days ? '' : 'muted' }, h('td', {}, cb), h('td', {}, h('label', { for: 'attr_' + e.pin, text: e.name })), h('td', { text: e.days ? e.days + ' Tage · ' + String(e.hours).replace('.', ',') + ' Std' : '–' }), h('td', {}, h('span', { class: 'badge ' + (e.released ? 'success' : e.state === 'sent_open' ? 'warn' : 'neutral'), text: ATT_STATE[e.state] || e.state })));
    });
    const go = { label: '', kind: 'primary', closes: false, onClick: null };
    const upd = function () { const n = Object.keys(pick).filter(function (p) { return pick[p]; }).length; if (btnEl) { btnEl.textContent = 'Für Chef freigeben (' + n + ')'; btnEl.disabled = !n; } };
    let btnEl = null;
    const m = DP.modal({ title: 'Für Chef freigeben · ' + PD.monthLabel(month + '-01'), wide: true, body: h('div', { class: 'stack-sm' },
      r.monthReleased ? null : h('div', { class: 'alert warn', text: 'Dieser Monat ist für den Chef noch nicht freigegeben. Er sieht die Stunden erst, wenn du im Reiter „Chef-Bericht“ den Monat freigibst.' }),
      h('p', { class: 'muted small', text: 'Deine Erfassung wird für die gewählten Mitarbeiter zum Endstand, ohne Korrektur. Wer schon selbst gesendet hat, wird übersprungen: den vergleichst du im Chef-Bericht.' }),
      h('div', { class: 'att-relwrap' }, h('table', { class: 'att-set' }, h('tbody', {}, rows)))),
      actions: [{ label: 'Abbrechen' }, { label: 'Für Chef freigeben', kind: 'primary', closes: false, onClick: async function (api) {
        const pins = Object.keys(pick).filter(function (p) { return pick[p]; }), skipped = []; let okN = 0;
        for (let i = 0; i < pins.length; i += 4) {
          const x = await adm('adminAttRelease', { month: month, pins: pins.slice(i, i + 4) });
          if (x.status !== 'success') { if (x.code !== 'ADMIN_AUTH') DP.toast(x.message || 'Nicht möglich.', 'error'); return; }
          x.results.forEach(function (y) { if (y.ok) okN++; else skipped.push((y.name || y.pin) + ': ' + y.reason); });
        }
        api.close(); DP.toast(okN + (okN === 1 ? ' Mitarbeiter' : ' Mitarbeiter') + ' für den Chef freigegeben' + (skipped.length ? '. Übersprungen: ' + skipped.join('; ') : '.'));
      } }] });
    btnEl = m.el.querySelector('.actions .btn-primary'); upd();
  }

  function usersView() {
    const base = usersViewBase();
    if (state.role === 'voll' && base && base.prepend) base.prepend(securityCard());
    return base;
  }
  function usersViewBase() {
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
      act.push(btn('Rolle ändern', function () { userRole(u); }));
      act.push(u.status === 'aktiv' ? btn('Sperren', function () { userStatus(u, 'gesperrt'); }) : btn('Aktivieren', function () { userStatus(u, 'aktiv'); }));
      act.push(btn('Löschen …', function () { userDelete(u); }));
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
  state.staff = { list: null, q: '', filter: 'all', pin: null, month: PD.today().slice(0, 7), detail: null, error: false, daysOpen: false };
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
    pushTabState('staff');
    const S = state.staff;
    S.pin = pin; S.detail = null; S.daysOpen = false; if (month) S.month = month; state.tab = 'staff';
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
          h('td', { 'data-l': 'Name' }, h('div', { class: 'name-cell' }, DP.avatar(e.name, 'avatar'), h('div', {}, h('div', { class: 'nm who-link', text: e.name }), h('div', { class: 'muted small mono', text: 'PIN ' + e.pin })))),
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
    const pickBtn = isVoll() ? h('button', { type: 'button', class: 'btn btn-secondary', id: 'pickAccBtn' }, DP.icon('key', 'sm'), 'Zugänge …') : null;
    if (pickBtn) pickBtn.addEventListener('click', function () { bulkAccountsDialog(); });
    const warn = false ? h('div', { class: 'warnbar' }, DP.icon('alert', 'sm'), h('div', {}, h('strong', { text: 'Die PIN 00 ist für „Offene Schichten“ reserviert. ' }), L.conflict00 + ' hat diese PIN und kann so nicht eingeplant werden. Bitte die PIN ändern: Mitarbeiter öffnen, „PIN ändern“.')) : null;
    return h('div', { class: 'stack' }, warn,
      h('div', { class: 'row wrap' }, search, chips, h('div', { class: 'grow' }), pickBtn, add),
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
      act.push(b('Fristen …', 'btn-secondary', function () { expiryForm(rosterEmp, (D.profile && D.profile.expiries) || []); }));
      if (!D.account) act.push(b('Zugang anlegen', 'btn-secondary', function () { createAccount(rosterEmp); }));
      else if (rosterEmp.account && rosterEmp.account.id) act.push(b('Passwort zurücksetzen', 'btn-secondary', function () { resetPassword(rosterEmp); }));
      act.push(b('Entfernen …', 'btn-secondary', function () { deleteDialog(rosterEmp); }));
    }
    const head = h('div', { class: 'dhead' }, DP.avatar(p.name, 'avatar'),
      h('div', {}, h('h2', { class: 'dtitle', text: p.name }),
        h('div', { class: 'dmeta' }, h('span', { class: 'badge neutral mono', text: 'PIN ' + p.pin }), p.home ? h('span', { class: 'row' }, lineBadge(p.home), h('span', { text: p.home })) : null,
          D.account ? h('span', { class: 'badge ' + (D.account.status === 'aktiv' ? 'success' : 'warn'), text: 'Zugang ' + D.account.status }) : h('span', { class: 'badge neutral', text: 'kein Zugang' }),
          h('span', { class: 'badge neutral', text: D.devices.length + (D.devices.length === 1 ? ' Handy' : ' Handys') }), p.phone ? telLink(p.phone) : null),
        p.note ? h('div', { class: 'muted', style: 'margin-top:6px', text: p.note }) : null,
        (p.expiries && p.expiries.length) ? h('div', { class: 'dmeta', style: 'margin-top:6px' }, p.expiries.map(function (e) { return h('span', { class: 'badge ' + EXP_LABEL[e.state][1], title: e.label + ' gültig bis ' + PD.short(e.date) + (e.note ? ' · ' + e.note : '') }, e.label + ' · ' + (e.state === 'ok' ? 'bis ' + PD.short(e.date) : expiryText(e))); })) : null),
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
    const problemDays = D.days.filter(function (d) { return kindOf(d) === 'miss' || kindOf(d) === 'krank' || (kindOf(d) === 'urlaub' && d.absent === 'urlaub?'); });
    const daysOpen = S.daysOpen || !problemDays.length;
    const toggleDaysBtn = problemDays.length ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: daysOpen ? 'Nur Auffälliges zeigen' : 'Alle ' + D.days.length + ' Tage zeigen' }) : null;
    if (toggleDaysBtn) toggleDaysBtn.addEventListener('click', function () { S.daysOpen = !S.daysOpen; renderTab(); });
    const shownCells = daysOpen ? cells : cells.filter(function (c, i) { return problemDays.indexOf(D.days[i]) !== -1; });
    const strip = h('div', {}, sum, !daysOpen ? h('p', { class: 'muted small', text: problemDays.length + (problemDays.length === 1 ? ' auffälliger Tag' : ' auffällige Tage') + ' von ' + D.days.length + ' im Monat (nicht gesendet, krank oder offene Urlaubsfrage).' }) : null, h('div', { class: 'daystrip' }, shownCells), toggleDaysBtn, h('div', { class: 'blegend lgline' }, h('span', {}, 'Grün = gearbeitet (Stunden stehen im Feld)'), h('span', {}, 'Rot ✗ = geplant, aber nichts gesendet'), h('span', {}, 'Orange = krank'), h('span', {}, 'Blau = Urlaub'), h('span', {}, 'Grau = frei'), h('span', {}, 'Oberer Rand = Standortfarbe'), h('span', {}, 'N nicht verfügbar' + (sm.unavailableDays ? ' (' + sm.unavailableDays + ' Tage)' : ''))));
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
    await loadPlaceMgmt();
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
  async function openPlace(place) { pushTabState('places'); const P = state.places; P.place = place; P.detail = null; renderTab(); await loadPlaces(); renderTab(); }
  async function closePlace() { const P = state.places; P.place = null; P.detail = null; renderTab(); await loadPlaces(); renderTab(); }
  async function setPlacesMonth(m) { const P = state.places; P.month = m; P.overview = null; P.detail = null; renderTab(); await loadPlaces(); renderTab(); }
  function placesOverview() {
    setTitle('Standorte');
    const P = state.places, O = P.overview;
    const nav = monthNav(P.month, setPlacesMonth);
    if (!O) return h('div', { class: 'stack' }, nav, h('div', { class: 'empty' }, P.error ? 'Verbindung unterbrochen. Es wird automatisch erneut versucht.' : h('span', { class: 'spinner' })));
    const addPlaceBtn = isVoll() ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', id: 'addPlaceBtn' }, DP.icon('plus', 'sm'), 'Standort hinzufügen') : null;
    if (addPlaceBtn) addPlaceBtn.addEventListener('click', function () { placeForm(null); });
    const cards = O.places.map(function (p) {
      const b = h('button', { type: 'button', class: 'pcard' + DP.placeClass(p.place) }, h('div', { class: 'row' }, lineBadge(p.place), h('div', { class: 'pname', text: p.place })),
        h('div', { class: 'pk' }, h('div', {}, h('div', { class: 'v', text: dec(p.plannedHours) }), h('div', { class: 'l', text: 'Std. geplant' })), h('div', {}, h('div', { class: 'v', text: p.sentDays ? dec(p.sentHours) : '–' }), h('div', { class: 'l', text: 'Std. gesendet' })),
          h('div', {}, h('div', { class: 'v' + (p.gaps ? ' bad' : ''), text: p.requirement ? String(p.gaps) : '–' }), h('div', { class: 'l', text: 'Lücken' })), h('div', {}, h('div', { class: 'v', text: String(p.openShifts) }), h('div', { class: 'l', text: 'offen' }))),
        h('div', { class: 'muted small', text: p.shifts + (p.shifts === 1 ? ' Schicht' : ' Schichten') + ', ' + p.staff + (p.staff === 1 ? ' Mitarbeiter' : ' Mitarbeiter') + (p.absentShifts ? ', ' + p.absentShifts + ' Ausfall(e) durch Krank/Urlaub' : '') }));
      b.addEventListener('click', function () { openPlace(p.place); });
      return b;
    });
    return h('div', { class: 'stack' }, h('div', { class: 'row wrap' }, nav, h('div', { class: 'grow' }), addPlaceBtn), h('div', { class: 'pgrid' }, cards), hiddenPlacesSection(), h('p', { class: 'muted small', text: 'Ein Klick auf einen Standort zeigt die Besetzung Tag für Tag, die Mitarbeiter, Ausfälle und die Entwicklung. „Lücken“ gibt es nur, wenn du unter Übersicht eine Mindestbesetzung festgelegt hast.' }));
  }
  function placeDetailView() {
    setTitle('Standorte');
    const P = state.places, D = P.detail;
    const back = h('button', { type: 'button', class: 'crumb' }, DP.icon('chevleft', 'sm'), 'Alle Standorte');
    back.addEventListener('click', closePlace);
    if (!D) return h('div', { class: 'stack' }, back, h('div', { class: 'empty' }, P.error ? 'Verbindung unterbrochen. Es wird automatisch erneut versucht.' : h('span', { class: 'spinner' })));
    const info = D.info ? [D.info.address, D.info.contact, D.info.note].filter(Boolean).join(' · ') : '';
    const head = h('div', { class: 'dhead' }, lineBadge(D.place), h('div', {}, h('h2', { class: 'dtitle', text: D.place }), info ? h('div', { class: 'muted', style: 'margin-top:8px', text: info }) : h('div', { class: 'muted small', style: 'margin-top:8px', text: 'Noch keine Standort-Infos hinterlegt (Übersicht, Standort-Infos).' })), h('div', { class: 'dact' }, placeActions(D.place)));
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

  // ===================== Standorte verwalten, Rundnachricht, Handy-Tagesansicht =====================
  function cfgFrom(list) { return list.map(function (p) { return { name: p.name, color: p.color, short: p.short, active: p.active }; }); }
  async function loadPlaceMgmt() { const r = await adm('adminPlacesGet'); if (r.status === 'success') { state.places.mgmt = r; DP.setPlaces(cfgFrom(r.places)); } }
  state.places.mgmt = null;
  const mgmtOf = function (name) { const M = state.places.mgmt; return M ? M.places.filter(function (p) { return p.name === name; })[0] || null : null; };

  function placeForm(p) {
    const M = state.places.mgmt, ncol = M ? M.colors : 12;
    const name = h('input', { class: 'input', id: 'pf_name', type: 'text', maxlength: '40', value: p ? p.name : '', autocomplete: 'off', placeholder: 'zum Beispiel Altona Depot' });
    const short = h('input', { class: 'input', id: 'pf_short', type: 'text', maxlength: '3', value: p ? (p.customShort || '') : '', autocomplete: 'off', placeholder: 'automatisch' });
    const usedBy = {}; (M ? M.places : []).forEach(function (x) { if (!p || x.name !== p.name) (usedBy[x.color] = usedBy[x.color] || []).push(x.name); });
    let color = p ? p.color : (function () { let c = 0; while (usedBy[c] && c < ncol - 1) c++; return c; })();
    const swBox = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Farbe des Standorts' });
    const drawSw = function () {
      swBox.replaceChildren(...Array.from({ length: ncol }, function (_, i) {
        const b = h('button', { type: 'button', class: 'swatch pl' + i + (i === color ? ' on' : ''), role: 'radio', 'aria-checked': String(i === color), 'aria-label': 'Farbe ' + (i + 1), title: usedBy[i] ? 'Schon benutzt von: ' + usedBy[i].join(', ') : 'Noch frei' });
        b.addEventListener('click', function () { color = i; drawSw(); });
        return b;
      }));
    };
    drawSw();
    let tpls = (p ? p.templates : [{ start: '22:00', end: '08:00', typ: 'Nachtschicht' }]).map(function (t) { return { start: t.start, end: t.end, typ: t.typ }; });
    if (!tpls.length) tpls = [{ start: '22:00', end: '08:00', typ: 'Nachtschicht' }];
    const tplBox = h('div', { class: 'stack-sm' });
    const drawTpl = function () {
      const rows = tpls.map(function (t, i) {
        const s = h('input', { class: 'input', type: 'time', value: t.start, 'aria-label': 'Beginn der Vorlage ' + (i + 1) });
        const e = h('input', { class: 'input', type: 'time', value: t.end, 'aria-label': 'Ende der Vorlage ' + (i + 1) });
        const ty = h('select', { class: 'input', 'aria-label': 'Art der Vorlage ' + (i + 1) }, h('option', { value: 'Nachtschicht', text: 'Nachtschicht' }), h('option', { value: 'Tagschicht', text: 'Tagschicht' }));
        ty.value = t.typ;
        s.addEventListener('input', function () { t.start = s.value; }); e.addEventListener('input', function () { t.end = e.value; }); ty.addEventListener('change', function () { t.typ = ty.value; });
        const del = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Vorlage entfernen', title: 'Vorlage entfernen' }, DP.icon('x', 'sm'));
        del.disabled = tpls.length <= 1;
        del.addEventListener('click', function () { tpls.splice(i, 1); drawTpl(); });
        return h('div', { class: 'tplrow' }, s, e, ty, del);
      });
      const add = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: '+ Vorlage hinzufügen' });
      add.disabled = tpls.length >= 8;
      add.addEventListener('click', function () { tpls.push({ start: '08:00', end: '17:00', typ: 'Tagschicht' }); drawTpl(); });
      tplBox.replaceChildren(...rows, add);
    };
    drawTpl();
    const hide = p ? h('input', { type: 'checkbox', id: 'pf_hide' }) : null;
    if (hide) hide.checked = !p.active;
    const err = h('div', {});
    const fields = [field('Name', name, 'pf_name'), h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, field('Kürzel (1 bis 3 Zeichen)', short, 'pf_short', 'Steht im Farbkreis, zum Beispiel „A“.')), h('div', { class: 'grow' }, field('Farbe', swBox, 'pf_color'))),
      h('div', {}, h('label', { text: 'Schichtvorlagen' }), h('div', { class: 'hint', text: 'Diese Zeiten bietet der Plan an. Die Stunden-App der Mitarbeiter zeigt sie bei diesem Standort zur Auswahl.' }), tplBox)];
    if (hide) fields.push(h('label', { class: 'check', for: 'pf_hide' }, hide, h('span', {}, h('strong', { text: 'Standort ausblenden' }), h('div', { class: 'hint', text: 'Neue Schichten sind dann nicht mehr möglich, alter Plan und Stunden bleiben erhalten.' }))));
    if (p) fields.push(h('div', { class: 'hint', text: 'Beim Umbenennen wandern Schichten, Mindestbesetzung, Standort-Infos und Stammstandorte mit. Schon gesendete Stunden behalten den alten Namen.' }));
    fields.push(err);
    DP.modal({
      title: p ? 'Standort bearbeiten' : 'Standort hinzufügen', wide: true, body: h('div', { class: 'stack-sm' }, fields),
      actions: [{ label: 'Abbrechen', kind: 'secondary' }, {
        label: p ? 'Speichern' : 'Anlegen', kind: 'primary', closes: false,
        onClick: async function (api) {
          err.replaceChildren();
          const templates = tpls.map(function (t) { return { start: t.start, end: t.end, typ: t.typ }; });
          const r = p ? await adm('adminPlaceUpdate', { name: p.name, newName: name.value, color: color, short: short.value.trim(), active: !hide.checked, templates: templates })
            : await adm('adminPlaceCreate', { name: name.value, color: color, short: short.value.trim(), templates: templates });
          if (r.status === 'success') {
            api.close(); DP.setPlaces(r.config);
            if (p && state.places.place === p.name) state.places.place = r.name;
            DP.toast(p ? 'Gespeichert.' : '„' + r.name + '“ angelegt.');
            state.places.overview = null; state.places.detail = null;
            await Promise.all([loadPlaces(), refresh()]); renderTab();
          } else if (r.code !== 'ADMIN_AUTH') err.append(alertBox('error', r.message || 'Das hat nicht geklappt.'));
        }
      }]
    });
  }
  function deletePlaceDialog(p) {
    const conf = h('input', { class: 'input', id: 'dp_name', type: 'text', autocomplete: 'off', placeholder: p.name });
    const err = h('div', {});
    DP.modal({
      title: '„' + p.name + '“ löschen', body: h('div', { class: 'stack-sm' }, h('p', { text: 'Der Standort wird aus der Liste entfernt, samt Mindestbesetzung und Standort-Infos. Das geht nur, wenn im Plan keine Schicht mehr dort liegt. Willst du den Verlauf behalten, blende ihn stattdessen aus.' }), field('Zur Sicherheit den Namen eingeben', conf, 'dp_name', p.name), err),
      actions: [{ label: 'Abbrechen', kind: 'secondary' }, {
        label: 'Löschen', kind: 'danger', closes: false,
        onClick: async function (api) {
          err.replaceChildren();
          const r = await adm('adminPlaceDelete', { name: p.name, confirmName: conf.value });
          if (r.status === 'success') { api.close(); DP.setPlaces(r.config); DP.toast('„' + p.name + '“ wurde gelöscht.'); state.places.place = null; state.places.detail = null; state.places.overview = null; await Promise.all([loadPlaces(), refresh()]); renderTab(); }
          else if (r.code !== 'ADMIN_AUTH') {
            err.append(alertBox('error', r.message || 'Das hat nicht geklappt.'));
            if (r.code === 'IN_USE') { const hb = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Stattdessen ausblenden' }); hb.addEventListener('click', async function () { const x = await adm('adminPlaceUpdate', { name: p.name, active: false }); if (x.status === 'success') { api.close(); DP.setPlaces(x.config); DP.toast('„' + p.name + '“ ist jetzt ausgeblendet.'); state.places.place = null; state.places.detail = null; state.places.overview = null; await Promise.all([loadPlaces(), refresh()]); renderTab(); } else err.append(alertBox('error', x.message || 'Das hat nicht geklappt.')); }); err.append(hb); }
          }
        }
      }]
    });
  }
  function placeActions(name) {
    if (!isVoll()) return null;
    const p = mgmtOf(name), out = [];
    const b = function (label, fn) { const x = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: label }); x.addEventListener('click', fn); return x; };
    if (p) { out.push(b('Bearbeiten', function () { placeForm(mgmtOf(name) || p); })); out.push(b('Löschen …', function () { deletePlaceDialog(mgmtOf(name) || p); })); }
    return out;
  }
  function hiddenPlacesSection() {
    const M = state.places.mgmt;
    const list = M ? M.places.filter(function (p) { return !p.active; }) : [];
    if (!list.length) return null;
    return h('section', { class: 'dsec' }, h('h3', {}, 'Ausgeblendete Standorte', h('small', { text: list.length + (list.length === 1 ? ' Standort' : ' Standorte') })),
      list.map(function (p) { const rowEl = h('div', { class: 'prow' }, lineBadge(p.name), h('div', { class: 'grow' }, h('div', { class: 't', text: p.name }), h('div', { class: 's', text: p.shifts + (p.shifts === 1 ? ' Schicht' : ' Schichten') + ' im Plan · bietet keine neuen Schichten an' })), isVoll() ? (function () { const x = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Bearbeiten' }); x.addEventListener('click', function () { placeForm(p); }); return x; })() : null); return rowEl; }));
  }

  // ---- Rundnachricht ----
  function messagesView() {
    const el = messagesViewBase();
    if (el && el.prepend && (state.role === 'voll' || state.role === 'planer')) {
      const b = h('button', { type: 'button', class: 'btn btn-primary btn-sm', id: 'bcBtn' }, DP.icon('chat', 'sm'), 'Nachricht an alle');
      b.addEventListener('click', broadcastDialog);
      el.prepend(h('div', { class: 'row wrap' }, b, h('span', { class: 'muted small', text: 'Eine Mitteilung an alle Mitarbeiter, zum Beispiel zu Terminen oder Änderungen.' })));
    }
    return el;
  }
  function broadcastDialog() {
    const ta = h('textarea', { class: 'input textarea', id: 'bc_text', maxlength: '480', rows: '5', placeholder: 'Zum Beispiel: Morgen um 9 Uhr Teambesprechung im Büro. Bitte pünktlich.' });
    const cnt = h('div', { class: 'hint', text: '0 / 480 Zeichen' });
    const err = h('div', {});
    ta.addEventListener('input', function () { cnt.textContent = ta.value.length + ' / 480 Zeichen'; });
    DP.modal({
      title: 'Nachricht an alle Mitarbeiter', wide: true, body: h('div', { class: 'stack-sm' }, h('p', { text: 'Die Nachricht geht an alle Mitarbeiter. Im Dienstplan-Portal sehen sie nur Mitarbeiter mit Zugang unter „Nachrichten“.' }), field('Nachricht', ta, 'bc_text'), cnt, err),
      actions: [{ label: 'Abbrechen', kind: 'secondary' }, {
        label: 'An alle senden', kind: 'primary', closes: false,
        onClick: async function (api) {
          err.replaceChildren();
          const r = await adm('adminBroadcast', { text: ta.value });
          if (r.status === 'success') { api.close(); DP.toast('Gesendet an ' + r.sent + (r.sent === 1 ? ' Mitarbeiter' : ' Mitarbeiter') + ' (' + r.withAccount + ' mit Portal-Zugang).'); await refresh(); renderTab(); }
          else if (r.code !== 'ADMIN_AUTH') err.append(alertBox('error', r.message || 'Das hat nicht geklappt.'));
        }
      }]
    });
  }
  if (window.matchMedia) { const mq = window.matchMedia('(max-width: 760px)'); const onChange = function () { if (state.session && state.tab === 'plan' && !state.plan.view) renderTab(); }; if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange); }

  // ===================== Benachrichtigungen, Suche, Sammel-Zugänge =====================
  state.feed = { items: [], lastTs: 0, ready: false, open: false };
  const FEED_DAY = 24 * 3600 * 1000;
  const FEED_ICON = { message: 'chat', hours: 'clock', request: 'swap', claim: 'check', help: 'alert', newpin: 'user', device: 'key', system: 'shield', dispute: 'alert', ack: 'check', viewlink: 'eye' };
  const feedStoreKey = function () { return 'dpa_feed_seen_v1_' + (state.who || 'admin'); };
  const feedSeen = function () { try { const v = localStorage.getItem(feedStoreKey()); return v === null ? null : (Number(v) || 0); } catch (e) { return null; } };
  const setFeedSeen = function (ts) { try { localStorage.setItem(feedStoreKey(), String(ts)); } catch (e) { /* gesperrt */ } };
  const monthName = function (m) { return /^\d{4}-\d{2}$/.test(m || '') ? PD.monthLabel(m + '-01') : (m || ''); };
  const deDate = function (s) { return String(s || '').replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3.$2.$1'); };
  function feedLine(it) {
    const n = it.name || 'Jemand';
    if (it.type === 'message') return [n + ' schreibt', '„' + it.text + '“'];
    if (it.type === 'hours') return [n + ' hat Stunden gesendet', monthName(it.monat) + ' · ' + String(it.total).replace('.', ',') + ' Std. an ' + it.days + (it.days === 1 ? ' Tag' : ' Tagen') + (it.resubmit ? ' (erneut gesendet)' : '')];
    if (it.type === 'request') return [n + (it.kind === 'krank' ? ' hat sich krank gemeldet' : it.kind === 'urlaub' ? ' beantragt Urlaub' : it.kind === 'verfuegbar' ? ' ist nicht verfügbar' : ' hat einen Antrag gestellt'), deDate(it.text)];
    if (it.type === 'viewlink') return ['Übersichtslink ' + it.text, monthName(it.monat)];
    if (it.type === 'dispute') return [n + ' widerspricht den Stunden', monthName(it.monat) + ' · ' + it.text];
    if (it.type === 'ack') return [n + ' hat die Stunden bestätigt', monthName(it.monat) + ' · ' + it.text];
    if (it.type === 'claim') return [n + ' hat eine offene Schicht übernommen', deDate(it.text)];
    if (it.type === 'help') return ['Hilfe-Anfrage von ' + n, it.text];
    if (it.type === 'newpin') return [n + ' hat eine PIN bekommen', it.text];
    if (it.type === 'device') return [n + ' hat ein neues Handy verbunden', it.text];
    return ['Hinweis des Systems', it.text];
  }
  const feedUnread = function () { const s = feedSeen(); return s === null ? [] : state.feed.items.filter(function (i) { return i.ts > s; }); };
  // Titel: zuerst die neuen Meldungen, sonst die Zahl der offenen Aufgaben (Anträge, unbeantwortete Nachrichten, gesperrte Zugänge)
  function refreshTitle() {
    const D = state.dash || {}, todo = (D.openRequests || 0) + (D.unansweredMessages || 0) + counts().locked, n = feedUnread().length || todo;
    document.title = (n ? '(' + n + ') ' : '') + 'Dienstplan – Admin';
  }
  function updateBell() {
    const n = feedUnread().length, b = document.getElementById('bellBtn'), badge = b && b.querySelector('.bellbadge');
    if (badge) { badge.textContent = n > 99 ? '99+' : String(n); badge.style.display = n ? '' : 'none'; }
    if (b) b.setAttribute('aria-label', n ? 'Benachrichtigungen, ' + n + ' neu' : 'Benachrichtigungen');
    refreshTitle();
  }
  async function loadFeed() {
    if (!state.session) return;
    const r = await adm('adminFeed', { since: Date.now() - 7 * FEED_DAY });
    if (r.status !== 'success') return;
    const F = state.feed, first = !F.ready;
    if (first && feedSeen() === null) setFeedSeen(r.now);
    const fresh = first ? [] : r.items.filter(function (i) { return i.ts > F.lastTs; });
    F.items = r.items; F.ready = true;
    F.lastTs = r.items.reduce(function (m, i) { return Math.max(m, i.ts); }, F.lastTs);
    updateBell();
    if (F.open) renderFeedPanel();
    if (fresh.length) announce(fresh);
  }
  function announce(fresh) {
    const l = feedLine(fresh[0]);
    DP.toast(fresh.length > 1 ? fresh.length + ' neue Meldungen, zuletzt: ' + l[0] : l[0] + (l[1] ? ': ' + l[1] : ''));
    try { if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') new Notification(fresh.length > 1 ? fresh.length + ' neue Meldungen' : l[0], { body: fresh.length > 1 ? l[0] : (l[1] || ''), tag: 'dpa-feed' }); } catch (e) { /* nicht möglich */ }
  }
  function gotoTab(tab) { const changed = tab !== state.tab; state.tab = tab; if (changed) pushTabState(tab); loadForTab(tab).then(function () { renderChrome(); renderTab(); }); renderChrome(); renderTab(); }
  // Der Zurück-Knopf des Browsers und des Handys soll zum vorigen Bereich führen, nicht die Seite verlassen.
  let navLock = false;
  function pushTabState(tab) {
    if (navLock || !state.session) return;
    try { history.pushState({ dpTab: tab }, '', location.pathname + location.search + '#' + tab); } catch (e) { /* nicht möglich */ }
  }
  window.addEventListener('popstate', function (e) {
    if (!state.session) return;
    const st = e.state || {};
    if (state.staff.pin) { navLock = true; closeEmployee(); navLock = false; return; }
    if (state.tab === 'chef' && state.cf.sel) { navLock = true; cfClosePerson(); navLock = false; return; }
    if (state.places.place) { navLock = true; closePlace(); navLock = false; return; }
    const tab = st.dpTab || (location.hash || '').replace('#', '') || 'plan';
    if (tab && tab !== state.tab) { navLock = true; state.tab = tab; renderChrome(); renderTab(); loadForTab(tab).then(function () { renderChrome(); renderTab(); }); navLock = false; }
  });
  function openFeedItem(it) {
    closeFeedPanel();
    if ((it.type === 'hours' || it.type === 'dispute' || it.type === 'ack') && it.pin) return openEmployee(it.pin, /^\d{4}-\d{2}$/.test(it.monat || '') ? it.monat : undefined);
    if (it.type === 'dispute' || it.type === 'ack') return gotoTab('e_hours');
    if (it.type === 'viewlink') return gotoTab(state.role === 'voll' ? 'viewlink' : 'overview');
    if (it.type === 'message') { if (it.pin) state.msg.pin = it.pin; return gotoTab('messages'); }
    if (it.type === 'request') return gotoTab('requests');
    if (it.type === 'claim') return gotoTab('plan');
    if (it.type === 'help') return gotoTab(state.role === 'voll' ? 'e_help' : 'overview');
    if ((it.type === 'newpin' || it.type === 'device') && it.pin) return openEmployee(it.pin);
    return gotoTab('staff');
  }
  let feedPanel = null, feedSnapshot = null;
  const feedOutside = function (e) { if (feedPanel && !feedPanel.contains(e.target) && !(e.target.closest && e.target.closest('#bellBtn'))) closeFeedPanel(); };
  const feedEsc = function (e) { if (e.key === 'Escape') closeFeedPanel(); };
  function closeFeedPanel() { if (feedPanel) { feedPanel.remove(); feedPanel = null; } state.feed.open = false; document.removeEventListener('click', feedOutside, true); document.removeEventListener('keydown', feedEsc); }
  function renderFeedPanel() {
    if (!feedPanel) return;
    const F = state.feed, list = F.items.slice(0, 40);
    const rows = list.length ? list.map(function (it) {
      const l = feedLine(it);
      const row = h('button', { type: 'button', class: 'fitem' + (feedSnapshot !== null && it.ts > feedSnapshot ? ' unread' : '') + (it.kind === 'krank' ? ' urgent' : '') },
        h('span', { class: 'fi t-' + it.type }, DP.icon(FEED_ICON[it.type] || 'alert', 'sm')),
        h('span', { class: 'grow' }, h('span', { class: 'fl', text: l[0] }), l[1] ? h('span', { class: 'fs', text: l[1] }) : null, h('span', { class: 'ft', text: DP.relTime(it.ts) })));
      row.addEventListener('click', function () { openFeedItem(it); });
      return row;
    }) : [h('div', { class: 'empty', text: 'Noch nichts Neues. Hier erscheint alles, was Mitarbeiter schicken: Nachrichten, Stunden, Anträge und Krankmeldungen.' })];
    let foot = null;
    if ('Notification' in window) {
      if (Notification.permission === 'granted') foot = h('div', { class: 'ffoot muted small', text: 'Desktop-Benachrichtigungen sind an. Sie erscheinen, wenn diese Seite im Hintergrund offen ist.' });
      else if (Notification.permission === 'denied') foot = h('div', { class: 'ffoot muted small', text: 'Desktop-Benachrichtigungen sind im Browser blockiert.' });
      else { const b = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Desktop-Benachrichtigungen erlauben' }); b.addEventListener('click', function () { try { Notification.requestPermission().then(renderFeedPanel); } catch (e) { /* nicht möglich */ } }); foot = h('div', { class: 'ffoot' }, b); }
    }
    feedPanel.replaceChildren(h('div', { class: 'fhead' }, h('strong', { text: 'Benachrichtigungen' }), h('span', { class: 'muted small', text: list.length ? 'letzte 7 Tage' : '' })), h('div', { class: 'flist' }, rows), foot);
  }
  function toggleFeed() {
    if (feedPanel) return closeFeedPanel();
    feedSnapshot = feedSeen(); if (feedSnapshot === null) feedSnapshot = Date.now();
    feedPanel = h('div', { class: 'feedpanel', role: 'dialog', 'aria-label': 'Benachrichtigungen' });
    document.body.append(feedPanel); state.feed.open = true;
    renderFeedPanel();
    setFeedSeen(Math.max(Date.now(), state.feed.lastTs)); updateBell();
    document.addEventListener('click', feedOutside, true); document.addEventListener('keydown', feedEsc);
    loadFeed();
  }
  function bellBtn() {
    const b = h('button', { type: 'button', class: 'btn btn-secondary btn-sm bellbtn', id: 'bellBtn', 'aria-label': 'Benachrichtigungen', title: 'Benachrichtigungen' }, DP.icon('bell', 'sm'), h('span', { class: 'bellbadge', style: 'display:none' }));
    b.addEventListener('click', function (e) { e.stopPropagation(); toggleFeed(); });
    return b;
  }

  // ---- Mitarbeiter suchen ----
  function searchDialog() {
    if (document.querySelector('.searchbox')) return;
    const input = h('input', { class: 'input', type: 'search', id: 'gs_q', placeholder: 'Name oder PIN …', autocomplete: 'off', 'aria-label': 'Mitarbeiter suchen' });
    const list = h('div', { class: 'sresults', role: 'listbox' });
    let idx = 0, hits = [], m = null;
    const go = function (e) { m.close(); openEmployee(e.pin); };
    const draw = function () {
      const q = input.value.trim().toLowerCase();
      hits = state.employees.filter(function (e) { return !q || (e.name + ' ' + e.pin).toLowerCase().indexOf(q) !== -1; }).sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); }).slice(0, 8);
      if (idx >= hits.length) idx = 0;
      list.replaceChildren(...(hits.length ? hits.map(function (e, i) {
        const b = h('button', { type: 'button', class: 'sres' + (i === idx ? ' on' : ''), role: 'option' }, DP.avatar(e.name, 'avatar small'), h('span', { class: 'grow' }, h('span', { class: 'nm', text: e.name }), h('span', { class: 'muted small', text: '  PIN ' + e.pin })), e.account ? null : h('span', { class: 'badge neutral', text: 'kein Zugang' }));
        b.addEventListener('click', function () { go(e); });
        return b;
      }) : [h('div', { class: 'empty', text: 'Keine Treffer.' })]));
    };
    input.addEventListener('input', function () { idx = 0; draw(); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); idx = Math.min(idx + 1, hits.length - 1); draw(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); idx = Math.max(idx - 1, 0); draw(); }
      else if (ev.key === 'Enter' && hits[idx]) { ev.preventDefault(); go(hits[idx]); }
    });
    m = DP.modal({ title: 'Mitarbeiter suchen', body: h('div', { class: 'stack-sm searchbox' }, input, list, h('p', { class: 'muted small', text: 'Mit Pfeiltasten wählen, mit Enter das Profil öffnen. Aufrufen mit Strg+K oder /.' })), actions: [{ label: 'Schließen', kind: 'secondary' }] });
    draw(); setTimeout(function () { input.focus(); }, 50);
  }
  function verifyDialog() {
    const inp = h('input', { class: 'input', id: 'vr_code', type: 'text', placeholder: 'ABCD-EFGH-JKLM', autocomplete: 'off', maxlength: '20' });
    const out = h('div', {});
    const run = async function () {
      out.replaceChildren(h('span', { class: 'spinner' }));
      const r = await adm('verifyReceipt', { code: inp.value });
      if (r.status !== 'success') { out.replaceChildren(alertBox('error', r.message || 'Das hat nicht geklappt.')); return; }
      if (!r.valid) { out.replaceChildren(alertBox('error', r.message || 'Diese Prüfnummer ist ungültig.')); return; }
      out.replaceChildren(h('div', { class: 'card stack-sm' }, alertBox('success', 'Gültig. Diese Bestätigung stammt aus diesem System und wurde seitdem nicht verändert.'),
        h('dl', { class: 'rc-meta' }, h('div', {}, h('dt', { text: 'Mitarbeiter' }), h('dd', { text: r.name })), h('div', {}, h('dt', { text: 'Monat' }), h('dd', { text: PD.monthLabel(r.monat + '-01') })),
          h('div', {}, h('dt', { text: 'Summe' }), h('dd', { text: String(r.summe).replace('.', ',') + ' Std.' })), h('div', {}, h('dt', { text: 'Tage' }), h('dd', { text: String(r.days) })),
          h('div', {}, h('dt', { text: 'Bestätigt am' }), h('dd', { text: DP.fmtDateTime(r.confirmedAt) })))));
    };
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    DP.modal({ title: 'Bestätigung prüfen', wide: true,
      body: h('div', { class: 'stack-sm' }, h('p', { class: 'muted small', text: 'Gib die Prüfnummer von einer Stunden-Bestätigung ein. Das System sagt dir, ob sie echt ist und zu welchen Angaben sie gehört.' }), field('Prüfnummer', inp, 'vr_code'), out),
      actions: [{ label: 'Schließen', kind: 'secondary' }, { label: 'Prüfen', kind: 'primary', closes: false, onClick: run }] });
    setTimeout(function () { inp.focus(); }, 50);
  }
  function searchBtn() {
    const b = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', id: 'searchBtn', 'aria-label': 'Mitarbeiter suchen (Strg+K)', title: 'Mitarbeiter suchen (Strg+K)' }, DP.icon('search', 'sm'));
    b.addEventListener('click', searchDialog);
    return b;
  }
  document.addEventListener('keydown', function (e) {
    if (!state.session || e.defaultPrevented) return;
    const k = String(e.key || '').toLowerCase(), tag = (document.activeElement && document.activeElement.tagName) || '';
    if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); searchDialog(); }
    else if (k === '/' && !/INPUT|TEXTAREA|SELECT/.test(tag) && !document.querySelector('.overlay')) { e.preventDefault(); searchDialog(); }
  });

  // ---- Anklickbare Namen ----
  const nameLink = function (name, pin, cls) { return h('span', { class: (cls || 'nm') + (pin ? ' who-link' : ''), text: name, dataset: pin ? { pin: pin } : {} }); };
  const pinFor = function (x) { if (x && x.pin) return x.pin; const e = state.employees.filter(function (y) { return y.name === (x && x.name); })[0]; return e ? e.pin : ''; };
  const messagesViewNamed = messagesView;
  messagesView = function () {
    const el = messagesViewNamed();
    const pane = el && el.querySelector ? el.querySelector('.thread-pane') : null;
    const e = state.msg.pin ? state.employees.filter(function (y) { return y.pin === state.msg.pin; })[0] : null;
    if (pane && pane.prepend && e) pane.prepend(h('div', { class: 'thread-head' }, nameLink(e.name, e.pin), h('span', { class: 'muted small', text: '  PIN ' + e.pin + ' · Profil öffnen' })));
    return el;
  };

  // ---- Sammel-Zugänge: Mitarbeiter auswählen, mit einem Klick Passwörter erzeugen ----
  function bulkAccountsDialog(pre) {
    const all = state.employees.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'de'); });
    let mode = (pre && pre.mode) || (all.some(function (e) { return !e.account; }) ? 'new' : 'reset');
    const sel = new Set();
    const q = h('input', { class: 'input', type: 'search', placeholder: 'Suchen …', 'aria-label': 'Mitarbeiter suchen' });
    const list = h('div', { class: 'bulklist' }), cnt = h('span', { class: 'muted small' }), hint = h('p', { class: 'muted small' });
    const nNew = all.filter(function (e) { return !e.account; }).length, nAcc = all.length - nNew;
    const tabNew = h('button', { type: 'button', class: 'chip', text: 'Zugang anlegen (' + nNew + ')' }), tabReset = h('button', { type: 'button', class: 'chip', text: 'Passwort zurücksetzen (' + nAcc + ')' });
    const eligible = function () { const s = q.value.trim().toLowerCase(); return all.filter(function (e) { return (mode === 'new' ? !e.account : !!e.account) && (!s || (e.name + ' ' + e.pin).toLowerCase().indexOf(s) !== -1); }); };
    let runBtn = null;
    const refreshBtn2 = function () {
      tabNew.className = 'chip' + (mode === 'new' ? ' active' : ''); tabReset.className = 'chip' + (mode === 'reset' ? ' active' : '');
      cnt.textContent = sel.size + ' ausgewählt';
      hint.textContent = mode === 'new' ? 'Für die Ausgewählten wird je ein Zugang mit vorläufigem Passwort angelegt. Danach druckst du die Zettel.' : 'Für die Ausgewählten wird ein neues vorläufiges Passwort erzeugt. Ihre Geräte werden sofort abgemeldet.';
      if (runBtn) { runBtn.textContent = (mode === 'new' ? 'Zugänge anlegen' : 'Passwörter zurücksetzen') + ' (' + sel.size + ')'; runBtn.disabled = !sel.size; }
    };
    const draw = function () {
      const rows = eligible();
      list.replaceChildren(...(rows.length ? rows.map(function (e) {
        const cb = h('input', { type: 'checkbox', id: 'bk_' + e.pin }); cb.checked = sel.has(e.pin);
        cb.addEventListener('change', function () { if (cb.checked) sel.add(e.pin); else sel.delete(e.pin); refreshBtn2(); });
        return h('label', { class: 'bkrow', for: 'bk_' + e.pin }, cb, DP.avatar(e.name, 'avatar small'), h('span', { class: 'grow' }, h('span', { class: 'nm', text: e.name }), h('span', { class: 'muted small', text: '  PIN ' + e.pin + (e.account ? ' · ' + e.account.username : '') })));
      }) : [h('div', { class: 'empty', text: mode === 'new' ? 'Alle haben schon einen Zugang.' : 'Noch niemand hat einen Zugang.' })]));
      refreshBtn2();
    };
    const setMode = function (m2) { mode = m2; sel.clear(); draw(); };
    tabNew.addEventListener('click', function () { setMode('new'); }); tabReset.addEventListener('click', function () { setMode('reset'); });
    q.addEventListener('input', draw);
    const allBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Alle auswählen' }), noneBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Keine' });
    allBtn.addEventListener('click', function () { eligible().forEach(function (e) { sel.add(e.pin); }); draw(); }); noneBtn.addEventListener('click', function () { sel.clear(); draw(); });
    const m = DP.modal({
      title: 'Zugänge für mehrere Mitarbeiter', wide: true,
      body: h('div', { class: 'stack-sm' }, h('div', { class: 'row wrap' }, tabNew, tabReset), hint, h('div', { class: 'row wrap' }, q, allBtn, noneBtn, h('div', { class: 'grow' }), cnt), list),
      actions: [{ label: 'Abbrechen', kind: 'secondary' }, {
        label: 'Los', kind: 'primary', closes: false,
        onClick: async function (api) {
          const picked = all.filter(function (e) { return sel.has(e.pin); });
          if (!picked.length) return;
          if (mode === 'reset' && !(await DP.confirm('Passwörter zurücksetzen?', 'Für ' + picked.length + ' Mitarbeiter wird ein neues vorläufiges Passwort erzeugt. Alle angemeldeten Geräte dieser Personen werden sofort abgemeldet.', 'Zurücksetzen', 'danger'))) return;
          api.close();
          const prog = h('p', { text: '0 von ' + picked.length + ' …' });
          const pm = DP.modal({ title: mode === 'new' ? 'Zugänge werden angelegt' : 'Passwörter werden erzeugt', dismissable: false, body: h('div', { class: 'stack-sm' }, prog, h('span', { class: 'spinner' })), actions: [] });
          const done = [], failed = [];
          for (const e of picked) {
            const r = mode === 'new' ? await adm('adminAccCreate', { pin: e.pin }) : await adm('adminAccReset', { id: e.account.id });
            if (r.status === 'success') done.push({ name: e.name, username: r.username || (e.account && e.account.username) || '', password: r.password });
            else { failed.push(e.name); if (r.code === 'ADMIN_AUTH') break; }
            prog.textContent = done.length + ' von ' + picked.length + ' …';
          }
          pm.close(); await refresh();
          if (done.length) showSlips(done, failed); else DP.toast('Es hat nicht geklappt.', 'error');
        }
      }]
    });
    runBtn = m.el ? m.el.querySelector('.actions .btn-primary') : document.querySelector('.modal .actions .btn-primary');
    draw();
  }
  const accountsViewPrev = accountsView;
  accountsView = function () {
    const el = accountsViewPrev();
    if (isVoll() && el && el.prepend) { const b = h('button', { type: 'button', class: 'btn btn-primary btn-sm', id: 'bulkPickBtn', text: 'Mehrere auswählen …' }); b.addEventListener('click', function () { bulkAccountsDialog(); }); el.prepend(h('div', { class: 'row wrap' }, b, h('span', { class: 'muted small', text: 'Zugänge anlegen oder Passwörter zurücksetzen, für genau die Mitarbeiter, die du ankreuzt.' }))); }
    return el;
  };

  // ===================== Admin-Konten, Fristen, Schicht-Serie =====================
  const ROLE_OPTS = [['planer', 'Planer: Plan, Anträge und Nachrichten bearbeiten'], ['lesen', 'Nur ansehen: nichts ändern'], ['admin', 'Vollzugriff: wie du']];
  async function userRole(u) {
    const sel = h('select', { class: 'input', id: 'ur_role' }, ROLE_OPTS.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    sel.value = u.role;
    const err = h('div', {});
    DP.modal({
      title: 'Rolle von ' + u.name + ' ändern', wide: true,
      body: h('div', { class: 'stack-sm' }, field('Rolle', sel, 'ur_role', 'Die neue Rolle gilt sofort. ' + u.name + ' wird dabei abgemeldet und muss sich neu anmelden.'), err),
      actions: [{ label: 'Abbrechen', kind: 'secondary' }, {
        label: 'Rolle ändern', kind: 'primary', closes: false,
        onClick: async function (api) {
          err.replaceChildren();
          const r = await adm('adminUserUpdate', { id: u.id, role: sel.value });
          if (r.status === 'success') { api.close(); DP.toast(u.name + ' ist jetzt „' + (ROLE_LABEL[r.role] || r.role) + '“.'); await loadUsers(); renderTab(); }
          else if (r.code !== 'ADMIN_AUTH') err.append(alertBox('error', r.message || 'Das hat nicht geklappt.'));
        }
      }]
    });
  }
  function userDelete(u) {
    const conf = h('input', { class: 'input', id: 'ud_name', type: 'text', autocomplete: 'off', placeholder: u.name });
    const err = h('div', {});
    DP.modal({
      title: 'Konto von ' + u.name + ' löschen',
      body: h('div', { class: 'stack-sm' }, h('p', { text: 'Das Konto wird entfernt, ' + u.name + ' kann sich nicht mehr anmelden und wird sofort abgemeldet. Die Einträge im Protokoll bleiben erhalten. Mitarbeiterdaten sind nicht betroffen.' }), field('Zur Sicherheit den Namen eingeben', conf, 'ud_name', u.name), err),
      actions: [{ label: 'Abbrechen', kind: 'secondary' }, {
        label: 'Löschen', kind: 'danger', closes: false,
        onClick: async function (api) {
          err.replaceChildren();
          const r = await adm('adminUserDelete', { id: u.id, confirmName: conf.value });
          if (r.status === 'success') { api.close(); DP.toast('Konto gelöscht.'); await loadUsers(); renderTab(); }
          else if (r.code !== 'ADMIN_AUTH') err.append(alertBox('error', r.message || 'Das hat nicht geklappt.'));
        }
      }]
    });
  }

  // ---- Fristen ----
  const EXP_LABEL = { abgelaufen: ['abgelaufen', 'danger'], bald: ['läuft bald ab', 'warn'], ok: ['gültig', 'neutral'] };
  function expiryText(e) { return e.state === 'abgelaufen' ? 'seit ' + Math.abs(e.days) + (Math.abs(e.days) === 1 ? ' Tag' : ' Tagen') + ' abgelaufen' : e.days === 0 ? 'läuft heute ab' : 'noch ' + e.days + (e.days === 1 ? ' Tag' : ' Tage'); }
  function expiryForm(emp, list) {
    let rows = (list || []).map(function (e) { return { label: e.label, date: e.date, note: e.note || '' }; });
    const box = h('div', { class: 'stack-sm' }), err = h('div', {});
    const draw = function () {
      const items = rows.map(function (e, i) {
        const l = h('input', { class: 'input', type: 'text', maxlength: '40', value: e.label, placeholder: 'z. B. Führerschein Klasse D', 'aria-label': 'Bezeichnung ' + (i + 1) });
        const d = h('input', { class: 'input', type: 'date', value: e.date, 'aria-label': 'Gültig bis ' + (i + 1) });
        const n = h('input', { class: 'input', type: 'text', maxlength: '80', value: e.note, placeholder: 'Notiz (optional)', 'aria-label': 'Notiz ' + (i + 1) });
        l.addEventListener('input', function () { e.label = l.value; }); d.addEventListener('input', function () { e.date = d.value; }); n.addEventListener('input', function () { e.note = n.value; });
        const del = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Frist entfernen', title: 'Frist entfernen' }, DP.icon('x', 'sm'));
        del.addEventListener('click', function () { rows.splice(i, 1); draw(); });
        return h('div', { class: 'exprow' }, l, d, n, del);
      });
      const add = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: '+ Frist hinzufügen' });
      add.disabled = rows.length >= 8;
      add.addEventListener('click', function () { rows.push({ label: '', date: '', note: '' }); draw(); });
      const quick = h('div', { class: 'row wrap' }, ['Führerschein Klasse D', 'Fahrerkarte', 'Erste Hilfe', 'Unterweisung', 'Betriebsärztliche Untersuchung'].map(function (q) {
        const b = h('button', { type: 'button', class: 'chip', text: '+ ' + q });
        b.disabled = rows.length >= 8 || rows.some(function (x) { return x.label.toLowerCase() === q.toLowerCase(); });
        b.addEventListener('click', function () { rows.push({ label: q, date: '', note: '' }); draw(); });
        return b;
      }));
      box.replaceChildren(...(items.length ? items : [h('p', { class: 'muted', text: 'Noch keine Fristen eingetragen.' })]), add, h('div', { class: 'hint', text: 'Oft gebraucht:' }), quick);
    };
    draw();
    DP.modal({
      title: 'Fristen von ' + emp.name, wide: true,
      body: h('div', { class: 'stack-sm' }, h('p', { class: 'muted small', text: 'Trage ein, was ablaufen kann: Führerschein, Fahrerkarte, Unterweisung, Untersuchung. 30 Tage vorher warnt die Übersicht, und im Profil steht es farbig.' }), box, err),
      actions: [{ label: 'Abbrechen', kind: 'secondary' }, {
        label: 'Speichern', kind: 'primary', closes: false,
        onClick: async function (api) {
          err.replaceChildren();
          const clean = rows.filter(function (e) { return e.label.trim() || e.date; });
          if (clean.some(function (e) { return !e.label.trim() || !e.date; })) { err.append(alertBox('error', 'Bitte bei jeder Frist eine Bezeichnung und ein Datum angeben, oder die Zeile entfernen.')); return; }
          const r = await adm('adminEmployeeExpiry', { pin: emp.pin, expiries: clean });
          if (r.status === 'success') { api.close(); DP.toast('Fristen gespeichert.'); await Promise.all([loadStaff(), loadExpiry()]); renderTab(); }
          else if (r.code !== 'ADMIN_AUTH') err.append(alertBox('error', r.message || 'Das hat nicht geklappt.'));
        }
      }]
    });
  }
  state.expiry = null;
  async function loadExpiry() { const r = await adm('adminExpiryOverview'); if (r.status === 'success') state.expiry = r.items; }
  // Widersprüche und Bestätigungen zu den Stunden
  state.acks = null;
  async function loadAcks() { const r = await adm('adminHoursAcks', { month: PD.monthAdd(PD.today(), -1).slice(0, 7) }); if (r.status === 'success') state.acks = r; }
  function acksCard() {
    const A2 = state.acks;
    if (!A2 || !A2.items.length) return null;
    const open = A2.items.filter(function (x) { return x.status === 'abgelehnt'; });
    const done = A2.items.filter(function (x) { return x.status === 'bestaetigt'; });
    const wait = A2.items.filter(function (x) { return x.status === 'offen'; });
    if (!open.length && !done.length && !wait.length) return null;
    return h('section', { class: 'card stack-sm' + (open.length ? ' warncard' : '') },
      h('div', { class: 'row between' }, h('h3', {}, 'Stunden ' + PD.monthLabel(A2.month + '-01')), h('span', { class: 'badge ' + (open.length ? 'danger' : 'neutral'), text: open.length ? open.length + ' Widerspruch' : done.length + ' bestätigt' })),
      open.length ? open.map(function (x) {
        const row = h('button', { type: 'button', class: 'prow linkrow' }, DP.avatar(x.name, 'avatar small'),
          h('div', { class: 'grow' }, h('div', { class: 't', text: x.name }), h('div', { class: 's', text: '„' + x.text + '“' })), h('span', { class: 'badge danger', text: 'widerspricht' }));
        row.addEventListener('click', function () { openEmployee(x.pin, A2.month); });
        return row;
      }) : null,
      h('p', { class: 'muted small', text: done.length + ' bestätigt, ' + wait.length + ' noch offen, ' + A2.items.filter(function (x) { return !x.status; }).length + ' nicht freigegeben.' }));
  }
  function uncoveredCard() {
    const list = (state.dash && state.dash.uncovered) || [];
    if (!list.length) return null;
    const total = list.reduce(function (a, x) { return a + x.count; }, 0);
    return h('section', { class: 'card stack-sm warncard' },
      h('div', { class: 'row between' }, h('h3', {}, DP.icon('alert', 'sm'), ' Abwesend, aber noch eingeplant'), h('span', { class: 'badge danger', text: total + (total === 1 ? ' Schicht' : ' Schichten') })),
      h('p', { class: 'muted small', text: 'Diese Mitarbeiter sind krank gemeldet oder im Urlaub, ihre Schichten stehen aber noch im Plan. Bitte absagen oder jemand anderem geben.' }),
      list.slice(0, 6).map(function (x) {
        const open = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', text: 'Im Plan öffnen' });
        open.addEventListener('click', function () { if (x.shifts[0]) { state.plan.weekStart = PD.weekStart(x.shifts[0].date); state.plan.view = null; } gotoTab('plan'); });
        return h('div', { class: 'prow' }, DP.avatar(x.name, 'avatar small'),
          h('div', { class: 'grow' }, h('div', { class: 't' }, nameLink(x.name, x.pin)), h('div', { class: 's', text: (x.type === 'krank' ? 'Krank' : 'Urlaub') + ' ' + (x.from === x.to ? PD.short(x.from) : PD.short(x.from) + ' – ' + PD.short(x.to)) + ' · ' + x.shifts.map(function (s) { return PD.short(s.date) + ' ' + s.place; }).slice(0, 3).join(', ') })), open);
      }), list.length > 6 ? h('p', { class: 'muted small', text: 'und ' + (list.length - 6) + ' weitere' }) : null);
  }
  function expiryCard() {
    const items = state.expiry;
    if (!items || !items.length) return null;
    const over = items.filter(function (i) { return i.state === 'abgelaufen'; }).length;
    return h('section', { class: 'card stack-sm' }, h('div', { class: 'row between' }, h('h3', { text: 'Fristen im Blick' }), h('span', { class: 'badge ' + (over ? 'danger' : 'warn'), text: over ? over + ' abgelaufen' : items.length + ' bald fällig' })),
      items.slice(0, 8).map(function (i) {
        const row = h('button', { type: 'button', class: 'prow linkrow' }, DP.avatar(i.name, 'avatar small'),
          h('div', { class: 'grow' }, h('div', { class: 't', text: i.name }), h('div', { class: 's', text: i.label + ' · ' + PD.short(i.date) + (i.note ? ' · ' + i.note : '') })),
          h('span', { class: 'badge ' + EXP_LABEL[i.state][1], text: expiryText(i) }));
        row.addEventListener('click', function () { openEmployee(i.pin); });
        return row;
      }), items.length > 8 ? h('p', { class: 'muted small', text: 'und ' + (items.length - 8) + ' weitere' }) : null);
  }

  // ---- Schicht-Serie: wiederkehrende Schichten ----
  const WD_NAMES = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  function seriesDialog(pre) {
    const emps = (state.plan.data && state.plan.data.employees ? state.plan.data.employees : []).filter(function (e) { return e.pin !== '00'; });
    const places = (state.plan.data && state.plan.data.places) || DP.PLACES;
    const tpls = (state.plan.data && state.plan.data.templates) || [];
    const emp = h('select', { class: 'input', id: 'se_emp' }, [h('option', { value: '00', text: 'Offene Schichten (für alle)' })].concat(emps.map(function (e) { return h('option', { value: e.pin, text: e.name }); })));
    if (pre && pre.pin) emp.value = pre.pin;
    const place = h('select', { class: 'input', id: 'se_place' }, places.map(function (p) { return h('option', { value: p, text: p }); }));
    if (pre && pre.place) place.value = pre.place;
    const start = h('input', { class: 'input', id: 'se_start', type: 'time', value: (pre && pre.start) || '22:00' });
    const end = h('input', { class: 'input', id: 'se_end', type: 'time', value: (pre && pre.end) || '08:00' });
    const from = h('input', { class: 'input', id: 'se_from', type: 'date', value: (pre && pre.date) || PD.today() });
    const to = h('input', { class: 'input', id: 'se_to', type: 'date', value: PD.add((pre && pre.date) || PD.today(), 27) });
    const days = new Set(pre && pre.date ? [PD.weekday(pre.date)] : []);
    const dayBox = h('div', { class: 'row wrap' }, WD_NAMES.map(function (n, i) {
      const b = h('button', { type: 'button', class: 'chip' + (days.has(i) ? ' active' : ''), text: n.slice(0, 2), 'aria-label': n, 'aria-pressed': days.has(i) ? 'true' : 'false' });
      b.addEventListener('click', function () { if (days.has(i)) days.delete(i); else days.add(i); b.className = 'chip' + (days.has(i) ? ' active' : ''); b.setAttribute('aria-pressed', days.has(i) ? 'true' : 'false'); preview(); });
      return b;
    }));
    const every = h('select', { class: 'input', id: 'se_every' }, [['1', 'jede Woche'], ['2', 'jede zweite Woche'], ['3', 'jede dritte Woche'], ['4', 'jede vierte Woche']].map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    const skipBusy = h('input', { type: 'checkbox', id: 'se_skip' }); skipBusy.checked = true;
    const info = h('div', { class: 'hint seriesinfo', id: 'se_info' }), err = h('div', {});
    const tplBox = h('div', { class: 'row wrap' }, tpls.slice(0, 12).map(function (t) {
      const b = h('button', { type: 'button', class: 'chip', text: DP.placeShort(t.place) + ' ' + t.start + '–' + t.end });
      b.addEventListener('click', function () { place.value = t.place; start.value = t.start; end.value = t.end; preview(); });
      return b;
    }));
    const dates = function () {
      const a = from.value, b = to.value, n = Number(every.value) || 1, out = [];
      if (!a || !b || a > b) return out;
      const first = PD.weekStart(a);
      for (let d = a; d <= b && out.length < 200; d = PD.add(d, 1)) {
        if (!days.has(PD.weekday(d))) continue;
        const w = Math.round((PD.parse(PD.weekStart(d)) - PD.parse(first)) / 604800000);
        if (w % n === 0) out.push(d);
      }
      return out;
    };
    const preview = function () {
      const list = dates();
      const h2 = PD.hours(start.value, end.value);
      info.textContent = !list.length ? 'Bitte Wochentage und einen Zeitraum wählen.' : list.length + (list.length === 1 ? ' Schicht' : ' Schichten') + ' werden angelegt' + (h2 ? ', zusammen ' + PD.fmtHours(list.length * h2) + ' Std.' : '') + ' · erste am ' + PD.short(list[0]) + ', letzte am ' + PD.short(list[list.length - 1]) + '.';
    };
    [from, to, every, start, end].forEach(function (el) { el.addEventListener('input', preview); el.addEventListener('change', preview); });
    preview();
    DP.modal({
      title: 'Serie anlegen', wide: true,
      body: h('div', { class: 'stack-sm' },
        h('div', { class: 'form-grid' }, field('Mitarbeiter', emp, 'se_emp'), field('Standort', place, 'se_place'), field('Beginn', start, 'se_start'), field('Ende', end, 'se_end'), field('Von', from, 'se_from'), field('Bis einschließlich', to, 'se_to')),
        tpls.length ? h('div', {}, h('label', { text: 'Vorlage übernehmen' }), tplBox) : null,
        h('div', {}, h('label', { text: 'An diesen Wochentagen' }), dayBox),
        field('Wiederholung', every, 'se_every'),
        h('label', { class: 'check', for: 'se_skip' }, skipBusy, h('span', {}, h('strong', { text: 'Belegte Tage überspringen' }), h('div', { class: 'hint', text: 'Tage, an denen die Person schon eine Schicht hat oder krank bzw. im Urlaub ist, werden ausgelassen.' }))),
        info, err),
      actions: [{ label: 'Abbrechen', kind: 'secondary' }, {
        label: 'Serie anlegen', kind: 'primary', closes: false,
        onClick: async function (api) {
          err.replaceChildren();
          let list = dates();
          if (!list.length) { err.append(alertBox('error', 'Bitte mindestens einen Wochentag und einen gültigen Zeitraum wählen.')); return; }
          if (!PD.hours(start.value, end.value)) { err.append(alertBox('error', 'Beginn und Ende dürfen nicht gleich sein.')); return; }
          const pin = emp.value;
          let skipped = 0;
          if (skipBusy.checked) {
            // Für den ganzen Zeitraum nachsehen, nicht nur für die angezeigte Woche
            const range = await adm('adminShiftList', { from: list[0], to: list[list.length - 1] });
            if (range.status !== 'success') { if (range.code !== 'ADMIN_AUTH') err.append(alertBox('error', range.message || 'Der Zeitraum konnte nicht geprüft werden.')); return; }
            const busy = {};
            (range.shifts || []).forEach(function (s) { if (s.pin === pin && s.status !== 'abgesagt') busy[s.date] = 1; });
            (range.absences || []).forEach(function (ab) { if (ab.pin !== pin) return; for (let d = ab.from; d <= ab.to && d <= list[list.length - 1]; d = PD.add(d, 1)) busy[d] = 1; });
            const before = list.length;
            list = list.filter(function (d) { return !busy[d]; });
            skipped = before - list.length;
            if (!list.length) { err.append(alertBox('error', 'An allen ' + before + ' Tagen ist die Person schon eingeplant oder abwesend. Es gibt nichts anzulegen.')); return; }
          }
          if (list.length > 120) { err.append(alertBox('error', 'Das wären ' + list.length + ' Schichten. Bitte den Zeitraum kleiner wählen (höchstens 120).')); return; }
          if (!(await DP.confirm('Serie anlegen?', list.length + (list.length === 1 ? ' Schicht wird' : ' Schichten werden') + ' als Entwurf angelegt' + (skipped ? ' (' + skipped + ' belegte Tage übersprungen)' : '') + '. Veröffentlichen musst du danach wie gewohnt.', 'Anlegen'))) return;
          const r = await adm('adminShiftBatch', { ops: list.map(function (d) { return { op: 'set', pin: pin, date: d, place: place.value, start: start.value, end: end.value }; }) });
          if (r.status !== 'success') { if (r.code !== 'ADMIN_AUTH') err.append(alertBox('error', r.message || 'Das hat nicht geklappt.')); return; }
          api.close();
          const parts = [];
          if (r.created) parts.push(r.created + ' neu');
          if (r.updated) parts.push(r.updated + ' geändert');
          if (r.unchanged) parts.push(r.unchanged + ' unverändert');
          if (skipped) parts.push(skipped + ' übersprungen');
          DP.toast('Serie angelegt: ' + (parts.join(', ') || 'nichts zu tun') + '.');
          await loadPlan(); renderTab();
        }
      }]
    });
  }

  // ---------- Start ----------
  const s = store.load();
  if (s) { state.session = { token: s.token }; bridgeSession(s.token); startConsole(); } else showLogin();
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { /* ohne Zwischenspeicher */ }); } catch (e) { /* egal */ }
})();

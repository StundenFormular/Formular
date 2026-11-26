/* Abschalter und Hinweis-Text (gemeinsam für alle Seiten).
   1) Ist der Dienst abgeschaltet, zeigt jede Seite nur noch eine einfache „403 Forbidden“-Seite (kein Logo, kein Hinweis, nichts anderes).
   2) Der Hinweis-Text unten steht hier an EINER Stelle (FOOTER_TEXT) und wird in alle Seiten eingefügt. */
(function () {
  'use strict';
  if (window.__dienstLoaded) return;
  window.__dienstLoaded = true;

  var API_URL = 'https://script.google.com/macros/s/AKfycbzNrtg6-hoAv_kWkuE_noqRtlRYYJAzQMxJnpnEbyP3b4JjlHyG4vPVsuqdC45xrPe9/exec';
  var API_TOKEN = 'Zk0sUhvBN2XU13DGgeAwhm-H-rtmBcK1OwJR7NLc1VI';
  var KEY = 'dienstAus';
  var FOOTER_TEXT = 'Dieser Dienst wurde entwickelt und an den Betreiber übergeben. Der Betrieb und die Verantwortung für die Datenverarbeitung liegen allein beim jeweiligen Betreiber. Der Entwickler hat keinen Zugriff auf die Daten und übernimmt keine Haftung für Betrieb, Inhalte oder Datenschutz.';

  var me = document.currentScript;
  var CSS = me && me.src ? me.src.replace(/\.js(\?.*)?$/, '.css') : 'dienst-aus.2.css';
  var isAdminPage = /dienstplan-admin\.html$/.test(location.pathname);
  var embedded = false;
  try { embedded = window.top !== window.self; } catch (e) { embedded = true; }

  function flag(v) {
    try {
      if (v === undefined) return localStorage.getItem(KEY) === '1';
      if (v) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY);
    } catch (e) { /* gesperrt */ }
    return false;
  }

  // ---------- Abfrage beim Server ----------
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  function post(body) {
    return realFetch(API_URL, { method: 'POST', body: JSON.stringify(Object.assign({ token: API_TOKEN }, body)), credentials: 'omit', referrerPolicy: 'no-referrer' }).then(function (r) { return r.json(); });
  }
  var lastPing = 0;
  function ping(force) {
    if (!realFetch || window.__dienstAus) return;
    var now = Date.now();
    if (!force && now - lastPing < 120000) return;
    lastPing = now;
    post({ action: 'dienstStatus' }).then(function (d) {
      if (d && d.code === 'OFF') show403();
      else if (d && d.on) flag(false);
    }).catch(function () { /* offline: nichts tun */ });
  }

  // Jede Antwort vom Server prüfen: kommt „OFF“, sofort 403 (kleine Antworten werden gelesen, große nicht)
  if (realFetch) {
    window.fetch = function (input, init) {
      var p = realFetch(input, init);
      var u = '';
      try { u = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) { /* egal */ }
      if (u.indexOf('script.google.com/macros/') === -1) return p;
      return p.then(function (res) {
        try {
          var len = Number(res.headers.get('content-length') || 0);
          if (!len || len < 600) {
            res.clone().text().then(function (t) { if (t.length < 600 && t.indexOf('"code":"OFF"') !== -1) show403(); }).catch(function () { /* egal */ });
          }
        } catch (e) { /* egal */ }
        return res;
      });
    };
  }

  // ---------- Die 403-Seite ----------
  function killWorkers() {
    try { if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) navigator.serviceWorker.getRegistrations().then(function (l) { l.forEach(function (r) { r.unregister(); }); }); } catch (e) { /* egal */ }
    try { if (window.caches && caches.keys) caches.keys().then(function (k) { k.forEach(function (n) { caches.delete(n); }); }); } catch (e) { /* egal */ }
  }
  function stopTimers() {
    var t = setTimeout(function () {}, 0);
    for (var i = 0; i <= t; i++) { clearTimeout(i); clearInterval(i); }
  }
  function render403() {
    if (document.readyState === 'loading') {
      // Seite wird gerade erst geladen (Skript steht im Kopf): 403-Seite einfügen und den ganzen Rest der alten Seite als verstecktes Textstück verschlucken, damit nichts davon läuft
      document.write('<title>403 Forbidden</title><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><link rel="stylesheet" href="' + CSS + '"></head><body class="d403"><h1 id="d403h">403 Forbidden</h1><p>You don\'t have permission to access this resource.</p><hr><div id="d403x"></div><plaintext hidden>');
    } else {
      build403();
    }
  }
  function build403() {
    var de = document.documentElement;
    de.removeAttribute('style'); de.removeAttribute('class'); de.setAttribute('lang', 'en');
    while (de.firstChild) de.removeChild(de.firstChild);
    var head = document.createElement('head');
    var m1 = document.createElement('meta'); m1.setAttribute('charset', 'utf-8');
    var m2 = document.createElement('meta'); m2.name = 'viewport'; m2.content = 'width=device-width, initial-scale=1';
    var m3 = document.createElement('meta'); m3.name = 'robots'; m3.content = 'noindex, nofollow';
    var ti = document.createElement('title'); ti.textContent = '403 Forbidden';
    var ln = document.createElement('link'); ln.rel = 'stylesheet'; ln.href = CSS;
    head.appendChild(m1); head.appendChild(m2); head.appendChild(m3); head.appendChild(ti); head.appendChild(ln);
    var body = document.createElement('body'); body.className = 'd403';
    var h = document.createElement('h1'); h.id = 'd403h'; h.textContent = '403 Forbidden';
    var p = document.createElement('p'); p.textContent = "You don't have permission to access this resource.";
    var hr = document.createElement('hr');
    var x = document.createElement('div'); x.id = 'd403x';
    body.appendChild(h); body.appendChild(p); body.appendChild(hr); body.appendChild(x);
    de.appendChild(head); de.appendChild(body);
  }
  function show403() {
    if (window.__dienstAus) return;
    window.__dienstAus = true;
    flag(true);
    killWorkers();
    stopTimers();
    try { sessionStorage.removeItem('adm_session'); } catch (e) { /* egal */ }
    render403();
    // Wieder eingeschaltet? Sofort prüfen (auch beim Zurückkehren zur Seite), danach alle 30 Sekunden. Dann lädt die Seite neu.
    function recheck() {
      post({ action: 'dienstStatus' }).then(function (d) { if (d && d.on) { flag(false); location.reload(); } }).catch(function () { /* egal */ });
    }
    recheck();
    setInterval(recheck, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) recheck(); });
    window.addEventListener('pageshow', recheck);
    if (isAdminPage) hiddenAdmin();
  }

  // Nur auf der Konsole: 5 Klicks auf die Überschrift öffnen ein verstecktes PIN-Feld zum Wieder-Einschalten
  function hiddenAdmin() {
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', hiddenAdmin); return; }
    var h = document.getElementById('d403h'), box = document.getElementById('d403x');
    if (!h || !box) return;
    var n = 0, t0 = 0;
    h.addEventListener('click', function () {
      var now = Date.now();
      if (now - t0 > 5000) n = 0;
      t0 = now; n++;
      if (n < 5 || box.firstChild) return;
      var pin = document.createElement('input');
      pin.type = 'password'; pin.autocomplete = 'off'; pin.className = 'd403pin'; pin.setAttribute('aria-label', 'PIN');
      var go = document.createElement('button');
      go.type = 'button'; go.className = 'd403go'; go.textContent = 'OK';
      var msg = document.createElement('div'); msg.className = 'd403msg';
      box.appendChild(pin); box.appendChild(go); box.appendChild(msg);
      pin.focus();
      var busy = false;
      function run() {
        if (busy || !pin.value) return;
        busy = true; msg.textContent = '';
        post({ action: 'adminLogin', pin: pin.value }).then(function (r) {
          if (!r || r.status !== 'success' || !r.session) throw new Error((r && r.message) || 'Fehler');
          return post({ action: 'adminDienstSet', off: false, adminSession: r.session });
        }).then(function (r2) {
          if (r2 && r2.status === 'success') { flag(false); location.reload(); } else throw new Error((r2 && r2.message) || 'Fehler');
        }).catch(function (e) { msg.textContent = String(e && e.message || 'Fehler'); busy = false; });
      }
      go.addEventListener('click', run);
      pin.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') run(); });
    });
  }

  // ---------- Hinweis-Text unten ----------
  function makeFooter(dark) {
    var f = document.createElement('footer');
    f.className = 'dienst-foot' + (dark ? ' dienst-foot-dark' : '');
    f.setAttribute('data-dienst-foot', '1');
    var p = document.createElement('p');
    p.textContent = FOOTER_TEXT;
    var nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'Rechtliches');
    var a1 = document.createElement('a'); a1.href = 'datenschutz.html'; a1.textContent = 'Datenschutz';
    var a2 = document.createElement('a'); a2.href = 'impressum.html'; a2.textContent = 'Impressum';
    nav.appendChild(a1); nav.appendChild(document.createTextNode(' · ')); nav.appendChild(a2);
    f.appendChild(p); f.appendChild(nav);
    return f;
  }
  function addFooters() {
    if (window.__dienstAus || embedded) return;
    var path = location.pathname;
    if (/(datenschutz|impressum)\.html$/.test(path)) return;
    if (!document.getElementById('dienst-css')) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = CSS; l.id = 'dienst-css'; document.head.appendChild(l);
    }
    // Stunden-App: jede Vollbild-Ansicht bekommt ihren eigenen Hinweis; die Haupt-Ansicht zeigt ihn vor der Senden-Leiste
    var screens = document.querySelectorAll('.pinBack');
    if (screens.length) {
      for (var i = 0; i < screens.length; i++) if (!screens[i].querySelector('[data-dienst-foot]')) {
        screens[i].appendChild(makeFooter(true));
        screens[i].style.setProperty('padding-bottom', 'calc(96px + env(safe-area-inset-bottom))', 'important');   // Platz für den Hinweis-Text unten
      }
      var mw = document.getElementById('mainWrap');
      if (mw && !mw.querySelector('[data-dienst-foot]')) mw.appendChild(makeFooter(false));
      return;
    }
    if (document.querySelector('[data-dienst-foot]')) return;   // schon vorhanden (zweiter Durchlauf)
    // Dienstplan-Seiten haben schon eine Zeile mit Datenschutz/Impressum: die wird ersetzt
    var old = document.querySelector('footer.legal');
    if (old) { old.parentNode.replaceChild(makeFooter(false), old); return; }
    var foot = document.querySelector('.wrap > .foot');   // Übersichtslink
    if (foot && foot.parentNode) { foot.parentNode.insertBefore(makeFooter(false), foot.nextSibling); return; }
    document.body.appendChild(makeFooter(false));
  }

  // ---------- Start ----------
  if (flag()) {
    show403();            // sofort, schon vor dem ersten Bild
    return;
  }
  function ready() {
    addFooters();
    setTimeout(function () { addFooters(); }, 1200);   // Seiten, die ihren Inhalt erst später aufbauen
    ping(true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
  document.addEventListener('visibilitychange', function () { if (!document.hidden) ping(false); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) ping(true); });
})();

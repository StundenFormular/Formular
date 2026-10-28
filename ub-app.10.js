(function () {
  "use strict";
  var URL_API = "https://script.google.com/macros/s/AKfycbzNrtg6-hoAv_kWkuE_noqRtlRYYJAzQMxJnpnEbyP3b4JjlHyG4vPVsuqdC45xrPe9/exec";
  var API_TOKEN = "Zk0sUhvBN2XU13DGgeAwhm-H-rtmBcK1OwJR7NLc1VI";
  var vt = (location.hash || "").replace(/^#/, "").replace(/[^0-9a-f]/gi, "").slice(0, 64);
  var state = { month: "", data: null, tab: null, firstCall: true, offline: false, pwErr: "", loading: false, retry: null, mode: "basis", report: null, cErr: "", cTab: "", cMonth: "", cPerson: "", cScroll: 0, pdfCache: {}, cTick: 0 };
  var $ = function (id) { return document.getElementById(id); };
  var main = $("main"), title = $("title"), stand = $("stand"), standTxt = $("standTxt");

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var EYE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var LOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  // Wer irgendwo klickt: freundlicher Hinweis, dass hier nur angesehen wird
  var toastTimer = null, lastToast = 0;
  function say(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 4200);
  }
  function hint() {
    var now = Date.now(); if (now - lastToast < 1800) return; lastToast = now;
    var t = $("toast"); t.textContent = "Diese Seite ist nur zur Ansicht. Hier lässt sich nichts ändern."; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  document.addEventListener("click", function (e) {
    if (state.mode === "plan") return;   // im Dienstplan darf man bedienen
    var t = e.target;
    if (t.closest && t.closest(".chip, .seg, .lock, #title, .cs-entry, .cs-back, .cs-open, .cs-month, .cs-dl, .pl-host, .pl-ov, .pl-toast")) return;   // echte Bedienelemente: Monat, Reiter, Passwort
    hint();
  });
  document.addEventListener("contextmenu", function () { /* erlaubt, nur Ansicht */ });

  function fmtTime(ts) {
    if (!ts) return "";
    var d = new Date(ts), n = new Date(), p = function (x) { return String(x).padStart(2, "0"); };
    var hm = p(d.getHours()) + ":" + p(d.getMinutes());
    var day = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diff = Math.round((day(n) - day(d)) / 86400000);
    if (diff === 0) return "heute " + hm;
    if (diff === 1) return "gestern " + hm;
    return p(d.getDate()) + "." + p(d.getMonth() + 1) + ". " + hm;
  }
  function setStand() {
    stand.className = "stand" + (state.offline ? " off" : "");
    var upd = state.mode === "chef" && state.report ? state.report.updated : (state.data && state.data.updated);
    if (!upd) { standTxt.textContent = state.offline ? "keine Verbindung" : "verbinde …"; return; }
    var d = new Date(upd), p = function (x) { return String(x).padStart(2, "0"); };
    standTxt.textContent = (state.offline ? "Keine Verbindung · letzter Stand " : "Stand ") + p(d.getHours()) + ":" + p(d.getMinutes()) + (state.offline ? "" : " · aktualisiert sich selbst");
  }
  function grantKey(m) { return "ansicht_grant_" + m; }
  function getGrant(m) { try { return sessionStorage.getItem(grantKey(m)) || ""; } catch (e) { return ""; } }
  function setGrant(m, g) { try { sessionStorage.setItem(grantKey(m), g); } catch (e) {} }

  function api(extra) {
    var body = { token: API_TOKEN, action: "viewMonth", vt: vt };
    for (var k in extra) body[k] = extra[k];
    return fetch(URL_API, { method: "POST", body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }
  function devId() {   // zufällige Kennung dieses Geräts: dasselbe Gerät meldet sich nur einmal in der Glocke des Admins
    try {
      var d = localStorage.getItem("ub_dev");
      if (!d || !/^[0-9a-f]{16,40}$/.test(d)) { var a = new Uint8Array(12); (window.crypto || window.msCrypto).getRandomValues(a); d = Array.prototype.map.call(a, function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); localStorage.setItem("ub_dev", d); }
      return d;
    } catch (e) { return ""; }
  }
  function load(opts) {
    opts = opts || {};
    var m = opts.month || state.month || "";
    var req = { month: m, grant: getGrant(m) };
    if (state.firstCall) { req.open = true; req.dev = devId(); state.firstCall = false; }
    if (opts.password) req.password = opts.password;
    clearTimeout(state.retry);
    setLoading(true, state.data && state.data.sent ? "aktualisiere …" : "lade …");
    return api(req).then(function (r) {
      setLoading(false);
      state.offline = false;
      if (r.status === "success") {
        if (r.grant) setGrant(r.month, r.grant);
        if (r.month !== m && m) { /* Monat nicht (mehr) freigegeben: Server hat auf einen anderen gewechselt */ }
        state.month = r.month; state.data = r.needPassword ? Object.assign({}, r, { needPassword: true }) : r; state.pwErr = "";
        if (state.tab === null && r.sent) state.tab = (r.missing && r.missing.length) ? "o" : "g";
        render();
      } else if (r.code === "VIEW_PW" || r.code === "VIEW_RATE") { state.pwErr = r.message; render(); }
      else { state.data = { fatal: r }; render(); }
    }).catch(function () {
      setLoading(false); state.offline = true; setStand();
      if (!state.data || !state.data.sent) main.replaceChildren(msg("Keine Verbindung", "Bitte prüfe dein Internet. Es wird automatisch weiter versucht."));
      state.retry = setTimeout(function () { load({ month: state.month }); }, 8000);
    });
  }

  // Sichtbar machen, dass geladen wird: Balken oben, Drehkreis in der Mitte, Hinweise bei langer Wartezeit
  var loadTimers = [];
  function loaderNode(titleText) {
    var d = el("div", "loader"); d.id = "loader"; d.setAttribute("role", "status");
    d.appendChild(el("div", "spin")); d.lastChild.setAttribute("aria-hidden", "true");
    var b = el("b", "", titleText); b.id = "loadTitle"; d.appendChild(b);
    var s = el("span", "", "Das dauert beim ersten Öffnen ein paar Sekunden."); s.id = "loadSub"; d.appendChild(s);
    var dots = el("div", "dots"); dots.setAttribute("aria-hidden", "true"); dots.appendChild(el("i")); dots.appendChild(el("i")); dots.appendChild(el("i")); d.appendChild(dots);
    return d;
  }
  function setLoading(on, label) {
    state.loading = on;
    document.body.classList.toggle("loading", on);
    loadTimers.forEach(clearTimeout); loadTimers = [];
    if (on) {
      standTxt.textContent = label || "aktualisiere …";
      loadTimers.push(setTimeout(function () { var s = $("loadSub"); if (s) s.textContent = "Gleich geschafft …"; }, 4000));
      loadTimers.push(setTimeout(function () { var s = $("loadSub"); if (s) s.textContent = "Dauert länger als sonst. Bitte noch einen Moment Geduld."; }, 10000));
    } else setStand();
  }
  function msg(h, p) { var d = el("div", "msg"); d.appendChild(el("h2", "", h)); d.appendChild(el("p", "", p)); return d; }

  function monthChips(d) {
    if (!d.months || d.months.length < 2) return null;
    var wrap = el("div", "chips");
    d.months.forEach(function (m) {
      var b = el("button", "chip" + (m.month === d.month ? " on" : "")); b.type = "button";
      if (m.pw) { var s = el("span"); s.innerHTML = LOCK; b.appendChild(s.firstChild); }
      b.appendChild(document.createTextNode(m.label));
      b.addEventListener("click", function () { if (m.month === state.month) return; state.month = m.month; state.tab = null; state.data = Object.assign({}, state.data, { sent: null, needPassword: false, month: m.month, label: m.label }); render(); load({ month: m.month }); });
      wrap.appendChild(b);
    });
    return wrap;
  }
  function noteBox() {
    var n = el("div", "note"); n.innerHTML = EYE;
    n.appendChild(el("span", "", "Nur zur Ansicht. Hier kann nichts geändert, korrigiert oder abgeschickt werden."));
    return n;
  }
  // ---------- Chef-Ansicht: Monat wählen, Zusammenfassung, Mitarbeiter, Standort-PDF (nur lesen, nur mit Passwort) ----------
  function cGrantKey() { return "ansicht_chef_grant"; }
  function getCGrant() { try { return sessionStorage.getItem(cGrantKey()) || ""; } catch (e) { return ""; } }
  function setCGrant(g) { try { if (g) sessionStorage.setItem(cGrantKey(), g); else sessionStorage.removeItem(cGrantKey()); } catch (e) {} }
  function apiX(action, extra) {
    var body = { token: API_TOKEN, action: action, vt: vt };
    for (var k in extra) body[k] = extra[k];
    return fetch(URL_API, { method: "POST", body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }
  function fh(x) { return x === "" || x == null ? "" : String(Math.round(Number(x) * 100) / 100).replace(".", ","); }
  function dmy(iso) { return iso.slice(8, 10) + "." + iso.slice(5, 7) + "."; }
  // Browser-Zurück-Taste: jede Ebene (Chef-Liste, Person) ist ein eigener Verlaufseintrag, damit man nicht aus der App fliegt
  function navPush(s) { try { history.pushState(s, "", location.href); } catch (e) {} }
  function navReplace(s) { try { history.replaceState(s, "", location.href); } catch (e) {} }
  window.addEventListener("popstate", function (e) {
    var s = e.state || {}, wasPerson = !!state.cPerson;
    if (zoomEl && s.ub !== "zoom") { closeZoom(); return; }   // Zurück schließt zuerst die Vergrößerung
    if (s.ub === "person") { state.mode = "chef"; state.cPerson = s.name || ""; }
    else if (s.ub === "chef") { state.mode = "chef"; state.cPerson = ""; }
    else if (s.ub === "plan") { state.mode = "plan"; state.cPerson = ""; }
    else { state.mode = "basis"; state.cPerson = ""; state.report = null; }
    render();
    if (state.mode === "chef" && getCGrant() && !state.report) loadReport();
    var y = state.mode === "chef" && wasPerson && !state.cPerson ? state.cScroll || 0 : 0;
    requestAnimationFrame(function () { window.scrollTo(0, y); });
  });
  function chefEntry() {
    var b = el("button", "cs-entry"); b.type = "button";
    b.appendChild(document.createTextNode("🔒 Chef- und Gruppenleiter-Zugang"));
    b.addEventListener("click", function () { state.mode = "chef"; state.cPerson = ""; navPush({ ub: "chef" }); render(); if (getCGrant()) loadReport(); window.scrollTo(0, 0); });
    return b;
  }
  function loadReport() {
    setLoading(true, "aktualisiere …");
    return apiX("viewReport", { grant: getCGrant(), month: state.cMonth || "" }).then(function (r) {
      setLoading(false); state.offline = false;
      if (r.status === "success") {
        var sig = JSON.stringify(r, function (k, v) { return k === "updated" ? undefined : v; }), same = state.report && state.cSig === sig && !state.cErr;
        state.cSig = sig; state.report = r; state.cErr = ""; if (r.available) state.cMonth = r.month;
        if (same) { setStand(); return; }
        var sec = r.sections || {}; var listOn = !!(sec.summary || sec.persons); if (!state.cTab || state.cTab === "persons" || (state.cTab === "summary" && !listOn) || (state.cTab === "locations" && !sec.locations)) state.cTab = listOn ? "summary" : "locations";
        render();
      } else if (r.code === "VIEW_CHEF_AUTH") { setCGrant(""); state.report = null; render(); }
      else { state.report = null; state.cErr = r.message || "Der Bericht konnte nicht geladen werden."; render(); }
    }).catch(function () { setLoading(false); state.offline = true; setStand(); if (!state.report) { state.cErr = "Keine Verbindung. Es wird automatisch weiter versucht."; render(); } });
  }
  function chefUnlock(pw, go, err) {
    go.disabled = true;
    apiX("viewChefUnlock", { password: pw, dev: devId() }).then(function (r) {
      go.disabled = false;
      if (r.status === "success") { setCGrant(r.grant); state.planOk = undefined; state.planLocked = false; state.cErr = ""; render(); loadReport(); }
      else { err.textContent = r.message || "Das hat nicht geklappt."; }
    }).catch(function () { go.disabled = false; err.textContent = "Keine Verbindung."; });
  }
  function goBack() { if (history.state && history.state.ub) history.back(); else { state.mode = "basis"; state.cPerson = ""; state.report = null; render(); } }
  function backBtn(label) { var b = el("button", "cs-back", label || "← Übersicht"); b.type = "button"; b.addEventListener("click", goBack); return b; }
  // Anmerkungen als kleine Felder (Datum + Text), zwei pro Zeile; lange Texte über die volle Breite und in der Liste gekürzt
  function remarkBlock(rem, clamp) {
    var g = el("div", "cs-rems" + (clamp ? " clamp" : ""));
    rem.forEach(function (x) {
      var wide = x.text.length > 52 || x.text.indexOf("\n") > -1, c = el("div", "cs-rc" + (wide ? " wide" : ""));
      if (x.iso) c.appendChild(el("span", "cs-rd", "Am " + x.iso.slice(8, 10) + "." + x.iso.slice(5, 7)));
      c.appendChild(el("span", "cs-rt", x.text));
      if (clamp && (x.text.length > 150 || x.text.split("\n").length > 3)) c.appendChild(el("span", "cs-more", "weiterlesen ›"));
      g.appendChild(c);
    });
    return g;
  }

  function svgN(tag, attrs) { var n = document.createElementNS("http://www.w3.org/2000/svg", tag); for (var k in attrs) n.setAttribute(k, attrs[k]); return n; }
  function stateIcon(p) {
    var s = el("span", "cs-st " + (p.released ? "ok" : "warn")); s.title = p.label || ""; s.setAttribute("aria-label", p.label || (p.released ? "freigegeben" : "nicht freigegeben")); s.setAttribute("role", "img");
    var v = svgN("svg", { viewBox: "0 0 24 24", width: "22", height: "22", "aria-hidden": "true" });
    if (p.released) v.appendChild(svgN("path", { d: "M5.2 12.8l4.3 4.4L18.9 7.4", fill: "none", stroke: "currentColor", "stroke-width": "3.6", "stroke-linecap": "round", "stroke-linejoin": "round" }));
    else { v.appendChild(svgN("path", { d: "M12 3.6L2.6 19.8h18.8z", fill: "none", stroke: "currentColor", "stroke-width": "2.7", "stroke-linejoin": "round" })); v.appendChild(svgN("path", { d: "M12 9.4v5.2", stroke: "currentColor", "stroke-width": "3", "stroke-linecap": "round" })); v.appendChild(svgN("circle", { cx: "12", cy: "17.5", r: "1.6", fill: "currentColor" })); }
    s.appendChild(v); return s;
  }

  function openPerson(p) { state.cScroll = window.scrollY; state.cPerson = p.name; navPush({ ub: "person", name: p.name }); render(); window.scrollTo(0, 0); }
  function personRow(p, sub) {
    var canOpen = !!(state.report && state.report.sections && state.report.sections.persons);   // Einzelseite nur, wenn freigegeben
    var row = el("div", "cs-row" + (canOpen ? " cs-open" : "")); if (canOpen) { row.setAttribute("role", "button"); row.tabIndex = 0; }
    var top = el("div", "cs-top"); top.appendChild(stateIcon(p)); top.appendChild(el("span", "cs-name", p.name)); top.appendChild(el("span", "cs-h", p.shown ? fh(p.total) : "–")); if (canOpen) top.appendChild(el("span", "cs-chev", "›")); row.appendChild(top);
    if (!p.released) row.appendChild(el("div", "cs-lbl", p.label));
    else if (sub) row.appendChild(el("div", "cs-lbl", sub));
    if (p.remarks && p.remarks.length && !sub) row.appendChild(remarkBlock(p.remarks, canOpen));
    if (canOpen) { row.addEventListener("click", function () { openPerson(p); }); row.addEventListener("keydown", function (e) { if (e.key === "Enter") openPerson(p); }); }
    return row;
  }
  function csSummary(R) {
    var wrap = el("div", "cs-list");
    R.persons.forEach(function (p) { wrap.appendChild(personRow(p)); });
    var tot = el("div", "cs-total"); tot.appendChild(el("span", "", "Gesamt")); tot.appendChild(el("b", "", fh(R.total) + " Std.")); wrap.appendChild(tot);
    return wrap;
  }
  // Tabelle und Anmerkungen einer Person (auch für den Druck)
  function csPersonDetail(p) {
    var box = el("div", "cs-detail");
    if (p.days && p.days.length) {
      var t = el("table", "cs-tab"), thead = el("thead"), hr = el("tr");
      ["Datum"].concat(p.days[0].ort !== undefined ? ["Ort"] : []).concat(p.days[0].beginn !== undefined ? ["Zeit"] : []).concat(["Std."]).forEach(function (x, i, a) { hr.appendChild(el("th", i === a.length - 1 ? "r" : "", x)); });
      thead.appendChild(hr); t.appendChild(thead); var tb = el("tbody");
      p.days.forEach(function (d) { var tr = el("tr"); tr.appendChild(el("td", "", dmy(d.iso))); if (d.ort !== undefined) tr.appendChild(el("td", "", d.ort)); if (d.beginn !== undefined) tr.appendChild(el("td", "", d.beginn && d.ende ? d.beginn + "–" + d.ende : "")); tr.appendChild(el("td", "r", fh(d.stunden))); tb.appendChild(tr); });
      t.appendChild(tb); var tf = el("tfoot"), fr = el("tr"), c1 = el("th", "", "Summe"); c1.colSpan = p.days[0].ort !== undefined && p.days[0].beginn !== undefined ? 3 : (p.days[0].ort !== undefined || p.days[0].beginn !== undefined ? 2 : 1);
      fr.appendChild(c1); fr.appendChild(el("th", "r", fh(p.total))); tf.appendChild(fr); t.appendChild(tf); box.appendChild(t);
    } else if (p.shown) box.appendChild(el("div", "cs-lbl", "Für diese Person wurde nur die Summe erfasst: " + fh(p.total) + " Std."));
    else box.appendChild(el("div", "cs-lbl", p.released ? "Es sind keine Tage vorhanden." : "Die Stunden sind noch nicht freigegeben."));
    if (p.empNote || (p.remarks && p.remarks.length)) {
      var rb = el("div", "cs-rembox"); rb.appendChild(el("div", "cs-remh", "Anmerkungen"));
      if (p.empNote) { var eb = el("div", "cs-emp"); eb.appendChild(el("div", "cs-emph", "Bemerkung vom Mitarbeiter")); eb.appendChild(el("div", "cs-emptxt", p.empNote)); rb.appendChild(eb); }
      if (p.remarks && p.remarks.length) {
        var ab = el("div", "cs-adm"); ab.appendChild(el("div", "cs-admh", "Anmerkung vom Admin"));
        p.remarks.forEach(function (x) { var ri = el("div", "cs-remi"); if (x.iso) { ri.appendChild(el("span", "cs-rd", dmy(x.iso))); ri.appendChild(document.createTextNode("  ")); } ri.appendChild(el("span", "cs-rt", x.text)); ab.appendChild(ri); });
        rb.appendChild(ab);
      }
      box.appendChild(rb);
    }
    return box;
  }
  var PCOL = ["#D6336C", "#2F9E8F", "#E8A33D", "#3D3A87", "#2557C4", "#0F7A55", "#BF2F23", "#7048E8"];
  function placeColor(s) { var x = 0; for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return PCOL[x % PCOL.length]; }
  function placeInit(s) { var w = String(s).split(/[\s\/]+/).filter(Boolean); return (w.length > 1 ? w.map(function (x) { return x[0]; }).join("") : (w[0] || "?").slice(0, 1)).toUpperCase().slice(0, 2); }
  function placesCard(p) {
    if (!p.days || !p.days.length || p.days[0].ort === undefined) return null;
    var m = {}, list;
    p.days.forEach(function (d) { var k = d.ort || "–", g = m[k] || (m[k] = { ort: k, n: 0, h: 0 }); g.n++; g.h += Number(d.stunden) || 0; });
    list = Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.h - a.h; });
    var card = el("div", "card cs-places"); card.appendChild(el("div", "cs-ph2", "Stunden nach Standort"));
    list.forEach(function (g) {
      var row = el("div", "cs-pl"), ic = el("span", "cs-pi", placeInit(g.ort)); ic.style.background = placeColor(g.ort); row.appendChild(ic);
      var nm = el("div", "cs-pn"); nm.appendChild(el("b", "", g.ort)); nm.appendChild(el("small", "", g.n + (g.n === 1 ? " Tag" : " Tage"))); row.appendChild(nm); row.appendChild(el("span", "cs-plh", fh(Math.round(g.h * 100) / 100) + " Std.")); card.appendChild(row);
    });
    return card;
  }
  function renderPerson() {
    var R = state.report, p = R && R.persons.filter(function (x) { return x.name === state.cPerson; })[0], frag = document.createDocumentFragment();
    if (!p) { state.cPerson = ""; renderChef(); return; }
    title.textContent = p.name;
    var acts = el("div", "cs-actions"); acts.appendChild(backBtn("‹ Zurück")); frag.appendChild(acts);
    var card = el("div", "card cs-person"), head = el("div", "cs-phead"); head.appendChild(stateIcon(p)); var nm = el("div", "cs-pname"); nm.appendChild(el("b", "", p.name)); nm.appendChild(el("small", "", R.label)); head.appendChild(nm); head.appendChild(el("span", "cs-ph", p.shown ? fh(p.total) + " Std." : "–")); card.appendChild(head);
    card.appendChild(el("div", "cs-pstatus " + (p.released ? "ok" : "warn"), p.label));
    var pcard = placesCard(p); if (pcard) { pcard.className = "cs-places in"; card.appendChild(pcard); }   // Überblick zuerst, dann die Tage
    card.appendChild(csPersonDetail(p));
    frag.appendChild(card);
    var ix = R.persons.indexOf(p), pv = R.persons[ix - 1], nx = R.persons[ix + 1];   // blättern, ohne zur Liste zurück zu müssen (Zurück-Taste führt trotzdem zur Liste)
    if (pv || nx) {
      var nav = el("div", "cs-pnav");
      [[pv, "‹ ", "cs-pnb prev"], [nx, " ›", "cs-pnb next"]].forEach(function (x) {
        var q = x[0], b = el("button", x[2]); b.type = "button";
        if (!q) { b.disabled = true; b.appendChild(el("span", "", "")); } else {
          b.appendChild(el("small", "", x[2].indexOf("prev") > -1 ? "Vorherige" : "Nächste")); b.appendChild(el("b", "", q.name));
          b.addEventListener("click", function () { state.cPerson = q.name; navReplace({ ub: "person", name: q.name }); render(); window.scrollTo(0, 0); });
        }
        nav.appendChild(b);
      });
      frag.appendChild(nav);
    }
    main.replaceChildren(frag);
  }
  // Standort-PDF: wird als Bild gezeichnet (funktioniert auf jedem Handy) und lässt sich laden
  var pdfLib = null;
  function loadPdfLib() { if (!pdfLib) { pdfLib = import("./dp-pdf.6.4.299.min.mjs").then(function (m) { m.GlobalWorkerOptions.workerSrc = new URL("./dp-pdf-worker.6.4.299.min.mjs", document.baseURI).href; return m; }); pdfLib.catch(function () { pdfLib = null; }); } return pdfLib; }
  function b64ToBytes(b64) { var bin = atob(b64), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  var zoomEl = null;
  function closeZoom() { if (zoomEl) { zoomEl.remove(); zoomEl = null; document.body.classList.remove("cs-nozoom"); } }
  function openZoom(cv) {
    closeZoom();
    var ov = el("div", "cs-zoom"), bar = el("div", "cs-zbar"), x = el("button", "cs-zx", "✕ Schließen"); x.type = "button";
    x.addEventListener("click", function () { if (history.state && history.state.ub === "zoom") history.back(); else closeZoom(); });
    bar.appendChild(el("span", "cs-zh", "Tippen zum Umschalten, zum Verschieben wischen")); bar.appendChild(x);
    var wrap = el("div", "cs-zwrap"), img = el("img", "cs-zimg big"); img.alt = "Standort-Übersicht"; img.src = cv.toDataURL("image/png");
    img.addEventListener("click", function () { img.classList.toggle("big"); });
    wrap.appendChild(img); ov.appendChild(bar); ov.appendChild(wrap); document.body.appendChild(ov); zoomEl = ov; document.body.classList.add("cs-nozoom"); navPush({ ub: "zoom" });
  }
  function renderPdfPages(box, bytes) {
    return loadPdfLib().then(function (m) {
      var task = m.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
      return task.promise.then(function (doc) {
        var n = Math.min(doc.numPages, 8), chain = Promise.resolve();
        for (var i = 1; i <= n; i++) (function (num) { chain = chain.then(function () { return doc.getPage(num).then(function (page) {
          var v0 = page.getViewport({ scale: 1 }), target = (navigator.deviceMemory && navigator.deviceMemory < 4) ? 1400 : 1800, scale = target / v0.width, vp = page.getViewport({ scale: scale });   // feste hohe Auflösung: auch Zoomen bleibt scharf
          var cv = document.createElement("canvas"); cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height); cv.className = "cs-pg"; cv.setAttribute("role", "button"); cv.setAttribute("aria-label", "Vergrößern"); box.appendChild(cv);
          cv.addEventListener("click", function () { openZoom(cv); });
          return page.render({ canvasContext: cv.getContext("2d"), canvas: cv, viewport: vp }).promise;
        }); }); })(i);
        return chain.then(function () { try { task.destroy(); } catch (e) { /* egal */ } });
      });
    });
  }
  function csLocations(R) {
    var wrap = el("div", "cs-pdfwrap"), info = R.pdf && R.pdf.standorte;
    if (!info) { wrap.appendChild(el("div", "card cs-empty", "Für " + R.label + " gibt es noch keine Standort-Übersicht.")); return wrap; }
    var key = R.month, box = el("div", "cs-pdfbox"), bar = el("div", "cs-pdfbar");
    bar.appendChild(el("span", "cs-pdfname", info.name)); wrap.appendChild(bar); box.appendChild(el("div", "cs-lbl", "Wird geladen …")); wrap.appendChild(box);
    var show = function (f) {
      var bytes = b64ToBytes(f.data), url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      var a = el("a", "cs-dl", "PDF laden"); a.href = url; a.download = f.name || "Standort-Uebersicht.pdf"; bar.appendChild(a);
      box.replaceChildren(); renderPdfPages(box, bytes).catch(function () { box.replaceChildren(el("div", "cs-lbl", "Die Vorschau ist hier nicht möglich. Mit „PDF laden“ kannst du die Datei öffnen.")); });
    };
    if (state.pdfCache[key]) show(state.pdfCache[key]);
    else apiX("viewReportPdf", { grant: getCGrant(), month: R.month }).then(function (r) { if (r.status === "success") { state.pdfCache[key] = r; if (state.mode === "chef" && state.cTab === "locations" && state.cMonth === key) show(r); } else box.replaceChildren(el("div", "cs-lbl", r.message || "Die Datei konnte nicht geladen werden.")); }).catch(function () { box.replaceChildren(el("div", "cs-lbl", "Keine Verbindung.")); });
    return wrap;
  }
  function printAll() {
    var R = state.report; if (!R) return;
    var box = el("div"); box.id = "csprint"; box.appendChild(el("h1", "", "Bericht – " + R.label));
    var s = R.sections || {};
    if (s.summary) { box.appendChild(el("h2", "", "Zusammenfassung")); var sm = el("div", "cs-list"); R.persons.forEach(function (p) { var row = el("div", "cs-row"), top = el("div", "cs-top"); top.appendChild(stateIcon(p)); top.appendChild(el("span", "cs-name", p.name)); top.appendChild(el("span", "cs-h", p.shown ? fh(p.total) : "–")); row.appendChild(top); if (!p.released) row.appendChild(el("div", "cs-lbl", p.label)); if (p.remarks && p.remarks.length) row.appendChild(remarkBlock(p.remarks, false)); sm.appendChild(row); }); box.appendChild(sm); }
    if (s.persons) { box.appendChild(el("h2", "", "Mitarbeiter")); R.persons.forEach(function (p) { var row = el("div", "cs-row"); row.appendChild(el("h3", "", p.name + " – " + (p.shown ? fh(p.total) + " Std." : "–"))); row.appendChild(csPersonDetail(p)); box.appendChild(row); }); }
    document.body.appendChild(box); document.body.classList.add("csp");
    var done = function () { document.body.classList.remove("csp"); box.remove(); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done); window.print(); done();
  }
  function modeSwitch(cur) {
    var sw = el("div", "seg cs-tabs"); sw.style.gridTemplateColumns = "1fr 1fr";
    [["hours", "Stunden"], ["plan", "Dienstplan"]].forEach(function (x) {
      var locked = x[0] === "plan" && state.planLocked, b = el("button", (x[0] === cur ? "on" : "") + (locked ? " locked" : ""), x[1]); b.type = "button";
      if (locked) b.setAttribute("aria-disabled", "true");
      if (locked) b.addEventListener("click", function () { say("Der Dienstplan ist zurzeit gesperrt. Bitte wende dich an den Admin."); });
      else if (x[0] !== cur) b.addEventListener("click", function () { if (x[0] === "plan") { state.mode = "plan"; state.planMode = "chef"; navPush({ ub: "plan" }); render(); window.scrollTo(0, 0); } else goBack(); });
      sw.appendChild(b);
    });
    return sw;
  }
  function renderPlan() {
    if (state.planHost && document.body.contains(state.planHost)) return;   // läuft schon: nicht neu aufbauen
    title.textContent = "Dienstplan";
    var frag = document.createDocumentFragment(), acts = el("div", "cs-actions");
    acts.appendChild(backBtn(state.planMode === "chef" ? "← Stunden" : "← Übersicht")); frag.appendChild(acts);
    if (state.planMode === "chef" && state.planOk) frag.appendChild(modeSwitch("plan"));
    var host = el("div", "pl-host"); state.planHost = host; frag.appendChild(host);
    main.replaceChildren(frag);
    if (window.DPPlan) window.DPPlan.mount(host, { mode: state.planMode === "chef" ? "chef" : "konto", vt: vt });
    else host.appendChild(el("div", "msg", "Der Dienstplan konnte nicht geladen werden."));
  }
  function renderChef() {
    if (state.cPerson && state.report) { renderPerson(); return; }
    var frag = document.createDocumentFragment(), R = state.report;
    title.textContent = R && R.available ? "Chef-Ansicht" : "Chef-Ansicht";
    var acts = el("div", "cs-actions"); acts.appendChild(backBtn());
    if (R && R.available && R.print) { var pb = el("button", "cs-back", "Drucken / PDF"); pb.type = "button"; pb.addEventListener("click", printAll); acts.appendChild(pb); }
    frag.appendChild(acts);
    if (getCGrant()) {   // Umschalter Stunden | Dienstplan nur, wenn der Admin dem Chef Rechte dafür gegeben hat
      if (state.planOk === undefined) { state.planOk = null; apiX("planBoot", { grant: getCGrant() }).then(function (r) { state.planOk = !!(r.status === "success" && !r.locked && r.me && r.me.perms && r.me.perms.v_plan); state.planLocked = !!(r.status === "success" && r.locked && r.available); if (state.mode === "chef") render(); }).catch(function () { state.planOk = false; }); }
      if (state.planOk || state.planLocked) frag.appendChild(modeSwitch("hours"));
    }
    if (!getCGrant()) {
      var c = el("div", "card lock cslogin"); c.appendChild(el("b", "", "Chef-Ansicht")); c.appendChild(el("div", "sub", "Bitte gib das Chef-Passwort ein."));
      var inp = el("input"); inp.type = "password"; inp.autocomplete = "current-password"; inp.placeholder = "Passwort"; inp.setAttribute("aria-label", "Chef-Passwort");
      var go = el("button", "go", "Öffnen"); go.type = "button"; var err = el("div", "err", state.cErr || "");
      var submit = function () { if (inp.value) chefUnlock(inp.value, go, err); };
      go.addEventListener("click", submit); inp.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
      c.appendChild(inp); c.appendChild(go); c.appendChild(err);
      var gl = el("button", "cs-back", "Gruppenleiter-Anmeldung (Benutzername)"); gl.type = "button"; gl.style.marginTop = "12px"; gl.addEventListener("click", function () { state.mode = "plan"; state.planMode = "konto"; navPush({ ub: "plan" }); render(); window.scrollTo(0, 0); });
      c.appendChild(gl); frag.appendChild(c); main.replaceChildren(frag); return;
    }
    if (!R) { frag.appendChild(state.cErr ? msg("Nicht geladen", state.cErr) : loaderNode("Bericht wird geladen …")); main.replaceChildren(frag); return; }
    if (!R.available) { frag.appendChild(msg("Noch nichts freigegeben", R.message || "Für die Chef-Ansicht ist noch kein Monat freigegeben.")); main.replaceChildren(frag); return; }
    var meta = el("div", "card cs-meta"), top = el("div", "cs-mrow");
    var sel = el("select", "cs-month"); sel.setAttribute("aria-label", "Monat wählen");
    (R.months || []).forEach(function (m) { var o = el("option", "", m.label); o.value = m.month; sel.appendChild(o); }); sel.value = R.month;
    sel.addEventListener("change", function () { state.cMonth = sel.value; state.report = null; render(); loadReport(); });
    top.appendChild(sel); top.appendChild(el("span", "cs-badge " + (R.closedAt ? "ok" : ""), R.closedAt ? "abgeschlossen " + new Date(R.closedAt).toLocaleDateString("de-DE") : "Monat offen")); meta.appendChild(top);
    var kp = el("div", "cs-kpi"); [[R.counts.released + " / " + R.counts.total, "freigegeben"], [fh(R.total), "Stunden gesamt"]].forEach(function (x) { var d = el("div"); d.appendChild(el("b", "", x[0])); d.appendChild(el("small", "", x[1])); kp.appendChild(d); }); meta.appendChild(kp);
    var bar = el("div", "bar"), fill = el("i"); fill.style.width = (R.counts.total ? Math.round(R.counts.released / R.counts.total * 100) : 0) + "%"; bar.appendChild(fill); meta.appendChild(bar);
    frag.appendChild(meta);
    var S = R.sections || {}, tabs = [["summary", "Zusammenfassung", S.summary || S.persons], ["locations", "Standorte", S.locations]].filter(function (x) { return x[2]; });
    var seg = el("div", "seg cs-tabs"); seg.style.gridTemplateColumns = "repeat(" + Math.max(tabs.length, 1) + ",1fr)";
    tabs.forEach(function (x) { var b = el("button", state.cTab === x[0] ? "on" : "", x[1]); b.type = "button"; b.addEventListener("click", function () { state.cTab = x[0]; render(); }); seg.appendChild(b); });
    if (tabs.length > 1) frag.appendChild(seg);
    frag.appendChild(state.cTab === "locations" ? csLocations(R) : csSummary(R));
    main.replaceChildren(frag);
  }
  function render() {
    var d = state.data;
    setStand();
    if (state.mode !== "plan" && state.planHost) { if (window.DPPlan) window.DPPlan.unmount(); state.planHost = null; }
    if (state.mode === "plan") { renderPlan(); return; }
    if (state.mode === "chef") { renderChef(); return; }
    if (!d) return;
    if (d.fatal) { title.textContent = "Stunden-Übersicht"; main.replaceChildren(msg(d.fatal.code === "VIEW_LOCKED" ? "Zurzeit gesperrt" : d.fatal.code === "VIEW_EMPTY" ? "Noch nichts freigegeben" : "Link nicht gültig", d.fatal.message || "")); standTxt.textContent = ""; return; }
    title.textContent = d.label || "Stunden-Übersicht";
    var frag = document.createDocumentFragment();
    frag.appendChild(noteBox());
    if (d.chef) frag.appendChild(chefEntry());
    var chips = monthChips(d); if (chips) frag.appendChild(chips);
    if (d.needPassword) {
      var c = el("div", "card lock");
      c.appendChild(el("b", "", "Dieser Monat ist geschützt"));
      c.appendChild(el("div", "sub", "Bitte gib das Passwort ein, das du bekommen hast."));
      var inp = el("input"); inp.type = "password"; inp.autocomplete = "current-password"; inp.placeholder = "Passwort"; inp.setAttribute("aria-label", "Passwort");
      var go = el("button", "go", "Öffnen"); go.type = "button";
      var err = el("div", "err", state.pwErr || "");
      var submit = function () { if (!inp.value) return; go.disabled = true; load({ month: d.month, password: inp.value }).then(function () { go.disabled = false; }); };
      go.addEventListener("click", submit); inp.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
      c.appendChild(inp); c.appendChild(go); c.appendChild(err); frag.appendChild(c);
      main.replaceChildren(frag); return;
    }
    if (!d.sent) { frag.appendChild(loaderNode((d.label || "Monat") + " wird geladen …")); main.replaceChildren(frag); return; }
    var total = d.total || 0, sentN = d.sentCount || 0, pct = total ? Math.round(sentN / total * 100) : 0;
    var card = el("div", "card");
    var big = el("div", "big"); big.appendChild(el("b", "", sentN + " von " + total)); big.appendChild(el("span", "", "haben gesendet")); card.appendChild(big);
    var bar = el("div", "bar"); var fill = el("i"); fill.style.width = pct + "%"; bar.appendChild(fill); card.appendChild(bar);
    card.appendChild(el("div", "sub", total - sentN === 0 ? "Alle Stunden sind da." : (total - sentN) + (total - sentN === 1 ? " Person fehlt noch" : " Personen fehlen noch") + " · " + pct + " %"));
    frag.appendChild(card);
    var seg = el("div", "seg");
    [["o", "Noch offen", d.missing.length], ["g", "Gesendet", d.sent.length]].forEach(function (x) {
      var b = el("button", x[0] + (state.tab === x[0] ? " on" : "")); b.type = "button"; b.appendChild(document.createTextNode(x[1])); b.appendChild(el("em", "", String(x[2])));
      b.addEventListener("click", function () { state.tab = x[0]; render(); });
      seg.appendChild(b);
    });
    frag.appendChild(seg);
    var list = el("ul"), rows = state.tab === "g" ? d.sent : d.missing;
    if (!rows.length) { var li = el("li", "empty", state.tab === "g" ? "Noch niemand hat gesendet." : "Alle haben gesendet. Super!"); li.style.display = "block"; list.appendChild(li); }
    rows.forEach(function (p) {
      var li = el("li", state.tab === "g" ? "g" : "o"); li.appendChild(el("span", "dot")); li.appendChild(el("span", "n", p.name));
      if (state.tab === "g") li.appendChild(el("span", "t", fmtTime(p.ts)));
      list.appendChild(li);
    });
    frag.appendChild(list);
    main.replaceChildren(frag);
  }

  main.replaceChildren(loaderNode("Aktuelle Zahlen werden geladen …"));
  if (!/^[0-9a-f]{32}$/i.test(vt)) { state.data = { fatal: { code: "VIEW_INVALID", message: "Dieser Link ist nicht (mehr) gültig." } }; render(); return; }
  load();
  var poll = setInterval(function () { if (state.mode === "chef") { if (document.visibilityState === "visible" && state.report && ++state.cTick % 3 === 0) loadReport(); return; } if (document.visibilityState === "visible" && state.data && !state.data.fatal && !state.data.needPassword) load(); }, 20000);   // Chef-Ansicht: nur jede Minute, das Stundenblatt wird dabei komplett gelesen
  document.addEventListener("visibilitychange", function () { if (state.mode === "chef") { if (document.visibilityState === "visible" && state.report) loadReport(); return; } if (document.visibilityState === "visible" && state.data && !state.data.fatal && !state.data.needPassword) load(); });
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { /* ohne Zwischenspeicher */ }); } catch (e) { /* egal */ }
})();

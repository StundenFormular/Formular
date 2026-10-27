(function () {
  "use strict";
  var URL_API = "https://script.google.com/macros/s/AKfycbzNrtg6-hoAv_kWkuE_noqRtlRYYJAzQMxJnpnEbyP3b4JjlHyG4vPVsuqdC45xrPe9/exec";
  var API_TOKEN = "Zk0sUhvBN2XU13DGgeAwhm-H-rtmBcK1OwJR7NLc1VI";
  var vt = (location.hash || "").replace(/^#/, "").replace(/[^0-9a-f]/gi, "").slice(0, 64);
  var state = { month: "", data: null, tab: null, firstCall: true, offline: false, pwErr: "", loading: false, retry: null, mode: "basis", report: null, cErr: "", cTab: "", openP: {}, cTick: 0 };
  var $ = function (id) { return document.getElementById(id); };
  var main = $("main"), title = $("title"), stand = $("stand"), standTxt = $("standTxt");

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var EYE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var LOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  // Wer irgendwo klickt: freundlicher Hinweis, dass hier nur angesehen wird
  var toastTimer = null, lastToast = 0;
  function hint() {
    var now = Date.now(); if (now - lastToast < 1800) return; lastToast = now;
    var t = $("toast"); t.textContent = "Diese Seite ist nur zur Ansicht. Hier lässt sich nichts ändern."; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t.closest && t.closest(".chip, .seg, .lock, #title, .cs-entry, .cs-back, .cs-acc .cs-top")) return;   // echte Bedienelemente: Monat, Reiter, Passwort
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
  function load(opts) {
    opts = opts || {};
    var m = opts.month || state.month || "";
    var req = { month: m, grant: getGrant(m) };
    if (state.firstCall) { req.open = true; state.firstCall = false; }
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
  // ---------- Chef-Ansicht: Zusammenfassung, Mitarbeiter, Standorte (nur lesen, nur mit Passwort) ----------
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
  function chefEntry() {
    var b = el("button", "cs-entry"); b.type = "button";
    b.appendChild(document.createTextNode("🔒 Chef-Ansicht"));
    b.addEventListener("click", function () { state.mode = "chef"; if (getCGrant()) { render(); loadReport(); } else render(); });
    return b;
  }
  function loadReport() {
    setLoading(true, "aktualisiere …");
    return apiX("viewReport", { grant: getCGrant() }).then(function (r) {
      setLoading(false); state.offline = false;
      if (r.status === "success") { state.report = r; state.cErr = ""; var sec = r.sections || {}; if (!state.cTab || !sec[state.cTab === "summary" ? "summary" : state.cTab === "persons" ? "persons" : "locations"]) state.cTab = sec.summary ? "summary" : sec.persons ? "persons" : "locations"; render(); }
      else if (r.code === "VIEW_CHEF_AUTH") { setCGrant(""); state.report = null; render(); }
      else { state.report = null; state.cErr = r.message || "Der Bericht konnte nicht geladen werden."; render(); }
    }).catch(function () { setLoading(false); state.offline = true; setStand(); if (!state.report) { state.cErr = "Keine Verbindung. Es wird automatisch weiter versucht."; render(); } });
  }
  function chefUnlock(pw, go, err) {
    go.disabled = true;
    apiX("viewChefUnlock", { password: pw }).then(function (r) {
      go.disabled = false;
      if (r.status === "success") { setCGrant(r.grant); state.cErr = ""; render(); loadReport(); }
      else { err.textContent = r.message || "Das hat nicht geklappt."; }
    }).catch(function () { go.disabled = false; err.textContent = "Keine Verbindung."; });
  }
  function backBtn() { var b = el("button", "cs-back", "← Übersicht"); b.type = "button"; b.addEventListener("click", function () { state.mode = "basis"; state.report = null; title.textContent = (state.data && state.data.label) || "Stunden-Übersicht"; render(); }); return b; }
  function stateIcon(p) { var s = el("span", "cs-st " + (p.released ? "ok" : "warn")); s.textContent = p.released ? "✓" : "⚠"; s.title = p.label || ""; s.setAttribute("aria-label", p.label || ""); return s; }
  function csSummary(R) {
    var wrap = el("div", "cs-list");
    R.persons.forEach(function (p) {
      var row = el("div", "cs-row"); var top = el("div", "cs-top"); top.appendChild(stateIcon(p)); top.appendChild(el("span", "cs-name", p.name)); top.appendChild(el("span", "cs-h", p.shown ? fh(p.total) : "–")); row.appendChild(top);
      if (!p.released) row.appendChild(el("div", "cs-lbl", p.label));
      if (p.remarkText) row.appendChild(el("div", "cs-rem", p.remarkText));
      wrap.appendChild(row);
    });
    var tot = el("div", "cs-total"); tot.appendChild(el("span", "", "Gesamt")); tot.appendChild(el("b", "", fh(R.total) + " Std.")); wrap.appendChild(tot);
    return wrap;
  }
  function csPersons(R, all) {
    var wrap = el("div", "cs-list");
    R.persons.forEach(function (p) {
      var open = all || !!state.openP[p.name], row = el("div", "cs-row cs-acc" + (open ? " open" : ""));
      var top = el("div", "cs-top"); top.appendChild(stateIcon(p)); top.appendChild(el("span", "cs-name", p.name)); top.appendChild(el("span", "cs-h", p.shown ? fh(p.total) : "–")); row.appendChild(top);
      if (!all) top.addEventListener("click", function () { state.openP[p.name] = !state.openP[p.name]; render(); });
      if (!p.released) row.appendChild(el("div", "cs-lbl", p.label));
      if (open && p.days && p.days.length) {
        var t = el("table", "cs-tab"); var thead = el("thead"); var hr = el("tr");
        ["Datum"].concat(p.days[0].ort !== undefined ? ["Ort"] : []).concat(p.days[0].beginn !== undefined ? ["Zeit"] : []).concat(["Std."]).forEach(function (x) { hr.appendChild(el("th", "", x)); });
        thead.appendChild(hr); t.appendChild(thead); var tb = el("tbody");
        p.days.forEach(function (d) { var tr = el("tr"); tr.appendChild(el("td", "", dmy(d.iso))); if (d.ort !== undefined) tr.appendChild(el("td", "", d.ort)); if (d.beginn !== undefined) tr.appendChild(el("td", "", d.beginn && d.ende ? d.beginn + "–" + d.ende : "")); tr.appendChild(el("td", "r", fh(d.stunden))); tb.appendChild(tr); });
        t.appendChild(tb); var tf = el("tfoot"); var fr = el("tr"); var span = p.days[0].ort !== undefined && p.days[0].beginn !== undefined ? 3 : (p.days[0].ort !== undefined || p.days[0].beginn !== undefined ? 2 : 1);
        var c1 = el("th", "", "Summe"); c1.colSpan = span; fr.appendChild(c1); fr.appendChild(el("th", "r", fh(p.total))); tf.appendChild(fr); t.appendChild(tf); row.appendChild(t);
      } else if (open && !p.shown) row.appendChild(el("div", "cs-lbl", "Die Stunden sind noch nicht freigegeben."));
      if (open && p.remarkText) row.appendChild(el("div", "cs-rem", p.remarkText));
      wrap.appendChild(row);
    });
    return wrap;
  }
  function csLocations(R) {
    var wrap = el("div", "cs-list"); var L = R.locations;
    if (!L.lines.length) wrap.appendChild(el("div", "cs-lbl", "Es sind noch keine Standorte eingerichtet."));
    L.lines.forEach(function (l) {
      var row = el("div", "cs-row"); var top = el("div", "cs-top"); top.appendChild(el("span", "cs-name", l.label)); top.appendChild(el("span", "cs-h", fh(l.actual))); row.appendChild(top);
      if (l.schicht) row.appendChild(el("div", "cs-lbl", l.schicht));
      var g = el("div", "cs-grid");
      [["Rechnung", l.rechnung || "–"], ["Möglich", fh(l.possible) + " Std."], ["Gearbeitet", fh(l.actual) + " Std."], ["Differenz", (l.diff > 0 ? "+" : "") + fh(l.diff) + " Std."]].forEach(function (x) { var c = el("div"); c.appendChild(el("small", "", x[0])); c.appendChild(el("b", x[0] === "Differenz" ? (l.diff < 0 ? "neg" : "pos") : "", x[1])); g.appendChild(c); });
      row.appendChild(g); wrap.appendChild(row);
    });
    var tot = el("div", "cs-total"); tot.appendChild(el("span", "", "Gesamt · möglich " + fh(L.totalPossible) + " Std. · gearbeitet")); tot.appendChild(el("b", "", fh(L.totalActual) + " Std.")); wrap.appendChild(tot);
    return wrap;
  }
  function printAll() {
    var R = state.report; if (!R) return;
    var box = el("div"); box.id = "csprint";
    box.appendChild(el("h1", "", "Bericht – " + R.label));
    var s = R.sections || {};
    if (s.summary) { box.appendChild(el("h2", "", "Zusammenfassung")); box.appendChild(csSummary(R)); }
    if (s.locations) { box.appendChild(el("h2", "", "Standort-Übersicht")); box.appendChild(csLocations(R)); }
    if (s.persons) { box.appendChild(el("h2", "", "Mitarbeiter")); box.appendChild(csPersons(R, true)); }
    document.body.appendChild(box); document.body.classList.add("csp");
    var done = function () { document.body.classList.remove("csp"); box.remove(); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done); window.print(); done();
  }
  function renderChef() {
    var frag = document.createDocumentFragment(), R = state.report;
    title.textContent = R ? "Chef-Ansicht · " + R.label : "Chef-Ansicht";
    var acts = el("div", "cs-actions"); acts.appendChild(backBtn());
    if (R && R.available && R.print) { var pb = el("button", "cs-back", "Drucken / PDF"); pb.type = "button"; pb.addEventListener("click", printAll); acts.appendChild(pb); }
    frag.appendChild(acts);
    if (!getCGrant()) {
      var c = el("div", "card lock cslogin"); c.appendChild(el("b", "", "Chef-Ansicht")); c.appendChild(el("div", "sub", "Bitte gib das Chef-Passwort ein."));
      var inp = el("input"); inp.type = "password"; inp.autocomplete = "current-password"; inp.placeholder = "Passwort"; inp.setAttribute("aria-label", "Chef-Passwort");
      var go = el("button", "go", "Öffnen"); go.type = "button"; var err = el("div", "err", state.cErr || "");
      var submit = function () { if (inp.value) chefUnlock(inp.value, go, err); };
      go.addEventListener("click", submit); inp.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
      c.appendChild(inp); c.appendChild(go); c.appendChild(err); frag.appendChild(c); main.replaceChildren(frag); return;
    }
    if (!R) { frag.appendChild(state.cErr ? msg("Nicht geladen", state.cErr) : loaderNode("Bericht wird geladen …")); main.replaceChildren(frag); return; }
    if (!R.available) { frag.appendChild(msg("Noch nichts freigegeben", R.message || "Für den Chef ist noch kein Monat freigegeben.")); main.replaceChildren(frag); return; }
    var meta = el("div", "card"); var big = el("div", "big"); big.appendChild(el("b", "", R.counts.released + " von " + R.counts.total)); big.appendChild(el("span", "", "freigegeben")); meta.appendChild(big);
    var bar = el("div", "bar"); var fill = el("i"); fill.style.width = (R.counts.total ? Math.round(R.counts.released / R.counts.total * 100) : 0) + "%"; bar.appendChild(fill); meta.appendChild(bar);
    meta.appendChild(el("div", "sub", "Gesamt " + fh(R.total) + " Std. · " + (R.closedAt ? "abgeschlossen am " + new Date(R.closedAt).toLocaleDateString("de-DE") : "Monat noch offen")));
    frag.appendChild(meta);
    var S = R.sections || {}, tabs = [["summary", "Zusammenfassung", S.summary], ["persons", "Mitarbeiter", S.persons], ["locations", "Standorte", S.locations]].filter(function (x) { return x[2]; });
    var seg = el("div", "seg cs-tabs"); seg.style.gridTemplateColumns = "repeat(" + Math.max(tabs.length, 1) + ",1fr)";
    tabs.forEach(function (x) { var b = el("button", state.cTab === x[0] ? "on" : "", x[1]); b.type = "button"; b.addEventListener("click", function () { state.cTab = x[0]; render(); }); seg.appendChild(b); });
    if (tabs.length > 1) frag.appendChild(seg);
    frag.appendChild(state.cTab === "persons" ? csPersons(R, false) : state.cTab === "locations" ? csLocations(R) : csSummary(R));
    main.replaceChildren(frag);
  }
  function render() {
    var d = state.data;
    setStand();
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
})();

(function () {
  "use strict";
  var URL_API = "https://script.google.com/macros/s/AKfycbzNrtg6-hoAv_kWkuE_noqRtlRYYJAzQMxJnpnEbyP3b4JjlHyG4vPVsuqdC45xrPe9/exec";
  var API_TOKEN = "Zk0sUhvBN2XU13DGgeAwhm-H-rtmBcK1OwJR7NLc1VI";
  var vt = (location.hash || "").replace(/^#/, "").replace(/[^0-9a-f]/gi, "").slice(0, 64);
  var state = { month: "", data: null, tab: null, firstCall: true, offline: false, pwErr: "", loading: false, retry: null };
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
    if (t.closest && t.closest(".chip, .seg, .lock, #title")) return;   // echte Bedienelemente: Monat, Reiter, Passwort
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
    if (!state.data || !state.data.updated) { standTxt.textContent = state.offline ? "keine Verbindung" : "verbinde …"; return; }
    var d = new Date(state.data.updated), p = function (x) { return String(x).padStart(2, "0"); };
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
  function render() {
    var d = state.data;
    setStand();
    if (!d) return;
    if (d.fatal) { title.textContent = "Stunden-Übersicht"; main.replaceChildren(msg(d.fatal.code === "VIEW_LOCKED" ? "Zurzeit gesperrt" : d.fatal.code === "VIEW_EMPTY" ? "Noch nichts freigegeben" : "Link nicht gültig", d.fatal.message || "")); standTxt.textContent = ""; return; }
    title.textContent = d.label || "Stunden-Übersicht";
    var frag = document.createDocumentFragment();
    frag.appendChild(noteBox());
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
  var poll = setInterval(function () { if (document.visibilityState === "visible" && state.data && !state.data.fatal && !state.data.needPassword) load(); }, 45000);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && state.data && !state.data.fatal && !state.data.needPassword) load(); });
})();

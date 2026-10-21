'use strict';
/* Dienstplan-Portal: gemeinsame Bausteine.
   Sicherheitsregeln dieses Codes:
   - Texte aus Daten werden NIE als HTML eingesetzt, nur als Text (textContent / Textknoten).
   - Keine eingebetteten Skripte, kein eval, keine Inline-Handler (passt zur strengen CSP der Seiten).
   - Die Seite verweigert das Einbetten in fremde Seiten (Clickjacking-Schutz). */
(function () {
  if (window.top !== window.self) {
    document.documentElement.textContent = '';
    throw new Error('Diese Seite darf nicht eingebettet werden.');
  }

  const DP = (window.DP = {});
  DP.API_URL = 'https://script.google.com/macros/s/AKfycbzNrtg6-hoAv_kWkuE_noqRtlRYYJAzQMxJnpnEbyP3b4JjlHyG4vPVsuqdC45xrPe9/exec';
  DP.API_TOKEN = 'Zk0sUhvBN2XU13DGgeAwhm-H-rtmBcK1OwJR7NLc1VI';

  // ---------- DOM-Bausteine ----------
  DP.h = function h(tag, props) {
    const el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        const v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'dataset') Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; });
        else if (k === 'style') el.style.cssText = String(v);   // über CSSOM: erlaubt, ein style-Attribut würde von der Sicherheitsrichtlinie blockiert
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (let i = 2; i < arguments.length; i++) appendChildren(el, arguments[i]);
    return el;
  };
  function appendChildren(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { appendChildren(el, x); }); return; }
    el.append(c && c.nodeType ? c : document.createTextNode(String(c)));
  }

  const ICONS = {
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    key: '<path d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    circle: '<circle cx="12" cy="12" r="9"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    pluscircle: '<circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>',
    swap: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
    bell: '<path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5M12 15V3"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>',
    chevleft: '<path d="M15 18l-6-6 6-6"/>',
    chevright: '<path d="M9 18l6-6-6-6"/>',
    sticky: '<path d="M15 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9z"/><path d="M15 3v6h6"/>',
    send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
    chart: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14L21 3"/>',
    more: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
    wifioff: '<path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>'
  };
  DP.icon = function (name, cls) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.innerHTML = ICONS[name] || ICONS.circle;   // nur feste, im Code stehende Zeichenketten
    return svg;
  };

  // ---------- Server ----------
  DP.api = async function (action, payload, opts) {
    const ctl = new AbortController();
    const timer = setTimeout(function () { ctl.abort(); }, (opts && opts.timeout) || 25000);
    try {
      const res = await fetch(DP.API_URL, {
        method: 'POST',
        body: JSON.stringify(Object.assign({ token: DP.API_TOKEN, action: action }, payload || {})),
        signal: ctl.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
      });
      const data = await res.json();
      if (!data || typeof data !== 'object') throw new Error('Antwort ungültig');
      if (Array.isArray(data.placeConfig)) DP.setPlaces(data.placeConfig);
      return data;
    } catch (e) {
      return { status: 'error', code: 'NETWORK', message: 'Keine Verbindung zum Server. Bitte prüfe dein Internet und versuche es erneut.' };
    } finally {
      clearTimeout(timer);
    }
  };

  // ---------- Sitzung im Browser ----------
  DP.sessionStore = function (key) {
    function stores() { const out = []; try { out.push(window.sessionStorage); } catch (e) { /* gesperrt */ } try { out.push(window.localStorage); } catch (e) { /* gesperrt */ } return out; }
    return {
      load: function () {
        const list = stores();
        for (let i = 0; i < list.length; i++) {
          try {
            const v = JSON.parse(list[i].getItem(key) || 'null');
            if (v && typeof v.token === 'string' && Number(v.expires) > Date.now()) return { token: v.token, expires: v.expires, remember: i === 1 };
          } catch (e) { /* ungültig */ }
        }
        return null;
      },
      save: function (token, expires, remember) {
        this.clear();
        try { (remember ? window.localStorage : window.sessionStorage).setItem(key, JSON.stringify({ token: token, expires: expires })); } catch (e) { /* ignorieren */ }
      },
      clear: function () {
        stores().forEach(function (s) { try { s.removeItem(key); } catch (e) { /* ignorieren */ } });
      }
    };
  };

  // ---------- Zeit ----------
  const p2 = function (n) { return String(n).padStart(2, '0'); };
  DP.fmtDate = function (ts) { const d = new Date(ts); return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear(); };
  DP.fmtDateTime = function (ts) { const d = new Date(ts); return DP.fmtDate(ts) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  DP.relTime = function (ts) {
    if (!ts) return 'nie';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45) return 'gerade eben';
    const m = Math.floor(s / 60);
    if (m < 60) return 'vor ' + m + ' Min.';
    const h = Math.floor(m / 60);
    if (h < 24) return 'vor ' + h + ' Std.';
    const d = Math.floor(h / 24);
    if (d < 7) return 'vor ' + d + (d === 1 ? ' Tag' : ' Tagen');
    return DP.fmtDate(ts);
  };
  DP.avatar = function (name, cls) {
    const s = String(name || ''); let hue = 0;
    for (let i = 0; i < s.length; i++) hue = (hue * 31 + s.charCodeAt(i)) % 360;
    const e = DP.h('div', { class: cls || 'avatar', text: DP.initials(s) });
    e.style.setProperty('--av', 'hsl(' + hue + ' 44% 32%)');
    e.style.setProperty('--avf', 'hsl(' + hue + ' 85% 93%)');
    return e;
  };
  DP.initials = function (name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || '?').charAt(0) + (parts.length > 1 ? parts[parts.length - 1].charAt(0) : '')).toUpperCase();
  };

  // ---------- Kalendertage (ohne Zeitzonen-Fallen: nur 'JJJJ-MM-TT' als Text) ----------
  const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
  const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  DP.dates = {
    WD: WD, WD_LONG: WD_LONG, MONTHS: MONTHS,
    parse: function (s) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
      if (!m) return null;
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
    },
    fmt: function (d) { return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()); },
    add: function (s, n) { const d = DP.dates.parse(s); d.setUTCDate(d.getUTCDate() + n); return DP.dates.fmt(d); },
    weekday: function (s) { return (DP.dates.parse(s).getUTCDay() + 6) % 7; },               // Montag = 0
    weekStart: function (s) { return DP.dates.add(s, -DP.dates.weekday(s)); },
    today: function () { const n = new Date(); return n.getFullYear() + '-' + p2(n.getMonth() + 1) + '-' + p2(n.getDate()); },
    diff: function (a, b) { return Math.round((DP.dates.parse(b) - DP.dates.parse(a)) / 86400000); },
    short: function (s) { const d = DP.dates.parse(s); return WD[DP.dates.weekday(s)] + ' ' + p2(d.getUTCDate()) + '.' + p2(d.getUTCMonth() + 1) + '.'; },
    long: function (s) { const d = DP.dates.parse(s); return WD_LONG[DP.dates.weekday(s)] + ', ' + d.getUTCDate() + '. ' + MONTHS[d.getUTCMonth()]; },
    monthLabel: function (s) { const d = DP.dates.parse(s); return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); },
    isoWeek: function (s) {
      const d = DP.dates.parse(s);
      const day = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - day);
      return Math.ceil(((d - new Date(Date.UTC(d.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7);
    },
    rangeLabel: function (ws) {
      const a = DP.dates.parse(ws), b = DP.dates.parse(DP.dates.add(ws, 6));
      const x = p2(a.getUTCDate()) + '.', y = p2(b.getUTCDate()) + '.' + p2(b.getUTCMonth() + 1) + '.' + b.getUTCFullYear();
      return a.getUTCMonth() === b.getUTCMonth() ? x + '–' + y : x + p2(a.getUTCMonth() + 1) + '.–' + y;
    },
    monthStart: function (s) { return String(s).slice(0, 8) + '01'; },
    monthEnd: function (ms) { const d = DP.dates.parse(DP.dates.monthStart(ms)); return DP.dates.fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); },
    monthAdd: function (ms, n) { const d = DP.dates.parse(DP.dates.monthStart(ms)); return DP.dates.fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))); },
    minutes: function (hm) { const m = /^(\d{2}):(\d{2})$/.exec(String(hm || '')); return m ? +m[1] * 60 + +m[2] : null; },
    hours: function (start, end) {   // Dauer in Stunden, über Mitternacht möglich
      const a = DP.dates.minutes(start), b = DP.dates.minutes(end);
      if (a === null || b === null || a === b) return null;
      let d = b - a; if (d <= 0) d += 1440; return d / 60;
    },
    fmtHours: function (h) { return String(Math.round(h * 10) / 10).replace('.', ','); },
    startDate: function (date, start) { const d = DP.dates.parse(date), m = DP.dates.minutes(start); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.floor(m / 60), m % 60); }
  };

  // Farbe pro Standort (gleiche Reihenfolge wie im Backend); unbekannte Standorte bekommen keine Farbe
  // Standorte sind einstellbar: DP.setPlaces(config) wird mit jeder Serverantwort aufgerufen, die "placeConfig" enthält.
  const LEGACY_PLACES = ['Hagenbecks Tierpark', 'Farmsen', 'Ochsenzoll', 'Volksdorf', 'Großhandsdorf', 'Volksdorf/Farmsen', 'Ochsenzoll (Tag)'];
  const LEGACY_SHORT = { 'Hagenbecks Tierpark': 'H', 'Farmsen': 'F', 'Ochsenzoll': 'O', 'Volksdorf': 'V', 'Großhandsdorf': 'G', 'Volksdorf/Farmsen': 'VF', 'Ochsenzoll (Tag)': 'OT' };
  DP.PLACES = LEGACY_PLACES.slice();   // sichtbare Standorte in der eingestellten Reihenfolge
  DP.PLACE_COLORS = 12;
  DP._cfg = {};
  LEGACY_PLACES.forEach(function (n, i) { DP._cfg[n] = { name: n, color: i, short: LEGACY_SHORT[n], active: true }; });
  DP.setPlaces = function (cfg) {
    if (!Array.isArray(cfg) || !cfg.length) return;
    DP._cfg = {}; DP.PLACES.length = 0;
    cfg.forEach(function (p) { if (!p || typeof p.name !== 'string') return; DP._cfg[p.name] = p; if (p.active !== false) DP.PLACES.push(p.name); });
  };
  DP.placeClass = function (place) { const c = DP._cfg[place]; if (c && Number.isInteger(c.color)) return ' pl' + c.color; const i = LEGACY_PLACES.indexOf(place); return i < 0 ? '' : ' pl' + i; };
  DP.placeShort = function (p) { const c = DP._cfg[p]; if (c && c.short) return c.short; return LEGACY_SHORT[p] || (String(p || '?').replace(/[^A-Za-zÄÖÜäöüß0-9]/g, '').slice(0, 2).toUpperCase() || '?'); };

  // ---------- Hinweise und Dialoge ----------
  DP.toast = function (message, kind) {
    let box = document.getElementById('toasts');
    if (!box) { box = DP.h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
    const t = DP.h('div', { class: 'toast' + (kind === 'error' ? ' error' : ''), role: 'status', text: message });
    box.append(t);
    setTimeout(function () { t.remove(); }, 4200);
  };

  DP.modal = function (opts) {
    const previous = document.activeElement;
    const overlay = DP.h('div', { class: 'overlay' });
    const body = typeof opts.body === 'string' ? DP.h('p', { text: opts.body }) : opts.body;
    const actions = DP.h('div', { class: 'actions' });
    const dlg = DP.h('div', { class: 'modal' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Dialog' },
      opts.title ? DP.h('h2', { text: opts.title }) : null, body, actions);
    overlay.append(dlg);
    let closed = false;
    DP._stack = DP._stack || [];
    const api = {
      el: dlg,
      close: function () {
        if (closed) return;
        closed = true;
        DP._stack = DP._stack.filter(function (x) { return x !== api; });
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        if (previous && previous.focus) previous.focus();
        if (opts.onClose) opts.onClose();
      }
    };
    (opts.actions || []).forEach(function (a) {
      const btn = DP.h('button', { type: 'button', class: 'btn ' + (a.kind ? 'btn-' + a.kind : 'btn-secondary') + (a.small ? ' btn-sm' : '') }, a.icon ? DP.icon(a.icon, 'sm') : null, a.label);
      btn.addEventListener('click', async function () {
        if (a.onClick) { btn.disabled = true; try { await a.onClick(api, btn); } finally { btn.disabled = false; } }
        if (a.closes !== false) api.close();
      });
      actions.append(btn);
    });
    function onKey(e) {
      if (DP._stack[DP._stack.length - 1] !== api) return;
      if (e.key === 'Escape' && opts.dismissable !== false) { e.stopPropagation(); api.close(); }
      if (e.key === 'Tab') {
        const f = dlg.querySelectorAll('button,[href],input,select,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    DP._stack.push(api);
    document.addEventListener('keydown', onKey, true);
    if (opts.dismissable !== false) overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) api.close(); });
    document.body.append(overlay);
    const focusEl = dlg.querySelector('[data-autofocus]') || dlg.querySelector('input,button');
    if (focusEl) focusEl.focus();
    return api;
  };

  DP.confirm = function (title, text, confirmLabel, kind) {
    return new Promise(function (resolve) {
      let answer = false;
      DP.modal({
        title: title, body: text, dismissable: true,
        onClose: function () { resolve(answer); },
        actions: [
          { label: 'Abbrechen', kind: 'secondary' },
          { label: confirmLabel || 'OK', kind: kind || 'primary', onClick: function () { answer = true; } }
        ]
      });
    });
  };

  DP.copyText = async function (text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
  };
})();

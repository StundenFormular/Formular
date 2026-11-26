/* Konsole → Wartung: Karte „Dienst abschalten“ (kommt nur in der Wartungs-Ansicht der Konsole vor). */
(function () {
  'use strict';
  var API_URL = 'https://script.google.com/macros/s/AKfycbzNrtg6-hoAv_kWkuE_noqRtlRYYJAzQMxJnpnEbyP3b4JjlHyG4vPVsuqdC45xrPe9/exec';
  var API_TOKEN = 'Zk0sUhvBN2XU13DGgeAwhm-H-rtmBcK1OwJR7NLc1VI';
  var WORD = 'ABSCHALTEN';

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e; }
  function session() { try { return sessionStorage.getItem('adm_session') || ''; } catch (e) { return ''; } }
  function call(body) {
    return fetch(API_URL, { method: 'POST', body: JSON.stringify(Object.assign({ token: API_TOKEN, adminSession: session() }, body)) }).then(function (r) { return r.json(); });
  }

  function build() {
    var anchor = document.getElementById('maintBar');
    if (!anchor || !document.documentElement.classList.contains('maintOnly') || document.getElementById('dienstKarte')) return;
    var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'dienst-aus.3.css'; document.head.appendChild(css);

    var card = el('section', 'dk'); card.id = 'dienstKarte';
    var head = el('div', 'dk-head');
    head.appendChild(el('h3', '', 'Dienst abschalten'));
    head.appendChild(el('span', 'dk-chip', 'Dienst läuft'));
    card.appendChild(head);
    card.appendChild(el('p', '', 'Beendet alle Funktionen auf einmal: die Stunden-App, den Dienstplan, den Übersichtslink und den Chef-Link. Jeder, der eine Seite öffnet, sieht nur noch „403 Forbidden“. Die Daten bleiben gespeichert.'));
    var btn = el('button', 'dk-btn', 'Dienst abschalten …'); btn.type = 'button';
    card.appendChild(btn);
    card.appendChild(el('div', 'dk-note', 'Wieder einschalten: Konsole öffnen und die Überschrift „403 Forbidden“ fünfmal antippen, dann PIN eingeben. Oder in Apps Script unter Projekteinstellungen → Skripteigenschaften die Zeile DIENST_AUS löschen.'));
    var msg = el('div', 'dk-msg'); card.appendChild(msg);
    anchor.parentNode.insertBefore(card, anchor.nextSibling);

    btn.addEventListener('click', function () {
      var back = el('div', 'dk-back'); back.setAttribute('role', 'dialog'); back.setAttribute('aria-modal', 'true');
      var dlg = el('div', 'dk-dlg'); back.appendChild(dlg);
      dlg.appendChild(el('h4', '', 'Dienst wirklich abschalten?'));
      var ul = el('ul');
      ['Stunden-App, Dienstplan, Übersichtslink und Chef-Link funktionieren sofort nicht mehr.',
       'Niemand kann Stunden senden oder ansehen, auch du nicht, bis du wieder einschaltest.',
       'Die Daten bleiben erhalten.'].forEach(function (t) { ul.appendChild(el('li', '', t)); });
      dlg.appendChild(ul);
      var lab = el('label', '', 'Zur Bestätigung tippe ' + WORD + ':'); lab.setAttribute('for', 'dkWord');
      var inp = el('input', 'dk-in'); inp.id = 'dkWord'; inp.type = 'text'; inp.autocomplete = 'off'; inp.autocapitalize = 'characters'; inp.placeholder = WORD;
      dlg.appendChild(lab); dlg.appendChild(inp);
      var err = el('div', 'dk-msg'); dlg.appendChild(err);
      var row = el('div', 'dk-row');
      var no = el('button', 'dk-btn ghost', 'Abbrechen'); no.type = 'button';
      var yes = el('button', 'dk-btn', 'Jetzt abschalten'); yes.type = 'button'; yes.disabled = true;
      row.appendChild(no); row.appendChild(yes); dlg.appendChild(row);
      document.body.appendChild(back); inp.focus();
      function close() { if (back.parentNode) back.parentNode.removeChild(back); }
      inp.addEventListener('input', function () { yes.disabled = inp.value.trim().toUpperCase() !== WORD; });
      no.addEventListener('click', close);
      back.addEventListener('click', function (e) { if (e.target === back) close(); });
      document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
      yes.addEventListener('click', function () {
        if (inp.value.trim().toUpperCase() !== WORD) return;
        yes.disabled = true; no.disabled = true; err.textContent = 'Wird abgeschaltet …';
        call({ action: 'adminDienstSet', off: true }).then(function (r) {
          if (!r || r.status !== 'success') throw new Error((r && r.message) || 'Das hat nicht geklappt.');
          try { localStorage.setItem('dienstAus', '1'); } catch (e) { /* egal */ }
          try { window.top.location.reload(); } catch (e) { location.reload(); }
        }).catch(function (e) { err.textContent = 'Fehler: ' + (e && e.message || 'unbekannt'); yes.disabled = false; no.disabled = false; });
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();

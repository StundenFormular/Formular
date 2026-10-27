// Liest Text samt Position aus einem PDF, nur im Browser. Zum Server geht später nur der erkannte Text.
(function () {
  'use strict';
  var libPromise = null;
  function lib() {
    if (!libPromise) {
      libPromise = import('./dp-pdf.6.4.299.min.mjs').then(function (m) {
        m.GlobalWorkerOptions.workerSrc = new URL('./dp-pdf-worker.6.4.299.min.mjs', document.baseURI).href;
        return m;
      });
      libPromise.catch(function () { libPromise = null; });
    }
    return libPromise;
  }
  var r1 = function (x) { return Math.round(x * 10) / 10; };
  // Textstücke zu Zeilen und Zellen: gleiche Höhe = eine Zeile, kleiner Abstand = eine Zelle, großer Abstand = nächste Spalte
  function buildLines(items) {
    items.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var rows = [];
    items.forEach(function (it) {
      var row = null;
      for (var i = 0; i < rows.length; i++) { if (Math.abs(rows[i].y - it.y) <= Math.max(2, it.h * 0.35)) { row = rows[i]; break; } }
      if (!row) { row = { y: it.y, items: [] }; rows.push(row); }
      row.items.push(it);
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    return rows.map(function (r) {
      r.items.sort(function (a, b) { return a.x - b.x; });
      var cells = [];
      r.items.forEach(function (it) {
        var last = cells[cells.length - 1], gap = last ? it.x - (last.x + last.w) : 0;
        if (last && gap <= Math.max(2.5, it.h * 0.45)) { last.t += (gap > it.h * 0.12 ? ' ' : '') + it.t; last.w = it.x + it.w - last.x; last.h = Math.max(last.h, it.h); }
        else cells.push({ x: it.x, w: it.w, h: it.h, t: it.t });
      });
      return { y: r1(r.y), cells: cells.map(function (c) { return { x: r1(c.x), h: r1(c.h), t: c.t.replace(/\s+/g, ' ').trim() }; }).filter(function (c) { return c.t; }) };
    }).filter(function (l) { return l.cells.length; });
  }
  window.DP = window.DP || {};
  DP.pdfExtract = async function (file) {
    if (!file || file.size > 8 * 1024 * 1024) throw new Error('Die Datei ist größer als 8 MB.');
    var m = await lib(), buf = await file.arrayBuffer();
    var task = m.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }), doc = await task.promise;
    var pages = [], n = Math.min(doc.numPages, 10);
    for (var p = 1; p <= n; p++) {
      var page = await doc.getPage(p), tc = await page.getTextContent(), items = [];
      tc.items.forEach(function (i) { if (i.str && i.str.trim() && i.transform) items.push({ x: i.transform[4], y: i.transform[5], w: i.width || 0, h: Math.abs(i.height || i.transform[3]) || 10, t: i.str }); });
      pages.push({ lines: buildLines(items) });
    }
    try { await task.destroy(); } catch (e) { /* aufräumen ist nicht kritisch */ }
    return { name: file.name, pages: pages };
  };
})();

/* PDF-Erzeugung im Browser (Version 68): Standort-Übersicht und Standortblätter für den Chef.
   Kein fremder Code: ein kleiner PDF-Schreiber mit den Standardschriften Helvetica und Helvetica-Bold (WinAnsi). */
(function (root) {
  "use strict";
  var WR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 761, 556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500], WB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 761, 556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, 0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556];
  var CP = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  function code(ch) { var c = ch.charCodeAt(0); if (c < 256 && !(c >= 0x80 && c <= 0x9F)) return c; return CP[c] !== undefined ? CP[c] : 63; }
  function tw(s, size, bold) { var W = bold ? WB : WR, t = 0; s = String(s == null ? "" : s); for (var i = 0; i < s.length; i++) { var c = code(s[i]); t += c >= 32 ? W[c - 32] || 0 : 0; } return t * size / 1000; }
  function esc(s) { var o = ""; s = String(s == null ? "" : s); for (var i = 0; i < s.length; i++) { var c = code(s[i]); if (c < 32) continue; var ch = String.fromCharCode(c); o += (ch === "(" || ch === ")" || ch === "\\") ? "\\" + ch : ch; } return o; }
  function num(n) { return (Math.round(n * 100) / 100).toString(); }
  function rgb(hex) { var h = String(hex || "#000000").replace("#", ""); return [0, 2, 4].map(function (i) { return (parseInt(h.substr(i, 2), 16) / 255).toFixed(3); }).join(" "); }
  function fmt(n) { var v = Math.round(Number(n) * 100) / 100, neg = v < 0, p = Math.abs(v).toString().split("."), i = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, "."); return (neg ? "−" : "") + i + (p[1] ? "," + p[1] : ""); }
  function fit(s, maxW, size, bold) { s = String(s == null ? "" : s); if (tw(s, size, bold) <= maxW) return s; while (s.length > 1 && tw(s + "…", size, bold) > maxW) s = s.slice(0, -1); return s + "…"; }
  function fitSize(s, maxW, size, bold, min) { while (size > min && tw(s, size, bold) > maxW) size -= 0.5; return size; }
  function wrap(s, maxW, size, bold) { var words = String(s).split(/\s+/), lines = [], cur = ""; words.forEach(function (w) { var t = cur ? cur + " " + w : w; if (tw(t, size, bold) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }); if (cur) lines.push(cur); return lines; }
  function Doc(title) { this.w = 595.28; this.h = 841.89; this.pages = []; this.cur = null; this.title = title || ""; }
  Doc.prototype.page = function () { this.cur = []; this.pages.push(this.cur); return this; };
  Doc.prototype.text = function (x, y, s, o) { o = o || {}; var size = o.size || 10, w = tw(s, size, o.bold), px = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x; this.cur.push("BT " + (o.bold ? "/F2" : "/F1") + " " + num(size) + " Tf " + rgb(o.color) + " rg " + num(px) + " " + num(this.h - y) + " Td (" + esc(s) + ") Tj ET"); return w; };
  Doc.prototype.rect = function (x, y, w, h, fill) { this.cur.push(rgb(fill) + " rg " + num(x) + " " + num(this.h - y - h) + " " + num(w) + " " + num(h) + " re f"); };
  Doc.prototype.line = function (x1, y1, x2, y2, col, lw) { this.cur.push(rgb(col || "#999999") + " RG " + num(lw || 0.5) + " w " + num(x1) + " " + num(this.h - y1) + " m " + num(x2) + " " + num(this.h - y2) + " l S"); };
  Doc.prototype.save = function () {
    var self = this, n = this.pages.length, objs = [];
    this.pages.forEach(function (p, i) { p.push("BT /F1 8 Tf " + rgb("#7A889B") + " rg " + num(self.w / 2 - tw("Seite " + (i + 1) + " von " + n, 8, false) / 2) + " 24 Td (Seite " + (i + 1) + " von " + n + ") Tj ET"); });
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    var kids = this.pages.map(function (_, i) { return (5 + i * 2) + " 0 R"; }).join(" ");
    objs[2] = "<< /Type /Pages /Kids [" + kids + "] /Count " + n + " >>";
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    this.pages.forEach(function (p, i) { var c = p.join("\n"), pn = 5 + i * 2; objs[pn] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + num(self.w) + " " + num(self.h) + "] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " + (pn + 1) + " 0 R >>"; objs[pn + 1] = "<< /Length " + c.length + " >>\nstream\n" + c + "\nendstream"; });
    var info = 5 + n * 2; objs[info] = "<< /Title (" + esc(this.title) + ") /Producer (Dienstplan) >>";
    var out = "%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n", offs = [];
    for (var i = 1; i <= info; i++) { offs[i] = out.length; out += i + " 0 obj\n" + objs[i] + "\nendobj\n"; }
    var xr = out.length; out += "xref\n0 " + (info + 1) + "\n0000000000 65535 f \n";
    for (var j = 1; j <= info; j++) out += ("0000000000" + offs[j]).slice(-10) + " 00000 n \n";
    out += "trailer\n<< /Size " + (info + 1) + " /Root 1 0 R /Info " + info + " 0 R >>\nstartxref\n" + xr + "\n%%EOF\n";
    var bytes = new Uint8Array(out.length); for (var k = 0; k < out.length; k++) bytes[k] = out.charCodeAt(k) & 255; return bytes;
  };
  var M = 36, NAVY = "#1B2A57", ZEBRA = "#F3F5F9", GRAY = "#5C6B80", RED = "#B3261E", REDBG = "#FBE3E3", AMBER = "#B45F06";
  function shiftTxt(p) { return p.start.slice(0, 2) + "–" + p.end.slice(0, 2) + " Uhr · " + fmt(p.hours) + " Std."; }
  function stamp() { var d = new Date(); return "Erstellt am " + ("0" + d.getDate()).slice(-2) + "." + ("0" + (d.getMonth() + 1)).slice(-2) + "." + d.getFullYear() + " um " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + " Uhr"; }
  function summaryPage(doc, data) {
    var y = 54; doc.text(M, y, "Standort-Übersicht – " + data.label, { size: 16, bold: true, color: NAVY }); y += 16;
    doc.text(M, y, "Aus der Anwesenheit. Gerechnet ab dem ersten bis zum letzten besetzten Tag jedes Standorts.", { size: 8.5, color: GRAY }); y += 24;
    var cols = [["Standort", 142, "left"], ["Schicht", 112, "left"], ["Rechnung", 132, "left"], ["Stunden", 58, "right"], ["nicht besetzt", 71, "right"]], x0 = M, RH = 22;
    doc.rect(M, y, 515, RH, NAVY); var x = x0;
    cols.forEach(function (c) { doc.text(c[2] === "right" ? x + c[1] - 6 : x + 6, y + 14.5, c[0], { size: 9, bold: true, color: "#FFFFFF", align: c[2] }); x += c[1]; }); y += RH;
    data.places.forEach(function (p, i) {
      if (i % 2 === 0) doc.rect(M, y, 515, RH, ZEBRA);
      var vals = [p.name, shiftTxt(p), p.slots + " MA × " + p.worked + " Tage × " + fmt(p.hours) + " Std.", fmt(p.possible), p.open ? String(p.open) : "–"]; x = x0;
      cols.forEach(function (c, k) { doc.text(c[2] === "right" ? x + c[1] - 6 : x + 6, y + 14.5, fit(vals[k], c[1] - 12, 9, k === 0 || k === 3), { size: 9, bold: k === 0 || k === 3, align: c[2], color: k === 4 && p.open ? RED : "#0E1A2B" }); x += c[1]; }); y += RH;
    });
    doc.line(M, y, M + 515, y, NAVY, 1); doc.rect(M, y, 515, RH, "#E8ECF5");
    doc.text(M + 6, y + 14.5, "Gesamt", { size: 9.5, bold: true, color: NAVY }); doc.text(M + 142 + 112 + 132 + 58 - 6, y + 14.5, fmt(data.total), { size: 10, bold: true, color: NAVY, align: "right" }); doc.text(M + 515 - 6, y + 14.5, data.openTotal ? String(data.openTotal) : "–", { size: 9.5, bold: true, color: data.openTotal ? RED : NAVY, align: "right" }); y += RH + 16;
    var notes = ["Ein Tag zählt voll (mit allen Plätzen), sobald mindestens ein Mitarbeiter da war.", "Tage vor dem ersten und nach dem letzten besetzten Tag eines Standorts zählen nicht.", "„nicht besetzt“ sind Tage dazwischen, an denen kein Mitarbeiter da war. Sie gehen nicht in die Rechnung ein."];
    notes.forEach(function (t) { wrap(t, 515, 8.5, false).forEach(function (l) { doc.text(M, y, l, { size: 8.5, color: GRAY }); y += 11; }); });
    doc.text(M, 806, stamp(), { size: 8, color: GRAY });
  }
  function placePages(doc, data, p) {
    var slots = Math.max(1, p.slots), fs = slots > 5 ? 7.5 : 9, dateW = 64, timeW = 78, nameW = (515 - dateW - timeW) / slots, RH = 18, top = 54, y;
    var head = function () { doc.rect(M, y, 515, RH, NAVY); doc.text(M + 6, y + 12.5, "Datum", { size: 9, bold: true, color: "#FFFFFF" }); for (var s = 0; s < slots; s++) doc.text(M + dateW + s * nameW + 6, y + 12.5, "Mitarbeiter " + (s + 1), { size: 9, bold: true, color: "#FFFFFF" }); doc.text(M + dateW + slots * nameW + 6, y + 12.5, "Arbeitszeit", { size: 9, bold: true, color: "#FFFFFF" }); y += RH; };
    doc.page(); y = top; doc.text(M, y, p.name + " – " + data.label, { size: 16, bold: true, color: NAVY }); y += 15;
    doc.text(M, y, "Schicht " + p.start + "–" + p.end + " · " + p.slots + (p.slots === 1 ? " Platz" : " Plätze") + " · " + p.worked + (p.worked === 1 ? " gearbeiteter Tag" : " gearbeitete Tage") + " · " + (p.open ? p.open + (p.open === 1 ? " Tag" : " Tage") + " nicht besetzt" : "alle Tage besetzt"), { size: 9, color: GRAY }); y += 12;
    doc.text(M, y, "Zeitraum " + p.from.slice(8, 10) + "." + p.from.slice(5, 7) + ".–" + p.to.slice(8, 10) + "." + p.to.slice(5, 7) + ". · mögliche Stunden: " + p.slots + " × " + p.worked + " × " + fmt(p.hours) + " = " + fmt(p.possible) + " Std.", { size: 9, bold: true, color: "#0E1A2B" }); y += 18;
    head();
    p.sheet.forEach(function (d, i) {
      var hasT = !d.open && d.people.some(function (q) { return q.time; }), rh = hasT ? RH + 8 : RH;
      if (y + rh > 800) { doc.page(); y = top; doc.text(M, y, p.name + " – " + data.label + " (Fortsetzung)", { size: 11, bold: true, color: NAVY }); y += 16; head(); }
      var we = d.wd === "Sa" || d.wd === "So";
      if (d.open) doc.rect(M, y, 515, rh, REDBG); else if (i % 2 === 0) doc.rect(M, y, 515, rh, ZEBRA);
      doc.text(M + 6, y + 12.5, d.wd + " " + d.iso.slice(8, 10) + "." + d.iso.slice(5, 7) + ".", { size: 9, bold: true, color: we ? AMBER : "#0E1A2B" });
      if (d.open) doc.text(M + dateW + 6, y + 12.5, "nicht besetzt", { size: 8.5, bold: true, color: RED });
      else { d.people.forEach(function (q, s) { if (s >= slots) return; var sz = fitSize(q.name, nameW - 10, fs, false, 6.5); doc.text(M + dateW + s * nameW + 6, y + 12.5, fit(q.name, nameW - 10, sz, false), { size: sz }); if (q.time) doc.text(M + dateW + s * nameW + 6, y + 21.5, q.time, { size: 7, bold: true, color: AMBER }); }); doc.text(M + dateW + slots * nameW + 6, y + 12.5, p.start + "–" + p.end, { size: 9 }); }
      y += rh;
    });
    doc.line(M, y, M + 515, y, "#C9D1E3", 0.7); doc.text(M, y + 14, stamp(), { size: 8, color: GRAY });
  }
  function slug(s) { return String(s).replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); }
  var api = {
    summary: function (data) { var d = new Doc("Standort-Übersicht " + data.label); d.page(); summaryPage(d, data); return d.save(); },
    place: function (data, name) { var p = data.places.filter(function (x) { return x.name === name; })[0]; if (!p) return null; var d = new Doc(p.name + " " + data.label); placePages(d, data, p); return d.save(); },
    all: function (data) { var d = new Doc("Alle Standorte " + data.label); d.page(); summaryPage(d, data); data.places.forEach(function (p) { placePages(d, data, p); }); return d.save(); },
    fileName: function (kind, data, name) { var m = slug(data.label); return kind === "summary" ? "Standort_Uebersicht_" + m + ".pdf" : kind === "all" ? "Standorte_Alle_" + m + ".pdf" : "Standort_" + slug(name) + "_" + m + ".pdf"; },
    download: function (bytes, name) { var blob = new Blob([bytes], { type: "application/pdf" }), url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.style.display = "none"; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 4000); },
    fmt: fmt, width: tw
  };
  root.DPPdfGen = api;
})(typeof window !== "undefined" ? window : globalThis);

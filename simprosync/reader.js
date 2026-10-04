/* ---------- Minimal .xlsx / .csv reader (no dependencies) ----------
   Reads cached cell values from the first (or chosen) worksheet.
   Cell values returned as: null | string | number | {date:{y,m,d}} | {err:"#REF!"} */
const XLSXLite = (() => {
  const td = new TextDecoder('utf-8');

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a valid .xlsx file (zip directory not found).');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = {};
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), cmtLen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
      entries[name] = { method, csize, lho };
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return {
      names: Object.keys(entries),
      async text(name) {
        const e = entries[name];
        if (!e) return null;
        const ln = dv.getUint16(e.lho + 26, true), le = dv.getUint16(e.lho + 28, true);
        const start = e.lho + 30 + ln + le;
        const data = u8.subarray(start, start + e.csize);
        const out = e.method === 0 ? data : await inflateRaw(data);
        return td.decode(out);
      }
    };
  }

  function decodeXml(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, g) => {
      if (g[0] === '#') return String.fromCodePoint(g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[g];
    });
  }
  function attrs(s) {
    const o = {}; let m; const re = /([\w:]+)\s*=\s*"([^"]*)"/g;
    while ((m = re.exec(s))) o[m[1]] = decodeXml(m[2]);
    return o;
  }
  function textOf(xml) {   // concatenate all <t> runs, ignoring phonetic runs
    xml = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let out = '', m; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
    while ((m = re.exec(xml))) out += m[1] ? decodeXml(m[1]) : '';
    return out;
  }
  function colIndex(ref) {
    const letters = ref.replace(/\d+/g, ''); let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
  function isDateFormat(id, code) {
    if (BUILTIN_DATE.has(id)) return true;
    if (!code) return false;
    const c = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');
    if (/general/i.test(c)) return false;
    return /[dmy]/i.test(c) || /h+:m|m+:s/i.test(c);
  }
  function serialToDate(serial, date1904) {
    const days = Math.floor(serial) + (date1904 ? 1462 : 0);
    const d = new Date(Date.UTC(1899, 11, 30) + days * 86400000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }

  async function readXlsx(buf) {
    const z = await unzip(buf);
    const wbXml = await z.text('xl/workbook.xml');
    if (!wbXml) throw new Error('This does not look like an Excel workbook.');
    const date1904 = /date1904\s*=\s*"(1|true)"/i.test(wbXml);
    const relsXml = (await z.text('xl/_rels/workbook.xml.rels')) || '';
    const rels = {}; let m;
    const relRe = /<Relationship\b([^>]*)\/?>/g;
    while ((m = relRe.exec(relsXml))) { const a = attrs(m[1]); rels[a.Id] = a.Target; }
    const sheets = []; const shRe = /<sheet\b([^>]*)\/?>/g;
    while ((m = shRe.exec(wbXml))) {
      const a = attrs(m[1]);
      let t = rels[a['r:id']] || '';
      t = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
      sheets.push({ name: a.name, path: t, state: a.state || 'visible' });
    }
    // shared strings
    const ss = [];
    const ssXml = await z.text('xl/sharedStrings.xml');
    if (ssXml) { const re = /<si>([\s\S]*?)<\/si>|<si\/>/g; while ((m = re.exec(ssXml))) ss.push(m[1] ? textOf(m[1]) : ''); }
    // styles -> which style indexes are dates
    const stXml = (await z.text('xl/styles.xml')) || '';
    const fmts = {}; const nfRe = /<numFmt\b([^>]*)\/?>/g;
    while ((m = nfRe.exec(stXml))) { const a = attrs(m[1]); fmts[+a.numFmtId] = a.formatCode; }
    const xfSec = (stXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/) || [, ''])[1];
    const xfDate = []; const xfRe = /<xf\b([^>]*?)(\/>|>)/g;
    while ((m = xfRe.exec(xfSec))) { const a = attrs(m[1]); const id = +(a.numFmtId || 0); xfDate.push(isDateFormat(id, fmts[id])); }

    async function sheetRows(index) {
      const xml = await z.text(sheets[index].path);
      if (!xml) throw new Error('Could not read sheet ' + sheets[index].name);
      const rows = []; const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g; let rm, nextRow = 1;
      while ((rm = rowRe.exec(xml))) {
        const ra = attrs(rm[1]); const r = ra.r ? +ra.r : nextRow; nextRow = r + 1;
        const row = []; let nextCol = 0;
        if (rm[2]) {
          const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
          while ((cm = cRe.exec(rm[2]))) {
            const a = attrs(cm[1]); const ci = a.r ? colIndex(a.r) : nextCol; nextCol = ci + 1;
            const inner = cm[2] || ''; const t = a.t || 'n';
            const vm = inner.match(/<v>([\s\S]*?)<\/v>/); const v = vm ? decodeXml(vm[1]) : null;
            let val = null;
            if (t === 's') val = v === null ? null : (ss[+v] ?? '');
            else if (t === 'inlineStr') val = textOf(inner);
            else if (t === 'str') val = v;
            else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
            else if (t === 'e') val = { err: v || '#ERR' };
            else if (t === 'd') { const d = (v || '').slice(0, 10).split('-'); val = d.length === 3 ? { date: { y: +d[0], m: +d[1], d: +d[2] } } : v; }
            else if (v !== null && v !== '') {
              const num = Number(v);
              val = xfDate[+(a.s || 0)] ? { date: serialToDate(num, date1904) } : num;
            }
            row[ci] = val;
          }
        }
        rows[r - 1] = row;
      }
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
      return rows;
    }
    return { sheets: sheets.map(s => s.name), rows: sheetRows };
  }

  function readCsv(text) {
    text = text.replace(/^﻿/, '');
    const rows = []; let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return { sheets: ['CSV'], rows: async () => rows };
  }

  async function read(file) {
    const buf = await file.arrayBuffer();
    if (/\.csv$/i.test(file.name)) return readCsv(new TextDecoder('utf-8').decode(buf));
    return readXlsx(buf);
  }
  return { read, readXlsx, readCsv };
})();
export { XLSXLite };

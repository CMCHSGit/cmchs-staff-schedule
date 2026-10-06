/* ---------- Sync rules (same as sync_assets.py) ---------- */
const SyncCore = (() => {
  const MATCH_FIELD = 'Serial Number', SITE_COL = 'Site ID', JOB_COL = 'Simpro Job';
  const XL_ERRORS = new Set(['#REF!', '#N/A', '#VALUE!', '#DIV/0!', '#NAME?', '#NUM!', '#NULL!', '#SPILL!', '#CALC!']);
  const DMY = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/;
  const pad = n => String(n).padStart(2, '0');

  function asText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && v.err) return v.err;
    if (typeof v === 'object' && v.date) return `${v.date.d}/${pad(v.date.m)}/${v.date.y}`;   // NZ Excel style 1/09/2017
    if (typeof v === 'number') return String(v);
    const s = String(v).trim();
    const m = s.match(DMY);
    if (m) return `${+m[1]}/${pad(+m[2])}/${m[3]}`;
    return s;
  }
  function asDateIso(v) {   // '' = blank, null = not a date
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return '';
    if (typeof v === 'object' && v.date) return `${v.date.y}-${pad(v.date.m)}-${pad(v.date.d)}`;
    if (typeof v === 'object') return null;
    const s = String(v).trim();
    const m = s.match(DMY);
    if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return null;
  }
  const isErr = s => XL_ERRORS.has(String(s).trim().toUpperCase());

  /* rows: array of arrays (row 0 = header). Returns {header, recs:[{rownum, r}]} */
  function toRecords(rows) {
    const header = (rows[0] || []).map(h => (h === null || h === undefined) ? '' : String(typeof h === 'object' ? asText(h) : h).trim());
    const recs = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      if (row.every(v => v === null || v === undefined || String(typeof v === 'object' ? asText(v) : v).trim() === '')) continue;
      const r = {};
      header.forEach((h, j) => { if (h) r[h] = row[j] ?? null; });
      recs.push({ rownum: i + 1, r });
    }
    return { header, recs };
  }

  /* fdef: {lowercaseName: {ID, Name, Type, ListItems}} */
  function mapColumns(header, fdef) {
    const mapped = {}, unmapped = [];
    for (const h of header) {
      if (!h || h === SITE_COL || h.toLowerCase() === JOB_COL.toLowerCase()) continue;
      const f = fdef[h.trim().toLowerCase()];
      if (f) mapped[h] = f; else unmapped.push(h);
    }
    return { mapped, unmapped };
  }

  /* existing: Map key `${site}|${SERIAL}` -> {id, values:{cfid: value}} */
  function compare(recs, mapped, existing, only) {
    const changes = [], creates = [], warnings = [], seen = new Set(), jobs = new Map();
    let unchanged = 0;
    const jobKey = Object.keys(recs[0] ? recs[0].r : {}).find(k => k.trim().toLowerCase() === JOB_COL.toLowerCase());
    // Carried onto each job item below so the job-completion note can record
    // what was attached (model + serial), not just the serial. Read from the
    // row's own headers rather than the Simpro-mapped ones, so it still
    // works for a column Simpro has no matching field for - and accept the
    // spellings these sheets actually use ("Device Model" in CHS's lists),
    // not just a bare "Model", which found nothing and silently left every
    // note serial-only.
    const rowKeys = Object.keys(recs[0] ? recs[0].r : {});
    const norm = k => k.trim().toLowerCase();
    const pick = (wants, loose) => wants.map(w => rowKeys.find(k => norm(k) === w)).find(Boolean)
      || (loose ? rowKeys.find(loose) : undefined);
    const modelKey = pick(['device model', 'model', 'model name', 'model number'], k => norm(k).includes('model'));
    // Device type and battery serial ride along too: a defibrillator's
    // battery is a separately tracked serial, and the job note has to record
    // it next to the device it belongs to.
    const typeKey = pick(['device type', 'devicetype', 'asset type'], k => norm(k).includes('device type'));
    const batteryKey = pick(
      ['battery serial number', 'battery serial no', 'battery serial', 'battery sn'],
      k => norm(k).includes('battery') && norm(k).includes('serial')
    );
    for (const { rownum, r } of recs) {
      const site = asText(r[SITE_COL]); const ser = asText(r[MATCH_FIELD]).toUpperCase();
      if (!ser) { warnings.push({ row: rownum, serial: '', msg: 'No serial number - row skipped' }); continue; }
      if (only && !only.has(ser)) continue;
      const key = `${site}|${ser}`;
      if (seen.has(key)) { warnings.push({ row: rownum, serial: ser, msg: 'Serial appears twice in the sheet - second row skipped' }); continue; }
      seen.add(key);
      const cur = existing.get(key);
      if (jobKey) {
        const jraw = asText(r[jobKey]).replace(/^#/, '').trim();
        if (jraw) {
          if (!/^\d+$/.test(jraw)) warnings.push({ row: rownum, serial: ser, msg: `Simpro Job '${jraw}' is not a job number - not attached to a job` });
          else {
            if (!jobs.has(jraw)) jobs.set(jraw, []);
            jobs.get(jraw).push({
              rownum, site, ser,
              model: modelKey ? asText(r[modelKey]) : '',
              deviceType: typeKey ? asText(r[typeKey]) : '',
              batterySerial: batteryKey ? asText(r[batteryKey]) : ''
            });
          }
        }
      }
      const rowChanges = [];
      for (const [col, f] of Object.entries(mapped)) {
        const raw = r[col]; const ftype = f.Type;
        if (raw && typeof raw === 'object' && raw.err) { warnings.push({ row: rownum, serial: ser, msg: `'${col}' is an Excel error (${raw.err}) - skipped, fix the formula in the sheet` }); continue; }
        let nv;
        if (ftype === 'Date') {
          nv = asDateIso(raw);
          if (nv === null) { warnings.push({ row: rownum, serial: ser, msg: `'${col}' value '${asText(raw)}' is not a date - skipped` }); continue; }
        } else nv = asText(raw);
        if (nv === '') continue;   // blanks never clear Simpro
        if (isErr(nv)) { warnings.push({ row: rownum, serial: ser, msg: `'${col}' is an Excel error (${nv}) - skipped, fix the formula in the sheet` }); continue; }
        if (ftype === 'List') {
          const items = (f.ListItems || []).map(x => String(x).trim());
          if (items.length && !items.includes(nv)) { warnings.push({ row: rownum, serial: ser, msg: `'${col}' value '${nv}' is not in the Simpro list - rejected` }); continue; }
        }
        const ov = cur ? (cur.values[f.ID] === null || cur.values[f.ID] === undefined ? '' : String(cur.values[f.ID]).trim()) : '';
        if (nv !== ov) rowChanges.push({ col, cfid: f.ID, old: ov, nv });
      }
      if (!cur) creates.push({ rownum, site, ser, r, changes: rowChanges });
      else if (rowChanges.length) changes.push({ rownum, site, ser, id: cur.id, changes: rowChanges });
      else unchanged++;
    }
    const simproOnly = only ? [] : [...existing.keys()].filter(k => !seen.has(k)).map(k => ({ site: k.split('|')[0], ser: k.split('|')[1], id: existing.get(k).id }));
    return { changes, creates, warnings, unchanged, simproOnly, jobs };
  }
  return { MATCH_FIELD, SITE_COL, JOB_COL, XL_ERRORS, asText, asDateIso, isErr, toRecords, mapColumns, compare };
})();
export { SyncCore };

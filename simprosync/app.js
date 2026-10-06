/* ---------- Simpro Asset Sync - page logic ----------
   Started by main.js once an admin has signed in. Every Simpro call goes
   through main.js's transport(), which relays it via chs-equipment's Apps
   Script proxy - this file never sees a Simpro key. */
import { XLSXLite } from './reader.js';
import { SyncCore } from './core.js';

export function startApp({ transport, who }) {
  const DEFAULT_COMPANY = 3, DEFAULT_TYPE = 114;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } }
  };

  const WHO = who;
  let book = null, fileName = '', plan = null, logLines = [];
  let busy = false;
  let assetTypes = []; // [{ID, Name}] from Simpro, for the selected company
  let warrantySerials = new Set(); // serials with "Extended Warranty" = Yes, across ticked sheets
  let warrantyDefaultApplied = false; // so the on-by-default tick happens once per file, not every re-scan

  /* ---------- logging & progress ---------- */
  function log(msg) { logLines.push(msg); $('log').textContent = logLines.join('\n'); }
  function progress(text, done, total) {
    $('progress').hidden = false;
    $('progText').textContent = text;
    $('progBar').style.width = total ? Math.round(100 * done / total) + '%' : '100%';
    $('progBar').classList.toggle('indeterminate', !total);
  }
  function progressDone() { $('progress').hidden = true; }
  function setBusy(b) { busy = b; document.body.classList.toggle('busy', b); updateButtons(); }
  function showError(msg) { const el = $('error'); el.textContent = msg; el.hidden = !msg; }

  /* ---------- API ---------- */
  async function call(method, path, body) {
    for (let a = 0; a < 4; a++) {
      let r;
      try {
        r = await transport(method, path, body);
      } catch (e) {
        // Logged permanently - a call that's silently retrying with
        // multi-second backoff sleeps looks like "it's just slow" from the
        // UI alone, so this is the first thing worth checking on any future
        // slowdown report.
        console.warn('[simproSync] call() retry', a + 1, 'of 4 -', method, path, '-', e.message);
        if (a < 3) { await sleep(2000 * (a + 1)); continue; }
        return { status: 0, data: 'Network error: ' + e.message };
      }
      if ((r.status === 429 || r.status >= 500) && a < 3) {
        console.warn('[simproSync] call() retry', a + 1, 'of 4 -', method, path, '- status', r.status);
        await sleep(4000 * (a + 1)); continue;
      }
      return r;
    }
  }
  const brief = d => (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400);
  async function getAll(path) {
    let out = [], page = 1; const sep = path.includes('?') ? '&' : '?';
    for (;;) {
      const { status, data } = await call('GET', `${path}${sep}pageSize=250&page=${page}`);
      if (status !== 200) throw new Error(`Simpro request failed (${status}) for ${path}: ${brief(data)}`);
      out = out.concat(data);
      if (data.length < 250) return out;
      page++;
    }
  }
  async function pool(items, n, fn, onTick) {
    let i = 0, done = 0; const res = new Array(items.length);
    async function worker() { while (i < items.length) { const k = i++; res[k] = await fn(items[k], k); done++; onTick && onTick(done, items.length); } }
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
    return res;
  }

  /* ---------- setup lists ---------- */
  async function loadSetup() {
    try {
      const { status, data } = await call('GET', '/companies/');
      if (status === 401 || status === 403) throw new Error('Simpro rejected the request (' + status + '). Ask an admin to check the SIMPRO_API_KEY script property on the proxy.');
      if (status !== 200) throw new Error('Could not reach Simpro (' + status + '): ' + brief(data));
      const savedC = +(store.get('simproSync.company') || DEFAULT_COMPANY);
      $('company').innerHTML = data.filter(c => !/do not use/i.test(c.Name)).map(c => `<option value="${c.ID}" ${c.ID === savedC ? 'selected' : ''}>${esc(c.Name)}</option>`).join('');
      await loadTypes();
    } catch (e) { showError(e.message); }
  }
  async function loadTypes() {
    const cid = $('company').value;
    assetTypes = await getAll(`/companies/${cid}/setup/assetTypes/`);
    assetTypes.sort((a, b) => a.Name.localeCompare(b.Name));
    renderSheetRows(); // re-populate every sheet row's type options for the (possibly new) company
  }
  $('company').onchange = () => { store.set('simproSync.company', $('company').value); resetResults(); loadTypes().catch(e => showError(e.message)); };

  // the "IT" sheet goes in as "Mindray IT"; everything else defaults to "Mindray"
  function defaultTypeIdForSheet(sheetName) {
    const want = /^\s*IT\s*$/i.test(sheetName || '') ? 'mindray it' : 'mindray';
    const t = assetTypes.find(t => t.Name.trim().toLowerCase() === want);
    if (t) return t.ID;
    const fallback = assetTypes.find(t => t.ID === DEFAULT_TYPE);
    return fallback ? fallback.ID : (assetTypes[0] ? assetTypes[0].ID : '');
  }
  function assetTypeOptionsHtml(selectedId) {
    return assetTypes.map(t => `<option value="${t.ID}" ${String(t.ID) === String(selectedId) ? 'selected' : ''}>${esc(t.Name.trim())}</option>`).join('');
  }

  /* ---------- sheet picker ----------
     One row per sheet in the workbook, each independently toggleable and
     independently typed - lets one upload sync e.g. "Monitors" as Mindray
     and "IT" as Mindray IT in a single run, instead of two separate ones. */
  function renderSheetRows() {
    const el = $('sheetPicker');
    if (!el) return;
    if (!book) { el.innerHTML = ''; return; }
    // Preserve each row's current checked/type state across a re-render
    // (e.g. triggered by a company change) rather than resetting it.
    const prior = {};
    el.querySelectorAll('.sheetrow').forEach(row => {
      prior[row.dataset.idx] = { checked: row.querySelector('.sheet-chk').checked, tid: row.querySelector('.sheet-type').value };
    });
    el.innerHTML = book.sheets.map((name, i) => {
      const p = prior[i];
      const checked = p ? p.checked : true;
      const tid = (p && p.tid) || defaultTypeIdForSheet(name);
      return `<div class="row sheetrow" data-idx="${i}" style="gap:8px;align-items:center;flex-wrap:nowrap">
        <label style="display:flex;align-items:center;gap:6px;min-width:0;flex:2;font-size:14px;color:var(--ink);cursor:pointer">
          <input type="checkbox" class="sheet-chk" ${checked ? 'checked' : ''}>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
        </label>
        <select class="sheet-type" style="flex:1;min-width:140px">${assetTypeOptionsHtml(tid)}</select>
      </div>`;
    }).join('');
    el.querySelectorAll('.sheet-chk, .sheet-type').forEach(input => input.addEventListener('change', () => { resetResults(); updateButtons(); refreshWarrantyFilter(); }));
    updateButtons();
  }
  function getCheckedSheets() {
    if (!book) return [];
    return [...document.querySelectorAll('#sheetPicker .sheetrow')]
      .filter(row => row.querySelector('.sheet-chk').checked)
      .map(row => {
        const idx = +row.dataset.idx;
        const typeSel = row.querySelector('.sheet-type');
        return { idx, name: book.sheets[idx], tid: typeSel.value, typeName: typeSel.selectedOptions[0] ? typeSel.selectedOptions[0].textContent : '' };
      });
  }

  // Scans every ticked sheet for an "Extended Warranty" column and collects
  // the Serial Number of every row where it's "Yes" - lets "only sync
  // warranty items" be a single checkbox instead of hand-typing/pasting
  // every serial into the free-text filter next to it. Silent no-op (and
  // the checkbox stays hidden) if no ticked sheet has that column at all.
  async function refreshWarrantyFilter() {
    const row = $('warrantyFilterRow'), chk = $('onlyWarranty'), countEl = $('warrantyCount');
    warrantySerials = new Set();
    if (!book) { row.hidden = true; return; }
    let anyColumn = false;
    for (const sr of getCheckedSheets()) {
      // Ticked sheets aren't necessarily asset lists at all (e.g. a
      // "Reference"/"Networking" tab) - read defensively so one odd sheet
      // can't break the scan for the rest, or block the file loading at all.
      let header, recs;
      try { ({ header, recs } = SyncCore.toRecords(await book.rows(sr.idx))); }
      catch (e) { continue; }
      // header can contain holes (a header row with a skipped/blank cell is
      // a real gap in the array, not an empty string) - Array.find() visits
      // holes as undefined, unlike the map()/forEach() toRecords() itself
      // uses, so h must be guarded before calling .trim() on it.
      const warrantyKey = header.find(h => h && h.trim().toLowerCase() === 'extended warranty');
      if (!warrantyKey) continue;
      anyColumn = true;
      const serialKey = header.find(h => h && h.trim().toLowerCase() === SyncCore.MATCH_FIELD.toLowerCase());
      if (!serialKey) continue;
      recs.forEach(({ r }) => {
        if (SyncCore.asText(r[warrantyKey]).trim().toLowerCase() !== 'yes') return;
        const ser = SyncCore.asText(r[serialKey]).trim().toUpperCase();
        if (ser) warrantySerials.add(ser);
      });
    }
    row.hidden = !anyColumn;
    if (!anyColumn) { chk.checked = false; return; }
    // On by default: job notes are meant to record the warranty items, so
    // that shouldn't depend on remembering to tick a box. Only forced once
    // per file - a deliberate untick survives re-scans from (un)ticking
    // sheets, it just doesn't survive loading a different workbook.
    if (!warrantyDefaultApplied) { chk.checked = true; warrantyDefaultApplied = true; }
    countEl.textContent = `(${warrantySerials.size} item${warrantySerials.size === 1 ? '' : 's'} found)`;
  }

  /* ---------- file ---------- */
  async function takeFile(f) {
    if (!f) return;
    if (!/\.(xlsx|xlsm|csv)$/i.test(f.name)) { showError('Choose an .xlsx or .csv asset list.'); return; }
    showError(''); resetResults();
    try {
      book = await XLSXLite.read(f); fileName = f.name;
      warrantyDefaultApplied = false;
      renderSheetRows();
      $('fileName').textContent = f.name;
      $('fileInfo').hidden = false; $('drop').classList.add('has-file');
      await refreshWarrantyFilter();
    } catch (e) { book = null; showError('Could not read that file: ' + e.message + ' (if it is open in Excel with unsaved changes, save it first).'); }
    updateButtons();
  }
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => takeFile(e.dataTransfer.files[0]));
  $('file').onchange = e => { takeFile(e.target.files[0]); e.target.value = ''; };
  $('only').oninput = resetResults;
  $('onlyWarranty').onchange = resetResults;
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  function updateButtons() {
    $('runDry').disabled = busy || !book || !getCheckedSheets().length;
    $('apply').disabled = busy || !plan || plan.applied || actionCount(plan) === 0;
  }
  function resetResults() { plan = null; $('results').hidden = true; updateButtons(); }

  /* ---------- jobs ---------- */
  const CLOSED_STAGES = ['Complete', 'Invoiced', 'Archived'];
  const todayNZ = () => { const d = new Date(); return `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };
  const noteText = () => `EST and PVT completed - ${todayNZ()}`;
  const plainNotes = h => String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
  // Everything ending up attached when the job closes (new this run, plus
  // already-attached from an earlier run, possibly spanning more than one
  // sheet - see combinedJobs in the preview below) - one line per asset,
  // model omitted (just the serial) for a sheet with no "Model" column. One
  // <div> with <br> between items, not a <div> per item - matches the
  // single <div> the "EST and PVT completed" note already uses below, and
  // guarantees an actual line break per item regardless of how Simpro's
  // notes editor handles adjacent top-level block elements.
  //
  // When the Extended Warranty checkbox is on, every asset is still
  // attached to the job as normal (see $('runDry').onclick's comment) -
  // this only narrows which of them get WRITTEN into the job's Notes, to
  // just the ones with Extended Warranty = Yes.
  const assetListHtml = jp => {
    const onlyWarranty = $('onlyWarranty').checked && warrantySerials.size > 0;
    let all = jp.attach.concat(jp.already);
    if (onlyWarranty) all = all.filter(a => warrantySerials.has(String(a.ser || '').toUpperCase()));
    const items = all.map(a => esc(a.model ? `${a.model} — SN:${a.ser}` : `SN:${a.ser}`));
    return items.length ? `<div>${items.join('<br>')}</div>` : '';
  };
  const ccPath = (p, jp) => `/companies/${p.cid}/jobs/${jp.jobNo}/sections/${jp.cc.sec}/costCenters/${jp.cc.id}/assets/`;
  async function planJobs(p) {
    p.jobPlans = [];
    if (!p.jobs.size) return;
    const codes = await getAll(`/companies/${p.cid}/setup/statusCodes/projects/`).catch(() => []);
    p.completedStatus = codes.find(c => String(c.Name).trim().toLowerCase() === 'job : completed') || null;
    let i = 0;
    for (const [jobNo, items] of p.jobs) {
      progress(`Checking Simpro job ${jobNo}… (${++i} of ${p.jobs.size})`, i, p.jobs.size);
      const jp = { jobNo, items, problems: [], notes: [], attach: [], already: [] };
      p.jobPlans.push(jp);
      const { status, data } = await call('GET', `/companies/${p.cid}/jobs/${jobNo}`);
      if (status === 404) { jp.problems.push('Job not found in Simpro'); continue; }
      if (status !== 200) { jp.problems.push(`Could not read the job (${status}): ${brief(data)}`); continue; }
      jp.job = { name: data.Name || '', site: data.Site || {}, stage: data.Stage || '', status: (data.Status || {}).Name || '', customer: (data.Customer || {}).CompanyName || '', notes: data.Notes || '' };
      const wrong = items.filter(x => String(x.site) !== String(jp.job.site.ID));
      if (wrong.length) jp.problems.push(`Job is for site ${jp.job.site.ID} (${jp.job.site.Name}) but ${wrong.length} asset(s) are on site ${[...new Set(wrong.map(x => x.site))].join(', ')} - job left alone`);
      if (CLOSED_STAGES.includes(jp.job.stage)) jp.problems.push(`Job is already at stage "${jp.job.stage}" - left alone`);
      if (!p.completedStatus) jp.problems.push('Status "Job : Completed" was not found in Simpro');
      const ccs = [];
      for (const sec of await getAll(`/companies/${p.cid}/jobs/${jobNo}/sections/`))
        for (const c of await getAll(`/companies/${p.cid}/jobs/${jobNo}/sections/${sec.ID}/costCenters/`))
          ccs.push({ sec: sec.ID, id: c.ID, name: c.Name || (c.CostCenter || {}).Name || String(c.ID) });
      if (!ccs.length) { jp.problems.push('Job has no cost centre to attach assets to'); continue; }
      jp.cc = ccs[0];
      if (ccs.length > 1) jp.notes.push(`Job has ${ccs.length} cost centres - assets go on the first one (${ccs[0].name})`);
      const attached = new Set();
      for (const c of ccs) (await getAll(`/companies/${p.cid}/jobs/${jobNo}/sections/${c.sec}/costCenters/${c.id}/assets/`)).forEach(x => attached.add(String((x.Asset || {}).ID)));
      for (const it of items) {
        const ex = p.existing.get(`${it.site}|${it.ser}`);
        if (ex && attached.has(String(ex.id))) jp.already.push(Object.assign({}, it, { assetId: ex.id }));
        else jp.attach.push(Object.assign({}, it, { assetId: ex ? ex.id : null }));
      }
    }
  }
  const okJobs = p => (p.jobPlans || []).filter(j => !j.problems.length);
  const actionCount = p => p.creates.length + p.changes.length + okJobs(p).length;

  /* ---------- preview ----------
     Runs every ticked sheet in turn, each against its own asset type's
     Simpro fields and existing-asset lookup, then merges everything into
     one combined plan - one preview / one Apply for the whole workbook
     instead of one pass per sheet. A job number referenced from more than
     one sheet (e.g. the same shipment carries both Monitors and IT items)
     is merged into a single job plan too, so it only gets attached-to and
     closed once, with every sheet's items accounted for. */
  $('runDry').onclick = async () => {
    showError(''); resetResults(); logLines = []; setBusy(true);
    const cid = $('company').value;
    const sheets = getCheckedSheets();
    // "Only these serials" restricts the sync itself (unchanged, pre-existing
    // behaviour). The Extended Warranty checkbox does NOT - every asset in
    // the ticked sheets is still created/updated as normal; it only controls
    // which of a job's attached assets get listed in that job's Notes field
    // (see assetListHtml() below), since Jonathan wants all assets processed
    // but only warranty items recorded there.
    const only = $('only').value.trim() ? new Set($('only').value.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean)) : null;
    const stamp = new Date();
    if (!sheets.length) { showError('Tick at least one sheet to sync.'); progressDone(); setBusy(false); return; }
    try {
      log(`PREVIEW | ${fileName} | sheets: ${sheets.map(s => `${s.name} (${s.typeName})`).join(', ')} | ${stamp.toLocaleString('en-NZ')} | by ${WHO}` + (only ? ` | only: ${[...only].join(', ')}` : '') + ($('onlyWarranty').checked ? ' | job notes: Extended Warranty items only' : ''));

      const creates = [], changes = [], warnings = [], simproOnly = [], simproErrors = [], dupes = [], unmapped = [];
      let unchanged = 0;
      const combinedExisting = new Map(); // site|serial -> {id, values} - for job-attach lookups, across all sheets
      const combinedJobs = new Map();     // jobNo -> items[] - merged across sheets
      // Two sheets very often share a site (same customer's Monitors + IT
      // lists) or, less often, a type - without these, each sheet redid the
      // same "fetch every asset at this site" / "fetch this type's field
      // definitions" work from scratch, doubling (or worse) Simpro traffic
      // for no reason.
      const siteAssetsCache = new Map(); // site -> raw unfiltered assets[]
      const fieldDefsCache = new Map();  // tid -> {lowercaseName: fieldDef}

      for (const sr of sheets) {
        progress(`Reading sheet "${sr.name}"…`);
        const { header, recs } = SyncCore.toRecords(await book.rows(sr.idx));
        log(`\n--- "${sr.name}" (${sr.typeName}) --- rows with data: ${recs.length}`);
        if (!recs.length) { log('  (no data rows - skipped)'); continue; }

        let fdef = fieldDefsCache.get(sr.tid);
        if (!fdef) {
          progress(`Reading ${sr.typeName} fields from Simpro…`);
          const fields = await getAll(`/companies/${cid}/setup/assetTypes/${sr.tid}/customFields/`);
          // Concurrency here isn't about hammering Simpro - main.js's
          // transport packs up to 25 calls into ONE proxy round trip, so a
          // pool narrower than that just leaves most of each ~3s round trip
          // empty. Keep these at/above 25 so every batch travels full.
          const fdefList = await pool(fields, 50, async f => {
            const { status, data } = await call('GET', `/companies/${cid}/setup/assetTypes/${sr.tid}/customFields/${f.ID}`);
            return status === 200 ? data : f;
          });
          fdef = {}; fdefList.forEach(f => { fdef[f.Name.trim().toLowerCase()] = f; });
          fieldDefsCache.set(sr.tid, fdef);
        }
        const { mapped, unmapped: sheetUnmapped } = SyncCore.mapColumns(header, fdef);
        log(`  Columns mapped to Simpro fields: ${Object.keys(mapped).length}`);
        if (sheetUnmapped.length) { log(`  Columns with NO matching Simpro field (ignored): ${sheetUnmapped.join(', ')}`); unmapped.push(...sheetUnmapped.map(u => `${sr.name}: ${u}`)); }
        if (!mapped[SyncCore.MATCH_FIELD]) {
          log(`  SKIPPED this sheet: no "${SyncCore.MATCH_FIELD}" column matching a ${sr.typeName} field.`);
          warnings.push({ row: '', serial: '', sheet: sr.name, msg: `Sheet "${sr.name}" skipped entirely: no "${SyncCore.MATCH_FIELD}" column matching a ${sr.typeName} field in Simpro` });
          continue;
        }
        const serialCf = mapped[SyncCore.MATCH_FIELD].ID;

        const sites = [...new Set(recs.map(x => SyncCore.asText(x.r[SyncCore.SITE_COL])))];
        const sheetExisting = new Map();
        for (const site of sites) {
          if (!/^\d+$/.test(site)) { log(`  Skipping rows with bad Site ID "${site}"`); continue; }
          let siteAssets = siteAssetsCache.get(site);
          if (!siteAssets) {
            progress(`Finding assets on site ${site}…`);
            siteAssets = await getAll(`/companies/${cid}/sites/${site}/assets/`);
            siteAssetsCache.set(site, siteAssets);
          }
          const assets = siteAssets.filter(a => String((a.AssetType || {}).ID) === String(sr.tid) && !a.Archived);
          log(`  Site ${site}: ${assets.length} ${sr.typeName} assets in Simpro`);
          // One call per asset is unavoidable (the serial we match on is
          // itself a custom field, so there's no knowing which assets matter
          // until they're read) - but at 50 wide these pack into full
          // 25-request batches instead of quarter-full ones.
          const cfs = await pool(assets, 50, async a => {
            const { status, data } = await call('GET', `/companies/${cid}/sites/${site}/assets/${a.ID}/customFields/?pageSize=250`);
            if (status !== 200) { log(`    could not read asset ${a.ID}: ${status}`); return null; }
            return data;
          }, (d, t) => progress(`Reading asset details on site ${site}… ${d} of ${t}`, d, t));
          assets.forEach((a, i) => {
            if (!cfs[i]) return;
            const values = {}; cfs[i].forEach(c => { values[c.CustomField.ID] = c.Value; });
            const ser = String(values[serialCf] ?? '').trim().toUpperCase();
            for (const c of cfs[i]) if (c.Value !== null && SyncCore.isErr(c.Value)) simproErrors.push({ site, ser, id: a.ID, field: c.CustomField.Name, value: c.Value, sheet: sr.name });
            if (!ser) return;
            const k = `${site}|${ser}`;
            if (sheetExisting.has(k)) { dupes.push({ site, ser, a: sheetExisting.get(k).id, b: a.ID, sheet: sr.name }); return; }
            sheetExisting.set(k, { id: a.ID, values });
            if (combinedExisting.has(k)) dupes.push({ site, ser, a: combinedExisting.get(k).id, b: a.ID, sheet: sr.name + ' (also matched on another sheet)' });
            else combinedExisting.set(k, { id: a.ID, values });
          });
        }

        const res = SyncCore.compare(recs, mapped, sheetExisting, only);
        res.creates.forEach(c => Object.assign(c, { sheet: sr.name, cid, tid: sr.tid, typeName: sr.typeName }));
        res.changes.forEach(c => Object.assign(c, { sheet: sr.name, cid, tid: sr.tid, typeName: sr.typeName }));
        res.warnings.forEach(w => w.sheet = sr.name);
        res.simproOnly.forEach(s => Object.assign(s, { sheet: sr.name }));
        creates.push(...res.creates);
        changes.push(...res.changes);
        warnings.push(...res.warnings);
        simproOnly.push(...res.simproOnly);
        unchanged += res.unchanged;
        log(`  To create: ${res.creates.length}   To update: ${res.changes.length} (${res.changes.reduce((n, c) => n + c.changes.length, 0)} field changes)   Unchanged: ${res.unchanged}`);

        for (const [jobNo, items] of res.jobs) {
          const tagged = items.map(it => ({ ...it, sheet: sr.name }));
          if (!combinedJobs.has(jobNo)) combinedJobs.set(jobNo, []);
          combinedJobs.get(jobNo).push(...tagged);
        }
      }

      plan = { creates, changes, warnings, unchanged, simproOnly, dupes, simproErrors, unmapped, cid, stamp, fileName, applied: false, existing: combinedExisting, jobs: combinedJobs };
      await planJobs(plan);
      log(`\nTOTAL  To create: ${creates.length}   To update: ${changes.length} (${changes.reduce((n, c) => n + c.changes.length, 0)} field changes)   Unchanged: ${unchanged}`);
      log(`In Simpro but not in sheet (left alone): ${simproOnly.length}`);
      if (plan.jobPlans.length) {
        log(`Jobs: ${plan.jobPlans.length} (${okJobs(plan).length} will have assets attached and be completed)`);
        plan.jobPlans.forEach(j => log(`  Job ${j.jobNo}: attach ${j.attach.length}, already attached ${j.already.length}` + (j.problems.length ? ' - NOT CHANGED: ' + j.problems.join('; ') : ` - then note "${noteText()}", Stage Complete, Status "Job : Completed"`) + (j.notes.length ? ' (' + j.notes.join('; ') + ')' : '')));
      }
      log(`Warnings: ${warnings.length}`);
      warnings.forEach(w => log(`  ${w.sheet ? '[' + w.sheet + '] ' : ''}Row ${w.row} ${w.serial}: ${w.msg}`));
      if (simproErrors.length) { log(`Excel errors already stored in Simpro: ${simproErrors.length}`); simproErrors.forEach(e => log(`  ${e.ser || '(no serial)'} (asset ${e.id}) ${e.field} = ${e.value}`)); }
      log('\nPreview only - nothing was changed in Simpro.');
      renderResults();
    } catch (e) { showError(e.message); log('STOPPED: ' + e.message); }
    progressDone(); setBusy(false);
  };

  /* ---------- results ---------- */
  function tile(n, label, cls) { return `<div class="tile ${cls || ''}"><b>${n}</b><span>${label}</span></div>`; }
  function renderResults() {
    const p = plan;
    const fieldChanges = p.changes.reduce((n, c) => n + c.changes.length, 0);
    $('tiles').innerHTML =
      tile(p.creates.length, 'to create', p.creates.length ? 'accent' : '') +
      tile(p.changes.length, `to update<small>${fieldChanges} field change${fieldChanges === 1 ? '' : 's'}</small>`, p.changes.length ? 'accent' : '') +
      tile(p.unchanged, 'unchanged') +
      tile(p.warnings.length, 'warnings', p.warnings.length ? 'warn' : '') +
      tile(p.simproOnly.length, 'in Simpro only<small>left alone</small>') +
      (p.simproErrors.length ? tile(p.simproErrors.length, 'Excel errors<small>already in Simpro</small>', 'warn') : '') +
      (p.jobPlans.length ? tile(okJobs(p).length, `job${okJobs(p).length === 1 ? '' : 's'} to complete<small>${okJobs(p).reduce((n, j) => n + j.attach.length, 0)} assets to attach${p.jobPlans.length - okJobs(p).length ? ` · ${p.jobPlans.length - okJobs(p).length} with problems` : ''}</small>`, p.jobPlans.length - okJobs(p).length ? 'warn' : (okJobs(p).length ? 'accent' : '')) : '');
    const n = actionCount(p);
    $('apply').textContent = n ? `Apply ${n} change${n === 1 ? '' : 's'} to Simpro` : 'Nothing to apply';
    $('resultTitle').textContent = p.applied ? 'Result' : 'Preview - nothing has been changed yet';
    const tabs = [
      ['create', `Create (${p.creates.length})`], ['update', `Update (${p.changes.length})`], ['warn', `Warnings (${p.warnings.length})`],
      ['only', `In Simpro only (${p.simproOnly.length})`]
    ];
    if (p.jobPlans.length) tabs.splice(2, 0, ['jobs', `Jobs (${p.jobPlans.length})`]);
    if (p.simproErrors.length) tabs.push(['serr', `Errors in Simpro (${p.simproErrors.length})`]);
    if (p.unmapped.length || p.dupes.length) tabs.push(['other', 'Other notes']);
    const first = (tabs.find(t => /\((?!0\))/.test(t[1])) || tabs[0])[0];
    $('tabs').innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === first ? 'on' : ''}">${l}</button>`).join('');
    $('tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; [...$('tabs').children].forEach(x => x.classList.toggle('on', x === b)); renderTab(b.dataset.tab); };
    renderTab(first);
    $('results').hidden = false; updateButtons();
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function table(head, rows) {
    if (!rows.length) return '<p class="empty">Nothing here.</p>';
    return `<div class="tablewrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function renderTab(k) {
    const p = plan; let html = '';
    if (k === 'create') html = p.creates.map(c => `<details class="asset"><summary><b>${esc(c.ser)}</b> <span class="muted">row ${c.rownum} · ${esc(c.sheet)} · site ${esc(c.site)} · ${c.changes.length} fields</span>${c.newId ? ` <span class="pill ok">created ${c.newId}</span>` : ''}${c.error ? ` <span class="pill bad">error</span>` : ''}</summary>${table(['Field', 'Value'], c.changes.map(x => [esc(x.col), esc(x.nv)]))}</details>`).join('') || '<p class="empty">No new assets.</p>';
    if (k === 'update') html = table(['Sheet', 'Serial', 'Row', 'Asset', 'Field', 'Simpro now', 'Spreadsheet', ''], p.changes.flatMap(c => c.changes.map(x => [esc(c.sheet), esc(c.ser), c.rownum, c.id, esc(x.col), `<span class="old">${esc(x.old) || '<i>blank</i>'}</span>`, `<span class="new">${esc(x.nv)}</span>`, x.status === 'ok' ? '<span class="pill ok">done</span>' : x.status ? '<span class="pill bad">failed</span>' : ''])));
    if (k === 'jobs') html = '<p class="muted">After the assets are imported, each job below gets ALL its assets attached, then a line per ' + ($('onlyWarranty').checked ? '<b>Extended Warranty = Yes</b> ' : '') + 'asset (model and serial number) plus the note <b>' + esc(noteText()) + '</b> is added to the job Notes, its stage is set to <b>Complete</b> and status to <b>Job : Completed</b>. A job is only completed if every one of its assets attached successfully. A job referenced from more than one sheet is only attached-to and closed once, with items from every sheet it appeared in.</p>' +
      table(['Job', 'Name / site', 'Now', 'To attach', 'Already attached', 'Notes', ''], p.jobPlans.map(j => [
        `<b>#${esc(j.jobNo)}</b>`,
        j.job ? `${esc(j.job.name)}<br><span class="muted">${esc(j.job.site.Name || '')}</span>` : '',
        j.job ? `${esc(j.job.stage)}<br><span class="muted">${esc(j.job.status)}</span>` : '',
        j.attach.map(a => esc(a.ser) + ` <span class="muted">[${esc(a.sheet)}]</span>` + (a.assetId ? '' : ' <span class="muted">(new)</span>') + (a.status === 'ok' ? ' <span class="pill ok">attached</span>' : a.status ? ' <span class="pill bad">failed</span>' : '')).join('<br>') || '<span class="muted">none</span>',
        j.already.map(a => esc(a.ser) + ` <span class="muted">[${esc(a.sheet)}]</span>`).join('<br>') || '<span class="muted">none</span>',
        j.problems.map(x => `<span class="bad">${esc(x)}</span>`).concat(j.notes.map(esc)).join('<br>'),
        j.closed ? '<span class="pill ok">completed</span>' : (j.result ? '<span class="pill bad">left open</span>' : (j.problems.length ? '<span class="pill bad">skipped</span>' : ''))
      ]));
    if (k === 'warn') html = table(['Sheet', 'Row', 'Serial', 'Warning'], p.warnings.map(w => [esc(w.sheet || ''), w.row, esc(w.serial), esc(w.msg)]));
    if (k === 'only') html = '<p class="muted">These are in Simpro but not in the sheet. The sync never deletes or archives anything.</p>' + table(['Sheet', 'Serial', 'Site', 'Asset ID'], p.simproOnly.map(s => [esc(s.sheet || ''), esc(s.ser), esc(s.site), s.id]));
    if (k === 'serr') html = '<p class="muted">These values were saved into Simpro as Excel errors by an earlier import. Fix the formula in the sheet and run again to replace them.</p>' + table(['Sheet', 'Serial', 'Asset ID', 'Field', 'Value in Simpro'], p.simproErrors.map(e => [esc(e.sheet || ''), esc(e.ser), e.id, esc(e.field), esc(e.value)]));
    if (k === 'other') html = (p.unmapped.length ? `<p><b>Columns with no matching Simpro field (ignored):</b> ${esc(p.unmapped.join(', '))}</p>` : '') +
      (p.dupes.length ? '<p><b>Duplicate serials in Simpro</b> (the first asset is used):</p>' + table(['Sheet', 'Serial', 'Site', 'Asset', 'Duplicate'], p.dupes.map(d => [esc(d.sheet || ''), esc(d.ser), esc(d.site), d.a, d.b])) : '');
    $('tabBody').innerHTML = html;
  }

  /* ---------- apply ---------- */
  $('apply').onclick = async () => {
    const p = plan; const n = actionCount(p);
    const jl = okJobs(p);
    if (!confirm(`Apply ${n} change${n === 1 ? '' : 's'} to Simpro now?\n\n${p.creates.length} new asset(s), ${p.changes.length} updated asset(s)` + (jl.length ? `\n${jl.length} job(s) to attach assets to and complete: ${jl.map(j => '#' + j.jobNo).join(', ')}` : '') + '.')) return;
    setBusy(true); showError('');
    log(`\nAPPLY started ${new Date().toLocaleString('en-NZ')} by ${WHO}`);
    let added = 0, updated = 0, errors = 0, done = 0, closedJobs = 0; const total = n;
    const setField = async (site, aid, x) => {
      const { status, data } = await call('PATCH', `/companies/${p.cid}/sites/${site}/assets/${aid}/customFields/${x.cfid}`, { Value: x.nv });
      x.status = (status === 200 || status === 204) ? 'ok' : 'fail';
      if (x.status !== 'ok') { errors++; log(`  ERROR ${aid} ${x.col}: ${status} ${brief(data)}`); }
      return x.status === 'ok';
    };
    try {
      // Concurrency model, and why it is this specific shape:
      //
      // Calls are batched by main.js's transport (up to 25 per proxy round
      // trip), so work has to be issued concurrently or every call pays its
      // own ~1.5s round trip - that was the original "30-60s per asset".
      // BUT two PATCHes to the SAME asset must never be in flight together:
      // Simpro answers both 200 while silently losing one of the values. A
      // run that reported 164/164 fields "ok" came back on the next preview
      // with 37 of them still blank across 10 assets, and an asset whose
      // Serial Number write is the one lost reappears as "to create",
      // duplicating it.
      //
      // So: one in-flight call per asset (fields strictly sequential within
      // an asset), many assets at once. Batches stay full because they're
      // filled by DIFFERENT assets, which don't collide. Job attaches are
      // left parallel - they're separate assets going onto one cost centre
      // and verified fine (45 of 47 already attached on the re-check).
      await pool(p.changes, 25, async c => {
        let ok = true;
        for (const x of c.changes) ok = (await setField(c.site, c.id, x)) && ok;
        if (ok) updated++;
        progress(`Applying… ${++done} of ${total}`, done, total);
      }, () => {});
      await pool(p.creates, 25, async c => {
        const start = SyncCore.asDateIso(c.r['Date Installed']) || new Date().toISOString().slice(0, 10);
        const { status, data } = await call('POST', `/companies/${p.cid}/sites/${c.site}/assets/`, { AssetType: +c.tid, StartDate: start });
        if (!(status === 200 || status === 201) || !data || !data.ID) { errors++; c.error = true; log(`  ERROR creating ${c.ser} (row ${c.rownum}, ${c.sheet}): ${status} ${brief(data)}`); }
        else {
          c.newId = data.ID; added++;
          for (const x of c.changes) await setField(c.site, c.newId, x);
          log(`  created asset ${c.newId} for ${c.ser} (${c.sheet})`);
        }
        progress(`Applying… ${++done} of ${total}`, done, total);
      }, () => {});
      // ---- jobs: attach assets, then complete
      const okStatus = r => r.status === 200 || r.status === 201 || r.status === 204;
      for (const jp of jl) {
        jp.result = { attached: 0, failed: 0 };
        await Promise.all(jp.attach.map(async it => {
          let aid = it.assetId;
          if (!aid) { const cr = p.creates.find(c => c.site === it.site && c.ser === it.ser); aid = cr && cr.newId; }
          if (!aid) { it.status = 'fail'; jp.result.failed++; log(`  ERROR job ${jp.jobNo}: ${it.ser} has no Simpro asset (it was not created)`); return; }
          let r = await call('POST', ccPath(p, jp), { Asset: +aid });
          if (!okStatus(r) && r.status >= 400 && r.status < 500) { const r2 = await call('POST', ccPath(p, jp), { Asset: { ID: +aid } }); if (okStatus(r2)) r = r2; }
          if (okStatus(r)) { it.status = 'ok'; jp.result.attached++; }
          else { it.status = 'fail'; jp.result.failed++; log(`  ERROR job ${jp.jobNo}: attaching ${it.ser} (asset ${aid}) failed: ${r.status} ${brief(r.data)}`); }
        }));
        if (jp.result.failed) { errors++; log(`  Job ${jp.jobNo} LEFT OPEN - ${jp.result.failed} asset(s) could not be attached`); progress(`Applying… ${++done} of ${total}`, done, total); continue; }
        const note = noteText();
        if (!plainNotes(jp.job.notes).includes(note)) {
          const newNotes = (jp.job.notes ? jp.job.notes + '\n' : '') + assetListHtml(jp) + `<div>${note}</div>`;
          const rn = await call('PATCH', `/companies/${p.cid}/jobs/${jp.jobNo}`, { Notes: newNotes });
          if (!okStatus(rn)) { errors++; jp.closeError = `notes: ${rn.status} ${brief(rn.data)}`; log(`  ERROR job ${jp.jobNo}: could not add the note - job LEFT OPEN: ${rn.status} ${brief(rn.data)}`); progress(`Applying… ${++done} of ${total}`, done, total); continue; }
          jp.noteAdded = note;
        }
        let r = await call('PATCH', `/companies/${p.cid}/jobs/${jp.jobNo}`, { Stage: 'Complete' });
        if (!okStatus(r)) { errors++; jp.closeError = `stage: ${r.status} ${brief(r.data)}`; log(`  ERROR job ${jp.jobNo}: could not set stage Complete: ${r.status} ${brief(r.data)}`); }
        else {
          r = await call('PATCH', `/companies/${p.cid}/jobs/${jp.jobNo}`, { Status: +p.completedStatus.ID });
          if (!okStatus(r) && r.status >= 400 && r.status < 500) { const r2 = await call('PATCH', `/companies/${p.cid}/jobs/${jp.jobNo}`, { Status: { ID: +p.completedStatus.ID } }); if (okStatus(r2)) r = r2; }
          if (!okStatus(r)) { errors++; jp.closeError = `status: ${r.status} ${brief(r.data)}`; log(`  ERROR job ${jp.jobNo}: stage is Complete but status could not be set: ${r.status} ${brief(r.data)}`); }
          else { jp.closed = true; closedJobs++; log(`  Job ${jp.jobNo}: attached ${jp.result.attached} asset(s), note "${note}", stage Complete, status "Job : Completed"`); }
        }
        progress(`Applying… ${++done} of ${total}`, done, total);
      }
    } catch (e) { showError('Stopped part-way: ' + e.message + ' - run the preview again to see what is left.'); }
    log(`\nDONE  Added: ${added}   Updated: ${updated}   Jobs completed: ${closedJobs}   Errors: ${errors}`);
    p.applied = true; p.result = { added, updated, errors, closedJobs };
    progressDone(); setBusy(false);
    renderResults();
    $('tiles').insertAdjacentHTML('afterbegin', `<div class="banner ${errors ? 'bad' : 'ok'}">${errors ? '⚠' : '✓'} Applied: ${added} added, ${updated} updated${jl.length ? `, ${closedJobs} of ${jl.length} job${jl.length === 1 ? '' : 's'} completed` : ''}, ${errors} error${errors === 1 ? '' : 's'}. Run the preview again to confirm everything matches.</div>`);
    downloadReport(true);
  };

  /* ---------- report download ---------- */
  function csvCell(v) { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function downloadReport(auto) {
    if (!plan) return;
    const p = plan, rows = [['Action', 'Sheet', 'Row', 'Site', 'Serial', 'Asset ID', 'Field', 'Simpro before', 'Spreadsheet', 'Result']];
    p.changes.forEach(c => c.changes.forEach(x => rows.push(['UPDATE', c.sheet, c.rownum, c.site, c.ser, c.id, x.col, x.old, x.nv, x.status || ''])));
    p.creates.forEach(c => c.changes.forEach(x => rows.push(['CREATE', c.sheet, c.rownum, c.site, c.ser, c.newId || '', x.col, '', x.nv, x.status || (c.error ? 'fail' : '')])));
    p.warnings.forEach(w => rows.push(['WARNING', w.sheet || '', w.row, '', w.serial, '', '', '', w.msg, '']));
    p.simproOnly.forEach(s => rows.push(['IN SIMPRO ONLY', s.sheet || '', '', s.site, s.ser, s.id, '', '', '', '']));
    (p.jobPlans || []).forEach(j => {
      j.attach.forEach(a => rows.push(['JOB ATTACH', a.sheet || '', a.rownum, a.site, a.ser, a.assetId || '', 'Job ' + j.jobNo, '', '', a.status || (j.problems.length ? 'skipped' : '')]));
      j.already.forEach(a => rows.push(['JOB ALREADY ATTACHED', a.sheet || '', a.rownum, a.site, a.ser, a.assetId, 'Job ' + j.jobNo, '', '', '']));
      rows.push(['JOB COMPLETE', '', '', j.job ? j.job.site.ID : '', '', '', 'Job ' + j.jobNo, j.job ? `${j.job.stage} / ${j.job.status}` : '', `Complete / Job : Completed / note: ${noteText()}`, j.closed ? 'ok' : (j.problems.length ? 'skipped: ' + j.problems.join('; ') : (j.result ? 'left open ' + (j.closeError || '') : ''))]);
    });
    p.simproErrors.forEach(e => rows.push(['ERROR IN SIMPRO', e.sheet || '', '', e.site, e.ser, e.id, e.field, e.value, '', '']));
    const csv = '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n\r\n' + logLines.map(l => csvCell(l)).join('\r\n');
    const ts = p.stamp.toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `Simpro sync ${p.applied ? 'APPLIED' : 'PREVIEW'} ${p.fileName.replace(/\.[^.]+$/, '')} ${ts}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }
  $('download').onclick = () => downloadReport(false);

  updateButtons();
  loadSetup();
}

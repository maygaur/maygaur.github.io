/* Home Buying Planner - UI */
(function () {
  'use strict';
  var E = window.HBPEngine, S = window.HBPSchema, C = window.HBPCharts;
  var STORE_KEY = 'homeBuyingPlanner.v1';
  var APP_TAG = 'home-buying-planner';
  var MAX_COMPARE = 3;

  // =====================================================================
  // Storage
  // =====================================================================
  var db, storageOk = true, sync = null, syncState = { state: 'off', detail: null };
  function emptyDb() { return { version: 1, activePlannerId: null, planners: [], lastBackupAt: null, theme: 'auto' }; }
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      db = raw ? JSON.parse(raw) : emptyDb();
      if (!db || !Array.isArray(db.planners)) db = emptyDb();
    } catch (e) { storageOk = false; db = emptyDb(); }
    db.planners.forEach(upgradePlanner);
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); storageOk = true; }
    catch (e) { storageOk = false; toast('Could not save in this browser (storage blocked or full). Export a backup file.'); }
    if (sync) sync.schedulePush();
    renderBanner();
  }
  /** Fill fields added in later versions so older files keep working. */
  function upgradePlanner(p) {
    var blank = E.blankBase(p.base && p.base.settings && p.base.settings.startMonth);
    p.base = deepFill(p.base || {}, blank);
    p.scenarios = p.scenarios || [];
    p.ui = p.ui || { compareIds: [] };
    p.currency = p.currency || 'INR';
    return p;
  }
  function deepFill(target, defaults) {
    Object.keys(defaults).forEach(function (k) {
      if (!(k in target)) target[k] = E.clone(defaults[k]);
      else if (defaults[k] && typeof defaults[k] === 'object' && !Array.isArray(defaults[k]) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) deepFill(target[k], defaults[k]);
    });
    return target;
  }
  function planner() { return db.planners.find(function (p) { return p.id === db.activePlannerId; }) || null; }
  function touch(p) { p.updatedAt = new Date().toISOString(); }

  // =====================================================================
  // Formatting & parsing
  // =====================================================================
  var CURRENCIES = [['INR', 'Indian rupee (₹, lakh / crore)'], ['USD', 'US dollar ($)'], ['EUR', 'Euro (€)'], ['GBP', 'British pound (£)'], ['AED', 'UAE dirham'], ['SGD', 'Singapore dollar'], ['AUD', 'Australian dollar'], ['CAD', 'Canadian dollar']];
  var fmtCache = {};
  function fmtFor(cur) {
    cur = cur || 'INR';
    if (fmtCache[cur]) return fmtCache[cur];
    var locale = cur === 'INR' ? 'en-IN' : undefined;
    var full = new Intl.NumberFormat(locale, { style: 'currency', currency: cur, maximumFractionDigits: 0 });
    var plain = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    var sym = (full.formatToParts(0).find(function (x) { return x.type === 'currency'; }) || {}).value || cur;
    var compact = new Intl.NumberFormat(locale, { style: 'currency', currency: cur, notation: 'compact', maximumFractionDigits: 2 });
    var f = {
      sym: sym, cur: cur,
      full: function (v) { return v == null || !isFinite(v) ? '–' : full.format(Math.round(v)); },
      plain: function (v) { return v == null || v === '' || !isFinite(v) ? '' : plain.format(v); },
      short: function (v) {
        if (v == null || !isFinite(v)) return '–';
        if (cur !== 'INR') return Math.abs(v) < 10000 ? full.format(Math.round(v)) : compact.format(v);
        var a = Math.abs(v), s = v < 0 ? '-' : '';
        if (a >= 1e7) return s + sym + trim(a / 1e7) + ' Cr';
        if (a >= 1e5) return s + sym + trim(a / 1e5) + ' L';
        return s + sym + plain.format(Math.round(a));
      }
    };
    function trim(x) { return (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2)).replace(/\.?0+$/, ''); }
    fmtCache[cur] = f;
    return f;
  }
  function fmt() { var p = planner(); return fmtFor(p ? p.currency : 'INR'); }
  /** Accepts 1,50,000 | 150000 | 1.5L | 1.2 cr | 45k | 2m */
  function parseAmount(str) {
    if (str == null) return null;
    var s = String(str).trim().toLowerCase().replace(/[,\s₹$€£]/g, '').replace(/^(rs\.?|inr)/, '');
    if (s === '') return null;
    var m = /^(-?\d*\.?\d+)(k|thousand|l|lac|lacs|lakh|lakhs|cr|crs|crore|crores|m|mn|million|b|bn)?$/.exec(s);
    if (!m) return NaN;
    var n = parseFloat(m[1]), u = m[2] || '';
    var mult = { k: 1e3, thousand: 1e3, l: 1e5, lac: 1e5, lacs: 1e5, lakh: 1e5, lakhs: 1e5, cr: 1e7, crs: 1e7, crore: 1e7, crores: 1e7, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9 }[u] || 1;
    return Math.round(n * mult);
  }
  function parseNum(str) {
    if (str == null || String(str).trim() === '') return null;
    var n = parseFloat(String(str).replace(/,/g, ''));
    return isFinite(n) ? n : NaN;
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monthName(ym) { if (!ym) return '–'; return MONTHS[+ym.slice(5) - 1] + ' ' + ym.slice(0, 4); }
  function pct(v) { return (Math.round(v * 100) / 100) + '%'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dateStr(iso) { if (!iso) return '–'; var d = new Date(iso); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  // =====================================================================
  // Running scenarios
  // =====================================================================
  var runCache = new Map();
  function run(base, overrides) {
    var raw = E.resolveInputs(base, overrides);
    var key = JSON.stringify(raw);
    if (runCache.has(key)) return runCache.get(key);
    var sug = E.applySuggestions(raw);
    var res = E.simulate(raw);
    var cf = res.buying ? E.simulate(raw, { counterfactual: true }) : res;
    var out = { raw: raw, inputs: sug.inputs, suggested: sug.suggested, res: res, cf: cf, opp: res.buying ? E.opportunity(res, cf) : null, missing: E.missingRequired(raw) };
    if (runCache.size > 200) runCache.clear();
    runCache.set(key, out);
    return out;
  }
  function tierOf(r) {
    var s = r.res.summary, em = +r.inputs.settings.emergencyMonths || 0;
    if (s.shortfallMonths > 0) return { cls: 'bad', label: 'Runs short' };
    if (s.minCover < em) return { cls: 'warn', label: 'Tight' };
    return { cls: 'good', label: 'Comfortable' };
  }

  // =====================================================================
  // UI state
  // =====================================================================
  var ui = { tab: 'scenarios', editor: null, chartTab: 'cashflow', tableMode: 'yearly', pane: 'inputs', open: {}, cmpChart: 'surplus', cmpTableKey: 'avgSurplus', bannerHidden: false, smooth: false };
  var TEMPLATES = [
    { id: 'savings', title: 'Buy using savings & investments', desc: 'Keep Home 1 and its rent. Down payment comes from cash and investments.', ov: { 'purchase.enabled': true, 'purchase.sellHome1': false } },
    { id: 'sell1', title: 'Buy by selling Home 1', desc: 'Sell Home 1 in the purchase month and use the proceeds; any extra is invested.', ov: { 'purchase.enabled': true, 'purchase.sellHome1': true }, when: function (b) { return b.home1.owned; } },
    { id: 'rent', title: 'Keep renting (don\'t buy)', desc: 'The baseline to compare against.', ov: { 'purchase.enabled': false } },
    { id: 'moveIn', title: 'Don\'t buy, move into Home 2 at possession', desc: 'Rent stops when Home 2 is handed over.', ov: { 'purchase.enabled': false, 'home2.afterPossession': 'moveIn' }, when: function (b) { return b.home2.owned; } },
    { id: 'blank', title: 'Start from my profile as it is', desc: 'No changes; tweak anything you like.', ov: {} }
  ];

  // =====================================================================
  // Generic UI helpers
  // =====================================================================
  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };
  var toastTimer;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  /** Promise-based modal. buttons: [{label, value, kind}] */
  function modal(opts) {
    return new Promise(function (resolve) {
      var root = $('#modalRoot');
      var back = document.createElement('div'); back.className = 'modal-back';
      back.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle"><h2 id="mTitle">' + esc(opts.title) + '</h2><div class="m-body"></div><div class="btn-row"></div></div>';
      var body = $('.m-body', back);
      if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
      var row = $('.btn-row', back);
      function close(v) { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); }
      (opts.buttons || [{ label: 'OK', value: true, kind: 'primary' }]).forEach(function (b) {
        var btn = document.createElement('button'); btn.className = 'btn ' + (b.kind || ''); btn.textContent = b.label;
        btn.addEventListener('click', function () { close(typeof b.value === 'function' ? b.value(back) : b.value); });
        row.appendChild(btn);
      });
      back.addEventListener('click', function (e) { if (e.target === back) close(null); });
      function onKey(e) {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && opts.enterValue && e.target.tagName === 'INPUT') { e.preventDefault(); close(opts.enterValue(back)); }
      }
      document.addEventListener('keydown', onKey);
      if (opts.onOpen) opts.onOpen(back, close);
      root.appendChild(back);
      var first = $('input,select', back) || $('.btn.primary', back);
      if (first) setTimeout(function () { first.focus(); if (first.select) first.select(); }, 30);
    });
  }
  function confirmBox(title, text, okLabel, danger) {
    return modal({ title: title, body: '<p>' + text + '</p>', buttons: [{ label: 'Cancel', value: false }, { label: okLabel || 'OK', value: true, kind: danger ? 'primary danger-bg' : 'primary' }] });
  }
  function promptBox(title, label, value, okLabel) {
    var get = function (b) { var v = $('input', b).value.trim(); return v || null; };
    return modal({
      title: title,
      body: '<label for="mInput">' + esc(label) + '</label><input type="text" id="mInput" value="' + esc(value || '') + '" maxlength="120">',
      buttons: [{ label: 'Cancel', value: null }, { label: okLabel || 'Save', value: get, kind: 'primary' }],
      enterValue: get
    });
  }
  function download(filename, text, type) {
    var blob = new Blob([text], { type: type || 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function slug(s) { return String(s || 'planner').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'planner'; }
  function today() { return new Date().toISOString().slice(0, 10); }

  var ICONS = {
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M16 13h2M3 10h18"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l3 12h11l2-8H6"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
    home: '<path d="M3 11 12 4l9 7v9h-6v-6H9v6H3z"/>',
    crane: '<path d="M4 21V5h14M4 5l4-3M18 5v6M16 11h4v4h-4zM2 21h10"/>',
    piggy: '<path d="M4 12c0-4 4-6 8-6s8 2 8 6c0 2-1 3-2 4v3h-3v-2H9v2H6v-3c-1-1-2-2-2-4z"/><circle cx="15" cy="10" r="1"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
    coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7M9 15v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.5-2-2.7-5-3"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24">' + (ICONS[name] || '') + '</svg>'; }

  // =====================================================================
  // Navigation / chrome
  // =====================================================================
  function setTab(tab) {
    ui.tab = tab;
    try { sessionStorage.setItem('hbp.tab', tab); } catch (e) { /* ignore */ }
    render();
    window.scrollTo(0, 0);
  }
  function renderChrome() {
    var sel = $('#plannerSelect');
    var p = planner();
    sel.innerHTML = db.planners.map(function (x) { return '<option value="' + esc(x.id) + '"' + (p && x.id === p.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') +
      '<option value="__new">+ New planner…</option>';
    $('.planner-switch').hidden = !db.planners.length;
    $$('#tabs button').forEach(function (b) {
      b.setAttribute('aria-current', b.dataset.tab === ui.tab ? 'page' : 'false');
      b.disabled = !p && b.dataset.tab !== 'data';
    });
    renderBanner();
  }
  function renderBanner() {
    var b = $('#backupBanner');
    if (!b) return;
    var needs = !ui.bannerHidden && !(sync && sync.configured()) && db.planners.some(function (p) { return p.scenarios.length && (!db.lastBackupAt || p.updatedAt > db.lastBackupAt); });
    if (!storageOk) {
      b.hidden = false;
      b.innerHTML = '<span><b>This browser is not saving your work.</b> Download a backup file before closing the page.</span><button class="btn" data-act="backup">Download backup</button>';
      return;
    }
    b.hidden = !needs;
    if (needs) b.innerHTML = '<span>Your planners live only in this browser. Download a backup file so you can load them again later or on another device.</span><span class="btn-row"><button class="btn primary" data-act="backup">Download backup</button><button class="btn ghost" data-act="hide-banner">Later</button></span>';
  }

  function fillTipHints() {
    var touch = window.matchMedia && (window.matchMedia('(hover: none)').matches || window.matchMedia('(pointer: coarse)').matches);
    $$('[data-tiphint]').forEach(function (p) { p.textContent = (touch ? 'Tap' : 'Hover over or click') + ' any number or heading to see how it is calculated.'; });
  }
  function render() {
    if (T) T.hide();
    renderChrome();
    var p = planner();
    $$('.view').forEach(function (v) { v.hidden = true; });
    if (!p && ui.tab !== 'data') { var w = $('#view-welcome'); w.hidden = false; renderWelcome(w); return; }
    var view = $('#view-' + ui.tab); view.hidden = false;
    ({ scenarios: renderScenarios, profile: renderProfile, editor: renderEditor, compare: renderCompare, data: renderData })[ui.tab](view);
    fillTipHints();
  }

  // =====================================================================
  // Welcome / planners
  // =====================================================================
  function renderWelcome(el) {
    el.innerHTML =
      '<div class="welcome card">' +
      '<h1>Plan your next home</h1>' +
      '<p class="muted">Build funding scenarios for buying a home, project your monthly cash flow, savings and net worth for years ahead, and compare up to three options side by side.</p>' +
      '<ol><li>Fill in your profile: income, expenses, rent, the homes you own, savings.</li><li>Create scenarios for how to fund the purchase.</li><li>Tweak, save and compare. Everything stays in this browser until you export it.</li></ol>' +
      '<div class="two-col" style="margin-top:14px">' +
      '<div class="field"><label for="wName">Planner name</label><div class="inp-wrap"><input id="wName" type="text" value="Buying the rented flat"></div></div>' +
      '<div class="field"><label for="wCur">Currency</label><div class="inp-wrap"><select id="wCur">' + CURRENCIES.map(function (c) { return '<option value="' + c[0] + '">' + esc(c[1]) + '</option>'; }).join('') + '</select></div></div>' +
      '</div>' +
      '<div class="btn-row"><button class="btn primary" id="wCreate">Create planner</button><button class="btn" data-act="import">Load from a backup file</button></div>' +
      '</div>';
    $('#wCreate', el).addEventListener('click', function () {
      createPlanner($('#wName', el).value.trim() || 'My home plan', $('#wCur', el).value);
      setTab('profile');
    });
  }
  function createPlanner(name, currency) {
    var now = new Date().toISOString();
    var p = { id: E.uid('pln'), name: name, currency: currency || 'INR', createdAt: now, updatedAt: now, base: E.blankBase(), scenarios: [], ui: { compareIds: [] } };
    db.planners.push(p); db.activePlannerId = p.id; ui.editor = null; save();
    return p;
  }
  async function newPlannerFlow() {
    var body = document.createElement('div');
    body.innerHTML = '<label for="npName">Name</label><input type="text" id="npName" value="New home plan">' +
      '<label for="npCur">Currency</label><select id="npCur">' + CURRENCIES.map(function (c) { return '<option value="' + c[0] + '">' + esc(c[1]) + '</option>'; }).join('') + '</select>' +
      (planner() ? '<label class="switch" style="margin-top:12px"><input type="checkbox" id="npCopy"> Copy the profile from "' + esc(planner().name) + '"</label>' : '');
    var get = function (b) { return { name: $('#npName', b).value.trim() || 'New home plan', cur: $('#npCur', b).value, copy: $('#npCopy', b) && $('#npCopy', b).checked }; };
    var r = await modal({ title: 'New planner', body: body, buttons: [{ label: 'Cancel', value: null }, { label: 'Create', value: get, kind: 'primary' }], enterValue: get });
    if (!r) return;
    if (!(await guardDirty())) return;
    var src = planner();
    var p = createPlanner(r.name, r.cur);
    if (r.copy && src) { p.base = E.clone(src.base); save(); }
    setTab('profile');
  }
  async function switchPlanner(id) {
    if (id === db.activePlannerId) return;
    if (!(await guardDirty())) { renderChrome(); return; }
    db.activePlannerId = id; ui.editor = null; save();
    setTab(ui.tab === 'editor' ? 'scenarios' : ui.tab);
  }
  async function guardDirty() {
    if (!ui.editor || !ui.editor.dirty) return true;
    var r = await modal({ title: 'Unsaved changes', body: '<p>You have unsaved changes in <b>' + esc(editorName()) + '</b>.</p>', buttons: [{ label: 'Keep editing', value: 'stay' }, { label: 'Discard', value: 'discard' }, { label: 'Save', value: 'save', kind: 'primary' }] });
    if (r === 'save') { saveEditor(false); return true; }
    if (r === 'discard') { ui.editor = null; return true; }
    return false;
  }

  // =====================================================================
  // Scenarios list
  // =====================================================================
  function renderScenarios(el) {
    var p = planner(), f = fmt();
    var missing = E.missingRequired(p.base);
    var html = '<div class="view-head"><div class="grow"><h1>Scenarios</h1><p>' + esc(p.name) + ' · ' + p.scenarios.length + ' saved</p></div>' +
      '<div class="btn-row"><button class="btn" data-act="go-compare"' + (p.ui.compareIds.length < 2 ? ' disabled' : '') + '>Compare selected (' + p.ui.compareIds.length + '/' + MAX_COMPARE + ')</button>' +
      '<button class="btn primary" data-act="new-scenario">' + icon('plus').replace('<svg', '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"') + 'New scenario</button></div></div>';
    if (missing.length) {
      html += '<div class="notice warn"><span class="ico">!</span><div>Your profile is missing: ' + missing.map(function (m) { return esc(m.label); }).join(', ') + '. <a href="#" data-act="tab" data-tab="profile">Complete your profile</a> for meaningful numbers.</div></div>';
    }
    if (!p.scenarios.length) {
      html += '<div class="card"><h2>No scenarios yet</h2><p class="muted">Start with the three most common options, or build one from a template.</p>' +
        '<div class="btn-row"><button class="btn primary" data-act="starter">Create starter scenarios</button><button class="btn" data-act="new-scenario">Pick a template</button></div></div>';
      el.innerHTML = html; return;
    }
    html += '<p class="tip-hint" data-tiphint></p><div class="grid-cards">';
    T.reset('cards');
    p.scenarios.forEach(function (s) {
      var r = run(p.base, s.overrides), sm = r.res.summary, t = tierOf(r);
      var checked = p.ui.compareIds.indexOf(s.id) >= 0;
      var nwDelta = r.opp ? r.opp.netWorthDiff : null;
      html += '<article class="card scn-card">' +
        '<div class="top"><h3>' + esc(scnName(p, s)) + '</h3><span class="pill ' + t.cls + '">' + t.label + '</span></div>' +
        '<div class="meta">Saved ' + dateStr(s.updatedAt) + (Object.keys(s.overrides).length ? ' · ' + Object.keys(s.overrides).length + ' change(s) from profile' : '') + '</div>' +
        '<div class="kv">' +
        kv(r.res.buying ? 'New flat EMI' : 'New flat', r.res.buying ? f.short(sm.emi3) : 'Not buying', r.res.buying ? 'emi3' : null, r) +
        kv('Left / month, year 1', f.short(sm.avgSurplusFirstYear), 'avgSurplusFirstYear', r) +
        kv('Lowest savings', f.short(sm.minLiquid), 'minLiquid', r) +
        kv('Net worth in ' + r.inputs.settings.horizonYears + ' yrs', f.short(sm.endNetWorth), 'endNetWorth', r) +
        (nwDelta != null ? kv('vs keep renting', (nwDelta >= 0 ? '+' : '') + f.short(nwDelta), 'netWorthVsRent', r) : '') +
        kv('Tightest month', f.short(sm.minSurplus), 'minSurplus', r) +
        '</div>' +
        '<div class="actions">' +
        '<button class="btn primary sm" data-act="open" data-id="' + s.id + '">Open</button>' +
        '<button class="btn sm" data-act="dup" data-id="' + s.id + '">Duplicate</button>' +
        '<button class="btn sm" data-act="rename" data-id="' + s.id + '">Rename</button>' +
        '<button class="btn sm danger" data-act="del" data-id="' + s.id + '">Delete</button>' +
        '<label class="compare-check" style="margin-left:auto"><input type="checkbox" data-act="cmp-toggle" data-id="' + s.id + '"' + (checked ? ' checked' : '') + '> Compare</label>' +
        '</div></article>';
    });
    html += '</div>';
    el.innerHTML = html;
  }
  /** Auto-named scenarios follow their current settings (e.g. after the profile price changes). */
  function scnName(p, s) { return s.nameAuto ? E.autoName(run(p.base, s.overrides).inputs) : s.name; }
  function kv(k, v, tipKey, r) {
    var a = tipKey ? T.attr('cards', function () { return explainMetric(tipKey, r); }) : '';
    return '<div class="' + (tipKey ? 'has-tip' : '') + '"' + a + '><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>';
  }

  async function newScenarioFlow() {
    var p = planner();
    var body = document.createElement('div');
    body.className = 'tpl-list';
    TEMPLATES.filter(function (t) { return !t.when || t.when(p.base); }).forEach(function (t) {
      var b = document.createElement('button'); b.className = 'tpl'; b.dataset.tpl = t.id;
      b.innerHTML = '<b>' + esc(t.title) + '</b><span>' + esc(t.desc) + '</span>';
      body.appendChild(b);
    });
    var choice = await modal({
      title: 'New scenario', body: body, buttons: [{ label: 'Cancel', value: null }],
      onOpen: function (back, close) { $$('.tpl', back).forEach(function (b) { b.addEventListener('click', function () { close(b.dataset.tpl); }); }); }
    });
    if (!choice) return;
    if (!(await guardDirty())) return;
    var t = TEMPLATES.find(function (x) { return x.id === choice; });
    openEditor(null, cleanOverrides(p.base, E.clone(t.ov)));
  }
  function cleanOverrides(base, ov) {
    Object.keys(ov).forEach(function (k) { if (eq(E.getPath(base, k), ov[k])) delete ov[k]; });
    return ov;
  }
  function createStarters() {
    var p = planner();
    TEMPLATES.filter(function (t) { return ['savings', 'sell1', 'rent'].indexOf(t.id) >= 0 && (!t.when || t.when(p.base)); }).forEach(function (t) {
      var ov = cleanOverrides(p.base, E.clone(t.ov));
      var r = run(p.base, ov);
      addScenario(p, E.autoName(r.inputs), true, ov);
    });
    p.ui.compareIds = p.scenarios.slice(0, MAX_COMPARE).map(function (s) { return s.id; });
    touch(p); save();
    toast('Created ' + p.scenarios.length + ' starter scenarios');
  }
  function addScenario(p, name, nameAuto, overrides) {
    var now = new Date().toISOString();
    var s = { id: E.uid('scn'), name: name, nameAuto: nameAuto, overrides: overrides, createdAt: now, updatedAt: now };
    p.scenarios.push(s);
    return s;
  }
  function uniqueName(p, name, exceptId) {
    var n = name, i = 2;
    while (p.scenarios.some(function (s) { return s.name === n && s.id !== exceptId; })) n = name + ' (' + (i++) + ')';
    return n;
  }

  // =====================================================================
  // Form rendering (shared by Profile and Editor)
  // =====================================================================
  /**
   * ctx: { mode: 'base'|'scenario', base, overrides (scenario), onChange() }
   */
  function makeCtx(mode, onChange) {
    var p = planner();
    var ctx = {
      mode: mode,
      raw: function () { return mode === 'base' ? p.base : E.resolveInputs(p.base, ui.editor.overrides); },
      get: function (path) { return E.getPath(ctx.raw(), path); },
      isOverridden: function (path) { return mode === 'scenario' && Object.prototype.hasOwnProperty.call(ui.editor.overrides, path); },
      set: function (path, val) {
        if (mode === 'base') { E.setPath(p.base, path, val); touch(p); save(); }
        else {
          if (eq(E.getPath(p.base, path), val)) delete ui.editor.overrides[path];
          else ui.editor.overrides[path] = E.clone(val);
          ui.editor.dirty = true;
        }
        onChange(path);
      },
      revert: function (path) { delete ui.editor.overrides[path]; ui.editor.dirty = true; onChange(path, true); }
    };
    return ctx;
  }

  function sectionVisible(sec, inp) { return !sec.when || sec.when(inp); }

  function renderForm(container, ctx, opts) {
    opts = opts || {};
    var inp = ctx.raw();
    var r = run(planner().base, ctx.mode === 'scenario' ? ui.editor.overrides : {});
    var html = '';
    S.SECTIONS.forEach(function (sec, si) {
      var openKey = ctx.mode + ':' + sec.id;
      var isOpen = ui.open[openKey] != null ? ui.open[openKey] : (opts.openFirst ? si === 0 : false);
      var ovCount = ctx.mode === 'scenario' ? Object.keys(ui.editor.overrides).filter(function (k) { return sec.fields.some(function (f) { return k === f.path || k.indexOf(f.path + '.') === 0; }); }).length : 0;
      html += '<details class="section" data-sec="' + sec.id + '"' + (isOpen ? ' open' : '') + (sectionVisible(sec, inp) ? '' : ' hidden') + '>' +
        '<summary><span class="sec-ico">' + icon(sec.icon) + '</span><span>' + esc(sec.title) + '</span><span class="badges" data-badges="' + sec.id + '">' + secBadges(sec, ctx, r, ovCount) + '</span><span class="chev">' + icon('chev').replace('<svg', '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"') + '</span></summary>' +
        '<div class="sec-body"><p class="intro">' + esc(sec.intro || '') + '</p>' +
        sec.fields.map(function (f) { return renderField(f, ctx, inp, r); }).join('') +
        (sec.id === 'funding' ? '<div class="funding-box" data-funding></div>' : '') +
        (opts.nextButtons && si < S.SECTIONS.length - 1 ? '<div style="text-align:right"><button class="btn sm" data-act="next-sec" data-sec="' + sec.id + '">Next: ' + esc(nextVisible(si, inp)) + ' ›</button></div>' : '') +
        '</div></details>';
    });
    container.innerHTML = html;
    container._ctx = ctx;
    refreshForm(container, r);
  }
  function nextVisible(si, inp) {
    for (var i = si + 1; i < S.SECTIONS.length; i++) if (sectionVisible(S.SECTIONS[i], inp)) return S.SECTIONS[i].title;
    return '';
  }
  function secBadges(sec, ctx, r, ovCount) {
    var miss = r.missing.filter(function (m) { return sec.fields.some(function (f) { return f.path === m.path; }); }).length;
    return (miss ? '<span class="pill bad">' + miss + ' needed</span>' : '') + (ovCount ? '<span class="pill ovr">' + ovCount + ' changed</span>' : '');
  }

  function affix(type) {
    var f = fmt();
    if (type === 'money') return { pre: f.sym };
    if (type === 'pct') return { post: '%' };
    return {};
  }
  function inputHtml(type, value, attrs, extra) {
    extra = extra || {};
    var a = attrs;
    if (type === 'money') {
      var af = affix('money');
      return '<div class="inp-wrap"><span class="affix">' + esc(af.pre) + '</span><input type="text" inputmode="decimal" autocomplete="off" ' + a + ' value="' + esc(value == null ? '' : fmt().plain(value)) + '" placeholder="' + esc(extra.placeholder || '') + '"></div>';
    }
    if (type === 'pct' || type === 'int') {
      return '<div class="inp-wrap"><input type="text" inputmode="decimal" autocomplete="off" ' + a + ' value="' + esc(value == null ? '' : value) + '" placeholder="' + esc(extra.placeholder || '') + '">' + (type === 'pct' ? '<span class="affix">%</span>' : (extra.unit ? '<span class="affix">' + esc(extra.unit) + '</span>' : '')) + '</div>';
    }
    if (type === 'month') {
      return '<div class="inp-wrap"><input type="month" ' + a + ' value="' + esc(value || '') + '" placeholder="YYYY-MM" pattern="\\d{4}-\\d{2}"></div>';
    }
    if (type === 'calmonth') {
      return '<div class="inp-wrap"><select ' + a + '>' + (extra.sug ? '<option value="">Auto' + (extra.placeholder ? ' (' + esc(extra.placeholder) + ')' : '') + '</option>' : '') + S.CAL.map(function (c) { return '<option value="' + c[0] + '"' + (+value === c[0] ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('') + '</select></div>';
    }
    if (type === 'select') {
      return '<div class="inp-wrap"><select ' + a + '>' + extra.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (value === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>';
    }
    if (type === 'holding') {
      var hs = extra.holdings || [];
      return '<div class="inp-wrap"><select ' + a + ' data-holding-select>' + hs.map(function (h, i) { return '<option value="' + esc(h.id) + '"' + (value === h.id || (!value && i === 0) ? ' selected' : '') + '>' + esc(h.name || 'Investment ' + (i + 1)) + '</option>'; }).join('') + '</select></div>';
    }
    return '<div class="inp-wrap"><input type="text" ' + a + ' value="' + esc(value || '') + '" placeholder="' + esc(extra.placeholder || '') + '"></div>';
  }

  function renderField(f, ctx, inp, r) {
    var val = E.getPath(inp, f.path);
    var vis = !f.when || f.when(inp);
    var ov = ctx.isOverridden(f.path);
    var cls = 'field' + (ov ? ' overridden' : '');
    var id = 'f_' + ctx.mode + '_' + f.path.replace(/\./g, '_');
    var head = '<span>' + esc(f.label) + (f.req ? ' <span class="req">*</span>' : '') + '</span>' +
      (f.sug ? '<span class="auto-tag" data-auto="' + f.path + '"' + (val == null || val === '' ? '' : ' hidden') + '>auto</span>' : '') +
      (ctx.mode === 'scenario' ? '<button type="button" class="revert" data-act="revert" data-path="' + f.path + '"' + (ov ? '' : ' hidden') + ' title="Use the value from your profile">↺ profile</button>' : '');
    var body = '';
    if (f.type === 'bool') {
      body = '<label class="switch"><input type="checkbox" id="' + id + '" data-f="field" data-type="bool" data-path="' + f.path + '"' + (val ? ' checked' : '') + '> <span>' + esc(f.label) + '</span>' + (ctx.mode === 'scenario' ? '<button type="button" class="revert" data-act="revert" data-path="' + f.path + '"' + (ov ? '' : ' hidden') + '>↺ profile</button>' : '') + '</label>';
      return '<div class="' + cls + '" data-field="' + f.path + '"' + (vis ? '' : ' hidden') + '>' + body + (f.help ? '<div class="help">' + esc(f.help) + '</div>' : '') + '</div>';
    }
    if (f.type === 'list') {
      return '<div class="' + cls + '" data-field="' + f.path + '"' + (vis ? '' : ' hidden') + '><div class="lbl">' + head + '</div>' + (f.help ? '<div class="help" style="margin:-2px 0 6px">' + esc(f.help) + '</div>' : '') + renderList(f, val || [], inp) + '</div>';
    }
    if (f.type === 'draws') {
      var hs = inp.assets.holdings || [];
      body = hs.length ? hs.map(function (h) {
        var dv = (val || {})[h.id];
        return '<div class="field" style="margin-bottom:8px"><label data-holding-label="' + esc(h.id) + '">' + esc(h.name || 'Investment') + ' <span class="muted small">(' + fmt().short(+h.balance || 0) + ' today)</span></label>' +
          inputHtml('money', dv == null ? null : dv, 'data-f="draw" data-hid="' + esc(h.id) + '" data-path="' + f.path + '"', { placeholder: '0' }) + '</div>';
      }).join('') : '<div class="list-empty">Add investments in "Savings & investments" to redeem them here.</div>';
      return '<div class="' + cls + '" data-field="' + f.path + '"' + (vis ? '' : ' hidden') + '><div class="lbl">' + head + '</div>' + body + '</div>';
    }
    var sugVal = r.suggested[f.path];
    var ph = '';
    if (f.sug && sugVal != null) ph = f.type === 'money' ? fmt().plain(sugVal) : f.type === 'calmonth' ? S.CAL[sugVal - 1][1] : String(sugVal);
    var attrs = 'id="' + id + '" data-f="field" data-type="' + f.type + '" data-path="' + f.path + '"';
    body = inputHtml(f.type, val, attrs, { placeholder: ph, options: f.options, unit: f.unit, sug: f.sug });
    return '<div class="' + cls + '" data-field="' + f.path + '"' + (vis ? '' : ' hidden') + '><label for="' + id + '">' + head + '</label>' + body +
      '<div class="hint" data-hint="' + f.path + '"></div>' + (f.help ? '<div class="help">' + esc(f.help) + '</div>' : '') + '</div>';
  }

  function renderList(f, list, inp) {
    var html = '<div class="list" data-list="' + f.path + '">';
    if (!list.length) html += '<div class="list-empty">Nothing added yet.</div>';
    list.forEach(function (it, i) {
      html += '<div class="list-item"><div class="li-grid">';
      f.cols.forEach(function (c) {
        var vis = !c.when || c.when(it);
        var ph = c.placeholder || '';
        if (c.placeholderFrom) ph = String(E.getPath(inp, c.placeholderFrom));
        var attrs = 'data-f="li" data-path="' + f.path + '" data-idx="' + i + '" data-key="' + c.key + '" data-type="' + c.type + '"';
        var missing = c.req && (it[c.key] == null || it[c.key] === '');
        html += '<div class="field' + (missing ? ' missing' : '') + '"' + (vis ? '' : ' hidden') + ' data-col="' + c.key + '"><label>' + esc(c.label) + '</label>' +
          inputHtml(c.type, it[c.key], attrs, { placeholder: ph, options: c.options, holdings: inp.assets.holdings }) + '</div>';
      });
      html += '</div><button type="button" class="icon-btn del" data-act="del-item" data-path="' + f.path + '" data-idx="' + i + '" title="Remove" aria-label="Remove">' + icon('trash') + '</button></div>';
    });
    html += '</div><div style="display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap"><button type="button" class="btn sm" data-act="add-item" data-path="' + f.path + '">+ ' + esc(f.addLabel || 'Add') + '</button><span class="list-total" data-total="' + f.path + '"></span></div>';
    return html;
  }

  function findField(path) {
    for (var i = 0; i < S.SECTIONS.length; i++) for (var j = 0; j < S.SECTIONS[i].fields.length; j++) if (S.SECTIONS[i].fields[j].path === path) return S.SECTIONS[i].fields[j];
    return null;
  }

  /** Update visibility, hints, badges, override marks without rebuilding inputs. */
  function refreshForm(container, r) {
    var ctx = container._ctx; if (!ctx) return;
    var inp = r.raw, f = fmt();
    S.SECTIONS.forEach(function (sec) {
      var d = $('[data-sec="' + sec.id + '"]', container);
      if (!d) return;
      d.hidden = !sectionVisible(sec, inp);
      var ovCount = ctx.mode === 'scenario' ? Object.keys(ui.editor.overrides).filter(function (k) { return sec.fields.some(function (fl) { return k === fl.path || k.indexOf(fl.path + '.') === 0; }); }).length : 0;
      var b = $('[data-badges="' + sec.id + '"]', d); if (b) b.innerHTML = secBadges(sec, ctx, r, ovCount);
      sec.fields.forEach(function (fl) {
        var el = $('[data-field="' + fl.path + '"]', d); if (!el) return;
        el.hidden = !!fl.when && !fl.when(inp);
        var ov = ctx.isOverridden(fl.path);
        el.classList.toggle('overridden', ov);
        $$('[data-act="revert"][data-path="' + fl.path + '"]', el).forEach(function (x) { x.hidden = !ov; });
        var val = E.getPath(inp, fl.path);
        el.classList.toggle('missing', !!fl.req && fl.type !== 'list' && r.missing.some(function (m) { return m.path === fl.path; }));
        var auto = $('[data-auto="' + fl.path + '"]', el); if (auto) auto.hidden = !(val == null || val === '');
        var hint = $('[data-hint="' + fl.path + '"]', el);
        if (hint) {
          var txt = '';
          if (fl.type === 'money') {
            var shown = val != null && val !== '' ? +val : r.suggested[fl.path];
            if (shown != null && Math.abs(shown) >= 1000) txt = (val == null || val === '' ? 'Suggested ' : '') + f.short(shown);
            if (fl.path === 'purchase.downPayment' && +r.inputs.purchase.price > 0) txt += (txt ? ' · ' : '') + Math.round(r.inputs.purchase.downPayment / r.inputs.purchase.price * 100) + '% of price, loan ' + f.short(r.inputs.purchase.price - r.inputs.purchase.downPayment);
          } else if (fl.type === 'month' && (val == null || val === '') && r.suggested[fl.path]) txt = 'Suggested ' + monthName(r.suggested[fl.path]);
          else if (fl.path === 'home2.loan.ratePct' && r.res.summary.emi2Now) txt = 'EMI now ' + f.short(r.res.summary.emi2Now) + ', peaks at ' + f.short(r.res.summary.emi2Peak) + ' in ' + monthName(r.res.summary.emi2PeakYM);
          else if (fl.path === 'purchase.tenureYears' && r.res.purchase) txt = 'EMI ' + f.short(r.res.purchase.emi) + ' per month';
          hint.textContent = txt;
        }
        if (fl.type === 'list') {
          var tot = $('[data-total="' + fl.path + '"]', el);
          var list = val || [];
          if (tot) {
            if (fl.path === 'expenses.items') {
              var e1 = list.filter(function (x) { return x.kind !== 'sip'; }).reduce(function (a, x) { return a + (+x.monthly || 0); }, 0);
              var s1 = list.filter(function (x) { return x.kind === 'sip'; }).reduce(function (a, x) { return a + (+x.monthly || 0); }, 0);
              tot.textContent = 'Expenses ' + f.short(e1) + '/month' + (s1 ? ' · SIPs ' + f.short(s1) + '/month' : '');
            } else if (fl.path === 'home2.schedule') {
              var ln = list.filter(function (x) { return x.paidBy !== 'self'; }).reduce(function (a, x) { return a + (+x.amount || 0); }, 0);
              var sf = list.filter(function (x) { return x.paidBy === 'self'; }).reduce(function (a, x) { return a + (+x.amount || 0); }, 0);
              tot.textContent = list.length ? 'Bank ' + f.short(ln) + ' · You ' + f.short(sf) : '';
            } else if (fl.path === 'assets.holdings') {
              tot.textContent = list.length ? 'Total ' + f.short(list.reduce(function (a, x) { return a + (+x.balance || 0); }, 0)) : '';
            } else tot.textContent = '';
          }
          $$('.list-item', el).forEach(function (li, i) {
            var it = list[i]; if (!it) return;
            var c = fl.cols;
            c.forEach(function (col) {
              var ce = $('[data-col="' + col.key + '"]', li); if (!ce) return;
              if (col.when) ce.hidden = !col.when(it);
              if (col.req) ce.classList.toggle('missing', it[col.key] == null || it[col.key] === '');
            });
          });
        }
      });
    });
    // holding names may have changed
    var hs = inp.assets.holdings || [];
    $$('[data-holding-select]', container).forEach(function (sel) {
      $$('option', sel).forEach(function (o, i) { if (hs[i]) o.textContent = hs[i].name || 'Investment ' + (i + 1); });
    });
    $$('[data-holding-label]', container).forEach(function (l) {
      var h = hs.find(function (x) { return x.id === l.dataset.holdingLabel; });
      if (h) l.innerHTML = esc(h.name || 'Investment') + ' <span class="muted small">(' + f.short(+h.balance || 0) + ' today)</span>';
    });
    var fb = $('[data-funding]', container);
    if (fb) fb.innerHTML = fundingHtml(r);
  }

  function fundingHtml(r) {
    var f = fmt(), pu = r.res.purchase;
    if (!pu) return '<span class="muted">Enter a purchase price to see the funding split.</span>';
    var rows = [
      ['Down payment', pu.down], ['Stamp duty & registration', pu.stamp], ['Loan processing fee', pu.fee], ['Other costs', pu.other]
    ].filter(function (x) { return x[1] > 0; });
    var html = '<div class="muted small" style="margin-bottom:4px">Needed in ' + monthName(pu.ym) + '</div>' +
      rows.map(function (x) { return '<div class="row"><span>' + x[0] + '</span><span>' + f.short(x[1]) + '</span></div>'; }).join('') +
      '<div class="row total"><span>Upfront cash needed</span><span>' + f.short(pu.upfront) + '</span></div>' +
      '<div class="muted small" style="margin:8px 0 4px">Paid from</div>';
    var src = [];
    if (r.res.sale) src.push(['Home 1 sale (net ' + f.short(r.res.sale.net) + ')', pu.fromSale]);
    if (pu.fromHoldings) src.push(['Investments you chose to redeem', pu.fromHoldings]);
    if (pu.fromCash) src.push(['Cash & that month\'s income', pu.fromCash]);
    if (pu.autoDrawn) src.push(['Auto-redeemed from investments', pu.autoDrawn]);
    html += src.map(function (x) { return '<div class="row"><span>' + esc(x[0]) + '</span><span>' + f.short(x[1]) + '</span></div>'; }).join('');
    if (r.res.sale && r.res.sale.net > pu.upfront) html += '<div class="row"><span>Surplus from sale, invested</span><span>' + f.short(r.res.sale.net - pu.upfront) + '</span></div>';
    var short = r.res.rows.find(function (x) { return x.ym === pu.ym; });
    if (short && short.liquid < 0) html += '<div class="notice bad" style="margin:8px 0 0"><span class="ico">!</span><div>Short by ' + f.short(-short.liquid) + ' in the purchase month.</div></div>';
    return html;
  }

  /** Wire input events once per container. */
  function bindForm(container) {
    if (container._bound) return;
    container._bound = true;
    function onValue(e) {
      var t = e.target, ctx = container._ctx;
      if (!ctx || !t.dataset || !t.dataset.f) return;
      var type = t.dataset.type, path = t.dataset.path, v;
      if (t.dataset.f === 'field') {
        v = readInput(t, type);
        if (v === undefined) return;
        ctx.set(path, v);
      } else if (t.dataset.f === 'li') {
        v = readInput(t, type);
        if (v === undefined) return;
        var list = E.clone(ctx.get(path) || []);
        var i = +t.dataset.idx; if (!list[i]) return;
        list[i][t.dataset.key] = v;
        ctx.set(path, list);
      } else if (t.dataset.f === 'draw') {
        v = readInput(t, 'money');
        if (v === undefined) return;
        var d = E.clone(ctx.get(path) || {});
        if (v == null || v === 0) delete d[t.dataset.hid]; else d[t.dataset.hid] = v;
        ctx.set(path, d);
      }
    }
    container.addEventListener('input', onValue);
    container.addEventListener('change', function (e) {
      onValue(e);
      var t = e.target;
      if (t.dataset && (t.dataset.type === 'money') && t.value) { var n = parseAmount(t.value); if (isFinite(n) && n != null) t.value = fmt().plain(n); }
    });
    container.addEventListener('toggle', function (e) {
      var d = e.target; if (!d.dataset || !d.dataset.sec || !container._ctx) return;
      ui.open[container._ctx.mode + ':' + d.dataset.sec] = d.open;
    }, true);
    container.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b || !container.contains(b)) return;
      var ctx = container._ctx, act = b.dataset.act;
      if (act === 'add-item' || act === 'del-item') {
        e.preventDefault();
        var fdef = findField(b.dataset.path);
        var list = E.clone(ctx.get(b.dataset.path) || []);
        if (act === 'add-item') list.push(fdef.newItem());
        else list.splice(+b.dataset.idx, 1);
        ctx.set(b.dataset.path, list);
        rerenderForm(container);
        if (act === 'add-item') {
          var items = $$('[data-list="' + b.dataset.path + '"] .list-item', container);
          var last = items[items.length - 1]; var inpEl = last && $('input,select', last); if (inpEl) inpEl.focus();
        }
      } else if (act === 'revert') {
        e.preventDefault(); e.stopPropagation();
        ctx.revert(b.dataset.path);
        rerenderForm(container);
      } else if (act === 'next-sec') {
        var secs = $$('details.section', container).filter(function (d) { return !d.hidden; });
        var idx = secs.findIndex(function (d) { return d.dataset.sec === b.dataset.sec; });
        secs[idx].open = false;
        if (secs[idx + 1]) { secs[idx + 1].open = true; secs[idx + 1].scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      }
    });
  }
  function rerenderForm(container) {
    var scroll = window.scrollY;
    var ctx = container._ctx;
    renderForm(container, ctx, { nextButtons: ctx.mode === 'base' });
    window.scrollTo(0, scroll);
  }
  function readInput(t, type) {
    var raw = t.type === 'checkbox' ? t.checked : t.value;
    var v;
    switch (type) {
      case 'bool': return !!raw;
      case 'money': v = parseAmount(raw); break;
      case 'pct': case 'int': v = parseNum(raw); break;
      case 'calmonth': return raw === '' ? null : +raw;
      case 'month': if (raw === '') return null; return E.parseYM(raw) == null ? undefined : E.ymStr(E.parseYM(raw));
      default: return raw;
    }
    var bad = typeof v === 'number' && isNaN(v);
    var wrap = t.closest('.inp-wrap'); if (wrap) wrap.style.borderColor = bad ? 'var(--bad)' : '';
    return bad ? undefined : v;
  }

  // =====================================================================
  // Profile view
  // =====================================================================
  function renderProfile(el) {
    var p = planner();
    var r = run(p.base, {});
    var total = S.SECTIONS.filter(function (s) { return sectionVisible(s, p.base); }).length;
    el.innerHTML = '<div class="view-head"><div class="grow"><h1>Your profile</h1><p>The starting point for every scenario in this planner. Scenarios inherit these values unless you change them inside the scenario. Saved automatically.</p></div>' +
      '<div class="btn-row"><button class="btn primary" data-act="profile-done">' + (p.scenarios.length ? 'Go to scenarios' : 'Create starter scenarios') + '</button></div></div>' +
      '<div id="profileMissing"></div>' +
      '<div class="editor" style="grid-template-columns:minmax(0,760px)"><div class="inputs-col" id="profileForm"></div></div>';
    var form = $('#profileForm', el);
    var ctx = makeCtx('base', function () {
      var rr = run(p.base, {});
      refreshForm(form, rr);
      renderProfileMissing(rr);
    });
    bindForm(form);
    renderForm(form, ctx, { openFirst: !p.scenarios.length && Object.keys(ui.open).every(function (k) { return k.indexOf('base:') !== 0; }), nextButtons: true });
    renderProfileMissing(r);
    void total;
  }
  function renderProfileMissing(r) {
    var el = $('#profileMissing'); if (!el) return;
    var f = fmt();
    if (r.missing.length) {
      el.innerHTML = '<div class="notice warn"><span class="ico">!</span><div><b>Still needed:</b> ' + r.missing.map(function (m) { return esc(m.label); }).join(', ') + '. Fields marked <span class="req" style="color:var(--bad)">*</span> are required; the rest have sensible defaults you can override.</div></div>';
    } else {
      var s = r.res.summary;
      el.innerHTML = '<div class="notice good"><span class="ico">✓</span><div>Profile complete. With these numbers you have about <b>' + f.short(s.surplusNow) + '</b> left each month after commitments today' + (r.res.buying && r.res.purchase ? ', and the new flat EMI would be <b>' + f.short(r.res.purchase.emi) + '</b>' : '') + '.</div></div>';
    }
  }

  // =====================================================================
  // Editor
  // =====================================================================
  function openEditor(scenarioId, overrides) {
    var p = planner();
    var s = scenarioId ? p.scenarios.find(function (x) { return x.id === scenarioId; }) : null;
    ui.editor = {
      scenarioId: s ? s.id : null,
      name: s ? s.name : '',
      nameAuto: s ? !!s.nameAuto : true,
      overrides: E.clone(s ? s.overrides : overrides || {}),
      dirty: !s
    };
    ui.pane = 'inputs';
    setTab('editor');
  }
  function editorName() {
    var e = ui.editor; if (!e) return '';
    if (e.nameAuto) return E.autoName(run(planner().base, e.overrides).inputs);
    return e.name || 'Untitled scenario';
  }
  function saveEditor(asNew, name) {
    var p = planner(), e = ui.editor;
    var nm = name || editorName();
    if (asNew || !e.scenarioId) {
      var s = addScenario(p, uniqueName(p, nm), name ? false : e.nameAuto, E.clone(e.overrides));
      e.scenarioId = s.id; e.name = s.name; e.nameAuto = s.nameAuto;
    } else {
      var sc = p.scenarios.find(function (x) { return x.id === e.scenarioId; });
      sc.overrides = E.clone(e.overrides); sc.name = uniqueName(p, nm, sc.id); sc.nameAuto = e.nameAuto; sc.updatedAt = new Date().toISOString();
      e.name = sc.name;
    }
    e.dirty = false;
    touch(p); save();
    toast('Saved "' + (e.name) + '"');
  }

  var editorTimer = null;
  function renderEditor(el) {
    var p = planner();
    if (!ui.editor) {
      el.innerHTML = '<div class="card welcome" style="text-align:center"><h2>No scenario open</h2><p class="muted">Open a saved scenario to tweak it, or start a new one from a template.</p><div class="btn-row" style="justify-content:center"><button class="btn" data-act="tab" data-tab="scenarios">Saved scenarios</button><button class="btn primary" data-act="new-scenario">New scenario</button></div></div>';
      return;
    }
    var e = ui.editor;
    el.innerHTML =
      '<div class="editor-title"><input class="name-input" id="scnName" aria-label="Scenario name" maxlength="120">' +
      '<button class="btn sm ghost" id="autoNameBtn" title="Use an automatic name based on the settings">Auto name</button></div>' +
      '<div class="editor-head"><div class="name-row">' +
      '<div class="seg" role="group" aria-label="Show"><button data-pane="inputs">Inputs</button><button data-pane="results">Results</button></div>' +
      '<span class="dirty-dot" id="dirtyDot" title="Unsaved changes"' + (e.dirty ? '' : ' hidden') + '></span><span class="dirty-txt muted small" id="dirtyTxt"' + (e.dirty ? '' : ' hidden') + '>Unsaved</span>' +
      '<div class="btn-row head-btns"><button class="btn" data-act="close-editor">Close</button><button class="btn" id="saveAsBtn">Save as new</button><button class="btn primary" id="saveBtn">Save</button></div>' +
      '</div>' +
      '<div class="mini-kpis" id="miniKpis"></div>' +
      '</div>' +
      '<div class="editor" id="editorGrid" data-pane="' + ui.pane + '">' +
      '<div class="inputs-col"><div class="notice info small"><span class="ico">i</span><div>Values come from your profile. Anything you change here applies only to this scenario and is marked <span class="pill ovr">changed</span>.</div></div><div id="scnForm"></div></div>' +
      '<div class="results-col" id="scnResults"></div>' +
      '</div>';
    var nameEl = $('#scnName', el);
    nameEl.value = editorName();
    nameEl.addEventListener('input', function () { e.name = nameEl.value; e.nameAuto = false; markDirty(); });
    $('#autoNameBtn', el).addEventListener('click', function () { e.nameAuto = true; nameEl.value = editorName(); markDirty(); });
    $('#saveBtn', el).addEventListener('click', function () { saveEditor(false); $('#dirtyDot').hidden = true; $('#dirtyTxt').hidden = true; });
    $('#saveAsBtn', el).addEventListener('click', async function () {
      var sugName = e.nameAuto ? editorName() : editorName() + ' (variant)';
      var nm = await promptBox('Save as a new scenario', 'Name', uniqueName(p, sugName), 'Save');
      if (!nm) return;
      saveEditor(true, nm); nameEl.value = e.name; $('#dirtyDot').hidden = true; $('#dirtyTxt').hidden = true;
    });
    $$('.seg button', el).forEach(function (b) {
      b.setAttribute('aria-pressed', b.dataset.pane === ui.pane);
      b.addEventListener('click', function () {
        ui.pane = b.dataset.pane; $('#editorGrid').dataset.pane = ui.pane;
        $$('.seg button', el).forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.pane === ui.pane); });
        if (ui.pane === 'results') { var r = run(p.base, e.overrides); updateResults($('#scnResults'), r, true); }
      });
    });
    var form = $('#scnForm', el);
    var ctx = makeCtx('scenario', function () {
      markDirty();
      clearTimeout(editorTimer);
      editorTimer = setTimeout(function () { liveUpdate(); }, 60);
    });
    bindForm(form);
    renderForm(form, ctx, {});
    buildResults($('#scnResults', el), run(p.base, e.overrides));
  }
  function markDirty() {
    if (!ui.editor) return;
    ui.editor.dirty = true;
    var d = $('#dirtyDot'); if (d) d.hidden = false;
    var dt = $('#dirtyTxt'); if (dt) dt.hidden = false;
  }
  function liveUpdate() {
    var p = planner(), e = ui.editor; if (!e) return;
    var r = run(p.base, e.overrides);
    var form = $('#scnForm'); if (form) refreshForm(form, r);
    var nameEl = $('#scnName'); if (nameEl && e.nameAuto && document.activeElement !== nameEl) nameEl.value = editorName();
    updateResults($('#scnResults'), r);
  }

  // ---------- results panel ----------
  var CHART_TABS = [['cashflow', 'Monthly cash flow'], ['outflows', 'Where money goes'], ['wealth', 'Savings & net worth'], ['opportunity', 'Buy vs keep renting']];
  function buildResults(el, r) {
    el.innerHTML =
      '<div id="resNotices"></div>' +
      '<div class="kpis" id="resKpis"></div>' +
      '<details class="card whatif" id="whatif" open><summary>Quick what-if <span class="muted small">(drag to see the effect instantly)</span></summary><div class="sliders" id="sliders"></div></details>' +
      '<div class="card"><div class="chart-tabs" id="chartTabs">' + CHART_TABS.map(function (t) { return '<button data-ct="' + t[0] + '" aria-pressed="' + (ui.chartTab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>' +
      '<label class="compare-check" id="smoothWrap" style="margin-bottom:6px"><input type="checkbox" id="smoothChk"' + (ui.smooth ? ' checked' : '') + '> Smooth out the yearly bonus (12-month average)</label>' +
      '<div class="chart-box tall"><canvas id="mainChart" role="img" aria-label="Scenario chart"></canvas></div><div class="chart-note" id="chartNote"></div></div>' +
      '<div class="card"><div class="table-tools"><h3 style="margin:0;flex:1">Year by year</h3>' +
      '<div class="chart-tabs" style="margin:0"><button data-tm="yearly" aria-pressed="' + (ui.tableMode === 'yearly') + '">Yearly</button><button data-tm="monthly" aria-pressed="' + (ui.tableMode === 'monthly') + '">Monthly</button></div>' +
      '<button class="btn sm" id="csvBtn">Download CSV</button></div><p class="tip-hint" data-tiphint></p><div class="chart-tabs tbl-groups" id="tblGroups" hidden></div><div class="table-wrap" id="resTable" style="max-height:480px"></div></div>';
    $$('#chartTabs button', el).forEach(function (b) {
      b.addEventListener('click', function () {
        ui.chartTab = b.dataset.ct;
        $$('#chartTabs button', el).forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.ct === ui.chartTab); });
        var c = $('#mainChart'); if (c._chart) { c._chart.destroy(); c._chart = null; }
        updateResults(el, run(planner().base, ui.editor.overrides), true);
      });
    });
    $('#smoothChk', el).addEventListener('change', function (ev) { ui.smooth = ev.target.checked; updateResults(el, run(planner().base, ui.editor.overrides), true); });
    $$('[data-tm]', el).forEach(function (b) {
      b.addEventListener('click', function () {
        ui.tableMode = b.dataset.tm;
        $$('[data-tm]', el).forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.tm === ui.tableMode); });
        updateResults(el, run(planner().base, ui.editor.overrides), true);
      });
    });
    $('#csvBtn', el).addEventListener('click', function () {
      var rr = run(planner().base, ui.editor.overrides);
      download(slug(editorName()) + '-' + ui.tableMode + '.csv', tableCsv(rr), 'text/csv');
    });
    buildSliders($('#sliders', el), r);
    updateResults(el, r, true);
  }

  function buildSliders(el, r) {
    var inp = r.inputs;
    var list = S.SLIDERS.filter(function (s) { return (!s.when || s.when(inp)); });
    el.innerHTML = list.map(function (s) {
      var v = +E.getPath(inp, s.path) || 0;
      var rg = s.range(v, inp);
      if (s.type === 'money' && !(rg[1] > rg[0])) return '';
      return '<div class="slider"><div class="top"><span>' + esc(s.label) + '</span><b data-sv="' + s.path + '"></b></div>' +
        '<input type="range" data-slider="' + s.path + '" data-type="' + s.type + '" min="' + rg[0] + '" max="' + rg[1] + '" step="' + rg[2] + '" value="' + v + '" aria-label="' + esc(s.label) + '"></div>';
    }).join('') || '<span class="muted small">Enter a purchase price and your income to unlock the sliders.</span>';
    el.oninput = function (e) {
      var t = e.target; if (!t.dataset.slider) return;
      var v = +t.value, path = t.dataset.slider;
      var ctx = $('#scnForm')._ctx;
      ctx.set(path, v);
      var inpEl = $('[data-f="field"][data-path="' + path + '"]');
      if (inpEl) inpEl.value = t.dataset.type === 'money' ? fmt().plain(v) : v;
    };
    updateSliderLabels(el, r);
  }
  function updateSliderLabels(el, r) {
    var f = fmt();
    $$('[data-slider]', el).forEach(function (s) {
      var path = s.dataset.slider, v = +E.getPath(r.inputs, path) || 0;
      if (document.activeElement !== s) {
        if (v > +s.max) s.max = v; if (v < +s.min) s.min = v;
        s.value = v;
      }
      var lbl = $('[data-sv="' + path + '"]', el);
      if (lbl) lbl.textContent = s.dataset.type === 'money' ? f.short(v) : s.dataset.type === 'pct' ? pct(v) : v + ' yrs';
    });
  }

  function updateResults(el, r, force) {
    if (!el) return;
    var f = fmt(), s = r.res.summary, inp = r.inputs, em = +inp.settings.emergencyMonths || 0;
    // notices
    var notes = '';
    if (r.missing.length) notes += '<div class="notice warn"><span class="ico">!</span><div>Missing: ' + r.missing.map(function (m) { return esc(m.label); }).join(', ') + '. Results treat these as 0.</div></div>';
    r.res.warnings.forEach(function (w) { notes += '<div class="notice warn"><span class="ico">!</span><div>' + esc(w) + '</div></div>'; });
    if (s.shortfallMonths) notes += '<div class="notice bad"><span class="ico">!</span><div>Your savings and investments run out for ' + s.shortfallMonths + ' month(s); lowest point ' + f.short(s.minLiquid) + ' in ' + monthName(s.minLiquidYM) + '.</div></div>';
    $('#resNotices', el).innerHTML = notes;

    // KPIs
    var t = tierOf(r), k = [];
    var pu = r.res.purchase;
    T.reset('kpis');
    if (pu) {
      k.push(kpi('Upfront cash needed', f.short(pu.upfront), 'Down ' + f.short(pu.down) + ' + costs ' + f.short(pu.upfront - pu.down), '', 'upfront', r));
      k.push(kpi('New flat EMI', f.short(pu.emi), 'Loan ' + f.short(pu.loan) + ' · ' + inp.purchase.tenureYears + ' yrs @ ' + pct(inp.purchase.loanRatePct), '', 'emi3', r));
      var pi = E.parseYM(pu.ym) + 1;
      var a = r.res.rows.find(function (x) { return x.idx === pi; }), b = r.cf.rows.find(function (x) { return x.idx === pi; });
      if (a && b) {
        var d = (a.committed - a.income) - (b.committed - b.income);
        k.push(kpi('Net change in monthly outgo', (d >= 0 ? '+' : '') + f.short(d), 'After buying: new EMI & upkeep minus rent saved' + (r.res.sale ? ', plus Home 1 rent lost' : ''), d > 0 ? 'warn' : 'good', 'netOutgo', r));
      }
    }
    if (s.emi2Peak > 0) k.push(kpi('Home 2 EMI', f.short(s.emi2Now) + ' → ' + f.short(s.emi2Peak), 'Peaks in ' + monthName(s.emi2PeakYM), '', 'emi2', r));
    k.push(kpi('Left each month (yr 1 avg)', f.short(s.avgSurplusFirstYear), 'Tightest: ' + f.short(s.minSurplus) + ' in ' + monthName(s.minSurplusYM), s.minSurplus < 0 ? 'warn' : '', 'avgSurplusFirstYear', r));
    k.push(kpi('Lowest savings', f.short(s.minLiquid), (s.minCover >= 99 ? '' : s.minCover.toFixed(1) + ' months of commitments · ') + monthName(s.minLiquidYM), t.cls === 'good' ? 'good' : t.cls, 'minLiquid', r));
    k.push(kpi('Net worth in ' + inp.settings.horizonYears + ' yrs', f.short(s.endNetWorth), r.opp ? 'vs keep renting: ' + (r.opp.netWorthDiff >= 0 ? '+' : '') + f.short(r.opp.netWorthDiff) : 'Savings ' + f.short(s.endLiquid), r.opp ? (r.opp.netWorthDiff >= 0 ? 'good' : 'warn') : '', 'netWorthVsRent', r));
    $('#resKpis', el).innerHTML = k.join('');
    var mk = $('#miniKpis');
    if (mk) mk.innerHTML = [
      pu ? ['New EMI', f.short(pu.emi)] : null,
      ['Left / month', f.short(s.avgSurplusFirstYear)],
      ['Lowest savings', f.short(s.minLiquid)],
      r.opp ? ['vs renting', (r.opp.netWorthDiff >= 0 ? '+' : '') + f.short(r.opp.netWorthDiff)] : ['Net worth', f.short(s.endNetWorth)]
    ].filter(Boolean).map(function (x) { return '<div class="mk">' + esc(x[0]) + '<b>' + esc(x[1]) + '</b></div>'; }).join('');

    updateSliderLabels($('#sliders', el), r);
    // rebuild sliders if their set changed (e.g. buying toggled)
    var want = S.SLIDERS.filter(function (x) { return !x.when || x.when(r.inputs); }).length;
    if ($$('[data-slider]', el).length !== want && !$$('[data-slider]', el).some(function (x) { return x === document.activeElement; })) buildSliders($('#sliders', el), r);

    // charts are hidden on small screens while editing inputs; skip work then
    var grid = $('#editorGrid');
    var hiddenPane = grid && getComputedStyle(el).display === 'none';
    if (!hiddenPane || force) {
      var cv = $('#mainChart', el), note = $('#chartNote', el);
      $('#smoothWrap', el).hidden = ui.chartTab !== 'cashflow';
      if (ui.chartTab === 'opportunity' && !r.opp) {
        if (cv._chart) { cv._chart.destroy(); cv._chart = null; }
        note.textContent = 'This scenario does not buy the new flat, so there is nothing to compare with keep renting.';
        cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
      } else if (ui.chartTab === 'cashflow') {
        C.cashflow(cv, r.res, f, ui.smooth);
        note.textContent = (ui.smooth ? 'Averaged over the previous 12 months. ' : '') + 'Bars show what is left each month after living expenses, SIPs, rent, EMIs and maintenance. Spikes are the February bonus; red bars are months where commitments exceed income.';
      } else if (ui.chartTab === 'outflows') {
        C.outflows(cv, r.res, f);
        note.textContent = 'Yearly spending by type, with income as the dashed line. A year marked * is a partial year.';
      } else if (ui.chartTab === 'wealth') {
        C.wealth(cv, r.res, r.cf, f);
        note.textContent = r.res.buying ? 'Dashed lines show the same inputs if you keep renting instead. The gap is your opportunity gain or loss.' : 'Savings & investments are cash plus investments; net worth adds property value and subtracts loans.';
      } else if (ui.chartTab === 'opportunity') {
        C.opportunity(cv, r.opp, f);
        var dlt = r.opp.netWorthDiff;
        note.textContent = 'After ' + inp.settings.horizonYears + ' years, buying leaves you ' + f.short(Math.abs(dlt)) + (dlt >= 0 ? ' better off' : ' worse off') + ' than renting, and your savings & investments ' + (r.opp.liquidDiff >= 0 ? 'higher' : 'lower') + ' by ' + f.short(Math.abs(r.opp.liquidDiff)) + '. Blue helps, orange costs.';
      }
      renderResTable(el, r);
    }
  }
  function kpi(k, v, s, cls, tipKey, r) {
    var a = tipKey ? T.attr('kpis', function () { return explainMetric(tipKey, r); }) : '';
    return '<div class="kpi has-tip ' + (cls || '') + '"' + a + '><div class="k">' + esc(k) + (tipKey ? ' <span class="info-i" aria-hidden="true">i</span>' : '') + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s) + '</div></div>';
  }

  var TABLE_COLS = [
    ['income', 'Income'], ['livingSip', 'Living & SIPs'], ['rent', 'Rent'], ['emis', 'Home EMIs'], ['maint', 'Mainte&shy;nance'],
    ['lump', 'Lump sums'], ['surplus', 'Left after commit&shy;ments'], ['avgSurplus', 'Avg left / month'],
    ['liquid', 'Savings & inv. (end)'], ['loans', 'Loans (end)'], ['netWorth', 'Net worth (end)']
  ];
  function tableRows(r) {
    var monthly = ui.tableMode === 'monthly';
    var src = monthly ? r.res.rows : r.res.years;
    return src.map(function (x) {
      return {
        label: monthly ? monthName(x.ym) : (x.months < 12 ? x.year + ' (' + x.months + '\u00a0mo)' : String(x.year)),
        income: x.income, livingSip: x.living + x.sip, rent: x.rent, emis: x.emi2 + x.emi3, maint: x.maint,
        lump: x.h2Self + x.upfront + x.oneOff + x.prepay - x.saleProceeds,
        surplus: x.surplus, avgSurplus: monthly ? x.surplus : x.avgSurplus,
        liquid: x.liquid, loans: x.loans, netWorth: x.netWorth
      };
    }).map(function (o) { return o; });
  }
  // On narrow screens the year table shows one group of columns at a time instead of scrolling sideways
  var TABLE_GROUPS = [
    ['flow', 'Income & living', ['income', 'livingSip', 'rent']],
    ['emi', 'EMIs & lump sums', ['emis', 'maint', 'lump']],
    ['left', 'Left & savings', ['surplus', 'avgSurplus', 'liquid']],
    ['bal', 'Loans & net worth', ['loans', 'netWorth']]
  ];
  function renderResTable(el, r) {
    var wrap = $('#resTable', el), bar = $('#tblGroups', el);
    var fits = function () { var t = wrap.firstElementChild; return wrap.clientWidth ? t.scrollWidth <= wrap.clientWidth + 2 : window.innerWidth >= 700; };
    wrap.innerHTML = tableHtml(r, null);
    if (fits()) { bar.hidden = true; return; }
    var g = ui.tableGroup || 'flow';
    bar.hidden = false;
    bar.innerHTML = TABLE_GROUPS.map(function (x) { return '<button data-tg="' + x[0] + '" aria-pressed="' + (x[0] === g) + '">' + x[1] + '</button>'; }).join('');
    $$('[data-tg]', bar).forEach(function (b) {
      b.addEventListener('click', function () { ui.tableGroup = b.dataset.tg; renderResTable(el, run(planner().base, ui.editor.overrides)); });
    });
    wrap.innerHTML = tableHtml(r, g);
  }
  function tableHtml(r, group) {
    var f = fmt(), monthly = ui.tableMode === 'monthly', cols = TABLE_COLS.filter(function (c) { return !(monthly && c[0] === 'avgSurplus'); });
    var gcols = group && TABLE_GROUPS.find(function (x) { return x[0] === group; });
    if (gcols) cols = cols.filter(function (c) { return gcols[2].indexOf(c[0]) >= 0; });
    var src = monthly ? r.res.rows : r.res.years;
    var rows = tableRows(r);
    T.reset('edTable');
    return '<table class="data"><thead><tr><th' + headTip('edTable', 'period') + '>' + (monthly ? 'Month' : 'Year') + '</th>' + cols.map(function (c) { return '<th class="has-tip"' + headTip('edTable', c[0]) + '>' + c[1] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (row, i) {
        var lab = group && monthly ? row.label.replace(/ \d\d(\d\d)$/, ' $1') : row.label;
        return '<tr><td>' + esc(lab) + '</td>' + cols.map(function (c) {
          var v = row[c[0]];
          var a = T.attr('edTable', function () { return explainCell(c[0], src[i], i > 0 ? src[i - 1] : null, monthly, r); });
          return '<td class="has-tip' + (v < -0.5 ? ' neg' : '') + '"' + a + '>' + (Math.abs(v) < 0.5 ? '–' : f.short(v)) + '</td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }
  function tableCsv(r) {
    var cols = TABLE_COLS.filter(function (c) { return !(ui.tableMode === 'monthly' && c[0] === 'avgSurplus'); });
    var lines = [[ui.tableMode === 'monthly' ? 'Month' : 'Year'].concat(cols.map(function (c) { return c[1].replace('&shy;', ''); })).join(',')];
    tableRows(r).forEach(function (row) { lines.push(['"' + row.label + '"'].concat(cols.map(function (c) { return Math.round(row[c[0]]); })).join(',')); });
    return lines.join('\n');
  }

  // =====================================================================
  // Explanations (tooltips on numbers and headings)
  // =====================================================================
  var T = window.HBPTips;
  /** Calculation block. lines: [sign, label, value] ; total: [label, value] */
  function calc(lines, total) {
    var f = fmt();
    var h = '<table class="tip-calc">' + lines.filter(Boolean).map(function (l) {
      return '<tr><td class="op">' + (l[0] || '') + '</td><td>' + esc(l[1]) + '</td><td class="amt">' + (typeof l[2] === 'number' ? esc(f.full(l[2])) : esc(l[2])) + '</td></tr>';
    }).join('');
    if (total) h += '<tr class="tot"><td class="op">=</td><td>' + esc(total[0]) + '</td><td class="amt">' + (typeof total[1] === 'number' ? esc(f.full(total[1])) : esc(total[1])) + '</td></tr>';
    return h + '</table>';
  }
  function tip(title, sub, body, note) {
    return '<div class="tip-title">' + esc(title) + '</div>' + (sub ? '<div class="tip-sub">' + esc(sub) + '</div>' : '') + (body || '') + (note ? '<div class="tip-note">' + note + '</div>' : '');
  }
  function nz(v) { return Math.abs(v) >= 0.5; }
  /** Plain-language list of the start / stop months set for income or expense lines. */
  function stopNotes(r, what) {
    var i = r.inputs, out = [];
    if (what === 'income') {
      if (i.income.salaryEndMonth) out.push('Salary and bonus stop after ' + monthName(i.income.salaryEndMonth) + '.');
      if (i.income.otherStartMonth || i.income.otherEndMonth) out.push('Other income ' + (i.income.otherStartMonth ? 'starts ' + monthName(i.income.otherStartMonth) : '') + (i.income.otherStartMonth && i.income.otherEndMonth ? ' and ' : '') + (i.income.otherEndMonth ? 'stops after ' + monthName(i.income.otherEndMonth) : '') + '.');
      if (i.home1.owned && i.home1.rentEndMonth) out.push('Home 1 rent stops after ' + monthName(i.home1.rentEndMonth) + '.');
      if (i.home2.owned && i.home2.rentEndMonth) out.push('Home 2 rent stops after ' + monthName(i.home2.rentEndMonth) + '.');
    } else {
      (i.expenses.items || []).forEach(function (it) {
        if (!it.startMonth && !it.endMonth) return;
        out.push(esc(it.name || (it.kind === 'sip' ? 'SIP' : 'Expense')) + ': ' + (it.startMonth ? 'from ' + monthName(it.startMonth) : '') + (it.startMonth && it.endMonth ? ' ' : '') + (it.endMonth ? 'until ' + monthName(it.endMonth) : '') + '.');
      });
    }
    return out.join(' ');
  }
  function startLiquid(r) { return (+r.inputs.assets.cash || 0) + (r.inputs.assets.holdings || []).reduce(function (a, h) { return a + (+h.balance || 0); }, 0); }
  function periodLabel(x, monthly) { return monthly ? monthName(x.ym) : (x.months < 12 ? x.year + ' (' + x.months + ' months in the projection)' : 'Year ' + x.year + ' (sum of 12 months)'); }

  var COL_HELP = {
    period: ['Period', 'Each row is one calendar year (or one month in Monthly view). Money flowing in or out is summed over the period; balances are as at the end of the period. The first and last years can be partial.'],
    income: ['Income', 'Everything coming in: in-hand salary, the yearly bonus in its payout month, other income, rent from Home 1 (while you own it) and rent from Home 2 (once let out after possession). Salary and other income rise each year in the hike month; rents rise on their own schedules. Anything with a stop month (retirement, a tenant leaving) drops out after it.'],
    livingSip: ['Living & SIPs', 'Your monthly expense lines, each grown every January by its own rise % (or general inflation). SIP lines are included here as money leaving your account, but they are added to your investments, so they are saving, not spending. Lines with a From / Until month only count inside those months.'],
    rent: ['Rent', 'Rent for the flat you live in now. It rises by the renewal % in the renewal month and stops the month after you buy the new flat (or at Home 2 possession if you choose to move in there).'],
    emis: ['Home EMIs', 'Home 2 EMI + new flat EMI. Home 2: the EMI is recalculated each time the bank disburses (or is interest-only until possession in pre-EMI mode). New flat: a fixed EMI starting the month after purchase. Each EMI = interest on the outstanding loan + principal repaid.'],
    maint: ['Maintenance', 'Society maintenance and property tax you pay: Home 1 while you own it, Home 2 from possession, and the new flat after purchase. Grows with general inflation.'],
    lump: ['Lump sums', 'One-off money out (minus one-off money in): builder demands you pay yourself + down payment, stamp duty, fees and other purchase costs + one-time expenses + loan prepayments − Home 1 sale proceeds. Not part of "left after commitments"; paid from savings.'],
    surplus: ['Left after commitments', 'Income − (living & SIPs + rent + home EMIs + maintenance). What is left to save or spend on extras. Lump sums are not deducted here.'],
    avgSurplus: ['Avg left / month', 'Left after commitments for the period ÷ number of months. The February bonus is spread across the year in this average.'],
    committed: ['Commitments', 'Living & SIPs + rent + home EMIs + maintenance: the regular money that leaves every month.'],
    liquid: ['Savings & investments (end)', 'Cash plus all investments at the end of the period. Moves by: what is left after commitments − lump sums + any Home 1 sale + SIPs added + interest and investment returns. Shortfalls are drawn from cash first, then investments.'],
    loans: ['Loans (end)', 'Outstanding principal at the end of the period: Home 2 loan (grows with each bank disbursement, falls with principal repaid and prepayments) + new flat loan.'],
    netWorth: ['Net worth (end)', 'Savings & investments + value of the homes you own (each growing at its appreciation rate) − loans outstanding.']
  };
  function headTip(scope, key) { var h = COL_HELP[key]; return h ? T.attr(scope, function () { return tip(h[0], 'What this column means', '', esc(h[1])); }) : ''; }

  /** Explain one table cell. x = month or year row; prev = previous row (or null); r = run result. */
  function explainCell(key, x, prev, monthly, r) {
    var f = fmt(), per = periodLabel(x, monthly);
    switch (key) {
      case 'income':
        return tip('Income', per, calc([
          ['', 'Salary (in-hand)', x.salary], nz(x.bonus) && ['+', 'Bonus', x.bonus], nz(x.otherIncome) && ['+', 'Other income', x.otherIncome],
          nz(x.h1Rent) && ['+', 'Home 1 rent', x.h1Rent], nz(x.h2Rent) && ['+', 'Home 2 rent', x.h2Rent]
        ], ['Income', x.income]), stopNotes(r, 'income'));
      case 'livingSip':
        return tip('Living & SIPs', per, calc([['', 'Living expenses', x.living], ['+', 'SIPs (go into investments)', x.sip]], ['Living & SIPs', x.living + x.sip]),
          'Each expense line grows every January by its own rise % (blank = general inflation of ' + pct(+r.inputs.settings.inflationPct || 0) + ').' + (stopNotes(r, 'expenses') ? '<br>' + stopNotes(r, 'expenses') : ''));
      case 'rent': {
        var pu = r.res.purchase, re = r.inputs.rent.endMonth;
        return tip('Rent', per, calc([['', 'Rent paid', x.rent]]), 'Rises ' + pct(+r.inputs.rent.escalationPct || 0) + ' each ' + S.CAL[(r.inputs.rent.renewalMonth || 1) - 1][1] + '.' + (pu ? ' Stops after ' + monthName(pu.ym) + ' when you buy.' : '') + (re ? ' You stop paying rent after ' + monthName(re) + '.' : ''));
      }
      case 'emis':
        return tip('Home EMIs', per, calc([
          nz(x.emi2) && ['', 'Home 2 EMI', x.emi2], nz(x.emi2) && ['', '   of which interest', x.int2], nz(x.emi2) && ['', '   of which principal', x.emi2 - x.int2],
          nz(x.emi3) && ['+', 'New flat EMI', x.emi3], nz(x.emi3) && ['', '   of which interest', x.int3], nz(x.emi3) && ['', '   of which principal', x.emi3 - x.int3]
        ], ['Home EMIs', x.emi2 + x.emi3]), r.inputs.home2.loan.mode === 'preemi' ? 'Home 2 is interest-only (pre-EMI) until possession, then the full EMI starts.' : 'Home 2 EMI is recalculated on the amount disbursed so far over the remaining tenure.');
      case 'maint':
        return tip('Maintenance', per, calc([['', 'Maintenance & property tax', x.maint]]), 'Home 1 while owned + Home 2 from possession + new flat after purchase, growing with inflation.');
      case 'lump':
        return tip('Lump sums', per, calc([
          ['', 'Builder demands you pay', x.h2Self], ['+', 'Down payment & purchase costs', x.upfront], ['+', 'One-time expenses', x.oneOff], ['+', 'Loan prepayments', x.prepay], ['−', 'Home 1 sale proceeds', x.saleProceeds]
        ].filter(function (l) { return nz(l[2]); }), ['Lump sums', x.h2Self + x.upfront + x.oneOff + x.prepay - x.saleProceeds]), 'Paid from (or added to) savings; not part of "left after commitments".');
      case 'surplus': case 'avgSurplus': case 'committed': {
        var lines = [['', 'Income', x.income], ['−', 'Living & SIPs', x.living + x.sip], ['−', 'Rent', x.rent], ['−', 'Home EMIs', x.emi2 + x.emi3], ['−', 'Maintenance', x.maint]].filter(function (l, li) { return li === 0 || nz(l[2]); });
        if (key === 'committed') return tip('Commitments', per, calc(lines.slice(1).map(function (l) { return ['+', l[1], l[2]]; }), ['Commitments', x.committed]));
        var body = calc(lines, ['Left after commitments', x.surplus]);
        if (key === 'avgSurplus' && !monthly) body += calc([['', 'Left after commitments', x.surplus], ['÷', 'Months', String(x.months)]], ['Average per month', x.avgSurplus]);
        return tip(key === 'avgSurplus' ? 'Average left per month' : 'Left after commitments', per, body);
      }
      case 'liquid': {
        var start = prev ? prev.liquid : startLiquid(r);
        var lump = x.h2Self + x.upfront + x.oneOff + x.prepay;
        var growth = x.liquid - start - x.net - x.sip;
        return tip('Savings & investments', 'At end of ' + (monthly ? monthName(x.ym) : x.year), calc([
          ['', prev ? 'At end of previous ' + (monthly ? 'month' : 'year') : 'Starting cash + investments', start],
          ['+', 'Left after commitments', x.surplus], nz(lump) && ['−', 'Lump sums paid', lump], nz(x.saleProceeds) && ['+', 'Home 1 sale proceeds', x.saleProceeds],
          nz(x.sip) && ['+', 'SIPs invested', x.sip], ['+', 'Interest & investment returns', growth]
        ], ['Savings & investments', x.liquid]) + calc([['', 'Cash', x.cash], ['+', 'Investments', x.invested]], ['Total', x.liquid]),
        'Cash above your "cash to keep aside" is moved into your first investment.');
      }
      case 'loans':
        return tip('Loans outstanding', 'At end of ' + (monthly ? monthName(x.ym) : x.year), calc([['', 'Home 2 loan', x.loan2], ['+', 'New flat loan', x.loan3]], ['Loans', x.loans]),
          'Principal repaid in this period: ' + esc(f.full((x.emi2 - x.int2) + (x.emi3 - x.int3))) + (nz(x.prepay) ? ', plus prepayments ' + esc(f.full(x.prepay)) : '') + '.');
      case 'netWorth':
        return tip('Net worth', 'At end of ' + (monthly ? monthName(x.ym) : x.year), calc([
          ['', 'Savings & investments', x.liquid], nz(x.h1Value) && ['+', 'Home 1 value', x.h1Value], nz(x.h2Value) && ['+', 'Home 2 value', x.h2Value], nz(x.h3Value) && ['+', 'New flat value', x.h3Value],
          nz(x.loan2) && ['−', 'Home 2 loan', x.loan2], nz(x.loan3) && ['−', 'New flat loan', x.loan3]
        ], ['Net worth', x.netWorth]), 'Home values grow at their appreciation rates.');
    }
    return '';
  }
  function rowAt(r, ym) { return r.res.rows.find(function (x) { return x.ym === ym; }); }

  var METRIC_HELP = {
    upfront: 'Cash you must pay in the purchase month: down payment + stamp duty & registration + loan processing fee + other one-time costs. Lower is better.',
    emi3: 'Monthly EMI on the new flat loan (price − down payment) at the loan rate over the tenure. Lower is better.',
    peakEmi: 'The highest combined Home 2 + new flat EMI in any month of the projection. Lower is better.',
    avgSurplusFirstYear: 'Average of "left after commitments" over the first 12 months. Higher is better.',
    minSurplus: 'The single month with the least left after commitments (income − commitments). Negative means that month needs savings. Higher is better.',
    avgSurplusLastYear: 'Average of "left after commitments" over the last 12 months of the projection. Higher is better.',
    minLiquid: 'The lowest point of cash + investments over the projection, usually right after the down payment. Higher is safer.',
    minCover: 'Savings & investments ÷ that month\'s commitments, at its lowest point: how many months you could keep paying everything with no income. Higher is safer.',
    interest: 'Total interest paid on both home loans over the projection. Lower is better.',
    rentPaid: 'Total rent paid for the flat you live in now over the projection. Lower is better.',
    endLiquid: 'Cash + investments in the last month of the projection. Higher is better.',
    endLoans: 'Loan principal still owed in the last month. Lower is better.',
    endNetWorth: 'Savings & investments + home values − loans, in the last month. Higher is better.',
    upfrontKpi: '', netOutgo: 'How much more (or less) leaves your account each month once you own the new flat, compared with the same month if you kept renting.',
    emi2: 'Home 2 EMI in the first month of the projection and at its highest, as the bank keeps disbursing.'
  };
  /** Explain a summary measure for one scenario run. */
  function explainMetric(key, r) {
    var f = fmt(), s = r.res.summary, pu = r.res.purchase, x, n;
    switch (key) {
      case 'upfront':
        if (!pu) return tip('Upfront cash needed', 'Not buying', '', 'This scenario does not buy the new flat.');
        return tip('Upfront cash needed', 'In ' + monthName(pu.ym), calc([
          ['', 'Down payment', pu.down], ['+', 'Stamp duty & registration (' + pct(+r.inputs.purchase.stampDutyPct || 0) + ' of ' + f.short(pu.price) + ')', pu.stamp],
          ['+', 'Processing fee (' + pct(+r.inputs.purchase.processingFeePct || 0) + ' of loan)', pu.fee], ['+', 'Other costs', pu.other]
        ], ['Upfront cash', pu.upfront]) + fundingCalc(r));
      case 'emi3':
        if (!pu) return tip('New flat EMI', 'Not buying', '', 'This scenario does not buy the new flat.');
        n = Math.round((+r.inputs.purchase.tenureYears || 0) * 12);
        return tip('New flat EMI', 'Fixed monthly payment', calc([
          ['', 'Loan amount P = price − down payment', pu.loan], ['', 'Monthly rate r = ' + pct(+r.inputs.purchase.loanRatePct || 0) + ' ÷ 12', (Math.round(r.inputs.purchase.loanRatePct / 12 * 10000) / 10000) + '%'], ['', 'Months n', String(n)]
        ], ['EMI', pu.emi]), 'EMI = P × r × (1+r)<sup>n</sup> ÷ ((1+r)<sup>n</sup> − 1). It starts the month after purchase.');
      case 'peakEmi':
        x = rowAt(r, s.peakEmiYM);
        return tip('Peak total EMI', 'In ' + monthName(s.peakEmiYM), calc([['', 'Home 2 EMI', x.emi2], ['+', 'New flat EMI', x.emi3]], ['Total EMI', x.emi2 + x.emi3]));
      case 'avgSurplusFirstYear': case 'avgSurplusLastYear': {
        var rows = key === 'avgSurplusFirstYear' ? r.res.rows.slice(0, 12) : r.res.rows.slice(-12);
        var sum = rows.reduce(function (a, q) { return a + q.surplus; }, 0);
        return tip(key === 'avgSurplusFirstYear' ? 'Left per month, first year' : 'Left per month, final year', monthName(rows[0].ym) + ' to ' + monthName(rows[rows.length - 1].ym),
          calc([['', 'Sum of "left after commitments"', sum], ['÷', 'Months', String(rows.length)]], ['Average per month', s[key]]), 'Includes the yearly bonus spread across the months.');
      }
      case 'minSurplus':
        x = rowAt(r, s.minSurplusYM);
        return tip('Tightest month', monthName(s.minSurplusYM), calc([['', 'Income', x.income], ['−', 'Living & SIPs', x.living + x.sip], ['−', 'Rent', x.rent], ['−', 'Home EMIs', x.emi2 + x.emi3], ['−', 'Maintenance', x.maint]].filter(function (l, li) { return li === 0 || nz(l[2]); }), ['Left after commitments', x.surplus]));
      case 'minLiquid':
        x = rowAt(r, s.minLiquidYM);
        return tip('Lowest savings & investments', 'End of ' + monthName(s.minLiquidYM), calc([['', 'Cash', x.cash], ['+', 'Investments', x.invested]], ['Savings & investments', x.liquid]),
          x.liquid < 0 ? 'Below zero means you would need to borrow or sell something to get through.' : '');
      case 'minCover':
        x = rowAt(r, s.minCoverYM);
        return tip('Lowest cover', 'End of ' + monthName(s.minCoverYM), calc([['', 'Savings & investments', x.liquid], ['÷', 'Commitments that month', x.committed]], ['Months of cover', s.minCover >= 99 ? '–' : s.minCover.toFixed(1)]),
          'Your safety-buffer target is ' + (+r.inputs.settings.emergencyMonths || 0) + ' months.');
      case 'interest':
        return tip('Loan interest paid', 'Whole projection', calc([['', 'Home 2 loan interest', r.res.totals.int2], ['+', 'New flat loan interest', r.res.totals.int3]], ['Total interest', r.res.totals.int2 + r.res.totals.int3]));
      case 'rentPaid':
        n = r.res.rows.filter(function (q) { return q.rent > 0; }).length;
        return tip('Rent paid', 'Whole projection', calc([['', 'Months of rent', String(n)], ['', 'Starting rent', +r.inputs.rent.monthly || 0]], ['Total rent', r.res.totals.rentPaid]), 'Rent rises ' + pct(+r.inputs.rent.escalationPct || 0) + ' at each renewal.');
      case 'endLiquid': case 'endLoans': case 'endNetWorth':
        x = r.res.rows[r.res.rows.length - 1];
        return explainCell({ endLiquid: 'liquid', endLoans: 'loans', endNetWorth: 'netWorth' }[key], x, r.res.rows[r.res.rows.length - 2], true, r);
      case 'netOutgo': {
        var i = E.parseYM(pu.ym) + 1;
        var a = r.res.rows.find(function (q) { return q.idx === i; }), b = r.cf.rows.find(function (q) { return q.idx === i; });
        return tip('Net change in monthly outgo', monthName(a.ym) + ', first month after buying', calc([
          ['', 'Commitments − income if you buy', a.committed - a.income], ['−', 'Commitments − income if you keep renting', b.committed - b.income]
        ], ['Change', (a.committed - a.income) - (b.committed - b.income)]) + calc([
          ['+', 'New flat EMI', a.emi3], ['+', 'Extra maintenance', a.maint - b.maint], ['−', 'Rent no longer paid', b.rent - a.rent], ['+', 'Rental income given up', b.income - a.income]
        ].filter(function (l) { return nz(l[2]); }), ['Change', (a.committed - a.income) - (b.committed - b.income)]), 'Positive means more money leaves each month than when renting.');
      }
      case 'emi2':
        return tip('Home 2 EMI', 'Now and at its peak', calc([['', 'EMI in ' + monthName(s.start), s.emi2Now], ['', 'Highest EMI, in ' + monthName(s.emi2PeakYM), s.emi2Peak]]), esc(COL_HELP.emis[1]));
      case 'netWorthVsRent': {
        var o = r.opp;
        if (!o) return explainMetric('endNetWorth', r);
        return explainMetric('endNetWorth', r) + '<div class="tip-title" style="margin-top:10px">Compared with keep renting</div>' +
          calc(o.parts.filter(function (p) { return nz(p.value); }).map(function (p) { return [p.value < 0 ? '−' : '+', p.label, Math.abs(p.value)]; }), ['Difference in net worth', o.netWorthDiff]);
      }
    }
    return '';
  }
  function fundingCalc(r) {
    var pu = r.res.purchase; if (!pu) return '';
    return '<div class="tip-sub" style="margin-top:8px">Paid from</div>' + calc([
      r.res.sale && ['', 'Home 1 sale', pu.fromSale], nz(pu.fromHoldings) && ['+', 'Investments you chose to redeem', pu.fromHoldings],
      nz(pu.fromCash) && ['+', 'Cash & that month\'s income', pu.fromCash], nz(pu.autoDrawn) && ['+', 'Auto-redeemed investments', pu.autoDrawn]
    ]);
  }
  function scenarioTip(r, name) {
    var f = fmt(), i = r.inputs, p = i.purchase, t = tierOf(r);
    var lines = p.enabled ? [
      ['', 'Buys the new flat in', monthName(i.purchase.month)], ['', 'Price', +p.price || 0], ['', 'Down payment', +p.downPayment || 0],
      ['', 'New loan', (r.res.purchase ? f.short(r.res.purchase.loan) : '–') + ' at ' + pct(+p.loanRatePct || 0) + ' for ' + p.tenureYears + ' yrs'],
      ['', 'Home 1', p.sellHome1 && i.home1.owned ? 'Sold in ' + monthName(p.home1SaleMonth) : 'Kept and rented out']
    ] : [['', 'New flat', 'Not bought (keep renting)'], ['', 'Home 2 after possession', { rentOut: 'Rented out', moveIn: 'Move in', vacant: 'Kept vacant' }[i.home2.afterPossession] || '']];
    return tip(name, 'Scenario · ' + t.label, calc(lines), 'Projection ' + monthName(i.settings.startMonth) + ' for ' + i.settings.horizonYears + ' years.');
  }

  // =====================================================================
  // Compare
  // =====================================================================
  var CMP_CHARTS = [['surplus', 'Left after commitments (12-month average)', 'line'], ['liquid', 'Savings & investments', 'line'], ['netWorth', 'Net worth', 'line'], ['committed', 'Yearly commitments', 'bar']];
  var CMP_METRICS = [
    ['upfront', 'Upfront cash needed', false, function (r) { return r.res.purchase ? r.res.purchase.upfront : 0; }],
    ['emi3', 'New flat EMI', false, function (r) { return r.res.summary.emi3; }],
    ['peakEmi', 'Peak total EMI', false, function (r) { return r.res.summary.peakEmi; }],
    ['avgSurplusFirstYear', 'Left / month, year 1 avg', true, function (r) { return r.res.summary.avgSurplusFirstYear; }],
    ['minSurplus', 'Tightest month', true, function (r) { return r.res.summary.minSurplus; }],
    ['avgSurplusLastYear', 'Left / month, final year', true, function (r) { return r.res.summary.avgSurplusLastYear; }],
    ['minLiquid', 'Lowest savings & inv.', true, function (r) { return r.res.summary.minLiquid; }],
    ['minCover', 'Lowest cover (months)', true, function (r) { return r.res.summary.minCover; }, 'months'],
    ['interest', 'Loan interest paid', false, function (r) { return r.res.totals.int2 + r.res.totals.int3; }],
    ['rentPaid', 'Rent paid', false, function (r) { return r.res.totals.rentPaid; }],
    ['endLiquid', 'Savings & inv. at end', true, function (r) { return r.res.summary.endLiquid; }],
    ['endLoans', 'Loans outstanding at end', false, function (r) { return r.res.summary.endLoans; }],
    ['endNetWorth', 'Net worth at end', true, function (r) { return r.res.summary.endNetWorth; }]
  ];
  function renderCompare(el) {
    var p = planner(), f = fmt();
    p.ui.compareIds = p.ui.compareIds.filter(function (id) { return p.scenarios.some(function (s) { return s.id === id; }); });
    var html = '<div class="view-head"><div class="grow"><h1>Compare scenarios</h1><p>Pick up to ' + MAX_COMPARE + '. Colors stay with each scenario.</p></div></div>';
    if (p.scenarios.length < 2) {
      el.innerHTML = html + '<div class="card"><p>You need at least two saved scenarios to compare.</p><div class="btn-row">' + (p.scenarios.length ? '' : '<button class="btn primary" data-act="starter">Create starter scenarios</button>') + '<button class="btn" data-act="new-scenario">New scenario</button></div></div>';
      return;
    }
    html += '<div class="pick-row">' + p.scenarios.map(function (s) {
      var i = p.ui.compareIds.indexOf(s.id), on = i >= 0;
      return '<label class="pick' + (on ? ' on' : '') + '"><input type="checkbox" data-act="cmp-toggle" data-id="' + s.id + '"' + (on ? ' checked' : '') + '>' + (on ? '<span class="swatch" style="background:var(--series-' + (i + 1) + ')"></span>' : '') + esc(scnName(p, s)) + '</label>';
    }).join('') + '</div>';
    var sel = p.ui.compareIds.map(function (id, i) { var s = p.scenarios.find(function (x) { return x.id === id; }); return { id: id, name: scnName(p, s), slot: i + 1, r: run(p.base, s.overrides) }; });
    if (sel.length < 2) { el.innerHTML = html + '<div class="card muted">Select at least two scenarios above.</div>'; return; }
    var items = sel.map(function (x) { return { id: x.id, name: x.name, slot: x.slot, res: x.r.res, cf: x.r.cf }; });
    var em = +sel[0].r.inputs.settings.emergencyMonths || 0;
    var rec = E.recommend(items, em);
    var best = rec.best;
    html += '<div class="card reco"><h2><span class="swatch" style="background:var(--series-' + sel.find(function (x) { return x.id === best.id; }).slot + ')"></span>Recommended: ' + esc(best.name) + '</h2>' +
      '<ul>' + rec.reasons.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      (rec.scored.some(function (x) { return x.flags.length; }) ? '<ul class="flag-list">' + rec.scored.map(function (x) { return x.flags.map(function (fl) { return '<li><span class="pill ' + (fl.level === 'critical' ? 'bad' : 'warn') + '">' + (fl.level === 'critical' ? 'Risk' : 'Watch') + '</span> <b>' + esc(x.name) + ':</b> ' + esc(fl.text) + '</li>'; }).join(''); }).join('') + '</ul>' : '') +
      '<p class="muted small" style="margin-top:8px">How this is chosen: options that never run out of savings and keep your ' + em + '-month buffer rank first; among those, the highest net worth at the end wins. It is a guide based on your assumptions, not financial advice.</p></div>';

    // metrics table
    T.reset('cmp');
    var scnHead = function (x) { return '<th class="has-tip"' + T.attr('cmp', function () { return scenarioTip(x.r, x.name); }) + '><span class="swatch" style="background:var(--series-' + x.slot + ');margin-right:6px"></span>' + scnHeadName(x.name) + '</th>'; };
    html += '<div class="card"><h3>Side by side</h3><p class="tip-hint" data-tiphint></p><div class="table-wrap"><table class="data"><thead><tr><th class="has-tip"' + T.attr('cmp', tip('Measure', 'Rows', '', 'Each row is one summary measure for the whole projection. Green marks the best value in the row; tap a measure for what it means.')) + '>Measure</th>' + sel.map(scnHead).join('') + '</tr></thead><tbody>';
    CMP_METRICS.forEach(function (m) {
      var vals = sel.map(function (x) { return m[3](x.r); });
      if (vals.every(function (v) { return Math.abs(v) < 0.5; })) return;
      var bestV = m[2] ? Math.max.apply(null, vals) : Math.min.apply(null, vals);
      var distinct = vals.some(function (v) { return Math.abs(v - vals[0]) > 0.5; });
      html += '<tr><td class="lbl-cell has-tip"' + T.attr('cmp', tip(m[1], 'What this measure means', '', esc(METRIC_HELP[m[0]] || ''))) + '>' + esc(m[1]) + '</td>' + vals.map(function (v, vi) {
        var shown = m[4] === 'months' ? (v >= 99 ? '–' : v.toFixed(1)) : f.short(v);
        var a = T.attr('cmp', function () { return explainMetric(m[0], sel[vi].r) + '<div class="tip-note">Scenario: ' + esc(sel[vi].name) + '</div>'; });
        return '<td class="has-tip ' + (distinct && v === bestV ? 'best' : '') + (v < -0.5 ? ' neg' : '') + '"' + a + '>' + shown + '</td>';
      }).join('') + '</tr>';
    });
    html += '</tbody></table></div><p class="chart-note">Green marks the best value in each row.</p></div>';

    // charts
    html += '<div class="compare-charts">' + CMP_CHARTS.map(function (c) { return '<div class="card"><h3>' + c[1] + '</h3><div class="chart-box"><canvas data-cmp="' + c[0] + '" role="img" aria-label="' + esc(c[1]) + '"></canvas></div></div>'; }).join('') + '</div>';

    // yearly table
    var opts = [['avgSurplus', 'Avg left / month'], ['surplus', 'Left after commitments (year)'], ['committed', 'Commitments (year)'], ['emis', 'Home EMIs (year)'], ['liquid', 'Savings & inv. (end of year)'], ['netWorth', 'Net worth (end of year)']];
    html += '<div class="card" style="margin-top:14px"><div class="table-tools"><h3 style="margin:0;flex:1">Year by year</h3><select id="cmpKey" class="btn sm">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (ui.cmpTableKey === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div><div class="table-wrap" id="cmpTable"></div></div>';
    el.innerHTML = html;
    CMP_CHARTS.forEach(function (c) {
      var cv = $('[data-cmp="' + c[0] + '"]', el);
      if (c[2] === 'line') C.compareLines(cv, items, c[0], f, c[0] === 'surplus'); else C.compareBars(cv, items, c[0], f);
    });
    function drawCmpTable() {
      var key = ui.cmpTableKey, ck = key === 'emis' ? 'emis' : key;
      var years = items[0].res.years;
      T.reset('cmpYears');
      var yHead = function (x) { return '<th class="has-tip"' + T.attr('cmpYears', function () { return scenarioTip(x.r, x.name); }) + '><span class="swatch" style="background:var(--series-' + x.slot + ');margin-right:6px"></span>' + scnHeadName(x.name) + '</th>'; };
      $('#cmpTable', el).innerHTML = '<table class="data"><thead><tr><th class="has-tip"' + T.attr('cmpYears', function () { var h = COL_HELP[ck]; return tip('Year', 'Showing: ' + $('#cmpKey', el).selectedOptions[0].textContent, '', esc(COL_HELP.period[1]) + (h ? '<br><br><b>' + esc(h[0]) + ':</b> ' + esc(h[1]) : '')); }) + '>Year</th>' + sel.map(yHead).join('') + '</tr></thead><tbody>' +
        years.map(function (y, yi) {
          var vals = items.map(function (it) { return it.res.years[yi] ? it.res.years[yi][key] : 0; });
          return '<tr><td>' + y.year + '</td>' + vals.map(function (v, vi) {
            var a = T.attr('cmpYears', function () { var ys = sel[vi].r.res.years; return ys[yi] ? explainCell(ck, ys[yi], yi > 0 ? ys[yi - 1] : null, false, sel[vi].r) + '<div class="tip-note">Scenario: ' + esc(sel[vi].name) + '</div>' : ''; });
            return '<td class="has-tip' + (v < -0.5 ? ' neg' : '') + '"' + a + '>' + f.short(v) + '</td>';
          }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
    }
    $('#cmpKey', el).addEventListener('change', function (e) { ui.cmpTableKey = e.target.value; drawCmpTable(); });
    drawCmpTable();
  }
  /** Scenario names as table headings: break at the " · " separators so long auto names stack instead of widening the table. */
  function scnHeadName(name) { return '<span class="th-name">' + String(name).split(' · ').map(esc).join(' ·<wbr> ') + '</span>'; }
  function toggleCompare(id, on) {
    var p = planner(), ids = p.ui.compareIds;
    var i = ids.indexOf(id);
    if (on && i < 0) {
      if (ids.length >= MAX_COMPARE) { toast('You can compare up to ' + MAX_COMPARE + ' scenarios. Untick one first.'); render(); return; }
      ids.push(id);
    } else if (!on && i >= 0) ids.splice(i, 1);
    save(); render();
  }

  // =====================================================================
  // Data view
  // =====================================================================
  function renderData(el) {
    var cur = planner();
    var html = '<div class="view-head"><div class="grow"><h1>Your data</h1><p>' + (sync && sync.configured() ? 'Stored in this browser and synced to your secret GitHub gist.' : 'Everything is stored only in this browser. Export to a file or turn on GitHub sync to keep a backup and use it on other devices.') + '</p></div></div>';
    html += '<div class="card"><div class="table-tools"><h2 style="margin:0;flex:1">Planners</h2><button class="btn primary sm" data-act="new-planner">+ New planner</button></div>';
    if (!db.planners.length) html += '<p class="muted">No planners yet.</p>';
    html += db.planners.map(function (p) {
      return '<div class="list-item" style="margin-bottom:8px"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:180px"><b>' + esc(p.name) + '</b>' + (cur && p.id === cur.id ? ' <span class="pill good">open</span>' : '') +
        '<div class="muted small">' + p.scenarios.length + ' scenario(s) · ' + esc(p.currency) + ' · updated ' + dateStr(p.updatedAt) + '</div></div>' +
        '<div class="btn-row">' + (cur && p.id === cur.id ? '' : '<button class="btn sm" data-act="switch-planner" data-id="' + p.id + '">Open</button>') +
        '<button class="btn sm" data-act="rename-planner" data-id="' + p.id + '">Rename</button>' +
        '<button class="btn sm" data-act="dup-planner" data-id="' + p.id + '">Duplicate</button>' +
        '<button class="btn sm" data-act="export-planner" data-id="' + p.id + '">Export</button>' +
        '<button class="btn sm danger" data-act="del-planner" data-id="' + p.id + '">Delete</button></div></div></div>';
    }).join('');
    html += '</div>';
    if (cur) {
      html += '<div class="card"><h2>Planner settings</h2><div class="field" style="max-width:360px"><label for="curSel">Currency for "' + esc(cur.name) + '"</label><div class="inp-wrap"><select id="curSel">' + CURRENCIES.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === cur.currency ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('') + '</select></div><div class="help">Changes the display only; amounts are not converted.</div></div></div>';
    }
    html += syncCardHtml();
    html += '<div class="card"><h2>Backup & restore</h2><p class="muted small">Last backup downloaded: ' + (db.lastBackupAt ? dateStr(db.lastBackupAt) : 'never') + '</p>' +
      '<div class="btn-row"><button class="btn primary" data-act="backup">Export all planners</button><button class="btn" data-act="import">Import from file</button></div>' +
      '<p class="muted small" style="margin-top:8px">Importing adds the planners from the file. If a planner already exists you can replace it or keep both.</p></div>';
    html += '<div class="card"><h2>Appearance</h2><div class="field" style="max-width:360px"><label for="themeSel">Theme</label><div class="inp-wrap"><select id="themeSel"><option value="auto">Match my device</option><option value="light">Light</option><option value="dark">Dark</option></select></div></div></div>';
    html += '<div class="card"><h2>Reset</h2><p class="muted small">Deletes every planner and scenario from this browser. Export first if you might want them back.</p><button class="btn danger" data-act="reset-all">Delete everything</button></div>';
    el.innerHTML = html;
    var cs = $('#curSel', el);
    if (cs) cs.addEventListener('change', function () { cur.currency = cs.value; touch(cur); save(); toast('Currency set to ' + cs.value); });
    bindSyncCard(el);
    var ts = $('#themeSel', el); ts.value = db.theme || 'auto';
    ts.addEventListener('change', function () { db.theme = ts.value; save(); applyTheme(); });
  }
  function exportPayload(planners) {
    return JSON.stringify({ app: APP_TAG, version: 1, exportedAt: new Date().toISOString(), planners: planners }, null, 2);
  }
  function exportAll() {
    if (ui.editor && ui.editor.dirty) toast('Note: unsaved editor changes are not in the backup.');
    download('home-planner-backup-' + today() + '.json', exportPayload(db.planners));
    db.lastBackupAt = new Date().toISOString(); save();
  }
  async function importFile(file) {
    var text = await file.text(), data;
    try { data = JSON.parse(text); } catch (e) { await modal({ title: 'Could not read file', body: '<p>That file is not valid JSON.</p>' }); return; }
    var planners = data && data.app === APP_TAG && Array.isArray(data.planners) ? data.planners : (data && data.base && data.scenarios ? [data] : null);
    if (!planners) { await modal({ title: 'Not a planner file', body: '<p>This file was not exported from Home Buying Planner.</p>' }); return; }
    var conflicts = planners.filter(function (p) { return db.planners.some(function (x) { return x.id === p.id; }); });
    var mode = 'keep';
    if (conflicts.length) {
      mode = await modal({
        title: 'Some planners already exist',
        body: '<p>' + conflicts.map(function (c) { return '<b>' + esc(c.name) + '</b>'; }).join(', ') + ' ' + (conflicts.length > 1 ? 'are' : 'is') + ' already in this browser.</p>',
        buttons: [{ label: 'Cancel', value: null }, { label: 'Keep both', value: 'keep' }, { label: 'Replace', value: 'replace', kind: 'primary' }]
      });
      if (!mode) return;
    }
    if (!(await guardDirty())) return;
    var lastId = null;
    planners.forEach(function (p) {
      p = upgradePlanner(E.clone(p));
      var i = db.planners.findIndex(function (x) { return x.id === p.id; });
      if (i >= 0 && mode === 'replace') db.planners[i] = p;
      else {
        if (i >= 0) { p.id = E.uid('pln'); p.name += ' (imported)'; }
        db.planners.push(p);
      }
      lastId = p.id;
    });
    db.activePlannerId = lastId; ui.editor = null;
    db.lastBackupAt = new Date().toISOString();
    save(); runCache.clear();
    toast('Imported ' + planners.length + ' planner(s)');
    setTab('scenarios');
  }

  // =====================================================================
  // GitHub sync
  // =====================================================================
  var SYNC_LABELS = { off: '', syncing: 'Syncing…', synced: 'Synced', error: 'Sync problem', conflict: 'Choose a version', pending: 'Sync waiting' };
  function setSyncStatus(state, detail) {
    syncState = { state: state, detail: detail };
    var b = $('#syncBadge');
    b.hidden = state === 'off';
    b.dataset.state = state;
    b.innerHTML = '<span>' + esc(SYNC_LABELS[state] || '') + '</span>';
    b.title = state === 'error' ? detail : state === 'synced' && detail ? 'Last synced ' + dateStr(detail) : 'GitHub sync';
    renderBanner();
    if (ui.tab === 'data' && $('#syncCard')) $('#syncCard').outerHTML = syncCardHtml(), bindSyncCard($('#view-data'));
  }
  function syncCardHtml() {
    var c = sync && sync.config();
    var h = '<div class="card" id="syncCard"><h2>Sync with GitHub</h2>';
    if (!c) {
      h += '<p class="muted small">Optional. Saves all your planners to a <b>secret gist</b> on your GitHub account so your PC and phone stay in step, and GitHub keeps every version. The token stays in this browser and is only sent to GitHub. A secret gist is unlisted, not locked: anyone who gets its link can read it, so never share the link.</p>' +
        '<ol class="steps"><li>Create a <a href="https://github.com/settings/tokens/new?scopes=gist&description=Home%20Buying%20Planner" target="_blank" rel="noopener">GitHub token with only the <code>gist</code> scope</a> (the link pre-selects it). Pick an expiry, then Generate and copy it.</li>' +
        '<li>Paste it below and connect. The first device creates the gist; other devices find it automatically with the same token.</li></ol>' +
        '<div class="field"><label for="syToken">Token</label><div class="inp-wrap"><input id="syToken" type="password" autocomplete="off" placeholder="ghp_… or github_pat_…"></div></div>' +
        '<details class="small" style="margin-bottom:10px"><summary class="muted">Advanced</summary><div class="field" style="margin-top:8px"><label for="syGist">Use a specific gist ID</label><div class="inp-wrap"><input id="syGist" type="text" placeholder="found automatically" autocomplete="off" autocapitalize="off" spellcheck="false"></div></div></details>' +
        '<div class="btn-row"><button class="btn primary" id="syConnect">Connect</button></div><div id="syMsg" class="small" style="margin-top:8px"></div>';
    } else {
      var st = syncState.state;
      var url = c.gistId ? 'https://gist.github.com/' + encodeURIComponent(c.login || '') + '/' + encodeURIComponent(c.gistId) : null;
      h += '<p class="small">Signed in as <b>' + esc(c.login || '') + '</b>' + (c.gistId ? ' · saving to secret gist <code>' + esc(c.gistId.slice(0, 8)) + '…</code>' : '') + '</p>' +
        '<p class="small"><span class="pill ' + (st === 'synced' ? 'good' : st === 'error' || st === 'conflict' ? 'bad' : 'warn') + '">' + esc(SYNC_LABELS[st] || 'Not synced yet') + '</span> ' +
        (st === 'error' ? esc(syncState.detail || '') : c.syncedAt ? '<span class="muted">Last synced ' + dateStr(c.syncedAt) + '</span>' : '') +
        (st === 'pending' ? ' <span class="muted">Newer data is waiting on GitHub; save or discard your open scenario to load it.</span>' : '') + '</p>' +
        '<label class="switch" style="margin:8px 0 12px"><input type="checkbox" id="syAuto"' + (c.auto ? ' checked' : '') + '> Sync automatically after every change</label>' +
        '<div class="btn-row"><button class="btn primary" id="sySync">Sync now</button>' + (url ? '<a class="btn" href="' + url + '/revisions" target="_blank" rel="noopener">Version history</a>' : '') + '<button class="btn danger" id="syOff">Disconnect this device</button></div>' +
        '<p class="muted small" style="margin-top:8px">Disconnecting removes the token from this browser only. Your data stays in the gist and in this browser.</p>';
    }
    return h + '</div>';
  }
  function bindSyncCard(el) {
    var btn = $('#syConnect', el);
    if (btn) btn.addEventListener('click', async function () {
      var c = { token: $('#syToken', el).value.trim(), gistId: $('#syGist', el).value.trim() };
      var msg = $('#syMsg', el);
      if (!c.token) { msg.textContent = 'Paste your token first.'; return; }
      btn.disabled = true; msg.textContent = 'Checking…';
      var t = await sync.test(c);
      btn.disabled = false;
      if (!t.ok) { msg.innerHTML = '<span style="color:var(--bad)">' + esc(t.message) + '</span>'; return; }
      c.login = t.login; c.gistId = t.gistId;
      msg.textContent = t.gistId ? 'Found your planner gist. Syncing…' : 'Creating a secret gist…';
      await sync.connect(c);
      if (syncState.state === 'synced') toast('Connected to GitHub');
      if (ui.tab === 'data') render();
    });
    var s1 = $('#sySync', el); if (s1) s1.addEventListener('click', function () { sync.sync('manual'); });
    var a1 = $('#syAuto', el); if (a1) a1.addEventListener('change', function () { sync.setAuto(a1.checked); });
    var o1 = $('#syOff', el); if (o1) o1.addEventListener('click', async function () {
      if (await confirmBox('Disconnect GitHub sync?', 'This removes the token from this browser. Your data stays in the gist and here.', 'Disconnect')) { sync.disconnect(); render(); }
    });
  }
  function initSync() {
    if (!window.HBPSync || !window.fetch) return;
    sync = HBPSync.create({
      getPlanners: function () { return db.planners; },
      payload: function (pl) { return exportPayload(pl); },
      canApplyRemote: function () { return !(ui.editor && ui.editor.dirty); },
      applyRemote: function (planners) {
        db.planners = planners.map(function (p) { return upgradePlanner(E.clone(p)); });
        if (!db.planners.some(function (p) { return p.id === db.activePlannerId; })) db.activePlannerId = db.planners[0] ? db.planners[0].id : null;
        if (ui.editor && !planner()) ui.editor = null;
        if (ui.editor && ui.editor.scenarioId && !planner().scenarios.some(function (x) { return x.id === ui.editor.scenarioId; })) ui.editor = null;
        try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* ignore */ }
        runCache.clear();
        render();
        toast('Loaded the latest data from GitHub');
      },
      resolveConflict: function () {
        return modal({
          title: 'Two different versions',
          body: '<p>Your planners were changed on another device <b>and</b> in this browser since the last sync.</p><p class="muted small">Pick which one to keep. The other is not lost: GitHub keeps every synced version, and you can export this browser\'s copy from Data first.</p>',
          buttons: [{ label: 'Decide later', value: null }, { label: 'Keep this browser\'s', value: 'local' }, { label: 'Load from GitHub', value: 'remote', kind: 'primary' }]
        });
      },
      onStatus: setSyncStatus
    });
    if (sync.configured()) { setSyncStatus('syncing'); sync.sync('start'); }
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') sync.maybePull(); });
    window.addEventListener('online', function () { sync.sync('online'); });
  }

  // =====================================================================
  // Theme
  // =====================================================================
  function applyTheme() {
    var t = db.theme || 'auto';
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    C.applyDefaults();
    C.destroyAll(document.body);
    if (db.planners.length) render();
  }

  // =====================================================================
  // Global actions (event delegation)
  // =====================================================================
  document.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-act]');
    if (b && b.closest('#scnForm, #profileForm')) return; // handled by form
    var tb = e.target.closest('#tabs button');
    if (tb) {
      if (tb.dataset.tab !== ui.tab) setTab(tb.dataset.tab);
      return;
    }
    if (!b) return;
    var act = b.dataset.act, id = b.dataset.id, p = planner();
    if (b.tagName === 'A') e.preventDefault();
    switch (act) {
      case 'tab': setTab(b.dataset.tab); break;
      case 'new-scenario': newScenarioFlow(); break;
      case 'starter': createStarters(); setTab(p.scenarios.length >= 2 ? 'compare' : 'scenarios'); break;
      case 'go-compare': setTab('compare'); break;
      case 'profile-done':
        if (!p.scenarios.length) { createStarters(); setTab('compare'); } else setTab('scenarios');
        break;
      case 'open': if (await guardDirty()) openEditor(id); break;
      case 'dup': {
        var s = p.scenarios.find(function (x) { return x.id === id; });
        addScenario(p, uniqueName(p, s.name + ' (copy)'), false, E.clone(s.overrides));
        touch(p); save(); render(); toast('Duplicated');
        break;
      }
      case 'rename': {
        var s2 = p.scenarios.find(function (x) { return x.id === id; });
        var nm = await promptBox('Rename scenario', 'Name', s2.name);
        if (nm) { s2.name = uniqueName(p, nm, s2.id); s2.nameAuto = false; s2.updatedAt = new Date().toISOString(); touch(p); save(); if (ui.editor && ui.editor.scenarioId === id) { ui.editor.name = s2.name; ui.editor.nameAuto = false; } render(); }
        break;
      }
      case 'del': {
        var s3 = p.scenarios.find(function (x) { return x.id === id; });
        if (await confirmBox('Delete scenario?', 'Delete <b>' + esc(s3.name) + '</b>? This cannot be undone.', 'Delete', true)) {
          p.scenarios = p.scenarios.filter(function (x) { return x.id !== id; });
          p.ui.compareIds = p.ui.compareIds.filter(function (x) { return x !== id; });
          if (ui.editor && ui.editor.scenarioId === id) ui.editor = null;
          touch(p); save(); render();
        }
        break;
      }
      case 'close-editor': if (await guardDirty()) { ui.editor = null; setTab('scenarios'); } break;
      case 'backup': exportAll(); break;
      case 'hide-banner': ui.bannerHidden = true; renderBanner(); break;
      case 'import': $('#importFile').click(); break;
      case 'new-planner': newPlannerFlow(); break;
      case 'switch-planner': await switchPlanner(id); setTab('scenarios'); break;
      case 'rename-planner': {
        var pl = db.planners.find(function (x) { return x.id === id; });
        var n2 = await promptBox('Rename planner', 'Name', pl.name);
        if (n2) { pl.name = n2; touch(pl); save(); render(); }
        break;
      }
      case 'dup-planner': {
        var src = db.planners.find(function (x) { return x.id === id; });
        var cp = E.clone(src); cp.id = E.uid('pln'); cp.name = src.name + ' (copy)'; cp.createdAt = cp.updatedAt = new Date().toISOString();
        db.planners.push(cp); save(); render(); toast('Planner duplicated');
        break;
      }
      case 'export-planner': {
        var pe = db.planners.find(function (x) { return x.id === id; });
        download('home-planner-' + slug(pe.name) + '-' + today() + '.json', exportPayload([pe]));
        break;
      }
      case 'del-planner': {
        var pd = db.planners.find(function (x) { return x.id === id; });
        if (await confirmBox('Delete planner?', 'Delete <b>' + esc(pd.name) + '</b> and its ' + pd.scenarios.length + ' scenario(s)? Export it first if you might need it.', 'Delete', true)) {
          db.planners = db.planners.filter(function (x) { return x.id !== id; });
          if (db.activePlannerId === id) { db.activePlannerId = db.planners[0] ? db.planners[0].id : null; ui.editor = null; }
          save(); render();
        }
        break;
      }
      case 'reset-all':
        if (await confirmBox('Delete everything?', 'This removes all planners and scenarios from this browser. It cannot be undone.', 'Delete everything', true)) {
          var theme = db.theme; db = emptyDb(); db.theme = theme; ui.editor = null; save(); runCache.clear(); ui.tab = 'scenarios'; render();
        }
        break;
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.act === 'cmp-toggle') toggleCompare(t.dataset.id, t.checked);
  });
  $('#plannerSelect').addEventListener('change', function (e) {
    var v = e.target.value;
    if (v === '__new') { renderChrome(); newPlannerFlow(); } else switchPlanner(v);
  });
  $('#importFile').addEventListener('change', function (e) {
    var f = e.target.files[0]; e.target.value = '';
    if (f) importFile(f);
  });
  window.addEventListener('beforeunload', function (e) {
    if (ui.editor && ui.editor.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if ((db.theme || 'auto') === 'auto') applyTheme(); });
  }
  var resizeT;
  window.addEventListener('resize', function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { if (ui.tab === 'editor' && ui.editor) { var r = run(planner().base, ui.editor.overrides); updateResults($('#scnResults'), r, true); } }, 200);
  });

  // =====================================================================
  // Boot
  // =====================================================================
  load();
  initSync();
  if (!db.activePlannerId && db.planners.length) db.activePlannerId = db.planners[0].id;
  try { var t0 = sessionStorage.getItem('hbp.tab'); if (t0 && t0 !== 'editor') ui.tab = t0; } catch (e) { /* ignore */ }
  if (planner() && ui.tab === 'scenarios' && E.missingRequired(planner().base).length && !planner().scenarios.length) ui.tab = 'profile';
  applyTheme();
  if (!db.planners.length) render();

  // test hook
  window.HBPApp = { sync: function () { return sync; }, db: function () { return db; }, run: run, parseAmount: parseAmount, fmtFor: fmtFor };
})();

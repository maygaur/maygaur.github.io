/*
 * Home Buying Planner - calculation engine.
 * Pure functions, no DOM. Works in the browser (window.HBPEngine) and in Node (module.exports).
 *
 * Months are integer indexes: year * 12 + (month - 1). "2026-11" <-> 24321.
 */
(function (root) {
  'use strict';

  // ---------- small helpers ----------
  function parseYM(s) {
    if (s == null || s === '') return null;
    var m = /^(\d{4})-(\d{1,2})/.exec(String(s));
    if (!m) return null;
    var mo = +m[2];
    if (mo < 1 || mo > 12) return null;
    return (+m[1]) * 12 + (mo - 1);
  }
  function ymStr(i) {
    var y = Math.floor(i / 12), m = (i % 12) + 1;
    return y + '-' + (m < 10 ? '0' : '') + m;
  }
  function addMonths(s, n) { var i = parseYM(s); return i == null ? null : ymStr(i + n); }
  function num(v) { var n = +v; return isFinite(n) ? n : 0; }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function uid(p) { return (p || 'id') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }

  function getPath(obj, path) {
    var parts = path.split('.'), o = obj;
    for (var i = 0; i < parts.length; i++) { if (o == null) return undefined; o = o[parts[i]]; }
    return o;
  }
  function setPath(obj, path, val) {
    var parts = path.split('.'), o = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = val;
  }

  /** Standard reducing-balance EMI. */
  function emi(principal, annualPct, months) {
    if (principal <= 0) return 0;
    if (months <= 0) return principal;
    var r = annualPct / 1200;
    if (r === 0) return principal / months;
    var f = Math.pow(1 + r, months);
    return principal * r * f / (f - 1);
  }

  function currentYM() {
    var d = new Date();
    return ymStr(d.getFullYear() * 12 + d.getMonth());
  }

  // ---------- default (blank) inputs ----------
  function blankBase(startMonth) {
    var start = startMonth || addMonths(currentYM(), 1);
    return {
      settings: { startMonth: start, horizonYears: 10, inflationPct: 6, emergencyMonths: 6 },
      income: {
        salaryMonthly: null, hikePct: 8, hikeMonth: 1,
        bonusAnnual: 0, bonusGrowthPct: 5, bonusMonth: 2,
        otherMonthly: 0, otherGrowthPct: 0
      },
      expenses: {
        items: [
          { id: 'exp_living', name: 'Household & living', monthly: null, growthPct: null, kind: 'expense' }
        ],
        oneOffs: []
      },
      rent: { monthly: null, escalationPct: 5, renewalMonth: null },
      home1: {
        owned: true, value: 0, appreciationPct: 5,
        rentMonthly: 0, rentEscalationPct: 5, rentEscalationMonth: null,
        maintenanceMonthly: 0, sellingCostPct: 2, capitalGainsTax: 0
      },
      home2: {
        owned: true, value: 0, appreciationPct: 5, possessionMonth: null,
        loan: { outstanding: 0, ratePct: 8.5, remainingYears: 20, mode: 'emi' },
        schedule: [],
        afterPossession: 'rentOut', rentMonthly: 0, rentStartDelayMonths: 2, rentEscalationPct: 5,
        maintenanceMonthly: 0
      },
      assets: {
        cash: 0, cashReturnPct: 3, cashBuffer: null,
        holdings: [{ id: 'hold_inv', name: 'Investments (MF / stocks)', balance: 0, returnPct: 10 }]
      },
      purchase: {
        enabled: true, price: null, month: null,
        stampDutyPct: 7, otherCosts: 0, downPayment: null,
        loanRatePct: 8.5, tenureYears: 20, processingFeePct: 0.5,
        appreciationPct: 5, maintenanceMonthly: 0,
        sellHome1: false, home1SaleMonth: null, draws: {}
      },
      prepayments: []
    };
  }

  /** Merge base + scenario overrides into one full input object (suggestions not yet applied). */
  function resolveInputs(base, overrides) {
    var inp = clone(base);
    if (overrides) Object.keys(overrides).forEach(function (p) { setPath(inp, p, clone(overrides[p])); });
    return inp;
  }

  /**
   * Fill fields left blank (null) with suggested values.
   * Returns { inputs, suggested } where suggested maps path -> suggested value (for all suggestible fields).
   */
  function applySuggestions(raw) {
    var inp = clone(raw), sug = {};
    var s = inp.settings, startIdx = parseYM(s.startMonth);
    function fill(path, val) {
      sug[path] = val;
      var cur = getPath(inp, path);
      if (cur === null || cur === undefined || cur === '') setPath(inp, path, val);
    }
    var startCal = ymStr(startIdx).slice(5);
    fill('rent.renewalMonth', +startCal);
    fill('home1.rentEscalationMonth', +startCal);
    fill('home2.possessionMonth', ymStr(startIdx + 12));
    (inp.expenses.items || []).forEach(function (it, i) {
      if (it.growthPct === null || it.growthPct === undefined || it.growthPct === '') it.growthPct = num(s.inflationPct);
      sug['expenses.items.' + i + '.growthPct'] = num(s.inflationPct);
    });
    var p = inp.purchase;
    fill('purchase.month', ymStr(startIdx + 2));
    // 20% of price; when selling Home 1, put its estimated net proceeds (after purchase costs) into the down payment instead
    var price = num(p.price), dp = price * 0.2;
    if (p.enabled && p.sellHome1 && inp.home1.owned && num(inp.home1.value) > 0) {
      var net1 = num(inp.home1.value) * (1 - num(inp.home1.sellingCostPct) / 100) - num(inp.home1.capitalGainsTax);
      var costs = price * num(p.stampDutyPct) / 100 + num(p.otherCosts);
      dp = Math.max(dp, Math.min(price, net1 - costs));
    }
    fill('purchase.downPayment', Math.round(dp / 10000) * 10000);
    fill('purchase.home1SaleMonth', inp.purchase.month);

    // cash buffer: emergency months x today's committed monthly outflow
    var exp = (inp.expenses.items || []).reduce(function (a, it) { return a + num(it.monthly); }, 0);
    var l = inp.home2.loan, emi2 = 0;
    if (inp.home2.owned && num(l.outstanding) > 0) {
      emi2 = l.mode === 'preemi' ? num(l.outstanding) * num(l.ratePct) / 1200
        : emi(num(l.outstanding), num(l.ratePct), Math.round(num(l.remainingYears) * 12));
    }
    var buf = Math.round(num(s.emergencyMonths) * (exp + num(inp.rent.monthly) + emi2) / 10000) * 10000;
    fill('assets.cashBuffer', buf);
    return { inputs: inp, suggested: sug };
  }

  /** Required fields that are still empty. */
  function missingRequired(inp) {
    var miss = [];
    if (inp.income.salaryMonthly == null || inp.income.salaryMonthly === '') miss.push({ path: 'income.salaryMonthly', label: 'Monthly in-hand salary' });
    if (inp.rent.monthly == null || inp.rent.monthly === '') miss.push({ path: 'rent.monthly', label: 'Current monthly rent' });
    if ((inp.expenses.items || []).some(function (it) { return it.monthly == null || it.monthly === ''; }))
      miss.push({ path: 'expenses.items', label: 'Monthly amount for every expense line' });
    if (inp.purchase.enabled && !(num(inp.purchase.price) > 0)) miss.push({ path: 'purchase.price', label: 'Price of the flat you want to buy' });
    return miss;
  }

  // ---------- simulation ----------
  function Loan(principal, ratePct, endIdx) {
    this.P = Math.max(0, num(principal)); this.rate = num(ratePct); this.endIdx = endIdx;
    this.emi = null; this.recalc = true;
  }
  /** Pay one month. interestOnly = pre-EMI. Returns {pay, interest, principal}. */
  Loan.prototype.pay = function (idx, interestOnly) {
    if (this.P <= 0.5) { this.P = 0; return { pay: 0, interest: 0, principal: 0 }; }
    var interest = this.P * this.rate / 1200;
    if (interestOnly) return { pay: interest, interest: interest, principal: 0 };
    var left = this.endIdx - idx;
    if (this.recalc || this.emi == null) { this.emi = emi(this.P, this.rate, Math.max(1, left)); this.recalc = false; }
    var pay = left <= 1 ? this.P + interest : Math.min(this.emi, this.P + interest);
    var principal = pay - interest;
    this.P -= principal;
    if (this.P < 0.5) this.P = 0;
    return { pay: pay, interest: interest, principal: principal };
  };

  function growM(pct) { return Math.pow(1 + num(pct) / 100, 1 / 12); }

  /**
   * Run a monthly projection.
   * opts.counterfactual = true -> same inputs but the new flat is not bought (keep renting).
   */
  function simulate(rawInputs, opts) {
    opts = opts || {};
    var inp = applySuggestions(rawInputs).inputs;
    var s = inp.settings, I = inp.income, R = inp.rent, H1 = inp.home1, H2 = inp.home2, A = inp.assets, P = inp.purchase;
    var start = parseYM(s.startMonth);
    var N = Math.max(12, Math.round(num(s.horizonYears) * 12));
    var warnings = [];

    var buying = !!P.enabled && !opts.counterfactual && num(P.price) > 0;
    var pIdx = buying ? parseYM(P.month) : null;
    if (buying && (pIdx == null || pIdx < start)) { pIdx = start; }
    var saleIdx = buying && P.sellHome1 && H1.owned ? (parseYM(P.home1SaleMonth) != null ? parseYM(P.home1SaleMonth) : pIdx) : null;
    if (saleIdx != null && saleIdx < start) saleIdx = start;
    var possIdx = parseYM(H2.possessionMonth);

    // state
    var salary = num(I.salaryMonthly), bonus = num(I.bonusAnnual), other = num(I.otherMonthly);
    var items = (inp.expenses.items || []).map(function (it) {
      return { name: it.name, cur: num(it.monthly), g: num(it.growthPct), kind: it.kind || 'expense', holdingId: it.holdingId };
    });
    var rent = num(R.monthly);
    var h1 = { owned: !!H1.owned, value: num(H1.value), rent: num(H1.rentMonthly), maint: num(H1.maintenanceMonthly) };
    var h2 = { owned: !!H2.owned, value: num(H2.value), rent: num(H2.rentMonthly), maint: num(H2.maintenanceMonthly), rentStartIdx: null };
    var loan2 = new Loan(H2.owned ? H2.loan.outstanding : 0, H2.loan.ratePct, start + Math.round(num(H2.loan.remainingYears) * 12));
    var loan3 = null, h3 = null;
    var cash = num(A.cash), buffer = num(A.cashBuffer);
    var holdings = (A.holdings || []).map(function (h) { return { id: h.id, name: h.name, bal: num(h.balance), g: growM(h.returnPct) }; });
    if (!holdings.length) holdings.push({ id: 'hold_auto', name: 'Investments', bal: 0, g: growM(10) });
    function holdingIndex(id) { for (var k = 0; k < holdings.length; k++) if (holdings[k].id === id) return k; return 0; }
    var cashG = num(A.cashReturnPct) / 1200;

    var sched = {};
    (H2.owned ? H2.schedule || [] : []).forEach(function (e) {
      var i = parseYM(e.month); if (i == null) return;
      if (i < start) i = start;
      (sched[i] = sched[i] || []).push(e);
    });
    var oneOffs = {};
    (inp.expenses.oneOffs || []).forEach(function (e) {
      var i = parseYM(e.month); if (i == null || i < start) return;
      oneOffs[i] = (oneOffs[i] || 0) + num(e.amount);
    });
    var prepay = {};
    (inp.prepayments || []).forEach(function (e) {
      var i = parseYM(e.month); if (i == null || i < start) return;
      if (e.loan === 'home3' && !buying) return;
      (prepay[i] = prepay[i] || []).push(e);
    });

    var maintG = growM(s.inflationPct);
    var lastSchedIdx = Object.keys(sched).reduce(function (a, k) { return Math.max(a, +k); }, -1);
    var preEmiUntil = possIdx != null ? possIdx : lastSchedIdx + 1;
    var moveInHome2 = H2.owned && H2.afterPossession === 'moveIn' && possIdx != null;
    if (buying && moveInHome2) warnings.push('Home 2 is set to "move in" but this scenario also buys the new flat; rent stops when the new flat is bought.');

    var rows = [];
    var tot = { rentPaid: 0, h1Rent: 0, h2Rent: 0, int2: 0, int3: 0, maint3: 0, emi2: 0, emi3: 0, income: 0 };
    var purchaseInfo = null, saleInfo = null;

    for (var m = 0; m < N; m++) {
      var idx = start + m, cal = (idx % 12) + 1;
      // ---- yearly step-ups (not in the first month) ----
      if (m > 0) {
        if (cal === num(I.hikeMonth || 1)) {
          salary *= 1 + num(I.hikePct) / 100;
          other *= 1 + num(I.otherGrowthPct) / 100;
        }
        if (cal === num(I.bonusMonth || 2)) bonus *= 1 + num(I.bonusGrowthPct) / 100;
        if (cal === 1) items.forEach(function (it) { it.cur *= 1 + it.g / 100; });
        if (cal === num(R.renewalMonth)) rent *= 1 + num(R.escalationPct) / 100;
        if (cal === num(H1.rentEscalationMonth)) h1.rent *= 1 + num(H1.rentEscalationPct) / 100;
        if (h2.rentStartIdx != null && idx > h2.rentStartIdx && (idx - h2.rentStartIdx) % 12 === 0) h2.rent *= 1 + num(H2.rentEscalationPct) / 100;
        h1.maint *= maintG; h2.maint *= maintG; if (h3) h3.maint *= maintG;
      }
      var row = { idx: idx, ym: ymStr(idx), year: Math.floor(idx / 12), cal: cal };

      // ---- events: home 1 sale ----
      var saleProceeds = 0;
      if (saleIdx === idx && h1.owned) {
        var gross = h1.value, costs = gross * num(H1.sellingCostPct) / 100, tax = num(H1.capitalGainsTax);
        saleProceeds = gross - costs - tax;
        saleInfo = { ym: row.ym, gross: gross, costs: costs, tax: tax, net: saleProceeds };
        h1.owned = false; h1.value = 0;
      }

      // ---- income ----
      var bonusNow = cal === num(I.bonusMonth || 2) ? bonus : 0;
      var h1Rent = h1.owned ? h1.rent : 0;
      if (h2.owned && H2.afterPossession === 'rentOut' && possIdx != null && h2.rentStartIdx == null && idx >= possIdx + num(H2.rentStartDelayMonths)) h2.rentStartIdx = idx;
      var h2Rent = h2.rentStartIdx != null ? h2.rent : 0;
      var income = salary + bonusNow + other + h1Rent + h2Rent;

      // ---- loan payments (on balance at start of month) ----
      var p2 = loan2.pay(idx, H2.loan.mode === 'preemi' && idx < preEmiUntil);
      var p3 = loan3 ? loan3.pay(idx, false) : { pay: 0, interest: 0, principal: 0 };

      // ---- home 2 construction-linked payments ----
      var h2Self = 0, h2Disb = 0;
      (sched[idx] || []).forEach(function (e) {
        if (e.paidBy === 'self') h2Self += num(e.amount);
        else { h2Disb += num(e.amount); }
      });
      if (h2Disb > 0) { loan2.P += h2Disb; loan2.recalc = true; }
      if (H2.loan.mode === 'preemi' && idx + 1 === preEmiUntil) loan2.recalc = true;

      // ---- purchase of the new flat ----
      var upfront = 0, draws = 0;
      if (buying && idx === pIdx) {
        var price = num(P.price), down = Math.min(price, num(P.downPayment));
        var loanAmt = price - down;
        var stamp = price * num(P.stampDutyPct) / 100, fee = loanAmt * num(P.processingFeePct) / 100;
        upfront = down + stamp + num(P.otherCosts) + fee;
        loan3 = new Loan(loanAmt, P.loanRatePct, idx + 1 + Math.round(num(P.tenureYears) * 12));
        h3 = { value: price, maint: num(P.maintenanceMonthly), g: growM(P.appreciationPct) };
        purchaseInfo = { ym: row.ym, price: price, down: down, loan: loanAmt, stamp: stamp, fee: fee, other: num(P.otherCosts), upfront: upfront, emi: emi(loanAmt, num(P.loanRatePct), Math.round(num(P.tenureYears) * 12)), fromSale: 0, fromHoldings: 0, fromCash: 0, autoDrawn: 0 };
        // explicit draws from holdings for the purchase
        Object.keys(P.draws || {}).forEach(function (hid) {
          var k = holdingIndex(hid), amt = Math.min(num(P.draws[hid]), holdings[k].bal);
          if (amt > 0) { holdings[k].bal -= amt; cash += amt; draws += amt; }
        });
      }

      // ---- prepayments ----
      var prepayAmt = 0;
      (prepay[idx] || []).forEach(function (e) {
        var L = e.loan === 'home3' ? loan3 : loan2;
        if (!L) return;
        var a = Math.min(num(e.amount), L.P);
        if (a > 0) { L.P -= a; prepayAmt += a; }
      });

      // ---- outflows ----
      var living = 0, sip = 0;
      items.forEach(function (it) {
        if (it.kind === 'sip') { sip += it.cur; holdings[holdingIndex(it.holdingId)].bal += it.cur; }
        else living += it.cur;
      });
      var rentActive = buying ? idx <= pIdx : !(moveInHome2 && idx >= possIdx);
      var rentPaid = rentActive ? rent : 0;
      var maint = (h1.owned ? h1.maint : 0) + (h2.owned && possIdx != null && idx >= possIdx ? h2.maint : 0) + (h3 && idx > pIdx ? h3.maint : 0);
      var maint3 = h3 && idx > pIdx ? h3.maint : 0;
      var oneOff = oneOffs[idx] || 0;
      var committed = living + sip + rentPaid + p2.pay + p3.pay + maint;
      var surplus = income - committed;                      // left for saving / extra spending
      var lumpy = h2Self + oneOff + upfront + prepayAmt;
      var net = surplus - lumpy + saleProceeds;

      // ---- balances ----
      cash += net;
      if (cash > 0) cash *= 1 + cashG;
      holdings.forEach(function (h) { h.bal *= h.g; });
      if (cash > buffer) { holdings[0].bal += cash - buffer; cash = buffer; }
      var autoDraw = 0;
      for (var k = 0; k < holdings.length && cash < 0; k++) {
        var take = Math.min(holdings[k].bal, -cash);
        holdings[k].bal -= take; cash += take; autoDraw += take;
      }
      if (purchaseInfo && idx === pIdx) {
        purchaseInfo.fromSale = Math.min(saleProceeds, upfront);
        purchaseInfo.fromHoldings = draws;
        purchaseInfo.autoDrawn = autoDraw;
        purchaseInfo.fromCash = Math.max(0, upfront - purchaseInfo.fromSale - draws - autoDraw);
      }

      h1.value *= h1.owned ? growM(H1.appreciationPct) : 1;
      if (h2.owned) h2.value *= growM(H2.appreciationPct);
      if (h3 && idx >= pIdx) h3.value *= h3.g;

      var invested = holdings.reduce(function (a, h) { return a + h.bal; }, 0);
      var liquid = cash + invested;
      var property = (h1.owned ? h1.value : 0) + (h2.owned ? h2.value : 0) + (h3 ? h3.value : 0);
      var loans = loan2.P + (loan3 ? loan3.P : 0);

      row.salary = salary; row.bonus = bonusNow; row.otherIncome = other; row.h1Rent = h1Rent; row.h2Rent = h2Rent;
      row.income = income;
      row.living = living; row.sip = sip; row.rent = rentPaid; row.emi2 = p2.pay; row.emi3 = p3.pay; row.maint = maint;
      row.int2 = p2.interest; row.int3 = p3.interest;
      row.committed = committed; row.surplus = surplus;
      row.h2Self = h2Self; row.oneOff = oneOff; row.upfront = upfront; row.prepay = prepayAmt; row.saleProceeds = saleProceeds;
      row.net = net;
      row.cash = cash; row.invested = invested; row.liquid = liquid;
      row.h1Value = h1.owned ? h1.value : 0; row.h2Value = h2.owned ? h2.value : 0; row.h3Value = h3 ? h3.value : 0;
      row.loan2 = loan2.P; row.loan3 = loan3 ? loan3.P : 0; row.loans = loans;
      row.netWorth = liquid + property - loans;
      row.cover = committed > 0 ? liquid / committed : 99;
      rows.push(row);

      tot.rentPaid += rentPaid; tot.h1Rent += h1Rent; tot.h2Rent += h2Rent; tot.int2 += p2.interest; tot.int3 += p3.interest;
      tot.maint3 += maint3; tot.emi2 += p2.pay; tot.emi3 += p3.pay; tot.income += income;
    }

    return { inputs: inp, rows: rows, years: aggregateYears(rows), totals: tot, purchase: purchaseInfo, sale: saleInfo, summary: summarize(rows, purchaseInfo, inp), warnings: warnings, buying: buying };
  }

  var FLOW_KEYS = ['salary', 'bonus', 'otherIncome', 'h1Rent', 'h2Rent', 'income', 'living', 'sip', 'rent', 'emi2', 'emi3', 'maint', 'int2', 'int3', 'committed', 'surplus', 'h2Self', 'oneOff', 'upfront', 'prepay', 'saleProceeds', 'net'];
  var STOCK_KEYS = ['cash', 'invested', 'liquid', 'h1Value', 'h2Value', 'h3Value', 'loan2', 'loan3', 'loans', 'netWorth'];

  function aggregateYears(rows) {
    var out = [], cur = null;
    rows.forEach(function (r) {
      if (!cur || cur.year !== r.year) {
        cur = { year: r.year, months: 0, minSurplus: Infinity };
        FLOW_KEYS.forEach(function (k) { cur[k] = 0; });
        out.push(cur);
      }
      cur.months++;
      FLOW_KEYS.forEach(function (k) { cur[k] += r[k]; });
      STOCK_KEYS.forEach(function (k) { cur[k] = r[k]; });
      cur.minSurplus = Math.min(cur.minSurplus, r.surplus);
    });
    out.forEach(function (y) { y.avgSurplus = y.surplus / y.months; y.emis = y.emi2 + y.emi3; });
    return out;
  }

  function summarize(rows, pur, inp) {
    var first = rows[0], last = rows[rows.length - 1];
    var minSurplus = rows[0], minLiquid = rows[0], minCover = rows[0], peakEmi = rows[0], peakEmi2 = rows[0];
    var shortfallMonths = 0, negSurplusMonths = 0;
    rows.forEach(function (r) {
      if (r.surplus < minSurplus.surplus) minSurplus = r;
      if (r.liquid < minLiquid.liquid) minLiquid = r;
      if (r.cover < minCover.cover) minCover = r;
      if (r.emi2 + r.emi3 > peakEmi.emi2 + peakEmi.emi3) peakEmi = r;
      if (r.emi2 > peakEmi2.emi2) peakEmi2 = r;
      if (r.liquid < 0) shortfallMonths++;
      if (r.surplus < 0) negSurplusMonths++;
    });
    var firstYear = rows.slice(0, 12), lastYear = rows.slice(-12);
    function avg(a, k) { return a.reduce(function (s, r) { return s + r[k]; }, 0) / Math.max(1, a.length); }
    return {
      start: first.ym, end: last.ym,
      emi2Now: first.emi2, emi2Peak: peakEmi2.emi2, emi2PeakYM: peakEmi2.ym,
      emi3: pur ? pur.emi : 0,
      peakEmi: peakEmi.emi2 + peakEmi.emi3, peakEmiYM: peakEmi.ym,
      surplusNow: first.surplus,
      avgSurplusFirstYear: avg(firstYear, 'surplus'), avgSurplusLastYear: avg(lastYear, 'surplus'),
      minSurplus: minSurplus.surplus, minSurplusYM: minSurplus.ym,
      negSurplusMonths: negSurplusMonths,
      minLiquid: minLiquid.liquid, minLiquidYM: minLiquid.ym,
      minCover: minCover.cover, minCoverYM: minCover.ym,
      shortfallMonths: shortfallMonths,
      endLiquid: last.liquid, endNetWorth: last.netWorth, endLoans: last.loans, endProperty: last.h1Value + last.h2Value + last.h3Value
    };
  }

  /** Scenario vs the same inputs without buying: where the net-worth difference comes from. */
  function opportunity(res, cf) {
    var a = res.rows[res.rows.length - 1], b = cf.rows[cf.rows.length - 1];
    var diff = a.netWorth - b.netWorth;
    var pur = res.purchase, sale = res.sale;
    var parts = [];
    parts.push({ key: 'rentSaved', label: 'Rent you no longer pay', value: cf.totals.rentPaid - res.totals.rentPaid });
    if (sale) {
      parts.push({ key: 'h1Rent', label: 'Home 1 rental income given up', value: -(cf.totals.h1Rent - res.totals.h1Rent) });
      parts.push({ key: 'h1Growth', label: 'Home 1 appreciation given up', value: -(b.h1Value - sale.gross) });
      parts.push({ key: 'h1Costs', label: 'Home 1 selling costs & tax', value: -(sale.costs + sale.tax) });
    }
    if (pur) {
      parts.push({ key: 'costs', label: 'Stamp duty, fees & other costs', value: -(pur.stamp + pur.fee + pur.other) });
      parts.push({ key: 'int3', label: 'Interest on the new loan', value: -res.totals.int3 });
      parts.push({ key: 'maint3', label: 'New flat maintenance', value: -res.totals.maint3 });
      parts.push({ key: 'h3Growth', label: 'New flat appreciation', value: a.h3Value - pur.price });
    }
    var known = parts.reduce(function (s, p) { return s + p.value; }, 0);
    parts.push({ key: 'returns', label: 'Investment returns gained / lost', value: diff - known });
    return {
      netWorthDiff: diff, liquidDiff: a.liquid - b.liquid,
      surplusDiffFirstYear: res.summary.avgSurplusFirstYear - cf.summary.avgSurplusFirstYear,
      parts: parts
    };
  }

  /** Compare up to 3 scenario results and produce a recommendation. items: [{name, res, cf}] */
  function recommend(items, emergencyMonths) {
    var em = emergencyMonths == null ? 6 : emergencyMonths;
    var scored = items.map(function (it) {
      var s = it.res.summary;
      var flags = [];
      if (s.shortfallMonths > 0) flags.push({ level: 'critical', text: 'Runs out of savings for ' + s.shortfallMonths + ' month(s), first low point around ' + s.minLiquidYM });
      else if (s.minCover < em) flags.push({ level: 'warning', text: 'Savings dip to ' + s.minCover.toFixed(1) + ' months of commitments around ' + s.minCoverYM + ' (target ' + em + ')' });
      if (s.negSurplusMonths > 0) flags.push({ level: 'warning', text: 'Monthly commitments exceed income in ' + s.negSurplusMonths + ' month(s)' });
      var tier = s.shortfallMonths > 0 ? 0 : (s.minCover < em ? 1 : 2);
      return { name: it.name, id: it.id, res: it.res, s: s, flags: flags, tier: tier };
    });
    var ranked = scored.slice().sort(function (x, y) {
      if (x.tier !== y.tier) return y.tier - x.tier;
      return y.s.endNetWorth - x.s.endNetWorth;
    });
    var best = ranked[0];
    function bestBy(key, higher) {
      return scored.reduce(function (b, x) { return (higher ? x.s[key] > b.s[key] : x.s[key] < b.s[key]) ? x : b; }, scored[0]);
    }
    var hiNW = bestBy('endNetWorth', true), hiSurplus = bestBy('minSurplus', true), hiLiquid = bestBy('minLiquid', true), loEmi = bestBy('peakEmi', false);
    var reasons = [];
    if (best.tier === 2) reasons.push(best.name + ' keeps at least ' + em + ' months of commitments in savings throughout.');
    else if (best.tier === 1) reasons.push('No option keeps the full ' + em + '-month safety buffer; ' + best.name + ' is the safest of those that never run out of money.');
    else reasons.push('Every option runs out of savings at some point; consider a smaller down payment, a longer tenure, or selling an asset.');
    if (hiNW === best) reasons.push('It ends with the highest net worth among the safe options.');
    else reasons.push(hiNW.name + ' ends richer on paper but is less safe on cash.');
    if (hiSurplus !== best) reasons.push(hiSurplus.name + ' leaves the most money in the tightest month.');
    if (hiLiquid !== best) reasons.push(hiLiquid.name + ' keeps the biggest cash and investment cushion at its low point.');
    return { best: best, ranked: ranked, scored: scored, reasons: reasons, leaders: { netWorth: hiNW.id, minSurplus: hiSurplus.id, minLiquid: hiLiquid.id, peakEmi: loEmi.id } };
  }

  /** Short meaningful name from a scenario's resolved inputs. */
  function autoName(inp, fmtShort) {
    var p = inp.purchase;
    if (!p.enabled) {
      return inp.home2.afterPossession === 'moveIn' ? 'Keep renting, move to Home 2' : 'Keep renting';
    }
    var bits = ['Buy'];
    if (p.sellHome1 && inp.home1.owned) bits.push('sell Home 1');
    var anyDraw = Object.keys(p.draws || {}).some(function (k) { return num(p.draws[k]) > 0; });
    if (!(p.sellHome1 && inp.home1.owned)) bits.push(anyDraw ? 'use investments' : 'use savings');
    var price = num(p.price);
    if (price > 0) bits.push(Math.round(num(p.downPayment) / price * 100) + '% down');
    bits.push(num(p.loanRatePct) + '% ' + num(p.tenureYears) + 'y');
    return bits.join(' · ');
  }

  var api = {
    parseYM: parseYM, ymStr: ymStr, addMonths: addMonths, currentYM: currentYM, emi: emi, clone: clone, uid: uid,
    getPath: getPath, setPath: setPath, blankBase: blankBase, resolveInputs: resolveInputs,
    applySuggestions: applySuggestions, missingRequired: missingRequired, simulate: simulate,
    opportunity: opportunity, recommend: recommend, autoName: autoName
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HBPEngine = api;
})(this);

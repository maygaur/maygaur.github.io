/* Chart helpers built on Chart.js (vendored). */
(function (root) {
  'use strict';

  var lastFmt = null;
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function series(i) { return css('--series-' + i); }
  function alpha(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function applyDefaults() {
    if (!root.Chart) return;
    var C = root.Chart;
    C.defaults.font.family = getComputedStyle(document.body).fontFamily;
    C.defaults.font.size = 12;
    C.defaults.color = css('--text-secondary');
    C.defaults.borderColor = css('--grid');
    C.defaults.plugins.legend.labels.boxWidth = 12;
    C.defaults.plugins.legend.labels.boxHeight = 12;
    C.defaults.plugins.legend.labels.usePointStyle = false;
    C.defaults.plugins.tooltip.backgroundColor = css('--surface-1');
    C.defaults.plugins.tooltip.titleColor = css('--text-primary');
    C.defaults.plugins.tooltip.bodyColor = css('--text-primary');
    C.defaults.plugins.tooltip.borderColor = css('--border');
    C.defaults.plugins.tooltip.borderWidth = 1;
    C.defaults.plugins.tooltip.padding = 10;
    C.defaults.plugins.tooltip.boxPadding = 4;
    C.defaults.animation = { duration: 250 };
    C.defaults.plugins.tooltip.footerColor = css('--text-secondary');
    C.defaults.plugins.tooltip.footerFont = { weight: 'normal', size: 11 };
    C.defaults.plugins.tooltip.footerMarginTop = 8;
    C.defaults.plugins.tooltip.titleMarginBottom = 6;
    C.defaults.plugins.tooltip.animation = false;
    // colour tweening has no interpolator in this build and throws on hover; numbers still animate
    C.defaults.animations.colors = false;
    if (!C._hbpCrosshair) { C.register(crosshair); C._hbpCrosshair = true; }
  }

  /** Crosshair through the hovered / tapped point, so the value can be read against both axes. */
  var crosshair = {
    id: 'hbpCrosshair',
    afterEvent: function (chart, args) {
      var e = args.event;
      if (e.type === 'mouseout') chart._hbpPointer = null;
      else if (e.x != null) chart._hbpPointer = { x: e.x, y: e.y };
    },
    afterDatasetsDraw: function (chart) {
      var act = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
      if (!act.length || !chart._hbpPointer) return;
      var area = chart.chartArea, ctx = chart.ctx, horiz = chart.options.indexAxis === 'y';
      var ptr = chart._hbpPointer;
      // the active point nearest the pointer is the "cross point"
      var best = act[0], bd = Infinity;
      act.forEach(function (a) {
        var el = a.element, d = horiz ? Math.abs(el.x - ptr.x) : Math.abs(el.y - ptr.y);
        if (d < bd) { bd = d; best = a; }
      });
      var x = best.element.x, y = best.element.y;
      ctx.save();
      ctx.strokeStyle = css('--text-muted'); ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, area.top); ctx.lineTo(x, area.bottom);
      ctx.moveTo(area.left, y); ctx.lineTo(area.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = css('--surface-1'); ctx.strokeStyle = css('--text-primary'); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // value label on the vertical axis at the cross point
      var yScale = chart.scales[horiz ? 'x' : 'y'];
      var fmt = chart._hbpFmt;
      if (fmt && yScale && !horiz) {
        var v = yScale.getValueForPixel(y), txt = fmt.short(v);
        ctx.font = '600 11px ' + root.Chart.defaults.font.family;
        var w = ctx.measureText(txt).width + 10;
        ctx.fillStyle = css('--text-primary');
        ctx.fillRect(area.left, y - 9, w, 18);
        ctx.fillStyle = css('--surface-1'); ctx.textBaseline = 'middle';
        ctx.fillText(txt, area.left + 5, y);
      }
      ctx.restore();
    }
  };

  /** Wrap long explanation lines so the tooltip stays inside a phone-width chart. */
  function wrap(lines, width) {
    var out = [], max = width || 46;
    lines.forEach(function (l) {
      if (l == null || l === false) return;
      var words = String(l).replace(/(\d) (L|Cr|K|M|B)\b/g, '$1\u00a0$2').split(' '), cur = '';
      words.forEach(function (w) {
        if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = '  ' + w; }
        else cur = (cur ? cur + ' ' : '') + w;
      });
      out.push(cur);
    });
    return out;
  }
  function narrow(chart) { return chart.width < 420 ? 34 : 50; }

  function draw(canvas, cfg) {
    if (!root.Chart || !canvas) return null;
    if (canvas._chart) {
      var ch = canvas._chart;
      // update in place when the shape matches so live tweaks animate smoothly
      if (ch.config.type === cfg.type && ch.data.datasets.length === cfg.data.datasets.length && ch._key === cfg._key) {
        ch.data.labels = cfg.data.labels;
        cfg.data.datasets.forEach(function (d, i) { Object.assign(ch.data.datasets[i], d); });
        ch.options = cfg.options;
        ch._hbpFmt = lastFmt;
        ch.update();
        return ch;
      }
      ch.destroy();
    }
    var c = new root.Chart(canvas.getContext('2d'), cfg);
    c._key = cfg._key;
    c._hbpFmt = lastFmt;
    canvas._chart = c;
    return c;
  }

  function moneyAxis(fmt, opts) {
    return Object.assign({
      grid: { color: css('--grid') },
      border: { display: false },
      ticks: { callback: function (v) { return fmt.short(v); }, maxTicksLimit: 6 }
    }, opts || {});
  }
  function catAxis(opts) {
    return Object.assign({ grid: { display: false }, border: { color: css('--border') }, ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 12 } }, opts || {});
  }
  function tooltipMoney(fmt) {
    return { mode: 'index', intersect: false, filter: function (c) { var v = c.chart.config.options.indexAxis === 'y' ? c.parsed.x : c.parsed.y; return v == null || Math.abs(v) >= 0.5 || c.dataset.type === 'line'; }, callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + fmt.short(c.parsed.y != null && c.chart.config.options.indexAxis !== 'y' ? c.parsed.y : c.parsed.x); } } };
  }
  function monthLabel(ym) {
    var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return M[+ym.slice(5) - 1] + ' ' + ym.slice(2, 4);
  }
  function line(label, data, color, extra) {
    return Object.assign({ type: 'line', label: label, data: data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 8, tension: 0.15 }, extra || {});
  }
  function baseOpts(fmt, extra, footer) {
    var tt = tooltipMoney(fmt);
    if (footer) tt.callbacks.footer = function (items) { if (!items.length) return []; return wrap(footer(items[0].dataIndex, items), narrow(items[0].chart)); };
    var o = Object.assign({
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom' }, tooltip: tt }
    }, extra || {});
    lastFmt = fmt;
    if (extra && extra.plugins) o.plugins = Object.assign({ legend: { position: 'bottom' }, tooltip: tt }, extra.plugins, { tooltip: Object.assign({}, tt, extra.plugins.tooltip || {}, { callbacks: Object.assign({}, tt.callbacks, (extra.plugins.tooltip || {}).callbacks || {}) }) });
    return o;
  }

  /** Trailing 12-month average (shorter at the start), so a once-a-year bonus doesn't dominate. */
  function rolling(vals) {
    var out = [], sum = 0;
    for (var i = 0; i < vals.length; i++) {
      sum += vals[i]; if (i >= 12) sum -= vals[i - 12];
      out.push(sum / Math.min(i + 1, 12));
    }
    return out;
  }
  function pick(rows, key, smooth) { var v = rows.map(function (r) { return r[key]; }); return smooth ? rolling(v) : v; }

  /** Monthly: income vs commitments with the surplus as bars. */
  function cashflow(canvas, res, fmt, smooth) {
    var rows = res.rows, bad = css('--bad'), pos = series(3);
    var inc = pick(rows, 'income', smooth), com = pick(rows, 'committed', smooth), sur = pick(rows, 'surplus', smooth);
    var liv = pick(rows, 'living', smooth), sip = pick(rows, 'sip', smooth), rnt = pick(rows, 'rent', smooth), emi = smooth ? rolling(rows.map(function (r) { return r.emi2 + r.emi3; })) : rows.map(function (r) { return r.emi2 + r.emi3; }), mnt = pick(rows, 'maint', smooth);
    var footer = function (i) {
      var r = rows[i];
      return [
        (smooth ? 'Average of the 12 months to here.' : null),
        'Left = income − commitments',
        '= ' + fmt.short(inc[i]) + ' − ' + fmt.short(com[i]) + ' = ' + fmt.short(sur[i]),
        'Commitments: living ' + fmt.short(liv[i]) + (sip[i] ? ', SIPs ' + fmt.short(sip[i]) : '') + (rnt[i] ? ', rent ' + fmt.short(rnt[i]) : '') + (emi[i] ? ', EMIs ' + fmt.short(emi[i]) : '') + (mnt[i] ? ', maintenance ' + fmt.short(mnt[i]) : ''),
        (!smooth && r.bonus ? 'Includes the yearly bonus of ' + fmt.short(r.bonus) + '.' : null),
        (!smooth && (r.upfront || r.h2Self || r.oneOff) ? 'Lump sums this month (paid from savings, not shown here): ' + fmt.short(r.upfront + r.h2Self + r.oneOff) : null),
        (sur[i] < 0 ? 'Negative: this month needs money from savings.' : null)
      ];
    };
    return draw(canvas, {
      _key: 'cashflow', type: 'bar',
      data: {
        labels: rows.map(function (r) { return monthLabel(r.ym); }),
        datasets: [
          line('Income', inc, series(1), { order: 0 }),
          line('Monthly commitments', com, series(2), { order: 0 }),
          {
            type: 'bar', label: 'Left after commitments', order: 1,
            data: sur,
            backgroundColor: sur.map(function (v) { return v < 0 ? bad : alpha(pos, 0.55); }),
            borderRadius: 2, barPercentage: 1, categoryPercentage: 0.9
          }
        ]
      },
      options: baseOpts(fmt, { scales: { x: catAxis(), y: moneyAxis(fmt) } }, footer)
    });
  }

  var OUT_PARTS = [
    ['living', 'Living expenses'], ['sip', 'SIPs'], ['rent', 'Rent'], ['emi2', 'Home 2 EMI'], ['emi3', 'New flat EMI'],
    ['maint', 'Maintenance'], ['h2Self', 'Builder payments (self)'], ['lump', 'Down payment, costs & one-offs']
  ];
  /** Yearly stacked outflows with income as a line. */
  function outflows(canvas, res, fmt) {
    var ys = res.years;
    var ds = OUT_PARTS.map(function (p, i) {
      return {
        type: 'bar', label: p[1], stack: 's', order: 1,
        data: ys.map(function (y) { return p[0] === 'lump' ? y.upfront + y.oneOff + y.prepay : y[p[0]]; }),
        backgroundColor: series(i + 1), borderColor: css('--surface-1'), borderWidth: 1, borderSkipped: 'bottom'
      };
    }).filter(function (d) { return d.data.some(function (v) { return v > 0; }); });
    ds.unshift(line('Income', ys.map(function (y) { return y.income; }), css('--text-primary'), { order: 0, borderDash: [5, 4], pointRadius: 3, stack: undefined }));
    return draw(canvas, {
      _key: 'outflows:' + ds.map(function (d) { return d.label; }).join('|'), type: 'bar',
      data: { labels: ys.map(function (y) { return y.months < 12 ? y.year + '*' : String(y.year); }), datasets: ds },
      options: baseOpts(fmt, { scales: { x: catAxis({ stacked: true }), y: moneyAxis(fmt, { stacked: true }) } }, function (i) {
        var y = ys[i];
        var out = y.living + y.sip + y.rent + y.emi2 + y.emi3 + y.maint + y.h2Self + y.upfront + y.oneOff + y.prepay;
        return [
          (y.months < 12 ? 'Partial year: ' + y.months + ' months.' : 'Sum of 12 months.'),
          'Total going out: ' + fmt.short(out),
          'Income − total going out = ' + fmt.short(y.income) + ' − ' + fmt.short(out) + ' = ' + fmt.short(y.income - out) + (y.income - out < 0 ? ' (drawn from savings)' : ' (saved)'),
          (y.saleProceeds ? 'Plus Home 1 sale proceeds of ' + fmt.short(y.saleProceeds) + '.' : null)
        ];
      })
    });
  }

  /** Savings & net worth, with the keep-renting counterfactual dashed. */
  function wealth(canvas, res, cf, fmt) {
    var rows = res.rows, ds = [
      line('Savings & investments', rows.map(function (r) { return r.liquid; }), series(1)),
      line('Net worth', rows.map(function (r) { return r.netWorth; }), series(7))
    ];
    if (cf && res.buying) {
      ds.push(line('Savings if you keep renting', cf.rows.map(function (r) { return r.liquid; }), series(1), { borderDash: [6, 4], borderWidth: 1.5 }));
      ds.push(line('Net worth if you keep renting', cf.rows.map(function (r) { return r.netWorth; }), series(7), { borderDash: [6, 4], borderWidth: 1.5 }));
    }
    return draw(canvas, {
      _key: 'wealth' + ds.length, type: 'line',
      data: { labels: rows.map(function (r) { return monthLabel(r.ym); }), datasets: ds },
      options: baseOpts(fmt, { scales: { x: catAxis(), y: moneyAxis(fmt) } }, function (i) {
        var r = rows[i], homes = r.h1Value + r.h2Value + r.h3Value;
        var l = [
          'Savings & investments = cash ' + fmt.short(r.cash) + ' + investments ' + fmt.short(r.invested),
          'Net worth = savings ' + fmt.short(r.liquid) + ' + homes ' + fmt.short(homes) + ' − loans ' + fmt.short(r.loans) + ' = ' + fmt.short(r.netWorth)
        ];
        if (cf && res.buying && cf.rows[i]) {
          var c = cf.rows[i], d = r.netWorth - c.netWorth, dl = r.liquid - c.liquid;
          l.push('vs keep renting: net worth ' + (d >= 0 ? '+' : '') + fmt.short(d) + ', savings ' + (dl >= 0 ? '+' : '') + fmt.short(dl));
        }
        return l;
      })
    });
  }

  var OPP_HELP = {
    rentSaved: 'Rent you would have paid if you kept renting, minus rent you still pay before buying, summed over the projection.',
    h1Rent: 'Rent from Home 1 you stop receiving once it is sold.',
    h1Growth: 'How much more Home 1 would have been worth at the end than its sale price.',
    h1Costs: 'Brokerage and capital gains tax on selling Home 1.',
    costs: 'Stamp duty, registration, loan processing fee and other one-time purchase costs. Money spent, not saved.',
    int3: 'Total interest paid on the new flat loan over the projection.',
    maint3: 'Maintenance and property tax on the new flat.',
    h3Growth: 'New flat value at the end minus its purchase price.',
    returns: 'The difference in returns your savings would have earned: the money used for the purchase and EMIs stays invested if you keep renting (or the reverse when buying frees up cash).'
  };
  /** Horizontal bars: what buying gains or costs vs keep renting. */
  function opportunity(canvas, opp, fmt) {
    var parts = opp.parts.filter(function (p) { return Math.abs(p.value) > 0.5; });
    var gain = series(1), cost = series(2);
    return draw(canvas, {
      _key: 'opp' + parts.length, type: 'bar',
      data: {
        labels: parts.map(function (p) { return p.label; }),
        datasets: [{ label: 'Effect on net worth', data: parts.map(function (p) { return p.value; }), backgroundColor: parts.map(function (p) { return p.value >= 0 ? gain : cost; }), borderRadius: 4, barPercentage: 0.7 }]
      },
      options: baseOpts(fmt, {
        indexAxis: 'y',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return ' ' + (c.parsed.x >= 0 ? 'Adds ' : 'Costs ') + fmt.short(Math.abs(c.parsed.x)) + ' to net worth'; }, footer: function (items) { return items.length ? wrap([OPP_HELP[parts[items[0].dataIndex].key] || ''], narrow(items[0].chart)) : []; } } } },
        scales: { x: moneyAxis(fmt), y: { grid: { display: false }, border: { display: false }, ticks: { autoSkip: false } } }
      })
    });
  }

  /** Compare: one line per scenario for a monthly metric. */
  function compareLines(canvas, items, key, fmt, smooth) {
    var labels = items[0].res.rows.map(function (r) { return monthLabel(r.ym); });
    var ds = items.map(function (it, i) {
      return line(it.name, pick(it.res.rows, key, smooth), series(it.slot || i + 1));
    });
    return draw(canvas, { _key: 'cmp-' + key + ds.length + (smooth ? 's' : ''), type: 'line', data: { labels: labels, datasets: ds }, options: baseOpts(fmt, { scales: { x: catAxis(), y: moneyAxis(fmt) } }, function (i) { return compareFooter(items, ds, i, key, fmt, smooth); }) });
  }
  function compareBars(canvas, items, key, fmt) {
    var labels = items[0].res.years.map(function (y) { return String(y.year); });
    var ds = items.map(function (it, i) {
      return { type: 'bar', label: it.name, data: it.res.years.map(function (y) { return y[key]; }), backgroundColor: series(it.slot || i + 1), borderRadius: 3, barPercentage: 0.85, categoryPercentage: 0.8 };
    });
    return draw(canvas, { _key: 'cmpb-' + key + ds.length, type: 'bar', data: { labels: labels, datasets: ds }, options: baseOpts(fmt, { scales: { x: catAxis(), y: moneyAxis(fmt) } }, function (i) { return compareFooter(items, ds, i, key, fmt, false, items[0].res.years[i]); }) });
  }

  var CMP_HELP = {
    surplus: 'Income − (living & SIPs + rent + EMIs + maintenance).',
    liquid: 'Cash + all investments at the end of the month.',
    netWorth: 'Savings & investments + home values − loans.',
    committed: 'Living & SIPs + rent + EMIs + maintenance for the year.'
  };
  function compareFooter(items, ds, i, key, fmt, smooth, yr) {
    var vals = ds.map(function (d, k) { return { name: items[k].name, v: d.data[i] }; }).filter(function (x) { return x.v != null; });
    if (!vals.length) return [];
    vals.sort(function (a, b) { return b.v - a.v; });
    var hi = vals[0], lo = vals[vals.length - 1];
    var lowerBetter = key === 'committed';
    return [
      CMP_HELP[key] ? CMP_HELP[key] + (smooth ? ' Averaged over the 12 months to here.' : '') : null,
      (yr && yr.months < 12 ? 'Partial year: ' + yr.months + ' months.' : null),
      vals.length > 1 ? (lowerBetter ? 'Lowest: ' + lo.name : 'Highest: ' + hi.name) : null,
      vals.length > 1 ? 'Gap between highest and lowest: ' + fmt.short(hi.v - lo.v) : null
    ];
  }

  function destroyAll(container) {
    if (!container) return;
    container.querySelectorAll('canvas').forEach(function (c) { if (c._chart) { c._chart.destroy(); c._chart = null; } });
  }

  root.HBPCharts = {
    applyDefaults: applyDefaults, cashflow: cashflow, outflows: outflows, wealth: wealth, opportunity: opportunity,
    compareLines: compareLines, compareBars: compareBars, destroyAll: destroyAll, series: series
  };
})(this);

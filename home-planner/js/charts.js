/* Chart helpers built on Chart.js (vendored). */
(function (root) {
  'use strict';

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
  }

  function draw(canvas, cfg) {
    if (!root.Chart || !canvas) return null;
    if (canvas._chart) {
      var ch = canvas._chart;
      // update in place when the shape matches so live tweaks animate smoothly
      if (ch.config.type === cfg.type && ch.data.datasets.length === cfg.data.datasets.length && ch._key === cfg._key) {
        ch.data.labels = cfg.data.labels;
        cfg.data.datasets.forEach(function (d, i) { Object.assign(ch.data.datasets[i], d); });
        ch.options = cfg.options;
        ch.update();
        return ch;
      }
      ch.destroy();
    }
    var c = new root.Chart(canvas.getContext('2d'), cfg);
    c._key = cfg._key;
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
    return { mode: 'index', intersect: false, callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + fmt.short(c.parsed.y != null && c.chart.config.options.indexAxis !== 'y' ? c.parsed.y : c.parsed.x); } } };
  }
  function monthLabel(ym) {
    var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return M[+ym.slice(5) - 1] + ' ' + ym.slice(2, 4);
  }
  function line(label, data, color, extra) {
    return Object.assign({ type: 'line', label: label, data: data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 8, tension: 0.15 }, extra || {});
  }
  function baseOpts(fmt, extra) {
    return Object.assign({
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom' }, tooltip: tooltipMoney(fmt) }
    }, extra || {});
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
      options: baseOpts(fmt, { scales: { x: catAxis(), y: moneyAxis(fmt) } })
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
        backgroundColor: series(i + 1), borderColor: css('--surface-1'), borderWidth: { top: 2 }, borderSkipped: false
      };
    }).filter(function (d) { return d.data.some(function (v) { return v > 0; }); });
    ds.unshift(line('Income', ys.map(function (y) { return y.income; }), css('--text-primary'), { order: 0, borderDash: [5, 4], pointRadius: 3, stack: undefined }));
    return draw(canvas, {
      _key: 'outflows:' + ds.map(function (d) { return d.label; }).join('|'), type: 'bar',
      data: { labels: ys.map(function (y) { return y.months < 12 ? y.year + '*' : String(y.year); }), datasets: ds },
      options: baseOpts(fmt, { scales: { x: catAxis({ stacked: true }), y: moneyAxis(fmt, { stacked: true }) } })
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
      options: baseOpts(fmt, { scales: { x: catAxis(), y: moneyAxis(fmt) } })
    });
  }

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
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return ' ' + fmt.short(c.parsed.x); } } } },
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
    return draw(canvas, { _key: 'cmp-' + key + ds.length + (smooth ? 's' : ''), type: 'line', data: { labels: labels, datasets: ds }, options: baseOpts(fmt, { scales: { x: catAxis(), y: moneyAxis(fmt) } }) });
  }
  function compareBars(canvas, items, key, fmt) {
    var labels = items[0].res.years.map(function (y) { return String(y.year); });
    var ds = items.map(function (it, i) {
      return { type: 'bar', label: it.name, data: it.res.years.map(function (y) { return y[key]; }), backgroundColor: series(it.slot || i + 1), borderRadius: 3, barPercentage: 0.85, categoryPercentage: 0.8 };
    });
    return draw(canvas, { _key: 'cmpb-' + key + ds.length, type: 'bar', data: { labels: labels, datasets: ds }, options: baseOpts(fmt, { scales: { x: catAxis(), y: moneyAxis(fmt) } }) });
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

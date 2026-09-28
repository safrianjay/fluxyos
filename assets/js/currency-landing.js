/* Marketing examples only: no workspace changes, document uploads, or writes. */
(function () {
  'use strict';
  var root = document.querySelector('.currency-page');
  if (!root) return;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var money = window.FluxyMoney;
  if (!money) return; // Static examples remain readable.
  var codes = ['SGD', 'MYR', 'PHP', 'IDR'];
  var values = {
    SGD: [1850, 245000, 68000, 177000, 100000],
    MYR: [1850, 245000, 68000, 177000, 100000],
    PHP: [18500, 2450000, 680000, 1770000, 1000000],
    IDR: [185000, 24500000, 6800000, 17700000, 10000000]
  };
  // Planning-range examples, not a shipped benchmarking or forecasting feature.
  var chartMonth = 5;
  var chartActual = [1800, 1950, 1880, 2210, 2300, 2450];
  var chartLow = [1450, 1550, 1600, 1700, 1800, 1900];
  var chartHigh = [1850, 1950, 2000, 2100, 2200, 2300];
  var report = root.querySelector('.currency-report-demo');
  var monthButtons = Array.from(root.querySelectorAll('[data-chart-month]'));
  function updateChart(code) {
    var factor = values[code][1] / 2450;
    function amount(value) { return money.formatMoney(Math.round(value * factor), code); }
    var actual = chartActual[chartMonth], low = chartLow[chartMonth], high = chartHigh[chartMonth];
    var relation = actual > high ? 'above' : actual < low ? 'below' : 'within';
    var difference = actual > high ? actual - high : actual < low ? low - actual : 0;
    root.querySelector('[data-chart-actual]').textContent = amount(actual);
    root.querySelector('[data-chart-low]').textContent = amount(low);
    root.querySelector('[data-chart-high]').textContent = amount(high);
    root.querySelector('[data-chart-difference]').textContent = amount(difference);
    root.querySelector('[data-chart-selected-month]').textContent = monthButtons[chartMonth].textContent;
    root.querySelectorAll('[data-chart-relation]').forEach(function (node) { node.hidden = node.dataset.chartRelation !== relation; });
    root.querySelectorAll('[data-chart-tick]').forEach(function (node) { node.textContent = amount(Number(node.dataset.chartTick)); });
    root.querySelectorAll('[data-chart-point]').forEach(function (node, index) { node.classList.toggle('is-selected', index === chartMonth); });
    monthButtons.forEach(function (button, index) { button.setAttribute('aria-pressed', String(index === chartMonth)); });
    var x = chartMonth * 100;
    root.querySelector('.currency-chart-guide').setAttribute('d', 'M' + x + ' 20V200');
  }
  function inspectMonth(index) {
    chartMonth = index;
    updateChart(report.dataset.reportCurrency);
  }
  monthButtons.forEach(function (button, index) {
    button.addEventListener('click', function () { button.focus({preventScroll: true}); inspectMonth(index); });
    button.addEventListener('mouseenter', function () { inspectMonth(index); });
    button.addEventListener('focus', function () { inspectMonth(index); });
    button.addEventListener('keydown', function (event) {
      var next;
      if (event.key === 'ArrowRight') next = (index + 1) % monthButtons.length;
      if (event.key === 'ArrowLeft') next = (index + monthButtons.length - 1) % monthButtons.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = monthButtons.length - 1;
      if (next !== undefined) { event.preventDefault(); monthButtons[next].focus({preventScroll: true}); }
    });
  });
  root.querySelector('.currency-performance-svg').addEventListener('pointermove', function (event) {
    var bounds = this.getBoundingClientRect();
    var x = (event.clientX - bounds.left) / bounds.width * 540 - 20;
    inspectMonth(Math.max(0, Math.min(5, Math.round(x / 100))));
  });
  // Independent sample workspaces, NOT live FX conversion or a reporting switch.
  function sequence(region, count, duration, update) {
    var index = 0, visible = false, timer = null;
    function stop() {
      window.clearTimeout(timer);
      region.dataset.motion = 'paused';
      timer = null;
    }
    function play() {
      stop();
      if (!visible || document.hidden || reduced.matches || region.contains(document.activeElement)) return;
      region.dataset.motion = 'running';
      timer = window.setTimeout(function () {
        index = (index + 1) % count;
        update(index, false);
        play();
      }, duration);
    }
    region.addEventListener('focusin', stop);
    region.addEventListener('focusout', function () { window.setTimeout(play, 0); });
    document.addEventListener('visibilitychange', play);
    reduced.addEventListener('change', play);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .15;
        play();
      }, {threshold: [0, .15]}).observe(region);
    } else { visible = true; play(); }
    update(0, false);
    return function (next) { index = next; update(index, true); play(); };
  }
  function marketPicker(type, region) {
    var buttons = Array.from(region.querySelectorAll('[data-' + type + '-market]'));
    var select = sequence(region, codes.length, type === 'hero' ? 4000 : 6000, function (index) {
      var code = codes[index], sample = values[code];
      region.dataset[type + 'Currency'] = code;
      buttons.forEach(function (b, i) { b.setAttribute('aria-pressed', String(i === index)); });
      // Localized complete labels come from static hidden markup, not JS prose.
      region.querySelector('[data-' + type + '-name]').textContent = root.querySelector('[data-workspace-name="' + code + '"]').textContent;
      region.querySelectorAll('[data-' + type + '-code]').forEach(function (node) { node.textContent = code; });
      if (type === 'hero') {
        var amount = region.querySelector('[data-hero-amount]');
        amount.textContent = money.formatMoney(sample[0], code);
        amount.classList.remove('currency-value-enter');
        void amount.offsetWidth;
        amount.classList.add('currency-value-enter');
        region.querySelectorAll('[data-event]').forEach(function (row) { row.classList.toggle('is-active', row.dataset.event === code); });
      } else {
        region.querySelectorAll('[data-report-value]').forEach(function (node) {
          node.textContent = money.formatMoney(sample[Number(node.dataset.reportValue) + 1], code);
        });
        region.querySelector('[data-report-budget]').textContent = money.formatMoney(sample[4], code);
        updateChart(code);
      }
      region.querySelectorAll('.currency-columns svg').forEach(function (bar) {
        bar.style.animation = 'none';
        void bar.offsetWidth;
        bar.style.animation = '';
      });
    });
    buttons.forEach(function (button, index) {
      button.addEventListener('click', function () {
        button.focus({preventScroll: true});
        select(index);
      });
    });
  }
  marketPicker('hero', root.querySelector('.currency-hero-demo'));
  marketPicker('report', root.querySelector('.currency-report-demo'));
  var workflow = root.querySelector('.currency-workflow');
  var steps = Array.from(workflow.querySelectorAll('[data-flow-step]'));
  var panels = Array.from(workflow.querySelectorAll('.currency-flow-panel'));
  var selectStep = sequence(workflow, steps.length, 5000, function (index) {
    workflow.dataset.flowStage = String(index);
    steps.forEach(function (step, position) { step.setAttribute('aria-pressed', String(position === index)); });
    panels.forEach(function (panel, position) {
      panel.hidden = position !== index;
      panel.classList.remove('currency-panel-enter');
      if (position === index) {
        void panel.offsetWidth;
        panel.classList.add('currency-panel-enter');
      }
    });
  });
  steps.forEach(function (step, index) {
    step.addEventListener('click', function () { step.focus({preventScroll: true}); selectStep(index); });
  });
  // Keep content visible before enhancement; reveal only chart/feed states.
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { entry.target.classList.toggle('is-visible', entry.isIntersecting); });
    }, {threshold: .1});
    root.querySelectorAll('.currency-section, .currency-connected').forEach(function (section) { observer.observe(section); });
  }
  var canvas = document.querySelector('.footer-canvas');
  if (canvas && typeof window.initUniverseCanvas === 'function') window.initUniverseCanvas(canvas);
})();

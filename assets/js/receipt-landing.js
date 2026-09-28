/* Illustrative marketing UI only. Never uploads documents or writes financial records. */
(function () {
  'use strict';
  var page = document.querySelector('.receipt-page');
  if (!page) return;
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function mountSequence(region, count, duration, select, stateKey) {
    var index = 0;
    var timer = null;
    var visible = false;
    function stop() {
      window.clearTimeout(timer);
      timer = null;
      region.dataset[stateKey] = 'paused';
    }
    function play() {
      stop();
      if (!visible || document.hidden || motion.matches || region.contains(document.activeElement)) return;
      region.dataset[stateKey] = 'running';
      timer = window.setTimeout(function () {
        index = (index + 1) % count;
        select(index, false);
        play();
      }, duration);
    }
    region.addEventListener('focusin', stop);
    region.addEventListener('focusout', function () { window.setTimeout(play, 0); });
    document.addEventListener('visibilitychange', play);
    motion.addEventListener('change', play);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .15;
        play();
      }, { threshold: [0, .15] }).observe(region);
    } else { visible = true; play(); }
    return function (next) { index = next; select(index, true); play(); };
  }

  var hero = page.querySelector('.receipt-hero-stage');
  var heroLabels = Array.from(page.querySelectorAll('[data-hero-labels] span'));
  var heroCaption = page.querySelector('[data-hero-caption]');
  mountSequence(hero, 3, 3000, function (index) {
    hero.dataset.heroPhase = String(index);
    heroCaption.textContent = heroLabels[index].textContent;
  }, 'motion');

  var workflow = page.querySelector('.receipt-workflow');
  var visual = page.querySelector('[data-receipt-stage]');
  var steps = Array.from(page.querySelectorAll('[data-receipt-step]'));
  var labels = Array.from(page.querySelectorAll('[data-receipt-labels] span'));
  var caption = page.querySelector('[data-receipt-caption]');
  var saveLabel = page.querySelector('[data-save-label]');
  var savedLabel = page.querySelector('[data-saved-label]');
  var selectedLabel = saveLabel.textContent;
  var selectStep = mountSequence(workflow, steps.length, 4200, function (index, manual) {
    steps.forEach(function (button, position) { button.setAttribute('aria-pressed', String(position === index)); });
    visual.dataset.receiptStage = String(index);
    caption.setAttribute('aria-live', manual ? 'polite' : 'off');
    caption.textContent = labels[index].textContent;
    saveLabel.textContent = index === 3 ? savedLabel.textContent : selectedLabel;
  }, 'autoplay');
  steps.forEach(function (button, index) {
    button.addEventListener('click', function () {
      button.focus({ preventScroll: true });
      selectStep(index);
    });
  });

  var category = page.querySelector('#receipt-demo-category');
  category.addEventListener('change', function () {
    page.querySelector('[data-category-preview]').textContent = category.selectedOptions[0].textContent;
  });

  var search = page.querySelector('#receipt-demo-search');
  var filters = Array.from(page.querySelectorAll('[data-receipt-filter]'));
  var rows = Array.from(page.querySelectorAll('[data-receipt-row]'));
  var filter = 'all';
  function filterRecords() {
    var query = search.value.trim().toLocaleLowerCase();
    var found = 0;
    rows.forEach(function (row) {
      var matches = row.textContent.toLocaleLowerCase().includes(query) &&
        (filter === 'all' || row.dataset.receiptRow === filter);
      row.hidden = !matches;
      if (matches) found += 1;
    });
    page.querySelector('[data-receipt-empty]').hidden = found !== 0;
    page.querySelector('[data-receipt-count]').textContent = String(found);
  }
  search.addEventListener('input', filterRecords);
  filters.forEach(function (button) {
    button.addEventListener('click', function () {
      filter = button.dataset.receiptFilter;
      filters.forEach(function (item) { item.setAttribute('aria-pressed', String(item === button)); });
      filterRecords();
    });
  });
  // Enhance visible content only; never hide sections while waiting for JS.
  if ('IntersectionObserver' in window && !motion.matches) {
    var reveal = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('receipt-enter');
        reveal.unobserve(entry.target);
      });
    }, { threshold: .08 });
    page.querySelectorAll('.receipt-section').forEach(function (section) { reveal.observe(section); });
  }
  document.addEventListener('DOMContentLoaded', function () {
    var canvas = document.querySelector('.footer-canvas');
    if (canvas && typeof window.initUniverseCanvas === 'function') window.initUniverseCanvas(canvas);
  });
})();

/* Marketing demonstrations only. No files, email, or financial records are submitted. */
(function () {
  'use strict';
  var page = document.querySelector('.invoice-page');
  if (!page) return;
  var steps = Array.from(page.querySelectorAll('[data-invoice-step]'));
  var visual = page.querySelector('[data-process-stage]');
  var labels = page.querySelectorAll('[data-stage-labels] span');
  var processing = page.querySelector('.invoice-processing-grid');
  var caption = page.querySelector('[data-stage-caption]');
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var currentStep = 0;
  var stepTimer = null;
  var processingVisible = false;
  var stepDuration = 4500;

  function selectStep(index, manual) {
    currentStep = index;
    steps.forEach(function (item, position) {
      item.setAttribute('aria-pressed', String(position === index));
    });
    visual.dataset.processStage = String(index);
    // Announce a user's selection without interrupting screen readers every cycle.
    caption.parentElement.setAttribute('aria-live', manual ? 'polite' : 'off');
    caption.textContent = labels[index].textContent;
  }

  function stopSteps() {
    window.clearTimeout(stepTimer);
    stepTimer = null;
    processing.dataset.autoplay = 'paused';
  }

  function playSteps() {
    stopSteps();
    if (!processingVisible || document.hidden || motion.matches ||
        processing.contains(document.activeElement)) return;
    processing.dataset.autoplay = 'running';
    stepTimer = window.setTimeout(function () {
      selectStep((currentStep + 1) % steps.length, false);
      playSteps();
    }, stepDuration);
  }

  processing.style.setProperty('--invoice-step-duration', stepDuration + 'ms');
  caption.parentElement.setAttribute('aria-live', 'off');
  steps.forEach(function (button, index) {
    button.addEventListener('click', function () {
      button.focus({ preventScroll: true });
      selectStep(index, true);
      playSteps();
    });
  });
  processing.addEventListener('focusin', stopSteps);
  processing.addEventListener('focusout', function () { window.setTimeout(playSteps, 0); });
  document.addEventListener('visibilitychange', playSteps);
  motion.addEventListener('change', playSteps);
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      processingVisible = entries[0].isIntersecting;
      playSteps();
    }, { threshold: 0.2 });
    observer.observe(processing);
  } else {
    processingVisible = true;
    playSteps();
  }
  var filters = Array.from(page.querySelectorAll('[data-invoice-filter]'));
  filters.forEach(function (button) {
    button.addEventListener('click', function () {
      filters.forEach(function (item) { item.setAttribute('aria-pressed', String(item === button)); });
      page.querySelectorAll('[data-invoice-row]').forEach(function (row) {
        row.hidden = button.dataset.invoiceFilter !== 'all' && row.dataset.invoiceRow !== button.dataset.invoiceFilter;
      });
    });
  });
  // The universal footer is pre-rendered so navigation survives blocked JS/fetch.
  document.addEventListener('DOMContentLoaded', function () {
    var canvas = document.querySelector('.footer-canvas');
    if (canvas && typeof window.initUniverseCanvas === 'function') window.initUniverseCanvas(canvas);
  });
})();

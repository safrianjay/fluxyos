/* Read-only marketing examples. Never reads or writes workspace data. */
(function () {
  'use strict';
  var root = document.querySelector('.auto-page');
  if (!root) return;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  function animatePanel(node) {
    node.classList.remove('auto-panel-enter');
    void node.offsetWidth;
    node.classList.add('auto-panel-enter');
  }
  function sequence(region, count, duration, update) {
    var index = 0, visible = false, timer;
    function stop() { window.clearTimeout(timer); region.dataset.motion = 'paused'; }
    function play() {
      stop();
      if (!visible || document.hidden || reduced.matches || region.contains(document.activeElement)) return;
      region.dataset.motion = 'running';
      timer = window.setTimeout(function () { index = (index + 1) % count; update(index); play(); }, duration);
    }
    region.addEventListener('focusin', stop);
    region.addEventListener('focusout', function () { window.setTimeout(play, 0); });
    document.addEventListener('visibilitychange', play);
    reduced.addEventListener('change', function () { update(index); play(); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .15;
        play();
      }, {threshold:[0,.15]}).observe(region);
    } else { visible = true; play(); }
    update(0);
    return function (next) { index = next; update(index); play(); };
  }
  var hero = root.querySelector('.auto-hero-demo');
  var heroButtons = Array.from(hero.querySelectorAll('[data-hero-source-button]'));
  var heroEntries = Array.from(hero.querySelectorAll('[data-hero-entry]'));
  var selectHero = sequence(hero, heroButtons.length * 4, 1400, function (index) {
    var source = Math.floor(index / 4), stage = reduced.matches ? 3 : index % 4;
    var changed = Number(hero.dataset.heroSource) !== source;
    hero.dataset.heroSource = String(source);
    hero.dataset.heroStage = String(stage);
    hero.querySelector('[data-hero-count]').textContent = String(stage + 1);
    hero.querySelectorAll('[data-hero-status]').forEach(function (node, position) { node.hidden = position !== stage; });
    hero.querySelectorAll('[data-hero-reveal]').forEach(function (node) {
      node.setAttribute('aria-hidden', String(Number(node.dataset.heroReveal) > stage));
    });
    heroButtons.forEach(function (button, position) { button.setAttribute('aria-pressed', String(position === source)); });
    heroEntries.forEach(function (entry, position) {
      entry.hidden = position !== source;
      if (changed && position === source) animatePanel(entry);
    });
    hero.querySelectorAll('[data-hero-phase]').forEach(function (node, position) {
      node.classList.toggle('is-complete', position <= stage);
      if (position === stage) node.setAttribute('aria-current', 'step');
      else node.removeAttribute('aria-current');
    });
  });
  heroButtons.forEach(function (button, index) {
    // A deliberate selection opens the complete record instead of pausing
    // halfway through an animation. Blur resumes the automatic sequence.
    button.addEventListener('click', function () { button.focus({preventScroll:true}); selectHero(index * 4 + 3); });
  });
  var story = root.querySelector('.auto-source-story');
  var sourceButtons = Array.from(story.querySelectorAll('[data-source-button]'));
  var sourcePanels = Array.from(story.querySelectorAll('[data-source-panel]'));
  function selectSource(index) {
    var changed = Number(story.dataset.source) !== index;
    story.dataset.source = String(index);
    sourceButtons.forEach(function (button, position) { button.setAttribute('aria-pressed', String(position === index)); });
    sourcePanels.forEach(function (panel, position) {
      panel.hidden = position !== index;
      if (changed && position === index) animatePanel(panel);
    });
  }
  selectSource(0);
  sourceButtons.forEach(function (button, index) {
    button.addEventListener('click', function () {
      button.focus({preventScroll:true}); selectSource(index);
      if (window.innerWidth <= 900) story.querySelector('.auto-source-demo').scrollIntoView({block:'start',behavior:reduced.matches?'instant':'smooth'});
    });
  });
  sequence(story, 4, 1200, function (stage) { story.dataset.sourceStage = String(reduced.matches ? 3 : stage); });
  // On desktop, the journal stays pinned while the reading position selects a source.
  var scrollPending = false;
  function followReadingPosition() {
    scrollPending = false;
    if (window.innerWidth <= 900 || story.contains(document.activeElement)) return;
    var bounds = story.getBoundingClientRect(), readingLine = Math.min(360, window.innerHeight * .4);
    if (bounds.top > readingLine || bounds.bottom < readingLine) return;
    var selected = 0, distance = Infinity;
    sourceButtons.forEach(function (button, index) {
      var delta = Math.abs(button.getBoundingClientRect().top - readingLine);
      if (delta < distance) { selected = index; distance = delta; }
    });
    selectSource(selected);
  }
  window.addEventListener('scroll', function () {
    if (!scrollPending) { scrollPending = true; window.requestAnimationFrame(followReadingPosition); }
  }, {passive:true});
  var ledgerButtons = Array.from(root.querySelectorAll('[data-ledger-source]'));
  function selectLedger(index) {
    root.querySelectorAll('[data-ledger-detail]').forEach(function (node, position) { node.hidden = position !== index; });
    root.querySelectorAll('[data-ledger-row]').forEach(function (node, position) { node.classList.toggle('is-active',position === index); });
    ledgerButtons.forEach(function (button, position) { button.setAttribute('aria-pressed',String(position === index)); });
  }
  ledgerButtons.forEach(function (button, index) { button.addEventListener('click',function () { selectLedger(index); }); });
  var tabs = Array.from(root.querySelectorAll('[data-report-tab]'));
  var reports = Array.from(root.querySelectorAll('[data-report-panel]'));
  root.querySelector('[data-report-tabs]').setAttribute('role','tablist');
  function selectReport(index) {
    tabs.forEach(function (tab, position) { tab.setAttribute('aria-selected',String(position === index)); tab.tabIndex = position === index ? 0 : -1; });
    reports.forEach(function (panel, position) { panel.hidden = position !== index; if (position === index) animatePanel(panel); });
  }
  tabs.forEach(function (tab, index) {
    tab.setAttribute('role','tab');
    reports[index].setAttribute('role','tabpanel');
    reports[index].tabIndex = 0;
    tab.addEventListener('click',function () { selectReport(index); });
    tab.addEventListener('keydown',function (event) {
      var next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); selectReport(next); tabs[next].focus(); }
    });
  });
  selectReport(0);
  var questions = Array.from(root.querySelectorAll('[data-ai-question]'));
  questions.forEach(function (button,index) {
    button.addEventListener('click',function () {
      questions.forEach(function (node,position) { node.setAttribute('aria-pressed',String(position === index)); });
      questions.forEach(function (node,position) { root.querySelector('#auto-ai-answer-' + position).hidden = position !== index; });
      animatePanel(root.querySelector('#auto-ai-answer-' + index));
    });
  });
  var match = root.querySelector('[data-match-example]');
  match.addEventListener('click',function () {
    root.querySelector('.auto-reconcile').dataset.matched = 'true';
    root.querySelector('[data-match-confirmed]').hidden = false;
    match.setAttribute('aria-pressed','true');
  });
  if ('IntersectionObserver' in window) {
    var workload = root.querySelector('.auto-workload-cards');
    if (workload && !reduced.matches) {
      var workloadObserver = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        workload.classList.add('is-visible');
        workloadObserver.unobserve(workload);
      }, {threshold:.15});
      workload.classList.add('has-motion');
      workloadObserver.observe(workload);
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { entry.target.classList.toggle('is-visible',entry.isIntersecting); });
    }, {threshold:.1});
    root.querySelectorAll('.auto-connected,.auto-insight-board').forEach(function (node) { observer.observe(node); });
  }
  var canvas = document.querySelector('.footer-canvas');
  if (canvas && typeof window.initUniverseCanvas === 'function') window.initUniverseCanvas(canvas);
})();

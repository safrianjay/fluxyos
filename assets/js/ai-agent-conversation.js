// Scripted product conversation. No API requests or customer records are used.
(() => {
  const init = () => {
    const demo = document.querySelector('[data-agent-conversation]');
    if (!demo) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const log = demo.querySelector('[data-conversation-log]');
    const turns = [...demo.querySelectorAll('[data-conversation-turn]')];
    const questions = turns.map(turn => turn.querySelector('[data-chat-question]').textContent);
    const answers = turns.map(turn => turn.querySelector('[data-chat-answer]').textContent);
    // A stable full conversation for assistive technology, without another
    // visible panel, footer, or suggested prompt.
    const transcript = demo.querySelector('[data-chat-transcript-body]');
    turns.forEach(turn => {
      const copy = turn.cloneNode(true);
      copy.removeAttribute('data-conversation-turn');
      copy.querySelectorAll('*').forEach(node => [...node.attributes].forEach(attribute => {
        if (attribute.name.startsWith('data-')) node.removeAttribute(attribute.name);
      }));
      transcript.append(copy);
    });
    let index = 0, reading = false, responding = false, complete = false, elapsed = 0, previous = 0, timer = 0, cycle = 0;
    let visible = !('IntersectionObserver' in window), hovered = false, focused = false;
    let lastHeight = 0;
    const active = () => visible && !document.hidden && !reduced.matches && !hovered && !focused;
    const scroll = () => {
      const height = log.scrollHeight;
      if (height !== lastHeight) {
        log.scrollTo({ top: height, behavior: reduced.matches ? 'auto' : 'smooth' });
        lastHeight = height;
      }
    };
    const render = () => {
      demo.dataset.chatPhase = complete ? 'complete' : responding ? 'responding' : reading ? 'reading' : 'typing';
      demo.dataset.chatTurn = String(index);
      demo.dataset.chatCycle = String(cycle);
      turns.forEach((turn, i) => {
        // Only future messages are hidden. Earlier bubbles are never rewritten,
        // replaced or removed within a conversation. Replay starts only after
        // all three exchanges and a final reading pause.
        turn.hidden = i > index;
        const typing = i === index && !reading && !complete;
        turn.toggleAttribute('data-chat-typing', typing);
        turn.querySelector('[data-chat-response]').hidden = i === index && typing;
        if (i === index) turn.querySelector('[data-chat-question]').textContent = typing
          ? questions[i].slice(0, Math.floor(elapsed / 28)) : questions[i];
        const revealing = i === index && responding;
        if (i === index) turn.querySelector('[data-chat-answer]').textContent = revealing
          ? answers[i].slice(0, Math.max(18, Math.ceil(answers[i].length * elapsed / 260))) : answers[i];
        turn.querySelectorAll('[data-chat-evidence], .agent-source-tag').forEach(node => { node.hidden = revealing; });
      });
    };
    const stop = () => { clearTimeout(timer); timer = 0; previous = 0; };
    const tick = () => {
      timer = 0;
      if (!active()) { previous = 0; return; }
      const now = performance.now();
      if (previous) elapsed += Math.min(now - previous, 250);
      previous = now;
      const duration = complete ? 5000 : responding ? 260 : reading ? 4000 : questions[index].length * 28;
      let replay = false;
      if (elapsed >= duration) {
        elapsed = 0;
        if (complete) {
          index = 0; reading = false; responding = false; complete = false; cycle++; replay = true;
        } else if (responding) {
          responding = false;
          if (index === turns.length - 1) complete = true;
        } else if (!reading) {
          reading = true; responding = true; // Start the answer immediately; reveal it in 260ms.
        } else {
          reading = false;
          index++;
        }
      }
      render();
      if (replay) { log.scrollTo({top:0,behavior:'instant'}); lastHeight = log.scrollHeight; }
      else scroll();
      timer = setTimeout(tick, 40);
    };
    const sync = () => {
      stop();
      demo.dataset.chatMotion = reduced.matches ? 'static' : active() ? 'running' : 'paused';
      if (active()) timer = setTimeout(tick, 40);
    };
    demo.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch') { hovered = true; sync(); }
    });
    demo.addEventListener('pointerleave', () => { hovered = false; sync(); });
    demo.addEventListener('focusin', () => { focused = true; sync(); });
    demo.addEventListener('focusout', () => queueMicrotask(() => {
      focused = demo.contains(document.activeElement); sync();
    }));
    document.addEventListener('visibilitychange', sync);
    const showAll = () => {
      // Reduced-motion visitors get the complete static transcript, without
      // changing their scroll position or restarting when preferences change.
      complete = true; reading = true; responding = false; index = turns.length - 1;
      turns.forEach((turn, i) => {
        turn.querySelector('[data-chat-question]').textContent = questions[i];
        turn.querySelector('[data-chat-answer]').textContent = answers[i];
      });
      render();
    };
    reduced.addEventListener('change', () => { if (reduced.matches) showAll(); sync(); });
    if ('IntersectionObserver' in window) new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting; sync();
    }, { threshold: .15 }).observe(demo);
    if (reduced.matches) showAll();
    else render();
    sync();
  };
  // Read the sample text after the existing language initializer has run.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

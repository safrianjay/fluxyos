/* Independent, progressively enhanced tab groups for the public POS previews. */
(() => {
  // The shared language switcher can translate the EN page in place.
  // Match each real-product screenshot to the active content language.
  const syncQrScreens = () => {
    const language = document.documentElement.lang.startsWith("id")
      ? "id"
      : "en";
    document.querySelectorAll("[data-qr-screen]").forEach((element) => {
      const source = `/assets/images/pos-qr-${element.dataset.qrScreen}-${language}.jpg`;
      const attribute = element.tagName === "IMG" ? "src" : "href";
      if (element.getAttribute(attribute) !== source)
        element.setAttribute(attribute, source);
    });
  };
  syncQrScreens();
  new MutationObserver(syncQrScreens).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });

  document.querySelectorAll("[data-pos-tabs]").forEach((group) => {
    const tabs = [...group.querySelectorAll('[role="tab"]')];
    const select = (tab, focus = false) => {
      tabs.forEach((candidate) => {
        const active = candidate === tab;
        candidate.setAttribute("aria-selected", String(active));
        candidate.tabIndex = active ? 0 : -1;
        document.getElementById(
          candidate.getAttribute("aria-controls"),
        ).hidden = !active;
      });
      if (focus) tab.focus();
    };
    if (group.hasAttribute("data-autoplay")) {
      const control = group.querySelector(".pos-autoplay");
      const motion = matchMedia("(prefers-reduced-motion: reduce)");
      let paused = motion.matches;
      let visible = false;
      let hovering = false;
      let timer;
      const update = () => {
        clearTimeout(timer);
        const playing = !paused && visible && !hovering && !document.hidden &&
          !group.contains(document.activeElement);
        group.dataset.playing = String(playing);
        control.setAttribute("aria-pressed", String(paused));
        const id = document.documentElement.lang.startsWith("id");
        const label = paused
          ? (id ? "Putar tayangan" : "Play slideshow")
          : (id ? "Jeda tayangan" : "Pause slideshow");
        const labelNode = control.querySelector(".pos-autoplay-label");
        if (labelNode.textContent !== label) labelNode.textContent = label;
        const icon = paused ? "▶" : "Ⅱ";
        if (control.firstElementChild.textContent !== icon) control.firstElementChild.textContent = icon;
        if (playing) timer = setTimeout(() => {
          const index = tabs.findIndex(tab => tab.getAttribute("aria-selected") === "true");
          select(tabs[(index + 1) % tabs.length]);
          update();
        }, 6000);
      };
      control.hidden = false;
      control.addEventListener("click", () => { paused = !paused; update(); });
      tabs.forEach(tab => tab.addEventListener("click", () => { paused = true; update(); }));
      group.addEventListener("pointerenter", event => { if (event.pointerType === "mouse") { hovering = true; update(); } });
      group.addEventListener("pointerleave", () => { hovering = false; update(); });
      group.addEventListener("focusin", update);
      group.addEventListener("focusout", () => setTimeout(update, 0));
      document.addEventListener("visibilitychange", update);
      motion.addEventListener("change", () => { paused = motion.matches; update(); });
      new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
      new IntersectionObserver(entries => { visible = entries[0].isIntersecting; update(); }, { threshold: 0.25 }).observe(group);
      update();
    }
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => select(tab));
      tab.addEventListener("keydown", (event) => {
        let next;
        const vertical =
          tab.closest('[role="tablist"]').getAttribute("aria-orientation") ===
          "vertical";
        if (event.key === (vertical ? "ArrowDown" : "ArrowRight"))
          next = (index + 1) % tabs.length;
        else if (event.key === (vertical ? "ArrowUp" : "ArrowLeft"))
          next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault();
        select(tabs[next], true);
      });
    });
  });
})();

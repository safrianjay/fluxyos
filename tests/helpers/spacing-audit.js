'use strict';

// =============================================================================
// The vertical-rhythm audit, in one place so more than one spec can run it.
//
// This is a real failure mode, not a taste rule. `.fluxy-section-stack > * + *`
// spaces DIRECT children only, so wrapping a page's sections in any new
// container silently drops every gap to ZERO and the page renders as one dense
// slab. That happened on /pos on 2026-08-31 and read as "weird, tight spacing"
// rather than as the missing rule it was.
//
// It lives here rather than only in the console sweep because the sweep sees a
// page in ONE state. A surface with in-page views — the till has four — hides
// three of them behind `.hidden`, where every rect is zero and nothing can be
// measured. `auditSpacing` is therefore called per view by the caller that
// knows how to switch them (tests/pos-ui.spec.js).
//
// Deliberately narrow: only same-parent, both-visible, card-like siblings inside
// a known page container. Table rows, list items and chip strips are
// legitimately flush and must not be flagged.
// =============================================================================

const MIN_GAP = 8;

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>} human-readable "a → b: Npx" offenders, capped at 8
 */
async function auditSpacing(page) {
    return page.evaluate((minGap) => {
        const CONTAINERS = ['.fluxy-page-canvas', '.fluxy-section-stack', '.pos-view', '.pos-col'];
        const out = [];
        const cardish = (el) => {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            if (r.height < 48 || r.width < 120) return false;
            if (cs.display === 'none' || cs.visibility === 'hidden') return false;
            // A "card" is something with its own surface — a border or a
            // background distinct from the page. Bare layout divs are not.
            const bordered = parseFloat(cs.borderTopWidth) > 0 || cs.borderRadius !== '0px';
            const filled = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
            return bordered || filled;
        };
        const name = (el) => el.id || String(el.className).split(' ')[0] || el.tagName.toLowerCase();

        document.querySelectorAll(CONTAINERS.join(',')).forEach((box) => {
            const kids = [...box.children].filter(cardish);
            for (let i = 1; i < kids.length; i += 1) {
                const a = kids[i - 1].getBoundingClientRect();
                const b = kids[i].getBoundingClientRect();
                // Only vertically stacked pairs; side-by-side is a grid.
                if (b.top < a.bottom - 1) continue;
                const gap = Math.round(b.top - a.bottom);
                if (gap < minGap) out.push(`${name(kids[i - 1])} → ${name(kids[i])}: ${gap}px`);
            }
        });
        return out.slice(0, 8);
    }, MIN_GAP);
}

module.exports = { auditSpacing, MIN_GAP };

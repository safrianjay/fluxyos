'use strict';

// Start an order the way a cashier does, whichever profile the workspace has.
//
// `#pos-new-order` reads "Create Order" on an F&B till and opens a chooser —
// dine in or take away — because naming the button after one of two options hid
// the other. A pay-first counter has one kind of order, so it is not asked and
// the button creates directly.
//
// Every spec that needs "a cart with something in it" goes through here, so the
// next change to that flow is one edit rather than fifteen. When the chooser
// landed, thirteen specs broke at once for exactly this reason.
async function startTakeawayOrder(page) {
    await page.click('#pos-new-order');
    const takeaway = page.locator('[data-type="takeaway"]');
    // Present on an F&B till, absent on a counter. Waited for rather than
    // assumed: the drawer is built on click, so a bare count() can race it.
    await takeaway.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
    if (await takeaway.count()) await takeaway.click();
}

module.exports = { startTakeawayOrder };

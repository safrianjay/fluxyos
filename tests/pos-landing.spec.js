const { test, expect } = require("@playwright/test");

test.use({ storageState: { cookies: [], origins: [] } });

for (const locale of ["en", "id"]) {
  for (const width of [390, 768, 1440]) {
    test(`POS landing ${locale} at ${width}px: previews, FAQ and locale`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(locale === "id" ? "/id/point-of-sale" : "/point-of-sale");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      const description = page.locator('meta[name="description"]');
      await expect(description).toHaveAttribute(
        "content",
        locale === "id" ? /^Hubungkan/ : /^Connect/,
      );
      await expect(
        page.locator('meta[property="og:locale:alternate"]'),
      ).toHaveAttribute("content", locale === "id" ? "en_US" : "id_ID");
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
        "content",
        locale === "id" ? /untuk Restoran/ : /for Restaurants/,
      );

      await expect(page.locator("main h1")).toContainText(
        locale === "id" ? "Setiap pesanan." : "Every order.",
      );
      await expect(page.locator("main h1")).toBeInViewport();
      await expect(page.locator(".pos-hero-particles")).toHaveCSS("position", "absolute");
      const heroHeight = await page.locator(".pos-hero").evaluate(element => element.getBoundingClientRect().height);
      await page.waitForTimeout(250);
      const settledHeight = await page.locator(".pos-hero").evaluate(element => element.getBoundingClientRect().height);
      expect(Math.abs(settledHeight - heroHeight)).toBeLessThan(4);
      expect(settledHeight).toBeLessThan(1800);
      await expect(page.locator(".footer-component")).toBeAttached();
      await expect(page.locator("html")).toHaveJSProperty("scrollWidth", width);
      await page.locator("#service-tab-kitchen").click();
      await expect(page.locator("#service-kitchen")).toBeVisible();
      await expect(page.locator("#service-floor")).toBeHidden();
      await page.locator("#service-tab-kitchen").press("ArrowRight");
      await expect(page.locator("#service-tab-payment")).toBeFocused();
      await expect(page.locator("#service-payment")).toBeVisible();
      await expect(page.locator("#service-payment")).toContainText("Rp90.000");
      await page.locator("#service-tab-payment").press("Home");
      await expect(page.locator("#service-floor")).toBeVisible();
      // The table view stays illustrated; only the customer phone uses real captures.
      await expect(page.locator("#service-floor .pos-table")).toHaveCount(9);
      const menuCapture = page.locator("#qr-menu img");
      await menuCapture.scrollIntoViewIfNeeded();
      await expect(menuCapture).toHaveAttribute(
        "src",
        `/assets/images/pos-qr-menu-${locale}.jpg`,
      );
      await expect
        .poll(() =>
          menuCapture.evaluate(
            (img) => img.complete && img.naturalWidth === 780,
          ),
        )
        .toBe(true);
      await page.locator("#qr-tab-customize").click();
      await expect(page.locator("#qr-customize")).toBeVisible();
      await expect(page.locator("#qr-menu")).toBeHidden();
      await page.locator("#qr-tab-customize").press("ArrowDown");
      await expect(page.locator("#qr-tab-basket")).toBeFocused();
      await expect(page.locator("#qr-basket")).toBeVisible();
      await expect(page.locator("#qr-basket a")).toHaveAttribute(
        "href",
        `/assets/images/pos-qr-basket-${locale}.jpg`,
      );
      await page.locator("#qr-tab-basket").press("Home");
      await expect(menuCapture).toBeVisible();
      await expect(page.locator("html")).toHaveJSProperty("scrollWidth", width);
      await page.locator("#report-tab-profit").click();
      await expect(page.locator("#report-profit")).toBeVisible();
      await expect(page.locator("#report-profit")).toContainText(
        "Rp2.880.000",
      );
      await expect(page.locator("#report-revenue")).toBeHidden();
      await page.locator(".pos-faq summary").nth(3).click();
      await expect(
        page.locator(".pos-faq details").nth(3).locator("p"),
      ).toBeVisible();
      const faq = await page
        .locator('script[type="application/ld+json"]')
        .evaluateAll((nodes) =>
          nodes
            .map((n) => JSON.parse(n.textContent))
            .find((n) => n["@type"] === "FAQPage"),
        );
      for (let i = 0; i < faq.mainEntity.length; i++) {
        await expect(
          page.locator(".pos-faq details").nth(i).locator("p"),
        ).toHaveText(faq.mainEntity[i].acceptedAnswer.text);
      }
      if (width < 1024) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.locator(".mobile-menu-toggle").click();
        await expect(page.locator("#mobile-menu")).toBeVisible();
        await page.locator(".mobile-menu-toggle").click();
        await expect(page.locator("#mobile-menu")).toBeHidden();
      }
      expect(errors).toEqual([]);
    });
  }
}

test("POS content stays readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:8765/id/point-of-sale");
  await expect(page.locator("h1")).toContainText("Setiap pesanan.");
  await expect(page.locator("#service-floor")).toBeVisible();
  await page.locator(".pos-faq summary").first().click();
  await expect(
    page.locator(".pos-faq details").first().locator("p"),
  ).toBeVisible();
  await context.close();
});

test("QR screenshots follow the shared in-place language switcher", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/point-of-sale");
  const languageLink = page.getByRole("link", {
    name: "Bahasa (ID)",
    exact: true,
  });
  await page
    .locator("nav")
    .getByRole("button", { name: "EN", exact: true })
    .hover();
  await languageLink.click();
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await expect(page.locator("#qr-menu img")).toHaveAttribute(
    "src",
    "/assets/images/pos-qr-menu-id.jpg",
  );
  await expect(page.locator("#qr-customize a")).toHaveAttribute(
    "href",
    "/assets/images/pos-qr-customize-id.jpg",
  );
});

test("QR autoplay advances, pauses and respects reduced motion", async ({ page }) => {
  await page.clock.install();
  await page.goto("/point-of-sale");
  const stage = page.locator(".pos-qr-stage");
  await stage.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await expect(stage).toHaveAttribute("data-playing", "true");
  await page.clock.fastForward(6100);
  await expect(page.locator("#qr-customize")).toBeVisible();
  await page.locator(".pos-autoplay").click();
  await page.mouse.move(0, 0);
  await page.clock.fastForward(12000);
  await expect(page.locator("#qr-customize")).toBeVisible();
  await expect(page.locator(".pos-autoplay")).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await stage.scrollIntoViewIfNeeded();
  await page.clock.fastForward(12000);
  await expect(page.locator("#qr-menu")).toBeVisible();
  await expect(stage).toHaveAttribute("data-playing", "false");
});

test("Daily chart samples reconcile to weekly totals on a shared scale", async ({ page }) => {
  await page.goto("/point-of-sale");
  const values = {};
  for (const metric of ["revenue", "cost", "profit"]) {
    values[metric] = await page.locator(`#report-${metric} .pos-daily-column`).evaluateAll(nodes => nodes.map(n => Number(n.dataset.value)));
    expect(values[metric]).toHaveLength(7);
    const percentages = await page.locator(`#report-${metric} .pos-daily-bar`).evaluateAll(nodes => nodes.map(n => parseFloat(n.style.getPropertyValue("--value"))));
    percentages.forEach((height, i) => expect(height).toBeCloseTo(values[metric][i] / 1200000 * 100, 1));
  }
  expect(values.revenue.reduce((a, b) => a + b)).toBe(4800000);
  expect(values.cost.reduce((a, b) => a + b)).toBe(1920000);
  expect(values.profit.reduce((a, b) => a + b)).toBe(2880000);
  values.revenue.forEach((value, i) => expect(value - values.cost[i]).toBe(values.profit[i]));
});

#!/usr/bin/env node
"use strict";

// Capture the REAL deployed QR ordering app against the existing ID demo outlet.
// Uses the same table link a diner opens after scanning. Menu/customization/cart
// only: never submits an order or requests a bill. No product DOM is restyled.
// Requires local, gitignored perf/.fixtures.json from the existing QA workspace.
const fs = require("fs");
const path = require("path");
const { chromium, expect } = require("@playwright/test");
const ROOT = path.resolve(__dirname, "..");

async function main() {
  const fixtures = JSON.parse(
    fs.readFileSync(path.join(ROOT, "perf/.fixtures.json"), "utf8"),
  );
  if (fixtures.account !== "id" || fixtures.country !== "ID")
    throw new Error("Use the existing ID QA fixtures only.");
  const outlet = fixtures.outlets.find((entry) => entry.name === "Senopati");
  const table = outlet?.tables.find((entry) => entry.label === "8");
  if (!table?.registered || !table.url)
    throw new Error("Registered Senopati table 8 is required.");
  const browser = await chromium.launch();
  try {
    for (const language of ["en", "id"]) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      await context.addInitScript(
        (lang) => localStorage.setItem("fluxyos-order-lang", lang),
        language,
      );
      const page = await context.newPage();
      // A second safety boundary: this capture must never submit any
      // customer order, even if the product's event handlers change.
      await page.route("**/*", (route) => {
        const request = route.request();
        if (
          /\/qr-(order|request-bill)(?:\?|$)/.test(request.url()) &&
          request.method() === "POST"
        ) {
          return route.abort("blockedbyclient");
        }
        return route.continue();
      });
      await page.goto(table.url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.locator("#sheet-welcome.is-open").waitFor({ timeout: 60000 });
      await page.locator("#welcome-name").fill("Sinta");
      await page.locator("#welcome-phone").fill("0812 3456 7890");
      await page.locator("#welcome-go").click();
      await expect(page.locator("#sheet-welcome")).not.toHaveClass(/is-open/);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(
        () => {
          const hero = document.querySelector("#hero-rail img");
          const photos = [...document.querySelectorAll(".reco-card img")].slice(
            0,
            2,
          );
          return (
            hero?.complete &&
            hero.naturalWidth > 0 &&
            photos.length === 2 &&
            photos.every((img) => img.complete && img.naturalWidth > 0)
          );
        },
        null,
        { timeout: 40000 },
      );
      const capture = async (screen) => {
        await page.waitForTimeout(450);
        await page.waitForFunction(
          () =>
            [...document.images]
              .filter((image) => {
                const box = image.getBoundingClientRect();
                return (
                  box.width > 0 &&
                  box.height > 0 &&
                  box.top < innerHeight &&
                  box.bottom > 0 &&
                  box.left < innerWidth &&
                  box.right > 0
                );
              })
              .every((image) => image.complete && image.naturalWidth > 0),
          null,
          { timeout: 30000 },
        );
        await page.screenshot({
          path: path.join(
            ROOT,
            `assets/images/pos-qr-${screen}-${language}.jpg`,
          ),
          type: "jpeg",
          quality: 88,
          animations: "disabled",
        });
        console.log(`Captured ${screen} (${language}), 780×1688.`);
      };
      await capture("menu");
      await page
        .locator(".reco-card")
        .filter({ hasText: "Kopi Susu Gula Aren" })
        .getByRole("button")
        .first()
        .click();
      await expect(page.locator("#sheet-item")).toHaveClass(/is-open/);
      const required = page.locator(
        '#sheet-item .optgroup[data-select="one_required"]',
      );
      for (let index = 0; index < (await required.count()); index++) {
        await required.nth(index).locator("input").first().check();
      }
      await capture("customize");
      await page.locator("#item-add").click(); // Local cart only.
      await expect(page.locator("#sheet-item")).not.toHaveClass(/is-open/);
      await page.locator("#cart-open").click();
      await expect(page.locator("#view-cart")).toBeVisible();
      await capture("basket");
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

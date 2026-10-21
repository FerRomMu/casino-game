import { test as base, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const original = JSON.parse(
  await readFile(
    new URL("../content/game.config.json", import.meta.url),
    "utf8",
  ),
);
const strings = JSON.parse(
  await readFile(new URL("../content/strings.json", import.meta.url), "utf8"),
);
const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await use(page);
    expect(errors).toEqual([]);
  },
});

async function prepare(
  page,
  { force = {}, timings = {}, reduced = true, mutate } = {},
) {
  const config = structuredClone(original);
  config.ui.randomSeed = false;
  config.ui.reducedMotionDuration = 8;
  for (const key of Object.keys(config.ui.timings)) config.ui.timings[key] = 20;
  Object.assign(config.ui.timings, timings);
  for (const [wheel, id] of Object.entries(force))
    for (const category of config.wheels[wheel].categories)
      category.weight = category.id === id ? 1 : 0;
  mutate?.(config);
  await page.route("**/content/game.config.json", (route) =>
    route.fulfill({ json: config }),
  );
  await page.emulateMedia({
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await page.goto("/");
  await ready(page, "wheel");
  return config;
}
async function ready(page, phase) {
  const stage = page.locator("#stage");
  if (phase) await expect(stage).toHaveAttribute("data-phase", phase);
  await expect(stage).toHaveAttribute("data-busy", "false");
  return stage;
}
async function click(page, action) {
  await page
    .locator(`[data-action="${action}"]`)
    .filter({ visible: true })
    .first()
    .click();
}
async function offer(page) {
  await click(page, "spin");
  await ready(page, "cards");
  await click(page, "pick");
  await ready(page, "offer");
}
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test("every configured illustration has visible SVG geometry", async ({
  page,
}) => {
  await prepare(page);
  await page.locator(".composition summary").click();
  const geometry = await page
    .locator(".inventory-table [data-symbol]")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.querySelector("use").getBBox();
        return {
          id: node.dataset.symbol,
          width: box.width,
          height: box.height,
        };
      }),
    );
  expect(geometry).toHaveLength(Object.keys(original.slots.target).length);
  expect(
    geometry.filter((item) => item.width <= 0 || item.height <= 0),
  ).toEqual([]);
});

test("moving reel strips keep visible cells throughout a mobile spin", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, {
    force: { wheel_1: "cat_6" },
    timings: { previewSpin: 1800, reelStop: 100 },
    reduced: false,
  });
  await offer(page);
  await click(page, "accept");
  await ready(page, "challenge");
  await click(page, "more");
  await click(page, "more");
  expect(
    await page
      .locator(".challenge-card")
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  await click(page, "numeric");
  await page.waitForSelector('#stage[data-phase="preview"] .reel-spinning');
  const emptyFrames = await page.evaluate(async () => {
    const start = performance.now(),
      empty = [];
    await new Promise((resolve) => {
      const frame = () => {
        for (const reel of document.querySelectorAll(".reel-spinning")) {
          const window = reel
            .querySelector(".reel-window")
            .getBoundingClientRect();
          const visible = [
            ...reel.querySelectorAll(".reel-blur-strip .reel-cell"),
          ].some((cell) => {
            const rect = cell.getBoundingClientRect();
            return rect.top < window.bottom && rect.bottom > window.top;
          });
          if (!visible) empty.push(reel.dataset.reel);
        }
        if (performance.now() - start >= 1000) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    return empty;
  });
  expect(emptyFrames).toEqual([]);
  await ready(page, "wheel");
  await noOverflow(page);
});

test("weighted SVG geometry, normalized probabilities and an all-in-one sector", async ({
  page,
}) => {
  await prepare(page, {
    mutate: (config) =>
      config.wheels.wheel_1.categories.forEach(
        (cat, i) => (cat.weight = i === 0 ? 33 : 67 / 6),
      ),
  });
  const sectors = page.locator("[data-sector]");
  await expect(sectors).toHaveCount(7);
  const weights = await sectors.evaluateAll((nodes) =>
    nodes.map((node) => Number(node.dataset.probability)),
  );
  expect(weights[0]).toBeCloseTo(0.33, 10);
  expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  expect(Number(await sectors.first().getAttribute("data-end"))).toBeCloseTo(
    0.33,
    10,
  );
  await page.locator(".category-details summary").click();
  await expect(page.locator(".category-pill")).toHaveCount(7);
  await ready(page, "wheel");
  await prepare(page, { force: { wheel_1: "cat_1" } });
  await expect(page.locator("[data-sector]")).toHaveCount(1);
  await expect(page.locator("[data-sector] circle")).toHaveCount(2);
  await noOverflow(page);
});

test("double clicks resolve one spin; help keeps the spinning wheel attached", async ({
  page,
}) => {
  await prepare(page, {
    force: { wheel_1: "cat_1" },
    timings: { wheel: 650, category: 80 },
    reduced: false,
  });
  await page.locator(".spin-button").evaluate((node) => {
    node.click();
    node.click();
  });
  const disc = await page.locator("#wheel").elementHandle();
  await click(page, "rules");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await disc.evaluate((node) => node.isConnected)).toBe(true);
  await page.keyboard.press("Escape");
  await ready(page, "cards");
  await expect(page.locator("[data-turn]")).toHaveText("01");
  await click(page, "pick");
  await ready(page, "offer");
  await click(page, "reject");
  await ready(page, "wheel");
  await expect(page.locator("[data-filled]")).toHaveText("0 / 80");
  await expect(page.locator("[data-banked-spins]")).toHaveText("0");
});

test("numeric controls keep keyboard focus, clamp results and complete the animated reward loop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, { force: { wheel_1: "cat_6" } });
  await offer(page);
  await click(page, "accept");
  await ready(page, "challenge");
  await expect(page.locator('[data-action="less"]')).toBeDisabled();
  await click(page, "more");
  await expect(page.locator('[data-action="more"]')).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator("[data-numeric-result]")).toHaveText("2 / 3");
  await click(page, "more");
  await expect(page.locator('[data-action="more"]')).toBeDisabled();
  await expect(page.locator('[data-action="less"]')).toBeFocused();
  await click(page, "less");
  await expect(page.locator("[data-numeric-result]")).toHaveText("2 / 3");
  await noOverflow(page);
  await page.evaluate(() => {
    window.observedPhases = [];
    new MutationObserver(() => {
      const phase = document.querySelector("#stage")?.dataset.phase;
      if (phase && !window.observedPhases.includes(phase))
        window.observedPhases.push(phase);
    }).observe(document.querySelector("#app"), {
      childList: true,
      subtree: true,
    });
  });
  await click(page, "numeric");
  await ready(page, "wheel");
  expect(await page.evaluate(() => window.observedPhases)).toEqual(
    expect.arrayContaining(["reward", "grid", "machine", "preview", "wheel"]),
  );
  const filled = Number(
    (await page.locator("[data-filled]").innerText()).split("/")[0],
  );
  const spins = Number(await page.locator("[data-banked-spins]").innerText());
  expect(filled + spins).toBeGreaterThan(0);
  await expect(page.locator("body")).not.toContainText("MISSING:");
  await expect(page.locator(".load-error")).toHaveCount(0);
  await noOverflow(page);
});

test("rejection during an accepted challenge and zero reward return cleanly", async ({
  page,
}) => {
  await prepare(page, { force: { wheel_1: "cat_1" } });
  await offer(page);
  await click(page, "accept");
  await ready(page, "challenge");
  await click(page, "reject");
  await ready(page, "wheel");
  await expect(page.locator("[data-filled]")).toHaveText("0 / 80");
  await offer(page);
  await click(page, "accept");
  await ready(page, "challenge");
  await click(page, "fail");
  await ready(page, "wheel");
  await expect(page.locator("[data-filled]")).toHaveText("0 / 80");
  await expect(page.locator("[data-banked-spins]")).toHaveText("0");
});

test("third progression can continue; fourth changes wheels; final spins cannot be duplicated", async ({
  page,
}) => {
  const cfg = await prepare(page, {
    force: { wheel_1: "cat_7_progression", wheel_2: "w2_cat_4_finale" },
  });
  for (let i = 0; i < 3; i++) {
    await click(page, "spin");
    await ready(page, i === 2 ? "decision" : "wheel");
  }
  await expect(page.locator(".progression-dots .lit")).toHaveCount(
    cfg.progression.choiceAt,
  );
  await click(page, "continue");
  await ready(page, "wheel");
  await expect(page.locator(".round-label strong")).toHaveText(
    strings["wheel_1.label"],
  );
  await click(page, "spin");
  await ready(page, "wheel");
  await expect(page.locator(".round-label strong")).toHaveText(
    strings["wheel_2.label"],
  );
  await click(page, "spin");
  await ready(page, "final_ready");
  await expect(page.locator("[data-remaining-spins]")).toHaveText(
    String(cfg.final.minSpins),
  );
  await page.locator('[data-action="final-spin"]').evaluate((node) => {
    node.click();
    node.click();
  });
  await ready(page, "final_ready");
  await expect(page.locator("[data-remaining-spins]")).toHaveText(
    String(cfg.final.minSpins - 1),
  );
  for (let i = 1; i < cfg.final.minSpins; i++) {
    await click(page, "final-spin");
    await ready(
      page,
      i === cfg.final.minSpins - 1 ? "finished" : "final_ready",
    );
  }
  await expect(page.locator('[data-action="final-spin"]')).toHaveCount(0);
  await click(page, "restart");
  await ready(page, "wheel");
  await expect(page.locator("[data-turn]")).toHaveText("00");
  await expect(page.locator("[data-filled]")).toHaveText("0 / 80");
});

test("third progression can advance immediately and restart confirmation can cancel", async ({
  page,
}) => {
  await prepare(page, {
    force: { wheel_1: "cat_7_progression", wheel_2: "w2_cat_4_finale" },
  });
  for (let i = 0; i < 3; i++) {
    await click(page, "spin");
    await ready(page, i === 2 ? "decision" : "wheel");
  }
  await click(page, "advance");
  await ready(page, "wheel");
  await expect(page.locator(".round-label strong")).toHaveText(
    strings["wheel_2.label"],
  );
  await click(page, "request-restart");
  await expect(page.getByRole("dialog")).toBeVisible();
  await click(page, "close-modal");
  await ready(page, "wheel");
  await expect(page.locator("[data-turn]")).toHaveText("03");
});

test("a complete deterministic game runs with sound, cards, rewards and the final on mobile", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await click(page, "sound");
  await expect(page.locator('[data-action="sound"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  let turns = 0;
  const phases = new Set();
  for (let action = 0; action < 300; action++) {
    await ready(page);
    const phase = await page.locator("#stage").getAttribute("data-phase");
    phases.add(phase);
    await noOverflow(page);
    if (phase === "finished") break;
    if (phase === "wheel") {
      await click(page, "spin");
      turns++;
    } else if (phase === "cards") await click(page, "pick");
    else if (phase === "offer") await click(page, "accept");
    else if (phase === "challenge") {
      if (await page.locator("[data-numeric-result]").count()) {
        while (await page.locator('[data-action="more"]').isEnabled())
          await click(page, "more");
        await click(page, "numeric");
      } else await click(page, "success");
    } else if (phase === "decision") await click(page, "continue");
    else if (phase === "final_ready") await click(page, "final-spin");
    else throw new Error(`UNEXPECTED_IDLE_PHASE:${phase}`);
  }
  await ready(page, "finished");
  expect(turns).toBeGreaterThan(3);
  expect([...phases]).toEqual(
    expect.arrayContaining([
      "wheel",
      "cards",
      "offer",
      "challenge",
      "decision",
      "final_ready",
      "finished",
    ]),
  );
  await expect(page.locator("body")).not.toContainText("MISSING:");
  await expect(page.locator("[data-prize]")).toBeVisible();
  await page.screenshot({ path: "artifacts/final-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "artifacts/final-desktop.png",
    fullPage: true,
  });
});

for (const width of [320, 390, 768, 1280]) {
  test(`layout remains within viewport at width ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await prepare(page, { force: { wheel_1: "cat_6" } });
    await noOverflow(page);
    const spin = page.locator(".spin-button");
    expect((await spin.boundingBox()).height).toBeGreaterThanOrEqual(44);
    if (width <= 390)
      expect(
        Number(
          await spin.evaluate((node) =>
            getComputedStyle(node).fontSize.replace("px", ""),
          ),
        ),
      ).toBeGreaterThanOrEqual(20);
    await offer(page);
    await noOverflow(page);
    await click(page, "accept");
    await ready(page, "challenge");
    await noOverflow(page);
    await click(page, "rules");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => !!document.activeElement.closest('[role="dialog"]'),
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await noOverflow(page);
  });
}

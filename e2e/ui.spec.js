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
  if (force.wheel_1) config.progression.adaptive.enabled = false;
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
async function drawChallenge(page) {
  await click(page, "spin");
  await ready(page, "challenge");
}
async function noOverflow(page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
}

test("symbol progress is vertical on desktop and horizontal on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await prepare(page);
  const progress = page.getByRole("progressbar", { name: strings["ui.inventory"] });
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute("aria-valuenow", "0");
  await expect(progress).toHaveAttribute("aria-valuemax", "80");
  await expect(page.locator(".inventory-table")).toHaveCount(0);
  const desktop = await progress.boundingBox();
  expect(desktop.height).toBeGreaterThan(desktop.width);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => {
    const mobile = await progress.boundingBox();
    return mobile.width > mobile.height;
  }).toBe(true);
});

test("cards move and one is chosen automatically", async ({ page }) => {
  await prepare(page, {
    force: { wheel_1: "cat_1" },
    timings: { deal: 650, draw: 850 },
    reduced: false,
  });
  await click(page, "spin");
  await expect(page.locator(".card-back")).toHaveCount(3);
  await expect(page.locator('[data-action="pick"]')).toHaveCount(0);
  await expect(page.locator(".card-back.is-selected")).toHaveCount(1);
  await expect(page.locator(".card-back.is-dismissed")).toHaveCount(2);
  await ready(page, "challenge");
  await expect(page.locator(".challenge-card")).toBeVisible();
});

test("mobile symbol installation reveals a maximum without spinning the reels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, {
    force: { wheel_1: "cat_6" },
    timings: { previewPrize: 1800 },
    reduced: false,
  });
  await page.evaluate(() => {
    window.previewSpins = 0;
    new MutationObserver(() => {
      if (document.querySelector('#stage[data-phase="preview"] .reel-spinning'))
        window.previewSpins++;
    }).observe(document.querySelector("#app"), { childList: true, subtree: true });
  });
  await drawChallenge(page);
  await click(page, "more");
  await click(page, "more");
  expect(
    await page
      .locator(".challenge-card")
      .evaluate((node) => getComputedStyle(node).animationName),
  ).toBe("none");
  await click(page, "numeric");
  await expect(page.locator('#stage[data-phase="preview"] .new-maximum.is-visible')).toBeVisible();
  expect(await page.locator(".new-maximum").evaluate((node) => getComputedStyle(node).animationName)).not.toBe("none");
  await ready(page, "wheel");
  expect(await page.evaluate(() => window.previewSpins)).toBe(0);
  await noOverflow(page);
});

test("weighted SVG geometry, normalized probabilities and an all-in-one sector", async ({
  page,
}) => {
  await prepare(page, {
    mutate: (config) => {
      config.progression.adaptive.enabled = false;
      config.wheels.wheel_1.categories.forEach(
        (cat, i) => (cat.weight = i === 0 ? 33 : 67 / 6),
      );
    },
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
    timings: { wheel: 2000, category: 80 },
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
  await ready(page, "challenge");
  await expect(page.locator("[data-turn]")).toHaveText("01");
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
  await drawChallenge(page);
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

test("rejection handles an incomplete challenge without extra controls", async ({
  page,
}) => {
  await prepare(page, { force: { wheel_1: "cat_1" } });
  await drawChallenge(page);
  await expect(page.locator('[data-action="accept"], [data-action="fail"]')).toHaveCount(0);
  await expect(page.locator('.challenge-card .actions button')).toHaveCount(2);
  await click(page, "reject");
  await ready(page, "wheel");
  await expect(page.locator("[data-filled]")).toHaveText("0 / 80");
  await drawChallenge(page);
  await click(page, "reject");
  await ready(page, "wheel");
  await expect(page.locator("[data-filled]")).toHaveText("0 / 80");
  await expect(page.locator("[data-banked-spins]")).toHaveText("0");
});

test("rejection uses the configured incomplete reward", async ({ page }) => {
  await prepare(page, { force: { wheel_1: "cat_2_quiz" } });
  await drawChallenge(page);
  await click(page, "reject");
  await ready(page, "wheel");
  const filled = Number((await page.locator("[data-filled]").innerText()).split("/")[0]);
  const spins = Number(await page.locator("[data-banked-spins]").innerText());
  expect(filled + spins).toBeGreaterThan(0);
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
    } else if (phase === "challenge") {
      if (await page.locator("[data-numeric-result]").count()) {
        while (await page.locator('[data-action="more"]').isEnabled())
          await click(page, "more");
        await click(page, "numeric");
      } else await click(page, "success");
    } else if (phase === "decision") await click(page, "continue");
    else if (phase === "final_ready") {
      const before = Number(
        await page.locator("[data-accumulated]").getAttribute("data-value"),
      );
      const remaining = Number(
        await page.locator("[data-remaining-spins]").innerText(),
      );
      const maximum = Number(
        await page.locator("[data-pot]").getAttribute("data-value"),
      );
      const perSpin = (maximum - before) / remaining;
      await page.evaluate(() => {
        window.banksDuringSpin = [];
        window.bankObserver = new MutationObserver(() => {
          if (
            document.querySelector(
              '#stage[data-phase="final_result"] .reel-spinning',
            )
          ) {
            window.banksDuringSpin.push({
              total: Number(
                document.querySelector("[data-accumulated]").dataset.value,
              ),
              maximum: Number(
                document.querySelector("[data-pot]").dataset.value,
              ),
            });
          }
        });
        window.bankObserver.observe(document.querySelector("#app"), {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class"],
        });
      });
      await click(page, "final-spin");
      await ready(page);
      const hiddenBanks = await page.evaluate(() => {
        window.bankObserver.disconnect();
        return window.banksDuringSpin;
      });
      expect(hiddenBanks.length).toBeGreaterThan(0);
      expect(
        hiddenBanks.every(
          (bank) => bank.total === before && bank.maximum === maximum,
        ),
      ).toBe(true);
      const line = await page
        .locator(".payline-symbol > [data-symbol]")
        .evaluateAll((nodes) => nodes.map((node) => node.dataset.symbol));
      const { explainLine } = await import("../src/domain/slots.js");
      const expected = explainLine(line, original.slots);
      const accumulated = before + expected.payout;
      await expect(page.locator("[data-accumulated]")).toHaveAttribute(
        "data-value",
        String(accumulated),
      );
      await expect(page.locator("[data-pot]")).toHaveAttribute(
        "data-value",
        String(accumulated + perSpin * (remaining - 1)),
      );
      const marked = await page
        .locator("[data-contribution]")
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            index: Number(node.closest("[data-reel]").dataset.reel),
            kind: node.dataset.contribution,
          })),
        );
      expect(
        marked.filter((x) => x.kind === "symbol").map((x) => x.index),
      ).toEqual(expected.winningIndices);
      expect(
        marked.filter((x) => x.kind === "multiplier").map((x) => x.index),
      ).toEqual(expected.multiplierIndices);
      await contentFits(page);
    } else throw new Error(`UNEXPECTED_IDLE_PHASE:${phase}`);
  }
  await ready(page, "finished");
  expect(turns).toBeGreaterThan(3);
  expect([...phases]).toEqual(
    expect.arrayContaining([
      "wheel",
      "challenge",
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
    await drawChallenge(page);
    await noOverflow(page);

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

async function contentFits(page) {
  await noOverflow(page);
  await expect(async () => {
    const clipped = await page
      .locator(
        ".symbol-progress, #stage button:not(:disabled), .cabinet-controls button",
      )
      .evaluateAll((nodes) =>
        nodes.flatMap((node) => {
          if (!node.checkVisibility()) return [];
          const r = node.getBoundingClientRect();
          return r.left < -1 ||
            r.top < -1 ||
            r.right > innerWidth + 1 ||
            r.bottom > innerHeight + 1
            ? [{ element: node.className, rect: r.toJSON() }]
            : [];
        }),
      );
    expect(clipped).toEqual([]);
  }).toPass({ timeout: 2000 });
  await expect(page.locator(".composition summary")).toHaveCount(0);
  await expect(page.locator(".app-header")).toHaveCount(0);
}

for (const [width, height] of [
  [320, 568],
  [390, 844],
  [844, 390],
  [1280, 720],
]) {
  test(`cabinet controls and symbol progress fit ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await prepare(page, { force: { wheel_1: "cat_6" } });
    await contentFits(page);
    await drawChallenge(page);
    await contentFits(page);

    await ready(page, "challenge");
    await contentFits(page);
    await click(page, "more");
    await click(page, "numeric");
    await ready(page, "wheel");
    await contentFits(page);
  });
}

test("insertion lands on stones and skips the maximum animation when unchanged", async ({
  page,
}) => {
  await prepare(page, {
    force: { wheel_1: "cat_1" },
    reduced: false,
    timings: {
      flight: 100,
      insertToken: 100,
      previewPrize: 500,
    },
    mutate: (config) => {
      // Keep a reachable maximum unchanged after its first symbol, exercising the random fallback next turn.
      for (const values of Object.values(config.slots.payout.table))
        for (let i = 1; i < values.length; i++) values[i] = 1000;
      config.slots.payout.multiplier = 1;
      config.slots.payout.exceptional.value = 1000;
    },
  });
  await page.evaluate(() => {
    window.machineSnapshots = [];
    window.previews = [];
    window.previewBoards = [];
    window.previewSpins = 0;
    const seenBoards = new WeakSet();
    let lastPhase = "";
    new MutationObserver(() => {
      const stage = document.querySelector("#stage");
      if (stage?.dataset.phase === "preview" && document.querySelector(".reel-spinning"))
        window.previewSpins++;
      if (stage?.dataset.phase === "machine")
        window.machineSnapshots.push(
          [...document.querySelectorAll("[data-reel]")].map((reel) => ({
            reel: reel.dataset.reel,
            position: reel.dataset.position,
            symbol: reel.querySelector(".payline-symbol [data-symbol]").dataset
              .symbol,
          })),
        );
      if (stage?.dataset.phase === "preview" && lastPhase !== "preview")
        window.previews.push(
          document.querySelector("[data-preview-kind]").dataset.previewKind,
        );
      const board = document.querySelector(
        ".prize-board.is-visible[data-preview-kind]",
      );
      if (board && !seenBoards.has(board)) {
        seenBoards.add(board);
        window.previewBoards.push({
          kind: board.dataset.previewKind,
          label: board.querySelector("span").textContent,
          labelSize: getComputedStyle(board.querySelector("span")).fontSize,
          numberSize: getComputedStyle(board.querySelector("strong")).fontSize,
        });
      }
      lastPhase = stage?.dataset.phase;
    }).observe(document.querySelector("#app"), {
      childList: true,
      subtree: true,
    });
  });
  for (let turn = 0; turn < 2; turn++) {
    await drawChallenge(page);
    await click(page, "success");
    await page.waitForSelector('#stage[data-phase="wheel"][data-busy="false"]');
    await ready(page, "wheel");
    const boards = await page.evaluate(() => window.previewBoards);
    expect(boards).toHaveLength(1);
    expect(boards[0].kind).toBe("maximum");
    expect(boards[0].label).toBe(strings["ui.previewMax"]);
    expect(boards[0].labelSize).toBe(boards[0].numberSize);
    await contentFits(page);
  }
  const { snapshots, previews, previewSpins } = await page.evaluate(() => ({
    snapshots: window.machineSnapshots,
    previews: window.previews,
    previewSpins: window.previewSpins,
  }));
  expect(previews).toEqual(["maximum"]);
  expect(previewSpins).toBe(0);
  let inserted = 0;
  for (let i = 1; i < snapshots.length; i++)
    for (let r = 0; r < 4; r++) {
      const before = snapshots[i - 1][r],
        after = snapshots[i][r];
      if (
        before.position === after.position &&
        before.symbol !== after.symbol &&
        after.symbol !== original.slots.stone
      ) {
        expect(before.symbol).toBe(original.slots.stone);
        inserted++;
      }
    }
  expect(inserted).toBeGreaterThan(0);
});

test("blast animation collects the domain snapshot and high maximum uses a larger number", async ({
  page,
}) => {
  const { createGame, transition } = await import("../src/domain/game.js");
  const { seededRandom } = await import("../src/domain/random.js");
  const decks = {
    wheel_1: JSON.parse(
      await readFile(
        new URL("../content/cards_wheel_1.json", import.meta.url),
        "utf8",
      ),
    ),
    wheel_2: JSON.parse(
      await readFile(
        new URL("../content/cards_wheel_2.json", import.meta.url),
        "utf8",
      ),
    ),
  };
  const cfg = structuredClone(original);
  for (const c of cfg.wheels.wheel_1.categories)
    c.weight = c.id === "cat_1" ? 1 : 0;
  let expected, seed;
  for (seed = 1; seed < 100; seed++) {
    const rng = seededRandom(seed),
      context = { config: cfg, decks, rng };
    let s = createGame(cfg, rng);
    for (const action of [
      { type: "SPIN_WHEEL" },
      { type: "SHOW_CARDS" },
      { type: "PICK_CARD" },
      { type: "ACCEPT" },
      { type: "RESOLVE", success: true },
      { type: "EXECUTE_GRID" },
    ])
      s = transition(s, action, context);
    if (s.extraction.draws.some((d) => d.explosions.length)) {
      expected = s.extraction;
      break;
    }
  }
  expect(expected).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, {
    force: { wheel_1: "cat_1" },
    reduced: false,
    timings: { explosion: 100, previewPrize: 700 },
    mutate: (c) => {
      c.seed = seed;
      for (const values of Object.values(c.slots.payout.table))
        for (let i = 1; i < values.length; i++) values[i] = 1000000;
    },
  });
  await page.evaluate(() => {
    window.exploded = 0;
    window.collectionCount = 0;
    const seen = new WeakSet();
    new MutationObserver(() => {
      for (const el of document.querySelectorAll(".exploding"))
        if (!seen.has(el)) {
          seen.add(el);
          window.exploded++;
        }
      window.collectionCount = Math.max(
        window.collectionCount,
        document.querySelectorAll(".collected-token").length,
      );
    }).observe(document.querySelector("#app"), {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  });
  await drawChallenge(page);
  await click(page, "success");
  await page.waitForSelector(".new-maximum.is-visible");
  const sizes = await page
    .locator(".new-maximum")
    .evaluate((node) => [
      parseFloat(getComputedStyle(node.querySelector("span")).fontSize),
      parseFloat(getComputedStyle(node.querySelector("strong")).fontSize),
    ]);
  expect(sizes[1]).toBeGreaterThan(sizes[0]);
  await contentFits(page);
  await page.screenshot({ path: "artifacts/maximum-mobile.png" });
  await ready(page, "wheel");
  expect(await page.evaluate(() => window.exploded)).toBe(
    expected.draws.reduce((n, d) => n + d.explosions.length, 0),
  );
  expect(await page.evaluate(() => window.collectionCount)).toBe(
    expected.draws.reduce((n, d) => n + d.collections.length, 0),
  );
  expect(
    Number((await page.locator("[data-filled]").innerText()).split("/")[0]),
  ).toBe(expected.tokens.reduce((n, t) => n + t.units, 0));
});

test("final reels stop left to right with growing pauses and never reveal the bank early", async ({
  page,
}) => {
  await prepare(page, {
    force: { wheel_1: "cat_7_progression", wheel_2: "w2_cat_4_finale" },
    reduced: false,
    timings: {
      finalSpin: 180,
      finalReelStop: 180,
      finalReelStep: 100,
      finalReelSettle: 100,
      finalPrize: 30,
    },
  });
  for (let i = 0; i < 3; i++) {
    await click(page, "spin");
    await ready(page, i === 2 ? "decision" : "wheel");
  }
  await click(page, "advance");
  await ready(page, "wheel");
  await click(page, "spin");
  await ready(page, "final_ready");
  await page.evaluate(() => {
    window.stops = [];
    window.earlyHighlights = [];
    new MutationObserver(() => {
      for (const node of document.querySelectorAll(".reel-stopped")) {
        const index = Number(node.dataset.reel);
        if (!window.stops.some((s) => s.index === index))
          window.stops.push({ index, time: performance.now() });
      }
      if (
        document.querySelector(".reel-spinning") &&
        document.querySelector("[data-contribution]")
      )
        window.earlyHighlights.push(true);
    }).observe(document.querySelector("#app"), {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  });
  await click(page, "final-spin");
  await page.waitForSelector(
    '#stage[data-phase="final_ready"][data-busy="false"]',
  );
  const stops = await page.evaluate(() => window.stops);
  expect(stops.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  for (let i = 1; i < 4; i++)
    expect(stops[i].time - stops[i - 1].time).toBeGreaterThanOrEqual(
      180 + (i - 1) * 100 - 25,
    );
  expect(await page.evaluate(() => window.earlyHighlights)).toEqual([]);
  await expect(page.locator("[data-contribution]")).toHaveCount(0);
  await expect(page.locator("[data-accumulated]")).toHaveAttribute(
    "data-value",
    "0",
  );
});

test("pay table updates as symbols are installed and matches the domain before the maximum reveal", async ({
  page,
}) => {
  const config = await prepare(page, {
    force: { wheel_1: "cat_1" },
    reduced: false,
    timings: { insertToken: 50, previewPrize: 1000 },
  });
  const { createGame, transition } = await import("../src/domain/game.js");
  const { seededRandom } = await import("../src/domain/random.js");
  const { attainablePrizes } = await import("../src/domain/slots.js");
  const decks = {
    wheel_1: JSON.parse(
      await readFile(
        new URL("../content/cards_wheel_1.json", import.meta.url),
        "utf8",
      ),
    ),
    wheel_2: JSON.parse(
      await readFile(
        new URL("../content/cards_wheel_2.json", import.meta.url),
        "utf8",
      ),
    ),
  };
  const rng = seededRandom(config.seed),
    context = { config, decks, rng };
  let state = createGame(config, rng);
  for (const action of [
    { type: "SPIN_WHEEL" },
    { type: "SHOW_CARDS" },
    { type: "PICK_CARD" },
    { type: "ACCEPT" },
    { type: "RESOLVE", success: true },
    { type: "EXECUTE_GRID" },
    { type: "INSERT_TOKENS" },
  ])
    state = transition(state, action, context);
  const expected = attainablePrizes(state.reels, config.slots);
  await page.evaluate(() => {
    window.payTables = [];
    new MutationObserver(() => {
      const panel = document.querySelector(".payout-panel");
      if (!panel) return;
      window.payTables.push({
        filled: Number(
          document.querySelector("[data-filled]").textContent.split("/")[0],
        ),
        progress: Number(document.querySelector(".symbol-progress").getAttribute("aria-valuenow")),
        growing: document.querySelector(".symbol-progress").classList.contains("is-growing"),
        maximum: Number(panel.dataset.prizeMaximum),
        rows: [...panel.querySelectorAll("[data-pay-symbol]")].map((row) => ({
          symbol: row.dataset.paySymbol,
          counts: [...row.querySelectorAll("[data-pay-count]")].map((cell) => ({
            count: Number(cell.dataset.payCount),
            normal: cell.querySelector(".pay-normal")
              ? Number(cell.querySelector(".pay-normal").dataset.payout)
              : null,
            multiplied: cell.querySelector(".pay-multiplied")
              ? Number(cell.querySelector(".pay-multiplied").dataset.payout)
              : null,
          })),
        })),
      });
    }).observe(document.querySelector("#app"), {
      childList: true,
      subtree: true,
    });
  });
  await drawChallenge(page);
  await click(page, "success");
  await page.waitForSelector('#stage[data-phase="wheel"][data-busy="false"]');
  const tables = await page.evaluate(() => window.payTables);
  expect(tables[0].filled).toBe(0);
  expect(tables.some((t) => t.growing && t.progress === t.filled && t.filled > 0)).toBe(true);
  expect(tables.at(-1).progress).toBe(tables.at(-1).filled);
  expect(tables[0].maximum).toBe(0);
  expect(
    tables.some(
      (t) => t.filled > 0 && t.filled < state.insertion.length && t.maximum > 0,
    ),
  ).toBe(true);
  expect(tables.at(-1).rows).toEqual(expected.rows);
  expect(tables.at(-1).maximum).toBe(expected.maximum);
});

for (const [width, height] of [
  [320, 568],
  [390, 844],
  [844, 390],
  [1060, 592],
  [1280, 720],
  [1440, 900],
]) {
  test(`complete prize table fits above reels at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    // Start a complete machine through the real app, so its fitting, rendering and
    // click handling are exercised without adding any fixture hooks to production.
    const source = await readFile(
      new URL("../src/domain/game.js", import.meta.url),
      "utf8",
    );
    await page.route("**/src/domain/game.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body:
          source.replace(
            "export function createGame(",
            "function fixtureBaseGame(",
          ) +
          `
    export function createGame(config,rng,participantId) {
      const state=fixtureBaseGame(config,rng,participantId);
      state.reels=Array.from({length:config.slots.reels},()=>Object.entries(config.slots.target).flatMap(([id,count])=>Array(count).fill(id)));
      state.preview=analyzeSlots(state.reels,config.slots);
      state.phase='final_ready';state.wheel=config.progression.nextWheel;state.spins=config.final.maxSpins;
      return state;
    }
  `,
      }),
    );
    await page.goto("/");
    await ready(page, "final_ready");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".payout-panel")).toBeVisible();
    await expect(page.locator("[data-jackpot-available]")).toHaveAttribute(
      "data-jackpot-available",
      "true",
    );
    await expect(page.locator("[data-prize-maximum]")).toHaveAttribute(
      "data-prize-maximum",
      String(original.slots.payout.exceptional.value),
    );
    await expect(async () => {
      const geometry = await page.evaluate(() => {
        const panel = document
            .querySelector(".payout-panel")
            .getBoundingClientRect(),
          reels = document
            .querySelector(".slot-machine")
            .getBoundingClientRect(),
          button = document
            .querySelector('[data-action="final-spin"]')
            .getBoundingClientRect();
        return {
          panel: panel.toJSON(),
          reels: reels.toJSON(),
          button: button.toJSON(),
          overflow: [...document.querySelectorAll(".payout-panel td")].filter(
            (n) => n.scrollWidth > n.clientWidth + 1,
          ).length,
        };
      });
      expect(geometry.panel.bottom).toBeLessThanOrEqual(geometry.reels.top + 1);
      if (width > 900) expect(geometry.reels.height).toBeGreaterThanOrEqual(geometry.panel.height);
      expect(geometry.panel.top).toBeGreaterThanOrEqual(0);
      expect(geometry.panel.right).toBeLessThanOrEqual(width + 1);
      expect(geometry.button.bottom).toBeLessThanOrEqual(height);
      expect(geometry.button.height).toBeGreaterThanOrEqual(40);
      expect(geometry.overflow).toBe(0);
    }).toPass({ timeout: 2000 });
    await contentFits(page);
    await page.screenshot({ path: `artifacts/paytable-live-${width}.png` });
    const payouts = await page
      .locator("[data-payout]")
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.payout));
    await click(page, "final-spin");
    await ready(page, "final_ready");
    expect(
      await page
        .locator("[data-payout]")
        .evaluateAll((nodes) => nodes.map((n) => n.dataset.payout)),
    ).toEqual(payouts);
  });
}

for (const completion of ['symbol', 'spin', 'advance']) {
  test(`complete machine automatically enters final after ${completion}`, async ({page}) => {
    const source = await readFile(new URL('../src/domain/game.js', import.meta.url), 'utf8');
    await page.route('**/src/domain/game.js', route => route.fulfill({
      contentType:'text/javascript',
      body:source.replace('export function createGame(', 'function fixtureBaseGame(') + `
        export function createGame(config,rng,participantId) {
          const state=fixtureBaseGame(config,rng,participantId);
          state.reels=Array.from({length:config.slots.reels},()=>Object.entries(config.slots.target).flatMap(([id,count])=>Array(count).fill(id)));
          state.spins=config.final.maxSpins;
          if (${JSON.stringify(completion)} !== 'advance') {
            state.wheel=config.progression.nextWheel;
            let tile;
            if (${JSON.stringify(completion)} === 'symbol') {
              tile={kind:'symbol',symbol:state.reels[0][0],units:1};
              state.reels[0][0]=config.slots.stone;
            } else {
              state.spins--;
              const effect=Object.keys(config.grid.effects).find(id=>config.grid.effects[id].spins===1);
              tile={kind:'effect',effect};
            }
            state.grid={cells:[tile,...Array(config.grid.rows*config.grid.columns-1).fill(null)],pool:[],reserves:[]};
          }
          return state;
        }`,
    }));
    await prepare(page, {force:{wheel_1:'cat_7_progression', wheel_2:'w2_cat_1'}});
    if (completion === 'advance') {
      for (let i=0;i<original.progression.choiceAt;i++) {
        await click(page,'spin');
        await ready(page,i===original.progression.choiceAt-1?'decision':'wheel');
      }
      await click(page,'advance');
    } else {
      await drawChallenge(page);

      await ready(page,'challenge');
      await click(page,'success');
    }
    await ready(page,'final_ready');
    await expect(page.locator('[data-filled]')).toContainText('80');
    await expect(page.locator('[data-pot]')).toHaveAttribute('data-value', String(original.final.maxSpins * original.slots.payout.exceptional.value));
    for (let i=0;i<original.final.maxSpins;i++) {
      await click(page,'final-spin');
      await ready(page,i===original.final.maxSpins-1?'finished':'final_ready');
    }
    await expect(page.locator('.load-error')).toHaveCount(0);
    await noOverflow(page);
  });
}

test('grid lights tolerate a frame timestamp preceding animation start', async ({page}) => {
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => request(timestamp => callback(timestamp - 100));
  });
  await prepare(page, {force:{wheel_1:'cat_1'}, reduced:false, timings:{grid:400}});
  await drawChallenge(page);

  await ready(page,'challenge');
  await click(page,'success');
  await page.waitForSelector('#stage[data-phase="wheel"][data-busy="false"]');
  await expect(page.locator('.load-error')).toHaveCount(0);
  expect(Number((await page.locator('[data-filled]').innerText()).split('/')[0])).toBeGreaterThan(0);
});

async function adaptiveFixture(page, body) {
  const source=await readFile(new URL('../src/domain/game.js',import.meta.url),'utf8');
  await page.route('**/src/domain/game.js', route=>route.fulfill({contentType:'text/javascript',body:
    source.replace('export function createGame(', 'function fixtureBaseGame(')+`
    export function createGame(config,rng,participantId) {
      const state=fixtureBaseGame(config,rng,participantId);
      const full=Array.from({length:config.slots.reels},()=>Object.entries(config.slots.target).flatMap(([symbol,n])=>Array(n).fill(symbol)));
      ${body}
      return state;
    }`,
  }));
}
function adaptiveCategories(config) {
  config.seed=61;
  config.progression.adaptive.enabled=true;
  config.wheels.wheel_1.categories.forEach(c=>c.weight=c.id==='cat_1'||c.behavior==='progression'?1:0);
}

test('adaptive wheel freezes its geometry while spinning and expands after a missed flame', async ({page}) => {
  await adaptiveFixture(page, `state.reels=full.map((reel,r)=>reel.map((symbol,p)=>r*config.slots.positions+p<56?symbol:config.slots.stone));state.appearances=2;state.progression=2;`);
  await prepare(page,{mutate:adaptiveCategories,reduced:false,timings:{wheel:900}});
  const flame=page.locator('[data-sector="cat_7_progression"]');
  expect(Number(await flame.getAttribute('data-probability'))).toBeCloseTo(.18,10);
  await click(page,'spin');
  await expect(page.locator('#wheel')).toBeVisible();
  expect(Number(await flame.getAttribute('data-probability'))).toBeCloseTo(.18,10);
  await ready(page,'challenge');
  await click(page,'reject');
  await ready(page,'wheel');
  expect(Number(await flame.getAttribute('data-probability'))).toBeCloseTo(.1825,10);
  const start=Number(await flame.getAttribute('data-start'));
  expect(1-start).toBeCloseTo(.1825,10);
  await noOverflow(page);
});

test('third flame remains visible and grows smoothly through seventy percent', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await adaptiveFixture(page, `
    const filled=55;
    state.reels=full.map((reel,r)=>reel.map((symbol,p)=>r*config.slots.positions+p<filled?symbol:config.slots.stone));
    state.appearances=2;state.progression=2;
    state.grid={cells:[{kind:'symbol',symbol:full.flat()[filled],units:1},...Array(config.grid.rows*config.grid.columns-1).fill(null)],pool:[],reserves:[]};
  `);
  await prepare(page,{mutate:adaptiveCategories});
  const flame=page.locator('[data-sector="cat_7_progression"]');
  await expect(flame).toHaveCount(1);
  const before=Number(await flame.getAttribute('data-probability'));
  expect(before).toBeGreaterThan(0);
  await expect(page.locator('.progress-panel')).not.toContainText(strings['ui.progressLocked']);
  await drawChallenge(page);await click(page,'success');
  await page.waitForSelector('#stage[data-phase="wheel"][data-busy="false"]');
  await expect(page.locator('[data-filled]')).toHaveText('56 / 80');
  expect(Number(await flame.getAttribute('data-probability'))-before).toBeLessThan(.02);
  expect(Number(await page.locator('[data-sector="cat_7_progression"]').getAttribute('data-probability'))).toBeCloseTo(.1825,10);
  await expect(page.locator('.progress-panel')).not.toContainText(strings['ui.progressLocked']);
  await noOverflow(page);
});

test('ninety percent handoff precedes overflow insertion and automatic finale', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await adaptiveFixture(page, `
    state.reels=full.map(reel=>[...reel]);
    const missing=state.reels[0].slice(0,10);
    for(let i=0;i<10;i++)state.reels[0][i]=config.slots.stone;
    const totals={};for(const symbol of missing)totals[symbol]=(totals[symbol]??0)+1;
    const tiles=Object.entries(totals).map(([symbol,units])=>({kind:'symbol',symbol,units}));
    state.grid={cells:[...tiles,...Array(config.grid.rows*config.grid.columns-tiles.length).fill(null)],pool:[],reserves:[]};
    state.spins=config.final.maxSpins;state.appearances=3;state.progression=3;state.continued=true;
  `);
  await prepare(page,{mutate:adaptiveCategories,reduced:false,timings:{wheelTransition:700}});
  await page.evaluate(()=>{
    window.handoffs=[];
    new MutationObserver(()=>{
      const stage=document.querySelector('#stage');
      if(stage)window.handoffs.push({phase:stage.dataset.phase,busy:stage.dataset.busy,
        filled:Number(document.querySelector('[data-filled]').textContent.split('/')[0]),
        wheel:document.querySelector('.round-label strong').textContent});
    }).observe(document.querySelector('#app'),{subtree:true,childList:true});
  });
  await drawChallenge(page);await click(page,'success');
  await page.waitForSelector('#stage[data-phase="wheel_transition"]');
  await expect(page.locator('#stage')).toContainText(strings['ui.stageUnlocked']);
  await noOverflow(page);
  await page.screenshot({path:'artifacts/adaptive-handoff-mobile.png'});
  await ready(page,'final_ready');
  const observed=await page.evaluate(()=>window.handoffs);
  expect(observed.some(s=>s.phase==='wheel_transition'&&s.filled===72&&s.busy==='true')).toBe(true);
  expect(observed.filter(s=>s.wheel===strings['wheel_1.label']).every(s=>s.filled<=72)).toBe(true);
  expect(observed.some(s=>s.wheel===strings['wheel_2.label']&&s.filled>72)).toBe(true);
  await expect(page.locator('[data-filled]')).toHaveText('80 / 80');
  await expect(page.locator('[data-remaining-spins]')).toHaveText(String(original.final.maxSpins));
  await click(page,'final-spin');await ready(page,'final_ready');
  await expect(page.locator('[data-remaining-spins]')).toHaveText(String(original.final.maxSpins-1));
});

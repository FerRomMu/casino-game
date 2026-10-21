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
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
}

test("every configured illustration has visible SVG geometry", async ({
  page,
}) => {
  await prepare(page);
  await expect(page.locator(".inventory-table")).toBeVisible();
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

async function contentFits(page) {
  await noOverflow(page);
  await expect(async () => {
    const clipped = await page
      .locator(
        ".inventory-table, .inventory-table > div, #stage button:not(:disabled), .cabinet-controls button",
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
  test(`cabinet controls and persistent inventory fit ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await prepare(page, { force: { wheel_1: "cat_6" } });
    await contentFits(page);
    await offer(page);
    await contentFits(page);
    await click(page, "accept");
    await ready(page, "challenge");
    await contentFits(page);
    await click(page, "more");
    await click(page, "numeric");
    await ready(page, "wheel");
    await contentFits(page);
  });
}

test("insertion lands on stones at actual positions and plays exactly one new-maximum preview", async ({
  page,
}) => {
  await prepare(page, {
    force: { wheel_1: "cat_1" },
    reduced: false,
    timings: {
      flight: 100,
      insertToken: 100,
      previewSpin: 200,
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
    const seenBoards = new WeakSet();
    let lastPhase = "";
    new MutationObserver(() => {
      const stage = document.querySelector("#stage");
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
    await offer(page);
    await click(page, "accept");
    await ready(page, "challenge");
    await click(page, "success");
    await page.waitForSelector('#stage[data-phase="wheel"][data-busy="false"]');
    await ready(page, "wheel");
    const board = await page.evaluate(
      (index) => window.previewBoards[index],
      turn,
    );
    expect(board.kind).toBe(turn === 0 ? "maximum" : "random");
    expect(board.label).toBe(
      strings[turn === 0 ? "ui.previewMax" : "ui.previewExample"],
    );
    expect(board.labelSize).toBe(board.numberSize);
    await contentFits(page);
  }
  const { snapshots, previews } = await page.evaluate(() => ({
    snapshots: window.machineSnapshots,
    previews: window.previews,
  }));
  expect(previews).toEqual(["maximum", "random"]);
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
  await offer(page);
  await click(page, "accept");
  await ready(page, "challenge");
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

import { seededRandom } from "../domain/random.js";
import { createGame, transition } from "../domain/game.js";
import { loadContent } from "./content.js";
import { createRenderer, escapeHtml } from "./render.js";
import { createAudio } from "./audio.js";

const app = document.querySelector("#app");
const modals = document.createElement("div");
modals.id = "modal-root";
const effects = document.createElement("div");
effects.id = "effects-root";
effects.setAttribute("aria-hidden", "true");
const announcer = document.createElement("div");
announcer.className = "sr-only";
announcer.setAttribute("role", "status");
document.body.append(modals, effects, announcer);
app.setAttribute("aria-busy", "true");

try {
  const { config, decks, t } = await loadContent();
  document.title = t("app.title");
  const seed = config.ui.randomSeed
    ? crypto.getRandomValues(new Uint32Array(1))[0]
    : config.seed;
  const rng = seededRandom(seed),
    context = { config, decks, rng };
  let state = createGame(config, rng),
    lastScene = "",
    modal = null,
    modalReturn = null;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const local = {
    busy: false,
    rotation: 0,
    numeric: 0,
    slotSpinning: false,
    wheelSpinning: false,
    displayStops: null,
    presentation: null,
    gridCells: null,
    collected: [],
    drawIndex: 0,
    upgradedCells: [],
    displayReels: null,
    prizeVisible: false,
    cardLeaving: false,
    sound: config.ui.soundEnabled,
    probabilitiesOpen: false,
    enter: true,
    motion: (name) =>
      reduced.matches
        ? config.ui.reducedMotionDuration
        : config.ui.timings[name],
  };
  const renderer = createRenderer(config, t),
    audio = createAudio({ volume: config.ui.soundVolume });
  const play = (name, ...args) => {
    if (local.sound) audio[name]?.(...args);
  };
  const wait = (name) =>
    new Promise((resolve) => setTimeout(resolve, local.motion(name)));
  const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const actionControls = [
    "spin",
    "pick",
    "accept",
    "reject",
    "fail",
    "success",
    "numeric",
    "more",
    "less",
    "continue",
    "advance",
    "final-spin",
    "restart",
    "request-restart",
  ];

  function fitScene() {
    const stage = app.querySelector("#stage"),
      scene = stage?.querySelector(".scene");
    if (!scene) return;
    scene.style.scale = "1";
    const available = stage.clientHeight;
    // Responsive geometry does most of the sizing; fit long external card text
    // and short landscape viewports without cutting off actions or adding scroll.
    const height = Math.max(scene.scrollHeight, scene.offsetHeight);
    const scale = Math.min(
      1,
      (available - 4) / height,
      stage.clientWidth / scene.scrollWidth,
    );
    scene.style.scale = String(scale);
  }
  const viewportObserver = new ResizeObserver(fitScene);
  document.fonts.ready.then(fitScene);
  function render(focusAction = null) {
    const focused = app.contains(document.activeElement)
      ? document.activeElement?.dataset.action
      : null;
    const probabilities = app.querySelector(".category-details");
    if (probabilities) local.probabilitiesOpen = probabilities.open;
    const scene = `${local.presentation ?? state.phase}:${state.wheel}:${state.category?.id ?? ""}`;
    local.enter = scene !== lastScene;
    lastScene = scene;
    app.innerHTML = renderer(state, local);
    viewportObserver.disconnect();
    viewportObserver.observe(app.querySelector("#stage"));
    fitScene();
    app.removeAttribute("aria-busy");
    if (local.busy)
      for (const control of app.querySelectorAll("button[data-action]"))
        if (actionControls.includes(control.dataset.action))
          control.disabled = true;
    const action = focusAction ?? focused;
    if (action && !modal)
      app
        .querySelector(`[data-action="${action}"]:not(:disabled)`)
        ?.focus({ preventScroll: true });
  }
  function send(action) {
    state = transition(state, action, context);
    render();
  }
  function announce(key) {
    announcer.textContent = t(key);
  }

  function openModal(kind) {
    modalReturn = document.activeElement?.dataset.action ?? "rules";
    modal = kind;
    modals.innerHTML = renderer.modal(kind);
    app.inert = true;
    document.body.classList.add("modal-open");
    modals.querySelector(".modal-close").focus();
  }
  function closeModal() {
    modal = null;
    modals.replaceChildren();
    app.inert = false;
    document.body.classList.remove("modal-open");
    app
      .querySelector(`[data-action="${modalReturn}"]:not(:disabled)`)
      ?.focus({ preventScroll: true });
  }

  async function fly(tile, from, to) {
    if (!from || !to) return;
    const a = from.getBoundingClientRect(),
      b = to.getBoundingClientRect();
    const flyer = document.createElement("div");
    flyer.className = "flying-token";
    flyer.innerHTML = renderer.tileContent(tile);
    flyer.style.cssText = `left:${a.x + a.width / 2 - 30}px;top:${a.y + a.height / 2 - 30}px;`;
    effects.append(flyer);
    const dx = b.x + b.width / 2 - a.x - a.width / 2,
      dy = b.y + b.height / 2 - a.y - a.height / 2;
    const animation = flyer.animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        {
          transform: `translate(${dx * 0.45}px,${dy * 0.4 - 50}px) scale(1.4)`,
          offset: 0.5,
          opacity: 1,
        },
        { transform: `translate(${dx}px,${dy}px) scale(.6)`, opacity: 0.8 },
      ],
      {
        duration: local.motion("flight"),
        easing: "cubic-bezier(.3,.05,.4,1)",
        fill: "forwards",
      },
    );
    try {
      await animation.finished;
    } finally {
      flyer.remove();
    }
  }
  function burst(target, rare = false) {
    if (!target || reduced.matches) return;
    const rect = target.getBoundingClientRect();
    const burst = document.createElement("div");
    burst.className = `celebration ${rare ? "rare-celebration" : ""}`;
    burst.style.cssText = `left:${rect.x + rect.width / 2}px;top:${rect.y + rect.height / 2}px`;
    burst.innerHTML = Array.from(
      { length: config.ui.particleCount },
      (_, i) =>
        `<i style="--angle:${(i / config.ui.particleCount) * 360}deg;--distance:${80 + (i % 4) * 30}px;--delay:${(i % 3) * 0.025}s"></i>`,
    ).join("");
    effects.append(burst);
    setTimeout(() => burst.remove(), 1200);
  }
  async function countPrize(prize) {
    const target = app.querySelector("[data-prize]");
    if (!target || reduced.matches) return;
    const duration = local.motion("numberCount"),
      start = performance.now();
    let raf;
    const frame = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      target.textContent = renderer.money(
        Math.round(prize * (1 - (1 - progress) ** 3)),
      );
      if (progress < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    await wait("numberCount");
    cancelAnimationFrame(raf);
    target.textContent = renderer.money(prize);
  }

  async function spinWheel() {
    local.presentation = "wheel";
    local.wheelSpinning = true;
    send({ type: "SPIN_WHEEL" });
    announce("ui.spinning");
    const center = ((state.category.start + state.category.end) / 2) * 360;
    const next =
      Math.ceil(local.rotation / 360) * 360 +
      config.ui.wheelTurns * 360 +
      360 -
      center;
    const disc = app.querySelector("#wheel");
    // Force a layout before changing the transform; never replace this node mid-spin.
    disc.getBoundingClientRect();
    disc.style.transform = `rotate(${next}deg)`;
    local.rotation = next;
    let tick;
    if (local.sound && !reduced.matches)
      tick = setInterval(() => play("tick"), 100);
    await wait("wheel");
    clearInterval(tick);
    local.presentation = null;
    local.wheelSpinning = false;
    render();
    if (state.phase === "category") {
      play("pick");
      await wait("category");
      send({ type: "SHOW_CARDS" });
      await wait("deal");
      announce("ui.chooseCard");
    } else if (state.phase === "progression") {
      play("fire");
      await wait("fire");
      send({ type: "END_PROGRESSION" });
    } else if (state.phase === "finale") {
      play("win");
      await wait("finalIntro");
      send({ type: "START_FINAL" });
      announce("ui.finalReady");
    }
  }

  async function chaseLights(draw, duration) {
    const tiles = [...app.querySelectorAll("[data-cell]")];
    const active = tiles.filter((_, i) => local.gridCells[i]);
    const start = performance.now();
    let raf;
    const frame = (now) => {
      tiles.forEach((tile) => tile.classList.remove("lit"));
      if (active.length)
        active[
          Math.floor((now - start) / config.ui.gridLightStep) % active.length
        ].classList.add("lit");
      raf = requestAnimationFrame(frame);
    };
    if (!reduced.matches) raf = requestAnimationFrame(frame);
    await waitMs(duration);
    cancelAnimationFrame(raf);
    tiles.forEach((tile) => tile.classList.remove("lit"));
    const chosen = tiles[draw.index];
    chosen?.classList.add("chosen");
    play("collect");
    await wait("gridStop");
    for (const index of draw.explosions) {
      const cell = tiles[index];
      cell?.classList.add("exploding");
      burst(cell, true);
      play("fire");
      await wait("explosion");
    }
    for (const item of draw.collections)
      tiles[item.index]?.classList.add("chosen");
    await Promise.all(
      draw.collections.map(async (item) => {
        await fly(
          item.tile,
          tiles[item.index],
          app.querySelector("#collected"),
        );
      }),
    );
    local.collected.push(...draw.collections.map((item) => item.tile));
    local.upgradedCells = [];
    for (const upgrade of draw.upgrades) {
      local.gridCells[upgrade.index] = upgrade.tile;
      local.upgradedCells.push(upgrade.index);
    }
    for (const item of draw.collections) {
      local.gridCells[item.index] = item.replacement;
      if (item.replacement) local.upgradedCells.push(item.index);
    }
    render();
    await wait("replacement");
  }

  async function revealReels(duration) {
    await wait(duration);
    const reels = [...app.querySelectorAll("[data-reel]")];
    for (const [i, reel] of reels.entries()) {
      reel.classList.remove("reel-spinning");
      reel.classList.add("reel-stopped");
      play("reel", i);
      if (reel.classList.contains("rare-reel")) burst(reel, true);
      await wait("reelStop");
    }
    local.slotSpinning = false;
    local.prizeVisible = true;
    render();
  }

  async function animateGrid() {
    local.gridCells = structuredClone(state.grid.cells);
    local.collected = [];
    local.drawIndex = 0;
    send({ type: "EXECUTE_GRID" });
    const duration = reduced.matches
      ? config.ui.reducedMotionDuration
      : local.motion("grid") / Math.max(1, state.extraction.draws.length);
    for (const [i, draw] of state.extraction.draws.entries()) {
      local.drawIndex = i;
      local.upgradedCells = [];
      render();
      await chaseLights(draw, duration);
    }
    local.gridCells = null;
    local.upgradedCells = [];
    render();
    await wait("reward");
    local.displayReels = structuredClone(state.reels);
    local.displayStops = local.displayReels.map((reel) =>
      Math.max(0, reel.indexOf(config.slots.stone)),
    );
    send({ type: "INSERT_TOKENS" });
    await wait("insertion");
    for (const insertion of state.insertion) {
      local.displayStops[insertion.reel] = insertion.position;
      render();
      await wait("insertToken");
      const from = [...app.querySelectorAll(".queue-token")].find((node) =>
        node.querySelector(`[data-symbol="${insertion.symbol}"]`),
      );
      const target = app.querySelector(
        `[data-reel="${insertion.reel}"] .payline-symbol`,
      );
      await fly(
        { kind: "symbol", symbol: insertion.symbol, units: 1 },
        from,
        target,
      );
      local.displayReels[insertion.reel][insertion.position] = insertion.symbol;
      play("collect");
      burst(target, config.grid.ranks[insertion.symbol] >= config.ui.rareRank);
      render();
      await wait("insertToken");
    }
    local.displayReels = null;
    local.displayStops = null;
    local.slotSpinning = true;
    local.prizeVisible = false;
    send({ type: "SHOW_PREVIEW" });
    await revealReels("previewSpin");
    if (state.newMaximum) {
      play("win");
      burst(app.querySelector(".prize-board"), true);
      announce("ui.previewMax");
    }
    await countPrize(state.previewOutcome.payout);
    await wait("previewPrize");
    local.prizeVisible = false;
    local.collected = [];
    send({ type: "END_PREVIEW" });
    announce("ui.ready");
  }

  async function exitCard(action) {
    local.cardLeaving = true;
    render();
    await wait("cardExit");
    local.cardLeaving = false;
    send(action);
  }
  async function resolveChallenge(action) {
    send(action);
    if (state.phase !== "reward") return;
    play("win");
    burst(app.querySelector(".points-pop"));
    await wait("reward");
    await animateGrid();
  }
  async function finalSpin() {
    local.slotSpinning = true;
    local.prizeVisible = false;
    send({ type: "SPIN_FINAL" });
    await revealReels("finalSpin");
    if (state.lastSpin.payout > 0) {
      play("win");
      burst(app.querySelector(".prize-board"), true);
    }
    await countPrize(state.lastSpin.payout);
    await wait("finalPrize");
    send({ type: "END_FINAL_RESULT" });
    if (state.phase === "finished") {
      burst(app.querySelector(".prize-board"), true);
      announce("ui.finished");
    }
  }
  function resetGame() {
    state = createGame(config, rng);
    Object.assign(local, {
      rotation: 0,
      numeric: 0,
      slotSpinning: false,
      wheelSpinning: false,
      displayStops: null,
      presentation: null,
      gridCells: null,
      collected: [],
      drawIndex: 0,
      upgradedCells: [],
      displayReels: null,
      prizeVisible: false,
      cardLeaving: false,
    });
    effects.replaceChildren();
    if (modal) closeModal();
    render();
  }

  async function handleAction(action, event) {
    if (action === "retry") {
      location.reload();
      return;
    }
    if (action === "close-modal") {
      closeModal();
      return;
    }
    if (action === "rules") {
      openModal("rules");
      return;
    }
    if (action === "request-restart") {
      if (!local.busy) openModal("restart");
      return;
    }
    if (action === "sound") {
      local.sound = !local.sound;
      if (local.sound) await audio.ready();
      else audio.stop();
      const control = app.querySelector('[data-action="sound"]');
      control.setAttribute("aria-pressed", String(local.sound));
      control.setAttribute(
        "aria-label",
        t(local.sound ? "ui.audioOn" : "ui.audioOff"),
      );
      control
        .querySelector("use")
        .setAttribute(
          "href",
          new URL(
            `../../assets/casino.svg#${local.sound ? "speaker" : "muted"}`,
            import.meta.url,
          ),
        );
      play("pick");
      return;
    }
    if (action === "fullscreen") {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        /* Browser may not offer fullscreen. */
      }
      return;
    }
    if (local.busy || (modal && action !== "restart")) return;
    if (event?.target.closest("button")?.disabled) return;
    local.busy = true;
    try {
      if (local.sound) await audio.ready();
      switch (action) {
        case "spin":
          if (state.phase === "wheel") await spinWheel();
          break;
        case "pick":
          local.numeric = 0;
          send({ type: "PICK_CARD" });
          play("pick");
          await wait("flip");
          break;
        case "accept":
          local.numeric = 0;
          send({ type: "ACCEPT" });
          break;
        case "reject":
          await exitCard({ type: "REJECT" });
          break;
        case "success":
          await resolveChallenge({ type: "RESOLVE", success: true });
          break;
        case "fail":
          if (state.card.reward.failure === 0)
            await exitCard({ type: "RESOLVE", success: false });
          else await resolveChallenge({ type: "RESOLVE", success: false });
          break;
        case "numeric":
          if (state.card.reward.byResult[local.numeric] === 0)
            await exitCard({ type: "RESOLVE", result: local.numeric });
          else
            await resolveChallenge({ type: "RESOLVE", result: local.numeric });
          break;
        case "more":
          local.numeric = Math.min(state.card.maximum, local.numeric + 1);
          break;
        case "less":
          local.numeric = Math.max(0, local.numeric - 1);
          break;
        case "continue":
        case "advance":
          send({ type: "CHOOSE_PROGRESSION", continue: action === "continue" });
          break;
        case "final-spin":
          await finalSpin();
          break;
        case "restart":
          resetGame();
          break;
      }
    } catch (error) {
      console.error(error);
      app.innerHTML = `<section class="load-error"><h1>${escapeHtml(t("app.error"))}</h1><pre>${escapeHtml(error.message)}</pre><button class="primary" data-action="retry">${escapeHtml(t("ui.errorBack"))}</button></section>`;
    } finally {
      local.busy = false;
      if (!app.querySelector(".load-error")) {
        const stepFocus =
          action === "more"
            ? local.numeric === state.card.maximum
              ? "less"
              : "more"
            : action === "less"
              ? local.numeric === 0
                ? "more"
                : "less"
              : null;
        render(stepFocus);
        if (!modal && !app.contains(document.activeElement)) {
          const focus =
            state.phase === "wheel"
              ? "spin"
              : state.phase === "cards"
                ? "pick"
                : state.phase === "offer"
                  ? "accept"
                  : state.phase === "challenge"
                    ? state.card.resolution === "numeric"
                      ? "more"
                      : "success"
                    : state.phase === "decision"
                      ? "advance"
                      : state.phase === "final_ready"
                        ? "final-spin"
                        : state.phase === "finished"
                          ? "restart"
                          : null;
          if (focus)
            app
              .querySelector(`[data-action="${focus}"]:not(:disabled)`)
              ?.focus({ preventScroll: true });
        }
      }
    }
  }

  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-action]");
    if (control) {
      void handleAction(control.dataset.action, event);
      return;
    }
    if (
      !local.busy &&
      !modal &&
      state.phase === "wheel" &&
      !event.target.closest(
        "[data-no-spin],a,button,details,summary,#modal-root",
      )
    )
      void handleAction("spin", event);
  });
  document.addEventListener("keydown", (event) => {
    if (modal) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
      }
      if (event.key === "Tab") {
        const controls = [
            ...modals.querySelectorAll("button:not(:disabled),a[href]"),
          ],
          first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    } else if (
      (event.key === " " || event.key === "Enter") &&
      !event.repeat &&
      state.phase === "wheel" &&
      !local.busy &&
      (event.target === document.body ||
        event.target === app.querySelector("#stage"))
    ) {
      event.preventDefault();
      void handleAction("spin", event);
    }
  });
  document.addEventListener("fullscreenchange", () => {
    app
      .querySelector('[data-action="fullscreen"]')
      ?.setAttribute(
        "aria-label",
        t(document.fullscreenElement ? "ui.exitFullscreen" : "ui.fullscreen"),
      );
  });
  render();
} catch (error) {
  app.removeAttribute("aria-busy");
  app.innerHTML = `<section class="load-error"><pre>${escapeHtml(error.message)}</pre><button type="button" class="primary" id="retry">↻</button></section>`;
  app
    .querySelector("#retry")
    .addEventListener("click", () => location.reload());
  console.error(error);
}

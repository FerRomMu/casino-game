import { attainablePrizes } from "../domain/slots.js";
import { finalBank } from "../domain/game.js";
import { wheelSectors } from "../domain/random.js";
import { wheelCategories, progressionStatus } from "../domain/progression.js";

export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const sprite = new URL("../../assets/casino.svg", import.meta.url).href;

export function createRenderer(config, t) {
  const e = escapeHtml,
    text = (key) => e(t(key));
  const number = (n) =>
    new Intl.NumberFormat(config.ui.locale, {
      maximumFractionDigits: 0,
    }).format(n);
  const percentage = (p) => new Intl.NumberFormat(config.ui.locale, {maximumFractionDigits: config.ui.wheelProbabilityDigits ?? 1}).format(p * 100);
  const money = (n) =>
    new Intl.NumberFormat(config.ui.locale, {
      style: "currency",
      currency: config.ui.currency,
      maximumFractionDigits: 0,
    }).format(n);
  const art = (id, cls = "") =>
    `<svg class="art ${cls}" viewBox="0 0 100 100" aria-hidden="true"><use href="${sprite}#${e(id)}"/></svg>`;
  const icon = (id) =>
    `<svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="${sprite}#${e(id)}"/></svg>`;
  const symbol = (id) =>
    `<span class="symbol symbol-${e(id)}" data-symbol="${e(id)}" title="${text(config.symbols[id].name_key)}">${config.symbols[id].art ? art(config.symbols[id].art) : text(config.symbols[id].icon_key)}</span>`;
  const button = (action, key, cls = "primary", attrs = "") =>
    `<button type="button" class="${cls}" data-action="${action}" ${attrs}><span>${text(key)}</span></button>`;
  const bulbs = (n = 30, cls = "") =>
    `<div class="marquee-bulbs ${cls}" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div>`;
  const sparks = () =>
    `<div class="spark-particles" aria-hidden="true">${Array.from({ length: config.ui.particleCount }, (_, i) => `<i style="--i:${i};--x:${(i * 37 + 11) % 100}%;--delay:${(i % 7) * -0.8}s"></i>`).join("")}</div>`;
  function wheelMarkup(state, local) {
    const sectors = wheelSectors(local.wheelSpinning && state.spinCategories ? state.spinCategories : wheelCategories(state, config));
    const polar = (a, r) => [
      300 + Math.sin((a * Math.PI) / 180) * r,
      300 - Math.cos((a * Math.PI) / 180) * r,
    ];
    const segments = sectors
      .filter((s) => s.probability > 0)
      .map((s, i) => {
        const a = s.start * 360,
          b = s.end * 360,
          mid = (a + b) / 2;
        const start = polar(a, 245),
          end = polar(b, 245),
          label = polar(mid, 175),
          mark = polar(mid, 216),
          rate = polar(mid, 141);
        const rotation = mid > 90 && mid < 270 ? mid + 180 : mid;
        const shape =
          s.probability >= 1 - 1e-10
            ? '<circle cx="300" cy="300" r="245"'
            : `<path d="M300 300L${start.join(" ")}A245 245 0 ${b - a > 180 ? 1 : 0} 1 ${end.join(" ")}Z"`;
        return `<g data-sector="${e(s.id)}" data-probability="${s.probability}" data-start="${s.start}" data-end="${s.end}"><defs><radialGradient id="sector-${i}" gradientUnits="userSpaceOnUse" cx="300" cy="300" r="245"><stop stop-color="#26083c"/><stop offset=".5" stop-color="${e(s.color)}"/><stop offset="1" stop-color="${e(s.color)}"/></radialGradient></defs>${shape} fill="url(#sector-${i})" stroke="#ffdc7b" stroke-width="2"/>${shape} fill="url(#wheel-sheen)"/><title>${text(s.name_key)} · ${percentage(s.probability)}%</title>${s.probability >= 0.065 ? `<use href="${sprite}#${e(s.art)}" x="${mark[0] - 18}" y="${mark[1] - 18}" width="36" height="36" transform="rotate(${rotation},${mark.join(",")})"/>` : ""}${s.probability >= 0.045 ? `<text class="sector-name" x="${label[0]}" y="${label[1]}" transform="rotate(${rotation},${label.join(",")})" text-anchor="middle" dominant-baseline="middle" style="font-size:${t(s.name_key).length > 16 ? 15 : 18}px">${text(s.name_key)}</text><text class="sector-rate" x="${rate[0]}" y="${rate[1]}" transform="rotate(${rotation},${rate.join(",")})" text-anchor="middle">${percentage(s.probability)}%</text>` : ""}</g>`;
      })
      .join("");
    const lights = Array.from({ length: config.ui.wheelBulbs }, (_, i) => {
      const p = polar((i / config.ui.wheelBulbs) * 360, 278);
      return `<circle class="wheel-bulb" cx="${p[0]}" cy="${p[1]}" r="4" style="--i:${i}"/>`;
    }).join("");
    return `<div class="wheel-wrap ${local.wheelSpinning ? "is-spinning" : ""}"><div class="wheel-aura"></div><div class="wheel-pedestal"></div><svg class="wheel-rim" viewBox="0 0 600 600" aria-hidden="true"><defs><linearGradient id="rim-gold" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#fff6c3"/><stop offset=".18" stop-color="#f9bf42"/><stop offset=".4" stop-color="#9b4914"/><stop offset=".55" stop-color="#ffe9a0"/><stop offset=".75" stop-color="#bd690b"/><stop offset="1" stop-color="#fff0b5"/></linearGradient><radialGradient id="rim-shade"><stop offset=".7" stop-color="#36115c"/><stop offset="1" stop-color="#0c021a"/></radialGradient><filter id="bulb-glow"><feGaussianBlur stdDeviation="2.8"/></filter></defs><circle cx="300" cy="309" r="290" fill="#080312"/><circle cx="300" cy="300" r="291" fill="url(#rim-gold)"/><circle cx="300" cy="300" r="283" fill="url(#rim-shade)" stroke="#693312" stroke-width="2"/><circle cx="300" cy="300" r="270" fill="none" stroke="#b36f1c"/><circle cx="300" cy="300" r="260" fill="url(#rim-gold)"/><circle cx="300" cy="300" r="250" fill="#381137"/><g opacity=".7" filter="url(#bulb-glow)">${lights}</g>${lights}</svg><svg id="wheel" class="wheel-disc" viewBox="0 0 600 600" role="img" aria-label="${text("ui.probabilities")}" style="transform:rotate(${local.rotation}deg);--spin-duration:${local.motion("wheel")}ms"><defs><radialGradient id="wheel-sheen" gradientUnits="userSpaceOnUse" cx="300" cy="300" r="245"><stop stop-color="#000" stop-opacity=".1"/><stop offset=".66" stop-color="#fff" stop-opacity="0"/><stop offset=".87" stop-color="#fff" stop-opacity=".2"/><stop offset="1" stop-color="#13002e" stop-opacity=".5"/></radialGradient></defs>${segments}<circle cx="300" cy="300" r="241" fill="none" stroke="#ffeac0" opacity=".7"/></svg><div class="wheel-pointer" aria-hidden="true"><span></span></div><button type="button" class="wheel-hub" data-action="spin" aria-label="${text("ui.spin")}" ${local.busy ? "disabled" : ""}><span class="hub-arrow">↻</span><span>${text("ui.spinShort")}</span></button></div>`;
  }

  function wheelScene(s, l) {
    return `<section class="scene wheel-scene ${l.enter ? "scene-enter" : ""}"><div class="scene-heading"><span class="eyebrow">${text("app.eyebrow")}</span><h1>${text("app.subtitle")}</h1><p>${text("ui.spinHint")}</p></div><div class="wheel-theater"><div class="floating-symbol floating-a">${art("cherry")}</div><div class="floating-symbol floating-b">${art("diamond")}</div><div class="floating-coin coin-a">${art("coin")}</div><div class="floating-coin coin-b">${art("coin")}</div>${wheelMarkup(s, l)}</div><div class="wheel-actions">${button("spin", l.wheelSpinning ? "ui.spinning" : "ui.spin", "primary spin-button", l.busy ? "disabled" : "")}<span class="click-hint"><i></i>${text(l.wheelSpinning ? "ui.locked" : "ui.ready")}</span></div><details class="category-details" ${l.probabilitiesOpen ? "open" : ""}><summary>${text("ui.probabilities")}<span>⌄</span></summary><div class="category-list">${wheelSectors(
      l.wheelSpinning && s.spinCategories ? s.spinCategories : wheelCategories(s, config),
    )
      .map(
        (c) =>
          `<div class="category-pill" style="--category:${e(c.color)}">${art(c.art)}<span>${text(c.name_key)}</span><b>${percentage(c.probability)}%</b></div>`,
      )
      .join("")}</div></details></section>`;
  }

  function categoryScene(s, l) {
    return `<section class="scene category-reveal ${l.enter ? "scene-enter" : ""}" style="--category:${e(s.category.color)}"><div class="category-explosion"></div>${sparks()}<span class="eyebrow">${text(config.wheels[s.wheel].label_key)}</span><div class="category-medallion">${art(s.category.art)}</div><h1>${text(s.category.name_key)}</h1><p>${text(s.category.description_key)}</p></section>`;
  }

  function cardsScene(s, l) {
    return `<section class="scene cards-scene ${l.enter ? "scene-enter" : ""}"><div class="scene-heading"><span class="eyebrow category-badge" style="--category:${e(s.category.color)}">${art(s.category.art)}${text(s.category.name_key)}</span><h1>${text("ui.chooseCard")}</h1><p>${text("ui.cardHint")}</p></div><div class="card-fan" style="--cards:${config.ui.cardsToDeal}">${Array.from({ length: config.ui.cardsToDeal }, (_, i) => `<button type="button" class="card-back" data-action="pick" data-card-index="${i}" style="--card-index:${i};--card-center:${(config.ui.cardsToDeal - 1) / 2}" aria-label="${text("ui.chooseCard")} ${i + 1}" ${l.busy ? "disabled" : ""}><span class="card-corner">✦</span><span class="card-corner bottom-corner">✦</span><span class="card-orbit">${art("wild")}</span><strong class="card-brand">${text("app.title")}</strong><span class="card-line"></span><span class="card-bottom">${text("ui.deck")}</span></button>`).join("")}</div><p class="select-hint"><span>✦</span>${text("ui.selectHint")}<span>✦</span></p></section>`;
  }

  function challengeScene(s, l) {
    const active = s.phase === "challenge",
      c = s.card,
      numeric = c.resolution === "numeric";
    const low = numeric ? c.reward.byResult[0] : c.reward.failure,
      high = numeric ? c.reward.byResult[c.maximum] : c.reward.success;
    return `<section class="scene challenge-scene ${l.enter ? "scene-enter" : ""}"><div class="challenge-card ${l.cardLeaving ? "card-leaving" : ""}" style="--category:${e(s.category.color)}"><div class="card-topline"><span class="category-badge">${art(s.category.art)}${text(s.category.name_key)}</span><span class="challenge-mark">✦</span></div><span class="eyebrow">${text(active ? "ui.challengeActive" : "ui.challenge")}</span><h1>${text(c.text_key)}</h1><div class="reward-tags"><div>${art("coin")}<span>${text("ui.successReward")}<b>+${number(high)} <small>${text("ui.points")}</small></b></span></div><div>${art("coin")}<span>${text("ui.failureReward")}<b>+${number(low)} <small>${text("ui.points")}</small></b></span></div></div>${active && numeric ? `<div class="numeric-control"><p>${text("ui.numericHint")}</p><div class="numeric-stepper"><button type="button" data-action="less" aria-label="${text("ui.less")}" ${l.numeric <= 0 ? "disabled" : ""}>−</button><output aria-live="polite" data-numeric-result>${l.numeric}<span> / ${c.maximum}</span></output><button type="button" data-action="more" aria-label="${text("ui.more")}" ${l.numeric >= c.maximum ? "disabled" : ""}>+</button></div><span class="numeric-reward">+${number(c.reward.byResult[l.numeric])} ${text("ui.points")}</span></div>` : ""}<div class="actions">${!active ? button("reject", "ui.reject", "secondary") + button("accept", "ui.accept", "primary green-button") : numeric ? button("reject", "ui.cancel", "secondary") + button("numeric", "ui.result", "primary green-button") : button("fail", "ui.fail", "secondary") + button("success", "ui.complete", "primary green-button")}</div>${active && !numeric ? button("reject", "ui.cancel", "text-button") : ""}</div></section>`;
  }

  function tileContent(tile) {
    if (!tile)
      return `<span class="empty-cell" aria-label="${text("ui.empty")}">·</span>`;
    if (tile.kind === "symbol")
      return `${symbol(tile.symbol)}${tile.units > 1 ? `<b class="tile-units">×${tile.units}</b>` : ""}`;
    const effect = config.grid.effects[tile.effect];
    return `<span class="effect-symbol" title="${text(effect.name_key)}">${effect.art ? art(effect.art) : text(effect.icon_key)}</span>`;
  }

  function gridScene(s, l) {
    const cells = l.gridCells ?? s.grid.cells,
      collected = l.collected ?? [];
    return `<section class="scene grid-scene ${l.enter ? "scene-enter" : ""}"><div class="scene-heading"><span class="eyebrow">${text("ui.collecting")}</span><h1>${text("ui.grid")}</h1><p>${text("ui.gridHint")}</p></div><div class="grid-layout"><div class="board-cabinet">${bulbs(18, "board-top")}<div class="tile-grid" style="--columns:${config.grid.columns}">${cells.map((tile, i) => `<div class="tile ${!tile ? "off" : ""} ${l.upgradedCells?.includes(i) ? "upgraded" : ""}" data-cell="${i}">${tileContent(tile)}</div>`).join("")}</div>${bulbs(18, "board-bottom")}<div class="board-counter">${text("ui.draw")} <b>${Math.min(l.drawIndex + 1, s.extraction?.draws.length ?? 0)} / ${s.extraction?.draws.length ?? 0}</b></div></div><div class="collected-tray"><div class="tray-heading">${art("coin")}<span>${text("ui.collected")}</span></div><div class="collected-items" id="collected">${collected.map((tile, i) => `<div class="collected-token" style="--i:${i}">${tileContent(tile)}</div>`).join("")}${!collected.length ? '<span class="tray-wait">✦</span>' : ""}</div></div></div></section>`;
  }

  let prizeTableKey = null,
    prizeTable = null;
  function payoutTable(s, l) {
    const reels = l.displayReels ?? s.reels;
    const key = JSON.stringify(reels.map((reel) => [...new Set(reel)].sort()));
    if (key !== prizeTableKey) {
      prizeTable = attainablePrizes(reels, config.slots);
      prizeTableKey = key;
    }
    const compact = (value) => {
      const unit = config.ui.prizeTable.units.find(
        (unit) => value >= unit.minimum,
      );
      return (
        numberFormat.format(value / (unit?.divisor ?? 1)) +
        (unit ? text(unit.suffix_key) : "")
      );
    };
    const numberFormat = new Intl.NumberFormat(config.ui.locale, {
      maximumFractionDigits: config.ui.prizeTable.fractionDigits,
    });
    const result =
      ["final_result", "final_ready", "finished"].includes(s.phase) &&
      l.prizeVisible &&
      !l.slotSpinning
        ? s.lastSpin
        : null;
    const amount = (value, multiplied = false) =>
      value == null
        ? `<span class="pay-unavailable" aria-label="${text("ui.prizeTableUnavailable")}">—</span>`
        : `<span class="${multiplied ? "pay-multiplied" : "pay-normal"}" data-payout="${value}" title="${text(multiplied ? "ui.prizeTableMultiplied" : "ui.prizeTableNormal")} · ${money(value)}" aria-label="${text(multiplied ? "ui.prizeTableMultiplied" : "ui.prizeTableNormal")} ${money(value)}">${compact(value)}</span>`;
    const hasMultiplier = prizeTable.rows.some((row) =>
      row.counts.some((cell) => cell.multiplied != null),
    );
    const columns = Array.from({ length: reels.length }, (_, i) => i + 1);
    return `<section class="payout-panel" aria-label="${text("ui.prizeTable")}" data-prize-maximum="${prizeTable.maximum}">
      <div class="payout-heading"><h2>${art("crown")}${text("ui.prizeTable")}</h2><div><span>${text("ui.prizeTableMaximum")}</span><strong>${money(prizeTable.maximum)}</strong></div></div>
      <table class="payout-table"><thead><tr><th scope="col"><span class="sr-only">${text("ui.prizeTableSymbol")}</span>${e(config.ui.currency)}</th>${columns.map((count) => `<th scope="col">×${count}</th>`).join("")}</tr></thead><tbody>${prizeTable.rows.map((row) => `<tr data-pay-symbol="${e(row.symbol)}"><th scope="row">${symbol(row.symbol)}<span class="sr-only">${text(config.symbols[row.symbol].name_key)}</span></th>${row.counts.map((cell) => `<td data-pay-count="${cell.count}" class="${cell.normal != null || cell.multiplied != null ? "pay-available" : "pay-locked"} ${result?.payout > 0 && !result.exceptional && result.winningSymbol === row.symbol && result.winningIndices.length === cell.count ? "pay-hit" : ""}">${amount(cell.normal)}${cell.multiplied != null ? `<span class="pay-divider" aria-hidden="true">/</span>${amount(cell.multiplied, true)}` : ""}</td>`).join("")}</tr>`).join("")}</tbody></table>
      <div class="payout-jackpot ${prizeTable.jackpot.available ? "is-available" : "is-locked"} ${result?.exceptional ? "pay-hit" : ""}" data-jackpot-available="${prizeTable.jackpot.available}"><span class="payout-jackpot-symbols">${columns.map(() => symbol(config.slots.payout.exceptional.symbol)).join("")}</span><span>${text("ui.prizeTableJackpot")}<small>${text(prizeTable.jackpot.available ? "ui.prizeTableAvailable" : "ui.prizeTableLocked")}</small></span><b>${money(prizeTable.jackpot.payout)}</b></div>
      <p class="payout-legend">${prizeTable.maximum === 0 ? text("ui.prizeTableEmpty") : `${hasMultiplier ? `${text("ui.prizeTableNormalShort")} / ×${number(config.slots.payout.multiplier)} · ` : ""}${text("ui.prizeTableLegend")} · ${text("ui.prizeTableUnits")}`}</p>
    </section>`;
  }

  function machine(s, line, l) {
    const reels = l.displayReels ?? s.reels;
    const stops =
      l.displayStops ??
      (s.phase === "preview" ? s.previewOutcome.stops : s.lastSpin?.stops);
    const result =
      ["final_result", "final_ready", "finished"].includes(s.phase) &&
      l.prizeVisible &&
      !l.slotSpinning
        ? s.lastSpin
        : null;
    const markup = reels
      .map((reel, i) => {
        const center =
            stops?.[i] != null
              ? reel[stops[i]]
              : (line?.[i] ?? config.slots.stone),
          pos = stops?.[i] ?? Math.max(0, reel.indexOf(center));
        const above = reel[(pos + reel.length - 1) % reel.length],
          below = reel[(pos + 1) % reel.length];
        const rare = (config.grid.ranks[center] ?? 0) >= config.ui.rareRank;
        const winning = result?.winningIndices.includes(i),
          multiplying = result?.multiplierIndices.includes(i);
        return `<div class="reel ${l.slotSpinning ? "reel-spinning" : ""} ${rare ? "rare-reel" : ""}" data-reel="${i}" data-position="${pos}" style="--reel-index:${i};--reel-length:${reel.length}"><div class="reel-window"><div class="reel-static"><div class="reel-cell adjacent-symbol">${symbol(above)}</div><div class="reel-cell payline-symbol ${winning ? "winning-symbol" : ""} ${multiplying ? "winning-multiplier" : ""}" ${winning || multiplying ? `data-contribution="${multiplying ? "multiplier" : "symbol"}"` : ""}>${symbol(center)}${winning || multiplying ? `<span class="winner-mark">${text(multiplying ? "ui.multiplierApplied" : "ui.winningSymbol")}</span>` : ""}</div><div class="reel-cell adjacent-symbol">${symbol(below)}</div></div><div class="reel-blur-strip" aria-hidden="true">${[...reel, ...reel.slice(0, 3)].map((id) => `<div class="reel-cell">${symbol(id)}</div>`).join("")}</div></div><span class="reel-shine"></span></div>`;
      })
      .join("");
    return `<div class="slot-machine ${result?.payout > 0 ? "has-winning-line" : ""}"><div class="machine-crown">${art("crown")}</div><div class="machine-marquee">${bulbs(16)}<span>✦</span><b>${text("app.title")}</b><span>✦</span></div><div class="machine-body"><div class="machine-column column-left"></div><div class="reel-frame"><span class="payline-arrow arrow-left">▸</span>${markup}<div class="payline" aria-hidden="true"></div><span class="payline-arrow arrow-right">◂</span></div><div class="machine-column column-right"></div></div><div class="machine-base"><span>✦ ✦ ✦</span><b>${text("ui.machine")}</b><span>✦ ✦ ✦</span></div></div>`;
  }

  function slotsScene(s, l) {
    const final = [
        "finale",
        "final_ready",
        "final_result",
        "finished",
      ].includes(s.phase),
      finished = s.phase === "finished",
      preview = s.phase === "preview";
    const outcome = preview ? s.previewOutcome : null;
    // Keep both banks at their previous values until the last reel reveals the prize.
    const bankState =
      s.phase === "final_result" && l.slotSpinning
        ? { ...s, total: s.total - s.lastSpin.payout, spins: s.spins + 1 }
        : s;
    const bank = finalBank(bankState);
    const idle = (l.displayReels ?? s.reels).map(
      (reel) =>
        reel.find((id) => id !== config.slots.stone) ?? config.slots.stone,
    );
    const line = final
      ? (s.lastSpin?.line ?? idle)
      : preview
        ? outcome.line
        : idle;
    const prize = finished
      ? s.total
      : preview
        ? outcome.payout
        : (s.lastSpin?.payout ?? 0);
    const title = finished
      ? "ui.finished"
      : s.phase === "finale"
        ? "ui.finalTitle"
        : s.phase === "final_result"
          ? "ui.prize"
          : final
            ? "ui.finalReady"
            : preview
              ? "ui.preview"
              : "ui.installing";
    return `<section class="scene slots-scene ${l.enter ? "scene-enter" : ""} ${l.prizeVisible ? "show-prize" : ""}"><div class="scene-heading"><span class="eyebrow">${text(final ? "ui.finalBadge" : preview ? "ui.previewBadge" : "ui.machine")}</span><h1>${text(title)}</h1>${!final && !preview ? `<p>${text("ui.installingHint")}</p>` : ""}</div>${final ? `<div class="final-stats"><div class="final-spin-bank"><span>${text("ui.remaining")}</span><b data-remaining-spins>${number(s.spins)}</b></div><div class="accumulated-bank"><span>${text("ui.accumulated")}</span><b data-accumulated data-value="${bank.accumulated}">${money(bank.accumulated)}</b></div><div class="pot-bank"><span>${text("ui.pot")}</span><b data-pot data-value="${bank.maximum}">${money(bank.maximum)}</b></div></div>` : ""}<div class="machine-theater">${payoutTable(s, l)}${machine(s, line, l)}${!final && !preview ? `<div class="token-queue" aria-label="${text("ui.collected")}">${s.extraction.tokens.map((token, i) => `<div data-queue="${i}" class="queue-token">${tileContent({ kind: "symbol", ...token })}</div>`).join("")}</div>` : ""}</div>${preview || s.phase === "final_result" || finished ? `<div class="prize-board ${l.prizeVisible || finished ? "is-visible" : ""} ${preview && s.newMaximum ? "new-maximum" : ""}" style="--prize-scale:${[...config.ui.prizeTiers].reverse().find((tier) => prize >= tier.minimum)?.scale ?? 1}" data-preview-kind="${preview ? (s.newMaximum ? "maximum" : "random") : "final"}" aria-live="polite"><span>${text(finished ? "ui.total" : preview ? (s.newMaximum ? "ui.previewMax" : "ui.previewExample") : prize > 0 ? "ui.prize" : "ui.zero")}</span><strong data-prize data-value="${prize}">${money(prize)}</strong></div>` : ""}${preview ? `<p class="fine-print">${text("ui.previewNote")}</p>` : ""}${s.phase === "final_ready" ? `<div class="final-actions">${button("final-spin", "ui.finalSpin", "primary green-button final-spin", l.busy ? "disabled" : "")}<p>${text("ui.finalSpinHint")}</p></div>` : ""}${s.phase === "finale" ? `<div class="final-intro"><b>${number(s.spins)}</b><span>${text("ui.finalIntroLabel")}</span></div>` : ""}${s.phase === "final_result" && l.slotSpinning ? `<p class="spinning-label">${text("ui.prizePending")}</p>` : ""}${finished ? `<div class="finish-actions"><p>${text("ui.finishedHint")}</p>${button("restart", "app.restart", "primary green-button")}</div>` : ""}</section>`;
  }

  function progressionScene(s, l) {
    return `<section class="scene fire-scene ${l.enter ? "scene-enter" : ""}"><div class="fire-rays"></div><div class="fire-burst" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => `<span style="--i:${i}">${text("ui.fireIcon")}</span>`).join("")}</div><div class="big-fire">${art("flame")}</div><h1>${text("ui.fire")}</h1><p>${text("ui.fireHint")}</p><div class="progression-large">${Array.from({ length: config.progression.choiceAt }, (_, i) => `<span class="flame-medal ${i < s.progression ? "lit" : ""}">${art("flame")}</span>`).join("")}</div><span class="fire-count">${s.progression} / ${config.progression.choiceAt}</span></section>`;
  }

  function sidebar(s, l) {
    const reels = l.displayReels ?? s.reels;
    const filled = reels
        .flat()
        .filter((id) => id !== config.slots.stone).length,
      capacity = config.slots.reels * config.slots.positions;
    return `<aside class="status-sidebar" data-no-spin><section class="jackpot-panel"><div class="jackpot-label">${art("crown")}<span>${text("ui.jackpot")}</span>${art("crown")}</div><strong>${money(config.slots.payout.exceptional.value)}</strong><div class="jackpot-symbols">${Array.from({ length: config.slots.reels }, () => symbol(config.slots.payout.exceptional.symbol)).join("")}</div><p>${text("ui.jackpotHint")}</p></section><section class="machine-status"><div class="panel-heading"><span>${text("ui.machine")}</span><span class="panel-tag">${filled === capacity ? text("ui.full") : `${Math.round((filled / capacity) * 100)}%`}</span></div><div class="mini-reels">${reels.map((reel) => `<div>${symbol([...reel].reverse().find((id) => id !== config.slots.stone) ?? config.slots.stone)}</div>`).join("")}</div><div class="capacity-label"><b data-filled>${filled}<small> / ${capacity}</small></b><span>${text("ui.filled")}</span></div><div class="capacity-bar"><i style="--fill:${(filled / capacity) * 100}%"></i></div><p class="panel-caption">${text("ui.machineHint")}</p><section class="composition"><h2>${text("ui.inventory")}</h2><div class="inventory-table">${Object.keys(
      config.slots.target,
    )
      .map(
        (id) =>
          `<div>${symbol(id)}<span>${reels.map((reel) => reel.filter((x) => x === id).length).join("·")}</span></div>`,
      )
      .join(
        "",
      )}</div></section></section><section class="spin-bank"><div>${art("spin")}<span>${text("ui.spins")}<small>${text("ui.spinBankHint")}</small></span><strong data-banked-spins>${number(s.spins)}</strong></div></section><section class="progress-panel"><div class="panel-heading"><span>${text("ui.progression")}</span><b>${s.progression} / ${config.progression.choiceAt}</b></div><div class="progression-dots">${Array.from({ length: config.progression.choiceAt }, (_, i) => `<span class="flame-medal ${i < s.progression ? "lit" : ""}">${art("flame")}</span>`).join("")}</div><p class="panel-caption">${progressionStatus(s, config).locked ? `${text("ui.progressLocked")} ${number(config.progression.adaptive.minimumFill * 100)}%` : text("ui.progressHint")}</p></section></aside>`;
  }

  function render(s, l) {
    const phase = l.presentation ?? s.phase;
    let scene;
    if (phase === "wheel") scene = wheelScene(s, l);
    else if (phase === "category") scene = categoryScene(s, l);
    else if (phase === "cards") scene = cardsScene(s, l);
    else if (["offer", "challenge"].includes(phase))
      scene = challengeScene(s, l);
    else if (phase === "reward")
      scene = `<section class="scene reward-scene scene-enter">${sparks()}<div class="reward-emblem">${art("coin")}</div><span class="eyebrow">${text("ui.points")}</span><strong class="points-pop">+${number(s.points)}</strong><h1>${text("ui.reward")}</h1><p>${text("ui.pointsHint")}</p></section>`;
    else if (phase === "grid") scene = gridScene(s, l);
    else if (phase === "progression") scene = progressionScene(s, l);
    else if (phase === "wheel_transition")
      scene = `<section class="scene reward-scene scene-enter">${sparks()}<div class="big-fire">${art("flame")}</div><span class="eyebrow">${text("ui.stageUnlocked")}</span><h1>${text(config.wheels[config.progression.nextWheel].label_key)}</h1><p>${text("ui.stageUnlockedHint")}</p></section>`;
    else if (phase === "decision")
      scene = `<section class="scene decision-scene scene-enter"><div class="big-fire">${art("flame")}</div><span class="eyebrow">${text(config.wheels[s.wheel].label_key)}</span><h1>${text("ui.decision")}</h1><p>${text("ui.decisionHint")}</p><div class="actions">${button("continue", "ui.continue", "secondary")}${button("advance", "ui.advance", "primary green-button")}</div></section>`;
    else scene = slotsScene(s, l);
    return `<div class="casino-backdrop" aria-hidden="true"><span class="spotlight spotlight-left"></span><span class="spotlight spotlight-right"></span><span class="backdrop-diamond">♦</span><span class="backdrop-star">✦</span>${sparks()}</div><div class="app-shell"><div class="play-layout"><div class="cabinet"><div class="cabinet-heading" data-no-spin><div class="brand"><span class="brand-emblem">${art("wild")}</span><div><span class="wordmark">${text("app.title")}</span><div class="round-label"><strong>${text(config.wheels[s.wheel].label_key)}</strong><span class="turn-label">${text("ui.turn")} <b data-turn>${String(s.turn).padStart(2, "0")}</b></span></div></div></div><div class="cabinet-controls"><button type="button" class="icon-button" data-action="sound" aria-label="${text(l.sound ? "ui.audioOn" : "ui.audioOff")}" aria-pressed="${l.sound}">${icon(l.sound ? "speaker" : "muted")}</button><button type="button" class="icon-button fullscreen-button" data-action="fullscreen" aria-label="${text("ui.fullscreen")}">${icon("expand")}</button><button type="button" class="icon-button" data-action="rules" aria-label="${text("ui.helpHint")}">?</button><button type="button" class="icon-button" data-action="request-restart" aria-label="${text("ui.newGame")}">↻</button></div></div><div class="cabinet-top-lights">${bulbs(38)}</div><main class="stage ${l.busy ? "is-busy" : ""}" id="stage" data-phase="${s.phase}" data-busy="${l.busy}" tabindex="-1">${scene}</main><div class="cabinet-bottom"><span>✦ ✦ ✦</span><p>${text("ui.footer")}</p><span>✦ ✦ ✦</span></div></div>${sidebar(s, l)}</div></div>`;
  }
  render.modal = (kind = "rules") =>
    `<div class="modal-scrim"><section class="rules-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><button type="button" class="modal-close icon-button" data-action="close-modal" aria-label="${text("app.close")}">×</button><span class="modal-emblem">${art(kind === "rules" ? "cards" : "spin")}</span><span class="eyebrow">${text("app.title")}</span><h2 id="modal-title">${text(kind === "rules" ? "ui.rulesTitle" : "ui.newGameConfirm")}</h2>${kind === "rules" ? `<div class="rule-steps">${[1, 2, 3].map((i) => `<div><b>${i}</b><div><h3>${text(`ui.rule${i}Title`)}</h3><p>${text(`ui.rule${i}Text`)}</p></div></div>`).join("")}</div>${button("close-modal", "ui.back", "primary green-button")}` : `<div class="actions">${button("close-modal", "ui.keepPlaying", "secondary")}${button("restart", "ui.confirmRestart")}</div>`}</section></div>`;
  Object.assign(render, { symbol, tileContent, money, art });
  return render;
}

import { wheelSectors } from '../domain/random.js';

export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function createRenderer(config, t) {
  const e = escapeHtml;
  const text = key => e(t(key));
  const number = value => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value);
  const money = value => `$ ${number(value)}`;
  const symbol = id => `<span class="symbol symbol-${e(id)}" title="${text(config.symbols[id].name_key)}">${text(config.symbols[id].icon_key)}</span>`;
  const button = (action, key, className = 'primary', extra = '') => `<button class="${className}" data-action="${action}" ${extra}>${text(key)}</button>`;

  function wheelSVG(state, local) {
    const sectors = wheelSectors(config.wheels[state.wheel].categories);
    const coord = (angle, radius) => [200 + Math.sin(angle * Math.PI / 180) * radius, 200 - Math.cos(angle * Math.PI / 180) * radius];
    const segments = sectors.filter(s => s.probability > 0).map(s => {
      const a = s.start * 360, b = s.end * 360;
      const p1 = coord(a, 185), p2 = coord(b, 185);
      const mid = (a + b) / 2;
      const pos = coord(mid, 123);
      const path = s.probability >= 1 - 1e-10 ? `<circle cx="200" cy="200" r="185" fill="${e(s.color)}"/>` : `<path d="M 200 200 L ${p1.join(' ')} A 185 185 0 ${b - a > 180 ? 1 : 0} 1 ${p2.join(' ')} Z" fill="${e(s.color)}" stroke="#20132d" stroke-width="2"/>`;
      const label = s.probability >= 0.055 ? `<text x="${pos[0]}" y="${pos[1]}" transform="rotate(${mid > 180 ? mid - 270 : mid - 90},${pos.join(',')})" text-anchor="middle" dominant-baseline="middle">${text(s.name_key)}</text>` : '';
      return `<g><title>${text(s.name_key)} · ${number(s.probability * 100)}%</title>${path}${label}</g>`;
    }).join('');
    const bulbs = Array.from({ length: 48 }, (_, i) => { const p = coord(i / 48 * 360, 195); return `<circle class="bulb" cx="${p[0]}" cy="${p[1]}" r="2.3" style="animation-delay:${i % 3 * .3}s"/>`; }).join('');
    return `<div class="wheel-wrap ${local.busy ? 'is-spinning' : ''}"><div class="wheel-pointer"></div><svg class="wheel-rim" viewBox="0 0 400 400" aria-hidden="true"><circle cx="200" cy="200" r="198" fill="#362144" stroke="#72503d" stroke-width="1"/>${bulbs}</svg><svg id="wheel" class="wheel" viewBox="0 0 400 400" role="img" aria-label="${text('ui.probabilities')}" style="transform:rotate(${local.rotation}deg);transition-duration:${local.motion('wheel')}ms">${segments}</svg><button class="wheel-hub" data-action="spin" aria-label="${text('ui.spin')}" ${local.busy ? 'disabled' : ''}>↗</button></div>`;
  }

  function wheelScene(state, local) {
    const label = config.wheels[state.wheel].label_key;
    return `<section class="wheel-scene scene"><div class="hero-copy"><div class="eyebrow"><span class="live-dot"></span>${text('app.eyebrow')}</div><h1>${text('app.subtitle')}</h1><p>${text('ui.spinHint')}</p>${button('spin', 'ui.spin', 'primary spin-button', local.busy ? 'disabled' : '')}<div class="current-round"><span>↗</span><div><small>${text('ui.stage')}</small><strong>${text(label)}</strong></div></div></div><div class="wheel-area"><span class="orbit orbit-a"></span><span class="orbit orbit-b"></span>${wheelSVG(state, local)}<div class="wheel-caption"><span class="sparkle">✦</span>${text(label)}<span class="sparkle">✦</span></div></div></section><div class="category-strip">${wheelSectors(config.wheels[state.wheel].categories).filter(c => c.weight > 0).map(c => `<div class="category-pill"><i style="--category:${e(c.color)}"></i><span>${text(c.name_key)}</span><b>${number(c.probability * 100)}%</b></div>`).join('')}</div>`;
  }

  function categoryScene(state) {
    return `<section class="scene category-reveal" style="--category:${e(state.category.color)}"><div class="category-bloom"></div><span class="eyebrow">${text(config.wheels[state.wheel].label_key)}</span><h1>${text(state.category.name_key)}</h1><p>${text(state.category.description_key)}</p></section>`;
  }

  function cardsScene(state) {
    return `<section class="scene cards-scene"><span class="eyebrow" style="color:${e(state.category.color)}">${text(state.category.name_key)}</span><h1>${text('ui.chooseCard')}</h1><p>${text('ui.cardHint')}</p><div class="card-fan">${Array.from({ length: config.ui.cardsToDeal }, (_, i) => `<button class="card-back" data-action="pick" style="--card-index:${i}" aria-label="${text('ui.chooseCard')} ${i + 1}"><span class="card-corner">✦</span><span class="card-orbit">✦</span><span class="card-brand">${text('app.title')}</span><span class="card-bottom">${text('ui.deck')}</span></button>`).join('')}</div></section>`;
  }

  function challengeScene(state, local) {
    const active = state.phase === 'challenge';
    const card = state.card;
    return `<section class="scene challenge-scene"><div class="challenge-card"><div class="card-topline"><span>${text(state.category.name_key)}</span><span>✦</span></div><span class="eyebrow">${text('ui.challenge')}</span><h2>${text(card.text_key)}</h2><div class="reward-tags"><span>${text('ui.successReward')} <b>+${number(card.reward.success)}</b></span><span>${text('ui.failureReward')} <b>+${number(card.reward.failure)}</b></span></div>${active && card.resolution === 'numeric' ? `<p class="numeric-hint">${text('ui.numericHint')}</p><div class="numeric-stepper"><button data-action="less" aria-label="${text('ui.less')}" ${local.numeric <= 0 ? 'disabled' : ''}>−</button><output>${local.numeric}<span> / ${card.maximum}</span></output><button data-action="more" aria-label="${text('ui.more')}" ${local.numeric >= card.maximum ? 'disabled' : ''}>+</button></div>` : ''}<div class="actions">${!active ? button('reject','ui.reject','secondary') + button('accept','ui.accept') : card.resolution === 'numeric' ? button('reject','ui.cancel','secondary') + button('numeric','ui.result') : button('fail','ui.fail','secondary') + button('success','ui.complete')}</div>${active && card.resolution !== 'numeric' ? button('reject','ui.cancel','text-button') : ''}</div></section>`;
  }

  function tileContent(tile) {
    if (!tile) return `<span class="empty-cell" aria-label="${text('ui.empty')}"></span>`;
    if (tile.kind === 'symbol') return `${symbol(tile.symbol)}${tile.units > 1 ? `<b class="tile-units">×${tile.units}</b>` : ''}`;
    return `<span class="effect-symbol" title="${text(config.grid.effects[tile.effect].name_key)}">${text(config.grid.effects[tile.effect].icon_key)}</span>`;
  }

  function gridScene(state, local) {
    const cells = local.gridBefore ?? state.grid.cells;
    return `<section class="scene grid-scene"><span class="eyebrow">${text('ui.collecting')}</span><h1>${text('ui.grid')}</h1><p>${text('ui.gridHint')}</p><div class="grid-layout"><div class="tile-grid" style="--columns:${config.grid.columns}">${cells.map((tile, i) => `<div class="tile ${!tile ? 'off' : ''}" data-cell="${i}">${tileContent(tile)}</div>`).join('')}</div><div class="collected-tray"><span class="eyebrow">${text('ui.machine')}</span><div id="collected">${state.extraction?.tokens.map(tile => `<div class="collected-token">${tileContent({kind:'symbol',...tile})}</div>`).join('') ?? ''}</div></div></div></section>`;
  }

  function machine(state, line, spinning = false) {
    const reels = state.reels.map((reel, i) => {
      const center = line?.[i] ?? config.slots.stone;
      const pos = Math.max(0, reel.indexOf(center));
      const top = reel[(pos + reel.length - 1) % reel.length];
      const bottom = reel[(pos + 1) % reel.length];
      return `<div class="reel ${spinning ? 'reel-spinning' : ''}" style="--reel-index:${i}"><div class="reel-track"><div>${symbol(top)}</div><div class="payline-symbol">${symbol(center)}</div><div>${symbol(bottom)}</div></div></div>`;
    }).join('');
    return `<div class="slot-machine"><div class="machine-marquee"><span>✦ ✦ ✦</span><b>${text('app.title')}</b><span>✦ ✦ ✦</span></div><div class="reel-frame"><div class="payline"></div>${reels}</div><div class="machine-base"><span>● ● ●</span><span>${text('ui.machine')}</span><span>● ● ●</span></div></div>`;
  }

  function slotsScene(state, local) {
    const isFinal = ['finale','final_ready','final_result','finished'].includes(state.phase);
    const finished = state.phase === 'finished';
    const preview = state.phase === 'preview';
    const line = isFinal ? state.lastSpin?.line : preview ? state.preview[local.previewMode === 'maximum' ? 'maximum' : 'representative'].line : state.insertion?.slice(-config.slots.reels).map(x => x.symbol);
    const prize = preview ? state.preview[local.previewMode === 'maximum' ? 'maximum' : 'representative'].payout : state.lastSpin?.payout ?? 0;
    const titleKey = finished ? 'ui.finished' : state.phase === 'finale' ? 'ui.finalTitle' : isFinal ? 'ui.finalSpinHint' : preview ? 'ui.preview' : 'ui.installing';
    return `<section class="scene slots-scene"><span class="eyebrow">${text(isFinal ? 'ui.total' : 'ui.machine')}${isFinal ? ` · ${money(state.total)}` : ''}</span><h1>${text(titleKey)}</h1>${isFinal && !finished ? `<div class="final-stats"><div><b class="spin-count">${number(state.spins)}</b><span>${text('ui.remaining')}</span></div><div><b>${money(state.preview.maximum.payout * state.spins)}</b><span>${text('ui.pot')}</span></div></div>` : ''}${machine(state,line,local.slotSpinning)}${preview || state.phase === 'final_result' || finished ? `<div class="prize-pop ${local.slotSpinning ? 'prize-hidden' : ''}"><small>${text(finished ? 'ui.total' : preview ? local.previewMode === 'maximum' ? 'ui.previewMax' : 'ui.previewMean' : 'ui.prize')}</small><strong>${money(finished ? state.total : prize)}</strong></div>` : ''}${preview ? `<p class="fine-print">${text('ui.previewNote')}</p>` : ''}${state.phase === 'final_ready' ? button('final-spin','ui.finalSpin','primary final-spin') : ''}${finished ? `<p>${text('ui.finishedHint')}</p>${button('restart','app.restart')}` : ''}</section>`;
  }

  function progressionScene(state) {
    return `<section class="scene fire-scene"><div class="fire-burst">${Array.from({ length: 12 }, (_, i) => `<span style="--i:${i}">🔥</span>`).join('')}</div><div class="big-fire">🔥</div><h1>${text('ui.fire')}</h1><p>${text('ui.fireHint')}</p><div class="progression-large">${Array.from({ length: config.progression.choiceAt }, (_, i) => `<span class="${i < state.progression ? 'lit' : ''}">🔥</span>`).join('')}</div></section>`;
  }

  function sidebar(state) {
    const filled = state.reels.flat().filter(s => s !== config.slots.stone).length;
    const total = config.slots.reels * config.slots.positions;
    return `<aside class="status-sidebar"><div class="sidebar-top"><span class="tiny-label">${text('ui.machine')}</span><span class="mini-icon">▥</span></div><div class="mini-reels">${state.reels.map(reel => `<div>${symbol([...reel].reverse().find(s => s !== config.slots.stone) ?? config.slots.stone)}</div>`).join('')}</div><div class="capacity-label"><strong>${filled}<span> / ${total}</span></strong></div><div class="capacity-bar"><i style="width:${filled / total * 100}%"></i></div><p class="muted">${text('ui.filled')}</p><div class="stat-divider"></div><span class="tiny-label">${text('ui.progression')}</span><div class="progression-dots">${Array.from({ length: config.progression.choiceAt }, (_, i) => `<span class="${i < state.progression ? 'active' : ''}">🔥</span>`).join('')}</div><div class="spin-bank"><span>${text('ui.spins')}</span><strong>${number(state.spins)}<span>↗</span></strong></div><details class="composition"><summary>${text('ui.inventory')}</summary>${Object.keys(config.slots.target).map(id => `<div>${symbol(id)}<span>${state.reels.map(reel => reel.filter(s => s === id).length).join(' · ')}</span></div>`).join('')}</details></aside>`;
  }

  return (state, local) => {
    let scene;
    const phase = local.presentation ?? state.phase;
    if (phase === 'wheel') scene = wheelScene(state, local);
    else if (phase === 'category') scene = categoryScene(state);
    else if (phase === 'cards') scene = cardsScene(state);
    else if (['offer','challenge'].includes(phase)) scene = challengeScene(state, local);
    else if (phase === 'reward') scene = `<section class="scene reward-scene"><span class="eyebrow">${text('ui.points')}</span><div class="points-pop">+${number(state.points)}</div><h1>${text('ui.reward')}</h1><div class="confetti"></div></section>`;
    else if (phase === 'grid') scene = gridScene(state, local);
    else if (phase === 'progression') scene = progressionScene(state);
    else if (phase === 'decision') scene = `<section class="scene decision-scene"><div class="big-fire">🔥</div><h1>${text('ui.decision')}</h1><p>${text('ui.decisionHint')}</p><div class="actions">${button('continue','ui.continue','secondary')}${button('advance','ui.advance')}</div></section>`;
    else scene = slotsScene(state, local);
    return `<div class="app-shell"><header class="app-header"><a class="wordmark" href="/" aria-label="${text('app.title')}"><span class="brand-icon">✦</span>${text('app.title')}<span class="brand-dot">.</span></a><span class="demo-badge">${text('app.demo')}</span><button class="rules-button" data-action="rules"><span>?</span>${text('app.rules')}</button></header><div class="topbar"><div class="round-label"><span class="live-dot"></span>${text(config.wheels[state.wheel].label_key)}</div><div class="turn-label">${text('ui.turn')}<b>${String(state.turn).padStart(2,'0')}</b></div></div><div class="play-layout"><main class="stage ${local.busy ? 'is-busy' : ''}" data-phase="${state.phase}">${scene}</main>${sidebar(state)}</div><footer><span>✦ ${text('app.title')}</span><p>${text('ui.demoNote')}</p><span class="footer-dots">● ● ●</span></footer></div>${local.rules ? `<div class="modal-scrim"><section class="rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title"><button class="modal-close" data-action="close-rules" aria-label="${text('app.close')}">×</button><span class="eyebrow">${text('app.title')}</span><h2 id="rules-title">${text('app.rules')}</h2><p>${text('ui.ruleText')}</p>${button('close-rules','ui.back')}</section></div>` : ''}`;
  };
}

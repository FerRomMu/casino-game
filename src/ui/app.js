import { seededRandom } from '../domain/random.js';
import { createGame, transition } from '../domain/game.js';
import { loadContent } from './content.js';
import { createRenderer, escapeHtml } from './render.js';

const app = document.querySelector('#app');

try {
  const { config, decks, t } = await loadContent();
  document.title = t('app.title');
  const rng = seededRandom(config.seed);
  const context = { config, decks, rng };
  let state = createGame(config, rng);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const local = {
    busy: false, rotation: 0, rules: false, numeric: 0, slotSpinning: false,
    previewMode: 'representative', presentation: null, gridBefore: null,
    motion: name => reducedMotion.matches ? config.ui.reducedMotionDuration : config.ui.timings[name]
  };
  const renderer = createRenderer(config,t);
  const render = () => { app.innerHTML = renderer(state, local); };
  const send = action => { state = transition(state,action,context); render(); };
  const wait = name => new Promise(resolve => setTimeout(resolve,local.motion(name)));

  async function spinWheel() {
    local.presentation = 'wheel';
    send({ type:'SPIN_WHEEL' });
    const center = (state.category.start + state.category.end) / 2 * 360;
    const next = Math.ceil(local.rotation / 360) * 360 + config.ui.wheelTurns * 360 + (360 - center);
    // Keep the existing SVG node alive during its CSS transition.
    const wheel = document.querySelector('#wheel');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    wheel.style.transform = `rotate(${next}deg)`;
    local.rotation = next;
    await wait('wheel');
    local.presentation = null;
    render();
    if (state.phase === 'category') {
      await wait('category');
      send({type:'SHOW_CARDS'});
      await wait('deal');
    } else if (state.phase === 'progression') {
      await wait('fire');
      send({type:'END_PROGRESSION'});
    } else if (state.phase === 'finale') {
      await wait('finalIntro');
      send({type:'START_FINAL'});
    }
  }

  async function animateGrid() {
    const before = structuredClone(state.grid.cells);
    local.gridBefore = before;
    send({type:'EXECUTE_GRID'});
    const tiles = [...document.querySelectorAll('[data-cell]')];
    const active = tiles.filter((_, i) => before[i]);
    const selected = state.extraction.draws;
    const totalDuration = local.motion('grid');
    const start = performance.now();
    const lights = Math.max(1, selected.length);
    // Animation only: no calls to the domain's RNG and no impact on outcomes.
    await new Promise(resolve => {
      function frame(now) {
        tiles.forEach(tile => tile.classList.remove('lit'));
        const elapsed = now - start;
        if (elapsed >= totalDuration || !active.length) {
          selected.forEach(draw => { tiles[draw.index].classList.add('chosen'); });
          resolve(); return;
        }
        for (let i=0;i<lights;i++) active[(Math.floor(elapsed / 65) + i * 7) % active.length].classList.add('lit');
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    await wait('flip');
    local.gridBefore = null;
    render();
    await wait('reward');
    send({type:'INSERT_TOKENS'});
    await wait('insertion');
    local.slotSpinning = true;
    send({type:'SHOW_PREVIEW'});
    await wait('previewSpin');
    local.slotSpinning = false;
    render();
    await wait('previewPrize');
    local.previewMode = 'maximum';
    local.slotSpinning = true;
    render();
    await wait('previewSpin');
    local.slotSpinning = false;
    render();
    await wait('previewPrize');
    local.previewMode = 'representative';
    send({type:'END_PREVIEW'});
  }

  async function resolveChallenge(action) {
    send(action);
    if (state.phase !== 'reward') return;
    await wait('reward');
    await animateGrid();
  }

  async function finalSpin() {
    local.slotSpinning = true;
    send({type:'SPIN_FINAL'});
    // Reel stop times are staggered by CSS, then the result is revealed.
    await wait('finalSpin');
    const reels = [...document.querySelectorAll('.reel')];
    for (const reel of reels) {
      reel.classList.remove('reel-spinning');
      reel.classList.add('reel-stopped');
      await wait('flip');
    }
    local.slotSpinning = false;
    render();
    await wait('finalPrize');
    send({type:'END_FINAL_RESULT'});
  }

  app.addEventListener('click', async event => {
    const control = event.target.closest('[data-action]');
    const action = control?.dataset.action;
    if (action === 'rules') { local.rules = true; render(); document.querySelector('.modal-close')?.focus(); return; }
    if (action === 'close-rules') { local.rules = false; render(); return; }
    if (local.busy || local.rules || control?.disabled) return;
    const shouldSpin = action === 'spin' || (!control && !event.target.closest('a,button,details,summary') && state.phase === 'wheel');
    if (!shouldSpin && !action) return;
    local.busy = true;
    try {
      if (shouldSpin) await spinWheel();
      else if (action === 'pick') { send({type:'PICK_CARD'}); await wait('flip'); }
      else if (action === 'accept') { local.numeric = 0; send({type:'ACCEPT'}); }
      else if (action === 'reject') { send({type:'REJECT'}); }
      else if (action === 'success' || action === 'fail') await resolveChallenge({type:'RESOLVE',success:action === 'success'});
      else if (action === 'numeric') await resolveChallenge({type:'RESOLVE',result:local.numeric});
      else if (action === 'more') { local.numeric = Math.min(state.card.maximum,local.numeric+1); render(); }
      else if (action === 'less') { local.numeric = Math.max(0,local.numeric-1); render(); }
      else if (action === 'continue' || action === 'advance') send({type:'CHOOSE_PROGRESSION',continue:action === 'continue'});
      else if (action === 'final-spin') await finalSpin();
      else if (action === 'restart') { state = createGame(config,rng); local.rotation = 0; render(); }
    } catch (error) {
      console.error(error);
      app.innerHTML = `<div class="load-error"><h1>${escapeHtml(t('app.error'))}</h1><pre>${escapeHtml(error.message)}</pre></div>`;
    } finally {
      local.busy = false;
      if (!document.querySelector('.load-error')) render();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && local.rules) { local.rules = false; render(); }
    if (local.rules && event.key === 'Tab') {
      const controls = [...document.querySelectorAll('.rules-modal button')];
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    }
  });
  render();
} catch (error) {
  // A failed strings request cannot resolve translations. Error codes remain visible.
  app.innerHTML = `<div class="load-error"><pre>${escapeHtml(error.message)}</pre></div>`;
  console.error(error);
}

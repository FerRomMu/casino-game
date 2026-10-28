import { selectCategory, indexOfRandom } from './random.js';
import { createGrid, executeGrid } from './grid.js';
import { createReels, insertTokens, analyzeSlots, spinSlots } from './slots.js';

// Completion closes only the advanced wheel, and requires earned spins: the
// minimum final-spin guarantee must not count as progression already collected.
export function shouldFinishOnCompletion(state, config) {
  return config.final.autoFinishWhenComplete === true &&
    state.wheel === config.progression.nextWheel &&
    state.spins >= config.final.maxSpins &&
    state.reels.length === config.slots.reels &&
    state.reels.every(reel => reel.length === config.slots.positions && !reel.includes(config.slots.stone));
}

export function createGame(config, rng, participantId = 'participant_1') {
  return {
    participantId, phase: 'wheel', wheel: config.progression.initialWheel,
    progression: 0, appearances: 0, continued: false, points: 0, spins: 0,
    total: 0, turn: 0, usedCards: [], grid: createGrid(config.grid, rng),
    reels: createReels(config.slots), category: null, card: null, extraction: null,
    preview: null, previewOutcome: null, newMaximum: false, maximumSeen: 0, lastSpin: null, history: []
  };
}

// Pure state machine. Animations, timers, JSON loading and DOM live elsewhere.
export function transition(state, action, context) {
  const { config, decks, rng } = context;
  const s = structuredClone(state);
  const requirePhase = (...phases) => {
    if (!phases.includes(s.phase)) throw new Error(`INVALID_ACTION:${s.phase}:${action.type}`);
  };
  const enterFinal = () => {
    s.spins = Math.max(config.final.minSpins, Math.min(config.final.maxSpins, s.spins));
    s.preview = analyzeSlots(s.reels, config.slots);
    s.phase = 'finale';
  };
  const returnToWheel = () => {
    s.phase = 'wheel'; s.card = null; s.extraction = null;
    if (shouldFinishOnCompletion(s, config)) enterFinal();
  };
  switch (action.type) {
    case 'SPIN_WHEEL': {
      requirePhase('wheel');
      if (shouldFinishOnCompletion(s, config)) { s.category = null; enterFinal(); break; }
      s.category = selectCategory(config.wheels[s.wheel].categories, rng);
      s.turn++;
      if (s.category.behavior === 'progression') {
        s.appearances++;
        s.progression = Math.min(config.progression.choiceAt, s.appearances);
        s.phase = 'progression';
      } else if (s.category.behavior === 'finale') {
        enterFinal();
      } else s.phase = 'category';
      break;
    }
    case 'SHOW_CARDS': requirePhase('category'); s.phase = 'cards'; break;
    case 'PICK_CARD': {
      requirePhase('cards');
      const categoryCards = decks[s.wheel].filter(c => c.category === s.category.id);
      let available = categoryCards.filter(c => !s.usedCards.includes(c.id));
      if (!available.length) {
        s.usedCards = s.usedCards.filter(id => !categoryCards.some(c => c.id === id));
        available = categoryCards;
      }
      s.card = available[indexOfRandom(available.length, rng)];
      s.usedCards.push(s.card.id);
      s.phase = 'offer';
      break;
    }
    case 'ACCEPT': requirePhase('offer'); s.phase = 'challenge'; break;
    case 'REJECT': requirePhase('offer', 'challenge'); returnToWheel(); break;
    case 'RESOLVE': {
      requirePhase('challenge');
      if (s.card.resolution === 'numeric') {
        if (!Number.isInteger(action.result) || action.result < 0 || action.result > s.card.maximum) throw new Error('INVALID_NUMERIC_RESULT');
        s.points = s.card.reward.byResult[action.result];
      } else {
        if (typeof action.success !== 'boolean') throw new Error('INVALID_BINARY_RESULT');
        s.points = action.success ? s.card.reward.success : s.card.reward.failure;
      }
      s.phase = s.points > 0 ? 'reward' : 'wheel';
      break;
    }
    case 'EXECUTE_GRID':
      requirePhase('reward');
      s.extraction = executeGrid(s.grid, s.points, config.grid, rng);
      s.grid = s.extraction.grid;
      s.spins = Math.min(config.final.maxSpins, s.spins + s.extraction.spins);
      s.points = 0;
      s.phase = 'grid';
      break;
    case 'INSERT_TOKENS': {
      requirePhase('grid');
      const insertion = insertTokens(s.reels, s.extraction.tokens, config.slots, rng);
      s.reels = insertion.reels;
      s.insertion = insertion.inserted;
      s.phase = 'machine';
      break;
    }
    case 'SHOW_PREVIEW':
      requirePhase('machine');
      if (shouldFinishOnCompletion(s, config)) { enterFinal(); break; }
      s.preview = analyzeSlots(s.reels, config.slots);
      s.newMaximum = s.preview.maximum.payout > s.maximumSeen;
      s.maximumSeen = Math.max(s.maximumSeen, s.preview.maximum.payout);
      s.previewOutcome = s.newMaximum ? s.preview.maximum : spinSlots(s.reels, config.slots, rng);
      s.phase = 'preview';
      break;
    case 'END_PREVIEW': requirePhase('preview'); returnToWheel(); break;
    case 'END_PROGRESSION':
      requirePhase('progression');
      if (s.appearances >= config.progression.forceAt) {
        s.wheel = config.progression.nextWheel;
        returnToWheel();
      } else if (s.appearances === config.progression.choiceAt) s.phase = 'decision';
      else returnToWheel();
      break;
    case 'CHOOSE_PROGRESSION':
      requirePhase('decision');
      if (typeof action.continue !== 'boolean') throw new Error('INVALID_PROGRESSION_CHOICE');
      s.continued = action.continue;
      if (!s.continued) s.wheel = config.progression.nextWheel;
      returnToWheel();
      break;
    case 'START_FINAL': requirePhase('finale'); s.phase = 'final_ready'; break;
    case 'SPIN_FINAL':
      requirePhase('final_ready');
      if (s.spins <= 0) throw new Error('NO_SPINS');
      s.lastSpin = spinSlots(s.reels, config.slots, rng);
      s.total += s.lastSpin.payout;
      s.spins--;
      s.history.push(s.lastSpin);
      s.phase = 'final_result';
      break;
    case 'END_FINAL_RESULT':
      requirePhase('final_result');
      s.phase = s.spins > 0 ? 'final_ready' : 'finished';
      break;
    default: throw new Error(`UNKNOWN_ACTION:${action.type}`);
  }
  return s;
}

// Maximum attainable final total includes the prize already banked.
export function finalBank(state) {
  return {
    accumulated: state.total,
    maximum: state.total + (state.preview?.maximum.payout ?? 0) * state.spins,
  };
}

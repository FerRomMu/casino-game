import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { seededRandom, indexOfRandom } from '../src/domain/random.js';
import { validateConfig } from '../src/domain/config.js';
import { createGame, transition } from '../src/domain/game.js';
import { analyzeSlots, spinSlots } from '../src/domain/slots.js';

const arg = (name,fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i+1];
};
const directory = arg('content','content');
const load = async name => JSON.parse(await readFile(`${directory}/${name}.json`,'utf8'));
const config = await load('game.config');
const decks = {wheel_1:await load('cards_wheel_1'),wheel_2:await load('cards_wheel_2')};
validateConfig(config,decks);
const count = Number(arg('games',config.simulation.games));
const samples = Number(arg('spins',100000));
const seed = Number(arg('seed',config.seed));
if (!Number.isInteger(count) || count < 1 || !Number.isInteger(samples) || samples < 1 || !Number.isInteger(seed)) throw new Error('INVALID_SIMULATION_ARGUMENTS');
const rng = seededRandom(seed);
const context = {config,decks,rng};
const totals = [], spinCounts = [], fillings = [];
let timeouts = 0, ordinaryHits = 0, exceptionalHits = 0, totalSpins = 0;

for (let game=0;game<count;game++) {
  let state = createGame(config,rng,`participant_${game}`);
  const send = action => {state=transition(state,action,context);};
  while (state.phase !== 'finished' && state.turn < config.simulation.maxTurns) {
    switch (state.phase) {
      case 'wheel':send({type:'SPIN_WHEEL'});break;
      case 'category':send({type:'SHOW_CARDS'});break;
      case 'cards':send({type:'PICK_CARD'});break;
      case 'offer':send({type:rng() < config.simulation.acceptProbability ? 'ACCEPT':'REJECT'});break;
      case 'challenge':
        if (state.card.resolution === 'numeric') send({type:'RESOLVE',result:indexOfRandom(state.card.maximum+1,rng)});
        else send({type:'RESOLVE',success:rng() < config.simulation.successProbability});
        break;
      case 'reward':send({type:'EXECUTE_GRID'});break;
      case 'grid':send({type:'INSERT_TOKENS'});break;
      case 'machine':send({type:'SHOW_PREVIEW'});break;
      case 'preview':send({type:'END_PREVIEW'});break;
      case 'progression':send({type:'END_PROGRESSION'});break;
      case 'decision':send({type:'CHOOSE_PROGRESSION',continue:config.simulation.continueAtChoice});break;
      case 'finale':send({type:'START_FINAL'});break;
      case 'final_ready':send({type:'SPIN_FINAL'});break;
      case 'final_result':send({type:'END_FINAL_RESULT'});break;
      default:throw new Error(`UNHANDLED_PHASE:${state.phase}`);
    }
  }
  if (state.phase !== 'finished') {timeouts++;continue;}
  totals.push(state.total);
  spinCounts.push(state.history.length);
  fillings.push(state.reels.flat().filter(s=>s!==config.slots.stone).length);
  for (const spin of state.history) {
    totalSpins++;
    if (spin.line.every(s=>s===config.slots.payout.exceptional.symbol)) exceptionalHits++;
    else if (spin.payout >= config.slots.payout.ordinary) ordinaryHits++;
  }
}
const fullReels = Array.from({length:config.slots.reels},()=>Object.entries(config.slots.target).flatMap(([symbol,n])=>Array(n).fill(symbol)));
const exact = analyzeSlots(fullReels,config.slots);
const finalSamples = [];
for (let i=0;i<samples;i++) {
  let sum=0;
  const spins = config.final.minSpins + indexOfRandom(config.final.maxSpins-config.final.minSpins+1,rng);
  for (let j=0;j<spins;j++) sum += spinSlots(fullReels,config.slots,rng).payout;
  finalSamples.push(sum);
}
function stats(values) {
  const sorted = [...values].sort((a,b)=>a-b);
  const q = p => sorted.length ? sorted[Math.floor((sorted.length-1)*p)] : null;
  return {samples:values.length,q1:q(.25),median:q(.5),q3:q(.75),mean:values.length ? values.reduce((a,b)=>a+b,0)/values.length : null,minimum:q(0),maximum:q(1)};
}
const actual = stats(totals), complete = stats(finalSamples);
const report = {
  contentMode:config.contentMode,seed,
  actualGames:{...actual,timeouts,finalSpins:stats(spinCounts),filledPositions:stats(fillings),ordinaryHits,exceptionalHits,totalSpins},
  completeMachine:{perSpin:{expected:exact.expected,maximum:exact.maximum.payout,ordinaryProbability:exact.ordinaryProbability,exceptionalProbability:exact.exceptionalProbability,distribution:exact.distribution},finalTotals:complete},
  targets:config.simulation.targets,
  targetComparison:{actualGames:{q1Ratio:actual.q1/config.simulation.targets.q1,medianRatio:actual.median/config.simulation.targets.median},completeMachine:{q1Ratio:complete.q1/config.simulation.targets.q1,medianRatio:complete.median/config.simulation.targets.median}},
  assumptions:{finalSpins:'uniform_integer_in_configured_range_for_complete_machine_only',actualGames:'same_state_machine_as_ui',jackpotProbabilities:'per_spin_exact_for_complete_machine',payoutRules:'config.slots.payout',calibrated:false}
};
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/simulation.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));

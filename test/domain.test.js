import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { seededRandom, selectCategory, wheelSectors } from '../src/domain/random.js';
import { validateConfig } from '../src/domain/config.js';
import { createGame, transition, shouldFinishOnCompletion } from '../src/domain/game.js';
import { createGrid, executeGrid } from '../src/domain/grid.js';
import { createReels, insertTokens, evaluateLine, analyzeSlots } from '../src/domain/slots.js';
import { translator } from '../src/ui/content.js';

const load = async name => JSON.parse(await readFile(new URL(`../content/${name}.json`,import.meta.url),'utf8'));
const config = await load('game.config');
const decks = {wheel_1:await load('cards_wheel_1'),wheel_2:await load('cards_wheel_2')};
const setup = (seed=1) => {
  const rng = seededRandom(seed);
  return {state:createGame(config,rng),context:{config,decks,rng}};
};
const forced = id => {
  const clone = structuredClone(config);
  clone.progression.adaptive.enabled = false;
  for (const wheel of Object.values(clone.wheels)) for (const cat of wheel.categories) cat.weight = cat.id === id ? 1 : 0;
  return clone;
};

test('configuration validates inventory, reel sizes and deck structures',()=>{
  assert.equal(validateConfig(config,decks),config);
  const invalid = structuredClone(config);
  invalid.grid.reserves[0].units++;
  assert.throws(()=>validateConfig(invalid,decks),/INVENTORY/);
});

test('weighted geometry and category selection use identical boundaries including zero weights',()=>{
  const cats=[{id:'a',weight:33},{id:'b',weight:67},{id:'c',weight:0}];
  const sectors=wheelSectors(cats);
  assert.equal(sectors[0].probability,.33);
  assert.equal(sectors[0].end,sectors[1].start);
  assert.equal(selectCategory(cats,()=>.329999).id,'a');
  assert.equal(selectCategory(cats,()=>.33).id,'b');
  assert.equal(selectCategory(cats,()=>.999999).id,'b');
  const rng=seededRandom(9);
  let first=0;
  for(let i=0;i<100000;i++) if(selectCategory(cats,rng).id==='a')first++;
  assert.ok(Math.abs(first/100000-.33)<.005);
  assert.throws(()=>wheelSectors([{weight:0}]),/WEIGHTS/);
  assert.throws(()=>wheelSectors([{weight:-1}]),/WEIGHTS/);
});

test('seeded game transitions are reproducible and do not mutate input',()=>{
  const a=setup(42),b=setup(42);
  const original=structuredClone(a.state);
  const one=transition(a.state,{type:'SPIN_WHEEL'},a.context);
  const two=transition(b.state,{type:'SPIN_WHEEL'},b.context);
  assert.deepEqual(one,two);
  assert.deepEqual(a.state,original);
  assert.throws(()=>transition(one,{type:'SPIN_WHEEL'},a.context),/INVALID_ACTION/);
});

test('third progression offers a choice, fourth forces transition, independent participants',()=>{
  const {context,state:initial}=setup();
  context.config=forced('cat_7_progression');
  let state=initial;
  for(let i=1;i<=3;i++) {
    state=transition(state,{type:'SPIN_WHEEL'},context);
    assert.equal(state.phase,'progression');
    assert.throws(()=>transition(state,{type:'SPIN_WHEEL'},context),/INVALID_ACTION/);
    state=transition(state,{type:'END_PROGRESSION'},context);
    assert.equal(state.progression,i);
  }
  assert.equal(state.phase,'decision');
  const passed=transition(state,{type:'CHOOSE_PROGRESSION',continue:false},context);
  assert.equal(passed.wheel,'wheel_2');
  state=transition(state,{type:'CHOOSE_PROGRESSION',continue:true},context);
  assert.equal(state.wheel,'wheel_1');
  state=transition(state,{type:'SPIN_WHEEL'},context);
  state=transition(state,{type:'END_PROGRESSION'},context);
  assert.equal(state.wheel,'wheel_2');
  assert.equal(state.progression,3);
  assert.equal(initial.progression,0);
});

test('rejecting a card at offer or during challenge preserves inventory, points and spins',()=>{
  const {state:initial,context}=setup();
  context.config=forced('cat_1');
  let state=transition(initial,{type:'SPIN_WHEEL'},context);
  state=transition(state,{type:'SHOW_CARDS'},context);
  state=transition(state,{type:'PICK_CARD'},context);
  for(const offered of [state,transition(state,{type:'ACCEPT'},context)]){
    const rejected=transition(offered,{type:'REJECT'},context);
    assert.equal(rejected.phase,'wheel');
    for(const key of ['grid','reels','spins','points','total','progression'])assert.deepEqual(rejected[key],initial[key]);
  }
});

test('numeric results use configured lookup and reject invalid quantities',()=>{
  const {state,context}=setup();
  const card=decks.wheel_1.find(c=>c.resolution==='numeric');
  state.phase='challenge';state.card=card;
  const resolved=transition(state,{type:'RESOLVE',result:2},context);
  assert.equal(resolved.points,card.reward.byResult[2]);
  assert.throws(()=>transition(state,{type:'RESOLVE',result:card.maximum+1},context),/NUMERIC/);
});

test('grid preserves inventory and fills all 80 positions without quota overflow across seeds',()=>{
  for(let seed=1;seed<=30;seed++) {
    const rng=seededRandom(seed);
    let grid=createGrid(config.grid,rng);
    let reels=createReels(config.slots);
    let count=0;
    while(grid.cells.some(Boolean)){
      const before=structuredClone(grid);
      const extraction=executeGrid(grid,1,config.grid,rng);
      assert.deepEqual(grid,before);
      assert.equal(extraction.grid.cells.length,49);
      assert.ok(before.cells[extraction.draws[0].index]);
      reels=insertTokens(reels,extraction.tokens,config.slots,rng).reels;
      grid=extraction.grid;
      count++;
      assert.ok(count<200);
    }
    assert.equal(grid.reserves.length,0);
    assert.equal(grid.pool.length,0);
    assert.equal(reels.flat().filter(s=>s===config.slots.stone).length,0);
    for(const reel of reels) for(const [symbol,n] of Object.entries(config.slots.target)) assert.equal(reel.filter(s=>s===symbol).length,n);
    const empty=executeGrid(grid,5,config.grid,rng);
    assert.equal(empty.draws.length,0);
  }
});

test('wild substitutes, multiplier applies once, and exceptional jackpot requires four literal symbols',()=>{
  const cfg=config.slots;
  assert.equal(evaluateLine(['lemon','wild','stone','stone'],cfg),cfg.payout.table.lemon[2]);
  assert.equal(evaluateLine(['lemon','x2','x2','stone'],cfg),cfg.payout.table.lemon[1]*cfg.payout.multiplier);
  assert.equal(evaluateLine(['seven','seven','seven','seven'],cfg),cfg.payout.exceptional.value);
  assert.equal(evaluateLine(['seven','seven','seven','wild'],cfg),cfg.payout.table.seven[4]);
});

test('exact analysis finds attainable rounded-up preview and correct exceptional probability',()=>{
  const reels=createReels(config.slots);
  reels[0][0]='lemon';
  const before=structuredClone(reels);
  const preview=analyzeSlots(reels,config.slots);
  assert.equal(preview.expected,Math.ceil(config.slots.payout.table.lemon[1]/config.slots.positions));
  assert.equal(preview.representative.line[0],'lemon');
  assert.equal(preview.maximum.payout,config.slots.payout.table.lemon[1]);
  assert.deepEqual(reels,before);
  const full=Array.from({length:config.slots.reels},()=>Object.entries(config.slots.target).flatMap(([symbol,n])=>Array(n).fill(symbol)));
  const analyzed=analyzeSlots(full,config.slots);
  assert.ok(Math.abs(analyzed.exceptionalProbability-1/20**4)<1e-12);
  assert.equal(analyzed.maximum.payout,5000000);
  assert.ok(Math.abs(analyzed.distribution.reduce((s,o)=>s+o.probability,0)-1)<1e-12);
});

test('first finale appearance starts final directly and exhausts configured spins',()=>{
  const {state:initial,context}=setup();
  context.config=forced('w2_cat_4_finale');
  initial.wheel='wheel_2';
  let state=transition(initial,{type:'SPIN_WHEEL'},context);
  assert.equal(state.phase,'finale');
  assert.equal(state.card,null);
  assert.equal(state.spins,config.final.minSpins);
  state=transition(state,{type:'START_FINAL'},context);
  for(let i=0;i<config.final.minSpins;i++){
    state=transition(state,{type:'SPIN_FINAL'},context);
    state=transition(state,{type:'END_FINAL_RESULT'},context);
  }
  assert.equal(state.phase,'finished');
  assert.equal(state.spins,0);
  assert.equal(state.history.length,config.final.minSpins);
  assert.throws(()=>transition(state,{type:'SPIN_FINAL'},context),/INVALID_ACTION/);
});

test('missing content is visible in development and empty in production',()=>{
  assert.equal(translator({'ns.key':'TEST_STRING'})('ns.key'),'TEST_STRING');
  assert.equal(translator({})('ns.missing'),'MISSING:ns.missing');
  assert.equal(translator({},{production:true})('ns.missing'),'');
});

test('five reserved effects collect orthogonal neighbors, with bounds and no diagonals', () => {
  assert.equal(config.grid.initial.filter(t => t.effect === 'bonus').reduce((n,t) => n+t.count,0),5);
  const symbol = {kind:'symbol',symbol:'lemon',units:1};
  for (const [index, expected] of [[24,[17,31,23,25]], [0,[7,1]], [6,[13,5]], [48,[41,47]], [21,[14,28,22]]]) {
    const cells = Array.from({length:49},()=>({...symbol}));
    cells[index] = {kind:'effect',effect:'bonus'};
    const grid = {cells,pool:[],reserves:[]};
    const before = structuredClone(grid);
    const result = executeGrid(grid,1,config.grid,()=> (index+.01)/49);
    assert.deepEqual(result.draws[0].collections.map(c=>c.index),[index,...expected]);
    assert.equal(result.tokens.length,expected.length);
    assert.equal(result.spins,0);
    assert.deepEqual(grid,before);
  }
});

test('blast chains collect each cell once, ignore dark cells and refill only after collection', () => {
  const cells = Array(49).fill(null);
  cells[24]={kind:'effect',effect:'bonus'};
  cells[25]={kind:'effect',effect:'bonus'};
  cells[17]={kind:'symbol',symbol:'lemon',units:2};
  cells[18]={kind:'symbol',symbol:'orange',units:1};
  cells[31]={kind:'effect',effect:'spin'};
  const result=executeGrid({cells,pool:[{kind:'symbol',symbol:'cherry',units:1}],reserves:[]},2,config.grid,()=>.4);
  assert.deepEqual(result.draws[0].explosions,[24,25]);
  const collected=result.draws[0].collections.map(c=>c.index);
  assert.equal(new Set(collected).size,5);
  assert.equal(result.draws.length,2); // The blast never consumes the second point.
  assert.equal(result.spins,1);
  assert.deepEqual(result.tokens.map(t=>[t.symbol,t.units]),[['lemon',2],['orange',1],['cherry',1]]);
  assert.ok(result.grid.cells.every(t=>!t));
});

test('every insertion replaces an actual stone and preserves all previously installed symbols', () => {
  for(let seed=1;seed<=20;seed++) {
    const rng=seededRandom(seed);
    let reels=createReels(config.slots), grid=createGrid(config.grid,rng);
    while(grid.cells.some(Boolean)) {
      const extraction=executeGrid(grid,3,config.grid,rng);
      const inserted=insertTokens(reels,extraction.tokens,config.slots,rng);
      const playback=structuredClone(reels);
      for(const event of inserted.inserted) {
        assert.equal(playback[event.reel][event.position],config.slots.stone);
        playback[event.reel][event.position]=event.symbol;
      }
      assert.deepEqual(playback,inserted.reels);
      for(let r=0;r<reels.length;r++) for(let p=0;p<reels[r].length;p++)
        if(reels[r][p]!==config.slots.stone) assert.equal(inserted.reels[r][p],reels[r][p]);
      reels=inserted.reels; grid=extraction.grid;
    }
  }
});

test('installation celebrates only a new maximum without simulating a spin', () => {
  const {state,context}=setup();
  state.phase='machine'; state.reels[0][0]='lemon'; state.spins=4;
  let preview=transition(state,{type:'SHOW_PREVIEW'},context);
  assert.equal(preview.newMaximum,true);
  assert.equal(preview.preview.maximum.payout,config.slots.payout.table.lemon[1]);
  assert.equal(preview.maximumSeen,preview.preview.maximum.payout);
  preview.phase='machine';
  const unchanged=transition(preview,{type:'SHOW_PREVIEW'},{...context,rng:()=>{throw Error('UNEXPECTED_RANDOM');}});
  assert.equal(unchanged.phase,'wheel');
  assert.equal(unchanged.newMaximum,false);
  assert.equal(unchanged.spins,4); assert.equal(unchanged.total,0); assert.equal(unchanged.history.length,0);
  unchanged.phase='machine'; unchanged.reels[1][0]='lemon';
  const higher=transition(unchanged,{type:'SHOW_PREVIEW'},{...context,rng:()=>{throw Error('UNEXPECTED_RANDOM');}});
  assert.equal(higher.newMaximum,true);
  assert.equal(higher.preview.maximum.payout,config.slots.payout.table.lemon[2]);
});

test('advanced demo wheel reserves ten percent for the finale', () => {
  const sectors=wheelSectors(config.wheels.wheel_2.categories);
  for(const s of sectors) assert.ok(Math.abs(s.probability-(s.behavior==='finale'?.1:.3))<1e-12);
});

test('payout explanations identify the paying combination, wilds and one applied multiplier', async () => {
  const {explainLine}=await import('../src/domain/slots.js');
  for(const [line, winning, multipliers, payout] of [
    [['lemon','wild','bell','x2'],[1,2],[3],40000],
    [['lemon','x2','x2','stone'],[0],[1],2000],
    [['seven','seven','seven','seven'],[0,1,2,3],[],5000000],
    [['seven','seven','seven','wild'],[0,1,2,3],[],1000000],
    [['stone','wild','x2','stone'],[],[],0],
    [['stone','stone','stone','stone'],[],[],0],
  ]) {
    const before=[...line], detail=explainLine(line,config.slots);
    assert.equal(detail.payout,payout);
    assert.equal(detail.payout,evaluateLine(line,config.slots));
    assert.deepEqual(detail.winningIndices,winning);
    assert.deepEqual(detail.multiplierIndices,multipliers);
    assert.deepEqual(line,before);
  }
  const tied=structuredClone(config.slots);
  tied.payout.table.orange[1]=tied.payout.table.lemon[1];
  assert.deepEqual(explainLine(['lemon','orange','stone','stone'],tied).winningIndices,[0]);
});

test('maximum final bank includes accumulated winnings and converges to the actual final total', async () => {
  const {finalBank}=await import('../src/domain/game.js');
  const {state,context}=setup();
  state.phase='final_ready'; state.spins=4; state.total=15000;
  state.reels=Array.from({length:4},()=>Array(20).fill('lemon'));
  state.preview=analyzeSlots(state.reels,config.slots);
  assert.deepEqual(finalBank(state),{accumulated:15000,maximum:415000});
  let next=state;
  for(let i=0;i<4;i++) {
    next=transition(next,{type:'SPIN_FINAL'},context);
    assert.equal(finalBank(next).accumulated,15000+(i+1)*100000);
    assert.equal(finalBank(next).maximum,415000);
    next=transition(next,{type:'END_FINAL_RESULT'},context);
  }
  assert.equal(next.phase,'finished');
  assert.equal(finalBank(next).maximum,finalBank(next).accumulated);
});

test('attainable pay table uses reel positions, wilds and multipliers without inventing combinations', async () => {
  const {attainablePrizes}=await import('../src/domain/slots.js');
  const reels=createReels(config.slots);
  const cell=(table,symbol,count)=>table.rows.find(row=>row.symbol===symbol).counts[count-1];
  let table=attainablePrizes(reels,config.slots);
  assert.equal(table.maximum,0); assert.equal(table.jackpot.available,false);
  assert.ok(table.rows.every(row=>row.counts.every(c=>c.normal===null&&c.multiplied===null)));
  reels[0].fill('lemon',0,5);
  table=attainablePrizes(reels,config.slots);
  assert.equal(cell(table,'lemon',1).normal,1000);
  assert.equal(cell(table,'lemon',2).normal,null); // Five copies on one reel cannot match twice.
  reels[1][0]='wild'; reels[1][1]='x2';
  table=attainablePrizes(reels,config.slots);
  assert.equal(cell(table,'lemon',2).normal,5000);
  assert.equal(cell(table,'lemon',1).multiplied,2000);
  assert.equal(cell(table,'lemon',2).multiplied,null); // Wild and x2 share one reel.
  reels[2][0]='x2';
  const before=structuredClone(reels);
  table=attainablePrizes(reels,config.slots);
  assert.equal(cell(table,'lemon',2).multiplied,10000);
  assert.equal(table.maximum,10000);
  assert.deepEqual(reels,before);
  const custom=structuredClone(config.slots);custom.payout.table.lemon[2]=12345;
  assert.equal(cell(attainablePrizes(reels,custom),'lemon',2).multiplied,24690);
});

test('pay table excludes losing combinations and separates the literal jackpot from wild substitutions', async () => {
  const {attainablePrizes}=await import('../src/domain/slots.js');
  const dominated=Array.from({length:4},()=>Array(20).fill('bell'));dominated[0][0]='lemon';
  assert.ok(attainablePrizes(dominated,config.slots).rows.find(r=>r.symbol==='lemon').counts.every(c=>c.normal===null));
  const reels=Array.from({length:4},()=>Array(20).fill('seven'));
  let table=attainablePrizes(reels,config.slots);
  assert.equal(table.jackpot.available,true);
  assert.equal(table.rows.find(r=>r.symbol==='seven').counts[3].normal,null);
  reels[3][0]='wild';table=attainablePrizes(reels,config.slots);
  assert.equal(table.rows.find(r=>r.symbol==='seven').counts[3].normal,1000000);
  assert.equal(table.jackpot.available,true);
  reels[3].fill('wild');table=attainablePrizes(reels,config.slots);
  assert.equal(table.jackpot.available,false);assert.equal(table.maximum,1000000);
});

test('every displayed prize is reachable and every payable amount is represented', async () => {
  const {attainablePrizes}=await import('../src/domain/slots.js');
  const full=Array.from({length:4},()=>Object.entries(config.slots.target).flatMap(([id,n])=>Array(n).fill(id)));
  for(const installed of [0,5,12,20]) {
    const reels=full.map((reel,r)=>reel.map((id,i)=>(i+r)%20<installed?id:config.slots.stone));
    const table=attainablePrizes(reels,config.slots),analysis=analyzeSlots(reels,config.slots);
    const displayed=table.rows.flatMap(r=>r.counts.flatMap(c=>[c.normal,c.multiplied])).filter(v=>v!=null);
    if(table.jackpot.available)displayed.push(table.jackpot.payout);
    assert.deepEqual([...new Set(displayed)].sort((a,b)=>a-b),analysis.distribution.filter(o=>o.payout>0).map(o=>o.payout));
    assert.equal(table.maximum,analysis.maximum.payout);
  }
});

test('automatic finale requires both complete reels and earned maximum spins in the advanced wheel', () => {
  const {state} = setup();
  state.reels = Array.from({length:config.slots.reels}, () => Object.entries(config.slots.target).flatMap(([symbol, n]) => Array(n).fill(symbol)));
  state.spins = config.final.maxSpins;
  assert.equal(shouldFinishOnCompletion(state, config), false);
  state.wheel = config.progression.nextWheel;
  assert.equal(shouldFinishOnCompletion(state, config), true);
  state.spins--;
  assert.equal(shouldFinishOnCompletion(state, config), false);
  state.spins++;
  const symbol = state.reels[0][0];
  state.reels[0][0] = config.slots.stone;
  assert.equal(shouldFinishOnCompletion(state, config), false);
  state.reels[0][0] = symbol;
  const disabled = {...config, final:{...config.final, autoFinishWhenComplete:false}};
  assert.equal(shouldFinishOnCompletion(state, disabled), false);
  const alternate = {...config, final:{...config.final, minSpins:2, maxSpins:4}};
  state.spins = 4;
  assert.equal(shouldFinishOnCompletion(state, alternate), true);
  state.spins = 3;
  assert.equal(shouldFinishOnCompletion(state, alternate), false);
});

test('last symbol or last earned spin closes after installation without an extra wheel or preview spin', () => {
  for (const last of ['symbol', 'spin']) {
    const {state, context} = setup(42);
    state.reels = Array.from({length:config.slots.reels}, () => Object.entries(config.slots.target).flatMap(([symbol, n]) => Array(n).fill(symbol)));
    state.wheel = config.progression.nextWheel;
    state.spins = config.final.maxSpins;
    let tile;
    if (last === 'symbol') {
      tile = {kind:'symbol', symbol:state.reels[0][0], units:1};
      state.reels[0][0] = config.slots.stone;
    } else {
      state.spins--;
      const effect = Object.keys(config.grid.effects).find(id => config.grid.effects[id].spins === 1);
      tile = {kind:'effect', effect};
    }
    state.grid = {cells:[tile, ...Array(config.grid.rows * config.grid.columns - 1).fill(null)], pool:[], reserves:[]};
    state.points = 1; state.phase = 'reward'; state.turn = 7;
    const before = structuredClone(state);
    let s = transition(state, {type:'EXECUTE_GRID'}, context);
    s = transition(s, {type:'INSERT_TOKENS'}, context);
    assert.equal(s.phase, 'machine');
    s = transition(s, {type:'SHOW_PREVIEW'}, {...context, rng:() => {throw Error('UNEXPECTED_RNG');}});
    assert.equal(s.phase, 'finale');
    assert.equal(s.spins, config.final.maxSpins);
    assert.equal(s.turn, 7);
    assert.equal(s.total, 0);
    assert.equal(s.history.length, 0);
    assert.equal(s.preview.maximum.payout, config.slots.payout.exceptional.value);
    assert.deepEqual(state, before);
    s = transition(s, {type:'START_FINAL'}, context);
    for (let i = 0; i < config.final.maxSpins; i++) {
      s = transition(s, {type:'SPIN_FINAL'}, context);
      s = transition(s, {type:'END_FINAL_RESULT'}, context);
    }
    assert.equal(s.phase, 'finished');
    assert.equal(s.history.length, config.final.maxSpins);
  }
});

test('entering advanced wheel already complete starts final immediately via either progression path', () => {
  const {state, context} = setup();
  context.config = structuredClone(config);
  context.config.progression.adaptive.enabled = false;
  state.reels = Array.from({length:config.slots.reels}, () => Object.entries(config.slots.target).flatMap(([symbol, n]) => Array(n).fill(symbol)));
  state.spins = config.final.maxSpins;
  state.phase = 'decision'; state.appearances = config.progression.choiceAt;
  assert.equal(transition(state, {type:'CHOOSE_PROGRESSION', continue:true}, context).phase, 'wheel');
  const advanced = transition(state, {type:'CHOOSE_PROGRESSION', continue:false}, context);
  assert.equal(advanced.wheel, config.progression.nextWheel);
  assert.equal(advanced.phase, 'finale');
  state.phase = 'progression'; state.appearances = config.progression.forceAt;
  assert.equal(transition(state, {type:'END_PROGRESSION'}, context).phase, 'finale');
  state.wheel = config.progression.nextWheel; state.phase = 'wheel';
  const guarded = transition(state, {type:'SPIN_WHEEL'}, {...context, rng:() => {throw Error('UNEXPECTED_RNG');}});
  assert.equal(guarded.phase, 'finale');
  assert.equal(guarded.turn, state.turn);
  assert.equal(guarded.category, null);
});

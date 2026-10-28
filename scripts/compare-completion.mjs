import {readFile, writeFile} from 'node:fs/promises';
import {runGame} from '../research/progression/engine.mjs';

const load = async path => JSON.parse(await readFile(path, 'utf8'));
const config = await load('content/game.config.json');
const decks = {wheel_1:await load('content/cards_wheel_1.json'), wheel_2:await load('content/cards_wheel_2.json')};
const experiment = await load('research/progression/models.json');
const profileIndex = experiment.profiles.findIndex(p => p.id === 'high');
const profile = experiment.profiles[profileIndex];
const n = experiment.gamesPerScenario;
const stats = values => {
  values.sort((a,b) => a-b);
  const q = p => values[Math.floor((values.length-1)*p)];
  return {median:q(.5), q75:q(.75), q90:q(.9), max:q(1)};
};
const scenarios = [];
for (const id of ['current', 'bounded_fast']) for (const choice of [false, true]) {
  const paired = [];
  for (const enabled of [false, true]) {
    const games = [];
    for (let game=0; game<n; game++) {
      const seed = (experiment.seed + Math.imul(game+1, 0x9e3779b1) + Math.imul(profileIndex+1, 0x85ebca6b) + (choice ? 0xc2b2ae35 : 0)) >>> 0;
      games.push(runGame(config, decks, {...experiment, autoFinishWhenComplete:enabled}, experiment.models.find(m => m.id === id), profile, choice, seed));
    }
    paired.push(games);
    scenarios.push({model:id, continueAtChoice:choice, autoFinishWhenComplete:enabled, samples:n,
      firstWheel:stats(games.map(g => g.wheel1Turns)), secondWheel:stats(games.map(g => g.wheel2Turns)),
      totalTurns:stats(games.map(g => g.turns)),
      completionClosures:games.filter(g => g.finishReason === 'complete').length,
      timeouts:games.filter(g => g.timeout).length});
  }
  for (let i=0;i<n;i++) {
    const [oldGame, newGame] = paired.map(g => g[i]);
    if (newGame.turns > oldGame.turns || newGame.wheel1Turns !== oldGame.wheel1Turns ||
        newGame.finalFill !== oldGame.finalFill || newGame.finalSpins !== oldGame.finalSpins) throw Error(`PAIRED_INVARIANT:${id}:${i}`);
  }
}
const report = {seed:experiment.seed, games:n*scenarios.length, profile, maxTurns:experiment.maxTurns,
  note:'Paired identical seeds. Current is the deployed first-wheel policy; bounded_fast remains experimental. No UI previews. Maximum is observed, not a hard turn limit.', scenarios};
await writeFile('research/progression/completion-results.json', JSON.stringify(report,null,2)+'\n');
const lines = [
  '# Cierre automático al completar máquina y tiradas', '',
  `${report.games.toLocaleString('es-AR')} partidas: dos políticas de primera ruleta, dos decisiones, cierre automático activado/desactivado y ${n} semillas por combinación. Perfil: acepta todo, supera 95% de retos binarios; numéricos binomiales con probabilidad 95%.`, '',
  'El cierre automático usa la misma condición del dominio que la demo: segunda ruleta activa, ninguna piedra y máximo configurado de tiradas acumuladas. Respeta el cierre anterior por categoría finale. Las semillas están emparejadas: se comprobó que activar la regla no aumenta los giros ni cambia las fichas o tiradas finales ganadas.', '',
  '| Primera ruleta | Decisión | Cierre automático | Segunda: Q75 / Q90 / máx. | Total: Q75 / Q90 / máx. |',
  '|---|---|---|---:|---:|',
];
for (const s of scenarios) {
  const triple = x => `${x.q75} / ${x.q90} / ${x.max}`;
  lines.push(`| ${s.model === 'current' ? 'Actual' : 'Híbrido recomendado'} | ${s.continueAtChoice ? 'Continúa' : 'Pasa'} | ${s.autoFinishWhenComplete ? 'Sí' : 'No'} | ${triple(s.secondWheel)} | ${triple(s.totalTurns)} |`);
}
lines.push('', 'El híbrido recomendado sigue siendo experimental; la demo sólo incorpora aquí el cierre automático de la segunda ruleta. La primera ruleta actual todavía puede durar mucho, porque su progresión no tiene límite por llenado.', '',
  'Los máximos son observados, no límites garantizados. Mientras falten fichas o tiradas, rechazos y fallos pueden prolongar la segunda etapa. Lo que se elimina es seguir girando cuando ya no queda nada por ganar.', '',
  'Repetir con `node scripts/compare-completion.mjs`. Datos: [completion-results.json](completion-results.json). Las reglas y el perfil se cargan desde los JSON existentes; se omiten las muestras sin premio y las animaciones.', '');
await writeFile('research/progression/COMPLETION.md', lines.join('\n'));
console.log(JSON.stringify(report,null,2));

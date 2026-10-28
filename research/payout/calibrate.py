"""Search payout tables; fixed full reels and the configured maximum spin count.

No production files are changed. Percentiles use the finite per-spin PMF
convolved N times with FFT (floating-point arithmetic), not fitted samples.
The JS validator independently checks every finalist against the real domain.
"""
import argparse
import hashlib
import itertools
import json
from pathlib import Path

import numpy as np
from scipy.optimize import differential_evolution
from scipy.fft import rfft, irfft, next_fast_len

ROOT = Path(__file__).resolve().parents[2]


class Evaluator:
    def __init__(self, config, experiment):
        self.config, self.experiment = config, experiment
        self.slots = config['slots']
        self.rules = self.slots['payout']
        self.spins = config['final']['maxSpins']
        self.unit = experiment['unit']
        self.symbols = list(self.rules['table'])
        available = list(self.slots['target'])
        lines = list(itertools.product(available, repeat=self.slots['reels']))
        self.probability = np.array([
            np.prod([self.slots['target'][s] / self.slots['positions'] for s in line])
            for line in lines
        ])
        self.counts = np.array([[line.count(s) + line.count(self.slots['wild']) for s in self.symbols] for line in lines])
        self.eligible = np.array([[s in line or not self.rules['wildRequiresNatural'] for s in self.symbols] for line in lines])
        self.exceptional = np.array([all(s == self.rules['exceptional']['symbol'] for s in line) for line in lines])
        self.multiplier = np.array([self.rules['multiplier'] if self.slots['multiplier'] in line else 1 for line in lines])
        self.base = np.array([self.rules['table'][s] for s in self.symbols], dtype=float)
        self.targets = np.array(list(experiment['targetQuantiles'].values()), dtype=float)
        self.quantiles = np.array([float(q) for q in experiment['targetQuantiles']])
        # Keep existing ordinary-jackpot entries and the exceptional award.
        self.fixed = self.base >= self.rules['ordinary']
        self.calls = 0

    def table(self, values):
        rounded = np.round(values / self.experiment['roundTo']) * self.experiment['roundTo']
        rounded[:, 0] = 0
        rounded[:, 1:] = np.maximum(rounded[:, 1:], self.experiment['roundTo'])
        rounded = np.maximum.accumulate(np.maximum.accumulate(rounded, axis=1), axis=0)
        rounded = np.minimum(rounded, self.rules['ordinary'])
        rounded[self.fixed] = self.base[self.fixed]
        return rounded.astype(int)

    def payouts(self, table):
        candidates = table[np.arange(len(self.symbols))[None, :], self.counts]
        values = np.max(np.where(self.eligible, candidates, 0), axis=1) * self.multiplier
        values[self.exceptional] = self.rules['exceptional']['value']
        return values.astype(int)

    def distribution(self, table):
        values = self.payouts(table)
        assert np.all(values % self.unit == 0)
        single = np.bincount(values // self.unit, weights=self.probability)
        length = (len(single) - 1) * self.spins + 1
        total = irfft(rfft(single, next_fast_len(length)) ** self.spins, next_fast_len(length))[:length]
        total = np.maximum(total, 0)
        total /= total.sum()
        return single, total

    def objective(self, table):
        self.calls += 1
        _, total = self.distribution(table)
        cdf = np.cumsum(total)
        values = np.searchsorted(cdf, self.quantiles) * self.unit
        error = np.mean(((values - self.targets) / self.targets) ** 2)
        # User puts 100k below P25, without making it a guaranteed floor.
        error += max(0, cdf[self.experiment['lowReference'] // self.unit] - .24) ** 2
        # Keep million-plus totals around the top 1%, including atom boundaries.
        million_rate = total[self.rules['ordinary'] // self.unit:].sum()
        error += .1 * ((million_rate - .01) / .01) ** 2
        return float(error)

    def summarize(self, table):
        single, total = self.distribution(table)
        cdf = np.cumsum(total)
        q = lambda p: int(np.searchsorted(cdf, p) * self.unit)
        threshold = self.rules['ordinary'] // self.unit
        exception_probability = float(self.probability[self.exceptional].sum())
        values = self.payouts(table)
        ordinary_probability = float(self.probability[(values >= self.rules['ordinary']) & ~self.exceptional].sum())
        return {
            'table': {s: table[i].tolist() for i, s in enumerate(self.symbols)},
            'objective': self.objective(table),
            'quantiles': {str(p): q(p) for p in [.01, .05, .1, .25, .5, .75, .9, .95, .99, .999]},
            'mean': float(np.dot(np.arange(len(total)) * self.unit, total)),
            'probabilityBelow100k': float(total[:self.experiment['lowReference'] // self.unit].sum()),
            'probabilityAtMost100k': float(cdf[self.experiment['lowReference'] // self.unit]),
            'probabilityMillionOrMore': float(total[threshold:].sum()),
            'perSpinOrdinaryJackpot': ordinary_probability,
            'perSpinExceptionalJackpot': exception_probability,
            'finalAnyOrdinaryJackpot': 1 - (1 - ordinary_probability) ** self.spins,
            'finalAnyExceptionalJackpot': 1 - (1 - exception_probability) ** self.spins,
            'perSpinDistribution': [{'payout': int(i * self.unit), 'probability': float(p)} for i, p in enumerate(single) if p > 0],
            'totalDistribution': [{'payout': int(i * self.unit), 'probability': float(p)} for i, p in enumerate(total) if p > 1e-14],
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default='artifacts/payout-search.json')
    args = parser.parse_args()
    source = (ROOT / 'content/game.config.json').read_bytes()
    config = json.loads(source)
    experiment = json.loads((ROOT / 'research/payout/experiment.json').read_text())
    evaluator = Evaluator(config, experiment)
    results = []

    def save(name, table):
        summary = {'model': name, **evaluator.summarize(table)}
        results.append(summary)
        print(name, json.dumps({k: summary[k] for k in ['quantiles', 'probabilityMillionOrMore', 'objective']}), flush=True)

    save('current', evaluator.base.astype(int))
    def scale(x):
        values = evaluator.base * x[0]
        values[evaluator.fixed] = evaluator.base[evaluator.fixed]
        return evaluator.table(values)

    def compressed(x):
        values = np.where(evaluator.base > 0, x[0] * (evaluator.base / 20000) ** x[1], 0)
        values[evaluator.fixed] = evaluator.base[evaluator.fixed]
        return evaluator.table(values)

    def by_count(x):
        # Four base awards plus four rank slopes, preserving symbol/count order.
        values = np.zeros_like(evaluator.base)
        rank = np.arange(len(evaluator.symbols)) / (len(evaluator.symbols) - 1)
        for count in range(1, evaluator.slots['reels'] + 1):
            values[:, count] = x[count - 1] + rank * x[count + 3]
        values[evaluator.fixed] = evaluator.base[evaluator.fixed]
        return evaluator.table(values)

    for name, decode, bounds in [
        ('scaled', scale, [(1, 5)]),
        ('compressed', compressed, [(25000, 100000), (.2, 1.1)]),
        ('by_count', by_count, [(5000, 40000), (15000, 80000), (60000, 180000), (100000, 500000), (0, 60000), (0, 80000), (0, 200000), (0, 500000)]),
    ]:
        result = differential_evolution(lambda x: evaluator.objective(decode(x)), bounds,
            seed=experiment['seed'], maxiter=experiment['search']['iterations'],
            popsize=experiment['search']['population'], polish=False, tol=.001)
        save(name, decode(result.x))

    best = min(results, key=lambda m: m['objective'])
    table = np.array([best['table'][s] for s in evaluator.symbols])
    score = evaluator.objective(table)
    positions = [(r, c) for r in range(len(evaluator.symbols))
                 for c in range(1, evaluator.slots['reels'] + 1) if not evaluator.fixed[r, c]]
    origin = table.copy()
    def refine(x):
        candidate = origin.copy()
        for (row, count), value in zip(positions, x):
            candidate[row, count] = value
        return evaluator.table(candidate)
    radius = experiment['search']['refinementRadius']
    result = differential_evolution(lambda x: evaluator.objective(refine(x)),
        [(max(experiment['roundTo'], origin[r, c] - radius), origin[r, c] + radius) for r, c in positions],
        x0=[origin[r, c] for r, c in positions], seed=experiment['seed'] + 2,
        maxiter=experiment['search']['refinementIterations'], popsize=experiment['search']['refinementPopulation'],
        polish=False, tol=.001)
    if result.fun < score:
        table, score = refine(result.x), result.fun
    for step in [40000, 20000, 10000, 5000]:
        for _ in range(12):
            improved = False
            for row in range(len(evaluator.symbols)):
                for count in range(1, evaluator.slots['reels'] + 1):
                    if evaluator.fixed[row, count]:
                        continue
                    for direction in [-1, 1]:
                        candidate = table.copy()
                        candidate[row, count] += direction * step
                        candidate = evaluator.table(candidate)
                        value = evaluator.objective(candidate)
                        if value < score - 1e-12:
                            table, score, improved = candidate, value, True
            if not improved:
                break
    save('refined', table)

    report = {'sourceHash': hashlib.sha256(source).hexdigest(), 'experiment': experiment,
        'spins': evaluator.spins, 'reels': config['slots']['target'],
        'method': 'weighted enumeration of full-reel lines and finite convolution of independent paid spins',
        'note': 'No progression, rejection or incomplete machines; floating-point FFT; production unchanged.',
        'objectiveEvaluations': evaluator.calls, 'models': results}
    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + '\n')
    print(f'Saved {out}', flush=True)


if __name__ == '__main__':
    main()

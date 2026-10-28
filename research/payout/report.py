"""Render the saved, domain-validated search without modifying the game."""
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'research/payout'
report = json.loads((ROOT / 'artifacts/payout-search.json').read_text())
best = min(report['models'], key=lambda m: m['objective'])
assert report['validation']['model'] == best['model']
labels = {'current': 'Actual', 'scaled': 'Escalado uniforme', 'compressed': 'Compresión de pagos',
          'by_count': 'Por cantidad y símbolo', 'refined': 'Tabla afinada'}
money = lambda n: '$' + f'{n:,.0f}'.replace(',', '.')
pct = lambda n: f'{n * 100:.4f}%'

fig, ax = plt.subplots(figsize=(10, 5.5), layout='constrained')
for model in [report['models'][0], best]:
    distribution = model['totalDistribution']
    ax.plot([p['payout'] for p in distribution], np.cumsum([p['probability'] for p in distribution]) * 100,
            label=labels[model['model']], linewidth=2.3)
for index, (p, value) in enumerate(report['experiment']['targetQuantiles'].items()):
    ax.scatter(value, float(p) * 100, color='#b83424', zorder=4, label='Objetivos' if index == 0 else None)
    ax.annotate(f'P{float(p)*100:g}: {money(value)}', (value, float(p) * 100),
                xytext=(-5, -20), textcoords='offset points', ha='right', fontsize=9)
ax.set(xlim=(0, 1200000), ylim=(0, 102), xlabel='Premio total de las 5 tiradas',
       ylabel='% de finales con un premio igual o menor',
       title='Máquina completa · 5 tiradas · distribución calculada')
ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f'${v/1000:,.0f}k'))
ax.spines[['top', 'right']].set_visible(False)
ax.grid(alpha=.2)
ax.legend(loc='lower right')
fig.savefig(OUT / 'comparison.png', dpi=160)
plt.close(fig)

summary = {**report, 'models': [{k: v for k, v in m.items() if k != 'totalDistribution'} for m in report['models']]}
(OUT / 'results.json').write_text(json.dumps(summary, indent=2) + '\n')
(OUT / 'proposal.json').write_text(json.dumps({'sourceHash': report['sourceHash'],
    'model': best['model'], 'table': best['table'], 'appliedToProduction': False}, indent=2) + '\n')

lines = [
    '# Calibración de premios con máquina completa', '',
    '**Escenario único: los 80 lugares completos y exactamente 5 tiradas pagadas.** Los percentiles corresponden a la suma de esas cinco tiradas; no a una tirada individual ni a una mezcla de partidas con distinta progresión.', '',
    'Objetivos: P50 $300.000, P75 $400.000, P90 $500.000 y P99 alrededor de $1.000.000. $100.000 es una referencia de premio bajo, por debajo del P25, sin mínimo garantizado ni percentil exacto fijado.', '',
    f'La mejor candidata ensayada es **{labels[best["model"]]}**. La propuesta está guardada en `proposal.json`; **no está aplicada a la demo**. La búsqueda compara un escalado uniforme, una transformación que aumenta proporcionalmente más los pagos bajos, una tabla por cantidad y rango de símbolo, y un ajuste de sus celdas en pasos de $5.000. No se afirma un óptimo global.', '',
    '| Modelo | P25 | Mediana | P75 | P90 | P99 | Total ≥ $1M |',
    '|---|---:|---:|---:|---:|---:|---:|',
]
for m in report['models']:
    lines.append('| ' + labels[m['model']] + ' | ' + ' | '.join(money(m['quantiles'][p]) for p in ['0.25','0.5','0.75','0.9','0.99']) + f' | {pct(m["probabilityMillionOrMore"])} |')
lines += ['', '![Distribución acumulada](comparison.png)', '',
    '## Extremos y jackpots', '',
    f'- P1: {money(best["quantiles"]["0.01"])}; P5: {money(best["quantiles"]["0.05"])}; P10: {money(best["quantiles"]["0.1"])}.',
    f'- Probabilidad de total menor a $100.000: **{pct(best["probabilityBelow100k"])}**; menor o igual: **{pct(best["probabilityAtMost100k"])}**.',
    f'- Probabilidad de acumular $1.000.000 o más: **{pct(best["probabilityMillionOrMore"])}**. Puede ser la suma de premios menores; no equivale a sacar un jackpot en una tirada.',
    f'- Jackpot ordinario por tirada (pago ≥ $1M, excluyendo el excepcional): **{pct(best["perSpinOrdinaryJackpot"])}**. Al menos uno en cinco: **{pct(best["finalAnyOrdinaryJackpot"])}**.',
    f'- Cuatro símbolos excepcionales naturales: **{pct(best["perSpinExceptionalJackpot"])}** por tirada, o **{pct(best["finalAnyExceptionalJackpot"])}** al menos una vez en cinco. Conserva el premio de $5M.',
    '', '## Tabla candidata', '',
    'Valores por combinación antes del multiplicador. Los ids provienen del JSON. Se conserva la sustitución por Wild, la necesidad de un símbolo natural y el multiplicador no acumulable. Los cuatro símbolos excepcionales naturales siguen pagando $5M, por encima de la entrada ordinaria de su fila.', '',
    '| id | 1 | 2 | 3 | 4 |', '|---|---:|---:|---:|---:|',
]
for symbol, values in best['table'].items():
    lines.append('| ' + symbol + ' | ' + ' | '.join(money(v) for v in values[1:]) + ' |')
validation = report['validation']
lines += ['', '## Verificación y reproducción', '',
    '- Se enumeran todas las líneas posibles, ponderadas por la frecuencia de cada símbolo en los rodillos completos. Se calcula la distribución de la suma de cinco tiradas independientes mediante convolución finita. FFT usa aritmética de punto flotante; no se confunde este cálculo con una muestra de partidas.',
    f'- Las distribuciones por tirada de las {validation["perSpinDomainDistributionsVerified"]} tablas se contrastaron con `analyzeSlots` del dominio, con tolerancia de 1e-12 por probabilidad.',
    f'- Validación independiente con **{validation["samples"]:,} finales / {validation["paidSpins"]:,} tiradas**, usando `spinSlots` real y una semilla distinta. Error máximo de CDF: {validation["maximumCdfError"]:.6f} (límite de comprobación {validation["tolerance"]:.6f}).',
    '- Percentiles observados en esa simulación: ' + ', '.join(f'P{float(p)*100:g} {money(validation["quantiles"][p])}' for p in ['0.25','0.5','0.75','0.9','0.99']) + '.',
    '- No se simulan decisiones, rechazos, ruletas de desafíos ni máquinas incompletas. Tampoco se incluyen las tiradas de muestra sin premio. El comportamiento de esos escenarios no se valida en este experimento.',
    '- Los percentiles son el menor importe cuya probabilidad acumulada alcanza el percentil indicado. Hay saltos porque los pagos son discretos; se informa por separado la probabilidad de alcanzar el millón.',
    '- Se preservan composición, cantidad de tiradas, azar uniforme, reglas de pago, entradas ordinarias de $1M y premio excepcional de $5M. Sólo se buscan importes alternativos para las otras celdas de pago.',
    '- El ajuste minimiza el error relativo cuadrático de los cuatro percentiles y la distancia de la probabilidad de total ≥ $1M al 1%; también evita situar $100.000 en o por encima del P25. No se fuerza un premio mínimo.', '',
    '```bash', 'python -m pip install -r research/payout/requirements.txt',
    'OPENBLAS_NUM_THREADS=1 python research/payout/calibrate.py',
    'node research/payout/validate.mjs', 'python research/payout/report.py', '```', '',
    'Los objetivos y parámetros de búsqueda están en `experiment.json`. `results.json` contiene probabilidades, percentiles, semilla y hash del archivo de configuración de origen. `proposal.json` permite revisar la tabla antes de incorporarla. El archivo completo de distribuciones se genera en `artifacts/payout-search.json`.', '',
]
(OUT / 'REPORT.md').write_text('\n'.join(lines))
print('Wrote research/payout/REPORT.md, results.json, proposal.json and comparison.png')

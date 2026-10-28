# Progresión gradual sin bloqueo

Se eligió `balanced_wait`: categoría siempre disponible, curva continua y bonificación de espera de 0,25 puntos por giro desde el 60%. Conserva el límite obligatorio del 90% y acredita excedentes en la segunda ruleta.

Refinamiento: 24.000 partidas (4 modelos × 6 perfiles × 2 decisiones × 500 semillas), después de explorar 42.000 partidas con otras curvas. Son supuestos de jugadores, no datos reales.

| Perfil | Acepta / éxito binario | Q25 al pasar | Q25 al continuar |
|---|---|---:|---:|
| typical | 85% / 70% | 78.75% | 82.5% |
| low | 50% / 40% | 70% | 73.75% |
| high | 100% / 95% | 85% | 88.75% |
| scarce | 20% / 25% | 57.5% | 61.25% |
| reject_half | 50% / 70% | 73.75% | 77.5% |
| reject_most | 20% / 70% | 65% | 68.75% |

El perfil que rechaza el 80% y supera el 70% de los retos binarios tiene Q25 de llenado cercano al 65%. En el caso extremo que además sólo supera el 25%, puede bajar del 60%: no hay mínimo garantizado. La curva suave también aumenta los pases obligatorios al 90% para quienes llenan rápido; es el costo de mantener la categoría pequeña durante más tiempo.

Parámetros y todos los escenarios: [smooth-results.json](smooth-results.json). Repetir: `npm run simulate:progression -- --experiment research/progression/smooth-refinement.json --out artifacts/smooth-refinement.json`. Comparación previa: `smooth-models.json`. Los premios, las fichas y las categorías restantes conservan sus reglas; se usa el mismo dominio de grilla, inserción y pagos. Las muestras sin premio no se simulan.

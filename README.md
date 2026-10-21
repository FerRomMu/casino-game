# Gameshow — demo funcional

Webapp local, sin backend ni dependencias de ejecución. Requiere **Node.js 22 o posterior**.

**Demo online:** https://ferrommu.github.io/casino-game/

GitHub Pages publica automáticamente el build de producción después de cada push a `master`, siempre que pasen las pruebas del dominio. El workflow también permite un despliegue manual desde Actions. Las partidas siguen ejecutándose íntegramente en el navegador.

## Probar la demo

```bash
git clone https://github.com/FerRomMu/casino-game.git
cd casino-game
npm run dev
```

Abrir **http://localhost:5173**. No hace falta ejecutar `npm install`.

Si ya tenés el repo clonado, ejecutá `git pull` antes de `npm run dev`.

La partida se ejecuta en memoria. Cada carga obtiene una semilla nueva del navegador. Para reproducir una partida, configurar `ui.randomSeed: false`: se utiliza `seed` del mismo JSON. El servidor sólo entrega archivos estáticos; no implementa lógica del juego ni una API.

![Interfaz de escritorio](docs/ui-desktop.png)

[Ver tragamonedas](docs/ui-slots.png) · [Ver versión móvil](docs/ui-mobile.png)

## Qué se puede probar

- Dos ruletas con sectores ponderados: el tamaño visual y la selección usan las mismas probabilidades normalizadas.
- Selección de carta boca abajo, aceptación o rechazo sin penalización, retos binarios y resultados numéricos.
- Conversión automática de puntos en extracciones del tablero 7 × 7, incorporación de especiales y reemplazo de piedras en cuatro rodillos de veinte posiciones.
- Ruleta con sectores de colores, relieve dorado, luces animadas e iconos por categoría. Símbolos ilustrados en SVG, tipografías locales y máquina con rodillos profundos y columnas doradas.
- Animaciones de cartas, selección de fichas, vuelos reales hacia el inventario y los rodillos, reemplazos del tablero, fuego y premios. Las fichas recogidas se muestran después de extraerse; los rodillos frenan de a uno.
- Protección frente a clicks repetidos durante las secuencias. La ayuda se puede abrir durante las animaciones sin reemplazar ni interrumpir la escena en curso.
- Una única tirada de muestra tras cada recompensa: si aumenta el máximo alcanzable, lo muestra y anuncia el nuevo récord; de lo contrario, muestra una tirada aleatoria. No consume tiradas ni acredita premios. Los umbrales y tamaños del número se configuran en `ui.prizeTiers`.
- Tercera aparición de progresión: elegir pasar o continuar. Cuarta aparición: pase obligatorio.
- Primera aparición de la categoría final: acceso directo al tragamonedas, con una tirada por click, frenado pausado de izquierda a derecha y resaltado de los símbolos que realmente pagan (incluidos Wild y un único multiplicador). El pozo acumulado se muestra junto al máximo total: acumulado + máximo por tirada × tiradas restantes. Ambos se actualizan al terminar de frenar, sin revelar el resultado durante el giro.
- Juego ajustado a `100dvh`, sin scroll de página, con título y sonido dentro del gabinete, fondo texturado e inventario siempre visible. Diseño adaptable y preferencia `prefers-reduced-motion`.
- Efectos de sonido opcionales, silenciados al iniciar, pantalla completa y reinicio con confirmación. El resultado numérico muestra su premio y conserva el foco del teclado, incluidos sus límites.

## Configuración

Todos los valores del juego y el contenido provisional están en `content/`:

| Archivo | Contenido |
| --- | --- |
| `game.config.json` | Pesos, símbolos, inventario, composición objetivo, pagos, progresión, efectos, cantidad de tiradas y tiempos principales de animación. |
| `cards_wheel_1.json` | Cartas, categoría, clave de texto, resolución y recompensas de la primera ruleta. |
| `cards_wheel_2.json` | Cartas de la segunda ruleta. La categoría final se resuelve directamente. |
| `strings.json` | Textos de interfaz, categorías, desafíos, nombres e iconos de símbolos. |

### Cambiar las probabilidades

Modificar `wheels.<wheel_id>.categories[].weight`. Los pesos se normalizan: no tienen que sumar cien. Por ejemplo, pesos `33` y `67` representan 33 % y 67 %; pesos `1` y `2` representan un tercio y dos tercios. Para que una categoría ocupe 33 % de una ruleta de siete categorías, los otros seis pesos deben sumar 67. Un peso cero oculta el sector y excluye la categoría del sorteo. Pesos negativos y ruletas sin peso positivo se rechazan al cargar.

La función `wheelSectors` produce tanto los límites utilizados por el dibujo SVG como los utilizados por el sorteo. Los porcentajes de la leyenda se redondean sólo para mostrarlos.

### Cartas y contenido

Las cartas usan `text_key` y `category`; ninguna regla depende del texto del desafío. `resolution: "binary"` utiliza `reward.success` / `reward.failure`. `resolution: "numeric"` utiliza `maximum` y `reward.byResult`: la posición del arreglo indica la cantidad cumplida, incluyendo cero. `reward.success` y `reward.failure` se muestran como referencia de los extremos.

Los mazos se agotan sin repetir cartas; al agotarse una categoría, se habilita nuevamente su mazo. Rechazar no cambia puntos, fichas, tiradas ni progresión. La carta extraída queda registrada como usada.

Las claves ausentes se muestran como `MISSING:<key>` en desarrollo y como texto vacío en la distribución de producción.

Los campos `art` de símbolos, efectos y categorías referencian ilustraciones de `assets/casino.svg`. Si un símbolo o efecto no declara ilustración, utiliza su `icon_key` como alternativa. El frenado final se configura con `ui.timings.finalReelStop` (primera pausa), `finalReelStep` (incremento entre pausas) y `finalReelSettle` (asentamiento final); las muestras conservan `reelStop`. Los tiempos de las secuencias, cantidad de luces, preferencia inicial de sonido y umbral de efectos para fichas especiales están en `ui`. Las fuentes y las ilustraciones se sirven localmente y se incluyen en el build: la demo no requiere servicios externos para dibujar la interfaz.

## Separación de responsabilidades

```text
src/domain/      Reglas, estado, pesos, azar inyectado, inventario y pagos.
src/ui/app.js   Orquestación de acciones y secuencias de animación.
src/ui/render.js Vista: transforma el estado en interfaz.
src/ui/audio.js Efectos de sonido opcionales, fuera del dominio.
assets/         Ilustraciones y tipografías locales con sus licencias.
content/        Datos de juego y textos externos.
scripts/        Servidor estático, build y simulación por consola.
test/           Invariantes del dominio.
e2e/            Recorridos reales en Chromium con Playwright.
```

El dominio no importa DOM, navegador, temporizadores, archivos ni strings. `transition(state, action, { config, decks, rng })` devuelve un estado nuevo. El consumidor controla la fuente de azar; la UI y el simulador usan el mismo dominio. Cada estado representa un participante, con su propio contador y partida; la demo presenta un participante por vez.

Las animaciones consumen resultados ya determinados y no llaman al RNG del dominio. Durante los efectos, la UI bloquea nuevas acciones. El dominio también rechaza acciones incompatibles con su fase actual.

## Pruebas, simulaciones y build

```bash
npm test
npm run simulate -- --games 1000 --spins 100000 --seed 20261021
npm run build
```

Para las pruebas de navegador sí se instalan las dependencias de desarrollo:

```bash
npm ci
npx playwright install chromium
npm run test:ui
```

Si existe `/usr/bin/chromium`, se utiliza directamente; `CHROMIUM_PATH` permite indicar otra ruta. El servidor de pruebas se inicia automáticamente. La suite cubre una partida completa con sonido, pesos no uniformes, todos los símbolos ilustrados, ayuda durante el giro, protección frente a dobles clicks, retos numéricos y binarios, rechazos, progresión, rodillos en movimiento, final y reinicio. Revisa desbordes y visibilidad de controles e inventario, incluyendo 320 × 568, 390 × 844, 844 × 390 y 1280 × 720. También comprueba inserciones sobre piedras, explosiones encadenadas y la selección de una única tirada de muestra. Las trazas y capturas de los fallos quedan en `artifacts/browser-results/`.

La simulación escribe `artifacts/simulation.json`, incluyendo cuartiles, mediana, premios, composición final, tiradas utilizadas y comparación con los objetivos configurados. Permite `--content <directorio>` para probar otra configuración sin modificar el código. `--spins` indica la cantidad de finales simulados con máquina completa; cada final utiliza entre el mínimo y máximo de tiradas configurados.

El informe distingue partidas completas con la progresión real de la máquina y finales con la máquina completamente formada. Las probabilidades por tirada de los jackpots de la máquina completa se calculan exactamente, enumerando combinaciones de símbolos ponderadas por sus cantidades, además del muestreo de premios.

`npm run build` genera `dist/`. Para servirlo: `node scripts/serve.mjs dist`. El servidor utiliza el puerto 5173; se puede cambiar con la variable `PORT`.

## Decisiones provisionales de la demo

Los datos están marcados como `contentMode: "dummy"`. **Los premios no están calibrados a los objetivos de la spec.** El informe lo indica con `calibrated: false` y expone la comparación, sin declarar cumplidos los objetivos.

- Se paga sólo la línea central: se elige el mejor premio de la tabla según cantidad de símbolos, sin requerir adyacencia. Las otras dos filas son presentación visual.
- `wildRequiresNatural: true` exige que haya al menos un símbolo natural del tipo representado para que un Wild lo complete. Esta política es configurable. x2 multiplica una sola vez el premio de la línea, independientemente de su cantidad.
- Cuatro sietes naturales dan el jackpot excepcional. Wild no sustituye un siete para ese jackpot.
- El mínimo de tres tiradas al entrar al final es una garantía de esta demo; las tiradas acumuladas se limitan a cinco. Ambos límites son configurables.
- Cinco fichas de tirada entregan una tirada cada una. Los cinco efectos `bonus` usan `collect: "orthogonal"`: recogen vecinos activos arriba, abajo, izquierda y derecha, sin diagonales ni cruce entre bordes. En esquinas/bordes recogen los vecinos disponibles. Los efectos alcanzados encadenan explosiones, cada casilla se recoge una sola vez por cadena y las reposiciones ocurren al terminarla. No consumen los demás puntos del turno ni entregan una tirada por sí mismos.
- Las quince fichas especiales reservadas representan veinte unidades de rodillo: algunas fichas especiales entregan dos unidades. Se agregan quince unidades ordinarias al inventario de reposición para alcanzar la composición objetivo de ochenta posiciones. Estas decisiones resuelven diferencias entre las cantidades de la grilla y de los rodillos; requieren validación de producto antes del balance definitivo.
- Al extraer una ficha se intenta colocar un especial reservado en otra posición aleatoria de menor rango. La ficha desplazada vuelve al inventario de reposición. Se conservan todas las unidades. Los huecos se apagan cuando se agota el inventario disponible, y dejan de participar en los sorteos.
- La inserción equilibra cada símbolo entre rodillos que todavía tienen capacidad, sin superar sus cuotas objetivo.
- La categoría de cierre pasa directamente al final. Sus pesos de prueba son 10 para finale y 30 para cada una de las otras tres categorías (10 % / 30 % / 30 % / 30 %).

Verificación del rediseño: pruebas del dominio, recorridos automatizados en Chromium, revisión de capturas de escritorio y móvil, y build de producción. El balance estadístico sigue siendo provisional.

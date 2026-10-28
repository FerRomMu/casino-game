# Cierre automático al completar máquina y tiradas

16.000 partidas: dos políticas de primera ruleta, dos decisiones, cierre automático activado/desactivado y 2000 semillas por combinación. Perfil: acepta todo, supera 95% de retos binarios; numéricos binomiales con probabilidad 95%.

El cierre automático usa la misma condición del dominio que la demo: segunda ruleta activa, ninguna piedra y máximo configurado de tiradas acumuladas. Respeta el cierre anterior por categoría finale. Las semillas están emparejadas: se comprobó que activar la regla no aumenta los giros ni cambia las fichas o tiradas finales ganadas.

| Primera ruleta | Decisión | Cierre automático | Segunda: Q75 / Q90 / máx. | Total: Q75 / Q90 / máx. |
|---|---|---|---:|---:|
| Actual | Pasa | No | 14 / 22 / 84 | 39 / 50 / 108 |
| Actual | Pasa | Sí | 4 / 8 / 17 | 27 / 36 / 92 |
| Actual | Continúa | No | 14 / 23 / 79 | 48 / 59 / 120 |
| Actual | Continúa | Sí | 2 / 5 / 16 | 35 / 46 / 112 |
| Híbrido recomendado | Pasa | No | 14 / 22 / 79 | 30 / 38 / 91 |
| Híbrido recomendado | Pasa | Sí | 5 / 5 / 8 | 20 / 21 / 25 |
| Híbrido recomendado | Continúa | No | 14 / 23 / 76 | 31 / 40 / 95 |
| Híbrido recomendado | Continúa | Sí | 4 / 5 / 7 | 21 / 22 / 25 |

El híbrido recomendado sigue siendo experimental; la demo sólo incorpora aquí el cierre automático de la segunda ruleta. La primera ruleta actual todavía puede durar mucho, porque su progresión no tiene límite por llenado.

Los máximos son observados, no límites garantizados. Mientras falten fichas o tiradas, rechazos y fallos pueden prolongar la segunda etapa. Lo que se elimina es seguir girando cuando ya no queda nada por ganar.

Repetir con `node scripts/compare-completion.mjs`. Datos: [completion-results.json](completion-results.json). Las reglas y el perfil se cargan desde los JSON existentes; se omiten las muestras sin premio y las animaciones.

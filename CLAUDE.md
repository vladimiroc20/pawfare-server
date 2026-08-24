# CLAUDE.md — pawfare-server

Este es el repositorio del **servidor de partida** de Pawfare (Node.js + Colyseus).

**Antes de trabajar aquí, lee el documento maestro:** `../CLAUDE.md` (visión de producto, reglas legales no negociables, mecánicas validadas en el prototipo, y plan de fases completo). Este archivo solo cubre lo específico de este repo.

## Qué vive aquí

Servidor de partidas por turnos: maneja salas de **2 a 4 jugadores**, sincroniza estado (turno activo, terreno, salud), y es la **fuente de verdad** para física, daño y knockback — nunca confía en los valores que envía el cliente.

Estructura real del proyecto:

```
pawfare-server/
├── src/
│   ├── index.ts             # bootstrap: Express + WebSocketTransport + gameServer.listen()
│   ├── polyfillMetadata.ts  # ver "Gotcha de TypeScript/decoradores" más abajo — importar SIEMPRE primero
│   ├── rooms/PawfareRoom.ts # sala: join/leave, turnos, bot de respaldo, reconexión, resolución de disparo
│   ├── schema/PawfareState.ts # estado sincronizado (@colyseus/schema): players, obstacles, terrainHeights...
│   ├── sim/                 # simulación pura, sin dependencias de Colyseus — espejo de pawfare-client
│   │   ├── Constants.ts     # mismas constantes que Constants.gd (gravedad, daño, pull, etc.)
│   │   ├── Biomes.ts        # espejo de Biomes.gd, solo obstacleDelta/windScale (lo visual vive en el cliente)
│   │   ├── Terrain.ts       # mapa de alturas: generateHeights, heightAt, carveCrater
│   │   ├── Combat.ts        # simulateProjectile (vuelo tick a tick) + resolveKnockback (con settle server-side)
│   │   ├── Ranking.ts       # espejo de _build_ffa_ranking/_build_team_ranking del cliente
│   │   └── Spawner.ts       # espejo de _spawn_players/_generate_obstacles del cliente
│   └── dev/smoke_test.ts    # test de regresión, ver más abajo
└── package.json
```

**Toda la lógica de físicas/daño/terreno en `src/sim/` es un espejo deliberado de `pawfare-client/scripts/`** (mismas constantes, mismas fórmulas) para que el servidor pueda ser la fuente de verdad sin que el resultado se sienta distinto al cliente. Si cambias una constante o fórmula de física en un lado, cámbiala en el otro.

## Reglas específicas de este repo

- **Principio de seguridad central (sección 5 del maestro):** el cliente solo envía la acción del jugador (ángulo/potencia del disparo). El servidor recalcula trayectoria, impacto en terreno, daño con falloff, y knockback de forma independiente — nunca usa el resultado que reporta el cliente.
- El juego es por turnos, no en tiempo real: no hay que sincronizar físicas cuadro a cuadro, solo estado discreto (turno, acción, resultado, terreno actualizado).
- Terreno: representarlo como mapa de alturas (array por columna), igual que en el cliente, para que el recálculo del servidor sea comparable 1:1 con lo que el cliente muestra.
- **Salas de 2 a 4 jugadores** (no asumir 1v1 fijo en ningún lado del modelo de sala): el orden de turnos rota entre todos los jugadores activos, humanos o controlados por bot.
- **Bot de respaldo al desconectarse:** usar `onLeave` de Colyseus para detectar la caída de un jugador; en vez de removerlo de la sala, marcar su personaje como controlado por un bot simple (apunta con variación aleatoria, dispara en su turno) para no interrumpir la partida a los demás.
- **Reconexión:** usar `allowReconnection` de Colyseus con un token de sesión de vida corta entregado al unirse a la sala; si el jugador vuelve antes de que expire la ventana (y antes de que termine la partida), recupera el control de su personaje con el estado tal cual quedó.
- MVP más simple si hace falta: Firebase Realtime DB/Firestore en vez de Colyseus (sección 4.2 del maestro) — pero perdiendo control de validación anti-trampas y el mecanismo de reconexión nativo. Usar solo como puente temprano, migrar a Colyseus antes de tener usuarios reales.
- Comandos: `npm run dev` (desarrollo, con recarga vía `tsx watch`), `npm run build && npm start` (producción), `npm run typecheck` (solo `tsc --noEmit`), `npm run smoke` (test de regresión, ver abajo).
- **Node 22+ es obligatorio** (no Node 20): `@colyseus/testing`/`@colyseus/sdk` de esta generación lo requieren. Este equipo tiene Node 20 del sistema (apt) — usar `nvm use 22` (o el alias `default` de nvm, ya configurado a 22) antes de correr cualquier comando de este repo.

### Gotcha de TypeScript/decoradores (perdí tiempo real con esto, documentado para no repetirlo)

`@colyseus/schema@4` usa **decoradores legacy de TypeScript** (`target.constructor`, firma `PropertyDecorator`), no los decoradores nativos de TC39 — a pesar de que internamente usa `Symbol.metadata` para su almacenamiento propio. Eso exige una combinación específica en `tsconfig.json`:

```json
"experimentalDecorators": true,
"useDefineForClassFields": false
```

Si `useDefineForClassFields` queda en `true` (el default implícito con `target: ES2022`+), los inicializadores de campo (`players = new MapSchema()`) definen la propiedad directamente en la instancia y **saltan el setter que el decorador `@type()` inyecta en el prototipo** — el síntoma es un crash silencioso mucho más adelante, al primer intento de sincronizar estado (`Cannot read properties of undefined (reading 'Symbol(Symbol.metadata)')` dentro de `@colyseus/schema`), no un error claro en la clase mal declarada.

Además, como Node todavía no implementa `Symbol.metadata` de forma nativa, `src/polyfillMetadata.ts` lo define a mano (`Symbol.metadata ??= Symbol.for(...)`) — **debe ser el primer import** de cualquier punto de entrada (`index.ts`, `smoke_test.ts`), antes de que se cargue cualquier clase `Schema`, porque los decoradores corren al cargar el módulo.

### Test de regresión (`npm run smoke`)

`src/dev/smoke_test.ts` levanta un servidor Colyseus real (WebSocket real, no el harness `@colyseus/testing` — ese harness reenvía el estado completo por un camino distinto que tiene su propio bug de serialización, ver commit) en un puerto por caso de prueba, conecta clientes reales con `@colyseus/sdk`, y valida con `assert`:
- una partida de 2 jugadores completa (join → disparo → cráter en el terreno),
- equipos 2v2 con 4 jugadores (el equipo se asigna por paridad de índice, alternando A/B automáticamente),
- bot de respaldo: un jugador se desconecta a mitad de partida y el bot dispara solo en su turno,
- reconexión: el jugador vuelve dentro de la ventana y recupera el control (mismo `sessionId`).

## Estado actual

**Servidor funcional (Fase 3 en progreso):** salas Colyseus de 2-4 jugadores, todo `src/sim/` como espejo de la física/terreno/ranking del cliente, turnos con bot de respaldo automático al desconectarse (`onLeave` marca `isBot=true` sin remover al jugador) y reconexión vía `allowReconnection` (ventana de 60s, `Constants.RECONNECTION_WINDOW_SECONDS`) que devuelve el control si el jugador vuelve a tiempo. `npm run smoke` valida los 4 escenarios de punta a punta contra un servidor real. `npm run build`/`npm run typecheck` (tsc) limpios.

**Pendiente:** el cliente (`pawfare-client`) todavía no se conecta a este servidor por red — sigue jugando 100% local. Conectar el cliente Godot (WebSocket a esta sala, renderizar el estado sincronizado en vez de simular localmente) es el siguiente paso real de integración, y probablemente donde aparezcan más ajustes finos (la física del cliente y del servidor deben sentirse idénticas, ya están escritas con las mismas constantes pero no se han comparado lado a lado todavía).

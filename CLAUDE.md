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
│   │   ├── Combat.ts        # simulateProjectile/simulatePiercer (vuelo tick a tick) + resolveKnockback (settle server-side)
│   │   ├── Weapons.ts       # bazooka/cluster/bouncer/piercer — radios, daño, rebotes, túnel
│   │   ├── Ranking.ts       # espejo de _build_ffa_ranking/_build_team_ranking del cliente
│   │   └── Spawner.ts       # espejo de _spawn_players/_generate_obstacles del cliente
│   ├── match/               # segunda implementación de sala, para el cliente Godot — ver "API REST" abajo
│   │   ├── Match.ts          # misma orquestación que PawfareRoom (turnos, bot, ranking) pero sin Colyseus
│   │   └── MatchRegistry.ts  # registro en memoria de partidas + bucle de chequeo de presencia
│   ├── routes/api.ts        # rutas Express: /api/quickmatch, /rooms/:id/{state,fire,heartbeat,leave}
│   ├── dev/smoke_test.ts     # test de regresión de PawfareRoom/Colyseus, ver más abajo
│   └── dev/smoke_test_api.ts # test de regresión de la API REST/Match, ver más abajo
└── package.json
```

**Dos implementaciones de sala en paralelo, mismo motor de simulación:** `PawfareRoom` (Colyseus/WebSocket) y `Match` (REST/JSON) implementan las mismas reglas — turnos, bot de respaldo, ranking — pero con tipos de estado distintos (Schema de Colyseus vs. objetos planos), así que hay algo de duplicación en la orquestación de sala. **`pawfare-client` (Godot) usa la API REST (`Match`), no Colyseus** — no hay SDK oficial de Colyseus para Godot, y portar su protocolo binario propietario a GDScript a ciegas era demasiado riesgo sin poder validarlo. `PawfareRoom` queda disponible para un futuro cliente web/JS. Si cambias una regla de juego (condición de victoria, cálculo de daño, etc.), probablemente haya que tocar los dos — la lógica de físicas en sí (`src/sim/`) es compartida y no necesita duplicarse.

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

### API REST (`/api/...`) — lo que usa `pawfare-client`

- `POST /api/quickmatch` `{playerCount, teamMode, biomeId}` → encuentra una sala "waiting" que calce o crea una nueva, une al jugador, responde `{roomId, playerId, token, state}`. `token` es el secreto de esa butaca — hace falta para `fire`/`heartbeat`/`leave`.
- `GET /api/rooms/:roomId/state` → estado completo en JSON (fase, viento, jugadores, obstáculos, `terrainHeights`, `ranking` si terminó). Sin autenticación — es de solo lectura y no expone tokens (`Match.toJSON()` los omite explícitamente).
- `POST /api/rooms/:roomId/fire` `{playerId, token, dx, dy}` → igual que `aim_fire` de Colyseus: valida turno/token, resuelve el disparo servidor-side, devuelve el estado actualizado.
- `POST /api/rooms/:roomId/heartbeat` `{playerId, token}` → el cliente debe llamarlo mientras esté activo (cada ~5s). Si un jugador deja de mandar heartbeat mientras es su turno por más de `DISCONNECT_TIMEOUT_MS` (15s), pasa a `isBot=true` automáticamente — el REST no tiene conexión persistente que "se caiga", así que la presencia se infiere por heartbeat en vez de por `onLeave`.
- `POST /api/rooms/:roomId/leave` `{playerId, token}` → desconexión explícita e inmediata (mismo efecto que el timeout, pero sin esperar).

**Bucle de presencia:** `MatchRegistry.startPresenceLoop()` corre cada `PRESENCE_CHECK_INTERVAL_MS` (3s) y llama `match.checkPresence()` en cada partida activa, además de descartar partidas ya terminadas (`match.isDisposable`).

## Estado actual

**Servidor funcional y conectado al cliente (Fase 3 casi completa):** dos implementaciones de sala en paralelo sobre el mismo `src/sim/` — `PawfareRoom` (Colyseus/WS, sin cliente todavía) y `Match`+API REST (lo que usa `pawfare-client` hoy). Turnos, bot de respaldo, reconexión/heartbeat y ranking funcionan en ambas. `npm run smoke` (Colyseus) y `npm run smoke:api` (REST) validan los escenarios de punta a punta contra un servidor real, incluyendo el timeout real de `DISCONNECT_TIMEOUT_MS`. `npm run build`/`npm run typecheck` limpios. Validado además desde el lado Godot: `pawfare-client/scripts/dev/network_smoke_test.gd` conecta dos clientes reales contra este servidor y confirma que caen en la misma sala, la partida arranca, y un disparo por HTTP cambia el terreno.

**Persistencia (2026-08-24):** `Match` acepta un callback `onChange` (constructor) invocado cada vez que su estado realmente cambia — join, resolución de disparo, heartbeat, leave, selección de personaje, timeout de presencia — y expone `toSnapshot()`/`Match.fromSnapshot()` para serializar/reconstruir *todo* su estado interno, incluidos los tokens de los jugadores (necesario para que un token siga siendo válido después de un reinicio). `MatchRegistry` escribe cada partida a `data/matches/<roomId>.json` en cada cambio, y al construirse (o sea, al arrancar el proceso) recarga cualquier archivo no terminado — si era el turno de un bot, se reprograma su temporizador (`setTimeout` no sobrevive un reinicio). Partidas terminadas en disco se borran en vez de restaurarse. `data/` está en `.gitignore`. Validado con `npm run smoke:persistence`: levanta un servidor, juega parcialmente una partida, apaga *todo* (servidor HTTP + `MatchRegistry`), levanta uno nuevo desde cero contra el mismo directorio, y confirma que la partida sigue con el mismo terreno/estado de jugadores y es jugable (no solo legible).

**Pendiente / rough edges:** no hay animación de vuelo del proyectil en el cliente online todavía — el disparo se resuelve de una vez en el servidor y el cliente solo ve el resultado en el siguiente *poll* (~700ms). `PawfareRoom`/Colyseus queda sin cliente propio por ahora — decidir si vale la pena mantenerlo (útil si algún día hay cliente web) o retirarlo para no duplicar la orquestación de sala. La persistencia es a archivos JSON en disco local, no a una base de datos real — suficiente para sobrevivir un reinicio del proceso en esta etapa, pero no pensada para múltiples instancias del servidor en paralelo (eso sí necesitaría Postgres/Redis compartido).

import "../polyfillMetadata";
import http from "http";
import express from "express";
import cors from "cors";
import { MatchRegistry } from "../match/MatchRegistry";
import { createApiRouter } from "../routes/api";
import { DISCONNECT_TIMEOUT_MS } from "../sim/Constants";

const PORT = 22780;
const BASE = `http://localhost:${PORT}/api`;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

async function get(path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, json: await res.json() };
}

async function run2PlayerCase() {
  const j1 = await post("/quickmatch", { playerCount: 2, biomeId: "backyard" });
  assert(j1.status === 200, "2p: quickmatch debe responder 200");
  const roomId = j1.json.roomId;

  const j2 = await post("/quickmatch", { playerCount: 2, biomeId: "backyard" });
  assert(j2.json.roomId === roomId, "2p: el segundo jugador debe caer en la misma sala");
  assert(j2.json.state.phase === "playing", "2p: la partida debe iniciar al llenarse el cupo");

  const shooterId = j2.json.state.turnOrder[j2.json.state.currentTurnIndex];
  const shooter = shooterId === j1.json.playerId ? j1.json : j2.json;

  const before = await get(`/rooms/${roomId}/state`);
  const heightsBefore = before.json.terrainHeights;

  const fireRes = await post(`/rooms/${roomId}/fire`, {
    playerId: shooter.playerId,
    token: shooter.token,
    dx: 50,
    dy: -20,
  });
  assert(fireRes.status === 200, "2p: el disparo debe aceptarse");
  await sleep(50);

  const after = await get(`/rooms/${roomId}/state`);
  const changed = heightsBefore.some((h: number, i: number) => Math.abs(h - after.json.terrainHeights[i]) > 0.001);
  assert(changed, "2p: el terreno debe cambiar tras un disparo válido");

  const notOnTurnId = after.json.turnOrder[after.json.currentTurnIndex] === j1.json.playerId
    ? j2.json.playerId
    : j1.json.playerId;
  const notOnTurn = notOnTurnId === j1.json.playerId ? j1.json : j2.json;

  await post(`/rooms/${roomId}/fire`, {
    playerId: notOnTurn.playerId,
    token: notOnTurn.token,
    dx: 50,
    dy: -20,
  });
  const stateAfterWrongTurn = await get(`/rooms/${roomId}/state`);
  assert(
    stateAfterWrongTurn.json.terrainHeights.every(
      (h: number, i: number) => h === after.json.terrainHeights[i]
    ),
    "2p: disparar fuera de turno no debe tener efecto"
  );
}

async function runBotAndReconnectCase() {
  const j1 = await post("/quickmatch", { playerCount: 2, biomeId: "backyard" });
  const j2 = await post("/quickmatch", { playerCount: 2, biomeId: "backyard" });
  const roomId = j1.json.roomId;

  const shooterId = j2.json.state.turnOrder[j2.json.state.currentTurnIndex];
  const shooter = shooterId === j1.json.playerId ? j1.json : j2.json;

  await post(`/rooms/${roomId}/leave`, { playerId: shooter.playerId, token: shooter.token });

  let state = (await get(`/rooms/${roomId}/state`)).json;
  let p = state.players.find((p: any) => p.id === shooter.playerId);
  assert(p.isBot, "bot: debe activarse el bot al salir explícitamente");
  assert(!p.connected, "bot: debe quedar marcado como desconectado");

  const turnIndexBefore = state.currentTurnIndex;
  await sleep(1400 + 800);
  state = (await get(`/rooms/${roomId}/state`)).json;
  // El bot puede elegir cualquier arma al azar (incl. Rebote, que a veces sale del mapa sin
  // explotar) — el invariante robusto es que el turno avanzó, no que el terreno cambió.
  assert(state.currentTurnIndex !== turnIndexBefore, "bot: el bot debe disparar solo y pasar el turno tras el retraso configurado");

  await post(`/rooms/${roomId}/heartbeat`, { playerId: shooter.playerId, token: shooter.token });
  state = (await get(`/rooms/${roomId}/state`)).json;
  p = state.players.find((p: any) => p.id === shooter.playerId);
  assert(!p.isBot, "reconexión: un heartbeat debe devolver el control al jugador");
  assert(p.connected, "reconexión: debe quedar marcado como conectado de nuevo");
}

async function runCharacterSelectCase() {
  const j1 = await post("/quickmatch", { playerCount: 2, biomeId: "backyard" });
  await post("/quickmatch", { playerCount: 2, biomeId: "backyard" });
  const roomId = j1.json.roomId;
  assert(j1.json.state.players[0].species !== undefined, "personaje: el estado debe traer species por defecto");

  const ok = await post(`/rooms/${roomId}/select-character`, {
    playerId: j1.json.playerId,
    token: j1.json.token,
    species: "panda",
  });
  assert(ok.status === 200, "personaje: seleccionar una especie válida debe responder 200");

  const state = await get(`/rooms/${roomId}/state`);
  const me = state.json.players.find((p: any) => p.id === j1.json.playerId);
  assert(me.species === "panda", "personaje: la especie elegida debe reflejarse en el estado");

  const bad = await post(`/rooms/${roomId}/select-character`, {
    playerId: j1.json.playerId,
    token: j1.json.token,
    species: "dragon-inexistente",
  });
  assert(bad.status === 200, "personaje: una especie inválida no debe romper la petición");
  const stateAfterBad = await get(`/rooms/${roomId}/state`);
  const meAfterBad = stateAfterBad.json.players.find((p: any) => p.id === j1.json.playerId);
  assert(meAfterBad.species === "panda", "personaje: una especie inválida no debe cambiar la especie actual");
}

function affectedIndexCount(before: number[], after: number[]): number {
  let count = 0;
  for (let i = 0; i < before.length; i++) {
    if (Math.abs(before[i] - after[i]) > 0.5) count++;
  }
  return count;
}

function affectedRunCount(before: number[], after: number[]): number {
  let runs = 0;
  let wasAffected = false;
  for (let i = 0; i < before.length; i++) {
    const affected = Math.abs(before[i] - after[i]) > 0.5;
    if (affected && !wasAffected) runs++;
    wasAffected = affected;
  }
  return runs;
}

async function fireAndMeasure(
  weaponId: string,
  pull: { dx: number; dy: number } = { dx: 50, dy: -20 }
): Promise<{ spread: number; runs: number }> {
  const j1 = await post("/quickmatch", { playerCount: 2, biomeId: "backyard" });
  const j2 = await post("/quickmatch", { playerCount: 2, biomeId: "backyard" });
  const roomId = j1.json.roomId;

  const shooterId = j2.json.state.turnOrder[j2.json.state.currentTurnIndex];
  const shooter = shooterId === j1.json.playerId ? j1.json : j2.json;
  const heightsBefore: number[] = j2.json.state.terrainHeights;

  const fireRes = await post(`/rooms/${roomId}/fire`, {
    playerId: shooter.playerId,
    token: shooter.token,
    dx: pull.dx,
    dy: pull.dy,
    weaponId,
  });
  assert(fireRes.status === 200, `armas (${weaponId}): el disparo debe aceptarse`);

  const after = await get(`/rooms/${roomId}/state`);
  return {
    spread: affectedIndexCount(heightsBefore, after.json.terrainHeights),
    runs: affectedRunCount(heightsBefore, after.json.terrainHeights),
  };
}

async function runWeaponsCase() {
  const bazooka = await fireAndMeasure("bazooka");
  assert(bazooka.spread > 0, "armas: la bazooka debe afectar el terreno");
  assert(bazooka.runs === 1, `armas: la bazooka debe dejar un único cráter (obtuve ${bazooka.runs})`);

  // El viento es aleatorio por partida y puede, en casos raros, empujar el rebote fuera del
  // mapa antes de aterrizar la segunda vez. Igual que con el racimo, reintentar absorbe esa
  // mala suerte sin dejar de validar que el rebote sí puede explotar normalmente.
  let bouncer = await fireAndMeasure("bouncer", { dx: -60, dy: -70 });
  let bouncerAttempts = 1;
  while (bouncer.spread === 0 && bouncerAttempts < 5) {
    bouncer = await fireAndMeasure("bouncer", { dx: -60, dy: -70 });
    bouncerAttempts++;
  }
  assert(bouncer.spread > 0, `armas: el rebote debe afectar el terreno al aterrizar (tras ${bouncerAttempts} intentos)`);

  // Los sub-proyectiles del racimo se dispersan al azar; ocasionalmente aterrizan tan cerca
  // que sus cráteres se fusionan en uno solo. Reintentar unas pocas veces antes de fallar
  // evita que ese caso (poco frecuente pero válido) haga fallar el test por pura mala suerte.
  let cluster = await fireAndMeasure("cluster");
  let attempts = 1;
  while (cluster.runs <= 1 && attempts < 5) {
    cluster = await fireAndMeasure("cluster");
    attempts++;
  }
  assert(cluster.spread > 0, "armas: el racimo debe afectar el terreno");
  assert(
    cluster.runs > 1,
    `armas: el racimo debe dejar más de un cráter separado al esparcir sub-proyectiles (obtuve ${cluster.runs} tras ${attempts} intentos)`
  );

  // El perforador vuela casi recto y perfora terreno en vez de explotar al primer contacto —
  // el invariante es que deja una franja de terreno afectada notablemente más ancha que un
  // impacto único de bazooka, no solo un cráter puntual.
  let piercer = await fireAndMeasure("piercer", { dx: -80, dy: -30 });
  let piercerAttempts = 1;
  while (piercer.spread === 0 && piercerAttempts < 5) {
    piercer = await fireAndMeasure("piercer", { dx: -80, dy: -30 });
    piercerAttempts++;
  }
  assert(piercer.spread > 0, `armas: el perforador debe afectar el terreno (tras ${piercerAttempts} intentos)`);
  assert(
    piercer.spread > bazooka.spread,
    `armas: el perforador debe dejar una franja más ancha que la bazooka (perforador=${piercer.spread}, bazooka=${bazooka.spread})`
  );

  const fallback = await fireAndMeasure("arma-inexistente");
  assert(fallback.spread > 0, "armas: un weaponId inválido debe caer al arma por defecto, no romper el disparo");
}

async function runTimeoutPresenceCase() {
  const j1 = await post("/quickmatch", { playerCount: 2, biomeId: "backyard" });
  const j2 = await post("/quickmatch", { playerCount: 2, biomeId: "backyard" });
  const roomId = j1.json.roomId;

  const state = (await get(`/rooms/${roomId}/state`)).json;
  const shooterId = state.turnOrder[state.currentTurnIndex];
  const idle = shooterId === j1.json.playerId ? j1.json : j2.json;

  // No hace heartbeat ni dispara: debe pasar a bot por inactividad tras DISCONNECT_TIMEOUT_MS.
  await sleep(DISCONNECT_TIMEOUT_MS + 3500);
  const after = (await get(`/rooms/${roomId}/state`)).json;
  const p = after.players.find((p: any) => p.id === idle.playerId);
  assert(p.isBot, "presencia: debe activarse el bot tras superar el tiempo de inactividad");
}

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  const registry = new MatchRegistry();
  app.use("/api", createApiRouter(registry));
  const presenceLoop = registry.startPresenceLoop();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  try {
    await run2PlayerCase();
    console.error("[smoke-api] caso 2 jugadores OK");

    await runBotAndReconnectCase();
    console.error("[smoke-api] caso bot/reconexión OK");

    await runCharacterSelectCase();
    console.error("[smoke-api] caso selección de personaje OK");

    await runWeaponsCase();
    console.error("[smoke-api] caso armas (bazooka/rebote/racimo) OK");

    await runTimeoutPresenceCase();
    console.error("[smoke-api] caso timeout de presencia OK");

    console.log("smoke test API OK — quickmatch, disparo, bot de respaldo y presencia funcionan");
    process.exit(0);
  } finally {
    clearInterval(presenceLoop);
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

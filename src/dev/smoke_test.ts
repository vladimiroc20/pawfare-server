import "../polyfillMetadata";
import http from "http";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Client } from "@colyseus/sdk";
import { PawfareRoom } from "../rooms/PawfareRoom";
import { BOT_THINK_DELAY_MS } from "../sim/Constants";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let nextPort = 22670;

async function withServer(fn: (makeClient: () => InstanceType<typeof Client>) => Promise<void>) {
  const port = nextPort++;
  const httpServer = http.createServer();
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
  gameServer.define("pawfare", PawfareRoom);
  await gameServer.listen(port);

  const makeClient = () => new Client(`ws://localhost:${port}`);

  try {
    await fn(makeClient);
  } finally {
    await gameServer.gracefullyShutdown(false).catch(() => {});
    httpServer.close();
  }
}

async function run2PlayerCase(makeClient: () => InstanceType<typeof Client>) {
  const client1 = makeClient();
  const client2 = makeClient();

  const room1 = await client1.joinOrCreate("pawfare", { playerCount: 2, biomeId: "backyard" });
  const room2 = await client2.joinOrCreate("pawfare", { playerCount: 2, biomeId: "backyard" });
  await sleep(150);

  assert(room1.state.phase === "playing", "2p: la partida debe iniciar al llenarse el cupo");
  assert(room1.state.players.size === 2, "2p: deben existir 2 jugadores");

  const shooterId = room1.state.turnOrder[room1.state.currentTurnIndex];
  const shooterRoom = room1.sessionId === shooterId ? room1 : room2;
  const heightsBefore = [...room1.state.terrainHeights];

  shooterRoom.send("aim_fire", { dx: 50, dy: -20 });
  await sleep(250);

  const heightsAfter = room1.state.terrainHeights;
  const terrainChanged = heightsBefore.some((h, i) => Math.abs(h - heightsAfter[i]) > 0.001);
  assert(terrainChanged, "2p: el terreno debe cambiar tras un disparo válido");
}

async function run4PlayerTeamCase(makeClient: () => InstanceType<typeof Client>) {
  const rooms = [];
  for (let i = 0; i < 4; i++) {
    rooms.push(await makeClient().joinOrCreate("pawfare", { playerCount: 4, teamMode: true, biomeId: "backyard" }));
  }
  await sleep(150);

  const room = rooms[0];
  assert(room.state.teamMode, "4p equipos: teamMode debe quedar activo");
  const teams = room.state.turnOrder.map((id: string) => room.state.players.get(id).team);
  assert(
    JSON.stringify(teams) === JSON.stringify([0, 1, 0, 1]),
    `4p equipos: los equipos deben alternar A/B por orden de entrada (obtuve ${JSON.stringify(teams)})`
  );
}

async function runBotTakeoverCase(makeClient: () => InstanceType<typeof Client>) {
  const room1 = await makeClient().joinOrCreate("pawfare", { playerCount: 2, biomeId: "backyard" });
  const room2 = await makeClient().joinOrCreate("pawfare", { playerCount: 2, biomeId: "backyard" });
  await sleep(150);

  const shooterId = room1.state.turnOrder[room1.state.currentTurnIndex];
  const shooterRoom = room1.sessionId === shooterId ? room1 : room2;
  const otherRoom = shooterRoom === room1 ? room2 : room1;

  await shooterRoom.leave(false);
  await sleep(150);

  const shooter = otherRoom.state.players.get(shooterId);
  assert(shooter.isBot, "bot: el jugador desconectado debe quedar controlado por bot");
  assert(!shooter.connected, "bot: el jugador debe quedar marcado como desconectado");

  const heightsBefore = [...otherRoom.state.terrainHeights];
  await sleep(BOT_THINK_DELAY_MS + 700);

  const heightsAfter = otherRoom.state.terrainHeights;
  const terrainChanged = heightsBefore.some((h, i) => Math.abs(h - heightsAfter[i]) > 0.001);
  assert(terrainChanged, "bot: el bot debe disparar solo y afectar el terreno");
}

async function runReconnectionCase(makeClient: () => InstanceType<typeof Client>) {
  const room1 = await makeClient().joinOrCreate("pawfare", { playerCount: 2, biomeId: "backyard" });
  const room2 = await makeClient().joinOrCreate("pawfare", { playerCount: 2, biomeId: "backyard" });
  await sleep(150);

  const leavingSessionId = room1.sessionId;
  const token = room1.reconnectionToken;

  await room1.leave(false);
  await sleep(150);

  let player = room2.state.players.get(leavingSessionId);
  assert(player.isBot, "reconexión: debe activarse el bot al desconectar");

  const reconnectedRoom = await makeClient().reconnect(token);
  await sleep(150);

  player = room2.state.players.get(leavingSessionId);
  assert(!player.isBot, "reconexión: el jugador debe recuperar el control al reconectarse");
  assert(player.connected, "reconexión: el jugador debe quedar marcado como conectado");
  assert(reconnectedRoom.sessionId === leavingSessionId, "reconexión: debe conservar el mismo sessionId");
}

async function main() {
  await withServer(run2PlayerCase);
  console.error("[smoke] caso 2 jugadores OK");

  await withServer(run4PlayerTeamCase);
  console.error("[smoke] caso equipos 2v2 OK");

  await withServer(runBotTakeoverCase);
  console.error("[smoke] caso bot de respaldo OK");

  await withServer(runReconnectionCase);
  console.error("[smoke] caso reconexión OK");

  console.log("smoke test OK — join/turnos, equipos, bot de respaldo y reconexión funcionan");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import "../polyfillMetadata";
import fs from "fs";
import path from "path";
import http from "http";
import express from "express";
import cors from "cors";
import { MatchRegistry } from "../match/MatchRegistry";
import { createApiRouter } from "../routes/api";

const PORT = 22790;
const BASE = `http://localhost:${PORT}/api`;
const DATA_DIR = path.join(process.cwd(), "data", "matches");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
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

async function startServer(): Promise<http.Server> {
  const app = express();
  app.use(cors());
  app.use(express.json());
  const registry = new MatchRegistry();
  app.use("/api", createApiRouter(registry));
  const httpServer = http.createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(PORT, resolve));
  return httpServer;
}

async function stopServer(httpServer: http.Server): Promise<void> {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
}

async function main() {
  // Limpieza por si quedó algo de una corrida anterior interrumpida.
  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  let server = await startServer();

  const j1 = await post("/quickmatch", { playerCount: 2, biomeId: "backyard" });
  const j2 = await post("/quickmatch", { playerCount: 2, biomeId: "backyard" });
  const roomId = j1.json.roomId;
  assert(j2.json.state.phase === "playing", "persistencia: la partida debe arrancar antes del reinicio");

  const shooterId = j2.json.state.turnOrder[j2.json.state.currentTurnIndex];
  const shooter = shooterId === j1.json.playerId ? j1.json : j2.json;
  await post(`/rooms/${roomId}/fire`, { playerId: shooter.playerId, token: shooter.token, dx: 50, dy: -20 });

  const stateBefore = (await get(`/rooms/${roomId}/state`)).json;

  // Simular un reinicio real del proceso: apagar el servidor HTTP y el registro en memoria
  // por completo, y levantar uno nuevo que lea el mismo directorio de datos desde cero —
  // sin reutilizar ningún objeto del proceso "anterior".
  await stopServer(server);
  server = await startServer();

  const stateAfter = (await get(`/rooms/${roomId}/state`)).json;
  assert(stateAfter.phase === stateBefore.phase, "persistencia: la fase debe sobrevivir al reinicio");
  assert(
    stateAfter.currentTurnIndex === stateBefore.currentTurnIndex,
    "persistencia: el turno activo debe sobrevivir al reinicio"
  );
  assert(
    JSON.stringify(stateAfter.terrainHeights) === JSON.stringify(stateBefore.terrainHeights),
    "persistencia: el terreno (con el cráter ya hecho) debe sobrevivir al reinicio"
  );
  assert(
    JSON.stringify(stateAfter.players) === JSON.stringify(stateBefore.players),
    "persistencia: la salud/posición de los jugadores debe sobrevivir al reinicio"
  );

  const nextShooterId = stateAfter.turnOrder[stateAfter.currentTurnIndex];
  const nextShooter = nextShooterId === j1.json.playerId ? j1.json : j2.json;
  const fireAfterRestart = await post(`/rooms/${roomId}/fire`, {
    playerId: nextShooter.playerId,
    token: nextShooter.token,
    dx: 50,
    dy: -20,
  });
  assert(fireAfterRestart.status === 200, "persistencia: la partida debe seguir jugable después del reinicio");

  console.log("smoke test de persistencia OK — la partida sobrevive a un reinicio del proceso");
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  await stopServer(server);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

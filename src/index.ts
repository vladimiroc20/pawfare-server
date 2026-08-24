import "./polyfillMetadata";
import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { PawfareRoom } from "./rooms/PawfareRoom";
import { MatchRegistry } from "./match/MatchRegistry";
import { createApiRouter } from "./routes/api";

const app = express();
app.use(cors());
app.use(express.json());

const matchRegistry = new MatchRegistry();
app.use("/api", createApiRouter(matchRegistry));
matchRegistry.startPresenceLoop();

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("pawfare", PawfareRoom);

const port = Number(process.env.PORT) || 2567;
gameServer.listen(port);

console.log(`Pawfare server escuchando en :${port}`);
console.log(`API REST (cliente Godot) en http://localhost:${port}/api`);

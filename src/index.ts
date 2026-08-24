import "./polyfillMetadata";
import http from "http";
import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { PawfareRoom } from "./rooms/PawfareRoom";

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("pawfare", PawfareRoom);

const port = Number(process.env.PORT) || 2567;
gameServer.listen(port);

console.log(`Pawfare server escuchando en :${port}`);

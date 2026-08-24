import { Router } from "express";
import { MatchRegistry } from "../match/MatchRegistry";

export function createApiRouter(registry: MatchRegistry): Router {
  const router = Router();

  router.post("/quickmatch", (req, res) => {
    try {
      const { playerCount, teamMode, biomeId } = req.body ?? {};
      const match = registry.findOrCreate({ playerCount, teamMode, biomeId });
      const { playerId, token } = match.join();
      res.json({ roomId: match.roomId, playerId, token, state: match.toJSON() });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.get("/rooms/:roomId/state", (req, res) => {
    const match = registry.get(req.params.roomId);
    if (!match) {
      res.status(404).json({ error: "Sala no encontrada" });
      return;
    }
    res.json(match.toJSON());
  });

  router.post("/rooms/:roomId/fire", (req, res) => {
    const match = registry.get(req.params.roomId);
    if (!match) {
      res.status(404).json({ error: "Sala no encontrada" });
      return;
    }
    try {
      const { playerId, token, dx, dy, weaponId } = req.body ?? {};
      match.fire(playerId, token, Number(dx) || 0, Number(dy) || 0, weaponId ? String(weaponId) : undefined);
      res.json({ state: match.toJSON() });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post("/rooms/:roomId/select-character", (req, res) => {
    const match = registry.get(req.params.roomId);
    if (!match) {
      res.status(404).json({ error: "Sala no encontrada" });
      return;
    }
    try {
      const { playerId, token, species } = req.body ?? {};
      match.selectCharacter(playerId, token, String(species ?? ""));
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post("/rooms/:roomId/heartbeat", (req, res) => {
    const match = registry.get(req.params.roomId);
    if (!match) {
      res.status(404).json({ error: "Sala no encontrada" });
      return;
    }
    try {
      const { playerId, token } = req.body ?? {};
      match.heartbeat(playerId, token);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post("/rooms/:roomId/leave", (req, res) => {
    const match = registry.get(req.params.roomId);
    if (!match) {
      res.status(404).json({ error: "Sala no encontrada" });
      return;
    }
    try {
      const { playerId, token } = req.body ?? {};
      match.leave(playerId, token);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  return router;
}

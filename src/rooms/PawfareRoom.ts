import { Client, Delayed, Room } from "colyseus";
import { PawfareState, PlayerState, RockState } from "../schema/PawfareState";
import { BiomeSim, getBiome, randomBiome } from "../sim/Biomes";
import {
  BOT_THINK_DELAY_MS,
  EXPLOSION_RADIUS,
  MAX_PLAYERS,
  MAX_PULL,
  MIN_PLAYERS,
  POWER_SCALE,
  RECONNECTION_WINDOW_SECONDS,
  TERRAIN_RES,
} from "../sim/Constants";
import { damageObstacle, ObstacleLike, resolveKnockback, simulateProjectile } from "../sim/Combat";
import { buildRanking, isMatchOver, RankablePlayer } from "../sim/Ranking";
import { spawnObstacles, spawnPlayers, SpawnedPlayer } from "../sim/Spawner";
import { carveCrater, generateHeights } from "../sim/Terrain";

export interface PawfareRoomOptions {
  playerCount?: number;
  teamMode?: boolean;
  biomeId?: string;
}

export class PawfareRoom extends Room<{ state: PawfareState }> {
  private playerCountTarget = 2;
  private biome: BiomeSim = getBiome("backyard");
  private heights: number[] = [];
  private obstaclesSim: ObstacleLike[] = [];
  private spawnSlots: SpawnedPlayer[] = [];
  private eliminationOrder: string[] = [];
  private botTimer?: Delayed;

  onCreate(options: PawfareRoomOptions) {
    this.state = new PawfareState();

    this.playerCountTarget = clamp(options.playerCount ?? 2, MIN_PLAYERS, MAX_PLAYERS);
    this.maxClients = this.playerCountTarget;
    this.state.teamMode = !!options.teamMode && this.playerCountTarget === 4;

    this.biome = options.biomeId ? getBiome(options.biomeId) : randomBiome();
    this.state.biomeId = this.biome.id;

    this.heights = generateHeights();
    this.state.terrainHeights.push(...this.heights);

    const rocks = spawnObstacles(this.biome, this.heights);
    this.obstaclesSim = rocks;
    for (const r of rocks) {
      const rock = new RockState();
      rock.x = r.x;
      rock.y = r.y;
      rock.radius = r.radius;
      rock.health = r.health;
      rock.maxHealth = r.maxHealth;
      this.state.obstacles.push(rock);
    }

    this.spawnSlots = spawnPlayers(this.playerCountTarget, this.state.teamMode, this.heights);

    this.onMessage("aim_fire", (client, message) => this.handleFire(client, message));
  }

  onJoin(client: Client) {
    if (this.state.phase !== "waiting") {
      throw new Error("La partida ya comenzó");
    }

    const index = this.state.turnOrder.length;
    const spawn = this.spawnSlots[index];

    const player = new PlayerState();
    player.slot = `p${index + 1}`;
    player.label = spawn.label;
    player.species = spawn.species;
    player.color = spawn.color;
    player.dir = spawn.dir;
    player.x = spawn.x;
    player.y = spawn.y;
    player.health = 100;
    player.team = spawn.team;
    player.isBot = false;
    player.connected = true;

    this.state.players.set(client.sessionId, player);
    this.state.turnOrder.push(client.sessionId);

    if (this.state.turnOrder.length === this.playerCountTarget) {
      this.startMatch();
    }
  }

  async onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (this.state.phase === "waiting") {
      this.state.players.delete(client.sessionId);
      const idx = this.state.turnOrder.indexOf(client.sessionId);
      if (idx !== -1) this.state.turnOrder.splice(idx, 1);
      return;
    }

    player.connected = false;
    player.isBot = true;
    this.maybeScheduleBotTurn();

    try {
      await this.allowReconnection(client, RECONNECTION_WINDOW_SECONDS);
      player.connected = true;
      player.isBot = false;
    } catch (e) {
      // Ventana de reconexión expiró: el bot se queda en control por el resto de la partida.
    }
  }

  private startMatch() {
    this.state.phase = "playing";
    this.state.currentTurnIndex = 0;
    this.rollWind();
    this.maybeScheduleBotTurn();
  }

  private rollWind() {
    this.state.wind = (Math.random() * 2 - 1) * 1.6 * this.biome.windScale;
  }

  private currentSessionId(): string {
    return this.state.turnOrder[this.state.currentTurnIndex];
  }

  private handleFire(client: Client, message: { dx?: number; dy?: number }) {
    if (this.state.phase !== "playing" || this.state.gameOver) return;
    if (this.currentSessionId() !== client.sessionId) return;

    const player = this.state.players.get(client.sessionId);
    if (!player || player.isBot || player.health <= 0) return;

    const dx = Number(message?.dx) || 0;
    const dy = Number(message?.dy) || 0;
    this.executeShot(client.sessionId, dx, dy);
  }

  private maybeScheduleBotTurn() {
    if (this.state.phase !== "playing" || this.state.gameOver) return;
    const player = this.state.players.get(this.currentSessionId());
    if (!player || !player.isBot || player.health <= 0) return;
    if (this.botTimer) return;

    this.botTimer = this.clock.setTimeout(() => {
      this.botTimer = undefined;
      this.performBotTurn();
    }, BOT_THINK_DELAY_MS);
  }

  private performBotTurn() {
    const sessionId = this.currentSessionId();
    const shooter = this.state.players.get(sessionId);
    if (!shooter || this.state.gameOver) return;

    const opponents = [...this.state.players.entries()].filter(
      ([id, p]) => id !== sessionId && p.health > 0 && (!this.state.teamMode || p.team !== shooter.team)
    );
    const target = opponents.length > 0
      ? opponents[Math.floor(Math.random() * opponents.length)][1]
      : shooter;

    const towardTarget = target.x >= shooter.x ? 1 : -1;
    const pullX = -towardTarget * (MAX_PULL * (0.55 + Math.random() * 0.35));
    const pullY = -(MAX_PULL * (0.25 + Math.random() * 0.35));

    this.executeShot(sessionId, pullX, pullY);
  }

  private executeShot(sessionId: string, pullDx: number, pullDy: number) {
    const shooter = this.state.players.get(sessionId);
    if (!shooter) return;

    let dx = pullDx;
    let dy = pullDy;
    const len = Math.hypot(dx, dy);
    if (len > MAX_PULL) {
      dx = (dx / len) * MAX_PULL;
      dy = (dy / len) * MAX_PULL;
    }
    if (len < 12) return; // tiro inválido: ignorar sin consumir el turno

    const anchorX = shooter.x;
    const anchorY = shooter.y - 14;
    const vx = -dx * POWER_SCALE;
    const vy = -dy * POWER_SCALE;

    const otherAnchors = [...this.state.players.entries()]
      .filter(([id, p]) => id !== sessionId && p.health > 0)
      .map(([, p]) => ({ x: p.x, y: p.y - 14 }));

    const hit = simulateProjectile(
      anchorX,
      anchorY,
      vx,
      vy,
      this.state.wind,
      this.heights,
      this.obstaclesSim,
      otherAnchors
    );

    if (hit.outOfBounds) {
      this.advanceTurn();
      return;
    }

    if (hit.hitObstacleIndex !== -1) {
      const rock = this.obstaclesSim[hit.hitObstacleIndex];
      const destroyed = damageObstacle(rock);
      this.state.obstacles[hit.hitObstacleIndex].health = rock.health;
      if (destroyed) {
        this.obstaclesSim.splice(hit.hitObstacleIndex, 1);
        this.state.obstacles.splice(hit.hitObstacleIndex, 1);
      }
    }

    carveCrater(this.heights, hit.x, hit.y, EXPLOSION_RADIUS);
    const idx0 = Math.max(0, Math.floor((hit.x - EXPLOSION_RADIUS) / TERRAIN_RES));
    const idx1 = Math.min(this.heights.length - 1, Math.ceil((hit.x + EXPLOSION_RADIUS) / TERRAIN_RES));
    for (let i = idx0; i <= idx1; i++) {
      this.state.terrainHeights[i] = this.heights[i];
    }

    for (const [id, p] of this.state.players.entries()) {
      const result = resolveKnockback(p, this.heights, hit.x, hit.y);
      if (!result) continue;
      const wasAlive = p.health > 0;
      p.health = Math.max(0, p.health - result.damage);
      p.x = result.finalX;
      p.y = result.finalY;
      if (wasAlive && p.health <= 0) {
        this.eliminationOrder.push(id);
      }
    }

    this.checkMatchOverOrAdvance();
  }

  private checkMatchOverOrAdvance() {
    const rankable: RankablePlayer[] = [...this.state.players.entries()].map(([id, p]) => ({
      id,
      team: p.team,
      health: p.health,
    }));

    if (isMatchOver(rankable, this.state.teamMode)) {
      this.state.gameOver = true;
      this.state.phase = "ended";
      const ranking = buildRanking(rankable, this.eliminationOrder, this.state.teamMode);
      this.broadcast("matchEnded", { ranking });
      return;
    }

    this.advanceTurn();
  }

  private advanceTurn() {
    const n = this.state.turnOrder.length;
    for (let i = 0; i < n; i++) {
      this.state.currentTurnIndex = (this.state.currentTurnIndex + 1) % n;
      const p = this.state.players.get(this.currentSessionId());
      if (p && p.health > 0) break;
    }
    this.rollWind();
    this.maybeScheduleBotTurn();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

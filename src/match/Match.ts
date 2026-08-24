import { randomUUID } from "crypto";
import { BiomeSim, getBiome, randomBiome } from "../sim/Biomes";
import {
  AVAILABLE_SPECIES,
  DISCONNECT_TIMEOUT_MS,
  MAX_PLAYERS,
  MAX_PULL,
  MIN_PLAYERS,
  POWER_SCALE,
} from "../sim/Constants";
import {
  damageObstacle,
  ObstacleLike,
  resolveKnockback,
  settleOnGround,
  simulatePiercer,
  simulateProjectile,
} from "../sim/Combat";
import { buildRanking, isMatchOver, RankablePlayer, RankEntry } from "../sim/Ranking";
import { spawnObstacles, spawnPlayers, SpawnedPlayer, SpawnedRock } from "../sim/Spawner";
import { carveCrater, generateHeights } from "../sim/Terrain";
import { DEFAULT_WEAPON_ID, getWeapon, WeaponDef } from "../sim/Weapons";

export interface MatchOptions {
  playerCount?: number;
  teamMode?: boolean;
  biomeId?: string;
}

export interface MatchPlayer {
  id: string;
  token: string;
  label: string;
  species: string;
  color: string;
  dir: number;
  x: number;
  y: number;
  health: number;
  team: number;
  isBot: boolean;
  connected: boolean;
  lastSeenAt: number;
}

export interface PublicPlayer {
  id: string;
  label: string;
  species: string;
  color: string;
  dir: number;
  x: number;
  y: number;
  health: number;
  team: number;
  isBot: boolean;
  connected: boolean;
}

export interface LastShot {
  seq: number;
  shooterId: string;
  weaponId: string;
  dx: number;
  dy: number;
  wind: number;
}

export interface MatchStateJSON {
  roomId: string;
  phase: "waiting" | "playing" | "ended";
  biomeId: string;
  wind: number;
  teamMode: boolean;
  playerCount: number;
  gameOver: boolean;
  currentTurnIndex: number;
  turnOrder: string[];
  players: PublicPlayer[];
  obstacles: SpawnedRock[];
  terrainHeights: number[];
  ranking: RankEntry[] | null;
  shotSeq: number;
  lastShot: LastShot | null;
}

export interface MatchSnapshot {
  roomId: string;
  playerCountTarget: number;
  teamMode: boolean;
  biomeId: string;
  heights: number[];
  obstacles: (SpawnedRock & ObstacleLike)[];
  spawnSlots: SpawnedPlayer[];
  players: MatchPlayer[];
  turnOrder: string[];
  currentTurnIndex: number;
  wind: number;
  phase: "waiting" | "playing" | "ended";
  eliminationOrder: string[];
  ranking: RankEntry[] | null;
  shotSeq: number;
  lastShot: LastShot | null;
}

export class Match {
  readonly roomId: string;
  private playerCountTarget: number;
  private teamMode: boolean;
  private biome: BiomeSim;

  private heights: number[];
  private obstacles: (SpawnedRock & ObstacleLike)[];
  private spawnSlots: SpawnedPlayer[];
  private players: MatchPlayer[] = [];
  private turnOrder: string[] = [];
  private currentTurnIndex = 0;
  private wind = 0;
  private phase: "waiting" | "playing" | "ended" = "waiting";
  private eliminationOrder: string[] = [];
  private ranking: RankEntry[] | null = null;
  private botTimer: NodeJS.Timeout | null = null;
  private onChange?: () => void;
  private shotSeq = 0;
  private lastShot: LastShot | null = null;

  constructor(roomId: string, options: MatchOptions, onChange?: () => void) {
    this.roomId = roomId;
    this.onChange = onChange;
    this.playerCountTarget = clamp(options.playerCount ?? 2, MIN_PLAYERS, MAX_PLAYERS);
    this.teamMode = !!options.teamMode && this.playerCountTarget === 4;
    this.biome = options.biomeId ? getBiome(options.biomeId) : randomBiome();

    this.heights = generateHeights();
    this.obstacles = spawnObstacles(this.biome, this.heights).map((r) => ({ ...r }));
    this.spawnSlots = spawnPlayers(this.playerCountTarget, this.teamMode, this.heights);
  }

  static fromSnapshot(snapshot: MatchSnapshot, onChange?: () => void): Match {
    const match = new Match(
      snapshot.roomId,
      { playerCount: snapshot.playerCountTarget, teamMode: snapshot.teamMode, biomeId: snapshot.biomeId },
      onChange
    );
    match.heights = snapshot.heights;
    match.obstacles = snapshot.obstacles;
    match.spawnSlots = snapshot.spawnSlots;
    match.players = snapshot.players;
    match.turnOrder = snapshot.turnOrder;
    match.currentTurnIndex = snapshot.currentTurnIndex;
    match.wind = snapshot.wind;
    match.phase = snapshot.phase;
    match.eliminationOrder = snapshot.eliminationOrder;
    match.ranking = snapshot.ranking;
    match.shotSeq = snapshot.shotSeq ?? 0;
    match.lastShot = snapshot.lastShot ?? null;
    match.maybeScheduleBotTurn();
    return match;
  }

  toSnapshot(): MatchSnapshot {
    return {
      roomId: this.roomId,
      playerCountTarget: this.playerCountTarget,
      teamMode: this.teamMode,
      biomeId: this.biome.id,
      heights: this.heights,
      obstacles: this.obstacles,
      spawnSlots: this.spawnSlots,
      players: this.players,
      turnOrder: this.turnOrder,
      currentTurnIndex: this.currentTurnIndex,
      wind: this.wind,
      phase: this.phase,
      eliminationOrder: this.eliminationOrder,
      ranking: this.ranking,
      shotSeq: this.shotSeq,
      lastShot: this.lastShot,
    };
  }

  get isJoinable(): boolean {
    return this.phase === "waiting" && this.players.length < this.playerCountTarget;
  }

  get isDisposable(): boolean {
    return this.phase === "ended" || this.players.every((p) => !p.connected);
  }

  join(): { playerId: string; token: string } {
    if (!this.isJoinable) {
      throw new Error("La sala no admite más jugadores");
    }

    const index = this.players.length;
    const spawn = this.spawnSlots[index];
    const token = randomUUID();

    const player: MatchPlayer = {
      id: `p${index + 1}`,
      token,
      label: spawn.label,
      species: spawn.species,
      color: spawn.color,
      dir: spawn.dir,
      x: spawn.x,
      y: spawn.y,
      health: 100,
      team: spawn.team,
      isBot: false,
      connected: true,
      lastSeenAt: Date.now(),
    };

    this.players.push(player);
    this.turnOrder.push(player.id);

    if (this.players.length === this.playerCountTarget) {
      this.phase = "playing";
      this.rollWind();
      this.maybeScheduleBotTurn();
    }

    this.onChange?.();
    return { playerId: player.id, token };
  }

  selectCharacter(playerId: string, token: string, species: string): void {
    const player = this.authenticate(playerId, token);
    if (!AVAILABLE_SPECIES.includes(species)) return;
    player.species = species;
    this.onChange?.();
  }

  heartbeat(playerId: string, token: string): void {
    const player = this.authenticate(playerId, token);
    player.lastSeenAt = Date.now();
    if (!player.connected) {
      player.connected = true;
      player.isBot = false;
    }
    this.onChange?.();
  }

  leave(playerId: string, token: string): void {
    const player = this.authenticate(playerId, token);
    player.connected = false;
    player.isBot = true;
    this.maybeScheduleBotTurn();
    this.onChange?.();
  }

  fire(playerId: string, token: string, dx: number, dy: number, weaponId?: string): void {
    const player = this.authenticate(playerId, token);
    if (this.phase !== "playing") return;
    if (this.turnOrder[this.currentTurnIndex] !== playerId) return;
    if (player.isBot || player.health <= 0) return;
    player.lastSeenAt = Date.now();
    this.executeShot(player, dx, dy, getWeapon(weaponId ?? DEFAULT_WEAPON_ID));
  }

  checkPresence(): void {
    if (this.phase !== "playing") return;
    const currentId = this.turnOrder[this.currentTurnIndex];
    const current = this.players.find((p) => p.id === currentId);
    if (!current || current.isBot || !current.connected) return;
    if (Date.now() - current.lastSeenAt > DISCONNECT_TIMEOUT_MS) {
      current.connected = false;
      current.isBot = true;
      this.maybeScheduleBotTurn();
      this.onChange?.();
    }
  }

  toJSON(): MatchStateJSON {
    return {
      roomId: this.roomId,
      phase: this.phase,
      biomeId: this.biome.id,
      wind: this.wind,
      teamMode: this.teamMode,
      playerCount: this.playerCountTarget,
      gameOver: this.phase === "ended",
      currentTurnIndex: this.currentTurnIndex,
      turnOrder: [...this.turnOrder],
      players: this.players.map(publicPlayer),
      obstacles: this.obstacles.map((o) => ({ ...o })),
      terrainHeights: [...this.heights],
      ranking: this.ranking,
      shotSeq: this.shotSeq,
      lastShot: this.lastShot,
    };
  }

  private authenticate(playerId: string, token: string): MatchPlayer {
    const player = this.players.find((p) => p.id === playerId);
    if (!player || player.token !== token) {
      throw new Error("Jugador o token inválido");
    }
    return player;
  }

  private rollWind(): void {
    this.wind = (Math.random() * 2 - 1) * 1.6 * this.biome.windScale;
  }

  private maybeScheduleBotTurn(): void {
    if (this.phase !== "playing") return;
    const current = this.players.find((p) => p.id === this.turnOrder[this.currentTurnIndex]);
    if (!current || !current.isBot || current.health <= 0) return;
    if (this.botTimer) return;

    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      this.performBotTurn();
    }, 1400);
  }

  private performBotTurn(): void {
    const shooter = this.players.find((p) => p.id === this.turnOrder[this.currentTurnIndex]);
    if (!shooter || this.phase !== "playing") return;

    const opponents = this.players.filter(
      (p) => p.id !== shooter.id && p.health > 0 && (!this.teamMode || p.team !== shooter.team)
    );
    const target = opponents.length > 0 ? opponents[Math.floor(Math.random() * opponents.length)] : shooter;

    const towardTarget = target.x >= shooter.x ? 1 : -1;
    const pullX = -towardTarget * (MAX_PULL * (0.55 + Math.random() * 0.35));
    const pullY = -(MAX_PULL * (0.25 + Math.random() * 0.35));
    const weaponRoll = Math.random();
    const weaponId =
      weaponRoll < 0.25 ? "cluster" : weaponRoll < 0.5 ? "bouncer" : weaponRoll < 0.7 ? "piercer" : "bazooka";

    this.executeShot(shooter, pullX, pullY, getWeapon(weaponId));
  }

  private executeShot(shooter: MatchPlayer, pullDx: number, pullDy: number, weapon: WeaponDef): void {
    let dx = pullDx;
    let dy = pullDy;
    const len = Math.hypot(dx, dy);
    if (len > MAX_PULL) {
      dx = (dx / len) * MAX_PULL;
      dy = (dy / len) * MAX_PULL;
    }
    if (len < 12) return;

    this.shotSeq++;
    this.lastShot = { seq: this.shotSeq, shooterId: shooter.id, weaponId: weapon.id, dx, dy, wind: this.wind };

    const anchorX = shooter.x;
    const anchorY = shooter.y - 14;
    const vx = -dx * POWER_SCALE;
    const vy = -dy * POWER_SCALE;

    const otherAnchors = this.players
      .filter((p) => p.id !== shooter.id && p.health > 0)
      .map((p) => ({ x: p.x, y: p.y - 14 }));

    if (weapon.tunnelTicks > 0) {
      const piercerHit = simulatePiercer(
        anchorX, anchorY, vx, vy, this.wind, this.heights, this.obstacles, otherAnchors, weapon.tunnelTicks
      );

      if (piercerHit.outOfBounds) {
        this.advanceTurn();
        return;
      }

      for (const tp of piercerHit.tunnelPoints) {
        carveCrater(this.heights, tp.x, tp.y, weapon.tunnelRadius);
      }

      if (piercerHit.hitObstacleIndex !== -1) {
        const rock = this.obstacles[piercerHit.hitObstacleIndex];
        const destroyed = damageObstacle(rock);
        if (destroyed) {
          this.obstacles.splice(piercerHit.hitObstacleIndex, 1);
        }
      }

      this.applyExplosionAt(piercerHit.x, piercerHit.y, weapon.explosionRadius, weapon.damage);
      this.checkMatchOverOrAdvance();
      return;
    }

    const hit = simulateProjectile(
      anchorX, anchorY, vx, vy, this.wind, this.heights, this.obstacles, otherAnchors, weapon.bounces
    );

    if (hit.outOfBounds) {
      this.advanceTurn();
      return;
    }

    if (hit.hitObstacleIndex !== -1) {
      const rock = this.obstacles[hit.hitObstacleIndex];
      const destroyed = damageObstacle(rock);
      if (destroyed) {
        this.obstacles.splice(hit.hitObstacleIndex, 1);
      }
    }

    this.applyExplosionAt(hit.x, hit.y, weapon.explosionRadius, weapon.damage);

    if (weapon.clusterCount > 0) {
      for (let i = 0; i < weapon.clusterCount; i++) {
        const angle = -Math.PI * (0.15 + Math.random() * 0.7);
        const speed = 2.0 + Math.random() * 2.2;
        const subVx = Math.cos(angle) * speed * (Math.random() < 0.5 ? -1 : 1);
        const subVy = Math.sin(angle) * speed;
        const subHit = simulateProjectile(
          hit.x, hit.y - 4, subVx, subVy, this.wind, this.heights, this.obstacles, otherAnchors, 0
        );
        if (subHit.hitObstacleIndex !== -1) {
          const rock = this.obstacles[subHit.hitObstacleIndex];
          const destroyed = damageObstacle(rock);
          if (destroyed) this.obstacles.splice(subHit.hitObstacleIndex, 1);
        }
        this.applyExplosionAt(subHit.x, subHit.y, weapon.clusterRadius, weapon.clusterDamage);
      }
    }

    this.checkMatchOverOrAdvance();
  }

  private applyExplosionAt(x: number, y: number, radius: number, damage: number): void {
    carveCrater(this.heights, x, y, radius);

    for (const p of this.players) {
      const result = resolveKnockback(p, this.heights, x, y, radius, damage);
      if (result) {
        const wasAlive = p.health > 0;
        p.health = Math.max(0, p.health - result.damage);
        p.x = result.finalX;
        p.y = result.finalY;
        if (wasAlive && p.health <= 0) {
          this.eliminationOrder.push(p.id);
        }
        continue;
      }

      const groundY = settleOnGround(p, this.heights);
      if (groundY !== null) {
        p.y = groundY;
      }
    }

    for (const o of this.obstacles) {
      const groundY = settleOnGround(o, this.heights);
      if (groundY !== null) {
        o.y = groundY;
      }
    }
  }

  private checkMatchOverOrAdvance(): void {
    const rankable: RankablePlayer[] = this.players.map((p) => ({ id: p.id, team: p.team, health: p.health }));

    if (isMatchOver(rankable, this.teamMode)) {
      this.phase = "ended";
      this.ranking = buildRanking(rankable, this.eliminationOrder, this.teamMode);
      this.onChange?.();
      return;
    }

    this.advanceTurn();
  }

  private advanceTurn(): void {
    const n = this.turnOrder.length;
    for (let i = 0; i < n; i++) {
      this.currentTurnIndex = (this.currentTurnIndex + 1) % n;
      const p = this.players.find((pl) => pl.id === this.turnOrder[this.currentTurnIndex]);
      if (p && p.health > 0) break;
    }
    this.rollWind();
    this.maybeScheduleBotTurn();
    this.onChange?.();
  }
}

function publicPlayer(p: MatchPlayer): PublicPlayer {
  const { token, lastSeenAt, ...rest } = p;
  return rest;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

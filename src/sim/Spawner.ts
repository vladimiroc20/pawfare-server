import { BiomeSim } from "./Biomes";
import {
  OBSTACLE_COUNT,
  PLAYER_COLORS,
  PLAYER_LABELS,
  PLAYER_SPECIES,
  ROCK_SIZES,
  SCREEN_W,
} from "./Constants";
import { heightAt } from "./Terrain";

export interface SpawnedPlayer {
  x: number;
  y: number;
  dir: number;
  species: string;
  color: string;
  label: string;
  team: number;
}

export function spawnPlayers(count: number, teamMode: boolean, heights: number[]): SpawnedPlayer[] {
  const teamModeActive = teamMode && count === 4;
  const margin = 90;
  const players: SpawnedPlayer[] = [];

  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0;
    const x = margin + (SCREEN_W - margin * 2) * t;
    players.push({
      x,
      y: heightAt(heights, x),
      dir: x < SCREEN_W * 0.5 ? 1 : -1,
      species: PLAYER_SPECIES[i % PLAYER_SPECIES.length],
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      label: PLAYER_LABELS[i % PLAYER_LABELS.length],
      team: teamModeActive ? i % 2 : -1,
    });
  }
  return players;
}

export interface SpawnedRock {
  x: number;
  y: number;
  radius: number;
  health: number;
  maxHealth: number;
}

export function spawnObstacles(biome: BiomeSim, heights: number[]): SpawnedRock[] {
  const count = Math.min(6, Math.max(1, OBSTACLE_COUNT + biome.obstacleDelta));
  const zoneStart = SCREEN_W * 0.28;
  const zoneEnd = SCREEN_W * 0.72;
  const zoneW = zoneEnd - zoneStart;
  const rocks: SpawnedRock[] = [];

  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0.5;
    const x = zoneStart + zoneW * t + (Math.random() * 34 - 17);
    const size = ROCK_SIZES[Math.floor(Math.random() * ROCK_SIZES.length)];
    const r = size.min + Math.random() * (size.max - size.min);
    rocks.push({ x, y: heightAt(heights, x), radius: r, health: size.hp, maxHealth: size.hp });
  }
  return rocks;
}

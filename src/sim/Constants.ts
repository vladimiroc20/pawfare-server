export const SCREEN_W = 800;
export const SCREEN_H = 450;

export const GRAVITY = 0.09;
export const EXPLOSION_RADIUS = 36;
export const DAMAGE_RANGE = EXPLOSION_RADIUS + 20;
export const DAMAGE = 26;
export const MAX_PULL = 95;
export const POWER_SCALE = 0.09;
export const TERRAIN_RES = 4;

export const KNOCKBACK_FORCE = 7.5;
export const KNOCK_GRAVITY = 0.5;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export const OBSTACLE_COUNT = 3;
export const ROCK_HIT_DAMAGE = 30;

export interface RockSize {
  min: number;
  max: number;
  hp: number;
}

export const ROCK_SIZES: RockSize[] = [
  { min: 12, max: 18, hp: 30 },
  { min: 19, max: 27, hp: 55 },
  { min: 28, max: 38, hp: 85 },
];

export const PLAYER_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#eab308"];
export const PLAYER_SPECIES = ["dog", "cat", "dog", "cat"];
export const PLAYER_LABELS = ["Jugador 1", "Jugador 2", "Jugador 3", "Jugador 4"];

export const MAX_TURN_SECONDS = 30;
export const BOT_THINK_DELAY_MS = 1400;
export const RECONNECTION_WINDOW_SECONDS = 60;

// API REST (pawfare-client vía HTTPRequest/polling, ver src/match/):
export const HEARTBEAT_INTERVAL_MS = 5000;
export const DISCONNECT_TIMEOUT_MS = 15000;
export const PRESENCE_CHECK_INTERVAL_MS = 3000;

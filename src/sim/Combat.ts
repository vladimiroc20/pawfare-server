import {
  GRAVITY,
  KNOCKBACK_FORCE,
  KNOCK_GRAVITY,
  ROCK_HIT_DAMAGE,
  SCREEN_H,
  SCREEN_W,
} from "./Constants";
import { heightAt, isBelowGround } from "./Terrain";

export interface ObstacleLike {
  x: number;
  y: number;
  radius: number;
  health: number;
}

export interface ProjectileHit {
  x: number;
  y: number;
  hitObstacleIndex: number; // -1 = no obstacle hit
  outOfBounds: boolean;
}

export function simulateProjectile(
  fromX: number,
  fromY: number,
  vx0: number,
  vy0: number,
  wind: number,
  heights: ArrayLike<number>,
  obstacles: ObstacleLike[],
  otherAnchors: { x: number; y: number }[],
  bounces: number = 0
): ProjectileHit {
  let x = fromX;
  let y = fromY;
  let vx = vx0;
  let vy = vy0;
  let bouncesLeft = bounces;

  for (let frame = 0; frame < 400; frame++) {
    vy += GRAVITY;
    vx += wind * 0.0035;
    x += vx;
    y += vy;

    let hitObstacleIndex = -1;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (Math.hypot(x - o.x, y - (o.y - o.radius * 0.5)) < o.radius + 6) {
        hitObstacleIndex = i;
        break;
      }
    }

    let hitPlayer = false;
    for (const a of otherAnchors) {
      if (Math.hypot(x - a.x, y - a.y) < 18) {
        hitPlayer = true;
        break;
      }
    }

    const outOfBounds = x < -20 || x > SCREEN_W + 20 || y > SCREEN_H + 40;
    const hitGround = isBelowGround(heights, x, y);

    if (hitPlayer || hitObstacleIndex !== -1) {
      return { x, y, hitObstacleIndex, outOfBounds: false };
    }
    if (hitGround) {
      if (bouncesLeft > 0) {
        bouncesLeft--;
        y = heightAt(heights, x) - 1;
        vy = -vy * 0.55;
        vx *= 0.85;
        continue;
      }
      return { x, y, hitObstacleIndex: -1, outOfBounds: false };
    }
    if (outOfBounds) {
      return { x, y, hitObstacleIndex: -1, outOfBounds: true };
    }
  }

  return { x, y, hitObstacleIndex: -1, outOfBounds: true };
}

export interface PiercerResult {
  x: number;
  y: number;
  tunnelPoints: { x: number; y: number }[];
  hitObstacleIndex: number;
  outOfBounds: boolean;
}

export function simulatePiercer(
  fromX: number,
  fromY: number,
  vx0: number,
  vy0: number,
  wind: number,
  heights: ArrayLike<number>,
  obstacles: ObstacleLike[],
  otherAnchors: { x: number; y: number }[],
  tunnelTicks: number
): PiercerResult {
  let x = fromX;
  let y = fromY;
  let vx = vx0;
  let vy = vy0;
  let tunnelTicksLeft = tunnelTicks;
  const tunnelPoints: { x: number; y: number }[] = [];

  for (let frame = 0; frame < 400; frame++) {
    vy += GRAVITY * 0.15;
    vx += wind * 0.0035;
    x += vx;
    y += vy;

    let hitObstacleIndex = -1;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (Math.hypot(x - o.x, y - (o.y - o.radius * 0.5)) < o.radius + 6) {
        hitObstacleIndex = i;
        break;
      }
    }

    let hitPlayer = false;
    for (const a of otherAnchors) {
      if (Math.hypot(x - a.x, y - a.y) < 18) {
        hitPlayer = true;
        break;
      }
    }

    const outOfBounds = x < -20 || x > SCREEN_W + 20 || y > SCREEN_H + 40;

    if (hitPlayer || hitObstacleIndex !== -1) {
      return { x, y, tunnelPoints, hitObstacleIndex, outOfBounds: false };
    }
    if (outOfBounds) {
      return { x, y, tunnelPoints, hitObstacleIndex: -1, outOfBounds: true };
    }

    if (isBelowGround(heights, x, y)) {
      if (tunnelTicksLeft > 0) {
        tunnelTicksLeft--;
        tunnelPoints.push({ x, y });
        continue;
      }
      return { x, y, tunnelPoints, hitObstacleIndex: -1, outOfBounds: false };
    }
  }

  return { x, y, tunnelPoints, hitObstacleIndex: -1, outOfBounds: true };
}

export function damageObstacle(o: ObstacleLike): boolean {
  o.health = Math.max(0, o.health - ROCK_HIT_DAMAGE);
  return o.health <= 0;
}

export interface PlayerLike {
  x: number;
  y: number;
  health: number;
}

export interface KnockbackResult {
  damage: number;
  finalX: number;
  finalY: number;
}

export function resolveKnockback(
  player: PlayerLike,
  heights: number[],
  blastX: number,
  blastY: number,
  explosionRadius: number,
  baseDamage: number
): KnockbackResult | null {
  if (player.health <= 0) return null;

  const damageRange = explosionRadius + 20;
  const anchorY = player.y - 14;
  const dx = player.x - blastX;
  const dy = anchorY - blastY;
  let d = Math.hypot(dx, dy);
  if (d === 0) d = 1;
  if (d >= damageRange) return null;

  const falloff = 1 - Math.min(d / damageRange, 1);
  const damage = baseDamage * (0.4 + 0.6 * falloff);

  const nx = dx / d;
  const ny = dy / d;
  let knockVx = nx * KNOCKBACK_FORCE * (0.5 + falloff);
  let knockVy = ny * KNOCKBACK_FORCE * (0.5 + falloff) - 2.5 * falloff;

  let x = player.x;
  let y = player.y;
  let airborne = true;
  let iterations = 0;

  while (airborne && iterations < 500) {
    knockVy += KNOCK_GRAVITY;
    x += knockVx;
    y += knockVy;
    x = Math.max(18, Math.min(SCREEN_W - 18, x));

    const groundY = heightAt(heights, x);
    if (y >= groundY) {
      y = groundY;
      if (Math.abs(knockVy) > 3) {
        knockVy *= -0.28;
        knockVx *= 0.5;
      } else {
        airborne = false;
      }
    }
    iterations++;
  }

  return { damage, finalX: x, finalY: y };
}

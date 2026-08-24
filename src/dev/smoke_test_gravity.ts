import { resolveKnockback, settleOnGround } from "../sim/Combat";
import { carveCrater, generateHeights, heightAt } from "../sim/Terrain";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function main() {
  const heights = generateHeights();

  const groundX = 300;
  const player = { x: groundX, y: heightAt(heights, groundX), health: 100 };

  // Simula lo que pasa cuando un disparo (p. ej. el túnel del Perforador) se lleva el
  // terreno bajo un jugador sin que el punto de impacto final esté lo bastante cerca
  // como para empujarlo: resolveKnockback no hace nada porque el jugador está fuera de
  // rango de daño.
  const explosionCenterX = groundX - 500;
  const farResult = resolveKnockback(player, heights, explosionCenterX, heightAt(heights, explosionCenterX), 26, 22);
  assert(farResult === null, "gravedad: una explosión lejana no debe empujar al jugador (precondición del test)");

  carveCrater(heights, groundX, player.y, 30);
  const newGroundY = heightAt(heights, groundX);
  assert(
    newGroundY > player.y + 1.0,
    "gravedad: el cráter debe dejar el terreno más abajo que el jugador (precondición del test)"
  );

  // Sin la corrección, el jugador se quedaría en su y original — flotando sobre el cráter.
  const settled = settleOnGround(player, heights);
  assert(settled !== null, "gravedad: settleOnGround debe detectar que el jugador quedó flotando");
  assert(
    Math.abs((settled as number) - newGroundY) < 0.01,
    "gravedad: settleOnGround debe bajar al jugador exactamente al nuevo nivel del suelo"
  );

  // Un jugador que ya está sobre el suelo (nada cambió debajo) no debe recibir ninguna
  // corrección — evita que la posición "tiemble" en cada explosión que no lo afecta.
  const grounded = { x: 100, y: heightAt(heights, 100), health: 100 };
  const noop = settleOnGround(grounded, heights);
  assert(noop === null, "gravedad: un jugador ya apoyado no debe recibir ninguna corrección");

  // Lo mismo debe valer para las rocas: settleOnGround no distingue el tipo de objeto,
  // solo necesita x/y/health — una roca es estructuralmente compatible.
  const rockX = 450;
  const rock = { x: rockX, y: heightAt(heights, rockX), radius: 20, health: 60, maxHealth: 60 };
  carveCrater(heights, rockX, rock.y, 30);
  const newRockGroundY = heightAt(heights, rockX);
  assert(
    newRockGroundY > rock.y + 1.0,
    "gravedad: el cráter también debe dejar el terreno más abajo que la roca (precondición del test)"
  );
  const rockSettled = settleOnGround(rock, heights);
  assert(rockSettled !== null, "gravedad: settleOnGround debe detectar que la roca quedó flotando");
  assert(
    Math.abs((rockSettled as number) - newRockGroundY) < 0.01,
    "gravedad: settleOnGround debe bajar la roca exactamente al nuevo nivel del suelo"
  );

  console.log(
    "smoke test de gravedad OK — un jugador que pierde el terreno bajo sus pies cae en vez de quedar flotando"
  );
}

main();

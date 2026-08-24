# CLAUDE.md — pawfare-server

Este es el repositorio del **servidor de partida** de Pawfare (Node.js + Colyseus).

**Antes de trabajar aquí, lee el documento maestro:** `../CLAUDE.md` (visión de producto, reglas legales no negociables, mecánicas validadas en el prototipo, y plan de fases completo). Este archivo solo cubre lo específico de este repo.

## Qué vive aquí

Servidor de partidas por turnos: maneja salas, sincroniza estado (turno activo, terreno, salud), y es la **fuente de verdad** para física, daño y knockback — nunca confía en los valores que envía el cliente.

Estructura sugerida (ver sección 13 del documento maestro):

```
pawfare-server/
├── src/
│   ├── rooms/          # lógica de sala/partida
│   ├── schema/         # estado sincronizado
│   └── validation/     # anti-trampas: recalcula daño/física
└── package.json
```

## Reglas específicas de este repo

- **Principio de seguridad central (sección 5 del maestro):** el cliente solo envía la acción del jugador (ángulo/potencia del disparo). El servidor recalcula trayectoria, impacto en terreno, daño con falloff, y knockback de forma independiente — nunca usa el resultado que reporta el cliente.
- El juego es por turnos, no en tiempo real: no hay que sincronizar físicas cuadro a cuadro, solo estado discreto (turno, acción, resultado, terreno actualizado).
- Terreno: representarlo como mapa de alturas (array por columna), igual que en el cliente, para que el recálculo del servidor sea comparable 1:1 con lo que el cliente muestra.
- MVP más simple si hace falta: Firebase Realtime DB/Firestore en vez de Colyseus (sección 4.2 del maestro) — pero perdiendo control de validación anti-trampas. Usar solo como puente temprano, migrar a Colyseus antes de tener usuarios reales.
- Comandos: `npm run dev` (desarrollo), `npm run build && npm start` (producción) — pendientes de definir en `package.json` cuando exista el proyecto real.

## Estado actual

Repo recién creado, sin contenido todavía. El servidor entra en juego en la Fase 3 del plan (backend y multijugador) — ver sección 11 del documento maestro. No es prioridad hasta cerrar la Fase 2 (port a Godot local).

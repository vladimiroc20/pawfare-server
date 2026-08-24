// Espejo de pawfare-client/scripts/world/Biomes.gd — solo los campos que
// afectan la simulación (densidad de obstáculos, viento). El resto de la
// presentación (paleta, íconos) vive únicamente en el cliente, que ya
// conoce estos mismos ids.

export interface BiomeSim {
  id: string;
  obstacleDelta: number;
  windScale: number;
}

export const BIOMES: BiomeSim[] = [
  { id: "backyard", obstacleDelta: 0, windScale: 1.0 },
  { id: "beach", obstacleDelta: -1, windScale: 1.4 },
  { id: "night_forest", obstacleDelta: 1, windScale: 0.8 },
  { id: "snow", obstacleDelta: 0, windScale: 1.2 },
  { id: "urban_alley", obstacleDelta: 1, windScale: 0.6 },
];

export function getBiome(id: string): BiomeSim {
  return BIOMES.find((b) => b.id === id) ?? BIOMES[0];
}

export function randomBiome(): BiomeSim {
  return BIOMES[Math.floor(Math.random() * BIOMES.length)];
}

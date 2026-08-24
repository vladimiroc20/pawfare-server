export interface WeaponDef {
  id: string;
  name: string;
  icon: string;
  explosionRadius: number;
  damage: number;
  bounces: number;
  clusterCount: number;
  clusterRadius: number;
  clusterDamage: number;
}

export const WEAPONS: Record<string, WeaponDef> = {
  bazooka: {
    id: "bazooka",
    name: "Mini Bazooka",
    icon: "🚀",
    explosionRadius: 36,
    damage: 26,
    bounces: 0,
    clusterCount: 0,
    clusterRadius: 0,
    clusterDamage: 0,
  },
  cluster: {
    id: "cluster",
    name: "Racimo",
    icon: "💥",
    explosionRadius: 18,
    damage: 8,
    bounces: 0,
    clusterCount: 4,
    clusterRadius: 22,
    clusterDamage: 16,
  },
  bouncer: {
    id: "bouncer",
    name: "Rebote",
    icon: "🎾",
    explosionRadius: 30,
    damage: 20,
    bounces: 1,
    clusterCount: 0,
    clusterRadius: 0,
    clusterDamage: 0,
  },
};

export const DEFAULT_WEAPON_ID = "bazooka";

export function getWeapon(id: string): WeaponDef {
  return WEAPONS[id] ?? WEAPONS[DEFAULT_WEAPON_ID];
}

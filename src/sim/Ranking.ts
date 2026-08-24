export interface RankablePlayer {
  id: string;
  team: number; // -1 = sin equipo
  health: number;
}

export interface RankEntry {
  place: number;
  ids: string[];
}

export function isMatchOver(players: RankablePlayer[], teamMode: boolean): boolean {
  if (teamMode) {
    const teamAAlive = players.some((p) => p.team === 0 && p.health > 0);
    const teamBAlive = players.some((p) => p.team === 1 && p.health > 0);
    return !(teamAAlive && teamBAlive);
  }
  const alive = players.filter((p) => p.health > 0);
  return alive.length <= 1;
}

export function buildRanking(
  players: RankablePlayer[],
  eliminationOrder: string[],
  teamMode: boolean
): RankEntry[] {
  if (teamMode) return buildTeamRanking(players);
  return buildFfaRanking(players, eliminationOrder);
}

function buildFfaRanking(players: RankablePlayer[], eliminationOrder: string[]): RankEntry[] {
  const ranking: RankEntry[] = [];
  const alive = players.filter((p) => p.health > 0);
  let place = 1;
  if (alive.length === 1) {
    ranking.push({ place, ids: [alive[0].id] });
    place += 1;
  }
  const order = [...eliminationOrder].reverse();
  for (const id of order) {
    ranking.push({ place, ids: [id] });
    place += 1;
  }
  return ranking;
}

function buildTeamRanking(players: RankablePlayer[]): RankEntry[] {
  const teamAAlive = players.some((p) => p.team === 0 && p.health > 0);
  const teamBAlive = players.some((p) => p.team === 1 && p.health > 0);
  if (teamAAlive === teamBAlive) return [];

  const winningTeam = teamAAlive ? 0 : 1;
  const winners = players.filter((p) => p.team === winningTeam).map((p) => p.id);
  const losers = players.filter((p) => p.team !== winningTeam).map((p) => p.id);
  return [
    { place: 1, ids: winners },
    { place: 2, ids: losers },
  ];
}

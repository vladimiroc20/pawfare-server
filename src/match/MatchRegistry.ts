import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { Match, MatchOptions, MatchSnapshot } from "./Match";
import { PRESENCE_CHECK_INTERVAL_MS } from "../sim/Constants";

const DATA_DIR = path.join(process.cwd(), "data", "matches");

export class MatchRegistry {
  private matches = new Map<string, Match>();

  constructor() {
    this.loadPersistedMatches();
  }

  findOrCreate(options: MatchOptions): Match {
    for (const match of this.matches.values()) {
      if (match.isJoinable) return match;
    }

    const roomId = randomUUID();
    const match: Match = new Match(roomId, options, () => this.persist(match));
    this.matches.set(match.roomId, match);
    this.persist(match);
    return match;
  }

  get(roomId: string): Match | undefined {
    return this.matches.get(roomId);
  }

  startPresenceLoop(): NodeJS.Timeout {
    return setInterval(() => {
      for (const [id, match] of this.matches) {
        match.checkPresence();
        if (match.isDisposable) {
          this.matches.delete(id);
          this.deletePersisted(id);
        }
      }
    }, PRESENCE_CHECK_INTERVAL_MS);
  }

  private persist(match: Match): void {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(path.join(DATA_DIR, `${match.roomId}.json`), JSON.stringify(match.toSnapshot()));
    } catch (err) {
      console.error(`No se pudo guardar la partida ${match.roomId} en disco:`, err);
    }
  }

  private deletePersisted(roomId: string): void {
    try {
      const file = path.join(DATA_DIR, `${roomId}.json`);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (err) {
      console.error(`No se pudo borrar el archivo de la partida ${roomId}:`, err);
    }
  }

  private loadPersistedMatches(): void {
    if (!fs.existsSync(DATA_DIR)) return;

    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
    let restored = 0;

    for (const file of files) {
      const filePath = path.join(DATA_DIR, file);
      try {
        const snapshot: MatchSnapshot = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (snapshot.phase === "ended") {
          fs.unlinkSync(filePath);
          continue;
        }
        const match: Match = Match.fromSnapshot(snapshot, () => this.persist(match));
        this.matches.set(match.roomId, match);
        restored++;
      } catch (err) {
        console.error(`No se pudo restaurar la partida desde ${file}, se descarta:`, err);
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignorar: ya quedó registrado el error de restauración arriba
        }
      }
    }

    if (restored > 0) {
      console.log(`Restauradas ${restored} partida(s) desde disco`);
    }
  }
}

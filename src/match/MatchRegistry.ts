import { randomUUID } from "crypto";
import { Match, MatchOptions } from "./Match";
import { PRESENCE_CHECK_INTERVAL_MS } from "../sim/Constants";

export class MatchRegistry {
  private matches = new Map<string, Match>();

  findOrCreate(options: MatchOptions): Match {
    for (const match of this.matches.values()) {
      if (match.isJoinable) return match;
    }
    const match = new Match(randomUUID(), options);
    this.matches.set(match.roomId, match);
    return match;
  }

  get(roomId: string): Match | undefined {
    return this.matches.get(roomId);
  }

  startPresenceLoop(): NodeJS.Timeout {
    return setInterval(() => {
      for (const [id, match] of this.matches) {
        match.checkPresence();
        if (match.isDisposable) this.matches.delete(id);
      }
    }, PRESENCE_CHECK_INTERVAL_MS);
  }
}

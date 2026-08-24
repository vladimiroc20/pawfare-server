import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") slot: string = "";
  @type("string") label: string = "";
  @type("string") species: string = "dog";
  @type("string") color: string = "#3b82f6";
  @type("number") dir: number = 1;
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") health: number = 100;
  @type("int8") team: number = -1;
  @type("boolean") isBot: boolean = false;
  @type("boolean") connected: boolean = true;
}

export class RockState extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") radius: number = 0;
  @type("number") health: number = 0;
  @type("number") maxHealth: number = 0;
}

export class PawfareState extends Schema {
  @type("string") phase: string = "waiting"; // waiting | playing | ended
  @type("string") biomeId: string = "backyard";
  @type("number") wind: number = 0;
  @type("boolean") teamMode: boolean = false;
  @type("boolean") gameOver: boolean = false;
  @type("int8") currentTurnIndex: number = 0;

  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type(["string"]) turnOrder = new ArraySchema<string>();
  @type([RockState]) obstacles = new ArraySchema<RockState>();
  @type(["number"]) terrainHeights = new ArraySchema<number>();
}

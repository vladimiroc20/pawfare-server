// Node todavía no implementa Symbol.metadata (propuesta de metadata de
// decoradores nativos de TC39). @colyseus/schema v4 lo necesita para sus
// decoradores @type(...). Este archivo debe ser el primer import de
// cualquier punto de entrada del proceso, antes de que se cargue cualquier
// clase Schema.
if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

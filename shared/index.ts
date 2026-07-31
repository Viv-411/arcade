// Barrel for the shared client/server contracts. Every game's types+events
// module belongs here — consumers mostly import the specific module directly
// (`@shared/trivia`), but a half-populated barrel is a trap, so keep this in
// sync when adding a game.
export * from "./types.js";
export * from "./events.js";
export * from "./normalize.js";
export * from "./trivia.js";
export * from "./bidbattle.js";
export * from "./imposter.js";
export * from "./imposterWords.js";
export * from "./codewords.js";
export * from "./social.js";

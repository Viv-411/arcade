/**
 * Codewords word bank — ORIGINAL and self-authored for this arcade. This list
 * was composed from scratch (everyday concrete nouns and evocative adjectives
 * that support multiple associations) and is deliberately NOT copied from or
 * modeled on any published word game's card list. Family-friendly, single
 * English words only.
 *
 * Structured as packs so user-authored packs can plug in later (the accounts
 * DB already hosts trivia sets; a codewords_packs table could follow the same
 * pattern).
 */

export interface CwWordPack {
  id: string;
  name: string;
  words: readonly string[];
}

const EVERYDAY_MIX: string[] = [
  // around the house
  "chair", "table", "lamp", "mirror", "clock", "candle", "pillow", "blanket",
  "drawer", "shelf", "bucket", "broom", "sponge", "kettle", "toaster", "oven",
  "fridge", "spoon", "fork", "plate", "bowl", "bottle", "jar", "scissors",
  "hammer", "nail", "ladder", "rope", "basket", "curtain", "carpet", "sofa",
  "vase", "magnet", "umbrella", "wallet", "key", "doorbell", "faucet", "hinge",
  // nature & weather
  "mountain", "river", "ocean", "lake", "forest", "desert", "island", "volcano",
  "canyon", "cliff", "cave", "meadow", "swamp", "glacier", "waterfall", "beach",
  "dune", "reef", "jungle", "storm", "thunder", "lightning", "rainbow", "cloud",
  "fog", "frost", "snow", "hail", "breeze", "tide", "wave", "pebble", "boulder",
  "mud", "moss", "fern", "vine", "root", "acorn", "cactus",
  // animals
  "tiger", "lion", "elephant", "giraffe", "zebra", "monkey", "gorilla", "panda",
  "koala", "kangaroo", "dolphin", "whale", "shark", "octopus", "jellyfish",
  "crab", "lobster", "penguin", "eagle", "hawk", "owl", "parrot", "flamingo",
  "peacock", "swan", "goose", "duck", "rooster", "turkey", "rabbit", "squirrel",
  "hedgehog", "beaver", "otter", "fox", "wolf", "moose", "camel", "donkey",
  "spider",
  // food & drink
  "pizza", "burger", "sandwich", "taco", "noodle", "pancake", "waffle",
  "muffin", "bagel", "pretzel", "cheese", "butter", "yogurt", "honey", "syrup",
  "pepper", "ginger", "garlic", "onion", "carrot", "potato", "tomato",
  "cucumber", "spinach", "mushroom", "avocado", "mango", "banana", "cherry",
  "grape", "lemon", "peach", "melon", "coconut", "walnut", "raisin", "cookie",
  "brownie", "pudding", "smoothie",
  // around town
  "bridge", "tunnel", "tower", "castle", "palace", "temple", "museum",
  "library", "theater", "stadium", "harbor", "airport", "station", "market",
  "bakery", "pharmacy", "hospital", "school", "factory", "warehouse",
  "fountain", "statue", "plaza", "alley", "sidewalk", "subway", "elevator",
  "escalator", "balcony", "chimney",
  // getting around
  "bicycle", "scooter", "skateboard", "tractor", "truck", "ambulance",
  "helicopter", "submarine", "sailboat", "canoe", "ferry", "rocket", "wagon",
  "sled", "train", "taxi", "yacht", "glider", "anchor", "sail",
  // people & jobs
  "doctor", "nurse", "teacher", "farmer", "baker", "butcher", "tailor",
  "barber", "plumber", "carpenter", "pilot", "sailor", "soldier", "detective",
  "lawyer", "judge", "mayor", "clown", "magician", "juggler", "acrobat",
  "chef", "waiter", "cashier", "janitor",
  // wearing & body
  "jacket", "sweater", "scarf", "mitten", "glove", "helmet", "crown",
  "necklace", "bracelet", "pocket", "button", "zipper", "collar", "sleeve",
  "boot", "sandal", "slipper", "elbow", "knee", "ankle", "shoulder", "thumb",
  "eyebrow", "mustache", "ponytail",
  // sports & games
  "soccer", "tennis", "hockey", "golf", "bowling", "archery", "karate",
  "boxing", "surfing", "skiing", "marathon", "trophy", "medal", "whistle",
  "racket", "paddle", "dice", "puzzle", "kite", "marble", "domino", "dart",
  "frisbee", "trampoline", "goalpost",
  // music & arts
  "guitar", "violin", "trumpet", "drum", "flute", "piano", "harp", "banjo",
  "accordion", "microphone", "melody", "rhythm", "canvas", "easel", "sketch",
  "sculpture", "mosaic", "ballet", "orchestra", "choir",
  // school & desk
  "pencil", "crayon", "marker", "eraser", "notebook", "envelope", "stamp",
  "sticker", "folder", "stapler", "calculator", "compass", "globe", "atlas",
  "dictionary", "chalk", "ruler", "backpack", "calendar", "ribbon",
  // storybook & imagination
  "dragon", "wizard", "ghost", "pirate", "treasure", "mermaid", "unicorn",
  "robot", "alien", "zombie", "ninja", "knight", "dungeon", "potion", "wand",
  "cauldron", "genie", "phoenix", "troll", "goblin",
  // evocative extras
  "shadow", "echo", "whisper", "dream", "riddle", "secret", "ticket",
  "luggage", "souvenir", "campfire", "tent", "lantern", "parade", "circus",
  "carnival", "firework", "balloon", "confetti", "avalanche", "quicksand",
  // adjectives with lots of associations
  "golden", "frozen", "giant", "tiny", "fuzzy", "shiny", "spooky", "slippery",
  "sticky", "sour", "spicy", "cozy", "rusty", "ancient", "hollow",
];

/** Dedup defensively so a future edit can't silently shrink a board draw. */
function dedupe(words: string[]): string[] {
  return [...new Set(words.map((w) => w.trim().toLowerCase()))].filter(Boolean);
}

export const CW_DEFAULT_PACK: CwWordPack = {
  id: "everyday",
  name: "Everyday Mix",
  words: dedupe(EVERYDAY_MIX),
};

export const CW_WORD_PACKS: CwWordPack[] = [CW_DEFAULT_PACK];

/** Draw `count` distinct words at random from a pack (default pack if unknown). */
export function drawBoardWords(count: number, packId?: string): string[] {
  const pack = CW_WORD_PACKS.find((p) => p.id === packId) ?? CW_DEFAULT_PACK;
  const pool = [...pack.words];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

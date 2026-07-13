/**
 * Built-in word bank for Imposter (both modes; no network calls).
 * Imposters with hints ON see only the CATEGORY name, never the word.
 */
export const IMPOSTER_WORD_BANK: Record<string, string[]> = {
  Animals: [
    "elephant", "penguin", "kangaroo", "octopus", "giraffe", "hedgehog", "dolphin",
    "raccoon", "flamingo", "chameleon", "walrus", "cheetah", "platypus", "owl",
    "lobster", "gorilla", "armadillo", "peacock", "otter", "koala", "moose",
    "jellyfish", "hamster", "eagle", "sloth", "panda",
  ],
  Food: [
    "pizza", "sushi", "pancakes", "tacos", "spaghetti", "cheeseburger", "burrito",
    "croissant", "dumplings", "waffles", "lasagna", "popcorn", "ramen", "hot dog",
    "ice cream", "nachos", "meatballs", "omelette", "pretzel", "curry", "donut",
    "sandwich", "fried rice", "cupcake", "guacamole", "mac and cheese",
  ],
  Movies: [
    "titanic", "frozen", "jaws", "shrek", "avatar", "inception", "up", "grease",
    "the lion king", "star wars", "jurassic park", "toy story", "the matrix",
    "finding nemo", "harry potter", "spider-man", "batman", "home alone",
    "back to the future", "the wizard of oz", "pirates of the caribbean",
    "kung fu panda", "the incredibles", "ghostbusters", "top gun", "moana",
  ],
  Countries: [
    "japan", "brazil", "canada", "egypt", "france", "australia", "india", "mexico",
    "italy", "kenya", "norway", "thailand", "greece", "peru", "iceland", "spain",
    "turkey", "vietnam", "morocco", "argentina", "germany", "cuba", "portugal",
    "south korea", "switzerland", "new zealand",
  ],
  Sports: [
    "basketball", "surfing", "archery", "bowling", "gymnastics", "hockey", "golf",
    "volleyball", "fencing", "skateboarding", "tennis", "boxing", "rock climbing",
    "swimming", "curling", "badminton", "cricket", "skiing", "rugby", "darts",
    "table tennis", "wrestling", "rowing", "figure skating", "baseball", "soccer",
  ],
  "Household Items": [
    "toaster", "umbrella", "scissors", "pillow", "vacuum", "mirror", "candle",
    "blender", "ladder", "doormat", "curtains", "stapler", "flashlight", "broom",
    "kettle", "clothes hanger", "remote control", "alarm clock", "ironing board",
    "trash can", "shower curtain", "picture frame", "extension cord", "spatula",
    "laundry basket", "welcome mat",
  ],
  Jobs: [
    "firefighter", "dentist", "pilot", "chef", "librarian", "plumber", "astronaut",
    "teacher", "detective", "barber", "electrician", "lifeguard", "magician",
    "farmer", "surgeon", "photographer", "mail carrier", "judge", "mechanic",
    "zookeeper", "architect", "translator", "bus driver", "veterinarian",
    "news anchor", "tattoo artist",
  ],
  Nature: [
    "volcano", "waterfall", "glacier", "rainbow", "desert", "coral reef", "canyon",
    "thunderstorm", "meadow", "cave", "geyser", "swamp", "tornado", "island",
    "sand dune", "hot spring", "avalanche", "jungle", "cliff", "lagoon", "aurora",
    "quicksand", "riverbank", "tide pool", "redwood tree", "meteor shower",
  ],
  Places: [
    "airport", "library", "circus", "hospital", "movie theater", "amusement park",
    "grocery store", "gas station", "museum", "gym", "casino", "aquarium",
    "courtroom", "barbershop", "campground", "subway station", "art gallery",
    "laundromat", "rooftop bar", "farmers market", "arcade", "bowling alley",
    "haunted house", "waiting room", "school cafeteria", "parking garage",
  ],
  Music: [
    "guitar", "karaoke", "opera", "drum solo", "violin", "marching band", "jazz",
    "saxophone", "choir", "beatboxing", "banjo", "orchestra", "trumpet", "lullaby",
    "harmonica", "bagpipes", "mixtape", "vinyl record", "accordion", "national anthem",
    "piano", "ukulele", "boy band", "tambourine", "elevator music", "air guitar",
  ],
};

export const IMPOSTER_CATEGORIES = Object.keys(IMPOSTER_WORD_BANK);

/** Draw {category, word}. Pass null/unknown category for a random one. */
export function drawImposterWord(category: string | null): { category: string; word: string } {
  const cat =
    category && IMPOSTER_WORD_BANK[category]
      ? category
      : IMPOSTER_CATEGORIES[Math.floor(Math.random() * IMPOSTER_CATEGORIES.length)];
  const words = IMPOSTER_WORD_BANK[cat];
  return { category: cat, word: words[Math.floor(Math.random() * words.length)] };
}

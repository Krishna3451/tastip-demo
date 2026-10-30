import type { Place, TasteProfile, TasteSeed, Trip } from "./types";

/** Bounded, explicit preferences only. Ignore unrelated fields instead of storing a user object. */
export function parseTasteProfile(value: unknown): TasteProfile | null {
  if (!value || typeof value !== "object") return null;
  const profile = value as TasteProfile;
  const text = (item: unknown, max: number) =>
    typeof item === "string" && item.trim().length > 0 && item.length <= max;
  if (
    !Array.isArray(profile.seeds) ||
    profile.seeds.length > 20 ||
    !profile.seeds.every(
      (seed) => seed && text(seed.id, 150) && text(seed.name, 300) && text(seed.type, 100),
    ) ||
    new Set(profile.seeds.map((seed) => seed.id)).size !== profile.seeds.length ||
    !text(profile.dayStyle, 300) ||
    !Array.isArray(profile.categories) ||
    profile.categories.length > 5 ||
    !profile.categories.every((category) =>
      ["cafe", "culture", "food", "outdoors", "shop"].includes(category),
    ) ||
    (profile.rhythm !== undefined && !["early", "balanced", "late"].includes(profile.rhythm)) ||
    (profile.walking !== undefined && !["short", "moderate", "long"].includes(profile.walking)) ||
    (profile.dietary !== undefined &&
      (!Array.isArray(profile.dietary) ||
        profile.dietary.length > 12 ||
        !profile.dietary.every((item) => text(item, 100)))) ||
    (profile.lodging !== undefined && !text(profile.lodging, 300))
  )
    return null;
  return {
    seeds: profile.seeds.map(({ id, name, type }) => ({ id, name, type })),
    dayStyle: profile.dayStyle,
    categories: [...new Set(profile.categories)],
    ...(profile.rhythm !== undefined ? { rhythm: profile.rhythm } : {}),
    ...(profile.walking !== undefined ? { walking: profile.walking } : {}),
    ...(profile.dietary !== undefined ? { dietary: [...new Set(profile.dietary)] } : {}),
    ...(profile.lodging !== undefined ? { lodging: profile.lodging } : {}),
  };
}

export type TasteQuestion = {
  title: string;
  note: string;
  options: { label: string; categories: Place["category"][] }[];
};

/** Ask about the experience, never infer why someone likes a cultural favorite. */
export function nextTasteQuestion(seeds: TasteSeed[]): TasteQuestion {
  const music = seeds.some((seed) => /artist|music|podcast/.test(seed.type));
  const stories = seeds.some((seed) => /book|movie|tv_show|videogame/.test(seed.type));
  return {
    title: music
      ? "How should that sound become a day?"
      : stories
        ? "What draws you into a place?"
        : "What makes a place feel like you?",
    note: seeds.length
      ? `You chose ${seeds
          .slice(0, 2)
          .map((seed) => seed.name)
          .join(" and ")}. Tell us what you want to explore; we won’t assume.`
      : "Pick the experiences you actually want. Your choices guide which Qloo places enter the draft.",
    options: music
      ? [
          { label: "Creative spaces & culture", categories: ["culture", "shop"] },
          { label: "Cafés & slow conversations", categories: ["cafe", "food"] },
          { label: "Outdoors & room to breathe", categories: ["outdoors"] },
        ]
      : stories
        ? [
            { label: "Art, stories & little bookshops", categories: ["culture", "shop"] },
            { label: "Neighborhood cafés & food", categories: ["cafe", "food"] },
            { label: "Gardens & open-air wandering", categories: ["outdoors"] },
          ]
        : [
            { label: "Local tables & café culture", categories: ["food", "cafe"] },
            { label: "Art, design & independent shops", categories: ["culture", "shop"] },
            { label: "Nature & quiet corners", categories: ["outdoors"] },
          ],
  };
}

/** Filter explicit trip choices, preserving Qloo order and each original rank. */
export function refineTastePlaces(
  places: readonly Place[],
  categories: Place["category"][],
  excludedIds: string[] = [],
): Place[] {
  const excluded = new Set(excludedIds);
  return places.filter(
    (place) =>
      !excluded.has(place.id) && (!categories.length || categories.includes(place.category)),
  );
}

/** Only explicit positive feedback becomes a signal; downvotes are exclusions. */
export function feedbackTasteSignals(trip: Trip) {
  const liked = new Set<string>();
  const excluded = new Set<string>();
  for (const stop of trip.stops) {
    const place = trip.places.find((candidate) => candidate.id === stop.placeId);
    if (place?.source !== "qloo") continue;
    if (stop.feedback === "more") liked.add(place.id);
    if (stop.feedback === "less") excluded.add(place.id);
  }
  return { likedIds: [...liked].filter((id) => !excluded.has(id)), excludedIds: [...excluded] };
}

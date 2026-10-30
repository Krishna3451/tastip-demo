import { type PlaceFacts, safePublicLink, WEEKDAYS, type WeeklyHours } from "@tastip/domain";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function clock(value: unknown): string | null {
  return typeof value === "string" && /^T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(value)
    ? value.slice(1, 6)
    : null;
}

/** Retain only observed native fields; incomplete or unsafe optional facts stay absent. */
export function normalizePlaceFacts(
  properties: unknown,
  retrievedAt: string,
): PlaceFacts | undefined {
  if (!record(properties)) return undefined;
  const facts: PlaceFacts = { source: "qloo", retrievedAt };
  if (typeof properties.address === "string" && properties.address.length <= 500)
    facts.address = properties.address;
  if (typeof properties.specialty_dishes === "string" && properties.specialty_dishes.length <= 500)
    facts.specialtyDishes = properties.specialty_dishes;
  if (
    typeof properties.cuisine_description === "string" &&
    properties.cuisine_description.length <= 500
  )
    facts.cuisine = properties.cuisine_description;
  if (typeof properties.phone === "string" && properties.phone.length <= 500)
    facts.phone = properties.phone;
  if (safePublicLink(properties.website)) facts.website = properties.website;
  if (safePublicLink(properties.menu_url)) facts.menuUrl = properties.menu_url;
  const images = Array.isArray(properties.images) ? properties.images : [];
  const image = record(properties.image)
    ? properties.image.url
    : record(images[0])
      ? images[0].url
      : undefined;
  if (safePublicLink(image)) {
    const url = new URL(image);
    if (url.protocol === "https:" && url.hostname === "images.qloo.com") facts.imageUrl = image;
  }
  if (record(properties.hours)) {
    const hours: WeeklyHours = {};
    for (const day of WEEKDAYS) {
      const periods = properties.hours[day];
      if (!Array.isArray(periods) || !periods.length || periods.length > 8) continue;
      const parsed = periods.flatMap((period) =>
        record(period) && typeof period.closed === "boolean"
          ? [{ closed: period.closed, opens: clock(period.opens), closes: clock(period.closes) }]
          : [],
      );
      if (parsed.length === periods.length) hours[day] = parsed;
    }
    if (Object.keys(hours).length) facts.hours = hours;
  }
  return Object.keys(facts).length > 2 ? facts : undefined;
}

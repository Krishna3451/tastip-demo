/** A small transparent parser for the route brief, not an LLM or an intent guarantee. */
export function parseRoutePrompt(input: string) {
  const text = input.trim();
  const duration = /\b(\d+)\s*(?:[-–]\s*)?days?\b/i.exec(text);
  const days = duration ? Number(duration[1]) : null;
  const travelers = /(?:with|for)\s+(\d+)\s*(?:people|travelers|travellers|adults)\b/i.exec(text);
  // Duration-first wording still needs an explicit location marker. Do not turn
  // “4 days of art and design” into city searches or infer interests as cities.
  const leadingDuration = /^(?:plan\s+)?(?:a\s+)?\d+\s*(?:[-–]\s*)?days?\b\s*/i.exec(text);
  const routeText = leadingDuration
    ? text.slice(leadingDuration[0].length).replace(/^trip\s+/i, "")
    : text;
  const from = /^\s*(?:plan\s+)?(?:a\s+trip\s+)?from\s+(.+?)\s+to\s+/i.exec(routeText);
  let route = from
    ? routeText.slice(from[0].length)
    : leadingDuration
      ? (/^(?:to|in|visit|visiting)\s+(.+)$/i.exec(routeText)?.[1] ?? "")
      : routeText.replace(/^(?:plan\s+)?(?:a\s+)?(?:trip\s+)?(?:to|in|visit)\s+/i, "");
  route = route
    .replace(/\s+(?:for|with|starting|from\s+\d)\s+.*$/i, "")
    .replace(/\s+\d+\s*days?\b.*$/i, "");
  const cityQueries = route
    .split(/\s*(?:→|->|,|\band\b|\bthen\b|\bto\b)\s*/i)
    .map((city) => city.replace(/[.!?]+$/, "").trim())
    .filter(Boolean);
  return {
    origin: from?.[1]?.trim() ?? "",
    cityQueries,
    days,
    partySize: travelers ? Number(travelers[1]) : null,
  };
}

/** Extract explicit details only. A month stays flexible; this never invents a travel date. */
export function parseTripRequest(input: string, today: string) {
  const text = input.trim();
  const duration = /\b(\d+)\s*[-– ]?\s*days?\b/i.exec(text);
  const from = /\bfrom\s+(.+?)\s+to\s+/i.exec(text);
  let cities = from ? text.slice((from.index ?? 0) + from[0].length) : text;
  cities = cities
    .replace(/^.*?\b(?:trip|vacation|holiday)\s+(?:to|in)\s+/i, "")
    .replace(
      /^(?:(?:please\s+)?plan\s+(?:me\s+)?(?:a\s+)?|(?:i(?:’|')?d like|i want)\s+(?:a\s+)?)?/i,
      "",
    )
    .replace(/^\d+\s*[-– ]?\s*days?\s+(?:trip\s+)?(?:(?:to|in)\s+)?/i, "")
    .replace(/^(?:visit|to|in)\s+/i, "")
    .replace(
      /\s+(?:trip|vacation|holiday|for|with|starting|leaving|departing|returning|during|this|next)\b.*$/i,
      "",
    )
    .replace(
      /\s+(?:in|on)\s+(?:\d{4}-\d{2}-\d{2}|january|february|march|april|may|june|july|august|september|october|november|december)\b.*$/i,
      "",
    );
  const cityQueries = cities
    .split(/\s*(?:→|->|,|\band\b|\bthen\b|\bto\b)\s*/i)
    .map((city) => city.replace(/[.!?]+$/, "").trim())
    .filter(Boolean)
    .slice(0, 7);
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const monthMatch =
    /\b(?:in|this|next)\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/i.exec(
      text,
    );
  const monthNumber = monthMatch ? months.indexOf(monthMatch[1]!.toLowerCase()) + 1 : 0;
  const year = monthMatch?.[2]
    ? Number(monthMatch[2])
    : Number(today.slice(0, 4)) + (monthNumber && monthNumber < Number(today.slice(5, 7)) ? 1 : 0);
  const flexibleMonths = monthNumber ? [`${year}-${String(monthNumber).padStart(2, "0")}`] : [];
  const travelers = /\b(?:with|for)\s+(\d+)\s*(?:people|travelers|travellers)\b/i.exec(text);
  const adults = /\b(\d+)\s*adults?\b/i.exec(text);
  const children = /\b(\d+)\s*(?:children|kids|child)\b/i.exec(text);
  const infants = /\b(\d+)\s*(?:infants?|babies|baby)\b/i.exec(text);
  const pets = /\b(\d+)\s*(?:pets?|dogs?|cats?)\b/i.exec(text);
  const counts = {
    adults: adults ? Number(adults[1]) : travelers ? Number(travelers[1]) : 1,
    children: children ? Number(children[1]) : 0,
    infants: infants ? Number(infants[1]) : 0,
    pets: pets ? Number(pets[1]) : 0,
  };
  return {
    cityQueries,
    days: duration ? Number(duration[1]) : null,
    origin: from?.[1]?.trim() ?? "",
    flexibleMonths,
    counts,
  };
}

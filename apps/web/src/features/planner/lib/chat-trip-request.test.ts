import { expect, test } from "bun:test";
import { parseTripRequest } from "@tastip/domain";
import {
  chatTripCreationRequest,
  chatTripRequest,
  parseChatTripRequest,
} from "./chat-trip-request";

const today = "2026-10-30";

const user = (text: string) => ({ role: "user" as const, text });

test("bound-trip summaries and practical questions never imply trip creation", () => {
  for (const text of [
    "Summarize our Lisbon–Porto route in two sentences, and name one practical detail we should verify. Don’t change the plan.",
    "What should we verify about our 4-day trip to Lisbon and Porto?",
    "Which day do we travel to Porto?",
    "Explain the plan for our trip.",
    "Show my current itinerary without changing it.",
    "How was this trip built?",
    "How do I create a new trip?",
    "I want a summary of our trip.",
    "Don't build a trip. Just summarize this one.",
    "I don't want a new trip; explain the current route.",
    "No new trip, please.",
    "Lisbon and Porto for 4 days with 2 adults",
  ])
    expect(chatTripCreationRequest([user(text)], true)).toBe("");
  expect(
    chatTripCreationRequest(
      [user("Summarize my route"), { role: "assistant", text: "Let's build a new trip!" }],
      true,
    ),
  ).toBe("");
});

test("informational next-trip mentions are not affirmative creation requests", () => {
  for (const text of [
    "What should I pack for my next trip?",
    "What are the dates of my next trip?",
    "Do I need insurance for my next trip?",
    "Will our next trip include a train?",
    "Which train is on our next trip?",
    "Tell me the weather for my new trip.",
    "What should I verify for another trip?",
  ]) {
    expect(chatTripCreationRequest([user(text)], true)).toBe("");
    expect(
      chatTripCreationRequest([user("Plan a trip to Lisbon for 4 days"), user(text)], true),
    ).toBe("");
  }
  for (const text of [
    "Can you plan my next trip?",
    "Think about my next trip",
    "I'd like a new trip. What should we consider?",
    "Don't change the current trip. Can you plan my next trip?",
    "What should I pack for my next trip? Also, plan a new trip to Kyoto for 5 days.",
  ])
    expect(chatTripCreationRequest([user(text)], true)).toBe(text);
});

test("affirmative creation and next-trip intent survives a current-trip protection clause", () => {
  for (const text of [
    "Plan a trip to Kyoto for 5 days",
    "Create a 6-day itinerary in Japan",
    "Build us a trip to Lisbon and Porto",
    "I'd like a relaxed trip with cafés and art",
    "I'm thinking about a 3-day trip",
    "Next trip: Kyoto for 5 days",
    "Help me plan another trip",
    "Don't change the current trip; plan a new trip to Kyoto for 5 days",
    "Don't change our current trip, but build a new trip to Kyoto",
    "Don't change the current trip and plan our next trip in Japan",
    "Plan a new trip to Kyoto. Don't change the current Lisbon–Porto plan.",
  ])
    expect(chatTripCreationRequest([user(text)], true)).toBe(text);
});

test("unbound city-duration starters stay actionable and ordinary questions do not", () => {
  for (const text of [
    "Lisbon and Porto for 4 days with 2 adults",
    "3 days in Kyoto",
    "From Delhi to Lisbon and Porto for 5 days",
  ])
    expect(chatTripCreationRequest([user(text)], false)).toBe(text);
  for (const text of [
    "What should I pack for Lisbon for 4 days?",
    "Summarize Lisbon and Porto for 4 days",
    "2 adults for 4 days",
    "4 days",
  ])
    expect(chatTripCreationRequest([user(text)], false)).toBe("");
});

test("clarifications preserve a handoff, read-only turns hide it, and a new request owns its context", () => {
  const request = "Plan a trip to Lisbon and Porto for 4 days";
  const messages = [user(request), user("2 adults and 1 child"), user("No museums, slow mornings")];
  expect(chatTripCreationRequest(messages, true)).toBe(
    `${request}\n2 adults and 1 child\nNo museums, slow mornings`,
  );
  messages.push(user("Summarize our Lisbon–Porto route. Don't change the plan."));
  expect(chatTripCreationRequest(messages, true)).toBe("");
  messages.push(user("Plan our next trip to Kyoto for 5 days. Don't change the current trip."));
  messages.push(user("2 adults, no children"));
  expect(chatTripCreationRequest(messages, true)).toBe(
    "Plan our next trip to Kyoto for 5 days. Don't change the current trip.\n2 adults, no children",
  );
  const before = structuredClone(messages);
  chatTripCreationRequest(messages, true);
  expect(messages).toEqual(before);
});

test("an explicit next trip starts a fresh brief even when an older planning handoff is active", () => {
  const next = "Plan our next trip to Kyoto for 5 days. Don't change this trip.";
  const request = chatTripCreationRequest(
    [
      user("Plan a trip to Lisbon and Porto for 4 days"),
      user("2 adults"),
      { role: "assistant", text: "Synthetic previous planning reply." },
      user(next),
      user("Actually 6 days, with 1 adult"),
    ],
    true,
  );
  expect(request).toBe(`${next}\nActually 6 days, with 1 adult`);
  const parsed = parseChatTripRequest(request, today);
  expect(parsed.cityQueries).toEqual(["Kyoto"]);
  expect(parsed.days).toBe(6);
  expect(parsed.counts.adults).toBe(1);
});

test("the chat handoff keeps the initial route and recent user clarifications without assistant facts", () => {
  const messages = [
    { role: "user" as const, text: "Lisbon and Porto for 5 days in March 2027" },
    {
      role: "assistant" as const,
      text: "Invented assistant-only destination Kyoto, 20 days and 8 adults",
    },
    { role: "user" as const, text: "2 adults and 1 child" },
    { role: "assistant" as const, text: "An invented hotel booking and proposal" },
    { role: "user" as const, text: "Slow pace, and make that 6 days" },
  ];
  const before = structuredClone(messages);
  const request = chatTripRequest(messages);
  expect(request).toBe(
    "Lisbon and Porto for 5 days in March 2027\n2 adults and 1 child\nSlow pace, and make that 6 days",
  );
  expect(request).not.toContain("Kyoto");
  expect(request).not.toContain("booking");
  expect(messages).toEqual(before);
  const parsed = parseChatTripRequest(request, today);
  expect(parsed.cityQueries).toEqual(["Lisbon", "Porto"]);
  expect(parsed.days).toBe(6);
  expect(parsed.counts).toEqual({ adults: 2, children: 1, infants: 0, pets: 0 });
  expect(parsed.flexibleMonths).toEqual(["2027-03"]);
});

test("bounded chat context preserves its original route and the newest clarifications", () => {
  const initial = "From Delhi to Lisbon and Porto for 5 days";
  const request = chatTripRequest([
    { role: "user", text: initial },
    ...Array.from({ length: 30 }, (_, index) => ({
      role: "user" as const,
      text: `Older preference ${index}: ${"quiet ".repeat(40)}`,
    })),
    { role: "user", text: "Make that 7 days with 2 adults" },
  ]);
  expect(request.length).toBeLessThanOrEqual(2000);
  expect(request.startsWith(`${initial}\n`)).toBe(true);
  expect(request.endsWith("Make that 7 days with 2 adults")).toBe(true);
  expect(request).not.toContain("Older preference 0:");
  const parsed = parseChatTripRequest(request, today);
  expect(parsed.origin).toBe("Delhi");
  expect(parsed.cityQueries).toEqual(["Lisbon", "Porto"]);
  expect(parsed.days).toBe(7);
  expect(parsed.counts.adults).toBe(2);
  const long = chatTripRequest([
    { role: "user", text: `${initial} ${"x".repeat(3000)}` },
    { role: "user", text: "1 child" },
  ]);
  expect(long.length).toBeLessThanOrEqual(2000);
  expect(long.startsWith(initial)).toBe(true);
  expect(long.endsWith("\n1 child")).toBe(true);
  expect(chatTripRequest([{ role: "assistant", text: "No user request" }])).toBe("");
});

test("latest explicit scalar mentions override only their corresponding values", () => {
  const parsed = parseChatTripRequest(
    "From Delhi to Lisbon and Porto for 5 days in March 2027 with 2 adults and 2 children\nMake that 6 days, with 3 adults and 1 child\nActually 8 days, 0 children, 1 infant and 2 dogs\nI like Kyoto in April; slower pace and no assumptions",
    today,
  );
  expect(parsed.cityQueries).toEqual(["Lisbon", "Porto"]);
  expect(parsed.origin).toBe("Delhi");
  expect(parsed.flexibleMonths).toEqual(["2027-03"]);
  expect(parsed.days).toBe(8);
  expect(parsed.counts).toEqual({ adults: 3, children: 0, infants: 1, pets: 2 });
  expect(
    parseChatTripRequest("Lisbon for 4 days with 2 adults\nNo numerical changes", today).counts
      .adults,
  ).toBe(2);
  expect(
    parseChatTripRequest(
      "Lisbon for 4 days\n5 days, actually 7 days with 2 adults, actually 3 adults",
      today,
    ),
  ).toMatchObject({ days: 7, counts: { adults: 3 } });
});

test("single-line requests keep the domain parser behavior unchanged", () => {
  for (const prompt of [
    "Lisbon and Porto for 5 days with 2 adults",
    "From Delhi to Kyoto for 3 days in March 2027",
    "Lisbon",
    "",
    "Plan a trip in Copenhagen with 2 children and 1 pet",
  ])
    expect(parseChatTripRequest(prompt, today)).toEqual(parseTripRequest(prompt, today));
  const long = "Lisbon for 5 days ".repeat(200);
  expect(chatTripRequest([{ role: "user", text: long }])).toBe(long.trim().slice(0, 2000));
});

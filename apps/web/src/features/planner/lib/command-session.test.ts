import { expect, test } from "bun:test";
import { createDemoTrip, DEFAULT_BRIEF } from "@tastip/domain";
import { acceptLocalCommand } from "./command-session";

test("same-frame direct edits serialize against the latest accepted trip, without losing a prior change", async () => {
  const session = { current: createDemoTrip(DEFAULT_BRIEF) };
  await Promise.all([
    Promise.resolve().then(() =>
      acceptLocalCommand(session, [{ type: "pin-stop", stopId: "day-1-stop-1", pinned: true }]),
    ),
    Promise.resolve().then(() =>
      acceptLocalCommand(session, [
        { type: "lock-time", stopId: "day-1-stop-2", timeLocked: true },
      ]),
    ),
  ]);
  expect(session.current.version).toBe(3);
  expect(session.current.stops[0]?.pinned).toBe(true);
  expect(session.current.stops[1]?.timeLocked).toBe(true);
});
test("async versions and trip identities cannot overwrite a newer accepted edit; retries keep the original command identity", () => {
  const session = { current: createDemoTrip(DEFAULT_BRIEF) };
  const tripId = session.current.id;
  const operations = [{ type: "pin-stop" as const, stopId: "day-1-stop-1", pinned: true }];
  expect(acceptLocalCommand(session, operations, 1, tripId, "proposal-1").ok).toBe(true);
  expect(
    acceptLocalCommand(
      session,
      [{ type: "remove-stop", stopId: "day-1-stop-2" }],
      1,
      tripId,
      "old-proposal",
    ).ok,
  ).toBe(false);
  const replay = acceptLocalCommand(session, operations, 1, tripId, "proposal-1");
  expect(replay.ok && replay.replayed).toBe(true);
  expect(session.current.version).toBe(2);
  expect(acceptLocalCommand(session, operations, 2, "another-trip", "foreign-proposal").ok).toBe(
    false,
  );
});

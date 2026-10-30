# Trip domain

`@tastip/domain` is provider-independent. Chat, voice, DOM controls, and the 3D scene use the same `Trip`, visit IDs, and command result.

`createTripFromPlaces(brief, places)` composes a draft from one candidate inventory. A Qloo inventory must retain actual query IDs and unique positive ranks from one query; rank determines which candidates are scheduled first. Scores are retained as evidence, not mixed across queries or interpreted as enjoyment percentages. Demo inventory uses its neutral supplied order. Both use the same scheduling function. Insufficient inventory leaves partial or empty days instead of inventing repeat visits. Times remain draft suggestions until dated hours and routes are checked.

```ts
const result = applyTripCommand(trip, {
  id: crypto.randomUUID(),
  baseVersion: trip.version,
  operations: [{ type: "set-start-time", stopId, startTime: "11:00" }],
});

if (result.ok) {
  // Persist the entire result.trip, including commandLog.
  // Announce success only after accepting this result.
  const undo = undoTripCommand(result.trip, result.receipt, crypto.randomUUID());
}
```

- Place IDs identify inventory. Stop IDs identify visits; visiting the same place on two days remains valid.
- Place pins protect identity; time locks protect the visit's day and time. They are separate controls.
- Commands apply atomically against a base version. A rejected operation leaves the original trip unchanged.
- Retrying the same command ID and payload returns its recorded receipt. The returned trip remains the latest accepted state, preserving edits accepted after the original command. Reusing an ID with a different payload fails.
- Undo restores the recorded snapshot only if no later edit intervened. Undo itself has a new command ID and increments the version.
- `validateTrip` checks references, IDs, local visit times, and overlapping visits. It does **not** establish opening hours, travel feasibility, live prices, or bookings.
- `TripBrief.budget` is the whole-trip activity budget for the whole party, excluding lodging and transport to the destination. `null` means unknown; `0` remains a valid declared value.
- Current demo dates are unknown (`null`), visits are illustrative, and costs/hours stay unknown. The original fixture venues are fictional and are never Qloo recommendations.

The local-first foundation persists command receipts with each trip. A production collaborative service should move acknowledgement records and authorization into its durable server transaction boundary; the UI should keep this command protocol.

import { dayFactWarnings, type Trip } from "@tastip/domain";
export function PracticalChecks({ trip, dayId }: { trip: Trip; dayId: string }) {
  const warnings = dayFactWarnings(trip, dayId);
  if (!warnings.length) return null;
  return (
    <details className="practical-checks">
      <summary>
        {warnings.length} venue-hour check{warnings.length === 1 ? "" : "s"} before you go
      </summary>
      <ul>
        {warnings.map((warning) => (
          <li key={warning.stopId}>{warning.message}</li>
        ))}
      </ul>
      <p>
        Provider-listed hours are advisory. No holiday or travel-time validation has been performed.
      </p>
    </details>
  );
}

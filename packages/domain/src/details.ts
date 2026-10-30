import type { TripDetails } from "./types";

export function validTravelers(value: unknown): value is TripDetails["travelers"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { adults, children, infants, pets } = value as TripDetails["travelers"];
  return (
    [adults, children, infants, pets].every(
      (count) => Number.isInteger(count) && count >= 0 && count <= 20,
    ) &&
    adults >= 1 &&
    adults + children + infants <= 20
  );
}

export function validTripDetails(value: unknown, partySize: number): value is TripDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as TripDetails;
  if (
    typeof details.request !== "string" ||
    details.request.length > 2000 ||
    !details.travelers ||
    typeof details.travelers !== "object"
  )
    return false;
  if (
    !validTravelers(details.travelers) ||
    details.travelers.adults + details.travelers.children + details.travelers.infants !== partySize
  )
    return false;
  return (
    Array.isArray(details.flexibleMonths) &&
    details.flexibleMonths.length <= 12 &&
    new Set(details.flexibleMonths).size === details.flexibleMonths.length &&
    details.flexibleMonths.every(
      (month) => typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month),
    )
  );
}

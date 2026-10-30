import {
  DESTINATIONS,
  type Destination,
  type LocalTravelTime,
  MAX_CITY_STAYS,
  MAX_TRIP_DAYS,
  type Place,
  routeDayDate,
  routeStayDates,
  stayForDay,
  type TasteProfile,
  type TripRoute,
  transferWindow,
  validDestination,
} from "@tastip/domain";
import type { TripContext } from "./contracts";

/** Current accepted-plan fields allowed across the client/provider boundary. */
export type TripContextInput = {
  id?: string;
  version?: number;
  brief: {
    destinationId: string;
    destination?: Destination;
    days: number;
    partySize: number;
    origin?: string;
    budget?: number | null;
    currency?: string;
    pace?: "slow" | "balanced" | "full";
    interests: string[];
    tasteProfile?: TasteProfile;
  };
  days?: { id: string; label: string; date: string | null }[];
  route?: TripRoute;
  lodgings?: { stayId: string; name: string; destinationId: string }[];
  places: { id: string; name: string; source: Place["source"] }[];
  stops: {
    id: string;
    placeId: string;
    dayId: string;
    startTime: string;
    durationMinutes?: number;
    pinned?: boolean;
    timeLocked?: boolean;
  }[];
};

function projectDestination(city: Destination): Destination {
  return {
    id: city.id,
    name: city.name,
    country: city.country,
    lat: city.lat,
    lng: city.lng,
    timeZone: city.timeZone,
  };
}

function projectLocalTime(value: LocalTravelTime): LocalTravelTime {
  return {
    date: value.date,
    time: value.time,
    ...(value.utcOffset !== undefined ? { utcOffset: value.utcOffset } : {}),
  };
}

/** Inputs are validated accepted domain/API values. Never spread imported records:
 * domain validators intentionally retain unknown metadata for lossless recovery. */
export function projectTripContextInput(trip: TripContextInput): TripContextInput {
  const brief = trip.brief;
  const taste = brief.tasteProfile;
  const route = trip.route;
  return {
    id: trip.id,
    version: trip.version,
    brief: {
      destinationId: brief.destinationId,
      ...(brief.destination ? { destination: projectDestination(brief.destination) } : {}),
      days: brief.days,
      partySize: brief.partySize,
      origin: brief.origin,
      budget: brief.budget,
      currency: brief.currency,
      pace: brief.pace,
      interests: brief.interests.slice(0, 30),
      ...(taste
        ? {
            tasteProfile: {
              seeds: taste.seeds.slice(0, 20).map(({ id, name, type }) => ({ id, name, type })),
              dayStyle: taste.dayStyle,
              categories: taste.categories.slice(0, 5),
              ...(taste.rhythm !== undefined ? { rhythm: taste.rhythm } : {}),
              ...(taste.dietary !== undefined ? { dietary: taste.dietary.slice(0, 12) } : {}),
              ...(taste.walking !== undefined ? { walking: taste.walking } : {}),
              ...(taste.lodging !== undefined ? { lodging: taste.lodging } : {}),
            },
          }
        : {}),
    },
    days: trip.days?.slice(0, MAX_TRIP_DAYS).map(({ id, label, date }) => ({ id, label, date })),
    ...(route
      ? {
          route: {
            startDate: route.startDate,
            stays: route.stays.slice(0, MAX_CITY_STAYS).map((stay) => ({
              id: stay.id,
              destinationId: stay.destinationId,
              days: stay.days,
              ...(stay.destination ? { destination: projectDestination(stay.destination) } : {}),
            })),
            transfers: route.transfers.slice(0, MAX_CITY_STAYS - 1).map((transfer) => ({
              id: transfer.id,
              fromStayId: transfer.fromStayId,
              toStayId: transfer.toStayId,
              mode: transfer.mode,
              ...(transfer.timing
                ? {
                    timing: {
                      source: transfer.timing.source,
                      departure: projectLocalTime(transfer.timing.departure),
                      arrival: projectLocalTime(transfer.timing.arrival),
                    },
                  }
                : {}),
            })),
          },
        }
      : {}),
    lodgings: trip.lodgings?.slice(0, MAX_CITY_STAYS).map(({ stayId, name, destinationId }) => ({
      stayId,
      name,
      destinationId,
    })),
    places: trip.places.slice(0, 150).map(({ id, name, source }) => ({ id, name, source })),
    stops: trip.stops
      .slice(0, 150)
      .map(({ id, placeId, dayId, startTime, durationMinutes, pinned, timeLocked }) => ({
        id,
        placeId,
        dayId,
        startTime,
        durationMinutes,
        pinned,
        timeLocked,
      })),
  };
}

export function projectTripContext(input?: TripContextInput): TripContext | undefined {
  if (!input) return undefined;
  const trip = projectTripContextInput(input);
  const places = new Map(trip.places.map((place) => [place.id, place]));
  const destination = (id: string | undefined) => {
    const embedded =
      id === trip.brief.destinationId
        ? trip.brief.destination
        : trip.route?.stays.find((stay) => stay.destinationId === id)?.destination;
    return embedded?.id === id && validDestination(embedded)
      ? embedded
      : DESTINATIONS.find((city) => city.id === id);
  };
  return {
    tripId: trip.id,
    version: trip.version,
    destinationId: trip.brief.destinationId,
    destination: trip.brief.destination,
    origin: trip.brief.origin,
    days: trip.brief.days,
    partySize: trip.brief.partySize,
    budget: trip.brief.budget,
    currency: trip.brief.currency,
    pace: trip.brief.pace,
    interests: trip.brief.interests,
    tasteProfile: trip.brief.tasteProfile,
    lodgings: trip.lodgings?.flatMap((choice) => {
      const stay = trip.route
        ? routeStayDates(trip.route).find((item) => item.id === choice.stayId)
        : undefined;
      return stay
        ? [
            {
              name: choice.name,
              city: destination(choice.destinationId)?.name ?? "Unknown city",
              arrival: stay.arrival,
              departure: stay.departure,
              status: "idea" as const,
            },
          ]
        : [];
    }),
    calendar: trip.days?.map((day, index) => {
      const cityId = trip.route
        ? stayForDay(trip.route, index)?.destinationId
        : trip.brief.destinationId;
      const city = destination(cityId);
      return {
        id: day.id,
        date: day.date,
        city: city?.name ?? "Unknown city",
        timeZone: city?.timeZone ?? "Unknown",
      };
    }),
    transfers: trip.route
      ? routeStayDates(trip.route)
          .slice(1)
          .map((stay, index) => {
            const route = trip.route!;
            const window = transferWindow(route, index);
            return {
              date: routeDayDate(route, stay.firstDay),
              from: destination(route.stays[index]?.destinationId)?.name ?? "Unknown city",
              to: destination(stay.destinationId)?.name ?? "Unknown city",
              mode: route.transfers[index]!.mode,
              verified: false as const,
              ...(window
                ? {
                    timing: {
                      source: "traveler" as const,
                      departure: projectLocalTime(window.timing.departure),
                      arrival: projectLocalTime(window.timing.arrival),
                      departureTimeZone: window.from.timeZone,
                      arrivalTimeZone: window.to.timeZone,
                    },
                  }
                : {}),
            };
          })
      : undefined,
    places: trip.places.map(({ id, name }) => ({ id, name })),
    stops: trip.stops.map((stop) => {
      const place = places.get(stop.placeId);
      return {
        id: stop.id,
        placeId: stop.placeId,
        name: place?.name || "Unknown place",
        day: stop.dayId,
        time: stop.startTime,
        durationMinutes: stop.durationMinutes,
        pinned: stop.pinned,
        timeLocked: stop.timeLocked,
        sample: !place || place.source === "demo",
        source: place?.source,
      };
    }),
  };
}

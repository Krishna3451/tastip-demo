import {
  type Destination,
  MAX_CITY_STAYS,
  MAX_TRIP_DAYS,
  validDestination,
  validRoute,
} from "@tastip/domain";
import { projectTripContext } from "@tastip/providers/context";
import { z } from "zod";

export const tripContextSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  version: z.number().int().min(1).optional(),
  brief: z.object({
    destinationId: z.string().max(150),
    destination: z.custom<Destination>(validDestination).optional(),
    days: z.number().int().min(1).max(MAX_TRIP_DAYS),
    partySize: z.number().int().min(1).max(30),
    origin: z.string().max(100).optional(),
    budget: z.number().nonnegative().nullable().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    pace: z.enum(["slow", "balanced", "full"]).optional(),
    interests: z.array(z.string().max(200)).max(30),
    tasteProfile: z
      .object({
        seeds: z
          .array(
            z.object({
              id: z.string().max(150),
              name: z.string().max(300),
              type: z.string().max(100),
            }),
          )
          .max(20),
        dayStyle: z.string().max(300),
        categories: z.array(z.enum(["cafe", "culture", "food", "outdoors", "shop"])).max(5),
        rhythm: z.enum(["early", "balanced", "late"]).optional(),
        dietary: z.array(z.string().max(100)).max(12).optional(),
        walking: z.enum(["short", "moderate", "long"]).optional(),
        lodging: z.string().max(300).optional(),
      })
      .optional(),
  }),
  days: z
    .array(
      z.object({
        id: z.string().max(100),
        label: z.string().max(100),
        date: z.string().date().nullable(),
      }),
    )
    .max(MAX_TRIP_DAYS)
    .optional(),
  route: z.custom<import("@tastip/domain").TripRoute>(validRoute).optional(),
  lodgings: z
    .array(
      z.object({
        stayId: z.string().max(150),
        name: z.string().max(300),
        destinationId: z.string().max(150),
      }),
    )
    .max(MAX_CITY_STAYS)
    .optional(),
  places: z
    .array(
      z.object({
        id: z.string().max(100),
        name: z.string().max(300),
        source: z.enum(["demo", "qloo", "traveler"]),
      }),
    )
    .max(150),
  stops: z
    .array(
      z.object({
        id: z.string().max(100),
        placeId: z.string().max(100),
        dayId: z.string().max(100),
        durationMinutes: z.number().int().min(1).max(1440).optional(),
        pinned: z.boolean().optional(),
        timeLocked: z.boolean().optional(),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .max(150),
});

export function toProviderContext(trip?: z.infer<typeof tripContextSchema>) {
  return projectTripContext(trip);
}

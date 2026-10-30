import { describe, expect, test } from "bun:test";
import { getPlaceLandmark } from "./place-visual";

describe("actual-visit landmark visuals", () => {
  test("an exact Eiffel identity and local coordinates select its model", () => {
    expect(
      getPlaceLandmark({ name: "Tour Eiffel", lat: 48.8583, lng: 2.2945, source: "qloo" }),
    ).toBe("eiffel-tower");
    expect(
      getPlaceLandmark({ name: "Eiffel Tower", lat: 0, lng: 0, source: "qloo" }),
    ).toBeUndefined();
  });
  test("nearby businesses and fictional samples never borrow a monument", () => {
    expect(
      getPlaceLandmark({ name: "Eiffel Café", lat: 48.8583, lng: 2.2945, source: "qloo" }),
    ).toBeUndefined();
    expect(
      getPlaceLandmark({ name: "Eiffel Tower", lat: 48.8583, lng: 2.2945, source: "demo" }),
    ).toBeUndefined();
  });
  test("the other original models require their own identity and location", () => {
    expect(
      getPlaceLandmark({ name: "Torre de Belém", lat: 38.691693, lng: -9.215988, source: "qloo" }),
    ).toBe("belem-tower");
    expect(
      getPlaceLandmark({
        name: "Fushimi Inari Taisha",
        lat: 34.9671,
        lng: 135.7727,
        source: "qloo",
      }),
    ).toBe("torii-gate");
    expect(
      getPlaceLandmark({ name: "Rundetaarn", lat: 55.6814, lng: 12.5757, source: "qloo" }),
    ).toBe("round-tower");
  });
});

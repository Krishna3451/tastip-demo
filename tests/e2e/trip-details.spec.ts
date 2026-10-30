import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src/fixtures";
import type { Trip } from "../../packages/domain/src/types";

for (const width of [375, 1440]) {
  test(`trip details recalculate entered costs, preserve drafts and undo without rebuilding at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fixture = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
    fixture.costs = [
      {
        id: "private-ticket-fixture",
        label: "Private ticket settings fixture",
        category: "activity",
        currency: "EUR",
        unitAmountMinor: 1250,
        quantity: 2,
        appliesTo: "each-traveler",
        source: "traveler",
      },
      {
        id: "private-room-fixture",
        label: "Private room settings fixture",
        category: "lodging",
        currency: "JPY",
        unitAmountMinor: 12000,
        quantity: 1,
        appliesTo: "party",
        source: "traveler",
      },
    ];
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, fixture);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.text().includes("Encountered two children with the same key"))
        errors.push(message.text());
    });
    await page.goto("/studio");
    const openDetails = async () => {
      if (width <= 620) await page.getByLabel("More planning views").selectOption("details");
      else await page.getByRole("button", { name: "Trip details", exact: true }).click();
    };
    await openDetails();
    const details = page.getByRole("region", {
      name: "Travelers, pace and activity budget",
      exact: true,
    });
    const travelers = details.getByLabel("Trip travelers", { exact: true });
    const pace = details.getByLabel("Trip pace", { exact: true });
    const budget = details.getByLabel("Trip activity budget", { exact: true });
    const currency = details.getByLabel("Trip budget currency", { exact: true });
    const apply = details.getByRole("button", { name: "Apply trip details", exact: true });
    await expect(
      details.getByRole("region", { name: "Planned totals with these travelers", exact: true }),
    ).toContainText("EUR 50.00");
    await travelers.fill("3");
    await pace.selectOption("slow");
    await budget.fill("100.01");
    await expect(
      details.getByRole("region", { name: "Planned totals with these travelers", exact: true }),
    ).toContainText("EUR 75.00");
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null").brief.partySize,
      ),
    ).toBe(2);
    await apply.click();
    await expect(details.getByRole("status")).toContainText("Trip details updated");
    let accepted: Trip = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
    );
    expect(accepted.brief).toMatchObject({
      partySize: 3,
      pace: "slow",
      currency: "EUR",
      budget: 100.01,
    });
    expect(accepted.stops).toEqual(fixture.stops);
    expect(accepted.places).toEqual(fixture.places);
    expect(accepted.costs).toEqual(fixture.costs);
    await travelers.fill("4");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(details.getByRole("status")).toContainText("Your plan changed");
    await expect(travelers).toHaveValue("4");
    await expect(apply).toBeDisabled();
    await details.getByRole("button", { name: "Reload latest trip details", exact: true }).click();
    await expect(travelers).toHaveValue("2");
    await expect(travelers).toBeFocused();
    await travelers.fill("1");
    await pace.selectOption("full");
    await budget.fill("200.50");
    await apply.click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(travelers).toHaveValue("2");
    await expect(pace).toHaveValue("balanced");
    await expect(budget).toHaveValue("");
    await expect(apply).toBeDisabled();
    await currency.selectOption("JPY");
    await budget.fill("100.50");
    await apply.click();
    await expect(details.getByRole("alert")).toContainText("whole yen");
    await budget.fill("0");
    await apply.click();
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null").brief.budget,
      ),
    ).toBe(0);
    await budget.fill("");
    await apply.click();
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null").brief.budget,
      ),
    ).toBeNull();
    await travelers.fill("3");
    await pace.selectOption("slow");
    await currency.selectOption("EUR");
    await budget.fill("100.01");
    await apply.click();
    await page.reload();
    await openDetails();
    await expect(travelers).toHaveValue("3");
    await expect(pace).toHaveValue("slow");
    await expect(budget).toHaveValue("100.01");
    if (width <= 620) await page.getByLabel("More planning views").selectOption("costs");
    else await page.getByRole("button", { name: "Costs", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Recorded cost subtotals", exact: true }),
    ).toContainText("EUR 75.00");
    await expect(
      page.getByRole("region", { name: "Activity budget comparison", exact: true }),
    ).toContainText("EUR 25.01 not yet allocated");
    if (width <= 620) await page.getByLabel("More planning views").selectOption("pack");
    else await page.getByRole("button", { name: "Travel pack", exact: true }).click();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: /Printable itinerary/ }).click();
    const path = await (await downloading).path();
    if (!path) throw new Error("Updated print itinerary is missing");
    const printed = (await readFile(path, "utf8")).replaceAll("\u00a0", " ");
    expect(printed).toContain("3 travelers");
    expect(printed).toContain("Unhurried");
    expect(printed).toContain("Activity budget: EUR 100.01");
    expect(printed).toContain("EUR 75.00");
    accepted = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
    );
    expect(accepted.stops).toEqual(fixture.stops);
    expect(accepted.costs).toEqual(fixture.costs);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}

test("the studio total-traveler editor preserves categories from a reference trip", async ({
  page,
}) => {
  const trip = createDemoTrip({
    ...DEFAULT_BRIEF,
    details: {
      request: "Retained reference brief",
      flexibleMonths: ["2027-03"],
      travelers: { adults: 1, children: 1, infants: 0, pets: 1 },
    },
  });
  await page.addInitScript(
    (trip) => localStorage.setItem("tastip.trip.v1", JSON.stringify(trip)),
    trip,
  );
  await page.goto("/studio");
  await page.getByRole("button", { name: "Trip details", exact: true }).click();
  const details = page.getByRole("region", {
    name: "Travelers, pace and activity budget",
    exact: true,
  });
  await details.getByLabel("Trip travelers", { exact: true }).fill("3");
  await details.getByRole("button", { name: "Apply trip details", exact: true }).click();
  await expect(details.getByRole("status")).toContainText("Trip details updated");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
  );
  expect(stored.brief.partySize).toBe(3);
  expect(stored.brief.details).toEqual({
    ...trip.brief.details,
    travelers: { adults: 2, children: 1, infants: 0, pets: 1 },
  });
  expect(stored.stops).toEqual(trip.stops);
  await details.getByLabel("Trip travelers", { exact: true }).fill("1");
  await details.getByRole("button", { name: "Apply trip details", exact: true }).click();
  await expect(details.getByRole("alert")).toContainText("at least 2 travelers");
});

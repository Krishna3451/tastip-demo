import { expect, test } from "@playwright/test";

test("entered intercity times reserve the timeline, calendar and download, persist and undo", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/studio");
  await page.getByRole("button", { name: "Explore my Lisbon" }).click();
  await page.getByRole("button", { name: "Edit dates & cities" }).click();
  await page.getByLabel("Trip start date").fill("2028-07-10");
  await page.getByRole("button", { name: "Add city", exact: true }).click();
  await page.getByLabel("City 2", { exact: true }).selectOption("porto");
  await page.getByLabel("Days in city 2").fill("2");
  await page.getByLabel("Transport to city 2").selectOption("train");
  await page.getByRole("button", { name: "Save route", exact: true }).click();
  const route = page.getByRole("region", { name: "Dates and city route" });
  await route.getByText(/Travel between cities/).click();
  const times = route.getByRole("form", { name: "Travel times 1" });
  await times.getByLabel("Departure time", { exact: true }).fill("09:00");
  await times.getByLabel("Arrival time", { exact: true }).fill("08:00");
  await times.getByRole("button", { name: "Save travel times" }).click();
  await expect(times.getByRole("alert")).toContainText("Arrival must be after departure");
  await times.getByLabel("Arrival time", { exact: true }).fill("12:00");
  await times.getByRole("button", { name: "Save travel times" }).click();
  await expect(route.getByText(/Travel between cities/)).toContainText("1 of 1 timed");
  await page.getByRole("button", { name: "Day 4", exact: true }).click();
  const journey = page.getByRole("region", { name: "Your floating day journey" });
  await expect(journey.getByRole("complementary", { name: "Reserved travel time" })).toContainText(
    "180 min reserved",
  );
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const calendar = page.getByRole("region", { name: "Trip calendar" });
  await expect(calendar.getByRole("complementary", { name: "Reserved travel time" })).toContainText(
    "2028-07-13 12:00 Europe/Lisbon",
  );
  await page.getByRole("button", { name: "Travel pack", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Calendar file/ }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString();
  expect(text).toContain("DTSTART:20280713T080000Z");
  expect(text).toContain("DTEND:20280713T110000Z");
  expect(text).toContain("TRANSP:OPAQUE");
  await page.reload();
  await expect(route.getByText(/Travel between cities/)).toContainText("1 of 1 timed");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(route.getByText(/Travel between cities/)).toContainText("0 of 1 timed");
});

test("travel times reject existing departure conflicts and remain usable at phone width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 950 });
  await page.goto("/studio");
  await page.getByRole("button", { name: "Explore my Lisbon" }).click();
  await page.getByRole("button", { name: "Edit dates & cities" }).click();
  await page.getByLabel("Trip start date").fill("2028-07-10");
  await page.getByRole("button", { name: "Add city", exact: true }).click();
  await page.getByLabel("City 2", { exact: true }).selectOption("porto");
  await page.getByRole("button", { name: "Save route", exact: true }).click();
  const route = page.getByRole("region", { name: "Dates and city route" });
  await route.getByText(/Travel between cities/).click();
  const times = route.getByRole("form", { name: "Travel times 1" });
  await times.getByLabel("Departure date", { exact: true }).fill("2028-07-12");
  await times.getByLabel("Departure time", { exact: true }).fill("09:30");
  await times.getByLabel("Arrival time", { exact: true }).fill("12:00");
  await times.getByRole("button", { name: "Save travel times" }).click();
  await expect(times.getByRole("alert")).toContainText("conflicts with your entered travel times");
  await expect(route.getByText(/Travel between cities/)).toContainText("0 of 1 timed");
  await times.getByLabel("Departure time", { exact: true }).fill("22:00");
  await times.getByRole("button", { name: "Save travel times" }).click();
  await expect(route.getByText(/Travel between cities/)).toContainText("1 of 1 timed");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

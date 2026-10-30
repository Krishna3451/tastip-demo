"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { IllustratedJourneyScene, type JourneySceneNode } from "./journey";

export type DayIsland = {
  id: string;
  label: string;
  city: string;
  date: string | null;
  visits: number;
  number?: number;
  /** Presentation comes from an actual visit, never the day's city alone. */
  category?: JourneySceneNode["category"];
  landmark?: JourneySceneNode["landmark"];
};
type Props = {
  days: DayIsland[];
  selectedDayId: string;
  focused: boolean;
  onSelect: (id: string) => void;
};

export function DayIslandScene({ days, selectedDayId, focused, onSelect }: Props) {
  const viewport = useRef<HTMLElement>(null);
  const dayKey = days.map((day) => day.id).join(":");
  const nodes = useMemo<JourneySceneNode[]>(() => {
    const visible = focused ? days.filter((day) => day.id === selectedDayId) : days;
    return visible.map((day, index) => ({
      id: day.id,
      name: day.city,
      category: day.category ?? "outdoors",
      landmark: day.landmark,
      time: "",
      duration: 0,
      pinned: false,
      timeLocked: false,
      day: {
        label: day.label,
        city: day.city,
        visits: day.visits,
        number: day.number ?? index + 1,
      },
    }));
  }, [days, selectedDayId, focused]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: New page of days starts at the bottom of the ascending path.
  useLayoutEffect(() => {
    const element = viewport.current;
    const world = element?.firstElementChild;
    if (!element || !world) return;
    let pending = true;
    const align = () => {
      if (!pending || (!focused && world?.querySelector(".day-scene-fallback"))) return;
      element.scrollTop = focused ? 0 : element.scrollHeight;
      pending = false;
      observer.disconnect();
    };
    const observer = new ResizeObserver(align);
    // Fallback CSS temporarily collapses the world. Wait for its real canvas size.
    observer.observe(world);
    observer.observe(element);
    align();
    return () => observer.disconnect();
  }, [focused, dayKey]);
  const fallback = (
    <div className="day-scene-fallback">
      <span aria-hidden="true">✦</span>
      <p>Your days are ready to explore.</p>
      <small>
        {focused
          ? "Your selected day’s complete schedule is open. Use the day buttons to keep exploring."
          : "Choose a day below to open its timeline. The 3D view is unavailable here."}
      </small>
    </div>
  );
  return (
    <section
      className={`day-island-scene${focused ? " is-focused" : ""}`}
      aria-label="Floating day islands"
      data-day-count={days.length}
    >
      <section
        ref={viewport}
        className="day-island-scroll"
        tabIndex={focused ? -1 : 0}
        aria-label={focused ? "Selected day island" : "Day path, scroll up for later days"}
        style={{
          width: "100%",
          height: "100%",
          overflowY: focused ? "hidden" : "auto",
          overflowX: "hidden",
        }}
      >
        <div
          className="day-island-world"
          style={{
            position: "relative",
            width: "100%",
            height: focused ? "100%" : Math.max(480, days.length * 220 + 80),
          }}
        >
          <IllustratedJourneyScene
            nodes={nodes}
            selectedId={selectedDayId}
            onSelect={onSelect}
            dayKey={`${focused ? "focused" : "overview"}:${dayKey}`}
            focused={focused}
            fallback={fallback}
          />
        </div>
      </section>
    </section>
  );
}

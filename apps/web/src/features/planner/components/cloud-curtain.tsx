"use client";

import { useEffect, useState } from "react";

/** Original cloud banks: a short cover, camera travel, then a clear reveal. */
export function CloudCurtain({ arrival = false }: { arrival?: boolean }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const dismiss = () => setVisible(false);
    if (motion.matches) {
      dismiss();
      return;
    }
    const timer = window.setTimeout(dismiss, 900);
    const onMotionChange = () => {
      if (motion.matches) dismiss();
    };
    motion.addEventListener("change", onMotionChange);
    return () => {
      window.clearTimeout(timer);
      motion.removeEventListener("change", onMotionChange);
    };
  }, []);
  if (!visible) return null;
  return (
    <div className={`cloud-curtain${arrival ? " cloud-curtain-arrival" : ""}`} aria-hidden="true">
      <div className="cloud-bank cloud-bank-north" />
      <div className="cloud-bank cloud-bank-east" />
      <div className="cloud-bank cloud-bank-south" />
      <div className="cloud-bank cloud-bank-west" />
      <div className="cloud-heart" />
    </div>
  );
}

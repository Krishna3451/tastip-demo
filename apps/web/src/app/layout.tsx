import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "@/features/planner/styles/index.css";
import "@/features/reference/reference.css";
import "@/features/reference/reference-dialogs.css";
import "@/features/reference/reference-workspaces.css";
import "@/features/reference/reference-navigation.css";
import "@/features/reference/reference-settings.css";
import "@/features/reference/reference-trip.css";
import "@/features/reference/reference-media.css";
import "@/features/reference/discovery-frame.css";

const ui = Geist({ subsets: ["latin"], variable: "--font-ui" });

export const metadata: Metadata = {
  title: "Tastip — Your personal travel assistant",
  description:
    "Plan, explore and keep your travel ideas together with a personal travel assistant powered by Qloo.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={ui.variable}>{children}</body>
    </html>
  );
}

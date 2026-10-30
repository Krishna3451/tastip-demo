import { notFound } from "next/navigation";
import { Planner } from "@/features/planner/planner";
import { ReferenceApp } from "@/features/reference/reference-app";

const ROUTES = new Set([
  "home",
  "discover",
  "settings",
  "profile",
  "trips",
  "chats",
  "chat",
  "calendar",
  "receipts",
  "saved",
  "explore",
  "inspiration",
  "create",
  "updates",
  "agents",
  "agents/manage",
  "setup",
  "about",
  "help",
  "contact",
  "terms",
  "privacy",
]);
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspace: string[] }>;
}) {
  const { workspace } = await params;
  const path = workspace.join("/");
  if (!ROUTES.has(path) && !/^(trip|chat)\/[A-Za-z0-9-]{1,80}$/.test(path)) notFound();
  return path === "home" ? <Planner /> : <ReferenceApp />;
}

/** Public browser configuration only; never include server-provider credentials here. */
export type MapsConfiguration =
  | { enabled: false }
  | { enabled: true; provider: "google-maps-3d"; apiKey: string };

# Tastip

**[Try the hosted demo](https://d1nv21gxelnw72.cloudfront.net)**

Tastip turns cultural taste into a travel plan you can review and edit. Start with a world globe, choose city stays, open a day island, and work with that day's complete schedule beside it.

## Try it

1. On the hosted demo, create an account or sign in for live recommendations and AI chat.
2. Choose a destination and confirm a cultural favorite returned by search.
3. Review the proposed itinerary before accepting it. Open day islands, edit visits, and save ideas in private collections.

Sample planning also works without provider keys. Sample venues are fictional and labeled; they are never presented as live recommendations.

## How Qloo drives the plan

Qloo is the recommendation engine. Confirmed favorites across cultural domains, such as music, film and food, become taste seeds for geographically bounded place recommendations. Tastip preserves each returned candidate's destination, query identity and original rank through review, selection and accepted visits. Day suggestions and Explore use the same evidence rather than inventing venues or affinity percentages.

OpenAI supplies streamed conversation and optional voice. Proposed itinerary edits require review and use the same validated command, version and undo rules as manual edits. Qloo supplies cultural relevance; listed facts, entered travel windows and schedule constraints have separate authority.

## Run locally

Requires **Bun 1.4.0** and **Node.js 22.13 or newer** (built-in SQLite).

```sh
bun install --frozen-lockfile
bun run dev
```

Open <http://localhost:3000>. For a separate preview cache, use `bun run preview`.

For live Qloo/OpenAI integrations, copy `apps/web/.env.example` to `apps/web/.env.local` and configure your own server keys locally. Keep them out of Git and `NEXT_PUBLIC_` variables. Provider API access/billing is separate from a ChatGPT subscription. Never paste keys into issues or screenshots.

Google Maps 3D is optional. Its disabled/error state keeps the original globe fallback. A dedicated browser key, Maps JavaScript API, billing, referrer/API restrictions and Google-side quotas are required before explicit activation; see [runtime Maps](docs/maps-runtime.md). Browser map keys are intentionally observable and must never be OpenAI/Qloo server keys.

Hosted provider access defaults off and requires explicit opt-in, an exact HTTPS origin, an authenticated matching account and durable request limits. [Deployment](docs/deployment.md) describes persistent SQLite and trusted-proxy setup; [AWS deployment](docs/aws-deployment.md) contains the optional parameterized hosting workflow.

## What is included

- Globe → city stays → day islands → full day schedule, with keyboard controls, reduced motion and rendering fallback.
- Reviewed Qloo trip creation, day-specific suggestions, contextual chat, editable visits and traveler-added pins.
- Canonical conflict-aware commands, retained drafts, repeat visits, undo, trip dates, entered transfer timing, planned costs and lodging intent.
- Account-owned server trips and Saved collections/notes; account-scoped local conversations and device-local media bytes.
- Leaflet/OpenStreetMap geographic maps with attribution and pointer-anchored wheel zoom; optional Google 3D globe.

Opening hours may be missing or change. A valid internal schedule does not guarantee real-world availability. No bookings, checkout, verified transit timetable, complete trip quote or live group editing is claimed. Media/receipt uploads retain files and metadata; they do not extract receipts or create reservations. See [scope and limits](docs/current-scope.md).

## Verify

```sh
bun run check
bun run build
bun run test:e2e
python3 -m unittest discover -s deploy/aws -p 'test_*.py' -v
```

Run checks and build sequentially. Browser tests use a separate cache and a fresh disposable test database at port 3101. Install Chromium with `bun x playwright install chromium`, or provide `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. The Linux CI container job builds and checks isolated app/proxy containers without provider keys. [Verification](docs/verification.md) explains the boundaries.

## Source layout

| Path                 | Responsibility                                                    |
| -------------------- | ----------------------------------------------------------------- |
| `apps/web`           | Next.js app, accessible product UI, account/server routes         |
| `packages/domain`    | Trip state, commands, validation, undo, synthetic sample data     |
| `packages/providers` | Qloo, OpenAI and routing adapters                                 |
| `packages/scene`     | Globe/island presentation; emits selection, never owns trip state |
| `packages/ui`        | Shared semantic controls                                          |
| `deploy`             | Reproducible container and optional AWS deployment assets         |

See [architecture](docs/architecture.md) and [assets](docs/assets.md). Project-owned contributions are available under the [MIT license](LICENSE); third-party dependencies, geographic data and provider services retain their own terms.

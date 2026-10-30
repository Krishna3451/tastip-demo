# Architecture

The Next.js web app composes domain and provider packages. React DOM owns accessible controls and focus. React Three Fiber renders the original globe and day islands from accepted trip data and emits selection intents; it does not call providers or own itinerary state.

A Place ID identifies a venue; a Stop ID identifies a visit. A repeat visit has its own identity. Commands carry a unique operation ID and base version, validate atomically and retain acknowledgements for idempotent retry. Stale edits fail instead of replacing newer work. Undo remains version guarded.

Qloo resolves confirmed cultural seeds and retrieves geographically bounded candidates. Destination, original query identity and rank survive normalization, preview and accepted visits. Chat/voice proposals use the same explicit review and canonical command path; a model response does not silently modify a trip.

Guest drafts and local conversations/media remain scoped to their browser owner. Explicit account saves use owner-scoped SQLite repositories and separate server revisions. Conflicting server/browser histories require reconciliation rather than silent replacement. Read-only itinerary links expose filtered snapshots, not private account records or media bytes.

Server-only provider construction lives under `apps/web/src/server`; route handlers validate bounded requests before invoking adapters. Hosted paid routes default off and require an exact configured HTTPS origin, a current authenticated session, matching rendered-owner identity and durable limits. A trusted internal origin is explicit configuration, never forwarded-header authority. Client cancellation rejects stale output; provider-side work cancellation is best effort.

Geographic maps retain provider attribution. Route estimates and listed opening windows are advisory, not bookings or verified current availability. Rendering, cultural relevance, practical facts and schedule constraints have separate authority.

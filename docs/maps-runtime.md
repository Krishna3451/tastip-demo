# Runtime Google 3D map configuration

The Google map remains optional. A missing/disabled/denied configuration uses Tastip's existing globe fallback. Configuration availability is not proof of working Google billing, imagery coverage or pointer-anchored zoom.

## Server contract

- `GET /api/maps/config`, using the existing rendered-owner `useProviderFetch()` helper, returns either `{ "enabled": false }` or `{ "enabled": true, "provider": "google-maps-3d", "apiKey": "<dedicated browser key>" }`.
- The route reads `TASTIP_ENABLE_GOOGLE_MAPS=1` and `GOOGLE_MAPS_BROWSER_KEY` at request time. It is dynamic and `no-store`; no key is baked into the Next.js image or read from `NEXT_PUBLIC_` variables.
- Hosted access retains the exact HTTPS app/internal-origin configuration, same-origin source, actual account session and matching rendered owner required by existing provider policy. Loopback development also requires same-origin source metadata, with equivalent loopback hostnames permitted on the same protocol/port. Denied callers receive only the disabled response.
- This is a capability read: no Google request, provider inference, quota consumption or itinerary mutation occurs. Database access, if needed, only resolves the existing account session. It never serializes the server environment. Misassigning the configured OpenAI/Qloo server key as the browser key fails closed.

## UI integration

The UI uses `features/planner/lib/use-maps-configuration.ts` to fetch once for the current ready rendered-owner transport. Its five-second AbortSignal covers the response body; identity changes invalidate the result during render, abort prior work and ignore late bodies. The planner supplies explicit `enabled`/`apiKey` props to `GoogleGlobe` and remounts it for owner/eligibility/key changes. Disabled/error/unready results are authoritative: no `NEXT_PUBLIC_` fallback or hostname-only activation remains. The existing visual/accessible fallback, camera, reduced motion and attribution rectangle are preserved.

`tests/e2e/maps-runtime.spec.ts` intercepts the SDK with an explicitly synthetic implementation. It covers non-prototype development-host activation at 375/1440px, disabled/error/malformed configuration, unready/changed owners, late bodies, timeout, post-ready SDK authentication-failure fallback, removal and key rotation. These tests make no actual Google requests; hosted HTTPS/session admission is independently covered by the server security-contract suite. They do not verify Google billing, imagery or real pointer-anchored zoom.

The SDK loader pins one key per page. A runtime key rotation requires a reload; do not borrow another integration's key. Live Google interaction still needs direct verification with the SDK, including ordinary wheel/pinch anchoring, selected-place camera movement, coverage and fallback on errors.

## Activation

1. In the correct Google project, enable Maps JavaScript API and billing. Restrict a dedicated browser key to that API and the intended localhost/hosted website referrers; configure Google-side quotas and budget monitoring.
2. Put that key in the private server runtime environment as `GOOGLE_MAPS_BROWSER_KEY`, then explicitly set `TASTIP_ENABLE_GOOGLE_MAPS=1`. Hosted configuration additionally requires the existing hosted-provider opt-in and exact origin/session policy.
3. Restart the server/container with the updated runtime environment; the immutable image does not need rebuilding for a key change. Test the actual map before claiming it works. To disable new configuration reads, clear the flag/key and restart; an already-loaded public browser key must be revoked/restricted in Google if immediate revocation is needed.

Browser keys are observable by design. This endpoint's sign-in gate is not a substitute for Google's API/referrer restrictions, quotas or key revocation, and does not impose a hard cap on Google map usage. Google bills actual map loads independently of Tastip's server-provider request limits. Budget alerts alone are not spending caps.

## AWS runtime file

After mounting the persistent volume, the AWS helper reads the optional root-owned
`/srv/tastip/config/maps-public.json` before writing runtime files or stopping the
old application. Its exact JSON fields are `enabled` (boolean) and `apiKey` (string).
For example, a disabled file is:

```json
{ "enabled": false, "apiKey": "" }
```

The parent directory must be a nonsymlink directory owned by UID 0 with mode `0700`;
the file must be a regular nonsymlink file owned by UID 0 with mode `0600`, at most
2 KiB. Unknown/duplicate fields, malformed JSON and unsafe permissions fail closed.
Keys are limited to 256 ASCII letters, digits, underscores or hyphens, with no
whitespace/control characters; enabling requires a nonempty key. The file is parsed
as JSON, never sourced as shell/environment text, and its contents are not logged.

Missing configuration explicitly produces `TASTIP_ENABLE_GOOGLE_MAPS=0` and an empty
`GOOGLE_MAPS_BROWSER_KEY`; disabled configuration also clears the runtime key. An
invalid present configuration aborts before replacing existing runtime files or
stopping the previous release. There is no fallback to stale environment/build keys.
Start/release must run the updated helper for this file to affect container settings.

This file is outside the app's `/data` directory. Stopped app-data copies do not
include it: keep its own versioned backup or a covering volume snapshot when changing
it, including during a rollback. The two-key SSM allowlist and instance IAM are
unchanged; only OpenAI/Qloo server keys come from SecureString. No upload/staging CLI
is added here. This configuration does not enable Google billing/APIs, provision
resources, apply key restrictions, or prove that MapsJS3D renders successfully.

References: [Google API security](https://developers.google.com/maps/api-security-best-practices), [MapsJS3D](https://developers.google.com/maps/documentation/javascript/3d/overview), [pricing](https://developers.google.com/maps/billing-and-pricing/pricing).

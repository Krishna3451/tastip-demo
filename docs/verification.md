# Verification

Run from a fresh checkout with the pinned Bun runtime:

```sh
bun install --frozen-lockfile
bun run check
bun run build
bun x playwright install chromium
bun run test:e2e
python3 -m unittest discover -s deploy/aws -p 'test_*.py' -v
```

Run `check` and `build` sequentially because Next type generation shares build metadata. E2E starts its own local server/cache and a disposable private database. Set `TASTIP_E2E_PORT` for an unused alternate port or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for an existing compatible Chromium installation.

Tests cover domain/version/undo invariants, provider normalization/evidence, request admission/owner isolation, persistence/reconciliation, cancellation, accessible navigation and browser editing flows. Provider fixtures are synthetic and clearly identified. Synthetic SDK/voice tests do not prove real Google imagery, physical microphone acceptance or current provider credentials.

The independent Linux CI container job runs `python3 scripts/smoke-container.py --allow-disposable-cleanup`. It builds the pinned app and capability-free proxy, creates only a uniquely named disposable Compose project/data directory, verifies SQLite/account/Saved isolation and persistence across recreation, then removes only its own temporary resources. It uses empty provider keys and makes no actual provider inference call. A working Docker daemon is required.

Before a hosted release, verify actual HTTPS cookies, sign-in, owner isolation, save/reload, static assets, the primary globe/islands/schedule flow, streaming Stop and private backup/recovery. Live Google billing/coverage, physical microphone behavior and real-model proposals need their own explicit acceptance checks. Automated passing tests are not a claim that those external services are configured.

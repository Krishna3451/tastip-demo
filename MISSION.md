# Maintainer status

This is the clean public demo source for Tastip. The primary experience is globe → city stays → day islands → selected-day schedule. Qloo remains the recommendation engine; OpenAI chat/voice can propose reviewed changes through the same canonical commands as manual edits.

The [README](README.md) contains the hosted demo, local setup and checks. [Scope](docs/current-scope.md), [verification](docs/verification.md) and [deployment](docs/deployment.md) document the implementation boundaries. Optional Google Maps requires its own correctly configured browser key, billing and restrictions; the app retains a fallback.

Maintain account isolation, source/query/rank evidence, explicit review, version checks, undo, accessibility and honest unknown facts. Never commit credentials, provider-response captures, account databases, personal media or test traces.

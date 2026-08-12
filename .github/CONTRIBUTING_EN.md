# Contributing Guide

> 中文版：[CONTRIBUTING.md](CONTRIBUTING.md)

## What this project welcomes

- 🐛 Bug fixes and edge-case hardening
- 🌡️ Accuracy improvements to the rule engine (scoring / usage / verdicts) — **must include a diagnosis or test**
- 🈶 Additions and corrections to the Chinese perfume-name, brand, and accord mappings
- 📝 Docs, copy, accessibility, and i18n improvements
- ✨ New capabilities aligned with the product's positioning (open an issue first if the proposal moves the product boundary)

Not a good fit: see the Four Commandments below and the "no" list under Governance.

## Before you start: the Four Commandments (hard constraints)

Every contribution must uphold these (full text and rationale in the [README](../README.md#四条戒律), in Chinese):

1. **No false precision** — longevity, sprays, and social distance are given only as ranges and tiers.
2. **No over-engineering** — no vector DB, no heavy backend; one concept, one criterion, in one place.
3. **Light cold-start** — search a name to add a bottle; no mandatory questionnaire.
4. **Closed feedback loop** — users must be able to rate and correct any new recommendation or judgment, and the feedback must have a testable consumption path.

## Architecture notes

- **The rule engine decides; the LLM only puts it into words.** Match scoring and the sprays / distance / longevity verdicts must come from deterministic rules (explainable, reproducible, unit-testable); DeepSeek only parses natural-language scenarios and turns the computed facts into plain language.
- **Weather always comes from the QWeather API — never invented by the LLM.**
- **Graceful degradation first** — DeepSeek timeouts and weather/geolocation failures must have fallbacks; core recommendations still work and the product never shows a blank screen.
- **Prefer the local rules and static data that already exist**; justify any new infrastructure.

The domain evidence behind the rules is in [领域规则手册](../docs/领域规则手册.md); read [声音与文案](../docs/声音与文案.md) before changing any user-visible wording. Both are in Chinese.

## Local development

Requires **Node 24** (Active LTS). `engines.node` in `package.json` is the source of truth — Vercel reads it directly and it overrides the dashboard setting; CI's `node-version` is kept on the same major. Installing under another major prints an `EBADENGINE` warning.

```bash
git clone https://github.com/MrBaoboer/FenCun.git
cd FenCun
npm ci
cp .env.example .env.local   # optional: only needed to exercise live weather or DeepSeek
npm run dev                  # http://localhost:3000
```

It runs without keys: weather falls back to season + time of day, and explanations fall back to rule templates. See the [directory structure](../README.md#目录结构) section of the README (Chinese).

## Pre-submit checklist

```bash
npm run lint    # code style
npm test        # unit tests — must pass if you touched the engine, journal, search, store, nudges, or the API routes; add cases too
npm run build   # make sure it builds
```

Docs-only PRs can skip these three, but do check them yourself: links resolve, commands run, terminology matches `format.ts`, and the Chinese and English files still say the same thing.

## Commit conventions

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `polish:`, and so on. Writing commit bodies in Chinese is perfectly fine — it matches the existing history.
- Signing off your commits is **encouraged, not required**:

  ```bash
  git commit -s -m "fix: ……"
  ```

  `-s` adds a `Signed-off-by` line, certifying under the [Developer Certificate of Origin](https://developercertificate.org/) that you have the right to submit the code. CI does not check it.

## Pull request flow

1. Branch off `main`; keep commits focused and traceable.
2. Describe the **motivation** and **how you verified** the change; if you touched the engine, attach a before/after comparison or tests.
3. Target branch is `main`; CI / build must pass.

## Governance

- **Who decides**: FenCun is maintained by a single person, [@MrBaoboer](https://github.com/MrBaoboer). The maintainer owns the product scope, deploy cadence, domain, and merge rights, and may close PRs that go out of scope, carry too much risk, or lack verification.
- **What does not go into `main`** (the "no" list): no shopping / e-commerce, no ingredient encyclopedia, no social features, no account system, and nothing that drifts from the "fragrance-usage decision + distribution" core. Even elegant implementations of these won't be merged. The current scope and deferred items are in the [product plan](../docs/氛寸-产品方案.md) (Chinese).
- **This section itself can be changed via PR**.

## Licensing of contributions

Unless a file carries different licensing information, by submitting a contribution you agree that it is licensed under this project's **AGPL-3.0-only** license and the Section 7 additional terms in [LICENSE](../LICENSE).

## Code of Conduct

Participation in this project implies agreement with the [Code of Conduct](CODE_OF_CONDUCT_EN.md).

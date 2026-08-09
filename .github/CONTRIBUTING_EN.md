# Contributing Guide

> 中文版：[CONTRIBUTING.md](CONTRIBUTING.md)

Thanks for your interest in improving **氛寸 / FenCun**.

## What this project welcomes

- 🐛 Bug fixes and edge-case hardening
- 🌡️ Accuracy improvements to the rule engine (scoring / usage / verdicts) — **must include a diagnosis or test**
- 🈶 Additions/corrections to the Chinese perfume-name & accord mappings
- 📝 Docs, copy, accessibility, and i18n improvements
- ✨ New capabilities aligned with the product's positioning (open an issue first)

**Not a good fit**: see the Four Commandments below and the "no" list under Governance.

## Before you start: the Four Commandments (hard constraints)

Every contribution must uphold these:

1. **No false precision** — longevity / sprays / social distance are given only as ranges and tiers, never fake numbers like "6.2 hours."
2. **No over-engineering** — no vector DB, no heavy backend; the rule engine runs locally in the browser in milliseconds.
3. **Light cold-start** — search a name to add a bottle; no mandatory questionnaire.
4. **Closed feedback loop** — users must be able to rate and correct any new recommendation or judgment.

## Architecture notes

- **The rule engine decides; the LLM only puts it into words.** Match scoring and the sprays / distance / longevity verdicts must come from deterministic rules (explainable, reproducible, unit-testable); DeepSeek only parses natural-language scenarios and turns the computed facts into plain language.
- **Weather always comes from the QWeather API — never invented by the LLM.**
- **Graceful degradation first** — LLM timeouts and geolocation failures must have fallbacks; the product never shows a blank screen.

## Local development

Requires **Node 24** (Active LTS). `engines.node` in `package.json` is the source of truth — Vercel reads it directly and it overrides the dashboard setting; CI's `node-version` is kept on the same major. Installing under another major prints an `EBADENGINE` warning.

```bash
git clone https://github.com/MrBaoboer/FenCun.git
cd FenCun
npm install
cp .env.example .env.local   # add your own QWeather / DeepSeek keys
npm run dev                  # http://localhost:3000
```

See the [directory structure](../README.md#目录结构) section of the README (Chinese).

## Pre-submit checklist

```bash
npm run lint    # code style
npm test        # unit tests — must pass if you touched the engine, journal, search, store, nudges, or the API routes; add cases too
npm run build   # make sure it builds
```

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
- **What does not go into `main`** (the "no" list): no shopping / e-commerce, no ingredient encyclopedia, no social features, no account system, and nothing that drifts from the "fragrance-usage decision + distribution" core. Even elegant implementations of these won't be merged.
- **This section itself can be changed via PR**.

## Licensing of contributions

By submitting a contribution, you agree that it is licensed under this project's **AGPL-3.0-only** license.

## Code of Conduct

Participation in this project implies agreement with the [Code of Conduct](CODE_OF_CONDUCT_EN.md).

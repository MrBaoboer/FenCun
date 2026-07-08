# Contributing Guide

> 中文版：[CONTRIBUTING.md](CONTRIBUTING.md)

Thanks for your interest in improving **氛寸 / FenCun**. This guide helps your contribution get merged faster.

## What this project welcomes

- 🐛 Bug fixes and edge-case hardening
- 🌡️ Accuracy improvements to the rule engine (scoring / usage / verdicts) — **must include a diagnosis or test**
- 🈶 Additions/corrections to the Chinese perfume-name & accord mappings
- 📝 Docs, copy, accessibility, and i18n improvements
- ✨ New capabilities aligned with the product's positioning (open an issue first)

**Not a good fit**: turning it into a shopping / e-commerce app, or pulling in heavyweight dependencies (see "The Four Commandments").

## Before you start: the Four Commandments (hard constraints)

Every contribution must uphold these, no matter how elegant it is otherwise:

1. **No false precision** — longevity / sprays / social distance are given only as ranges and tiers, never fake numbers like "6.2 hours."
2. **No over-engineering** — no vector DB, no heavy backend; the rule engine runs locally in the browser in milliseconds.
3. **Light cold-start** — no mandatory questionnaire; search-and-add a bottle and it just works.
4. **Closed feedback loop** — new recommendations / judgments should be rate-able and correctable.

## Architecture notes

- **The rule engine decides; the LLM only puts it into words.** Matching, sprays / distance / longevity must be deterministic rules (explainable, reproducible, unit-testable); DeepSeek only parses natural-language scenarios and puts the computed facts into human-readable language.
- **Weather always comes from the QWeather API — never invented by the LLM.**
- **Graceful degradation first** — LLM timeouts and geolocation failures must have fallbacks; the product never shows a blank screen.

## Local development

```bash
git clone https://github.com/MasterBao66/FenCun.git
cd FenCun
npm install
cp .env.example .env.local   # add your own QWeather / DeepSeek keys
npm run dev                  # http://localhost:3000
```

See the project layout in the README's "目录结构" (directory structure) section.

## Pre-submit checklist

```bash
npm run lint    # code style
npm test        # engine / journal / search unit tests (must pass if you touched the corresponding modules — add cases too)
npm run build   # make sure it builds
```

## Commit conventions

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `polish:` … (Chinese bodies are fine, matching existing history).
- Please **sign off** your commits (DCO — lightweight, no CLA required):

  ```bash
  git commit -s -m "fix: ……"
  ```

  `-s` adds a `Signed-off-by` line, certifying you have the right to submit the code under the [Developer Certificate of Origin](https://developercertificate.org/).

## Pull request flow

1. Branch off `main`; keep commits focused and traceable.
2. Describe the **motivation** and **how you verified** it (engine changes: attach before/after or tests).
3. Target branch is `main`; CI / build must pass.
4. A maintainer will review as soon as possible. Small, clear PRs merge fastest.

## Governance

- **Who decides**: FenCun is maintained by a single person, [@MasterBao66](https://github.com/MasterBao66). The maintainer owns the product scope, deploy cadence, domain, and merge rights, and may close PRs that go out of scope, carry too much risk, or lack verification.
- **What does not go into `main`** (the "no" list): no shopping / e-commerce, no ingredient encyclopedia, no social features, no account system, and nothing that drifts from the "fragrance-usage decision + distribution" core — even elegant implementations of these won't be merged (see also the Four Commandments and Architecture notes above).
- **This section itself can be changed via PR**; before adding a long-term collaborator, this section will first be updated to spell out responsibilities and handover, and only then are permissions granted.

## Licensing of contributions

By submitting a contribution, you agree that it is licensed under this project's **AGPL-3.0-only** license.

## Code of Conduct

Participation in this project implies agreement with the [Code of Conduct](CODE_OF_CONDUCT_EN.md).

# Security Policy

> 中文版：[SECURITY.md](SECURITY.md)

## Supported versions

氛寸 / FenCun is a continuously deployed web app; only `main` and the latest deployed version are maintained.

## Reporting a vulnerability

**Please do not report security issues via public issues.** Use one of these private channels instead:

1. **GitHub private vulnerability reporting** (preferred): this repo's **Security → Report a vulnerability** (private reporting is enabled).
2. **Email**: reach the maintainer privately via the email published on [@MrBaoboer](https://github.com/MrBaoboer)'s GitHub profile; please start the subject with "FenCun security" (or 「氛寸安全」).

Please include, if possible: affected page / endpoint, reproduction steps, impact assessment, and a PoC if available. Please also allow a reasonable **coordinated-disclosure** window.

## What to expect

- Acknowledge receipt **within 72 hours**.
- Share the severity assessment and remediation plan with you.
- Credit you in the acknowledgements after the fix ships, if you wish.

## Attack surface

FenCun deliberately keeps a thin backend, so the attack surface is small:

- **No backend database** — the library, journal, and feedback live only in the user's browser `localStorage`; no user data is stored server-side.
- **Server-side secrets** — QWeather / DeepSeek keys are used only in server Route Handlers and never sent to the client.
- **API proxies** — `/api/context`, `/api/explain`, `/api/parse-intent` have built-in rate limiting and graceful degradation; `/api/explain` and `/api/parse-intent` additionally cap input length.

So the most valuable areas to look at are usually: the abuse / injection surface of the proxy routes, dependency-chain vulnerabilities, and any path that could leak server-side secrets.

## Scope

- **In scope**: this repository's code, API routes, and build output.
- **Out of scope**: vulnerabilities in third-party services themselves (DeepSeek, QWeather, Vercel) — please report those to the respective vendors; and denial-of-service / stress testing against the live site.

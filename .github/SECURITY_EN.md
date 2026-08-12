# Security Policy

> 中文版：[SECURITY.md](SECURITY.md)

## Supported scope

FenCun is continuously deployed. Only `main` and the latest deployed version are maintained.

In scope: this repository's code, API routes, and build output.

Out of scope: vulnerabilities in third-party services such as DeepSeek, QWeather, or Vercel, and denial-of-service or stress testing against the live site. Report third-party vulnerabilities to the relevant vendor.

## Reporting a vulnerability

Do not open a public issue. Use either of these private channels:

1. GitHub private vulnerability reporting under **Security → Report a vulnerability** in this repository.
2. Email the maintainer at the address published on [@MrBaoboer](https://github.com/MrBaoboer)'s GitHub profile. Start the subject with `FenCun security` or 「氛寸安全」.

Include the affected page or endpoint, reproduction steps, impact assessment, and a PoC when available. Allow a reasonable coordinated-disclosure period before the fix is published. After acknowledging the report, the maintainer will share the assessment and remediation plan. If a fix is released, the reporter can be credited on request.

## Architecture notes

- The perfume library, journal, and feedback are stored in the browser's `localStorage`; there is no persistent server-side user database.
- QWeather and DeepSeek credentials are used only by server-side Route Handlers and are not sent to the browser.
- `/api/context`, `/api/explain`, and `/api/parse-intent` all have rate limiting and graceful degradation; `/api/explain` and `/api/parse-intent` additionally cap input length.

The most valuable areas to look at are therefore the abuse and injection surface of those three proxy routes, any path that could leak server-side credentials, and the dependency chain and build output.

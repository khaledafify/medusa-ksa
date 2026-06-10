# Security Policy

We take the security of the Medusa KSA suite seriously. These packages handle payments, encrypted ZATCA credentials, and webhook signatures, so responsible disclosure genuinely protects downstream stores.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.** A public report exposes the issue before a fix is available.

Instead, report privately by email to:

> **ikhaledayed@gmail.com**

Please include, as much as you can:

- The affected package(s) and version(s).
- A description of the vulnerability and its impact.
- Steps to reproduce, a proof of concept, or sample configuration.
- Any suggested remediation.

If you prefer, you can also use GitHub's private ["Report a vulnerability"](https://github.com/khaledafify/medusa-ksa/security/advisories/new) flow to open a draft security advisory.

## What to expect

- **Acknowledgement** within 3 business days.
- An initial assessment and severity triage within 7 business days.
- Coordinated disclosure: we will work with you on a fix, publish a security advisory, and credit you (if you wish) once a patched version is released. Please give us reasonable time to ship a fix before any public disclosure.

We will not pursue legal action against good-faith research that respects this policy and avoids privacy violations, service degradation, or data destruction.

## Supported versions

This is an actively maintained monorepo of independently versioned packages. Security fixes land on the **latest published minor of each package**; please upgrade to the most recent release before reporting, as the issue may already be fixed.

| Version | Supported |
|---|:---:|
| Latest published minor (each package) | ✅ |
| Older minors | ❌ — upgrade to the latest minor |

Because the suite targets a rolling **Medusa v2** baseline, we do not backport fixes to versions built against unsupported Medusa releases.

## Handling secrets safely

A reminder for operators, since it intersects with security:

- Provider API keys live in your `.env` / `medusa-config.ts`, never in the admin UI or in source control.
- ZATCA CSID credentials are **generated** and stored **encrypted** in your database — they are never pasted into env and never logged.

If you believe a package logs a secret, leaks a credential, or mishandles a webhook signature, treat it as a security report and use the private channel above.

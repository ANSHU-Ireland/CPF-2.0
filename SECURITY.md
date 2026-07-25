# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the maintainers
(security contact to be published with the hosted deployment — until then, use
GitHub private vulnerability reporting on this repository).

Do **not** open public issues for security reports.

We aim to acknowledge reports within 2 business days.

## Scope

- Authentication, authorisation, and tenant-isolation weaknesses
- Personal-data exposure, injection, deserialisation, SSRF, XSS, CSRF
- Evidence-integrity weaknesses (audit-log tampering, score manipulation)
- Dependency and supply-chain issues

## Out of scope

- Findings on the legacy CPF demo repository (superseded; not deployed)
- Denial of service against local development environments

## Handling

Confirmed vulnerabilities are tracked in the security risk register
(docs/security/threat-model.md), fixed on a priority branch, and disclosed in
release notes after remediation.

## Supported versions

Pre-release (`0.x`): only the `main` branch receives security fixes.

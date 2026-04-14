# Security Policy

## Supported Versions

MarkCanvas is currently pre-`1.0`.
Security fixes are handled on a best-effort basis for the latest code on `main`.
Older snapshots and unpublished local builds should be considered unsupported unless maintainers explicitly state otherwise.

## Reporting a Vulnerability

Please avoid opening a public issue for suspected security vulnerabilities.

Preferred process:

1. Use GitHub private vulnerability reporting for this repository if it is enabled.
2. If private reporting is not available, open a public issue only to request a private contact path, and do not include exploit details, proof-of-concept code, or sensitive impact information.

Please include:

- A description of the issue
- Affected versions, commits, or branches when known
- Reproduction steps or a proof of concept
- Impact assessment
- Any mitigations or workarounds you have identified

## Response Expectations

- Initial acknowledgment target: within 5 business days
- Status updates: when investigation or remediation materially changes
- Public disclosure: after a fix or mitigation is available, or after maintainers and reporter agree on a coordinated disclosure timeline

## Scope Notes

Security reports are especially helpful for issues involving:

- Webview content injection or sandbox bypass
- Unsafe resource loading
- Unexpected file access
- Command execution paths
- Dependency vulnerabilities with a realistic impact on this extension

# Security policy

Lumicos is an early public snapshot. No version has a formal security-support SLA or independent security certification. Please report issues against the current public commit and say whether they reproduce with a clean setup.

## Report privately

**Do not open a public issue with a vulnerability, exploit steps, credentials or personal data.** On 30 October 2026, GitHub private vulnerability reporting was disabled and no verified maintainer security email was listed.

If the repository Security tab offers **Report a vulnerability**, use it. Otherwise, open only a minimal issue such as “Please enable private vulnerability reporting” with **no technical details, logs or secrets**. Wait for the owner to enable a private channel before sending the report. Do not guess an email address or send sensitive material to unrelated accounts. The owner must activate a channel before launch; this branch does not enable settings automatically.

In the private report include the affected commit/platform, impact, minimal synthetic reproduction, prerequisites and suggested mitigation. Redact credentials and use non-sensitive samples. If a real credential was exposed, revoke/rotate it first; deleting a file does not invalidate copies or history.

## Trust boundaries

- Inference and stored data are local by design. Optional search, downloads and sandbox internet access leave the machine. Do not claim full offline operation without preparing assets and disabling network features.
- Local loopback services are not permission to expose raw model, ComfyUI or application ports to the internet. The optional remote gateway has a separate authentication/configuration model requiring review.
- File/path checks, approval rules and AppContainer isolation reduce risks; they are not a guarantee against all prompt injection or hostile generated code. Agent output and downloaded packages remain untrusted.
- Keep private chats, memory/workspace files, hardware reports and environment configuration out of Git and public screenshots.

See the scoped [repository review](docs/SECURITY_REVIEW.md). It is not a penetration test or a dependency-vulnerability clearance.

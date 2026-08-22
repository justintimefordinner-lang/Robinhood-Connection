# Security Policy

This is a personal, self-hosted project. By design the data bridge is
**read-only** toward your Robinhood account — it reads positions and market data
but cannot place trades. Every secret stays on your own machine: your Robinhood
username/password (and the optional TOTP secret for unattended runs) live only in
the git-ignored `databridge/.env`. The dashboard writes those credentials to that
file **write-only** — it never reads the password back, and never logs it.

## Reporting a vulnerability

If you find a security issue — especially anything that could expose Robinhood
credentials, the session/token cache, or account data — please report it
**privately** rather than opening a public issue.

- Preferred: this repository's **Security** tab → **Report a vulnerability**
  (GitHub private vulnerability reporting).

Please include clear steps to reproduce and the affected file(s). I'll
acknowledge and address confirmed issues as time allows.

This is a hobby project provided **as is, without warranty** (see
[LICENSE](LICENSE.md)). Nothing here is financial advice.

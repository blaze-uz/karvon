# Security policy

## Reporting a vulnerability

Please report security issues privately by opening a
[GitHub Security Advisory](https://github.com/blaze-uz/app-orchestrator/security/advisories/new)
on the repository. Do not file public issues for security bugs.

We will acknowledge receipt within 7 days and aim to ship a fix or mitigation
within 30 days for high-severity issues.

## Threat model

App Orchestrator is a single-user desktop app. It manages local OS processes
and, optionally, remote processes over SSH. The trust boundary is the local
user account: anything that can read the user's app-config directory or
connect to the local HTTP API can execute arbitrary commands as the user.

## HTTP API

The optional HTTP API is disabled by default. When enabled it:

- Binds to `127.0.0.1` by default. Changing the bind host to `0.0.0.0` exposes
  the API to every network the host is connected to. Do this only on trusted
  networks.
- Requires a Bearer token (32 random bytes, hex-encoded) on every protected
  endpoint. The token is persisted in the app config file and never logged in
  full (only a 6-character prefix appears in stdout for diagnostic purposes).
- Allows any origin via CORS but does not echo credentials, so cross-origin
  browser pages cannot send the Authorization header. CLI clients (curl,
  scripts) are unaffected.

The protected endpoints can execute arbitrary commands (process spawn, deploy
scripts, SSH). Treat the API token like an SSH private key.

## SSH

Remote execution uses the system `ssh` client. Host-key validation is set to
`accept-new` (TOFU) — the first connection to an unseen host is accepted and
pinned, subsequent connections require the same key. This is appropriate for
desktop dev tooling on private networks. If you operate over hostile networks,
pre-populate `~/.ssh/known_hosts` before adding a machine to the orchestrator.

## Updater

Release artifacts are signed with a minisign keypair. The public key is
embedded in `src-tauri/tauri.conf.json`. Only artifacts signed with the
matching private key (held by the project maintainers) will be installed by
the in-app updater.

If you fork the project, generate your own keypair and replace both the public
key in `tauri.conf.json` and the updater endpoint URL before shipping releases.
See [CONTRIBUTING.md](CONTRIBUTING.md).

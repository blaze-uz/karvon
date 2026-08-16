# Changelog

All notable changes to Karvon are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A tag-triggered release workflow that builds macOS (both arches) **and
  Windows**, so a release stops depending on whoever cuts it having the right
  machine. It runs on tags only — never on a branch push or a pull request. See
  [docs/releasing.md](docs/releasing.md).
- Optional Apple Developer ID signing and notarization, wired into the same
  workflow. With the secrets unset the bundle is ad-hoc signed exactly as every
  release through 0.3.0 was; set them and the DMG opens by double-click instead
  of requiring right-click → *Open*.

## [0.3.0] — 2026-08-16

### Added

- **Presets.** A preset is a reusable bundle of processes. Setting up a Laravel or
  Rails project meant adding the same four or five processes by hand every time —
  web server, queue worker, scheduler, asset watcher — each with its own command,
  working directory, dependency order and health check. A preset captures that
  shape once, so the next project is one click.
  - Plain JSON files in the app config directory. The API reports the exact path
    it scanned, so you never have to guess where they go.
  - `{{variable}}` substitution in a process's name, command, args, working
    directory and environment. Every variable used must be declared, and a
    variable with no default is required — a half-substituted command is a
    command that runs and does the wrong thing, which is worse than not running.
  - **Applying is all-or-nothing.** The whole preset is validated against the
    target project before anything is written, so a preset whose third process
    collides with an existing key does not leave the first two behind to clean up
    by hand.
  - A broken file never hides the working ones: each is parsed independently and
    failures come back alongside the presets that loaded, each naming its file.
  - `GET /api/v1/presets` and `POST /api/v1/projects/{id}/presets/{preset}`, plus
    the `list_presets` / `apply_preset` commands.
  - See [docs/presets.md](docs/presets.md).

- **launchd-delegated supervision** for externally-managed services. Set
  `launchd { label, domain }` on a process and Karvon stops spawning a child:
  start/stop/restart shell out to `launchctl` (locally, or over SSH to the
  project's machine), and a monitor mirrors real status from `launchctl list`
  alongside the HTTP health check. launchd stays the supervisor — so the service
  survives a reboot and keeps its `KeepAlive` — while Karvon is the truthful
  control panel. This removes the two-supervisors-fighting failure mode, where
  duplicate-spawn storms and wedged status came from both sides believing they
  owned the process. `restart_process` delegates to `kickstart -k`, so
  `autoRestartOnDeploy` correctly restarts launchd jobs after a deploy.

### Changed

- Dependency updates: tokio 1.53.1, serde 1.0.229, serde_json 1.0.151, nix
  0.31.3, tauri-plugin-dialog 2.7.2, lucide-react 1.28.0, TypeScript 7.0.2,
  @vitejs/plugin-react 6.0.5, @types/node 26.1.2.

### Note on platforms

This release ships **macOS builds only** (Apple Silicon and Intel). The 0.2.0
Windows installer was produced by a CI job that no longer exists, and a Windows
NSIS bundle cannot be cross-compiled from macOS. Windows users stay on 0.2.0 and
will not be offered this update until a Windows builder is back.

## [0.2.0] — 2026-06-20

See the [0.2.0 release](https://github.com/blaze-uz/karvon/releases/tag/v0.2.0).

## [0.1.0] — 2026-06-13

Initial release.

[Unreleased]: https://github.com/blaze-uz/karvon/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/blaze-uz/karvon/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/blaze-uz/karvon/compare/0.1.0...v0.2.0
[0.1.0]: https://github.com/blaze-uz/karvon/releases/tag/0.1.0

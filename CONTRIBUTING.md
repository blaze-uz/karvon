# Contributing

Thanks for your interest in Karvon. This document covers local setup,
the dev loop, and what to change if you fork the project to ship your own builds.

## Local setup

Prerequisites:

- macOS (this is a macOS-only desktop app)
- Node.js LTS and npm
- Rust stable + Cargo (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- Xcode Command Line Tools

```bash
npm install
npm run tauri:dev    # full Tauri app (Rust + React)
npm run dev          # frontend only, with a mock runtime in the browser
```

The browser-only mode at <http://127.0.0.1:1420> uses a mock adapter so you can
iterate on the UI without launching native processes.

## Project layout

| Path | Contents |
|---|---|
| `src/` | React + TypeScript frontend |
| `src/lib/api.ts` | Tauri command wrappers |
| `src/lib/mockApi.ts` | Browser-mode mock adapter |
| `src-tauri/src/` | Rust backend |
| `src-tauri/src/commands.rs` | Tauri command handlers |
| `src-tauri/src/http_api.rs` | Optional HTTP API |
| `src-tauri/src/process_manager.rs` | Local process lifecycle |
| `src-tauri/src/deploy.rs` | Deploy pipeline runner |
| `src-tauri/src/ssh_executor.rs` | Remote command execution |
| `docs/ARCHITECTURE.md` | High-level architecture |

## Build & install locally

```bash
npm run desktop:build      # produces a signed .app + .dmg in src-tauri/target/release/bundle
npm run desktop:install    # copies the .app to /Applications and reopens it
```

`desktop:build` looks for a minisign signing key at `~/.tauri/karvon.key`.
If the file is absent, the build silently skips the updater tarball so the .app
and .dmg still produce.

## Forking the project

If you publish your own builds, change these before tagging a release:

1. **Bundle identifier** — `src-tauri/tauri.conf.json` (`identifier`) and
   `scripts/desktop-install.mjs` (`bundleIdentifier`). Pick a reverse-DNS name
   you control (e.g. `com.example.karvon`).
2. **Updater public key** — generate a new minisign keypair, replace the
   `plugins.updater.pubkey` field in `tauri.conf.json` with your public key
   (base64), and keep the private key secret.
3. **Updater endpoint** — `plugins.updater.endpoints` and the `latest.json` URL
   in `README.md` point at the original repo. Change them to your fork's
   release path.
4. **Release workflow secrets** — add `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets in GitHub for your
   fork. `…_PASSWORD` may be empty if your key has no passphrase.

## Pull requests

- Run `cargo check` in `src-tauri/` and `npx tsc --noEmit` in the repo root
  before pushing.
- Keep the change focused. If you spot unrelated bugs while working, open
  separate issues rather than bundling them.
- For UI changes, attach a screenshot or short clip.
- For security-relevant changes, see [SECURITY.md](SECURITY.md) for the
  threat-model context.

## Code style

- Rust: standard `rustfmt` (no custom config). Prefer `Result<_, ApiError>`
  over panicking at the command boundary.
- TypeScript: explicit types at public API boundaries; let inference do the
  rest. React function components only.
- No comments restating what the code does — only the *why* when it isn't
  obvious.

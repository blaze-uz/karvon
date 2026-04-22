# Local Project Orchestrator

macOS desktop app for managing local projects and their processes from one orchestration panel.

## Stack

- Tauri v2
- React + TypeScript + Vite
- Zustand
- Virtualized log rendering with `@tanstack/react-virtual`
- JSON config persistence in the Tauri app config directory

## Current MVP

- Workspace/project/process domain model
- Project CRUD and process definition CRUD
- Process start/stop/restart command surface
- Project-level start/stop/restart and restart failed
- Event-driven runtime state and live logs
- Basic TCP/HTTP/custom-command health check architecture
- Dashboard, projects, project detail, process detail, logs, settings
- JSON import/export with secret-like env redaction
- Browser mock runtime for UI development without Tauri

## Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:1420/`.

The browser version uses a mock runtime so the UI can be tested without launching native processes.

## Tauri

Tauri requires Rust and Cargo:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
npm run tauri:dev
```

On macOS, Xcode Command Line Tools are also required.

## Build

```bash
npm run build
npm run tauri:build
```

`npm run build` validates TypeScript and produces the frontend bundle. `npm run tauri:build` additionally compiles the Rust native layer and bundles the macOS app.

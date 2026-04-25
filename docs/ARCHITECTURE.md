# App Orchestrator Architecture

App Orchestrator is split into a React presentation layer and a Tauri-native orchestration layer.

## Frontend

- React + TypeScript + Vite
- Zustand stores UI selection, filters, runtime snapshots, and log buffers
- Tauri commands are wrapped in `src/lib/api.ts`
- Browser development falls back to a mock adapter so the UI remains usable without the native shell
- Logs are rendered with virtualization to keep large streams responsive

## Native Layer

- Tauri v2 command API exposes workspace, project, process, runtime, log, health, and utility commands
- Configuration is persisted as JSON in the app config directory
- Process lifecycle ownership stays in Rust; the UI only asks for actions and receives runtime events
- stdout/stderr are streamed to the frontend as `process_log` events
- Runtime state is process-local and cleaned up on app start

## Future Extensions

- Swap JSON persistence for SQLite without changing the command surface
- Add sidecar/helper process for stronger background orchestration
- Add macOS tray/menu commands using the existing aggregate runtime state
- Add project presets for Laravel, Vite, queue workers, schedulers, Python collectors, Node services, Telegram collectors, and YouTube collectors

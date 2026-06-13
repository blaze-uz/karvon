# App Orchestrator

A macOS desktop control panel for the local processes that make up your dev
environment — APIs, queues, schedulers, collectors — plus optional remote
processes over SSH.

> Status: early. The macOS Tauri app is functional, the HTTP API is stable,
> and remote SSH deploys work. There is no Windows/Linux build yet.

## What it does

- Define **projects** as folders with one or more **processes** (commands,
  args, env, working dir, health check, restart policy)
- **Start, stop, restart** processes or whole projects from one panel
- Stream **stdout/stderr logs** with virtualized rendering, filters, and
  full-text search
- **Health checks** over TCP, HTTP, or arbitrary commands
- **Deploy pipelines** — ordered scripts per project, run locally or over SSH
- **Auto-deploy** — poll `git` and rerun the pipeline when the remote branch
  advances
- **Multi-machine** — register remote Macs and route projects/processes to
  them via SSH
- **JSON import/export** of the whole config, with secret redaction
- **Optional HTTP API** for scripting and integrations (disabled by default)

## Install

Grab the latest `.dmg` from
[Releases](https://github.com/blaze-uz/app-orchestrator/releases) or build it
yourself — see [CONTRIBUTING.md](CONTRIBUTING.md).

The app stores its config in
`~/Library/Application Support/uz.blaze.app-orchestrator/`. Replacing the
`.app` does not touch this directory, so updates preserve your projects,
deploy history, and logs.

## Security

App Orchestrator can execute arbitrary local commands and SSH commands on
machines you register. Treat the HTTP API token like an SSH key. See
[SECURITY.md](SECURITY.md) for the threat model and how to report a
vulnerability.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Contributing & forking](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## License

[MIT](LICENSE)

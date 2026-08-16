# Presets

A preset is a reusable bundle of processes. Setting up a Laravel or Rails project
in Karvon means adding the same four or five processes by hand every time — web
server, queue worker, scheduler, asset watcher — each with its own command,
working directory, dependency order and health check. A preset captures that
shape once so the next project is one click.

Presets are plain JSON files in the app config directory:

| Platform | Location |
|---|---|
| macOS | `~/Library/Application Support/uz.blaze.karvon/presets/` |
| Windows | `%APPDATA%\uz.blaze.karvon\presets\` |

The directory is created on first use, and `GET /api/v1/presets` reports the exact
path it scanned so you never have to guess.

---

## A minimal preset

`presets/laravel.json`:

```json
{
  "name": "Laravel",
  "description": "Web server, queue worker and scheduler for a Laravel app.",
  "variables": [
    { "key": "php", "label": "PHP binary", "default": "php" },
    { "key": "root", "label": "Project root", "description": "Absolute path to the app." }
  ],
  "processes": [
    {
      "name": "Web server",
      "key": "serve",
      "command": "{{php}}",
      "args": ["artisan", "serve", "--port=8000"],
      "workingDirectory": "{{root}}",
      "autoStart": true,
      "healthCheck": { "kind": "http", "url": "http://127.0.0.1:8000/up", "method": "GET", "expectedStatus": 200, "timeoutMs": 3000 },
      "restartPolicy": { "kind": "on-failure", "maxRetries": null, "retryDelayMs": 2000 }
    },
    {
      "name": "Queue worker",
      "key": "queue",
      "command": "{{php}}",
      "args": ["artisan", "queue:work", "--tries=3"],
      "workingDirectory": "{{root}}",
      "dependsOn": ["serve"],
      "restartPolicy": { "kind": "always", "maxRetries": null, "retryDelayMs": 5000 }
    },
    {
      "name": "Scheduler",
      "key": "schedule",
      "command": "{{php}}",
      "args": ["artisan", "schedule:work"],
      "workingDirectory": "{{root}}",
      "dependsOn": ["serve"]
    }
  ]
}
```

The `id` defaults to the file stem (`laravel`), so a file is all you need. Set
`id` explicitly if you want it independent of the filename.

---

## Variables

Anywhere in a process's `name`, `command`, `args`, `workingDirectory` or `env`,
`{{key}}` is substituted when the preset is applied.

Two rules keep this honest:

- **Every variable used must be declared.** A preset referencing `{{root}}`
  without listing it under `variables` fails to load, naming the variable — so a
  typo is a load error with a file name attached rather than a literal `{{root}}`
  ending up in a command line.
- **A variable with no `default` is required.** Applying a preset while one is
  unset is refused. A half-substituted command is a command that runs and does
  the wrong thing, which is worse than not running at all. A supplied value that
  is blank or whitespace counts as unset.

---

## Fields

Everything a process can have in the UI, and nothing it cannot:

| Field | Required | Notes |
|---|---|---|
| `name`, `key`, `command` | ✅ | `key` must be unique within the preset |
| `args` | | defaults to `[]` |
| `workingDirectory` | | |
| `env` | | keys *and* values are substituted |
| `memoryLimitMb` | | |
| `autoStart` | | defaults to `false` |
| `restartPolicy` | | defaults to `never` |
| `startupDelayMs` | | |
| `dependsOn` | | must name a `key` **in the same preset** |
| `healthCheck` | | `none` \| `tcp` \| `http` \| `custom`; defaults to `none` |
| `logMode` | | `combined` \| `split`; defaults to `combined` |
| `group`, `visible` | | `visible` defaults to `true` |

`projectId` and `machineId` are deliberately **not** preset fields. A preset
describes a *shape*; where it runs is the target project's decision, and applying
one inherits the project's machine.

---

## Applying

From the HTTP API:

```bash
# what is available, and where it was read from
curl -H "Authorization: Bearer $KARVON_TOKEN" \
  http://127.0.0.1:7777/api/v1/presets

# apply, supplying the required variables
curl -X POST -H "Authorization: Bearer $KARVON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"root": "/Users/me/code/shop", "php": "/opt/homebrew/bin/php"}' \
  http://127.0.0.1:7777/api/v1/projects/proj_123/presets/laravel
```

**Applying is all-or-nothing.** The whole preset is validated against the target
project before anything is written, so a preset whose third process collides with
an existing key does not leave the first two behind for you to clean up by hand.

---

## When a file is wrong

A broken file never hides the working ones. Each is parsed independently and
failures are returned alongside the presets that loaded:

```json
{
  "directory": "/Users/me/Library/Application Support/uz.blaze.karvon/presets",
  "presets": [ { "id": "laravel", "name": "Laravel", "...": "..." } ],
  "errors": [
    { "source": ".../rails.json", "message": "process \"worker\" depends on \"web\", which is not a process in this preset" }
  ]
}
```

Loading rejects, with the file named:

- invalid JSON
- no processes, an empty `name`, `key` or `command`
- a duplicate `key` inside one preset, or a duplicate preset `id` across files
- a `dependsOn` naming a process that is not in the preset — otherwise that
  process waits forever on a dependency that never appears
- a `{{variable}}` that is not declared
- a file over 512 KB

---

## Security

A preset cannot do anything you could not type into the process form yourself.
It fills in fields; it does not introduce a capability. Karvon already runs
arbitrary local and SSH commands by design — see [SECURITY.md](../SECURITY.md) —
so a preset is a faster way to write a command, not a new privilege.

That said, **a preset is executable configuration**. Read one before you drop it
in `presets/`, the same way you would read a shell script someone sent you.

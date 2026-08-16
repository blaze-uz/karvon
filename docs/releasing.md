# Releasing

A release is cut by pushing a tag. `.github/workflows/release.yml` then builds
macOS (both arches) and Windows, signs the updater artifacts, and attaches
everything to the GitHub release for that tag.

This is the only workflow in the repo, and it runs on tags only — never on a push
to a branch or on a pull request.

```bash
# bump the three version fields first (see below), commit, then:
git tag -a v0.4.0 -m "v0.4.0"
git push origin v0.4.0
```

## The version lives in three files

All three must agree, or the bundle identifier and the updater disagree about
what version is installed:

| File | Field |
|---|---|
| `package.json` | `version` |
| `src-tauri/tauri.conf.json` | `version` |
| `src-tauri/Cargo.toml` | `[package] version` |

## Required secrets

**The updater signature is not optional.** `plugins.updater.pubkey` in
`tauri.conf.json` pins a minisign public key, and every installed client verifies
the update against it. A build without the private key ships no `.sig`, and every
client refuses the update — the release looks fine on GitHub and silently reaches
nobody.

| Secret | Where it comes from |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | contents of the minisign private key (`~/.tauri/karvon.key`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password — empty string if the key has none |

Set them once:

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo blaze-uz/karvon < ~/.tauri/karvon.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo blaze-uz/karvon --body ""
```

To confirm the key is the right one, compare it against the configured public key:

```bash
diff <(tr -d '\n' < ~/.tauri/karvon.key.pub) \
     <(python3 -c "import json;print(json.load(open('src-tauri/tauri.conf.json'))['plugins']['updater']['pubkey'])")
```

Silence means they match. **Lose this key and the updater is unrecoverable** —
every installed client is pinned to its public half, so a new key means every
user must download and install the app by hand. Back it up somewhere you would
also keep a production database password.

## Optional: Apple Developer ID signing and notarization

Without these, the app is ad-hoc signed. It runs, but Gatekeeper refuses a
double-click: macOS reports the developer cannot be verified, and the user has to
right-click → *Open* the first time. Releases through 0.3.0 shipped this way.

Setting the secrets below makes the DMG open normally. They require an Apple
Developer Program membership.

| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | base64 of the *Developer ID Application* `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | the Apple ID used for notarization |
| `APPLE_PASSWORD` | an **app-specific** password, not the account password |
| `APPLE_TEAM_ID` | the 10-character team identifier |

```bash
base64 -i DeveloperID.p12 | gh secret set APPLE_CERTIFICATE --repo blaze-uz/karvon
```

The macOS job has **two build steps**, selected by whether `APPLE_CERTIFICATE` is
set. Leave the secrets unset and the ad-hoc step runs, exactly as before.

They cannot be a single step with the Apple values left empty. An undefined
GitHub secret interpolates to the empty string, but the `env:` key is still
created — and Tauri decides to code-sign on the variable being *present*, not on
it being non-empty. An empty `APPLE_CERTIFICATE` sends the bundler down the
signing path with nothing to import, and the build dies with:

```
failed codesign application: failed to run command security import:
failed to import keychain certificate
```

If you edit these steps, keep the two `with:` blocks identical apart from
`releaseBody`.

## Adding a platform to an existing release

`workflow_dispatch` re-runs against the current default branch and merges its
artifacts into the release for the version in `package.json`. This is how a
platform that was missed gets added without cutting a new version:

```bash
gh workflow run "Release Desktop App" --repo blaze-uz/karvon
```

Each job merges its own key into the shared `latest.json`. That merge is a
non-atomic read-modify-write, which is why the two macOS arches run with
`max-parallel: 1` and the Windows job `needs:` them — concurrent jobs would
overwrite each other's platform entry, and the loser would vanish from the
updater with no error anywhere.

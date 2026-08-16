//! Project presets: reusable process bundles loaded from `presets/*.json` in
//! the app config directory.
//!
//! Setting up a Laravel or Rails project in Karvon means adding the same four or
//! five processes by hand every time — web server, queue worker, scheduler,
//! asset watcher — each with its own command, working directory, dependency
//! order and health check. A preset captures that shape once so the next project
//! is one click.
//!
//! Three properties shape the design:
//!
//! * **Presets are data, not code.** A preset cannot introduce a capability
//!   Karvon does not already have; it only fills in fields the user could type
//!   themselves. That keeps the security story unchanged — the app already runs
//!   arbitrary commands by design, and a preset is a faster way to type one, not
//!   a new privilege.
//! * **A bad file must not hide the good ones.** Each file is parsed
//!   independently and its failure reported against that file, so one stray
//!   comma does not empty the preset list with a single unexplained error.
//! * **Substitution is explicit and total.** Every `{{variable}}` a preset uses
//!   must be declared, and applying one refuses to proceed while any required
//!   variable is unset — a half-substituted command is a command that runs and
//!   does the wrong thing.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::models::{
    ApiError, HealthCheck, LogMode, ProcessFormInput, RestartPolicy, RestartPolicyKind,
};

/// Directory under the app config dir that holds preset files.
pub const PRESETS_DIR: &str = "presets";

/// Upper bound on a preset file, so a stray huge file cannot stall the scan.
const MAX_PRESET_BYTES: u64 = 512 * 1024;

/// A declared substitution point in a preset.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetVariable {
    /// Name used as `{{name}}` in the preset body.
    pub key: String,
    /// Human label shown in the apply dialog.
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    /// Prefilled value. A variable with a default is optional.
    #[serde(default)]
    pub default: Option<String>,
}

/// One process in a preset. Mirrors `ProcessFormInput` minus the ids Karvon
/// assigns, so a preset can express anything the process form can and nothing
/// more.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetProcess {
    pub name: String,
    pub key: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub memory_limit_mb: Option<u64>,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default)]
    pub restart_policy: Option<RestartPolicy>,
    #[serde(default)]
    pub startup_delay_ms: Option<u64>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub health_check: Option<HealthCheck>,
    #[serde(default)]
    pub log_mode: Option<LogMode>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default = "default_true")]
    pub visible: bool,
}

fn default_true() -> bool {
    true
}

/// A preset as it appears on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    /// Stable identifier. Defaults to the file stem when absent.
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub variables: Vec<PresetVariable>,
    pub processes: Vec<PresetProcess>,
}

/// A preset that parsed, plus where it came from.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedPreset {
    pub id: String,
    pub source: String,
    #[serde(flatten)]
    pub preset: Preset,
}

/// A file that did not parse or did not validate.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetLoadError {
    pub source: String,
    pub message: String,
}

/// The result of scanning the presets directory.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetCatalog {
    pub presets: Vec<LoadedPreset>,
    /// Files that failed, reported alongside the ones that worked so a single
    /// bad file is visible rather than silently reducing the list.
    pub errors: Vec<PresetLoadError>,
    /// Absolute path scanned, so the UI can tell the user where to put files.
    pub directory: String,
}

/// Read every `*.json` in `dir`, parsing each independently.
///
/// A missing directory is not an error — it is the normal state before the user
/// has written a preset — and yields an empty catalog naming the path.
pub fn load_catalog(dir: &Path) -> PresetCatalog {
    let mut catalog = PresetCatalog {
        directory: dir.display().to_string(),
        ..Default::default()
    };

    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return catalog,
        Err(error) => {
            catalog.errors.push(PresetLoadError {
                source: dir.display().to_string(),
                message: format!("could not read the presets directory: {error}"),
            });
            return catalog;
        }
    };

    let mut paths: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
        })
        .collect();
    // Sorted so the list is stable between runs rather than filesystem order.
    paths.sort();

    let mut seen: BTreeSet<String> = BTreeSet::new();

    for path in paths {
        let source = path.display().to_string();

        match load_one(&path) {
            Ok(mut loaded) => {
                if !seen.insert(loaded.id.clone()) {
                    catalog.errors.push(PresetLoadError {
                        source,
                        message: format!(
                            "duplicate preset id \"{}\" — ids must be unique across the directory",
                            loaded.id
                        ),
                    });
                    continue;
                }
                loaded.source = path.display().to_string();
                catalog.presets.push(loaded);
            }
            Err(message) => catalog.errors.push(PresetLoadError { source, message }),
        }
    }

    catalog
}

fn load_one(path: &Path) -> Result<LoadedPreset, String> {
    let metadata =
        std::fs::metadata(path).map_err(|error| format!("could not stat the file: {error}"))?;

    if metadata.len() > MAX_PRESET_BYTES {
        return Err(format!(
            "file is {} bytes; presets are capped at {MAX_PRESET_BYTES} bytes",
            metadata.len()
        ));
    }

    let raw =
        std::fs::read_to_string(path).map_err(|error| format!("could not read the file: {error}"))?;

    let preset: Preset =
        serde_json::from_str(&raw).map_err(|error| format!("invalid preset JSON: {error}"))?;

    let id = preset.id.clone().unwrap_or_else(|| {
        path.file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("preset")
            .to_string()
    });

    validate(&preset, &id)?;

    Ok(LoadedPreset {
        id,
        source: path.display().to_string(),
        preset,
    })
}

/// Reject a preset that would produce something the process form would refuse,
/// so the failure surfaces at load time with the file name attached rather than
/// halfway through applying it.
fn validate(preset: &Preset, id: &str) -> Result<(), String> {
    if id.trim().is_empty() {
        return Err("preset id is empty".into());
    }
    if preset.name.trim().is_empty() {
        return Err("preset name is empty".into());
    }
    if preset.processes.is_empty() {
        return Err("preset declares no processes".into());
    }

    let mut keys: BTreeSet<&str> = BTreeSet::new();
    for process in &preset.processes {
        if process.key.trim().is_empty() {
            return Err(format!("process \"{}\" has an empty key", process.name));
        }
        if process.command.trim().is_empty() {
            return Err(format!("process \"{}\" has an empty command", process.key));
        }
        if !keys.insert(process.key.as_str()) {
            return Err(format!("duplicate process key \"{}\"", process.key));
        }
    }

    // depends_on names a sibling by key; a typo here would otherwise become a
    // process that waits forever on a dependency that does not exist.
    for process in &preset.processes {
        for dependency in &process.depends_on {
            if !keys.contains(dependency.as_str()) {
                return Err(format!(
                    "process \"{}\" depends on \"{dependency}\", which is not a process in this preset",
                    process.key
                ));
            }
        }
    }

    let declared: BTreeSet<&str> = preset.variables.iter().map(|v| v.key.as_str()).collect();
    let used = referenced_variables(preset);
    let undeclared: Vec<&str> = used
        .iter()
        .map(String::as_str)
        .filter(|key| !declared.contains(key))
        .collect();

    if !undeclared.is_empty() {
        return Err(format!(
            "uses undeclared variable(s): {}. Add them to \"variables\" so the apply dialog can ask for them.",
            undeclared.join(", ")
        ));
    }

    Ok(())
}

/// Every `{{name}}` referenced anywhere in the preset body.
fn referenced_variables(preset: &Preset) -> BTreeSet<String> {
    let mut found = BTreeSet::new();

    for process in &preset.processes {
        let mut texts: Vec<&str> = vec![&process.name, &process.command];
        texts.extend(process.args.iter().map(String::as_str));
        if let Some(dir) = &process.working_directory {
            texts.push(dir);
        }
        for (key, value) in &process.env {
            texts.push(key);
            texts.push(value);
        }

        for text in texts {
            found.extend(placeholders(text).into_iter().map(str::to_string));
        }
    }

    found
}

/// Extract `name` from each `{{name}}` occurrence.
fn placeholders(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;

    while i + 3 < bytes.len() {
        if bytes[i] == b'{' && bytes[i + 1] == b'{' {
            if let Some(end) = text[i + 2..].find("}}") {
                let key = text[i + 2..i + 2 + end].trim();
                if !key.is_empty() {
                    out.push(key);
                }
                i += 2 + end + 2;
                continue;
            }
        }
        i += 1;
    }

    out
}

/// Replace every `{{key}}` in `text` using `values`.
fn substitute(text: &str, values: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(start) = rest.find("{{") {
        let Some(end) = rest[start + 2..].find("}}") else {
            break;
        };
        let key = rest[start + 2..start + 2 + end].trim();

        out.push_str(&rest[..start]);
        match values.get(key) {
            Some(value) => out.push_str(value),
            // Unresolved placeholders are impossible here — `resolve_values`
            // refuses first — but leaving the literal is better than emptying it
            // if that ever changes.
            None => out.push_str(&rest[start..start + 2 + end + 2]),
        }
        rest = &rest[start + 2 + end + 2..];
    }

    out.push_str(rest);
    out
}

/// Merge supplied values over the declared defaults, refusing when a required
/// variable is still unset.
///
/// A half-substituted command is a command that runs and does the wrong thing,
/// so this fails rather than proceeding with a blank.
pub fn resolve_values(
    preset: &Preset,
    supplied: &HashMap<String, String>,
) -> Result<HashMap<String, String>, ApiError> {
    let mut values = HashMap::new();
    let mut missing = Vec::new();

    for variable in &preset.variables {
        match supplied
            .get(&variable.key)
            .filter(|value| !value.trim().is_empty())
            .or(variable.default.as_ref())
        {
            Some(value) => {
                values.insert(variable.key.clone(), value.clone());
            }
            None => missing.push(variable.key.clone()),
        }
    }

    if !missing.is_empty() {
        return Err(ApiError::new(
            "preset/missing-variables",
            &format!("required variable(s) not set: {}", missing.join(", ")),
            false,
        ));
    }

    Ok(values)
}

/// Turn a preset into the process inputs Karvon would otherwise be typed by hand.
///
/// `project_id` and `machine_id` come from the target project, not the preset:
/// a preset describes a *shape*, and where it runs is the user's decision.
pub fn instantiate(
    preset: &Preset,
    project_id: &str,
    machine_id: Option<String>,
    supplied: &HashMap<String, String>,
) -> Result<Vec<ProcessFormInput>, ApiError> {
    let values = resolve_values(preset, supplied)?;

    Ok(preset
        .processes
        .iter()
        .map(|process| ProcessFormInput {
            project_id: project_id.to_string(),
            name: substitute(&process.name, &values),
            key: process.key.clone(),
            command: substitute(&process.command, &values),
            args: process
                .args
                .iter()
                .map(|arg| substitute(arg, &values))
                .collect(),
            working_directory: process
                .working_directory
                .as_ref()
                .map(|dir| substitute(dir, &values)),
            env: process
                .env
                .iter()
                .map(|(key, value)| {
                    (
                        substitute(key, &values),
                        substitute(value, &values),
                    )
                })
                .collect(),
            memory_limit_mb: process.memory_limit_mb,
            auto_start: process.auto_start,
            restart_policy: process
                .restart_policy
                .clone()
                // RestartPolicy has no Default; "never" is the conservative choice for a
                // preset that did not say, matching what the process form starts on.
                .unwrap_or(RestartPolicy {
                    kind: RestartPolicyKind::Never,
                    max_retries: None,
                    retry_delay_ms: None,
                }),
            startup_delay_ms: process.startup_delay_ms,
            depends_on: process.depends_on.clone(),
            health_check: process
                .health_check
                .clone()
                .unwrap_or(HealthCheck::None),
            log_mode: process.log_mode.clone().unwrap_or(LogMode::Combined),
            group: process.group.clone(),
            visible: process.visible,
            machine_id: machine_id.clone(),
            launchd: None,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal(json: &str) -> Result<LoadedPreset, String> {
        let dir = std::env::temp_dir().join(format!("karvon-preset-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("laravel.json");
        std::fs::write(&path, json).unwrap();
        let result = load_one(&path);
        let _ = std::fs::remove_dir_all(&dir);
        result
    }

    const VALID: &str = r#"{
        "name": "Laravel",
        "variables": [{ "key": "phpPath", "default": "php" }],
        "processes": [
            { "name": "Server", "key": "serve", "command": "{{phpPath}}", "args": ["artisan", "serve"] },
            { "name": "Queue", "key": "queue", "command": "{{phpPath}}", "args": ["artisan", "queue:work"], "dependsOn": ["serve"] }
        ]
    }"#;

    #[test]
    fn loads_a_valid_preset_and_defaults_the_id_to_the_file_stem() {
        let loaded = minimal(VALID).unwrap();
        assert_eq!(loaded.id, "laravel");
        assert_eq!(loaded.preset.processes.len(), 2);
    }

    #[test]
    fn rejects_a_preset_with_no_processes() {
        let error = minimal(r#"{ "name": "Empty", "processes": [] }"#).unwrap_err();
        assert!(error.contains("no processes"), "{error}");
    }

    #[test]
    fn rejects_duplicate_process_keys() {
        let error = minimal(
            r#"{ "name": "Dup", "processes": [
                { "name": "A", "key": "same", "command": "a" },
                { "name": "B", "key": "same", "command": "b" }
            ] }"#,
        )
        .unwrap_err();
        assert!(error.contains("duplicate process key"), "{error}");
    }

    #[test]
    fn rejects_a_dependency_on_a_process_that_does_not_exist() {
        // Otherwise the process waits forever on a dependency that never appears.
        let error = minimal(
            r#"{ "name": "Bad", "processes": [
                { "name": "A", "key": "a", "command": "a", "dependsOn": ["ghost"] }
            ] }"#,
        )
        .unwrap_err();
        assert!(error.contains("ghost"), "{error}");
    }

    #[test]
    fn rejects_an_undeclared_variable() {
        let error = minimal(
            r#"{ "name": "Bad", "processes": [
                { "name": "A", "key": "a", "command": "{{unknown}}" }
            ] }"#,
        )
        .unwrap_err();
        assert!(error.contains("unknown"), "{error}");
    }

    #[test]
    fn rejects_an_empty_command() {
        let error = minimal(
            r#"{ "name": "Bad", "processes": [{ "name": "A", "key": "a", "command": "  " }] }"#,
        )
        .unwrap_err();
        assert!(error.contains("empty command"), "{error}");
    }

    #[test]
    fn a_bad_file_does_not_hide_the_good_ones() {
        let dir = std::env::temp_dir().join(format!("karvon-catalog-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("good.json"), VALID).unwrap();
        std::fs::write(dir.join("broken.json"), "{ not json").unwrap();
        std::fs::write(dir.join("notes.txt"), "ignored").unwrap();

        let catalog = load_catalog(&dir);
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(catalog.presets.len(), 1, "the good preset must still load");
        assert_eq!(catalog.errors.len(), 1, "the broken file must be reported");
        assert!(catalog.errors[0].source.ends_with("broken.json"));
    }

    #[test]
    fn a_missing_directory_is_empty_not_an_error() {
        let catalog = load_catalog(&std::env::temp_dir().join("karvon-presets-absent-xyz"));
        assert!(catalog.presets.is_empty());
        assert!(catalog.errors.is_empty(), "not having written one yet is normal");
    }

    #[test]
    fn duplicate_ids_across_files_are_reported() {
        let dir = std::env::temp_dir().join(format!("karvon-dup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let body = r#"{ "id": "same", "name": "A", "processes": [{ "name": "A", "key": "a", "command": "a" }] }"#;
        std::fs::write(dir.join("a.json"), body).unwrap();
        std::fs::write(dir.join("b.json"), body).unwrap();

        let catalog = load_catalog(&dir);
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(catalog.presets.len(), 1);
        assert!(catalog.errors[0].message.contains("duplicate preset id"));
    }

    #[test]
    fn substitutes_declared_variables() {
        let preset = minimal(VALID).unwrap().preset;
        let supplied = HashMap::from([("phpPath".to_string(), "/usr/bin/php8.4".to_string())]);

        let inputs = instantiate(&preset, "proj-1", None, &supplied).unwrap();

        assert_eq!(inputs[0].command, "/usr/bin/php8.4");
        assert_eq!(inputs[0].project_id, "proj-1");
        assert_eq!(inputs[1].depends_on, vec!["serve".to_string()]);
    }

    #[test]
    fn falls_back_to_the_declared_default() {
        let preset = minimal(VALID).unwrap().preset;
        let inputs = instantiate(&preset, "proj-1", None, &HashMap::new()).unwrap();
        assert_eq!(inputs[0].command, "php");
    }

    #[test]
    fn refuses_to_apply_while_a_required_variable_is_unset() {
        // A half-substituted command runs and does the wrong thing.
        let preset = minimal(
            r#"{ "name": "P", "variables": [{ "key": "root" }],
                 "processes": [{ "name": "A", "key": "a", "command": "run", "workingDirectory": "{{root}}" }] }"#,
        )
        .unwrap()
        .preset;

        let error = instantiate(&preset, "proj-1", None, &HashMap::new()).unwrap_err();
        assert!(error.message.contains("root"), "{}", error.message);
    }

    #[test]
    fn treats_a_blank_supplied_value_as_unset() {
        let preset = minimal(
            r#"{ "name": "P", "variables": [{ "key": "root" }],
                 "processes": [{ "name": "A", "key": "a", "command": "{{root}}" }] }"#,
        )
        .unwrap()
        .preset;

        let supplied = HashMap::from([("root".to_string(), "   ".to_string())]);
        assert!(instantiate(&preset, "p", None, &supplied).is_err());
    }

    #[test]
    fn the_target_project_decides_where_it_runs_not_the_preset() {
        let preset = minimal(VALID).unwrap().preset;
        let inputs =
            instantiate(&preset, "proj-1", Some("machine-9".into()), &HashMap::new()).unwrap();

        assert!(inputs.iter().all(|i| i.machine_id.as_deref() == Some("machine-9")));
    }

    #[test]
    fn placeholder_scanning_handles_the_awkward_cases() {
        assert_eq!(placeholders("{{a}} and {{ b }}"), vec!["a", "b"]);
        assert_eq!(placeholders("no braces"), Vec::<&str>::new());
        assert_eq!(placeholders("{{unclosed"), Vec::<&str>::new());
        assert_eq!(placeholders("{{}}"), Vec::<&str>::new());
    }

    #[test]
    fn substitution_leaves_surrounding_text_intact() {
        let values = HashMap::from([("x".to_string(), "V".to_string())]);
        assert_eq!(substitute("a{{x}}b", &values), "aVb");
        assert_eq!(substitute("{{x}}{{x}}", &values), "VV");
        assert_eq!(substitute("plain", &values), "plain");
    }
}

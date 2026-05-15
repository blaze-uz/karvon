use crate::{
    models::{ApiError, HealthCheck, HealthStatus, Machine},
    ssh_executor,
};
use std::time::Duration;
use tokio::{net::TcpStream, process::Command, time::timeout};

pub async fn run_health_check(
    check: &HealthCheck,
    default_cwd: Option<&str>,
    machine: Option<&Machine>,
) -> Result<HealthStatus, ApiError> {
    match check {
        HealthCheck::None => Ok(HealthStatus::Unknown),
        HealthCheck::Tcp {
            host,
            port,
            timeout_ms,
        } => {
            let effective_host = resolve_host_for_machine(host, machine);
            let address = format!("{effective_host}:{port}");
            match timeout(
                Duration::from_millis(*timeout_ms),
                TcpStream::connect(address),
            )
            .await
            {
                Ok(Ok(_)) => Ok(HealthStatus::Healthy),
                Ok(Err(error)) => Err(ApiError::with_details(
                    "HEALTHCHECK_FAILED",
                    "TCP health check failed",
                    error,
                    true,
                )),
                Err(_) => Err(ApiError::new(
                    "HEALTHCHECK_FAILED",
                    "TCP health check timed out",
                    true,
                )),
            }
        }
        HealthCheck::Http {
            url,
            expected_status,
            timeout_ms,
            ..
        } => {
            let effective_url = rewrite_url_host_for_machine(url, machine);
            let status = http_status(&effective_url, *timeout_ms).await?;
            if status == *expected_status {
                Ok(HealthStatus::Healthy)
            } else {
                Err(ApiError::with_details(
                    "HEALTHCHECK_FAILED",
                    "HTTP health check returned an unexpected status",
                    format!("expected {expected_status}, got {status}"),
                    true,
                ))
            }
        }
        HealthCheck::Custom {
            command,
            args,
            working_directory,
            timeout_ms,
        } => {
            let timeout_duration = Duration::from_millis(timeout_ms.unwrap_or(12_000));
            if let Some(machine) = machine.filter(|m| !m.is_default_local) {
                let cwd_arg = working_directory.as_deref().or(default_cwd);
                let mut shell_command = String::new();
                if let Some(cwd) = cwd_arg {
                    shell_command.push_str(&format!("cd {} && ", shell_quote(cwd)));
                }
                shell_command.push_str(&shell_quote(command));
                for arg in args {
                    shell_command.push(' ');
                    shell_command.push_str(&shell_quote(arg));
                }
                let output = timeout(
                    timeout_duration,
                    ssh_executor::run_remote_command(machine, &shell_command),
                )
                .await
                .map_err(|_| {
                    ApiError::new(
                        "HEALTHCHECK_FAILED",
                        "Custom health check timed out",
                        true,
                    )
                })?
                .map_err(|error| {
                    ApiError::with_details(
                        "HEALTHCHECK_FAILED",
                        "Custom health check failed to execute remotely",
                        error,
                        true,
                    )
                })?;
                if output.status.success() {
                    Ok(HealthStatus::Healthy)
                } else {
                    Err(ApiError::with_details(
                        "HEALTHCHECK_FAILED",
                        "Custom health check exited unsuccessfully",
                        String::from_utf8_lossy(&output.stderr),
                        true,
                    ))
                }
            } else {
                let mut cmd = Command::new(command);
                cmd.args(args);
                if let Some(cwd) = working_directory.as_deref().or(default_cwd) {
                    cmd.current_dir(cwd);
                }
                let output = timeout(timeout_duration, cmd.output())
                    .await
                    .map_err(|_| {
                        ApiError::new(
                            "HEALTHCHECK_FAILED",
                            "Custom health check timed out",
                            true,
                        )
                    })?
                    .map_err(|error| {
                        ApiError::with_details(
                            "HEALTHCHECK_FAILED",
                            "Custom health check failed to execute",
                            error,
                            true,
                        )
                    })?;
                if output.status.success() {
                    Ok(HealthStatus::Healthy)
                } else {
                    Err(ApiError::with_details(
                        "HEALTHCHECK_FAILED",
                        "Custom health check exited unsuccessfully",
                        String::from_utf8_lossy(&output.stderr),
                        true,
                    ))
                }
            }
        }
    }
}

fn resolve_host_for_machine(host: &str, machine: Option<&Machine>) -> String {
    let Some(machine) = machine else {
        return host.to_string();
    };
    if machine.is_default_local {
        return host.to_string();
    }
    let trimmed = host.trim();
    let is_loopback =
        trimmed.is_empty() || trimmed == "127.0.0.1" || trimmed.eq_ignore_ascii_case("localhost");
    if is_loopback {
        machine.hostname.clone()
    } else {
        host.to_string()
    }
}

fn rewrite_url_host_for_machine(url: &str, machine: Option<&Machine>) -> String {
    let Some(machine) = machine else {
        return url.to_string();
    };
    if machine.is_default_local {
        return url.to_string();
    }
    let Some(rest) = url.strip_prefix("http://") else {
        return url.to_string();
    };
    let (authority, tail) = match rest.find('/') {
        Some(idx) => rest.split_at(idx),
        None => (rest, ""),
    };
    let (host, port_suffix) = match authority.rsplit_once(':') {
        Some((host, port)) => (host, format!(":{port}")),
        None => (authority, String::new()),
    };
    let trimmed = host.trim();
    let is_loopback =
        trimmed.is_empty() || trimmed == "127.0.0.1" || trimmed.eq_ignore_ascii_case("localhost");
    if !is_loopback {
        return url.to_string();
    }
    format!("http://{}{}{}", machine.hostname, port_suffix, tail)
}

fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    if value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':' | '@' | '%' | '=' | '+'))
    {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

async fn http_status(url: &str, timeout_ms: u64) -> Result<u16, ApiError> {
    let stripped = url.strip_prefix("http://").ok_or_else(|| {
        ApiError::new(
            "HEALTHCHECK_FAILED",
            "Only http:// health checks are supported in MVP",
            false,
        )
    })?;
    let (host_port, path) = stripped.split_once('/').unwrap_or((stripped, ""));
    let (host, port) = match host_port.split_once(':') {
        Some((host, port_str)) => {
            let port = port_str.parse::<u16>().map_err(|error| {
                ApiError::with_details(
                    "HEALTHCHECK_FAILED",
                    "HTTP health check URL has an invalid port",
                    error,
                    false,
                )
            })?;
            (host, port)
        }
        None => (host_port, 80),
    };
    if host.is_empty() {
        return Err(ApiError::new(
            "HEALTHCHECK_FAILED",
            "HTTP health check URL is missing a host",
            false,
        ));
    }
    let mut stream = timeout(
        Duration::from_millis(timeout_ms),
        TcpStream::connect((host, port)),
    )
    .await
    .map_err(|_| ApiError::new("HEALTHCHECK_FAILED", "HTTP health check timed out", true))?
    .map_err(|error| {
        ApiError::with_details(
            "HEALTHCHECK_FAILED",
            "HTTP health check failed to connect",
            error,
            true,
        )
    })?;
    let request = format!("GET /{path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(|error| {
            ApiError::with_details(
                "HEALTHCHECK_FAILED",
                "HTTP health check failed to write request",
                error,
                true,
            )
        })?;
    let mut buffer = vec![0_u8; 256];
    let size = stream.read(&mut buffer).await.map_err(|error| {
        ApiError::with_details(
            "HEALTHCHECK_FAILED",
            "HTTP health check failed to read response",
            error,
            true,
        )
    })?;
    let response = String::from_utf8_lossy(&buffer[..size]);
    let status = response
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| {
            ApiError::new(
                "HEALTHCHECK_FAILED",
                "HTTP health check returned an invalid response",
                true,
            )
        })?;
    Ok(status)
}

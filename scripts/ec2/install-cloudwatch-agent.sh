#!/usr/bin/env bash
# Install and configure the Amazon CloudWatch agent on EC2 for EventCart.
#
# Ships Spring Boot stdout/stderr (log files + systemd journal) to CloudWatch Log
# Groups named after each service, and publishes CPU / memory / disk metrics.
#
# Prerequisites:
#   - EC2 instance IAM role with CloudWatchAgentServerPolicy (or equivalent)
#   - Root / sudo
#
# Usage:
#   sudo ./scripts/ec2/install-cloudwatch-agent.sh
#   sudo ./scripts/ec2/install-cloudwatch-agent.sh --config /path/to/amazon-cloudwatch-agent.json
#   sudo ./scripts/ec2/install-cloudwatch-agent.sh --service order-service
#
# Manual install cheat-sheet (script automates this):
#
#   Amazon Linux 2 / 2023:
#     sudo yum install -y amazon-cloudwatch-agent
#     # or: wget https://amazoncloudwatch-agent.s3.amazonaws.com/amazon_linux/amd64/latest/amazon-cloudwatch-agent.rpm
#     #     sudo rpm -U ./amazon-cloudwatch-agent.rpm
#
#   Ubuntu (amd64):
#     wget https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
#     sudo dpkg -i -E ./amazon-cloudwatch-agent.deb
#
#   Ubuntu (arm64):
#     wget https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/arm64/latest/amazon-cloudwatch-agent.deb
#     sudo dpkg -i -E ./amazon-cloudwatch-agent.deb
#
#   Apply config + start:
#     sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
#       -a fetch-config -m ec2 -s -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DEFAULT_CONFIG="${REPO_ROOT}/monitoring/cloudwatch-agent/amazon-cloudwatch-agent.json"
AGENT_ETC="/opt/aws/amazon-cloudwatch-agent/etc"
AGENT_CTL="/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl"
LOG_DIR="/var/log/eventcart"

CONFIG_SRC="${DEFAULT_CONFIG}"
SERVICE_FILTER=""

usage() {
  sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config)
      CONFIG_SRC="${2:?--config requires a path}"
      shift 2
      ;;
    --service)
      SERVICE_FILTER="${2:?--service requires a name (e.g. order-service)}"
      shift 2
      ;;
    -h|--help)
      usage 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage 1
      ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "This script must run as root (sudo)." >&2
  exit 1
fi

if [[ ! -f "${CONFIG_SRC}" ]]; then
  echo "Config not found: ${CONFIG_SRC}" >&2
  exit 1
fi

detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    echo "${ID:-unknown}"
  else
    echo "unknown"
  fi
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    *)
      echo "Unsupported architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

install_amazon_linux() {
  echo "==> Installing CloudWatch agent via yum (Amazon Linux)..."
  if command -v amazon-cloudwatch-agent-ctl >/dev/null 2>&1 || [[ -x "${AGENT_CTL}" ]]; then
    echo "    Agent already present; skipping package install."
    return 0
  fi
  yum install -y amazon-cloudwatch-agent
}

install_ubuntu() {
  local arch="$1"
  local deb="amazon-cloudwatch-agent.deb"
  local url="https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/${arch}/latest/amazon-cloudwatch-agent.deb"
  local tmp
  tmp="$(mktemp -d)"

  echo "==> Installing CloudWatch agent for Ubuntu (${arch})..."
  if command -v amazon-cloudwatch-agent-ctl >/dev/null 2>&1 || [[ -x "${AGENT_CTL}" ]]; then
    echo "    Agent already present; skipping package install."
    return 0
  fi

  apt-get update -y
  apt-get install -y wget ca-certificates
  wget -q -O "${tmp}/${deb}" "${url}"
  dpkg -i -E "${tmp}/${deb}"
  rm -rf "${tmp}"
}

prepare_log_dirs() {
  echo "==> Preparing log directories under ${LOG_DIR}..."
  mkdir -p "${LOG_DIR}"
  # Agent runs as cwagent after install; allow it to read app logs.
  chmod 755 "${LOG_DIR}"
  local svc
  for svc in order-service inventory-service payment-service notification-service; do
    if [[ -n "${SERVICE_FILTER}" && "${SERVICE_FILTER}" != "${svc}" ]]; then
      continue
    fi
    touch "${LOG_DIR}/${svc}.log"
    chmod 644 "${LOG_DIR}/${svc}.log"
  done
  # Best-effort: if cwagent user exists, grant group read.
  if id cwagent >/dev/null 2>&1; then
    chown root:cwagent "${LOG_DIR}" || true
    chmod 755 "${LOG_DIR}"
  fi
}

filter_config_for_service() {
  local src="$1"
  local dest="$2"
  local svc="$3"

  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required to filter config for --service=${svc}" >&2
    exit 1
  fi

  python3 - "${src}" "${dest}" "${svc}" <<'PY'
import json, sys
src, dest, svc = sys.argv[1], sys.argv[2], sys.argv[3]
with open(src, encoding="utf-8") as f:
    cfg = json.load(f)

logs = cfg.setdefault("logs", {}).setdefault("logs_collected", {})
files = logs.get("files", {}).get("collect_list", [])
journal = logs.get("journal", {}).get("collect_list", [])

logs.setdefault("files", {})["collect_list"] = [
    e for e in files if e.get("log_group_name") == svc
]
logs.setdefault("journal", {})["collect_list"] = [
    e for e in journal if e.get("log_group_name") == svc
]

if not logs["files"]["collect_list"] and not logs["journal"]["collect_list"]:
    raise SystemExit(f"No log collect entries found for service '{svc}'")

with open(dest, "w", encoding="utf-8") as out:
    json.dump(cfg, out, indent=2)
    out.write("\n")
print(f"Wrote filtered config for {svc} -> {dest}")
PY
}

install_config() {
  local dest="${AGENT_ETC}/amazon-cloudwatch-agent.json"
  mkdir -p "${AGENT_ETC}"

  if [[ -n "${SERVICE_FILTER}" ]]; then
    filter_config_for_service "${CONFIG_SRC}" "${dest}" "${SERVICE_FILTER}"
  else
    echo "==> Installing agent config from ${CONFIG_SRC}"
    cp "${CONFIG_SRC}" "${dest}"
  fi
  chmod 644 "${dest}"
  echo "    Config installed at ${dest}"
}

start_agent() {
  local dest="${AGENT_ETC}/amazon-cloudwatch-agent.json"
  echo "==> Starting CloudWatch agent with fetch-config..."
  "${AGENT_CTL}" -a fetch-config -m ec2 -s -c "file:${dest}"
  "${AGENT_CTL}" -m ec2 -a status || true
  echo "==> Done."
  echo
  echo "Log groups (one per service): order-service, inventory-service, payment-service, notification-service"
  echo "Metrics namespace: EventCart/EC2 (cpu, mem, disk, diskio, swap, net)"
  echo
  echo "Point Spring Boot stdout/stderr at the agent file collectors, e.g.:"
  echo "  java -jar order-service.jar >> /var/log/eventcart/order-service.log 2>&1"
  echo "or run under systemd units named <service>.service (journal collectors)."
}

main() {
  local os arch
  os="$(detect_os)"
  arch="$(detect_arch)"
  echo "==> Detected OS=${os} arch=${arch}"

  case "${os}" in
    amzn|amzn2)
      install_amazon_linux
      ;;
    ubuntu|debian)
      install_ubuntu "${arch}"
      ;;
    *)
      echo "Unsupported OS '${os}'. Supported: Amazon Linux (amzn), Ubuntu/Debian." >&2
      echo "Install manually using the commands in the script header, then re-run." >&2
      exit 1
      ;;
  esac

  if [[ ! -x "${AGENT_CTL}" ]]; then
    echo "CloudWatch agent binary not found at ${AGENT_CTL}" >&2
    exit 1
  fi

  prepare_log_dirs
  install_config
  start_agent
}

main

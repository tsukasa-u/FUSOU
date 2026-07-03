#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="$(readlink -f "$0" 2>/dev/null || printf "%s" "$0")"

print_and_wait() {
  echo
  read -r -p "Press Enter to close..." _
}

is_safe_username() {
  [[ "$1" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]]
}

install_tpm_packages() {
  if command -v tpm2_getcap >/dev/null 2>&1; then
    echo "tpm2-tools is already installed"
    return
  fi

  echo "Installing TPM runtime/tools packages"
  local distro_id=""
  local distro_like=""
  if [[ -r /etc/os-release ]]; then
    # shellcheck source=/dev/null
    source /etc/os-release
    distro_id="${ID:-}"
    distro_like="${ID_LIKE:-}"
  fi

  if [[ "$distro_id" == "ubuntu" || "$distro_id" == "debian" || "$distro_like" == *"debian"* ]]; then
    sudo apt-get update
    sudo apt-get install -y tpm2-tools tpm2-tss
    return
  fi

  if [[ "$distro_id" == "fedora" || "$distro_like" == *"rhel"* || "$distro_like" == *"fedora"* ]]; then
    sudo dnf install -y tpm2-tools tpm2-tss
    return
  fi

  if [[ "$distro_id" == "arch" || "$distro_like" == *"arch"* ]]; then
    sudo pacman -Sy --noconfirm tpm2-tools tpm2-tss
    return
  fi

  if [[ "$distro_id" == "opensuse-tumbleweed" || "$distro_id" == "opensuse-leap" || "$distro_like" == *"suse"* ]]; then
    sudo zypper --non-interactive install tpm2.0-tools tpm2.0-tss
    return
  fi

  echo "Unsupported distribution for automatic package install."
  echo "Please install TPM runtime packages manually, then run this action again."
}

run_internal_setup() {
  local target_user="$1"

  if ! is_safe_username "$target_user"; then
    echo "Unsafe username was provided."
    exit 1
  fi

  if ! id "$target_user" >/dev/null 2>&1; then
    echo "User '$target_user' does not exist on this system."
    exit 1
  fi

  trap 'echo "Setup failed."; print_and_wait' ERR

  echo "Preparing TPM access for user: $target_user"
  echo "Requesting administrator permission..."
  sudo -v

  install_tpm_packages

  if ! getent group tss >/dev/null 2>&1; then
    echo "Creating tss group"
    sudo groupadd --system tss || true
  fi

  if id -nG "$target_user" | tr ' ' '\n' | grep -qx "tss"; then
    echo "User already belongs to group tss"
  else
    echo "Adding user to tss group"
    sudo usermod -aG tss "$target_user"
  fi

  if command -v udevadm >/dev/null 2>&1; then
    echo "Reloading udev rules for TPM devices"
    sudo udevadm control --reload-rules || true
    sudo udevadm trigger --subsystem-match=tpm || true
  fi

  echo
  echo "TPM access setup completed."
  echo "You must log out and log back in before applications can use new group membership."
  echo "After re-login, run 'Run TPM Check' in FUSOU-APP Settings."
  print_and_wait
}

launch_terminal_and_run() {
  local target_user="$1"
  local quoted_script
  local quoted_user
  quoted_script="$(printf '%q' "$SCRIPT_PATH")"
  quoted_user="$(printf '%q' "$target_user")"
  local cmd="${quoted_script} --internal ${quoted_user}"

  if command -v gnome-terminal >/dev/null 2>&1; then
    gnome-terminal -- bash -lc "$cmd"
    return 0
  fi

  if command -v x-terminal-emulator >/dev/null 2>&1; then
    x-terminal-emulator -e bash -lc "$cmd"
    return 0
  fi

  if command -v konsole >/dev/null 2>&1; then
    konsole -e bash -lc "$cmd"
    return 0
  fi

  if command -v xfce4-terminal >/dev/null 2>&1; then
    xfce4-terminal --command="bash -lc \"$cmd\""
    return 0
  fi

  if command -v mate-terminal >/dev/null 2>&1; then
    mate-terminal -- bash -lc "$cmd"
    return 0
  fi

  if command -v lxterminal >/dev/null 2>&1; then
    lxterminal -e bash -lc "$cmd"
    return 0
  fi

  echo "No supported terminal emulator was found."
  echo "Cannot prompt for admin password interactively."
  exit 1
}

if [[ "${1:-}" == "--internal" ]]; then
  target="${2:-${USER:-}}"
  if [[ -z "$target" ]]; then
    echo "Failed to determine target user"
    exit 1
  fi
  run_internal_setup "$target"
  exit 0
fi

target="${1:-${USER:-}}"
if [[ -z "$target" ]]; then
  echo "Failed to determine target user"
  exit 1
fi

launch_terminal_and_run "$target"

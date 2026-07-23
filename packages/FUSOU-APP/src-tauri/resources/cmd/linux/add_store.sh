#!/bin/bash

set -eu
set -o pipefail

SCRIPT_NAME="$(basename -- "$0")"

log_error() {
    echo "[ERROR][$SCRIPT_NAME] $1" 1>&2
}

log_warn() {
    echo "[WARN][$SCRIPT_NAME] $1" 1>&2
}

log_info() {
    echo "[INFO][$SCRIPT_NAME] $1" 1>&2
}

on_error() {
    local exit_code="$1"
    local line_no="$2"
    log_error "command failed at line $line_no with exit code $exit_code"
    exit "$exit_code"
}

trap 'on_error $? $LINENO' ERR

has_cmd() {
    command -v "$1" >/dev/null 2>&1
}

die() {
    log_error "$1"
    exit "${2:-1}"
}

is_safe_target_name() {
    case "$1" in
        ""|.|..) return 1 ;;
        */*|*$'\n'*|*$'\r'*|*$'\t'*) return 1 ;;
        *) return 0 ;;
    esac
}

ensure_absolute_path() {
    case "$1" in
        /*) return 0 ;;
        *) return 1 ;;
    esac
}

run_refresh() {
    case "$1" in
        update-ca-certificates) update-ca-certificates ;;
        update-ca-trust) update-ca-trust extract ;;
        trust) trust extract-compat ;;
        *) return 5 ;;
    esac
}

if [ "${1-}" = "--run-as-root" ]; then
    [ "$(id -u)" -eq 0 ] || die "root mode requires root privileges" 7
    [ "$#" -eq 5 ] || die "Usage: $0 --run-as-root <anchor_dir> <cert_path> <target_path> <refresh_mode>" 2

    ANCHOR_DIR="$2"
    CERT_PATH="$3"
    TARGET_PATH="$4"
    REFRESH_MODE="$5"

    ensure_absolute_path "$ANCHOR_DIR" || die "anchor path must be absolute" 8
    ensure_absolute_path "$CERT_PATH" || die "certificate path must be absolute" 8
    ensure_absolute_path "$TARGET_PATH" || die "target path must be absolute" 8
    [ "$(dirname -- "$TARGET_PATH")" = "$ANCHOR_DIR" ] || die "target path must be directly under anchor directory" 8
    case "$TARGET_PATH" in
        "$ANCHOR_DIR"/*) ;;
        *) die "target path must stay under anchor directory" 8 ;;
    esac
    [ -f "$CERT_PATH" ] || die "certificate file not found: $CERT_PATH" 3

    log_info "installing certificate into trust anchor"
    log_info "anchor_dir=$ANCHOR_DIR target_path=$TARGET_PATH refresh_mode=$REFRESH_MODE"

    mkdir -p -- "$ANCHOR_DIR"
    install -m 0644 -- "$CERT_PATH" "$TARGET_PATH"
    run_refresh "$REFRESH_MODE" || die "failed to refresh trust store" 5
    log_info "trust store refresh completed successfully"
    exit 0
fi

[ -n "${1-}" ] || die "Usage: $0 <certificate_path>" 2
CERT_PATH="$1"
[ -f "$CERT_PATH" ] || die "certificate file not found: $CERT_PATH" 3
log_info "starting certificate install flow"
log_info "input_cert_path=$CERT_PATH"
if has_cmd realpath; then
    CERT_PATH="$(realpath "$CERT_PATH")"
else
    CERT_PATH="$(readlink -f "$CERT_PATH" 2>/dev/null || true)"
fi
ensure_absolute_path "$CERT_PATH" || die "certificate path must be absolute" 8
log_info "normalized_cert_path=$CERT_PATH"

CERT_BASENAME="$(basename -- "$CERT_PATH")"
case "$CERT_BASENAME" in
    *.crt) TARGET_NAME="$CERT_BASENAME" ;;
    *.pem) TARGET_NAME="${CERT_BASENAME%.pem}.crt" ;;
    *) TARGET_NAME="${CERT_BASENAME}.crt" ;;
esac

is_safe_target_name "$TARGET_NAME" || die "unsafe certificate target name: $TARGET_NAME" 9

SCRIPT_PATH="$(readlink -f "$0" 2>/dev/null || true)"
if [ -z "$SCRIPT_PATH" ] && has_cmd realpath; then
    SCRIPT_PATH="$(realpath "$0" 2>/dev/null || true)"
fi
[ -n "$SCRIPT_PATH" ] || die "failed to resolve script path" 10
ensure_absolute_path "$SCRIPT_PATH" || die "script path must be absolute" 10

detect_family() {
    local distro_id=""
    local distro_like=""

    if [ -r /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        distro_id="${ID:-}"
        distro_like="${ID_LIKE:-}"
    fi

    case "$distro_id" in
        ubuntu|debian|linuxmint|pop|elementary) echo "debian"; return ;;
        fedora|rhel|centos|rocky|almalinux|ol|amzn) echo "rhel"; return ;;
        arch|manjaro|endeavouros) echo "arch"; return ;;
        opensuse*|sles) echo "suse"; return ;;
    esac

    case " $distro_like " in
        *" debian "*) echo "debian" ;;
        *" rhel "*|*" fedora "*) echo "rhel" ;;
        *" arch "*) echo "arch" ;;
        *" suse "*) echo "suse" ;;
        *) echo "generic" ;;
    esac
}

preferred_mode_for_family() {
    case "$1" in
        debian|suse) echo "update-ca-certificates" ;;
        rhel) echo "update-ca-trust" ;;
        arch) echo "trust" ;;
        *) echo "" ;;
    esac
}

anchor_candidates_for_mode() {
    local mode="$1"
    local family="$2"

    case "$mode" in
        update-ca-certificates)
            if [ "$family" = "suse" ]; then
                echo "/etc/pki/trust/anchors"
            else
                echo "/usr/local/share/ca-certificates"
            fi
            ;;
        update-ca-trust)
            echo "/etc/pki/ca-trust/source/anchors"
            ;;
        trust)
            printf '%s\n' \
                "/etc/ca-certificates/trust-source/anchors" \
                "/etc/pki/trust/anchors"
            ;;
        *)
            printf '%s\n' \
                "/usr/local/share/ca-certificates" \
                "/etc/pki/ca-trust/source/anchors" \
                "/etc/ca-certificates/trust-source/anchors" \
                "/etc/pki/trust/anchors"
            ;;
    esac
}

pick_anchor_dir() {
    local mode="$1"
    local family="$2"
    local dir=""
    while IFS= read -r dir; do
        if [ -n "$dir" ] && [ -d "$dir" ]; then
            echo "$dir"
            return
        fi
    done < <(anchor_candidates_for_mode "$mode" "$family")

    # If none exists yet, pick the first mode-appropriate path and create it later as root.
    anchor_candidates_for_mode "$mode" "$family" | head -n 1
}

resolve_refresh_mode() {
    local preferred="$1"
    if [ -n "$preferred" ] && has_cmd "$preferred"; then
        echo "$preferred"
        return
    fi
    if has_cmd update-ca-certificates; then
        echo "update-ca-certificates"
        return
    fi
    if has_cmd update-ca-trust; then
        echo "update-ca-trust"
        return
    fi
    if has_cmd trust; then
        echo "trust"
        return
    fi
    echo "none"
}

FAMILY="$(detect_family)"
REFRESH_MODE="$(resolve_refresh_mode "$(preferred_mode_for_family "$FAMILY")")"

if [ "$REFRESH_MODE" = "none" ]; then
    die "no trust-store refresh command found (update-ca-certificates, update-ca-trust, trust)." 6
fi

ANCHOR_DIR="$(pick_anchor_dir "$REFRESH_MODE" "$FAMILY")"
TARGET_PATH="$ANCHOR_DIR/$TARGET_NAME"

log_info "family=$FAMILY refresh_mode=$REFRESH_MODE anchor_dir=$ANCHOR_DIR target_path=$TARGET_PATH"

if [ "$(id -u)" -eq 0 ]; then
    "$SCRIPT_PATH" --run-as-root "$ANCHOR_DIR" "$CERT_PATH" "$TARGET_PATH" "$REFRESH_MODE"
    exit $?
fi

# GUI-only policy: require an interactive desktop session and polkit agent.
if ! { [ -n "${DISPLAY-}" ] || [ -n "${WAYLAND_DISPLAY-}" ]; }; then
    die "GUI session is required for certificate installation." 11
fi

if ! command -v pkexec >/dev/null 2>&1; then
    die "pkexec is required for GUI-based certificate installation." 12
fi

log_info "requesting GUI authentication via polkit"
pkexec "$SCRIPT_PATH" --run-as-root "$ANCHOR_DIR" "$CERT_PATH" "$TARGET_PATH" "$REFRESH_MODE"
PKEXEC_STATUS=$?
case "$PKEXEC_STATUS" in
    0)
        exit 0
        ;;
    126)
        die "pkexec execution failed (permission or policy issue)." 126
        ;;
    127)
        die "pkexec helper failed to start (command not found in privileged context)." 127
        ;;
    *)
        log_warn "pkexec returned status $PKEXEC_STATUS"
        die "certificate installation failed after GUI authentication." "$PKEXEC_STATUS"
        ;;
esac

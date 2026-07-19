#!/bin/bash

set -u

if [ -z "${1-}" ]; then
    echo "Usage: $0 <certificate_path>" 1>&2
    exit 2
fi

CERT_PATH="$1"
if [ ! -f "$CERT_PATH" ]; then
    echo "[ERROR] certificate file not found: $CERT_PATH" 1>&2
    exit 3
fi

CERT_BASENAME="$(basename "$CERT_PATH")"
case "$CERT_BASENAME" in
    *.crt) TARGET_NAME="$CERT_BASENAME" ;;
    *.pem) TARGET_NAME="${CERT_BASENAME%.pem}.crt" ;;
    *) TARGET_NAME="${CERT_BASENAME}.crt" ;;
esac

has_cmd() {
    command -v "$1" >/dev/null 2>&1
}

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

anchor_candidates_for_family() {
    case "$1" in
        debian) echo "/usr/local/share/ca-certificates" ;;
        rhel) echo "/etc/pki/ca-trust/source/anchors" ;;
        arch) echo "/etc/ca-certificates/trust-source/anchors" ;;
        suse) echo "/etc/pki/trust/anchors" ;;
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
    local family="$1"
    local dir=""
    while IFS= read -r dir; do
        if [ -n "$dir" ] && [ -d "$dir" ]; then
            echo "$dir"
            return
        fi
    done < <(anchor_candidates_for_family "$family")
    echo "/usr/local/share/ca-certificates"
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
ANCHOR_DIR="$(pick_anchor_dir "$FAMILY")"
REFRESH_MODE="$(resolve_refresh_mode "$(preferred_mode_for_family "$FAMILY")")"
TARGET_PATH="$ANCHOR_DIR/$TARGET_NAME"

if [ "$REFRESH_MODE" = "none" ]; then
    echo "[ERROR] no trust-store refresh command found (update-ca-certificates, update-ca-trust, trust)." 1>&2
    exit 6
fi

RUN_AS_ROOT_CMD='mkdir -p "$ANCHOR_DIR" && cp "$CERT_PATH" "$TARGET_PATH" && case "$REFRESH_MODE" in update-ca-certificates) update-ca-certificates ;; update-ca-trust) update-ca-trust extract ;; trust) trust extract-compat ;; *) exit 5 ;; esac'

if [ "$(id -u)" -eq 0 ]; then
    ANCHOR_DIR="$ANCHOR_DIR" CERT_PATH="$CERT_PATH" TARGET_PATH="$TARGET_PATH" REFRESH_MODE="$REFRESH_MODE" bash -lc "$RUN_AS_ROOT_CMD"
    exit $?
fi

if command -v sudo >/dev/null 2>&1; then
    ANCHOR_DIR="$ANCHOR_DIR" CERT_PATH="$CERT_PATH" TARGET_PATH="$TARGET_PATH" REFRESH_MODE="$REFRESH_MODE" sudo bash -lc "$RUN_AS_ROOT_CMD"
    exit $?
fi

echo "[ERROR] no privilege escalation method available (sudo not found)." 1>&2
exit 4

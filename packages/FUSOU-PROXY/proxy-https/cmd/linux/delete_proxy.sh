#!/bin/bash

set -eu
set -o pipefail

SCRIPT_NAME="$(basename -- "$0")"

log_info() {
    echo "[INFO][$SCRIPT_NAME] $1" 1>&2
}

log_error() {
    echo "[ERROR][$SCRIPT_NAME] $1" 1>&2
}

on_error() {
    local exit_code="$1"
    local line_no="$2"
    log_error "command failed at line $line_no with exit code $exit_code"
    exit "$exit_code"
}

trap 'on_error $? $LINENO' ERR

has_gsettings_proxy() {
    command -v gsettings >/dev/null 2>&1 && gsettings list-schemas 2>/dev/null | grep -qx 'org.gnome.system.proxy'
}

find_kwriteconfig() {
    if command -v kwriteconfig6 >/dev/null 2>&1; then
        echo "kwriteconfig6"
        return
    fi
    if command -v kwriteconfig5 >/dev/null 2>&1; then
        echo "kwriteconfig5"
        return
    fi
    echo ""
}

if has_gsettings_proxy; then
    log_info "detected GNOME gsettings backend"
    gsettings reset org.gnome.system.proxy mode
    gsettings reset org.gnome.system.proxy autoconfig-url
    log_info "cleared PAC via gsettings"
    exit 0
fi

KWRITECONFIG_BIN="$(find_kwriteconfig)"
if [ -n "$KWRITECONFIG_BIN" ]; then
    log_info "detected KDE backend via $KWRITECONFIG_BIN"
    "$KWRITECONFIG_BIN" --file kioslaverc --group "Proxy Settings" --key ProxyType 0
    "$KWRITECONFIG_BIN" --file kioslaverc --group "Proxy Settings" --key "Proxy Config Script" ""
    log_info "cleared PAC via KDE config"
    exit 0
fi

log_error "unsupported desktop proxy backend. neither GNOME gsettings nor KDE kwriteconfig was found"
exit 4

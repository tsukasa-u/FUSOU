#!/bin/bash

set -eu

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
    gsettings reset org.gnome.system.proxy mode
    gsettings reset org.gnome.system.proxy autoconfig-url
    exit 0
fi

KWRITECONFIG_BIN="$(find_kwriteconfig)"
if [ -n "$KWRITECONFIG_BIN" ]; then
    "$KWRITECONFIG_BIN" --file kioslaverc --group "Proxy Settings" --key ProxyType 0
    "$KWRITECONFIG_BIN" --file kioslaverc --group "Proxy Settings" --key "Proxy Config Script" ""
    exit 0
fi

echo "[ERROR] unsupported desktop proxy backend. Neither GNOME gsettings nor KDE kwriteconfig was found." 1>&2
exit 4

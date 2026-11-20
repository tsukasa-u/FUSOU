#!/bin/bash

set -uo pipefail
umask 077

SCRIPT_NAME="$(basename -- "$0")"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PAC_SCRIPT_NAME="$SCRIPT_NAME"
source "$SCRIPT_DIR/pac_settings_common.sh"

if [[ $# -ne 2 ]]; then
    pac_log_error "usage_invalid"
    exit 2
fi

if ! pac_initialize_state_path "$2"; then
    exit 1
fi
if ! pac_apply "$1"; then
    exit 1
fi

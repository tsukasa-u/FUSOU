#!/bin/bash

set -u
set -o pipefail
umask 077

PAC_GSETTINGS_SCHEMA="org.gnome.system.proxy"
PAC_STATE_VERSION="1"
PAC_MISSING_SENTINEL="__FUSOU_PAC_CONFIG_KEY_MISSING_4d2ecf0e_2a93_4d95_973f_f1b9b31a6e26__"
PAC_MISSING_SENTINEL_ALT="__FUSOU_PAC_CONFIG_KEY_MISSING_0e1bb4b9_2215_4ddb_88cc_03c0274ed8c8__"
PAC_SCRIPT_NAME="${PAC_SCRIPT_NAME:-pac-settings}"
PAC_STATE_FILE=""
PAC_BACKEND=""
PAC_BACKEND_IMPL=""
PAC_GNOME_PRESENCE_MODE="unknown"
PAC_KWRITE_BIN=""
PAC_KREAD_BIN=""
PAC_PHASE=""
PAC_ORIGINAL_MODE=""
PAC_ORIGINAL_MODE_PRESENCE=""
PAC_ORIGINAL_URL=""
PAC_ORIGINAL_URL_PRESENCE=""
PAC_APPLIED_MODE=""
PAC_APPLIED_MODE_PRESENCE=""
PAC_APPLIED_URL=""
PAC_APPLIED_URL_PRESENCE=""
PAC_READ_VALUE=""
PAC_READ_PRESENCE=""
PAC_DECODED=""
PAC_EXTERNAL_CHANGE=0
declare -A PAC_SAVED_STATE=()

pac_log_info() {
    printf '[INFO][%s] code=%s\n' "$PAC_SCRIPT_NAME" "$1" >&2
}

pac_log_error() {
    printf '[ERROR][%s] code=%s\n' "$PAC_SCRIPT_NAME" "$1" >&2
}

pac_encode() {
    printf '%s' "$1" | base64 | tr -d '\n'
}

pac_decode() {
    local output
    [[ "$1" =~ ^[A-Za-z0-9+/]*={0,2}$ ]] || return 1
    output=$(printf '%s' "$1" | base64 --decode 2>/dev/null && printf '\001') || return 1
    PAC_DECODED="${output%$'\001'}"
}

pac_initialize_state_path() {
    PAC_STATE_FILE="$1"
    case "$PAC_STATE_FILE" in
        /*) ;;
        *) pac_log_error "pac_state_path_must_be_absolute"; return 1 ;;
    esac
    [[ "${PAC_STATE_FILE##*/}" != "" ]] || {
        pac_log_error "pac_state_path_invalid"
        return 1
    }

    local state_dir="${PAC_STATE_FILE%/*}"
    if ! mkdir -p -- "$state_dir" 2>/dev/null; then
        pac_log_error "pac_state_directory_unavailable"
        return 1
    fi
    if ! { exec 9>"${PAC_STATE_FILE}.lock"; } 2>/dev/null; then
        pac_log_error "pac_state_lock_unavailable"
        return 1
    fi
    if ! flock --exclusive --wait 30 9 >/dev/null 2>&1; then
        pac_log_error "pac_state_lock_timeout"
        return 1
    fi
}

pac_has_gsettings_proxy() {
    command -v gsettings >/dev/null 2>&1 || return 1
    gsettings list-schemas 2>/dev/null | grep -qx "$PAC_GSETTINGS_SCHEMA"
}

pac_find_kde_pair() {
    local version writer reader
    for version in 6 5; do
        writer="kwriteconfig${version}"
        reader="kreadconfig${version}"
        if command -v "$writer" >/dev/null 2>&1 && command -v "$reader" >/dev/null 2>&1; then
            PAC_KWRITE_BIN="$writer"
            PAC_KREAD_BIN="$reader"
            PAC_BACKEND_IMPL="kde${version}"
            return 0
        fi
    done
    return 1
}

pac_set_gnome_backend_impl() {
    if [[ "${GSETTINGS_BACKEND+x}" == "x" ]]; then
        PAC_BACKEND_IMPL="gnome-env:$(pac_encode "$GSETTINGS_BACKEND")"
    else
        PAC_BACKEND_IMPL="gnome-default"
    fi

    if command -v dconf >/dev/null 2>&1 &&
        { [[ "${GSETTINGS_BACKEND+x}" != "x" ]] || [[ "$GSETTINGS_BACKEND" == "dconf" ]]; }; then
        PAC_GNOME_PRESENCE_MODE="dconf"
    else
        PAC_GNOME_PRESENCE_MODE="unknown"
    fi
}

pac_select_backend_for_apply() {
    local desktop="${XDG_CURRENT_DESKTOP:-} ${XDG_SESSION_DESKTOP:-}"
    desktop="${desktop,,}"

    if [[ "$desktop" == *kde* || "$desktop" == *plasma* ]]; then
        if pac_find_kde_pair; then
            PAC_BACKEND="kde"
            return 0
        fi
        pac_log_error "pac_kde_backend_unavailable"
        return 1
    fi
    if [[ "$desktop" == *gnome* || "$desktop" == *cinnamon* || "$desktop" == *mate* ]]; then
        if pac_has_gsettings_proxy; then
            PAC_BACKEND="gnome"
            pac_set_gnome_backend_impl
            return 0
        fi
        pac_log_error "pac_gnome_backend_unavailable"
        return 1
    fi

    local has_gnome=0 has_kde=0
    if pac_has_gsettings_proxy; then has_gnome=1; fi
    if pac_find_kde_pair; then has_kde=1; fi
    if (( has_gnome == has_kde )); then
        pac_log_error "pac_proxy_backend_ambiguous_or_unsupported"
        return 1
    fi
    if (( has_gnome == 1 )); then
        PAC_BACKEND="gnome"
        pac_set_gnome_backend_impl
    else
        PAC_BACKEND="kde"
    fi
}

pac_bind_saved_backend() {
    case "$PAC_BACKEND" in
        gnome)
            if ! pac_has_gsettings_proxy; then
                pac_log_error "pac_saved_gnome_backend_unavailable"
                return 1
            fi
            case "$PAC_BACKEND_IMPL" in
                gnome-default)
                    if [[ "${GSETTINGS_BACKEND+x}" == "x" ]]; then
                        pac_log_error "pac_gsettings_backend_changed"
                        return 1
                    fi
                    ;;
                gnome-env:*)
                    if ! pac_decode "${PAC_BACKEND_IMPL#gnome-env:}"; then
                        pac_log_error "pac_state_invalid"
                        return 1
                    fi
                    if [[ "${GSETTINGS_BACKEND+x}" != "x" || "$GSETTINGS_BACKEND" != "$PAC_DECODED" ]]; then
                        pac_log_error "pac_gsettings_backend_changed"
                        return 1
                    fi
                    ;;
                *)
                    pac_log_error "pac_state_invalid"
                    return 1
                    ;;
            esac
            pac_set_gnome_backend_impl
            if [[ "$PAC_GNOME_PRESENCE_MODE" != "dconf" ]] &&
                [[ "$PAC_ORIGINAL_MODE_PRESENCE" != "unknown" ||
                    "$PAC_ORIGINAL_URL_PRESENCE" != "unknown" ||
                    "$PAC_APPLIED_MODE_PRESENCE" != "unknown" ||
                    "$PAC_APPLIED_URL_PRESENCE" != "unknown" ]]; then
                pac_log_error "pac_saved_gnome_presence_unavailable"
                return 1
            fi
            return 0
            ;;
        kde)
            case "$PAC_BACKEND_IMPL" in
                kde6)
                    PAC_KWRITE_BIN="kwriteconfig6"
                    PAC_KREAD_BIN="kreadconfig6"
                    ;;
                kde5)
                    PAC_KWRITE_BIN="kwriteconfig5"
                    PAC_KREAD_BIN="kreadconfig5"
                    ;;
                *)
                    pac_log_error "pac_state_invalid"
                    return 1
                    ;;
            esac
            if ! command -v "$PAC_KWRITE_BIN" >/dev/null 2>&1 ||
                ! command -v "$PAC_KREAD_BIN" >/dev/null 2>&1; then
                pac_log_error "pac_saved_kde_backend_unavailable"
                return 1
            fi
            ;;
        *)
            pac_log_error "pac_state_invalid"
            return 1
            ;;
    esac
}

pac_setting_name() {
    case "$1" in
        mode)
            if [[ "$PAC_BACKEND" == "gnome" ]]; then
                PAC_SETTING_NAME="mode"
            else
                PAC_SETTING_NAME="ProxyType"
            fi
            ;;
        url)
            if [[ "$PAC_BACKEND" == "gnome" ]]; then
                PAC_SETTING_NAME="autoconfig-url"
            else
                PAC_SETTING_NAME="Proxy Config Script"
            fi
            ;;
        *)
            return 1
            ;;
    esac
}

pac_read_setting() {
    local key="$1"
    local output
    pac_setting_name "$key" || return 1

    if [[ "$PAC_BACKEND" == "gnome" ]]; then
        output=$(gsettings get "$PAC_GSETTINGS_SCHEMA" "$PAC_SETTING_NAME" 2>/dev/null) || return 1
        PAC_READ_VALUE="$output"
        PAC_READ_PRESENCE="unknown"
        if [[ "$PAC_GNOME_PRESENCE_MODE" == "dconf" ]]; then
            local path="/system/proxy/$PAC_SETTING_NAME"
            output=$(dconf read "$path" 2>/dev/null) || return 1
            if [[ -n "$output" ]]; then
                PAC_READ_PRESENCE="present"
            else
                PAC_READ_PRESENCE="absent"
            fi
        fi
        return 0
    fi

    output=$(
        "$PAC_KREAD_BIN" \
            --file kioslaverc \
            --group "Proxy Settings" \
            --key "$PAC_SETTING_NAME" \
            --default "$PAC_MISSING_SENTINEL" 2>/dev/null
    ) || return 1
    if [[ "$output" == "$PAC_MISSING_SENTINEL" ]]; then
        output=$(
            "$PAC_KREAD_BIN" \
                --file kioslaverc \
                --group "Proxy Settings" \
                --key "$PAC_SETTING_NAME" \
                --default "$PAC_MISSING_SENTINEL_ALT" 2>/dev/null
        ) || return 1
        if [[ "$output" == "$PAC_MISSING_SENTINEL_ALT" ]]; then
            PAC_READ_VALUE="$PAC_MISSING_SENTINEL"
            PAC_READ_PRESENCE="absent"
        else
            PAC_READ_VALUE="$output"
            PAC_READ_PRESENCE="present"
        fi
    else
        PAC_READ_VALUE="$output"
        PAC_READ_PRESENCE="present"
    fi
}

pac_write_setting() {
    local key="$1"
    local value="$2"
    pac_setting_name "$key" || return 1
    if [[ "$PAC_BACKEND" == "gnome" ]]; then
        gsettings set "$PAC_GSETTINGS_SCHEMA" "$PAC_SETTING_NAME" "$value" >/dev/null 2>&1
    else
        "$PAC_KWRITE_BIN" \
            --file kioslaverc \
            --group "Proxy Settings" \
            --key "$PAC_SETTING_NAME" \
            "$value" >/dev/null 2>&1
    fi
}

pac_delete_setting() {
    local key="$1"
    pac_setting_name "$key" || return 1
    if [[ "$PAC_BACKEND" == "gnome" ]]; then
        gsettings reset "$PAC_GSETTINGS_SCHEMA" "$PAC_SETTING_NAME" >/dev/null 2>&1
    else
        "$PAC_KWRITE_BIN" \
            --delete \
            --file kioslaverc \
            --group "Proxy Settings" \
            --key "$PAC_SETTING_NAME" >/dev/null 2>&1
    fi
}

pac_presence_matches() {
    local expected="$1"
    local actual="$2"
    [[ "$expected" == "unknown" || "$expected" == "$actual" ]]
}

pac_state_write() {
    local temporary original_mode original_url applied_mode applied_url
    original_mode=$(pac_encode "$PAC_ORIGINAL_MODE") || return 1
    original_url=$(pac_encode "$PAC_ORIGINAL_URL") || return 1
    applied_mode=$(pac_encode "$PAC_APPLIED_MODE") || return 1
    applied_url=$(pac_encode "$PAC_APPLIED_URL") || return 1
    temporary=$(mktemp "${PAC_STATE_FILE}.tmp.XXXXXX" 2>/dev/null) || return 1
    chmod 600 "$temporary" 2>/dev/null || {
        rm -f -- "$temporary" 2>/dev/null
        return 1
    }
    if ! {
        printf 'version=%s\n' "$PAC_STATE_VERSION"
        printf 'backend=%s\n' "$PAC_BACKEND"
        printf 'backend_impl=%s\n' "$PAC_BACKEND_IMPL"
        printf 'phase=%s\n' "$PAC_PHASE"
        printf 'original_mode=%s\n' "$original_mode"
        printf 'original_mode_presence=%s\n' "$PAC_ORIGINAL_MODE_PRESENCE"
        printf 'original_url=%s\n' "$original_url"
        printf 'original_url_presence=%s\n' "$PAC_ORIGINAL_URL_PRESENCE"
        printf 'applied_mode=%s\n' "$applied_mode"
        printf 'applied_mode_presence=%s\n' "$PAC_APPLIED_MODE_PRESENCE"
        printf 'applied_url=%s\n' "$applied_url"
        printf 'applied_url_presence=%s\n' "$PAC_APPLIED_URL_PRESENCE"
    } >"$temporary"; then
        rm -f -- "$temporary" 2>/dev/null
        return 1
    fi
    if ! mv -f -- "$temporary" "$PAC_STATE_FILE" 2>/dev/null; then
        rm -f -- "$temporary" 2>/dev/null
        return 1
    fi
}

pac_state_load() {
    local line key value
    PAC_SAVED_STATE=()
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ "$line" == *=* ]] || return 1
        key="${line%%=*}"
        value="${line#*=}"
        case "$key" in
            version|backend|backend_impl|phase|original_mode|original_mode_presence|original_url|original_url_presence|applied_mode|applied_mode_presence|applied_url|applied_url_presence) ;;
            *) return 1 ;;
        esac
        [[ -z "${PAC_SAVED_STATE[$key]+present}" ]] || return 1
        PAC_SAVED_STATE["$key"]="$value"
    done <"$PAC_STATE_FILE"

    local required
    for required in version backend backend_impl phase original_mode original_mode_presence original_url original_url_presence applied_mode applied_mode_presence applied_url applied_url_presence; do
        [[ -n "${PAC_SAVED_STATE[$required]+present}" ]] || return 1
    done
    [[ "${PAC_SAVED_STATE[version]}" == "$PAC_STATE_VERSION" ]] || return 1
    [[ "${PAC_SAVED_STATE[phase]}" == "pending" ||
        "${PAC_SAVED_STATE[phase]}" == "active" ||
        "${PAC_SAVED_STATE[phase]}" == "rollback" ||
        "${PAC_SAVED_STATE[phase]}" == "removing" ||
        "${PAC_SAVED_STATE[phase]}" == "recovering" ]] || return 1
    [[ "${PAC_SAVED_STATE[original_mode_presence]}" =~ ^(present|absent|unknown)$ ]] || return 1
    [[ "${PAC_SAVED_STATE[original_url_presence]}" =~ ^(present|absent|unknown)$ ]] || return 1
    [[ "${PAC_SAVED_STATE[applied_mode_presence]}" =~ ^(present|unknown)$ ]] || return 1
    [[ "${PAC_SAVED_STATE[applied_url_presence]}" =~ ^(present|unknown)$ ]] || return 1

    PAC_BACKEND="${PAC_SAVED_STATE[backend]}"
    PAC_BACKEND_IMPL="${PAC_SAVED_STATE[backend_impl]}"
    PAC_PHASE="${PAC_SAVED_STATE[phase]}"
    PAC_ORIGINAL_MODE_PRESENCE="${PAC_SAVED_STATE[original_mode_presence]}"
    PAC_ORIGINAL_URL_PRESENCE="${PAC_SAVED_STATE[original_url_presence]}"
    PAC_APPLIED_MODE_PRESENCE="${PAC_SAVED_STATE[applied_mode_presence]}"
    PAC_APPLIED_URL_PRESENCE="${PAC_SAVED_STATE[applied_url_presence]}"
    pac_decode "${PAC_SAVED_STATE[original_mode]}" || return 1
    PAC_ORIGINAL_MODE="$PAC_DECODED"
    pac_decode "${PAC_SAVED_STATE[original_url]}" || return 1
    PAC_ORIGINAL_URL="$PAC_DECODED"
    pac_decode "${PAC_SAVED_STATE[applied_mode]}" || return 1
    PAC_APPLIED_MODE="$PAC_DECODED"
    pac_decode "${PAC_SAVED_STATE[applied_url]}" || return 1
    PAC_APPLIED_URL="$PAC_DECODED"
    [[ "$PAC_BACKEND" == "gnome" || "$PAC_BACKEND" == "kde" ]] || return 1
}

pac_restore_original_setting() {
    local key="$1"
    local presence="$2"
    local value="$3"
    if [[ "$presence" == "absent" ]]; then
        pac_delete_setting "$key"
    else
        pac_write_setting "$key" "$value"
    fi
}

pac_restore_owned_setting() {
    local key="$1"
    local original_value="$2"
    local original_presence="$3"
    local applied_value="$4"
    local applied_presence="$5"

    if ! pac_read_setting "$key"; then
        pac_log_error "pac_setting_readback_unconfirmed"
        return 1
    fi
    local current_value="$PAC_READ_VALUE"
    local current_presence="$PAC_READ_PRESENCE"

    if [[ "$current_value" == "$original_value" ]] &&
        pac_presence_matches "$original_presence" "$current_presence"; then
        return 0
    fi

    if [[ "$current_value" != "$applied_value" ]] ||
        ! pac_presence_matches "$applied_presence" "$current_presence"; then
        PAC_EXTERNAL_CHANGE=1
        pac_log_info "pac_external_setting_preserved"
        return 0
    fi

    if ! pac_restore_original_setting "$key" "$original_presence" "$original_value"; then
        pac_log_error "pac_original_setting_restore_failed"
        return 1
    fi
    if ! pac_read_setting "$key"; then
        pac_log_error "pac_restore_readback_unconfirmed"
        return 1
    fi
    if [[ "$PAC_READ_VALUE" != "$original_value" ]] ||
        ! pac_presence_matches "$original_presence" "$PAC_READ_PRESENCE"; then
        pac_log_error "pac_restore_readback_mismatch"
        return 1
    fi
    return 0
}

pac_pair_value_matches() {
    local current_value="$1"
    local current_presence="$2"
    local expected_value="$3"
    local expected_presence="$4"
    [[ "$current_value" == "$expected_value" ]] &&
        pac_presence_matches "$expected_presence" "$current_presence"
}

pac_read_current_pair() {
    if ! pac_read_setting mode; then
        pac_log_error "pac_mode_readback_unconfirmed"
        return 1
    fi
    PAC_CURRENT_MODE="$PAC_READ_VALUE"
    PAC_CURRENT_MODE_PRESENCE="$PAC_READ_PRESENCE"
    if ! pac_read_setting url; then
        pac_log_error "pac_url_readback_unconfirmed"
        return 1
    fi
    PAC_CURRENT_URL="$PAC_READ_VALUE"
    PAC_CURRENT_URL_PRESENCE="$PAC_READ_PRESENCE"
}

pac_restore_active_pair() {
    if ! pac_read_current_pair; then
        return 1
    fi

    local mode_original=0
    local url_original=0
    local mode_applied=0
    local url_applied=0
    if pac_pair_value_matches "$PAC_CURRENT_MODE" "$PAC_CURRENT_MODE_PRESENCE" \
        "$PAC_ORIGINAL_MODE" "$PAC_ORIGINAL_MODE_PRESENCE"; then
        mode_original=1
    fi
    if pac_pair_value_matches "$PAC_CURRENT_URL" "$PAC_CURRENT_URL_PRESENCE" \
        "$PAC_ORIGINAL_URL" "$PAC_ORIGINAL_URL_PRESENCE"; then
        url_original=1
    fi
    if pac_pair_value_matches "$PAC_CURRENT_MODE" "$PAC_CURRENT_MODE_PRESENCE" \
        "$PAC_APPLIED_MODE" "$PAC_APPLIED_MODE_PRESENCE"; then
        mode_applied=1
    fi
    if pac_pair_value_matches "$PAC_CURRENT_URL" "$PAC_CURRENT_URL_PRESENCE" \
        "$PAC_APPLIED_URL" "$PAC_APPLIED_URL_PRESENCE"; then
        url_applied=1
    fi

    local restore_mode=0
    local restore_url=0
    if [[ "$PAC_PHASE" != "removing" ]]; then
        pac_log_error "pac_recovery_phase_ambiguous"
        return 1
    fi
    if (( mode_original != 0 && url_original != 0 )); then
        return 0
    fi
    if (( (mode_original == 0 && mode_applied == 0) ||
        (url_original == 0 && url_applied == 0) )); then
        PAC_EXTERNAL_CHANGE=1
        pac_log_info "pac_external_pair_preserved"
        return 0
    fi

    if (( mode_original == 0 )); then
        restore_mode=1
    fi
    if (( url_original == 0 )); then
        restore_url=1
    fi
    if (( restore_mode != 0 )) &&
        ! pac_restore_original_setting mode "$PAC_ORIGINAL_MODE_PRESENCE" "$PAC_ORIGINAL_MODE"; then
        pac_log_error "pac_original_mode_restore_failed"
        return 1
    fi
    if (( restore_url != 0 )) &&
        ! pac_restore_original_setting url "$PAC_ORIGINAL_URL_PRESENCE" "$PAC_ORIGINAL_URL"; then
        pac_log_error "pac_original_url_restore_failed"
        return 1
    fi

    if ! pac_read_current_pair; then
        return 1
    fi
    if ! pac_pair_value_matches "$PAC_CURRENT_MODE" "$PAC_CURRENT_MODE_PRESENCE" \
        "$PAC_ORIGINAL_MODE" "$PAC_ORIGINAL_MODE_PRESENCE" ||
        ! pac_pair_value_matches "$PAC_CURRENT_URL" "$PAC_CURRENT_URL_PRESENCE" \
            "$PAC_ORIGINAL_URL" "$PAC_ORIGINAL_URL_PRESENCE"; then
        pac_log_error "pac_pair_restore_readback_mismatch"
        return 1
    fi
}

pac_remove_state_file() {
    rm -f -- "$PAC_STATE_FILE" 2>/dev/null
}

pac_rollback_after_apply_failure() {
    local failures=0
    PAC_PHASE="rollback"
    if ! pac_state_write; then
        pac_log_error "pac_recovery_state_update_failed"
    fi
    if ! pac_restore_owned_setting mode "$PAC_ORIGINAL_MODE" "$PAC_ORIGINAL_MODE_PRESENCE" "$PAC_APPLIED_MODE" "$PAC_APPLIED_MODE_PRESENCE"; then
        failures=1
    fi
    if ! pac_restore_owned_setting url "$PAC_ORIGINAL_URL" "$PAC_ORIGINAL_URL_PRESENCE" "$PAC_APPLIED_URL" "$PAC_APPLIED_URL_PRESENCE"; then
        failures=1
    fi
    if (( failures == 0 )); then
        if ! pac_remove_state_file; then
            failures=1
        fi
    fi
    if (( failures != 0 )); then
        pac_log_error "pac_apply_rollback_unconfirmed"
        return 1
    fi
    pac_log_info "pac_apply_rollback_verified"
}

pac_apply() {
    local pac_url="$1"
    if [[ ! "$pac_url" =~ ^http://localhost:([0-9]{1,5})/proxy\.pac$ ]]; then
        pac_log_error "pac_url_invalid"
        return 1
    fi
    local port="${BASH_REMATCH[1]}"
    if (( 10#$port < 1 || 10#$port > 65535 )); then
        pac_log_error "pac_url_invalid"
        return 1
    fi
    if [[ -e "$PAC_STATE_FILE" || -L "$PAC_STATE_FILE" ]]; then
        pac_log_error "pac_existing_recovery_state"
        return 1
    fi
    if ! pac_select_backend_for_apply; then
        return 1
    fi
    if ! pac_read_setting mode; then
        pac_log_error "pac_original_mode_read_failed"
        return 1
    fi
    PAC_ORIGINAL_MODE="$PAC_READ_VALUE"
    PAC_ORIGINAL_MODE_PRESENCE="$PAC_READ_PRESENCE"
    if ! pac_read_setting url; then
        pac_log_error "pac_original_url_read_failed"
        return 1
    fi
    PAC_ORIGINAL_URL="$PAC_READ_VALUE"
    PAC_ORIGINAL_URL_PRESENCE="$PAC_READ_PRESENCE"

    if [[ "$PAC_BACKEND" == "gnome" ]]; then
        PAC_APPLIED_MODE="'auto'"
        PAC_APPLIED_URL="'$pac_url'"
        if [[ "$PAC_GNOME_PRESENCE_MODE" == "dconf" ]]; then
            PAC_APPLIED_MODE_PRESENCE="present"
            PAC_APPLIED_URL_PRESENCE="present"
        else
            PAC_APPLIED_MODE_PRESENCE="unknown"
            PAC_APPLIED_URL_PRESENCE="unknown"
        fi
    else
        PAC_APPLIED_MODE="2"
        PAC_APPLIED_URL="$pac_url"
        PAC_APPLIED_MODE_PRESENCE="present"
        PAC_APPLIED_URL_PRESENCE="present"
    fi
    PAC_PHASE="pending"
    if ! pac_state_write; then
        pac_log_error "pac_original_state_persist_failed"
        return 1
    fi

    if ! pac_write_setting mode "$PAC_APPLIED_MODE"; then
        pac_log_error "pac_mode_write_failed"
        pac_rollback_after_apply_failure || true
        return 1
    fi
    if ! pac_write_setting url "$PAC_APPLIED_URL"; then
        pac_log_error "pac_url_write_failed"
        pac_rollback_after_apply_failure || true
        return 1
    fi
    if ! pac_read_setting mode ||
        [[ "$PAC_READ_VALUE" != "$PAC_APPLIED_MODE" ]] ||
        ! pac_presence_matches "$PAC_APPLIED_MODE_PRESENCE" "$PAC_READ_PRESENCE"; then
        pac_log_error "pac_mode_readback_failed"
        pac_rollback_after_apply_failure || true
        return 1
    fi
    if ! pac_read_setting url ||
        [[ "$PAC_READ_VALUE" != "$PAC_APPLIED_URL" ]] ||
        ! pac_presence_matches "$PAC_APPLIED_URL_PRESENCE" "$PAC_READ_PRESENCE"; then
        pac_log_error "pac_url_readback_failed"
        pac_rollback_after_apply_failure || true
        return 1
    fi

    PAC_PHASE="active"
    if ! pac_state_write; then
        pac_log_error "pac_active_state_persist_failed"
        pac_rollback_after_apply_failure || true
        return 1
    fi
    pac_log_info "pac_application_verified"
}

pac_remove() {
    if [[ ! -e "$PAC_STATE_FILE" && ! -L "$PAC_STATE_FILE" ]]; then
        pac_log_info "pac_state_absent_no_settings_changed"
        return 0
    fi
    if [[ -L "$PAC_STATE_FILE" || ! -f "$PAC_STATE_FILE" ]] ||
        ! pac_state_load; then
        pac_log_error "pac_recovery_state_invalid"
        return 1
    fi
    if ! pac_bind_saved_backend; then
        return 1
    fi

    case "$PAC_PHASE" in
        pending|rollback)
            if ! pac_rollback_after_apply_failure; then
                return 1
            fi
            return 0
            ;;
        active)
            if ! pac_read_current_pair; then
                pac_log_error "pac_restore_unconfirmed"
                return 1
            fi
            if pac_pair_value_matches "$PAC_CURRENT_MODE" "$PAC_CURRENT_MODE_PRESENCE" \
                "$PAC_ORIGINAL_MODE" "$PAC_ORIGINAL_MODE_PRESENCE" &&
                pac_pair_value_matches "$PAC_CURRENT_URL" "$PAC_CURRENT_URL_PRESENCE" \
                    "$PAC_ORIGINAL_URL" "$PAC_ORIGINAL_URL_PRESENCE"; then
                PAC_EXTERNAL_CHANGE=0
                if ! pac_remove_state_file; then
                    pac_log_error "pac_recovery_state_remove_failed"
                    return 1
                fi
                pac_log_info "pac_cleanup_verified"
                return 0
            fi
            if ! pac_pair_value_matches "$PAC_CURRENT_MODE" "$PAC_CURRENT_MODE_PRESENCE" \
                "$PAC_APPLIED_MODE" "$PAC_APPLIED_MODE_PRESENCE" ||
                ! pac_pair_value_matches "$PAC_CURRENT_URL" "$PAC_CURRENT_URL_PRESENCE" \
                    "$PAC_APPLIED_URL" "$PAC_APPLIED_URL_PRESENCE"; then
                PAC_EXTERNAL_CHANGE=1
                if ! pac_remove_state_file; then
                    pac_log_error "pac_recovery_state_remove_failed"
                    return 1
                fi
                pac_log_info "pac_cleanup_verified_external_changes_preserved"
                return 0
            fi
            PAC_PHASE="removing"
            if ! pac_state_write; then
                pac_log_error "pac_recovery_state_persist_failed"
                return 1
            fi
            ;;
        removing)
            ;;
        recovering)
            pac_log_error "pac_recovery_phase_ambiguous"
            return 1
            ;;
        *)
            pac_log_error "pac_recovery_phase_ambiguous"
            return 1
            ;;
    esac

    PAC_EXTERNAL_CHANGE=0
    if ! pac_restore_active_pair; then
        pac_log_error "pac_restore_unconfirmed"
        return 1
    fi
    if ! pac_remove_state_file; then
        pac_log_error "pac_recovery_state_remove_failed"
        return 1
    fi
    if (( PAC_EXTERNAL_CHANGE != 0 )); then
        pac_log_info "pac_cleanup_verified_external_changes_preserved"
    else
        pac_log_info "pac_cleanup_verified"
    fi
}

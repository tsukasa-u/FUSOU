#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
RESOURCE_DIR="$REPO_ROOT/packages/FUSOU-APP/src-tauri/resources/cmd/linux"
ADD_SCRIPT="$RESOURCE_DIR/add_proxy.sh"
DELETE_SCRIPT="$RESOURCE_DIR/delete_proxy.sh"
TEST_ROOT="$(mktemp -d)"
GNOME_BIN="$TEST_ROOT/gnome-bin"
KDE_BIN="$TEST_ROOT/kde-bin"
PAC_URL="http://localhost:34567/proxy.pac"
GNOME_TARGET_URL="'$PAC_URL'"
TEST_COUNT=0
CASE_COUNT=0
MOCK_FAIL_GET_KEY=""
MOCK_FAIL_GET_AT=""
MOCK_FAIL_SET_KEY=""
MOCK_FAIL_SET_VALUE=""
MOCK_FAIL_SET_AFTER_WRITE=""
MOCK_FAIL_STATE_MOVE=""
MOCK_FAIL_DCONF_KEY=""
MOCK_FAIL_DCONF_AT=""

trap 'rm -rf -- "$TEST_ROOT"' EXIT

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

pass() {
    TEST_COUNT=$((TEST_COUNT + 1))
    printf 'PASS: %s\n' "$1"
}

new_case() {
    CASE_COUNT=$((CASE_COUNT + 1))
    CASE_DIR="$TEST_ROOT/case-$CASE_COUNT"
    mkdir -p "$CASE_DIR"
}

clear_faults() {
    MOCK_FAIL_GET_KEY=""
    MOCK_FAIL_GET_AT=""
    MOCK_FAIL_SET_KEY=""
    MOCK_FAIL_SET_VALUE=""
    MOCK_FAIL_SET_AFTER_WRITE=""
    MOCK_FAIL_STATE_MOVE=""
    MOCK_FAIL_DCONF_KEY=""
    MOCK_FAIL_DCONF_AT=""
}

run_gnome() {
    local settings_dir="$1"
    shift
    env \
        PATH="$GNOME_BIN:/usr/bin:/bin" \
        XDG_CURRENT_DESKTOP="GNOME" \
        GSETTINGS_BACKEND="dconf" \
        MOCK_SETTINGS_DIR="$settings_dir" \
        MOCK_FAIL_GET_KEY="$MOCK_FAIL_GET_KEY" \
        MOCK_FAIL_GET_AT="$MOCK_FAIL_GET_AT" \
        MOCK_FAIL_SET_KEY="$MOCK_FAIL_SET_KEY" \
        MOCK_FAIL_SET_VALUE="$MOCK_FAIL_SET_VALUE" \
        MOCK_FAIL_SET_AFTER_WRITE="$MOCK_FAIL_SET_AFTER_WRITE" \
        MOCK_FAIL_STATE_MOVE="$MOCK_FAIL_STATE_MOVE" \
        MOCK_FAIL_DCONF_KEY="$MOCK_FAIL_DCONF_KEY" \
        MOCK_FAIL_DCONF_AT="$MOCK_FAIL_DCONF_AT" \
        "$@"
}

run_kde() {
    local settings_dir="$1"
    shift
    env \
        PATH="$KDE_BIN:/usr/bin:/bin" \
        XDG_CURRENT_DESKTOP="KDE" \
        GSETTINGS_BACKEND="keyfile" \
        MOCK_SETTINGS_DIR="$settings_dir" \
        MOCK_FAIL_GET_KEY="$MOCK_FAIL_GET_KEY" \
        MOCK_FAIL_GET_AT="$MOCK_FAIL_GET_AT" \
        MOCK_FAIL_SET_KEY="$MOCK_FAIL_SET_KEY" \
        MOCK_FAIL_SET_VALUE="$MOCK_FAIL_SET_VALUE" \
        MOCK_FAIL_SET_AFTER_WRITE="$MOCK_FAIL_SET_AFTER_WRITE" \
        MOCK_FAIL_STATE_MOVE="$MOCK_FAIL_STATE_MOVE" \
        "$@"
}

assert_file_value() {
    local path="$1"
    local expected="$2"
    [[ -f "$path" ]] || fail "expected settings value file: $path"
    local actual
    actual="$(cat "$path")"
    [[ "$actual" == "$expected" ]] || fail "unexpected value in $path"
}

assert_present() {
    [[ -e "$1" ]] || fail "expected setting to be present: $1"
}

assert_absent() {
    [[ ! -e "$1" ]] || fail "expected setting to be absent: $1"
}

assert_no_state() {
    [[ ! -e "$1" ]] || fail "unexpected recovery state: $1"
}

assert_state_phase() {
    grep -Fqx "phase=$2" "$1" || fail "unexpected recovery phase in $1"
}

prepare_gnome() {
    local settings_dir="$1"
    local mode="$2"
    local mode_present="$3"
    local url="$4"
    local url_present="$5"
    mkdir -p "$settings_dir"
    printf '%s' "$mode" >"$settings_dir/gnome_mode.value"
    printf '%s' "$url" >"$settings_dir/gnome_autoconfig-url.value"
    if [[ "$mode_present" == "yes" ]]; then
        touch "$settings_dir/gnome_mode.present"
    fi
    if [[ "$url_present" == "yes" ]]; then
        touch "$settings_dir/gnome_autoconfig-url.present"
    fi
}

set_gnome_external() {
    local settings_dir="$1"
    local key="$2"
    local value="$3"
    local present="$4"
    printf '%s' "$value" >"$settings_dir/gnome_${key}.value"
    if [[ "$present" == "yes" ]]; then
        touch "$settings_dir/gnome_${key}.present"
    else
        rm -f "$settings_dir/gnome_${key}.present"
    fi
}

prepare_kde() {
    local settings_dir="$1"
    local mode="$2"
    local mode_present="$3"
    local url="$4"
    local url_present="$5"
    mkdir -p "$settings_dir"
    if [[ "$mode_present" == "yes" ]]; then
        printf '%s' "$mode" >"$settings_dir/kde_ProxyType.value"
        touch "$settings_dir/kde_ProxyType.present"
    fi
    if [[ "$url_present" == "yes" ]]; then
        printf '%s' "$url" >"$settings_dir/kde_Proxy_Config_Script.value"
        touch "$settings_dir/kde_Proxy_Config_Script.present"
    fi
}

set_kde_external() {
    local settings_dir="$1"
    local key="$2"
    local value="$3"
    printf '%s' "$value" >"$settings_dir/kde_${key// /_}.value"
    touch "$settings_dir/kde_${key// /_}.present"
}

mkdir -p "$GNOME_BIN" "$KDE_BIN"
cat >"$GNOME_BIN/gsettings" <<'MOCK'
#!/bin/bash
set -euo pipefail
case "$1" in
    list-schemas)
        printf '%s\n' org.gnome.system.proxy
        ;;
    get)
        key="$3"
        count_file="$MOCK_SETTINGS_DIR/gnome_get_${key}.count"
        count=0
        [[ ! -f "$count_file" ]] || count="$(cat "$count_file")"
        count=$((count + 1))
        printf '%s' "$count" >"$count_file"
        if [[ "$MOCK_FAIL_GET_KEY" == "$key" && -n "$MOCK_FAIL_GET_AT" && "$count" -ge "$MOCK_FAIL_GET_AT" ]]; then
            exit 91
        fi
        value_file="$MOCK_SETTINGS_DIR/gnome_${key}.value"
        if [[ -f "$value_file" ]]; then
            cat "$value_file"
        elif [[ "$key" == "mode" ]]; then
            printf '%s' "'none'"
        else
            printf '%s' "''"
        fi
        ;;
    set)
        key="$3"
        value="$4"
        count_file="$MOCK_SETTINGS_DIR/gnome_set_${key}.count"
        count=0
        [[ ! -f "$count_file" ]] || count="$(cat "$count_file")"
        printf '%s' "$((count + 1))" >"$count_file"
        if [[ "$MOCK_FAIL_SET_KEY" == "$key" && "$MOCK_FAIL_SET_VALUE" == "$value" ]]; then
            if [[ "$MOCK_FAIL_SET_AFTER_WRITE" == "yes" ]]; then
                printf '%s' "$value" >"$MOCK_SETTINGS_DIR/gnome_${key}.value"
                touch "$MOCK_SETTINGS_DIR/gnome_${key}.present"
            fi
            exit 92
        fi
        printf '%s' "$value" >"$MOCK_SETTINGS_DIR/gnome_${key}.value"
        touch "$MOCK_SETTINGS_DIR/gnome_${key}.present"
        ;;
    reset)
        key="$3"
        rm -f "$MOCK_SETTINGS_DIR/gnome_${key}.present"
        if [[ "$key" == "mode" ]]; then
            printf '%s' "'none'" >"$MOCK_SETTINGS_DIR/gnome_${key}.value"
        else
            printf '%s' "''" >"$MOCK_SETTINGS_DIR/gnome_${key}.value"
        fi
        ;;
    *)
        exit 93
        ;;
esac
MOCK
cat >"$GNOME_BIN/mv" <<'MOCK'
#!/bin/bash
set -euo pipefail
if [[ "$MOCK_FAIL_STATE_MOVE" == "yes" ]]; then
    for argument in "$@"; do
        if [[ "$argument" == *.tmp.* ]]; then
            exit 98
        fi
    done
fi
exec /usr/bin/mv "$@"
MOCK
cat >"$GNOME_BIN/dconf" <<'MOCK'
#!/bin/bash
set -euo pipefail
key="${2##*/}"
count_file="$MOCK_SETTINGS_DIR/dconf_get_${key}.count"
count=0
[[ ! -f "$count_file" ]] || count="$(cat "$count_file")"
count=$((count + 1))
printf '%s' "$count" >"$count_file"
if [[ "$MOCK_FAIL_DCONF_KEY" == "$key" && -n "$MOCK_FAIL_DCONF_AT" && "$count" -ge "$MOCK_FAIL_DCONF_AT" ]]; then
    exit 94
fi
value_file="$MOCK_SETTINGS_DIR/gnome_${key}.value"
presence_file="$MOCK_SETTINGS_DIR/gnome_${key}.present"
if [[ -f "$presence_file" ]]; then
    cat "$value_file"
fi
MOCK
cat >"$KDE_BIN/gsettings" <<'MOCK'
#!/bin/bash
if [[ "$1" == "list-schemas" ]]; then
    printf '%s\n' org.gnome.desktop.interface
    exit 0
fi
exit 1
MOCK
cat >"$KDE_BIN/kreadconfig6" <<'MOCK'
#!/bin/bash
set -euo pipefail
key=""
default=""
while (($#)); do
    case "$1" in
        --file|--group)
            shift 2
            ;;
        --key)
            key="$2"
            shift 2
            ;;
        --default)
            default="$2"
            shift 2
            ;;
        *)
            exit 95
            ;;
    esac
done
safe_key="${key// /_}"
count_file="$MOCK_SETTINGS_DIR/kde_get_${safe_key}.count"
count=0
[[ ! -f "$count_file" ]] || count="$(cat "$count_file")"
count=$((count + 1))
printf '%s' "$count" >"$count_file"
if [[ "$MOCK_FAIL_GET_KEY" == "$key" && -n "$MOCK_FAIL_GET_AT" && "$count" -ge "$MOCK_FAIL_GET_AT" ]]; then
    exit 96
fi
value_file="$MOCK_SETTINGS_DIR/kde_${safe_key}.value"
presence_file="$MOCK_SETTINGS_DIR/kde_${safe_key}.present"
if [[ -f "$presence_file" ]]; then
    cat "$value_file"
else
    printf '%s' "$default"
fi
MOCK
cat >"$KDE_BIN/kwriteconfig6" <<'MOCK'
#!/bin/bash
set -euo pipefail
key=""
value=""
delete_key=0
while (($#)); do
    case "$1" in
        --delete)
            delete_key=1
            shift
            ;;
        --file|--group)
            shift 2
            ;;
        --key)
            key="$2"
            shift 2
            ;;
        *)
            value="$1"
            shift
            ;;
    esac
done
safe_key="${key// /_}"
count_file="$MOCK_SETTINGS_DIR/kde_set_${safe_key}.count"
count=0
[[ ! -f "$count_file" ]] || count="$(cat "$count_file")"
printf '%s' "$((count + 1))" >"$count_file"
if (( delete_key == 1 )); then
    rm -f "$MOCK_SETTINGS_DIR/kde_${safe_key}.present" "$MOCK_SETTINGS_DIR/kde_${safe_key}.value"
    exit 0
fi
if [[ "$MOCK_FAIL_SET_KEY" == "$key" && "$MOCK_FAIL_SET_VALUE" == "$value" ]]; then
    if [[ "$MOCK_FAIL_SET_AFTER_WRITE" == "yes" ]]; then
        printf '%s' "$value" >"$MOCK_SETTINGS_DIR/kde_${safe_key}.value"
        touch "$MOCK_SETTINGS_DIR/kde_${safe_key}.present"
    fi
    exit 97
fi
printf '%s' "$value" >"$MOCK_SETTINGS_DIR/kde_${safe_key}.value"
touch "$MOCK_SETTINGS_DIR/kde_${safe_key}.present"
MOCK
cat >"$KDE_BIN/mv" <<'MOCK'
#!/bin/bash
set -euo pipefail
if [[ "$MOCK_FAIL_STATE_MOVE" == "yes" ]]; then
    for argument in "$@"; do
        if [[ "$argument" == *.tmp.* ]]; then
            exit 98
        fi
    done
fi
exec /usr/bin/mv "$@"
MOCK
chmod +x "$GNOME_BIN/gsettings" "$GNOME_BIN/dconf" \
    "$GNOME_BIN/mv" "$KDE_BIN/gsettings" "$KDE_BIN/kreadconfig6" \
    "$KDE_BIN/kwriteconfig6" "$KDE_BIN/mv"

test_gnome_manual_and_absent_settings_restore() {
    new_case
    local state="$CASE_DIR/state/pac.state"
    prepare_gnome "$CASE_DIR/settings" "'manual'" yes "''" no
    clear_faults
    run_gnome "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'auto'"
    assert_file_value "$CASE_DIR/settings/gnome_autoconfig-url.value" "$GNOME_TARGET_URL"
    assert_present "$CASE_DIR/settings/gnome_autoconfig-url.present"
    [[ "$(stat -c '%a' "$state")" == "600" ]] || fail "GNOME recovery state permissions are not private"
    run_gnome "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'manual'"
    assert_present "$CASE_DIR/settings/gnome_mode.present"
    assert_file_value "$CASE_DIR/settings/gnome_autoconfig-url.value" "''"
    assert_absent "$CASE_DIR/settings/gnome_autoconfig-url.present"
    assert_no_state "$state"
    pass "GNOME restores manual mode and absent PAC URL"
}

test_gnome_absent_mode_restore() {
    new_case
    local state="$CASE_DIR/state/pac.state"
    prepare_gnome "$CASE_DIR/settings" "'none'" no "''" no
    clear_faults
    run_gnome "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    run_gnome "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'none'"
    assert_absent "$CASE_DIR/settings/gnome_mode.present"
    assert_absent "$CASE_DIR/settings/gnome_autoconfig-url.present"
    assert_no_state "$state"
    pass "GNOME removes an originally absent mode override"
}

test_gnome_existing_pac_restore() {
    new_case
    local old_url="'https://previous.example/proxy.pac'"
    local state="$CASE_DIR/state/pac.state"
    prepare_gnome "$CASE_DIR/settings" "'auto'" yes "$old_url" yes
    clear_faults
    run_gnome "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    run_gnome "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'auto'"
    assert_file_value "$CASE_DIR/settings/gnome_autoconfig-url.value" "$old_url"
    assert_present "$CASE_DIR/settings/gnome_autoconfig-url.present"
    assert_no_state "$state"
    pass "GNOME restores an existing PAC configuration"
}

test_gnome_second_write_failure_rolls_back() {
    new_case
    local old_url="'https://previous.example/proxy.pac'"
    local state="$CASE_DIR/state/pac.state"
    prepare_gnome "$CASE_DIR/settings" "'manual'" yes "$old_url" yes
    clear_faults
    MOCK_FAIL_SET_KEY="autoconfig-url"
    MOCK_FAIL_SET_VALUE="$GNOME_TARGET_URL"
    MOCK_FAIL_SET_AFTER_WRITE="yes"
    if run_gnome "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1; then
        fail "GNOME accepted a failed second write"
    fi
    clear_faults
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'manual'"
    assert_file_value "$CASE_DIR/settings/gnome_autoconfig-url.value" "$old_url"
    assert_present "$CASE_DIR/settings/gnome_mode.present"
    assert_present "$CASE_DIR/settings/gnome_autoconfig-url.present"
    assert_no_state "$state"
    pass "GNOME rolls back a second write that mutated before failing"
}

test_gnome_snapshot_read_failure_writes_nothing() {
    new_case
    local state="$CASE_DIR/state/pac.state"
    prepare_gnome "$CASE_DIR/settings" "'manual'" yes "''" no
    clear_faults
    MOCK_FAIL_GET_KEY="mode"
    MOCK_FAIL_GET_AT="1"
    if run_gnome "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1; then
        fail "GNOME accepted an unreadable initial snapshot"
    fi
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'manual'"
    assert_absent "$CASE_DIR/settings/gnome_set_mode.count"
    assert_absent "$CASE_DIR/settings/gnome_set_autoconfig-url.count"
    assert_no_state "$state"
    pass "GNOME performs no writes when the initial snapshot cannot be read"
}

test_gnome_readback_failure_retains_recovery_state() {
    new_case
    local old_url="'https://previous.example/proxy.pac'"
    local state="$CASE_DIR/state/pac.state"
    prepare_gnome "$CASE_DIR/settings" "'manual'" yes "$old_url" yes
    clear_faults
    MOCK_FAIL_GET_KEY="mode"
    MOCK_FAIL_GET_AT="2"
    if run_gnome "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1; then
        fail "GNOME accepted an unreadable application readback"
    fi
    assert_present "$state"
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'auto'"
    assert_file_value "$CASE_DIR/settings/gnome_autoconfig-url.value" "$old_url"
    clear_faults
    run_gnome "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'manual'"
    assert_no_state "$state"
    pass "GNOME retains and retries recovery after readback failure"
}

test_gnome_user_override_is_preserved() {
    new_case
    local state="$CASE_DIR/state/pac.state"
    prepare_gnome "$CASE_DIR/settings" "'none'" yes "''" no
    clear_faults
    run_gnome "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    set_gnome_external "$CASE_DIR/settings" "mode" "'manual'" yes
    run_gnome "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'manual'"
    assert_file_value "$CASE_DIR/settings/gnome_autoconfig-url.value" "$GNOME_TARGET_URL"
    assert_present "$CASE_DIR/settings/gnome_autoconfig-url.present"
    assert_no_state "$state"
    pass "GNOME preserves a user mode override and the PAC URL as a pair"
}

test_gnome_user_pac_url_override_preserves_auto_mode() {
    new_case
    local state="$CASE_DIR/state/pac.state"
    local user_url="'https://operator.example/proxy.pac'"
    prepare_gnome "$CASE_DIR/settings" "'manual'" yes "''" no
    clear_faults
    run_gnome "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    set_gnome_external "$CASE_DIR/settings" "autoconfig-url" "$user_url" yes
    run_gnome "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'auto'"
    assert_file_value "$CASE_DIR/settings/gnome_autoconfig-url.value" "$user_url"
    assert_present "$CASE_DIR/settings/gnome_mode.present"
    assert_present "$CASE_DIR/settings/gnome_autoconfig-url.present"
    assert_no_state "$state"
    pass "GNOME preserves automatic mode and a user-replaced PAC URL"
}

test_gnome_original_pac_url_reselected_preserves_auto_mode() {
    new_case
    local old_url="'https://previous.example/proxy.pac'"
    local state="$CASE_DIR/state/pac.state"
    prepare_gnome "$CASE_DIR/settings" "'manual'" yes "$old_url" yes
    clear_faults
    run_gnome "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    set_gnome_external "$CASE_DIR/settings" "autoconfig-url" "$old_url" yes
    run_gnome "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'auto'"
    assert_file_value "$CASE_DIR/settings/gnome_autoconfig-url.value" "$old_url"
    assert_present "$CASE_DIR/settings/gnome_mode.present"
    assert_present "$CASE_DIR/settings/gnome_autoconfig-url.present"
    assert_no_state "$state"
    pass "GNOME preserves automatic mode when the original PAC URL is reselected"
}

test_gnome_original_pair_reselected_completes_without_writes() {
    new_case
    local old_url="'https://previous.example/proxy.pac'"
    local state="$CASE_DIR/state/pac.state"
    prepare_gnome "$CASE_DIR/settings" "'manual'" yes "$old_url" yes
    clear_faults
    run_gnome "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    set_gnome_external "$CASE_DIR/settings" "mode" "'manual'" yes
    set_gnome_external "$CASE_DIR/settings" "autoconfig-url" "$old_url" yes
    run_gnome "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'manual'"
    assert_file_value "$CASE_DIR/settings/gnome_autoconfig-url.value" "$old_url"
    assert_file_value "$CASE_DIR/settings/gnome_set_mode.count" "1"
    assert_file_value "$CASE_DIR/settings/gnome_set_autoconfig-url.count" "1"
    assert_no_state "$state"
    pass "GNOME completes an already-restored pair without setting writes"
}

test_gnome_remove_state_persist_failure_does_not_write_settings() {
    new_case
    local old_url="'https://previous.example/proxy.pac'"
    local state="$CASE_DIR/state/pac.state"
    prepare_gnome "$CASE_DIR/settings" "'manual'" yes "$old_url" yes
    clear_faults
    run_gnome "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    MOCK_FAIL_STATE_MOVE="yes"
    if run_gnome "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1; then
        fail "GNOME accepted a failed removing-state write"
    fi
    assert_state_phase "$state" "active"
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'auto'"
    assert_file_value "$CASE_DIR/settings/gnome_autoconfig-url.value" "$GNOME_TARGET_URL"
    assert_file_value "$CASE_DIR/settings/gnome_set_mode.count" "1"
    assert_file_value "$CASE_DIR/settings/gnome_set_autoconfig-url.count" "1"
    clear_faults
    run_gnome "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'manual'"
    assert_file_value "$CASE_DIR/settings/gnome_autoconfig-url.value" "$old_url"
    assert_no_state "$state"
    pass "GNOME makes no setting writes when persisting removing fails"
}

test_gnome_interrupted_remove_resumes_from_removing_state() {
    new_case
    local old_url="'https://previous.example/proxy.pac'"
    local state="$CASE_DIR/state/pac.state"
    prepare_gnome "$CASE_DIR/settings" "'manual'" yes "$old_url" yes
    clear_faults
    run_gnome "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    MOCK_FAIL_SET_KEY="autoconfig-url"
    MOCK_FAIL_SET_VALUE="$old_url"
    if run_gnome "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1; then
        fail "GNOME accepted an interrupted second restore write"
    fi
    assert_state_phase "$state" "removing"
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'manual'"
    assert_file_value "$CASE_DIR/settings/gnome_autoconfig-url.value" "$GNOME_TARGET_URL"
    clear_faults
    run_gnome "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'manual'"
    assert_file_value "$CASE_DIR/settings/gnome_autoconfig-url.value" "$old_url"
    assert_no_state "$state"
    pass "GNOME resumes an interrupted remove and verifies the restored pair"
}

test_gnome_restore_failure_retains_recovery_state() {
    new_case
    local state="$CASE_DIR/state/pac.state"
    prepare_gnome "$CASE_DIR/settings" "'manual'" yes "''" no
    clear_faults
    run_gnome "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    MOCK_FAIL_SET_KEY="mode"
    MOCK_FAIL_SET_VALUE="'manual'"
    if run_gnome "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1; then
        fail "GNOME accepted an unconfirmed restore"
    fi
    assert_present "$state"
    clear_faults
    run_gnome "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/gnome_mode.value" "'manual'"
    assert_absent "$CASE_DIR/settings/gnome_autoconfig-url.present"
    assert_no_state "$state"
    pass "GNOME retains and retries recovery after restore failure"
}

test_kde_manual_and_absent_settings_restore() {
    new_case
    local state="$CASE_DIR/state/pac.state"
    prepare_kde "$CASE_DIR/settings" "1" yes "" no
    clear_faults
    run_kde "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/kde_ProxyType.value" "2"
    assert_file_value "$CASE_DIR/settings/kde_Proxy_Config_Script.value" "$PAC_URL"
    run_kde "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/kde_ProxyType.value" "1"
    assert_present "$CASE_DIR/settings/kde_ProxyType.present"
    assert_absent "$CASE_DIR/settings/kde_Proxy_Config_Script.present"
    assert_no_state "$state"
    pass "KDE restores manual mode and an absent PAC URL key"
}

test_kde_absent_mode_restore() {
    new_case
    local state="$CASE_DIR/state/pac.state"
    prepare_kde "$CASE_DIR/settings" "" no "" no
    clear_faults
    run_kde "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    run_kde "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_absent "$CASE_DIR/settings/kde_ProxyType.present"
    assert_absent "$CASE_DIR/settings/kde_Proxy_Config_Script.present"
    assert_no_state "$state"
    pass "KDE removes an originally absent mode override"
}

test_kde_existing_pac_restore() {
    new_case
    local old_url="https://previous.example/proxy.pac"
    local state="$CASE_DIR/state/pac.state"
    prepare_kde "$CASE_DIR/settings" "2" yes "$old_url" yes
    clear_faults
    run_kde "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    run_kde "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/kde_ProxyType.value" "2"
    assert_file_value "$CASE_DIR/settings/kde_Proxy_Config_Script.value" "$old_url"
    assert_present "$CASE_DIR/settings/kde_Proxy_Config_Script.present"
    assert_no_state "$state"
    pass "KDE restores an existing PAC configuration"
}

test_kde_second_write_failure_rolls_back() {
    new_case
    local old_url="https://previous.example/proxy.pac"
    local state="$CASE_DIR/state/pac.state"
    prepare_kde "$CASE_DIR/settings" "1" yes "$old_url" yes
    clear_faults
    MOCK_FAIL_SET_KEY="Proxy Config Script"
    MOCK_FAIL_SET_VALUE="$PAC_URL"
    MOCK_FAIL_SET_AFTER_WRITE="yes"
    if run_kde "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1; then
        fail "KDE accepted a failed second write"
    fi
    clear_faults
    assert_file_value "$CASE_DIR/settings/kde_ProxyType.value" "1"
    assert_file_value "$CASE_DIR/settings/kde_Proxy_Config_Script.value" "$old_url"
    assert_no_state "$state"
    pass "KDE rolls back a second write that mutated before failing"
}

test_kde_snapshot_read_failure_writes_nothing() {
    new_case
    local state="$CASE_DIR/state/pac.state"
    prepare_kde "$CASE_DIR/settings" "1" yes "" no
    clear_faults
    MOCK_FAIL_GET_KEY="ProxyType"
    MOCK_FAIL_GET_AT="1"
    if run_kde "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1; then
        fail "KDE accepted an unreadable initial snapshot"
    fi
    assert_file_value "$CASE_DIR/settings/kde_ProxyType.value" "1"
    assert_present "$CASE_DIR/settings/kde_ProxyType.present"
    assert_absent "$CASE_DIR/settings/kde_set_ProxyType.count"
    assert_no_state "$state"
    pass "KDE performs no writes when the initial snapshot cannot be read"
}

test_kde_readback_failure_retains_recovery_state() {
    new_case
    local state="$CASE_DIR/state/pac.state"
    prepare_kde "$CASE_DIR/settings" "1" yes "https://previous.example/proxy.pac" yes
    clear_faults
    MOCK_FAIL_GET_KEY="ProxyType"
    MOCK_FAIL_GET_AT="2"
    if run_kde "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1; then
        fail "KDE accepted an unreadable application readback"
    fi
    assert_present "$state"
    assert_file_value "$CASE_DIR/settings/kde_ProxyType.value" "2"
    clear_faults
    run_kde "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/kde_ProxyType.value" "1"
    assert_no_state "$state"
    pass "KDE retains and retries recovery after readback failure"
}

test_kde_user_override_is_preserved() {
    new_case
    local state="$CASE_DIR/state/pac.state"
    prepare_kde "$CASE_DIR/settings" "0" yes "" no
    clear_faults
    run_kde "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    set_kde_external "$CASE_DIR/settings" "ProxyType" "1"
    run_kde "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/kde_ProxyType.value" "1"
    assert_file_value "$CASE_DIR/settings/kde_Proxy_Config_Script.value" "$PAC_URL"
    assert_present "$CASE_DIR/settings/kde_Proxy_Config_Script.present"
    assert_no_state "$state"
    pass "KDE preserves a user mode override and the PAC URL as a pair"
}

test_kde_user_pac_url_override_preserves_auto_mode() {
    new_case
    local state="$CASE_DIR/state/pac.state"
    local user_url="https://operator.example/proxy.pac"
    prepare_kde "$CASE_DIR/settings" "1" yes "" no
    clear_faults
    run_kde "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    set_kde_external "$CASE_DIR/settings" "Proxy Config Script" "$user_url"
    run_kde "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/kde_ProxyType.value" "2"
    assert_file_value "$CASE_DIR/settings/kde_Proxy_Config_Script.value" "$user_url"
    assert_present "$CASE_DIR/settings/kde_ProxyType.present"
    assert_present "$CASE_DIR/settings/kde_Proxy_Config_Script.present"
    assert_no_state "$state"
    pass "KDE preserves automatic mode and a user-replaced PAC URL"
}

test_kde_original_pac_url_reselected_preserves_auto_mode() {
    new_case
    local old_url="https://previous.example/proxy.pac"
    local state="$CASE_DIR/state/pac.state"
    prepare_kde "$CASE_DIR/settings" "1" yes "$old_url" yes
    clear_faults
    run_kde "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    set_kde_external "$CASE_DIR/settings" "Proxy Config Script" "$old_url"
    run_kde "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/kde_ProxyType.value" "2"
    assert_file_value "$CASE_DIR/settings/kde_Proxy_Config_Script.value" "$old_url"
    assert_present "$CASE_DIR/settings/kde_ProxyType.present"
    assert_present "$CASE_DIR/settings/kde_Proxy_Config_Script.present"
    assert_no_state "$state"
    pass "KDE preserves automatic mode when the original PAC URL is reselected"
}

test_kde_original_pair_reselected_completes_without_writes() {
    new_case
    local old_url="https://previous.example/proxy.pac"
    local state="$CASE_DIR/state/pac.state"
    prepare_kde "$CASE_DIR/settings" "1" yes "$old_url" yes
    clear_faults
    run_kde "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    set_kde_external "$CASE_DIR/settings" "ProxyType" "1"
    set_kde_external "$CASE_DIR/settings" "Proxy Config Script" "$old_url"
    run_kde "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/kde_ProxyType.value" "1"
    assert_file_value "$CASE_DIR/settings/kde_Proxy_Config_Script.value" "$old_url"
    assert_file_value "$CASE_DIR/settings/kde_set_ProxyType.count" "1"
    assert_file_value "$CASE_DIR/settings/kde_set_Proxy_Config_Script.count" "1"
    assert_no_state "$state"
    pass "KDE completes an already-restored pair without setting writes"
}

test_kde_remove_state_persist_failure_does_not_write_settings() {
    new_case
    local old_url="https://previous.example/proxy.pac"
    local state="$CASE_DIR/state/pac.state"
    prepare_kde "$CASE_DIR/settings" "1" yes "$old_url" yes
    clear_faults
    run_kde "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    MOCK_FAIL_STATE_MOVE="yes"
    if run_kde "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1; then
        fail "KDE accepted a failed removing-state write"
    fi
    assert_state_phase "$state" "active"
    assert_file_value "$CASE_DIR/settings/kde_ProxyType.value" "2"
    assert_file_value "$CASE_DIR/settings/kde_Proxy_Config_Script.value" "$PAC_URL"
    assert_file_value "$CASE_DIR/settings/kde_set_ProxyType.count" "1"
    assert_file_value "$CASE_DIR/settings/kde_set_Proxy_Config_Script.count" "1"
    clear_faults
    run_kde "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/kde_ProxyType.value" "1"
    assert_file_value "$CASE_DIR/settings/kde_Proxy_Config_Script.value" "$old_url"
    assert_no_state "$state"
    pass "KDE makes no setting writes when persisting removing fails"
}

test_kde_interrupted_remove_resumes_from_removing_state() {
    new_case
    local old_url="https://previous.example/proxy.pac"
    local state="$CASE_DIR/state/pac.state"
    prepare_kde "$CASE_DIR/settings" "1" yes "$old_url" yes
    clear_faults
    run_kde "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    MOCK_FAIL_SET_KEY="Proxy Config Script"
    MOCK_FAIL_SET_VALUE="$old_url"
    if run_kde "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1; then
        fail "KDE accepted an interrupted second restore write"
    fi
    assert_state_phase "$state" "removing"
    assert_file_value "$CASE_DIR/settings/kde_ProxyType.value" "1"
    assert_file_value "$CASE_DIR/settings/kde_Proxy_Config_Script.value" "$PAC_URL"
    clear_faults
    run_kde "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/kde_ProxyType.value" "1"
    assert_file_value "$CASE_DIR/settings/kde_Proxy_Config_Script.value" "$old_url"
    assert_no_state "$state"
    pass "KDE resumes an interrupted remove and verifies the restored pair"
}

test_kde_restore_failure_retains_recovery_state() {
    new_case
    local state="$CASE_DIR/state/pac.state"
    prepare_kde "$CASE_DIR/settings" "1" yes "" no
    clear_faults
    run_kde "$CASE_DIR/settings" "$ADD_SCRIPT" "$PAC_URL" "$state" >/dev/null 2>&1
    MOCK_FAIL_SET_KEY="ProxyType"
    MOCK_FAIL_SET_VALUE="1"
    if run_kde "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1; then
        fail "KDE accepted an unconfirmed restore"
    fi
    assert_present "$state"
    clear_faults
    run_kde "$CASE_DIR/settings" "$DELETE_SCRIPT" "$state" >/dev/null 2>&1
    assert_file_value "$CASE_DIR/settings/kde_ProxyType.value" "1"
    assert_absent "$CASE_DIR/settings/kde_Proxy_Config_Script.present"
    assert_no_state "$state"
    pass "KDE retains and retries recovery after restore failure"
}

test_gnome_manual_and_absent_settings_restore
test_gnome_absent_mode_restore
test_gnome_existing_pac_restore
test_gnome_second_write_failure_rolls_back
test_gnome_snapshot_read_failure_writes_nothing
test_gnome_readback_failure_retains_recovery_state
test_gnome_user_override_is_preserved
test_gnome_user_pac_url_override_preserves_auto_mode
test_gnome_original_pac_url_reselected_preserves_auto_mode
test_gnome_original_pair_reselected_completes_without_writes
test_gnome_remove_state_persist_failure_does_not_write_settings
test_gnome_interrupted_remove_resumes_from_removing_state
test_gnome_restore_failure_retains_recovery_state
test_kde_manual_and_absent_settings_restore
test_kde_absent_mode_restore
test_kde_existing_pac_restore
test_kde_second_write_failure_rolls_back
test_kde_snapshot_read_failure_writes_nothing
test_kde_readback_failure_retains_recovery_state
test_kde_user_override_is_preserved
test_kde_user_pac_url_override_preserves_auto_mode
test_kde_original_pac_url_reselected_preserves_auto_mode
test_kde_original_pair_reselected_completes_without_writes
test_kde_remove_state_persist_failure_does_not_write_settings
test_kde_interrupted_remove_resumes_from_removing_state
test_kde_restore_failure_retains_recovery_state

printf '%s PAC settings regression cases passed\n' "$TEST_COUNT"

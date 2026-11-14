#!/bin/bash

set -u
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

if [ -z "${1-}" ]; then
    echo "Usage: $0 <local_certificate_path>" 1>&2
    exit 2
fi

if ! command -v openssl >/dev/null 2>&1; then
    echo "[ERROR] openssl is required." 1>&2
    exit 3
fi

LOCAL_CERT_PATH="$1"
if [ ! -f "$LOCAL_CERT_PATH" ]; then
    log_error "local certificate file not found: $LOCAL_CERT_PATH"
    exit 3
fi

log_info "starting CA installation check"
log_info "local_cert_path=$LOCAL_CERT_PATH"

CERT_FILE_NAME="$(basename "$LOCAL_CERT_PATH")"
CERT_BASE="${CERT_FILE_NAME%.*}"

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

anchor_candidates_for_family() {
    case "$1" in
        debian)
            printf '%s\n' \
                "/usr/local/share/ca-certificates/$CERT_BASE.crt" \
                "/usr/local/share/ca-certificates/$CERT_BASE.pem"
            ;;
        rhel)
            printf '%s\n' \
                "/etc/pki/ca-trust/source/anchors/$CERT_BASE.crt" \
                "/etc/pki/ca-trust/source/anchors/$CERT_BASE.pem"
            ;;
        arch)
            printf '%s\n' \
                "/etc/ca-certificates/trust-source/anchors/$CERT_BASE.crt" \
                "/etc/ca-certificates/trust-source/anchors/$CERT_BASE.pem"
            ;;
        suse)
            printf '%s\n' \
                "/etc/pki/trust/anchors/$CERT_BASE.crt" \
                "/etc/pki/trust/anchors/$CERT_BASE.pem"
            ;;
        *)
            printf '%s\n' \
                "/usr/local/share/ca-certificates/$CERT_BASE.crt" \
                "/usr/local/share/ca-certificates/$CERT_BASE.pem" \
                "/etc/pki/ca-trust/source/anchors/$CERT_BASE.crt" \
                "/etc/pki/ca-trust/source/anchors/$CERT_BASE.pem" \
                "/etc/ca-certificates/trust-source/anchors/$CERT_BASE.crt" \
                "/etc/ca-certificates/trust-source/anchors/$CERT_BASE.pem" \
                "/etc/pki/trust/anchors/$CERT_BASE.crt" \
                "/etc/pki/trust/anchors/$CERT_BASE.pem"
            ;;
    esac
}

bundle_candidates_for_family() {
    case "$1" in
        debian)
            printf '%s\n' "/etc/ssl/certs/ca-certificates.crt"
            ;;
        rhel)
            printf '%s\n' \
                "/etc/pki/tls/certs/ca-bundle.crt" \
                "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem"
            ;;
        arch)
            printf '%s\n' "/etc/ssl/certs/ca-certificates.crt"
            ;;
        suse)
            printf '%s\n' "/etc/ssl/ca-bundle.pem"
            ;;
        *)
            printf '%s\n' \
                "/etc/ssl/certs/ca-certificates.crt" \
                "/etc/pki/tls/certs/ca-bundle.crt" \
                "/etc/ssl/ca-bundle.pem" \
                "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem"
            ;;
    esac
}

DISTRO_FAMILY="$(detect_family)"
mapfile -t ANCHOR_CANDIDATES < <(anchor_candidates_for_family "$DISTRO_FAMILY")

ANCHOR_CERT=""
for candidate in "${ANCHOR_CANDIDATES[@]}"; do
    if [ -f "$candidate" ]; then
        ANCHOR_CERT="$candidate"
        break
    fi
done

if [ -z "$ANCHOR_CERT" ]; then
    log_info "anchor certificate not found for $CERT_BASE"
    echo "Certificate $CERT_BASE is not installed."
    exit 1
fi

log_info "anchor certificate found: $ANCHOR_CERT"

LOCAL_FP=$(openssl x509 -in "$LOCAL_CERT_PATH" -noout -fingerprint -sha256 2>/dev/null | awk -F= '{print $2}' | tr -d '\r')
ANCHOR_FP=$(openssl x509 -in "$ANCHOR_CERT" -noout -fingerprint -sha256 2>/dev/null | awk -F= '{print $2}' | tr -d '\r')

if [ -z "$LOCAL_FP" ] || [ -z "$ANCHOR_FP" ]; then
    log_error "failed to read certificate fingerprint"
    exit 4
fi

log_info "local_fp=$LOCAL_FP"
log_info "anchor_fp=$ANCHOR_FP"

if [ "$LOCAL_FP" != "$ANCHOR_FP" ]; then
    log_info "fingerprint mismatch detected"
    echo "Certificate $CERT_BASE is installed, but fingerprint does not match local CA."
    exit 1
fi

mapfile -t BUNDLES < <(bundle_candidates_for_family "$DISTRO_FAMILY")

for bundle in "${BUNDLES[@]}"; do
    if [ -f "$bundle" ] && openssl verify -CAfile "$bundle" "$ANCHOR_CERT" >/dev/null 2>&1; then
        echo "Certificate $CERT_BASE is already installed."
        exit 0
    fi
done

if [ -f "$ANCHOR_CERT" ]; then
    log_error "trust bundle verification inconclusive for anchor $ANCHOR_CERT"
    echo "Certificate $CERT_BASE is installed in anchors, but trust bundle check was inconclusive."
    exit 4
fi

echo "Certificate $CERT_BASE is not installed."
exit 1

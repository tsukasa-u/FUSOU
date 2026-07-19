#!/bin/bash

set -u

if [ -z "${1-}" ]; then
    echo "Usage: $0 <certificate_base_name>" 1>&2
    exit 2
fi

if ! command -v openssl >/dev/null 2>&1; then
    echo "[ERROR] openssl is required." 1>&2
    exit 3
fi

CERT_BASE="$1"
if ! [[ "$CERT_BASE" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "[ERROR] certificate base name contains unsupported characters: $CERT_BASE" 1>&2
    exit 2
fi

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
    echo "Certificate $1 is not installed."
    exit 1
fi

mapfile -t BUNDLES < <(bundle_candidates_for_family "$DISTRO_FAMILY")

for bundle in "${BUNDLES[@]}"; do
    if [ -f "$bundle" ] && openssl verify -CAfile "$bundle" "$ANCHOR_CERT" >/dev/null 2>&1; then
        echo "Certificate $1 is already installed."
        exit 0
    fi
done

if [ -f "$ANCHOR_CERT" ]; then
    echo "Certificate $1 is installed in anchors, but trust bundle check was inconclusive."
    exit 4
fi

echo "Certificate $1 is not installed."
exit 1

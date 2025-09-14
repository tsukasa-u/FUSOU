#!/bin/bash

FINGERPRINT1=$(openssl x509 -in /etc/ssl/certs/$1.pem -noout -subject -issuer -dates -fingerprint | grep Fingerprint)
FINGERPRINT2=$(openssl x509 -in /usr/local/share/ca-certificates/$1.crt -noout -subject -issuer -dates -fingerprint | grep Fingerprint)
if [ "$FINGERPRINT1" == "$FINGERPRINT2" ]; then
    CA_FUSOU_LINE=$(awk -v cmd='openssl x509 -noout -subject' ' /BEGIN/{close(cmd)};{print | cmd}' < /etc/ssl/certs/ca-certificates.crt | grep FUSOU)
    if [ -z "$CA_FUSOU_LINE" ]; then
        echo "Certificate $1 is not installed."
        exit 1
    else
        echo "Certificate $1 is already installed."
        exit 0
    fi
else
    echo "Certificate $1 is not installed."
    exit 1
fi
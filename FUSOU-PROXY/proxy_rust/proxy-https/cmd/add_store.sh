#!/bin/sh
pkexec sh -c apt-get install -y ca-certificates && cp $1 /usr/local/share/ca-certificates && update-ca-certificates

# replace $1 with your certificate file path (ca_cert.pem)
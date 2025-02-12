#!/bin/sh

sudo apt-get install -y ca-certificates
sudo cp $1 /usr/local/share/ca-certificates
sudo update-ca-certificates

# replace $1 with your certificate file path (ca_cert.pem)
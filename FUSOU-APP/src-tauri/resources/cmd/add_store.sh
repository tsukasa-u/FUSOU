#!/bin/bash

gnome-terminal -- bash -c "echo '> sudo apt install -y ca-certificates && sudo cp $1 /usr/local/share/ca-certificates && sudo update-ca-certificates' && sudo apt install -y ca-certificates && sudo cp $1 /usr/local/share/ca-certificates && sudo update-ca-certificates"

# sudo apt-get install -y ca-certificates
# sudo cp $1 /usr/local/share/ca-certificates
# sudo update-ca-certificates

# replace $1 with your certificate file path (ca_cert.pem)
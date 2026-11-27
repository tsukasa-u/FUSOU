#!/usr/bin/env bash
set -euo pipefail

# The candidate runs on Ubuntu 24.04. All requested packages come from Ubuntu.
# Use the image's Ubuntu sources without querying its unrelated vendor feeds.
ubuntu_sources=/etc/apt/sources.list.d/ubuntu.sources
test -r "$ubuntu_sources"
apt_options=(-o "Dir::Etc::sourcelist=$ubuntu_sources" -o Dir::Etc::sourceparts=-)

sudo apt-get "${apt_options[@]}" update
sudo apt-get "${apt_options[@]}" install -y "$@"

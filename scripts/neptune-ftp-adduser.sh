#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $(basename "$0") <username> <home_dir>" >&2
  exit 1
fi

USERNAME="$1"
HOME_DIR="$2"

if ! [[ "$USERNAME" =~ ^[a-zA-Z0-9_-]{1,32}$ ]]; then
  echo "Invalid username: $USERNAME" >&2
  exit 1
fi

if [[ ! "$HOME_DIR" =~ ^/ ]]; then
  echo "home_dir must be absolute: $HOME_DIR" >&2
  exit 1
fi

if [ ! -d "$HOME_DIR" ]; then
  echo "home_dir does not exist: $HOME_DIR" >&2
  exit 1
fi

pure-pw useradd "$USERNAME" -f /etc/pure-ftpd/pureftpd.passwd -d "$HOME_DIR" -m
pure-pw mkdb

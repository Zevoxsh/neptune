#!/usr/bin/env bash
set -euo pipefail

USERNAME="$1"

if ! [[ "$USERNAME" =~ ^[a-zA-Z0-9_-]{1,32}$ ]]; then
  echo "Invalid username: $USERNAME" >&2
  exit 1
fi

pure-pw userdel "$USERNAME" -f /etc/pure-ftpd/pureftpd.passwd -m
pure-pw mkdb

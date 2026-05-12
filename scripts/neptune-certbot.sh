#!/bin/bash
set -e
DOMAIN="$1"
WEBROOT="$2"

if [[ -z "$DOMAIN" || -z "$WEBROOT" ]]; then
  echo "Usage: neptune-certbot.sh <domain> <webroot>" >&2
  exit 1
fi

# Validate domain — only alphanumeric, dots, hyphens
if [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9.\-]+$ ]]; then
  echo "Invalid domain: $DOMAIN" >&2
  exit 1
fi

# Validate webroot — must be an absolute path that exists
if [[ ! "$WEBROOT" =~ ^/ ]] || [[ ! -d "$WEBROOT" ]]; then
  echo "Invalid or non-existent webroot: $WEBROOT" >&2
  exit 1
fi

certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" --non-interactive --agree-tos

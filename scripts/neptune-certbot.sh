#!/bin/bash
set -e
DOMAIN="$1"
WEBROOT="$2"
EMAIL="$3"

if [[ -z "$DOMAIN" || -z "$WEBROOT" || -z "$EMAIL" ]]; then
  echo "Usage: neptune-certbot.sh <domain> <webroot> <email>" >&2
  exit 1
fi

# Validate domain — only alphanumeric, dots, hyphens, proper structure
if [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$ ]]; then
  echo "Invalid domain: $DOMAIN" >&2
  exit 1
fi

# Validate webroot — must be an absolute path that exists
if [[ ! "$WEBROOT" =~ ^/ ]] || [[ ! -d "$WEBROOT" ]]; then
  echo "Invalid or non-existent webroot: $WEBROOT" >&2
  exit 1
fi

# Validate email — basic sanity check
if [[ ! "$EMAIL" =~ ^[^@]+@[^@]+\.[^@]+$ ]]; then
  echo "Invalid email: $EMAIL" >&2
  exit 1
fi

certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" --email "$EMAIL" --non-interactive --agree-tos

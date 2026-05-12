#!/bin/bash
set -e
nginx -t
apache2ctl configtest
systemctl reload nginx
systemctl reload apache2

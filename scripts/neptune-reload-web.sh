#!/bin/bash
set -e
nginx -t
systemctl reload nginx
apache2ctl configtest
systemctl reload apache2

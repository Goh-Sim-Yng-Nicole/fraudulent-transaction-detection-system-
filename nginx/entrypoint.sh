#!/bin/sh
set -eu

cert_host="${DEPLOYMENT_HOST:-localhost}"
letsencrypt_dir="/etc/letsencrypt/live/${cert_host}"
letsencrypt_cert="${letsencrypt_dir}/fullchain.pem"
letsencrypt_key="${letsencrypt_dir}/privkey.pem"
target_cert="/etc/nginx/tls/localhost.crt"
target_key="/etc/nginx/tls/localhost.key"

if [ -f "${letsencrypt_cert}" ] && [ -f "${letsencrypt_key}" ]; then
  cp "${letsencrypt_cert}" "${target_cert}"
  cp "${letsencrypt_key}" "${target_key}"
  chmod 600 "${target_key}"
  echo "[ftds-nginx] Using Let's Encrypt certificate for ${cert_host}"
else
  echo "[ftds-nginx] Let's Encrypt certificate not found for ${cert_host}; using bundled self-signed certificate"
fi

exec nginx -g 'daemon off;'

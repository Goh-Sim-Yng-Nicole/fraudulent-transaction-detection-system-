FROM nginx:1.25-alpine

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf \
    && apk add --no-cache openssl

RUN mkdir -p /etc/nginx/tls \
    && printf '%s\n' \
      '[req]' \
      'distinguished_name=req_distinguished_name' \
      'x509_extensions=v3_req' \
      'prompt=no' \
      '[req_distinguished_name]' \
      'CN=localhost' \
      '[v3_req]' \
      'subjectAltName=@alt_names' \
      '[alt_names]' \
      'DNS.1=localhost' \
      'IP.1=127.0.0.1' \
      > /tmp/localhost.cnf \
    && openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
      -keyout /etc/nginx/tls/localhost.key \
      -out /etc/nginx/tls/localhost.crt \
      -config /tmp/localhost.cnf \
    && rm -f /tmp/localhost.cnf

COPY nginx/nginx.conf /etc/nginx/nginx.conf

# Copy Customer Banking UI static files
COPY ui/ /usr/share/nginx/html/

EXPOSE 8088 8443 3000 16686 9090 9091 8025

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8088/ || exit 1

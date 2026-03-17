FROM nginx:1.25-alpine

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

COPY nginx/nginx.conf /etc/nginx/nginx.conf

# Copy Customer Banking UI static files
COPY ui/ /usr/share/nginx/html/

EXPOSE 80

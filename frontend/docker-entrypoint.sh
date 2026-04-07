#!/bin/sh
# Only substitute BITSCOPE_BACKEND_URL — leave nginx variables ($host, $uri etc) untouched
envsubst '${BITSCOPE_BACKEND_URL}' < /etc/nginx/templates/default.conf.template \
    > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'

# syntax=docker/dockerfile:1
FROM caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f
USER root
# The official binary requests NET_BIND_SERVICE via its file capability. Our proxy
# only binds 8080; remove that request so exec works with an empty capability bound.
RUN setcap -r /usr/bin/caddy && test -z "$(getcap /usr/bin/caddy)"
USER 1000:1000

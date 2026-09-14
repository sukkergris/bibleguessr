---
name: nginx
description: Use when the user asks for help with nginx configuration, wants to learn nginx, or has questions about nginx directives, load balancing, caching, security, or any other nginx topic
---

# NGINX Help

## Kogebog

Brugeren har NGINX Cookbook 3rd Edition opdelt i kapitler på:
`/xyz/Documentation/nginx-cookbook/`

**Fremgangsmåde:** Slå emnet op i indeksen herunder → læs det relevante kapitel med Read-værktøjet → svar derefter.

Læs kun de kapitler der er relevante for spørgsmålet. Læs ikke alle kapitler.

## Kapitelindeks

| Kapitel | Emner |
|---------|-------|
| `01-basics.md` | Installation (Debian/Ubuntu/RHEL), nginx.conf struktur, nøglefiler og -mapper, includes, static content |
| `02-high-performance-load-balancing.md` | HTTP/TCP/UDP load balancing, load-balancing metoder, sticky sessions, health checks, slow start, connection draining |
| `03-traffic-management.md` | A/B testing, GeoIP, rate limiting (`limit_req`), connection limits (`limit_conn`), båndbreddebegrænsning, geo-blokering |
| `04-massively-scalable-content-caching.md` | Cache zones (`proxy_cache`), cache keys, cache locking, stale cache, cache bypass, cache purging, cache slicing |
| `05-programmability-and-automation.md` | NGINX Plus API, key-value store, njs/JavaScript i NGINX, Ansible, Chef, Consul templating |
| `06-authentication.md` | HTTP basic auth, auth subrequests, JWT validering, OpenID Connect SSO, SAML |
| `07-security-controls.md` | IP allowlists/denylists, CORS, TLS/SSL (client + upstream), secure links, HTTPS redirect, HSTS, DDoS-mitigering |
| `08-http2-and-http3-quic.md` | HTTP/2 aktivering, HTTP/3/QUIC, gRPC proxying |
| `09-sophisticated-media-streaming.md` | MP4/FLV serving, HLS/HDS streaming, båndbreddebegrænsning for media |
| `10-cloud-deployments.md` | AWS/GCP VM-deploy, machine images, cloud load balancing, App Engine proxy |
| `11-containers-microservices.md` | Docker (officielt image + Dockerfile), API gateway, DNS SRV, Kubernetes Ingress Controller, env vars |
| `12-high-availability-deployment-modes.md` | NGINX Plus HA clustering, DNS-baseret LB, EC2 LB, config sync, zone sync |
| `13-advanced-activity-monitoring.md` | Stub status, NGINX Plus dashboard, metrics API, OpenTelemetry, Prometheus exporter |
| `14-debugging-and-troubleshooting.md` | Access logs (format/rotation), error logs, syslog forwarding, config debugging, request tracing |
| `15-performance-tuning.md` | Worker-tuning, keepalive (clients + upstream), response buffering, log buffering, OS-tuning |

## Kontekst

Brugeren lærer nginx i en **honeypot-sandbox**: en devcontainer med nginx:alpine på port 80. Live config ligger i `/xyz/nginx/`, reference-implementation i `/xyz/nginx-bakup/nginx.conf`. Brug altid denne kontekst når du forklarer konfiguration.

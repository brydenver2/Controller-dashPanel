# Installation & Setup Guide

Complete instructions for installing, configuring, and deploying nodejs-poolController-dashPanel.

## Table of Contents

- [Quick Start](#quick-start)
- [Installation Methods](#installation-methods)
  - [Docker (Recommended)](#docker-recommended)
  - [Manual Installation](#manual-installation)
- [Configuration](#configuration)
  - [Configuration File](#configuration-file)
  - [Environment Variables](#environment-variables)
- [Network Setup](#network-setup)
  - [Firewall Configuration](#firewall-configuration)
  - [Reverse Proxy](#reverse-proxy)
- [Security](#security)
  - [HTTPS Setup](#https-setup)
  - [Authentication](#authentication)
- [Upgrades and Maintenance](#upgrades-and-maintenance)

---

## Quick Start

The fastest way to get started is with Docker Compose:

```bash
# Create a docker-compose.yml (see Docker section below)
docker-compose up -d

# Access the dashboard
open http://localhost:5150
```

---

## Installation Methods

### Docker (Recommended)

Docker provides the easiest deployment with automatic dependency management.

#### Prerequisites

- Docker Engine 20.10+
- Docker Compose v2+

#### Docker Compose Setup

Create a `docker-compose.yml` file:

```yaml
services:
  njspc:
    image: ghcr.io/sam2kb/njspc
    container_name: njspc
    restart: unless-stopped
    environment:
      - TZ=${TZ:-UTC}
      - NODE_ENV=production
      # Coordinates for sunrise/sunset calculations
      - POOL_LATITUDE=28.5383
      - POOL_LONGITUDE=-81.3792
    ports:
      - "4200:4200"
    devices:
      - /dev/ttyUSB0:/dev/ttyUSB0   # RS485 adapter
    volumes:
      - ./config.json:/app/config.json
      - njspc-data:/app/data

  njspc-dash:
    image: ghcr.io/sam2kb/njspc-dash
    container_name: njspc-dash
    restart: unless-stopped
    depends_on:
      - njspc
    environment:
      - TZ=${TZ:-UTC}
      - NODE_ENV=production
      - POOL_WEB_SERVICES_IP=njspc    # Docker service name
    ports:
      - "5150:5150"
    volumes:
      - ./dash-config.json:/app/config.json

volumes:
  njspc-data:
```

#### Starting the Services

```bash
# Start in background
docker-compose up -d

# View logs
docker-compose logs -f njspc-dash

# Stop services
docker-compose down
```

#### Building from Source

```bash
# Clone the repository
git clone https://github.com/rstrouse/nodejs-poolController-dashPanel.git
cd nodejs-poolController-dashPanel

# Build the Docker image
docker build -t njspc-dash .

# Run the container
docker run -d \
  --name njspc-dash \
  -p 5150:5150 \
  -e POOL_WEB_SERVICES_IP=192.168.1.100 \
  njspc-dash
```

---

### Manual Installation

For development or custom deployments, install manually.

#### Prerequisites

- Node.js 18+ (LTS recommended)
- npm 9+
- Git

#### Installation Steps

```bash
# Clone the repository
git clone https://github.com/rstrouse/nodejs-poolController-dashPanel.git
cd nodejs-poolController-dashPanel

# Install dependencies
npm install

# Build TypeScript
npm run build

# Start the server
npm start
```

#### PM2 Process Manager (Production)

For production, use PM2 for process management:

```bash
# Install PM2 globally
npm install -g pm2

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Setup startup script
pm2 startup
```

The `ecosystem.config.js` configuration:

```javascript
module.exports = {
  apps: [{
    name: 'njspc-dash',
    script: 'dist/app.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production'
    }
  }]
}
```

---

## Configuration

### Configuration File

The application uses `config.json` for settings. It's automatically created from `defaultConfig.json` on first run.

#### Location

| Platform | Path |
|----------|------|
| Docker | `/app/config.json` |
| Manual | `./config.json` |

#### Structure

```json
{
  "web": {
    "servers": {
      "http": {
        "enabled": true,
        "ip": "0.0.0.0",
        "port": 5150,
        "httpsRedirect": false,
        "authentication": "none",
        "authFile": "/users.htpasswd"
      },
      "https": {
        "enabled": false,
        "ip": "0.0.0.0",
        "port": 5151,
        "sslKeyFile": "/ssl/privkey.pem",
        "sslCertFile": "/ssl/cert.pem"
      }
    },
    "services": {
      "protocol": "http://",
      "ip": "127.0.0.1",
      "port": 4200,
      "useProxy": false,
      "socket": {
        "protocol": "ws://",
        "reconnectionDelay": 2000,
        "reconnection": true
      }
    }
  },
  "log": {
    "app": {
      "enabled": true,
      "level": "info"
    }
  }
}
```

#### Key Settings

| Setting | Description |
|---------|-------------|
| `web.servers.http.port` | HTTP port (default: 5150) |
| `web.servers.https.port` | HTTPS port (default: 5151) |
| `web.services.ip` | Backend controller IP |
| `web.services.port` | Backend controller port (default: 4200) |
| `web.services.useProxy` | Enable request proxying |
| `log.app.level` | Log level: error, warn, info, debug |

---

### Environment Variables

Environment variables override configuration file settings.

#### Docker Environment

```yaml
environment:
  - POOL_WEB_SERVICES_IP=192.168.1.100
  - POOL_WEB_SERVICES_PORT=4200
  - POOL_WEB_SERVERS_HTTP_PORT=5150
```

#### Complete Variable Reference

| Variable | Description | Default |
|----------|-------------|---------|
| `POOL_WEB_SERVICES_IP` | Backend server IP | 127.0.0.1 |
| `POOL_WEB_SERVICES_PORT` | Backend server port | 4200 |
| `POOL_WEB_SERVICES_PROTOCOL` | Backend protocol | http:// |
| `POOL_WEB_SERVERS_HTTP_ENABLED` | Enable HTTP | true |
| `POOL_WEB_SERVERS_HTTP_PORT` | HTTP port | 5150 |
| `POOL_WEB_SERVERS_HTTPS_ENABLED` | Enable HTTPS | false |
| `POOL_WEB_SERVERS_HTTPS_PORT` | HTTPS port | 5151 |

#### Legacy Variables

For backward compatibility:

| Variable | Maps To |
|----------|---------|
| `POOL_HTTP_IP` | `web.services.ip` |
| `POOL_HTTP_PORT` | `web.services.port` |

---

## Network Setup

### Firewall Configuration

Open the required ports on your firewall:

```bash
# UFW (Ubuntu)
sudo ufw allow 5150/tcp    # HTTP
sudo ufw allow 5151/tcp    # HTTPS (if enabled)

# firewalld (CentOS/RHEL)
sudo firewall-cmd --permanent --add-port=5150/tcp
sudo firewall-cmd --reload

# iptables
sudo iptables -A INPUT -p tcp --dport 5150 -j ACCEPT
```

### Reverse Proxy

#### Nginx Configuration

```nginx
server {
    listen 80;
    server_name pool.example.com;

    location / {
        proxy_pass http://localhost:5150;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Apache Configuration

```apache
<VirtualHost *:80>
    ServerName pool.example.com

    ProxyPreserveHost On
    ProxyPass / http://localhost:5150/
    ProxyPassReverse / http://localhost:5150/

    # WebSocket support
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteRule /(.*) ws://localhost:5150/$1 [P,L]
</VirtualHost>
```

---

## Security

### HTTPS Setup

#### Generate SSL Certificates

Using Let's Encrypt (certbot):

```bash
sudo certbot certonly --standalone -d pool.example.com
```

Self-signed (development only):

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ssl/privkey.pem \
  -out ssl/cert.pem
```

#### Enable HTTPS

Update `config.json`:

```json
{
  "web": {
    "servers": {
      "https": {
        "enabled": true,
        "port": 5151,
        "sslKeyFile": "/ssl/privkey.pem",
        "sslCertFile": "/ssl/cert.pem"
      }
    }
  }
}
```

#### Docker Volume Mount

```yaml
volumes:
  - /etc/letsencrypt/live/pool.example.com:/ssl:ro
```

### Authentication

HTTP Basic Authentication is supported but not enabled by default.

#### Creating Password File

```bash
# Install htpasswd utility
sudo apt install apache2-utils

# Create password file
htpasswd -c /app/users.htpasswd username
```

#### Enable Authentication

Update `config.json`:

```json
{
  "web": {
    "servers": {
      "http": {
        "authentication": "basic",
        "authFile": "/app/users.htpasswd"
      }
    }
  }
}
```

---

## Upgrades and Maintenance

### Docker Upgrades

```bash
# Pull latest image
docker-compose pull

# Restart with new image
docker-compose up -d

# Clean old images
docker image prune
```

### Manual Upgrades

```bash
# Pull latest code
git pull origin master

# Update dependencies
npm install

# Rebuild
npm run build

# Restart service
pm2 restart njspc-dash
```

### Backup Configuration

```bash
# Docker
docker cp njspc-dash:/app/config.json ./backup/

# Manual
cp config.json backup/config.json.$(date +%Y%m%d)
```

### Log Management

#### View Logs

```bash
# Docker
docker logs -f njspc-dash

# PM2
pm2 logs njspc-dash

# Manual
tail -f logs/app.log
```

#### Log Rotation

For PM2, add to `ecosystem.config.js`:

```javascript
{
  log_date_format: 'YYYY-MM-DD HH:mm:ss',
  error_file: 'logs/error.log',
  out_file: 'logs/out.log',
  merge_logs: true,
  max_size: '10M',
  max_restarts: 10
}
```

---

## Health Checks

### Docker Health Check

Add to `docker-compose.yml`:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:5150"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

### Monitoring

Check application status:

```bash
# Docker
docker inspect --format='{{.State.Health.Status}}' njspc-dash

# PM2
pm2 status njspc-dash
```

---

## Next Steps

- Read the [User Guide](USER_GUIDE.md) for daily usage
- Review the [API Documentation](API.md) for integration
- Check [Troubleshooting](#troubleshooting) for common issues

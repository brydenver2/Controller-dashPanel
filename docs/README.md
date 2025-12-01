# nodejs-poolController-dashPanel Documentation

Welcome to the documentation wiki for nodejs-poolController-dashPanel. This documentation provides comprehensive guides for users, developers, and system administrators.

## 📚 Documentation Index

### Getting Started

| Document | Description |
|----------|-------------|
| [Installation Guide](INSTALLATION.md) | Complete setup instructions for Docker and manual installation |
| [User Guide](USER_GUIDE.md) | How to use the dashboard interface |
| [Quick Start](../README.md) | Minimal setup to get running quickly |

### Technical Reference

| Document | Description |
|----------|-------------|
| [API Reference](API.md) | REST API and WebSocket documentation |
| [Configuration Reference](#configuration-reference) | All configuration options |
| [Environment Variables](#environment-variables) | Docker and system environment settings |

---

## Quick Links

### 🚀 New Users Start Here

1. **[Installation Guide](INSTALLATION.md)** - Get the dashboard up and running
2. **[User Guide](USER_GUIDE.md)** - Learn the interface basics
3. **[Troubleshooting](#troubleshooting)** - Common issues and solutions

### 👨‍💻 Developers

1. **[API Reference](API.md)** - REST endpoints and WebSocket events
2. **[Development Setup](#development-setup)** - Contributing to the project
3. **[Architecture Overview](#architecture)** - System design

---

## Architecture

### System Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Web Browser    │────▶│  dashPanel       │────▶│ poolController  │
│  (Dashboard)    │◀────│  (This App)      │◀────│ (Backend)       │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                       │                        │
        │    HTTP/WebSocket     │     HTTP/WebSocket     │    RS485
        └───────────────────────┴────────────────────────┴──────────▶
                                                                Pool Equipment
```

### Component Responsibilities

| Component | Purpose |
|-----------|---------|
| **dashPanel** | Web UI, relay proxy, message debugging |
| **nodejs-poolController** | RS485 communication, equipment control |
| **Pool Controller** | IntelliCenter/IntelliTouch/EasyTouch hardware |

### Technology Stack

- **Backend**: Node.js, Express.js, TypeScript
- **Real-time**: Socket.IO
- **Frontend**: jQuery, Bootstrap
- **Deployment**: Docker, PM2

---

## Configuration Reference

### Web Server Settings

```json
{
  "web": {
    "servers": {
      "http": {
        "enabled": true,        // Enable HTTP server
        "ip": "0.0.0.0",        // Bind address
        "port": 5150,           // HTTP port
        "httpsRedirect": false, // Redirect HTTP to HTTPS
        "authentication": "none" // "none" or "basic"
      },
      "https": {
        "enabled": false,       // Enable HTTPS server
        "port": 5151,           // HTTPS port
        "sslKeyFile": "",       // Path to private key
        "sslCertFile": ""       // Path to certificate
      }
    }
  }
}
```

### Backend Connection Settings

```json
{
  "web": {
    "services": {
      "protocol": "http://",    // http:// or https://
      "ip": "127.0.0.1",        // Backend IP address
      "port": 4200,             // Backend port
      "useProxy": false,        // Enable relay proxy
      "socket": {
        "protocol": "ws://",    // WebSocket protocol
        "reconnection": true,   // Auto-reconnect
        "reconnectionDelay": 2000
      }
    }
  }
}
```

### Logging Settings

```json
{
  "log": {
    "app": {
      "enabled": true,
      "level": "info"   // error, warn, info, debug, verbose
    }
  }
}
```

---

## Environment Variables

### Server Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `POOL_WEB_SERVERS_HTTP_ENABLED` | Enable HTTP | `true` |
| `POOL_WEB_SERVERS_HTTP_PORT` | HTTP port | `5150` |
| `POOL_WEB_SERVERS_HTTPS_ENABLED` | Enable HTTPS | `false` |
| `POOL_WEB_SERVERS_HTTPS_PORT` | HTTPS port | `5151` |

### Backend Connection

| Variable | Description | Default |
|----------|-------------|---------|
| `POOL_WEB_SERVICES_IP` | Backend IP | `127.0.0.1` |
| `POOL_WEB_SERVICES_PORT` | Backend port | `4200` |
| `POOL_WEB_SERVICES_PROTOCOL` | Protocol | `http://` |

### Docker Environment

```yaml
environment:
  - NODE_ENV=production
  - TZ=America/New_York
  - POOL_WEB_SERVICES_IP=njspc
  - POOL_WEB_SERVICES_PORT=4200
```

---

## Development Setup

### Prerequisites

- Node.js 18+
- npm 9+
- Git

### Local Development

```bash
# Clone repository
git clone https://github.com/rstrouse/nodejs-poolController-dashPanel.git
cd nodejs-poolController-dashPanel

# Install dependencies
npm install

# Development mode with watch
npm run watch

# Build for production
npm run build

# Start server
npm start
```

### Project Structure

```
├── app.ts              # Application entry point
├── server/
│   ├── Server.ts       # Express server setup
│   ├── api/            # REST API routes
│   ├── relay/          # Backend proxy
│   ├── messages/       # RS485 message handling
│   ├── queues/         # Message queues
│   ├── config/         # Configuration
│   ├── logger/         # Logging
│   └── upload/         # File uploads
├── scripts/            # Frontend JavaScript
├── pages/              # HTML pages
├── themes/             # CSS and images
└── docs/               # Documentation
```

---

## Troubleshooting

### Connection Issues

**Dashboard won't load**
- Verify server is running: `docker ps` or `pm2 status`
- Check port availability: `netstat -tlnp | grep 5150`
- Review logs: `docker logs njspc-dash`

**"Cannot connect to backend"**
- Verify backend is running on configured IP/port
- Check network connectivity: `curl http://[backend-ip]:4200`
- Ensure firewall allows connection

**WebSocket disconnects**
- Check for proxy/firewall WebSocket support
- Verify browser console for errors
- Increase reconnection delay in config

### Configuration Issues

**Changes not saving**
- Check file permissions on `config.json`
- Verify container has write access to volume
- Check logs for write errors

**Environment variables ignored**
- Use correct `POOL_WEB_*` prefix
- Verify Docker environment is set correctly
- Restart container after changes

### Performance Issues

**Slow dashboard loading**
- Check network latency to backend
- Verify backend is responding quickly
- Monitor system resources

**High memory usage**
- Enable memory limits in Docker/PM2
- Check for memory leaks in logs
- Restart service periodically

---

## FAQ

### General

**Q: What pool controllers are supported?**
A: IntelliCenter, IntelliTouch, EasyTouch, and SunTouch (limited) via nodejs-poolController.

**Q: Can I run this without Docker?**
A: Yes, see the [Manual Installation](INSTALLATION.md#manual-installation) section.

**Q: How do I update?**
A: For Docker: `docker-compose pull && docker-compose up -d`

### Security

**Q: Is HTTPS supported?**
A: Yes, see [HTTPS Setup](INSTALLATION.md#https-setup).

**Q: How do I add authentication?**
A: Enable HTTP Basic Auth in config - see [Authentication](INSTALLATION.md#authentication).

### Connectivity

**Q: Can I access remotely?**
A: Yes, configure port forwarding or use a reverse proxy with SSL.

**Q: How do I find my pool controller?**
A: Use the "Find Controllers" button in settings for SSDP discovery.

---

## Support

- **GitHub Issues**: [Report bugs or request features](https://github.com/rstrouse/nodejs-poolController-dashPanel/issues)
- **Discussions**: [Community support](https://github.com/rstrouse/nodejs-poolController-dashPanel/discussions)
- **Wiki**: Check for additional community documentation

---

## Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

See [Development Setup](#development-setup) for local development instructions.

---

## License

This project is licensed under GPL-3.0. See the LICENSE file for details.

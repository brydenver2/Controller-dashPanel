# nodejs-poolController-dashPanel API Documentation

This document provides comprehensive API documentation for the nodejs-poolController-dashPanel application.

## Table of Contents

- [Overview](#overview)
- [Server Configuration](#server-configuration)
- [HTTP REST API Endpoints](#http-rest-api-endpoints)
  - [Configuration Endpoints](#configuration-endpoints)
  - [Messages Endpoints](#messages-endpoints)
  - [Upload Endpoints](#upload-endpoints)
  - [Relay/Proxy Endpoints](#relayproxy-endpoints)
- [WebSocket Events](#websocket-events)
- [Environment Variables](#environment-variables)
- [Error Handling](#error-handling)

---

## Overview

The dashPanel application serves as a web dashboard and relay proxy for the [nodejs-poolController](https://github.com/tagyoureit/nodejs-poolController) backend. It provides:

- A web-based dashboard for pool control and monitoring
- Real-time updates via Socket.IO WebSocket connections
- RS485 message debugging tools (Message Manager)
- HTTP proxy/relay to the backend pool controller

### Base URLs

| Protocol | Default Port | URL |
|----------|--------------|-----|
| HTTP | 5150 | `http://localhost:5150` |
| HTTPS | 5151 | `https://localhost:5151` |

### Technology Stack

- **Server**: Node.js with Express.js
- **Real-time**: Socket.IO v4
- **Frontend**: jQuery widgets with Bootstrap
- **Language**: TypeScript

---

## Server Configuration

### Configuration File (config.json)

The application uses a JSON configuration file located at `./config.json`. Configuration is automatically merged with `defaultConfig.json` on startup.

```json
{
  "web": {
    "servers": {
      "http": {
        "enabled": true,
        "ip": "0.0.0.0",
        "port": 5150,
        "httpsRedirect": false
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
      "useProxy": false
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

---

## HTTP REST API Endpoints

### Configuration Endpoints

#### GET /config/serviceUri

Returns the current backend service connection settings.

**Response:**
```json
{
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
```

**Status Codes:**
- `200 OK` - Success

---

#### PUT /config/serviceUri

Updates the backend service connection settings and reinitializes the relay connection.

**Request Body:**
```json
{
  "protocol": "http://",
  "ip": "192.168.1.100",
  "port": 4200,
  "useProxy": true
}
```

**Response:**
```json
{
  "protocol": "http://",
  "ip": "192.168.1.100",
  "port": 4200,
  "useProxy": true
}
```

**Status Codes:**
- `200 OK` - Configuration updated successfully

---

#### GET /config/findPoolControllers

Discovers pool controllers on the local network using SSDP (Simple Service Discovery Protocol).

**Response:**
```json
[
  {
    "origin": "http://192.168.1.100:4200",
    "protocol": "http:",
    "hostname": "192.168.1.100",
    "port": "4200",
    "hostnames": ["poolcontroller.local"]
  }
]
```

**Notes:**
- Discovery has a 5-second timeout
- Searches for `urn:schemas-tagyoureit-org:device:PoolController:1`

**Status Codes:**
- `200 OK` - Discovery complete (may return empty array)

---

#### GET /config/findREMControllers

Discovers Relay Equipment Manager (REM) controllers on the local network.

**Response:**
```json
[
  {
    "origin": "http://192.168.1.101:8080",
    "protocol": "http:",
    "hostname": "192.168.1.101",
    "port": "8080",
    "hostnames": []
  }
]
```

**Notes:**
- Discovery has a 5-second timeout
- Searches for `urn:schemas-rstrouse-org:device:relayEquipmentManager:1`

**Status Codes:**
- `200 OK` - Discovery complete

---

#### GET /config/appVersion

Returns application version information including installed version and latest GitHub release.

**Response:**
```json
{
  "installed": "8.3.0",
  "githubRelease": "8.3.0",
  "status": "current",
  "gitLocalBranch": "master",
  "gitLocalCommit": "abc1234..."
}
```

**Version Status Values:**
- `current` - Installed version matches latest release
- `behind` - Newer version available
- `ahead` - Running a pre-release/development version
- `unknown` - Unable to determine version status

**Status Codes:**
- `200 OK` - Version info retrieved
- `500 Internal Server Error` - Failed to check version

---

#### GET /config/:section

Retrieves a specific configuration section.

**Parameters:**
- `section` (path) - Dot-notation path to config section (e.g., `web.services`, `log.app`)

**Example Request:**
```bash
curl http://localhost:5150/config/web.services
```

**Response:**
```json
{
  "protocol": "http://",
  "ip": "127.0.0.1",
  "port": 4200
}
```

**Status Codes:**
- `200 OK` - Section retrieved

---

#### PUT /config/:section

Updates a specific configuration section.

**Parameters:**
- `section` (path) - Dot-notation path to config section

**Request Body:** Configuration object to set

**Example Request:**
```bash
curl -X PUT http://localhost:5150/config/log.app \
  -H "Content-Type: application/json" \
  -d '{"level": "debug", "enabled": true}'
```

**Status Codes:**
- `200 OK` - Section updated
- `400 Bad Request` - Invalid configuration

---

#### GET /options

Returns dashboard options including available background images.

**Response:**
```json
{
  "web": {
    "servers": { ... },
    "services": { ... }
  },
  "backgrounds": [
    {
      "name": "pool-bg.jpg",
      "ext": ".jpg",
      "size": 245678,
      "url": "/themes/Images/pool-bg.jpg"
    }
  ]
}
```

**Status Codes:**
- `200 OK` - Options retrieved

---

### Messages Endpoints

These endpoints support the RS485 Message Manager debugging tool.

#### PUT /messages/queue

Creates or updates an outbound message queue.

**Request Body:**
```json
{
  "id": 1,
  "name": "Test Queue",
  "description": "Queue for testing pump commands",
  "messages": [
    { "header": [165, 0, 96, 16, 7, 15], "payload": [1, 0, 0, 0] }
  ]
}
```

**Response:** The saved queue object

**Status Codes:**
- `200 OK` - Queue saved successfully

---

#### GET /messages/queue/:id

Retrieves a specific message queue by ID including all messages.

**Parameters:**
- `id` (path) - Queue ID number

**Response:**
```json
{
  "id": 1,
  "name": "Test Queue",
  "description": "Queue description",
  "type": "messageList",
  "fileName": "Test_Queue.out",
  "messages": [...]
}
```

**Status Codes:**
- `200 OK` - Queue found
- `404 Not Found` - Queue ID not found

---

#### GET /messages/queues

Lists all available message queues (descriptors only, not full message content).

**Response:**
```json
[
  {
    "id": 1,
    "name": "Test Queue",
    "description": "Queue description",
    "type": "messageList",
    "fileName": "Test_Queue.out"
  },
  {
    "id": 2,
    "name": "pump_test",
    "type": "testModule",
    "description": "Test module for generating outbound messages"
  }
]
```

**Status Codes:**
- `200 OK` - Queues listed

---

#### GET /messages/docs/constants

Returns RS485 protocol constants used for message decoding.

**Response:**
```json
{
  "actions": {
    "1": "ACK",
    "2": "SET",
    "3": "GET"
  },
  "addresses": {
    "16": "OCP",
    "96": "Pump 1"
  }
}
```

**Status Codes:**
- `200 OK` - Constants returned

---

#### GET /messages/docs/keyBytes

Returns message key byte definitions for protocol identification.

**Response:**
```json
{
  "broadcast.1": {
    "keyBytes": [165, 1],
    "shortName": "Version",
    "category": "System"
  }
}
```

**Status Codes:**
- `200 OK` - Key bytes returned

---

#### GET /messages/docs/:key

Returns documentation for a specific message key.

**Parameters:**
- `key` (path) - Message documentation key

**Response:**
```json
{
  "docKey": "broadcast.1",
  "shortName": "Version",
  "description": "Firmware version broadcast",
  "payloadBytes": [...]
}
```

**Status Codes:**
- `200 OK` - Documentation found (returns `{ docKey: key }` if not found)

---

### Upload Endpoints

#### POST /upload/logfile

Uploads and parses an RS485 log file for the Message Manager.

**Content-Type:** `multipart/form-data`

**Form Fields:**
- `logFile` - The log file to upload

**Supported Formats:**
- JSON message logs (one JSON object per line)
- Hex stream files (pipe-delimited hex bytes, e.g., `0x10|0x02|0x00|...`)

**Response:** Array of parsed message objects

**Status Codes:**
- `200 OK` - File parsed successfully
- `500 Internal Server Error` - Parse error

---

#### POST /upload/backgroundFile

Uploads a background image for dashboard customization.

**Content-Type:** `multipart/form-data`

**Form Fields:**
- `backgroundFile` - Image file (JPG, PNG, GIF, BMP, TIFF)

**Notes:**
- No explicit file size limit configured (subject to server defaults)
- Files are stored in `themes/Images/` directory
- Duplicate filenames will overwrite existing files unless `preserveFile` is enabled

**Response:**
```json
{
  "uploaded": {
    "name": "my-background.jpg",
    "ext": ".jpg",
    "size": 123456,
    "url": "/themes/Images/my-background.jpg"
  },
  "backgrounds": [...]
}
```

**Status Codes:**
- `200 OK` - Upload successful
- `500 Internal Server Error` - Upload failed

---

### Relay/Proxy Endpoints

#### ALL /njsPC/*

Proxies all requests to the nodejs-poolController backend server.

**Description:**
All HTTP methods (GET, POST, PUT, DELETE, PATCH) to paths starting with `/njsPC/` are forwarded to the configured backend pool controller. The `/njsPC` prefix is stripped before forwarding.

**Example:**
```bash
# Request to dashboard
GET http://localhost:5150/njsPC/state/temps

# Forwarded to backend
GET http://192.168.1.100:4200/state/temps
```

**Headers Forwarded:**
- `connection`
- `accept`
- `user-agent`
- `content-type`
- `content-length`

**Response:** Proxied response from backend

**Status Codes:** Matches backend response

---

## WebSocket Events

The dashPanel uses Socket.IO for real-time communication with both connected clients and the backend pool controller.

### Connection

```javascript
// Client connection
const socket = io('http://localhost:5150', {
  transports: ['websocket'],
  upgrade: true
});
```

### Client → Server Events

#### sendRS485PortStats

Toggles RS485 port statistics streaming.

```javascript
socket.emit('sendRS485PortStats', true);  // Enable
socket.emit('sendRS485PortStats', false); // Disable
```

When enabled, client joins the `rs485PortStats` channel.

---

#### sendLogMessages

Toggles RS485 message logging for Message Manager.

```javascript
socket.emit('sendLogMessages', true);  // Enable
socket.emit('sendLogMessages', false); // Disable
```

When enabled, client joins the `msgLogger` channel.

---

#### sendOutboundMessage

Sends an outbound RS485 message through the backend.

```javascript
socket.emit('sendOutboundMessage', {
  header: [165, 0, 96, 16, 7, 15],
  payload: [1, 0, 0, 0]
});
```

---

#### echo

Sends an echo request for connection testing.

```javascript
socket.emit('echo', 'test message');
socket.on('echo', (msg) => console.log('Echo:', msg));
```

---

### Server → Client Events

These events are forwarded from the nodejs-poolController backend:

#### Pool State Events

| Event | Description |
|-------|-------------|
| `controller` | Pool controller state update |
| `temps` | Temperature readings |
| `circuits` | Circuit states |
| `features` | Feature states |
| `pumps` | Pump status |
| `bodies` | Body of water states |
| `schedules` | Schedule configurations |
| `chlorinators` | Chlorinator status |
| `chemistry` | Chemistry readings |
| `heaters` | Heater status |

#### Message Manager Events

| Event | Channel | Description |
|-------|---------|-------------|
| `rs485Stats` | `rs485PortStats` | RS485 port statistics |
| `logMessage` | `msgLogger` | RS485 message for logging |

---

## Environment Variables

Environment variables can override configuration file settings, useful for Docker deployments.

### Legacy Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `POOL_HTTP_IP` | Backend service IP | `192.168.1.100` |
| `POOL_HTTP_PORT` | Backend service port | `4200` |

### Hierarchical Variables (POOL_WEB_*)

| Variable | Description | Example |
|----------|-------------|---------|
| `POOL_WEB_SERVICES_IP` | Backend service IP | `192.168.1.100` |
| `POOL_WEB_SERVICES_PORT` | Backend service port | `4200` |
| `POOL_WEB_SERVICES_PROTOCOL` | Backend protocol | `http://` |
| `POOL_WEB_SERVERS_HTTP_PORT` | Dashboard HTTP port | `5150` |
| `POOL_WEB_SERVERS_HTTPS_PORT` | Dashboard HTTPS port | `5151` |
| `POOL_WEB_SERVERS_HTTP_ENABLED` | Enable HTTP | `true` |
| `POOL_WEB_SERVERS_HTTPS_ENABLED` | Enable HTTPS | `false` |

---

## Error Handling

### Error Response Format

API errors are returned as JSON with the following structure:

```json
{
  "name": "ApiError",
  "message": "Description of the error",
  "code": 100,
  "httpCode": 400,
  "position": {
    "file": "Config.ts",
    "line": 45,
    "column": 12
  }
}
```

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `400` | Bad Request - Invalid input |
| `404` | Not Found - Resource doesn't exist |
| `500` | Internal Server Error |

### Common Error Codes

| Code | Description |
|------|-------------|
| `0` | General error |
| `100` | Resource not found |

### Troubleshooting

#### Connection Issues

1. **Dashboard won't load**: Verify the HTTP server is enabled and port is not in use
2. **Backend not responding**: Check `web.services` configuration matches your pool controller
3. **WebSocket disconnects**: Ensure firewall allows WebSocket connections

#### Configuration Issues

1. **Config not saving**: Check file permissions on `config.json`
2. **Environment variables ignored**: Ensure variables use correct `POOL_WEB_*` prefix
3. **HTTPS not working**: Verify SSL certificate files exist and are readable

---

## Static File Routes

The dashboard serves static files from the following paths:

| URL Path | Source Directory | Cache |
|----------|-----------------|-------|
| `/` | `pages/` | 1 day |
| `/scripts` | `scripts/` | 1 day |
| `/themes` | `themes/` | 1 day |
| `/icons` | `themes/icons/` | 1 day |
| `/socket.io-client` | `node_modules/socket.io-client/dist/` | 60 days |
| `/jquery` | `node_modules/jquery/` | 60 days |
| `/jquery-ui` | `node_modules/jquery-ui-dist/` | 60 days |
| `/font-awesome` | `node_modules/@fortawesome/fontawesome-free/` | 60 days |

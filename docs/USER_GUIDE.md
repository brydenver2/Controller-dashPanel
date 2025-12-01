# nodejs-poolController-dashPanel User Guide

A comprehensive guide for users of the dashPanel web interface for pool control and monitoring.

## Table of Contents

- [Introduction](#introduction)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [First-Time Setup](#first-time-setup)
- [Dashboard Overview](#dashboard-overview)
  - [Main Interface](#main-interface)
  - [Navigation Menu](#navigation-menu)
- [Controlling Your Pool](#controlling-your-pool)
  - [Circuits and Features](#circuits-and-features)
  - [Temperature Control](#temperature-control)
  - [Pumps](#pumps)
  - [Chemistry](#chemistry)
- [Settings and Configuration](#settings-and-configuration)
  - [Connection Settings](#connection-settings)
  - [Dashboard Customization](#dashboard-customization)
- [Message Manager](#message-manager)
  - [Viewing RS485 Messages](#viewing-rs485-messages)
  - [Filtering Messages](#filtering-messages)
- [Troubleshooting](#troubleshooting)

---

## Introduction

The dashPanel is a web-based interface that provides real-time control and monitoring of your pool equipment. It works as a frontend for the [nodejs-poolController](https://github.com/tagyoureit/nodejs-poolController) backend server, which communicates directly with your pool controller via RS485.

### Supported Pool Controllers

- **Pentair IntelliCenter**
- **Pentair IntelliTouch**
- **Pentair EasyTouch**
- **Pentair SunTouch** (limited support)

---

## Getting Started

### Prerequisites

Before using the dashPanel, you need:

1. **nodejs-poolController** server running and connected to your pool equipment
2. Network access between your browser and the dashPanel server
3. A modern web browser (Chrome, Firefox, Safari, Edge)

### First-Time Setup

1. **Open the Dashboard**
   
   Navigate to the dashPanel URL in your browser:
   ```
   http://[server-ip]:5150
   ```
   Replace `[server-ip]` with your dashPanel server's IP address.

2. **Configure Backend Connection**
   
   On first launch, you'll need to connect to your nodejs-poolController:
   
   - Click the **☰** (menu) icon in the top-left corner
   - Enter your pool controller server's **IP address** and **port** (default: 4200)
   - Click **Apply**
   
   ![Configuration Menu](https://user-images.githubusercontent.com/47839015/83304160-38a86780-a1b3-11ea-8214-442db6c6bdc4.png)

3. **Verify Connection**
   
   Once connected, the dashboard will display your pool equipment status:
   - Temperature readings
   - Circuit/feature states
   - Pump status
   - Chemistry readings (if equipped)

---

## Dashboard Overview

### Main Interface

The dashboard displays a real-time view of your pool equipment:

| Section | Description |
|---------|-------------|
| **Bodies** | Pool and spa temperature, heating status |
| **Circuits** | On/off controls for pool equipment |
| **Features** | Special features like waterfalls, lights |
| **Pumps** | Pump speeds, flow rates, power consumption |
| **Chemistry** | pH, ORP, salt levels, chlorinator status |
| **Schedules** | Automated schedule times |

### Navigation Menu

Access the navigation menu by clicking the **☰** icon:

- **Dashboard** - Main equipment view
- **Message Manager** - RS485 debugging tool
- **Settings** - Connection and display options

---

## Controlling Your Pool

### Circuits and Features

**Turning Circuits On/Off:**
1. Locate the circuit panel on the dashboard
2. Click the toggle button next to any circuit
3. The indicator changes color to show the new state:
   - **Green/On** - Circuit is running
   - **Gray/Off** - Circuit is off

**Common Circuits:**
- Pool pump
- Spa pump
- Pool light
- Spa light
- Cleaner
- Water features

### Temperature Control

**Setting Pool/Spa Temperature:**
1. Find the temperature panel for Pool or Spa
2. Click the temperature setpoint
3. Use +/- buttons to adjust
4. Temperature changes are applied immediately

**Heating Modes:**
| Mode | Description |
|------|-------------|
| Off | Heater disabled |
| Heater | Gas/electric heater only |
| Solar Preferred | Solar first, backup heater if needed |
| Solar Only | Solar heating only |

### Pumps

**Variable Speed Pumps:**
- View current RPM and flow rate
- See power consumption (watts)
- Monitor pump programs

**Pump Status Indicators:**
- **Running** - Pump is active
- **Idle** - Pump is stopped
- **Priming** - Pump is priming

### Chemistry

**Monitoring:**
- **pH Level** - Acidity (target: 7.2-7.6)
- **ORP** - Oxidation-Reduction Potential
- **Salt Level** - For salt chlorine generators
- **Chlorine Output** - Chlorinator percentage

**Adjusting Chlorinator:**
1. Locate the chlorinator panel
2. Adjust the output percentage slider
3. Changes apply to current operation

---

## Settings and Configuration

### Connection Settings

**Accessing Settings:**
1. Click the **☰** menu icon
2. Select **Settings** or use the gear icon

**Backend Connection:**
| Setting | Description | Default |
|---------|-------------|---------|
| Protocol | http:// or https:// | http:// |
| IP Address | Pool controller server IP | 127.0.0.1 |
| Port | Pool controller server port | 4200 |
| Use Proxy | Route through dashboard | false |

**Finding Your Controller:**
- Click **Find Controllers** to auto-discover pool controllers on your network
- Select from the discovered list to auto-populate settings

### Dashboard Customization

**Background Image:**
1. Navigate to Settings
2. Upload a custom background image
3. Supported formats: JPG, PNG, GIF

**Theme Settings:**
- Adjust color schemes through the settings panel
- Changes are saved to your browser

---

## Message Manager

The Message Manager is an advanced tool for inspecting RS485 communication between your pool controller and equipment.

### Viewing RS485 Messages

**Starting the Message Manager:**
1. Click **☰** menu → **Message Manager**
2. Click **Start Logging** to begin capturing messages

**Message Display:**
- Messages are displayed in chronological order
- Each message shows:
  - Direction (in/out)
  - Protocol type
  - Source/destination addresses
  - Payload data
  - Timestamp

![Message Manager](https://user-images.githubusercontent.com/47839015/83314254-7a92d700-a1ce-11ea-8891-545db084624e.png)

### Filtering Messages

**Available Filters:**
- **Protocol** - Filter by message protocol type
- **Address** - Filter by source or destination address
- **Action** - Filter by command type
- **Direction** - Show only inbound or outbound

**Using Filters:**
1. Click the filter dropdown
2. Select desired filter criteria
3. Messages update in real-time

**Saving Message Logs:**
- Click **Export** to download logged messages
- Logs can be imported later for analysis

---

## Troubleshooting

### Common Issues

**Dashboard won't load:**
1. Verify the server is running
2. Check the URL and port number
3. Ensure firewall allows port 5150

**"Connection Failed" error:**
1. Verify nodejs-poolController is running
2. Check IP address and port settings
3. Ensure network connectivity

**Pool equipment not responding:**
1. Check RS485 connection to pool controller
2. Verify nodejs-poolController logs for errors
3. Restart nodejs-poolController service

**Real-time updates stopped:**
1. Refresh the browser page
2. Check network connection
3. Verify WebSocket connections in browser console

### Getting Help

- **GitHub Issues**: [Repository Issues](https://github.com/rstrouse/nodejs-poolController-dashPanel/issues)
- **Wiki**: Check the project wiki for additional documentation
- **Community**: Join discussions in project forums

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `F5` | Refresh dashboard |
| `Esc` | Close dialogs |

---

## Mobile Usage

The dashPanel is responsive and works on mobile devices:

- Panels stack vertically on small screens
- Touch-friendly toggle controls
- Swipe navigation in Message Manager

**Tips for Mobile:**
- Use landscape orientation for Message Manager
- Pinch to zoom on detailed panels
- Bookmark the dashboard URL for quick access

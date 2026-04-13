# Ashly Protea 4.8SP Control App

Cross-platform (Mac-first) control application for the Ashly Protea 4.8SP speaker processor. Replaces the Windows-only Protea DSP Suite.

## Architecture

```
[React Frontend] <──WebSocket──> [Node.js Backend] <──RS-232 @ 9600──> [Ashly 4.8SP]
```

## Quick Start

```bash
npm install
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:3000

## Hardware Setup

1. Connect a USB-to-RS-232 adapter (FTDI chipset recommended) to the 4.8SP's serial port
2. On macOS, the port appears as `/dev/tty.usbserial-XXXXXXXX`
3. Install FTDI drivers if macOS doesn't detect automatically
4. Select the port in the Connection Bar and click Connect

## Demo Mode

The Vercel deployment runs in demo mode — a fully interactive simulation with animated meters and realistic defaults. No hardware required.

To run demo mode locally: http://localhost:5173?demo=1

## Features

- **Level Meters**: Animated VU meters for all 4 inputs and 8 outputs with clip indicators and gain reduction display
- **Input Channels**: Gain, mute, delay (0–682ms), 6-band parametric EQ with frequency response curve
- **Output Channels**: Gain, mute, polarity, delay, HPF/LPF crossover, 4-band EQ, limiter
- **Routing Matrix**: 4×8 input-to-output assignment grid
- **Presets**: 30 presets — recall, save, rename
- **Mobile Responsive**: Tab navigation on small screens, touch-friendly controls

## Serial Protocol

Implements the Ashly Protea 4.8SP/3.6SP Control Protocol (RS-232, 9600 8N1).

- Message framing: `[F0 00 01 2A 12 00] [CLASS] [TYPE] [PAYLOAD] [F7]`
- All encoding/decoding in `src/lib/ashly-protocol.ts`
- Unit tests: `npm test`

## Development

```bash
npm test              # Run protocol unit tests
npm run client:build  # Build frontend only (for Vercel)
npm run build         # Build everything (server + client)
```

# Bluesky Firehose Visualization

A 3D visualization of the Bluesky firehose using Babylon.js and WebGL.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start development server:
```bash
npm start
```

3. Build for production:
```bash
npm run build
```

## Configuration

The visualization can be configured using URL parameters:
- `discardFrac`: Fraction of messages to discard (0-1)
- `speed`: Animation speed multiplier

Example:
```
http://localhost:9000/?discardFrac=0.5&speed=1.2
```

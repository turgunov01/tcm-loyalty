# TCM Loyalty Telegram Bot

Node.js Telegram bot for Tashkent City Mall employee loyalty with JSON storage, QR links, scan tracking, and daily rewards.

## Features
- Register employees against `employees.json`
- Create loyalty profiles (100 points default, UUID loyaltyId)
- Generate QR URL: `/scan?...&loyaltyId=...&points=100&scanType=iphone`
- Commands/buttons: Register, My QR, Scan, /me
- Scan adds +10 points, increments scanCount, logs to `scans.json`
- Manual daily rewards helper (`applyDailyRewards`) adds +10 points once per day per profile

## Requirements
- Node.js 18+
- Telegram bot token

## Setup
```bash
npm install
cp .env .env.local # or edit .env directly
```

## Run locally
```bash
BOT_TOKEN=... PUBLIC_HOST=http://localhost:3000 npm run start
```

## Deploy on Pella
1. Set start command: `npm run start`
2. Configure env vars in Pella:
   - `BOT_TOKEN`
   - `PUBLIC_HOST` (e.g., `https://yourproject.pella.app`)
   - `PORT` (optional, defaults to 3000)
3. Deploy; bot runs with `node bot.js`.

## Environment Variables
- `BOT_TOKEN` — Telegram bot token (required)
- `PUBLIC_HOST` — Base URL used in QR links (e.g., `https://yourproject.pella.app`)
- `PORT` — Optional, defaults to 3000

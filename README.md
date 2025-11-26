# Cetus Pool Monitor Bot

Scripts to manage the Cetus Pool Monitor.

## Usage

### Start the Bot
Run the bot in the background:
```bash
./start-bot.sh
```
This will start the monitor and log output to `bot.log`.

### Check Status
Check if the bot is running and view recent logs:
```bash
./status-bot.sh
```

### Stop the Bot
Stop all bot processes:
```bash
./stop-bot.sh
```

### Logs
Logs are written to `bot.log`. You can follow them in real-time with:
```bash
tail -f bot.log
```

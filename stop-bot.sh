#!/bin/bash

# Script to stop the Cetus Pool Monitor

echo "🔍 Finding monitor processes..."

# Find the main start-bot.sh process
START_BOT_PID=$(ps aux | grep '[s]tart-bot.sh' | awk '{print $2}')

if [ -z "$START_BOT_PID" ]; then
    echo "⚠️  No start-bot.sh process found"
else
    echo "🛑 Stopping start-bot.sh (PID: $START_BOT_PID)..."
    kill $START_BOT_PID
    echo "🆗 Sent SIGTERM to start-bot.sh"
fi

# Find and kill the actual node process running the monitor
MONITOR_PIDS=$(ps aux | grep '[c]etus-pool-monitor.ts' | awk '{print $2}')

if [ -z "$MONITOR_PIDS" ]; then
    echo "⚠️  No monitor processes found"
else
    echo "🛑 Stopping monitor processes: $MONITOR_PIDS"
    echo "$MONITOR_PIDS" | xargs kill
    echo "🆗 Sent SIGTERM to monitor processes"
fi

echo ""
echo "🆗 Monitor shutdown complete"

#!/bin/bash

# Master script to manage Cetus Pool Monitor
# Usage: nohup bash ./start-bot.sh > bot.log 2>&1 &

LOG_FILE="bot.log"

echo "========================================" | tee -a "$LOG_FILE"
echo "🚀 Starting Cetus Pool Monitor" | tee -a "$LOG_FILE"
echo "📅 Started at $(TZ='Asia/Ho_Chi_Minh' date '+%H:%M:%S %Z %d:%m:%Y')" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"

# Function to cleanup background processes on exit
cleanup() {
    echo "🛑 Shutting down monitor..." | tee -a "$LOG_FILE"
    # Kill all background jobs started by this script
    jobs -p | xargs -r kill 2>/dev/null
    wait
    echo "🆗 Monitor stopped" | tee -a "$LOG_FILE"
    exit
}

# Trap SIGTERM and SIGINT to cleanup
trap cleanup SIGTERM SIGINT

echo "🔧 Starting monitor process..." | tee -a "$LOG_FILE"

# Run the monitor
# We use npx tsx to run the typescript file directly
npx tsx cetus-pool-monitor.ts >> "$LOG_FILE" 2>&1 &
MONITOR_PID=$!

echo "  ✓ Monitor started with PID $MONITOR_PID" | tee -a "$LOG_FILE"
echo "⏳ Waiting 5 seconds for initialization..." | tee -a "$LOG_FILE"
sleep 5

# Check if it's still running
if ps -p $MONITOR_PID > /dev/null; then
   echo "🆗 Monitor is running successfully." | tee -a "$LOG_FILE"
else
   echo "❌ Monitor failed to start or crashed immediately. Check logs above." | tee -a "$LOG_FILE"
fi

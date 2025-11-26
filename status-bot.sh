#!/bin/bash

# Script to check the status of the Cetus Pool Monitor

echo "🔍 Checking Cetus Pool Monitor Status"
echo "===================================="
echo ""

# Check start-bot.sh
echo "📋 Main Script (start-bot.sh):"
START_BOT_PID=$(ps aux | grep '[s]tart-bot.sh' | awk '{print $2}')
if [ -z "$START_BOT_PID" ]; then
    echo "  ❌ Not running"
else
    echo "  🆗 Running (PID: $START_BOT_PID)"
fi
echo ""

# Check monitor process
echo "📋 Monitor Process (cetus-pool-monitor.ts):"
MONITOR_COUNT=$(ps aux | grep '[c]etus-pool-monitor.ts' | wc -l)
if [ "$MONITOR_COUNT" -eq 0 ]; then
    echo "  ❌ No monitor running"
else
    echo "  🆗 Running"
    ps aux | grep '[c]etus-pool-monitor.ts' | awk '{print "     PID: " $2 " | CPU: " $3 "% | MEM: " $4 "%"}'
fi
echo ""

# Show recent log entries
echo "📋 Recent Log Entries (last 20 lines):"
echo "------------------------------------"
if [ -f "bot.log" ]; then
    tail -n 20 bot.log
else
    echo "  ⚠️  bot.log not found"
fi

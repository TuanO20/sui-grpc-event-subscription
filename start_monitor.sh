#!/bin/bash

# Run the monitor script in the background using nohup
# Redirect both stdout (1) and stderr (2) to monitor.log
nohup npx tsx cetus-pool-monitor.ts > monitor.log 2>&1 &

# Print the process ID
echo "Monitor started in background with PID $!"
echo "Logs are being written to monitor.log"

#!/bin/bash
# ================================================
# MIRROR Bot — Pi Startup Script
# Runs the local web server
# Usage: bash start_mirror.sh
# ================================================

cd "$(dirname "$0")"

echo "======================================"
echo "  MIRROR Bot - Starting Up"
echo "======================================"

# Kill any existing processes on our port
echo "[1/2] Cleaning up old processes..."
fuser -k 3000/tcp 2>/dev/null
sleep 1

# Start Node.js web server
echo "[2/2] Starting web server..."
node server.js &
NODE_PID=$!
echo "      Web server PID: $NODE_PID"

echo ""
echo "======================================"
echo "  ✅ MIRROR Bot is running!"
echo "  Open: http://localhost:3000"
echo "======================================"
echo ""
echo "Press Ctrl+C to stop everything."

# Wait and cleanup on exit
trap "echo 'Stopping...'; kill $NODE_PID 2>/dev/null; exit" INT TERM
wait

#!/bin/bash
# ================================================
# MIRROR Bot — Pi Startup Script
# Runs both the STT server and the web server
# Usage: bash start_mirror.sh
# ================================================

cd "$(dirname "$0")"

echo "======================================"
echo "  MIRROR Bot - Starting Up"
echo "======================================"

# Kill any existing processes on our ports
echo "[1/3] Cleaning up old processes..."
fuser -k 3000/tcp 2>/dev/null
fuser -k 8765/tcp 2>/dev/null
sleep 1

# Start Vosk STT server in background
echo "[2/3] Starting offline STT server (Vosk)..."
python3 pi_stt.py &
STT_PID=$!
echo "      STT server PID: $STT_PID"
sleep 3

# Start Node.js web server
echo "[3/3] Starting web server..."
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
trap "echo 'Stopping...'; kill $STT_PID $NODE_PID 2>/dev/null; exit" INT TERM
wait

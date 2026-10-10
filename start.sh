#!/bin/bash
# ====================================================
#  start.sh — Launch Maze Solver Project
#  Just run:  ./start.sh
# ====================================================

cd "$(dirname "$0")"

echo ""
echo "╔═══════════════════════════════════╗"
echo "║   🧩 Maze Solver — DSA Project    ║"
echo "╚═══════════════════════════════════╝"
echo ""

# Kill any existing server on port 8080
fuser -k 8080/tcp 2>/dev/null && echo "   Stopped old server."

# Start the server in background
python3 -m http.server 8080 &
SERVER_PID=$!

sleep 1

# Check if server started successfully
if kill -0 $SERVER_PID 2>/dev/null; then
    echo "   ✓ Server running at http://localhost:8080"
    echo "   ✓ PID: $SERVER_PID"
    echo ""
    echo "   Opening browser..."
    xdg-open http://localhost:8080 2>/dev/null || \
    google-chrome http://localhost:8080 2>/dev/null || \
    firefox http://localhost:8080 2>/dev/null
    echo ""
    echo "   Press CTRL+C to stop the server."
    wait $SERVER_PID
else
    echo "   ✗ Failed to start server. Try: python3 -m http.server 8080"
fi

#!/bin/bash
# ================================================================
#  compile.sh — Build solver.c → solver.wasm using Emscripten
# ================================================================
#
#  USAGE:
#    chmod +x compile.sh
#    ./compile.sh
#
#  This will output:
#    solver.js   — Emscripten glue code (loaded by maze.js)
#    solver.wasm — WebAssembly binary (the actual C code)
# ================================================================

set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   DSA Project — Maze Solver Compiler     ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Check for Emscripten ──────────────────────────────────────
if ! command -v emcc &> /dev/null; then
    echo "⚠  Emscripten (emcc) not found."
    echo ""
    echo "   Installing Emscripten SDK..."
    echo ""

    # Install emsdk in the project directory
    if [ ! -d "emsdk" ]; then
        git clone https://github.com/emscripten-core/emsdk.git
    fi

    cd emsdk
    ./emsdk install latest
    ./emsdk activate latest
    source ./emsdk_env.sh
    cd ..

    echo ""
    echo "✓  Emscripten installed successfully!"
    echo ""
else
    echo "✓  Emscripten found: $(emcc --version | head -1)"
    echo ""
fi

# ── Compile C → WebAssembly ───────────────────────────────────
echo "   Compiling solver.c → WebAssembly..."
echo ""

emcc solver.c \
    -o solver.js \
    -s WASM=1 \
    -s EXPORTED_FUNCTIONS='["_solve_maze","_get_path_length","_get_nodes_visited","_malloc","_free"]' \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","HEAPU8","HEAP32"]' \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME='MazeSolverModule' \
    -s NO_EXIT_RUNTIME=1 \
    -O2

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   ✓  Build Successful!                   ║"
echo "║                                          ║"
echo "║   Generated:                             ║"
echo "║     solver.js   (JS glue code)           ║"
echo "║     solver.wasm (WebAssembly binary)     ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "   Now serve the project:"
echo "   python3 -m http.server 8080"
echo "   → Open: http://localhost:8080"
echo ""

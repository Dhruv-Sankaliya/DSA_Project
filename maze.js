/**
 * ============================================================
 *  maze.js — Maze Generation + WASM Bridge + Animation Engine
 * ============================================================
 *
 *  RESPONSIBILITIES:
 *  1. Maze Generation — Recursive Backtracker algorithm (JS)
 *  2. WASM Bridge     — Passes maze data to C solver via WASM
 *  3. Fallback BFS    — Pure JS BFS if WASM isn't compiled yet
 *  4. Rendering       — Canvas-based maze drawing
 *  5. Animation       — Solution path reveal animation
 *
 * ============================================================
 */

'use strict';

/* ──────────────────────────────────────────────
   CONFIGURATION
   ────────────────────────────────────────────── */
const CONFIG = {
  cellSize: 0,           // calculated dynamically
  wallColor:     '#dde1f0',    // white/light — crisp visible walls on dark background
  wallStroke:    '#b0b8d4',    // slightly darker border line on each wall tile
  openColor:     '#1e3a5f',    // bright enough to read as open passage
  startColor:    '#00ff9d',
  endColor:      '#ff4d6d',
  pathColor:     '#00d4ff',
  visitedColor:  'rgba(140, 60, 255, 0.75)', // vivid purple — clearly visible
  borderColor:   '#07080d',
  canvasMaxSize: 620,    // max canvas dimension in px
};

/* ──────────────────────────────────────────────
   STATE
   ────────────────────────────────────────────── */
const State = {
  rows:       21,
  cols:       21,
  grid:       null,    // 1D flat array: 0=wall, 1=open
  animSpeed:    3,
  exploreSpeed: 3,
  isGenerating: false,
  isSolving:    false,
  wasmModule:   null,
  wasmReady:    false,
  mazeGenerated: false,
  animFrameId:   null,
  mazeType:     'corner-corner', // 'corner-corner' | 'corner-center'
  startCell:    0,    // flat index of start cell (set after generation)
  endCell:      0,    // flat index of end cell   (set after generation)
};

/* ──────────────────────────────────────────────
   DOM REFERENCES
   ────────────────────────────────────────────── */
const DOM = {
  canvas:         document.getElementById('mazeCanvas'),
  placeholder:    document.getElementById('mazePlaceholder'),
  btnGenerate:    document.getElementById('btnGenerate'),
  btnSolve:       document.getElementById('btnSolve'),
  btnReset:       document.getElementById('btnReset'),
  statusDot:      document.getElementById('statusDot'),
  statusText:     document.getElementById('statusText'),
  wasmStatus:     document.getElementById('wasmStatus'),
  sizeButtons:    document.querySelectorAll('[data-size]'),
  speedSlider:    document.getElementById('animSpeed'),
  exploreSlider:  document.getElementById('exploreSpeed'),
  exploreSpeedVal: document.getElementById('exploreSpeedVal'),
  pathSpeedVal:   document.getElementById('pathSpeedVal'),
  valMazeSize:    document.getElementById('valMazeSize'),
  valOpenCells:   document.getElementById('valOpenCells'),
  valPathLen:     document.getElementById('valPathLen'),
  valVisited:     document.getElementById('valVisited'),
  valEdges:       document.getElementById('valEdges'),
  valSolveTime:   document.getElementById('valSolveTime'),
  resultBox:      document.getElementById('resultBox'),
  resultIcon:     document.getElementById('resultIcon'),
  resultTitle:    document.getElementById('resultTitle'),
  resultSub:      document.getElementById('resultSub'),
  wtSteps:        document.querySelectorAll('.wt-step'),
  bgParticles:    document.getElementById('bgParticles'),
};

const ctx = DOM.canvas.getContext('2d');

/* ──────────────────────────────────────────────
   CANVAS SETUP
   ────────────────────────────────────────────── */
function setupCanvas() {
  const container = document.getElementById('mazeContainer');
  const maxSize   = Math.min(container.clientWidth - 40, container.clientHeight - 40, CONFIG.canvasMaxSize);
  const cellSize  = Math.floor(maxSize / Math.max(State.rows, State.cols));
  CONFIG.cellSize = Math.max(cellSize, 4);

  DOM.canvas.width  = State.cols * CONFIG.cellSize;
  DOM.canvas.height = State.rows * CONFIG.cellSize;
}

/* ──────────────────────────────────────────────
   MAZE DRAWING
   ────────────────────────────────────────────── */
function drawMaze(overlay) {
  const cs = CONFIG.cellSize;
  const { rows, cols, grid } = State;

  // Dark background — the "grout" between white wall tiles
  ctx.fillStyle = '#07080d';
  ctx.fillRect(0, 0, DOM.canvas.width, DOM.canvas.height);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const x = c * cs, y = r * cs;
      const cell = overlay ? overlay[idx] : null;

      if (cell === 'start') {
        drawGlowCell(x, y, cs, CONFIG.startColor, 0.9);
      } else if (cell === 'end') {
        drawGlowCell(x, y, cs, CONFIG.endColor, 0.9);
      } else if (cell === 'path') {
        ctx.fillStyle = CONFIG.pathColor;
        ctx.fillRect(x, y, cs, cs);
      } else if (cell === 'visited') {
        ctx.fillStyle = CONFIG.visitedColor;
        ctx.fillRect(x, y, cs, cs);
      } else if (grid[idx] === 1) {
        ctx.fillStyle = CONFIG.openColor;
        ctx.fillRect(x, y, cs, cs);
      } else {
        // Walls — white square tiles with 1px dark gap showing between them
        ctx.fillStyle = CONFIG.wallColor;
        ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
        ctx.strokeStyle = CONFIG.wallStroke;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
      }
    }
  }
}

function drawGlowCell(x, y, cs, color, alpha) {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fillRect(x, y, cs, cs);
  ctx.globalAlpha = 1.0;

  if (cs >= 8) {
    const grad = ctx.createRadialGradient(
      x + cs / 2, y + cs / 2, 0,
      x + cs / 2, y + cs / 2, cs
    );
    grad.addColorStop(0, color + '55');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(x - cs / 2, y - cs / 2, cs * 2, cs * 2);
  }
}


/* ──────────────────────────────────────────────
   MAZE GENERATION — Recursive Backtracker
   Creates a perfect maze (exactly one path between any two cells)
   ────────────────────────────────────────────── */
async function generateMaze() {
  if (State.isGenerating || State.isSolving) return;

  State.isGenerating = true;
  setStatus('generating', 'Generating maze...');
  setButtonState('generating');
  DOM.resultBox.style.display = 'none';

  const { rows, cols } = State;
  const grid = new Array(rows * cols).fill(0); // all walls

  // Helper: convert 2D to 1D
  const idx = (r, c) => r * cols + c;

  // High-branching Growing Tree Algorithm:
  // Combines DFS (deep corridors) with random selection (heavy side-branching off main path)
  // to produce tricky newspaper-style mazes with deceptive false leads.
  const active = [[1, 1]];
  grid[idx(1, 1)] = 1;

  const directions = [[0, 2], [2, 0], [0, -2], [-2, 0]];

  // Show canvas
  DOM.placeholder.style.display = 'none';
  DOM.canvas.style.display = 'block';
  setupCanvas();

  // Animation speed delay
  const delay = () => new Promise(r => setTimeout(r, speedToDelay(State.animSpeed)));

  let step = 0;
  while (active.length > 0) {
    // 50% newest (corridors), 40% random (branching off main path), 10% older (deceptive start traps)
    let index;
    const r = Math.random();
    if (r < 0.50) {
      index = active.length - 1;
    } else if (r < 0.90) {
      index = Math.floor(Math.random() * active.length);
    } else {
      index = Math.floor(Math.random() * Math.max(1, Math.floor(active.length / 2)));
    }

    const [cr, cc] = active[index];
    const dirs = shuffleArray([...directions]);
    let moved = false;

    for (const [dr, dc] of dirs) {
      const nr = cr + dr, nc = cc + dc;
      if (nr > 0 && nr < rows - 1 && nc > 0 && nc < cols - 1 && grid[idx(nr, nc)] === 0) {
        // Carve passage
        grid[idx(cr + dr / 2, cc + dc / 2)] = 1;
        grid[idx(nr, nc)] = 1;
        active.push([nr, nc]);
        moved = true;
        break;
      }
    }

    if (!moved) {
      active.splice(index, 1);
    }

    // Animate every N steps
    step++;
    if (step % 3 === 0) {
      State.grid = grid;
      drawMaze(null);
      await delay();
    }
  }

  // Set start/end cells — computed ONCE here and reused everywhere
  State.grid = grid;
  State.startCell = 1 * cols + 1;
  State.endCell   = getEndCell(rows, cols, grid);

  // Final draw with start/end markers
  const overlay = buildBaseOverlay();
  drawMaze(overlay);

  // Calculate stats
  const openCells = grid.filter(v => v === 1).length;
  const edges = countEdges(grid, rows, cols);

  updateStat('valMazeSize',  `${rows}×${cols}`);
  updateStat('valOpenCells', openCells);
  updateStat('valEdges',     edges);
  updateStat('valPathLen',   '—');
  updateStat('valVisited',   '—');
  updateStat('valSolveTime', '—');

  State.isGenerating = false;
  State.mazeGenerated = true;

  setStatus('ready', 'Maze ready! Click "Solve with BFS"');
  setButtonState('ready');
}

/* Computes the end cell index based on mazeType.
   Validates against the actual grid — searches outward if target is a wall. */
function getEndCell(rows, cols, grid) {
  let targetR, targetC;

  if (State.mazeType === 'corner-center') {
    // Center of the maze — snap to nearest odd-coordinate (valid passage cell)
    targetR = Math.floor(rows / 2);
    targetC = Math.floor(cols / 2);
    if (targetR % 2 === 0) targetR++;
    if (targetC % 2 === 0) targetC++;
  } else {
    // Bottom-right corner
    targetR = rows - 2;
    targetC = cols - 2;
  }

  const flatIdx = (r, c) => r * cols + c;

  // If we have the grid, validate the cell is actually open
  // If it's somehow a wall, search outward in steps of 2 (odd cells only)
  if (grid) {
    if (grid[flatIdx(targetR, targetC)] === 1) {
      return flatIdx(targetR, targetC); // ideal — cell is open
    }
    // Search outward from target in expanding rings
    for (let delta = 2; delta < Math.max(rows, cols); delta += 2) {
      const candidates = [
        [targetR - delta, targetC], [targetR + delta, targetC],
        [targetR, targetC - delta], [targetR, targetC + delta],
        [targetR - delta, targetC - delta], [targetR + delta, targetC + delta],
      ];
      for (const [r, c] of candidates) {
        if (r > 0 && r < rows - 1 && c > 0 && c < cols - 1 && grid[flatIdx(r, c)] === 1) {
          return flatIdx(r, c);
        }
      }
    }
  }

  return flatIdx(targetR, targetC);
}

function buildBaseOverlay() {
  const { rows, cols } = State;
  const overlay = new Array(rows * cols).fill(null);

  overlay[State.startCell] = 'start';
  overlay[State.endCell]   = 'end';

  return overlay;
}

function countEdges(grid, rows, cols) {
  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!grid[r * cols + c]) continue;
      if (c + 1 < cols && grid[r * cols + (c + 1)]) count++;
      if (r + 1 < rows && grid[(r + 1) * cols + c]) count++;
    }
  }
  return count;
}

/* ──────────────────────────────────────────────
   BFS SOLVER (JavaScript Fallback)
   Mirrors the C BFS algorithm exactly
   Used when WASM is not yet compiled
   ────────────────────────────────────────────── */
function jsBFSSolve(grid, rows, cols, start, end) {
  const visited = new Uint8Array(rows * cols);
  const parent  = new Int32Array(rows * cols).fill(-1);
  const queue   = [];

  visited[start] = 1;
  queue.push(start);

  let nodesVisited = 0;
  let found = false;
  const directions = [1, -1, cols, -cols];

  while (queue.length > 0) {
    const curr = queue.shift();
    nodesVisited++;

    if (curr === end) { found = true; break; }

    for (const d of directions) {
      const nbr = curr + d;
      // Bounds check
      if (nbr < 0 || nbr >= rows * cols) continue;
      // Prevent wrapping (left-right)
      const currCol = curr % cols;
      if (d === 1 && currCol === cols - 1) continue;
      if (d === -1 && currCol === 0) continue;

      if (!visited[nbr] && grid[nbr] === 1) {
        visited[nbr] = 1;
        parent[nbr] = curr;
        queue.push(nbr);
      }
    }
  }

  if (!found) return { path: [], nodesVisited };

  // Reconstruct path
  const path = [];
  let curr = end;
  while (curr !== -1) {
    path.unshift(curr);
    curr = parent[curr];
  }

  return { path, nodesVisited };
}

/* ──────────────────────────────────────────────
   WASM SOLVER (C code via Emscripten)
   ────────────────────────────────────────────── */
async function wasmBFSSolve(grid, rows, cols, start, end) {
  const mod = State.wasmModule;
  const n   = rows * cols;

  // Allocate memory in WASM heap for the grid
  const ptr = mod._malloc(n * 4);
  const heapView = new Int32Array(mod.HEAP32.buffer, ptr, n);
  heapView.set(grid);

  // Call the C function
  const pathPtr = mod._solve_maze(ptr, rows, cols, start, end);
  const pathLen = mod._get_path_length();
  const nodesVisited = mod._get_nodes_visited();

  let path = [];
  if (pathPtr && pathLen > 0) {
    const pathView = new Int32Array(mod.HEAP32.buffer, pathPtr, pathLen);
    path = Array.from(pathView);
  }

  mod._free(ptr);
  return { path, nodesVisited };
}

/* ──────────────────────────────────────────────
   SOLVE MAZE — Main orchestrator
   ────────────────────────────────────────────── */
async function solveMaze() {
  if (!State.mazeGenerated || State.isSolving || State.isGenerating) return;

  State.isSolving = true;
  setStatus('solving', 'Running BFS algorithm in C...');
  setButtonState('solving');
  highlightWTStep(1);

  const { rows, cols, grid } = State;
  const start = State.startCell;
  const end   = State.endCell;

  // Safety: if end is a wall for any reason, abort early
  if (!grid || grid[end] !== 1) {
    setStatus('error', 'End cell is unreachable — please regenerate the maze.');
    State.isSolving = false;
    setButtonState('done');
    return;
  }

  const t0 = performance.now();

  let result;
  let solverLabel;

  if (State.wasmReady && State.wasmModule) {
    // Use C/WASM solver
    try {
      result = await wasmBFSSolve(grid, rows, cols, start, end);
      solverLabel = 'C (WebAssembly)';
    } catch (e) {
      console.error('WASM solve failed, falling back to JS:', e);
      result = jsBFSSolve(grid, rows, cols, start, end);
      solverLabel = 'JS (Fallback)';
    }
  } else {
    // Use JS BFS fallback
    result = jsBFSSolve(grid, rows, cols, start, end);
    solverLabel = 'JS Fallback (BFS)';
  }

  const t1 = performance.now();
  const solveTime = (t1 - t0).toFixed(2);

  highlightWTStep(4);

  if (result.path.length === 0) {
    // No solution
    setStatus('error', 'No path found!');
    showResult(false, '✗', 'No Path Found', 'The maze has no solution');
    updateStat('valVisited', result.nodesVisited);
    updateStat('valSolveTime', solveTime + 'ms');
    State.isSolving = false;
    setButtonState('done');
    return;
  }

  // Update stats
  updateStat('valPathLen',   result.path.length);
  updateStat('valVisited',   result.nodesVisited);
  updateStat('valSolveTime', solveTime + 'ms');

  // ── Animate the solution ──
  await animateSolution(result.path, result.nodesVisited, start, end);

  highlightWTStep(5);
  setStatus('done', `Done! Shortest Path: ${result.path.length} steps | Solver: ${solverLabel}`);
  showResult(true, '✓', 'Shortest Path Found!', `${result.path.length} steps (optimal shortest route among multiple paths) · ${result.nodesVisited} nodes explored`);

  State.isSolving = false;
  setButtonState('done');
}

/* ──────────────────────────────────────────────
   ANIMATION ENGINE
   ────────────────────────────────────────────── */
async function animateSolution(path, nodesVisited, start, end) {
  const { rows, cols, grid } = State;
  const overlay = buildBaseOverlay();

  const fastDelay = () => new Promise(r => setTimeout(r, Math.max(1, animPathDelay(State.exploreSpeed) / 2)));
  const pathDelay = () => new Promise(r => setTimeout(r, animPathDelay(State.animSpeed)));

  // ── PHASE 1: BFS exploration — purple visited cells spreading out ──
  highlightWTStep(2);

  // Replay BFS level-by-level to show exploration order
  const visited   = new Uint8Array(rows * cols);
  const bfsQueue  = [start];
  const visitOrder = [];
  const directions = [1, -1, cols, -cols];
  visited[start] = 1;

  while (bfsQueue.length > 0) {
    const curr = bfsQueue.shift();
    visitOrder.push(curr);
    for (const d of directions) {
      const nbr = curr + d;
      if (nbr < 0 || nbr >= rows * cols) continue;
      const currCol = curr % cols;
      if (d === 1  && currCol === cols - 1) continue;
      if (d === -1 && currCol === 0)        continue;
      if (!visited[nbr] && grid[nbr] === 1) {
        visited[nbr] = 1;
        bfsQueue.push(nbr);
      }
    }
  }

  highlightWTStep(3);
  const pathSet = new Set(path);

  // Animate purple visited cells
  for (let i = 0; i < visitOrder.length; i++) {
    const cell = visitOrder[i];
    if (cell === start || cell === end) continue;
    overlay[cell] = 'visited';           // purple for ALL explored
    if (i % 5 === 0) {
      drawMaze(overlay);
      await fastDelay();
    }
  }
  drawMaze(overlay);
  await new Promise(r => setTimeout(r, 250)); // brief pause before path draw

  // ── PHASE 2: Draw shortest path in cyan on top of purple ──
  highlightWTStep(4);
  for (let i = 1; i < path.length - 1; i++) {
    overlay[path[i]] = 'path';           // cyan overwrites purple on path cells
    drawMaze(overlay);
    await pathDelay();
  }

  // Stamp start & end on top
  overlay[start] = 'start';
  overlay[end]   = 'end';
  drawMaze(overlay);

  await pulseEffect(overlay, path, start, end);
}


async function pulseEffect(overlay, path, start, end) {
  // Brief glow animation by redrawing 3 times
  for (let i = 0; i < 2; i++) {
    await new Promise(r => setTimeout(r, 120));
    drawMaze(overlay);
  }
}

/* ──────────────────────────────────────────────
   WASM LOADER
   ────────────────────────────────────────────── */
async function loadWASM() {
  if (typeof MazeSolverModule === 'undefined') {
    DOM.wasmStatus.textContent = 'JS Fallback (compile for C)';
    document.querySelector('.wasm-badge').style.borderColor = 'rgba(255, 157, 0, 0.3)';
    document.querySelector('.wasm-badge').style.color = '#ff9d00';
    document.querySelector('.wasm-dot').style.background = '#ff9d00';
    return;
  }

  try {
    State.wasmModule = await MazeSolverModule();
    State.wasmReady  = true;
    window.WASM_AVAILABLE = true;
    DOM.wasmStatus.textContent = 'C/WASM Ready ✓';
    console.log('✓ WebAssembly (C solver) loaded successfully');
  } catch (e) {
    DOM.wasmStatus.textContent = 'JS Fallback Active';
    console.warn('WASM load failed, using JS BFS fallback:', e);
  }
}

/* ──────────────────────────────────────────────
   UI HELPERS
   ────────────────────────────────────────────── */
function setStatus(type, text) {
  DOM.statusDot.className = `status-dot ${type}`;
  DOM.statusText.textContent = text;
}

function setButtonState(state) {
  switch (state) {
    case 'generating':
      DOM.btnGenerate.disabled = true;
      DOM.btnGenerate.classList.add('loading');
      DOM.btnSolve.disabled = true;
      DOM.btnSolve.classList.remove('ready');
      break;
    case 'ready':
      DOM.btnGenerate.disabled = false;
      DOM.btnGenerate.classList.remove('loading');
      DOM.btnSolve.disabled = false;
      DOM.btnSolve.classList.add('ready');
      break;
    case 'solving':
      DOM.btnGenerate.disabled = true;
      DOM.btnSolve.disabled = true;
      DOM.btnSolve.classList.remove('ready');
      DOM.btnSolve.classList.add('loading');
      break;
    case 'done':
      DOM.btnGenerate.disabled = false;
      DOM.btnSolve.disabled = false;
      DOM.btnSolve.classList.remove('loading', 'ready');
      break;
  }
}

function showResult(success, icon, title, sub) {
  DOM.resultBox.style.display = 'block';
  DOM.resultBox.className = `result-box ${success ? 'success' : 'failure'}`;
  DOM.resultIcon.textContent  = icon;
  DOM.resultTitle.textContent = title;
  DOM.resultSub.textContent   = sub;
}

function updateStat(id, value) {
  const el = document.getElementById(id);
  el.textContent = value;
  el.classList.remove('pop');
  void el.offsetWidth; // reflow
  el.classList.add('pop');
}

function highlightWTStep(n) {
  DOM.wtSteps.forEach((s, i) => {
    s.classList.toggle('active', i + 1 === n);
  });
}

/* ──────────────────────────────────────────────
   UTILITY FUNCTIONS
   ────────────────────────────────────────────── */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function speedToDelay(speed) {
  // Speed 1-5 → delay in ms (inverted: higher speed = lower delay)
  const map = { 1: 80, 2: 30, 3: 10, 4: 3, 5: 0 };
  return map[speed] ?? 10;
}

function animPathDelay(speed) {
  const map = { 1: 120, 2: 60, 3: 25, 4: 8, 5: 2 };
  return map[speed] ?? 25;
}

/* ──────────────────────────────────────────────
   BACKGROUND PARTICLES
   ────────────────────────────────────────────── */
function createParticles() {
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 4 + 1;
    const colors = ['#00d4ff', '#7c3aed', '#00ff9d', '#ff4d6d'];
    p.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      left: ${Math.random() * 100}%;
      top: ${Math.random() * 100}%;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      animation-duration: ${Math.random() * 15 + 10}s;
      animation-delay: ${Math.random() * 10}s;
    `;
    DOM.bgParticles.appendChild(p);
  }
}

/* ──────────────────────────────────────────────
   RESET
   ────────────────────────────────────────────── */
function resetAll() {
  if (State.isGenerating || State.isSolving) return;
  State.grid = null;
  State.mazeGenerated = false;
  DOM.canvas.style.display = 'none';
  DOM.placeholder.style.display = 'block';
  DOM.resultBox.style.display = 'none';
  DOM.btnSolve.disabled = true;
  DOM.btnSolve.classList.remove('ready');
  setStatus('idle', 'Click "Generate Maze" to begin');
  ['valMazeSize','valOpenCells','valPathLen','valVisited','valEdges','valSolveTime'].forEach(id => {
    document.getElementById(id).textContent = '—';
  });
  DOM.wtSteps.forEach(s => s.classList.remove('active'));
}

/* ──────────────────────────────────────────────
   EVENT LISTENERS
   ────────────────────────────────────────────── */
DOM.btnGenerate.addEventListener('click', generateMaze);
DOM.btnSolve.addEventListener('click',    solveMaze);
DOM.btnReset.addEventListener('click',    resetAll);

DOM.sizeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (State.isGenerating || State.isSolving) return;
    DOM.sizeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const size = parseInt(btn.dataset.size);
    State.rows = size;
    State.cols = size;
    resetAll();
  });
});

// Mode buttons — Corner→Corner vs Corner→Center
const modeButtons = document.querySelectorAll('[data-mode]');
modeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (State.isGenerating || State.isSolving) return;
    modeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    State.mazeType = btn.dataset.mode;
    // If a maze is already generated, recompute endCell and redraw with new end position
    if (State.mazeGenerated && State.grid) {
      State.endCell = getEndCell(State.rows, State.cols, State.grid);
      const overlay = buildBaseOverlay();
      drawMaze(overlay);
    }
    const label = State.mazeType === 'corner-center'
      ? 'Corner → Center: End is at the maze center! Click Solve.'
      : 'Corner → Corner: Classic mode. Click Solve.';
    setStatus('idle', label);
  });
});

DOM.speedSlider.addEventListener('input', e => {
  State.animSpeed = parseInt(e.target.value);
  DOM.pathSpeedVal.textContent = e.target.value;
});

DOM.exploreSlider.addEventListener('input', e => {
  State.exploreSpeed = parseInt(e.target.value);
  DOM.exploreSpeedVal.textContent = e.target.value;
});

window.addEventListener('resize', () => {
  if (State.mazeGenerated && State.grid) {
    setupCanvas();
    const overlay = buildBaseOverlay();
    drawMaze(overlay);
  }
});

/* ──────────────────────────────────────────────
   INIT
   ────────────────────────────────────────────── */
(async function init() {
  createParticles();
  await loadWASM();
  console.log('🧩 Maze Solver initialized. Graph + BFS algorithm ready.');
})();

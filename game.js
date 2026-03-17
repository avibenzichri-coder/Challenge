'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const BOARD_ROWS = 20;
const BOARD_COLS = 10;
const CELL_SIZE  = 30;

const COLORS = [
  null,
  '#00f5ff', // 1 I - cyan
  '#ffe600', // 2 O - yellow
  '#bf00ff', // 3 T - purple
  '#00e400', // 4 S - green
  '#ff2400', // 5 Z - red
  '#0040ff', // 6 J - blue
  '#ff8c00', // 7 L - orange
];

// Each piece: array of rotation states, each state = four [dr, dc] offsets
const PIECES = {
  I: {
    color: 1,
    rotations: [
      [[0,0],[0,1],[0,2],[0,3]],
      [[0,0],[1,0],[2,0],[3,0]],
      [[0,0],[0,1],[0,2],[0,3]],
      [[0,0],[1,0],[2,0],[3,0]],
    ],
  },
  O: {
    color: 2,
    rotations: [
      [[0,0],[0,1],[1,0],[1,1]],
    ],
  },
  T: {
    color: 3,
    rotations: [
      [[0,1],[1,0],[1,1],[1,2]],
      [[0,0],[1,0],[1,1],[2,0]],
      [[1,0],[1,1],[1,2],[2,1]],
      [[0,1],[1,0],[1,1],[2,1]],
    ],
  },
  S: {
    color: 4,
    rotations: [
      [[0,1],[0,2],[1,0],[1,1]],
      [[0,0],[1,0],[1,1],[2,1]],
      [[0,1],[0,2],[1,0],[1,1]],
      [[0,0],[1,0],[1,1],[2,1]],
    ],
  },
  Z: {
    color: 5,
    rotations: [
      [[0,0],[0,1],[1,1],[1,2]],
      [[0,1],[1,0],[1,1],[2,0]],
      [[0,0],[0,1],[1,1],[1,2]],
      [[0,1],[1,0],[1,1],[2,0]],
    ],
  },
  J: {
    color: 6,
    rotations: [
      [[0,0],[1,0],[1,1],[1,2]],
      [[0,0],[0,1],[1,0],[2,0]],
      [[1,0],[1,1],[1,2],[2,2]],
      [[0,1],[1,1],[2,0],[2,1]],
    ],
  },
  L: {
    color: 7,
    rotations: [
      [[0,2],[1,0],[1,1],[1,2]],
      [[0,0],[1,0],[2,0],[2,1]],
      [[1,0],[1,1],[1,2],[2,0]],
      [[0,0],[0,1],[1,1],[2,1]],
    ],
  },
};

const PIECE_TYPES = Object.keys(PIECES);
const SCORE_TABLE = [0, 40, 100, 300, 1200];

// ─── Canvas setup ─────────────────────────────────────────────────────────────

const canvas     = document.getElementById('canvas');
const ctx        = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx    = nextCanvas.getContext('2d');

canvas.width  = BOARD_COLS * CELL_SIZE;
canvas.height = BOARD_ROWS * CELL_SIZE;
nextCanvas.width  = 4 * CELL_SIZE;
nextCanvas.height = 4 * CELL_SIZE;

// ─── Game State ───────────────────────────────────────────────────────────────

let board, currentPiece, nextPieceType;
let score, level, lines;
let gameOver, paused;
let dropInterval, lastDropTime;
let animFrameId;
let audioCtx;

// ─── Sound ────────────────────────────────────────────────────────────────────

function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playSound(type) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  switch (type) {
    case 'rotate':
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.start(now); osc.stop(now + 0.06);
      break;
    case 'lock':
      osc.type = 'square';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now); osc.stop(now + 0.12);
      break;
    case 'clear':
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523, now);
      osc.frequency.exponentialRampToValueAtTime(784, now + 0.15);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now); osc.stop(now + 0.2);
      break;
    case 'tetris': {
      // Short fanfare: play 3 notes in sequence
      const notes = [523, 659, 784, 1047];
      notes.forEach((freq, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.connect(g); g.connect(audioCtx.destination);
        o.type = 'sine';
        const t = now + i * 0.1;
        o.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        o.start(t); o.stop(t + 0.12);
      });
      return;
    }
    case 'gameover':
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(330, now);
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.8);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
      osc.start(now); osc.stop(now + 0.8);
      break;
    default:
      return;
  }
}

// ─── Board ────────────────────────────────────────────────────────────────────

function createBoard() {
  return Array.from({ length: BOARD_ROWS }, () => new Array(BOARD_COLS).fill(0));
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function getShape(type, rotation) {
  const rots = PIECES[type].rotations;
  return rots[rotation % rots.length];
}

function randomType() {
  return PIECE_TYPES[Math.floor(Math.random() * PIECE_TYPES.length)];
}

// ─── Collision ────────────────────────────────────────────────────────────────

function isValidPosition(type, rotation, row, col) {
  for (const [dr, dc] of getShape(type, rotation)) {
    const r = row + dr;
    const c = col + dc;
    if (r >= BOARD_ROWS) return false;
    if (c < 0 || c >= BOARD_COLS) return false;
    if (r >= 0 && board[r][c] !== 0) return false;
  }
  return true;
}

// ─── Spawn ────────────────────────────────────────────────────────────────────

function spawnPiece() {
  currentPiece = {
    type:     nextPieceType,
    rotation: 0,
    row:      0,
    col:      3,
  };
  nextPieceType = randomType();

  if (!isValidPosition(currentPiece.type, currentPiece.rotation, currentPiece.row, currentPiece.col)) {
    gameOver = true;
    playSound('gameover');
  }
}

// ─── Lock ─────────────────────────────────────────────────────────────────────

function lockPiece() {
  const colorIdx = PIECES[currentPiece.type].color;
  for (const [dr, dc] of getShape(currentPiece.type, currentPiece.rotation)) {
    const r = currentPiece.row + dr;
    const c = currentPiece.col + dc;
    if (r >= 0) board[r][c] = colorIdx;
  }
  playSound('lock');
  clearLines();
  spawnPiece();
}

// ─── Line Clearing ────────────────────────────────────────────────────────────

function clearLines() {
  const newBoard = [];
  let cleared = 0;

  for (let r = 0; r < BOARD_ROWS; r++) {
    if (board[r].every(cell => cell !== 0)) {
      cleared++;
    } else {
      newBoard.push(board[r]);
    }
  }

  while (newBoard.length < BOARD_ROWS) {
    newBoard.unshift(new Array(BOARD_COLS).fill(0));
  }
  board = newBoard;

  if (cleared > 0) {
    score += SCORE_TABLE[cleared] * level;
    lines += cleared;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 800 - (level - 1) * 70);
    playSound(cleared === 4 ? 'tetris' : 'clear');
    updateUI();
  }
}

function updateUI() {
  document.getElementById('score').textContent = score;
  document.getElementById('level').textContent = level;
  document.getElementById('lines').textContent = lines;
}

// ─── Movement ─────────────────────────────────────────────────────────────────

function tryMove(dr, dc) {
  const { type, rotation, row, col } = currentPiece;
  if (isValidPosition(type, rotation, row + dr, col + dc)) {
    currentPiece.row += dr;
    currentPiece.col += dc;
    return true;
  }
  return false;
}

function tryRotate() {
  const { type, rotation, row, col } = currentPiece;
  const newRot = (rotation + 1) % PIECES[type].rotations.length;
  for (const offset of [0, -1, 1, -2, 2]) {
    if (isValidPosition(type, newRot, row, col + offset)) {
      currentPiece.rotation = newRot;
      currentPiece.col += offset;
      playSound('rotate');
      return;
    }
  }
}

function softDrop() {
  if (tryMove(1, 0)) {
    score += 1;
    document.getElementById('score').textContent = score;
  } else {
    lockPiece();
  }
}

function getGhostRow() {
  let ghostRow = currentPiece.row;
  while (isValidPosition(currentPiece.type, currentPiece.rotation, ghostRow + 1, currentPiece.col)) {
    ghostRow++;
  }
  return ghostRow;
}

function hardDrop() {
  const ghost = getGhostRow();
  score += (ghost - currentPiece.row) * 2;
  currentPiece.row = ghost;
  document.getElementById('score').textContent = score;
  lockPiece();
}

function togglePause() {
  paused = !paused;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function drawCell(context, r, c, colorIdx, alpha = 1) {
  const x = c * CELL_SIZE;
  const y = r * CELL_SIZE;
  const color = COLORS[colorIdx];
  const size = CELL_SIZE;

  context.globalAlpha = alpha;

  // Main fill
  context.fillStyle = color;
  context.fillRect(x + 1, y + 1, size - 2, size - 2);

  // Light edge (top + left)
  context.fillStyle = 'rgba(255,255,255,0.35)';
  context.fillRect(x + 1, y + 1, size - 2, 3);
  context.fillRect(x + 1, y + 1, 3, size - 2);

  // Dark edge (bottom + right)
  context.fillStyle = 'rgba(0,0,0,0.35)';
  context.fillRect(x + 1, y + size - 4, size - 2, 3);
  context.fillRect(x + size - 4, y + 1, 3, size - 2);

  context.globalAlpha = 1;
}

function drawBoard() {
  // Background
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle grid
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let r = 0; r <= BOARD_ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * CELL_SIZE);
    ctx.lineTo(canvas.width, r * CELL_SIZE);
    ctx.stroke();
  }
  for (let c = 0; c <= BOARD_COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * CELL_SIZE, 0);
    ctx.lineTo(c * CELL_SIZE, canvas.height);
    ctx.stroke();
  }

  // Locked cells
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      if (board[r][c] !== 0) drawCell(ctx, r, c, board[r][c]);
    }
  }
}

function drawCurrentPiece() {
  if (!currentPiece) return;

  // Ghost piece
  const ghostRow = getGhostRow();
  if (ghostRow !== currentPiece.row) {
    for (const [dr, dc] of getShape(currentPiece.type, currentPiece.rotation)) {
      const r = ghostRow + dr;
      const c = currentPiece.col + dc;
      if (r >= 0) drawCell(ctx, r, c, PIECES[currentPiece.type].color, 0.2);
    }
  }

  // Active piece
  for (const [dr, dc] of getShape(currentPiece.type, currentPiece.rotation)) {
    const r = currentPiece.row + dr;
    const c = currentPiece.col + dc;
    if (r >= 0) drawCell(ctx, r, c, PIECES[currentPiece.type].color);
  }
}

function drawNextPiece() {
  nextCtx.fillStyle = '#0a0a14';
  nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);

  if (!nextPieceType) return;
  const shape = getShape(nextPieceType, 0);
  const colorIdx = PIECES[nextPieceType].color;

  // Center the piece in the 4×4 preview
  const minR = Math.min(...shape.map(([r]) => r));
  const maxR = Math.max(...shape.map(([r]) => r));
  const minC = Math.min(...shape.map(([, c]) => c));
  const maxC = Math.max(...shape.map(([, c]) => c));
  const offsetR = Math.floor((4 - (maxR - minR + 1)) / 2) - minR;
  const offsetC = Math.floor((4 - (maxC - minC + 1)) / 2) - minC;

  for (const [dr, dc] of shape) {
    drawCell(nextCtx, dr + offsetR, dc + offsetC, colorIdx);
  }
}

function drawOverlay(text, subText = '') {
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 32px Courier New';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 - 20);

  if (subText) {
    ctx.fillStyle = '#a0a0c0';
    ctx.font = '14px Courier New';
    ctx.fillText(subText, canvas.width / 2, canvas.height / 2 + 16);
  }
}

function render() {
  drawBoard();
  drawCurrentPiece();
  drawNextPiece();

  if (paused) drawOverlay('PAUSED', 'Press P to continue');
  if (gameOver) drawOverlay('GAME OVER', 'Press Enter to restart');
}

// ─── Game Loop ────────────────────────────────────────────────────────────────

function gameLoop(timestamp) {
  if (!gameOver) {
    if (!paused) {
      const elapsed = Math.min(timestamp - lastDropTime, dropInterval);
      if (elapsed >= dropInterval) {
        if (!tryMove(1, 0)) lockPiece();
        lastDropTime = timestamp;
      }
    } else {
      lastDropTime = timestamp; // reset timer while paused to avoid burst drop
    }
    animFrameId = requestAnimationFrame(gameLoop);
  }
  render();
}

// ─── Input ────────────────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  initAudio(); // Resume AudioContext on first interaction

  if (e.key === 'p' || e.key === 'P' || e.key === 'פ') {
    if (!gameOver) togglePause();
    e.preventDefault();
    return;
  }

  if (e.key === 'Enter' && gameOver) {
    startGame();
    e.preventDefault();
    return;
  }

  if (paused || gameOver) return;

  switch (e.key) {
    case 'ArrowLeft':  tryMove(0, -1); break;
    case 'ArrowRight': tryMove(0,  1); break;
    case 'ArrowDown':  softDrop();     break;
    case 'ArrowUp':    tryRotate();    break;
    case ' ':          hardDrop();     break;
    default: return;
  }
  e.preventDefault();
});

// ─── Mouse Controls ───────────────────────────────────────────────────────────

let mouseStartX = null;
let mouseStartCol = null;
let mouseDragged = false;
let clickTimer = null;

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return; // left button only
  initAudio();
  mouseStartX   = e.clientX;
  mouseStartCol = currentPiece ? currentPiece.col : null;
  mouseDragged  = false;
  e.preventDefault();
});

canvas.addEventListener('mousemove', e => {
  if (mouseStartX === null || paused || gameOver || !currentPiece) return;
  const dx = e.clientX - mouseStartX;
  if (Math.abs(dx) >= 5) mouseDragged = true;
  const targetCol = mouseStartCol + Math.round(dx / CELL_SIZE);
  const diff = targetCol - currentPiece.col;
  if (diff !== 0) {
    const step = diff > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(diff); i++) {
      if (!tryMove(0, step)) break;
    }
  }
});

canvas.addEventListener('mouseup', e => {
  if (e.button !== 0) return;
  if (!mouseDragged && !gameOver) {
    clickTimer = setTimeout(() => {
      togglePause();
      clickTimer = null;
    }, 250);
  }
  mouseStartX   = null;
  mouseStartCol = null;
  e.preventDefault();
});

canvas.addEventListener('mouseleave', () => {
  mouseStartX   = null;
  mouseStartCol = null;
});

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  initAudio();
  if (!paused && !gameOver) tryRotate();
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  initAudio();
  if (!paused && !gameOver && e.deltaY > 0) softDrop();
}, { passive: false });

canvas.addEventListener('dblclick', e => {
  e.preventDefault();
  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
  initAudio();
  if (!paused && !gameOver) hardDrop();
});

// ─── Start ────────────────────────────────────────────────────────────────────

function startGame() {
  if (animFrameId) cancelAnimationFrame(animFrameId);

  board        = createBoard();
  score        = 0;
  level        = 1;
  lines        = 0;
  gameOver     = false;
  paused       = false;
  dropInterval = 800;
  lastDropTime = 0;

  nextPieceType = randomType();
  spawnPiece();
  updateUI();

  animFrameId = requestAnimationFrame(gameLoop);
}

startGame();

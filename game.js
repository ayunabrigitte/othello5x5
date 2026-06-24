/**
 * OCEAN OTHELLO 5×5 — game.js
 * 電資一甲 412043 林元薇
 *
 * 5×5 board variant with:
 *  - Human vs Human / Human vs AI modes
 *  - AI difficulty: Easy (random), Medium (greedy+corner), Hard (minimax α-β)
 *  - Valid move hints (toggle)
 *  - Move log
 *  - Animated disc flip & placement
 *  - Win/draw detection with modal
 *  - Undo (PvP only)
 *  - Pass-turn logic
 *
 * 5×5 Starting layout (B=Black, W=White, .=empty):
 *   . . . . .
 *   . W B . .
 *   . B W . .
 *   . . . . .
 *   . . . . .
 */

'use strict';

/* ─────────────────── CONSTANTS ─────────────────── */
const EMPTY = 0, BLACK = 1, WHITE = 2;
const SIZE  = 5;
const DIRS  = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const COLS  = 'ABCDE';

/**
 * Position weight table for 5×5.
 * Corners are extremely valuable, adjacent-to-corner edges are negative,
 * everything else is graded accordingly.
 */
const POS_WEIGHTS = [
  [120, -20,  10,  -20, 120],
  [-20, -40,  -5,  -40, -20],
  [ 10,  -5,   5,   -5,  10],
  [-20, -40,  -5,  -40, -20],
  [120, -20,  10,  -20, 120]
];

/* ─────────────────── STATE ─────────────────── */
let board         = [];
let currentPlayer = BLACK;
let mode          = 'pvp';    // 'pvp' | 'ai'
let aiPlayer      = WHITE;
let aiDepth       = 4;        // minimax search depth
let showHints     = true;
let moveLog       = [];
let history       = [];       // for undo
let gameOver      = false;
let aiThinking    = false;

/* ─────────────────── DOM REFS ─────────────────── */
const boardEl       = document.getElementById('board');
const blackScoreEl  = document.getElementById('score-black');
const whiteScoreEl  = document.getElementById('score-white');
const statusEl      = document.getElementById('status-msg');
const logEntriesEl  = document.getElementById('log-entries');
const modal         = document.getElementById('win-modal');
const modalTitle    = document.getElementById('modal-title');
const modalSubtitle = document.getElementById('modal-subtitle');
const modalBlack    = document.getElementById('modal-black');
const modalWhite    = document.getElementById('modal-white');
const blackCard     = document.getElementById('card-black');
const whiteCard     = document.getElementById('card-white');
const hintToggle    = document.getElementById('hint-toggle');
const diffSelect    = document.getElementById('diff-select');
const diffRow       = document.getElementById('diff-row');
const undoBtn       = document.getElementById('btn-undo');

/* ─────────────────── INIT ─────────────────── */
function initBoard() {
  board = Array.from({ length: SIZE }, () => new Array(SIZE).fill(EMPTY));

  /* Standard 5×5 starting position — centre 2×2 */
  board[1][1] = WHITE; board[1][2] = BLACK;
  board[2][1] = BLACK; board[2][2] = WHITE;

  currentPlayer = BLACK;
  moveLog       = [];
  history       = [];
  gameOver      = false;
  aiThinking    = false;

  renderBoard();
  renderScores();
  updateStatus();
  renderLog();
  modal.classList.remove('show');
}

/* ─────────────────── RENDER BOARD ─────────────────── */
function renderBoard() {
  boardEl.innerHTML = '';
  const valids   = validMoves(board, currentPlayer);
  const validSet = new Set(valids.map(([r, c]) => `${r},${c}`));

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell      = document.createElement('div');
      cell.className  = 'cell';
      cell.dataset.r  = r;
      cell.dataset.c  = c;

      if (board[r][c] !== EMPTY) {
        cell.classList.add('no-hover');
        const disc      = document.createElement('div');
        disc.className  = `disc ${board[r][c] === BLACK ? 'black' : 'white'}`;
        cell.appendChild(disc);
      } else if (showHints && validSet.has(`${r},${c}`) && !gameOver) {
        cell.classList.add('valid-hint');
      }

      if (!gameOver && !aiThinking) {
        cell.addEventListener('click', () => handleClick(r, c));
      }
      boardEl.appendChild(cell);
    }
  }
}

/* ─────────────────── SCORES ─────────────────── */
function countPieces(b) {
  let black = 0, white = 0;
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      if (b[r][c] === BLACK) black++;
      if (b[r][c] === WHITE) white++;
    }
  return { black, white };
}

function renderScores() {
  const { black, white } = countPieces(board);
  blackScoreEl.textContent = black;
  whiteScoreEl.textContent = white;
  blackCard.classList.toggle('active-turn', currentPlayer === BLACK && !gameOver);
  whiteCard.classList.toggle('active-turn', currentPlayer === WHITE && !gameOver);
}

/* ─────────────────── STATUS ─────────────────── */
function updateStatus(msg) {
  if (msg) { statusEl.textContent = msg; return; }
  if (gameOver) return;
  const who = currentPlayer === BLACK ? '⚫ 黑棋' : '⚪ 白棋';
  if (mode === 'ai' && currentPlayer === aiPlayer) {
    statusEl.textContent = `🐬 AI 思考中 (${who})...`;
  } else {
    statusEl.textContent = `${who} 的回合 — 請落子`;
  }
}

/* ─────────────────── MOVE LOG ─────────────────── */
function renderLog() {
  logEntriesEl.innerHTML = '';
  moveLog.forEach(entry => {
    const el      = document.createElement('div');
    el.className  = `log-entry ${entry.player === BLACK ? 'black-log' : 'white-log'}`;
    el.textContent = entry.text;
    logEntriesEl.appendChild(el);
  });
  logEntriesEl.scrollLeft = logEntriesEl.scrollWidth;
}

/* ─────────────────── GAME LOGIC ─────────────────── */

/** Returns list of [r,c] squares that would be flipped by placing `player` at (r,c). */
function flipsFrom(b, r, c, player) {
  if (b[r][c] !== EMPTY) return [];
  const opp     = player === BLACK ? WHITE : BLACK;
  const flipped = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let nr = r + dr, nc = c + dc;
    while (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && b[nr][nc] === opp) {
      line.push([nr, nc]);
      nr += dr; nc += dc;
    }
    if (line.length && nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE && b[nr][nc] === player) {
      flipped.push(...line);
    }
  }
  return flipped;
}

/** Returns all valid moves for `player` on board `b`. */
function validMoves(b, player) {
  const moves = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (flipsFrom(b, r, c, player).length) moves.push([r, c]);
  return moves;
}

/** Returns a NEW board after placing `player` at (r,c), plus the list of flipped squares. */
function applyMove(b, r, c, player) {
  const nb    = b.map(row => [...row]);
  const flips = flipsFrom(nb, r, c, player);
  nb[r][c]    = player;
  flips.forEach(([fr, fc]) => { nb[fr][fc] = player; });
  return { board: nb, flips };
}

/* ─────────────────── CLICK HANDLER ─────────────────── */
function handleClick(r, c) {
  if (gameOver || aiThinking) return;
  if (mode === 'ai' && currentPlayer === aiPlayer) return;
  if (board[r][c] !== EMPTY) return;

  const flips = flipsFrom(board, r, c, currentPlayer);
  if (!flips.length) return;

  saveHistory();
  placeDisc(r, c, currentPlayer, flips, true);
}

/* ─────────────────── PLACE DISC ─────────────────── */
function placeDisc(r, c, player, flips, animate) {
  const { board: nb } = applyMove(board, r, c, player);
  board = nb;

  /* Render placed disc */
  const cellEl   = boardEl.children[r * SIZE + c];
  const disc     = document.createElement('div');
  disc.className = `disc ${player === BLACK ? 'black' : 'white'} placed`;
  cellEl.appendChild(disc);
  cellEl.classList.remove('valid-hint');

  /* Staggered flip animation */
  if (animate) {
    flips.forEach(([fr, fc], i) => {
      const flipCell = boardEl.children[fr * SIZE + fc];
      const flipDisc = flipCell.querySelector('.disc');
      if (flipDisc) {
        setTimeout(() => {
          flipDisc.classList.add('flipping');
          setTimeout(() => {
            flipDisc.className = `disc ${player === BLACK ? 'black' : 'white'}`;
          }, 225);
        }, i * 60);
      }
    });
  }

  /* Log entry */
  const colLabel    = COLS[c];
  const rowLabel    = SIZE - r;
  const playerLabel = player === BLACK ? '⚫' : '⚪';
  moveLog.push({ player, text: `${playerLabel} ${colLabel}${rowLabel} (+${flips.length})` });

  const totalFlipTime = flips.length * 60 + 300;
  setTimeout(() => {
    advanceTurn();
    renderScores();
    renderLog();
  }, animate ? totalFlipTime : 0);
}

/* ─────────────────── TURN MANAGEMENT ─────────────────── */
function advanceTurn() {
  const opp      = currentPlayer === BLACK ? WHITE : BLACK;
  const oppMoves = validMoves(board, opp);
  const myMoves  = validMoves(board, currentPlayer);

  if (oppMoves.length) {
    /* Normal: hand off to opponent */
    currentPlayer = opp;
    renderBoard();
    updateStatus();
    renderScores();
    if (mode === 'ai' && currentPlayer === aiPlayer && !gameOver) {
      scheduleAI();
    }
  } else if (myMoves.length) {
    /* Opponent has no moves → pass */
    const passedName = opp === BLACK ? '⚫ 黑棋' : '⚪ 白棋';
    updateStatus(`${passedName} 無子可走，自動跳過！`);
    renderBoard();
    renderScores();
    setTimeout(() => {
      if (!gameOver) {
        updateStatus();
        renderBoard();
        if (mode === 'ai' && currentPlayer === aiPlayer) scheduleAI();
      }
    }, 1300);
  } else {
    /* Neither side can move → game over */
    endGame();
  }
}

/* ─────────────────── END GAME ─────────────────── */
function endGame() {
  gameOver = true;
  const { black, white } = countPieces(board);
  renderBoard();
  renderScores();

  let title, subtitle;
  if (black > white) {
    title    = '⚫ 黑棋勝利！';
    subtitle = `黑棋以 ${black} 比 ${white} 獲勝`;
  } else if (white > black) {
    title    = '⚪ 白棋勝利！';
    subtitle = `白棋以 ${white} 比 ${black} 獲勝`;
  } else {
    title    = '🤝 平局！';
    subtitle = `雙方均為 ${black} 枚`;
  }

  statusEl.textContent = title;
  statusEl.classList.add('game-over');

  modalTitle.textContent    = title;
  modalSubtitle.textContent = subtitle;
  modalBlack.textContent    = black;
  modalWhite.textContent    = white;

  setTimeout(() => modal.classList.add('show'), 600);
}

/* ─────────────────── AI ─────────────────── */
function scheduleAI() {
  aiThinking = true;
  updateStatus();
  setTimeout(runAI, 480);
}

function runAI() {
  if (gameOver) { aiThinking = false; return; }

  const moves = validMoves(board, aiPlayer);
  if (!moves.length) { aiThinking = false; advanceTurn(); return; }

  let chosen;

  if (aiDepth === 1) {
    /* Easy: pure random */
    chosen = moves[Math.floor(Math.random() * moves.length)];

  } else if (aiDepth === 2) {
    /* Medium: greedy — maximise flips weighted by position */
    let best = -Infinity;
    moves.forEach(([r, c]) => {
      const flips = flipsFrom(board, r, c, aiPlayer);
      const score = flips.length + POS_WEIGHTS[r][c] * 0.4;
      if (score > best) { best = score; chosen = [r, c]; }
    });

  } else {
    /* Hard: minimax with α-β pruning */
    const result = minimax(board, aiDepth, -Infinity, Infinity, true, aiPlayer);
    chosen = result.move;
  }

  if (!chosen) { aiThinking = false; return; }

  const [r, c] = chosen;
  const flips  = flipsFrom(board, r, c, aiPlayer);
  saveHistory();
  aiThinking = false;
  placeDisc(r, c, aiPlayer, flips, true);
}

/* ─────────────────── MINIMAX ─────────────────── */
function minimax(b, depth, alpha, beta, maximizing, player) {
  const opp   = player === BLACK ? WHITE : BLACK;
  const moves = validMoves(b, player);

  if (depth === 0 || moves.length === 0) {
    return { score: evaluate(b, aiPlayer), move: null };
  }

  let bestMove = null;

  if (maximizing) {
    let best = -Infinity;
    for (const [r, c] of moves) {
      const { board: nb } = applyMove(b, r, c, player);
      const { score }     = minimax(nb, depth - 1, alpha, beta, false, opp);
      if (score > best) { best = score; bestMove = [r, c]; }
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return { score: best, move: bestMove };
  } else {
    let best = Infinity;
    for (const [r, c] of moves) {
      const { board: nb } = applyMove(b, r, c, player);
      const { score }     = minimax(nb, depth - 1, alpha, beta, true, opp);
      if (score < best) { best = score; bestMove = [r, c]; }
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return { score: best, move: bestMove };
  }
}

/**
 * Heuristic evaluation for 5×5:
 *  - Positional weight sum
 *  - Mobility (number of available moves)
 *  - Piece count (more important in late game)
 */
function evaluate(b, player) {
  const opp        = player === BLACK ? WHITE : BLACK;
  const { black, white } = countPieces(b);
  const total      = black + white;
  const maxSquares = SIZE * SIZE;  // 25

  let posScore = 0, mobScore = 0, pieceScore = 0;

  /* Positional weight */
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      if (b[r][c] === player) posScore += POS_WEIGHTS[r][c];
      if (b[r][c] === opp)    posScore -= POS_WEIGHTS[r][c];
    }

  /* Mobility */
  const playerMoves = validMoves(b, player).length;
  const oppMoves    = validMoves(b, opp).length;
  if (playerMoves + oppMoves > 0) {
    mobScore = 10 * (playerMoves - oppMoves) / (playerMoves + oppMoves);
  }

  /* Piece count — weighted heavily only in endgame */
  const endgameWeight = total / maxSquares;  // 0..1
  const pCount        = player === BLACK ? black : white;
  const oCount        = player === BLACK ? white : black;
  if (pCount + oCount > 0) {
    pieceScore = 25 * endgameWeight * (pCount - oCount) / (pCount + oCount);
  }

  return posScore + mobScore * 8 + pieceScore;
}

/* ─────────────────── UNDO ─────────────────── */
function saveHistory() {
  history.push({
    board:         board.map(row => [...row]),
    currentPlayer: currentPlayer,
    moveLog:       [...moveLog]
  });
  if (history.length > 30) history.shift();
}

function undoMove() {
  if (mode !== 'pvp' || !history.length || gameOver || aiThinking) return;
  const prev    = history.pop();
  board         = prev.board;
  currentPlayer = prev.currentPlayer;
  moveLog       = prev.moveLog;
  gameOver      = false;
  statusEl.classList.remove('game-over');
  renderBoard();
  renderScores();
  updateStatus();
  renderLog();
}

/* ─────────────────── BUTTON WIRING ─────────────────── */
document.getElementById('btn-new').addEventListener('click', () => {
  statusEl.classList.remove('game-over');
  initBoard();
});

document.getElementById('btn-undo').addEventListener('click', undoMove);

document.getElementById('btn-close-modal').addEventListener('click', () => {
  modal.classList.remove('show');
});

document.getElementById('btn-new-from-modal').addEventListener('click', () => {
  modal.classList.remove('show');
  statusEl.classList.remove('game-over');
  initBoard();
});

/* Mode buttons */
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    mode               = btn.dataset.mode;
    diffRow.style.display = mode === 'ai' ? 'flex' : 'none';
    undoBtn.style.display = mode === 'pvp' ? '' : 'none';
    initBoard();
  });
});

/* Difficulty select */
diffSelect.addEventListener('change', () => {
  const val = diffSelect.value;
  if (val === 'easy')   aiDepth = 1;
  if (val === 'medium') aiDepth = 4;
  if (val === 'hard')   aiDepth = 7;
  initBoard();
});

/* Hint toggle */
hintToggle.addEventListener('click', () => {
  showHints = !showHints;
  hintToggle.classList.toggle('on', showHints);
  renderBoard();
});

/* Click outside modal to close */
modal.addEventListener('click', e => {
  if (e.target === modal) modal.classList.remove('show');
});

/* ─────────────────── BUBBLES ─────────────────── */
function spawnBubbles() {
  const container = document.querySelector('.bubbles-container');
  for (let i = 0; i < 18; i++) {
    const b      = document.createElement('div');
    b.className  = 'bubble';
    const size   = 4 + Math.random() * 14;
    b.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      left: ${Math.random() * 100}%;
      bottom: ${Math.random() * 30}%;
      animation-duration: ${8 + Math.random() * 14}s;
      animation-delay: ${-Math.random() * 14}s;
    `;
    container.appendChild(b);
  }
}

/* ─────────────────── KICK OFF ─────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  spawnBubbles();
  initBoard();
});

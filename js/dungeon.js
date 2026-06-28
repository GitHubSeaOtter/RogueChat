// NetHack 参考の複数レベル生成：部屋＋通路 / 迷路 / 洞窟 / 大部屋。罠も配置。

export const TILE = {
  WALL: '#',
  FLOOR: '.',
  DOOR: '+',
  STAIRS_DOWN: '>',
};

export const MAP_W = 48;
export const MAP_H = 32;

export const LAYOUTS = ['rooms', 'maze', 'cavern', 'bigroom'];

function randint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

function makeGrid(fill) {
  const g = [];
  for (let y = 0; y < MAP_H; y++) g.push(new Array(MAP_W).fill(fill));
  return g;
}

function center(room) {
  return { x: Math.floor(room.x + room.w / 2), y: Math.floor(room.y + room.h / 2) };
}

function collectFloorCells(grid) {
  const cells = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (grid[y][x] === TILE.FLOOR) cells.push({ x, y });
    }
  }
  return cells;
}

// --- 部屋＋通路 ---
function genRooms(floor) {
  const grid = makeGrid(TILE.WALL);
  const rooms = [];
  const maxRooms = 8 + Math.min(floor, 6);
  const overlap = (a, b) =>
    a.x <= b.x + b.w + 1 && a.x + a.w + 1 >= b.x &&
    a.y <= b.y + b.h + 1 && a.y + a.h + 1 >= b.y;

  for (let i = 0; i < maxRooms; i++) {
    const w = randint(4, 9), h = randint(3, 6);
    const x = randint(1, MAP_W - w - 2), y = randint(1, MAP_H - h - 2);
    const room = { x, y, w, h };
    if (rooms.some((r) => overlap(r, room))) continue;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) grid[yy][xx] = TILE.FLOOR;
    if (rooms.length > 0) {
      const a = center(rooms[rooms.length - 1]), b = center(room);
      if (Math.random() < 0.5) {
        for (let xx = Math.min(a.x, b.x); xx <= Math.max(a.x, b.x); xx++) grid[a.y][xx] = TILE.FLOOR;
        for (let yy = Math.min(a.y, b.y); yy <= Math.max(a.y, b.y); yy++) grid[yy][b.x] = TILE.FLOOR;
      } else {
        for (let yy = Math.min(a.y, b.y); yy <= Math.max(a.y, b.y); yy++) grid[yy][a.x] = TILE.FLOOR;
        for (let xx = Math.min(a.x, b.x); xx <= Math.max(a.x, b.x); xx++) grid[b.y][xx] = TILE.FLOOR;
      }
    }
    rooms.push(room);
  }
  return grid;
}

// --- 迷路 ---
function genMaze() {
  const grid = makeGrid(TILE.WALL);
  const sx = 1, sy = 1;
  grid[sy][sx] = TILE.FLOOR;
  const stack = [{ x: sx, y: sy }];
  const dirs = [[0, -2], [0, 2], [-2, 0], [2, 0]];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const opts = [];
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx > 0 && ny > 0 && nx < MAP_W - 1 && ny < MAP_H - 1 && grid[ny][nx] === TILE.WALL) {
        opts.push([dx, dy]);
      }
    }
    if (opts.length === 0) { stack.pop(); continue; }
    const [dx, dy] = opts[randint(0, opts.length - 1)];
    grid[cur.y + dy / 2][cur.x + dx / 2] = TILE.FLOOR;
    grid[cur.y + dy][cur.x + dx] = TILE.FLOOR;
    stack.push({ x: cur.x + dx, y: cur.y + dy });
  }
  // 少しだけ壁を抜いてループを作る（行き止まり地獄を緩和）
  for (let i = 0; i < 30; i++) {
    const x = randint(1, MAP_W - 2), y = randint(1, MAP_H - 2);
    if (grid[y][x] === TILE.WALL &&
        grid[y][x - 1] === TILE.FLOOR && grid[y][x + 1] === TILE.FLOOR) grid[y][x] = TILE.FLOOR;
  }
  return grid;
}

// --- 洞窟（セルオートマトン）---
function genCavern() {
  let grid = makeGrid(TILE.WALL);
  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      grid[y][x] = Math.random() < 0.45 ? TILE.WALL : TILE.FLOOR;
    }
  }
  for (let step = 0; step < 5; step++) {
    const next = makeGrid(TILE.WALL);
    for (let y = 1; y < MAP_H - 1; y++) {
      for (let x = 1; x < MAP_W - 1; x++) {
        let walls = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (!(dx === 0 && dy === 0) && grid[y + dy][x + dx] === TILE.WALL) walls++;
        next[y][x] = walls >= 5 ? TILE.WALL : TILE.FLOOR;
      }
    }
    grid = next;
  }
  return keepLargestRegion(grid);
}

// --- 大部屋 ---
function genBigRoom() {
  const grid = makeGrid(TILE.WALL);
  const x0 = 2, y0 = 2, x1 = MAP_W - 3, y1 = MAP_H - 3;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y][x] = TILE.FLOOR;
  // 柱をいくつか
  for (let i = 0; i < 14; i++) {
    const x = randint(x0 + 2, x1 - 2), y = randint(y0 + 2, y1 - 2);
    grid[y][x] = TILE.WALL;
  }
  return grid;
}

// 最大連結領域だけ残す
function keepLargestRegion(grid) {
  const seen = makeGrid(false);
  let best = [];
  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      if (grid[y][x] !== TILE.FLOOR || seen[y][x]) continue;
      const region = [];
      const stack = [{ x, y }];
      seen[y][x] = true;
      while (stack.length) {
        const c = stack.pop();
        region.push(c);
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const nx = c.x + dx, ny = c.y + dy;
          if (nx > 0 && ny > 0 && nx < MAP_W - 1 && ny < MAP_H - 1 &&
              grid[ny][nx] === TILE.FLOOR && !seen[ny][nx]) {
            seen[ny][nx] = true;
            stack.push({ x: nx, y: ny });
          }
        }
      }
      if (region.length > best.length) best = region;
    }
  }
  const out = makeGrid(TILE.WALL);
  for (const c of best) out[c.y][c.x] = TILE.FLOOR;
  return out;
}

// BFS で start から最遠の床セルを返す
function farthestCell(grid, start) {
  const dq = [start];
  const seen = makeGrid(false);
  seen[start.y][start.x] = true;
  let last = start;
  let head = 0;
  while (head < dq.length) {
    const c = dq[head++];
    last = c;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = c.x + dx, ny = c.y + dy;
      if (nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H &&
          grid[ny][nx] === TILE.FLOOR && !seen[ny][nx]) {
        seen[ny][nx] = true;
        dq.push({ x: nx, y: ny });
      }
    }
  }
  return last;
}

export function isWalkable(tile) {
  return tile === TILE.FLOOR || tile === TILE.DOOR || tile === TILE.STAIRS_DOWN;
}

// layout: 指定が無ければ階に応じて抽選
export function generateDungeon(floor, layout) {
  let kind = LAYOUTS.includes(layout) ? layout : null;
  if (!kind) {
    const r = Math.random();
    if (floor >= 3 && r < 0.18) kind = 'maze';
    else if (r < 0.4) kind = 'cavern';
    else if (r < 0.5) kind = 'bigroom';
    else kind = 'rooms';
  }

  let grid;
  if (kind === 'maze') grid = genMaze();
  else if (kind === 'cavern') grid = genCavern();
  else if (kind === 'bigroom') grid = genBigRoom();
  else grid = genRooms(floor);

  let cells = collectFloorCells(grid);
  if (cells.length < 20) { // 生成失敗時の保険
    grid = genRooms(floor);
    cells = collectFloorCells(grid);
    kind = 'rooms';
  }

  const start = cells[randint(0, cells.length - 1)];
  const stairs = farthestCell(grid, start);
  grid[stairs.y][stairs.x] = TILE.STAIRS_DOWN;

  // 罠を配置（隠れている）
  const traps = [];
  const trapTypes = ['dart', 'poison', 'teleport', 'pit'];
  const trapCount = randint(2, 4 + Math.min(floor, 6));
  for (let i = 0; i < trapCount; i++) {
    const c = cells[randint(0, cells.length - 1)];
    if (c.x === start.x && c.y === start.y) continue;
    if (c.x === stairs.x && c.y === stairs.y) continue;
    if (traps.some((t) => t.x === c.x && t.y === c.y)) continue;
    traps.push({ x: c.x, y: c.y, type: trapTypes[randint(0, trapTypes.length - 1)], known: false });
  }

  return { grid, start, traps, layout: kind };
}

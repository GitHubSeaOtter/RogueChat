// ダンジョン生成：部屋と通路でつなぐシンプルなアルゴリズム

export const TILE = {
  WALL: '#',
  FLOOR: '.',
  DOOR: '+',
  STAIRS_DOWN: '>',
};

export const MAP_W = 48;
export const MAP_H = 32;

function randint(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

function makeGrid(w, h, fill) {
  const g = [];
  for (let y = 0; y < h; y++) {
    g.push(new Array(w).fill(fill));
  }
  return g;
}

function carveRoom(grid, room) {
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      grid[y][x] = TILE.FLOOR;
    }
  }
}

function carveHTunnel(grid, x1, x2, y) {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
    grid[y][x] = TILE.FLOOR;
  }
}

function carveVTunnel(grid, y1, y2, x) {
  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
    grid[y][x] = TILE.FLOOR;
  }
}

function roomsOverlap(a, b) {
  return (
    a.x <= b.x + b.w + 1 &&
    a.x + a.w + 1 >= b.x &&
    a.y <= b.y + b.h + 1 &&
    a.y + a.h + 1 >= b.y
  );
}

export function center(room) {
  return {
    x: Math.floor(room.x + room.w / 2),
    y: Math.floor(room.y + room.h / 2),
  };
}

// floor: 階層（深いほど部屋数を増やす）
export function generateDungeon(floor) {
  const grid = makeGrid(MAP_W, MAP_H, TILE.WALL);
  const rooms = [];
  const maxRooms = 8 + Math.min(floor, 6);

  for (let i = 0; i < maxRooms; i++) {
    const w = randint(4, 9);
    const h = randint(3, 6);
    const x = randint(1, MAP_W - w - 2);
    const y = randint(1, MAP_H - h - 2);
    const room = { x, y, w, h };
    if (rooms.some((r) => roomsOverlap(r, room))) continue;

    carveRoom(grid, room);

    if (rooms.length > 0) {
      const prev = center(rooms[rooms.length - 1]);
      const cur = center(room);
      if (Math.random() < 0.5) {
        carveHTunnel(grid, prev.x, cur.x, prev.y);
        carveVTunnel(grid, prev.y, cur.y, cur.x);
      } else {
        carveVTunnel(grid, prev.y, cur.y, prev.x);
        carveHTunnel(grid, prev.x, cur.x, cur.y);
      }
    }
    rooms.push(room);
  }

  // 下り階段を最後の部屋に置く
  const last = center(rooms[rooms.length - 1]);
  grid[last.y][last.x] = TILE.STAIRS_DOWN;

  return { grid, rooms };
}

export function isWalkable(tile) {
  return tile === TILE.FLOOR || tile === TILE.DOOR || tile === TILE.STAIRS_DOWN;
}

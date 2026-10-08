export const WIDTH = 43,
  HEIGHT = 25,
  LAST_FLOOR = 5;
export const THEMES = [
  {
    name: "忘れられた水路",
    flavor: "壁の隙間を水が歌う。誰かの焚き火がまだ温かい。",
    tiles: ["~", "~", "="],
    enemies: ["rat", "goblin"],
  },
  {
    name: "糸紡ぎの庭",
    flavor: "根は石を縫い、糸は暗がりを結ぶ。名前のないものが芽吹く。",
    tiles: ['"', '"', "~"],
    enemies: ["spider", "goblin"],
  },
  {
    name: "灰の書庫",
    flavor: "読まれなかった物語が、燃え残った頁の間を歩いている。",
    tiles: ["=", "^", '"'],
    enemies: ["archer", "moth"],
  },
  {
    name: "逆さの天文台",
    flavor: "足元の水に星が浮く。空を忘れた観測者があなたを待つ。",
    tiles: ["~", "=", "^"],
    enemies: ["moth", "archer", "spider"],
  },
  {
    name: "まだない世界の心臓",
    flavor: "最後の扉の向こうで、ひとつの星が書き手を待っている。",
    tiles: ["~", '"', "="],
    enemies: ["archer", "goblin"],
  },
];
export const TILES = {
  "#": {
    name: "石壁",
    detail: "視線を遮る。掘る、溶かす、説得する――自由行動で道を開ける。",
  },
  ".": { name: "石床", detail: "何もない場所にも、何かを生み出せる。" },
  "+": {
    name: "閉じた扉",
    detail: "ぶつかると開く。開けるのに1ターン。視線を遮る。",
  },
  "/": { name: "開いた扉", detail: "通行できる。" },
  "~": { name: "浅い水", detail: "通行可能。炎上を消す。火は広がらない。" },
  '"': { name: "蜘蛛の糸", detail: "踏むと1ターン拘束。次の移動で抜ける。" },
  "=": { name: "油だまり", detail: "通行可能。隣の火から引火する。" },
  "^": {
    name: "露出した罠",
    detail: "踏むたび4ダメージ。迂回や自由行動で解除できる。",
  },
  "*": {
    name: "炎",
    detail:
      "このマスにいると毎ターン3ダメージ。各ターン、隣接する油へ広がる。敵にも作用。",
  },
  ">": {
    name: "下り階段",
    detail: "上に立って「先へ進む」。次の階でHP＋4、集中＋3。",
  },
  "<": { name: "入口", detail: "帰還の巻物の着地点。" },
  0: {
    name: "星の核",
    detail: "守護者を倒すか交渉で鎮め、ここで「星を持ち帰る」。",
  },
  "&": { name: "野営地", detail: "ここでの野営は糧食を消費しない。各階1回。" },
};
export const ENEMIES = {
  rat: {
    name: "水路ねずみ",
    symbol: "r",
    hp: 7,
    attack: 4,
    range: 1,
    behavior: "melee",
    tags: ["獣", "臆病"],
    detail: "噛みつき。予告した1マスを攻撃する。",
  },
  goblin: {
    name: "拾い屋ゴブリン",
    symbol: "g",
    hp: 12,
    attack: 5,
    range: 1,
    behavior: "melee",
    tags: ["言葉", "欲深い"],
    detail: "短剣。食料や道具をめぐる交渉が得意。",
  },
  spider: {
    name: "糸紡ぎ",
    symbol: "s",
    hp: 10,
    attack: 4,
    range: 1,
    behavior: "poison",
    tags: ["獣", "糸", "火に弱い"],
    detail: "噛みつき＋毒（2ターン、各2ダメージ）。",
  },
  archer: {
    name: "頁の射手",
    symbol: "a",
    hp: 12,
    attack: 7,
    range: 5,
    behavior: "ranged",
    tags: ["紙", "言葉"],
    detail: "射撃。予告マスから動けば避けられる。壁と扉で視線を切れる。",
  },
  moth: {
    name: "記憶喰い",
    symbol: "m",
    hp: 13,
    attack: 5,
    range: 3,
    behavior: "drain",
    tags: ["魔法", "光"],
    detail: "記憶の針。被弾時に集中を2失う。",
  },
  warden: {
    name: "未完の守護者",
    symbol: "W",
    hp: 36,
    attack: 10,
    range: 2,
    behavior: "slam",
    tags: ["言葉", "孤独", "守護"],
    detail: "大振り。予告した十字5マスを攻撃。力でも、言葉でも越えられる。",
  },
};
export function distance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
export function lineOfSight(grid, a, b) {
  let x = a.x,
    y = a.y;
  const dx = Math.abs(b.x - x),
    dy = Math.abs(b.y - y),
    sx = x < b.x ? 1 : -1,
    sy = y < b.y ? 1 : -1;
  let err = dx - dy;
  while (x !== b.x || y !== b.y) {
    const e = err * 2;
    if (
      e > -dy &&
      e < dx &&
      ("#+".includes(grid[y]?.[x + sx] || "#") ||
        "#+".includes(grid[y + sy]?.[x] || "#"))
    )
      return false;
    if (e > -dy) {
      err -= dy;
      x += sx;
    }
    if (e < dx) {
      err += dx;
      y += sy;
    }
    if (x === b.x && y === b.y) return true;
    if (!grid[y]?.[x] || "#+".includes(grid[y][x])) return false;
  }
  return true;
}
export function generateDungeon(floor, random, makeId) {
  const theme = THEMES[floor - 1];
  const grid = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill("#"));
  const rooms = [];
  // Nine connected rooms; corridors are carved after rooms to guarantee reachability.
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) {
      const x = 2 + col * 14 + Math.floor(random() * 2),
        y = 1 + row * 8 + Math.floor(random() * 2);
      const w = 7 + Math.floor(random() * 4),
        h = 4 + Math.floor(random() * 2);
      const room = {
        x,
        y,
        w,
        h,
        cx: x + Math.floor(w / 2),
        cy: y + Math.floor(h / 2),
      };
      rooms.push(room);
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) grid[yy][xx] = ".";
    }
  const connect = (a, b) => {
    let x = a.cx,
      y = a.cy;
    while (x !== b.cx) {
      grid[y][x] = ".";
      x += Math.sign(b.cx - x);
    }
    while (y !== b.cy) {
      grid[y][x] = ".";
      y += Math.sign(b.cy - y);
    }
    grid[y][x] = ".";
  };
  for (let i = 1; i < rooms.length; i++) connect(rooms[i - 1], rooms[i]);
  connect(rooms[0], rooms[3]);
  connect(rooms[3], rooms[6]);
  connect(rooms[1], rooms[4]);
  const start = { x: rooms[0].cx, y: rooms[0].cy },
    exit = { x: rooms[8].cx, y: rooms[8].cy };
  const occupied = new Set([`${start.x},${start.y}`, `${exit.x},${exit.y}`]);
  if (floor === LAST_FLOOR) occupied.add(`${exit.x - 1},${exit.y}`);
  const spot = (room) => {
    for (let i = 0; i < 100; i++) {
      const pos = {
        x: room.x + Math.floor(random() * room.w),
        y: room.y + Math.floor(random() * room.h),
      };
      const key = `${pos.x},${pos.y}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        return pos;
      }
    }
    throw new Error("Room exhausted");
  };
  const enemies = [],
    drops = [];
  for (let i = 1; i < rooms.length; i++) {
    const room = rooms[i];
    for (let n = 0; n < 2; n++) {
      const p = spot(room);
      grid[p.y][p.x] = theme.tiles[Math.floor(random() * theme.tiles.length)];
    }
    if (i !== 1) {
      const type = theme.enemies[Math.floor(random() * theme.enemies.length)],
        def = ENEMIES[type];
      enemies.push({
        ...def,
        ...spot(room),
        type,
        id: makeId(),
        hp: def.hp + floor - 1,
        maxHp: def.hp + floor - 1,
        attack: def.attack + Math.floor(floor / 2),
        intent: null,
        stunned: 0,
        burning: 0,
        friendly: false,
      });
    }
    const key =
      i === 1
        ? "tonic"
        : [
            "tonic",
            "focus",
            "smoke",
            "oil",
            "ration",
            floor > 2 ? "blade" : "chalk",
            "mail",
          ][Math.floor(random() * 7)];
    drops.push({ ...spot(room), key, id: makeId() });
  }
  if (floor === LAST_FLOOR) {
    const def = ENEMIES.warden;
    enemies.push({
      ...def,
      x: exit.x - 1,
      y: exit.y,
      type: "warden",
      id: makeId(),
      maxHp: def.hp,
      intent: null,
      stunned: 0,
      burning: 0,
      friendly: false,
    });
  }
  const camp = spot(rooms[4]);
  grid[camp.y][camp.x] = "&";
  // Place doors only in one-cell passages, without sealing room interiors.
  for (let y = 1; y < HEIGHT - 1; y++)
    for (let x = 1; x < WIDTH - 1; x++) {
      if (grid[y][x] !== "." || occupied.has(`${x},${y}`)) continue;
      if (grid[y - 1][x] === "#" && grid[y + 1][x] === "#" && random() < 0.08)
        grid[y][x] = "+";
    }
  grid[start.y][start.x] = "<";
  grid[exit.y][exit.x] = floor === LAST_FLOOR ? "0" : ">";
  return {
    grid,
    rooms,
    start,
    exit,
    enemies,
    drops,
    objects: [],
    theme,
    campUsed: false,
  };
}

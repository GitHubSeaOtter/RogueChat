import {
  TILE, MAP_W, MAP_H, generateDungeon, isWalkable, LAYOUTS,
} from './dungeon.js';
import {
  makeItem, makeItemFromDef, itemName, isEquippable,
  builtinFloorItemDefs, resolveByName,
} from './items.js';
import { hasApiKey, generateFloor, adjudicate } from './llm.js';

// ---- 状態異常（NetHack 参考） ----
export const STATUS_INFO = {
  '毒':   { dot: 2, color: '#7cd97c' },
  '炎上': { dot: 3, color: '#ff8a4c' },
  '出血': { dot: 2, color: '#e06c75' },
  '麻痺': { skip: true, color: '#d9d97c' },
  '睡眠': { skip: true, color: '#9aa0ff' },
  '凍結': { skip: true, color: '#7cd0ff' },
  '石化': { skip: true, color: '#bbbbbb' },
  '混乱': { confuse: true, color: '#d97cd9' },
  '朦朧': { confuse: true, color: '#d9b07c' },
  '盲目': { blind: true, color: '#888888' },
  '恐怖': { flee: true, color: '#c0c0ff' },
};

// ---- フォールバック用モンスターカタログ（NetHack 参考） ----
const MONSTER_CATALOG = [
  { sym: 'r', name: 'ドブネズミ',   hp: 4,  atk: 2,  def: 0, xp: 2,  color: '#a98', ability: '',     depth: 1 },
  { sym: 'b', name: 'コウモリ',     hp: 5,  atk: 3,  def: 0, xp: 3,  color: '#9af', ability: '混乱', depth: 1 },
  { sym: 'x', name: 'グリッドバグ', hp: 3,  atk: 1,  def: 0, xp: 1,  color: '#c6c', ability: '',     depth: 1 },
  { sym: 'd', name: '野犬',         hp: 6,  atk: 3,  def: 0, xp: 3,  color: '#ca8', ability: '',     depth: 1 },
  { sym: 'k', name: 'コボルト',     hp: 8,  atk: 4,  def: 1, xp: 5,  color: '#7c5', ability: '',     depth: 2 },
  { sym: 'G', name: 'ノーム',       hp: 8,  atk: 4,  def: 1, xp: 5,  color: '#bba', ability: '',     depth: 2 },
  { sym: 'g', name: 'ゴブリン',     hp: 10, atk: 5,  def: 1, xp: 7,  color: '#5b6', ability: '',     depth: 2 },
  { sym: 'F', name: '黄色カビ',     hp: 8,  atk: 3,  def: 0, xp: 4,  color: '#dd5', ability: '毒',   depth: 2 },
  { sym: 'e', name: '浮遊する目',   hp: 9,  atk: 0,  def: 1, xp: 6,  color: '#6cf', ability: '麻痺', depth: 3 },
  { sym: 'o', name: 'オーク',       hp: 16, atk: 7,  def: 2, xp: 12, color: '#3a4', ability: '',     depth: 4 },
  { sym: 'S', name: '大蜘蛛',       hp: 14, atk: 6,  def: 1, xp: 11, color: '#a55', ability: '毒',   depth: 4 },
  { sym: 'n', name: 'ニンフ',       hp: 12, atk: 4,  def: 1, xp: 9,  color: '#f9c', ability: '睡眠', depth: 4 },
  { sym: 'Z', name: 'ゾンビ',       hp: 14, atk: 6,  def: 1, xp: 10, color: '#9a6', ability: '',     depth: 4 },
  { sym: 's', name: 'スケルトン',   hp: 16, atk: 8,  def: 3, xp: 14, color: '#ddd', ability: '',     depth: 5 },
  { sym: 'N', name: 'ナーガ',       hp: 20, atk: 8,  def: 2, xp: 18, color: '#6c9', ability: '毒',   depth: 6 },
  { sym: 'O', name: 'オーガ',       hp: 24, atk: 10, def: 2, xp: 20, color: '#9a5', ability: '',     depth: 6 },
  { sym: 'T', name: 'トロル',       hp: 30, atk: 11, def: 3, xp: 26, color: '#696', ability: '出血', depth: 7 },
  { sym: 'c', name: 'コカトリス',   hp: 18, atk: 6,  def: 2, xp: 20, color: '#cb7', ability: '石化', depth: 7 },
  { sym: 'L', name: 'リッチ',       hp: 26, atk: 10, def: 4, xp: 30, color: '#bcf', ability: '麻痺', depth: 9 },
  { sym: 'D', name: 'ドラゴン',     hp: 44, atk: 15, def: 5, xp: 45, color: '#e55', ability: '炎上', depth: 9 },
];

const GLYPH_COLOR = {
  '#': '#3b454e', '.': '#4a5560', '+': '#b5814a', '>': '#5fd1e0', '@': '#ffe27a', '$': '#e5c07b',
};
const TRAP_NAME = { dart: '矢の罠', poison: '毒矢の罠', teleport: 'テレポートの罠', pit: '落とし穴' };

function randint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function clampInt(v, lo, hi) { v = Math.round(Number(v) || 0); return Math.max(lo, Math.min(hi, v)); }
function dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
function validHex(c) { return typeof c === 'string' && /^#?[0-9a-fA-F]{6}$/.test(c); }
function normHex(c, fb) { if (!validHex(c)) return fb; return c[0] === '#' ? c : '#' + c; }
function oneChar(s, fb) { return (typeof s === 'string' && s.trim()) ? s.trim()[0] : fb; }
function dirName(dx, dy) {
  const ns = dy < 0 ? '北' : dy > 0 ? '南' : '';
  const ew = dx < 0 ? '西' : dx > 0 ? '東' : '';
  return (ns + ew) || '隣';
}

export class Game {
  constructor(canvas, log) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.log = log;
    this.cell = 22;
    this.player = null;
  }

  async newGame() {
    this.nextId = 1;
    this.player = {
      x: 0, y: 0,
      hp: 20, maxHp: 20, mp: 5, maxMp: 5,
      atk: 5, def: 1,
      level: 1, xp: 0, xpNext: 20, gold: 0,
      inventory: [],
      equipment: { weapon: null, armor: null, shield: null },
      statuses: {},
    };
    this.player.equipment.weapon = makeItem('dagger');
    this.player.equipment.armor = makeItem('leather_armor');
    this.player.inventory.push(makeItem('potion_healing'));
    this.player.inventory.push(makeItem('potion_healing'));

    this.floor = 0;
    this.dead = false;
    this.clearLog();
    this.message('RogueChat の世界へようこそ。', 'sys');
    this.message('各階の構成はAIが生成する。「持ち物」から装備変更・使用・破棄ができる。', 'sys');
    await this.goToFloor(1);
  }

  // ---- 実効ステータス ----
  atkTotal() {
    const w = this.player.equipment.weapon;
    return this.player.atk + (w ? w.bonus + (w.ench || 0) : 0);
  }
  defTotal() {
    const e = this.player.equipment;
    let d = this.player.def;
    if (e.armor) d += e.armor.bonus + (e.armor.ench || 0);
    if (e.shield) d += e.shield.bonus + (e.shield.ench || 0);
    return d;
  }

  // ---- 階層移動・生成 ----
  async goToFloor(n) {
    this.floor = n;
    this.roster = await this.makeRoster();
    const theme = this.roster.theme || '未知の階層';
    this.message(`地下${n}階 【${theme}】 へ降りた。`, 'gm');
    this.buildFloor();
    this.render();
  }

  async makeRoster() {
    if (hasApiKey()) {
      try {
        const r = await generateFloor({ floor: this.floor, level: this.player.level });
        return this.sanitizeRoster(r);
      } catch (e) {
        this.message('階層のAI生成に失敗。既定の構成で進む。', 'sys');
      }
    }
    return this.fallbackRoster();
  }

  fallbackRoster() {
    let monsters = MONSTER_CATALOG.filter((m) => m.depth <= this.floor);
    if (monsters.length === 0) monsters = MONSTER_CATALOG.slice(0, 4);
    return {
      theme: '未知の階層',
      layout: LAYOUTS[randint(0, LAYOUTS.length - 1)],
      monsters: monsters.map((m) => ({ ...m })),
      items: builtinFloorItemDefs(this.floor),
    };
  }

  sanitizeRoster(r) {
    const f = this.floor;
    let monsters = (Array.isArray(r.monsters) ? r.monsters : [])
      .filter((m) => m && m.name)
      .map((m) => ({
        name: String(m.name).slice(0, 16),
        sym: oneChar(m.symbol, 'm'),
        color: normHex(m.color, '#ccc'),
        hp: clampInt(m.hp, 1, f * 8 + 12),
        atk: clampInt(m.atk, 0, f * 2 + 4),
        def: clampInt(m.def, 0, f + 3),
        xp: clampInt(m.xp, 1, f * 8 + 4),
        ability: STATUS_INFO[m.ability] ? m.ability : '',
      }));
    const validKind = new Set(['weapon', 'armor', 'shield', 'potion', 'scroll']);
    let items = (Array.isArray(r.items) ? r.items : [])
      .filter((it) => it && it.name && validKind.has(it.kind))
      .map((it) => ({
        id: 'gen', name: String(it.name).slice(0, 20), kind: it.kind,
        sym: oneChar(it.symbol, it.kind === 'potion' ? '!' : it.kind === 'scroll' ? '?' : ')'),
        color: normHex(it.color, '#aaa'),
        bonus: ['weapon', 'armor', 'shield'].includes(it.kind) ? clampInt(it.bonus, 1, 8) : 0,
        hint: String(it.hint || '').slice(0, 80),
      }));

    if (monsters.length === 0) monsters = this.fallbackRoster().monsters;
    if (items.length === 0) items = builtinFloorItemDefs(f);

    return {
      theme: String(r.theme || '未知の階層').slice(0, 24),
      layout: LAYOUTS.includes(r.layout) ? r.layout : undefined,
      monsters, items,
    };
  }

  buildFloor() {
    const { grid, start, traps } = generateDungeon(this.floor, this.roster.layout);
    this.grid = grid;
    this.traps = traps;
    this.seen = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(false));
    this.visible = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(false));
    this.player.x = start.x;
    this.player.y = start.y;
    this.items = [];
    this.monsters = [];
    this.spawnItems();
    this.spawnMonsters();
    this.computeFOV();
  }

  isOccupied(x, y) {
    if (x === this.player.x && y === this.player.y) return true;
    if (this.monsters.some((m) => m.x === x && m.y === y)) return true;
    if (this.items.some((it) => it.x === x && it.y === y)) return true;
    return false;
  }

  randomEmptyCell(minFromStart = 0) {
    for (let t = 0; t < 300; t++) {
      const x = randint(1, MAP_W - 2), y = randint(1, MAP_H - 2);
      if (this.grid[y][x] !== TILE.FLOOR) continue;
      if (this.isOccupied(x, y)) continue;
      if (minFromStart && dist({ x, y }, this.player) < minFromStart) continue;
      return { x, y };
    }
    return null;
  }

  spawnItems() {
    const pool = this.roster.items.length ? this.roster.items : builtinFloorItemDefs(this.floor);
    const count = randint(3, 5);
    for (let i = 0; i < count; i++) {
      const c = this.randomEmptyCell();
      if (!c) break;
      if (Math.random() < 0.35) {
        this.items.push({ x: c.x, y: c.y, sym: '$', color: GLYPH_COLOR['$'], gold: randint(5, 20 + this.floor * 3) });
      } else {
        const def = pool[randint(0, pool.length - 1)];
        const inst = makeItemFromDef(def);
        this.items.push({ x: c.x, y: c.y, sym: inst.sym, color: inst.color, item: inst });
      }
    }
  }

  spawnMonsters() {
    const pool = this.roster.monsters.length ? this.roster.monsters : MONSTER_CATALOG.slice(0, 4);
    const count = randint(5, 8);
    for (let i = 0; i < count; i++) {
      const c = this.randomEmptyCell(5);
      if (!c) break;
      const def = pool[randint(0, pool.length - 1)];
      this.monsters.push({
        id: this.nextId++,
        name: def.name, sym: def.sym, color: def.color,
        hp: def.hp, maxHp: def.hp, atk: def.atk, def: def.def, xp: def.xp,
        ability: def.ability || '',
        x: c.x, y: c.y, statuses: {},
      });
    }
  }

  // ---- 状態異常ヘルパ ----
  applyStatus(ent, name, turns) {
    if (!name) return;
    const t = clampInt(turns, 1, 12);
    ent.statuses[name] = Math.max(ent.statuses[name] || 0, t);
  }
  hasStatus(ent, name) { return (ent.statuses[name] || 0) > 0; }
  isIncapacitated(ent) { return Object.keys(ent.statuses).some((n) => STATUS_INFO[n]?.skip); }
  isConfused(ent) { return Object.keys(ent.statuses).some((n) => STATUS_INFO[n]?.confuse); }
  isBlind(ent) { return this.hasStatus(ent, '盲目'); }
  incapName(ent) {
    const n = Object.keys(ent.statuses).find((s) => STATUS_INFO[s]?.skip);
    return n || '';
  }

  tickEntity(ent, isPlayer) {
    for (const name of Object.keys(ent.statuses)) {
      const info = STATUS_INFO[name];
      if (info?.dot) {
        ent.hp -= info.dot;
        if (isPlayer) this.message(`${name}で ${info.dot} のダメージ。`, 'bad');
      }
      ent.statuses[name] -= 1;
      if (ent.statuses[name] <= 0) {
        delete ent.statuses[name];
        if (isPlayer) this.message(`${name}が治まった。`, 'sys');
      }
    }
    if (isPlayer && ent.hp <= 0) this.killPlayer();
  }

  // ---- 視界 ----
  computeFOV() {
    const radius = this.isBlind(this.player) ? 1 : 7;
    for (let y = 0; y < MAP_H; y++) this.visible[y].fill(false);
    const px = this.player.x, py = this.player.y;
    for (let y = py - radius; y <= py + radius; y++) {
      for (let x = px - radius; x <= px + radius; x++) {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
        if (dist({ x: px, y: py }, { x, y }) > radius) continue;
        if (this.lineOfSight(px, py, x, y)) {
          this.visible[y][x] = true;
          this.seen[y][x] = true;
        }
      }
    }
  }

  lineOfSight(x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    while (true) {
      if (x === x1 && y === y1) return true;
      if (!(x === x0 && y === y0) && this.grid[y][x] === TILE.WALL) return false;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  // ---- 描画 ----
  resize() {
    if (!this.player) return;
    const main = this.canvas.parentElement;
    const w = main.clientWidth, h = main.clientHeight;
    const viewCols = Math.min(MAP_W, Math.floor(w / 16));
    const viewRows = Math.min(MAP_H, Math.floor(h / 16));
    this.cell = Math.max(12, Math.min(Math.floor(w / viewCols), Math.floor(h / viewRows), 30));
    this.viewCols = Math.max(8, Math.floor(w / this.cell));
    this.viewRows = Math.max(8, Math.floor(h / this.cell));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.viewCols * this.cell * dpr;
    this.canvas.height = this.viewRows * this.cell * dpr;
    this.canvas.style.width = this.viewCols * this.cell + 'px';
    this.canvas.style.height = this.viewRows * this.cell + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  render() {
    if (!this.player) return;
    if (!this.viewCols) { this.resize(); return; }
    const ctx = this.ctx, c = this.cell;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.font = `${Math.floor(c * 0.82)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ox = this.player.x - Math.floor(this.viewCols / 2);
    const oy = this.player.y - Math.floor(this.viewRows / 2);

    for (let row = 0; row < this.viewRows; row++) {
      for (let col = 0; col < this.viewCols; col++) {
        const mx = ox + col, my = oy + row;
        if (mx < 0 || my < 0 || mx >= MAP_W || my >= MAP_H) continue;
        if (!this.seen[my][mx]) continue;
        const vis = this.visible[my][mx];

        let glyph = this.grid[my][mx];
        let color = GLYPH_COLOR[glyph] || '#4a5560';

        const trap = this.traps.find((t) => t.x === mx && t.y === my && t.known);
        if (trap && glyph === TILE.FLOOR) { glyph = '^'; color = '#e0617a'; }

        if (vis) {
          const item = this.items.find((it) => it.x === mx && it.y === my);
          if (item) { glyph = item.sym; color = item.color; }
          const mon = this.monsters.find((m) => m.x === mx && m.y === my);
          if (mon) {
            glyph = mon.sym; color = mon.color;
            if (this.isIncapacitated(mon)) color = '#888';
          }
          if (mx === this.player.x && my === this.player.y) { glyph = '@'; color = GLYPH_COLOR['@']; }
        } else {
          color = '#1c232a';
        }
        ctx.fillStyle = color;
        ctx.fillText(glyph, col * c + c / 2, row * c + c / 2);
      }
    }
  }

  // ---- ログ ----
  clearLog() { this.log.innerHTML = ''; }
  message(text, cls = '') {
    const p = document.createElement('p');
    p.className = 'line ' + cls;
    p.textContent = text;
    this.log.appendChild(p);
    this.log.scrollTop = this.log.scrollHeight;
    while (this.log.children.length > 200) this.log.removeChild(this.log.firstChild);
  }

  // ---- 移動・戦闘 ----
  tryMove(dx, dy) {
    if (this.dead || !this.player) return false;

    if (this.isIncapacitated(this.player)) {
      this.message(`${this.incapName(this.player)}で動けない！`, 'bad');
      this.endTurn();
      return true;
    }
    if (dx === 0 && dy === 0) { this.endTurn(); return true; }

    if (this.isConfused(this.player) && Math.random() < 0.5) {
      dx = randint(-1, 1); dy = randint(-1, 1);
      this.message('混乱してふらついた。', 'sys');
      if (dx === 0 && dy === 0) { this.endTurn(); return true; }
    }

    const nx = this.player.x + dx, ny = this.player.y + dy;
    if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) return false;

    const mon = this.monsters.find((m) => m.x === nx && m.y === ny);
    if (mon) { this.attackMonster(mon); this.endTurn(); return true; }

    if (!isWalkable(this.grid[ny][nx])) return false;

    this.player.x = nx; this.player.y = ny;
    this.triggerTrap();
    this.pickup();
    if (!this.dead) this.endTurn();
    return true;
  }

  attackMonster(mon) {
    delete mon.statuses['睡眠'];
    const dmg = Math.max(1, this.atkTotal() - mon.def + randint(-1, 2));
    mon.hp -= dmg;
    this.message(`${mon.name}に ${dmg} のダメージ。`, 'good');
    if (mon.hp <= 0) this.defeatMonster(mon);
  }

  defeatMonster(mon) {
    this.message(`${mon.name}を倒した！（経験値 +${mon.xp}）`, 'good');
    this.gainXp(mon.xp);
    this.monsters = this.monsters.filter((m) => m !== mon);
  }

  triggerTrap() {
    const t = this.traps.find((tr) => tr.x === this.player.x && tr.y === this.player.y && !tr.known);
    if (!t) return;
    t.known = true;
    this.message(`${TRAP_NAME[t.type]}を踏んでしまった！`, 'bad');
    if (t.type === 'dart') {
      const d = randint(2, 5); this.player.hp -= d;
      this.message(`矢が刺さり ${d} のダメージ。`, 'bad');
    } else if (t.type === 'poison') {
      const d = randint(1, 3); this.player.hp -= d;
      this.applyStatus(this.player, '毒', randint(3, 5));
      this.message(`毒矢を受けた（${d}ダメージ・毒）。`, 'bad');
    } else if (t.type === 'teleport') {
      const spot = this.randomFloorTile();
      if (spot) { this.player.x = spot.x; this.player.y = spot.y; this.computeFOV(); }
      this.message('景色が歪み、別の場所へ飛ばされた。', 'sys');
    } else if (t.type === 'pit') {
      const d = randint(3, 6); this.player.hp -= d;
      this.applyStatus(this.player, '朦朧', 1);
      this.message(`落とし穴に落ちて ${d} のダメージ。`, 'bad');
    }
    if (this.player.hp <= 0) this.killPlayer();
  }

  pickup() {
    const idx = this.items.findIndex((it) => it.x === this.player.x && it.y === this.player.y);
    if (idx < 0) return;
    const it = this.items[idx];
    if (it.gold) {
      this.player.gold += it.gold;
      this.message(`金貨を ${it.gold} 枚拾った。`, 'gold');
    } else if (it.item) {
      this.player.inventory.push(it.item);
      this.message(`${itemName(it.item)} を拾った。`, 'good');
    }
    this.items.splice(idx, 1);
  }

  gainXp(amount) {
    this.player.xp += amount;
    while (this.player.xp >= this.player.xpNext) {
      this.player.xp -= this.player.xpNext;
      this.levelUp();
    }
  }
  levelUp() {
    const p = this.player;
    p.level += 1;
    p.xpNext = Math.floor(p.xpNext * 1.5);
    p.maxHp += 5; p.hp = p.maxHp;
    p.maxMp += 2; p.mp = p.maxMp;
    p.atk += 2; p.def += 1;
    this.message(`レベルアップ！ Lv${p.level} になった。`, 'good');
  }

  async descend() {
    if (this.dead) return false;
    if (this.grid[this.player.y][this.player.x] !== TILE.STAIRS_DOWN) {
      this.message('ここに階段はない。「>」の上で試そう。', 'sys');
      return false;
    }
    await this.goToFloor(this.floor + 1);
    return true;
  }

  // ---- 装備・アイテム ----
  equipFromInventory(i) {
    const inv = this.player.inventory, it = inv[i];
    if (!it) return;
    if (!isEquippable(it)) { this.message('それは装備できない。', 'sys'); return; }
    inv.splice(i, 1);
    const slot = it.kind, prev = this.player.equipment[slot];
    this.player.equipment[slot] = it;
    if (prev) inv.push(prev);
    this.message(`${itemName(it)} を装備した。`, 'good');
  }
  unequip(slot) {
    const cur = this.player.equipment[slot];
    if (!cur) return;
    this.player.equipment[slot] = null;
    this.player.inventory.push(cur);
    this.message(`${itemName(cur)} を外した。`, 'sys');
  }
  dropItem(i) {
    const inv = this.player.inventory, it = inv[i];
    if (!it) return;
    inv.splice(i, 1);
    this.items.push({ x: this.player.x, y: this.player.y, sym: it.sym, color: it.color, item: it });
    this.message(`${itemName(it)} を床に置いた。`, 'sys');
  }

  // API無し時の簡易使用（名前から推定）
  deterministicConsume(it) {
    const p = this.player, n = it.name;
    if (it.kind === 'potion') {
      if (n.includes('魔力')) { p.maxMp += 1; p.mp = p.maxMp; this.message('魔力が満ちた。', 'good'); }
      else if (n.includes('力')) { p.atk += 1; this.message('力がみなぎる（攻撃力+1）。', 'good'); }
      else if (n.includes('上級')) { p.maxHp += 2; const h = randint(20, 30); p.hp = Math.min(p.maxHp, p.hp + h); this.message(`HPが ${h} 回復した。`, 'good'); }
      else { const h = randint(8, 14); p.hp = Math.min(p.maxHp, p.hp + h); this.message(`HPが ${h} 回復した。`, 'good'); }
    } else {
      if (n.includes('テレポート')) { const s = this.randomFloorTile(); if (s) { p.x = s.x; p.y = s.y; this.computeFOV(); } this.message('別の場所へ飛ばされた。', 'good'); }
      else if (n.includes('地図')) { this.revealMap(); this.message('この階の地図が判明した。', 'good'); }
      else if (n.includes('武器強化')) { const w = p.equipment.weapon; if (w) { w.ench = (w.ench || 0) + 1; this.message(`${itemName(w)} が輝いた。`, 'good'); } else this.message('武器を装備していない。', 'bad'); }
      else if (n.includes('防具強化')) { const a = p.equipment.armor || p.equipment.shield; if (a) { a.ench = (a.ench || 0) + 1; this.message(`${itemName(a)} が硬くなった。`, 'good'); } else this.message('防具を装備していない。', 'bad'); }
      else this.message('巻物を読んだが、はっきりした効果はなかった。', 'sys');
    }
  }

  randomFloorTile() {
    for (let t = 0; t < 200; t++) {
      const x = randint(1, MAP_W - 2), y = randint(1, MAP_H - 2);
      if (!isWalkable(this.grid[y][x])) continue;
      if (this.monsters.some((m) => m.x === x && m.y === y)) continue;
      return { x, y };
    }
    return null;
  }
  revealMap() {
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (this.grid[y][x] !== TILE.WALL) this.seen[y][x] = true;
    }
  }

  // ---- モンスター行動 ----
  endTurn() {
    if (this.dead) return;
    for (const mon of [...this.monsters]) {
      if (this.dead) break;
      this.monsterAct(mon);
    }
    // 状態異常の経過
    this.tickEntity(this.player, true);
    if (!this.dead) {
      const survivors = [];
      for (const mon of this.monsters) {
        this.tickEntity(mon, false);
        if (mon.hp <= 0) { this.message(`${mon.name}は倒れた。`, 'good'); this.gainXp(mon.xp); }
        else survivors.push(mon);
      }
      this.monsters = survivors;
    }
    this.computeFOV();
  }

  monsterAct(mon) {
    if (this.isIncapacitated(mon)) return;
    const p = this.player, d = dist(mon, p);
    const flee = this.hasStatus(mon, '恐怖');
    const confused = this.isConfused(mon);

    if (d <= 1 && !flee && !confused) { this.monsterAttack(mon); return; }

    let dx, dy;
    if (confused) { dx = randint(-1, 1); dy = randint(-1, 1); }
    else if (flee) { dx = Math.sign(mon.x - p.x); dy = Math.sign(mon.y - p.y); }
    else {
      if (!(d <= 7 && this.visible[mon.y][mon.x])) return;
      dx = Math.sign(p.x - mon.x); dy = Math.sign(p.y - mon.y);
    }
    this.moveMonster(mon, dx, dy);
  }

  moveMonster(mon, dx, dy) {
    const p = this.player;
    const tries = [[dx, dy], [dx, 0], [0, dy]];
    for (const [mx, my] of tries) {
      if (mx === 0 && my === 0) continue;
      const nx = mon.x + mx, ny = mon.y + my;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      if (nx === p.x && ny === p.y) { this.monsterAttack(mon); return; }
      if (!isWalkable(this.grid[ny][nx])) continue;
      if (this.monsters.some((m) => m !== mon && m.x === nx && m.y === ny)) continue;
      mon.x = nx; mon.y = ny; return;
    }
  }

  monsterAttack(mon) {
    delete this.player.statuses['睡眠'];
    const raw = mon.atk - this.defTotal() + randint(-1, 1);
    const dmg = mon.atk === 0 ? 0 : Math.max(1, raw);
    if (dmg > 0) {
      this.player.hp -= dmg;
      this.message(`${mon.name}の攻撃！ ${dmg} のダメージ。`, 'bad');
    } else {
      this.message(`${mon.name}がこちらをじっと見つめる。`, 'bad');
    }
    if (mon.ability && Math.random() < 0.35) {
      const turns = mon.ability === '石化' ? randint(3, 5) : randint(2, 4);
      this.applyStatus(this.player, mon.ability, turns);
      this.message(`${mon.ability}状態になった！`, 'bad');
    }
    if (this.player.hp <= 0) this.killPlayer();
  }

  killPlayer() {
    this.player.hp = 0;
    this.dead = true;
    this.message(`あなたは地下${this.floor}階で力尽きた……。`, 'bad');
    this.message('「設定」→「最初から」で再挑戦できる。', 'sys');
  }

  // ---- 状態要約（LLM用） ----
  statusString(ent) {
    const ks = Object.keys(ent.statuses);
    return ks.length ? ks.map((k) => `${k}${ent.statuses[k]}`).join(' ') : '';
  }
  describeSurroundings() {
    const p = this.player;
    const dirs = [['北', 0, -1], ['南', 0, 1], ['東', 1, 0], ['西', -1, 0]];
    return dirs.map(([name, dx, dy]) => {
      const x = p.x + dx, y = p.y + dy;
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return `${name}は岩壁`;
      const t = this.grid[y][x];
      if (t === TILE.WALL) return `${name}は壁`;
      if (t === TILE.STAIRS_DOWN) return `${name}に下り階段`;
      return `${name}は通路`;
    }).join('、');
  }
  underfootDesc() {
    if (this.grid[this.player.y][this.player.x] === TILE.STAIRS_DOWN) return '下り階段の上';
    const it = this.items.find((i) => i.x === this.player.x && i.y === this.player.y);
    if (it) return it.gold ? '金貨の上' : `${itemName(it.item)}の上`;
    return '石畳の床';
  }
  nearbyTrapDesc() {
    const known = this.traps.filter((t) => t.known && dist(t, this.player) <= 5);
    return known.length ? known.map((t) => `${TRAP_NAME[t.type]}(${dirName(Math.sign(t.x - this.player.x), Math.sign(t.y - this.player.y))})`).join('、') : '';
  }
  nearbyMonsters() {
    return this.monsters
      .filter((m) => this.visible[m.y][m.x] && dist(m, this.player) <= 8)
      .map((m) => ({
        id: m.id, name: m.name, hp: m.hp, maxHp: m.maxHp,
        dist: dist(m, this.player),
        dir: dirName(Math.sign(m.x - this.player.x), Math.sign(m.y - this.player.y)),
        statuses: this.statusString(m),
      }));
  }
  equipmentDesc() {
    const e = this.player.equipment;
    return `武器:${itemName(e.weapon)} / 防具:${itemName(e.armor)} / 盾:${itemName(e.shield)}`;
  }
  stateSummary() {
    const p = this.player;
    return {
      floor: this.floor,
      theme: this.roster?.theme || '未知の階層',
      layout: this.roster?.layout || '不明',
      level: p.level, xp: p.xp, xpNext: p.xpNext,
      hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp,
      atk: this.atkTotal(), def: this.defTotal(), gold: p.gold,
      playerStatus: this.statusString(p),
      equipment: this.equipmentDesc(),
      inventory: p.inventory.map((it) => itemName(it)),
      underfoot: this.underfootDesc(),
      surroundings: this.describeSurroundings(),
      nearbyTraps: this.nearbyTrapDesc(),
      monsters: this.nearbyMonsters(),
    };
  }

  // ---- LLM判定の適用（自由行動／アイテム使用 共通） ----
  applyEffects(eff) {
    const p = this.player;
    if (eff.narration) this.message(eff.narration, 'gm');

    if (eff.hp_delta) p.hp = Math.max(0, Math.min(p.maxHp, p.hp + clampInt(eff.hp_delta, -40, 40)));
    if (eff.mp_delta) p.mp = Math.max(0, Math.min(p.maxMp, p.mp + clampInt(eff.mp_delta, -20, 20)));
    if (eff.gold_delta) p.gold = Math.max(0, p.gold + clampInt(eff.gold_delta, -100, 100));
    if (eff.xp_delta && eff.xp_delta > 0) this.gainXp(clampInt(eff.xp_delta, 0, 50));

    if (Array.isArray(eff.add_items)) {
      for (const name of eff.add_items) {
        if (!name) continue;
        const known = resolveByName(name);
        if (known) p.inventory.push(known);
        else p.inventory.push({ id: 'misc', name: String(name).slice(0, 20), kind: 'misc', sym: '*', color: '#aaa' });
      }
    }
    if (Array.isArray(eff.remove_items)) {
      for (const name of eff.remove_items) {
        const base = String(name).replace(/[+\-]\d+$/, '').trim();
        const idx = p.inventory.findIndex((it) => it.name === base || itemName(it) === name);
        if (idx >= 0) p.inventory.splice(idx, 1);
      }
    }

    if (Array.isArray(eff.player_status)) {
      for (const s of eff.player_status) if (s && s.name) this.applyStatus(p, s.name, s.turns);
    }
    if (Array.isArray(eff.clear_status)) {
      for (const name of eff.clear_status) delete p.statuses[name];
    }

    if (Array.isArray(eff.monster_effects)) {
      for (const me of eff.monster_effects) {
        const mon = this.monsters.find((m) => m.id === me.id);
        if (!mon) continue;
        if (me.hp_delta) {
          mon.hp += clampInt(me.hp_delta, -40, 10);
          if (mon.hp <= 0) {
            this.message(`${mon.name}は倒れた。`, 'good');
            this.gainXp(mon.xp);
            this.monsters = this.monsters.filter((m) => m !== mon);
            continue;
          }
        }
        if (me.status && STATUS_INFO[me.status]) {
          this.applyStatus(mon, me.status, me.status_turns);
          this.message(`${mon.name}は${me.status}状態になった。`, 'good');
        }
      }
    }

    if (eff.reveal_map) this.revealMap();
    if (eff.teleport) {
      const s = this.randomFloorTile();
      if (s) { p.x = s.x; p.y = s.y; this.computeFOV(); }
    }

    let moved = false;
    if (eff.move_dx || eff.move_dy) {
      const dx = Math.sign(eff.move_dx || 0), dy = Math.sign(eff.move_dy || 0);
      const nx = p.x + dx, ny = p.y + dy;
      if (nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H && isWalkable(this.grid[ny][nx])
          && !this.monsters.some((m) => m.x === nx && m.y === ny)) {
        p.x = nx; p.y = ny; this.triggerTrap(); this.pickup(); moved = true;
      }
    }

    if (p.hp <= 0) { this.killPlayer(); this.render(); return; }
    if (eff.end_turn) this.endTurn();
    else if (moved) this.computeFOV();
    if (p.hp <= 0) this.killPlayer();
    this.render();
  }
}

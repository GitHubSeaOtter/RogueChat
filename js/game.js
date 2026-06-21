import {
  TILE, MAP_W, MAP_H, generateDungeon, center, isWalkable,
} from './dungeon.js';
import {
  makeItem, itemName, isEquippable, pickFloorItem, resolveByName,
} from './items.js';

// モンスター定義（深いほど強いものが出る）
const MONSTER_TYPES = [
  { sym: 'r', name: 'ドブネズミ', hp: 4,  atk: 2,  def: 0, xp: 2,  color: '#a98', minF: 1 },
  { sym: 'b', name: 'コウモリ',   hp: 5,  atk: 3,  def: 0, xp: 3,  color: '#9af', minF: 1 },
  { sym: 'k', name: 'コボルト',   hp: 8,  atk: 4,  def: 1, xp: 5,  color: '#7c5', minF: 2 },
  { sym: 'g', name: 'ゴブリン',   hp: 10, atk: 5,  def: 1, xp: 7,  color: '#5b6', minF: 2 },
  { sym: 'o', name: 'オーク',     hp: 16, atk: 7,  def: 2, xp: 12, color: '#3a4', minF: 4 },
  { sym: 's', name: 'スケルトン', hp: 14, atk: 8,  def: 3, xp: 14, color: '#ddd', minF: 5 },
  { sym: 't', name: 'トロル',     hp: 26, atk: 10, def: 3, xp: 22, color: '#696', minF: 7 },
  { sym: 'D', name: 'ドラゴン',   hp: 40, atk: 14, def: 5, xp: 40, color: '#e55', minF: 9 },
];

const GLYPH_COLOR = {
  '#': '#3b454e',
  '.': '#4a5560',
  '+': '#b5814a',
  '>': '#5fd1e0',
  '@': '#ffe27a',
  '$': '#e5c07b',
};

function randint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function dist(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }

export class Game {
  constructor(canvas, log) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.log = log;
    this.cell = 22;
    this.newGame();
  }

  newGame() {
    this.player = {
      x: 0, y: 0,
      hp: 20, maxHp: 20,
      mp: 5, maxMp: 5,
      atk: 5, def: 1, // 基礎値（レベルアップで増える）
      level: 1, xp: 0, xpNext: 20,
      gold: 0,
      inventory: [],
      equipment: { weapon: null, armor: null, shield: null },
    };
    // 初期装備と所持品
    this.player.equipment.weapon = makeItem('dagger');
    this.player.equipment.armor = makeItem('leather_armor');
    this.player.inventory.push(makeItem('potion_healing'));
    this.player.inventory.push(makeItem('potion_healing'));

    this.floor = 1;
    this.dead = false;
    this.clearLog();
    this.buildFloor();
    this.message('地下へと続く階段を降りた。RogueChat の世界へようこそ。', 'sys');
    this.message('「持ち物」から装備の変更やアイテムの使用ができる。', 'sys');
    this.message('自由入力欄に行動を打ち込めば、GM(LLM)が結果を判定する。', 'sys');
    this.render();
  }

  // ---- 実効ステータス（基礎値 + 装備）----
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

  buildFloor() {
    const { grid, rooms } = generateDungeon(this.floor);
    this.grid = grid;
    this.rooms = rooms;
    this.seen = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(false));
    this.visible = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(false));

    const start = center(rooms[0]);
    this.player.x = start.x;
    this.player.y = start.y;

    this.items = [];
    this.spawnItems();
    this.monsters = [];
    this.spawnMonsters();
    this.computeFOV();
  }

  spawnItems() {
    const count = randint(2, 4);
    for (let i = 0; i < count; i++) {
      const room = this.rooms[randint(1, this.rooms.length - 1)];
      const x = randint(room.x, room.x + room.w - 1);
      const y = randint(room.y, room.y + room.h - 1);
      if (x === this.player.x && y === this.player.y) continue;

      if (Math.random() < 0.4) {
        this.items.push({ x, y, sym: '$', color: GLYPH_COLOR['$'], gold: randint(5, 25) });
      } else {
        const it = pickFloorItem(this.floor);
        this.items.push({ x, y, sym: it.sym, color: it.color, item: it });
      }
    }
  }

  spawnMonsters() {
    const pool = MONSTER_TYPES.filter((m) => m.minF <= this.floor);
    const count = randint(4, 7);
    for (let i = 0; i < count; i++) {
      const room = this.rooms[randint(1, this.rooms.length - 1)];
      const x = randint(room.x, room.x + room.w - 1);
      const y = randint(room.y, room.y + room.h - 1);
      if (x === this.player.x && y === this.player.y) continue;
      const t = pool[randint(0, pool.length - 1)];
      this.monsters.push({ ...t, x, y, hp: t.hp, maxHp: t.hp });
    }
  }

  // ---- 視界（簡易レイキャスト）----
  computeFOV() {
    const radius = 7;
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
    let err = dx - dy;
    let x = x0, y = y0;
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
    const main = this.canvas.parentElement;
    const w = main.clientWidth;
    const h = main.clientHeight;
    const viewCols = Math.min(MAP_W, Math.floor(w / 16));
    const viewRows = Math.min(MAP_H, Math.floor(h / 16));
    const cellW = Math.floor(w / viewCols);
    const cellH = Math.floor(h / viewRows);
    this.cell = Math.max(12, Math.min(cellW, cellH, 30));
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
    if (!this.viewCols) this.resize();
    const ctx = this.ctx;
    const c = this.cell;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.font = `${Math.floor(c * 0.82)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const halfC = Math.floor(this.viewCols / 2);
    const halfR = Math.floor(this.viewRows / 2);
    const ox = this.player.x - halfC;
    const oy = this.player.y - halfR;

    for (let row = 0; row < this.viewRows; row++) {
      for (let col = 0; col < this.viewCols; col++) {
        const mx = ox + col;
        const my = oy + row;
        if (mx < 0 || my < 0 || mx >= MAP_W || my >= MAP_H) continue;
        if (!this.seen[my][mx]) continue;
        const vis = this.visible[my][mx];

        let glyph = this.grid[my][mx];
        let color = GLYPH_COLOR[glyph] || '#4a5560';

        if (vis) {
          const item = this.items.find((it) => it.x === mx && it.y === my);
          if (item) { glyph = item.sym; color = item.color; }
          const mon = this.monsters.find((m) => m.x === mx && m.y === my);
          if (mon) { glyph = mon.sym; color = mon.color; }
          if (mx === this.player.x && my === this.player.y) {
            glyph = '@'; color = GLYPH_COLOR['@'];
          }
        } else {
          color = '#1c232a'; // 記憶済みは暗く
        }

        const px = col * c + c / 2;
        const py = row * c + c / 2;
        ctx.fillStyle = color;
        ctx.fillText(glyph, px, py);
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
    if (this.dead) return false;
    if (dx === 0 && dy === 0) { this.endTurn(); return true; } // 待機

    const nx = this.player.x + dx;
    const ny = this.player.y + dy;
    if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) return false;

    const mon = this.monsters.find((m) => m.x === nx && m.y === ny);
    if (mon) {
      this.attackMonster(mon);
      this.endTurn();
      return true;
    }

    if (!isWalkable(this.grid[ny][nx])) return false;

    this.player.x = nx;
    this.player.y = ny;
    this.pickup();
    this.endTurn();
    return true;
  }

  attackMonster(mon) {
    const dmg = Math.max(1, this.atkTotal() - mon.def + randint(-1, 2));
    mon.hp -= dmg;
    this.message(`${mon.name}に ${dmg} のダメージ。`, 'good');
    if (mon.hp <= 0) {
      this.message(`${mon.name}を倒した！（経験値 +${mon.xp}）`, 'good');
      this.gainXp(mon.xp);
      this.monsters = this.monsters.filter((m) => m !== mon);
    }
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
    this.message(`レベルアップ！ Lv${p.level} になった。心身が満たされる。`, 'good');
  }

  // 階段を降りる
  descend() {
    if (this.dead) return;
    if (this.grid[this.player.y][this.player.x] !== TILE.STAIRS_DOWN) {
      this.message('ここに階段はない。「>」の上で試そう。', 'sys');
      return;
    }
    this.floor += 1;
    this.message(`地下${this.floor}階へ降りた。空気が重くなる。`, 'sys');
    this.buildFloor();
    this.render();
  }

  // ---- 装備・アイテム ----
  equipFromInventory(i) {
    const inv = this.player.inventory;
    const it = inv[i];
    if (!it) return;
    if (!isEquippable(it)) { this.message('それは装備できない。', 'sys'); return; }
    inv.splice(i, 1);
    const slot = it.kind; // weapon / armor / shield
    const prev = this.player.equipment[slot];
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

  // 消費アイテムを使う。ターンを消費したら true を返す
  consume(i) {
    if (this.dead) return false;
    const inv = this.player.inventory;
    const it = inv[i];
    if (!it) return false;
    let used = true;
    if (it.kind === 'potion') used = this.quaffPotion(it);
    else if (it.kind === 'scroll') used = this.readScroll(it);
    else { this.message('それは使えない。', 'sys'); return false; }

    if (used) inv.splice(i, 1);
    return used;
  }

  quaffPotion(it) {
    const p = this.player;
    switch (it.effect) {
      case 'heal': {
        const h = randint(8, 14);
        p.hp = Math.min(p.maxHp, p.hp + h);
        this.message(`回復薬を飲んだ。HPが ${h} 回復した。`, 'good');
        return true;
      }
      case 'extraheal': {
        const h = randint(20, 30);
        p.maxHp += 2;
        p.hp = Math.min(p.maxHp, p.hp + h);
        this.message(`上級回復薬を飲んだ。HPが ${h} 回復し、最大HPも上がった。`, 'good');
        return true;
      }
      case 'energy': {
        p.maxMp += 1;
        p.mp = p.maxMp;
        this.message('魔力の薬を飲んだ。魔力が満ちあふれる。', 'good');
        return true;
      }
      case 'strength': {
        p.atk += 1;
        this.message('力の薬を飲んだ。力がみなぎる（攻撃力+1）。', 'good');
        return true;
      }
      case 'gainlevel': {
        this.message('経験の薬を飲んだ。一段強くなった気がする。', 'good');
        this.levelUp();
        return true;
      }
      default:
        this.message('奇妙な味がしたが、何も起きなかった。', 'sys');
        return true;
    }
  }

  readScroll(it) {
    const p = this.player;
    switch (it.effect) {
      case 'teleport': {
        const spot = this.randomFloorTile();
        if (spot) { p.x = spot.x; p.y = spot.y; this.computeFOV(); }
        this.message('テレポートの巻物を読んだ。視界が歪み、別の場所へ飛ばされた。', 'good');
        return true;
      }
      case 'mapping': {
        for (let y = 0; y < MAP_H; y++) {
          for (let x = 0; x < MAP_W; x++) {
            if (this.grid[y][x] !== TILE.WALL) this.seen[y][x] = true;
          }
        }
        this.message('魔法地図の巻物を読んだ。この階の構造が頭に流れ込む。', 'good');
        return true;
      }
      case 'enchant_weapon': {
        const w = p.equipment.weapon;
        if (!w) { this.message('武器を装備していない。巻物は無駄になった。', 'bad'); return true; }
        w.ench = (w.ench || 0) + 1;
        this.message(`武器強化の巻物を読んだ。${itemName(w)} が輝いた。`, 'good');
        return true;
      }
      case 'enchant_armor': {
        const a = p.equipment.armor || p.equipment.shield;
        if (!a) { this.message('防具を装備していない。巻物は無駄になった。', 'bad'); return true; }
        a.ench = (a.ench || 0) + 1;
        this.message(`防具強化の巻物を読んだ。${itemName(a)} が硬くなった。`, 'good');
        return true;
      }
      default:
        this.message('巻物には読めない文字が並んでいた。', 'sys');
        return true;
    }
  }

  randomFloorTile() {
    for (let tries = 0; tries < 200; tries++) {
      const x = randint(1, MAP_W - 2);
      const y = randint(1, MAP_H - 2);
      if (!isWalkable(this.grid[y][x])) continue;
      if (this.monsters.some((m) => m.x === x && m.y === y)) continue;
      return { x, y };
    }
    return null;
  }

  // ---- モンスター行動 ----
  endTurn() {
    this.computeFOV();
    if (this.dead) return;
    for (const mon of [...this.monsters]) {
      if (this.dead) break;
      this.monsterAct(mon);
    }
    this.computeFOV();
  }

  monsterAct(mon) {
    const p = this.player;
    const d = dist(mon, p);
    if (d <= 1) {
      const dmg = Math.max(1, mon.atk - this.defTotal() + randint(-1, 1));
      this.player.hp -= dmg;
      this.message(`${mon.name}の攻撃！ ${dmg} のダメージを受けた。`, 'bad');
      if (this.player.hp <= 0) this.killPlayer();
      return;
    }
    if (d <= 7 && this.visible[mon.y][mon.x]) {
      const sx = Math.sign(p.x - mon.x);
      const sy = Math.sign(p.y - mon.y);
      const tries = [[sx, sy], [sx, 0], [0, sy]];
      for (const [dx, dy] of tries) {
        if (dx === 0 && dy === 0) continue;
        const nx = mon.x + dx, ny = mon.y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        if (!isWalkable(this.grid[ny][nx])) continue;
        if (nx === p.x && ny === p.y) continue;
        if (this.monsters.some((m) => m !== mon && m.x === nx && m.y === ny)) continue;
        mon.x = nx; mon.y = ny;
        break;
      }
    }
  }

  killPlayer() {
    this.player.hp = 0;
    this.dead = true;
    this.message(`あなたは地下${this.floor}階で力尽きた……。`, 'bad');
    this.message('「設定」→「最初から」で再挑戦できる。', 'sys');
  }

  // ---- LLM連携：状態要約 ----
  describeSurroundings() {
    const p = this.player;
    const dirs = [['北', 0, -1], ['南', 0, 1], ['東', 1, 0], ['西', -1, 0]];
    const parts = [];
    for (const [name, dx, dy] of dirs) {
      const x = p.x + dx, y = p.y + dy;
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) { parts.push(`${name}は岩壁`); continue; }
      const t = this.grid[y][x];
      if (t === TILE.WALL) parts.push(`${name}は壁`);
      else if (t === TILE.STAIRS_DOWN) parts.push(`${name}に下り階段`);
      else parts.push(`${name}は通路`);
    }
    return parts.join('、');
  }

  underfootDesc() {
    const t = this.grid[this.player.y][this.player.x];
    if (t === TILE.STAIRS_DOWN) return '下り階段の上';
    const it = this.items.find((i) => i.x === this.player.x && i.y === this.player.y);
    if (it) return it.gold ? '金貨の上' : `${itemName(it.item)}の上`;
    return '石畳の床';
  }

  visibleMonsterNames() {
    return this.monsters
      .filter((m) => this.visible[m.y][m.x])
      .map((m) => `${m.name}(距離${dist(m, this.player)})`);
  }

  equipmentDesc() {
    const e = this.player.equipment;
    return `武器:${itemName(e.weapon)} / 防具:${itemName(e.armor)} / 盾:${itemName(e.shield)}`;
  }

  stateSummary() {
    const p = this.player;
    return {
      floor: this.floor,
      level: p.level, xp: p.xp, xpNext: p.xpNext,
      hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp,
      atk: this.atkTotal(), def: this.defTotal(), gold: p.gold,
      equipment: this.equipmentDesc(),
      inventory: p.inventory.map((it) => itemName(it)),
      underfoot: this.underfootDesc(),
      surroundings: this.describeSurroundings(),
      monsters: this.visibleMonsterNames(),
    };
  }

  // ---- LLM連携：判定結果の適用 ----
  applyEffects(eff) {
    const p = this.player;
    if (eff.narration) this.message(eff.narration, 'gm');

    if (eff.hp_delta) p.hp = Math.max(0, Math.min(p.maxHp, p.hp + eff.hp_delta));
    if (eff.mp_delta) p.mp = Math.max(0, Math.min(p.maxMp, p.mp + eff.mp_delta));
    if (eff.gold_delta) p.gold = Math.max(0, p.gold + eff.gold_delta);

    if (Array.isArray(eff.add_items)) {
      for (const name of eff.add_items) {
        if (!name) continue;
        const known = resolveByName(name);
        if (known) {
          p.inventory.push(known);
        } else {
          // 未知の名前は飾りアイテムとして所持品に加える
          p.inventory.push({ id: 'misc', name: String(name), kind: 'misc', sym: '*', color: '#aaa' });
        }
      }
    }
    if (Array.isArray(eff.remove_items)) {
      for (const name of eff.remove_items) {
        const base = String(name).replace(/[+\-]\d+$/, '').trim();
        const idx = p.inventory.findIndex((it) => it.name === base || itemName(it) === name);
        if (idx >= 0) p.inventory.splice(idx, 1);
      }
    }
    if (eff.xp_delta && eff.xp_delta > 0) this.gainXp(eff.xp_delta);

    let consumed = false;
    if (eff.move_dx || eff.move_dy) {
      const dx = Math.sign(eff.move_dx || 0);
      const dy = Math.sign(eff.move_dy || 0);
      const nx = p.x + dx, ny = p.y + dy;
      if (nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H && isWalkable(this.grid[ny][nx])
          && !this.monsters.some((m) => m.x === nx && m.y === ny)) {
        p.x = nx; p.y = ny; this.pickup();
        consumed = true;
      }
    }

    if (p.hp <= 0) { this.killPlayer(); this.render(); return; }

    if (eff.end_turn) this.endTurn();
    else if (consumed) this.computeFOV();

    if (p.hp <= 0) this.killPlayer();
    this.render();
  }
}

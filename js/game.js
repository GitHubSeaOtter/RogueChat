import {
  TILE, MAP_W, MAP_H, generateDungeon, center, isWalkable,
} from './dungeon.js';

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
  '!': '#d36cd3',
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
      atk: 5, def: 1,
      level: 1, xp: 0, xpNext: 20,
      gold: 0,
      inventory: [],
    };
    this.floor = 1;
    this.dead = false;
    this.clearLog();
    this.buildFloor();
    this.message('地下へと続く階段を降りた。RogueChat の世界へようこそ。', 'sys');
    this.message('自由入力欄に行動を打ち込めば、GM(LLM)が結果を判定する。', 'sys');
    this.render();
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
      const kind = Math.random() < 0.5 ? 'potion' : 'gold';
      this.items.push({
        x, y,
        kind,
        sym: kind === 'potion' ? '!' : '$',
        amount: kind === 'gold' ? randint(5, 25) : 0,
      });
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
          // アイテム・モンスター・プレイヤーは可視時のみ表示
          const item = this.items.find((it) => it.x === mx && it.y === my);
          if (item) { glyph = item.sym; color = GLYPH_COLOR[item.sym]; }
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
  // 戻り値: ターンを消費したか
  tryMove(dx, dy) {
    if (this.dead) return false;
    if (dx === 0 && dy === 0) { return true; } // その場で待機

    const nx = this.player.x + dx;
    const ny = this.player.y + dy;
    if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) return false;

    const mon = this.monsters.find((m) => m.x === nx && m.y === ny);
    if (mon) {
      this.attackMonster(mon);
      this.endTurn();
      return true;
    }

    if (!isWalkable(this.grid[ny][nx])) {
      return false; // 壁：ターン消費なし
    }

    this.player.x = nx;
    this.player.y = ny;
    this.pickup();
    this.endTurn();
    return true;
  }

  attackMonster(mon) {
    const dmg = Math.max(1, this.player.atk - mon.def + randint(-1, 2));
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
    if (it.kind === 'gold') {
      this.player.gold += it.amount;
      this.message(`金貨を ${it.amount} 枚拾った。`, 'gold');
    } else {
      this.player.inventory.push('回復薬');
      this.message('回復薬を拾った。「持ち物」または自由入力で使える。', 'good');
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

  // 持ち物（回復薬を使う簡易版）
  useInventory() {
    if (this.dead) return;
    const idx = this.player.inventory.indexOf('回復薬');
    if (idx < 0) {
      this.message(`持ち物: ${this.player.inventory.length ? this.player.inventory.join('、') : 'なし'}`, 'sys');
      return;
    }
    const heal = randint(8, 14);
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
    this.player.inventory.splice(idx, 1);
    this.message(`回復薬を飲んだ。HPが ${heal} 回復した。`, 'good');
    this.endTurn();
    this.render();
  }

  // 休む：その場で1ターン待機しつつ少し回復（モンスターが近いと危険）
  rest() {
    if (this.dead) return;
    const nearMon = this.monsters.some((m) => dist(m, this.player) <= 4 && this.visible[m.y][m.x]);
    if (!nearMon && Math.random() < 0.6) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 1);
      this.player.mp = Math.min(this.player.maxMp, this.player.mp + 1);
    }
    this.message('ひと息ついた。', 'sys');
    this.endTurn();
    this.render();
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
      const dmg = Math.max(1, mon.atk - this.player.def + randint(-1, 1));
      this.player.hp -= dmg;
      this.message(`${mon.name}の攻撃！ ${dmg} のダメージを受けた。`, 'bad');
      if (this.player.hp <= 0) this.killPlayer();
      return;
    }
    // 視界内なら近づく
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
    const dirs = [
      ['北', 0, -1], ['南', 0, 1], ['東', 1, 0], ['西', -1, 0],
    ];
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
    const item = this.items.find((it) => it.x === this.player.x && it.y === this.player.y);
    if (item) return item.kind === 'gold' ? '金貨の上' : '回復薬の上';
    return '石畳の床';
  }

  visibleMonsterNames() {
    return this.monsters
      .filter((m) => this.visible[m.y][m.x])
      .map((m) => `${m.name}(距離${dist(m, this.player)})`);
  }

  stateSummary() {
    const p = this.player;
    return {
      floor: this.floor,
      level: p.level, xp: p.xp, xpNext: p.xpNext,
      hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp,
      atk: p.atk, def: p.def, gold: p.gold,
      inventory: p.inventory,
      underfoot: this.underfootDesc(),
      surroundings: this.describeSurroundings(),
      monsters: this.visibleMonsterNames(),
    };
  }

  // ---- LLM連携：判定結果の適用 ----
  applyEffects(eff) {
    const p = this.player;
    if (eff.narration) this.message(eff.narration, 'gm');

    if (eff.hp_delta) {
      p.hp = Math.max(0, Math.min(p.maxHp, p.hp + eff.hp_delta));
    }
    if (eff.mp_delta) {
      p.mp = Math.max(0, Math.min(p.maxMp, p.mp + eff.mp_delta));
    }
    if (eff.gold_delta) {
      p.gold = Math.max(0, p.gold + eff.gold_delta);
    }
    if (Array.isArray(eff.add_items)) {
      for (const it of eff.add_items) { if (it) p.inventory.push(String(it)); }
    }
    if (Array.isArray(eff.remove_items)) {
      for (const it of eff.remove_items) {
        const idx = p.inventory.indexOf(String(it));
        if (idx >= 0) p.inventory.splice(idx, 1);
      }
    }
    if (eff.xp_delta && eff.xp_delta > 0) this.gainXp(eff.xp_delta);

    // 移動を伴う行動
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

    if (eff.end_turn) {
      this.endTurn();
    } else if (consumed) {
      this.computeFOV();
    }

    if (p.hp <= 0) this.killPlayer();
    this.render();
  }
}

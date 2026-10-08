import {
  generateDungeon,
  distance,
  lineOfSight,
  TILES,
  WIDTH,
  HEIGHT,
  LAST_FLOOR,
} from "./dungeon.js";
import { makeItem, BACKGROUNDS, SKILLS, ITEMS } from "./items.js";

export const SAVE_KEY = "roguechat_v2_run";
const clamp = (n, lo, hi) =>
  Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));
const clean = (value, size = 200) =>
  typeof value === "string" ? value.slice(0, size) : "";
const SAVE_FIELDS = [
  "rng",
  "seed",
  "serial",
  "turn",
  "revision",
  "floor",
  "ended",
  "messages",
  "memory",
  "background",
  "player",
  "dungeon",
  "seen",
  "knownTerrain",
];
const EFFECTS = new Set([
  "damage",
  "stun",
  "peace",
  "heal",
  "cleanse",
  "ward",
  "move",
  "terrain",
  "create",
  "reveal",
]);
const TERRAIN = new Set([".", "~", '"', "=", "*"]);
const COST = {
  damage: 1,
  stun: 1,
  peace: 2,
  heal: 2,
  cleanse: 1,
  ward: 1,
  move: 1,
  terrain: 1,
  create: 2,
  reveal: 1,
};
const DIFFICULTY = {
  damage: 2,
  stun: 2,
  peace: 3,
  heal: 2,
  cleanse: 1,
  ward: 2,
  move: 2,
  terrain: 2,
  create: 3,
  reveal: 1,
};
export class Game {
  constructor({
    seed = Date.now(),
    background = "wanderer",
    name = "名もなき旅人",
    personality = "危機でも工夫を忘れない。",
  } = {}) {
    this.rng = Number(seed) >>> 0 || 1;
    this.seed = this.rng;
    this.serial = 0;
    this.turn = 0;
    this.revision = 0;
    this.floor = 1;
    this.ended = null;
    this.messages = [];
    this.memory = [];
    this.pending = null;
    this.background = Object.hasOwn(BACKGROUNDS, background)
      ? background
      : "wanderer";
    const b = BACKGROUNDS[this.background];
    this.player = {
      name: clean(name, 16).trim() || "名もなき旅人",
      personality: clean(personality, 160),
      hp: b.hp,
      maxHp: b.hp,
      focus: b.focus,
      maxFocus: b.focus,
      attack: b.attack,
      defense: b.defense,
      skills: { ...b.skills },
      level: 1,
      xp: 0,
      supplies: 3,
      ward: 0,
      poison: 0,
      burning: 0,
      stuck: 0,
      equipment: { weapon: null, armor: null },
      inventory: b.items.map((key) => makeItem(key, this.id())),
    };
    this.loadFloor();
    this.log(
      "第五層の星の核を持ち帰ろう。地図を見る、敵を調べる、考える間は時間が進まない。",
      "story",
    );
  }
  id() {
    return `id-${++this.serial}`;
  }
  random() {
    let t = (this.rng += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    this.rng >>>= 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  log(text, kind = "info") {
    this.messages.push({ text, kind, turn: this.turn });
    this.messages = this.messages.slice(-70);
  }
  loadFloor() {
    this.dungeon = generateDungeon(
      this.floor,
      () => this.random(),
      () => this.id(),
    );
    Object.assign(this.player, this.dungeon.start);
    this.seen = Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(false));
    this.knownTerrain = this.dungeon.grid.map((row) => row.map(() => "#"));
    this.updateVision();
    this.log(
      `B${this.floor} / ${this.dungeon.theme.name} — ${this.dungeon.theme.flavor}`,
      "story",
    );
  }
  tile(x, y) {
    return this.dungeon.grid[y]?.[x] || "#";
  }
  inside(x, y) {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x > 0 &&
      y > 0 &&
      x < WIDTH - 1 &&
      y < HEIGHT - 1
    );
  }
  walkable(x, y) {
    return this.inside(x, y) && !["#", "+"].includes(this.tile(x, y));
  }
  enemyAt(x, y) {
    return this.dungeon.enemies.find((e) => e.hp > 0 && e.x === x && e.y === y);
  }
  rememberedTile(x, y) {
    return this.visible[y]?.[x]
      ? this.tile(x, y)
      : this.knownTerrain[y]?.[x] || "#";
  }
  updateVision() {
    this.visible = Array.from({ length: HEIGHT }, () =>
      Array(WIDTH).fill(false),
    );
    for (let y = 0; y < HEIGHT; y++)
      for (let x = 0; x < WIDTH; x++) {
        if (
          distance(this.player, { x, y }) <= 7 &&
          lineOfSight(this.dungeon.grid, this.player, { x, y })
        ) {
          this.visible[y][x] = true;
          this.seen[y][x] = true;
          this.knownTerrain[y][x] = this.tile(x, y);
        }
      }
  }
  visibleEnemies() {
    return this.dungeon.enemies.filter(
      (e) => e.hp > 0 && this.visible[e.y]?.[e.x],
    );
  }
  threats() {
    return this.visibleEnemies()
      .filter((e) => !e.friendly && e.intent && e.stunned === 0)
      .map((e) => ({
        id: e.id,
        name: e.name,
        damage: Math.max(1, e.attack - this.defense()),
        tiles: e.intent.tiles,
        label: e.intent.label,
      }));
  }
  attack() {
    return this.player.attack + (this.player.equipment.weapon?.power || 0);
  }
  defense() {
    return this.player.defense + (this.player.equipment.armor?.power || 0);
  }
  move(dx, dy) {
    if (
      this.ended ||
      !Number.isInteger(dx) ||
      !Number.isInteger(dy) ||
      Math.abs(dx) > 1 ||
      Math.abs(dy) > 1
    )
      return false;
    const p = this.player,
      x = p.x + dx,
      y = p.y + dy;
    if (!dx && !dy) {
      this.log("その場で様子をうかがう。");
      this.endTurn();
      return true;
    }
    if (!this.inside(x, y)) return false;
    // Prevent squeezing diagonally through a sealed corner.
    if (
      dx &&
      dy &&
      (!this.walkable(p.x + dx, p.y) || !this.walkable(p.x, p.y + dy))
    ) {
      this.log("角を斜めに抜けることはできない。");
      return false;
    }
    if (this.tile(x, y) === "#") {
      this.log("石壁だ。自由行動なら道を開けるかもしれない。");
      return false;
    }
    if (p.stuck) {
      p.stuck = 0;
      this.log("糸を振りほどいた。", "warning");
      this.endTurn();
      return true;
    }
    if (this.tile(x, y) === "+") {
      this.dungeon.grid[y][x] = "/";
      this.log("扉を開いた。");
      this.endTurn();
      return true;
    }
    const e = this.enemyAt(x, y);
    if (e && !e.friendly) {
      const damage = this.attack();
      e.hp -= damage;
      this.log(`${e.name}に${damage}ダメージ。`, "combat");
      this.checkKills();
    } else {
      if (e) {
        e.x = p.x;
        e.y = p.y;
      }
      p.x = x;
      p.y = y;
      this.onEnter();
      this.pickup();
    }
    this.endTurn();
    return true;
  }
  pickup() {
    const p = this.player;
    for (const d of this.dungeon.drops.filter(
      (d) => d.x === p.x && d.y === p.y,
    )) {
      if (p.inventory.length >= 18) {
        this.log(
          "持ち物がいっぱい（18個）。使うか置いてから拾おう。",
          "warning",
        );
        continue;
      }
      p.inventory.push(makeItem(d.key, d.id));
      this.dungeon.drops = this.dungeon.drops.filter((x) => x.id !== d.id);
      this.log(`${p.inventory.at(-1).name}を拾った。`, "good");
    }
  }
  onEnter() {
    const tile = this.tile(this.player.x, this.player.y);
    if (tile === "~") {
      this.player.burning = 0;
      this.log("水が火を鎮める。");
    }
    if (tile === "^") this.hurt(4, "露出した罠");
    // Fire is resolved once at turn end, including newly created fire.
    if (tile === '"') {
      this.player.stuck = 1;
      this.log("糸が足に絡む。次の移動は糸をほどく行動になる。", "warning");
    }
  }
  hurt(amount, source) {
    const blocked = Math.min(this.player.ward, amount);
    this.player.ward -= blocked;
    const damage = amount - blocked;
    this.player.hp = Math.max(0, this.player.hp - damage);
    this.log(
      `${source}：HP −${damage}${blocked ? `（護りが${blocked}軽減）` : ""}。`,
      "danger",
    );
    if (this.player.hp <= 0 && !this.ended) {
      this.ended = "dead";
      this.log(
        "あなたの物語はここで途切れた。次の旅には、この記憶を。",
        "danger",
      );
    }
  }
  checkKills() {
    for (const e of this.dungeon.enemies)
      if (e.hp <= 0 && !e.rewarded) {
        e.rewarded = true;
        e.intent = null;
        this.gainXP(e.type === "warden" ? 10 : 3);
        this.log(`${e.name}は倒れた。`, "good");
      }
  }
  gainXP(amount) {
    const p = this.player;
    p.xp += amount;
    while (p.xp >= p.level * 9) {
      p.xp -= p.level * 9;
      p.level++;
      p.maxHp += 3;
      p.hp = Math.min(p.maxHp, p.hp + 6);
      p.maxFocus++;
      p.focus = Math.min(p.maxFocus, p.focus + 3);
      p.attack++;
      if (p.level % 2 === 0) p.skills.wit++;
      else p.skills.spirit++;
      this.log(
        `Lv.${p.level} — HPと集中が回復し、攻撃と判定能力が成長した。`,
        "good",
      );
    }
  }
  endTurn() {
    this.pending = null;
    this.turn++;
    this.revision++;
    if (this.ended) {
      this.updateVision();
      return;
    }
    const p = this.player;
    if (p.poison) {
      p.poison--;
      this.hurt(2, "毒");
    }
    if (!this.ended && p.burning) {
      p.burning--;
      this.hurt(2, "炎上");
    }
    const spread = [];
    for (let y = 1; y < HEIGHT - 1; y++)
      for (let x = 1; x < WIDTH - 1; x++)
        if (this.tile(x, y) === "*") {
          for (const [dx, dy] of [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
          ])
            if (this.tile(x + dx, y + dy) === "=")
              spread.push({ x: x + dx, y: y + dy });
        }
    for (const s of spread) this.dungeon.grid[s.y][s.x] = "*";
    if (!this.ended && this.tile(p.x, p.y) === "*") this.hurt(3, "足元の炎");
    for (const e of this.dungeon.enemies) {
      if (this.ended) break;
      if (e.hp <= 0 || e.friendly) continue;
      if (this.tile(e.x, e.y) === "~") e.burning = 0;
      if (this.tile(e.x, e.y) === "*") {
        e.hp -= 3;
        if (e.hp <= 0) continue;
      }
      if (e.burning) {
        e.hp -= 3;
        e.burning--;
        if (e.hp <= 0) continue;
      }
      if (e.stunned > 0) {
        e.stunned--;
        e.intent = null;
        continue;
      }
      // Resolve the previously advertised attack, never an unadvertised one.
      if (e.intent) {
        if (
          e.intent.tiles.some((t) => t.x === p.x && t.y === p.y) &&
          lineOfSight(this.dungeon.grid, e, p)
        ) {
          this.hurt(Math.max(1, e.attack - this.defense()), e.name);
          if (!this.ended && e.behavior === "poison") p.poison = 2;
          if (!this.ended && e.behavior === "drain")
            p.focus = Math.max(0, p.focus - 2);
        } else this.log(`${e.name}の攻撃は空を切った。`, "combat");
        e.intent = null;
        // A recovery turn after each strike gives time to counterattack.
        continue;
      }
      if (distance(e, p) > 7 || !lineOfSight(this.dungeon.grid, e, p)) continue;
      if (distance(e, p) <= e.range) {
        const tiles = [{ x: p.x, y: p.y }];
        if (e.behavior === "slam")
          for (const [dx, dy] of [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
          ])
            tiles.push({ x: p.x + dx, y: p.y + dy });
        e.intent = {
          tiles,
          label:
            e.behavior === "slam"
              ? "大振り"
              : e.behavior === "ranged"
                ? "射撃"
                : "攻撃",
        };
      } else {
        const candidates = [
          [Math.sign(p.x - e.x), 0],
          [0, Math.sign(p.y - e.y)],
        ];
        candidates.sort(
          (a, b) =>
            distance({ x: e.x + a[0], y: e.y + a[1] }, p) -
            distance({ x: e.x + b[0], y: e.y + b[1] }, p),
        );
        for (const [dx, dy] of candidates) {
          const x = e.x + dx,
            y = e.y + dy;
          if (
            (dx || dy) &&
            this.walkable(x, y) &&
            !this.enemyAt(x, y) &&
            !(x === p.x && y === p.y)
          ) {
            e.x = x;
            e.y = y;
            if (this.tile(x, y) === "^") e.hp -= 4;
            if (this.tile(x, y) === '"' && e.type !== "spider") e.stunned = 1;
            break;
          }
        }
      }
    }
    this.checkKills();
    if (!this.ended && this.turn % 4 === 0)
      p.focus = Math.min(p.maxFocus, p.focus + 1);
    this.updateVision();
  }
  rest() {
    if (this.ended) return false;
    if (this.visibleEnemies().some((e) => !e.friendly)) {
      this.log("敵が見えている。まず視線を切って、安全な場所へ。", "warning");
      return false;
    }
    const camp =
      this.tile(this.player.x, this.player.y) === "&" && !this.dungeon.campUsed;
    if (!camp && !this.player.supplies) {
      this.log("野営には糧食が必要。未使用の野営地なら無料。", "warning");
      return false;
    }
    if (camp) this.dungeon.campUsed = true;
    else this.player.supplies--;
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 12);
    this.player.focus = Math.min(this.player.maxFocus, this.player.focus + 7);
    this.player.poison = this.player.burning = this.player.stuck = 0;
    this.log("野営した。HP＋12、集中＋7。状態異常を解除。", "good");
    this.endTurn();
    return true;
  }
  interact() {
    if (this.ended) return false;
    const p = this.player,
      tile = this.tile(p.x, p.y);
    const obj = this.dungeon.objects.find((o) => o.x === p.x && o.y === p.y);
    if (obj) {
      if (p.inventory.length >= 18) {
        this.log("持ち物がいっぱい。", "warning");
        return false;
      }
      p.inventory.push(
        obj.droppedItem || {
          id: obj.id,
          key: "custom",
          kind: "tool",
          name: obj.name,
          detail: obj.detail,
          symbol: obj.symbol,
          tags: [
            obj.skill === "wit" ? "知" : obj.skill === "might" ? "力" : "心",
          ],
        },
      );
      this.dungeon.objects = this.dungeon.objects.filter(
        (o) => o.id !== obj.id,
      );
      this.log(`${obj.name}を手に取った。自由行動の道具として使える。`, "good");
      this.endTurn();
      return true;
    }
    if (tile === ">") {
      this.floor++;
      p.hp = Math.min(p.maxHp, p.hp + 4);
      p.focus = Math.min(p.maxFocus, p.focus + 3);
      p.poison = p.burning = p.stuck = 0;
      this.revision++;
      this.pending = null;
      this.turn++;
      this.loadFloor();
      return true;
    }
    if (tile === "0") {
      const guardian = this.dungeon.enemies.find((e) => e.type === "warden");
      if (guardian && guardian.hp > 0 && !guardian.friendly) {
        this.log("守護者が星を護っている。戦う以外の道もある。", "warning");
        return false;
      }
      this.ended = "won";
      this.revision++;
      this.pending = null;
      this.log(
        "星を胸に、地上へ。あなたが書き換えた世界は、あなたの不在にも続いていく。",
        "story",
      );
      return true;
    }
    if (tile === "&") return this.rest();
    const before = p.inventory.length;
    this.pickup();
    if (p.inventory.length > before) {
      this.endTurn();
      return true;
    }
    this.log("階段、星の核、野営地、創作した道具の上で使おう。");
    return false;
  }
  useItem(id, target) {
    if (this.ended) return false;
    const p = this.player,
      item = p.inventory.find((i) => i.id === id);
    if (!item) return false;
    if (item.kind === "tool") {
      this.log(
        "この道具は自由行動の判定を助ける。行動に名前を織り込んでみよう。",
      );
      return false;
    }
    if (item.kind === "oil") {
      const e = this.visibleEnemies().find(
        (e) => e.id === target && !e.friendly && distance(p, e) <= 3,
      );
      if (!e) {
        this.log("マップで3マス以内の敵を選択してから使おう。", "warning");
        return false;
      }
      e.hp -= 8;
      e.burning = 2;
      this.log(`${e.name}に8ダメージ。2ターン炎上。`, "combat");
    } else if (item.kind === "heal") {
      p.hp = Math.min(p.maxHp, p.hp + 14);
      p.poison = p.burning = 0;
      this.log("HP＋14。毒と炎上を解除。", "good");
    } else if (item.kind === "focus") {
      p.focus = Math.min(p.maxFocus, p.focus + 8);
      this.log("集中＋8。", "good");
    } else if (item.kind === "smoke") {
      for (const e of this.visibleEnemies().filter((e) => !e.friendly)) {
        e.stunned = 3;
        e.intent = null;
      }
      this.log("煙が敵の予告を消す。3ターン足止め。", "good");
    } else if (item.kind === "blink") {
      Object.assign(p, this.dungeon.start);
      p.stuck = 0;
      this.log("入口へ帰還した。", "good");
    } else if (item.kind === "ration") {
      p.supplies++;
      this.log("野営の糧食＋1。", "good");
    } else if (["weapon", "armor"].includes(item.kind)) {
      const old = p.equipment[item.kind];
      p.equipment[item.kind] = item;
      p.inventory = p.inventory.filter((i) => i.id !== id);
      if (old) p.inventory.push(old);
      this.log(`${item.name}を装備した。`, "good");
      this.endTurn();
      return true;
    } else return false;
    p.inventory = p.inventory.filter((i) => i.id !== id);
    this.checkKills();
    this.endTurn();
    return true;
  }
  dropItem(id) {
    if (this.ended) return false;
    const item = this.player.inventory.find((i) => i.id === id);
    if (!item) return false;
    // All drops retain their complete identity, including invented tools.
    this.dungeon.objects.push({
      ...item,
      x: this.player.x,
      y: this.player.y,
      droppedItem: item,
    });
    this.player.inventory = this.player.inventory.filter((i) => i.id !== id);
    this.log(`${item.name}を床に置いた。`);
    this.endTurn();
    return true;
  }
  inspect(x, y) {
    if (!this.inside(x, y) || !this.seen[y]?.[x])
      return { title: "未踏の暗がり", detail: "まだ見ていない場所。", x, y };
    const tile = this.rememberedTile(x, y),
      def = TILES[tile];
    if (!this.visible[y][x])
      return {
        title: `記憶：${tile} ${def.name}`,
        detail: `${def.detail} 今は視界の外。敵や道具の現在位置は分からない。`,
        x,
        y,
      };
    const enemy = this.enemyAt(x, y),
      drop = this.dungeon.drops.find((d) => d.x === x && d.y === y),
      object = this.dungeon.objects.find((o) => o.x === x && o.y === y);
    if (enemy)
      return {
        title: `${enemy.symbol} ${enemy.name}${enemy.friendly ? " / 友好的" : ""}`,
        detail: `HP ${enemy.hp}/${enemy.maxHp} ・攻撃 ${Math.max(1, enemy.attack - this.defense())}。${enemy.detail} 特性：${enemy.tags.join("、")}。${enemy.stunned ? `拘束：あと${enemy.stunned}ターン。` : ""}`,
        enemyId: enemy.id,
        x,
        y,
      };
    if (object)
      return {
        title: `${object.symbol} ${object.name}`,
        detail: object.detail,
        x,
        y,
      };
    if (drop) {
      const item = makeItem(drop.key, drop.id);
      return {
        title: `${item.symbol} ${item.name}`,
        detail: item.detail,
        x,
        y,
      };
    }
    return { title: `${tile} ${def.name}`, detail: def.detail, x, y };
  }
  context(selected = null) {
    const cells = [];
    for (let y = 0; y < HEIGHT; y++)
      for (let x = 0; x < WIDTH; x++)
        if (this.visible[y][x] && distance(this.player, { x, y }) <= 4)
          cells.push({
            x,
            y,
            tile: this.tile(x, y),
            name: TILES[this.tile(x, y)].name,
          });
    return {
      floor: this.floor,
      theme: this.dungeon.theme.name,
      turn: this.turn,
      player: this.player,
      selected,
      enemies: this.visibleEnemies(),
      nearby: cells,
      objects: this.dungeon.objects.filter((o) => this.visible[o.y]?.[o.x]),
      memory: this.memory.slice(-12),
      threats: this.threats(),
    };
  }
  prepare(raw, command) {
    if (this.ended) throw new Error("冒険は終了している。新しい旅を始めよう。");
    if (
      !raw ||
      !Array.isArray(raw.effects) ||
      raw.effects.length < 1 ||
      raw.effects.length > 2
    )
      throw new Error("行動は1〜2個の具体的な効果で提案してください。");
    const skill = Object.hasOwn(SKILLS, raw.skill) ? raw.skill : "wit";
    const effects = [],
      unique = new Set();
    let minimumEffort = 1,
      minimumDifficulty = 1;
    for (const input of raw.effects) {
      if (!input || !EFFECTS.has(input.kind))
        throw new Error(
          "世界に反映できる効果が含まれていません。言い方を変えてみよう。",
        );
      const e = {
        kind: input.kind,
        target: clean(input.target, 60),
        x: Number(input.x),
        y: Number(input.y),
        name: clean(input.name, 32),
        detail: clean(input.detail, 180),
        symbol: clean(input.symbol, 1),
      };
      const enemy = this.visibleEnemies().find(
        (m) => m.id === e.target && !m.friendly,
      );
      if (
        ["damage", "stun", "peace"].includes(e.kind) &&
        (!enemy || distance(enemy, this.player) > 4)
      )
        throw new Error("対象の敵は視界内かつ4マス以内である必要があります。");
      if (["move", "terrain", "create"].includes(e.kind)) {
        if (
          !this.inside(e.x, e.y) ||
          !this.visible[e.y][e.x] ||
          distance(this.player, e) > (e.kind === "move" ? 4 : 3)
        )
          throw new Error("対象マスは視界内の近い場所を指定してください。");
        if (
          e.kind === "move" &&
          (!this.walkable(e.x, e.y) || this.enemyAt(e.x, e.y))
        )
          throw new Error("移動先には通行可能な空きマスが必要です。");
        if (
          e.kind === "terrain" &&
          (!TERRAIN.has(e.symbol) ||
            [">", "<", "0", "&"].includes(this.tile(e.x, e.y)))
        )
          throw new Error(
            "階段や星、野営地は書き換えられません。地形は床・水・糸・油・火を指定してください。",
          );
        if (
          e.kind === "create" &&
          (!this.walkable(e.x, e.y) ||
            this.enemyAt(e.x, e.y) ||
            this.dungeon.objects.some((o) => o.x === e.x && o.y === e.y) ||
            !e.name)
        )
          throw new Error(
            "名前のある道具を、近くの空いた床に生み出してください。",
          );
      }
      if (["heal", "cleanse", "ward", "reveal"].includes(e.kind)) {
        e.target = "self";
        e.x = this.player.x;
        e.y = this.player.y;
      }
      if (e.kind === "damage" && !["", "*", "~", ":"].includes(e.symbol))
        e.symbol = "";
      if (e.kind === "damage" && e.symbol)
        minimumEffort = Math.max(minimumEffort, 2);
      const key = `${e.kind}:${["damage", "stun", "peace"].includes(e.kind) ? e.target : `${e.x},${e.y}`}`;
      if (unique.has(key))
        throw new Error("同じ効果を重ねることはできません。");
      unique.add(key);
      minimumEffort = Math.max(minimumEffort, COST[e.kind]);
      minimumDifficulty = Math.max(minimumDifficulty, DIFFICULTY[e.kind]);
      if (enemy?.type === "warden") {
        minimumEffort = Math.max(minimumEffort, 4);
        minimumDifficulty = 5;
      }
      effects.push(e);
    }
    const consumes = [
      ...new Set(Array.isArray(raw.consumes) ? raw.consumes : []),
    ];
    if (consumes.length > 2)
      throw new Error("一度に消費できる材料は2個までです。");
    if (consumes.some((id) => !this.player.inventory.some((i) => i.id === id)))
      throw new Error("材料に指定された道具を持っていません。");
    const effort = clamp(raw.effort, minimumEffort, 5),
      difficulty = clamp(raw.difficulty, minimumDifficulty, 5);
    const cost = effort + effects.length - 1;
    const tool = this.player.inventory.some(
      (i) =>
        i.kind === "tool" &&
        (skill === "wit"
          ? i.tags.some((t) => ["知", "技"].includes(t))
          : i.tags.includes(SKILLS[skill])),
    )
      ? 1
      : 0;
    const environment = this.dungeon.objects.some(
      (o) => o.skill === skill && distance(o, this.player) <= 2,
    )
      ? 1
      : 0;
    const bonus =
      this.player.skills[skill] +
      tool +
      environment +
      Math.floor(effort / 2) +
      (consumes.length ? 1 : 0);
    const threshold = difficulty + 3,
      chance = clamp(((7 + bonus - threshold) / 6) * 100, 0, 100);
    const potency = Math.max(
      2,
      Math.floor(
        (4 + effort * 2 + Math.floor(this.player.level / 2)) / effects.length,
      ),
    );
    const proposal = {
      title: clean(raw.title, 60) || "世界への働きかけ",
      reasoning: clean(raw.reasoning, 280),
      success: clean(raw.success, 280) || "試みは形になった。",
      failure:
        clean(raw.failure, 280) || "あと少し届かなかった。状況を変えて試そう。",
      skill,
      difficulty,
      effort,
      cost,
      consumes,
      effects,
      bonus,
      threshold,
      chance,
      potency,
      command: clean(command, 500),
      revision: this.revision,
    };
    this.pending = proposal;
    return structuredClone(proposal);
  }
  damageAmount(e, a) {
    const enemy = this.dungeon.enemies.find((m) => m.id === e.target);
    if (!enemy) return a.potency;
    let amount = a.potency;
    if (e.symbol === "*") {
      if (this.tile(enemy.x, enemy.y) === "~") amount = Math.ceil(amount / 2);
      else if (enemy.tags.some((t) => ["紙", "火に弱い"].includes(t)))
        amount += 3;
    }
    if (e.symbol === ":" && this.tile(enemy.x, enemy.y) === "~") amount += 4;
    return amount;
  }
  effectDescription(e, proposal) {
    const enemy =
      this.dungeon.enemies.find((m) => m.id === e.target)?.name || "敵";
    const descriptions = {
      damage: `${enemy}に${this.damageAmount(e, proposal)}ダメージ${e.symbol === "*" ? "＋炎上（2ターン、各3。水上では炎上なし）" : e.symbol === "~" ? "＋1ターン凍結（予告解除）" : e.symbol === ":" ? "（水上なら感電＋4を加算済み）" : ""}`,
      stun: `${enemy}を${Math.min(4, 1 + proposal.effort)}ターン拘束（攻撃予告を解除）`,
      peace: `${enemy}と和解、この階で敵対しない`,
      heal: `HPを${proposal.potency}回復`,
      cleanse: "毒・炎上・拘束を解除",
      ward: `${proposal.potency}ダメージ分の護り（重複せず、上限12）`,
      move: `(${e.x}, ${e.y})へ移動`,
      terrain: `(${e.x}, ${e.y})を${TILES[e.symbol]?.name || "地形"}に変える`,
      create: `(${e.x}, ${e.y})に「${e.name}」を創作。持ち歩ける判定道具`,
      reveal: "この階の地形を記憶する（敵は表示しない）",
    };
    return descriptions[e.kind];
  }
  execute() {
    const a = this.pending;
    if (!a || a.revision !== this.revision || this.ended)
      throw new Error("状況が変わりました。もう一度提案を作ってください。");
    if (this.player.focus < a.cost)
      throw new Error(
        "集中が足りません。規模を小さくするか、薬・野営で回復しよう。",
      );
    this.player.focus -= a.cost;
    this.player.inventory = this.player.inventory.filter(
      (i) => !a.consumes.includes(i.id),
    );
    const die = 1 + Math.floor(this.random() * 6),
      success = die + a.bonus >= a.threshold;
    this.log(
      `「${a.command}」 / d6=${die}＋${a.bonus} 対 ${a.threshold} → ${success ? "成功" : "失敗"}。集中 −${a.cost}。`,
      success ? "good" : "warning",
    );
    this.log(success ? a.success : a.failure, "story");
    if (success) {
      for (const e of a.effects) this.applyEffect(e, a);
      this.memory.push({
        floor: this.floor,
        turn: this.turn,
        action: a.command,
        result: a.success,
        effects: a.effects.map((e) => this.effectDescription(e, a)),
      });
      this.memory = this.memory.slice(-20);
      this.checkKills();
    }
    this.endTurn();
    return { success, die };
  }
  applyEffect(e, a) {
    const enemy = this.dungeon.enemies.find((m) => m.id === e.target),
      p = this.player;
    if (e.kind === "damage" && enemy) {
      enemy.hp -= this.damageAmount(e, a);
      if (e.symbol === "*" && this.tile(enemy.x, enemy.y) !== "~") {
        enemy.burning = 2;
        if (this.tile(enemy.x, enemy.y) === "=")
          this.dungeon.grid[enemy.y][enemy.x] = "*";
      }
      if (e.symbol === "~") {
        enemy.stunned = 1;
        enemy.intent = null;
      }
    }
    if (e.kind === "stun" && enemy) {
      enemy.stunned = Math.min(4, 1 + a.effort);
      enemy.intent = null;
    }
    if (e.kind === "peace" && enemy) {
      enemy.friendly = true;
      enemy.intent = null;
      if (!enemy.rewarded) {
        enemy.rewarded = true;
        this.gainXP(enemy.type === "warden" ? 10 : 3);
      }
    }
    if (e.kind === "heal") p.hp = Math.min(p.maxHp, p.hp + a.potency);
    if (e.kind === "cleanse") p.poison = p.burning = p.stuck = 0;
    if (e.kind === "ward") p.ward = Math.min(12, Math.max(p.ward, a.potency));
    if (e.kind === "move") {
      p.x = e.x;
      p.y = e.y;
      p.stuck = 0;
      this.onEnter();
      this.pickup();
    }
    if (e.kind === "terrain") this.dungeon.grid[e.y][e.x] = e.symbol;
    if (e.kind === "create")
      this.dungeon.objects.push({
        id: this.id(),
        name: e.name,
        detail: e.detail || a.success,
        symbol: /^[!-~]$/.test(e.symbol) ? e.symbol : "&",
        x: e.x,
        y: e.y,
        skill: a.skill,
      });
    if (e.kind === "reveal") {
      this.seen = this.seen.map((row) => row.map(() => true));
      this.knownTerrain = this.dungeon.grid.map((row) => [...row]);
    }
    this.log(this.effectDescription(e, a) + "。", "good");
  }
  serialize() {
    const data = { version: 2 };
    for (const key of SAVE_FIELDS) data[key] = this[key];
    return JSON.stringify(data);
  }
  static restore(json) {
    const d = JSON.parse(json);
    const point = (p) =>
      p &&
      Number.isInteger(p.x) &&
      Number.isInteger(p.y) &&
      p.x > 0 &&
      p.x < WIDTH - 1 &&
      p.y > 0 &&
      p.y < HEIGHT - 1;
    const strings = (a) =>
      Array.isArray(a) && a.every((s) => typeof s === "string");
    const item = (i) =>
      i &&
      typeof i.id === "string" &&
      typeof i.name === "string" &&
      typeof i.detail === "string" &&
      /^[!-~]$/.test(i.symbol) &&
      strings(i.tags) &&
      [
        "tool",
        "weapon",
        "armor",
        "heal",
        "focus",
        "smoke",
        "blink",
        "oil",
        "ration",
      ].includes(i.kind);
    if (
      d?.version !== 2 ||
      !Number.isInteger(d.floor) ||
      d.floor < 1 ||
      d.floor > LAST_FLOOR ||
      !Object.hasOwn(BACKGROUNDS, d.background) ||
      !d.player ||
      !Number.isFinite(d.player.hp) ||
      !Number.isFinite(d.player.focus) ||
      !Array.isArray(d.player.inventory) ||
      !d.player.skills ||
      !d.player.equipment ||
      typeof d.player.name !== "string" ||
      ![
        "maxHp",
        "maxFocus",
        "attack",
        "defense",
        "level",
        "xp",
        "supplies",
        "ward",
        "poison",
        "burning",
        "stuck",
      ].every((k) => Number.isInteger(d.player[k]) && d.player[k] >= 0) ||
      !Object.keys(SKILLS).every(
        (k) => Number.isInteger(d.player.skills[k]) && d.player.skills[k] >= 0,
      ) ||
      !d.player.inventory.every(item) ||
      !Object.values(d.player.equipment).every((i) => i === null || item(i)) ||
      ![null, "dead", "won"].includes(d.ended) ||
      !Array.isArray(d.dungeon?.enemies) ||
      !Array.isArray(d.dungeon?.drops) ||
      !Array.isArray(d.dungeon?.objects) ||
      !point(d.dungeon.start) ||
      !point(d.dungeon.exit) ||
      typeof d.dungeon.theme?.name !== "string" ||
      !d.dungeon.enemies.every(
        (e) =>
          point(e) &&
          typeof e.id === "string" &&
          Number.isFinite(e.hp) &&
          Number.isFinite(e.attack) &&
          Number.isFinite(e.range) &&
          strings(e.tags) &&
          (e.intent === null ||
            (Array.isArray(e.intent?.tiles) &&
              e.intent.tiles.every(
                (t) => Number.isInteger(t.x) && Number.isInteger(t.y),
              ))),
      ) ||
      !d.dungeon.drops.every((i) => point(i) && Object.hasOwn(ITEMS, i.key)) ||
      !d.dungeon.objects.every(
        (o) =>
          point(o) &&
          typeof o.name === "string" &&
          typeof o.detail === "string" &&
          (!o.droppedItem || item(o.droppedItem)),
      ) ||
      !Array.isArray(d.messages) ||
      !Array.isArray(d.memory) ||
      !d.messages.every(
        (m) => typeof m.text === "string" && typeof m.kind === "string",
      ) ||
      !d.memory.every(
        (m) =>
          typeof m.action === "string" &&
          typeof m.result === "string" &&
          strings(m.effects),
      ) ||
      (d.knownTerrain &&
        (!Array.isArray(d.knownTerrain) ||
          d.knownTerrain.length !== HEIGHT ||
          !d.knownTerrain.every(
            (r) =>
              Array.isArray(r) &&
              r.length === WIDTH &&
              r.every((t) => Object.hasOwn(TILES, t)),
          ))) ||
      !d.dungeon.grid ||
      d.dungeon.grid.length !== HEIGHT ||
      !d.dungeon.grid.every(
        (r) => r.length === WIDTH && r.every((t) => Object.hasOwn(TILES, t)),
      ) ||
      d.seen?.length !== HEIGHT ||
      !d.seen.every((r) => r.length === WIDTH) ||
      !Number.isInteger(d.rng) ||
      !Number.isInteger(d.serial) ||
      !Number.isInteger(d.revision)
    )
      throw new Error(
        "このセーブは読み込めません。新しい冒険を始めてください。",
      );
    const game = Object.create(Game.prototype);
    for (const key of SAVE_FIELDS) game[key] = d[key];
    game.knownTerrain ||= game.dungeon.grid.map((row) => [...row]);
    if (!game.inside(d.player.x, d.player.y))
      throw new Error("セーブの座標が不正です。");
    game.pending = null;
    game.updateVision();
    return game;
  }
}

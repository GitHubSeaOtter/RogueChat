import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../js/game.js";
import {
  generateDungeon,
  WIDTH,
  HEIGHT,
  TILES,
  lineOfSight,
} from "../js/dungeon.js";
import { makeItem } from "../js/items.js";
import { localProposal } from "../js/llm.js";

function arena(background = "wanderer") {
  const game = new Game({ seed: 42, background });
  game.dungeon.grid = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) =>
      x && y && x < WIDTH - 1 && y < HEIGHT - 1 ? "." : "#",
    ),
  );
  Object.assign(game.player, { x: 10, y: 10 });
  game.dungeon.enemies = [];
  game.dungeon.objects = [];
  game.dungeon.drops = [];
  game.updateVision();
  return game;
}
function enemy(game, extra = {}) {
  const e = {
    id: game.id(),
    x: 11,
    y: 10,
    name: "試験の射手",
    symbol: "a",
    hp: 20,
    maxHp: 20,
    attack: 7,
    range: 5,
    type: "archer",
    behavior: "ranged",
    intent: null,
    stunned: 0,
    burning: 0,
    friendly: false,
    tags: ["紙"],
    detail: "射撃",
    ...extra,
  };
  game.dungeon.enemies.push(e);
  game.updateVision();
  return e;
}
const proposal = (kind, extra = {}) => ({
  skill: "wit",
  effort: 2,
  difficulty: 2,
  effects: [
    {
      kind,
      target: "self",
      x: 10,
      y: 10,
      name: "",
      detail: "",
      symbol: "",
      ...extra,
    },
  ],
  consumes: [],
});

test("all 5 floors are connected over 200 seeds, with safe starts and reserved objectives", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const g = new Game({ seed });
    for (let floor = 1; floor <= 5; floor++) {
      const d = generateDungeon(
        floor,
        () => g.random(),
        () => g.id(),
      );
      assert.equal(d.grid.length, HEIGHT);
      assert.ok(
        d.grid.every(
          (r) => r.length === WIDTH && r.every((t) => Object.hasOwn(TILES, t)),
        ),
      );
      const visited = new Set(),
        queue = [d.start];
      for (let i = 0; i < queue.length; i++) {
        const p = queue[i],
          key = `${p.x},${p.y}`;
        if (visited.has(key)) continue;
        visited.add(key);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const x = p.x + dx,
            y = p.y + dy;
          if (
            d.grid[y]?.[x] &&
            d.grid[y][x] !== "#" &&
            !visited.has(`${x},${y}`)
          )
            queue.push({ x, y });
        }
      }
      assert.ok(visited.has(`${d.exit.x},${d.exit.y}`));
      for (const p of [...d.enemies, ...d.drops]) {
        assert.ok(visited.has(`${p.x},${p.y}`));
        assert.notDeepEqual({ x: p.x, y: p.y }, d.start);
        assert.notDeepEqual({ x: p.x, y: p.y }, d.exit);
      }
      assert.equal(d.grid[d.start.y][d.start.x], "<");
      assert.equal(d.grid[d.exit.y][d.exit.x], floor === 5 ? "0" : ">");
    }
  }
});
test("inspection and proposals do not consume time, resources, or RNG; cancel is free", () => {
  const g = arena(),
    before = g.serialize();
  g.inspect(11, 10);
  g.prepare(localProposal(g, "身を守る"), "身を守る");
  g.pending = null;
  assert.equal(g.serialize(), before);
});
test("enemies advertise a turn before dealing damage and have a recovery turn", () => {
  const g = arena(),
    e = enemy(g),
    hp = g.player.hp;
  g.move(0, 0);
  assert.equal(g.player.hp, hp);
  assert.ok(e.intent);
  assert.equal(g.threats().length, 1);
  g.move(0, 0);
  assert.equal(g.player.hp, hp - 6);
  assert.equal(e.intent, null);
  g.move(0, 0);
  assert.equal(g.player.hp, hp - 6);
  assert.ok(e.intent);
});
test("moving out of a ranged attack avoids damage, while a wall cuts line of sight", () => {
  const g = arena();
  enemy(g);
  g.move(0, 0);
  const hp = g.player.hp;
  g.move(0, 1);
  assert.equal(g.player.hp, hp);
  g.dungeon.grid[10][12] = "#";
  assert.equal(
    lineOfSight(g.dungeon.grid, { x: 11, y: 10 }, { x: 13, y: 10 }),
    false,
  );
});
test("a first visible enemy cannot attack without a displayed intent", () => {
  const g = arena();
  const e = enemy(g, { x: 17, y: 10 });
  const hp = g.player.hp;
  g.move(1, 0);
  assert.equal(g.player.hp, hp);
  assert.equal(e.intent, null);
});
test("smoke cancels attacks for three turns and never creates a surprise strike", () => {
  const g = arena();
  const e = enemy(g);
  g.move(0, 0);
  const hp = g.player.hp;
  g.useItem(g.player.inventory.find((i) => i.key === "smoke").id);
  assert.equal(g.player.hp, hp);
  assert.equal(e.intent, null);
  g.move(0, 0);
  g.move(0, 0);
  assert.equal(g.player.hp, hp);
  assert.equal(e.intent, null);
  g.move(0, 0);
  assert.ok(e.intent);
  assert.equal(g.player.hp, hp);
});
test("closed doors consume a turn and sealed diagonal corners cannot be crossed", () => {
  const g = arena();
  g.dungeon.grid[10][11] = "+";
  assert.equal(g.move(1, 0), true);
  assert.equal(g.player.x, 10);
  assert.equal(g.turn, 1);
  assert.equal(g.tile(11, 10), "/");
  g.dungeon.grid[10][11] = "#";
  assert.equal(g.move(1, 1), false);
  assert.equal(g.turn, 1);
});
test("rest needs safety and finite supplies; a camp is free once", () => {
  const g = arena();
  enemy(g);
  assert.equal(g.rest(), false);
  assert.equal(g.turn, 0);
  g.dungeon.enemies = [];
  g.player.hp = 10;
  g.player.supplies = 0;
  assert.equal(g.rest(), false);
  g.dungeon.grid[10][10] = "&";
  assert.equal(g.rest(), true);
  assert.equal(g.player.hp, 22);
  assert.equal(g.player.supplies, 0);
  assert.equal(g.rest(), false);
});
test("dangerous terrain and ongoing poison can kill; input is then locked", () => {
  const g = arena();
  g.player.hp = 4;
  g.dungeon.grid[10][11] = "^";
  g.move(1, 0);
  assert.equal(g.ended, "dead");
  assert.equal(g.player.hp, 0);
  assert.equal(g.move(0, 0), false);
  const h = arena();
  h.player.hp = 2;
  h.player.poison = 1;
  h.move(0, 0);
  assert.equal(h.ended, "dead");
});
test("water extinguishes burning and fire spreads exactly one oil tile per turn", () => {
  const g = arena();
  g.player.burning = 3;
  g.dungeon.grid[10][11] = "~";
  const hp = g.player.hp;
  g.move(1, 0);
  assert.equal(g.player.burning, 0);
  assert.equal(g.player.hp, hp);
  g.dungeon.grid[5][5] = "*";
  g.dungeon.grid[5][6] = "=";
  g.dungeon.grid[5][7] = "=";
  g.move(0, 0);
  assert.equal(g.tile(6, 5), "*");
  assert.equal(g.tile(7, 5), "=");
  g.move(0, 0);
  assert.equal(g.tile(7, 5), "*");
});
test("invalid, distant, duplicated and protected-target effects cannot mutate the state", () => {
  const g = arena(),
    before = g.serialize();
  assert.throws(() =>
    g.prepare(proposal("damage", { target: "invented" }), "攻撃"),
  );
  assert.throws(() => g.prepare(proposal("move", { x: 40, y: 20 }), "移動"));
  g.dungeon.grid[10][11] = ">";
  assert.throws(() =>
    g.prepare(proposal("terrain", { x: 11, y: 10, symbol: "." }), "階段を消す"),
  );
  const p = proposal("heal");
  p.effects.push(p.effects[0]);
  assert.throws(() => g.prepare(p, "重複"));
  assert.throws(() =>
    g.prepare({ ...proposal("heal"), consumes: ["missing"] }, "材料"),
  );
  g.dungeon.grid[10][11] = ".";
  assert.equal(g.serialize(), before);
});
test("negative and exaggerated model values are bounded; chance and power follow engine rules", () => {
  const g = arena();
  const a = g.prepare(
    { ...proposal("heal"), difficulty: -100, effort: 999, hp: 99999 },
    "奇跡",
  );
  assert.equal(a.difficulty, 2);
  assert.equal(a.effort, 5);
  assert.equal(a.cost, 5);
  assert.equal(a.potency, 14);
  assert.ok(a.chance >= 0 && a.chance <= 100);
});
test("failed actions charge focus and materials and allow enemy attacks without applying effects", () => {
  const g = arena();
  enemy(g);
  g.move(0, 0);
  const p = g.prepare(
    {
      ...proposal("heal"),
      effort: 2,
      difficulty: 5,
      skill: "might",
      consumes: [g.player.inventory[0].id],
    },
    "回復",
  );
  g.random = () => 0;
  const hp = g.player.hp,
    focus = g.player.focus,
    count = g.player.inventory.length;
  assert.equal(g.execute().success, false);
  assert.equal(g.player.hp, hp - 6);
  assert.equal(g.player.focus, focus - p.cost);
  assert.equal(g.player.inventory.length, count - 1);
  assert.equal(g.memory.length, 0);
});
test("not enough focus and stale proposals cannot be executed or charged", () => {
  const g = arena();
  g.prepare(proposal("heal"), "回復");
  g.player.focus = 0;
  const before = g.serialize();
  assert.throws(() => g.execute());
  assert.equal(g.serialize(), before);
  g.player.focus = 12;
  g.move(0, 0);
  assert.throws(() => g.execute());
});
test("peace cancels intent, rewards the same XP as combat, and persists on reload", () => {
  const g = arena(),
    e = enemy(g);
  g.move(0, 0);
  const hp = g.player.hp;
  g.prepare(proposal("peace", { target: e.id }), "交渉");
  g.random = () => 0.99;
  assert.equal(g.execute().success, true);
  assert.equal(e.friendly, true);
  assert.equal(e.intent, null);
  assert.equal(g.player.xp, 3);
  assert.equal(g.player.hp, hp);
  const loaded = Game.restore(g.serialize());
  assert.equal(loaded.dungeon.enemies[0].friendly, true);
  assert.equal(loaded.memory.length, 1);
});
test("created artifacts are visible, grant a bounded bonus and can be carried, dropped, and recovered", () => {
  const g = arena();
  g.prepare(
    proposal("create", {
      name: "夢の羅針盤",
      detail: "<script> remains inert text",
      symbol: "&",
    }),
    "夢を編む",
  );
  g.random = () => 0.99;
  g.execute();
  assert.equal(g.dungeon.objects.length, 1);
  assert.equal(g.inspect(10, 10).title, "& 夢の羅針盤");
  const nearby = g.prepare(proposal("ward"), "護り");
  assert.equal(nearby.bonus, 5);
  g.pending = null;
  g.interact();
  const item = g.player.inventory.at(-1);
  assert.equal(item.name, "夢の羅針盤");
  g.dropItem(item.id);
  g.interact();
  assert.deepEqual(g.player.inventory.at(-1), item);
});
test("regular dropped equipment retains identity and stats on recovery", () => {
  const g = arena(),
    item = makeItem("blade", g.id());
  g.player.inventory.push(item);
  g.dropItem(item.id);
  g.interact();
  assert.deepEqual(g.player.inventory.at(-1), item);
  g.useItem(item.id);
  assert.equal(g.attack(), 7);
});
test("map reveal exposes only terrain and an unseen enemy cannot be inspected", () => {
  const g = arena();
  enemy(g, { x: 30, y: 20 });
  g.prepare(proposal("reveal"), "地図");
  g.random = () => 0.99;
  g.execute();
  assert.equal(g.seen[20][30], true);
  assert.equal(g.visibleEnemies().length, 0);
  assert.ok(!g.inspect(30, 20).enemyId);
});
test("descents restore small resources and the star requires overcoming the guardian", () => {
  const g = arena();
  g.player.hp = 10;
  g.player.focus = 3;
  g.dungeon.grid[10][10] = ">";
  assert.equal(g.interact(), true);
  assert.equal(g.floor, 2);
  assert.equal(g.player.hp, 14);
  assert.equal(g.player.focus, 6);
  g.floor = 5;
  g.loadFloor();
  Object.assign(g.player, g.dungeon.exit);
  g.updateVision();
  assert.equal(g.interact(), false);
  const guardian = g.dungeon.enemies.find((e) => e.type === "warden");
  guardian.friendly = true;
  assert.equal(g.interact(), true);
  assert.equal(g.ended, "won");
  assert.equal(g.interact(), false);
});
test("save/restore preserves RNG and replay, and refuses old or corrupt saves", () => {
  const g = arena();
  g.move(0, 0);
  const h = Game.restore(g.serialize());
  assert.equal(g.random(), h.random());
  assert.equal(g.serialize(), h.serialize());
  assert.throws(() => Game.restore('{"version":1}'));
  assert.throws(() => Game.restore("bad"));
});

test("elemental attacks use paper, water and oil; ice interrupts an advertised strike", () => {
  const g = arena(),
    e = enemy(g);
  g.random = () => 0.99;
  let a = g.prepare(proposal("damage", { target: e.id, symbol: "*" }), "火");
  assert.equal(g.damageAmount(a.effects[0], a), 11);
  g.dungeon.grid[e.y][e.x] = "~";
  assert.equal(g.damageAmount(a.effects[0], a), 4);
  a = g.prepare(proposal("damage", { target: e.id, symbol: ":" }), "雷");
  assert.equal(g.damageAmount(a.effects[0], a), 12);
  g.dungeon.grid[e.y][e.x] = "=";
  g.prepare(proposal("damage", { target: e.id, symbol: "*" }), "火");
  g.execute();
  assert.equal(g.tile(e.x, e.y), "*");
  assert.equal(e.hp, 3); // 11 direct + 3 terrain + 3 burning
  const h = arena(),
    f = enemy(h);
  h.random = () => 0.99;
  h.move(0, 0);
  const hp = h.player.hp;
  h.prepare(proposal("damage", { target: f.id, symbol: "~" }), "氷");
  h.execute();
  assert.equal(h.player.hp, hp);
  assert.equal(f.intent, null);
});
test("created fire hurts enemies and the player; traps and webs affect moving enemies", () => {
  const g = arena(),
    e = enemy(g, { x: 11, y: 10 });
  g.dungeon.grid[10][11] = "*";
  g.move(0, 0);
  assert.equal(e.hp, 17);
  const hp = g.player.hp;
  g.dungeon.grid[10][10] = "*";
  g.move(0, 1);
  assert.equal(g.player.hp, hp); // escaped both fire and the strike
  g.dungeon.grid[11][10] = "*";
  g.move(0, 0);
  assert.equal(g.player.hp, hp - 3);
});

test("line of sight and attacks cannot cut across a sealed diagonal corner", () => {
  const g = arena();
  g.dungeon.grid[10][11] = "#";
  const e = enemy(g, { x: 11, y: 11, range: 1, behavior: "melee" });
  assert.equal(lineOfSight(g.dungeon.grid, e, g.player), false);
  assert.equal(g.move(1, 1), false);
  g.move(0, 0);
  assert.equal(e.intent, null);
});
test("remembered terrain does not update while outside vision; save keeps that memory", () => {
  const g = arena();
  g.prepare(proposal("reveal"), "地図");
  g.random = () => 0.99;
  g.execute();
  g.dungeon.grid[20][30] = "*";
  assert.equal(g.rememberedTile(30, 20), ".");
  assert.match(g.inspect(30, 20).title, /石床/);
  const loaded = Game.restore(g.serialize());
  assert.equal(loaded.rememberedTile(30, 20), ".");
});
test("malformed inventories are rejected and save fields cannot overwrite game methods", () => {
  const g = arena(),
    data = JSON.parse(g.serialize());
  data.random = "not a function";
  const loaded = Game.restore(JSON.stringify(data));
  assert.equal(typeof loaded.random, "function");
  data.player.inventory[0].tags = 1;
  assert.throws(() => Game.restore(JSON.stringify(data)));
});

import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../js/game.js";
import { WIDTH, HEIGHT } from "../js/dungeon.js";
import {
  makeItem,
  itemMagnitude,
  itemSummary,
  publicItem,
  groupItems,
} from "../js/items.js";
import { PROVIDERS } from "../js/llm.js";
function arena() {
  const g = new Game({ seed: 42, background: "scholar" });
  g.dungeon.grid = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) =>
      x && y && x < WIDTH - 1 && y < HEIGHT - 1 ? "." : "#",
    ),
  );
  Object.assign(g.player, { x: 10, y: 10 });
  g.dungeon.enemies = [];
  g.dungeon.drops = [];
  g.dungeon.objects = [];
  g.updateVision();
  return g;
}
function monster(g, more = {}) {
  const e = {
    id: g.id(),
    x: 11,
    y: 10,
    type: "goblin",
    name: "拾い屋",
    symbol: "g",
    hp: 20,
    maxHp: 20,
    attack: 5,
    range: 1,
    behavior: "melee",
    stunned: 0,
    burning: 0,
    intent: null,
    friendly: false,
    tags: ["言葉"],
    detail: "短剣",
    ...more,
  };
  g.dungeon.enemies.push(e);
  g.updateVision();
  return e;
}
const ward = {
  skill: "wit",
  difficulty: 2,
  effort: 2,
  effects: [
    {
      kind: "ward",
      target: "self",
      x: 10,
      y: 10,
      name: "",
      detail: "",
      symbol: "",
    },
  ],
  consumes: [],
};

test("placed instances have distinct names and fixed corrections across observation and reload", () => {
  const g = new Game({ seed: 42 }),
    h = new Game({ seed: 42 });
  assert.deepEqual(g.dungeon.drops, h.dungeon.drops);
  const names = [
    ...g.player.inventory,
    ...g.dungeon.drops.map((d) => d.item),
  ].map((i) => i.name);
  assert.equal(new Set(names).size, names.length);
  const before = g.serialize();
  for (const d of g.dungeon.drops) g.inspect(d.x, d.y);
  assert.equal(g.serialize(), before);
  assert.deepEqual(Game.restore(before).dungeon.drops, g.dungeon.drops);
  const corrupt = JSON.parse(before);
  corrupt.dungeon.drops[0].item.modifier = 99;
  assert.throws(() => Game.restore(JSON.stringify(corrupt)), /セーブ/);
});
test("hierarchies keep same-type weapons and potions separate at instance level", () => {
  const inventory = [
    makeItem("tonic", "id-1"),
    makeItem("tonic", "id-2"),
    makeItem("blade", "id-3"),
    makeItem("blade", "id-4"),
  ];
  const groups = groupItems(inventory);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[1].items.length, 2);
  assert.notEqual(groups[0].items[0].name, groups[0].items[1].name);
});
test("default choice consumes the first instance and an explicit name consumes exactly that instance", () => {
  const g = arena();
  const a = makeItem("tonic", g.id(), { modifier: -2 }),
    b = makeItem("tonic", g.id(), { modifier: 2 });
  g.player.inventory = [a, b];
  g.player.hp = 1;
  g.useItem(b.id);
  assert.equal(g.player.hp, 17);
  assert.equal(g.player.inventory[0].id, a.id);
  g.player.hp = 1;
  g.useItem("tonic");
  assert.equal(g.player.hp, 13);
  assert.equal(g.player.inventory.length, 0);
});
test("identification reveals rather than rerolls the fixed amount, and failed attempts cost time and focus", () => {
  const g = arena(),
    item = makeItem("tonic", g.id(), { modifier: 2 });
  g.player.inventory = [item];
  assert.match(itemSummary(item), /未識別/);
  assert.ok(!itemSummary(item).includes("16"));
  assert.equal(publicItem(item).modifier, undefined);
  g.player.skills.wit = 0;
  g.random = () => 0;
  const focus = g.player.focus;
  g.identify(item.id);
  assert.equal(item.identified, false);
  assert.equal(item.modifier, 2);
  assert.equal(g.turn, 1);
  assert.equal(g.player.focus, focus - 1);
  g.random = () => 0.99;
  g.identify(item.id);
  assert.equal(item.identified, true);
  assert.match(itemSummary(item), /16/);
  assert.equal(publicItem(item).modifier, 2);
  const before = g.serialize();
  assert.equal(g.identify(item.id), false);
  assert.equal(g.serialize(), before);
});
test("unidentified corrections are withheld from every API context location", () => {
  const g = arena(),
    item = makeItem("blade", g.id(), { modifier: 3 });
  g.player.inventory = [item];
  let ctx = g.context(null, item.id);
  assert.equal(ctx.player.inventory[0].modifier, undefined);
  assert.equal(ctx.selectedItem.power, undefined);
  g.useItem(item.id);
  ctx = g.context();
  assert.equal(ctx.player.equipment.weapon.power, undefined);
  g.unequip("weapon");
  g.dropItem(item.id);
  ctx = g.context();
  assert.equal(ctx.objects[0].modifier, undefined);
  assert.equal(ctx.objects[0].droppedItem, undefined);
  assert.ok(!ctx.objects[0].detail.includes("＋5"));
});
test("named free actions bind their consumable, even if the model omits the consumption", () => {
  const g = arena(),
    a = makeItem("tonic", g.id()),
    b = makeItem("tonic", g.id());
  g.player.inventory = [a, b];
  const prepared = g.prepare(ward, "雨の薬を霧の盾にする", b.id);
  assert.deepEqual(prepared.consumes, [b.id]);
  const before = g.serialize();
  g.pending = null;
  assert.equal(g.serialize(), before);
  g.prepare(ward, "雨の薬を霧に", b.id);
  g.random = () => 0;
  g.player.skills.wit = 0;
  g.execute();
  assert.equal(g.player.inventory.length, 1);
  assert.equal(g.player.inventory[0].id, a.id);
  assert.throws(() => g.prepare(ward, "再使用", b.id), /手元/);
});
test("synthesis previews are free and deterministic; new healing-focus mixtures are usable after save", () => {
  const g = arena(),
    a = makeItem("tonic", g.id(), { modifier: 2 }),
    b = makeItem("focus", g.id(), { modifier: 0 });
  g.player.inventory = [a, b];
  const before = g.serialize();
  const preview = g.craftPreview(a.id, b.id);
  assert.equal(preview.recipe.key, "elixir");
  assert.equal(g.serialize(), before);
  g.random = () => 0.99;
  g.craft(a.id, b.id);
  const item = g.player.inventory[0];
  assert.equal(item.key, "elixir");
  assert.equal(item.identified, false);
  assert.equal(item.modifier, 2);
  assert.notEqual(item.name, a.name);
  assert.equal(g.turn, 1);
  const saved = Game.restore(g.serialize());
  assert.equal(saved.player.inventory[0].name, item.name);
  saved.player.hp = 1;
  saved.useItem("elixir");
  assert.equal(saved.player.hp, 13);
  assert.equal(saved.player.inventory.length, 0);
});
test("synthesis can resolve two copies of a type automatically without consuming the same instance twice", () => {
  const g = arena();
  g.player.inventory = [makeItem("blade", g.id()), makeItem("blade", g.id())];
  g.random = () => 0.99;
  const preview = g.craftPreview("blade", "blade");
  assert.notEqual(preview.a.id, preview.b.id);
  g.craft("blade", "blade");
  assert.equal(g.player.inventory.length, 1);
  assert.equal(g.player.inventory[0].power, 3);
  const before = g.serialize();
  assert.equal(g.craft("blade", "blade"), false);
  assert.equal(g.revision, 1);
  assert.equal(g.player.inventory.length, 1);
});
test("failed synthesis consumes both materials, charges focus and permits the advertised counterattack", () => {
  const g = arena();
  g.player.skills.wit = 0;
  g.player.inventory = [makeItem("tonic", g.id()), makeItem("focus", g.id())];
  const e = monster(g);
  g.move(0, 0);
  const hp = g.player.hp,
    focus = g.player.focus;
  g.random = () => 0;
  g.craft("tonic", "focus");
  assert.equal(g.player.inventory.length, 0);
  assert.equal(g.player.focus, focus - 3);
  assert.equal(g.player.hp, hp - 4);
  assert.equal(e.intent, null);
});
test("invalid targets and insufficient focus do not consume item instances", () => {
  const g = arena(),
    item = makeItem("oil", g.id());
  g.player.inventory = [item];
  const rng = g.rng;
  assert.equal(g.useItem("oil", "missing"), false);
  assert.equal(g.throwItem("oil", "missing"), false);
  assert.equal(g.player.inventory[0].id, item.id);
  assert.equal(g.turn, 0);
  assert.equal(g.rng, rng);
  g.player.focus = 0;
  assert.equal(g.identify(item.id), false);
  assert.equal(g.turn, 0);
});
test("throwing healing medicine heals the target; a thrown weapon lands intact and can be retrieved", () => {
  const g = arena(),
    e = monster(g, { hp: 2 });
  const tonic = makeItem("tonic", g.id());
  g.player.inventory = [tonic];
  g.throwItem(tonic.id, e.id);
  assert.equal(e.hp, 16);
  const blade = makeItem("blade", g.id(), { modifier: 2 });
  g.player.inventory = [blade];
  g.throwItem(blade.id, e.id);
  assert.equal(g.dungeon.objects[0].droppedItem.id, blade.id);
  e.hp = 0;
  Object.assign(g.player, { x: e.x, y: e.y });
  g.interact();
  assert.equal(g.player.inventory[0].power, 4);
});
test("closing a door cuts an advertised shot; kicking breaks a door or pushes an enemy", () => {
  const g = arena();
  const e = monster(g, {
    x: 12,
    range: 5,
    behavior: "ranged",
    intent: { tiles: [{ x: 10, y: 10 }], label: "射撃" },
  });
  g.dungeon.grid[10][11] = "/";
  const hp = g.player.hp;
  g.closeDoor({ x: 11, y: 10 });
  assert.equal(g.tile(11, 10), "+");
  assert.equal(g.player.hp, hp);
  assert.equal(e.intent, null);
  g.kick({ x: 11, y: 10 });
  assert.equal(g.tile(11, 10), ".");
  const h = arena(),
    m = monster(h);
  h.kick(m);
  assert.equal(m.x, 12);
  assert.equal(m.hp, 17);
  assert.equal(m.intent, null);
  assert.equal(h.player.focus, h.player.maxFocus - 1);
  const empty = arena(),
    next = monster(empty);
  empty.player.focus = 0;
  assert.equal(empty.kick(next), false);
  assert.equal(next.hp, 20);
  assert.equal(next.x, 11);
  assert.equal(empty.turn, 0);
});
test("search reveals a nearby secret once; its named stash is created only at discovery", () => {
  const g = arena();
  g.dungeon.grid[10][11] = "#";
  g.dungeon.secrets = [{ x: 11, y: 10, found: false }];
  g.search();
  assert.equal(g.tile(11, 10), "/");
  assert.equal(g.dungeon.drops.length, 1);
  const item = g.dungeon.drops[0].item;
  g.search();
  assert.equal(g.dungeon.drops.length, 1);
  assert.equal(g.dungeon.drops[0].item.name, item.name);
  assert.equal(g.turn, 2);
});
test("held movement follows a corner but stops at branches, items, enemies, doors and hazards", () => {
  const g = arena();
  g.dungeon.grid = g.dungeon.grid.map((r) => r.map(() => "#"));
  for (let x = 10; x <= 13; x++) g.dungeon.grid[10][x] = ".";
  for (let y = 10; y <= 14; y++) g.dungeon.grid[y][13] = ".";
  g.updateVision();
  assert.deepEqual(g.runNextDir(1, 0), [1, 0]);
  g.move(1, 0);
  g.move(1, 0);
  g.move(1, 0);
  assert.deepEqual(g.runNextDir(1, 0), [0, 1]);
  g.dungeon.grid[9][13] = ".";
  assert.equal(g.runNextDir(1, 0), null);
  g.dungeon.grid[9][13] = "#";
  Object.assign(g.player, { x: 11, y: 10 });
  g.dungeon.grid[9][11] = g.dungeon.grid[11][11] = ".";
  assert.equal(g.runNextDir(1, 0), null);
  g.dungeon.grid[9][11] = g.dungeon.grid[11][11] = "#";
  Object.assign(g.player, { x: 13, y: 10 });
  for (const tile of ["+", ">", "^", "*", '"']) {
    g.dungeon.grid[11][13] = tile;
    assert.equal(g.runNextDir(0, 1), null);
  }
  g.dungeon.grid[11][13] = ".";
  g.dungeon.drops = [{ x: 13, y: 11, id: "x", key: "tonic" }];
  assert.equal(g.runNextDir(0, 1), null);
  g.dungeon.drops = [];
  monster(g, { x: 13, y: 12 });
  assert.equal(g.runNextDir(0, 1), null);
});
test("hunger pressures indefinite waiting, bypasses wards, and food and finite camping restore it", () => {
  const g = arena();
  g.player.satiety = 1;
  g.turn = 2;
  g.player.ward = 12;
  const hp = g.player.hp;
  g.move(0, 0);
  assert.equal(g.player.satiety, 0);
  assert.equal(g.player.hp, hp - 2);
  assert.equal(g.player.ward, 12);
  const food = makeItem("ration", g.id());
  g.player.inventory = [food];
  g.useItem(food.id);
  assert.equal(g.player.satiety, 30);
  const supplies = g.player.supplies;
  g.rest();
  assert.equal(g.player.satiety, 60);
  assert.equal(g.player.supplies, supplies - 1);
});
test("requested provider defaults are used without guessing model availability", () => {
  assert.equal(PROVIDERS.openai.model, "gpt-6-luna");
  assert.equal(PROVIDERS.anthropic.model, "claude-haiku-5-5");
});

test("repeated creations get distinct selectable names and retain their fiction in the API context", () => {
  const g = arena();
  g.random = () => 0.99;
  const action = {
    ...ward,
    effects: [
      {
        kind: "create",
        target: "",
        x: 10,
        y: 10,
        name: "影の猫",
        detail: "影を編んだ旅の相棒",
        symbol: "c",
      },
    ],
  };
  g.prepare(action, "猫を編む");
  g.execute();
  g.interact();
  const first = g.player.inventory.at(-1);
  const preview = g.prepare(action, "もう一匹");
  assert.notEqual(preview.effects[0].name, first.name);
  g.execute();
  g.interact();
  const last = g.player.inventory.at(-1);
  assert.notEqual(last.name, first.name);
  assert.equal(
    g.context(null, last.id).selectedItem.lore,
    "影を編んだ旅の相棒",
  );
});

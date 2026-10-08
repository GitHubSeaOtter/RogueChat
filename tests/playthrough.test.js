import test from "node:test";
import assert from "node:assert/strict";
import { Game } from "../js/game.js";
import { localProposal } from "../js/llm.js";
import { distance } from "../js/dungeon.js";
const dirs = [
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];
function path(g, target) {
  const key = (p) => `${p.x},${p.y}`;
  const q = [g.player],
    seen = new Set([key(g.player)]),
    previous = new Map();
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    if (key(p) === key(target)) {
      let curr = p,
        step = null;
      while (previous.has(key(curr))) {
        step = curr;
        curr = previous.get(key(curr));
      }
      return step ? [step.x - g.player.x, step.y - g.player.y] : null;
    }
    for (const [dx, dy] of dirs.slice(0, 4)) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (!g.inside(n.x, n.y) || g.tile(n.x, n.y) === "#" || seen.has(key(n)))
        continue;
      seen.add(key(n));
      previous.set(key(n), p);
      q.push(n);
    }
  }
  return null;
}
function pilot(seed, background, tactical) {
  const g = new Game({ seed, background });
  for (let iter = 0; iter < 1500 && !g.ended; iter++) {
    const p = g.player,
      threats = g.threats(),
      danger = (pos) =>
        threats.some((t) =>
          t.tiles.some((k) => k.x === pos.x && k.y === pos.y),
        );
    const guardian = g.dungeon.enemies.find(
      (e) => e.type === "warden" && e.hp > 0 && !e.friendly,
    );
    const visible = g.visibleEnemies().filter((e) => !e.friendly);
    const target = tactical
      ? visible.sort((a, b) => distance(p, a) - distance(p, b))[0] ||
        guardian ||
        g.dungeon.exit
      : guardian || g.dungeon.exit;
    if (tactical && p.hp < 15) {
      const item = p.inventory.find((i) => i.kind === "heal");
      if (item) {
        g.useItem(item.id);
        continue;
      }
      if (!g.visibleEnemies().some((e) => !e.friendly) && p.supplies) {
        g.rest();
        continue;
      }
    }
    if (tactical && danger(p)) {
      const options = dirs.filter(
        ([dx, dy]) =>
          g.walkable(p.x + dx, p.y + dy) &&
          !g.enemyAt(p.x + dx, p.y + dy) &&
          !danger({ x: p.x + dx, y: p.y + dy }) &&
          !["^", "*", '"'].includes(g.tile(p.x + dx, p.y + dy)) &&
          (!dx ||
            !dy ||
            (g.walkable(p.x + dx, p.y) && g.walkable(p.x, p.y + dy))),
      );
      options.sort(
        (a, b) =>
          distance({ x: p.x + a[0], y: p.y + a[1] }, target) -
          distance({ x: p.x + b[0], y: p.y + b[1] }, target),
      );
      if (options.length) {
        g.move(...options[0]);
        continue;
      }
      const smoke = p.inventory.find((i) => i.kind === "smoke");
      if (smoke) {
        g.useItem(smoke.id);
        continue;
      }
    }
    if (tactical && !danger(p)) {
      const casterTarget = visible.find(
        (e) =>
          distance(p, e) <= 4 &&
          (distance(p, e) > 1 ||
            (e.x !== p.x &&
              e.y !== p.y &&
              (!g.walkable(e.x, p.y) || !g.walkable(p.x, e.y)))),
      );
      if (casterTarget && p.focus >= 3) {
        g.prepare(
          localProposal(g, "火花を放つ", { enemyId: casterTarget.id }),
          "火花を放つ",
        );
        g.execute();
        continue;
      }
    }
    const adjacent = g
      .visibleEnemies()
      .filter((e) => !e.friendly && distance(p, e) === 1)
      .sort((a, b) => a.hp - b.hp);
    if (adjacent.length) {
      const e = adjacent.find(
        (e) =>
          e.x === p.x ||
          e.y === p.y ||
          (g.walkable(e.x, p.y) && g.walkable(p.x, e.y)),
      );
      if (e) {
        g.move(e.x - p.x, e.y - p.y);
        continue;
      }
    }
    if (p.x === g.dungeon.exit.x && p.y === g.dungeon.exit.y && !guardian) {
      g.interact();
      continue;
    }
    const step = path(g, target);
    if (step) {
      g.move(...step);
      continue;
    }
    g.move(0, 0);
  }
  return {
    result: g.ended || "stalled",
    floor: g.floor,
    turn: g.turn,
    hp: g.player.hp,
  };
}

for (const background of ["wanderer", "scholar", "sentinel"])
  test(`all five floors can be cleared with tactical play as ${background}`, () => {
    const result = pilot(1, background, true);
    assert.equal(result.result, "won");
    assert.ok(result.turn < 1000);
  });

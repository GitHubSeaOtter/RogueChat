import { bindRepeatControls } from "./repeat.js";
import { Game, SAVE_KEY } from "./game.js";
import { WIDTH, HEIGHT, LAST_FLOOR, distance, TILES } from "./dungeon.js";
import { BACKGROUNDS, SKILLS, groupItems, itemSummary } from "./items.js";
import { PROVIDERS, proposeAction, localProposal } from "./llm.js";

const $ = (id) => document.getElementById(id);
const store = {
  read(key, session = false) {
    try {
      return (session ? sessionStorage : localStorage).getItem(key);
    } catch {
      return null;
    }
  },
  write(key, value, session = false) {
    try {
      (session ? sessionStorage : localStorage).setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key, session = false) {
    try {
      (session ? sessionStorage : localStorage).removeItem(key);
    } catch {
      /* Storage may be unavailable. */
    }
  },
  json(key, session = false) {
    try {
      return JSON.parse(this.read(key, session)) || {};
    } catch {
      return {};
    }
  },
};
const meta = store.json("roguechat_v2_api");
const credentials = {};
for (const provider of Object.keys(PROVIDERS))
  credentials[provider] = {
    key:
      store.read(`roguechat_v2_key_${provider}`, true) ||
      store.read(`roguechat_v2_key_${provider}`) ||
      "",
    remember: !!store.read(`roguechat_v2_key_${provider}`),
    model:
      typeof meta.models?.[provider] === "string" &&
      !["gpt-4.1-mini", "claude-haiku-4-5-20251001"].includes(
        meta.models[provider],
      )
        ? meta.models[provider]
        : PROVIDERS[provider].model,
  };
let activeProvider = Object.hasOwn(PROVIDERS, meta.provider)
  ? meta.provider
  : "openai";
let editingProvider = activeProvider;
let game = null,
  selected = null,
  requestController = null,
  lastMessage = null,
  endingShown = false;
let toastTimer;
let activeTab = "controls",
  activeItemId = null,
  activeGroupKey = null,
  keyboardDirection = null;
let stopRepeat = () => {};
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 6500);
}
function config() {
  return { provider: activeProvider, ...credentials[activeProvider] };
}
function open(id) {
  stopRepeat();
  if (!$(id).open) $(id).showModal();
}
function close(id) {
  $(id).close();
  requestAnimationFrame(() => {
    if (game?.ended && !endingShown && !hasModal()) showEnding();
  });
}
function hasModal() {
  return [...document.querySelectorAll("dialog")].some((d) => d.open);
}
function blocked() {
  return !game || !!game.ended || !!requestController || hasModal();
}
function el(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function button(text, handler, className) {
  const element = el("button", text, className);
  element.type = "button";
  element.addEventListener("click", handler);
  return element;
}
function save() {
  if (!game) return;
  const saved = store.write(SAVE_KEY, game.serialize());
  $("save-status").textContent = saved
    ? "自動セーブ済み"
    : "保存不可：このタブでのみ継続";
}
function renderMode() {
  const connected = !!config().key;
  $("mode-button").textContent = connected
    ? `${PROVIDERS[activeProvider].name}`
    : "内蔵ルール";
  $("mode-button").title =
    "API設定を開く（接続設定は実際の認証成功を保証しません）";
  $("action-source").textContent = connected
    ? `${PROVIDERS[activeProvider].name} / ${config().model}`
    : "内蔵アクション";
}
function renderMap() {
  if (!game) return;
  const p = game.player,
    map = $("map"),
    mobile = window.innerWidth <= 760;
  const availableWidth = Math.max(120, map.clientWidth - 6),
    availableHeight = Math.max(40, map.clientHeight - 6);
  const targetSize = mobile ? 15 : 20;
  const cols = Math.max(
    11,
    Math.min(mobile ? 25 : WIDTH, Math.floor(availableWidth / targetSize)),
  );
  const rows = Math.max(
    3,
    Math.min(HEIGHT, Math.floor(availableHeight / targetSize)),
  );
  const cell = Math.max(
    5,
    Math.min(22, availableWidth / cols, availableHeight / rows),
  );
  map.style.setProperty("--rows", rows);
  map.style.setProperty("--cell", `${cell}px`);
  map.style.setProperty("--glyph-size", `${Math.max(7, cell * 0.9)}px`);
  const ox = Math.max(0, Math.min(WIDTH - cols, p.x - Math.floor(cols / 2))),
    oy = Math.max(0, Math.min(HEIGHT - rows, p.y - Math.floor(rows / 2)));
  const threats = new Set(
    game.threats().flatMap((t) => t.tiles.map((p) => `${p.x},${p.y}`)),
  );
  const fragment = document.createDocumentFragment();
  map.style.setProperty("--cols", cols);
  for (let y = oy; y < oy + rows; y++)
    for (let x = ox; x < ox + cols; x++) {
      const visible = game.visible[y][x],
        seen = game.seen[y][x],
        tile = game.rememberedTile(x, y);
      const enemy = visible && game.enemyAt(x, y),
        item =
          visible && game.dungeon.drops.find((i) => i.x === x && i.y === y),
        obj =
          visible && game.dungeon.objects.find((o) => o.x === x && o.y === y);
      const player = p.x === x && p.y === y;
      let symbol = seen ? tile : " ",
        className = "cell";
      if (!seen) className += " unseen";
      else if (!visible) className += " memory";
      else if (enemy) {
        symbol = enemy.symbol;
        className += enemy.friendly ? " friendly" : " enemy";
      } else if (item) {
        symbol =
          {
            tonic: "!",
            focus: "!",
            oil: "!",
            ration: "%",
            smoke: "?",
            blink: "?",
            blade: ")",
            mail: "[",
          }[item.key] || "&";
        className += " item";
      } else if (obj) {
        symbol = obj.symbol;
        className += " item";
      } else if (tile === "#") className += " wall";
      else if (tile === "~") className += " water";
      else if (tile === "*") className += " fire";
      else if ("><0&".includes(tile)) className += " special";
      if (threats.has(`${x},${y}`)) className += " threat";
      if (selected?.x === x && selected?.y === y) className += " selected";
      if (player) {
        symbol = "@";
        className += " player";
      }
      const cell = button(symbol, () => selectCell(x, y), className);
      cell.dataset.x = x;
      cell.dataset.y = y;
      cell.tabIndex = selected
        ? selected.x === x && selected.y === y
          ? 0
          : -1
        : player
          ? 0
          : -1;
      cell.setAttribute(
        "aria-label",
        `${x},${y} ${player ? "あなた" : visible ? enemy?.name || obj?.name || (item ? "落ちている道具" : TILES[tile].name) : seen ? "地形の記憶" : "未踏"}`,
      );
      cell.title = visible
        ? `${symbol} ${enemy?.name || obj?.name || TILES[tile].name}`
        : seen
          ? "地形の記憶"
          : "未踏";
      fragment.append(cell);
    }
  map.replaceChildren(fragment);
}
function selectCell(x, y) {
  if (requestController) return;
  selected = game.inspect(x, y);
  $("inspect-title").textContent = selected.title;
  $("inspect-detail").textContent = selected.detail;
  $("selected-coordinate").textContent =
    `選択中 (${x}, ${y})${game.visible[y]?.[x] ? " / 行動の対象" : " / 視界外"}。移動は方向ボタンで。`;
  switchTab("observe");
  renderMap();
}
function renderThreats() {
  const list = $("threat-list");
  list.replaceChildren();
  const threats = game.threats();
  const incoming = threats
    .filter((t) =>
      t.tiles.some((p) => p.x === game.player.x && p.y === game.player.y),
    )
    .reduce((sum, t) => sum + t.damage, 0);
  $("map-state").textContent = incoming
    ? `次の一手：現在位置に被弾 ${incoming} / 移動で回避`
    : "時間は、あなたを待つ";
  $("map-state").style.color = incoming ? "var(--red)" : "";
  if (!threats.length)
    list.append(
      el(
        "p",
        game.visibleEnemies().some((e) => !e.friendly)
          ? "敵が近くにいる。次の予告に備えよう。"
          : "攻撃の予告なし。探索や工夫の時間。",
        "safe-note",
      ),
    );
  for (const t of threats) {
    const enemy = game.dungeon.enemies.find((e) => e.id === t.id);
    const onPlayer = t.tiles.some(
      (p) => p.x === game.player.x && p.y === game.player.y,
    );
    const row = button("", () => selectCell(enemy.x, enemy.y), "threat-row");
    row.append(
      el("b", `${enemy.symbol} ${t.name} / ${t.label}`),
      el(
        "span",
        `${onPlayer ? "現在位置が危険" : "赤いマスを避ける"} · 被弾 ${t.damage} · 次の1ターン`,
      ),
    );
    list.append(row);
  }
}
function logEntry(message) {
  const entry = el("div", undefined, `log-entry ${message.kind}`);
  entry.append(
    el("time", String(message.turn).padStart(3, "0")),
    el("p", message.text),
  );
  entry.title = message.text;
  return entry;
}
function renderLog() {
  const latest = game.messages.at(-1);
  if (latest === lastMessage) return;
  $("log").replaceChildren(...game.messages.slice(-3).map(logEntry));
  lastMessage = latest;
}
function switchTab(tab, focus = false) {
  if (!["controls", "command", "inventory", "observe"].includes(tab)) return;
  stopRepeat();
  activeTab = tab;
  for (const button of document.querySelectorAll("[data-tab]")) {
    const chosen = button.dataset.tab === tab;
    button.setAttribute("aria-selected", String(chosen));
    button.tabIndex = chosen ? 0 : -1;
    $(button.getAttribute("aria-controls")).hidden = !chosen;
    if (chosen && focus) button.focus();
  }
  if (tab === "inventory" && game) renderInventory();
  requestAnimationFrame(renderMap);
}
for (const tab of document.querySelectorAll("[data-tab]")) {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  tab.addEventListener("keydown", (event) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const tabs = ["controls", "command", "inventory", "observe"];
    let index = tabs.indexOf(activeTab);
    index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 3
          : (index + (event.key === "ArrowRight" ? 1 : 3)) % 4;
    switchTab(tabs[index], true);
  });
}
$("history-button").addEventListener("click", () => {
  if (!game) return;
  $("full-history").replaceChildren(...game.messages.map(logEntry));
  open("history-dialog");
  $("full-history").lastElementChild?.scrollIntoView({ block: "end" });
});
function fitViewport() {
  const h = window.visualViewport?.height || innerHeight;
  document.documentElement.dataset.viewport =
    h < 420 ? "tiny" : h < 620 ? "short" : "normal";
  document.documentElement.style.setProperty("--viewport-height", `${h}px`);
  requestAnimationFrame(renderMap);
}
window.visualViewport?.addEventListener("resize", fitViewport);
window.addEventListener("resize", fitViewport);
new ResizeObserver(() => requestAnimationFrame(renderMap)).observe($("map"));
fitViewport();
function render() {
  if (!game) return;
  const p = game.player;
  $("floor-title").textContent = game.dungeon.theme.name;
  $("floor-badge").textContent = `B${game.floor} / ${LAST_FLOOR}`;
  $("objective").textContent =
    game.floor === LAST_FLOOR
      ? "守護者を越え、「0」の上で星を持ち帰る。"
      : "「>」へ向かい、第五層の「星の核」を目指す。";
  $("player-name").textContent = p.name;
  $("level-text").textContent = `Lv.${p.level} / XP ${p.xp}/${p.level * 9}`;
  for (const [id, value, max] of [
    ["hp", p.hp, p.maxHp],
    ["focus", p.focus, p.maxFocus],
  ]) {
    $(`${id}-text`).textContent = `${value} / ${max}`;
    $(`${id}-bar`).max = max;
    $(`${id}-bar`).value = value;
  }
  $("turn-text").textContent = `TURN ${String(game.turn).padStart(3, "0")}`;
  $("coordinates").textContent = `${p.x}, ${p.y}`;
  $("combat-stats").textContent =
    `攻 ${game.attack()} / 守 ${game.defense()} · 力 ${p.skills.might} / 技・知 ${p.skills.wit} / 心 ${p.skills.spirit}`;
  $("status-text").textContent = [
    p.ward && `護り ${p.ward}`,
    p.poison && `毒 ${p.poison}T`,
    p.burning && `炎上 ${p.burning}T`,
    p.stuck && "拘束 1T",
  ]
    .filter(Boolean)
    .join(" / ");
  $("supply-count").textContent = `${p.supplies}回`;
  $("hunger-text").textContent = `満腹 ${p.satiety ?? 100}`;
  $("hunger-text").style.color = p.satiety <= 20 ? "var(--red)" : "";
  const tile = game.tile(p.x, p.y);
  const interact = $("interact-button");
  interact.replaceChildren(
    el(
      "span",
      tile === "0"
        ? "星を持ち帰る"
        : tile === "&"
          ? "野営地を使う"
          : game.dungeon.objects.some((o) => o.x === p.x && o.y === p.y)
            ? "道具を拾う"
            : "先へ進む",
    ),
    el("span", tile === "0" ? "0" : ">"),
  );
  $("seed-text").textContent = `SEED ${game.seed}`;
  for (const element of document.querySelectorAll(
    ".play-controls button, #command-form button, #command-input, #suggestions button",
  ))
    element.disabled = !!game.ended || !!requestController;
  renderMap();
  renderThreats();
  renderLog();
  renderMode();
  if (activeItemId && !game.resolveItem(activeItemId)) activeItemId = null;
  $("active-item").hidden = !activeItemId;
  if (activeItemId)
    $("active-item-name").textContent =
      `名前を活かす：${game.resolveItem(activeItemId).name}`;
  if (activeTab === "inventory") renderInventory();
  if (selected) {
    selected = game.inspect(selected.x, selected.y);
    $("inspect-title").textContent = selected.title;
    $("inspect-detail").textContent = selected.detail;
  }
  if (game.ended && !endingShown && !hasModal()) showEnding();
}
function perform(action) {
  if (blocked()) return;
  const revision = game.revision;
  action();
  if (game.revision !== revision) save();
  render();
}
function showEnding() {
  endingShown = true;
  const won = game.ended === "won";
  $("ending-label").textContent = won
    ? "A WORLD YOU HAVE WRITTEN"
    : "A STORY TO REMEMBER";
  $("ending-ascii").textContent = won
    ? "     .   *   .\n   --  \\ | /  --\n       --@--\n   --  / | \\  --\n     .   *   ."
    : "    +---------+\n    |    @    |\n    |  . . .  |\n    +---------+";
  $("ending-title").textContent = won
    ? "あなたは、星を持ち帰った。"
    : "この旅の、最後の一頁。";
  $("ending-description").textContent = won
    ? "力だけが道ではなかった。あなたの工夫が残した世界は、これからも続いていく。"
    : "敵の予告、使いきれなかった道具、あと一歩の工夫。この記憶を、次の冒険へ。";
  $("ending-stats").textContent =
    `${game.player.name} / B${game.floor} / Lv.${game.player.level} / ${game.turn}ターン / 世界に残した記憶 ${game.memory.length}件`;
  open("ending-dialog");
}

async function propose(command, builtin = false) {
  if (blocked()) return;
  command = command.trim();
  if (!command) {
    toast("試したい行動を入力してください。");
    return;
  }
  try {
    let raw;
    if (builtin || !config().key) raw = localProposal(game, command, selected);
    else {
      requestController = new AbortController();
      $("request-status").hidden = false;
      render();
      raw = await proposeAction(
        config(),
        game.context(selected, builtin ? null : activeItemId),
        command,
        {
          signal: requestController.signal,
        },
      );
    }
    const proposal = game.prepare(raw, command, builtin ? null : activeItemId);
    renderProposal(
      proposal,
      builtin || !config().key ? "内蔵ルール" : PROVIDERS[activeProvider].name,
    );
    open("proposal-dialog");
  } catch (error) {
    toast(error.message);
  } finally {
    requestController = null;
    $("request-status").hidden = true;
    render();
  }
}
function renderProposal(a, source) {
  $("proposal-title").textContent = a.title;
  $("proposal-reason").textContent = `${source}：${a.reasoning}`;
  $("proposal-chance").textContent = `${a.chance}%`;
  $("proposal-cost").textContent = `−${a.cost}`;
  $("proposal-roll").textContent =
    `d6 ＋ ${SKILLS[a.skill]}・道具・工夫 ${a.bonus} ≥ ${a.threshold} / 現在の集中 ${game.player.focus}`;
  $("proposal-effects").replaceChildren(
    ...a.effects.map((e) => el("li", game.effectDescription(e, a))),
  );
  $("proposal-materials").textContent = a.consumes.length
    ? `成功・失敗にかかわらず使い切る材料：${a.consumes.map((id) => game.player.inventory.find((i) => i.id === id).name).join("、")}`
    : "消費する材料なし。";
  const threats = game
    .threats()
    .filter((t) =>
      t.tiles.some((pos) => pos.x === game.player.x && pos.y === game.player.y),
    );
  const attack = threats.length
    ? `現在位置への予告は合計${threats.reduce((sum, t) => sum + t.damage, 0)}ダメージ（護り適用前）。成功効果で避けられなければ被弾します。`
    : "現在位置への攻撃予告はありません。敵の接近や新しい予告は起こります。";
  const status =
    game.player.poison || game.player.burning
      ? `現在の継続ダメージは${(game.player.poison ? 2 : 0) + (game.player.burning ? 2 : 0)}。解除しないとターン終了時に受けます。`
      : "";
  const hazard = a.effects.some(
    (e) =>
      (e.kind === "move" && ["^", "*", '"'].includes(game.tile(e.x, e.y))) ||
      (e.kind === "terrain" &&
        e.symbol === "*" &&
        e.x === game.player.x &&
        e.y === game.player.y),
  )
    ? "移動先や足元の罠・炎・糸も発動します。"
    : "";
  $("proposal-risk").textContent =
    `失敗すると効果は発生せず、集中${a.cost}${a.consumes.length ? "と材料" : ""}を失います。${attack}${status}${hazard}`;
  $("proposal-error").textContent =
    game.player.focus < a.cost
      ? "集中が不足しています。規模を小さくするか、回復してから試そう。"
      : a.chance === 0
        ? "今の能力では成功しません。道具や方法を変えてください。"
        : "";
  $("proposal-execute").disabled = game.player.focus < a.cost || a.chance === 0;
}
$("proposal-execute").addEventListener("click", () => {
  try {
    game.execute();
    close("proposal-dialog");
    save();
    render();
  } catch (error) {
    $("proposal-error").textContent = error.message;
  }
});
$("proposal-cancel").addEventListener("click", () => {
  game.pending = null;
  close("proposal-dialog");
});
$("proposal-dialog").addEventListener("cancel", () => (game.pending = null));
$("command-form").addEventListener("submit", (event) => {
  event.preventDefault();
  propose($("command-input").value);
});
$("command-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("command-form").requestSubmit();
  }
});
for (const suggestion of document.querySelectorAll("[data-command]"))
  suggestion.addEventListener("click", () => {
    $("command-input").value = suggestion.dataset.command;
    activeItemId = null;
    propose(suggestion.dataset.command, true);
  });
$("cancel-request").addEventListener("click", () => requestController?.abort());
stopRepeat = bindRepeatControls(document.querySelectorAll("[data-dx]"), {
  blocked,
  next: (dx, dy) => game.runNextDir(dx, dy),
  step: (dx, dy) => {
    if (blocked()) return false;
    const count = game.player.inventory.length;
    const result = game.move(dx, dy);
    if (result) save();
    render();
    return result && game.player.inventory.length === count;
  },
});
$("interact-button").addEventListener("click", () =>
  perform(() => game.interact()),
);
$("rest-button").addEventListener("click", () => perform(() => game.rest()));
$("guard-button").addEventListener("click", () => propose("身を守る", true));

function showInventory() {
  if (blocked()) return;
  switchTab("inventory");
}
function renderInventory() {
  const p = game.player,
    groups = groupItems(p.inventory);
  $("inventory-count").textContent = `${p.inventory.length}/18`;
  $("equipment-text").textContent =
    `武器：${p.equipment.weapon?.name || "旅の短剣"} / 防具：${p.equipment.armor?.name || "旅装"}`;
  for (const id of ["dock-inventory-list", "inventory-list"]) {
    const list = $(id);
    list.replaceChildren();
    if (!groups.length)
      list.append(
        el("p", "持ち物はない。探索や創作で道具を手に入れよう。", "hint"),
      );
    for (const group of groups) {
      const row = button("", () => openGroup(group.key), "item-group");
      row.dataset.group = group.key;
      row.append(
        el("strong", `${group.symbol} ${group.name}`),
        el("b", `×${group.items.length} ›`),
      );
      list.append(row);
    }
  }
}
function selectedInstance() {
  return $("instance-select").value || activeGroupKey;
}
function openGroup(key) {
  if (!game || game.ended || requestController) return;
  if ($("inventory-dialog").open) close("inventory-dialog");
  activeGroupKey = key;
  const items = game.player.inventory.filter(
    (i) => (i.key || "custom") === key,
  );
  if (!items.length) return;
  $("group-title").textContent =
    `${groupItems(items)[0].name} ×${items.length}`;
  $("instance-select").replaceChildren(
    new Option("おまかせ（名前を選ばない）", ""),
    ...items.map(
      (i) =>
        new Option(
          `${i.name}${i.identified ? " / 識別済み" : " / 未識別"}`,
          i.id,
        ),
    ),
  );
  updateInstance();
  open("group-dialog");
}
function updateInstance() {
  const item = game.resolveItem(selectedInstance());
  if (!item) return;
  $("instance-detail").textContent =
    `${item.name}：${itemSummary(item)}${item.lore ? ` / ${item.lore}` : ""}${item.source ? ` / 出自：${item.source}` : ""}`;
  $("identify-info").textContent = item.identified
    ? "識別済み：使用前に補正を確認できます。"
    : `識別：集中1・1ターン / 成功率 ${game.identifyChance()}%。補正値はすでに固定されています。`;
  $("item-identify").disabled = item.identified || game.player.focus < 1;
  $("item-use").textContent = ["weapon", "armor"].includes(item.kind)
    ? "装備する"
    : "使う";
}
$("instance-select").addEventListener("change", updateInstance);
function itemAction(action) {
  const before = game.revision;
  action();
  if (game.revision !== before) {
    close("group-dialog");
    save();
    render();
  } else toast(game.messages.at(-1)?.text || "この操作はできません。");
}
$("item-use").addEventListener("click", () =>
  itemAction(() => game.useItem(selectedInstance(), selected?.enemyId)),
);
$("item-identify").addEventListener("click", () =>
  itemAction(() => game.identify(selectedInstance())),
);
$("item-throw").addEventListener("click", () =>
  itemAction(() => game.throwItem(selectedInstance(), selected?.enemyId)),
);
$("item-drop").addEventListener("click", () =>
  itemAction(() => game.dropItem(game.resolveItem(selectedInstance())?.id)),
);
$("item-language").addEventListener("click", () => {
  const item = game.resolveItem(selectedInstance());
  if (!item) return;
  activeItemId = item.id;
  close("group-dialog");
  if ($("inventory-dialog").open) close("inventory-dialog");
  switchTab("command");
  $("command-input").value = `${item.name}を使って、`;
  render();
  $("command-input").focus();
});
$("clear-active-item").addEventListener("click", () => {
  activeItemId = null;
  render();
});
$("inventory-button").addEventListener("click", showInventory);
$("equipment-button").addEventListener("click", () => {
  renderInventory();
  const list = $("inventory-list");
  for (const [slot, item] of Object.entries(game.player.equipment))
    if (item) {
      const row = el("div", undefined, "inventory-item");
      row.append(
        el("h3", item.name),
        el("p", itemSummary(item)),
        button("外す（1ターン）", () => {
          game.unequip(slot);
          close("inventory-dialog");
          save();
          render();
        }),
      );
      list.prepend(row);
    }
  open("inventory-dialog");
});
$("search-button").addEventListener("click", () =>
  perform(() => game.search()),
);
$("door-button").addEventListener("click", () =>
  perform(() => game.closeDoor(selected)),
);
$("kick-button").addEventListener("click", () =>
  perform(() => game.kick(selected)),
);
function craftChoices(typeId, nameId) {
  const key = $(typeId).value,
    items = game.player.inventory.filter((i) => (i.key || "custom") === key);
  $(nameId).replaceChildren(
    new Option("おまかせ", ""),
    ...items.map((i) => new Option(i.name, i.id)),
  );
}
function craftSelections() {
  return [
    $("craft-instance-a").value || $("craft-type-a").value,
    $("craft-instance-b").value || $("craft-type-b").value,
  ];
}
function updateCraft() {
  try {
    const preview = game.craftPreview(...craftSelections());
    $("craft-preview").textContent =
      `${preview.a.name} × ${preview.b.name} → ${preview.recipe.name} / 成功率 ${preview.chance}% / 集中−3（現在${game.player.focus}）`;
    $("craft-error").textContent =
      game.player.focus < 3 ? "集中が足りません。" : "";
    $("craft-execute").disabled = game.player.focus < 3 || preview.chance === 0;
  } catch (error) {
    $("craft-error").textContent = error.message;
    $("craft-preview").textContent = "";
    $("craft-execute").disabled = true;
  }
}
function showCraft() {
  if (blocked()) return;
  const groups = groupItems(game.player.inventory);
  for (const id of ["craft-type-a", "craft-type-b"])
    $(id).replaceChildren(
      ...groups.map((g) => new Option(`${g.name} ×${g.items.length}`, g.key)),
    );
  if (groups.length > 1) $("craft-type-b").selectedIndex = 1;
  craftChoices("craft-type-a", "craft-instance-a");
  craftChoices("craft-type-b", "craft-instance-b");
  updateCraft();
  open("craft-dialog");
}
for (const [type, name] of [
  ["craft-type-a", "craft-instance-a"],
  ["craft-type-b", "craft-instance-b"],
]) {
  $(type).addEventListener("change", () => {
    craftChoices(type, name);
    updateCraft();
  });
  $(name).addEventListener("change", updateCraft);
}
$("craft-button").addEventListener("click", showCraft);
$("dock-craft-button").addEventListener("click", showCraft);
$("craft-execute").addEventListener("click", () => {
  const before = game.revision;
  game.craft(...craftSelections());
  if (game.revision !== before) {
    close("craft-dialog");
    save();
    render();
  } else updateCraft();
});
function showMemory() {
  if (!game || requestController) return;
  const list = $("memory-list");
  list.replaceChildren();
  if (!game.memory.length)
    list.append(
      el("p", "まだ書かれていない。最初の一手が、世界の記憶になる。"),
    );
  for (const m of [...game.memory].reverse()) {
    const row = el("div", undefined, "memory-item");
    row.append(
      el("p", `B${m.floor} / TURN ${m.turn}`, "hint"),
      el("h3", m.action),
      el("p", m.result),
      el("p", m.effects.join(" / ")),
    );
    list.append(row);
  }
  open("memory-dialog");
}
$("memory-button").addEventListener("click", showMemory);
$("help-button").addEventListener("click", () => open("help-dialog"));
for (const b of document.querySelectorAll("[data-close]"))
  b.addEventListener("click", () => close(b.dataset.close));

function fillSettings(provider) {
  editingProvider = provider;
  const c = credentials[provider];
  $("provider-input").value = provider;
  $("key-input").value = c.key;
  $("model-input").value = c.model;
  $("remember-key").checked = c.remember;
  $("settings-error").textContent = "";
}
function settings() {
  if (requestController) return;
  fillSettings(activeProvider);
  open("settings-dialog");
}
$("mode-button").addEventListener("click", settings);
$("start-settings").addEventListener("click", settings);
$("provider-input").addEventListener("change", () => {
  fillSettings($("provider-input").value);
});
$("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const provider = editingProvider,
    model = $("model-input").value.trim();
  if (!/^[\w.:-]+$/.test(model)) {
    $("settings-error").textContent = "有効なモデルIDを指定してください。";
    return;
  }
  credentials[provider] = {
    key: $("key-input").value.trim(),
    model,
    remember: $("remember-key").checked,
  };
  const c = credentials[provider],
    key = `roguechat_v2_key_${provider}`;
  store.remove(key);
  store.remove(key, true);
  if (c.key && !store.write(key, c.key, !c.remember))
    toast(
      "ブラウザに設定を保存できません。この画面を開いている間だけ使用します。",
    );
  activeProvider = provider;
  store.write(
    "roguechat_v2_api",
    JSON.stringify({
      provider,
      models: Object.fromEntries(
        Object.entries(credentials).map(([p, c]) => [p, c.model]),
      ),
    }),
  );
  close("settings-dialog");
  renderMode();
  toast(
    c.key
      ? "接続設定を保存しました。次の自由行動でAPIを使用します。"
      : "内蔵ルールで遊べます。",
  );
});
$("clear-keys").addEventListener("click", () => {
  for (const provider of Object.keys(PROVIDERS)) {
    credentials[provider].key = "";
    credentials[provider].remember = false;
    store.remove(`roguechat_v2_key_${provider}`);
    store.remove(`roguechat_v2_key_${provider}`, true);
  }
  // Also erase the obsolete version's persisted API key when explicitly clearing all keys.
  store.remove("roguechat_apikey");
  fillSettings(editingProvider);
  renderMode();
  toast("このブラウザのRogueChat APIキーをすべて消去しました。");
});

const keymap = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  w: [0, -1],
  a: [-1, 0],
  s: [0, 1],
  d: [1, 0],
  h: [-1, 0],
  j: [0, 1],
  k: [0, -1],
  l: [1, 0],
  y: [-1, -1],
  u: [1, -1],
  b: [-1, 1],
  n: [1, 1],
  ".": [0, 0],
};
window.addEventListener("keydown", (event) => {
  if (
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) ||
    blocked()
  )
    return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.key === "S") {
    event.preventDefault();
    perform(() => game.search());
    return;
  }
  if (keymap[key]) {
    event.preventDefault();
    if (!event.repeat) {
      keyboardDirection = keymap[key];
      perform(() => game.move(...keyboardDirection));
    } else if (key !== "." && keyboardDirection) {
      const next = game.runNextDir(...keyboardDirection);
      keyboardDirection = next;
      if (next) perform(() => game.move(...next));
    }
  } else if (key === "i") {
    event.preventDefault();
    showInventory();
  } else if (key === "r") {
    event.preventDefault();
    perform(() => game.rest());
  } else if (key === "g") {
    event.preventDefault();
    propose("身を守る", true);
  } else if (key === ">" || key === "e") {
    event.preventDefault();
    perform(() => game.interact());
  } else if (key === "/") {
    event.preventDefault();
    switchTab("command");
    $("command-input").focus();
  } else if (key === "?") {
    event.preventDefault();
    open("help-dialog");
  }
});
window.addEventListener("keyup", () => (keyboardDirection = null));
window.addEventListener("blur", () => (keyboardDirection = null));

for (const [key, b] of Object.entries(BACKGROUNDS)) {
  const label = el("label", undefined, "background-card"),
    radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "background";
  radio.value = key;
  radio.checked = key === "wanderer";
  const desc = el("div");
  desc.append(
    el("b", b.name),
    el("span", b.subtitle),
    el(
      "span",
      `生命 ${b.hp} / 集中 ${b.focus} / 力 ${b.skills.might} · 技・知 ${b.skills.wit} · 心 ${b.skills.spirit}`,
    ),
  );
  label.append(radio, desc);
  $("background-options").append(label);
}
function showStart(initial = false) {
  if (requestController) return;
  $("resume-box").hidden = !game;
  $("start-close").hidden = initial || !game;
  $("restart-warning").hidden = !game;
  if (game) {
    $("resume-description").textContent =
      `${game.player.name} / B${game.floor} ${game.dungeon.theme.name} / ${game.turn}ターン${game.ended ? " / 冒険終了" : ""}`;
    $("resume-button").textContent = game.ended
      ? "旅の記録を見る"
      : "旅を続ける";
  }
  const profile = store.json("roguechat_v2_profile");
  if (profile.name) $("name-input").value = profile.name;
  if (profile.personality) $("personality-input").value = profile.personality;
  if (Object.hasOwn(BACKGROUNDS, profile.background))
    document.querySelector(
      `input[name="background"][value="${profile.background}"]`,
    ).checked = true;
  open("start-dialog");
}
$("start-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const seed = $("seed-input").value
    ? Number($("seed-input").value)
    : crypto.getRandomValues(new Uint32Array(1))[0] || 1;
  const profile = {
    name: $("name-input").value,
    personality: $("personality-input").value,
    background: document.querySelector('input[name="background"]:checked')
      .value,
  };
  game = new Game({ ...profile, seed });
  selected = null;
  activeItemId = null;
  switchTab("controls");
  lastMessage = null;
  endingShown = false;
  $("inspect-title").textContent = "@ 旅人";
  $("inspect-detail").textContent =
    "地図の記号を選ぶと、敵の特性や地形の使い道が分かります。";
  $("selected-coordinate").textContent = "";
  store.write("roguechat_v2_profile", JSON.stringify(profile));
  close("start-dialog");
  save();
  render();
});
$("resume-button").addEventListener("click", () => {
  close("start-dialog");
  render();
});
$("start-close").addEventListener("click", () => close("start-dialog"));
$("start-dialog").addEventListener("cancel", (event) => {
  if (!game) event.preventDefault();
});
$("new-button").addEventListener("click", () => showStart());
$("ending-new").addEventListener("click", () => {
  close("ending-dialog");
  showStart();
});

const saved = store.read(SAVE_KEY);
if (saved) {
  try {
    game = Game.restore(saved);
  } catch {
    toast("セーブを読み込めませんでした。新しい旅を始めてください。");
  }
}
showStart(true);
if (game) render();
renderMode();

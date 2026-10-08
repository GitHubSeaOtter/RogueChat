import { Game, SAVE_KEY } from "./game.js";
import { WIDTH, HEIGHT, LAST_FLOOR, distance, TILES } from "./dungeon.js";
import { BACKGROUNDS, SKILLS } from "./items.js";
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
      typeof meta.models?.[provider] === "string"
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
  if (!$(id).open) $(id).showModal();
}
function close(id) {
  $(id).close();
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
    mobile = window.innerWidth <= 760;
  const cols = mobile ? 25 : WIDTH,
    rows = mobile ? 19 : HEIGHT;
  const ox = Math.max(0, Math.min(WIDTH - cols, p.x - Math.floor(cols / 2))),
    oy = Math.max(0, Math.min(HEIGHT - rows, p.y - Math.floor(rows / 2)));
  const threats = new Set(
    game.threats().flatMap((t) => t.tiles.map((p) => `${p.x},${p.y}`)),
  );
  const map = $("map"),
    fragment = document.createDocumentFragment();
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
function renderLog() {
  const log = $("log"),
    latest = game.messages.at(-1);
  if (latest === lastMessage) return;
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 70;
  const start = game.messages.indexOf(lastMessage);
  if (start < 0) log.replaceChildren();
  for (const message of game.messages.slice(start + 1)) {
    const entry = el("div", undefined, `log-entry ${message.kind}`);
    entry.append(
      el("time", `TURN ${String(message.turn).padStart(3, "0")}`),
      el("p", message.text),
    );
    log.append(entry);
  }
  while (log.children.length > 70) log.firstElementChild.remove();
  lastMessage = latest;
  if (nearBottom || start < 0) log.scrollTop = log.scrollHeight;
}
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
      raw = await proposeAction(config(), game.context(selected), command, {
        signal: requestController.signal,
      });
    }
    const proposal = game.prepare(raw, command);
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
    propose(suggestion.dataset.command, true);
  });
$("cancel-request").addEventListener("click", () => requestController?.abort());
for (const direction of document.querySelectorAll("[data-dx]"))
  direction.addEventListener("click", () =>
    perform(() =>
      game.move(Number(direction.dataset.dx), Number(direction.dataset.dy)),
    ),
  );
$("interact-button").addEventListener("click", () =>
  perform(() => game.interact()),
);
$("rest-button").addEventListener("click", () => perform(() => game.rest()));
$("guard-button").addEventListener("click", () => propose("身を守る", true));

function showInventory() {
  if (blocked()) return;
  renderInventory();
  open("inventory-dialog");
}
function renderInventory() {
  const p = game.player,
    list = $("inventory-list");
  list.replaceChildren();
  $("equipment-text").textContent =
    `武器：${p.equipment.weapon?.name || "旅の短剣"} / 防具：${p.equipment.armor?.name || "旅装"} / ${p.inventory.length}/18個`;
  if (!p.inventory.length)
    list.append(
      el("p", "今は何も持っていない。世界に道具をつくることもできる。"),
    );
  for (const item of p.inventory) {
    const row = el("div", undefined, "inventory-item");
    row.append(
      el("h3", `${item.symbol} ${item.name}`),
      el("p", `${item.detail} [${item.tags.join(" / ")}]`),
    );
    const actions = el("div", undefined, "item-actions");
    if (item.kind !== "tool")
      actions.append(
        button(
          ["weapon", "armor"].includes(item.kind) ? "装備する" : "使う",
          () => {
            const before = game.revision;
            game.useItem(item.id, selected?.enemyId);
            if (game.revision !== before) {
              close("inventory-dialog");
              save();
            } else toast(game.messages.at(-1).text);
            render();
          },
          "primary",
        ),
      );
    else actions.append(el("span", "所持するだけで判定を助ける", "hint"));
    actions.append(
      button("床に置く", () => {
        game.dropItem(item.id);
        close("inventory-dialog");
        save();
        render();
      }),
    );
    row.append(actions);
    list.append(row);
  }
}
$("inventory-button").addEventListener("click", showInventory);
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
  if (keymap[key]) {
    event.preventDefault();
    if (!event.repeat || !game.visibleEnemies().some((e) => !e.friendly))
      perform(() => game.move(...keymap[key]));
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
    $("command-input").focus();
  } else if (key === "?") {
    event.preventDefault();
    open("help-dialog");
  }
});
window.addEventListener("resize", renderMap);

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

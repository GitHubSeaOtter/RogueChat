export const ITEMS = {
  tonic: {
    name: "赤い回復薬",
    symbol: "!",
    kind: "heal",
    detail: "HPを14回復。毒と炎上も解除。1ターン。",
    tags: ["液体", "薬"],
  },
  focus: {
    name: "青い記憶薬",
    symbol: "!",
    kind: "focus",
    detail: "集中を8回復。1ターン。",
    tags: ["液体", "魔力"],
  },
  smoke: {
    name: "煙の巻物",
    symbol: "?",
    kind: "smoke",
    detail: "見える敵を3ターン足止め。逃走や仕切り直しに。",
    tags: ["煙", "紙"],
  },
  blink: {
    name: "帰還の巻物",
    symbol: "?",
    kind: "blink",
    detail: "この階の入口へ瞬間移動。1ターン。",
    tags: ["空間", "紙"],
  },
  oil: {
    name: "油の小瓶",
    symbol: "!",
    kind: "oil",
    detail: "選択した3マス以内の敵に8ダメージ＋炎上。地形や創作の材料にも。",
    tags: ["油", "可燃", "瓶"],
  },
  ration: {
    name: "旅の糧食",
    symbol: "%",
    kind: "ration",
    detail: "野営の回数を1増やす。1ターン。",
    tags: ["食料", "交渉"],
  },
  blade: {
    name: "刻印の剣",
    symbol: ")",
    kind: "weapon",
    power: 2,
    detail: "装備すると攻撃＋2。1ターン。",
    tags: ["金属", "刃"],
  },
  mail: {
    name: "継ぎ目の鎧",
    symbol: "[",
    kind: "armor",
    power: 1,
    detail: "装備すると防御＋1。1ターン。",
    tags: ["金属", "防具"],
  },
  rope: {
    name: "結び目のロープ",
    symbol: "&",
    kind: "tool",
    detail: "自由行動の道具。技の判定＋1（道具の加点は最大＋1）。",
    tags: ["技", "繊維", "拘束"],
  },
  chalk: {
    name: "星図のチョーク",
    symbol: "&",
    kind: "tool",
    detail: "自由行動の道具。知の判定＋1（道具の加点は最大＋1）。",
    tags: ["知", "印", "魔法"],
  },
};
// Individual corrections are fixed at creation and never rerolled by identification.
const PREFIXES = [
  "夜明けの",
  "灰を纏う",
  "星影の",
  "雨音の",
  "琥珀の",
  "忘れられた",
  "翡翠の",
  "凪いだ",
];
const MOTIFS = {
  tonic: ["慈雨", "命の雫", "帰り道", "春の息"],
  focus: ["記憶", "青い灯", "夢の潮", "星の涙"],
  smoke: ["帳", "霞の頁", "残像", "白い夜"],
  blink: ["道標", "帰路", "抜け道", "旅の栞"],
  oil: ["火種", "灼ける月", "灯油", "赤い約束"],
  ration: ["糧", "麦の夢", "旅の実", "食卓"],
  blade: ["牙", "切先", "月の刃", "銀の枝"],
  mail: ["殻", "護り", "石の衣", "鉄の庭"],
  rope: ["結び目", "長い糸", "縁", "絡む影"],
  chalk: ["星図", "白い印", "約束", "描く指"],
  elixir: ["双命", "虹の雫", "再生の詩", "命の星"],
  flare: ["閃光", "炎の頁", "流星", "火の翼"],
};
Object.assign(ITEMS, {
  elixir: {
    name: "命と記憶の霊薬",
    symbol: "!",
    kind: "elixir",
    detail: "HPと集中を回復する合成薬。",
    tags: ["液体", "薬", "魔力"],
  },
  flare: {
    name: "閃光の巻物",
    symbol: "?",
    kind: "flare",
    detail: "選択した敵にダメージと足止めを与える合成巻物。",
    tags: ["紙", "火", "光"],
  },
});
export function makeItem(
  key,
  id,
  { random, source = "", modifier, identified = false } = {},
) {
  const def = ITEMS[key];
  if (!def) throw new Error("知らないアイテムです。");
  let hash = 0;
  for (const c of String(id)) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const motifs = MOTIFS[key];
  const name = `${PREFIXES[hash % PREFIXES.length]}${motifs[Math.floor(hash / 8) % motifs.length]}・${String(id).replace("id-", "")}`;
  const correction = modifier ?? (random ? Math.floor(random() * 5) - 2 : 0);
  const item = {
    ...def,
    tags: [...def.tags],
    key,
    id,
    name,
    source,
    modifier: correction,
    identified,
  };
  item.power = Math.max(1, (def.power || 0) + correction);
  return item;
}
export function itemMagnitude(item) {
  const base =
    {
      heal: 14,
      focus: 8,
      oil: 8,
      smoke: 3,
      elixir: 10,
      flare: 8,
      tool: 4,
      weapon: 2,
      armor: 1,
      ration: 30,
      blink: 0,
    }[item.kind] ?? 4;
  return Math.max(item.kind === "blink" ? 0 : 1, base + (item.modifier || 0));
}
export function itemSummary(item) {
  const amount = item.identified ? String(itemMagnitude(item)) : "未識別";
  const power = item.identified ? `＋${item.power}` : "補正未識別";
  return (
    {
      heal: `HP回復（${amount}）・毒と炎上を解除`,
      focus: `集中回復（${amount}）`,
      oil: `3マス以内の敵にダメージ（${amount}）＋炎上`,
      smoke: `見える敵を足止め（${item.identified ? Math.min(4, itemMagnitude(item)) + "ターン" : "持続未識別"}）`,
      blink: "この階の入口へ帰還",
      ration: `空腹回復（${amount}）・野営の糧食＋1`,
      weapon: `武器：攻撃${power}`,
      armor: `防具：防御${power}`,
      elixir: `HP回復（${amount}）・集中回復（${item.identified ? Math.max(1, Math.floor(itemMagnitude(item) / 2)) : "未識別"}）・毒と炎上を解除`,
      flare: `4マス以内の敵にダメージ（${amount}）＋2ターン足止め`,
      tool:
        item.key === "rope"
          ? "集中1で隣の敵を2ターン拘束。所持で技・知の判定を助ける"
          : `集中2で護り（${amount}）を張る。所持で判定を助ける`,
    }[item.kind] || "自由行動に使える道具"
  );
}
export function publicItem(item) {
  if (!item) return null;
  const { id, key, kind, name, symbol, tags, source, identified } = item;
  return {
    id,
    key,
    kind,
    name,
    symbol,
    tags,
    source,
    identified,
    detail: itemSummary(item),
    ...(item.lore ? { lore: item.lore } : {}),
    ...(identified ? { modifier: item.modifier, power: item.power } : {}),
  };
}
export function groupItems(inventory) {
  const groups = new Map();
  for (const item of inventory) {
    const key = item.key || "custom";
    if (!groups.has(key))
      groups.set(key, {
        key,
        name: ITEMS[key]?.name || "創作した道具",
        symbol: item.symbol,
        items: [],
      });
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}
export function synthesisRecipe(a, b) {
  if (!a || !b || a.id === b.id)
    throw new Error("別々の材料を2個選んでください。");
  const keys = [a.key, b.key].sort().join("+");
  let key;
  if (keys === "focus+tonic") key = "elixir";
  else if (keys === "oil+smoke") key = "flare";
  else if (a.key === b.key && Object.hasOwn(ITEMS, a.key)) key = a.key;
  else if (a.kind === "weapon" || b.kind === "weapon") key = "blade";
  else if (a.kind === "armor" || b.kind === "armor") key = "mail";
  else if (
    a.kind === "heal" ||
    b.kind === "heal" ||
    a.kind === "elixir" ||
    b.kind === "elixir"
  )
    key = "tonic";
  else if (a.kind === "focus" || b.kind === "focus") key = "focus";
  else if (
    a.kind === "oil" ||
    b.kind === "oil" ||
    a.kind === "flare" ||
    b.kind === "flare"
  )
    key = "oil";
  else if (a.kind === "ration" || b.kind === "ration") key = "ration";
  else if (a.kind === "smoke" || b.kind === "smoke") key = "smoke";
  else key = "chalk";
  return {
    key,
    name: ITEMS[key].name,
    modifier: Math.min(
      3,
      Math.max(-2, Math.floor(((a.modifier || 0) + (b.modifier || 0)) / 2) + 1),
    ),
  };
}
export const BACKGROUNDS = {
  wanderer: {
    name: "渡り鳥",
    subtitle: "逃げ道を見つけ、あり合わせで生き延びる。",
    hp: 32,
    focus: 12,
    attack: 5,
    defense: 1,
    skills: { might: 1, wit: 2, spirit: 1 },
    items: ["tonic", "tonic", "smoke", "rope"],
  },
  scholar: {
    name: "星読み",
    subtitle: "言葉と記号で、世界の理をひとつ書き換える。",
    hp: 28,
    focus: 16,
    attack: 4,
    defense: 1,
    skills: { might: 0, wit: 3, spirit: 1 },
    items: ["tonic", "focus", "blink", "chalk"],
  },
  sentinel: {
    name: "門番",
    subtitle: "盾の後ろで考える時間をつくる。",
    hp: 38,
    focus: 10,
    attack: 6,
    defense: 2,
    skills: { might: 3, wit: 0, spirit: 1 },
    items: ["tonic", "tonic", "oil", "rope"],
  },
};
export const SKILLS = { might: "力", wit: "技・知", spirit: "心" };

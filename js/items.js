// NetHack を参考にしたアイテム/装備定義
// kind: weapon / armor / shield は装備可能、potion / scroll は消費アイテム

export const ITEM_DEFS = {
  // --- 武器（装備で攻撃力+bonus） sym ')' ---
  dagger:      { name: 'ダガー',         kind: 'weapon', sym: ')', color: '#c7d0d8', bonus: 2, depth: 1, weight: 9 },
  short_sword: { name: 'ショートソード', kind: 'weapon', sym: ')', color: '#c7d0d8', bonus: 3, depth: 2, weight: 7 },
  mace:        { name: 'メイス',         kind: 'weapon', sym: ')', color: '#c7d0d8', bonus: 4, depth: 3, weight: 6 },
  long_sword:  { name: 'ロングソード',   kind: 'weapon', sym: ')', color: '#c7d0d8', bonus: 5, depth: 4, weight: 5 },
  war_hammer:  { name: 'ウォーハンマー', kind: 'weapon', sym: ')', color: '#c7d0d8', bonus: 6, depth: 6, weight: 4 },
  battle_axe:  { name: 'バトルアックス', kind: 'weapon', sym: ')', color: '#c7d0d8', bonus: 7, depth: 8, weight: 3 },

  // --- 防具（装備で防御力+bonus） sym '[' ---
  leather_armor: { name: '革鎧',         kind: 'armor', sym: '[', color: '#caa46a', bonus: 2, depth: 1, weight: 8 },
  ring_mail:     { name: 'リングメイル', kind: 'armor', sym: '[', color: '#caa46a', bonus: 3, depth: 3, weight: 6 },
  chain_mail:    { name: 'チェインメイル', kind: 'armor', sym: '[', color: '#caa46a', bonus: 4, depth: 5, weight: 5 },
  plate_mail:    { name: 'プレートメイル', kind: 'armor', sym: '[', color: '#caa46a', bonus: 6, depth: 8, weight: 3 },

  // --- 盾（装備で防御力+bonus） sym '[' ---
  small_shield:  { name: '小盾', kind: 'shield', sym: '[', color: '#b08a5a', bonus: 1, depth: 1, weight: 6 },
  large_shield:  { name: '大盾', kind: 'shield', sym: '[', color: '#b08a5a', bonus: 2, depth: 4, weight: 4 },

  // --- ポーション sym '!' ---
  potion_healing:       { name: '回復薬',     kind: 'potion', sym: '!', color: '#d36cd3', effect: 'heal',       depth: 1, weight: 10 },
  potion_extra_healing: { name: '上級回復薬', kind: 'potion', sym: '!', color: '#e58ce5', effect: 'extraheal',  depth: 4, weight: 5 },
  potion_energy:        { name: '魔力の薬',   kind: 'potion', sym: '!', color: '#7aa0ff', effect: 'energy',     depth: 2, weight: 6 },
  potion_strength:      { name: '力の薬',     kind: 'potion', sym: '!', color: '#ff9a6c', effect: 'strength',   depth: 3, weight: 4 },
  potion_gain_level:    { name: '経験の薬',   kind: 'potion', sym: '!', color: '#ffd27a', effect: 'gainlevel',  depth: 5, weight: 2 },

  // --- 巻物 sym '?' ---
  scroll_teleport:       { name: 'テレポートの巻物', kind: 'scroll', sym: '?', color: '#e9d8a6', effect: 'teleport',       depth: 2, weight: 6 },
  scroll_magic_mapping:  { name: '魔法地図の巻物',   kind: 'scroll', sym: '?', color: '#e9d8a6', effect: 'mapping',        depth: 2, weight: 6 },
  scroll_enchant_weapon: { name: '武器強化の巻物',   kind: 'scroll', sym: '?', color: '#e9d8a6', effect: 'enchant_weapon', depth: 3, weight: 5 },
  scroll_enchant_armor:  { name: '防具強化の巻物',   kind: 'scroll', sym: '?', color: '#e9d8a6', effect: 'enchant_armor',  depth: 3, weight: 5 },
};

const EQUIP_KINDS = new Set(['weapon', 'armor', 'shield']);

export function isEquippable(item) {
  return item && EQUIP_KINDS.has(item.kind);
}

// アイテムの実体（インスタンス）を生成。装備品には強化値 ench を持たせる
export function makeItem(id) {
  const def = ITEM_DEFS[id];
  if (!def) return null;
  const inst = { id, ...def };
  if (EQUIP_KINDS.has(def.kind)) inst.ench = 0;
  return inst;
}

// 表示名（強化値つき）
export function itemName(item) {
  if (!item) return 'なし';
  if (typeof item.ench === 'number' && item.ench !== 0) {
    return `${item.name}${item.ench > 0 ? '+' : ''}${item.ench}`;
  }
  return item.name;
}

// 階層に応じて床に落ちるアイテムを1つ選ぶ（重み付き抽選）
export function pickFloorItem(floor) {
  const pool = Object.keys(ITEM_DEFS).filter((id) => ITEM_DEFS[id].depth <= floor);
  let total = 0;
  for (const id of pool) total += ITEM_DEFS[id].weight;
  let r = Math.random() * total;
  for (const id of pool) {
    r -= ITEM_DEFS[id].weight;
    if (r <= 0) return makeItem(id);
  }
  return makeItem(pool[pool.length - 1]);
}

// 日本語名から定義を逆引き（LLMが付与したアイテム名の解決用。強化値の接尾辞は除去）
export function resolveByName(name) {
  if (!name) return null;
  const base = String(name).replace(/[+\-]\d+$/, '').trim();
  for (const id of Object.keys(ITEM_DEFS)) {
    if (ITEM_DEFS[id].name === base) return makeItem(id);
  }
  return null;
}

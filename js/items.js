// 内蔵アイテムカタログ（NetHack 参考）＋ AI生成アイテムの取り込み
// kind: weapon / armor / shield は装備、potion / scroll は消費（使用時はAIが判定）

export const ITEM_DEFS = {
  // --- 武器 ')' ---
  dagger:      { name: 'ダガー',         kind: 'weapon', sym: ')', color: '#c7d0d8', bonus: 2, depth: 1, weight: 9 },
  short_sword: { name: 'ショートソード', kind: 'weapon', sym: ')', color: '#c7d0d8', bonus: 3, depth: 2, weight: 7 },
  mace:        { name: 'メイス',         kind: 'weapon', sym: ')', color: '#c7d0d8', bonus: 4, depth: 3, weight: 6 },
  long_sword:  { name: 'ロングソード',   kind: 'weapon', sym: ')', color: '#c7d0d8', bonus: 5, depth: 4, weight: 5 },
  war_hammer:  { name: 'ウォーハンマー', kind: 'weapon', sym: ')', color: '#c7d0d8', bonus: 6, depth: 6, weight: 4 },
  battle_axe:  { name: 'バトルアックス', kind: 'weapon', sym: ')', color: '#c7d0d8', bonus: 7, depth: 8, weight: 3 },

  // --- 防具 '[' ---
  leather_armor: { name: '革鎧',           kind: 'armor', sym: '[', color: '#caa46a', bonus: 2, depth: 1, weight: 8 },
  ring_mail:     { name: 'リングメイル',   kind: 'armor', sym: '[', color: '#caa46a', bonus: 3, depth: 3, weight: 6 },
  chain_mail:    { name: 'チェインメイル', kind: 'armor', sym: '[', color: '#caa46a', bonus: 4, depth: 5, weight: 5 },
  plate_mail:    { name: 'プレートメイル', kind: 'armor', sym: '[', color: '#caa46a', bonus: 6, depth: 8, weight: 3 },

  // --- 盾 '[' ---
  small_shield:  { name: '小盾', kind: 'shield', sym: '[', color: '#b08a5a', bonus: 1, depth: 1, weight: 6 },
  large_shield:  { name: '大盾', kind: 'shield', sym: '[', color: '#b08a5a', bonus: 2, depth: 4, weight: 4 },

  // --- ポーション '!' ---
  potion_healing:       { name: '回復薬',     kind: 'potion', sym: '!', color: '#d36cd3', depth: 1, weight: 10, hint: '飲むとHPを中程度回復する' },
  potion_extra_healing: { name: '上級回復薬', kind: 'potion', sym: '!', color: '#e58ce5', depth: 4, weight: 5,  hint: '飲むとHPを大きく回復し最大HPも少し上がる' },
  potion_energy:        { name: '魔力の薬',   kind: 'potion', sym: '!', color: '#7aa0ff', depth: 2, weight: 6,  hint: '飲むと魔力(MP)が全回復する' },
  potion_strength:      { name: '力の薬',     kind: 'potion', sym: '!', color: '#ff9a6c', depth: 3, weight: 4,  hint: '飲むと攻撃力が永続的に+1される' },
  potion_fire:          { name: '火炎の薬',   kind: 'potion', sym: '!', color: '#ff6a3c', depth: 3, weight: 4,  hint: '割って投げると周囲の敵に炎上を与える。誤って飲むと火傷する' },
  potion_paralysis:     { name: '麻痺の薬',   kind: 'potion', sym: '!', color: '#d9d97c', depth: 4, weight: 3,  hint: '蒸気を浴びると麻痺する。敵に投げれば麻痺させられる' },

  // --- 巻物 '?' ---
  scroll_teleport:       { name: 'テレポートの巻物', kind: 'scroll', sym: '?', color: '#e9d8a6', depth: 2, weight: 6, hint: '読むと自分がランダムな場所へ飛ぶ' },
  scroll_magic_mapping:  { name: '魔法地図の巻物',   kind: 'scroll', sym: '?', color: '#e9d8a6', depth: 2, weight: 6, hint: 'この階の地図が判明する' },
  scroll_enchant_weapon: { name: '武器強化の巻物',   kind: 'scroll', sym: '?', color: '#e9d8a6', depth: 3, weight: 5, hint: '装備中の武器が+1強化される' },
  scroll_enchant_armor:  { name: '防具強化の巻物',   kind: 'scroll', sym: '?', color: '#e9d8a6', depth: 3, weight: 5, hint: '装備中の防具が+1強化される' },
  scroll_fire:           { name: '業火の巻物',       kind: 'scroll', sym: '?', color: '#ffae6a', depth: 4, weight: 4, hint: '読むと視界内の敵に炎のダメージと炎上を与える' },
  scroll_fear:           { name: '威圧の巻物',       kind: 'scroll', sym: '?', color: '#cfcfff', depth: 3, weight: 4, hint: '読むと周囲の敵が恐怖して逃げ出す' },
};

const EQUIP_KINDS = new Set(['weapon', 'armor', 'shield']);

export function isEquippable(item) {
  return item && EQUIP_KINDS.has(item.kind);
}

// 定義（内蔵 or AI生成）から実体を生成
export function makeItemFromDef(def) {
  const inst = {
    id: def.id || 'gen',
    name: def.name,
    kind: def.kind,
    sym: def.sym || '*',
    color: def.color || '#aaa',
    bonus: def.bonus || 0,
    effect: def.effect,
    hint: def.hint || '',
  };
  if (EQUIP_KINDS.has(def.kind)) inst.ench = 0;
  return inst;
}

export function makeItem(id) {
  const def = ITEM_DEFS[id];
  if (!def) return null;
  return makeItemFromDef({ id, ...def });
}

export function itemName(item) {
  if (!item) return 'なし';
  if (typeof item.ench === 'number' && item.ench !== 0) {
    return `${item.name}${item.ench > 0 ? '+' : ''}${item.ench}`;
  }
  return item.name;
}

// 内蔵カタログから、その階向けのアイテム定義リスト（フォールバック用）
export function builtinFloorItemDefs(floor) {
  return Object.keys(ITEM_DEFS)
    .filter((id) => ITEM_DEFS[id].depth <= floor)
    .map((id) => ({ id, ...ITEM_DEFS[id] }));
}

// 日本語名から内蔵定義を逆引き
export function resolveByName(name) {
  if (!name) return null;
  const base = String(name).replace(/[+\-]\d+$/, '').trim();
  for (const id of Object.keys(ITEM_DEFS)) {
    if (ITEM_DEFS[id].name === base) return makeItem(id);
  }
  return null;
}

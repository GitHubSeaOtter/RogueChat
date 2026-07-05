// プレイヤーキャラクターの永続管理(localStorage)。
// 成長・アイテムは持ち越さないため、保存するのは素体パラメータと外見・名前・性格のみ。

const KEY = 'roguechat_characters';

// 値域(ハンドオフ文書のサニタイズ契約)
const RANGE = {
  hp:  { min: 16, max: 28, def: 20 },
  mp:  { min: 3,  max: 10, def: 5 },
  atk: { min: 3,  max: 7,  def: 5 },
  def: { min: 0,  max: 3,  def: 1 },
};

const NAMES = [
  'アルヴィン', 'ミラ', 'ガロン', 'セツナ', 'ロヴェル', 'ティア',
  'バルド', 'ユキネ', 'ドラン', 'カヤ', 'レオニス', 'シズク',
  'ゴルム', 'フィオナ', 'ザイン', 'ナユタ',
];
const PERSONALITIES = [
  '慎重で用心深いが、宝を前にすると我を忘れる',
  '豪快で細かいことは気にしない楽天家',
  '皮肉屋だが仲間思いの一匹狼',
  '知識欲の塊で、未知のものをすぐ調べたがる',
  '臆病だが追い詰められると誰より勇敢になる',
  '無口で無表情、しかし行動は誰よりも早い',
  '祈りを欠かさない敬虔な性格で、不浄なものを嫌う',
  '手癖が悪く、光るものを見ると拾わずにいられない',
];

function randint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function pick(arr) { return arr[randint(0, arr.length - 1)]; }
function clampInt(v, lo, hi, fb) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fb;
  return Math.max(lo, Math.min(hi, n));
}

function newId() {
  return 'ch_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- CRUD ----------
export function listCharacters() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

export function getCharacter(id) {
  return listCharacters().find((c) => c.id === id) || null;
}

// 追加 or id 一致で置換。localStorage 容量超過は呼び出し側で捕捉する。
export function saveCharacter(c) {
  const all = listCharacters();
  const i = all.findIndex((x) => x.id === c.id);
  if (i >= 0) all[i] = c; else all.push(c);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function deleteCharacter(id) {
  localStorage.setItem(KEY, JSON.stringify(listCharacters().filter((c) => c.id !== id)));
}

// ---------- 生成 ----------
export function randomCharacter() {
  return {
    id: newId(),
    name: pick(NAMES),
    personality: pick(PERSONALITIES),
    portrait: null,
    hp: randint(RANGE.hp.min + 2, RANGE.hp.max - 4),
    mp: randint(RANGE.mp.min + 1, RANGE.mp.def + 2),
    atk: randint(RANGE.atk.min + 1, RANGE.atk.max - 1),
    def: randint(RANGE.def.min, RANGE.def.max - 1),
    createdAt: Date.now(),
  };
}

// AI 生成結果(生JSON)を値域にクランプして Character 化
export function sanitizeGenerated(raw, portrait) {
  const name = String(raw?.name || '').trim().slice(0, 12);
  const personality = String(raw?.personality || '').trim().slice(0, 60);
  return {
    id: newId(),
    name: name || pick(NAMES),
    personality: personality || pick(PERSONALITIES),
    portrait: portrait || null,
    hp: clampInt(raw?.hp, RANGE.hp.min, RANGE.hp.max, RANGE.hp.def),
    mp: clampInt(raw?.mp, RANGE.mp.min, RANGE.mp.max, RANGE.mp.def),
    atk: clampInt(raw?.atk, RANGE.atk.min, RANGE.atk.max, RANGE.atk.def),
    def: clampInt(raw?.def, RANGE.def.min, RANGE.def.max, RANGE.def.def),
    createdAt: Date.now(),
  };
}

// ---------- 画像 ----------
// カメラロールの画像を長辺192pxのJPEG dataURLに縮小(保存容量とAPI送信量の両方を抑える)
export function fileToPortrait(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 192;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('NOT_IMAGE'));
    };
    img.src = url;
  });
}

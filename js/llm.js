// Anthropic Messages API をブラウザから直接呼び出す。
//  1) generateFloor: 階のテーマ・地形・モンスター群・アイテム群をAI生成
//  2) adjudicate: 自由入力／アイテム使用の結果をAI判定（地形・敵の状態を反映）
//  3) generateCharacter: 外見画像からキャラクターのプロフィールを生成（vision）
//
// モデル割当は docs/model-routing.md 参照:
//  - 判定・フロア生成 = 設定で選択したモデル（既定 Haiku 4.5、高頻度・低コスト）
//  - キャラ生成 = Sonnet 4.6 固定（低頻度だが生成物が永続するため 1 Tier 上げ）

export const STATUS_NAMES = ['毒', '炎上', '出血', '麻痺', '睡眠', '凍結', '石化', '混乱', '朦朧', '盲目', '恐怖'];

function getKey() { return localStorage.getItem('roguechat_apikey'); }
function getModel() { return localStorage.getItem('roguechat_model') || 'claude-haiku-4-5'; }

export function hasApiKey() { return !!getKey(); }

async function callApi(system, schema, userContent, maxTokens, model) {
  const apiKey = getKey();
  if (!apiKey) throw new Error('NO_KEY');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || getModel(),
      max_tokens: maxTokens,
      system,
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch (_) {}
    if (res.status === 401) throw new Error('BAD_KEY');
    throw new Error(`API_ERROR:${res.status}:${detail}`);
  }
  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('NO_OUTPUT');
  try { return JSON.parse(textBlock.text); } catch (_) { throw new Error('PARSE_ERROR'); }
}

// ---------- フロア生成 ----------
const FLOOR_SYSTEM = `あなたはNetHack風アスキー・ローグライクのダンジョン設計者です。
指定された階層に合う「テーマ」「地形タイプ」「モンスター群」「アイテム群」を生成してください。

ルール:
- theme は日本語の短い階層名（例: ねずみの巣窟、氷の回廊、地下墓地）。
- layout は rooms / maze / cavern / bigroom のいずれか。
- monsters は3〜6種。symbol は半角英字1文字、color は #RRGGBB。
  hp/atk/def/xp は階層が深いほど強く（目安: hp = 階層*3〜階層*6、atk = 階層+1〜階層*2、def = 0〜階層、xp = hp と同程度）。
  ability は攻撃時に与えうる状態異常で、次から1つ選ぶか空文字: 毒,炎上,出血,麻痺,睡眠,凍結,石化,混乱,朦朧,盲目,恐怖,（なし）。
  NetHackのモンスター（ねずみ,コウモリ,コボルト,ゴブリン,オーク,スケルトン,浮遊する目,ニンフ,トロル,ナーガ,リッチ,ドラゴン等）を参考に多様性を出す。
- items は3〜6種。kind は weapon/armor/shield/potion/scroll。symbol は ) [ ! ? など、color は #RRGGBB。
  weapon/armor/shield には bonus(攻撃力or防御力の加算, 1〜8) を入れ、effect/hint は空でよい。
  potion/scroll には bonus=0 とし、hint に「使うと何が起きるか」を日本語で簡潔に書く（地形や敵に作用する効果も可）。`;

const FLOOR_SCHEMA = {
  type: 'object',
  properties: {
    theme: { type: 'string' },
    layout: { type: 'string' },
    monsters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          symbol: { type: 'string' },
          hp: { type: 'integer' },
          atk: { type: 'integer' },
          def: { type: 'integer' },
          xp: { type: 'integer' },
          color: { type: 'string' },
          ability: { type: 'string' },
        },
        required: ['name', 'symbol', 'hp', 'atk', 'def', 'xp', 'color', 'ability'],
        additionalProperties: false,
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kind: { type: 'string' },
          symbol: { type: 'string' },
          color: { type: 'string' },
          bonus: { type: 'integer' },
          hint: { type: 'string' },
        },
        required: ['name', 'kind', 'symbol', 'color', 'bonus', 'hint'],
        additionalProperties: false,
      },
    },
  },
  required: ['theme', 'layout', 'monsters', 'items'],
  additionalProperties: false,
};

export async function generateFloor(ctx) {
  const user =
    `地下${ctx.floor}階。プレイヤーはレベル${ctx.level}。` +
    `この階のテーマ・地形・モンスター群・アイテム群をスキーマに従い生成してください。`;
  return callApi(FLOOR_SYSTEM, FLOOR_SCHEMA, user, 1500);
}

// ---------- キャラクター生成（vision） ----------
const CHAR_MODEL = 'claude-sonnet-4-6';

const CHAR_SYSTEM = `あなたはローグライクRPGのキャラクターメイカーです。
渡された画像に写る人物・動物・キャラクターの見た目や雰囲気から、ダンジョンに挑む冒険者のプロフィールを生成してください。

ルール:
- name は日本語またはカタカナで12文字以内。画像の印象に合う固有名。
- personality は60文字以内の一文。見た目から想像できる性格や癖を具体的に。
- パラメータは画像の印象で強弱をつける: hp は 16〜28、mp は 3〜10、atk は 3〜7、def は 0〜3 の整数。
  屈強そうなら hp/atk 寄り、賢そう・神秘的なら mp 寄り、重装備なら def 寄りに。合計が偏りすぎないように。`;

const CHAR_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    personality: { type: 'string' },
    hp: { type: 'integer' },
    mp: { type: 'integer' },
    atk: { type: 'integer' },
    def: { type: 'integer' },
  },
  required: ['name', 'personality', 'hp', 'mp', 'atk', 'def'],
  additionalProperties: false,
};

// portraitDataUrl: "data:image/jpeg;base64,..." 形式
export async function generateCharacter(portraitDataUrl) {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/.exec(portraitDataUrl || '');
  if (!m) throw new Error('BAD_IMAGE');
  const content = [
    { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
    { type: 'text', text: 'この画像から冒険者のプロフィールをスキーマに従い生成してください。' },
  ];
  return callApi(CHAR_SYSTEM, CHAR_SCHEMA, content, 400, CHAR_MODEL);
}

// ---------- 行動／アイテム使用の判定 ----------
const ADJ_SYSTEM = `あなたはアスキー・ローグライクRPGのゲームマスター(GM)です。
プレイヤーの自由行動、またはアイテム使用の結果を、現在の状態・地形・周囲の敵の状態を踏まえて判定します。

方針:
- もっともらしく、面白く、バランスを保つ。無敵化や即死級の効果は避ける。
- プレイヤーの名前と性格が与えられた場合、描写(narration)や結果の味付けに反映する。
- 魔法やアイテム効果は地形（罠・階段・通路）や周囲の敵に作用してよい。
- 敵に作用する場合は monster_effects に対象の id を指定し、hp_delta（負=ダメージ）や status（状態異常名）を入れる。
- 状態異常名は次から選ぶ: 毒,炎上,出血,麻痺,睡眠,凍結,石化,混乱,朦朧,盲目,恐怖。プレイヤーに付与/解除する場合は player_status / clear_status を使う。
- 攻撃的・無謀な行動で反撃されうるなら end_turn=true。観察・調査など時間をほぼ使わないなら false。
- HP/MPの増減は概ね -12〜+10、敵への hp_delta は -30〜0 程度に抑える。
- narration は必ず日本語で2文以内。`;

const ADJ_SCHEMA = {
  type: 'object',
  properties: {
    narration: { type: 'string' },
    hp_delta: { type: 'integer' },
    mp_delta: { type: 'integer' },
    gold_delta: { type: 'integer' },
    xp_delta: { type: 'integer' },
    add_items: { type: 'array', items: { type: 'string' } },
    remove_items: { type: 'array', items: { type: 'string' } },
    player_status: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, turns: { type: 'integer' } },
        required: ['name', 'turns'],
        additionalProperties: false,
      },
    },
    clear_status: { type: 'array', items: { type: 'string' } },
    monster_effects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          hp_delta: { type: 'integer' },
          status: { type: 'string' },
          status_turns: { type: 'integer' },
        },
        required: ['id', 'hp_delta', 'status', 'status_turns'],
        additionalProperties: false,
      },
    },
    reveal_map: { type: 'boolean' },
    teleport: { type: 'boolean' },
    move_dx: { type: 'integer' },
    move_dy: { type: 'integer' },
    success: { type: 'boolean' },
    end_turn: { type: 'boolean' },
  },
  required: [
    'narration', 'hp_delta', 'mp_delta', 'gold_delta', 'xp_delta',
    'add_items', 'remove_items', 'player_status', 'clear_status',
    'monster_effects', 'reveal_map', 'teleport', 'success', 'end_turn',
  ],
  additionalProperties: false,
};

export async function adjudicate(state, command) {
  const monLines = state.monsters.length
    ? state.monsters.map((m) =>
        `  - id:${m.id} ${m.name}（HP${m.hp}/${m.maxHp}, ${m.dir}方向 距離${m.dist}${m.statuses ? ', 状態:' + m.statuses : ''}）`).join('\n')
    : '  なし';

  const user =
    `# 現在の状態\n` +
    (state.charName ? `プレイヤー: ${state.charName}\n` : '') +
    (state.personality ? `性格: ${state.personality}\n` : '') +
    `階層: 地下${state.floor}階（${state.theme} / 地形:${state.layout}）\n` +
    `レベル: ${state.level}（経験値 ${state.xp}/${state.xpNext}）\n` +
    `HP: ${state.hp}/${state.maxHp}　MP: ${state.mp}/${state.maxMp}\n` +
    `攻撃力: ${state.atk}　防御力: ${state.def}　金貨: ${state.gold}\n` +
    `状態異常: ${state.playerStatus || 'なし'}\n` +
    `装備: ${state.equipment}\n` +
    `所持品: ${state.inventory.length ? state.inventory.join('、') : 'なし'}\n` +
    `足元: ${state.underfoot}\n` +
    `周囲: ${state.surroundings}\n` +
    (state.nearbyTraps ? `近くの罠: ${state.nearbyTraps}\n` : '') +
    `見える敵:\n${monLines}\n\n` +
    `# プレイヤーの行動\n「${command}」\n\n` +
    `この行動の結果を判定し、スキーマに従ってJSONで返してください。`;

  return callApi(ADJ_SYSTEM, ADJ_SCHEMA, user, 1024);
}

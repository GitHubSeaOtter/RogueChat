// Anthropic Messages API をブラウザから直接呼び出し、
// 自由入力コマンドの「判定」を構造化出力(JSON)で受け取る。

const SYSTEM_PROMPT = `あなたはアスキー文字のローグライクRPGのゲームマスター(GM)です。
プレイヤーが自由に入力した行動を、現在のゲーム状態にもとづいて公平かつ面白く判定してください。

判定の方針:
- プレイヤーのレベル・HP・MP・所持品・周囲の状況を考慮し、もっともらしい結果を返す。
- 強すぎる結果（即死級の回復や無敵化、莫大な金貨など）は避け、ゲームバランスを保つ。
- 失敗・空振り・思わぬ副作用もありうる。リスクのある行動には代償を。
- 魔法など魔力(MP)を要する行動は mp_delta を負の値にする。MPが足りなければ失敗させる。
- 攻撃的な行動・無謀な行動の結果モンスターから反撃される場合は end_turn を true に。
- 単なる調査・観察・休息など時間をほとんど使わない行動は end_turn を false に。
- 移動を伴う行動なら move_dx/move_dy に -1〜1 を入れる（壁があれば無視される）。
- narration は必ず日本語で、2文以内の簡潔な情景描写にする。
- 数値の増減は小さめに（HPやMPは概ね -10〜+8、金貨は -20〜+30 程度）。`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    narration: { type: 'string', description: '日本語での結果描写（2文以内）' },
    hp_delta: { type: 'integer', description: 'HPの増減' },
    mp_delta: { type: 'integer', description: 'MPの増減' },
    gold_delta: { type: 'integer', description: '金貨の増減' },
    xp_delta: { type: 'integer', description: '経験値の増減' },
    move_dx: { type: 'integer', description: '横移動 -1/0/1' },
    move_dy: { type: 'integer', description: '縦移動 -1/0/1' },
    add_items: { type: 'array', items: { type: 'string' }, description: '入手アイテム名' },
    remove_items: { type: 'array', items: { type: 'string' }, description: '失うアイテム名' },
    success: { type: 'boolean', description: '行動が成功したか' },
    end_turn: { type: 'boolean', description: 'モンスターの行動ターンを進めるか' },
  },
  required: [
    'narration', 'hp_delta', 'mp_delta', 'gold_delta', 'xp_delta',
    'add_items', 'remove_items', 'success', 'end_turn',
  ],
  additionalProperties: false,
};

export function hasApiKey() {
  return !!localStorage.getItem('roguechat_apikey');
}

// state: ゲーム状態の要約オブジェクト, command: プレイヤー入力文字列
export async function adjudicate(state, command) {
  const apiKey = localStorage.getItem('roguechat_apikey');
  if (!apiKey) {
    throw new Error('NO_KEY');
  }
  const model = localStorage.getItem('roguechat_model') || 'claude-haiku-4-5';

  const userContent =
    `# 現在の状態\n` +
    `階層: 地下${state.floor}階\n` +
    `レベル: ${state.level}（経験値 ${state.xp}/${state.xpNext}）\n` +
    `HP: ${state.hp}/${state.maxHp}　MP: ${state.mp}/${state.maxMp}\n` +
    `攻撃力: ${state.atk}　防御力: ${state.def}　金貨: ${state.gold}\n` +
    `所持品: ${state.inventory.length ? state.inventory.join('、') : 'なし'}\n` +
    `足元: ${state.underfoot}\n` +
    `周囲の様子: ${state.surroundings}\n` +
    `見えるモンスター: ${state.monsters.length ? state.monsters.join('、') : 'いない'}\n\n` +
    `# プレイヤーの行動\n「${command}」\n\n` +
    `この行動の結果を判定し、スキーマに従ってJSONで返してください。`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const err = await res.json();
      detail = err?.error?.message || '';
    } catch (_) { /* noop */ }
    if (res.status === 401) throw new Error('BAD_KEY');
    throw new Error(`API_ERROR:${res.status}:${detail}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('NO_OUTPUT');

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (_) {
    throw new Error('PARSE_ERROR');
  }
  return parsed;
}

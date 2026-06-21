import { Game } from './game.js';
import { adjudicate, hasApiKey } from './llm.js';

const canvas = document.getElementById('screen');
const log = document.getElementById('log');
const game = new Game(canvas, log);

// ---- HUD 更新 ----
function updateHud() {
  const p = game.player;
  document.getElementById('st-floor').textContent = `B${game.floor}F`;
  document.getElementById('st-lv').textContent = `Lv${p.level}`;
  document.getElementById('st-hp').textContent = `HP ${p.hp}/${p.maxHp}`;
  document.getElementById('st-mp').textContent = `MP ${p.mp}/${p.maxMp}`;
  document.getElementById('st-gold').textContent = `G ${p.gold}`;
}

// game の描画後に毎回 HUD を更新したいので render をラップ
const origRender = game.render.bind(game);
game.render = function () { origRender(); updateHud(); };

// ---- 移動入力 ----
function doMove(dx, dy) {
  if (game.dead) return;
  game.tryMove(dx, dy);
  game.render();
}

document.querySelectorAll('.dir').forEach((btn) => {
  btn.addEventListener('click', () => {
    doMove(parseInt(btn.dataset.dx, 10), parseInt(btn.dataset.dy, 10));
  });
});

document.getElementById('act-descend').addEventListener('click', () => { game.descend(); });
document.getElementById('act-inv').addEventListener('click', () => { game.useInventory(); });
document.getElementById('act-rest').addEventListener('click', () => { game.rest(); });

// ---- キーボード ----
const KEYMAP = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  k: [0, -1], j: [0, 1], h: [-1, 0], l: [1, 0],
  y: [-1, -1], u: [1, -1], b: [-1, 1], n: [1, 1],
  '.': [0, 0],
};
window.addEventListener('keydown', (e) => {
  if (document.activeElement === cmdInput) return; // 入力欄では無効
  if (document.getElementById('settings').classList.contains('hidden') === false) return;
  const m = KEYMAP[e.key];
  if (m) { e.preventDefault(); doMove(m[0], m[1]); return; }
  if (e.key === '>') { e.preventDefault(); game.descend(); }
  if (e.key === 'g') { e.preventDefault(); game.useInventory(); }
});

// ---- 自由入力コマンド（LLM判定）----
const cmdForm = document.getElementById('cmdform');
const cmdInput = document.getElementById('cmdinput');
const cmdSend = document.getElementById('cmdsend');

cmdForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = cmdInput.value.trim();
  if (!text || game.dead) return;

  if (!hasApiKey()) {
    game.message('APIキーが未設定です。⚙設定 から入力してください。（移動や戦闘はキー無しでも遊べます）', 'sys');
    openSettings();
    return;
  }

  cmdInput.value = '';
  cmdInput.disabled = true;
  cmdSend.disabled = true;
  cmdSend.textContent = '判定中';
  game.message(`▷ ${text}`, 'sys');

  try {
    const eff = await adjudicate(game.stateSummary(), text);
    game.applyEffects(eff);
  } catch (err) {
    handleLlmError(err);
  } finally {
    cmdInput.disabled = false;
    cmdSend.disabled = false;
    cmdSend.textContent = '実行';
    cmdInput.focus();
  }
});

function handleLlmError(err) {
  const msg = String(err.message || err);
  if (msg === 'NO_KEY' || msg === 'BAD_KEY') {
    game.message('APIキーが無効です。⚙設定 を確認してください。', 'bad');
    openSettings();
  } else if (msg.startsWith('API_ERROR')) {
    game.message('API呼び出しに失敗しました：' + msg.replace('API_ERROR:', ''), 'bad');
  } else if (msg === 'PARSE_ERROR' || msg === 'NO_OUTPUT') {
    game.message('GMの返答を解釈できませんでした。もう一度試してください。', 'bad');
  } else {
    game.message('通信エラー：ネットワークを確認してください。', 'bad');
  }
}

// ---- 設定パネル ----
const settings = document.getElementById('settings');
const apikeyInput = document.getElementById('apikey');
const modelSelect = document.getElementById('model');

function openSettings() {
  apikeyInput.value = localStorage.getItem('roguechat_apikey') || '';
  modelSelect.value = localStorage.getItem('roguechat_model') || 'claude-haiku-4-5';
  settings.classList.remove('hidden');
}
function closeSettings() {
  const key = apikeyInput.value.trim();
  if (key) localStorage.setItem('roguechat_apikey', key);
  localStorage.setItem('roguechat_model', modelSelect.value);
  settings.classList.add('hidden');
}

document.getElementById('btn-settings').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);
document.getElementById('apikey-clear').addEventListener('click', () => {
  localStorage.removeItem('roguechat_apikey');
  apikeyInput.value = '';
  game.message('保存していたAPIキーを消去しました。', 'sys');
});
document.getElementById('newgame').addEventListener('click', () => {
  settings.classList.add('hidden');
  game.newGame();
  game.resize();
});

// ---- リサイズ ----
window.addEventListener('resize', () => game.resize());
game.resize();

// 初回：キーが無ければ案内
if (!hasApiKey()) {
  game.message('LLM判定を使うには ⚙設定 からAPIキーを入力してください。', 'sys');
}

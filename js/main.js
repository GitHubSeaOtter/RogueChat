import { Game } from './game.js';
import { adjudicate, hasApiKey } from './llm.js';
import { itemName, isEquippable } from './items.js';

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
  document.getElementById('st-atk').textContent = `A${game.atkTotal()}`;
  document.getElementById('st-def').textContent = `D${game.defTotal()}`;
  document.getElementById('st-gold').textContent = `G ${p.gold}`;
}

// render をラップして毎回 HUD を更新
const origRender = game.render.bind(game);
game.render = function () { origRender(); updateHud(); };

// ---- モーダル状態 ----
const settings = document.getElementById('settings');
const invPanel = document.getElementById('inventory');
function modalOpen() {
  return !settings.classList.contains('hidden') || !invPanel.classList.contains('hidden');
}

// ---- 移動入力 ----
function doMove(dx, dy) {
  if (game.dead || modalOpen()) return;
  game.tryMove(dx, dy);
  game.render();
}

// ---- Dパッド：長押しリピート対応 ----
let repeatTimer = null;
let repeatDelay = null;
function stopRepeat() {
  if (repeatDelay) { clearTimeout(repeatDelay); repeatDelay = null; }
  if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
}
function startRepeat(dx, dy) {
  stopRepeat();
  doMove(dx, dy);
  repeatDelay = setTimeout(() => {
    repeatTimer = setInterval(() => doMove(dx, dy), 110);
  }, 280);
}
document.querySelectorAll('.dir').forEach((btn) => {
  const dx = parseInt(btn.dataset.dx, 10);
  const dy = parseInt(btn.dataset.dy, 10);
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (btn.setPointerCapture) { try { btn.setPointerCapture(e.pointerId); } catch (_) {} }
    startRepeat(dx, dy);
  });
  btn.addEventListener('pointerup', stopRepeat);
  btn.addEventListener('pointercancel', stopRepeat);
  btn.addEventListener('pointerleave', stopRepeat);
});
window.addEventListener('blur', stopRepeat);

document.getElementById('act-descend').addEventListener('click', () => { game.descend(); });
document.getElementById('act-inv').addEventListener('click', openInventory);
document.getElementById('act-rest').addEventListener('click', rest);

// 休む＝その場で待機（近くに敵がいなければ少し回復）
function rest() {
  if (game.dead || modalOpen()) return;
  const p = game.player;
  game.message('ひと息ついた。', 'sys');
  if (Math.random() < 0.5) p.hp = Math.min(p.maxHp, p.hp + 1);
  game.tryMove(0, 0);
  game.render();
}

// ---- キーボード ----
const KEYMAP = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  k: [0, -1], j: [0, 1], h: [-1, 0], l: [1, 0],
  y: [-1, -1], u: [1, -1], b: [-1, 1], n: [1, 1],
  '.': [0, 0],
};
window.addEventListener('keydown', (e) => {
  if (document.activeElement === cmdInput) return;
  if (modalOpen()) return;
  const m = KEYMAP[e.key];
  if (m) { e.preventDefault(); doMove(m[0], m[1]); return; }
  if (e.key === '>') { e.preventDefault(); game.descend(); }
  if (e.key === 'i') { e.preventDefault(); openInventory(); }
});

// ---- 持ち物モーダル ----
const invStats = document.getElementById('inv-stats');
const invEquip = document.getElementById('inv-equip');
const invList = document.getElementById('inv-list');

function openInventory() {
  if (game.dead) { game.message('もう動けない。', 'sys'); return; }
  renderInventory();
  invPanel.classList.remove('hidden');
}
function closeInventory() { invPanel.classList.add('hidden'); }
document.getElementById('inv-close').addEventListener('click', closeInventory);

function makeRow(label, btns) {
  const row = document.createElement('div');
  row.className = 'inv-row';
  const span = document.createElement('span');
  span.className = 'inv-name';
  span.textContent = label;
  row.appendChild(span);
  const box = document.createElement('div');
  box.className = 'inv-btns';
  for (const b of btns) box.appendChild(b);
  row.appendChild(box);
  return row;
}
function button(text, onClick, cls = '') {
  const b = document.createElement('button');
  b.textContent = text;
  b.className = 'inv-btn ' + cls;
  b.addEventListener('click', onClick);
  return b;
}

function renderInventory() {
  const p = game.player;
  invStats.textContent =
    `攻撃 ${game.atkTotal()}（基礎${p.atk}）　防御 ${game.defTotal()}（基礎${p.def}）　金貨 ${p.gold}`;

  // 装備スロット
  invEquip.innerHTML = '';
  const slots = [['weapon', '武器'], ['armor', '防具'], ['shield', '盾']];
  for (const [slot, jp] of slots) {
    const it = p.equipment[slot];
    const label = `${jp}：${it ? itemName(it) : 'なし'}`;
    const btns = [];
    if (it) btns.push(button('外す', () => { game.unequip(slot); afterChange(); }));
    invEquip.appendChild(makeRow(label, btns));
  }

  // 所持品
  invList.innerHTML = '';
  if (p.inventory.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'note';
    empty.textContent = '所持品はない。';
    invList.appendChild(empty);
  }
  p.inventory.forEach((it, i) => {
    const btns = [];
    if (isEquippable(it)) {
      btns.push(button('装備', () => { game.equipFromInventory(i); afterChange(); }, 'equip'));
    } else if (it.kind === 'potion') {
      btns.push(button('飲む', () => { useConsumable(i); }, 'use'));
    } else if (it.kind === 'scroll') {
      btns.push(button('読む', () => { useConsumable(i); }, 'use'));
    }
    invList.appendChild(makeRow(itemName(it), btns));
  });
}

// 装備変更：ターン消費なし。リストとHUDを更新
function afterChange() {
  renderInventory();
  game.render();
}

// 消費アイテム使用：モーダルを閉じて効果適用→敵のターン
function useConsumable(i) {
  const passed = game.consume(i);
  closeInventory();
  if (passed && !game.dead) game.endTurn();
  game.render();
}

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

if (!hasApiKey()) {
  game.message('LLM判定を使うには ⚙設定 からAPIキーを入力してください。', 'sys');
}

import { Game, STATUS_INFO } from './game.js';
import { adjudicate, generateCharacter, hasApiKey } from './llm.js';
import { itemName, isEquippable } from './items.js';
import {
  listCharacters, getCharacter, saveCharacter, deleteCharacter,
  randomCharacter, sanitizeGenerated, fileToPortrait,
} from './characters.js';

const canvas = document.getElementById('screen');
const log = document.getElementById('log');
const game = new Game(canvas, log);

// ---- ローディング ----
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
function showLoading(t) { loadingText.textContent = t || '生成中…'; loading.classList.remove('hidden'); }
function hideLoading() { loading.classList.add('hidden'); }
function busy() { return !loading.classList.contains('hidden'); }

// ---- HUD ----
function updateHud() {
  if (!game.player) return;
  const p = game.player;
  document.getElementById('st-name').textContent = game.character?.name || '';
  document.getElementById('st-floor').textContent = `B${game.floor}F`;
  document.getElementById('st-lv').textContent = `Lv${p.level}`;
  document.getElementById('st-hp').textContent = `HP ${p.hp}/${p.maxHp}`;
  document.getElementById('st-mp').textContent = `MP ${p.mp}/${p.maxMp}`;
  document.getElementById('st-atk').textContent = `A${game.atkTotal()}`;
  document.getElementById('st-def').textContent = `D${game.defTotal()}`;
  document.getElementById('st-gold').textContent = `G ${p.gold}`;
  renderStatusBar();
}
function renderStatusBar() {
  const bar = document.getElementById('statusbar');
  bar.innerHTML = '';
  const st = game.player.statuses || {};
  for (const name of Object.keys(st)) {
    const chip = document.createElement('span');
    chip.className = 'status-chip';
    chip.textContent = `${name} ${st[name]}`;
    if (STATUS_INFO[name]) chip.style.color = STATUS_INFO[name].color;
    bar.appendChild(chip);
  }
}

const origRender = game.render.bind(game);
game.render = function () { origRender(); updateHud(); };

// ---- モーダル状態 ----
const settings = document.getElementById('settings');
const invPanel = document.getElementById('inventory');
const charSelect = document.getElementById('charselect');
const charEdit = document.getElementById('charedit');
function modalOpen() {
  return [settings, invPanel, charSelect, charEdit]
    .some((el) => !el.classList.contains('hidden'));
}
function blocked() { return !game.player || game.dead || modalOpen() || busy(); }

// ---- 移動 ----
function doMove(dx, dy) {
  if (blocked()) return;
  game.tryMove(dx, dy);
  game.render();
}

// ---- Dパッド：長押しリピート（道なりに進行方向を追従） ----
let repeatTimer = null, repeatDelay = null, runDx = 0, runDy = 0;
function stopRepeat() {
  if (repeatDelay) { clearTimeout(repeatDelay); repeatDelay = null; }
  if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = null; }
}
function startRepeat(dx, dy) {
  stopRepeat();
  doMove(dx, dy);
  runDx = dx; runDy = dy;
  repeatDelay = setTimeout(() => {
    repeatTimer = setInterval(() => {
      if (blocked()) { stopRepeat(); return; }
      if (runDx === 0 && runDy === 0) { doMove(0, 0); return; } // 待機の長押しはその場で待機継続
      const d = game.runNextDir(runDx, runDy);
      if (!d) { stopRepeat(); return; }
      runDx = d.dx; runDy = d.dy;
      doMove(runDx, runDy);
    }, 110);
  }, 280);
}
document.querySelectorAll('.dir').forEach((btn) => {
  const dx = parseInt(btn.dataset.dx, 10), dy = parseInt(btn.dataset.dy, 10);
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

// ---- マップタップ検分 ----
canvas.addEventListener('click', (e) => {
  if (!game.player || busy() || modalOpen()) return;
  const rect = canvas.getBoundingClientRect();
  const col = Math.floor((e.clientX - rect.left) / game.cell);
  const row = Math.floor((e.clientY - rect.top) / game.cell);
  const ox = game.player.x - Math.floor(game.viewCols / 2);
  const oy = game.player.y - Math.floor(game.viewRows / 2);
  const desc = game.describeAt(ox + col, oy + row);
  if (desc) game.message(`▷ ${desc}`, 'sys');
});

document.getElementById('act-descend').addEventListener('click', handleDescend);
document.getElementById('act-inv').addEventListener('click', openInventory);
document.getElementById('act-rest').addEventListener('click', rest);

async function handleDescend() {
  if (blocked()) return;
  if (game.grid[game.player.y][game.player.x] !== '>') {
    game.message('ここに階段はない。「>」の上で試そう。', 'sys');
    return;
  }
  showLoading('次の階を生成中…');
  try { await game.descend(); } finally { hideLoading(); }
}

function rest() {
  if (blocked()) return;
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
  y: [-1, -1], u: [1, -1], b: [-1, 1], n: [1, 1], '.': [0, 0],
};
window.addEventListener('keydown', (e) => {
  if (document.activeElement === cmdInput) return;
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if (modalOpen() || busy()) return;
  const m = KEYMAP[e.key];
  if (m) { e.preventDefault(); doMove(m[0], m[1]); return; }
  if (e.key === '>') { e.preventDefault(); handleDescend(); }
  if (e.key === 'i') { e.preventDefault(); openInventory(); }
});

// ---- 持ち物モーダル ----
const invStats = document.getElementById('inv-stats');
const invEquip = document.getElementById('inv-equip');
const invList = document.getElementById('inv-list');

function openInventory() {
  if (!game.player || game.dead || busy()) return;
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

  invEquip.innerHTML = '';
  for (const [slot, jp] of [['weapon', '武器'], ['armor', '防具'], ['shield', '盾']]) {
    const it = p.equipment[slot];
    const btns = [];
    if (it) btns.push(button('外す', () => { game.unequip(slot); afterChange(); }));
    invEquip.appendChild(makeRow(`${jp}：${it ? itemName(it) : 'なし'}`, btns));
  }

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
    } else if (it.kind === 'potion' || it.kind === 'scroll') {
      btns.push(button(it.kind === 'potion' ? '飲む' : '読む', () => { useConsumable(i); }, 'use'));
    }
    btns.push(button('捨てる', () => { game.dropItem(i); afterChange(); }, 'drop'));
    invList.appendChild(makeRow(itemName(it), btns));
  });
}

function afterChange() { renderInventory(); game.render(); }

// 消費アイテム：APIキーがあればAI判定、無ければ簡易処理
async function useConsumable(i) {
  const it = game.player.inventory[i];
  if (!it) return;
  closeInventory();

  if (hasApiKey()) {
    showLoading('効果を判定中…');
    try {
      const cmd = `所持アイテム「${itemName(it)}」を使う。` + (it.hint ? `（${it.hint}）` : '');
      const eff = await adjudicate(game.stateSummary(), cmd);
      const idx = game.player.inventory.indexOf(it);
      if (idx >= 0) game.player.inventory.splice(idx, 1);
      game.applyEffects(eff);
    } catch (err) {
      handleLlmError(err);
    } finally {
      hideLoading();
    }
  } else {
    game.deterministicConsume(it);
    const idx = game.player.inventory.indexOf(it);
    if (idx >= 0) game.player.inventory.splice(idx, 1);
    if (!game.dead) game.endTurn();
    game.render();
  }
}

// ---- 自由入力コマンド ----
const cmdForm = document.getElementById('cmdform');
const cmdInput = document.getElementById('cmdinput');

cmdForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = cmdInput.value.trim();
  if (!text || !game.player || game.dead || busy()) return;

  if (!hasApiKey()) {
    game.message('APIキーが未設定です。⚙設定 から入力してください。（移動や戦闘はキー無しでも遊べます）', 'sys');
    openSettings();
    return;
  }

  cmdInput.value = '';
  showLoading('判定中…');
  game.message(`▷ ${text}`, 'sys');
  try {
    const eff = await adjudicate(game.stateSummary(), text);
    game.applyEffects(eff);
  } catch (err) {
    handleLlmError(err);
  } finally {
    hideLoading();
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

// ---- 設定 ----
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
document.getElementById('newgame').addEventListener('click', async () => {
  closeSettings();
  if (game.character) {
    await startGameWith(game.character);
  } else {
    openCharSelect();
  }
});
document.getElementById('btn-charselect').addEventListener('click', () => {
  closeSettings();
  openCharSelect();
});

// ---- キャラクター選択 ----
let gameStarted = false;
const charListEl = document.getElementById('char-list');
const charCloseBtn = document.getElementById('char-close');

function openCharSelect() {
  renderCharList();
  charCloseBtn.style.display = gameStarted ? '' : 'none';
  charEdit.classList.add('hidden');
  charSelect.classList.remove('hidden');
}
charCloseBtn.addEventListener('click', () => charSelect.classList.add('hidden'));
document.getElementById('char-new').addEventListener('click', () => openCharEdit(null));

function charThumb(c) {
  if (c.portrait) {
    const img = document.createElement('img');
    img.className = 'char-thumb';
    img.src = c.portrait;
    img.alt = '';
    return img;
  }
  const span = document.createElement('span');
  span.className = 'char-thumb noimg';
  span.textContent = '@';
  return span;
}

function renderCharList() {
  charListEl.innerHTML = '';
  const all = listCharacters();
  if (all.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'note';
    empty.textContent = 'まだキャラクターがいません。「新規作成」から作りましょう。';
    charListEl.appendChild(empty);
    return;
  }
  for (const c of all) {
    const row = document.createElement('div');
    row.className = 'char-row';
    row.appendChild(charThumb(c));

    const info = document.createElement('div');
    info.className = 'char-info';
    const name = document.createElement('div');
    name.className = 'char-name';
    name.textContent = c.name;
    const sub = document.createElement('div');
    sub.className = 'char-sub';
    sub.textContent = `HP${c.hp} MP${c.mp} 攻${c.atk} 防${c.def}　${c.personality}`;
    info.appendChild(name);
    info.appendChild(sub);
    row.appendChild(info);

    const btns = document.createElement('div');
    btns.className = 'char-btns';
    btns.appendChild(button('冒険に出る', () => selectCharacter(c.id), 'equip'));
    btns.appendChild(button('編集', () => openCharEdit(c.id)));
    btns.appendChild(button('削除', () => {
      if (confirm(`${c.name} を削除しますか？`)) {
        deleteCharacter(c.id);
        renderCharList();
      }
    }, 'drop'));
    row.appendChild(btns);
    charListEl.appendChild(row);
  }
}

async function selectCharacter(id) {
  const c = getCharacter(id);
  if (!c) return;
  charSelect.classList.add('hidden');
  await startGameWith(c);
}

async function startGameWith(character) {
  gameStarted = true;
  showLoading('生成中…');
  try {
    await game.newGame(character);
  } finally {
    hideLoading();
    game.resize();
  }
  if (!hasApiKey()) {
    game.message('AI生成・自由入力・アイテムのAI判定には ⚙設定 のAPIキーが必要です（移動や戦闘はキー無しでも可）。', 'sys');
  }
}

// ---- キャラクター作成／編集 ----
const editTitle = document.getElementById('charedit-title');
const editPortrait = document.getElementById('charedit-portrait');
const editNoimg = document.getElementById('charedit-noimg');
const editImgBtns = document.getElementById('charedit-imgbtns');
const editFile = document.getElementById('charedit-file');
const editName = document.getElementById('charedit-name');
const editPersonality = document.getElementById('charedit-personality');
const editStats = document.getElementById('charedit-stats');

// 作成モード: draft を保持。編集モード: editingId のキャラの名前・性格のみ変更可
let draft = null;
let editingId = null;

function showDraft() {
  editName.value = draft.name;
  editPersonality.value = draft.personality;
  editStats.textContent = `能力: HP ${draft.hp} / MP ${draft.mp} / 攻撃 ${draft.atk} / 防御 ${draft.def}`;
  if (draft.portrait) {
    editPortrait.src = draft.portrait;
    editPortrait.classList.remove('hidden');
    editNoimg.classList.add('hidden');
  } else {
    editPortrait.classList.add('hidden');
    editNoimg.classList.remove('hidden');
  }
}

function openCharEdit(id) {
  editingId = id;
  if (id) {
    const c = getCharacter(id);
    if (!c) return;
    draft = { ...c };
    editTitle.textContent = 'キャラクター編集';
    editImgBtns.style.display = 'none'; // 編集は名前・性格のみ
  } else {
    draft = randomCharacter();
    editTitle.textContent = 'キャラクター作成';
    editImgBtns.style.display = '';
  }
  showDraft();
  charSelect.classList.add('hidden');
  charEdit.classList.remove('hidden');
}

document.getElementById('charedit-pick').addEventListener('click', () => editFile.click());

editFile.addEventListener('change', async () => {
  const file = editFile.files && editFile.files[0];
  editFile.value = '';
  if (!file) return;
  let portrait;
  try {
    portrait = await fileToPortrait(file);
  } catch (_) {
    game.message('画像として読み込めませんでした。', 'bad');
    return;
  }
  draft.portrait = portrait;
  if (hasApiKey()) {
    showLoading('キャラクターを生成中…');
    try {
      const raw = await generateCharacter(portrait);
      draft = sanitizeGenerated(raw, portrait);
      game.message('画像からキャラクターを生成しました。名前と性格は自由に編集できます。', 'good');
    } catch (err) {
      handleLlmError(err);
      game.message('AI生成に失敗したため、ランダム生成の内容を使います。', 'sys');
    } finally {
      hideLoading();
    }
  } else {
    game.message('APIキーがあれば画像から名前・性格・能力を生成できます（⚙設定）。今回はランダム生成です。', 'sys');
  }
  showDraft();
});

document.getElementById('charedit-reroll').addEventListener('click', () => {
  const keep = draft.portrait;
  draft = randomCharacter();
  draft.portrait = keep;
  showDraft();
});

document.getElementById('charedit-cancel').addEventListener('click', () => {
  charEdit.classList.add('hidden');
  openCharSelect();
});

document.getElementById('charedit-save').addEventListener('click', () => {
  const name = editName.value.trim().slice(0, 12);
  const personality = editPersonality.value.trim().slice(0, 60);
  if (editingId) {
    const c = getCharacter(editingId);
    if (!c) return;
    c.name = name || c.name;
    c.personality = personality || c.personality;
    trySave(c);
    // プレイ中のキャラを編集した場合はHUDにも反映
    if (game.character && game.character.id === c.id) {
      game.character = c;
      if (game.player) game.render();
    }
  } else {
    draft.name = name || draft.name;
    draft.personality = personality || draft.personality;
    trySave(draft);
  }
  charEdit.classList.add('hidden');
  openCharSelect();
});

function trySave(c) {
  try {
    saveCharacter(c);
  } catch (_) {
    alert('保存に失敗しました。端末の保存容量が足りない可能性があります。古いキャラクターを削除してください。');
  }
}

window.addEventListener('resize', () => game.resize());

// ---- 起動 ----
// ゲームは開始せず、まずキャラクター選択を表示する
openCharSelect();

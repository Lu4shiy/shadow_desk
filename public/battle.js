// ==================== BATTLE CLIENT ====================

let currentBattleId = null;
let currentBattleState = null;
let currentPlayerKey = null;
let currentOppDiscSec = 0;
let serverTimeOffsetMs = 0;
let battlePollTimer = null;
let turnTimerInterval = null;
let selectedAttacker = null;
let pendingCardId = null;
let targetMode = null;
let isActionInProgress = false;
let fetchGen = 0;
let lastAppliedGen = 0;
let resultShownBattleId = null;

let prevSnapshot = null;
let oppDisconnectedSince = null;
let sectionHashes = { oppHeader: '', myHeader: '', oppBoard: '', myBoard: '', hand: '' };

let handPointerDown = false;
let handWasDragged = false;
let handStartX = 0;
let handStartScroll = 0;

const OPP_DISC_THRESHOLD = 4;
const OPP_DISC_LIMIT = 60;
let lastMagicSkipNotice = null;

const CARD_TARGETS = {
  'Каменная кожа': 'friendly',
  'Отравленный клинок': 'enemy',
  'Тёмный жрец': 'friendly',
  'Проклятие слабости': 'enemy',
  'Исцеляющий отвар': 'friendly',
  'Теневой сгусток': 'enemy',
  'Вампирский укус': 'enemy',
  'Тёмное благословение': 'friendly',
  'Удар души': 'enemy',
  'Зеркальное отражение': 'friendly',
  'Падающая звезда': 'enemy',
};

const UNTARGETABLE = ['Дракон Бездны', 'Единорог'];

function bShowToast(msg, ok = false) {
  if (/не ваш ход|не твой ход|ваш ход|твой ход/i.test(msg)) return;
  if (typeof showToast === 'function') showToast(msg, ok);
}

// ==================== ВИБРАЦИЯ ====================
function vibrate(kind) {
  try {
    const tg = window.Telegram?.WebApp;
    if (tg?.HapticFeedback) {
      const style = kind === 'heavy' ? 'heavy' : kind === 'medium' ? 'medium' : 'light';
      try { tg.HapticFeedback.impactOccurred(style); } catch (e) {}
      if (kind === 'heavy') {
        try { tg.HapticFeedback.notificationOccurred('error'); } catch (e) {}
      } else {
        try { tg.HapticFeedback.notificationOccurred('warning'); } catch (e) {}
      }
      return;
    }
  } catch (e) {}
  try {
    if (navigator.vibrate) {
      const patterns = { light: 20, medium: [30, 20, 30], heavy: [80, 40, 80] };
      navigator.vibrate(patterns[kind] || [40]);
    }
  } catch (e) {}
}

function flashScreen(color) {
  const flash = document.getElementById('damage-flash');
  if (!flash) return;
  const map = {
    win: 'rgba(46,204,113,0.7)',
    lose: 'rgba(231,76,60,0.7)',
    draw: 'rgba(155,89,182,0.6)',
    damage: 'rgba(231,76,60,0.6)'
  };
  const c = map[color] || map.damage;
  flash.style.background = `radial-gradient(circle, transparent 30%, ${c} 100%)`;
  flash.style.transition = 'opacity 0.1s';
  flash.style.opacity = '1';
  setTimeout(() => {
    flash.style.transition = 'opacity 0.4s';
    flash.style.opacity = '0';
  }, 100);
}

// ==================== ЖИЗНЕННЫЙ ЦИКЛ ====================

function joinBattleInternal(rawBattleId) {
  try {
    const battleId = parseInt(rawBattleId);
    if (!battleId || isNaN(battleId)) {
      console.error('joinBattle: invalid battleId', rawBattleId);
      if (typeof showToast === 'function') showToast('Ошибка: некорректный ID боя');
      return;
    }

    const screen = document.getElementById('battle-screen');
    if (!screen) {
      console.error('joinBattle: #battle-screen not found');
      return;
    }

    // Если уже в этом бою и экран активен — ничего не делаем
    if (currentBattleId === battleId && screen.classList.contains('active')) return;

    // Жесткий сброс на случай, если висел предыдущий бой
    if (battlePollTimer) { clearInterval(battlePollTimer); battlePollTimer = null; }
    if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }

    if (currentBattleId !== battleId) resultShownBattleId = null;
    currentBattleId = battleId;
    currentBattleState = null;
    currentPlayerKey = null;
    currentOppDiscSec = 0;
    oppDisconnectedSince = null;
    selectedAttacker = null;
    pendingCardId = null;
    targetMode = null;
    isActionInProgress = false;
    fetchGen = 0;
    lastAppliedGen = 0;
    prevSnapshot = null;
    sectionHashes = { oppHeader: '', myHeader: '', oppBoard: '', myBoard: '', hand: '' };

    // Безопасный сброс UI
    const setHtml = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

    setHtml('b-opp-board', '<div class="b-board-empty">Загрузка...</div>');
    setHtml('b-my-board', '<div class="b-board-empty">Загрузка...</div>');
    setHtml('b-hand', '');
    setText('b-opp-nick', '…');
    setText('b-my-nick', '…');
    setText('b-opp-hp-text', '…');
    setText('b-my-hp-text', '…');
    setText('b-energy-val', '…');
    setText('b-timer', '⏱ …');

    const oppHpBar = document.getElementById('b-opp-hp-bar'); if (oppHpBar) oppHpBar.style.width = '100%';
    const myHpBar = document.getElementById('b-my-hp-bar'); if (myHpBar) myHpBar.style.width = '100%';
    const oppAv = document.getElementById('b-opp-avatar'); if (oppAv) oppAv.src = '';
    const myAv = document.getElementById('b-my-avatar'); if (myAv) myAv.src = '';

    const resultEl = document.getElementById('b-result'); if (resultEl) resultEl.classList.remove('active');
    const reconnectEl = document.getElementById('b-reconnect-overlay'); if (reconnectEl) reconnectEl.classList.remove('active');
    const targetHintEl = document.getElementById('b-target-hint'); if (targetHintEl) targetHintEl.style.display = 'none';

    // Открываем экран
    screen.classList.add('active');

    // Запускаем поллинг и таймеры
    fetchBattleState();
    if (battlePollTimer) clearInterval(battlePollTimer);
    battlePollTimer = setInterval(fetchBattleState, 1000);

    if (turnTimerInterval) clearInterval(turnTimerInterval);
    turnTimerInterval = setInterval(() => {
      updateTimerDisplay();
      updateReconnectOverlayTick();
    }, 500);

  } catch (e) {
    console.error('joinBattle error:', e);
    if (typeof showToast === 'function') showToast('Ошибка открытия боя');
  }
}

function leaveBattleInternal() {
  if (battlePollTimer) { clearInterval(battlePollTimer); battlePollTimer = null; }
  if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
  document.getElementById('battle-screen').classList.remove('active');
  document.getElementById('b-result').classList.remove('active');
  document.getElementById('b-reconnect-overlay').classList.remove('active');
  document.getElementById('b-target-hint').style.display = 'none';
  currentBattleId = null;
  currentBattleState = null;
  currentPlayerKey = null;
  currentOppDiscSec = 0;
  oppDisconnectedSince = null;
  selectedAttacker = null;
  pendingCardId = null;
  targetMode = null;
  prevSnapshot = null;
  if (typeof window.checkActiveBattle === 'function') window.checkActiveBattle();
}

// ==================== ПОЛУЧЕНИЕ ====================

async function fetchBattleState() {
  if (!currentBattleId) return;
  const myGen = ++fetchGen;
  const fetchStartedAt = Date.now();
  try {
    const res = await apiFetch(`/api/battle/${currentBattleId}`);
    if (myGen < lastAppliedGen) return;
    lastAppliedGen = myGen;

    if (Number.isFinite(Number(res.server_now))) {
      const requestStartedAt = fetchStartedAt;
      serverTimeOffsetMs = Number(res.server_now) - (requestStartedAt + Date.now()) / 2;
    }
    currentBattleState = res.battle.state;
    currentPlayerKey = res.battle.playerKey;
    currentOppDiscSec = res.battle.opponent_disconnected_sec || 0;

    renderBattle(res.battle);
    updateTimerDisplay();
    updateReconnectOverlayTick();
    detectFeedback();
  } catch (err) {
    console.error('fetchBattle:', err);
    if (err.message && err.message.includes('не найден')) leaveBattleInternal();
  }
}

function detectFeedback() {
  const st = currentBattleState;
  if (!st) return;
  const myKey = currentPlayerKey;
  const oppKey = myKey === 'p1' ? 'p2' : 'p1';

  const snap = {
    myHp: st[myKey].hp,
    oppHp: st[oppKey].hp,
    myBoard: new Set((st[myKey].board || []).map(Number)),
    oppBoard: new Set((st[oppKey].board || []).map(Number))
  };

  if (prevSnapshot) {
    let playerDamaged = false, characterDied = false;
    if (snap.myHp < prevSnapshot.myHp) playerDamaged = true;
    if (snap.oppHp < prevSnapshot.oppHp) playerDamaged = true;
    prevSnapshot.myBoard.forEach(id => { if (!snap.myBoard.has(id)) characterDied = true; });
    prevSnapshot.oppBoard.forEach(id => { if (!snap.oppBoard.has(id)) characterDied = true; });

    if (playerDamaged) { vibrate('heavy'); flashScreen('damage'); }
    else if (characterDied) vibrate('medium');
  }
  prevSnapshot = snap;
}

// ==================== УТИЛИТЫ ====================

function cardImgUrl(card) { return card.image_url ? `/img/cards/${card.image_url}` : null; }

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

function isValidTarget(card, ownerKey) {
  if (!targetMode) return false;
  const isFriendly = ownerKey === currentPlayerKey;
  if (targetMode === 'friendly' && !isFriendly) return false;
  if (targetMode === 'enemy' && isFriendly) return false;

  if (targetMode === 'enemy') {
    if (UNTARGETABLE.includes(card.name)) return false;
    const pendingCard = currentBattleState.cards[pendingCardId] || currentBattleState.cards[String(pendingCardId)];
    if (pendingCard && pendingCard.type === 'Негативная') {
      const me = currentBattleState[currentPlayerKey];
      if (card.immuneNegativeUntil && (me.turnNumber || 0) <= card.immuneNegativeUntil) return false;
    }
  }
  return true;
}

// ==================== РЕНДЕР ====================

function isBattleStarted(st = currentBattleState) {
  if (!st) return false;
  if (st.countdownEnabled !== true) return st.status === 'active';
  const startsAt = Number(st.battleStartsAt);
  return Number.isFinite(startsAt) && startsAt > 0 && Date.now() + serverTimeOffsetMs >= startsAt;
}

function updateStartCountdown() {
  const overlay = document.getElementById('b-start-overlay');
  const title = document.getElementById('b-start-title');
  const number = document.getElementById('b-start-countdown');
  if (!overlay || !title || !number) return;

  const st = currentBattleState;
  if (!st || st.status !== 'active' || st.countdownEnabled !== true) {
    overlay.classList.remove('active');
    return;
  }

  const startsAt = Number(st.battleStartsAt);
  if (!Number.isFinite(startsAt) || startsAt <= 0) {
    title.textContent = 'ОЖИДАЕМ СОПЕРНИКА';
    number.textContent = '…';
    overlay.classList.add('active');
    return;
  }

  const remainingMs = startsAt - (Date.now() + serverTimeOffsetMs);
  if (remainingMs > 0) {
    title.textContent = 'МАТЧ НАЧИНАЕТСЯ ЧЕРЕЗ';
    number.textContent = String(Math.max(1, Math.ceil(remainingMs / 1000)));
    overlay.classList.add('active');
  } else {
    overlay.classList.remove('active');
  }
}

function renderBattle(battle) {
  const st = battle.state;
  const myKey = battle.playerKey;
  const oppKey = myKey === 'p1' ? 'p2' : 'p1';
  const me = st[myKey], opp = st[oppKey];
  const battleReady = isBattleStarted(st);
  const myTurn = st.currentTurnPlayer === myKey && battleReady;
  updateStartCountdown();

  const oppHeaderHtml = `${opp.player?.avatar_url || ''}|${opp.player?.nickname || 'Соперник'}|${opp.hp}/${opp.maxHp}|${opp.handCount ?? (opp.hand ? opp.hand.length : 0)}`;
  if (hashStr(oppHeaderHtml) !== sectionHashes.oppHeader) {
    sectionHashes.oppHeader = hashStr(oppHeaderHtml);
    const a = document.getElementById('b-opp-avatar');
    if (a) a.src = opp.player?.avatar_url || '';
    document.getElementById('b-opp-nick').textContent = opp.player?.nickname || 'Соперник';
    document.getElementById('b-opp-sub').textContent = `🃏 ${opp.handCount ?? (opp.hand ? opp.hand.length : 0)} карт в руке`;
    document.getElementById('b-opp-hp-bar').style.width = Math.max(0, (opp.hp / opp.maxHp) * 100) + '%';
    document.getElementById('b-opp-hp-text').textContent = `${Math.max(0, opp.hp)}/${opp.maxHp}`;
  }

  const myHeaderHtml = `${me.player?.avatar_url || ''}|${me.player?.nickname || 'Вы'}|${me.hp}/${me.maxHp}|${me.energy}/${me.maxEnergy}|${myTurn ? 1 : 0}|${st.status}`;
  if (hashStr(myHeaderHtml) !== sectionHashes.myHeader) {
    sectionHashes.myHeader = hashStr(myHeaderHtml);
    const a = document.getElementById('b-my-avatar');
    if (a) a.src = me.player?.avatar_url || '';
    document.getElementById('b-my-nick').textContent = me.player?.nickname || 'Вы';
    document.getElementById('b-my-hp-bar').style.width = Math.max(0, (me.hp / me.maxHp) * 100) + '%';
    document.getElementById('b-my-hp-text').textContent = `${Math.max(0, me.hp)}/${me.maxHp}`;
    document.getElementById('b-energy-val').textContent = `${me.energy}/${me.maxEnergy}`;
    document.getElementById('b-end-turn').disabled = !myTurn || st.status !== 'active';
  }

  renderBoardSection('b-opp-board', opp.board, st.cards, oppKey, myKey, myTurn, 'oppBoard');
  renderBoardSection('b-my-board', me.board, st.cards, myKey, oppKey, myTurn, 'myBoard');
  renderHandSection(me.hand, st.cards, me.energy, myTurn, st.status === 'active' && battleReady);
  const skipNoticeKey = `${battle.id}:${me.turnNumber}`;
  if (me.skipMagicPhase && lastMagicSkipNotice !== skipNoticeKey) {
    lastMagicSkipNotice = skipNoticeKey;
    bShowToast('Кража разума: в этом ходу вы не можете разыгрывать карты');
  }

  if (st.status === 'finished') {
    showBattleResult(st.winner === myKey ? 'win' : (st.winner === null ? 'draw' : 'lose'));
  }
}

function buildBoardHtml(boardInvIds, cards, ownerKey, otherKey, myTurn) {
  if (!boardInvIds || boardInvIds.length === 0) {
    return `<div class="b-board-empty">${ownerKey === currentPlayerKey ? 'Ваш стол пуст' : 'Стол соперника пуст'}</div>`;
  }
  return boardInvIds.map(invId => {
    const c = cards[invId] || cards[String(invId)];
    if (!c) return '';
    const canAttack = ownerKey === currentPlayerKey && myTurn && !c.hasAttacked && c.currentAtk > 0 && !c.discarded;
    const isSelected = selectedAttacker === Number(invId);
    const isEnemyTarget = otherKey === currentPlayerKey && selectedAttacker !== null && ownerKey !== currentPlayerKey;
    const isTargetValid = isValidTarget(c, ownerKey);

    const cls = ['b-card-wrap'];
    if (canAttack) cls.push('can-attack');
    if (isSelected) cls.push('selected');
    if (!canAttack && c.hasAttacked && ownerKey === currentPlayerKey) cls.push('attacked');
    if (isEnemyTarget) cls.push('enemy-target');
    
    if (targetMode) {
      if (isTargetValid) cls.push('target-valid');
      else cls.push('target-invalid');
    }

    const imgUrl = cardImgUrl(c);
    const img = imgUrl
      ? `<img src="${imgUrl}" alt="" draggable="false" />`
      : `<div style="width:100%;height:100%;background:#222;display:flex;justify-content:center;align-items:center;font-size:10px;text-align:center;padding:4px;">${c.name}</div>`;

    return `
      <div class="${cls.join(' ')}" data-inv="${invId}" data-owner="${ownerKey}">
        <div class="b-card">${img}</div>
        <div class="b-stats">
          <span class="atk">⚔${c.currentAtk}</span>
          ${c.currentArmor > 0 ? `<span class="armor">🛡${c.currentArmor}</span>` : ''}
          <span class="hp">❤${Math.max(0, c.currentHp)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderBoardSection(containerId, board, cards, ownerKey, otherKey, myTurn, hashKey) {
  const html = buildBoardHtml(board, cards, ownerKey, otherKey, myTurn);
  const h = hashStr(html);
  if (h === sectionHashes[hashKey]) return;
  sectionHashes[hashKey] = h;

  const container = document.getElementById(containerId);
  container.innerHTML = html;
  container.querySelectorAll('.b-card-wrap').forEach(el => {
    el.onclick = () => onBoardCardClick(el, ownerKey);
  });
}

function buildHandHtml(hand, cards, energy, myTurn, active, magicPhaseAvailable = true) {
  if (!hand || hand.length === 0) return '';
  return hand.map(invId => {
    const c = cards[invId] || cards[String(invId)];
    if (!c) return '';
    const energyCost = Number(c.energyCost ?? c.cost ?? 0);
    const playable = active && myTurn && magicPhaseAvailable && Number.isFinite(energyCost) && energyCost >= 0 && energyCost <= energy;
    const imgUrl = cardImgUrl(c);
    const img = imgUrl
      ? `<img src="${imgUrl}" alt="" draggable="false" />`
      : `<div style="width:100%;height:100%;background:#222;display:flex;justify-content:center;align-items:center;font-size:10px;text-align:center;padding:4px;">${c.name}</div>`;

    // НЕТ статов под картой в руке — они уже на картинке
    return `
      <div class="hand-card-wrap ${playable ? 'playable' : 'not-playable'}" data-inv="${invId}">
        <div class="hand-card">${img}</div>
      </div>
    `;
  }).join('');
}

function renderHandSection(hand, cards, energy, myTurn, active) {
  const html = buildHandHtml(hand, cards, energy, myTurn, active, !currentBattleState?.[currentPlayerKey]?.skipMagicPhase);
  const h = hashStr(html);
  if (h === sectionHashes.hand) return;
  sectionHashes.hand = h;

  const container = document.getElementById('b-hand');
  container.innerHTML = html;
  container.querySelectorAll('.hand-card-wrap').forEach(el => {
    el.onclick = () => {
      if (handWasDragged) { handWasDragged = false; return; }
      const invId = parseInt(el.dataset.inv);
      if (el.classList.contains('not-playable')) return;
      if (!currentBattleState || currentBattleState.status !== 'active') return;
      if (!isBattleStarted(currentBattleState)) return;
      if (currentBattleState.currentTurnPlayer !== currentPlayerKey) return;
      onHandCardClick(invId);
    };
  });
}

// ==================== ДЕЙСТВИЯ ====================

function onHandCardClick(invId) {
  const me = currentBattleState[currentPlayerKey];
  const card = currentBattleState.cards[invId] || currentBattleState.cards[String(invId)];
  if (!card) return;
  if (!isBattleStarted(currentBattleState)) return;

  if (me.skipMagicPhase) {
    bShowToast('В этом ходу вы пропускаете фазу магии');
    return;
  }
  if (Number(card.energyCost ?? card.cost ?? 0) > me.energy) {
    bShowToast('Недостаточно энергии');
    return;
  }

  // Если уже в target mode — отменяем и начинаем заново
  if (targetMode) { cancelTargetMode(); }

  const targetReq = CARD_TARGETS[card.name];
  if (!targetReq) {
    doPlay(invId, null);
    return;
  }

  const oppKey = currentPlayerKey === 'p1' ? 'p2' : 'p1';
  const opp = currentBattleState[oppKey];
  const pool = targetReq === 'friendly' ? me.board : opp.board;

  if (!pool || pool.length === 0) {
    bShowToast(targetReq === 'friendly' ? 'У вас нет персонажей для цели' : 'У соперника нет персонажей');
    return;
  }

  pendingCardId = invId;
  targetMode = targetReq;
  sectionHashes.oppBoard = '';
  sectionHashes.myBoard = '';
  renderBattle({ id: currentBattleId, playerKey: currentPlayerKey, status: currentBattleState.status, state: currentBattleState });
  showTargetHint(targetReq);
}

// showTargetHint больше не нужна — цели подсвечиваются диммингом

function cancelTargetMode() {
  pendingCardId = null;
  targetMode = null;
  sectionHashes.oppBoard = '';
  sectionHashes.myBoard = '';
  if (currentBattleState) {
    renderBattle({ id: currentBattleId, playerKey: currentPlayerKey, status: currentBattleState.status, state: currentBattleState });
  }
}

function onBoardCardClick(el, ownerKey) {
  const board = el.closest('.b-board');
  if (board && Number(board.dataset.suppressClickUntil || 0) > Date.now()) return;
  if (!currentBattleState || currentBattleState.status !== 'active') return;
  if (!isBattleStarted(currentBattleState)) return;

  const invId = parseInt(el.dataset.inv);
  const st = currentBattleState;

  // === Target mode: клик по карте-цели ===
  if (targetMode && pendingCardId) {
    const card = st.cards[invId] || st.cards[String(invId)];
    if (!card) return;
    if (!isValidTarget(card, ownerKey)) {
      bShowToast('Недопустимая цель');
      return;
    }
    const cardId = pendingCardId;
    cancelTargetMode();
    doPlay(cardId, invId);
    return;
  }

  // === Обычный режим ===
  if (st.currentTurnPlayer !== currentPlayerKey) return;

  if (ownerKey === currentPlayerKey) {
    const c = st.cards[invId] || st.cards[String(invId)];
    if (!c || c.hasAttacked || c.currentAtk <= 0) return;
    selectedAttacker = (selectedAttacker === invId) ? null : invId;
    sectionHashes.oppBoard = '';
    sectionHashes.myBoard = '';
    renderBattle({ id: currentBattleId, playerKey: currentPlayerKey, status: st.status, state: st });
  } else {
    if (!selectedAttacker) return;
    doAttack(selectedAttacker, invId);
  }
}

async function doPlay(invId, targetId) {
  if (isActionInProgress) return;
  isActionInProgress = true;
  try {
    const body = { inv_id: invId };
    if (targetId) body.target_id = targetId;
    await apiFetch(`/api/battle/${currentBattleId}/play`, {
      method: 'POST', body: JSON.stringify(body)
    });
  } catch (err) { bShowToast(err.message); }
  isActionInProgress = false;
  await fetchBattleState();
}

async function doAttack(attackerId, targetId) {
  if (isActionInProgress) return;
  isActionInProgress = true;
  try {
    await apiFetch(`/api/battle/${currentBattleId}/attack`, {
      method: 'POST',
      body: JSON.stringify({ attacker_id: attackerId, target_id: targetId })
    });
    selectedAttacker = null;
  } catch (err) { bShowToast(err.message); }
  isActionInProgress = false;
  await fetchBattleState();
}

async function attackPlayer() {
  if (!selectedAttacker) return;
  const oppKey = currentPlayerKey === 'p1' ? 'p2' : 'p1';
  const opp = currentBattleState[oppKey];
  if (opp.board.length > 0) return;
  await doAttack(selectedAttacker, 'player');
}

async function endTurn() {
  if (isActionInProgress) return;
  isActionInProgress = true;
  try {
    await apiFetch(`/api/battle/${currentBattleId}/end-turn`, { method: 'POST' });
    selectedAttacker = null;
  } catch (err) { bShowToast(err.message); }
  isActionInProgress = false;
  await fetchBattleState();
}

// ==================== ТАЙМЕР ====================
function updateTimerDisplay() {
  updateStartCountdown();
  const el = document.getElementById('b-timer');
  if (!el) return;
  if (currentOppDiscSec > OPP_DISC_THRESHOLD) { el.style.color = '#666'; return; }
  if (!currentBattleState || currentBattleState.status !== 'active' || !isBattleStarted(currentBattleState) || !currentBattleState.turnStartedAt) {
    el.textContent = '⏱ —'; el.style.color = '#666'; return;
  }
  const elapsed = Math.floor((Date.now() + serverTimeOffsetMs - currentBattleState.turnStartedAt) / 1000);
  const remaining = Math.max(0, 60 - elapsed);
  el.textContent = `⏱ ${remaining}с`;
  if (remaining <= 10) el.style.color = '#e74c3c';
  else if (remaining <= 30) el.style.color = '#f1c40f';
  else el.style.color = '#2ecc71';

  if (remaining <= 0
      && currentBattleState.currentTurnPlayer === currentPlayerKey
      && !isActionInProgress
      && currentBattleState.status === 'active') {
    endTurn();
  }
}

function updateReconnectOverlayTick() {
  const overlay = document.getElementById('b-reconnect-overlay');
  const timerEl = document.getElementById('b-reconnect-timer');
  if (!overlay || !timerEl) return;
  const active = currentBattleState && currentBattleState.status === 'active';
  if (currentBattleState?.countdownEnabled === true && !isBattleStarted(currentBattleState)) {
    oppDisconnectedSince = null;
    overlay.classList.remove('active');
    return;
  }

  if (currentOppDiscSec >= OPP_DISC_THRESHOLD && active) {
    if (!oppDisconnectedSince) {
      oppDisconnectedSince = Date.now() - currentOppDiscSec * 1000;
    }
    const goneSec = Math.floor((Date.now() - oppDisconnectedSince) / 1000);
    const remaining = Math.max(0, OPP_DISC_LIMIT - goneSec);
    timerEl.textContent = remaining;
    if (remaining <= 10) timerEl.style.color = '#e74c3c';
    else if (remaining <= 30) timerEl.style.color = '#f1c40f';
    else timerEl.style.color = '#e74c3c';
    overlay.classList.add('active');
  } else {
    oppDisconnectedSince = null;
    overlay.classList.remove('active');
  }
}

// ==================== СДАЧА ====================
function handleSurrender() {
  if (!currentBattleId || !currentBattleState) return;
  if (currentBattleState.status !== 'active') { leaveBattleInternal(); return; }

  const modal = document.getElementById('b-surrender-modal');
  modal.style.display = 'flex';

  document.getElementById('b-surr-ok').onclick = async () => {
    modal.style.display = 'none';
    try {
      await apiFetch(`/api/battle/${currentBattleId}/surrender`, { method: 'POST' });
    } catch (err) { bShowToast(err.message); }
    await fetchBattleState();
  };
  document.getElementById('b-surr-cancel').onclick = () => {
    modal.style.display = 'none';
  };
}

function showBattleResult(kind) {
  const overlay = document.getElementById('b-result');
  const title = document.getElementById('b-result-title');
  const rewardsEl = document.getElementById('b-rewards');
  const isFirstResultForBattle = currentBattleId !== null && resultShownBattleId !== currentBattleId;

  overlay.classList.add('active');

  if (kind === 'win') {
    title.textContent = '🏆 ПОБЕДА';
    title.className = 'win';
    if (isFirstResultForBattle) {
      vibrate('heavy');
      flashScreen('win');
    }
  } else if (kind === 'lose') {
    title.textContent = '💀 ПОРАЖЕНИЕ';
    title.className = 'lose';
    if (isFirstResultForBattle) {
      vibrate('heavy');
      flashScreen('lose');
    }
  } else {
    title.textContent = 'НИЧЬЯ';
    title.className = 'draw';
    if (isFirstResultForBattle) flashScreen('draw');
  }

  if (currentBattleState && currentBattleState[currentPlayerKey] && currentBattleState[currentPlayerKey].rewards) {
    const r = currentBattleState[currentPlayerKey].rewards;
    rewardsEl.innerHTML =
      '<div>✨ Опыт: <span style="color:#f1c40f; float:right;">+' + r.xp + '</span></div>' +
      '<div>💰 Монеты: <span style="color:#f1c40f; float:right;">+' + r.coins + '</span></div>' +
      '<div>💧 Мана: <span style="color:#3498db; float:right;">+' + r.mana + '</span></div>' +
      (r.pack ? '<div style="color:#2ecc71; margin-top:5px;">🎁 Выпал пак с картой!</div>' : '');
    rewardsEl.style.display = 'block';
  } else {
    rewardsEl.style.display = 'none';
  }

  if (isFirstResultForBattle) {
    resultShownBattleId = currentBattleId;
    if (typeof window.refreshProfile === 'function') window.refreshProfile();
  }
}

function setupBoardScroll() {
  document.querySelectorAll('.b-board').forEach(board => {
    if (board.dataset.boardScrollBound === '1') return;
    board.dataset.boardScrollBound = '1';
    let pointerId = null;
    let startX = 0;
    let startScroll = 0;
    let dragged = false;

    const finish = event => {
      if (pointerId === null || (event && event.pointerId !== pointerId)) return;
      const previousPointer = pointerId;
      pointerId = null;
      if (dragged) board.dataset.suppressClickUntil = String(Date.now() + 350);
      dragged = false;
      board.classList.remove('dragging');
      try {
        if (board.hasPointerCapture?.(previousPointer)) board.releasePointerCapture(previousPointer);
      } catch (error) {}
    };

    board.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (board.scrollWidth <= board.clientWidth) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startScroll = board.scrollLeft;
      dragged = false;
      try { board.setPointerCapture(event.pointerId); } catch (error) {}
    });

    board.addEventListener('pointermove', event => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      const deltaX = startX - event.clientX;
      if (!dragged && Math.abs(deltaX) > 6) {
        dragged = true;
        board.classList.add('dragging');
      }
      if (dragged) {
        board.scrollLeft = startScroll + deltaX;
        if (event.cancelable) event.preventDefault();
      }
    });

    board.addEventListener('pointerup', finish);
    board.addEventListener('pointercancel', finish);
    board.addEventListener('lostpointercapture', finish);
  });
}

// ==================== СКРОЛЛ РУКИ ====================
function setupHandScroll() {
  const handEl = document.getElementById('b-hand');
  if (!handEl || handEl.dataset.scrollBound === '1') return;
  handEl.dataset.scrollBound = '1';

  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    handPointerDown = true;
    handWasDragged = false;
    handStartX = e.clientX;
    handStartScroll = handEl.scrollLeft;
  };
  const onMove = (e) => {
    if (!handPointerDown) return;
    const dx = handStartX - e.clientX;
    if (Math.abs(dx) > 5) {
      handWasDragged = true;
      handEl.classList.add('dragging');
      handEl.scrollLeft = handStartScroll + dx;
      if (e.cancelable) e.preventDefault();
    }
  };
  const onUp = () => {
    handPointerDown = false;
    handEl.classList.remove('dragging');
  };

  handEl.addEventListener('pointerdown', onDown);
  handEl.addEventListener('pointermove', onMove);
  handEl.addEventListener('pointerup', onUp);
  handEl.addEventListener('pointercancel', onUp);
  handEl.addEventListener('pointerleave', () => { if (handPointerDown) onUp(); });

  handEl.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      handEl.scrollLeft += e.deltaY;
    }
  }, { passive: false });
}

document.addEventListener('keydown', (e) => {
  const battleScreen = document.getElementById('battle-screen');
  if (!battleScreen || !battleScreen.classList.contains('active')) return;
  if (e.key === 'Escape') { cancelTargetMode(); selectedAttacker = null; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const handEl = document.getElementById('b-hand');
    if (!handEl) return;
    e.preventDefault();
    handEl.scrollLeft += (e.key === 'ArrowLeft' ? -150 : 150);
  }
});

// ==================== ЭКСПОРТ В WINDOW (сразу, до любой инициализации) ====================
// Делаем ДО IIFE, чтобы даже если IIFE упадёт — joinBattle доступен из app.js
window.joinBattle = function(id) { return joinBattleInternal(id); };
window.leaveBattle = function() { return leaveBattleInternal(); };
console.log('[battle.js] window.joinBattle установлен');

// ==================== ПРИВЯЗКА (изолированно, чтобы не сломать экспорт) ====================
try {
  const endTurnBtn = document.getElementById('b-end-turn');
  if (endTurnBtn) endTurnBtn.onclick = endTurn;

  const surrenderBtn = document.getElementById('b-surrender');
  if (surrenderBtn) {
    surrenderBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleSurrender();
    };
  }

  const resultBackBtn = document.getElementById('b-result-back');
  if (resultBackBtn) resultBackBtn.onclick = leaveBattleInternal;

  const oppInfoEl = document.querySelectorAll('.b-info')[0];
  if (oppInfoEl) {
    oppInfoEl.style.cursor = 'pointer';
    oppInfoEl.onclick = () => attackPlayer();
  }

  const targetCancel = document.getElementById('b-target-cancel');
  if (targetCancel) targetCancel.onclick = cancelTargetMode;

  setupHandScroll();
  setupBoardScroll();
  console.log('[battle.js] события привязаны');
} catch (e) {
  console.error('[battle.js] Ошибка при привязке событий:', e);
}
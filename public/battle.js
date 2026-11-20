// ==================== BATTLE CLIENT ====================

let currentBattleId = null;
let currentBattleState = null;
let currentPlayerKey = null;
let currentOppDiscSec = 0;
let battlePollTimer = null;
let turnTimerInterval = null;
let selectedAttacker = null;
let isActionInProgress = false;
let fetchGen = 0;
let lastAppliedGen = 0;

let prevSnapshot = null;
let oppDisconnectedSince = null; // ЛОКАЛЬНЫЙ timestamp первого обнаружения офлайна

let sectionHashes = { oppHeader: '', myHeader: '', oppBoard: '', myBoard: '', hand: '' };

let handPointerDown = false;
let handWasDragged = false;
let handStartX = 0;
let handStartScroll = 0;

const OPP_DISC_THRESHOLD = 4; // сек — после какого офлайна показывать overlay
const OPP_DISC_LIMIT = 60;    // сек — сколько ждём соперника

function bShowToast(msg, ok = false) {
  if (typeof showToast === 'function') showToast(msg, ok);
}

// ==================== ВИБРАЦИЯ ====================
function vibrate(kind) {
  // Визуальный флэш при тяжёлом уроне (работает везде, включая десктоп)
  if (kind === 'heavy') {
    const flash = document.getElementById('damage-flash');
    if (flash) {
      flash.style.opacity = '1';
      setTimeout(() => { flash.style.opacity = '0'; }, 150);
    }
  }

  // Telegram HapticFeedback (мобильный Telegram)
  try {
    const tg = window.Telegram?.WebApp;
    if (tg?.HapticFeedback) {
      const styleMap = { light: 'light', medium: 'medium', heavy: 'heavy' };
      const style = styleMap[kind] || 'medium';
      try { tg.HapticFeedback.impactOccurred(style); } catch (e) {}
      if (kind === 'heavy') {
        try { tg.HapticFeedback.notificationOccurred('error'); } catch (e) {}
      } else {
        try { tg.HapticFeedback.notificationOccurred('warning'); } catch (e) {}
      }
      return;
    }
  } catch (e) {}

  // Fallback — обычный браузер
  try {
    if (navigator.vibrate) {
      const patterns = { light: 20, medium: [30, 20, 30], heavy: [80, 40, 80] };
      navigator.vibrate(patterns[kind] || [40]);
    }
  } catch (e) {}
}

// ==================== ЖИЗНЕННЫЙ ЦИКЛ ====================

function joinBattle(battleId) {
  if (currentBattleId === battleId) return;
  currentBattleId = battleId;
  currentBattleState = null;
  currentPlayerKey = null;
  currentOppDiscSec = 0;
  oppDisconnectedSince = null;
  selectedAttacker = null;
  isActionInProgress = false;
  fetchGen = 0;
  lastAppliedGen = 0;
  prevSnapshot = null;
  sectionHashes = { oppHeader: '', myHeader: '', oppBoard: '', myBoard: '', hand: '' };

  // Очистка прошлого боя
  document.getElementById('b-opp-board').innerHTML = '<div class="b-board-empty">Загрузка...</div>';
  document.getElementById('b-my-board').innerHTML = '<div class="b-board-empty">Загрузка...</div>';
  document.getElementById('b-hand').innerHTML = '';
  document.getElementById('b-opp-nick').textContent = '…';
  document.getElementById('b-my-nick').textContent = '…';
  document.getElementById('b-opp-hp-text').textContent = '…';
  document.getElementById('b-my-hp-text').textContent = '…';
  document.getElementById('b-energy-val').textContent = '…';
  document.getElementById('b-timer').textContent = '⏱ …';
  document.getElementById('b-opp-hp-bar').style.width = '100%';
  document.getElementById('b-my-hp-bar').style.width = '100%';
  const oppAv = document.getElementById('b-opp-avatar'); if (oppAv) oppAv.src = '';
  const myAv = document.getElementById('b-my-avatar'); if (myAv) myAv.src = '';
  document.getElementById('b-result').classList.remove('active');
  document.getElementById('b-reconnect-overlay').classList.remove('active');

  document.getElementById('battle-screen').classList.add('active');

  fetchBattleState();
  if (battlePollTimer) clearInterval(battlePollTimer);
  battlePollTimer = setInterval(fetchBattleState, 1000); // ← каждую 1 сек

  if (turnTimerInterval) clearInterval(turnTimerInterval);
  turnTimerInterval = setInterval(() => {
    updateTimerDisplay();
    updateReconnectOverlayTick(); // ← локальный тик 500мс
  }, 500);
}

function leaveBattle() {
  if (battlePollTimer) { clearInterval(battlePollTimer); battlePollTimer = null; }
  if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
  document.getElementById('battle-screen').classList.remove('active');
  document.getElementById('b-result').classList.remove('active');
  document.getElementById('b-reconnect-overlay').classList.remove('active');
  currentBattleId = null;
  currentBattleState = null;
  currentPlayerKey = null;
  currentOppDiscSec = 0;
  oppDisconnectedSince = null;
  selectedAttacker = null;
  prevSnapshot = null;
  if (typeof window.checkActiveBattle === 'function') window.checkActiveBattle();
}

// ==================== ПОЛУЧЕНИЕ ====================

async function fetchBattleState() {
  if (!currentBattleId) return;
  const myGen = ++fetchGen;
  try {
    const res = await apiFetch(`/api/battle/${currentBattleId}`);
    if (myGen < lastAppliedGen) return;
    lastAppliedGen = myGen;

    currentBattleState = res.battle.state;
    currentPlayerKey = res.battle.playerKey;
    currentOppDiscSec = res.battle.opponent_disconnected_sec || 0;

    renderBattle(res.battle);
    updateTimerDisplay();
    updateReconnectOverlayTick();
    detectFeedback();
  } catch (err) {
    console.error('fetchBattle:', err);
    if (err.message && err.message.includes('не найден')) leaveBattle();
  }
}

// ==================== ВИБРАЦИЯ ПО ДИФФУ ====================
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

    if (playerDamaged) vibrate('heavy');
    else if (characterDied) vibrate('medium');
  }
  prevSnapshot = snap;
}

// ==================== УТИЛИТЫ ====================

function cardImgUrl(card) {
  if (card.image_url) return `/img/cards/${card.image_url}`;
  return null;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

// ==================== РЕНДЕР ====================

function renderBattle(battle) {
  const st = battle.state;
  const myKey = battle.playerKey;
  const oppKey = myKey === 'p1' ? 'p2' : 'p1';
  const me = st[myKey], opp = st[oppKey];
  const myTurn = st.currentTurnPlayer === myKey;

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
  renderHandSection(me.hand, st.cards, me.energy, myTurn, st.status === 'active');

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

    const cls = ['b-card-wrap'];
    if (canAttack) cls.push('can-attack');
    if (isSelected) cls.push('selected');
    if (!canAttack && c.hasAttacked && ownerKey === currentPlayerKey) cls.push('attacked');
    if (isEnemyTarget) cls.push('enemy-target');

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

function buildHandHtml(hand, cards, energy, myTurn, active) {
  if (!hand || hand.length === 0) return '';
  return hand.map(invId => {
    const c = cards[invId] || cards[String(invId)];
    if (!c) return '';
    const playable = active && myTurn && c.cost <= energy;
    const imgUrl = cardImgUrl(c);
    const img = imgUrl
      ? `<img src="${imgUrl}" alt="" draggable="false" />`
      : `<div style="width:100%;height:100%;background:#222;display:flex;justify-content:center;align-items:center;font-size:10px;text-align:center;padding:4px;">${c.name}</div>`;

    const statsHtml = c.type === 'Персонаж'
      ? `<div class="h-stats"><span class="atk">⚔${c.baseAtk}</span><span class="hp">❤${c.baseHp}</span></div>`
      : `<div class="h-stats"><span class="cost">⚡${c.cost}</span></div>`;

    return `
      <div class="hand-card-wrap ${playable ? 'playable' : 'not-playable'}" data-inv="${invId}">
        <div class="hand-card">${img}</div>
        ${statsHtml}
      </div>
    `;
  }).join('');
}

function renderHandSection(hand, cards, energy, myTurn, active) {
  const html = buildHandHtml(hand, cards, energy, myTurn, active);
  const h = hashStr(html);
  if (h === sectionHashes.hand) return;
  sectionHashes.hand = h;

  const container = document.getElementById('b-hand');
  container.innerHTML = html;
  container.querySelectorAll('.hand-card-wrap').forEach(el => {
    el.onclick = () => {
      if (handWasDragged) { handWasDragged = false; return; }
      const invId = parseInt(el.dataset.inv);
      if (!currentBattleState || currentBattleState.status !== 'active') return;
      if (currentBattleState.currentTurnPlayer !== currentPlayerKey) return;
      playCard(invId);
    };
  });
}

// ==================== ДЕЙСТВИЯ ====================

function onBoardCardClick(el, ownerKey) {
  if (!currentBattleState || currentBattleState.status !== 'active') return;
  if (currentBattleState.currentTurnPlayer !== currentPlayerKey) return;

  const invId = parseInt(el.dataset.inv);
  const st = currentBattleState;

  if (ownerKey === currentPlayerKey) {
    const c = st.cards[invId] || st.cards[String(invId)];
    if (!c || c.hasAttacked || c.currentAtk <= 0) return;
    selectedAttacker = (selectedAttacker === invId) ? null : invId;
    // Форсируем перерисовку: сбрасываем хеши досок
    sectionHashes.oppBoard = '';
    sectionHashes.myBoard = '';
    renderBattle({ id: currentBattleId, playerKey: currentPlayerKey, status: st.status, state: st });
  } else {
    if (!selectedAttacker) return;
    doAttack(selectedAttacker, invId);
  }
}

async function playCard(invId) {
  if (isActionInProgress) return;
  isActionInProgress = true;
  try {
    await apiFetch(`/api/battle/${currentBattleId}/play`, {
      method: 'POST', body: JSON.stringify({ inv_id: invId })
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
      method: 'POST', body: JSON.stringify({ attacker_id: attackerId, target_id: targetId })
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
  const el = document.getElementById('b-timer');
  if (!el) return;
  if (currentOppDiscSec > OPP_DISC_THRESHOLD) {
    el.style.color = '#666';
    return;
  }
  if (!currentBattleState || currentBattleState.status !== 'active' || !currentBattleState.turnStartedAt) {
    el.textContent = '⏱ —';
    el.style.color = '#666';
    return;
  }
  const elapsed = Math.floor((Date.now() - currentBattleState.turnStartedAt) / 1000);
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

// ==================== RECONNECT OVERLAY (локальный тик) ====================
function updateReconnectOverlayTick() {
  const overlay = document.getElementById('b-reconnect-overlay');
  const timerEl = document.getElementById('b-reconnect-timer');
  if (!overlay || !timerEl) return;

  const active = currentBattleState && currentBattleState.status === 'active';

  if (currentOppDiscSec >= OPP_DISC_THRESHOLD && active) {
    if (!oppDisconnectedSince) {
      // Первое обнаружение — устанавливаем локальную точку отсчёта
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
  if (currentBattleState.status !== 'active') { leaveBattle(); return; }

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
  overlay.classList.add('active');
  if (kind === 'win') { title.textContent = '🏆 ПОБЕДА'; title.className = 'win'; vibrate('heavy'); }
  else if (kind === 'lose') { title.textContent = '💀 ПОРАЖЕНИЕ'; title.className = 'lose'; vibrate('heavy'); }
  else { title.textContent = 'НИЧЬЯ'; title.className = 'draw'; }
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
  handEl.addEventListener('pointerleave', () => {
    if (handPointerDown) onUp();
  });

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
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const handEl = document.getElementById('b-hand');
    if (!handEl) return;
    e.preventDefault();
    handEl.scrollLeft += (e.key === 'ArrowLeft' ? -150 : 150);
  }
});

// ==================== ПРИВЯЗКА ====================
(function bindBattleEvents() {
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
  if (resultBackBtn) resultBackBtn.onclick = leaveBattle;

  const oppInfoEl = document.querySelectorAll('.b-info')[0];
  if (oppInfoEl) {
    oppInfoEl.style.cursor = 'pointer';
    oppInfoEl.onclick = () => attackPlayer();
  }

  setupHandScroll();
})();

window.joinBattle = joinBattle;
window.leaveBattle = leaveBattle;
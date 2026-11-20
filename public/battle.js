// ==================== BATTLE CLIENT ====================

let currentBattleId = null;
let currentBattleState = null;
let currentPlayerKey = null;
let battlePollTimer = null;
let turnTimerInterval = null;
let selectedAttacker = null;
let isActionInProgress = false;

// Кэш прошлого состояния — для детекта урона/смертей
let prevSnapshot = null;

// Хеши секций для избежания полного ре-рендера
let sectionHashes = {
  oppHeader: '',
  myHeader: '',
  oppBoard: '',
  myBoard: '',
  hand: ''
};

function bShowToast(msg, ok = false) {
  if (typeof showToast === 'function') showToast(msg, ok);
  else console.log(msg);
}

// ==================== ВИБРАЦИЯ ====================
function vibrate(kind) {
  try {
    const tg = window.Telegram?.WebApp;
    if (tg?.HapticFeedback) {
      const map = { light: 'lightImpact', medium: 'mediumImpact', heavy: 'heavyImpact' };
      tg.HapticFeedback.impactOccurred(map[kind] || 'medium');
      return;
    }
    if (navigator.vibrate) {
      const map = { light: 15, medium: 40, heavy: 90 };
      navigator.vibrate(map[kind] || 40);
    }
  } catch (e) {}
}

// ==================== ЖИЗНЕННЫЙ ЦИКЛ ====================

function joinBattle(battleId) {
  if (currentBattleId === battleId) return;
  currentBattleId = battleId;
  currentBattleState = null;
  currentPlayerKey = null;
  selectedAttacker = null;
  isActionInProgress = false;
  prevSnapshot = null;
  sectionHashes = { oppHeader: '', myHeader: '', oppBoard: '', myBoard: '', hand: '' };

  // Очищаем DOM от предыдущего боя — чтобы не мелькал
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

  document.getElementById('battle-screen').classList.add('active');

  fetchBattleState();
  if (battlePollTimer) clearInterval(battlePollTimer);
  battlePollTimer = setInterval(fetchBattleState, 2000);

  if (turnTimerInterval) clearInterval(turnTimerInterval);
  turnTimerInterval = setInterval(updateTimerDisplay, 500);
}

function leaveBattle() {
  if (battlePollTimer) { clearInterval(battlePollTimer); battlePollTimer = null; }
  if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
  document.getElementById('battle-screen').classList.remove('active');
  document.getElementById('b-result').classList.remove('active');
  currentBattleId = null;
  currentBattleState = null;
  currentPlayerKey = null;
  selectedAttacker = null;
  prevSnapshot = null;
}

// ==================== ПОЛУЧЕНИЕ И РЕНДЕР ====================

async function fetchBattleState() {
  if (!currentBattleId) return;
  if (isActionInProgress) return;
  try {
    const res = await apiFetch(`/api/battle/${currentBattleId}`);
    currentBattleState = res.battle.state;
    currentPlayerKey = res.battle.playerKey;
    renderBattle(res.battle);
    updateTimerDisplay();
    detectFeedback(); // вибрация по диффу
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
    let heavy = false, medium = false;

    // Игрок получил урон (любой)
    if (snap.myHp < prevSnapshot.myHp) heavy = true;
    if (snap.oppHp < prevSnapshot.oppHp) heavy = true;

    // Чей-то персонаж погиб
    prevSnapshot.myBoard.forEach(id => { if (!snap.myBoard.has(id)) medium = true; });
    prevSnapshot.oppBoard.forEach(id => { if (!snap.oppBoard.has(id)) medium = true; });

    if (heavy) vibrate('heavy');
    else if (medium) vibrate('medium');
  }
  prevSnapshot = snap;
}

function cardImgUrl(card) {
  if (card.image_url) return `/img/cards/${card.image_url}`;
  return null;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

function renderBattle(battle) {
  const st = battle.state;
  const myKey = battle.playerKey;
  const oppKey = myKey === 'p1' ? 'p2' : 'p1';
  const me = st[myKey], opp = st[oppKey];
  const myTurn = st.currentTurnPlayer === myKey;

  // --- Header соперника (hash) ---
  const oppHeaderHtml = `
    ${opp.player?.avatar_url || ''}|${opp.player?.nickname || 'Соперник'}|
    ${Math.max(0, opp.hp)}/${opp.maxHp}|${opp.handCount ?? (opp.hand ? opp.hand.length : 0)}
  `;
  if (hashStr(oppHeaderHtml) !== sectionHashes.oppHeader) {
    sectionHashes.oppHeader = hashStr(oppHeaderHtml);
    const a = document.getElementById('b-opp-avatar');
    if (a) a.src = opp.player?.avatar_url || '';
    document.getElementById('b-opp-nick').textContent = opp.player?.nickname || 'Соперник';
    document.getElementById('b-opp-sub').textContent = `🃏 ${opp.handCount ?? (opp.hand ? opp.hand.length : 0)} карт в руке`;
    document.getElementById('b-opp-hp-bar').style.width = Math.max(0, (opp.hp / opp.maxHp) * 100) + '%';
    document.getElementById('b-opp-hp-text').textContent = `${Math.max(0, opp.hp)}/${opp.maxHp}`;
  }

  // --- Header мой (hash) ---
  const myHeaderHtml = `
    ${me.player?.avatar_url || ''}|${me.player?.nickname || 'Вы'}|
    ${Math.max(0, me.hp)}/${me.maxHp}|${me.energy}/${me.maxEnergy}|${myTurn ? 1 : 0}|${st.status}
  `;
  if (hashStr(myHeaderHtml) !== sectionHashes.myHeader) {
    sectionHashes.myHeader = hashStr(myHeaderHtml);
    const a = document.getElementById('b-my-avatar');
    if (a) a.src = me.player?.avatar_url || '';
    document.getElementById('b-my-nick').textContent = me.player?.nickname || 'Вы';
    document.getElementById('b-my-hp-bar').style.width = Math.max(0, (me.hp / me.maxHp) * 100) + '%';
    document.getElementById('b-my-hp-text').textContent = `${Math.max(0, me.hp)}/${me.maxHp}`;
    document.getElementById('b-energy-val').textContent = `${me.energy}/${me.maxEnergy}`;
    const endBtn = document.getElementById('b-end-turn');
    endBtn.disabled = !myTurn || st.status !== 'active';
  }

  // --- Доски ---
  renderBoardSection('b-opp-board', opp.board, st.cards, oppKey, myKey, myTurn, 'oppBoard');
  renderBoardSection('b-my-board', me.board, st.cards, myKey, oppKey, myTurn, 'myBoard');

  // --- Рука ---
  renderHandSection(me.hand, st.cards, me.energy, myTurn, st.status === 'active');

  // --- Результат ---
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

    const cls = ['b-card'];
    if (canAttack) cls.push('can-attack');
    if (isSelected) cls.push('selected');
    if (!canAttack && c.hasAttacked && ownerKey === currentPlayerKey) cls.push('attacked');
    if (isEnemyTarget) cls.push('enemy-target');

    const imgUrl = cardImgUrl(c);
    const img = imgUrl
      ? `<img src="${imgUrl}" alt="" draggable="false" style="pointer-events:none;user-select:none;-webkit-user-drag:none;" />`
      : `<div style="width:100%;height:100%;background:#222;display:flex;justify-content:center;align-items:center;font-size:9px;text-align:center;padding:2px;">${c.name}</div>`;

    return `
      <div class="${cls.join(' ')}" data-inv="${invId}" data-owner="${ownerKey}">
        ${img}
        ${c.currentArmor > 0 ? `<div class="armor-badge">🛡${c.currentArmor}</div>` : ''}
        <div class="stat-row">
          <span class="atk">⚔${c.currentAtk}</span>
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
  container.querySelectorAll('.b-card').forEach(el => {
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
      ? `<img src="${imgUrl}" alt="" draggable="false" style="pointer-events:none;user-select:none;-webkit-user-drag:none;" />`
      : `<div style="width:100%;height:100%;background:#222;display:flex;justify-content:center;align-items:center;font-size:8px;text-align:center;padding:2px;">${c.name}</div>`;
    const stats = c.type === 'Персонаж'
      ? `<div class="hc-stats"><span class="atk">⚔${c.baseAtk}</span><span class="hp">❤${c.baseHp}</span></div>`
      : '';
    return `
      <div class="hand-card ${playable ? 'playable' : 'not-playable'}" data-inv="${invId}" title="${c.name}">
        ${img}
        <div class="cost">${c.cost}</div>
        ${stats}
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
  container.querySelectorAll('.hand-card').forEach(el => {
    el.onclick = () => {
      if (isHandDragging) return;
      const invId = parseInt(el.dataset.inv);
      if (!currentBattleState || currentBattleState.status !== 'active') return;
      if (currentBattleState.currentTurnPlayer !== currentPlayerKey) { bShowToast('Сейчас не ваш ход'); return; }
      playCard(invId);
    };
  });
}

// ==================== ДЕЙСТВИЯ ====================

function onBoardCardClick(el, ownerKey) {
  if (!currentBattleState || currentBattleState.status !== 'active') return;
  if (currentBattleState.currentTurnPlayer !== currentPlayerKey) {
    bShowToast('Сейчас не ваш ход');
    return;
  }
  const invId = parseInt(el.dataset.inv);
  const st = currentBattleState;

  if (ownerKey === currentPlayerKey) {
    const c = st.cards[invId] || st.cards[String(invId)];
    if (!c || c.hasAttacked) { bShowToast('Эта карта уже атаковала'); return; }
    if (c.currentAtk <= 0) { bShowToast('У карты нет атаки'); return; }
    selectedAttacker = (selectedAttacker === invId) ? null : invId;
    renderBattle({ id: currentBattleId, playerKey: currentPlayerKey, status: st.status, state: st });
  } else {
    if (!selectedAttacker) { bShowToast('Сначала выберите атакующего'); return; }
    doAttack(selectedAttacker, invId);
  }
}

async function playCard(invId) {
  if (isActionInProgress) return;
  isActionInProgress = true;
  if (battlePollTimer) clearInterval(battlePollTimer);
  try {
    await apiFetch(`/api/battle/${currentBattleId}/play`, {
      method: 'POST', body: JSON.stringify({ inv_id: invId })
    });
  } catch (err) { bShowToast(err.message); }
  await fetchBattleState();
  isActionInProgress = false;
  if (battlePollTimer) clearInterval(battlePollTimer);
  battlePollTimer = setInterval(fetchBattleState, 2000);
}

async function doAttack(attackerId, targetId) {
  if (isActionInProgress) return;
  isActionInProgress = true;
  if (battlePollTimer) clearInterval(battlePollTimer);
  try {
    await apiFetch(`/api/battle/${currentBattleId}/attack`, {
      method: 'POST',
      body: JSON.stringify({ attacker_id: attackerId, target_id: targetId })
    });
    selectedAttacker = null;
  } catch (err) { bShowToast(err.message); }
  await fetchBattleState();
  isActionInProgress = false;
  if (battlePollTimer) clearInterval(battlePollTimer);
  battlePollTimer = setInterval(fetchBattleState, 2000);
}

async function attackPlayer() {
  if (!selectedAttacker) return;
  const oppKey = currentPlayerKey === 'p1' ? 'p2' : 'p1';
  const opp = currentBattleState[oppKey];
  if (opp.board.length > 0) { bShowToast('Сначала убейте всех персонажей соперника'); return; }
  await doAttack(selectedAttacker, 'player');
}

async function endTurn() {
  if (isActionInProgress) return;
  isActionInProgress = true;
  if (battlePollTimer) clearInterval(battlePollTimer);
  try {
    await apiFetch(`/api/battle/${currentBattleId}/end-turn`, { method: 'POST' });
    selectedAttacker = null;
  } catch (err) { bShowToast(err.message); }
  await fetchBattleState();
  isActionInProgress = false;
  if (battlePollTimer) clearInterval(battlePollTimer);
  battlePollTimer = setInterval(fetchBattleState, 2000);
}

// ==================== ТАЙМЕР ====================
function updateTimerDisplay() {
  const el = document.getElementById('b-timer');
  if (!el) return;
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

// ==================== СДАЧА ====================

function handleSurrender() {
  if (!currentBattleId || !currentBattleState) {
    bShowToast('Бой не найден');
    return;
  }
  if (currentBattleState.status !== 'active') {
    leaveBattle();
    return;
  }
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-text').textContent = 'Покинуть матч? Это будет засчитано как поражение.';
  modal.style.zIndex = '6000';
  modal.style.display = 'flex';

  document.getElementById('btn-confirm-ok').onclick = async () => {
    modal.style.display = 'none';
    try {
      await apiFetch(`/api/battle/${currentBattleId}/surrender`, { method: 'POST' });
    } catch (err) { bShowToast(err.message); }
    await fetchBattleState();
  };
  document.getElementById('btn-confirm-cancel').onclick = () => {
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
let isHandDragging = false;
let handDragStartX = 0;
let handScrollStart = 0;
let handDragActive = false;

function setupHandScroll() {
  const handEl = document.getElementById('b-hand');
  if (!handEl || handEl.dataset.scrollBound === '1') return;
  handEl.dataset.scrollBound = '1';

  // Мышью / touch — drag-to-scroll
  let pointerDown = false;
  let didDrag = false;

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return; // только ЛКМ
    pointerDown = true;
    didDrag = false;
    isHandDragging = false;
    handDragStartX = e.touches ? e.touches[0].clientX : e.clientX;
    handScrollStart = handEl.scrollLeft;
  };

  const onPointerMove = (e) => {
    if (!pointerDown) return;
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const dx = handDragStartX - cx;
    if (!isHandDragging && Math.abs(dx) > 5) {
      isHandDragging = true;
      didDrag = true;
      handEl.classList.add('dragging');
    }
    if (isHandDragging) {
      handEl.scrollLeft = handScrollStart + dx;
      if (e.cancelable) e.preventDefault();
    }
  };

  const onPointerUp = () => {
    pointerDown = false;
    handEl.classList.remove('dragging');
    // Даём клику отработать, если drag не случился
    setTimeout(() => { isHandDragging = false; }, 30);
  };

  handEl.addEventListener('mousedown', onPointerDown);
  handEl.addEventListener('touchstart', onPointerDown, { passive: true });
  document.addEventListener('mousemove', onPointerMove);
  document.addEventListener('touchmove', onPointerMove, { passive: false });
  document.addEventListener('mouseup', onPointerUp);
  document.addEventListener('touchend', onPointerUp);

  // Захватываем click на карточке, если был drag — отменяем
  handEl.addEventListener('click', (e) => {
    if (didDrag || isHandDragging) {
      e.stopPropagation();
      e.preventDefault();
      didDrag = false;
    }
  }, true);

  // Колесо мыши → горизонтальный скролл
  handEl.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      handEl.scrollLeft += e.deltaY;
    }
  }, { passive: false });
}

// Стрелки ← →
document.addEventListener('keydown', (e) => {
  const battleScreen = document.getElementById('battle-screen');
  if (!battleScreen || !battleScreen.classList.contains('active')) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const handEl = document.getElementById('b-hand');
    if (!handEl) return;
    e.preventDefault();
    handEl.scrollLeft += (e.key === 'ArrowLeft' ? -120 : 120);
  }
});

// ==================== ПРИВЯЗКА СОБЫТИЙ ====================
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
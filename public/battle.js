// ==================== BATTLE CLIENT ====================

let currentBattleId = null;
let currentBattleState = null;
let currentPlayerKey = null;
let battlePollTimer = null;
let selectedAttacker = null;
let battleRenderedKey = '';

function bShowToast(msg, ok = false) {
  if (typeof showToast === 'function') showToast(msg, ok);
  else console.log(msg);
}

function joinBattle(battleId) {
  if (currentBattleId === battleId) return;
  currentBattleId = battleId;
  currentBattleState = null;
  selectedAttacker = null;
  battleRenderedKey = '';

  document.getElementById('battle-screen').classList.add('active');
  document.getElementById('b-result').classList.remove('active');
  document.getElementById('b-hand').innerHTML = '';

  fetchBattleState();
  if (battlePollTimer) clearInterval(battlePollTimer);
  battlePollTimer = setInterval(fetchBattleState, 1500);
}

function leaveBattle() {
  if (battlePollTimer) { clearInterval(battlePollTimer); battlePollTimer = null; }
  document.getElementById('battle-screen').classList.remove('active');
  document.getElementById('b-result').classList.remove('active');
  currentBattleId = null;
  currentBattleState = null;
  selectedAttacker = null;
  battleRenderedKey = '';
}

async function fetchBattleState() {
  if (!currentBattleId) return;
  try {
    const res = await apiFetch(`/api/battle/${currentBattleId}`);
    currentBattleState = res.battle.state;
    currentPlayerKey = res.battle.playerKey;
    renderBattle(res.battle);
  } catch (err) {
    console.error('fetchBattle:', err);
    if (err.message && err.message.includes('не найден')) leaveBattle();
  }
}

function cardImgUrl(card) {
  if (card.image_url) return `/img/cards/${card.image_url}`;
  return null;
}

function renderBattle(battle) {
  const st = battle.state;
  const myKey = battle.playerKey;
  const oppKey = myKey === 'p1' ? 'p2' : 'p1';
  const me = st[myKey], opp = st[oppKey];
  const myTurn = st.currentTurnPlayer === myKey;

  // Header
  document.getElementById('b-opp-avatar').src = opp.player?.avatar_url || '';
  document.getElementById('b-opp-nick').textContent = opp.player?.nickname || 'Соперник';
  document.getElementById('b-opp-sub').textContent = `🃏 ${opp.handCount ?? opp.hand.length} карт в руке`;
  document.getElementById('b-opp-hp-bar').style.width = Math.max(0, (opp.hp / opp.maxHp) * 100) + '%';
  document.getElementById('b-opp-hp-text').textContent = `${Math.max(0, opp.hp)}/${opp.maxHp}`;

  document.getElementById('b-my-avatar').src = me.player?.avatar_url || '';
  document.getElementById('b-my-nick').textContent = me.player?.nickname || 'Вы';
  document.getElementById('b-my-hp-bar').style.width = Math.max(0, (me.hp / me.maxHp) * 100) + '%';
  document.getElementById('b-my-hp-text').textContent = `${Math.max(0, me.hp)}/${me.maxHp}`;

  document.getElementById('b-energy-val').textContent = `${me.energy}/${me.maxEnergy}`;
  const endBtn = document.getElementById('b-end-turn');
  endBtn.disabled = !myTurn || st.status !== 'active';

  // Boards
  renderBoard('b-opp-board', opp.board, st.cards, oppKey, myKey, myTurn);
  renderBoard('b-my-board', me.board, st.cards, myKey, oppKey, myTurn);
  renderHand(me.hand, st.cards, me.energy, myTurn, st.status === 'active');

  // Result
  if (st.status === 'finished') {
    showBattleResult(st.winner === myKey ? 'win' : (st.winner === null ? 'draw' : 'lose'));
  }

  // Turn indicator
  const badge = document.getElementById('b-turn-badge');
  const turnKey = `${st.currentTurnPlayer}-${st[st.currentTurnPlayer].turnNumber}-${battle.id}`;
  if (turnKey !== battleRenderedKey && st.status === 'active') {
    battleRenderedKey = turnKey;
    badge.textContent = myTurn ? 'ВАШ ХОД' : 'ХОД СОПЕРНИКА';
    badge.classList.remove('show');
    void badge.offsetWidth;
    badge.classList.add('show');
  }
}

function renderBoard(containerId, boardInvIds, cards, ownerKey, otherKey, myTurn) {
  const container = document.getElementById(containerId);
  if (!boardInvIds || boardInvIds.length === 0) {
    container.innerHTML = `<div class="b-board-empty">${ownerKey === currentPlayerKey ? 'Ваш стол пуст' : 'Стол соперника пуст'}</div>`;
    return;
  }

  container.innerHTML = boardInvIds.map(invId => {
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
    const img = imgUrl ? `<img src="${imgUrl}" alt="" />`
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

  container.querySelectorAll('.b-card').forEach(el => {
    el.onclick = () => onBoardCardClick(el, ownerKey);
  });
}

function onBoardCardClick(el, ownerKey) {
  if (!currentBattleState || currentBattleState.status !== 'active') return;
  if (currentBattleState.currentTurnPlayer !== currentPlayerKey) {
    bShowToast('Сейчас не ваш ход');
    return;
  }
  const invId = parseInt(el.dataset.inv);
  const st = currentBattleState;
  const me = st[currentPlayerKey];
  const opp = st[currentPlayerKey === 'p1' ? 'p2' : 'p1'];

  if (ownerKey === currentPlayerKey) {
    // Свой персонаж — выбрать/снять
    const c = st.cards[invId] || st.cards[String(invId)];
    if (!c || c.hasAttacked) { bShowToast('Эта карта уже атаковала'); return; }
    if (c.currentAtk <= 0) { bShowToast('У карты нет атаки'); return; }
    selectedAttacker = (selectedAttacker === invId) ? null : invId;
    renderBattleFromCache();
  } else {
    // Цель
    if (!selectedAttacker) { bShowToast('Сначала выберите атакующего'); return; }
    doAttack(selectedAttacker, invId);
  }
}

function renderBattleFromCache() {
  if (!currentBattleState) return;
  renderBattle({
    id: currentBattleId,
    playerKey: currentPlayerKey,
    status: currentBattleState.status,
    state: currentBattleState
  });
}

function renderHand(hand, cards, energy, myTurn, active) {
  const container = document.getElementById('b-hand');
  if (!hand || hand.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = hand.map(invId => {
    const c = cards[invId] || cards[String(invId)];
    if (!c) return '';
    const playable = active && myTurn && c.cost <= energy;
    const imgUrl = cardImgUrl(c);
    const img = imgUrl ? `<img src="${imgUrl}" alt="" />`
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

  container.querySelectorAll('.hand-card').forEach(el => {
    el.onclick = () => {
      const invId = parseInt(el.dataset.inv);
      if (!currentBattleState || currentBattleState.status !== 'active') return;
      if (currentBattleState.currentTurnPlayer !== currentPlayerKey) { bShowToast('Сейчас не ваш ход'); return; }
      playCard(invId);
    };
  });
}

async function playCard(invId) {
  try {
    await apiFetch(`/api/battle/${currentBattleId}/play`, {
      method: 'POST', body: JSON.stringify({ inv_id: invId })
    });
    await fetchBattleState();
  } catch (err) { bShowToast(err.message); }
}

async function doAttack(attackerId, targetId) {
  try {
    await apiFetch(`/api/battle/${currentBattleId}/attack`, {
      method: 'POST',
      body: JSON.stringify({ attacker_id: attackerId, target_id: targetId })
    });
    selectedAttacker = null;
    await fetchBattleState();
  } catch (err) { bShowToast(err.message); }
}

async function attackPlayer() {
  if (!selectedAttacker) return;
  const oppKey = currentPlayerKey === 'p1' ? 'p2' : 'p1';
  const opp = currentBattleState[oppKey];
  if (opp.board.length > 0) { bShowToast('Сначала убейте всех персонажей соперника'); return; }
  await doAttack(selectedAttacker, 'player');
}

async function endTurn() {
  try {
    await apiFetch(`/api/battle/${currentBattleId}/end-turn`, { method: 'POST' });
    selectedAttacker = null;
    await fetchBattleState();
  } catch (err) { bShowToast(err.message); }
}

async function surrender() {
  if (!confirm) return;
  // Кастомная модалка подтверждения
  document.getElementById('confirm-text').textContent = 'Вы уверены, что хотите сдаться?';
  document.getElementById('confirm-modal').style.display = 'flex';
  document.getElementById('btn-confirm-ok').onclick = async () => {
    document.getElementById('confirm-modal').style.display = 'none';
    try {
      await apiFetch(`/api/battle/${currentBattleId}/surrender`, { method: 'POST' });
      await fetchBattleState();
    } catch (err) { bShowToast(err.message); }
  };
  document.getElementById('btn-confirm-cancel').onclick = () => {
    document.getElementById('confirm-modal').style.display = 'none';
  };
}

function showBattleResult(kind) {
  const overlay = document.getElementById('b-result');
  const title = document.getElementById('b-result-title');
  overlay.classList.add('active');
  if (kind === 'win') { title.textContent = '🏆 ПОБЕДА'; title.className = 'win'; }
  else if (kind === 'lose') { title.textContent = '💀 ПОРАЖЕНИЕ'; title.className = 'lose'; }
  else { title.textContent = 'НИЧЬЯ'; title.className = 'draw'; }
}

// Привязка событий
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('b-end-turn').onclick = endTurn;
  document.getElementById('b-surrender').onclick = surrender;
  document.getElementById('b-result-back').onclick = leaveBattle;

  // Клик по HP соперника — атака героя
  const oppInfoEl = document.querySelectorAll('.b-info')[0];
  if (oppInfoEl) {
    oppInfoEl.style.cursor = 'pointer';
    oppInfoEl.onclick = () => attackPlayer();
  }
});

window.joinBattle = joinBattle;
window.leaveBattle = leaveBattle;
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CARD_EFFECTS_IMPLEMENTED,
  CARD_TARGETS,
  UNTARGETABLE,
  makeCardState,
  canPlayCard,
  spendCardEnergy,
  startTurn,
  applyCardEffect,
  applyDamage,
  resolveAttack,
  isNegativeTargetProtected,
  removeDead
} from '../battle-engine.js';

const cardRows = JSON.parse(readFileSync(new URL('./fixtures/cards.json', import.meta.url), 'utf8'));
const rowByName = new Map(cardRows.map(row => [row.name, row]));

function newPlayer() {
  return {
    hp: 30, maxHp: 30, energy: 10, maxEnergy: 10,
    hand: [], board: [], turnNumber: 0,
    heroShield: false, skipMagicPhase: false, skipNextMagicPhase: false
  };
}

function newGame() {
  return {
    p1: newPlayer(),
    p2: newPlayer(),
    cards: {},
    status: 'active',
    currentTurnPlayer: 'p1',
    turnCounter: 1,
    turnStartedAt: Date.now(),
    log: []
  };
}

function makeCard(name, invId, ownerKey, overrides = {}) {
  const row = rowByName.get(name);
  assert.ok(row, 'Neon card not found: ' + name);
  return { ...makeCardState({ ...row, inv_id: invId }, ownerKey), ...overrides };
}

function addBoardCard(state, ownerKey, name, invId, overrides = {}) {
  const card = makeCard(name, invId, ownerKey, overrides);
  state.cards[invId] = card;
  state[ownerKey].board.push(invId);
  return card;
}

function addDiscardedCard(state, ownerKey, name, invId, discardedAt = invId) {
  const card = makeCard(name, invId, ownerKey, { discarded: true, discardedAt });
  state.cards[invId] = card;
  return card;
}

function playEffect(state, ownerKey, name, targetId = null) {
  const invId = 10000 + rowByName.get(name).id;
  const card = makeCard(name, invId, ownerKey);
  state.cards[invId] = card;
  const opponentKey = ownerKey === 'p1' ? 'p2' : 'p1';
  applyCardEffect(state, ownerKey, opponentKey, card, targetId);
  return card;
}

test('Neon catalogue: every non-empty effect description has an engine handler', () => {
  assert.equal(cardRows.length, 40);
  for (const row of cardRows) {
    assert.ok(Number.isInteger(row.energy) && row.energy >= 0, row.name + ' must have a valid Energy');
    if (row.description.trim() !== 'Без эффектов.') {
      assert.ok(CARD_EFFECTS_IMPLEMENTED.has(row.name), 'Missing handler for: ' + row.name);
    }
  }
});

test('Energy uses cards.energy exactly, including zero-energy cards', () => {
  const p = newPlayer();
  p.energy = 5;
  const cost7 = makeCard('Архитектор реальности', 501, 'p1');
  const cost1 = makeCard('Гоблин-вор', 502, 'p1');
  const cost0 = makeCard('Кровавый ритуал', 503, 'p1');
  assert.equal(cost7.energyCost, 7);
  assert.equal(cost7.cost, 7);
  assert.equal(canPlayCard(p, cost7), false);
  assert.equal(canPlayCard(p, cost1), true);
  assert.equal(cost0.energyCost, 0);
  assert.equal(canPlayCard({ ...p, energy: 0 }, cost0), true);
  assert.equal(canPlayCard({ ...p, energy: 7 }, cost7), true);

  const exactPlayer = { ...p, energy: 7 };
  assert.equal(spendCardEnergy(exactPlayer, cost7), 0);
  assert.equal(exactPlayer.energy, 0);

  const zeroPlayer = { ...p, energy: 0 };
  assert.equal(spendCardEnergy(zeroPlayer, cost0), 0);
  assert.equal(zeroPlayer.energy, 0);
  assert.throws(() => spendCardEnergy({ ...p, energy: 5 }, cost7), /Недостаточно энергии/);
});

test('A 0-energy spell resolves without spending energy and grants its described energy', () => {
  const state = newGame();
  state.p1.energy = 0;
  state.p1.hp = 20;
  const ritual = makeCard('Кровавый ритуал', 610, 'p1');
  assert.equal(canPlayCard(state.p1, ritual), true);
  state.p1.energy -= ritual.energyCost;
  playEffect(state, 'p1', 'Кровавый ритуал');
  assert.equal(state.p1.hp, 17);
  assert.equal(state.p1.energy, 3);
});

test('Взрывная волна damages every character on both players boards', () => {
  const state = newGame();
  const ally = addBoardCard(state, 'p1', 'Скелет-воин', 11, { currentHp: 6, currentArmor: 0 });
  const enemy = addBoardCard(state, 'p2', 'Гоблин-вор', 21, { currentHp: 6, currentArmor: 0 });
  playEffect(state, 'p1', 'Взрывная волна');
  assert.equal(ally.currentHp, 4);
  assert.equal(enemy.currentHp, 4);
});

test('Взрывная волна ignores armor and removes exactly 2 HP', () => {
  const state = newGame();
  const ally = addBoardCard(state, 'p1', 'Скелет-воин', 12, { currentHp: 6, currentArmor: 3 });
  const enemy = addBoardCard(state, 'p2', 'Гоблин-вор', 22, { currentHp: 6, currentArmor: 1 });
  playEffect(state, 'p1', 'Взрывная волна');
  assert.equal(ally.currentHp, 4);
  assert.equal(ally.currentArmor, 3);
  assert.equal(enemy.currentHp, 4);
  assert.equal(enemy.currentArmor, 1);
});

test('Волшебная фея heals its owner by exactly 2 HP', () => {
  const state = newGame();
  state.p1.hp = 20;
  playEffect(state, 'p1', 'Волшебная фея');
  assert.equal(state.p1.hp, 22);
});

test('Архитектор реальности returns one latest discarded card to its owner', () => {
  const state = newGame();
  addDiscardedCard(state, 'p1', 'Скелет-воин', 31, 10);
  addDiscardedCard(state, 'p1', 'Отравленный клинок', 32, 20);
  addDiscardedCard(state, 'p2', 'Гоблин-вор', 33, 30);
  playEffect(state, 'p1', 'Архитектор реальности');
  assert.deepEqual(state.p1.hand, [32]);
  assert.equal(state.cards[32].discarded, false);
  assert.equal(state.cards[31].discarded, true);
  assert.deepEqual(state.p2.hand, []);
});

test('Король-мертвец returns two characters only, not spells or opponent cards', () => {
  const state = newGame();
  addDiscardedCard(state, 'p1', 'Скелет-воин', 41, 10);
  addDiscardedCard(state, 'p1', 'Гоблин-вор', 42, 20);
  addDiscardedCard(state, 'p1', 'Отравленный клинок', 43, 30);
  addDiscardedCard(state, 'p2', 'Гоблин-вор', 44, 40);
  playEffect(state, 'p1', 'Король-мертвец');
  assert.deepEqual(state.p1.hand, [42, 41]);
  assert.equal(state.cards[43].discarded, true);
  assert.equal(state.cards[44].discarded, true);
});

test('Абсолютное безумие removes 3 hero HP and discards one random opponent card', () => {
  const state = newGame();
  const enemyCard = makeCard('Гоблин-вор', 51, 'p2');
  state.cards[51] = enemyCard;
  state.p2.hand = [51];
  const oldRandom = Math.random;
  Math.random = () => 0;
  try {
    playEffect(state, 'p1', 'Абсолютное безумие');
  } finally {
    Math.random = oldRandom;
  }
  assert.equal(state.p2.hp, 27);
  assert.deepEqual(state.p2.hand, []);
  assert.equal(enemyCard.discarded, true);
});

test('Кража разума skips the opponent next magic phase only', () => {
  const state = newGame();
  playEffect(state, 'p1', 'Кража разума');
  assert.equal(state.p2.skipNextMagicPhase, true);
  startTurn(state, 'p2');
  assert.equal(state.p2.skipMagicPhase, true);
  assert.equal(canPlayCard(state.p2, makeCard('Гоблин-вор', 61, 'p2')), false);
  startTurn(state, 'p1');
  startTurn(state, 'p2');
  assert.equal(state.p2.skipMagicPhase, false);
  assert.equal(canPlayCard(state.p2, makeCard('Гоблин-вор', 62, 'p2')), true);
});

test('Огненный маг immunity uses the shared global turn counter', () => {
  const state = newGame();
  state.turnCounter = 5;
  const mage = addBoardCard(state, 'p1', 'Огненный маг', 71);
  applyCardEffect(state, 'p1', 'p2', mage, mage.invId);
  assert.equal(mage.immuneNegativeUntilTurn, 8);
  for (const turn of [6, 7, 8]) {
    state.turnCounter = turn;
    assert.equal(isNegativeTargetProtected(state, mage, 'p2'), true);
  }
  state.turnCounter = 9;
  assert.equal(isNegativeTargetProtected(state, mage, 'p2'), false);
});

test('Временной скачок grants a full extra turn with energy and attack reset', () => {
  const state = newGame();
  state.p1.energy = 4;
  state.p1.turnNumber = 2;
  state.turnCounter = 4;
  const unit = addBoardCard(state, 'p1', 'Скелет-воин', 81, { hasAttacked: true });
  playEffect(state, 'p1', 'Временной скачок');
  assert.equal(state.p1.energy, 5);
  assert.equal(state.p1.turnNumber, 3);
  assert.equal(state.turnCounter, 5);
  assert.equal(unit.hasAttacked, false);
  assert.equal(state.currentTurnPlayer, 'p1');
});

test('Древний голем forces attacks to target it while alive', () => {
  const state = newGame();
  const attacker = addBoardCard(state, 'p1', 'Скелет-воин', 91, { currentAtk: 4 });
  const golem = addBoardCard(state, 'p2', 'Древний голем', 92, { currentHp: 12, currentArmor: 0 });
  const other = addBoardCard(state, 'p2', 'Гоблин-вор', 93, { currentHp: 6, currentArmor: 0 });
  assert.throws(() => resolveAttack(state, 'p1', 'p2', 91, 93), /Древнего голема/);
  resolveAttack(state, 'p1', 'p2', 91, 92);
  assert.equal(golem.currentHp, 8);
  assert.equal(other.currentHp, 6);
  assert.equal(attacker.hasAttacked, true);
});

test('Оборотень heals 2 HP when it attacks; Пожиратель душ gains +2 attack on kill', () => {
  const state = newGame();
  const werewolf = addBoardCard(state, 'p1', 'Оборотень', 101, { currentHp: 4, maxHp: 9, currentAtk: 4 });
  addBoardCard(state, 'p2', 'Скелет-воин', 102, { currentHp: 8, currentArmor: 0 });
  resolveAttack(state, 'p1', 'p2', 101, 102);
  assert.equal(werewolf.currentHp, 6);

  const second = newGame();
  const eater = addBoardCard(second, 'p1', 'Пожиратель душ', 103, { currentAtk: 6 });
  addBoardCard(second, 'p2', 'Гоблин-вор', 104, { currentHp: 2, currentArmor: 0 });
  resolveAttack(second, 'p1', 'p2', 103, 104);
  assert.equal(eater.currentAtk, 8);
  assert.equal(second.p2.board.length, 0);
});

test('Щит хаоса absorbs one hero hit and is then removed', () => {
  const state = newGame();
  playEffect(state, 'p1', 'Щит хаоса');
  const attacker = addBoardCard(state, 'p2', 'Скелет-воин', 111, { currentAtk: 3 });
  resolveAttack(state, 'p2', 'p1', 111, 'player');
  assert.equal(state.p1.hp, 30);
  assert.equal(state.p1.heroShield, false);
  assert.equal(attacker.hasAttacked, true);
});

test('Космо-Феникс revives once with 5 HP, then can die normally', () => {
  const state = newGame();
  const phoenix = addBoardCard(state, 'p1', 'Космо-Феникс', 121, { currentHp: 0 });
  removeDead(state, 'p1', 121);
  assert.equal(phoenix.currentHp, 5);
  assert.equal(phoenix.hasRevived, true);
  assert.deepEqual(state.p1.board, [121]);
  phoenix.currentHp = 0;
  removeDead(state, 'p1', 121);
  assert.deepEqual(state.p1.board, []);
  assert.equal(phoenix.discarded, true);
});

test('Dragon of Abyss and Unicorn are protected from negative-card targeting', () => {
  assert.deepEqual(UNTARGETABLE, ['Дракон Бездны', 'Единорог']);
});

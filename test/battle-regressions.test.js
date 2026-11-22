import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCardEffect, resolveAttack } from '../battle-engine.js';

function makeState() {
  const attacker = {
    invId: 1, name: 'Атакующий', currentAtk: 5, currentHp: 5,
    currentArmor: 0, maxHp: 5, hasAttacked: false
  };
  const ownTarget = {
    invId: 2, name: 'Защитник', currentAtk: 1, currentHp: 8,
    currentArmor: 4, maxHp: 8, hasAttacked: false
  };
  const enemyTarget = {
    invId: 3, name: 'Враг', currentAtk: 1, currentHp: 8,
    currentArmor: 3, maxHp: 8, hasAttacked: false
  };
  return {
    status: 'active',
    winner: null,
    log: [],
    turnCounter: 1,
    cards: { 1: attacker, 2: ownTarget, 3: enemyTarget },
    p1: { hp: 30, maxHp: 30, board: [2], hand: [], energy: 5 },
    p2: { hp: 30, maxHp: 30, board: [1, 3], hand: [], energy: 5 }
  };
}

test('Взрывная волна снимает ровно 2 HP и игнорирует броню', () => {
  const state = makeState();
  applyCardEffect(state, 'p1', 'p2', { name: 'Взрывная волна' });
  assert.equal(state.cards[2].currentHp, 6);
  assert.equal(state.cards[3].currentHp, 6);
  assert.equal(state.cards[2].currentArmor, 4);
  assert.equal(state.cards[3].currentArmor, 3);
});

test('Щит хаоса блокирует следующую атаку по персонажу целиком', () => {
  const state = makeState();
  applyCardEffect(state, 'p1', 'p2', { name: 'Щит хаоса' });
  resolveAttack(state, 'p2', 'p1', 1, 2);
  assert.equal(state.cards[2].currentHp, 8);
  assert.equal(state.p1.heroShield, false);
  assert.equal(state.cards[1].hasAttacked, true);
});

test('Щит хаоса блокирует следующую атаку по герою', () => {
  const state = makeState();
  state.p1.board = [];
  applyCardEffect(state, 'p1', 'p2', { name: 'Щит хаоса' });
  resolveAttack(state, 'p2', 'p1', 1, 'player');
  assert.equal(state.p1.hp, 30);
  assert.equal(state.p1.heroShield, false);
  assert.equal(state.cards[1].hasAttacked, true);
});

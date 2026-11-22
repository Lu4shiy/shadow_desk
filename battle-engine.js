export function makeCardState(c, ownerKey) {
  return {
    invId: c.inv_id,
    cardId: c.id,
    name: c.name,
    type: c.type,
    rarity: c.rarity,
    description: c.description,
    image_url: c.image_url,
    energyCost: Number(c.energy),
    cost: Number(c.energy),
    ownerKey,
    baseAtk: c.atk || 0,
    baseArmor: c.armor || 0,
    baseHp: c.hp || 0,
    currentAtk: c.atk || 0,
    currentArmor: c.armor || 0,
    currentHp: c.hp || 0,
    maxHp: c.hp || 0,
    hasAttacked: false,
    discarded: false
  };
}

export function startTurn(state, playerKey) {
  const p = state[playerKey];
  p.turnNumber = (Number(p.turnNumber) || 0) + 1;
  state.turnCounter = (Number(state.turnCounter) || 0) + 1;
  p.skipMagicPhase = p.skipNextMagicPhase === true;
  p.skipNextMagicPhase = false;
  p.maxEnergy = 10;
  const prev = Number.isFinite(p.energy) ? p.energy : 0;
  p.energy = Math.min(10, prev + 1);
  p.board.forEach(invId => {
    const c = state.cards[invId] || state.cards[String(invId)];
    if (!c) return;
    c.hasAttacked = false;
    // Лесной тролль лечит 1 HP в начале хода
    if (c.name === 'Лесной тролль' && c.currentHp > 0) {
      c.currentHp = Math.min(c.maxHp, c.currentHp + 1);
    }
  });
  state.currentTurnPlayer = playerKey;
  state.turnStartedAt = Date.now();
  state.log.push(`Ход ${playerKey === 'p1' ? 'Игрока 1' : 'Игрока 2'} — энергия ${p.energy}`);
  if (state.log.length > 30) state.log = state.log.slice(-30);
}

export function applyDamage(card, dmg) {
  const damage = Math.max(0, Number(dmg) || 0);
  const armor = Math.max(0, Number(card.currentArmor) || 0);
  const hpDamage = Math.max(0, damage - armor);
  if (hpDamage > 0) card.currentHp -= hpDamage;
  return hpDamage;
}
export function canPlayCard(player, card) {
  const cost = Number(card?.energyCost ?? card?.cost);
  return Boolean(player && card && player.skipMagicPhase !== true && Number.isFinite(cost) && cost >= 0 && Number(player.energy) >= cost);
}
export function isNegativeTargetProtected(state, target, casterKey) {
  if (!target) return false;
  if (target.immuneNegativeUntilTurn != null) return (Number(state.turnCounter) || 0) <= Number(target.immuneNegativeUntilTurn);
  if (target.immuneNegativeUntil != null) return (Number(state[casterKey]?.turnNumber) || 0) <= Number(target.immuneNegativeUntil);
  return false;
}

export function isBattleStarted(state) {
  if (state.countdownEnabled !== true) return true;
  const startsAt = Number(state.battleStartsAt);
  return Number.isFinite(startsAt) && startsAt > 0 && Date.now() >= startsAt;
}

export function checkBattleEnd(state) {
  if (state.p1.hp <= 0 && state.p2.hp <= 0) { state.status = 'finished'; state.winner = null; }
  else if (state.p1.hp <= 0) { state.status = 'finished'; state.winner = 'p2'; }
  else if (state.p2.hp <= 0) { state.status = 'finished'; state.winner = 'p1'; }
}

export const CARD_TARGETS = {
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

export const UNTARGETABLE = ['Дракон Бездны', 'Единорог'];

// applyDamage уже объявлен выше (в блоке БОЕВОЙ ДВИЖОК) — не дублируем!

export function removeDead(state, ownerKey, invId) {
  const owner = state[ownerKey];
  const card = state.cards[invId] || state.cards[String(invId)];
  if (!card || card.currentHp > 0) return;

  // Космо-Феникс: возрождается 1 раз с 5 HP
  if (card.name === 'Космо-Феникс' && !card.hasRevived) {
    card.hasRevived = true;
    card.currentHp = 5;
    state.log.push(`🔥 Космо-Феникс возрождается!`);
    return;
  }

  owner.board = owner.board.filter(id => Number(id) !== Number(invId));
  card.discarded = true;
  card.discardedAt = Date.now();
  state.log.push(`💀 ${card.name} погибает`);
}

export function healHero(player, amount) {
  player.hp = Math.min(player.maxHp, player.hp + amount);
}

export function returnDiscardedCards(state, playerKey, count, charactersOnly = false) {
  const player = state[playerKey];
  if (!player || !Array.isArray(player.hand)) return [];
  const items = Object.entries(state.cards || {}).filter(([,c]) => c && c.ownerKey === playerKey && c.discarded && (!charactersOnly || c.type === 'Персонаж')).sort((a,b)=>(Number(b[1].discardedAt)||0)-(Number(a[1].discardedAt)||0)).slice(0,Math.max(0,Number(count)||0));
  const returned=[];
  for(const [id,c] of items) {
    const invId=Number(c.invId ?? id);
    if(player.hand.some(x=>Number(x)===invId)) continue;
    c.discarded=false; delete c.discardedAt;
    c.currentAtk=Number(c.baseAtk)||0; c.currentArmor=Number(c.baseArmor)||0; c.currentHp=Number(c.maxHp ?? c.baseHp)||0;
    c.hasAttacked=false; delete c.immuneNegativeUntilTurn;
    player.hand.push(invId); returned.push(c); state.log.push(`♻️ ${c.name} возвращается из сброса в руку`);
  }
  return returned;
}
function extraTurn(state, playerKey) {
  startTurn(state, playerKey);
  state.log.push('⏳ Временной скачок! Вы получаете дополнительный ход');
}

export function resolveAttack(state, playerKey, oppKey, attackerIdRaw, targetRaw) {
  const player=state[playerKey], opponent=state[oppKey];
  const attackerId=Number.parseInt(attackerIdRaw,10);
  const attacker=state.cards[attackerId]||state.cards[String(attackerId)];
  const fail=message=>{const error=new Error(message);error.statusCode=400;throw error;};
  if(!attacker||!player.board.map(Number).includes(attackerId))fail('Атакующий не на столе');
  if(attacker.hasAttacked)fail('Эта карта уже атаковала');
  if(attacker.currentAtk<=0)fail('Нет атаки');
  const taunts=opponent.board.map(Number).filter(id=>{const c=state.cards[id]||state.cards[String(id)];return c&&c.name==='Древний голем'&&c.currentHp>0;});
  if(targetRaw==='player'){
    if(opponent.board.length>0)fail('Сначала убейте всех персонажей соперника');
    if(taunts.length)fail('Сначала убейте Древнего голема');
    if(opponent.heroShield){opponent.heroShield=false;state.log.push(`🛡 Щит хаоса поглощает ${attacker.currentAtk} урона`);}
    else{opponent.hp-=attacker.currentAtk;state.log.push(`${attacker.name} бьёт игрока на ${attacker.currentAtk}`);}
    attacker.hasAttacked=true;
  } else {
    const targetId=Number.parseInt(targetRaw,10);
    const target=state.cards[targetId]||state.cards[String(targetId)];
    if(!target||!opponent.board.map(Number).includes(targetId))fail('Цель не найдена');
    if(taunts.length&&!taunts.includes(targetId))fail('Сначала убейте Древнего голема');
    const dealt=applyDamage(target,attacker.currentAtk);attacker.hasAttacked=true;
    if(attacker.name==='Оборотень'&&attacker.currentHp>0){attacker.currentHp=Math.min(attacker.maxHp,attacker.currentHp+2);state.log.push('🐺 Оборотень лечится на 2 HP');}
    if(target.currentHp<=0&&attacker.name==='Пожиратель душ'){attacker.currentAtk+=2;state.log.push('👻 Пожиратель душ поглощает душу: +2 атаки');}
    if(dealt===0)state.log.push(`🛡 ${target.name} полностью защищён бронёй`);
    removeDead(state,oppKey,targetId);removeDead(state,playerKey,attackerId);
  }
  checkBattleEnd(state);return {success:true};
}

export function applyCardEffect(state, playerKey, oppKey, card, targetId) {
  const me = state[playerKey];
  const opp = state[oppKey];
  const getCard = (id) => state.cards[id] || state.cards[String(id)];
  const target = targetId ? getCard(targetId) : null;

  switch (card.name) {
    // ===== GREY =====
    case 'Скелет-воин':
    case 'Гоблин-вор':
    case 'Кот-фамильяр':
    case 'Сырный воришка':
      return;

    case 'Каменная кожа': {
      if (!target) return;
      target.currentArmor += 3;
      state.log.push(`${target.name} получает +3 брони`);
      return;
    }
    case 'Отравленный клинок': {
      if (!target) return;
      applyDamage(target, 4);
      state.log.push(`${target.name} получает 4 урона`);
      if (target.currentHp <= 0) removeDead(state, oppKey, target.invId);
      return;
    }
    case 'Шёпот теней': {
      me.energy = Math.min(10, me.energy + 2);
      state.log.push(`+2 энергии`);
      return;
    }
    case 'Исцеляющий отвар': {
      if (!target) return;
      healCard(target, 4);
      state.log.push(`${target.name} лечится на 4 HP`);
      return;
    }
    case 'Теневой сгусток': {
      if (!target) return;
      applyDamage(target, 2);
      state.log.push(`${target.name} получает 2 урона`);
      if (target.currentHp <= 0) removeDead(state, oppKey, target.invId);
      return;
    }

    // ===== PURPLE =====
    case 'Лесной тролль':
      return; // пассив обрабатывается в startTurn

    case 'Тёмный жрец': {
      if (!target) return;
      healCard(target, 3);
      state.log.push(`${target.name} лечится на 3 HP`);
      return;
    }
    case 'Проклятие слабости': {
      if (!target) return;
      target.currentAtk = Math.max(0, target.currentAtk - 2);
      state.log.push(`${target.name} теряет 2 урона`);
      return;
    }
    case 'Взрывная волна': {
      for (const ownerKey of [playerKey, oppKey]) {
        [...state[ownerKey].board].forEach(id => {
          const target = getCard(id);
          if (!target) return;
          const dealt = applyDamage(target, 2);
          state.log.push(dealt > 0 ? `💥 ${target.name} теряет ${dealt} HP` : `🛡 ${target.name}: броня поглощает 2 урона`);
        });
      }
      [...me.board].forEach(id => removeDead(state, playerKey, id));
      [...opp.board].forEach(id => removeDead(state, oppKey, id));
      state.log.push('💥 Взрывная волна наносит 2 урона всем персонажам на обоих столах');
      return;
    }
    case 'Кровавый ритуал': {
      me.hp -= 3;
      me.energy = Math.min(10, me.energy + 3);
      state.log.push(`-3 HP герою, +3 энергии`);
      return;
    }
    case 'Сказочный гриб':
      return;
    case 'Волшебная фея': {
      healHero(me, 2);
      state.log.push('🧚 Волшебная фея лечит вас на 2 HP');
      return;
    }

    case 'Вампирский укус': {
      if (!target) return;
      applyDamage(target, 3);
      healHero(me, 3);
      state.log.push(`${target.name} получает 3 урона, вы лечитесь на 3`);
      if (target.currentHp <= 0) removeDead(state, oppKey, target.invId);
      return;
    }
    case 'Тёмное благословение': {
      if (!target) return;
      target.currentAtk += 2;
      state.log.push(`${target.name} получает +2 урона`);
      return;
    }

    // ===== ORANGE =====
    case 'Призрачный рыцарь':
      return;

    case 'Огненный маг': {
      const self = getCard(card.invId);
      if (self) self.immuneNegativeUntilTurn = (Number(state.turnCounter) || 0) + 3;
      state.log.push('Огненный маг защищён от негативных карт на 3 следующих хода');
      return;
    }
    case 'Щит хаоса': {
      me.heroShield = true;
      state.log.push(`🛡 Щит хаоса активирован`);
      return;
    }
    case 'Кража разума': {
      opp.skipNextMagicPhase = true;
      state.log.push('🧠 Кража разума: соперник пропустит фазу магии в следующий ход');
      return;
    }
    case 'Оборотень':
      return; // пассив в attack

    case 'Добрый дух': {
      healHero(me, 3);
      state.log.push(`+3 HP герою`);
      return;
    }
    case 'Удар души': {
      if (!target) return;
      applyDamage(target, 5);
      state.log.push(`${target.name} получает 5 урона`);
      if (target.currentHp <= 0) removeDead(state, oppKey, target.invId);
      return;
    }
    case 'Зеркальное отражение': {
      if (!target) return;
      target.currentArmor += 4;
      state.log.push(`${target.name} получает +4 брони`);
      return;
    }

    // ===== BLUE =====
    case 'Древний голем':
      return; // пассив (taunt) в attack

    case 'Пожиратель душ':
      return; // пассив в attack

    case 'Временной скачок': {
      extraTurn(state, playerKey);
      return;
    }

    case 'Единорог':
      return; // пассив

    case 'Кровавый договор': {
      me.hp -= 5;
      me.energy = Math.min(10, me.energy + 5);
      state.log.push(`-5 HP герою, +5 энергии`);
      return;
    }
    case 'Падающая звезда': {
      if (!target) return;
      applyDamage(target, 6);
      state.log.push(`${target.name} получает 6 урона`);
      if (target.currentHp <= 0) removeDead(state, oppKey, target.invId);
      return;
    }

    // ===== GOLD =====
    case 'Безумный клоун': {
      [...opp.board].forEach(id => {
        const c = getCard(id);
        if (c) {
          const dmg = Math.floor(Math.random() * 6) + 1;
          applyDamage(c, dmg);
          state.log.push(`🎭 Безумный клоун: ${dmg} урона ${c.name}`);
        }
      });
      [...opp.board].forEach(id => removeDead(state, oppKey, id));
      return;
    }
    case 'Архитектор реальности': {
      const returned = returnDiscardedCards(state, playerKey, 1, false);
      state.log.push(returned.length ? '🏛 Архитектор возвращает 1 карту из сброса' : '🏛 В сбросе нет карт для Архитектора');
      return;
    }

    case 'Дракон Бездны':
      return; // пассив

    case 'Облачный кит': {
      me.board.forEach(id => {
        const c = getCard(id);
        if (c) healCard(c, 4);
      });
      state.log.push('☁️ Облачный кит восстанавливает 4 HP всем вашим персонажам');
      return;
    }
    case 'Король-мертвец': {
      const returned = returnDiscardedCards(state, playerKey, 2, true);
      state.log.push(returned.length ? `👑 Король-мертвец возвращает ${returned.length} персонажей из сброса в руку` : '👑 В сбросе нет персонажей для Короля-мертвеца');
      return;
    }
    case 'Абсолютное безумие': {
      if (opp.heroShield) {
        opp.heroShield = false;
        state.log.push('🛡 Щит хаоса поглощает 3 урона Абсолютного безумия');
      } else {
        opp.hp -= 3;
        state.log.push('Противник теряет 3 HP');
      }
      if (opp.hand.length) {
        const index = Math.floor(Math.random() * opp.hand.length);
        const [discardId] = opp.hand.splice(index, 1);
        const discarded = getCard(discardId);
        if (discarded) {
          discarded.discarded = true;
          discarded.discardedAt = Date.now();
          state.log.push(`🗑 Противник сбрасывает карту: ${discarded.name}`);
        }
      }
      return;
    }
    case 'Апокалипсис': {
      [...me.board].forEach(id => {
        const c = getCard(id);
        if (c) c.currentHp = 0;
      });
      [...opp.board].forEach(id => {
        const c = getCard(id);
        if (c) c.currentHp = 0;
      });
      [...me.board].forEach(id => removeDead(state, playerKey, id));
      [...opp.board].forEach(id => removeDead(state, oppKey, id));
      state.log.push(`☄️ Апокалипсис уничтожает всех персонажей`);
      return;
    }

    case 'Космо-Феникс':
      return; // пассив в removeDead
  }
}

export const CARD_EFFECTS_IMPLEMENTED = new Set(["Каменная кожа","Отравленный клинок","Шёпот теней","Лесной тролль","Тёмный жрец","Проклятие слабости","Взрывная волна","Кровавый ритуал","Огненный маг","Щит хаоса","Кража разума","Древний голем","Пожиратель душ","Временной скачок","Безумный клоун","Архитектор реальности","Дракон Бездны","Исцеляющий отвар","Теневой сгусток","Волшебная фея","Вампирский укус","Тёмное благословение","Оборотень","Добрый дух","Удар души","Зеркальное отражение","Единорог","Кровавый договор","Падающая звезда","Облачный кит","Король-мертвец","Абсолютное безумие","Апокалипсис","Космо-Феникс"]);

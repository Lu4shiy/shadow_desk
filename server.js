import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

if (!BOT_TOKEN) console.warn('BOT_TOKEN is not set.');
if (!DATABASE_URL) console.warn('DATABASE_URL is not set.');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.query(`
  CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    nickname VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    age INTEGER NOT NULL,
    tutorial_done BOOLEAN DEFAULT FALSE,
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    crystals INTEGER DEFAULT 0,
    coins INTEGER DEFAULT 100,
    mana INTEGER DEFAULT 50,
    badge VARCHAR(50) DEFAULT NULL,
    avatar_url TEXT DEFAULT NULL
  )
`).catch(err => console.error('DB Init Error:', err));

pool.query(`
  CREATE TABLE IF NOT EXISTS friendships (
    id SERIAL PRIMARY KEY,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    friend_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(player_id, friend_id)
  )
`).catch(err => console.error('DB Init Error:', err));

pool.query(`
  CREATE TABLE IF NOT EXISTS battle_invites (
    id SERIAL PRIMARY KEY,
    from_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    to_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending',
    battle_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '10 minutes'
  )
`).catch(err => console.error('DB Init Error:', err));

// Миграция: стоимость карт
pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS cost INTEGER DEFAULT 1`).catch(()=>{});

// Таблица боёв
pool.query(`
  CREATE TABLE IF NOT EXISTS battles (
    id SERIAL PRIMARY KEY,
    player1_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    player2_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'active',
    winner_id INTEGER REFERENCES players(id),
    state JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )
`).catch(err => console.error('DB Init Error:', err));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(join(__dirname, 'public')));

const hashPassword = (pass) => crypto.createHash('sha256').update(pass).digest('hex');

// Надежная проверка initData напрямую через crypto
function validateTelegramData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('No hash provided');
  
  params.delete('hash');
  
  // Сортируем ключи по алфавиту и склеиваем
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (calculatedHash !== hash) {
    throw new Error('Неверная подпись. Проверь BOT_TOKEN на Render!');
  }

  const authDate = parseInt(params.get('auth_date'));
  const currentTime = Math.floor(Date.now() / 1000);
  
  // Даем 24 часа (86400 секунд) на тесты вместо 1 часа
  if (currentTime - authDate > 86400) {
    throw new Error('Данные устарели (прошло больше 24 часов)');
  }
  
  return true;
}

function telegramAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [authType, authData = ''] = authHeader.split(' ');

  if (authType !== 'tma' || !authData) {
    return res.status(401).json({ error: 'Unauthorized: missing initData' });
  }

  try {
    validateTelegramData(authData, BOT_TOKEN);
    next();
  } catch (err) {
    console.error('InitData validation failed:', err.message); // Это покажет точную причину в логах Render
    return res.status(403).json({ error: 'Invalid initData', details: err.message });
  }
}

async function playerAuth(req, res, next) {
  const playerId = req.headers['x-player-id'];
  if (!playerId) return res.status(401).json({ error: 'Не авторизован' });

  try {
    const result = await pool.query('SELECT * FROM players WHERE id = $1', [playerId]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Аккаунт не найден' });
    req.player = result.rows[0];
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

app.post('/api/register', telegramAuth, async (req, res) => {
  const { nickname, password, age, tutorialDone } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO players (nickname, password_hash, age, tutorial_done) VALUES ($1, $2, $3, $4) RETURNING id, nickname, level, xp, crystals, coins, mana, avatar_url',
      [nickname, hashPassword(password), age, tutorialDone]
    );
    res.json({ success: true, profile: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Этот никнейм уже занят' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', telegramAuth, async (req, res) => {
  const { nickname, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM players WHERE nickname = $1', [nickname]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Аккаунт не найден' });
    
    const player = result.rows[0];
    if (player.password_hash !== hashPassword(password)) {
      return res.status(400).json({ error: 'Неверный пароль' });
    }
    
    delete player.password_hash;
    res.json({ success: true, profile: player });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/me', telegramAuth, playerAuth, (req, res) => {
  const player = req.player;
  delete player.password_hash;
  res.json({ success: true, profile: player });
});

app.put('/api/profile/nickname', telegramAuth, playerAuth, async (req, res) => {
  const { nickname } = req.body;
  try {
    const result = await pool.query(
      'UPDATE players SET nickname = $1 WHERE id = $2 RETURNING nickname',
      [nickname.trim(), req.player.id]
    );
    res.json({ success: true, profile: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Этот никнейм уже занят' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/profile/password', telegramAuth, playerAuth, async (req, res) => {
  const { newPassword } = req.body;
  try {
    await pool.query('UPDATE players SET password_hash = $1 WHERE id = $2', [hashPassword(newPassword), req.player.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/profile/avatar', telegramAuth, playerAuth, async (req, res) => {
  const { avatarBase64 } = req.body;
  try {
    const result = await pool.query(
      'UPDATE players SET avatar_url = $1 WHERE id = $2 RETURNING avatar_url',
      [avatarBase64, req.player.id]
    );
    res.json({ success: true, avatar_url: result.rows[0].avatar_url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получить инвентарь игрока
app.get('/api/inventory', telegramAuth, playerAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT inv.id as inv_id, inv.level, inv.in_deck, inv.is_new, c.* 
      FROM player_inventory inv
      JOIN cards c ON inv.card_id = c.id
      WHERE inv.player_id = $1
      ORDER BY inv.id DESC
    `, [req.player.id]);
    res.json({ success: true, cards: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Добавить/убрать карту из колоды
app.post('/api/deck/toggle', telegramAuth, playerAuth, async (req, res) => {
  const { inv_id } = req.body;
  try {
    // 1. Получаем текущий статус карты
    const cardRes = await pool.query('SELECT * FROM player_inventory WHERE id = $1 AND player_id = $2', [inv_id, req.player.id]);
    if (cardRes.rows.length === 0) return res.status(404).json({ error: 'Карта не найдена' });
    
    const currentCard = cardRes.rows[0];
    const newStatus = !currentCard.in_deck;

    // 2. Если мы добавляем карту, проверяем лимиты
    if (newStatus) {
      // Проверка на дубликат (нельзя добавить две одинаковые карты)
      const duplicateCheck = await pool.query(
        'SELECT 1 FROM player_inventory WHERE player_id = $1 AND card_id = $2 AND in_deck = TRUE AND id != $3',
        [req.player.id, currentCard.card_id, inv_id]
      );
      if (duplicateCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Такая карта уже есть в колоде!' });
      }

      const deckRes = await pool.query(`
        SELECT count(*) as total, 
               sum(case when c.type = 'Персонаж' then 1 else 0 end) as characters
        FROM player_inventory inv
        JOIN cards c ON inv.card_id = c.id
        WHERE inv.player_id = $1 AND inv.in_deck = TRUE
      `, [req.player.id]);
      
      const total = parseInt(deckRes.rows[0].total);
      const characters = parseInt(deckRes.rows[0].characters) || 0;

      if (total >= 12) return res.status(400).json({ error: 'В колоде уже 12 карт!' });
      
      const typeRes = await pool.query('SELECT type FROM cards WHERE id = $1', [currentCard.card_id]);
      if (typeRes.rows[0].type === 'Персонаж' && characters >= 6) {
        return res.status(400).json({ error: 'В колоде уже максимум 6 персонажей!' });
      }
    }

    // 3. Переключаем статус
    await pool.query('UPDATE player_inventory SET in_deck = $1 WHERE id = $2', [newStatus, inv_id]);
    res.json({ success: true, in_deck: newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Открыть бесплатный кейс
app.post('/api/shop/open', telegramAuth, playerAuth, async (req, res) => {
  try {
    // 1. Определяем редкость по шансам
    const roll = Math.random() * 100;
    let rarity = 'grey'; // Частая (68.52%)
    if (roll < 0.13) rarity = 'gold'; // Легендарная (0.13%)
    else if (roll < 2.87) rarity = 'blue'; // Супер-редкая (2.74%)
    else if (roll < 12.84) rarity = 'orange'; // Редкая (9.97%)
    else if (roll < 31.48) rarity = 'purple'; // Обычная (18.64%)

    // 2. Выбираем случайную карту этой редкости
    let cardResult = await pool.query('SELECT * FROM cards WHERE rarity = $1 ORDER BY RANDOM() LIMIT 1', [rarity]);
    
    // Если карт такой редкости нет в базе, берем любую
    if (cardResult.rows.length === 0) {
      cardResult = await pool.query('SELECT * FROM cards ORDER BY RANDOM() LIMIT 1');
    }
    
    const card = cardResult.rows[0];
    if (!card) return res.status(500).json({ error: 'База карт пуста' });
    
    // 3. Добавляем в инвентарь
    await pool.query('INSERT INTO player_inventory (player_id, card_id) VALUES ($1, $2)', [req.player.id, card.id]);
    
    // 4. Возвращаем данные карты для анимации
    res.json({ success: true, card: card });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Пометить карту как прочитанную
app.post('/api/inventory/read', telegramAuth, playerAuth, async (req, res) => {
  const { inv_id } = req.body;
  try {
    await pool.query('UPDATE player_inventory SET is_new = FALSE WHERE id = $1 AND player_id = $2', [inv_id, req.player.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Пометить ВСЕ карты как прочитанные
app.post('/api/inventory/read-all', telegramAuth, playerAuth, async (req, res) => {
  try {
    await pool.query('UPDATE player_inventory SET is_new = FALSE WHERE player_id = $1', [req.player.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ДРУЗЬЯ ====================

// Поиск игроков по ID или никнейму
app.get('/api/friends/search', telegramAuth, playerAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, players: [] });

  try {
    let result;
    if (/^\d+$/.test(q)) {
      result = await pool.query(
        'SELECT id, nickname, avatar_url, level FROM players WHERE id = $1 AND id != $2',
        [parseInt(q), req.player.id]
      );
    } else {
      result = await pool.query(
        'SELECT id, nickname, avatar_url, level FROM players WHERE LOWER(nickname) LIKE LOWER($1) AND id != $2 LIMIT 10',
        [`%${q}%`, req.player.id]
      );
    }

    const ids = result.rows.map(r => r.id);
    const statuses = {};
    if (ids.length > 0) {
      const statusRes = await pool.query(
        `SELECT player_id, friend_id, status FROM friendships
         WHERE (player_id = $1 AND friend_id = ANY($2))
            OR (friend_id = $1 AND player_id = ANY($2))`,
        [req.player.id, ids]
      );
      statusRes.rows.forEach(r => {
        const otherId = r.player_id === req.player.id ? r.friend_id : r.player_id;
        statuses[otherId] = {
          status: r.status,
          direction: r.player_id === req.player.id ? 'outgoing' : 'incoming'
        };
      });
    }

    const players = result.rows.map(p => ({ ...p, friendship: statuses[p.id] || null }));
    res.json({ success: true, players });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Отправить запрос в друзья
app.post('/api/friends/request', telegramAuth, playerAuth, async (req, res) => {
  const targetId = parseInt(req.body.target_id);
  if (!targetId) return res.status(400).json({ error: 'Не указан игрок' });
  if (targetId === req.player.id) return res.status(400).json({ error: 'Нельзя добавить себя' });

  try {
    const targetRes = await pool.query('SELECT id FROM players WHERE id = $1', [targetId]);
    if (targetRes.rows.length === 0) return res.status(404).json({ error: 'Игрок не найден' });

    const existing = await pool.query(
      `SELECT * FROM friendships
       WHERE (player_id = $1 AND friend_id = $2) OR (player_id = $2 AND friend_id = $1)`,
      [req.player.id, targetId]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.status === 'accepted') return res.status(400).json({ error: 'Вы уже друзья' });

      // Встречный запрос — автопринятие
      if (row.status === 'pending' && row.player_id === targetId) {
        await pool.query('UPDATE friendships SET status = $1 WHERE id = $2', ['accepted', row.id]);
        return res.json({ success: true, status: 'accepted' });
      }
      return res.status(400).json({ error: 'Запрос уже отправлен' });
    }

    await pool.query(
      'INSERT INTO friendships (player_id, friend_id, status) VALUES ($1, $2, $3)',
      [req.player.id, targetId, 'pending']
    );
    res.json({ success: true, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Список друзей
app.get('/api/friends', telegramAuth, playerAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT p.id, p.nickname, p.avatar_url, p.level
      FROM players p
      WHERE p.id IN (
        SELECT friend_id FROM friendships WHERE player_id = $1 AND status = 'accepted'
        UNION
        SELECT player_id FROM friendships WHERE friend_id = $1 AND status = 'accepted'
      )
      AND p.id != $1
      ORDER BY p.nickname
    `, [req.player.id]);
    res.json({ success: true, friends: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Входящие запросы
app.get('/api/friends/requests', telegramAuth, playerAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT f.id as request_id, p.id, p.nickname, p.avatar_url, p.level
      FROM friendships f
      JOIN players p ON f.player_id = p.id
      WHERE f.friend_id = $1 AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `, [req.player.id]);
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Принять запрос
app.post('/api/friends/accept', telegramAuth, playerAuth, async (req, res) => {
  const { request_id } = req.body;
  try {
    await pool.query(
      'UPDATE friendships SET status = $1 WHERE id = $2 AND friend_id = $3',
      ['accepted', request_id, req.player.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Отклонить запрос / удалить друга
app.post('/api/friends/decline', telegramAuth, playerAuth, async (req, res) => {
  const { request_id } = req.body;
  try {
    await pool.query(
      'DELETE FROM friendships WHERE id = $1 AND (friend_id = $2 OR player_id = $2)',
      [request_id, req.player.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ПРИГЛАШЕНИЯ В БОЙ ====================

// Отправить приглашение
app.post('/api/battle/invite', telegramAuth, playerAuth, async (req, res) => {
  const toId = parseInt(req.body.to_player_id);
  if (!toId) return res.status(400).json({ error: 'Не указан игрок' });

  try {
    const friendshipRes = await pool.query(`
      SELECT 1 FROM friendships
      WHERE status = 'accepted'
      AND ((player_id = $1 AND friend_id = $2) OR (player_id = $2 AND friend_id = $1))
    `, [req.player.id, toId]);
    if (friendshipRes.rows.length === 0) return res.status(400).json({ error: 'Вы не друзья' });

    // Просрочим старые pending-инвайты от этого игрока
    await pool.query(
      `UPDATE battle_invites SET status = 'expired'
       WHERE from_player_id = $1 AND to_player_id = $2 AND status = 'pending'`,
      [req.player.id, toId]
    );

    const result = await pool.query(
      `INSERT INTO battle_invites (from_player_id, to_player_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING id, expires_at`,
      [req.player.id, toId]
    );
    res.json({ success: true, invite: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получить инвайты (входящие + исходящие + готовые к бою)
app.get('/api/battle/invites', telegramAuth, playerAuth, async (req, res) => {
  try {
    const incoming = await pool.query(`
      SELECT bi.id, bi.from_player_id as player_id, bi.expires_at, p.nickname, p.avatar_url, p.level
      FROM battle_invites bi
      JOIN players p ON bi.from_player_id = p.id
      WHERE bi.to_player_id = $1 AND bi.status = 'pending' AND bi.expires_at > NOW()
      ORDER BY bi.created_at DESC
    `, [req.player.id]);

    const outgoing = await pool.query(`
      SELECT bi.id, bi.to_player_id as player_id, bi.expires_at, bi.status, bi.battle_id,
             p.nickname, p.avatar_url, p.level
      FROM battle_invites bi
      JOIN players p ON bi.to_player_id = p.id
      WHERE bi.from_player_id = $1
        AND bi.status IN ('pending', 'accepted')
        AND bi.expires_at > NOW() - INTERVAL '5 minutes'
      ORDER BY bi.created_at DESC
    `, [req.player.id]);

    res.json({
      success: true,
      incoming: incoming.rows,
      outgoing: outgoing.rows,
      ready_battles: outgoing.rows.filter(r => r.status === 'accepted')
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Принять инвайт
app.post('/api/battle/invite/accept', telegramAuth, playerAuth, async (req, res) => {
  const { invite_id } = req.body;
  try {
    const result = await pool.query(
      `UPDATE battle_invites SET status = 'accepted'
       WHERE id = $1 AND to_player_id = $2 AND status = 'pending' AND expires_at > NOW()
       RETURNING from_player_id, to_player_id, id`,
      [invite_id, req.player.id]
    );
    if (result.rows.length === 0) return res.status(400).json({ error: 'Приглашение не найдено или истекло' });

    const invite = result.rows[0];
    let battleId = null;
    try {
      battleId = await createBattle(invite.from_player_id, invite.to_player_id);
      await pool.query('UPDATE battle_invites SET battle_id = $1 WHERE id = $2', [battleId, invite.id]);
    } catch (e) {
      await pool.query(`UPDATE battle_invites SET status = 'pending' WHERE id = $1`, [invite.id]);
      return res.status(400).json({ error: e.message });
    }

    res.json({ success: true, invite, battle_id: battleId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Отклонить / отменить инвайт
app.post('/api/battle/invite/decline', telegramAuth, playerAuth, async (req, res) => {
  const { invite_id } = req.body;
  try {
    await pool.query(
      `UPDATE battle_invites SET status = 'declined'
       WHERE id = $1 AND (to_player_id = $2 OR from_player_id = $2) AND status = 'pending'`,
      [invite_id, req.player.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Заглушка матчмейкинга
app.post('/api/battle/matchmaking', telegramAuth, playerAuth, async (req, res) => {
  res.json({ success: true, message: 'Подбор соперника в разработке' });
});

// ==================== БОЕВОЙ ДВИЖОК ====================

function makeCardState(c) {
  return {
    invId: c.inv_id,
    cardId: c.id,
    name: c.name,
    type: c.type,
    rarity: c.rarity,
    description: c.description,
    image_url: c.image_url,
    cost: c.cost || 1,
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

function startTurn(state, playerKey) {
  const p = state[playerKey];
  p.turnNumber++;
  p.maxEnergy = Math.min(10, p.turnNumber + 1);
  p.energy = p.maxEnergy;
  p.board.forEach(invId => {
    const c = state.cards[invId] || state.cards[String(invId)];
    if (c) c.hasAttacked = false;
  });
  state.currentTurnPlayer = playerKey;
  state.log.push(`Ход ${playerKey === 'p1' ? 'Игрока 1' : 'Игрока 2'} — энергия ${p.energy}`);
  if (state.log.length > 30) state.log = state.log.slice(-30);
}

function applyDamage(card, dmg) {
  let remaining = dmg;
  if (card.currentArmor > 0) {
    const absorbed = Math.min(card.currentArmor, remaining);
    card.currentArmor -= absorbed;
    remaining -= absorbed;
  }
  if (remaining > 0) card.currentHp -= remaining;
}

function checkBattleEnd(state) {
  if (state.p1.hp <= 0 && state.p2.hp <= 0) { state.status = 'finished'; state.winner = null; }
  else if (state.p1.hp <= 0) { state.status = 'finished'; state.winner = 'p2'; }
  else if (state.p2.hp <= 0) { state.status = 'finished'; state.winner = 'p1'; }
}

async function createBattle(player1Id, player2Id) {
  const [deckRes1, deckRes2, playersRes] = await Promise.all([
    pool.query(`SELECT inv.id as inv_id, c.* FROM player_inventory inv
                JOIN cards c ON inv.card_id = c.id
                WHERE inv.player_id = $1 AND inv.in_deck = TRUE`, [player1Id]),
    pool.query(`SELECT inv.id as inv_id, c.* FROM player_inventory inv
                JOIN cards c ON inv.card_id = c.id
                WHERE inv.player_id = $1 AND inv.in_deck = TRUE`, [player2Id]),
    pool.query(`SELECT id, nickname, avatar_url, level FROM players WHERE id = ANY($1)`, [[player1Id, player2Id]])
  ]);

  const deck1 = deckRes1.rows, deck2 = deckRes2.rows;
  if (deck1.length !== 12 || deck2.length !== 12) throw new Error('У обоих игроков должно быть по 12 карт в колоде');

  const playerMap = Object.fromEntries(playersRes.rows.map(p => [p.id, p]));

  const state = {
    p1: { player: playerMap[player1Id], hp: 30, maxHp: 30, energy: 0, maxEnergy: 0, hand: [], board: [], turnNumber: 0 },
    p2: { player: playerMap[player2Id], hp: 30, maxHp: 30, energy: 0, maxEnergy: 0, hand: [], board: [], turnNumber: 0 },
    cards: {},
    currentTurnPlayer: 'p1',
    status: 'active',
    winner: null,
    log: []
  };

  deck1.forEach(c => { state.p1.hand.push(c.inv_id); state.cards[c.inv_id] = makeCardState(c); });
  deck2.forEach(c => { state.p2.hand.push(c.inv_id); state.cards[c.inv_id] = makeCardState(c); });

  startTurn(state, 'p1');

  const result = await pool.query(
    'INSERT INTO battles (player1_id, player2_id, state) VALUES ($1, $2, $3) RETURNING id',
    [player1Id, player2Id, JSON.stringify(state)]
  );
  return result.rows[0].id;
}

async function loadBattle(req, res, next) {
  const battleId = parseInt(req.params.id);
  try {
    const result = await pool.query('SELECT * FROM battles WHERE id = $1', [battleId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Бой не найден' });
    const battle = result.rows[0];
    if (battle.player1_id !== req.player.id && battle.player2_id !== req.player.id) {
      return res.status(403).json({ error: 'Вы не участвуете в этом бою' });
    }
    req.battle = battle;
    req.playerKey = battle.player1_id === req.player.id ? 'p1' : 'p2';
    req.oppKey = req.playerKey === 'p1' ? 'p2' : 'p1';
    next();
  } catch (err) { res.status(500).json({ error: err.message }); }
}

async function saveBattleState(battle) {
  const winnerId = battle.state.winner === 'p1' ? battle.player1_id
                 : battle.state.winner === 'p2' ? battle.player2_id : null;
  await pool.query(
    'UPDATE battles SET state = $1, status = $2, winner_id = $3, updated_at = NOW() WHERE id = $4',
    [JSON.stringify(battle.state), battle.state.status, winnerId, battle.id]
  );
}

// GET состояния боя (с фильтрацией руки соперника)
app.get('/api/battle/:id', telegramAuth, playerAuth, loadBattle, (req, res) => {
  const state = JSON.parse(JSON.stringify(req.battle.state));
  const oppHand = state[req.oppKey].hand || [];
  oppHand.forEach(id => { delete state.cards[id]; delete state.cards[String(id)]; });
  state[req.oppKey].hand = [];
  state[req.oppKey].handCount = oppHand.length;

  res.json({
    success: true,
    battle: {
      id: req.battle.id,
      playerKey: req.playerKey,
      status: req.battle.status,
      winner_id: req.battle.winner_id,
      state
    }
  });
});

// Разыграть карту
app.post('/api/battle/:id/play', telegramAuth, playerAuth, loadBattle, async (req, res) => {
  try {
    const state = req.battle.state;
    if (state.status !== 'active') return res.status(400).json({ error: 'Бой окончен' });
    if (state.currentTurnPlayer !== req.playerKey) return res.status(400).json({ error: 'Не ваш ход' });

    const p = state[req.playerKey];
    const invId = parseInt(req.body.inv_id);
    if (!p.hand.map(Number).includes(invId)) return res.status(400).json({ error: 'Карты нет в руке' });

    const card = state.cards[invId] || state.cards[String(invId)];
    if (!card) return res.status(400).json({ error: 'Карта не найдена' });
    if (p.energy < card.cost) return res.status(400).json({ error: 'Недостаточно энергии' });

    if (card.type === 'Персонаж' && p.board.length >= 6) {
      return res.status(400).json({ error: 'На столе уже 6 персонажей' });
    }

    p.hand = p.hand.filter(id => Number(id) !== invId);
    p.energy -= card.cost;

    if (card.type === 'Персонаж') {
      p.board.push(invId);
      card.hasAttacked = true;
      state.log.push(`${card.name} выставлен на стол`);
    } else {
      card.discarded = true;
      state.log.push(`Сыграна карта: ${card.name} (эффект — в следующем обновлении)`);
    }

    await saveBattleState(req.battle);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Атака
app.post('/api/battle/:id/attack', telegramAuth, playerAuth, loadBattle, async (req, res) => {
  try {
    const state = req.battle.state;
    if (state.status !== 'active') return res.status(400).json({ error: 'Бой окончен' });
    if (state.currentTurnPlayer !== req.playerKey) return res.status(400).json({ error: 'Не ваш ход' });

    const p = state[req.playerKey], opp = state[req.oppKey];
    const attackerId = parseInt(req.body.attacker_id);
    const targetRaw = req.body.target_id;

    const attacker = state.cards[attackerId] || state.cards[String(attackerId)];
    if (!attacker || !p.board.map(Number).includes(attackerId)) {
      return res.status(400).json({ error: 'Атакующий не на столе' });
    }
    if (attacker.hasAttacked) return res.status(400).json({ error: 'Эта карта уже атаковала' });
    if (attacker.currentAtk <= 0) return res.status(400).json({ error: 'Нет атаки' });

    if (targetRaw === 'player') {
      if (opp.board.length > 0) return res.status(400).json({ error: 'Сначала убейте всех персонажей соперника' });
      opp.hp -= attacker.currentAtk;
      state.log.push(`${attacker.name} бьёт игрока на ${attacker.currentAtk}`);
      attacker.hasAttacked = true;
    } else {
      const targetId = parseInt(targetRaw);
      const target = state.cards[targetId] || state.cards[String(targetId)];
      if (!target || !opp.board.map(Number).includes(targetId)) {
        return res.status(400).json({ error: 'Цель не найдена' });
      }

      applyDamage(target, attacker.currentAtk);
      applyDamage(attacker, target.currentAtk);
      attacker.hasAttacked = true;

      if (target.currentHp <= 0) {
        opp.board = opp.board.filter(id => Number(id) !== targetId);
        target.discarded = true;
        state.log.push(`${target.name} погибает`);
      }
      if (attacker.currentHp <= 0) {
        p.board = p.board.filter(id => Number(id) !== attackerId);
        attacker.discarded = true;
        state.log.push(`${attacker.name} погибает`);
      }
    }

    checkBattleEnd(state);
    await saveBattleState(req.battle);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Конец хода
app.post('/api/battle/:id/end-turn', telegramAuth, playerAuth, loadBattle, async (req, res) => {
  try {
    const state = req.battle.state;
    if (state.status !== 'active') return res.status(400).json({ error: 'Бой окончен' });
    if (state.currentTurnPlayer !== req.playerKey) return res.status(400).json({ error: 'Не ваш ход' });

    startTurn(state, req.oppKey);
    await saveBattleState(req.battle);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Сдаться
app.post('/api/battle/:id/surrender', telegramAuth, playerAuth, loadBattle, async (req, res) => {
  try {
    const state = req.battle.state;
    if (state.status !== 'active') return res.status(400).json({ error: 'Бой уже окончен' });

    state.status = 'finished';
    state.winner = req.oppKey;
    state[req.playerKey].hp = 0;
    state.log.push(`${req.playerKey === 'p1' ? 'Игрок 1' : 'Игрок 2'} сдался`);
    await saveBattleState(req.battle);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
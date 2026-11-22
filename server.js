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

// На случай, если таблица уже была создана без battle_id
pool.query(`ALTER TABLE battle_invites ADD COLUMN IF NOT EXISTS battle_id INTEGER`)
  .catch(err => console.error('Migration Error battle_id:', err));

// Миграция: стоимости карт по редкости (если все ещё дефолтные)
(async () => {
  try {
    await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS cost INTEGER DEFAULT 1`);
    await pool.query(`
      UPDATE cards SET cost = CASE
        WHEN rarity = 'grey' THEN 1
        WHEN rarity = 'purple' THEN 2
        WHEN rarity = 'orange' THEN 3
        WHEN rarity = 'blue' THEN 4
        WHEN rarity = 'gold' THEN 5
        ELSE 2
      END
      WHERE cost = 1 AND rarity != 'grey'
    `);
  } catch (e) { console.error('Cost migration:', e); }
})();

// Миграция: стоимость карт
pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS cost INTEGER DEFAULT 1`).catch(()=>{});

// Миграция: убрать все UNIQUE-констрейнты с player_inventory.
// Игра разрешает дубликаты в инвентаре (каждый экземпляр — свой inv_id).
// Если стоит UNIQUE (player_id, card_id) — паки падают с "duplicate key".
(async () => {
  try {
    const constraintsRes = await pool.query(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      WHERE tc.table_name = 'player_inventory'
        AND tc.constraint_type = 'UNIQUE'
    `);
    for (const row of constraintsRes.rows) {
      try {
        await pool.query(`ALTER TABLE player_inventory DROP CONSTRAINT IF EXISTS "${row.constraint_name}"`);
        console.log('Dropped UNIQUE constraint on player_inventory:', row.constraint_name);
      } catch (e) {
        console.error('Failed to drop constraint', row.constraint_name, ':', e.message);
      }
    }
  } catch (e) {
    console.error('player_inventory constraint cleanup:', e);
  }
})();

// Очередь матчмейкинга
pool.query(`
  CREATE TABLE IF NOT EXISTS matchmaking_queue (
    player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    level INTEGER,
    status VARCHAR(20) DEFAULT 'searching',
    battle_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
  )
`).catch(err => console.error('Matchmaking init:', err));

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
    // Сортируем: сначала по card_id (группирует одинаковые карты),
    // внутри группы — новые сверху
    const result = await pool.query(`
      SELECT inv.id as inv_id, inv.level, inv.in_deck, inv.is_new, c.* 
      FROM player_inventory inv
      JOIN cards c ON inv.card_id = c.id
      WHERE inv.player_id = $1
      ORDER BY c.id ASC, inv.id DESC
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

// Открыть платный кейс (100 монет, 3 карты, без дубликатов)
const PACK_COST = 100;
const PACK_SIZE = 3;

app.post('/api/shop/open', telegramAuth, playerAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Атомарно списываем монеты (внутри транзакции)
    const deductRes = await client.query(
      'UPDATE players SET coins = coins - $1 WHERE id = $2 AND coins >= $1 RETURNING coins',
      [PACK_COST, req.player.id]
    );
    if (deductRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Недостаточно монет (нужно ${PACK_COST})` });
    }

    // 2. Генерируем 3 УНИКАЛЬНЫЕ карты
    const cards = [];
    const usedCardIds = new Set();
    let safetyCounter = 0;

    while (cards.length < PACK_SIZE && safetyCounter < 30) {
      safetyCounter++;

      const roll = Math.random() * 100;
      let rarity = 'grey';
      if (roll < 0.13) rarity = 'gold';
      else if (roll < 2.87) rarity = 'blue';
      else if (roll < 12.84) rarity = 'orange';
      else if (roll < 31.48) rarity = 'purple';

      let cardResult = await client.query(
        `SELECT * FROM cards WHERE rarity = $1
         AND id <> ALL($2::int[])
         ORDER BY RANDOM() LIMIT 1`,
        [rarity, Array.from(usedCardIds)]
      );
      if (cardResult.rows.length === 0) {
        cardResult = await client.query(
          `SELECT * FROM cards WHERE id <> ALL($1::int[]) ORDER BY RANDOM() LIMIT 1`,
          [Array.from(usedCardIds)]
        );
      }
      if (cardResult.rows.length === 0) break;

      const card = cardResult.rows[0];
      usedCardIds.add(card.id);
      cards.push(card);

      // ON CONFLICT DO NOTHING — страховка, если остались какие-то UNIQUE-констрейнты
      await client.query(
        `INSERT INTO player_inventory (player_id, card_id, is_new)
         VALUES ($1, $2, TRUE)
         ON CONFLICT DO NOTHING`,
        [req.player.id, card.id]
      );
    }

    if (cards.length === 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Не удалось сгенерировать карты' });
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      cards,
      coins: deductRes.rows[0].coins,
      cost: PACK_COST
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
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
    // Проверка колоды у себя
    const myDeck = await pool.query('SELECT count(*) FROM player_inventory WHERE player_id = $1 AND in_deck = TRUE', [req.player.id]);
    if (parseInt(myDeck.rows[0].count) !== 12) {
      return res.status(400).json({ error: 'У вас должно быть ровно 12 карт в колоде' });
    }

    // Проверка колоды у соперника
    const oppDeck = await pool.query('SELECT count(*) FROM player_inventory WHERE player_id = $1 AND in_deck = TRUE', [toId]);
    if (parseInt(oppDeck.rows[0].count) !== 12) {
      return res.status(400).json({ error: 'У соперника не собрана колода (12 карт)' });
    }

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
        AND (
          bi.status = 'pending'
          OR EXISTS (
            SELECT 1 FROM battles b
            WHERE b.id = bi.battle_id AND b.status = 'active'
          )
        )
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
  let client = null;
  let transactionOpen = false;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;

    // Блокируем приглашение, в том числе для безопасного повторного запроса.
    const inviteRes = await client.query(
      'SELECT id, from_player_id, to_player_id, status, battle_id, (expires_at > NOW()) AS is_valid FROM battle_invites WHERE id = $1 AND to_player_id = $2 FOR UPDATE',
      [invite_id, req.player.id]
    );
    if (inviteRes.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({ error: 'Приглашение не найдено' });
    }

    const invite = inviteRes.rows[0];

    // Повторное нажатие на уже принятое приглашение возвращает тот же активный бой.
    if (invite.status === 'accepted' && invite.battle_id) {
      const acceptedBattle = await client.query(
        `SELECT id FROM battles
         WHERE id = $1 AND status = 'active'
           AND ((player1_id = $2 AND player2_id = $3)
             OR (player1_id = $3 AND player2_id = $2))
         FOR UPDATE`,
        [invite.battle_id, invite.from_player_id, invite.to_player_id]
      );

      if (acceptedBattle.rows.length > 0) {
        await client.query('COMMIT');
        transactionOpen = false;
        return res.json({
          success: true,
          invite,
          battle_id: acceptedBattle.rows[0].id,
          reused: true
        });
      }

      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(409).json({ error: 'Бой по этому приглашению уже завершён' });
    }

    if (invite.status !== 'pending') {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({ error: 'Приглашение уже недействительно' });
    }

    if (!invite.is_valid) {
      await client.query('ROLLBACK');
      transactionOpen = false;
      return res.status(400).json({ error: 'Срок действия приглашения истёк' });
    }

    // Сериализуем встречные приглашения и матчмейкинг для одной пары игроков.
    await lockBattlePlayers(client, invite.from_player_id, invite.to_player_id);

    // Если встречное приглашение уже запустило бой, используем существующий матч.
    const activePair = await client.query(
      `SELECT id FROM battles
       WHERE status = 'active'
         AND ((player1_id = $1 AND player2_id = $2)
           OR (player1_id = $2 AND player2_id = $1))
       ORDER BY id DESC
       LIMIT 1
       FOR UPDATE`,
      [invite.from_player_id, invite.to_player_id]
    );

    const battleId = activePair.rows.length > 0
      ? activePair.rows[0].id
      : await createBattle(invite.from_player_id, invite.to_player_id, client);

    await client.query(
      `UPDATE battle_invites
       SET status = 'accepted', battle_id = $1
       WHERE id = $2`,
      [battleId, invite.id]
    );

    invite.status = 'accepted';
    invite.battle_id = battleId;

    // Закрываем встречный инвайт тем же боем, чтобы оба клиента получили один battle_id.
    await client.query(
      `UPDATE battle_invites
       SET status = 'accepted', battle_id = $1
       WHERE from_player_id = $2
         AND to_player_id = $3
         AND status = 'pending'
         AND expires_at > NOW()`,
      [battleId, invite.to_player_id, invite.from_player_id]
    );

    await client.query('COMMIT');
    transactionOpen = false;
    return res.json({ success: true, invite, battle_id: battleId, reused: activePair.rows.length > 0 });
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) {}
      transactionOpen = false;
    }
    console.error('Accept battle invite failed:', error);
    return res.status(error.statusCode || 500).json({
      error: error.message || 'Не удалось принять приглашение'
    });
  } finally {
    if (client) client.release();
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

// Матчмейкинг
app.post('/api/battle/matchmaking', telegramAuth, playerAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    // Защита от дабл-клика: проверяем активный бой
    const existingBattle = await client.query(
      `SELECT id FROM battles WHERE status = 'active' AND (player1_id = $1 OR player2_id = $1) LIMIT 1`,
      [req.player.id]
    );
    if (existingBattle.rows.length > 0) {
      client.release();
      return res.status(400).json({ error: 'У вас уже есть активный бой', battle_id: existingBattle.rows[0].id });
    }

    const myDeck = await client.query('SELECT count(*) FROM player_inventory WHERE player_id = $1 AND in_deck = TRUE', [req.player.id]);
    if (parseInt(myDeck.rows[0].count) !== 12) {
      client.release();
      return res.status(400).json({ error: 'У вас должно быть ровно 12 карт в колоде' });
    }

    await client.query('BEGIN');

    // Чистим устаревшие заявки
    await client.query(`DELETE FROM matchmaking_queue WHERE created_at < NOW() - INTERVAL '5 minutes'`);

    const myLevel = req.player.level || 1;

    // FOR UPDATE SKIP LOCKED — защита от одновременного матчинга нескольких игроков
    const oppRes = await client.query(`
      SELECT player_id, level FROM matchmaking_queue
      WHERE player_id != $1 AND status = 'searching'
      ORDER BY ABS(level - $2) ASC LIMIT 1
      FOR UPDATE SKIP LOCKED
    `, [req.player.id, myLevel]);

    if (oppRes.rows.length > 0) {
      const oppId = oppRes.rows[0].player_id;
      const oppLevel = oppRes.rows[0].level || 1;

      const oppDeck = await client.query('SELECT count(*) FROM player_inventory WHERE player_id = $1 AND in_deck = TRUE', [oppId]);
      if (parseInt(oppDeck.rows[0].count) !== 12) {
        await client.query(`DELETE FROM matchmaking_queue WHERE player_id = $1`, [oppId]);
        await client.query('COMMIT');
        client.release();
        return res.json({ success: true, searching: true });
      }

      // Создаём бой внутри транзакции
      const battleId = await createBattle(req.player.id, oppId, client);

      // Помечаем обоих как matched
      await client.query(`UPDATE matchmaking_queue SET status = 'matched', battle_id = $1 WHERE player_id = $2`, [battleId, oppId]);
      await client.query(`
        INSERT INTO matchmaking_queue (player_id, level, status, battle_id, created_at)
        VALUES ($1, $2, 'matched', $3, NOW())
        ON CONFLICT (player_id) DO UPDATE SET status = 'matched', battle_id = $3, created_at = NOW()
      `, [req.player.id, myLevel, battleId]);

      await client.query('COMMIT');
      client.release();
      return res.json({ success: true, battle_id: battleId });
    } else {
      await client.query(`
        INSERT INTO matchmaking_queue (player_id, level, status, battle_id, created_at)
        VALUES ($1, $2, 'searching', NULL, NOW())
        ON CONFLICT (player_id) DO UPDATE SET status = 'searching', battle_id = NULL, created_at = NOW()
      `, [req.player.id, myLevel]);
      await client.query('COMMIT');
      client.release();
      return res.json({ success: true, searching: true });
    }
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch(e) {}
    client.release();
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/battle/matchmaking/status', telegramAuth, playerAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT status, battle_id FROM matchmaking_queue WHERE player_id = $1`, [req.player.id]);
    if (result.rows.length === 0) return res.json({ success: true, status: 'none' });

    const row = result.rows[0];
    if (row.status === 'matched') {
      await pool.query(`DELETE FROM matchmaking_queue WHERE player_id = $1`, [req.player.id]);
      return res.json({ success: true, status: 'matched', battle_id: row.battle_id });
    }
    res.json({ success: true, status: 'searching' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/battle/matchmaking/cancel', telegramAuth, playerAuth, async (req, res) => {
  try {
    await pool.query(`DELETE FROM matchmaking_queue WHERE player_id = $1 AND status = 'searching'`, [req.player.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==================== БОЕВОЙ ДВИЖОК ====================

function getRarityCost(rarity) {
  return { grey: 1, purple: 2, orange: 3, blue: 4, gold: 5 }[rarity] || 2;
}

function makeCardState(c) {
  return {
    invId: c.inv_id,
    cardId: c.id,
    name: c.name,
    type: c.type,
    rarity: c.rarity,
    description: c.description,
    image_url: c.image_url,
    cost: getRarityCost(c.rarity),
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

async function lockBattlePlayers(client, player1Id, player2Id) {
  const playerIds = [...new Set([Number(player1Id), Number(player2Id)])].sort((a, b) => a - b);
  if (playerIds.length !== 2 || playerIds.some(id => !Number.isInteger(id) || id <= 0)) {
    const error = new Error('Некорректные игроки для создания боя');
    error.statusCode = 400;
    throw error;
  }

  // Единый порядок advisory-lock для приглашений и матчмейкинга.
  for (const playerId of playerIds) {
    await client.query('SELECT pg_advisory_xact_lock(92731, $1::int)', [playerId]);
  }
  return playerIds;
}

async function createBattle(player1Id, player2Id, client) {
  if (!client || typeof client.query !== 'function' || typeof client.release !== 'function') {
    throw new Error('Создание боя должно выполняться внутри транзакции');
  }

  const playerIds = await lockBattlePlayers(client, player1Id, player2Id);

  // Один игрок не может одновременно оказаться в двух активных боях.
  const activeBattleRes = await client.query(
    'SELECT id FROM battles WHERE status = $1 AND (player1_id = ANY($2::int[]) OR player2_id = ANY($2::int[])) LIMIT 1',
    ['active', playerIds]
  );
  if (activeBattleRes.rows.length > 0) {
    const error = new Error('Один из игроков уже участвует в активном бою');
    error.statusCode = 409;
    throw error;
  }

  const deckRes1 = await client.query(
    'SELECT inv.id as inv_id, c.* FROM player_inventory inv JOIN cards c ON inv.card_id = c.id WHERE inv.player_id = $1 AND inv.in_deck = TRUE',
    [player1Id]
  );
  const deckRes2 = await client.query(
    'SELECT inv.id as inv_id, c.* FROM player_inventory inv JOIN cards c ON inv.card_id = c.id WHERE inv.player_id = $1 AND inv.in_deck = TRUE',
    [player2Id]
  );
  const playersRes = await client.query(
    'SELECT id, nickname, avatar_url, level FROM players WHERE id = ANY($1::int[])',
    [playerIds]
  );

  const deck1 = deckRes1.rows;
  const deck2 = deckRes2.rows;
  if (deck1.length !== 12 || deck2.length !== 12) {
    const error = new Error('У обоих игроков должно быть по 12 карт в колоде');
    error.statusCode = 400;
    throw error;
  }
  if (playersRes.rows.length !== 2) {
    const error = new Error('Один из игроков не найден');
    error.statusCode = 404;
    throw error;
  }

  const playerMap = Object.fromEntries(playersRes.rows.map(p => [p.id, p]));
  const now = Date.now();
  const state = {
    p1: { player: playerMap[player1Id], hp: 30, maxHp: 30, energy: 10, maxEnergy: 10, hand: [], board: [], turnNumber: 0, lastSeen: now, enteredBattle: false, heroShield: false },
    p2: { player: playerMap[player2Id], hp: 30, maxHp: 30, energy: 10, maxEnergy: 10, hand: [], board: [], turnNumber: 0, lastSeen: now, enteredBattle: false, heroShield: false },
    cards: {},
    currentTurnPlayer: 'p1',
    status: 'active',
    winner: null,
    turnPausedAt: null,
    createdAt: now,
    log: []
  };

  deck1.forEach(c => { state.p1.hand.push(c.inv_id); state.cards[c.inv_id] = makeCardState(c); });
  deck2.forEach(c => { state.p2.hand.push(c.inv_id); state.cards[c.inv_id] = makeCardState(c); });

  startTurn(state, 'p1');

  const result = await client.query(
    'INSERT INTO battles (player1_id, player2_id, state) VALUES ($1, $2, $3) RETURNING id',
    [player1Id, player2Id, JSON.stringify(state)]
  );
  return result.rows[0].id;
}

async function loadBattle(req, res, next) {
  const battleId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(battleId) || battleId <= 0) {
    return res.status(400).json({ error: 'Некорректный ID боя' });
  }

  let client = null;
  let transactionSettled = false;
  let clientReleased = false;
  const releaseClient = () => {
    if (clientReleased || !client) return;
    clientReleased = true;
    client.release();
  };

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM battles WHERE id = $1 FOR UPDATE', [battleId]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionSettled = true;
      releaseClient();
      return res.status(404).json({ error: 'Бой не найден' });
    }

    const battle = result.rows[0];
    if (battle.player1_id !== req.player.id && battle.player2_id !== req.player.id) {
      await client.query('ROLLBACK');
      transactionSettled = true;
      releaseClient();
      return res.status(403).json({ error: 'Вы не участвуете в этом бою' });
    }

    req.battle = battle;
    req.battleClient = client;
    req.playerKey = battle.player1_id === req.player.id ? 'p1' : 'p2';
    req.oppKey = req.playerKey === 'p1' ? 'p2' : 'p1';

    if (battle.state[req.playerKey]) {
      battle.state[req.playerKey].lastSeen = Date.now();
      battle.state[req.playerKey].enteredBattle = true;
    }

    // Ответ отправляется только после COMMIT/ROLLBACK: все запросы одного боя сериализованы.
    const originalJson = res.json.bind(res);
    res.json = function(payload) {
      if (transactionSettled) return res;
      transactionSettled = true;

      (async () => {
        let commitError = null;
        try {
          if (res.statusCode >= 500) await client.query('ROLLBACK');
          else await client.query('COMMIT');
        } catch (error) {
          commitError = error;
          try { await client.query('ROLLBACK'); } catch (rollbackError) {}
        } finally {
          releaseClient();
        }

        if (res.destroyed || res.writableEnded) return;
        if (commitError) {
          console.error('Battle transaction commit failed:', commitError);
          res.statusCode = 500;
          return originalJson({ error: 'Не удалось сохранить состояние боя' });
        }
        return originalJson(payload);
      })().catch(error => {
        console.error('Battle response finalization failed:', error);
        releaseClient();
        if (!res.destroyed && !res.writableEnded && !res.headersSent) {
          res.statusCode = 500;
          originalJson({ error: 'Не удалось завершить запрос боя' });
        }
      });

      return res;
    };

    res.once('close', () => {
      if (transactionSettled) return;
      transactionSettled = true;
      client.query('ROLLBACK').catch(() => {}).finally(releaseClient);
    });

    next();
  } catch (error) {
    if (!transactionSettled) {
      transactionSettled = true;
      try { await client.query('ROLLBACK'); } catch (rollbackError) {}
    }
    releaseClient();
    console.error('loadBattle failed:', error);
    if (!res.headersSent) return res.status(500).json({ error: error.message });
  }
}

async function giveRewards(battle, client) {
  if (battle.state.rewards_given) return;

  const isDraw = battle.state.winner === null;
  const p1Win = battle.state.winner === 'p1';
  const p2Win = battle.state.winner === 'p2';

  const calc = (isWinner) => {
    if (isDraw) return { xp: 50, coins: 20, mana: 5 };
    if (isWinner) return { xp: 100, coins: 50, mana: 10 };
    return { xp: 30, coins: 10, mana: 2 };
  };

  const r1 = calc(p1Win);
  const r2 = calc(p2Win);

  // Начисление, выдача карты и флаг rewards_given находятся в одной транзакции.
  await client.query(
    'UPDATE players SET xp = xp + $1, coins = coins + $2, mana = mana + $3 WHERE id = $4',
    [r1.xp, r1.coins, r1.mana, battle.player1_id]
  );
  await client.query(
    'UPDATE players SET xp = xp + $1, coins = coins + $2, mana = mana + $3 WHERE id = $4',
    [r2.xp, r2.coins, r2.mana, battle.player2_id]
  );

  if (p1Win && Math.random() < 0.2) {
    const pack = await client.query(
      'INSERT INTO player_inventory (player_id, card_id, is_new) SELECT $1, id, TRUE FROM cards ORDER BY RANDOM() LIMIT 1 RETURNING id',
      [battle.player1_id]
    );
    r1.pack = pack.rowCount > 0;
  }
  if (p2Win && Math.random() < 0.2) {
    const pack = await client.query(
      'INSERT INTO player_inventory (player_id, card_id, is_new) SELECT $1, id, TRUE FROM cards ORDER BY RANDOM() LIMIT 1 RETURNING id',
      [battle.player2_id]
    );
    r2.pack = pack.rowCount > 0;
  }

  battle.state.p1.rewards = r1;
  battle.state.p2.rewards = r2;
  battle.state.rewards_given = true;
  if (!Array.isArray(battle.state.log)) battle.state.log = [];
  battle.state.log.push('🎁 Награды начислены');
}

async function saveBattleState(battle, client) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('Сохранение боя должно выполняться внутри транзакции');
  }

  if (battle.state.status === 'finished') {
    await giveRewards(battle, client);
  }

  const winnerId = battle.state.winner === 'p1' ? battle.player1_id
                 : battle.state.winner === 'p2' ? battle.player2_id : null;
  await client.query(
    'UPDATE battles SET state = $1, status = $2, winner_id = $3, updated_at = NOW() WHERE id = $4',
    [JSON.stringify(battle.state), battle.state.status, winnerId, battle.id]
  );
}

// ==================== ЭФФЕКТЫ КАРТ ====================

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

// applyDamage уже объявлен выше (в блоке БОЕВОЙ ДВИЖОК) — не дублируем!

function removeDead(state, ownerKey, invId) {
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
  state.log.push(`💀 ${card.name} погибает`);
}

function healHero(player, amount) {
  player.hp = Math.min(player.maxHp, player.hp + amount);
}

function healCard(card, amount) {
  card.currentHp = Math.min(card.maxHp, card.currentHp + amount);
}

function extraTurn(state, playerKey) {
  const p = state[playerKey];
  // НЕ трогаем энергию
  p.board.forEach(invId => {
    const c = state.cards[invId] || state.cards[String(invId)];
    if (c) c.hasAttacked = false;
  });
  state.turnStartedAt = Date.now();
  state.log.push(`⏳ Временной скачок! Таймер хода обновлён, атаки разблокированы`);
}

function applyCardEffect(state, playerKey, oppKey, card, targetId) {
  const me = state[playerKey];
  const opp = state[oppKey];
  const getCard = (id) => state.cards[id] || state.cards[String(id)];
  const target = targetId ? getCard(targetId) : null;

  switch (card.name) {
    // ===== GREY =====
    case 'Скелет-воин':
    case 'Гоблин-вор':
    case 'Кот-фамильяр':
    case 'Сырный вор ишка':
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
      [...me.board].forEach(id => {
        const c = getCard(id);
        if (c) applyDamage(c, 2);
      });
      [...opp.board].forEach(id => {
        const c = getCard(id);
        if (c) applyDamage(c, 2);
      });
      [...me.board].forEach(id => removeDead(state, playerKey, id));
      [...opp.board].forEach(id => removeDead(state, oppKey, id));
      state.log.push(`💥 Взрыв наносит 2 урона всем персонажам`);
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
      if (self) self.immuneNegativeUntil = (me.turnNumber || 0) + 3;
      state.log.push(`Огненный маг защищён от негативных карт на 3 хода`);
      return;
    }
    case 'Щит хаоса': {
      me.heroShield = true;
      state.log.push(`🛡 Щит хаоса активирован`);
      return;
    }
    case 'Кража разума': {
      opp.energy = Math.max(0, opp.energy - 3);
      state.log.push(`Противник теряет 3 энергии`);
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
      healHero(me, 5);
      state.log.push(`+5 HP герою`);
      return;
    }

    case 'Дракон Бездны':
      return; // пассив

    case 'Облачный кит': {
      me.board.forEach(id => {
        const c = getCard(id);
        if (c && Number(id) !== Number(card.invId)) healCard(c, 4);
      });
      state.log.push(`Все ваши персонажи лечатся на 4 HP`);
      return;
    }
    case 'Король-мертвец': {
      healHero(me, 10);
      state.log.push(`+10 HP герою`);
      return;
    }
    case 'Абсолютное безумие': {
      if (opp.heroShield) {
        opp.heroShield = false;
        state.log.push(`Щит хаоса поглощает урон Абсолютного безумия`);
      } else {
        opp.hp -= 3;
        state.log.push(`Противник теряет 3 HP`);
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

// GET состояния боя (с фильтрацией руки соперника + таймауты + пауза хода)
app.get('/api/battle/:id', telegramAuth, playerAuth, loadBattle, async (req, res) => {
  try {
    const state = req.battle.state;
    const myKey = req.playerKey;
    const oppKey = req.oppKey;
    const now = Date.now();

    const createdAt = state.createdAt || (req.battle.created_at ? new Date(req.battle.created_at).getTime() : now);
    const oppEntered = state[oppKey]?.enteredBattle === true;
    const oppLastSeen = oppEntered ? (state[oppKey]?.lastSeen || 0) : createdAt;
    const oppGoneSec = (now - oppLastSeen) / 1000;

    // === Таймаут для соперника (своего не проверяем — loadBattle только что обновил мой lastSeen) ===
    if (state.status === 'active' && oppGoneSec > 60) {
      state.status = 'finished';
      state.winner = myKey;
      state[oppKey].hp = 0;
      state.log.push(oppEntered ? '⏱ Соперник не вернулся — тех. поражение' : '⏱ Соперник не зашёл в бой');
    }

    // === Пауза таймера хода, если соперник отключён > 4с ===
    if (state.status === 'active') {
      if (oppGoneSec > 4) {
        if (!state.turnPausedAt) state.turnPausedAt = now;
      } else if (state.turnPausedAt) {
        state.turnStartedAt += (now - state.turnPausedAt);
        state.turnPausedAt = null;
      }
    }

    // === Авто-конец хода (только если соперник онлайн) ===
    if (state.status === 'active'
        && oppGoneSec <= 4
        && state.turnStartedAt
        && now - state.turnStartedAt > 60000) {
      const next = state.currentTurnPlayer === 'p1' ? 'p2' : 'p1';
      state.log.push('⏱ Время хода истекло');
      startTurn(state, next);
    }

    await saveBattleState(req.battle, req.battleClient);

    const view = JSON.parse(JSON.stringify(state));
    const oppHand = view[oppKey].hand || [];
    oppHand.forEach(id => { delete view.cards[id]; delete view.cards[String(id)]; });
    view[oppKey].hand = [];
    view[oppKey].handCount = oppHand.length;

    res.json({
      success: true,
      battle: {
        id: req.battle.id,
        playerKey: myKey,
        status: state.status,
        winner_id: req.battle.winner_id,
        state: view,
        opponent_disconnected_sec: oppGoneSec > 4 ? Math.floor(oppGoneSec) : 0
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Разыграть карту (с эффектами и target-логикой)
app.post('/api/battle/:id/play', telegramAuth, playerAuth, loadBattle, async (req, res) => {
  try {
    const state = req.battle.state;
    if (state.status !== 'active') return res.status(400).json({ error: 'Бой окончен' });
    if (state.turnStartedAt && Date.now() - state.turnStartedAt > 60000) {
      return res.status(400).json({ error: '⏱ Время хода истекло' });
    }
    if (state.currentTurnPlayer !== req.playerKey) return res.status(400).json({ error: 'Не ваш ход' });

    const p = state[req.playerKey];
    const opp = state[req.oppKey];
    const invId = parseInt(req.body.inv_id);
    if (!p.hand.map(Number).includes(invId)) return res.status(400).json({ error: 'Карты нет в руке' });

    const card = state.cards[invId] || state.cards[String(invId)];
    if (!card) return res.status(400).json({ error: 'Карта не найдена' });
    if (p.energy < card.cost) return res.status(400).json({ error: 'Недостаточно энергии' });

    if (card.type === 'Персонаж' && p.board.length >= 6) {
      return res.status(400).json({ error: 'На столе уже 6 персонажей' });
    }

    // === Проверка цели ===
    const targetReq = CARD_TARGETS[card.name];
    let targetId = req.body.target_id ? parseInt(req.body.target_id) : null;
    let target = null;

    if (targetReq) {
      if (!targetId) {
        return res.status(400).json({ error: 'Нужна цель', needs_target: targetReq });
      }
      target = state.cards[targetId] || state.cards[String(targetId)];
      if (!target) return res.status(400).json({ error: 'Цель не найдена' });

      const isFriendly = p.board.map(Number).includes(targetId);
      const isEnemy = opp.board.map(Number).includes(targetId);

      if (targetReq === 'friendly' && !isFriendly) {
        return res.status(400).json({ error: 'Цель — ваш персонаж' });
      }
      if (targetReq === 'enemy' && !isEnemy) {
        return res.status(400).json({ error: 'Цель — персонаж противника' });
      }
      if (UNTARGETABLE.includes(target.name) && isEnemy) {
        return res.status(400).json({ error: `${target.name} неуязвим к картам` });
      }
      if (card.type === 'Негативная' && target.immuneNegativeUntil && (p.turnNumber || 0) <= target.immuneNegativeUntil) {
        return res.status(400).json({ error: 'Цель защищена от негативных карт' });
      }
    }

    // === Применение ===
    p.hand = p.hand.filter(id => Number(id) !== invId);
    p.energy -= card.cost;

    if (card.type === 'Персонаж') {
      p.board.push(invId);
      card.hasAttacked = true;
      state.log.push(`${card.name} выставлен на стол`);
    } else {
      card.discarded = true;
      state.log.push(`Сыграна карта: ${card.name}`);
    }

    applyCardEffect(state, req.playerKey, req.oppKey, card, targetId);
    checkBattleEnd(state); // эффекты могут убить игрока (Кровавый ритуал, Абсолютное безумие и т.д.)

    await saveBattleState(req.battle, req.battleClient);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Атака (с taunt, пассивами и корректным убийством)
app.post('/api/battle/:id/attack', telegramAuth, playerAuth, loadBattle, async (req, res) => {
  try {
    const state = req.battle.state;
    if (state.status !== 'active') return res.status(400).json({ error: 'Бой окончен' });
    if (state.turnStartedAt && Date.now() - state.turnStartedAt > 60000) {
      return res.status(400).json({ error: '⏱ Время хода истекло' });
    }
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

    // Taunt: если у соперника есть Древний голем — обязаны бить только его
    const tauntIds = opp.board.map(Number).filter(id => {
      const c = state.cards[id] || state.cards[String(id)];
      return c && c.name === 'Древний голем' && c.currentHp > 0;
    });

    if (targetRaw === 'player') {
      if (opp.board.length > 0) return res.status(400).json({ error: 'Сначала убейте всех персонажей соперника' });
      if (tauntIds.length > 0) return res.status(400).json({ error: 'Сначала убейте Древнего голема' });

      if (opp.heroShield) {
        opp.heroShield = false;
        state.log.push(`🛡 Щит хаоса поглощает ${attacker.currentAtk} урона`);
      } else {
        opp.hp -= attacker.currentAtk;
        state.log.push(`${attacker.name} бьёт игрока на ${attacker.currentAtk}`);
      }
      attacker.hasAttacked = true;
    } else {
      const targetId = parseInt(targetRaw);
      const target = state.cards[targetId] || state.cards[String(targetId)];
      if (!target || !opp.board.map(Number).includes(targetId)) {
        return res.status(400).json({ error: 'Цель не найдена' });
      }

      if (tauntIds.length > 0 && !tauntIds.includes(targetId)) {
        return res.status(400).json({ error: 'Сначала убейте Древнего голема' });
      }

      applyDamage(target, attacker.currentAtk);
      attacker.hasAttacked = true;

      // Оборотень лечится на 2 HP при атаке
      if (attacker.name === 'Оборотень' && attacker.currentHp > 0) {
        attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + 2);
        state.log.push(`🐺 Оборотень лечится на 2 HP`);
      }

      // Пожиратель душ: +2 к атаке при убийстве
      if (target.currentHp <= 0 && attacker.name === 'Пожиратель душ') {
        attacker.currentAtk += 2;
        state.log.push(`👻 Пожиратель душ поглощает душу: +2 атаки`);
      }

      removeDead(state, req.oppKey, targetId);
      if (attacker.currentHp <= 0) removeDead(state, req.playerKey, attackerId);
    }

    checkBattleEnd(state);
    await saveBattleState(req.battle, req.battleClient);
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
    await saveBattleState(req.battle, req.battleClient);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Сдаться / покинуть матч
app.post('/api/battle/:id/surrender', telegramAuth, playerAuth, loadBattle, async (req, res) => {
  try {
    const state = req.battle.state;
    if (state.status !== 'active') return res.status(400).json({ error: 'Бой уже окончен' });

    const now = Date.now();
    const oppLastSeen = state[req.oppKey]?.lastSeen || now;
    const oppGoneSec = (now - oppLastSeen) / 1000;

    if (oppGoneSec > 60) {
      // Оба покинули — ничья
      state.status = 'finished';
      state.winner = null;
      state.log.push('Оба игрока покинули матч — ничья');
    } else {
      state.status = 'finished';
      state.winner = req.oppKey;
      state[req.playerKey].hp = 0;
      state.log.push('Сдача');
    }

    await saveBattleState(req.battle, req.battleClient);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Активный бой (для reconnect-баннера)
app.get('/api/active-battle', telegramAuth, playerAuth, async (req, res) => {
  let client = null;
  let transactionOpen = false;

  const commitResponse = async (payload) => {
    await client.query('COMMIT');
    transactionOpen = false;
    return res.json(payload);
  };

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionOpen = true;

    // Проверка и изменение reconnect-состояния выполняются под блокировкой строки боя.
    const result = await client.query(
      'SELECT * FROM battles WHERE status = $1 AND (player1_id = $2 OR player2_id = $2) ORDER BY id DESC LIMIT 1 FOR UPDATE',
      ['active', req.player.id]
    );
    if (result.rows.length === 0) {
      return await commitResponse({ success: true, battle_id: null });
    }

    const battle = result.rows[0];
    const myKey = battle.player1_id === req.player.id ? 'p1' : 'p2';
    const oppKey = myKey === 'p1' ? 'p2' : 'p1';
    const state = battle.state;
    const now = Date.now();
    const createdAt = state.createdAt || (battle.created_at ? new Date(battle.created_at).getTime() : now);

    const myEntered = state[myKey]?.enteredBattle === true;
    const oppEntered = state[oppKey]?.enteredBattle === true;
    const myLastSeen = myEntered ? (state[myKey]?.lastSeen || 0) : createdAt;
    const oppLastSeen = oppEntered ? (state[oppKey]?.lastSeen || 0) : createdAt;
    const myGoneSec = (now - myLastSeen) / 1000;
    const oppGoneSec = (now - oppLastSeen) / 1000;

    // Первый вход: reconnect-баннер не нужен, но через 60 секунд бой завершается.
    if (!myEntered) {
      if (myGoneSec > 60) {
        if (oppGoneSec > 60) {
          state.status = 'finished';
          state.winner = null;
          state.log.push('Оба не зашли в бой');
        } else {
          state.status = 'finished';
          state.winner = oppKey;
          state[myKey].hp = 0;
          state.log.push('Вы не зашли в бой');
        }
        await saveBattleState(battle, client);
        return await commitResponse({ success: true, battle_id: null, finished: true });
      }
      return await commitResponse({ success: true, battle_id: null });
    }

    // Игрок уже входил: применяем общий 60-секундный лимит переподключения.
    if (state.status === 'active') {
      if (myGoneSec > 60 && oppGoneSec > 60) {
        state.status = 'finished';
        state.winner = null;
        state.log.push('⏱ Оба не вернулись — ничья');
      } else if (myGoneSec > 60) {
        state.status = 'finished';
        state.winner = oppKey;
        state[myKey].hp = 0;
        state.log.push('⏱ Вы не вернулись вовремя');
      } else if (oppGoneSec > 60) {
        state.status = 'finished';
        state.winner = myKey;
        state[oppKey].hp = 0;
        state.log.push('⏱ Соперник не вернулся');
      }

      if (state.status === 'finished') {
        await saveBattleState(battle, client);
        return await commitResponse({ success: true, battle_id: null, finished: true });
      }
    }

    // Не показываем баннер, пока игрок отсутствовал меньше пяти секунд.
    if (myGoneSec < 5) {
      return await commitResponse({ success: true, battle_id: null });
    }

    return await commitResponse({
      success: true,
      battle_id: battle.id,
      my_gone_sec: Math.floor(myGoneSec),
      opp_gone_sec: Math.floor(oppGoneSec),
      remaining_reconnect_sec: Math.max(0, 60 - Math.floor(myGoneSec))
    });
  } catch (error) {
    if (transactionOpen && client) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) {}
      transactionOpen = false;
    }
    console.error('active-battle failed:', error);
    if (!res.headersSent) return res.status(500).json({ error: error.message });
  } finally {
    if (client) client.release();
  }
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
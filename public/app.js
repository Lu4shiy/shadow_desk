const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const ASSETS_TO_PRELOAD = ['/img/crystal.png', '/img/coin.png', '/img/mana.png'];

function preloadImages(urls) {
  return Promise.all(urls.map(url => {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = url;
    });
  }));
}

async function apiFetch(path, options = {}) {
  const playerId = localStorage.getItem('playerId');
  const res = await fetch(path, {
    ...options,
    headers: {
      Authorization: `tma ${tg.initData}`,
      'Content-Type': 'application/json',
      ...(playerId ? { 'X-Player-Id': playerId } : {}),
      ...options.headers
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Ошибка ${res.status}`);
  }
  return res.json();
}

const loadScreen = document.getElementById('loading-screen');
const regScreen = document.getElementById('register-screen');
const mainScreen = document.getElementById('main-screen');
const toastEl = document.getElementById('toast');
const profileModal = document.getElementById('profile-modal');
const confirmModal = document.getElementById('confirm-modal');
let currentProfile = null;
let isRegisterMode = true;

function showToast(message, isSuccess = false) {
  toastEl.textContent = message;
  toastEl.classList.remove('success'); // Сбрасываем предыдущий статус
  if (isSuccess) toastEl.classList.add('success');
  toastEl.classList.add('show');
  
  setTimeout(() => { 
    toastEl.classList.remove('show'); 
    // Убираем success только после того, как плашка уехала вниз, чтобы не было мигания цвета
    setTimeout(() => toastEl.classList.remove('success'), 300);
  }, 3000);
}

async function init() {
  try {
    await preloadImages(ASSETS_TO_PRELOAD);
    const playerId = localStorage.getItem('playerId');
    
    if (playerId) {
      try {
        const data = await apiFetch('/api/me');
        loadScreen.style.display = 'none';
        showMain(data.profile);
        return;
      } catch (err) {
        localStorage.removeItem('playerId');
      }
    }
    
    loadScreen.style.display = 'none';
    showRegister();
  } catch (err) {
    document.getElementById('loading-screen').innerHTML = `<p style="color:red; padding:20px; text-align:center;">Ошибка: ${err.message}</p>`;
  }
}

function showRegister() {
  regScreen.style.display = 'flex';
  const btn = document.getElementById('btn-auth');
  const tabLogin = document.getElementById('tab-login');
  const tabReg = document.getElementById('tab-register');
  const ageGroup = document.getElementById('age-group');
  const tutorialGroup = document.getElementById('tutorial-group');
  const title = document.getElementById('auth-title');

  tabLogin.onclick = () => {
    isRegisterMode = false;
    title.textContent = 'Вход в аккаунт';
    ageGroup.style.display = 'none';
    tutorialGroup.style.display = 'none';
    tabLogin.style.background = 'linear-gradient(135deg, #9b59b6, #71368a)';
    tabLogin.style.boxShadow = '0 4px 15px rgba(155, 89, 182, 0.4)';
    tabReg.style.background = '#333';
    tabReg.style.boxShadow = 'none';
    btn.textContent = 'Войти';
  };

  tabReg.onclick = () => {
    isRegisterMode = true;
    title.textContent = 'Создание профиля';
    ageGroup.style.display = 'block';
    tutorialGroup.style.display = 'flex';
    tabReg.style.background = 'linear-gradient(135deg, #9b59b6, #71368a)';
    tabReg.style.boxShadow = '0 4px 15px rgba(155, 89, 182, 0.4)';
    tabLogin.style.background = '#333';
    tabLogin.style.boxShadow = 'none';
    btn.textContent = 'Создать аккаунт';
  };

  btn.onclick = async () => {
    const nick = document.getElementById('reg-nickname').value.trim();
    const password = document.getElementById('reg-password').value;
    const age = parseInt(document.getElementById('reg-age').value);
    const tut = document.getElementById('reg-tutorial').checked;

    if (!nick) return showToast('Введите никнейм!');
    if (!password) return showToast('Введите пароль!');
    if (isRegisterMode && (!age || age < 10)) return showToast('Введите корректный возраст!');

    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Загрузка...';

    try {
      const endpoint = isRegisterMode ? '/api/register' : '/api/login';
      const payload = isRegisterMode ? { nickname: nick, password, age, tutorialDone: tut } : { nickname: nick, password };

      const res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      
      localStorage.setItem('playerId', res.profile.id);
      regScreen.style.display = 'none';
      showToast(isRegisterMode ? 'Аккаунт создан!' : 'Успешный вход!', true);
      showMain(res.profile);
    } catch (err) {
      showToast(err.message);
      btn.disabled = false;
      btn.textContent = originalText;
    }
  };
}

function showMain(profile) {
  try {
    mainScreen.style.display = 'flex';
    currentProfile = profile;
    
    const avatarImg = document.getElementById('ui-avatar');
    if (profile.avatar_url) {
      avatarImg.src = profile.avatar_url;
    } else if (tg.initDataUnsafe?.user?.photo_url) {
      avatarImg.src = tg.initDataUnsafe.user.photo_url;
    } else {
      avatarImg.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    }

    document.getElementById('ui-nickname').textContent = profile.nickname || 'Игрок';
    document.getElementById('ui-id').textContent = profile.id || '0';
    document.getElementById('ui-level').textContent = profile.level || '1';
    document.getElementById('ui-xp').textContent = profile.xp || '0';
    document.getElementById('ui-max-xp').textContent = (profile.level || 1) * 1000;
    document.getElementById('ui-crystals').textContent = profile.crystals || '0';
    document.getElementById('ui-coins').textContent = profile.coins || '0';
    document.getElementById('ui-mana').textContent = profile.mana || '0';

    document.getElementById('open-profile-btn').onclick = () => {
      document.getElementById('edit-nickname-input').value = currentProfile.nickname || '';
      document.getElementById('edit-password-input').value = '';
      profileModal.style.display = 'flex';
    };

    document.getElementById('close-profile').onclick = () => profileModal.style.display = 'none';

    document.getElementById('btn-save-nickname').onclick = async () => {
      const newNick = document.getElementById('edit-nickname-input').value.trim();
      if (!newNick) return showToast('Никнейм не может быть пустым');
      try {
        const res = await apiFetch('/api/profile/nickname', { method: 'PUT', body: JSON.stringify({ nickname: newNick }) });
        currentProfile.nickname = res.profile.nickname;
        document.getElementById('ui-nickname').textContent = res.profile.nickname;
        showToast('Никнейм изменен', true);
      } catch (err) { showToast(err.message); }
    };

    document.getElementById('btn-save-password').onclick = async () => {
      const newPass = document.getElementById('edit-password-input').value;
      if (!newPass || newPass.length < 4) return showToast('Пароль от 4 символов');
      try {
        await apiFetch('/api/profile/password', { method: 'PUT', body: JSON.stringify({ newPassword: newPass }) });
        document.getElementById('edit-password-input').value = '';
        showToast('Пароль изменен', true);
      } catch (err) { showToast(err.message); }
    };

    document.getElementById('avatar-upload').onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) return showToast('Файл слишком большой (макс 2 МБ)');
      
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const res = await apiFetch('/api/profile/avatar', { method: 'PUT', body: JSON.stringify({ avatarBase64: event.target.result }) });
          currentProfile.avatar_url = res.avatar_url;
          avatarImg.src = res.avatar_url;
          showToast('Аватарка обновлена', true);
        } catch (err) { showToast(err.message); }
      };
      reader.readAsDataURL(file);
    };

    document.getElementById('btn-logout').onclick = () => {
      document.getElementById('confirm-text').textContent = 'Вы уверены, что хотите выйти? Ваш прогресс сохранится, вы сможете войти снова.';
      confirmModal.style.display = 'flex';
    };

    document.getElementById('btn-confirm-cancel').onclick = () => confirmModal.style.display = 'none';
    document.getElementById('btn-confirm-ok').onclick = () => {
      confirmModal.style.display = 'none';
      localStorage.removeItem('playerId');
      location.reload();
    };

    // Логика переключения вкладок
    const navBtns = document.querySelectorAll('.nav-btn');
    const contents = document.querySelectorAll('.content');
    
    navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        navBtns.forEach(b => b.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        document.getElementById(targetId).classList.add('active');
        
        // Дополнительная инициализация при входе на вкладку "В бой"
        if (targetId === 'tab-battle') {
          setTimeout(bindBattleTab, 50);
        }
      });
    });

    // Отрисовка карточек и привязка кнопки магазина
    renderInventory();

    // Глобальный polling приглашений — работает на любой вкладке
    startBattlePolling();
    
    document.getElementById('btn-open-case').onclick = async () => {
      if ((currentProfile.coins || 0) < 100) {
        showToast('Недостаточно монет. Нужно 100.');
        return;
      }

      try {
        const res = await apiFetch('/api/shop/open', { method: 'POST' });

        // Обновляем монеты
        if (typeof res.coins === 'number') {
          currentProfile.coins = res.coins;
          document.getElementById('ui-coins').textContent = res.coins;
        }

        const cards = res.cards || [];
        if (cards.length === 0) {
          showToast('Не удалось получить карты');
          return;
        }

        const packModal = document.getElementById('pack-modal');
        const packWrapper = document.getElementById('pack-wrapper');
        const packTop = document.getElementById('pack-top');
        const packResult = document.getElementById('pack-result');
        const packTitle = document.getElementById('pack-title');
        const swipeHint = document.getElementById('pack-swipe-hint');
        const closeBtn = document.getElementById('btn-close-pack');
        const dotsEl = document.getElementById('pack-dots');
        const cardContainer = document.getElementById('pack-card-container');

        // Сброс
        packWrapper.style.display = 'block';
        packResult.style.display = 'none';
        packTop.style.transform = 'translateX(0) rotate(0deg)';
        packTop.style.opacity = '1';
        packTitle.textContent = 'Смахни крышку вправо';
        packTitle.style.display = 'block';
        packModal.style.display = 'flex';

        let packIndex = 0;

        // === Свайп крышечки (влево → вправо) ===
        let startX = 0, currentX = 0, isDragging = false;

        const onDragStart = (e) => {
          isDragging = true;
          startX = e.touches ? e.touches[0].clientX : e.clientX;
          currentX = startX;
        };
        const onDragMove = (e) => {
          if (!isDragging) return;
          currentX = e.touches ? e.touches[0].clientX : e.clientX;
          const diff = currentX - startX;
          if (diff > 0) {
            packTop.style.transform = `translateX(${diff}px) rotate(${diff * 0.1}deg)`;
          }
        };
        const onDragEnd = () => {
          if (!isDragging) return;
          isDragging = false;
          const diff = currentX - startX;
          document.removeEventListener('mousemove', onDragMove);
          document.removeEventListener('mouseup', onDragEnd);
          document.removeEventListener('touchmove', onDragMove);
          document.removeEventListener('touchend', onDragEnd);
          if (diff > 60) {
            packTop.style.transform = `translateX(300px) rotate(20deg)`;
            packTop.style.opacity = '0';
            setTimeout(showCurrentCard, 250);
          } else {
            packTop.style.transform = `translateX(0) rotate(0deg)`;
          }
          startX = 0; currentX = 0;
        };

        packTop.onmousedown = (e) => {
          onDragStart(e);
          document.addEventListener('mousemove', onDragMove);
          document.addEventListener('mouseup', onDragEnd);
        };
        packTop.ontouchstart = (e) => {
          onDragStart(e);
          document.addEventListener('touchmove', onDragMove, { passive: false });
          document.addEventListener('touchend', onDragEnd);
        };

        // === Показ текущей карты из пачки ===
        function renderDots() {
          let html = '';
          for (let i = 0; i < cards.length; i++) {
            html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin:0 4px;background:${i <= packIndex ? '#f1c40f' : '#555'};"></span>`;
          }
          dotsEl.innerHTML = html;
        }

        function showCurrentCard() {
          packWrapper.style.display = 'none';
          packTitle.style.display = 'none';
          packResult.style.display = 'flex';

          const card = cards[packIndex];
          if (!card) return;

          const imgHtml = card.image_url
            ? `<img src="/img/cards/${card.image_url}" style="width:100%;border-radius:12px;display:block;" alt="${card.name}" />`
            : `<div style="background:url('/img/card_template_${card.rarity}.png') center/100% 100%;aspect-ratio:4/5;display:flex;justify-content:center;align-items:center;border-radius:12px;"><div style="background:rgba(0,0,0,0.8);padding:10px;border-radius:8px;font-weight:bold;">${card.name}</div></div>`;

          cardContainer.innerHTML = `<div id="pack-current-card" class="card-reveal" style="width:100%;">${imgHtml}</div>`;
          renderDots();

          const isLast = packIndex >= cards.length - 1;
          if (isLast) {
            swipeHint.style.display = 'none';
            closeBtn.style.display = 'block';
            loadInventory();
          } else {
            swipeHint.style.display = 'block';
            closeBtn.style.display = 'none';
            bindCardSwipeUp();
          }
        }

        // === Свайп карты вверх → следующая ===
        function bindCardSwipeUp() {
          const cardEl = document.getElementById('pack-current-card');
          if (!cardEl) return;

          let sY = 0, cY = 0, drag = false;

          const onStart = (e) => {
            drag = true;
            sY = e.touches ? e.touches[0].clientY : e.clientY;
            cY = sY;
          };
          const onMove = (e) => {
            if (!drag) return;
            cY = e.touches ? e.touches[0].clientY : e.clientY;
            const diff = cY - sY;
            if (diff < 0) {
              cardEl.style.transition = '';
              cardEl.style.transform = `translateY(${diff}px) rotate(${diff * 0.02}deg)`;
              cardEl.style.opacity = String(Math.max(0, 1 + diff / 400));
            }
          };
          const onEnd = () => {
            if (!drag) return;
            drag = false;
            const diff = cY - sY;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
            if (diff < -80) {
              cardEl.style.transition = 'transform 0.25s ease-out, opacity 0.25s ease-out';
              cardEl.style.transform = 'translateY(-150%) scale(0.85)';
              cardEl.style.opacity = '0';
              setTimeout(() => {
                packIndex++;
                showCurrentCard();
              }, 260);
            } else {
              cardEl.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
              cardEl.style.transform = 'translateY(0)';
              cardEl.style.opacity = '1';
              setTimeout(() => { cardEl.style.transition = ''; }, 220);
            }
            sY = 0; cY = 0;
          };

          cardEl.onmousedown = (e) => {
            onStart(e);
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onEnd);
          };
          cardEl.ontouchstart = (e) => {
            onStart(e);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd);
          };
        }

        document.getElementById('btn-close-pack').onclick = () => {
          packModal.style.display = 'none';
          loadInventory();
        };

      } catch (err) {
        showToast(err.message);
      }
    };

  } catch (err) {
    console.error(err);
    showToast('Ошибка отрисовки профиля: ' + err.message);
  }
}

// --- ЛОГИКА ИНВЕНТАРЯ ---

let allInventoryCards = []; // Храним все карты в памяти
let currentTab = 'deck'; // 'deck' или 'all'
let longPressTimer;

const rarityNames = { grey: 'Частая', purple: 'Обычная', orange: 'Редкая', blue: 'Супер-редкая', gold: 'Легендарная' };
const rarityColors = { grey: '#aaa', purple: '#9b59b6', orange: '#e67e22', blue: '#3498db', gold: '#f1c40f' };

async function loadInventory() {
  try {
    const data = await apiFetch('/api/inventory');
    allInventoryCards = data.cards;
    updateInventoryUI();
  } catch (err) {
    document.getElementById('inventory-container').innerHTML = `<div style="color:red; grid-column: 1 / -1;">Ошибка загрузки: ${err.message}</div>`;
  }
}

function updateInventoryUI() {
  const deckCount = allInventoryCards.filter(c => c.in_deck).length;
  document.getElementById('deck-counter').textContent = deckCount;

  const typeFilter = document.getElementById('filter-type').value;
  const rarityFilter = document.getElementById('filter-rarity').value;
  const sortBy = document.getElementById('sort-by').value;

  let filtered = allInventoryCards.filter(card => {
    if (currentTab === 'deck' && !card.in_deck) return false;
    if (typeFilter !== 'all' && card.type !== typeFilter) return false;
    if (rarityFilter !== 'all' && card.rarity !== rarityFilter) return false;
    return true;
  });

  const typeWeight = { 'Персонаж': 1, 'Позитивная': 2, 'Негативная': 3, 'Атака': 4, 'Действие': 5 };
  const rarityWeight = { grey: 1, purple: 2, orange: 3, blue: 4, gold: 5 };

  filtered.sort((a, b) => {
    let rarA = rarityWeight[a.rarity] || 0;
    let rarB = rarityWeight[b.rarity] || 0;
    let typeA = typeWeight[a.type] || 0;
    let typeB = typeWeight[b.type] || 0;

    if (sortBy === 'rarity-desc') {
      if (rarB !== rarA) return rarB - rarA;
      return typeA - typeB;
    }
    if (sortBy === 'rarity-asc') {
      if (rarA !== rarB) return rarA - rarB;
      return typeA - typeB;
    }
    if (sortBy === 'type-asc') {
      if (typeA !== typeB) return typeA - typeB;
      return rarB - rarA; // Внутри типа сначала лучшие
    }
    if (sortBy === 'type-desc') {
      if (typeA !== typeB) return typeB - typeA;
      return rarB - rarA; // Внутри типа сначала лучшие
    }
    return 0;
  });

  const container = document.getElementById('inventory-container');
  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #555; border: 2px dashed #333; border-radius: 12px;">Здесь пусто.</div>`;
    return;
  }

  container.innerHTML = filtered.map(card => {
    const inDeckStyle = card.in_deck ? 'border: 3px solid #2ecc71; box-shadow: 0 0 15px #2ecc71; transform: scale(0.95);' : '';
    const newBadge = card.is_new ? '<div class="badge-new">NEW</div>' : '';
    
    let cardHtml = '';
    if (card.image_url) {
      cardHtml = `<img src="/img/cards/${card.image_url}" alt="${card.name}" />`;
    } else {
      cardHtml = `<div style="background-image: url('/img/card_template_${card.rarity}.png'); background-size: 100% 100%; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center;">
          <div style="background: rgba(0,0,0,0.7); padding: 10px; border-radius: 8px; color: #fff; text-align: center; font-size: 12px;">${card.name}</div>
        </div>`;
    }

    return `
      <div class="game-card" style="${inDeckStyle}" data-id="${card.inv_id}">
        ${newBadge}
        ${cardHtml}
      </div>
    `;
  }).join('');

  // 5. Привязка событий к карточкам
  const cardElements = container.querySelectorAll('.game-card');
  cardElements.forEach(el => {
    const invId = el.getAttribute('data-id');

    el.addEventListener('click', (e) => {
      if (el.dataset.longPressed === 'true') return;
      openCardModal(invId);
    });

    let pressStartX = 0, pressStartY = 0;

    const startPress = (e) => {
      el.dataset.longPressed = 'false';
      const touch = e.touches ? e.touches[0] : e;
      pressStartX = touch.clientX;
      pressStartY = touch.clientY;
      longPressTimer = setTimeout(() => {
        el.dataset.longPressed = 'true';
        showContextMenu(e, invId);
      }, 600);
    };

    const movePress = (e) => {
      const touch = e.touches ? e.touches[0] : e;
      const dx = Math.abs(touch.clientX - pressStartX);
      const dy = Math.abs(touch.clientY - pressStartY);
      // Даём 10px допуска на дрожание пальца
      if (dx > 10 || dy > 10) clearTimeout(longPressTimer);
    };

    const cancelPress = () => clearTimeout(longPressTimer);

    el.addEventListener('touchstart', startPress, { passive: true });
    el.addEventListener('touchend', cancelPress);
    el.addEventListener('touchmove', movePress, { passive: true });
    
    // Для ПКМ на компьютере
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      el.dataset.longPressed = 'true'; // Блокируем обычный клик
      showContextMenu(e, invId);
    });
  });
}

// Переключение вкладок
document.getElementById('btn-tab-deck').addEventListener('click', () => {
  currentTab = 'deck';
  document.getElementById('btn-tab-deck').classList.add('active');
  document.getElementById('btn-tab-all').classList.remove('active');
  updateInventoryUI();
});

document.getElementById('btn-tab-all').addEventListener('click', () => {
  currentTab = 'all';
  document.getElementById('btn-tab-all').classList.add('active');
  document.getElementById('btn-tab-deck').classList.remove('active');
  updateInventoryUI();
});

// Слушатели фильтров
document.getElementById('filter-type').addEventListener('change', updateInventoryUI);
document.getElementById('filter-rarity').addEventListener('change', updateInventoryUI);
document.getElementById('sort-by').addEventListener('change', updateInventoryUI);

// Глобальная функция для вызова из showMain
function renderInventory() {
  loadInventory();
}

// Логика переключения колоды
async function toggleDeckCard(invId) {
  try {
    await apiFetch('/api/deck/toggle', {
      method: 'POST',
      body: JSON.stringify({ inv_id: parseInt(invId) })
    });
    hideContextMenu();
    document.getElementById('card-detail-modal').style.display = 'none';
    loadInventory(); // Перезагружаем данные с сервера
  } catch (err) {
    showToast(err.message);
  }
}

function openCardModal(invId) {
  const card = allInventoryCards.find(c => c.inv_id == invId);
  if (!card) return;

  // Убираем NEW и обновляем UI
  if (card.is_new) {
    card.is_new = false;
    apiFetch('/api/inventory/read', { method: 'POST', body: JSON.stringify({ inv_id: invId }) }).catch(console.error);
    updateInventoryUI();
  }

  document.getElementById('card-detail-name').textContent = card.name;
  document.getElementById('card-detail-rarity').textContent = rarityNames[card.rarity];
  document.getElementById('card-detail-rarity').style.color = rarityColors[card.rarity];
  document.getElementById('card-detail-desc').textContent = card.description;

  const imgContainer = document.getElementById('card-detail-image-container');
  if (card.image_url) {
    imgContainer.innerHTML = `<img src="/img/cards/${card.image_url}" style="width:100%; display:block;" />`;
  } else {
    imgContainer.innerHTML = `<div style="background-image: url('/img/card_template_${card.rarity}.png'); background-size: 100% 100%; aspect-ratio: 4/5; display: flex; justify-content: center; align-items: center;"><div style="background: rgba(0,0,0,0.7); padding: 10px; border-radius: 8px;">${card.name}</div></div>`;
  }

  const statsContainer = document.getElementById('card-detail-stats');
  if (card.type === 'Персонаж') {
    statsContainer.innerHTML = `
      <span style="color:#e74c3c;">⚔️ Урон: ${card.atk}</span>
      <span style="color:#3498db;">🛡️ Броня: ${card.armor}</span>
      <span style="color:#2ecc71;">❤️ HP: ${card.hp}</span>
    `;
    statsContainer.style.display = 'flex';
  } else {
    statsContainer.style.display = 'none';
  }

  const toggleBtn = document.getElementById('btn-modal-toggle-deck');
  if (card.in_deck) {
    toggleBtn.textContent = 'Убрать из колоды';
    toggleBtn.className = 'btn-danger';
    toggleBtn.style.background = ''; 
    toggleBtn.style.boxShadow = '';
  } else {
    toggleBtn.textContent = 'Добавить в колоду';
    toggleBtn.className = '';
    toggleBtn.style.background = 'linear-gradient(135deg, #2ecc71, #27ae60)';
    toggleBtn.style.boxShadow = '0 4px 15px rgba(46, 204, 113, 0.4)';
  }

  toggleBtn.onclick = () => toggleDeckCard(card.inv_id);
  document.getElementById('card-detail-modal').style.display = 'flex';
}

document.getElementById('btn-close-card-modal').onclick = () => {
  document.getElementById('card-detail-modal').style.display = 'none';
};

// --- КОНТЕКСТНОЕ МЕНЮ (bottom sheet, ПКМ / Долгое нажатие) ---
const contextMenu = document.getElementById('context-menu');
const ctxBackdrop = document.getElementById('ctx-backdrop');
const ctxToggleBtn = document.getElementById('ctx-toggle-deck');
let activeContextCard = null;

function showContextMenu(e, invId) {
  e.preventDefault();
  e.stopPropagation();

  activeContextCard = allInventoryCards.find(c => c.inv_id == invId);
  if (!activeContextCard) return;

  if (activeContextCard.is_new) {
    activeContextCard.is_new = false;
    apiFetch('/api/inventory/read', { method: 'POST', body: JSON.stringify({ inv_id: invId }) }).catch(console.error);
    updateInventoryUI();
  }

  if (activeContextCard.in_deck) {
    ctxToggleBtn.textContent = 'Убрать из колоды';
    ctxToggleBtn.style.background = '#e74c3c';
  } else {
    ctxToggleBtn.textContent = 'Добавить в колоду';
    ctxToggleBtn.style.background = '#2ecc71';
  }

  ctxBackdrop.style.display = 'block';
  contextMenu.style.display = 'block';
}

function hideContextMenu() {
  ctxBackdrop.style.display = 'none';
  contextMenu.style.display = 'none';
}

// Кнопка действия в меню
ctxToggleBtn.onclick = () => {
  if (activeContextCard) toggleDeckCard(activeContextCard.inv_id);
};
// Отмена
document.getElementById('ctx-cancel').onclick = hideContextMenu;
// Клик по фону
ctxBackdrop.onclick = hideContextMenu;

// Привязка кнопки "Прочитать все"
document.getElementById('btn-mark-all-read').addEventListener('click', async () => {
  try {
    await apiFetch('/api/inventory/read-all', { method: 'POST' });
    allInventoryCards.forEach(c => c.is_new = false);
    updateInventoryUI();
    showToast('Все карты прочитаны', true);
  } catch (err) {
    showToast(err.message);
  }
});

// ==================== ДРУЗЬЯ И БОЙ ====================

let invitesPollTimer = null;
let pollTick = 0;

async function loadFriends() {
  try {
    const data = await apiFetch('/api/friends');
    renderFriends(data.friends);
  } catch (err) { console.error('loadFriends:', err); }
}

function renderFriends(friends) {
  const container = document.getElementById('friends-list');
  if (!friends || friends.length === 0) {
    container.innerHTML = '<div style="color: #555; text-align: center; padding: 20px; border: 2px dashed #333; border-radius: 12px;">У вас пока нет друзей</div>';
    return;
  }
  const fallbackAvatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  container.innerHTML = friends.map(f => `
    <div style="display: flex; align-items: center; gap: 10px; background: #1e1e1e; border: 1px solid #333; border-radius: 10px; padding: 10px; margin-bottom: 8px;">
      <img src="${f.avatar_url || fallbackAvatar}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid #9b59b6;" />
      <div style="flex: 1;">
        <div style="font-weight: bold;">${f.nickname}</div>
        <div style="font-size: 11px; color: #888;">ID: ${f.id} | Ур. ${f.level}</div>
      </div>
      <button class="btn-invite-battle" data-id="${f.id}" data-nickname="${f.nickname}" style="width: auto; padding: 8px 12px; font-size: 12px; background: linear-gradient(135deg, #e74c3c, #c0392b);">⚔️ В бой</button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-invite-battle').forEach(btn => {
    btn.onclick = async () => {
      const friendId = parseInt(btn.getAttribute('data-id'));
      const nick = btn.getAttribute('data-nickname');
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = 'Отправлено';
      try {
        await apiFetch('/api/battle/invite', { method: 'POST', body: JSON.stringify({ to_player_id: friendId }) });
        showToast(`Приглашение отправлено ${nick} (10 мин)`, true);
        loadInvites();
      } catch (err) {
        showToast(err.message);
        btn.disabled = false;
        btn.textContent = orig;
      }
    };
  });
}

async function loadFriendRequests() {
  try {
    const data = await apiFetch('/api/friends/requests');
    const container = document.getElementById('friend-requests-container');
    const list = document.getElementById('friend-requests-list');
    const fallbackAvatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    if (!data.requests || data.requests.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';
    list.innerHTML = data.requests.map(r => `
      <div style="display: flex; align-items: center; gap: 10px; background: #1e1e1e; border: 1px solid #333; border-radius: 10px; padding: 10px; margin-bottom: 8px;">
        <img src="${r.avatar_url || fallbackAvatar}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid #9b59b6;" />
        <div style="flex: 1;">
          <div style="font-weight: bold;">${r.nickname}</div>
          <div style="font-size: 11px; color: #888;">ID: ${r.id}</div>
        </div>
        <button class="btn-accept-req" data-id="${r.request_id}" style="width: auto; padding: 8px 12px; font-size: 12px; background: #2ecc71;">✓</button>
        <button class="btn-decline-req" data-id="${r.request_id}" style="width: auto; padding: 8px 12px; font-size: 12px; background: #e74c3c;">✕</button>
      </div>
    `).join('');

    list.querySelectorAll('.btn-accept-req').forEach(btn => {
      btn.onclick = async () => {
        try {
          await apiFetch('/api/friends/accept', { method: 'POST', body: JSON.stringify({ request_id: parseInt(btn.getAttribute('data-id')) }) });
          showToast('Запрос принят', true);
          loadFriendRequests();
          loadFriends();
        } catch (err) { showToast(err.message); }
      };
    });
    list.querySelectorAll('.btn-decline-req').forEach(btn => {
      btn.onclick = async () => {
        try {
          await apiFetch('/api/friends/decline', { method: 'POST', body: JSON.stringify({ request_id: parseInt(btn.getAttribute('data-id')) }) });
          loadFriendRequests();
        } catch (err) { showToast(err.message); }
      };
    });
  } catch (err) { console.error('loadFriendRequests:', err); }
}

async function loadInvites() {
  try {
    const data = await apiFetch('/api/battle/invites');
    const fallbackAvatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    // Входящие
    const inContainer = document.getElementById('battle-invites-container');
    const inList = document.getElementById('battle-invites-list');
    if (!data.incoming || data.incoming.length === 0) {
      inContainer.style.display = 'none';
    } else {
      inContainer.style.display = 'block';
      inList.innerHTML = data.incoming.map(inv => `
        <div style="display: flex; align-items: center; gap: 10px; background: #1e1e1e; border: 1px solid #e74c3c; border-radius: 10px; padding: 10px; margin-bottom: 8px;">
          <img src="${inv.avatar_url || fallbackAvatar}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid #e74c3c;" />
          <div style="flex: 1;">
            <div style="font-weight: bold;">${inv.nickname}</div>
            <div style="font-size: 11px; color: #888;">приглашает в бой</div>
          </div>
          <button class="btn-accept-invite" data-id="${inv.id}" style="width: auto; padding: 8px 12px; font-size: 12px; background: #2ecc71;">Принять</button>
          <button class="btn-decline-invite" data-id="${inv.id}" style="width: auto; padding: 8px 12px; font-size: 12px; background: #e74c3c;">✕</button>
        </div>
      `).join('');

      inList.querySelectorAll('.btn-accept-invite').forEach(btn => {
        btn.onclick = async () => {
          try {
            const res = await apiFetch('/api/battle/invite/accept', { method: 'POST', body: JSON.stringify({ invite_id: parseInt(btn.getAttribute('data-id')) }) });
            showToast('Бой начинается!', true);
            if (res.battle_id && window.joinBattle) window.joinBattle(res.battle_id);
            loadInvites();
          } catch (err) { showToast(err.message); }
        };
      });
      inList.querySelectorAll('.btn-decline-invite').forEach(btn => {
        btn.onclick = async () => {
          try {
            await apiFetch('/api/battle/invite/decline', { method: 'POST', body: JSON.stringify({ invite_id: parseInt(btn.getAttribute('data-id')) }) });
            loadInvites();
          } catch (err) { showToast(err.message); }
        };
      });
    }

    // Исходящие
    const outContainer = document.getElementById('battle-outgoing-container');
    const outList = document.getElementById('battle-outgoing-list');
    const pendingOut = (data.outgoing || []).filter(o => o.status === 'pending');
    if (pendingOut.length === 0) {
      outContainer.style.display = 'none';
    } else {
      outContainer.style.display = 'block';
      outList.innerHTML = pendingOut.map(o => `
        <div style="display: flex; align-items: center; gap: 10px; background: #1e1e1e; border: 1px dashed #666; border-radius: 10px; padding: 10px; margin-bottom: 8px;">
          <img src="${o.avatar_url || fallbackAvatar}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid #666; opacity: 0.7;" />
          <div style="flex: 1;">
            <div style="font-weight: bold;">${o.nickname}</div>
            <div style="font-size: 11px; color: #888;">ожидает ответа...</div>
          </div>
          <button class="btn-cancel-invite" data-id="${o.id}" style="width: auto; padding: 8px 12px; font-size: 12px; background: #555;">Отменить</button>
        </div>
      `).join('');

      outList.querySelectorAll('.btn-cancel-invite').forEach(btn => {
        btn.onclick = async () => {
          try {
            await apiFetch('/api/battle/invite/decline', { method: 'POST', body: JSON.stringify({ invite_id: parseInt(btn.getAttribute('data-id')) }) });
            loadInvites();
          } catch (err) { showToast(err.message); }
        };
      });
    }

    // Входящие — уведомление, если на другой вкладке
    if (data.incoming && data.incoming.length > 0) {
      const seenInc = JSON.parse(sessionStorage.getItem('seen_incoming_invites') || '[]');
      data.incoming.forEach(inv => {
        if (!seenInc.includes(inv.id)) {
          seenInc.push(inv.id);
          sessionStorage.setItem('seen_incoming_invites', JSON.stringify(seenInc));
          showToast(`⚔️ ${inv.nickname} приглашает вас в бой!`, true);
        }
      });
    }

    // Готовые бои (для инициатора)
    if (data.ready_battles && data.ready_battles.length > 0) {
      const seen = JSON.parse(sessionStorage.getItem('seen_battles') || '[]');
      data.ready_battles.forEach(b => {
        if (!seen.includes(b.id) && b.battle_id) {
          seen.push(b.id);
          sessionStorage.setItem('seen_battles', JSON.stringify(seen));
          showToast(`${b.nickname} принял приглашение!`, true);
          if (window.joinBattle) window.joinBattle(b.battle_id);
        }
      });
    }
  } catch (err) { console.error('loadInvites:', err); }
}

async function searchFriends() {
  const input = document.getElementById('friend-search-input');
  const q = input.value.trim();
  if (!q) return;

  const results = document.getElementById('friend-search-results');
  results.innerHTML = '<div style="color: #888; padding: 10px;">Поиск...</div>';
  const fallbackAvatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  try {
    const data = await apiFetch('/api/friends/search?q=' + encodeURIComponent(q));
    if (!data.players || data.players.length === 0) {
      results.innerHTML = '<div style="color: #888; padding: 10px; text-align: center;">Никого не найдено</div>';
      return;
    }
    results.innerHTML = data.players.map(p => {
      let actionBtn = '';
      if (!p.friendship) {
        actionBtn = `<button class="btn-add-friend" data-id="${p.id}" style="width: auto; padding: 8px 12px; font-size: 12px; background: #2ecc71;">Добавить</button>`;
      } else if (p.friendship.status === 'pending' && p.friendship.direction === 'outgoing') {
        actionBtn = `<span style="font-size: 11px; color: #888;">Запрос отправлен</span>`;
      } else if (p.friendship.status === 'pending' && p.friendship.direction === 'incoming') {
        actionBtn = `<button class="btn-add-friend" data-id="${p.id}" style="width: auto; padding: 8px 12px; font-size: 12px; background: #2ecc71;">Принять</button>`;
      } else if (p.friendship.status === 'accepted') {
        actionBtn = `<span style="font-size: 11px; color: #2ecc71;">Уже друг</span>`;
      }
      return `
        <div style="display: flex; align-items: center; gap: 10px; background: #1e1e1e; border: 1px solid #333; border-radius: 10px; padding: 10px; margin-bottom: 8px;">
          <img src="${p.avatar_url || fallbackAvatar}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid #9b59b6;" />
          <div style="flex: 1;">
            <div style="font-weight: bold;">${p.nickname}</div>
            <div style="font-size: 11px; color: #888;">ID: ${p.id} | Ур. ${p.level}</div>
          </div>
          ${actionBtn}
        </div>
      `;
    }).join('');

    results.querySelectorAll('.btn-add-friend').forEach(btn => {
      btn.onclick = async () => {
        try {
          const res = await apiFetch('/api/friends/request', { method: 'POST', body: JSON.stringify({ target_id: parseInt(btn.getAttribute('data-id')) }) });
          showToast(res.status === 'accepted' ? 'Теперь вы друзья!' : 'Запрос отправлен', true);
          searchFriends();
          loadFriends();
          loadFriendRequests();
        } catch (err) { showToast(err.message); }
      };
    });
  } catch (err) {
    results.innerHTML = `<div style="color: #e74c3c; padding: 10px;">${err.message}</div>`;
  }
}

function startBattlePolling() {
  if (invitesPollTimer) clearInterval(invitesPollTimer);
  pollTick = 0;
  invitesPollTimer = setInterval(async () => {
    if (mainScreen.style.display === 'none') return;
    pollTick++;
    try { await loadInvites(); } catch (e) {}
    if (pollTick % 4 === 0) { // раз в 20 секунд
      try { await loadFriends(); } catch (e) {}
      try { await loadFriendRequests(); } catch (e) {}
    }
  }, 5000);
}

// ==================== ХУК В showMain ====================

function bindBattleTab() {
  const matchBtn = document.getElementById('btn-matchmaking');
  if (matchBtn) {
    matchBtn.onclick = async () => {
      try {
        const res = await apiFetch('/api/battle/matchmaking', { method: 'POST' });
        showToast(res.message || 'Подбор в разработке');
      } catch (err) { showToast(err.message); }
    };
  }

  const searchBtn = document.getElementById('btn-friend-search');
  const searchInput = document.getElementById('friend-search-input');
  if (searchBtn) searchBtn.onclick = searchFriends;
  if (searchInput) {
    searchInput.onkeydown = (e) => { if (e.key === 'Enter') searchFriends(); };
  }

  loadFriends();
  loadFriendRequests();
  loadInvites();
  startBattlePolling();
}

// Перехватываем переключение вкладок, чтобы дёрнуть загрузку
document.addEventListener('DOMContentLoaded', () => {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('data-tab') === 'tab-battle') {
        setTimeout(bindBattleTab, 50);
      }
    });
  });
});

init();
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
      });
    });

    // Отрисовка карточек и привязка кнопки магазина
    renderInventory();
    
    document.getElementById('btn-open-case').onclick = async () => {
      try {
        const res = await apiFetch('/api/shop/open', { method: 'POST' });
        
        // Показываем модалку с паком
        const packModal = document.getElementById('pack-modal');
        const packImage = document.getElementById('pack-image');
        const packResult = document.getElementById('pack-result');
        const cardContainer = document.getElementById('pack-card-container');
        
        packImage.style.display = 'flex';
        packImage.style.transform = 'translateX(0)';
        packResult.style.display = 'none';
        packModal.style.display = 'flex';

        // Логика свайпа
        let startX = 0;
        const onTouchStart = (e) => startX = e.touches ? e.touches[0].clientX : e.clientX;
        const onTouchEnd = (e) => {
          const endX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
          if (endX - startX > 50) { // Свайп слева направо
            packImage.removeEventListener('touchstart', onTouchStart);
            packImage.removeEventListener('touchend', onTouchEnd);
            packImage.removeEventListener('mousedown', onTouchStart);
            packImage.removeEventListener('mouseup', onTouchEnd);
            openPack(res.card);
          }
        };

        packImage.addEventListener('touchstart', onTouchStart);
        packImage.addEventListener('touchend', onTouchEnd);
        packImage.addEventListener('mousedown', onTouchStart);
        packImage.addEventListener('mouseup', onTouchEnd);

        function openPack(card) {
          packImage.style.display = 'none';
          packResult.style.display = 'flex';
          
          // Рендерим карту в модалке
          if (card.image_url) {
             cardContainer.innerHTML = `<img src="/img/cards/${card.image_url}" class="card-reveal" style="width: 100%; border-radius: 12px;" />`;
          } else {
             cardContainer.innerHTML = `<div class="card-reveal" style="background-image: url('/img/card_template_${card.rarity}.png'); background-size: 100% 100%; aspect-ratio: 4/5; display: flex; justify-content: center; align-items: center; border-radius: 12px;"><div style="background: rgba(0,0,0,0.8); padding: 10px; border-radius: 8px; font-weight: bold;">${card.name}</div></div>`;
          }
          
          // Обновляем инвентарь в фоне
          loadInventory();
        }

        document.getElementById('btn-close-pack').onclick = () => {
          packModal.style.display = 'none';
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

  // ... (обработчики кликов остаются без изменений, они ниже в твоем файле)
  const cardElements = container.querySelectorAll('.game-card');
  cardElements.forEach(el => {
    const invId = el.getAttribute('data-id');

    el.addEventListener('click', (e) => {
      if (el.dataset.longPressed === 'true') return;
      openCardModal(invId);
    });

    const startPress = (e) => {
      el.dataset.longPressed = 'false';
      longPressTimer = setTimeout(() => {
        el.dataset.longPressed = 'true';
        showContextMenu(e, invId);
      }, 600);
    };
    const cancelPress = () => clearTimeout(longPressTimer);

    el.addEventListener('mousedown', startPress);
    el.addEventListener('touchstart', startPress);
    el.addEventListener('mouseup', cancelPress);
    el.addEventListener('touchend', cancelPress);
    el.addEventListener('touchmove', cancelPress);
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
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

// --- МОДАЛЬНОЕ ОКНО КАРТЫ ---
function openCardModal(invId) {
  const card = allInventoryCards.find(c => c.inv_id == invId);
  if (!card) return;

  // Если карта новая - помечаем прочитанной
  if (card.is_new) {
    card.is_new = false;
    apiFetch('/api/inventory/read', { method: 'POST', body: JSON.stringify({ inv_id: invId }) }).catch(console.error);
    // Перерисовывать сразу не будем, чтобы не мигало, перерисуем при закрытии
  }

  document.getElementById('card-detail-name').textContent = card.name;
  document.getElementById('card-detail-rarity').textContent = rarityNames[card.rarity];
  document.getElementById('card-detail-rarity').style.color = rarityColors[card.rarity];
  document.getElementById('card-detail-desc').textContent = card.description;

  // Картинка
  const imgContainer = document.getElementById('card-detail-image-container');
  if (card.image_url) {
    imgContainer.innerHTML = `<img src="/img/cards/${card.image_url}" style="width:100%; display:block;" />`;
  } else {
    imgContainer.innerHTML = `<div style="background-image: url('/img/card_template_${card.rarity}.png'); background-size: 100% 100%; aspect-ratio: 4/5; display: flex; justify-content: center; align-items: center;"><div style="background: rgba(0,0,0,0.7); padding: 10px; border-radius: 8px;">${card.name}</div></div>`;
  }

  // Статы (если персонаж)
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

  // Кнопка добавления/удаления
  const toggleBtn = document.getElementById('btn-modal-toggle-deck');
  if (card.in_deck) {
    toggleBtn.textContent = 'Убрать из колоды';
    toggleBtn.className = 'btn-danger';
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

// --- КОНТЕКСТНОЕ МЕНЮ (ПКМ / Долгое нажатие) ---
const contextMenu = document.getElementById('context-menu');
const ctxToggleBtn = document.getElementById('ctx-toggle-deck');
let activeContextCard = null;

function showContextMenu(e, invId) {
  e.preventDefault();
  activeContextCard = allInventoryCards.find(c => c.inv_id == invId);
  if (!activeContextCard) return;

  // Если карта новая - помечаем прочитанной
  if (card.is_new) {
    card.is_new = false;
    apiFetch('/api/inventory/read', { method: 'POST', body: JSON.stringify({ inv_id: invId }) }).catch(console.error);
    // Перерисовывать сразу не будем, чтобы не мигало, перерисуем при закрытии
  }

  // Настраиваем текст кнопки
  if (activeContextCard.in_deck) {
    ctxToggleBtn.textContent = 'Убрать из колоды';
    ctxToggleBtn.style.background = '#e74c3c';
  } else {
    ctxToggleBtn.textContent = 'Добавить в колоду';
    ctxToggleBtn.style.background = '#2ecc71';
  }

  // Позиционируем меню
  let x = e.pageX || e.touches[0].pageX;
  let y = e.pageY || e.touches[0].pageY;
  
  // Чтобы меню не уходило за экран
  if (x > window.innerWidth - 150) x -= 150;
  if (y > window.innerHeight - 80) y -= 80;

  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.style.display = 'block';

  ctxToggleBtn.onclick = () => toggleDeckCard(activeContextCard.inv_id);

  // Закрываем меню при клике в любое другое место
  setTimeout(() => {
    document.addEventListener('click', hideContextMenu, { once: true });
    document.addEventListener('touchstart', hideContextMenu, { once: true });
  }, 100);
}

function hideContextMenu() {
  contextMenu.style.display = 'none';
}

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

init();
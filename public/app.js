const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

const statusEl = document.getElementById('status');
const cardsEl = document.getElementById('cards');

async function apiFetch(path) {
  const res = await fetch(path, {
    headers: {
      Authorization: `tma ${tg.initData}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

async function init() {
  try {
    const me = await apiFetch('/api/me');
    statusEl.textContent = `Привет, ${me.user.first_name}!`;

    const collection = await apiFetch('/api/collection');
    cardsEl.innerHTML = collection.cards
      .map(c => `<div class="card"><strong>${c.name}</strong> — ${c.type} (${c.rarity})</div>`)
      .join('');
  } catch (err) {
    statusEl.textContent = `Ошибка: ${err.message}`;
    console.error(err);
  }
}

init();

const BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

function getToken() {
  return localStorage.getItem('kb_token');
}

export function setToken(token) {
  localStorage.setItem('kb_token', token);
}

export function clearToken() {
  localStorage.removeItem('kb_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  authWithTelegram: (initData) => request('/api/auth/telegram', { method: 'POST', body: JSON.stringify({ initData }) }),
  appointments: () => request('/api/appointments'),
  appointmentPrefs: () => request('/api/appointments/prefs'),
  setAppointmentPrefs: (notify) => request('/api/appointments/prefs', { method: 'POST', body: JSON.stringify({ notify }) }),
  addAppointment: (body) => request('/api/appointments', { method: 'POST', body: JSON.stringify({ body }) }),
  voteAppointment: (id) => request(`/api/appointments/${id}/vote`, { method: 'POST' }),
  deleteAppointment: (id) => request(`/api/appointments/${id}`, { method: 'DELETE' }),
  registrationDone: () => request('/api/auth/registration-done', { method: 'POST' }),
  register: (payload) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  becomeAdmin: (initData, code) => request('/api/auth/become-admin', { method: 'POST', body: JSON.stringify({ initData, code }) }),
  me: () => request('/api/users/me'),
  myTransactions: () => request('/api/users/me/transactions'),
  myReferrals: () => request('/api/users/me/referrals'),
  telebirrInfo: () => request('/api/wallet/telebirr-info'),
  paymentInfo: () => request('/api/wallet/payment-info'),
  depositRequest: (amount, senderPhone, transactionId, screenshot, method, payTo) => request('/api/wallet/deposit-request', { method: 'POST', body: JSON.stringify({ amount, senderPhone, transactionId, screenshot, method, payTo }) }),
  withdrawalRequest: (amount, note) => request('/api/wallet/withdrawal-request', { method: 'POST', body: JSON.stringify({ amount, note }) }),
  stakeTiers: () => request('/api/games/stake-tiers'),
  cardPool: () => request('/api/games/cards'),
  takenCards: (stakeTierId) => request(`/api/games/taken-cards?stakeTierId=${stakeTierId}`),
  joinGame: (stakeTierId, cardId) => request('/api/games/join', { method: 'POST', body: JSON.stringify({ stakeTierId, cardId }) }),
  roomState: (roomCode) => request(`/api/games/room/${roomCode}`),
  gameHistory: () => request('/api/games/history'),
  // KING LUDO
  ludoConfig: () => request('/api/ludo/config'),
  ludoRooms: () => request('/api/ludo/rooms'),
  ludoRoom: (code) => request(`/api/ludo/rooms/${code}`),
  ludoPlay: (settings) => request('/api/ludo/play', { method: 'POST', body: JSON.stringify(settings) }),
  ludoCreate: (settings) => request('/api/ludo/rooms', { method: 'POST', body: JSON.stringify(settings) }),
  ludoJoin: (code) => request(`/api/ludo/rooms/${code}/join`, { method: 'POST' }),
  ludoLeave: (code) => request(`/api/ludo/rooms/${code}/leave`, { method: 'POST' }),
  // KING DAMA
  damaConfig: () => request('/api/dama/config'),
  damaActive: () => request('/api/dama/active'),
  damaHistory: () => request('/api/dama/history'),
  damaRoom: (code) => request(`/api/dama/rooms/${code}`),
  damaRooms: () => request('/api/dama/rooms'),
  damaCreate: (body) => request('/api/dama/rooms', { method: 'POST', body: JSON.stringify(body) }),
  damaJoin: (code) => request(`/api/dama/rooms/${code}/join`, { method: 'POST' }),
  damaPlay: (body) => request('/api/dama/play', { method: 'POST', body: JSON.stringify(body) }),
  damaCancel: (code) => request(`/api/dama/rooms/${code}/cancel`, { method: 'POST' }),
};

export function wsUrl() {
  const token = getToken();
  const base = BASE_URL.replace(/^http/, 'ws');
  return `${base}/ws?token=${encodeURIComponent(token)}`;
}

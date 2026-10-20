const BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

function getToken() {
  return localStorage.getItem('kb_admin_token');
}

export function setToken(token) {
  localStorage.setItem('kb_admin_token', token);
}

export function clearToken() {
  localStorage.removeItem('kb_admin_token');
  localStorage.removeItem('kb_admin_role');
}

// 'admin' (full panel) or 'agent' (only the deposit/withdrawal requests meant for him)
export function setRole(role) {
  localStorage.setItem('kb_admin_role', role);
}

export function getRole() {
  return localStorage.getItem('kb_admin_role') === 'agent' ? 'agent' : 'admin';
}

const staffBase = () => (getRole() === 'agent' ? '/api/agent' : '/api/admin');

export function isAuthenticated() {
  return Boolean(getToken());
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
  if (res.status === 401 && token) {
    // token expired or invalid -> go back to the login page
    clearToken();
    window.location.reload();
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  adminLoginCode: (playerId, code) =>
    request('/api/auth/admin-login-code', { method: 'POST', body: JSON.stringify({ playerId, code }) }),
  agentLoginCode: (playerId, code) =>
    request('/api/auth/agent-login-code', { method: 'POST', body: JSON.stringify({ playerId, code }) }),
  agents: () => request('/api/admin/agents'),
  addAgent: (playerId, username) => request('/api/admin/agents', { method: 'POST', body: JSON.stringify({ playerId, username }) }),
  revokeAgent: (playerId, username) => request('/api/admin/agents/revoke', { method: 'POST', body: JSON.stringify({ playerId, username }) }),
  updateAgent: (id, body) => request(`/api/admin/agents/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  resetAgentCode: (id) => request(`/api/admin/agents/${id}/reset-code`, { method: 'POST' }),
  deleteAgent: (id) => request(`/api/admin/agents/${id}`, { method: 'DELETE' }),
  dashboard: () => request('/api/admin/dashboard'),
  users: (search) => request(`/api/admin/users${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  setUserStatus: (id, status) => request(`/api/admin/users/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  adjustBalance: (id, amount, direction, reason) =>
    request(`/api/admin/users/${id}/adjust-balance`, { method: 'POST', body: JSON.stringify({ amount, direction, reason }) }),
  transactions: (status, type) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    return request(`${staffBase()}/transactions?${params.toString()}`);
  },
  // screenshot attached to a deposit request -> blob URL (needs the admin token, so an <img src> alone cannot load it)
  depositProof: async (id) => {
    const res = await fetch(`${BASE_URL}${staffBase()}/transactions/${id}/proof`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error('Screenshot not found');
    return URL.createObjectURL(await res.blob());
  },
  reviewTransaction: (id, decision) => request(`${staffBase()}/transactions/${id}/review`, { method: 'POST', body: JSON.stringify({ decision }) }),
  rooms: () => request('/api/admin/rooms'),
  menuBanner: () => request('/api/admin/menu-banner'),
  uploadMenuBanner: (file) => request('/api/admin/menu-banner', { method: 'PUT', headers: { 'Content-Type': file.type }, body: file }),
  resetMenuBanner: () => request('/api/admin/menu-banner', { method: 'DELETE' }),
  ludoOverview: () => request('/api/admin/ludo/overview'),
  damaOverview: () => request('/api/admin/dama/overview'),
  damaSaveConfig: (body) => request('/api/admin/dama/config', { method: 'PUT', body: JSON.stringify(body) }),
  damaVoid: (code, reason) => request(`/api/admin/dama/rooms/${code}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
  auditLogs: () => request('/api/admin/audit-logs'),
  settings: () => request('/api/admin/settings'),
  updateSetting: (key, value) => request(`/api/admin/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  cbeAccounts: () => request('/api/admin/cbe-accounts'),
  addCbeAccount: (accountName, accountNumber) =>
    request('/api/admin/cbe-accounts', { method: 'POST', body: JSON.stringify({ accountName, accountNumber }) }),
  updateCbeAccount: (id, accountName, accountNumber) =>
    request(`/api/admin/cbe-accounts/${id}`, { method: 'PUT', body: JSON.stringify({ accountName, accountNumber }) }),
  deleteCbeAccount: (id) => request(`/api/admin/cbe-accounts/${id}`, { method: 'DELETE' }),
};

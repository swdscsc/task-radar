// 办事雷达 · 云端数据层（小程序）
// 复用网页版同一后端 wbapp_XrK8n6IQEOHB04l0XXM43T
// 登录后数据存云端（按账号 RLS 隔离，跨设备同步）；未登录则回退本地存储

const CONFIG = {
  endpoint: 'https://taskcard.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_XrK8n6IQEOHB04l0XXM43T_eDX1vpYPmfGHVg7fhG9vbQ0dTD7zblls'
};

// 本地回退存储
const LOCAL_KEY = 'taskcard.cloud.local.v1';

let client = null;
let mode = 'checking'; // checking | cloud | anon
let user = null;
let authListener = null;

function getClient() {
  if (!client) {
    const sdk = require('@workbuddy/cloud-sdk/miniprogram');
    client = sdk.createMiniProgramWorkBuddyCloud({
      endpoint: CONFIG.endpoint,
      oauthRelayBaseUrl: CONFIG.oauthRelayBaseUrl,
      publishableKey: CONFIG.publishableKey
    });
    client.auth.onAuthStateChanged(function (s) {
      if (s && s.user) {
        mode = 'cloud';
        user = s.user;
      } else {
        mode = 'anon';
        user = null;
      }
      if (authListener) authListener(mode, user);
    });
  }
  return client;
}

function getMode() { return mode; }
function getUser() { return user; }
function onAuthChange(fn) { authListener = fn; }

// ---------------- 鉴权 ----------------
async function checkAuth() {
  try {
    const c = getClient();
    const session = await c.auth.getSession();
    if (session && session.user) {
      mode = 'cloud';
      user = session.user;
    } else {
      mode = 'anon';
      user = null;
    }
  } catch (e) {
    mode = 'anon';
    user = null;
  }
  return { mode: mode, user: user };
}

async function signIn() {
  const c = getClient();
  await c.auth.signInWithOAuth({ provider: 'workbuddy' });
}

async function signOut() {
  const c = getClient();
  await c.auth.signOut();
  mode = 'anon';
  user = null;
}

// ---------------- 本地回退 ----------------
function localGet() {
  try { return wx.getStorageSync(LOCAL_KEY) || []; } catch (e) { return []; }
}
function localSet(list) {
  try { wx.setStorageSync(LOCAL_KEY, list); } catch (e) {}
}

// ---------------- 卡片 ----------------
async function saveCard(cardObj) {
  const cardJson = cardObj.cardJson || cardObj.card || cardObj;
  const title = cardObj.title || cardJson.title || '未命名办事卡';
  const category = cardObj.category || cardJson.category || '其他';
  const deadline = cardObj.deadline || (cardJson.deadline && cardJson.deadline.normalized_date);
  const ownerName = cardObj.ownerName || (user && user.name) || '未登录';

  if (mode === 'cloud') {
    const c = getClient();
    const { data, error } = await c.database.from('cards').insert([{
      title: title,
      category: category,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      card_json: JSON.stringify(cardJson),
      owner_name: ownerName
    }]).select();
    if (error) throw error;
    return data[0];
  } else {
    const list = localGet();
    const item = {
      id: 'local_' + Date.now(),
      owner_id: 'local',
      title: title,
      category: category,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      card_json: JSON.stringify(cardJson),
      owner_name: ownerName,
      created_at: new Date().toISOString(),
      __local: true
    };
    list.unshift(item);
    localSet(list);
    return item;
  }
}

async function listCards() {
  if (mode === 'cloud') {
    const c = getClient();
    const { data, error } = await c.database.from('cards')
      .select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(normalizeCard);
  } else {
    return localGet().map(normalizeCard);
  }
}

function normalizeCard(row) {
  let card;
  try { card = JSON.parse(row.card_json); } catch (e) { card = {}; }
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    deadlineText: row.deadline ? fmtLocal(row.deadline) : '',
    card: card,
    createdAt: row.created_at || new Date().toISOString(),
    __local: !!row.__local
  };
}

async function removeCard(id) {
  if (mode === 'cloud' && !String(id).startsWith('local_')) {
    const c = getClient();
    const { error } = await c.database.from('cards').delete().eq('id', id);
    if (error) throw error;
  } else {
    localSet(localGet().filter(function (x) { return x.id !== id; }));
  }
}

async function updateCard(id, cardJson) {
  if (mode === 'cloud' && !String(id).startsWith('local_')) {
    const c = getClient();
    const { error } = await c.database.from('cards')
      .update({ card_json: JSON.stringify(cardJson) }).eq('id', id);
    if (error) throw error;
  } else {
    const list = localGet().map(function (x) {
      if (x.id === id) return Object.assign({}, x, { card_json: JSON.stringify(cardJson) });
      return x;
    });
    localSet(list);
  }
}

// ---------------- 提醒 ----------------
async function setReminder(cardId, remindAtISO, label) {
  if (mode === 'cloud') {
    const c = getClient();
    const { error } = await c.database.from('reminders').insert([{
      card_id: cardId,
      remind_at: remindAtISO,
      lead_label: label || ''
    }]);
    if (error) throw error;
  } else {
    const list = localGet();
    const found = list.filter(function (x) { return x.id === cardId; })[0];
    if (found) {
      found.__reminder = { remind_at: remindAtISO, lead_label: label };
      localSet(list);
    }
  }
}

async function listReminders() {
  if (mode === 'cloud') {
    const c = getClient();
    const { data, error } = await c.database.from('reminders')
      .select('*, cards(title, category)')
      .order('remind_at', { ascending: true });
    if (error) throw error;
    return (data || []);
  } else {
    return localGet().filter(function (x) { return x.__reminder; })
      .map(function (x) {
        return {
          id: 'r_' + x.id,
          card_id: x.id,
          remind_at: x.__reminder.remind_at,
          lead_label: x.__reminder.lead_label,
          notified: false,
          cards: { title: x.title, category: x.category }
        };
      });
  }
}

async function markNotified(id) {
  if (mode === 'cloud' && !String(id).startsWith('r_')) {
    const c = getClient();
    await c.database.from('reminders').update({ notified: true }).eq('id', id);
  }
}

function fmtLocal(d) {
  const dt = new Date(d);
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()) +
    ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes());
}

module.exports = {
  CONFIG: CONFIG,
  getMode: getMode,
  getUser: getUser,
  onAuthChange: onAuthChange,
  checkAuth: checkAuth,
  signIn: signIn,
  signOut: signOut,
  saveCard: saveCard,
  listCards: listCards,
  removeCard: removeCard,
  updateCard: updateCard,
  setReminder: setReminder,
  listReminders: listReminders,
  markNotified: markNotified,
  fmtLocal: fmtLocal
};

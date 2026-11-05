/* ============================================================
   办事雷达 · 账户与云端数据层（WorkBuddy Cloud Service）
   - 登录（WorkBuddy 账号登录）/ 会话恢复 / 退出
   - 办事卡：云端 Database（每人私有，RLS 隔离）
   - 提醒：云端 reminders + 浏览器通知调度 + 提醒中心
   本文件自包含，依赖全局 WorkBuddyCloud（vendor 已加载）。
   ============================================================ */
(function () {
  'use strict';

  var CONFIG = {
    endpoint: 'https://taskcard.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_XrK8n6IQEOHB04l0XXM43T_eDX1vpYPmfGHVg7fhG9vbQ0dTD7zblls'
  };

  var cloud = null;
  function getCloud() {
    if (!cloud) cloud = window.WorkBuddyCloud.createWorkBuddyCloud(CONFIG);
    return cloud;
  }

  var session = null;
  var user = null;
  var mode = 'checking'; // checking | cloud | anon | local | nosdk
  var listeners = [];
  var notifCheckTimer = null;

  function setMode(m) {
    mode = m;
    emit();
    updateTopbar();
    updateOverlay();
  }
  function emit() {
    var snap = { mode: mode, user: user, session: session };
    listeners.forEach(function (fn) { try { fn(snap); } catch (e) {} });
  }
  function onChange(fn) { listeners.push(fn); }
  function getMode() { return mode; }
  function getSession() { return session; }
  function getUser() { return user; }

  /* ---------------- 鉴权 ---------------- */

  // 从完整地址栏里取参数，比 URL.search 更稳：
  // 1) 不依赖 relay 是用 ? 还是 & 拼接（避免 sharecode 已带 ? 时把 code 拼成 ?code 导致解析失败）
  // 2) sharecode 作为首个参数，遇到后续 ? 即截断，避免被后续参数污染
  function extractParam(name, stopAtQuestion) {
    var cls = stopAtQuestion ? '[^&#?]' : '[^&#]';
    var re = new RegExp('[?&]' + name + '=(' + cls + '+)');
    var m = re.exec(location.href);
    if (!m) return null;
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return m[1]; }
  }

  function cleanAddressBar() {
    var sc = extractParam('sharecode', true) || 'N5KJMMD5OJ';
    var base = location.origin + location.pathname + '?sharecode=' + sc;
    try { history.replaceState(null, '', base); } catch (e) {}
  }

  function handleCallback() {
    var code = extractParam('code');
    var err = extractParam('error');
    if (!code && !err) return Promise.resolve(false);

    // 重建一条干净、SDK 可解析的回调 URL（无论 relay 拼接方式如何都不会损坏）。
    // workbuddy 登录的回调只需 code + state，且不能带 provider_id=custom-oauth。
    var state = extractParam('state') || '';
    var clean = location.origin + location.pathname +
      '?code=' + encodeURIComponent(code || '') +
      '&state=' + encodeURIComponent(state) +
      '&provider=workbuddy';
    if (err) clean += '&error=' + encodeURIComponent(err);

    return getCloud().auth.handleWorkBuddyCallback(clean).then(function (res) {
      if (res.error) { cleanAddressBar(); setMode('anon'); return true; }
      if (res.data) {
        session = res.data;
        user = (res.data && res.data.user) || null;
        setMode('cloud');
        cleanAddressBar();
      }
      return true;
    }).catch(function () {
      cleanAddressBar();
      setMode('anon');
      return true;
    });
  }

  function restore() {
    return getCloud().auth.getSession().then(function (res) {
      if (res.error) { setMode('anon'); return; }
      if (res.data) {
        session = res.data;
        user = (res.data && res.data.user) || null;
        setMode('cloud');
      } else {
        setMode('anon');
      }
    }).catch(function () { setMode('anon'); });
  }

  function signIn() {
    if (mode === 'nosdk') { toast('云后端未加载，请刷新重试'); return Promise.resolve(); }
    var sc = extractParam('sharecode', true) || 'N5KJMMD5OJ';
    var redirectTo = location.origin + location.pathname + '?sharecode=' + sc;
    return getCloud().auth.signInWithOAuth({ provider: 'workbuddy', redirectTo: redirectTo }).then(function (res) {
      if (res.error) { toast('登录发起失败：' + res.error.message); return; }
      if (res.data && res.data.url) location.assign(res.data.url);
    }).catch(function (e) {
      toast('登录发起失败，请重试');
    });
  }

  function signOut() {
    return getCloud().auth.signOut().then(function () {
      session = null; user = null; setMode('anon');
    }).catch(function () { session = null; user = null; setMode('anon'); });
  }

  /* ---------------- 办事卡（云端） ---------------- */

  function listCards() {
    return getCloud().database.from('cards').select('*').order('created_at', { ascending: false });
  }
  function saveCard(cardObj) {
    var row = {
      title: cardObj.title || '未命名',
      category: cardObj.category || '其他',
      deadline: cardObj.deadlineISO || null,
      card_json: cardObj.card,
      owner_name: (user && user.name) || null
    };
    return getCloud().database.from('cards').insert(row).select();
  }
  function removeCard(id) {
    return getCloud().database.from('cards').delete().eq('id', id).select();
  }

  /* ---------------- 提醒（云端） ---------------- */

  function setReminder(cardId, remindAtISO, label) {
    return getCloud().database.from('reminders').insert({
      card_id: cardId,
      remind_at: remindAtISO,
      lead_label: label || null
    }).select();
  }
  function listReminders() {
    return getCloud().database.from('reminders').select('*, cards(title, category)').order('remind_at', { ascending: true });
  }
  function markNotified(id) {
    return getCloud().database.from('reminders').update({ notified: true }).eq('id', id);
  }

  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function dayBefore(iso, n) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() - n);
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function openSetForCard(cardId, deadlineISO) {
    if (mode !== 'cloud') { toast('请先登录并保存卡片到云端'); return; }
    if (!cardId || !deadlineISO) { toast('缺少卡片或日期信息'); return; }
    closeReminderCenter();
    var existing = document.getElementById('radarRemindDlg');
    if (existing) existing.parentNode.removeChild(existing);
    var scrim = document.createElement('div');
    scrim.id = 'radarRemindDlg';
    scrim.className = 'remind-dialog-scrim';
    var dlg = document.createElement('div');
    dlg.className = 'remind-dialog';
    var h = document.createElement('div');
    h.className = 'remind-dialog-title';
    h.textContent = '设置提醒';
    dlg.appendChild(h);
    var sub = document.createElement('div');
    sub.className = 'remind-dialog-sub';
    sub.textContent = '办理日期 ' + deadlineISO + '，选择提醒时间（云端同步，手机/电脑通用）：';
    dlg.appendChild(sub);

    var presets = [
      { text: '提前 1 天（' + dayBefore(deadlineISO, 1) + ' 09:00）', iso: dayBefore(deadlineISO, 1) + 'T09:00' },
      { text: '截止当天 09:00', iso: deadlineISO + 'T09:00' },
      { text: '截止当天 18:00', iso: deadlineISO + 'T18:00' },
      { text: '自定义日期时间…', iso: null }
    ];
    presets.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'remind-opt';
      b.textContent = p.text;
      b.addEventListener('click', function () {
        var target = p.iso;
        if (!target) {
          var input = window.prompt('输入提醒时间（格式 YYYY-MM-DDTHH:MM，24 小时制）', deadlineISO + 'T09:00');
          if (!input) return;
          target = input;
        }
        commit(cardId, target, p.text);
      });
      dlg.appendChild(b);
    });
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'remind-opt remind-opt-cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', function () { closeDlg(); });
    dlg.appendChild(cancel);

    scrim.appendChild(dlg);
    scrim.addEventListener('click', function (e) { if (e.target === scrim) closeDlg(); });
    document.body.appendChild(scrim);

    function closeDlg() { if (scrim.parentNode) scrim.parentNode.removeChild(scrim); }
    function commit(id, iso, label) {
      setReminder(id, iso, label).then(function (res) {
        closeDlg();
        if (res.error) { toast('提醒设置失败：' + res.error.message); return; }
        toast('提醒已设置（云端同步）');
        refreshReminderCenter();
      }).catch(function () { toast('提醒设置失败'); });
    }
  }

  /* ---------------- 浏览器通知 ---------------- */

  function getNotifPerm() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
  }
  function requestNotifPerm() {
    if (!('Notification' in window)) return Promise.resolve('unsupported');
    if (Notification.permission === 'granted') return Promise.resolve('granted');
    if (Notification.permission === 'denied') return Promise.resolve('denied');
    return Notification.requestPermission().then(function (p) { return p; }).catch(function () { return 'denied'; });
  }
  function fireNotification(title, body) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return false;
      var n = new Notification(title, { body: body, tag: 'taskcard-reminder', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect x=%224%22 y=%222.5%22 width=%2224%22 height=%2227%22 rx=%225%22 fill=%22%231E7A63%22/%3E%3Cpath d=%22M10 11h12M10 16.5h8%22 stroke=%22%23FFFFFF%22 stroke-width=%222.2%22/%3E%3C/sec%3E%3C/svg%3E' });
      n.onclick = function () { window.focus(); n.close(); };
      return true;
    } catch (e) { return false; }
  }
  function inQuietHours() {
    try {
      var q = JSON.parse(localStorage.getItem('taskcard.radar.settings.v1') || '{}');
      if (!q.quietEnabled) return false;
      var now = new Date();
      var hm = now.getHours() * 60 + now.getMinutes();
      var start = parseHM(q.quietStart || '22:00');
      var end = parseHM(q.quietEnd || '08:00');
      if (start === end) return false;
      if (start < end) return hm >= start && hm < end;
      return hm >= start || hm < end;
    } catch (e) { return false; }
  }
  function parseHM(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
    if (!m) return 0;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  function checkDueReminders() {
    if (mode !== 'cloud') return;
    if (document.visibilityState !== 'visible') return;
    if (getNotifPerm() !== 'granted') return;
    if (inQuietHours()) return;
    var now = new Date();
    listReminders().then(function (res) {
      if (res.error || !res.data) return;
      res.data.forEach(function (r) {
        if (r.notified) return;
        var t = new Date(r.remind_at);
        if (isNaN(t.getTime())) return;
        if (t.getTime() <= now.getTime() + 30000) {
          var title = '办事雷达提醒：' + ((r.cards && r.cards.title) || '待办事项');
          var body = '截止/办理时间：' + (r.lead_label ? (r.lead_label + ' · ') : '') + fmtLocal(t);
          if (fireNotification(title, body)) {
            markNotified(r.id).catch(function () {});
          }
        }
      });
    }).catch(function () {});
  }
  function fmtLocal(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------------- UI：顶栏 / 登录遮罩 / 提醒中心 ---------------- */

  function $(id) { return document.getElementById(id); }
  function toast(msg) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function updateTopbar() {
    var badge = $('accountBadge');
    if (!badge) return;
    if (mode === 'cloud' && user) {
      badge.hidden = false;
      badge.innerHTML = '';
      var name = document.createElement('span');
      name.textContent = (user.name || '已登录').slice(0, 10);
      badge.appendChild(name);
      var out = document.createElement('button');
      out.type = 'button';
      out.className = 'btn btn-ghost btn-sm';
      out.textContent = '退出';
      out.addEventListener('click', function () { signOut(); });
      badge.appendChild(out);
    } else if (mode === 'cloud') {
      badge.hidden = false;
      badge.innerHTML = '<span>已登录</span><button type="button" class="btn btn-ghost btn-sm" id="topLogout">退出</button>';
      var lo = $('topLogout');
      if (lo) lo.addEventListener('click', function () { signOut(); });
    } else if (mode === 'anon' || mode === 'local') {
      badge.hidden = false;
      badge.innerHTML = '<button type="button" class="btn btn-primary btn-sm" id="topLogin">登录</button>';
      var l = $('topLogin');
      if (l) l.addEventListener('click', showOverlay);
    } else {
      badge.hidden = true;
    }
  }

  function updateOverlay() {
    var ov = $('loginOverlay');
    if (!ov) return;
    if (mode === 'anon' || mode === 'local') ov.hidden = false;
    else ov.hidden = true;
  }
  function showOverlay() {
    var ov = $('loginOverlay');
    if (ov) ov.hidden = false;
  }
  function hideOverlay() {
    var ov = $('loginOverlay');
    if (ov) ov.hidden = true;
  }

  function openReminderCenter() {
    refreshReminderCenter();
    var scrim = $('reminderScrim');
    var drawer = $('reminderDrawer');
    if (scrim) scrim.hidden = false;
    if (drawer) drawer.hidden = false;
  }
  function closeReminderCenter() {
    var scrim = $('reminderScrim');
    var drawer = $('reminderDrawer');
    if (scrim) scrim.hidden = true;
    if (drawer) drawer.hidden = true;
  }
  function refreshReminderCenter() {
    var list = $('reminderList');
    var note = $('reminderNote');
    if (!list) return;
    if (mode !== 'cloud') {
      if (note) note.textContent = '登录后可查看与设置跨设备提醒。';
      list.innerHTML = '';
      return;
    }
    list.innerHTML = '<div class="saved-item-meta">加载中…</div>';
    listReminders().then(function (res) {
      if (res.error) { list.innerHTML = '<div class="saved-item-meta">读取失败：' + res.error.message + '</div>'; return; }
      var rows = res.data || [];
      if (!rows.length) {
        list.innerHTML = '';
        if (note) note.textContent = '还没有设置提醒。在办事卡结果页点「设置提醒」即可添加。';
        return;
      }
      if (note) note.textContent = '共 ' + rows.length + ' 条提醒（云端，手机/电脑同步）。';
      list.innerHTML = '';
      var now = new Date();
      rows.forEach(function (r) {
        var t = new Date(r.remind_at);
        var overdue = t.getTime() < now.getTime();
        var box = document.createElement('div');
        box.className = 'saved-item';
        var title = document.createElement('div');
        title.className = 'saved-item-title';
        title.textContent = ((r.cards && r.cards.title) || '待办事项') + (overdue ? '（已到期）' : '');
        box.appendChild(title);
        var meta = document.createElement('div');
        meta.className = 'saved-item-meta';
        meta.textContent = (r.lead_label ? (r.lead_label + ' · ') : '') + fmtLocal(t) + (r.notified ? ' · 已提醒' : '');
        box.appendChild(meta);
        var ops = document.createElement('div');
        ops.className = 'saved-item-ops';
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn-ghost btn-sm';
        del.textContent = '删除';
        del.addEventListener('click', function () {
          getCloud().database.from('reminders').delete().eq('id', r.id).select().then(function () { refreshReminderCenter(); });
        });
        ops.appendChild(del);
        box.appendChild(ops);
        list.appendChild(box);
      });
    }).catch(function () {
      list.innerHTML = '<div class="saved-item-meta">读取失败</div>';
    });
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    if (!window.WorkBuddyCloud || !window.WorkBuddyCloud.createWorkBuddyCloud) {
      setMode('nosdk');
      return;
    }
    // 绑定登录遮罩按钮
    var loginBtn = $('overlayLoginBtn');
    if (loginBtn) loginBtn.addEventListener('click', function () { signIn(); });
    var skipBtn = $('overlaySkipBtn');
    if (skipBtn) skipBtn.addEventListener('click', function () { setMode('local'); });
    // 绑定提醒中心
    var navRemind = $('navRemindBtn');
    if (navRemind) navRemind.addEventListener('click', openReminderCenter);
    var remClose = $('reminderCloseBtn');
    if (remClose) remClose.addEventListener('click', closeReminderCenter);
    var remScrim = $('reminderScrim');
    if (remScrim) remScrim.addEventListener('click', closeReminderCenter);
    var remTest = $('reminderTestBtn');
    if (remTest) remTest.addEventListener('click', function () {
      requestNotifPerm().then(function (p) {
        if (p === 'granted') { fireNotification('办事雷达提醒（测试）', '这是一条测试提醒，说明浏览器通知已可用。'); }
        else { toast('请先在浏览器允许通知权限'); }
      });
    });

    handleCallback().then(function (handled) {
      if (handled) return;
      return restore().then(function () {
        if (mode === 'cloud') { hideOverlay(); startNotifLoop(); }
        else { showOverlay(); }
      });
    });
  }

  function startNotifLoop() {
    if (notifCheckTimer) return;
    notifCheckTimer = setInterval(checkDueReminders, 30000);
    checkDueReminders();
  }

  onChange(function (snap) {
    if (snap.mode === 'cloud') { startNotifLoop(); }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ---------------- 暴露接口给 app.js ---------------- */
  window.RadarAccount = {
    init: init,
    signIn: signIn,
    signOut: signOut,
    getMode: getMode,
    getUser: getUser,
    getSession: getSession,
    onChange: onChange,
    _cloud: getCloud,
    showOverlay: showOverlay
  };
  window.RadarCards = { list: listCards, save: saveCard, remove: removeCard };
  window.RadarReminders = { setForCard: setReminder, list: listReminders, markNotified: markNotified, openSetForCard: openSetForCard };
  window.RadarNotify = { getPerm: getNotifPerm, request: requestNotifPerm, fmtLocal: fmtLocal };
})();

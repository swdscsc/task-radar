const store = require('../../utils/store.js');

function buildPlainText(card) {
    const lines = [];
    lines.push('【' + (card.title || '办事卡') + '】');
    if (card.summary) lines.push(card.summary);
    lines.push('');
    if (card.deadline && card.deadline.original_text) {
        lines.push('截止：' + card.deadline.original_text +
            (card.deadline.needs_confirmation ? '（需确认）' : ''));
    }
    if (card.tasks && card.tasks.length) {
        lines.push('');
        lines.push('待办：');
        card.tasks.forEach(function (t, i) {
            lines.push((i + 1) + '. ' + t.title + (t.completed ? ' ✓' : '') +
                (t.needs_confirmation ? '（需确认）' : ''));
        });
    }
    if (card.materials && card.materials.length) {
        lines.push('');
        lines.push('材料：');
        card.materials.forEach(function (m, i) {
            lines.push((i + 1) + '. ' + m.name + (m.completed ? ' ✓' : '') +
                (m.needs_confirmation ? '（需确认）' : ''));
        });
    }
    if (card.steps && card.steps.length) {
        lines.push('');
        lines.push('步骤：');
        card.steps.forEach(function (s, i) {
            lines.push((i + 1) + '. ' + s.text);
        });
    }
    if (card.questions_to_confirm && card.questions_to_confirm.length) {
        lines.push('');
        lines.push('需确认：');
        card.questions_to_confirm.forEach(function (q, i) {
            lines.push((i + 1) + '. ' + q.question + '：' + (q.reason || ''));
        });
    }
    return lines.join('\n');
}

function fmtDate(ts) {
    const d = new Date(ts);
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
        ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

Page({
    data: {
        dark: false,
        cards: [],
        viewState: 'list',
        card: null,
        selectedId: null
    },

    onShow: function () {
        this.applyAppearance();
        this.refresh();
    },

    applyAppearance: function () {
        let mode = 'system';
        try { mode = wx.getStorageSync('taskcard.appearance') || 'system'; } catch (e) {}
        let dark = mode === 'dark';
        if (mode === 'system') {
            try {
                const info = wx.getSystemInfoSync();
                dark = info.theme === 'dark';
            } catch (e) {}
        }
        this.setData({ dark: dark });
    },

    refresh: function () {
        const cards = store.getCards().map(function (c) {
            return {
                id: c.id,
                title: c.card.title || '未命名办事卡',
                category: c.card.category || '其他',
                createdText: fmtDate(c.createdAt),
                deadline: (c.card.deadline && c.card.deadline.original_text) || '',
                taskCount: (c.card.tasks || []).length
            };
        });
        this.setData({ cards: cards });
    },

    openCard: function (e) {
        const id = e.currentTarget.dataset.id;
        const all = store.getCards();
        const found = all.filter(function (c) { return c.id === id; })[0];
        if (!found) return;
        this.setData({ viewState: 'detail', card: found.card, selectedId: id });
    },

    toggleTask: function (e) {
        const i = e.currentTarget.dataset.index;
        const card = this.data.card;
        if (!card || !card.tasks[i]) return;
        const key = 'card.tasks[' + i + '].completed';
        this.setData({ [key]: !card.tasks[i].completed });
        store.updateCard(this.data.selectedId, this.data.card);
    },

    toggleMaterial: function (e) {
        const i = e.currentTarget.dataset.index;
        const card = this.data.card;
        if (!card || !card.materials[i]) return;
        const key = 'card.materials[' + i + '].completed';
        this.setData({ [key]: !card.materials[i].completed });
        store.updateCard(this.data.selectedId, this.data.card);
    },

    copyCard: function () {
        wx.setClipboardData({
            data: buildPlainText(this.data.card),
            success: function () {
                wx.showToast({ title: '已复制', icon: 'success' });
            }
        });
    },

    deleteCard: function () {
        const id = this.data.selectedId;
        const that = this;
        wx.showModal({
            title: '删除这张卡',
            content: '删除后无法恢复',
            confirmColor: '#DC2626',
            success: function (r) {
                if (r.confirm) {
                    store.removeCard(id);
                    that.setData({ viewState: 'list', card: null, selectedId: null });
                    that.refresh();
                    wx.showToast({ title: '已删除', icon: 'success' });
                }
            }
        });
    },

    backToList: function () {
        this.setData({ viewState: 'list', card: null, selectedId: null });
    }
});

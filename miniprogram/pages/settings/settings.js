const store = require('../../utils/store.js');

Page({
    data: {
        dark: false,
        appearance: 'system',
        appearanceOptions: [
            { mode: 'system', label: '跟随系统' },
            { mode: 'light', label: '浅色' },
            { mode: 'dark', label: '深色' }
        ],
        cardCount: 0
    },

    onShow: function () {
        let mode = 'system';
        try { mode = wx.getStorageSync('taskcard.appearance') || 'system'; } catch (e) {}
        this.setData({ appearance: mode, cardCount: store.getCards().length });
        this.applyAppearance(mode);
    },

    applyAppearance: function (mode) {
        let dark = mode === 'dark';
        if (mode === 'system') {
            try {
                const info = wx.getSystemInfoSync();
                dark = info.theme === 'dark';
            } catch (e) {}
        }
        this.setData({ dark: dark });
    },

    setAppearance: function (e) {
        const mode = e.currentTarget.dataset.mode;
        try { wx.setStorageSync('taskcard.appearance', mode); } catch (err) {}
        this.setData({ appearance: mode });
        this.applyAppearance(mode);
        wx.showToast({ title: '已设置', icon: 'success' });
    },

    clearAll: function () {
        const that = this;
        if (this.data.cardCount === 0) {
            wx.showToast({ title: '没有可清空的卡', icon: 'none' });
            return;
        }
        wx.showModal({
            title: '清空所有卡',
            content: '将删除本机保存的全部办事卡，且无法恢复。',
            confirmColor: '#DC2626',
            success: function (r) {
                if (r.confirm) {
                    store.clearAll();
                    that.setData({ cardCount: 0 });
                    wx.showToast({ title: '已清空', icon: 'success' });
                }
            }
        });
    },

    copyContact: function () {
        wx.setClipboardData({
            data: '办事雷达 · TaskCard',
            success: function () {
                wx.showToast({ title: '已复制名称', icon: 'success' });
            }
        });
    }
});

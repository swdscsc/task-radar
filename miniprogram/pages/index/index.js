const api = require('../../utils/api.js');
const ocr = require('../../utils/ocr.js');
const cloud = require('../../utils/cloud.js');

const SAMPLES = require('../../utils/samples.js');

Page({
    data: {
        dark: false,
        inputText: '',
        charCount: 0,
        maxLen: 5000,
        parsing: false,
        ocrLoading: false,
        viewState: 'input',
        card: null,
        errorMsg: '',
        savedId: null,
        samplePreview: false,
        samples: SAMPLES
    },

    onLoad: function () {
        this.applyAppearance();
    },

    onShow: function () {
        this.applyAppearance();
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

    onInput: function (e) {
        const v = e.detail.value || '';
        this.setData({ inputText: v, charCount: v.length });
    },

    useSample: function (e) {
        const id = e.currentTarget.dataset.id;
        const s = SAMPLES.filter(function (x) { return x.id === id; })[0];
        if (!s) return;
        this.setData({ inputText: s.text, charCount: s.text.length, viewState: 'input', samplePreview: false });
    },

    previewSample: function (e) {
        const id = e.currentTarget.dataset.id;
        const s = SAMPLES.filter(function (x) { return x.id === id; })[0];
        if (!s || !s.card) return;
        this.setData({ viewState: 'result', card: s.card, savedId: null, samplePreview: true, errorMsg: '' });
    },

    clearInput: function () {
        this.setData({ inputText: '', charCount: 0 });
    },

    chooseScreenshot: function () {
        const that = this;
        wx.chooseMedia({
            count: 1,
            mediaType: ['image'],
            sourceType: ['album', 'camera'],
            sizeType: ['compressed'],
            success: function (res) {
                const file = res.tempFiles && res.tempFiles[0];
                if (!file) return;
                that.setData({ ocrLoading: true });
                ocr.recognizeImage(file.tempFilePath).then(function (text) {
                    const trimmed = (text || '').trim();
                    if (!trimmed) {
                        wx.showToast({ title: '没识别出文字，请手填', icon: 'none' });
                        that.setData({ ocrLoading: false });
                        return;
                    }
                    that.setData({
                        inputText: trimmed,
                        charCount: trimmed.length,
                        ocrLoading: false
                    });
                    wx.showToast({ title: '识别完成', icon: 'success' });
                }).catch(function (err) {
                    that.setData({ ocrLoading: false });
                    wx.showToast({
                        title: 'OCR 不可用，请手动粘贴',
                        icon: 'none'
                    });
                    console.error('OCR failed', err);
                });
            },
            fail: function () {}
        });
    },

    generate: function () {
        const text = (this.data.inputText || '').trim();
        if (!text) {
            wx.showToast({ title: '请先粘贴或截图通知', icon: 'none' });
            return;
        }
        const that = this;
        that.setData({ parsing: true, errorMsg: '' });
        api.parseNotice(text).then(function (card) {
            card.source_text = text;
            that.setData({ parsing: false, viewState: 'result', card: card, savedId: null, samplePreview: false });
        }).catch(function (err) {
            let msg = '解析失败，请重试';
            if (err && err.errMsg) {
                if (/timeout/i.test(err.errMsg)) msg = '请求超时，请重试';
                else if (/fail/i.test(err.errMsg)) msg = '网络异常，请检查后重试';
            }
            that.setData({ parsing: false, errorMsg: msg });
        });
    },

    toggleTask: function (e) {
        const i = e.currentTarget.dataset.index;
        const card = this.data.card;
        if (!card || !card.tasks[i]) return;
        const key = 'card.tasks[' + i + '].completed';
        const val = !card.tasks[i].completed;
        this.setData({ [key]: val });
        this.persistIfSaved();
    },

    toggleMaterial: function (e) {
        const i = e.currentTarget.dataset.index;
        const card = this.data.card;
        if (!card || !card.materials[i]) return;
        const key = 'card.materials[' + i + '].completed';
        const val = !card.materials[i].completed;
        this.setData({ [key]: val });
        this.persistIfSaved();
    },

    persistIfSaved: function () {
        const id = this.data.savedId;
        if (!id) return;
        cloud.updateCard(id, this.data.card).catch(function (e) {
            console.error('updateCard failed', e);
        });
    },

    saveCard: function () {
        if (this.data.samplePreview) {
            wx.showToast({ title: '示例预览不可保存', icon: 'none' });
            return;
        }
        const card = this.data.card;
        if (!card) return;
        wx.showLoading({ title: '保存中' });
        cloud.saveCard({ cardJson: card }).then(function (item) {
            wx.hideLoading();
            this.setData({ savedId: item.id });
            wx.showToast({
                title: cloud.getMode() === 'cloud' ? '已存云端' : '已存本地',
                icon: 'success'
            });
        }.bind(this)).catch(function (err) {
            wx.hideLoading();
            console.error('saveCard failed', err);
            wx.showToast({ title: '保存失败', icon: 'none' });
        });
    },

    buildPlainText: function (card) {
        let lines = [];
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
                lines.push((i + 1) + '. ' + t.title +
                    (t.completed ? ' ✓' : '') +
                    (t.needs_confirmation ? '（需确认）' : ''));
            });
        }
        if (card.materials && card.materials.length) {
            lines.push('');
            lines.push('材料：');
            card.materials.forEach(function (m, i) {
                lines.push((i + 1) + '. ' + m.name +
                    (m.completed ? ' ✓' : '') +
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
    },

    copyCard: function () {
        const text = this.buildPlainText(this.data.card);
        wx.setClipboardData({
            data: text,
            success: function () {
                wx.showToast({ title: '已复制', icon: 'success' });
            }
        });
    },

    back: function () {
        this.setData({ viewState: 'input', card: null, errorMsg: '', samplePreview: false });
    }
});

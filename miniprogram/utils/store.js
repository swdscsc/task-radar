// 本地存储：已保存的办事卡
const STORAGE_KEY = 'taskcard.saved.v1';

function getCards() {
    try {
        return wx.getStorageSync(STORAGE_KEY) || [];
    } catch (e) {
        return [];
    }
}

function saveCard(card) {
    const list = getCards();
    const item = {
        id: 'c' + Date.now(),
        createdAt: Date.now(),
        card: card
    };
    list.unshift(item);
    try {
        wx.setStorageSync(STORAGE_KEY, list);
    } catch (e) {}
    return item;
}

function removeCard(id) {
    const next = getCards().filter(function (c) { return c.id !== id; });
    try {
        wx.setStorageSync(STORAGE_KEY, next);
    } catch (e) {}
    return next;
}

function updateCard(id, card) {
    const next = getCards().map(function (c) {
        if (c.id === id) return { id: id, createdAt: c.createdAt, card: card };
        return c;
    });
    try {
        wx.setStorageSync(STORAGE_KEY, next);
    } catch (e) {}
    return next;
}

function clearAll() {
    try {
        wx.setStorageSync(STORAGE_KEY, []);
    } catch (e) {}
}

module.exports = { getCards, saveCard, removeCard, updateCard, clearAll };

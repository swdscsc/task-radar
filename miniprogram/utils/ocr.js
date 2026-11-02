// 截图识别：微信自带 OCR（免费，需在微信公众平台添加"微信OCR"插件）
// 返回识别出的纯文本。若插件不可用，调用方应回退到手动粘贴。
const OCR_SERVICE = 'wx79ac3a8c47e54be9';
const OCR_API = 'nlp_ocr';

function recognizeImage(tempFilePath) {
    return new Promise(function (resolve, reject) {
        wx.getFileSystemManager().readFile({
            filePath: tempFilePath,
            encoding: 'base64',
            success: function (res) {
                const base64 = res.data;
                wx.serviceMarket.invokeService({
                    service: OCR_SERVICE,
                    api: OCR_API,
                    data: { img: base64 },
                    success: function (r) {
                        const data = r.data || {};
                        if (data.errcode && data.errcode !== 0) {
                            reject(new Error('OCR_ERR_' + data.errcode));
                            return;
                        }
                        const list = data.ocr_list || [];
                        const text = list
                            .map(function (item) { return item.text || ''; })
                            .join('\n');
                        resolve(text);
                    },
                    fail: function (e) {
                        reject(e);
                    }
                });
            },
            fail: function (e) {
                reject(e);
            }
        });
    });
}

module.exports = { recognizeImage };

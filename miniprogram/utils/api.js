// AI 解析：复用已发布站点自带的免费接口（无需云服务、无需密钥）
// 该接口只支持流式 SSE，小程序用 wx.request 接收完整 body 后解析 data: 行。
const ENDPOINT = 'https://taskcard.app.workbuddy.host';
const PUBLISHABLE_KEY = 'wbpk_XrK8n6IQEOHB04l0XXM43T_eDX1vpYPmfGHVg7fhG9vbQ0dTD7zblls';
const MODEL_ID = 'deepseek-v4-flash';
const { SYSTEM_PROMPT, REPAIR_HINT } = require('./system-prompt.js');

function extractJson(raw) {
    if (!raw) throw new Error('INVALID_JSON');
    let s = String(raw).trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw new Error('INVALID_JSON');
    try {
        return JSON.parse(s.slice(start, end + 1));
    } catch (e) {
        throw new Error('INVALID_JSON');
    }
}

function validateShape(obj) {
    const problems = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        problems.push('返回内容不是对象');
        return problems;
    }
    if (typeof obj.title !== 'string') problems.push('缺少 title');
    if (typeof obj.summary !== 'string') problems.push('缺少 summary');
    if (typeof obj.category !== 'string') problems.push('缺少 category');
    if (!obj.deadline || typeof obj.deadline !== 'object') problems.push('缺少 deadline');
    else {
        if (typeof obj.deadline.original_text !== 'string') problems.push('缺少 deadline.original_text');
        if (!('normalized_date' in obj.deadline)) problems.push('缺少 deadline.normalized_date');
        if (typeof obj.deadline.needs_confirmation !== 'boolean') problems.push('缺少 deadline.needs_confirmation');
    }
    ['tasks', 'materials', 'steps', 'questions_to_confirm'].forEach(function (k) {
        if (!Array.isArray(obj[k])) problems.push('缺少 ' + k + ' 数组');
    });
    if (Array.isArray(obj.tasks)) {
        obj.tasks.forEach(function (t, i) {
            if (!t || typeof t.title !== 'string') problems.push('tasks[' + i + '].title 无效');
        });
    }
    if (Array.isArray(obj.materials)) {
        obj.materials.forEach(function (m, i) {
            if (!m || typeof m.name !== 'string') problems.push('materials[' + i + '].name 无效');
        });
    }
    if (Array.isArray(obj.steps)) {
        obj.steps.forEach(function (s, i) {
            if (!s || typeof s.text !== 'string') problems.push('steps[' + i + '].text 无效');
        });
    }
    if (Array.isArray(obj.questions_to_confirm)) {
        obj.questions_to_confirm.forEach(function (q, i) {
            if (!q || typeof q.question !== 'string') problems.push('questions_to_confirm[' + i + '].question 无效');
        });
    }
    return problems;
}

// 把 SSE 文本（多行 data: {...}）累积为模型输出的完整文本
function parseSSE(sse) {
    const lines = String(sse).split('\n');
    let out = '';
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
            const json = JSON.parse(payload);
            const delta = json.choices && json.choices[0] && json.choices[0].delta;
            if (delta && delta.content) out += delta.content;
        } catch (e) {
            // 跳过无法解析的分片
        }
    }
    return out;
}

function callOnce(text, repairInstruction) {
    return new Promise(function (resolve, reject) {
        wx.request({
            url: ENDPOINT + '/.cloud/llm/chat/completions',
            method: 'POST',
            timeout: 60000,
            header: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
                'x-wb-webapp-access-key': PUBLISHABLE_KEY
            },
            data: {
                model: MODEL_ID,
                stream: true,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: repairInstruction ? (repairInstruction + '\n\n原始通知：\n' + text) : text }
                ]
            },
            success: function (res) {
                if (res.statusCode !== 200) {
                    reject(new Error('HTTP_' + res.statusCode));
                    return;
                }
                try {
                    const content = parseSSE(res.data);
                    const obj = extractJson(content);
                    const problems = validateShape(obj);
                    if (problems.length) {
                        if (!repairInstruction) {
                            // 触发一次修复重试
                            callOnce(text, REPAIR_HINT).then(resolve, reject);
                        } else {
                            reject(new Error('INVALID_SHAPE'));
                        }
                        return;
                    }
                    resolve(obj);
                } catch (e) {
                    if (!repairInstruction) {
                        callOnce(text, REPAIR_HINT).then(resolve, reject);
                    } else {
                        reject(e);
                    }
                }
            },
            fail: function (err) {
                reject(err);
            }
        });
    });
}

// 对外：传入通知文本，返回解析后的办事卡对象
function parseNotice(text) {
    return callOnce(text, null);
}

module.exports = { parseNotice, extractJson, validateShape };

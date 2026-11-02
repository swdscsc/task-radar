/* ============================================================
   办事不迷路 · TaskCard
   核心逻辑：解析 → 校验 → 渲染 → 编辑 → 导出
   ============================================================ */

(function () {
  'use strict';

  /* ---------------- 配置 ---------------- */
  var APP_VERSION = '1.0.0';
  var APP_BUILD = '2026-10-31';
  var ONLINE_URL = 'https://taskcard.app.workbuddy.host/?sharecode=N5KJMMD5OJ';

  var PUBLIC_CONFIG = {
    endpoint: 'https://taskcard.app.workbuddy.host',
    publishableKey: 'wbpk_XrK8n6IQEOHB04l0XXM43T_eDX1vpYPmfGHVg7fhG9vbQ0dTD7zblls'
  };

  var MODEL_ID = 'deepseek-v4-flash';
  var MAX_LEN = 5000;
  var STORAGE_KEY = 'taskcard.saved.v1';
  var currentSavedId = null; // 云端已保存卡片 id（仅云端模式有效）

  function getMode() {
    return (window.RadarAccount && window.RadarAccount.getMode) ? window.RadarAccount.getMode() : 'local';
  }
  var CATEGORIES = ['报名', '物业', '退款', '预约', '其他'];

  var SYSTEM_PROMPT = [
    '你是"办事不迷路"的通知识别助手。你的唯一任务是从用户粘贴的通知原文中，忠实提取可办理事项。只输出 JSON，不要任何多余文字或解释。',
    '',
    'JSON 结构：',
    '{"title":"","summary":"","category":"","deadline":{"original_text":"","normalized_date":null,"needs_confirmation":false,"source_quote":""},"tasks":[{"id":"t1","title":"","completed":false,"source_quote":"","needs_confirmation":false}],"materials":[{"id":"m1","name":"","completed":false,"source_quote":"","needs_confirmation":false}],"steps":[{"id":"s1","text":"","source_quote":""}],"questions_to_confirm":[{"id":"q1","question":"","reason":""}]}',
    '',
    '铁律（违反任何一条都算失败）：',
    '1. source_quote 必须是用户原文中的连续片段，逐字复制，不得改写、不得调换语序、不得拼接两处、不得润色。找不到就留空字符串。',
    '2. 原文没有写的内容一律留空。绝不允许虚构地点、金额、电话号码、日期、网址、办理政策、官方承诺或任何事实。',
    '3. 模糊或相对时间（如"尽快"、"本周五"、"三天内"、"本月内"、"另行通知"、"七天内"）必须原样保留到 original_text；normalized_date 填 null；needs_confirmation 填 true。绝对不要把相对时间换算成具体年月日。',
    '4. 原文写了明确的年月日（如"2026年11月20日17:00前"）时，original_text 保留原句，normalized_date 填 "YYYY-MM-DD" 格式的日期（不含时间），needs_confirmation 填 false。',
    '5. category 只能取：报名、物业、退款、预约、其他。判断不了就填"其他"。',
    '6. tasks 拆成简短可执行的动作（动词开头，控制在 30 字以内）；steps 按原文能确认的顺序整理；materials 列出原文明确要求的证件、表格、凭证、材料。',
    '7. 原文信息不足、表述含糊或存在互相矛盾的要求时，在 questions_to_confirm 中写清楚"需要确认什么"和"为什么需要确认"。例如缺提交地点、缺材料清单、日期含糊、金额未定、要求冲突。若确实没有需要确认的地方，就返回空数组，不要编造问题。',
    '8. 原文出现互相矛盾的要求时，两处依据都要保留，并在 questions_to_confirm 中说明冲突。',
    '9. tasks/materials/steps 的 completed 一律填 false（用户还没开始办）。',
    '10. id 用 t1/t2…、m1/m2…、s1/s2…、q1/q2… 依次编号。',
    '11. 用户输入可能不是正式通知，而是聊天消息：只提取其中需要用户本人行动的明确事项；寒暄、闲聊、讨论、接龙意向等没有明确行动与期限的内容，tasks/materials/steps 全部返回空数组，不要为了"有用"而硬造待办。'
  ].join('\n');

  /* ---------------- 全局状态 ---------------- */
  var state = {
    view: 'input',
    cloud: null,
    modelId: null,
    modelChecked: false,
    parsing: false,
    originalText: '',
    card: null,
    isSample: false,
    sampleId: null,
    editingTaskId: null,
    editingDraft: null,
    returnView: 'input',
    radarTaskOpen: null,
    radarTab: 'today'
  };

  /* ---------------- DOM ---------------- */
  var $ = function (id) { return document.getElementById(id); };

  var el = {
    viewInput: $('viewInput'),
    viewResult: $('viewResult'),
    noticeInput: $('noticeInput'),
    charCount: $('charCount'),
    counter: $('charCounter'),
    inputError: $('inputError'),
    submitBtn: $('submitBtn'),
    clearBtn: $('clearBtn'),
    ocrBtn: $('ocrBtn'),
    ocrInput: $('ocrInput'),
    sampleGrid: $('sampleGrid'),
    cardTitle: $('cardTitle'),
    cardSummary: $('cardSummary'),
    cardCategory: $('cardCategory'),
    cardCreated: $('cardCreated'),
    deadlineBody: $('deadlineBody'),
    taskList: $('taskList'),
    taskCount: $('taskCount'),
    progressFill: $('progressFill'),
    progressText: $('progressText'),
    materialList: $('materialList'),
    materialCount: $('materialCount'),
    stepList: $('stepList'),
    questionList: $('questionList'),
    evidenceToggle: $('evidenceToggle'),
    evidenceBody: $('evidenceBody'),
    evidenceMeta: $('evidenceMeta'),
    sampleBanner: $('sampleBanner'),
    backBtn: $('backBtn'),
    copyBtn: $('copyBtn'),
    printBtn: $('printBtn'),
    saveLocalBtn: $('saveLocalBtn'),
    reminderBtn: $('reminderBtn'),
    restartBtn: $('restartBtn'),
    addTaskBtn: $('addTaskBtn'),
    toast: $('toast'),
    savedDrawer: $('savedDrawer'),
    savedScrim: $('savedScrim'),
    savedList: $('savedList'),
    savedFoot: $('savedFoot'),
    savedNote: $('savedNote'),
    navSavedBtn: $('navSavedBtn'),
    savedCloseBtn: $('savedCloseBtn'),
    radarCardActions: $('radarCardActions'),
    radarCardStateLabel: $('radarCardStateLabel'),
    radarConfirmBtn: $('radarConfirmBtn'),
    radarDoneBtn: $('radarDoneBtn'),
    radarReopenBtn: $('radarReopenBtn'),
    radarIgnoreBtn: $('radarIgnoreBtn'),
    addToTasksBtn: $('addToTasksBtn'),
    cardSource: $('cardSource')
  };

  /* ---------------- 工具 ---------------- */

  var CHECK_SVG = '<svg viewBox="0 0 14 14" width="12" height="12" fill="none"><path d="M2.5 7.2l3 3 6-6.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var EDIT_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M11.2 2.6l2.2 2.2L5.6 12.6l-3 .8.8-3 7.8-7.8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  var TRASH_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><path d="M3 4.5h10M6.4 4.5V3.2h3.2v1.3M4.3 4.5l.6 8.3h6.2l.6-8.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var OK_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M5.4 8.1l1.8 1.8 3.4-3.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /** 所有动态文本都通过 textContent 写入，绝不拼接 innerHTML —— XSS 防线 */
  function textNode(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  var toastTimer = null;
  function toast(msg, kind) {
    clearTimeout(toastTimer);
    el.toast.textContent = msg;
    el.toast.className = 'toast' + (kind ? ' is-' + kind : '');
    el.toast.hidden = false;
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2800);
  }

  function uid(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function formatTime(iso) {
    try {
      var d = new Date(iso);
      var p = function (n) { return n < 10 ? '0' + n : String(n); };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (e) { return ''; }
  }

  /* ============================================================
     文本规范化与原文核验
     ============================================================ */

  function normalizeForMatch(s) {
    if (!s) return '';
    return String(s)
      .replace(/[！-～]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[「」『』“”‘’]/g, '"')
      .replace(/[，、；：]/g, ',')
      .replace(/。/g, '.')
      .replace(/（/g, '(').replace(/）/g, ')')
      .replace(/【/g, '[').replace(/】/g, ']')
      .replace(/[\s　]+/g, '')
      .toLowerCase();
  }

  /** 校验 source_quote 是否确实出现在原文中 */
  function verifyQuote(quote, original) {
    if (!quote || !String(quote).trim()) return { ok: false, matched: null };
    var q = String(quote).trim();
    var orig = String(original || '');
    if (!orig) return { ok: false, matched: null };

    if (orig.indexOf(q) !== -1) return { ok: true, matched: q };

    var nq = normalizeForMatch(q);
    var no = normalizeForMatch(orig);
    if (nq && no.indexOf(nq) !== -1) return { ok: true, matched: q };

    var lines = orig.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    for (var i = 0; i < lines.length; i++) {
      var nl = normalizeForMatch(lines[i]);
      if (nl && nl.indexOf(nq) !== -1) return { ok: true, matched: lines[i] };
    }
    return { ok: false, matched: null };
  }

  function isGrounded(quote, original) {
    return verifyQuote(quote, original).ok;
  }

  /* ============================================================
     幻觉扫描
     原文依据能核验「这句话抄自哪里」，但核验不了「这句话本身是否属实」。
     金额、电话、网址、具体日期是最容易被模型凭空补出来的四类事实，
     这里在客户端再兜一层：原文查不到出处的，一律标注待核实并进待确认区。
     ============================================================ */

  var RISKY_FACT_PATTERNS = [
    { kind: '金额', re: /\d+(?:\.\d+)?\s*(?:万元|块钱|元)/g },
    { kind: '电话号码', re: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
    { kind: '网址', re: /(?:https?:\/\/|www\.)[^\s，。；、）)\]】"'<>]+/gi }
  ];

  function pad2(n) { n = parseInt(n, 10); return (n < 10 ? '0' : '') + n; }

  /** 抽出一段文字里的全部「月日」，并判断它前面有没有紧跟的年份 */
  function dateFacts(text) {
    var t = String(text || '');
    var out = [];
    var re = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
    var m;
    while ((m = re.exec(t)) !== null) {
      var pre = t.slice(Math.max(0, m.index - 8), m.index);
      var ym = pre.match(/(\d{4})\s*年\s*$/);
      out.push({
        raw: (ym ? ym[1] + '年' : '') + m[1] + '月' + m[2] + '日',
        year: ym ? ym[1] : '',
        md: pad2(m[1]) + '-' + pad2(m[2])
      });
    }
    return out;
  }

  /**
   * 找出「在原文（含本条依据）中查无出处」的具体事实。
   * quote：这一条自己的原文依据；originalText：用户粘贴的全文。
   */
  function scanUnsupportedFacts(text, quote, originalText) {
    var out = [];
    var t = String(text || '');
    if (!t.trim()) return out;

    var qNorm = normalizeForMatch(quote || '');
    var oNorm = normalizeForMatch(originalText || '');

    // 原文中出现过的年份与「月日」，作为可组合的事实来源
    var yearSet = {}, mdSet = {};
    [[quote || ''], [originalText || '']].forEach(function (pair) {
      var src = String(pair[0] || '');
      var yre = /(\d{4})\s*年/g, ym;
      while ((ym = yre.exec(src)) !== null) yearSet[ym[1]] = true;
      dateFacts(src).forEach(function (f) { mdSet[f.md] = true; });
    });

    // 金额 / 电话 / 网址：必须能在本条依据或全文里找到
    RISKY_FACT_PATTERNS.forEach(function (p) {
      var re = new RegExp(p.re.source, p.re.flags);
      var m;
      while ((m = re.exec(t)) !== null) {
        var nn = normalizeForMatch(m[0]);
        if (qNorm.indexOf(nn) !== -1 || oNorm.indexOf(nn) !== -1) continue;
        out.push({ kind: p.kind, value: m[0].replace(/\s+/g, ' ') });
      }
    });

    // 具体日期：月日必须在原文出现；带年份时，年份也必须在原文出现
    dateFacts(t).forEach(function (f) {
      if (!mdSet[f.md]) {
        out.push({ kind: '具体日期', value: f.raw });
        return;
      }
      if (f.year && !yearSet[f.year]) {
        out.push({ kind: '具体日期（年份无出处）', value: f.raw });
      }
    });

    var seen = {}, uniq = [];
    out.forEach(function (x) {
      var k = x.kind + '|' + x.value;
      if (seen[k]) return;
      seen[k] = 1;
      uniq.push(x);
    });
    return uniq;
  }

  /* ============================================================
     AI 解析
     ============================================================ */

  function ensureCloud() {
    if (state.cloud) return state.cloud;
    if (!window.WorkBuddyCloud || !window.WorkBuddyCloud.createWorkBuddyCloud) {
      throw new Error('NO_SDK');
    }
    state.cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: PUBLIC_CONFIG.endpoint,
      publishableKey: PUBLIC_CONFIG.publishableKey
    });
    return state.cloud;
  }

  function resolveModel() {
    if (state.modelChecked) return Promise.resolve(state.modelId);
    var cloud = ensureCloud();
    return cloud.llm.models.list().then(function (models) {
      state.modelChecked = true;
      if (!models || !models.length) throw new Error('NO_MODEL');
      var usable = models.filter(function (m) { return m.disabled !== true && m.enabled !== false; });
      if (!usable.length) throw new Error('NO_MODEL');
      var ids = usable.map(function (m) { return m.id; });
      // 首选 deepseek-v4-flash，其余按目录顺序做故障转移候选
      state.modelCandidates = [MODEL_ID].filter(function (id) { return ids.indexOf(id) !== -1; })
        .concat(ids.filter(function (id) { return id !== MODEL_ID; }));
      state.modelId = state.modelCandidates[0];
      return state.modelId;
    });
  }

  /** 单个模型的一次完整调用（含流式读取） */
  function callOneModel(modelId, text, repairInstruction) {
    var cloud = ensureCloud();
    var messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: repairInstruction
          ? repairInstruction + '\n\n原始通知：\n' + text
          : text }
    ];
    var out = '';
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 60000);

    var stream = cloud.llm.chat.completions.create({
      model: modelId,
      stream: true,
      response_format: { type: 'json_object' },
      messages: messages,
      signal: controller.signal
    });

    var it = stream[Symbol.asyncIterator]();
    function step() {
      return it.next().then(function (r) {
        if (r.done) { clearTimeout(timer); return out; }
        var delta = r.value.choices && r.value.choices[0] && r.value.choices[0].delta;
        if (delta && delta.content) out += delta.content;
        return step();
      });
    }
    return step().catch(function (e) {
      clearTimeout(timer);
      throw e;
    });
  }

  function isQuotaLikeError(err) {
    var code = (err && err.error && err.error.code) || err.message || '';
    return /quota|rate_limited|429|saturat|busy| frequenc/i.test(String(code));
  }

  /** 首选模型限流/饱和时自动换下一个候选（故障转移） */
  function callModel(text, repairInstruction) {
    return resolveModel().then(function () {
      var candidates = (state.modelCandidates && state.modelCandidates.length)
        ? state.modelCandidates.slice() : [state.modelId];
      var lastErr = null;
      function attempt(i) {
        if (i >= candidates.length) throw lastErr || new Error('NO_MODEL');
        return callOneModel(candidates[i], text, repairInstruction).then(function (out) {
          // 记住这次真正可用的模型，后续请求优先用它
          if (i > 0) {
            state.modelCandidates = [candidates[i]].concat(
              candidates.filter(function (id, j) { return j !== i; }));
          }
          return out;
        }).catch(function (e) {
          if (isQuotaLikeError(e) && i + 1 < candidates.length) {
            lastErr = e;
            return attempt(i + 1);
          }
          throw e;
        });
      }
      return attempt(0);
    });
  }

  function extractJson(raw) {
    if (!raw) throw new Error('INVALID_JSON');
    var s = String(raw).trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    var start = s.indexOf('{');
    var end = s.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw new Error('INVALID_JSON');
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch (e) {
      throw new Error('INVALID_JSON');
    }
  }

  function validateShape(obj) {
    var problems = [];
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

  var REPAIR_HINT = '你上一次的输出不符合要求（结构缺失或无法解析为 JSON）。请重新输出严格的 JSON，不要任何多余文字、不要代码块标记。必须包含 title、summary、category、deadline、tasks、materials、steps、questions_to_confirm 八个字段。';

  /** 解析 → 校验 → 必要时请求模型修复一次 → 再校验 */
  function parseNotice(text) {
    function attempt(repairTried) {
      return callModel(text, repairTried ? REPAIR_HINT : null)
        .then(function (out) {
          var obj;
          try {
            obj = extractJson(out);
          } catch (e) {
            if (!repairTried) return attempt(true);
            throw new Error('INVALID_JSON');
          }
          if (validateShape(obj).length) {
            if (!repairTried) return attempt(true);
            throw new Error('INVALID_SHAPE');
          }
          return obj;
        });
    }
    return attempt(false);
  }

  var RELATIVE_RE = /(尽快|尽早|即时|立即|马上|近期|近日|最近|本周|这周|下周|下下周|周末|月底|月初|月中|今日|今天|明天|后天|日前|之前|之内|日内|工作日|另行通知|待定|暂定|视情况|若干)/;

  function looksRelative(s) {
    if (!s) return false;
    var t = String(s);
    if (/\d{4}\s*年|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日/.test(t)) return false;
    return RELATIVE_RE.test(t);
  }

  /**
   * 判断原文里的时间表述是否真的构成「办理截止时间」。
   * 「将于下月开展义诊」是活动时间，不是截止时间 —— 把活动时间当截止时间，
   * 会让用户误以为自己有个 deadline，是这个产品最不能犯的错。
   *
   * 做法：先定位时间表述本身，再看它周围紧邻的语义线索。
   * 「本周五前」→ 时间词后紧跟"前" → 是期限。
   * 「下月开展义诊」→ 时间词后是"开展"等动作 → 是活动时间。
   */
  // 自带期限语义的时间词（"三日内"本身即期限，"下月"不是）
  var DEADLINE_TOKEN_RE = /(?:\d+\s*(?:个)?(?:工作日|天|周|个月)内|三日内|两日内|七日内|十日内|十五日内|三十日内|日内|周内|个月内|工作日内|尽快|尽早|即刻|立即|马上)/;

  // 通用时间词：宽泛扫描，再看其后 0-3 字内是否有期限线索
  var TIME_TOKEN_RE = /(?:\d{4}\s*年|\d{1,2}\s*月|\d{1,2}\s*日|\d{1,2}\s*周|\d{1,2}\s*个?工作日|\d{1,2}\s*天|[一二三四五六七八九十两]\s*日|[一二三四五六七八九十两]\s*个?工作日|[一二三四五六七八九十两]\s*天|[一二三四五六七八九十两]\s*周|本周|这周|下周|周[一二三四五六日天]|本月|下月|上月|本学期|这学期|下学期|学期|今日|今天|明天|后天|日前|近期|近日|最近|周末|月底|月初|月中|\d{1,2}\s*个月)/g;

  // 完整日期（含年月日，或仅月日）。日期后可能紧跟一个时间点，
  // 「2026年11月20日17:00前」里的"前"距离"年"有 6 个字，必须先锚定整段日期。
  var DATE_TOKEN_RE = /(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日/g;
  // ISO / 斜杠日期（系统通知常用）：2026-11-03、2026/11/3
  var ISO_DATE_TOKEN_RE = /\d{4}\s*[-/]\s*\d{1,2}\s*[-/]\s*\d{1,2}/g;

  // 日期与期限词之间允许出现的时间点
  var CLOCK_RE = /^\s*(?:\d{1,2}\s*[:：]\s*\d{1,2}(?:\s*[:：]\s*\d{2})?|\d{1,2}\s*时(?:\s*\d{1,2}\s*分)?|[上下]午)?/;

  // 明确的期限总线索（出现在时间表述所在分句里）
  var DEADLINE_CONTEXT_RE = /(截止|截至|期限|逾期|过期|失效|不得晚于|不晚于|最迟|之前|以前)/;

  // 期限词：紧跟在时间表述（或其后的时间点）之后
  var DEADLINE_TAIL_RE = /^\s*(?:前|之前|内|以内|之内)/;

  function hasTimeExpression(s) {
    var t = String(s || '');
    if (!t.trim()) return false;
    return new RegExp(TIME_TOKEN_RE.source, 'g').test(t) ||
           new RegExp(DATE_TOKEN_RE.source, 'g').test(t) ||
           new RegExp(ISO_DATE_TOKEN_RE.source, 'g').test(t);
  }

  function isDeadlineBearing(originalText, quote) {
    var t = String(originalText || '');
    if (!t.trim()) return false;

    function inspect(s) {
      if (!String(s || '').trim()) return false;

      // 自带期限语义
      if (DEADLINE_TOKEN_RE.test(s)) return true;

      // 完整日期 → 允许隔着时间点再看期限词
      // 「2026年11月20日17:00前」= 日期 + "17:00" + "前"
      var dre = new RegExp(DATE_TOKEN_RE.source, 'g');
      var m;
      while ((m = dre.exec(s)) !== null) {
        var tail = s.slice(m.index + m[0].length);
        var cm = tail.match(CLOCK_RE);
        if (cm && cm[0]) tail = tail.slice(cm[0].length);
        if (DEADLINE_TAIL_RE.test(tail)) return true;
      }

      // ISO / 斜杠日期同理：「2026-11-03前」「2026/11/3 18:00内」
      var ire = new RegExp(ISO_DATE_TOKEN_RE.source, 'g');
      while ((m = ire.exec(s)) !== null) {
        var tail3 = s.slice(m.index + m[0].length);
        var cm3 = tail3.match(CLOCK_RE);
        if (cm3 && cm3[0]) tail3 = tail3.slice(cm3[0].length);
        if (DEADLINE_TAIL_RE.test(tail3)) return true;
      }

      // 扫描所有宽泛时间词候选，看其后 0-3 字内是否有期限线索
      // （"本周五前"的时间词是"本周"，与"前"之间隔了一个"五"）
      var re = new RegExp(TIME_TOKEN_RE.source, 'g');
      while ((m = re.exec(s)) !== null) {
        var rest = s.slice(m.index + m[0].length);
        var t2 = rest.slice(0, 3);
        if (/^\s*(?:[一二三四五六日天]?\s*)?(?:前|之前|内|以内|之内)/.test(t2)) return true;
        // 允许时间词与期限词之间隔一个时间点："今日18:00前"、"明天上午9点前"
        var cm2 = rest.match(CLOCK_RE);
        if (cm2 && cm2[0] && /^\s*(?:前|之前|内|以内|之内)/.test(rest.slice(cm2[0].length))) return true;
        if (m.index > re.lastIndex) re.lastIndex = m.index + 1;
      }

      // 明确的期限总线索
      if (DEADLINE_CONTEXT_RE.test(s)) return true;
      return false;
    }

    if (inspect(t)) return true;
    var q = String(quote || '');
    if (q && inspect(q)) return true;
    return false;
  }

  function dateGrounded(norm, originalText) {
    if (!norm || !originalText) return false;
    var m = String(norm).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return false;
    var y = m[1], mo = m[2], d = m[3];
    // 「11月3日」这种个位日在原文里通常不带前导零，匹配时用 0? + 十进制值，
    // 否则 0?03 会要求至少出现 "03"，单数字日期被误判为无出处
    var moi = parseInt(mo, 10), di = parseInt(d, 10);
    var text = String(originalText);
    var patterns = [
      y + '\\s*年\\s*(?:0?' + moi + ')\\s*月\\s*(?:0?' + di + ')\\s*日',
      y + '-' + mo + '-' + d,
      y + '/' + mo + '/' + d,
      y + '\\.\\s*' + mo + '\\.\\s*' + d
    ];
    for (var i = 0; i < patterns.length; i++) {
      if (new RegExp(patterns[i]).test(text)) return true;
    }
    return false;
  }

  /** 归一化 + 引用核验：不合法的引用一律降级，绝不展示杜撰内容 */
  function normalizeCard(obj, originalText) {
    var card = {
      title: String(obj.title || '').trim() || '待确认事项',
      summary: String(obj.summary || '').trim(),
      category: CATEGORIES.indexOf(obj.category) !== -1 ? obj.category : '其他',
      deadline: null,
      tasks: [],
      materials: [],
      steps: [],
      questions_to_confirm: [],
      source: 'ai',
      createdAt: new Date().toISOString()
    };

    var d = obj.deadline || {};
    var dlOriginal = String(d.original_text || '').trim();
    var dlQuote = String(d.source_quote || '').trim();
    var dlGrounded = isGrounded(dlQuote, originalText);

    // 原文是否真的说了「截止时间」。活动时间（如"下月开展义诊"）不算。
    // 优先按截止时间自己的原文片段判断：整篇通知里别处的时间（如义诊日期）
    // 不该串味到截止时间上。片段里根本没有时间表述时，才回退看全文。
    var dlScope = (dlGrounded && dlQuote) ? dlQuote : dlOriginal;
    var bearsDeadline = hasTimeExpression(dlScope)
      ? isDeadlineBearing(dlScope, '')
      : isDeadlineBearing(originalText, '');

    card.deadline = {
      original_text: dlOriginal,
      normalized_date: (typeof d.normalized_date === 'string' && d.normalized_date) ? d.normalized_date : null,
      needs_confirmation: d.needs_confirmation !== false,
      source_quote: dlGrounded ? dlQuote : '',
      grounded: dlGrounded,
      bears_deadline: bearsDeadline
    };

    if (looksRelative(dlOriginal) || looksRelative(dlQuote)) {
      card.deadline.normalized_date = null;
      card.deadline.needs_confirmation = true;
    }
    if (card.deadline.normalized_date && !dateGrounded(card.deadline.normalized_date, originalText)) {
      card.deadline.normalized_date = null;
      card.deadline.needs_confirmation = true;
    }
    if (!dlOriginal) card.deadline.needs_confirmation = true;

    (obj.tasks || []).forEach(function (t) {
      var title = String(t.title || '').trim();
      if (!title) return;
      var q = String(t.source_quote || '').trim();
      var grounded = isGrounded(q, originalText);
      card.tasks.push({
        id: uid('t'),
        title: title,
        completed: t.completed === true,
        source_quote: grounded ? q : '',
        needs_confirmation: t.needs_confirmation === true || !grounded,
        grounded: grounded
      });
    });

    (obj.materials || []).forEach(function (m) {
      var name = String(m.name || '').trim();
      if (!name) return;
      var q = String(m.source_quote || '').trim();
      var grounded = isGrounded(q, originalText);
      card.materials.push({
        id: uid('m'),
        name: name,
        completed: m.completed === true,
        source_quote: grounded ? q : '',
        needs_confirmation: m.needs_confirmation === true || !grounded,
        grounded: grounded
      });
    });

    (obj.steps || []).forEach(function (s) {
      var t = String(s.text || '').trim();
      if (!t) return;
      var q = String(s.source_quote || '').trim();
      var grounded = isGrounded(q, originalText);
      card.steps.push({
        id: uid('s'),
        text: t,
        source_quote: grounded ? q : '',
        grounded: grounded
      });
    });

    (obj.questions_to_confirm || []).forEach(function (q) {
      var question = String(q.question || '').trim();
      if (!question) return;
      card.questions_to_confirm.push({
        id: uid('q'),
        question: question,
        reason: String(q.reason || '').trim()
      });
    });

    /* 原文出现了时间，但看不出是"截止时间"还是"活动时间/生效时间"：
       不擅自认定为截止时间，改为列入待确认，由用户核实。 */
    if (card.deadline.original_text && !card.deadline.bears_deadline) {
      var alreadyAsked = card.questions_to_confirm.some(function (q) {
        return card.deadline.original_text &&
          (q.question.indexOf(card.deadline.original_text) !== -1 ||
           q.reason.indexOf(card.deadline.original_text) !== -1);
      });
      if (!alreadyAsked) {
        card.questions_to_confirm.push({
          id: uid('q'),
          question: '原文提到的「' + card.deadline.original_text + '」是办理截止时间，还是活动时间/生效时间？',
          reason: '原文中没有明确说明这是"必须在此之前办完"的期限，因此没有把它直接当作截止时间。'
        });
      }
    }

    /* 幻觉扫描：正文里出现原文查无出处的事实 → 逐条标注 + 汇总进待确认 */
    var unsupported = [];

    function collectUnsupported(item, label, text, quote) {
      var hits = scanUnsupportedFacts(text, quote, originalText);
      if (!hits.length) return;
      if (item) {
        item.needs_confirmation = true;
        item.risk = hits.map(function (h) { return h.kind + '「' + h.value + '」'; }).join('、');
      }
      hits.forEach(function (h) {
        var dup = unsupported.some(function (u) { return u.kind === h.kind && u.value === h.value; });
        if (!dup) unsupported.push({ kind: h.kind, value: h.value, where: label });
      });
    }

    collectUnsupported(null, '标题', card.title, '');
    collectUnsupported(null, '摘要', card.summary, '');
    if (card.deadline && card.deadline.original_text) {
      collectUnsupported(null, '截止时间', card.deadline.original_text, card.deadline.source_quote);
    }
    card.tasks.forEach(function (t) { collectUnsupported(t, '待办', t.title, t.source_quote); });
    card.materials.forEach(function (m) { collectUnsupported(m, '材料', m.name, m.source_quote); });
    card.steps.forEach(function (s) { collectUnsupported(s, '步骤', s.text, s.source_quote); });

    if (unsupported.length) {
      card.questions_to_confirm.push({
        id: uid('q'),
        question: '以下信息在原文里没有找到出处，请核实：' +
          unsupported.map(function (u) { return u.kind + '「' + u.value + '」'; }).join('、'),
        reason: '这些内容出现在' + unsupported.map(function (u) { return u.where; }).join('、') +
          '，但通知原文中没有对应表述，可能是识别有误。正式办理前请以原文为准。'
      });
    }

    return card;
  }

  /* ============================================================
     渲染
     ============================================================ */

  function render() {
    if (!state.card) return;
    var card = state.card;

    el.cardCategory.textContent = card.category;
    el.cardTitle.textContent = card.title;
    el.cardSummary.textContent = card.summary;
    el.cardCreated.textContent = '生成于 ' + formatTime(card.createdAt);
    var printTime = document.getElementById('printTime');
    if (printTime) printTime.textContent = formatTime(card.createdAt);

    renderDeadline(card);
    renderTasks(card);
    renderProgress(card);
    renderMaterials(card);
    renderSteps(card);
    renderQuestions(card);
    renderEvidence(card);
  }

  function renderDeadline(card) {
    clear(el.deadlineBody);
    var d = card.deadline || {};
    var hasText = !!d.original_text;
    // 只有原文确实表达了"期限"语义时才当作截止时间
    var isDeadline = hasText && d.bears_deadline !== false;
    var isManual = card.source === 'manual';

    var main = textNode('div', 'deadline-main');
    var val = textNode('span', 'deadline-value', hasText ? d.original_text : '原文未提及');
    if (!hasText) val.classList.add('is-missing');
    else if (!isDeadline) val.classList.add('is-missing');
    else if (d.needs_confirmation || !d.normalized_date) val.classList.add('is-vague');
    main.appendChild(val);

    if (isDeadline && d.normalized_date) {
      main.appendChild(textNode('span', 'deadline-normalized', '规范化日期：' + d.normalized_date));
    }
    if (!isDeadline && hasText) {
      // 时间表述存在，但不是办理期限 —— 明确区分，避免误读为 deadline
      main.appendChild(textNode('span', 'deadline-normalized', '原文提到的时间（非办理期限）'));
    }
    el.deadlineBody.appendChild(main);

    var note;
    if (isManual) {
      note = hasText
        ? textNode('p', 'deadline-note', '这是你手动填写的日期，没有原文依据，请自行确认是否准确。')
        : textNode('p', 'deadline-note is-ok', '你没有填写截止时间，建议向发布方确认后再安排。');
    } else if (!hasText) {
      note = textNode('p', 'deadline-note is-ok', '原文中没有提到截止时间，建议向发布方确认后再安排。');
    } else if (!isDeadline) {
      note = textNode('p', 'deadline-note',
        '原文出现了这个时间，但没有说明它是"必须在此之前办完"的期限，因此未认定为截止时间，已放入待确认。');
    } else if (d.needs_confirmation) {
      note = textNode('p', 'deadline-note', '原文时间表述不够明确，未换算成具体日期，建议自行确认准确时间。');
    } else {
      note = textNode('p', 'deadline-note is-ok', '原文给出了明确日期，请以官方通知为准。');
    }
    el.deadlineBody.appendChild(note);

    if (d.source_quote) {
      var q = textNode('p', 'deadline-quote');
      q.appendChild(textNode('b', null, '原文依据：'));
      q.appendChild(document.createTextNode(d.source_quote));
      el.deadlineBody.appendChild(q);
    } else if (hasText && !isManual) {
      el.deadlineBody.appendChild(textNode('p', 'deadline-quote', '未找到明确原文依据'));
    }
  }

  function renderTasks(card) {
    clear(el.taskList);

    if (!card.tasks.length) {
      el.taskList.appendChild(emptyNote('这份通知里没有提取到明确要做的事，可以手动添加一条。'));
      el.taskCount.textContent = '';
      return;
    }

    card.tasks.forEach(function (task) {
      var li = textNode('li', 'task-item');
      if (task.completed) li.classList.add('is-done');

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'check' + (task.completed ? ' is-checked' : '');
      btn.setAttribute('aria-label', (task.completed ? '取消完成：' : '标记完成：') + task.title);
      btn.setAttribute('aria-pressed', task.completed ? 'true' : 'false');
      btn.innerHTML = CHECK_SVG;
      btn.addEventListener('click', function () {
        task.completed = !task.completed;
        touchRadarCard();
        render();
      });
      li.appendChild(btn);

      var main = textNode('div', 'task-main');

      if (state.editingTaskId === task.id) {
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'task-title-edit';
        input.value = (state.editingDraft && state.editingDraft.id === task.id) ? state.editingDraft.value : task.title;
        main.appendChild(input);
        input.addEventListener('input', function () {
          state.editingDraft = { id: task.id, value: input.value };
        });

        var row = textNode('div', 'task-edit-row');
        var ok = textNode('button', 'btn btn-primary btn-sm', '保存');
        ok.type = 'button';
        ok.addEventListener('click', function () {
          var v = input.value.trim();
          if (v && v !== task.title) {
            task.title = v;
            task.edited = true;      // 依据仍是编辑前的原文，需明示
            touchRadarCard();
          }
          state.editingTaskId = null;
          state.editingDraft = null;
          render();
        });
        var cancel = textNode('button', 'btn btn-ghost btn-sm', '取消');
        cancel.type = 'button';
        cancel.addEventListener('click', function () {
          state.editingTaskId = null;
          state.editingDraft = null;
          render();
        });
        row.appendChild(ok);
        row.appendChild(cancel);
        main.appendChild(row);

        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); ok.click(); }
          if (e.key === 'Escape') { e.preventDefault(); cancel.click(); }
        });
        setTimeout(function () { input.focus(); input.select(); }, 0);
      } else {
        main.appendChild(textNode('div', 'task-title', task.title));

        var meta = textNode('div', 'task-meta');
        if (task.source_quote) {
          var qt = textNode('span', 'quote-tag', (task.edited ? '依据（编辑前）：' : '依据：') + task.source_quote);
          qt.title = task.source_quote;
          meta.appendChild(qt);
        } else {
          meta.appendChild(textNode('span', 'quote-tag is-missing', '未找到明确原文依据'));
        }
        if (task.edited) meta.appendChild(textNode('span', 'edited-tag', '已编辑'));
        if (task.risk) meta.appendChild(textNode('span', 'confirm-tag', '信息待核实'));
        else if (task.needs_confirmation) meta.appendChild(textNode('span', 'confirm-tag', '需确认'));
        if (meta.childNodes.length) main.appendChild(meta);
      }

      li.appendChild(main);

      var ops = textNode('div', 'task-ops');
      var edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'icon-btn';
      edit.setAttribute('aria-label', '编辑任务：' + task.title);
      edit.innerHTML = EDIT_SVG;
      edit.addEventListener('click', function () {
        state.editingTaskId = task.id;
        render();
      });

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn is-danger';
      del.setAttribute('aria-label', '删除任务：' + task.title);
      del.innerHTML = TRASH_SVG;
      del.addEventListener('click', function () {
        card.tasks = card.tasks.filter(function (x) { return x.id !== task.id; });
        touchRadarCard();
        render();
        toast('已删除该待办');
      });

      ops.appendChild(edit);
      ops.appendChild(del);
      li.appendChild(ops);

      el.taskList.appendChild(li);
    });
  }

  function renderProgress(card) {
    var total = card.tasks.length;
    var done = card.tasks.filter(function (t) { return t.completed; }).length;
    var remain = total - done;
    var pct = total ? Math.round((done / total) * 100) : 0;

    el.progressFill.style.width = pct + '%';
    el.progressText.textContent = total ? done + '/' + total + ' · 剩 ' + remain + ' 项' : '暂无任务';
    el.taskCount.textContent = total ? '共 ' + total + ' 项' : '';
  }

  function renderMaterials(card) {
    clear(el.materialList);

    if (!card.materials.length) {
      el.materialList.appendChild(emptyNote('原文中没有明确列出需要准备的材料。若确有要求，可到「需要核实的地方」确认。'));
      el.materialCount.textContent = '';
      return;
    }

    var doneCount = 0;
    card.materials.forEach(function (m) {
      if (m.completed) doneCount++;
      var li = textNode('li', 'material-item' + (m.completed ? ' is-done' : ''));

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'check' + (m.completed ? ' is-checked' : '');
      btn.setAttribute('aria-label', (m.completed ? '取消备齐：' : '标记已备齐：') + m.name);
      btn.setAttribute('aria-pressed', m.completed ? 'true' : 'false');
      btn.innerHTML = CHECK_SVG;
      btn.addEventListener('click', function () {
        m.completed = !m.completed;
        touchRadarCard();
        render();
      });
      li.appendChild(btn);

      var main = textNode('div', 'material-main');
      main.appendChild(textNode('div', 'material-name', m.name));

      var meta = textNode('div', 'material-meta');
      if (m.source_quote) {
        var qt = textNode('span', 'quote-tag', '依据：' + m.source_quote);
        qt.title = m.source_quote;
        meta.appendChild(qt);
      } else {
        meta.appendChild(textNode('span', 'quote-tag is-missing', '未找到明确原文依据'));
      }
      if (m.risk) meta.appendChild(textNode('span', 'confirm-tag', '信息待核实'));
      else if (m.needs_confirmation) meta.appendChild(textNode('span', 'confirm-tag', '需确认'));
      if (meta.childNodes.length) main.appendChild(meta);

      li.appendChild(main);

      var mops = textNode('div', 'task-ops');
      var mdel = document.createElement('button');
      mdel.type = 'button';
      mdel.className = 'icon-btn is-danger';
      mdel.setAttribute('aria-label', '删除材料：' + m.name);
      mdel.innerHTML = TRASH_SVG;
      mdel.addEventListener('click', function () {
        card.materials = card.materials.filter(function (x) { return x.id !== m.id; });
        touchRadarCard();
        render();
        toast('已删除该材料');
      });
      mops.appendChild(mdel);
      li.appendChild(mops);

      el.materialList.appendChild(li);
    });

    el.materialCount.textContent = '已备齐 ' + doneCount + '/' + card.materials.length + ' 项';
  }

  function renderSteps(card) {
    clear(el.stepList);
    if (!card.steps.length) {
      el.stepList.appendChild(emptyNote('原文中没有能确认先后顺序的操作步骤。'));
      return;
    }
    card.steps.forEach(function (s, i) {
      var li = textNode('li', 'step-item');
      li.appendChild(textNode('span', 'step-num', String(i + 1)));
      var main = textNode('div', 'step-main');
      main.appendChild(textNode('div', 'step-text', s.text));
      var meta = textNode('div', 'step-meta');
      if (s.source_quote) {
        var qt = textNode('span', 'quote-tag', '依据：' + s.source_quote);
        qt.title = s.source_quote;
        meta.appendChild(qt);
      } else {
        meta.appendChild(textNode('span', 'quote-tag is-missing', '未找到明确原文依据'));
      }
      if (s.risk) meta.appendChild(textNode('span', 'confirm-tag', '信息待核实'));
      main.appendChild(meta);
      li.appendChild(main);

      var sops = textNode('div', 'task-ops');
      var sdel = document.createElement('button');
      sdel.type = 'button';
      sdel.className = 'icon-btn is-danger';
      sdel.setAttribute('aria-label', '删除步骤：' + s.text);
      sdel.innerHTML = TRASH_SVG;
      sdel.addEventListener('click', function () {
        card.steps = card.steps.filter(function (x) { return x.id !== s.id; });
        touchRadarCard();
        render();
        toast('已删除该步骤');
      });
      sops.appendChild(sdel);
      li.appendChild(sops);

      el.stepList.appendChild(li);
    });
  }

  function renderQuestions(card) {
    clear(el.questionList);
    var qs = card.questions_to_confirm;
    if (!qs.length) {
      el.questionList.appendChild(emptyNote('暂未发现需要单独核实的信息。'));
      return;
    }
    qs.forEach(function (q) {
      var li = textNode('li', 'question-item');
      li.appendChild(textNode('p', 'question-text', q.question));
      if (q.reason) li.appendChild(textNode('p', 'question-reason', q.reason));
      el.questionList.appendChild(li);
    });
  }

  function emptyNote(msg) {
    var n = textNode('p', 'empty-note');
    var holder = document.createElement('span');
    holder.innerHTML = OK_SVG;
    holder.style.display = 'inline-flex';
    n.appendChild(holder.firstChild);
    n.appendChild(document.createTextNode(msg));
    return n;
  }

  function renderEvidence(card) {
    clear(el.evidenceBody);

    var rows = [];
    if (card.deadline && card.deadline.original_text) {
      rows.push({
        label: '截止时间',
        text: card.deadline.source_quote || '',
        origin: card.deadline.original_text
      });
    }
    card.tasks.forEach(function (t) {
      rows.push({ label: '待办', text: t.source_quote || '', origin: t.title, edited: t.edited, risk: t.risk });
    });
    card.materials.forEach(function (m) {
      rows.push({ label: '材料', text: m.source_quote || '', origin: m.name, risk: m.risk });
    });
    card.steps.forEach(function (s) {
      rows.push({ label: '步骤', text: s.source_quote || '', origin: s.text, risk: s.risk });
    });

    var groundedCount = rows.filter(function (r) { return r.text; }).length;
    el.evidenceMeta.textContent = rows.length ? groundedCount + '/' + rows.length + ' 条可在原文中定位' : '';

    if (!rows.length) {
      el.evidenceBody.appendChild(emptyNote('这份办事卡没有可对照的原文片段。'));
      return;
    }

    rows.forEach(function (r) {
      var row = textNode('div', 'evidence-row');
      row.appendChild(textNode('div', 'evidence-label', r.label));
      var body = textNode('div');
      if (r.text) {
        body.appendChild(textNode('div', 'evidence-text', r.text));
        body.appendChild(textNode('div', 'evidence-origin', r.origin));
        if (r.edited) body.appendChild(textNode('div', 'evidence-origin', '※ 该条已被手动编辑，以上为编辑前的原文依据'));
        if (r.risk) body.appendChild(textNode('div', 'evidence-origin', '※ 信息待核实：' + r.risk));
      } else {
        body.appendChild(textNode('div', 'evidence-text is-missing', '未找到明确原文依据'));
        if (r.risk) body.appendChild(textNode('div', 'evidence-origin', '※ 信息待核实：' + r.risk));
      }
      row.appendChild(body);
      el.evidenceBody.appendChild(row);
    });
  }

  /* ============================================================
     导出纯文本
     ============================================================ */

  function buildPlainText() {
    var card = state.card;
    if (!card) return '';
    var lines = [];
    var L = function (s) { lines.push(s); };

    if (state.isSample) {
      L('【示例预览 · 并非实时 AI 解析】');
      L('以下是内置演示数据，不是对你粘贴的通知做的真实解析，请勿直接对外使用。');
      L('用你自己的通知重新生成后，才是你这份通知的真实办事卡。');
      L('');
    }

    L('【' + card.title + '】');
    L('类型：' + card.category);
    if (card.summary) L('摘要：' + card.summary);
    L('');

    var d = card.deadline || {};
    var isManual = card.source === 'manual';
    var isDeadline = d.original_text && d.bears_deadline !== false;
    if (isManual) {
      if (d.original_text) {
        L('截止时间：' + d.original_text);
        L('  ※ 手动填写，无原文依据，请自行确认是否准确');
      } else {
        L('截止时间：未填写');
      }
    } else if (isDeadline) {
      L('截止时间：' + d.original_text + (d.normalized_date ? '（规范化：' + d.normalized_date + '）' : ''));
      if (d.needs_confirmation) L('  ※ 原文时间表述不明确，请自行确认准确日期');
      if (d.source_quote) L('  原文依据：' + d.source_quote);
    } else if (d.original_text) {
      L('截止时间：原文未提及办理期限');
      L('  ※ 原文中提到的时间「' + d.original_text + '」未说明是"必须在此之前办完"的期限，已列入待确认');
      if (d.source_quote) L('  原文依据：' + d.source_quote);
    } else {
      L('截止时间：原文未提及');
    }
    L('');

    var done = card.tasks.filter(function (t) { return t.completed; }).length;
    L('■ 要办的事（' + done + '/' + card.tasks.length + ' 已完成）');
    if (!card.tasks.length) {
      L('  （无）');
    } else {
      card.tasks.forEach(function (t) {
        L('  ' + (t.completed ? '[x]' : '[ ]') + ' ' + t.title);
        if (t.edited) L('      ※ 已手动编辑');
        if (t.risk) L('      ※ 信息待核实：' + t.risk);
        if (t.source_quote) L('      依据' + (t.edited ? '（编辑前）' : '') + '：' + t.source_quote);
        else if (t.needs_confirmation) L('      ※ 未找到明确原文依据，需确认');
      });
    }
    L('');

    var mDone = card.materials.filter(function (m) { return m.completed; }).length;
    L('■ 要带的材料（' + mDone + '/' + card.materials.length + ' 已备齐）');
    if (!card.materials.length) {
      L('  （原文中未明确列出）');
    } else {
      card.materials.forEach(function (m) {
        L('  ' + (m.completed ? '[x]' : '[ ]') + ' ' + m.name);
        if (m.risk) L('      ※ 信息待核实：' + m.risk);
        if (m.source_quote) L('      依据：' + m.source_quote);
      });
    }
    L('');

    L('■ 办理步骤');
    if (!card.steps.length) {
      L('  （原文中没有可确认的步骤）');
    } else {
      card.steps.forEach(function (s, i) {
        L('  ' + (i + 1) + '. ' + s.text);
        if (s.source_quote) L('      依据：' + s.source_quote);
      });
    }
    L('');

    L('■ 需要核实的地方');
    if (!card.questions_to_confirm.length) {
      L('  暂未发现需要单独核实的信息。');
    } else {
      card.questions_to_confirm.forEach(function (q, i) {
        L('  ' + (i + 1) + '. ' + q.question);
        if (q.reason) L('     ' + q.reason);
      });
    }
    L('');
    L('—— 由「办事雷达 · TaskCard」' + (isManual ? '（手动整理）' : '') + '生成于 ' + formatTime(card.createdAt));
    L('提示：结果仅供参考，正式办理前请以官方原文和现场要求为准。');

    return lines.join('\n');
  }

  /* ============================================================
     复制 / 打印 / 本地保存
     ============================================================ */

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '-9999px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) resolve();
        else reject(new Error('copy_failed'));
      } catch (e) { reject(e); }
    });
  }

  function saveCardToCloud(card) {
    var c = JSON.parse(JSON.stringify(card));
    c.originalText = state.originalText;
    var deadlineISO = (c.deadline && c.deadline.normalized_date) ? c.deadline.normalized_date : null;
    return window.RadarCards.save({
      title: c.title,
      category: c.category,
      deadlineISO: deadlineISO,
      card: c
    }).then(function (res) {
      if (res.error) return { error: res.error };
      var row = (res.data && res.data[0]) || null;
      currentSavedId = row ? row.id : null;
      return currentSavedId;
    });
  }

  function saveCard() {
    if (!state.card) return;
    var m = getMode();
    if (m === 'cloud') {
      saveCardToCloud(state.card).then(function (id) {
        if (id && !id.error) { toast('已保存到云端', 'success'); renderSaved(); }
        else { toast('云端保存失败', 'error'); }
      }).catch(function () { toast('云端保存失败', 'error'); });
      return;
    }
    if (m === 'anon' || m === 'checking') {
      if (window.RadarAccount && window.RadarAccount.showOverlay) window.RadarAccount.showOverlay();
      toast('请先登录后再云端保存', 'error');
      return;
    }
    // local / nosdk 本地兜底
    var list = readSaved();
    var card = JSON.parse(JSON.stringify(state.card));
    card.originalText = state.originalText;
    list.unshift({
      id: uid('s'),
      title: card.title,
      category: card.category,
      savedAt: new Date().toISOString(),
      card: card
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      toast('已保存到本设备', 'success');
      renderSaved();
    } catch (e) {
      toast('本地保存失败，请改用复制或打印', 'error');
    }
  }

  function ensureCloudCard() {
    if (currentSavedId) return Promise.resolve(currentSavedId);
    return saveCardToCloud(state.card);
  }

  function readSaved() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }

  function renderSaved() {
    if (getMode() === 'cloud') { renderCloudCards(); return; }
    renderLocalCards();
  }

  function renderLocalCards() {
    clear(el.savedList);
    clear(el.savedFoot);
    currentSavedId = null;

    var list = readSaved();
    if (!list.length) {
      el.savedNote.textContent = '当前设备还没有保存过办事卡。在结果页点击「保存到云端」登录后即可跨设备保存。';
      el.savedList.appendChild(emptyNote('还没有保存过的办事卡。'));
      return;
    }

    el.savedNote.textContent = '共 ' + list.length + ' 张（含通知原文），仅保存在当前浏览器中，清除浏览器数据或换设备即丢失，无法恢复。';

    list.forEach(function (item) {
      var box = textNode('div', 'saved-item');
      box.appendChild(textNode('div', 'saved-item-title', item.title || '未命名'));
      var meta = textNode('div', 'saved-item-meta');
      meta.textContent = (item.category || '其他') + ' · 保存于 ' + formatTime(item.savedAt);
      box.appendChild(meta);

      var ops = textNode('div', 'saved-item-ops');
      var open = textNode('button', 'btn btn-ghost btn-sm', '打开');
      open.type = 'button';
      open.addEventListener('click', function () {
        var c = JSON.parse(JSON.stringify(item.card));
        state.card = c;
        state.originalText = c.originalText || '';
        state.isSample = false;
        state.sampleId = null;
        state.radarTaskOpen = null;
        state.returnView = 'input';
        closeSaved();
        showResult();
      });

      var del = textNode('button', 'btn btn-ghost btn-sm', '删除');
      del.type = 'button';
      del.addEventListener('click', function () {
        var next = readSaved().filter(function (x) { return x.id !== item.id; });
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          renderSaved();
          toast('已删除');
        } catch (e) { toast('删除失败', 'error'); }
      });

      ops.appendChild(open);
      ops.appendChild(del);
      box.appendChild(ops);
      el.savedList.appendChild(box);
    });

    var clearBtn = textNode('button', 'btn btn-ghost', '清除本地保存的全部记录');
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', function () {
      if (!window.confirm('确定清除本设备上保存的全部办事卡吗？此操作不可恢复。')) return;
      try {
        localStorage.removeItem(STORAGE_KEY);
        renderSaved();
        toast('本地记录已清除', 'success');
      } catch (e) { toast('清除失败', 'error'); }
    });
    el.savedFoot.appendChild(clearBtn);
  }

  function renderCloudCards() {
    clear(el.savedList);
    clear(el.savedFoot);
    el.savedNote.textContent = '正在从云端加载你的办事卡…';
    el.savedList.innerHTML = '<div class="saved-item-meta">加载中…</div>';
    window.RadarCards.list().then(function (res) {
      if (res.error) {
        el.savedList.innerHTML = '<div class="saved-item-meta">读取失败：' + res.error.message + '</div>';
        el.savedNote.textContent = '云端读取失败，请重试或检查网络。';
        return;
      }
      var rows = res.data || [];
      el.savedNote.textContent = '共 ' + rows.length + ' 张（云端同步，手机/电脑通用）。';
      clear(el.savedList);
      if (!rows.length) {
        el.savedList.appendChild(emptyNote('云端还没有保存过的办事卡。在结果页点「保存到云端」即可。'));
        return;
      }
      rows.forEach(function (row) {
        var c = row.card_json || {};
        var box = textNode('div', 'saved-item');
        box.appendChild(textNode('div', 'saved-item-title', row.title || c.title || '未命名'));
        var meta = textNode('div', 'saved-item-meta');
        meta.textContent = (row.category || c.category || '其他') + ' · 保存于 ' + formatTime(row.created_at);
        box.appendChild(meta);

        var ops = textNode('div', 'saved-item-ops');
        var open = textNode('button', 'btn btn-ghost btn-sm', '打开');
        open.type = 'button';
        open.addEventListener('click', function () {
          var cc = JSON.parse(JSON.stringify(c));
          state.card = cc;
          state.originalText = cc.originalText || '';
          state.isSample = false;
          state.sampleId = null;
          state.radarTaskOpen = null;
          state.returnView = 'input';
          currentSavedId = row.id;
          closeSaved();
          showResult();
        });
        var rem = textNode('button', 'btn btn-ghost btn-sm', '提醒');
        rem.type = 'button';
        rem.addEventListener('click', function () {
          currentSavedId = row.id;
          var d = (c.deadline && c.deadline.normalized_date) ? c.deadline.normalized_date : null;
          if (!d) { toast('该卡片没有明确的办理日期，无法设置提醒', 'error'); return; }
          window.RadarReminders.openSetForCard(row.id, d);
        });
        var del = textNode('button', 'btn btn-ghost btn-sm', '删除');
        del.type = 'button';
        del.addEventListener('click', function () {
          window.RadarCards.remove(row.id).then(function () {
            renderSaved();
            toast('已删除');
          }).catch(function () { toast('删除失败', 'error'); });
        });
        ops.appendChild(open);
        ops.appendChild(rem);
        ops.appendChild(del);
        box.appendChild(ops);
        el.savedList.appendChild(box);
      });
    }).catch(function () {
      el.savedList.innerHTML = '<div class="saved-item-meta">读取失败</div>';
      el.savedNote.textContent = '云端读取失败，请重试。';
    });
  }

  function openSaved() { renderSaved(); el.savedScrim.hidden = false; el.savedDrawer.hidden = false; }
  function closeSaved() { el.savedScrim.hidden = true; el.savedDrawer.hidden = true; }

  /* ============================================================
     视图切换
     ============================================================ */

  var RADAR_VIEW_IDS = {
    input: 'viewInput',
    result: 'viewResult',
    inbox: 'viewInbox',
    tasks: 'viewTasks',
    connections: 'viewConnections',
    settings: 'viewSettings'
  };

  function showView(name) {
    state.view = name;
    Object.keys(RADAR_VIEW_IDS).forEach(function (k) {
      var node = document.getElementById(RADAR_VIEW_IDS[k]);
      if (node) node.hidden = (k !== name);
    });
    var nav = document.getElementById('topbarNav');
    if (nav) {
      Array.prototype.forEach.call(nav.querySelectorAll('.nav-btn'), function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-nav') === name);
      });
    }
    window.scrollTo(0, 0);
    if (name === 'inbox') renderInbox();
    if (name === 'tasks') renderTasksView();
    if (name === 'connections') renderConnections();
    if (name === 'settings') syncSettingsUI();
  }

  function showInput() {
    showView('input');
  }

  function showResult() {
    state.view = 'result';
    Object.keys(RADAR_VIEW_IDS).forEach(function (k) {
      var node = document.getElementById(RADAR_VIEW_IDS[k]);
      if (node) node.hidden = (k !== 'result');
    });
    var nav = document.getElementById('topbarNav');
    if (nav) {
      Array.prototype.forEach.call(nav.querySelectorAll('.nav-btn'), function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-nav') === 'result');
      });
    }
    el.sampleBanner.hidden = !state.isSample;
    state.editingTaskId = null;
    state.editingDraft = null;
    // 换卡时把原文依据区收回折叠态，避免沿用上一张卡的展开状态
    if (el.evidenceToggle) el.evidenceToggle.setAttribute('aria-expanded', 'false');
    if (el.evidenceBody) el.evidenceBody.hidden = true;
    syncRadarCardActions();
    render();
    window.scrollTo(0, 0);
  }

  function radarGoBack() {
    var back = state.returnView || 'input';
    if (back === 'result') back = 'input';
    if (!RADAR_VIEW_IDS[back]) back = 'input';
    state.radarTaskOpen = null;
    showView(back);
  }

  /* ============================================================
     交互
     ============================================================ */

  function updateCounter() {
    var len = el.noticeInput.value.length;
    el.charCount.textContent = String(len);
    el.counter.classList.remove('is-over', 'is-near');

    if (len > MAX_LEN) {
      el.counter.classList.add('is-over');
      // 超限时禁用提交并明确说明，避免静默截断关键内容
      el.submitBtn.disabled = true;
      if (!state.parsing) showInputError('内容已超过 ' + MAX_LEN + ' 字上限（当前 ' + len + ' 字），请精简后再生成。请勿直接粘贴过长的通知。', false);
    } else {
      if (len > MAX_LEN * 0.9) el.counter.classList.add('is-near');
      el.submitBtn.disabled = state.parsing;
    }
  }

  function showInputError(msg, canRetry) {
    el.inputError.textContent = msg;
    el.inputError.hidden = false;
    var acts = $('inputErrorActions');
    if (acts) {
      acts.hidden = !canRetry;
      var hint = acts.querySelector('.input-error-hint');
      if (hint) hint.textContent = canRetry
        ? '你的通知原文已完整保留在上面的输入框里'
        : '';
    }
  }
  function hideInputError() {
    el.inputError.hidden = true;
    var acts = $('inputErrorActions');
    if (acts) acts.hidden = true;
  }

  function setLoading(on) {
    state.parsing = on;
    var overLimit = el.noticeInput.value.length > MAX_LEN;
    el.submitBtn.disabled = on || overLimit;
    el.submitBtn.classList.toggle('is-loading', on);
    el.submitBtn.querySelector('.btn-label').textContent = on ? '正在提取事项……' : '生成办事卡';
  }

  function doParse() {
    var text = el.noticeInput.value;
    hideInputError();

    if (!text.trim()) {
      showInputError('请先粘贴一段通知内容，再生成办事卡。', false);
      el.noticeInput.focus();
      return;
    }
    if (text.length > MAX_LEN) {
      showInputError('内容超过 ' + MAX_LEN + ' 字，请精简后再试（当前 ' + text.length + ' 字）。', false);
      return;
    }

    state.originalText = text;
    setLoading(true);

    parseNotice(text)
      .then(function (obj) {
        var card = normalizeCard(obj, text);
        if (!card.tasks.length && !card.materials.length && !card.steps.length) {
          throw new Error('EMPTY_RESULT');
        }
        state.card = card;
        state.isSample = false;
        state.sampleId = null;
        state.radarTaskOpen = null;
        state.returnView = 'input';
        setLoading(false);
        showResult();
        toast('办事卡已生成', 'success');
      })
      .catch(function (err) {
        setLoading(false);
        var code = (err && err.error && err.error.code) || err.message || 'UNKNOWN';
        if (code === 'NO_MODEL') {
          showInputError('当前没有可用的模型，无法实时解析。你的原文已保留，可以改用「手动整理」。', true);
        } else if (code === 'NO_SDK') {
          showInputError('模型组件未加载成功，无法实时解析。你的原文已保留，可以改用「手动整理」。', true);
        } else if (code === 'EMPTY_RESULT') {
          showInputError('没能从这段文字里提取出明确事项，请确认是否粘贴了完整通知，或改用手动整理。原文已保留。', true);
        } else if (code === 'auth_' || code === 'request_invalid_parameter') {
          showInputError('模型服务暂时不可用或校验未通过。你的原文已保留，可重试或改用手动整理。', true);
        } else if (code === 'timeout' || code === 'AbortError') {
          showInputError('解析超时了，你的原文已保留，可以点击重试。', true);
        } else {
          showInputError('解析没有成功，你的原文已保留。请重试，或改用手动整理。', true);
        }
        toast('解析失败，原文已保留', 'error');
      });
  }

  /* ---------------- 截图识别（浏览器端免费 OCR，无需密钥） ---------------- */
  var tesseractPromise = null;

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (tesseractPromise) return tesseractPromise;
    tesseractPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.async = true;
      s.onload = function () {
        if (window.Tesseract) resolve(window.Tesseract);
        else reject(new Error('Tesseract missing'));
      };
      s.onerror = function () { reject(new Error('Tesseract load failed')); };
      document.head.appendChild(s);
    });
    return tesseractPromise;
  }

  function setOcrLoading(on) {
    if (!el.ocrBtn) return;
    el.ocrBtn.disabled = on;
    el.ocrBtn.classList.toggle('is-loading', on);
    var label = el.ocrBtn.querySelector('.btn-label');
    if (label) label.textContent = on ? '识别中…' : '截图识别';
  }

  function handleOcrFile(file) {
    if (!file) return;
    setOcrLoading(true);
    var hintTimer = setTimeout(function () { toast('正在识别图片中的文字…', 'success'); }, 900);

    loadTesseract()
      .then(function (Tesseract) {
        return Tesseract.recognize(file, 'chi_sim', { logger: function () {} });
      })
      .then(function (result) {
        clearTimeout(hintTimer);
        setOcrLoading(false);
        var text = ((result && result.data && result.data.text) || '').trim();
        if (!text) {
          toast('没能从图片里识别出文字，请换张截图或手动粘贴', 'error');
          return;
        }
        el.noticeInput.value = text;
        updateCounter();
        hideInputError();
        toast('识别完成，正在生成办事卡', 'success');
        doParse();
      })
      .catch(function () {
        clearTimeout(hintTimer);
        setOcrLoading(false);
        toast('图片识别失败，请手动粘贴或重试', 'error');
      });
  }

  function doManualParse() {
    hideInputError();
    var title = ($('manualTitle').value || '').trim();
    var summary = ($('manualSummary').value || '').trim();
    var category = $('manualCategory').value;
    var dlText = ($('manualDeadline').value || '').trim();
    var taskText = $('manualTasks').value || '';
    var matText = $('manualMaterials').value || '';
    var stepText = $('manualSteps').value || '';
    var qText = $('manualQuestions').value || '';

    if (!title && !summary && !taskText.trim()) {
      showInputError('至少填写标题或一条待办事项。');
      return;
    }

    var lines = function (v) {
      return v.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    };

    var card = {
      title: title || '待确认事项',
      summary: summary,
      category: CATEGORIES.indexOf(category) !== -1 ? category : '其他',
      deadline: {
        original_text: dlText,
        normalized_date: null,
        needs_confirmation: !dlText || looksRelative(dlText),
        source_quote: '',
        grounded: false,
        bears_deadline: isDeadlineBearing(dlText, '')
      },
      tasks: lines(taskText).map(function (t) {
        return { id: uid('t'), title: t, completed: false, source_quote: '', needs_confirmation: true, grounded: false };
      }),
      materials: lines(matText).map(function (m) {
        return { id: uid('m'), name: m, completed: false, source_quote: '', needs_confirmation: true, grounded: false };
      }),
      steps: lines(stepText).map(function (s) {
        return { id: uid('s'), text: s, source_quote: '', grounded: false };
      }),
      questions_to_confirm: lines(qText).map(function (q) {
        return { id: uid('q'), question: q, reason: '手动整理时添加的问题，暂无原文依据。' };
      }),
      source: 'manual',
      createdAt: new Date().toISOString()
    };

    state.card = card;
    state.originalText = '';
    state.isSample = false;
    state.sampleId = null;
    state.radarTaskOpen = null;
    state.returnView = 'input';
    showResult();
    toast('已生成手动整理的办事卡', 'success');
  }

  /* ---------------- 示例 ---------------- */

  function renderSamples() {
    clear(el.sampleGrid);
    (window.TASKCARD_SAMPLES || []).forEach(function (s) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sample-card';

      var icon = textNode('span', 'sample-icon');
      var holder = document.createElement('span');
      holder.innerHTML = s.icon;
      holder.style.display = 'inline-flex';
      icon.appendChild(holder.firstChild);
      btn.appendChild(icon);

      var wrap = textNode('span', 'sample-text');
      wrap.appendChild(textNode('span', 'sample-name', s.name));
      wrap.appendChild(textNode('span', 'sample-desc', s.desc));
      btn.appendChild(wrap);

      btn.appendChild(textNode('span', 'sample-go', '使用 →'));

      btn.addEventListener('click', function () {
        el.noticeInput.value = s.text;
        updateCounter();
        hideInputError();
        state.card = JSON.parse(JSON.stringify(s.card));
        state.originalText = s.text;
        state.isSample = true;
        state.sampleId = s.id;
        state.radarTaskOpen = null;
        state.returnView = 'input';
        showResult();
      });

      el.sampleGrid.appendChild(btn);
    });
  }

  /* ============================================================
     启动
     ============================================================ */

  function init() {
    el.noticeInput.addEventListener('input', function () {
      var over = el.noticeInput.value.length > MAX_LEN;
      updateCounter();
      if (!over) hideInputError();
    });

    el.submitBtn.addEventListener('click', doParse);

    $('retryBtn').addEventListener('click', function () {
      doParse();
    });

    el.clearBtn.addEventListener('click', function () {
      el.noticeInput.value = '';
      updateCounter();
      hideInputError();
      el.noticeInput.focus();
      toast('已清空');
    });

    el.ocrBtn.addEventListener('click', function () {
      if (el.ocrInput) el.ocrInput.click();
    });

    el.ocrInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) handleOcrFile(file);
      e.target.value = '';
    });

    $('manualSubmitBtn').addEventListener('click', doManualParse);

    el.backBtn.addEventListener('click', radarGoBack);

    el.restartBtn.addEventListener('click', function () {
      if (!window.confirm('确定返回输入页重新整理吗？当前这张卡会从屏幕上清除（已保存到本设备的记录不受影响）。')) return;
      state.card = null;
      state.originalText = '';
      state.isSample = false;
      state.sampleId = null;
      state.radarTaskOpen = null;
      state.returnView = 'input';
      el.noticeInput.value = '';
      updateCounter();
      hideInputError();
      showInput();
    });

    el.copyBtn.addEventListener('click', function () {
      if (!state.card) return;
      var text = buildPlainText();
      copyToClipboard(text).then(function () {
        toast('办事卡已复制到剪贴板', 'success');
      }).catch(function () {
        var manual = window.prompt('浏览器未授权剪贴板，请手动复制下面的内容：', text);
        if (manual === null) toast('复制未完成，请改用打印', 'error');
        else toast('请手动复制上面的内容', 'error');
      });
    });

    el.printBtn.addEventListener('click', function () {
      window.print();
    });

    el.saveLocalBtn.addEventListener('click', saveCard);

    if (el.reminderBtn) {
      el.reminderBtn.addEventListener('click', function () {
        if (!state.card) return;
        var m = getMode();
        if (m !== 'cloud') {
          if (window.RadarAccount && window.RadarAccount.showOverlay) window.RadarAccount.showOverlay();
          toast('请先登录并保存卡片，再设置提醒', 'error');
          return;
        }
        var deadlineISO = (state.card.deadline && state.card.deadline.normalized_date) ? state.card.deadline.normalized_date : null;
        if (!deadlineISO) { toast('该卡片没有明确的办理日期，无法设置提醒', 'error'); return; }
        ensureCloudCard().then(function (id) {
          if (!id || id.error) { toast('请先保存到云端再设置提醒', 'error'); return; }
          window.RadarReminders.openSetForCard(id, deadlineISO);
        });
      });
    }

    el.addTaskBtn.addEventListener('click', function () {
      if (!state.card) return;
      state.card.tasks.push({
        id: uid('t'),
        title: '新待办事项',
        completed: false,
        source_quote: '',
        needs_confirmation: true,
        grounded: false
      });
      state.editingTaskId = state.card.tasks[state.card.tasks.length - 1].id;
      touchRadarCard();
      render();
    });

    el.evidenceToggle.addEventListener('click', function () {
      var open = el.evidenceToggle.getAttribute('aria-expanded') === 'true';
      el.evidenceToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      el.evidenceBody.hidden = open;
    });

    el.navSavedBtn.addEventListener('click', openSaved);
    el.savedCloseBtn.addEventListener('click', closeSaved);
    el.savedScrim.addEventListener('click', closeSaved);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el.savedDrawer.hidden) closeSaved();
    });

    renderSamples();
    updateCounter();
    renderSaved();
    radarInit();
  }

  /* ============================================================
     办事雷达：消息捕捉 / 收件箱 / 任务视图 / 连接中心 / 提醒
     本地优先：数据存 localStorage。云服务（Database/Auth）未开通前
     如实标注"仅保存在本设备"，不伪造云同步状态。
     ============================================================ */

  var RADAR_MSG_KEY = 'taskcard.radar.messages.v1';
  var RADAR_TASK_KEY = 'taskcard.radar.tasks.v1';
  var RADAR_SET_KEY = 'taskcard.radar.settings.v1';
  var RADAR_CONN_KEY = 'taskcard.radar.connections.v1';
  var RADAR_NOTIFIED_KEY = 'taskcard.radar.notified.v1';
  var RADAR_MAX_LEN = MAX_LEN;

  var RADAR_DEFAULT_SETTINGS = {
    autoCapture: true,
    sources: { manual: true, clipboard: true, link: true },
    autoCreateHigh: true,
    reviewAll: false,
    remindLeadMinutes: 1440,
    mergeReminders: true,
    quietEnabled: true,
    quietStart: '22:00',
    quietEnd: '08:00',
    dailyDigest: false,
    digestTime: '08:30',
    keepOriginalText: true
  };

  var RADAR_SOURCE_NAMES = {
    manual: '手动粘贴',
    clipboard: '剪贴板捕捉',
    link: '链接导入'
  };

  /* 收件箱空状态的示例消息（与导入框占位文案一致） */
  var RADAR_SAMPLE_MSG = '【培训中心】你报名的职业技能培训班将于2026年11月15日开班，请于11月10日前携带身份证复印件到培训中心二楼完成现场确认，逾期视为放弃报名。现场确认不收取任何费用。';

  /* 连接中心：来源定义。平台来源的状态是真实的——探测不到就如实显示，
     绝不显示虚构的"已连接"徽标。 */
  var RADAR_CONN_DEFS = [
    { id: 'manual', name: '手动粘贴导入', type: 'local',
      permissions: '仅处理你主动粘贴或转发的文本',
      boundary: '' },
    { id: 'clipboard', name: '剪贴板捕捉', type: 'local',
      permissions: '仅在你点击「捕捉剪贴板」时读取一次剪贴板，浏览器可能弹窗询问授权',
      boundary: '拒绝授权后本应用不会读取剪贴板。' },
    { id: 'link', name: '链接导入', type: 'local',
      permissions: '仅处理通过带 ?msg= 参数的链接打开时携带的文本',
      boundary: '' },
    { id: 'wecom', name: '企业微信（转发聊天）', type: 'platform', initStatus: '待授权',
      permissions: '若在 WorkBuddy 应用内完成企业微信授权：对话侧可引用转发聊天中的在线文档、微盘文件、日程、待办等资源',
      boundary: '能力边界：不支持监听新消息；网页应用无法直接读取连接器数据（平台限制），本应用目前不能自动接收企业微信消息。' },
    { id: 'wechat', name: '微信（个人）', type: 'platform', initStatus: '未连接',
      permissions: '—',
      boundary: '能力边界：当前 WorkBuddy 平台没有个人微信助理集成，也不存在官方的全量聊天读取入口，因此本应用不提供该来源。' },
    { id: 'feishu', name: '飞书', type: 'platform', initStatus: '未连接',
      permissions: '—（需先在 WorkBuddy 中安装并授权飞书连接器）',
      boundary: '能力边界：当前账号未安装未授权；即使授权，网页应用也无法直接读取连接器数据。' },
    { id: 'dingtalk', name: '钉钉', type: 'platform', initStatus: '未连接',
      permissions: '—（需先在 WorkBuddy 中安装并授权钉钉连接器）',
      boundary: '能力边界：当前账号未安装未授权；即使授权，网页应用也无法直接读取连接器数据。' },
    { id: 'email', name: '邮箱', type: 'platform', initStatus: '未连接',
      permissions: '—（当前环境没有已授权的邮箱连接器）',
      boundary: '能力边界：当前账号未安装未授权。' }
  ];

  /* ---------------- 雷达存储 ---------------- */

  function radarRead(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) { return fallback; }
  }

  function radarWrite(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      toast('本地存储写入失败，请清理浏览器空间', 'error');
      return false;
    }
  }

  function radarSettings() {
    var s = radarRead(RADAR_SET_KEY, null);
    if (!s || typeof s !== 'object') return JSON.parse(JSON.stringify(RADAR_DEFAULT_SETTINGS));
    var merged = JSON.parse(JSON.stringify(RADAR_DEFAULT_SETTINGS));
    Object.keys(RADAR_DEFAULT_SETTINGS).forEach(function (k) {
      if (s[k] !== undefined) {
        if (k === 'sources') {
          Object.keys(RADAR_DEFAULT_SETTINGS.sources).forEach(function (sk) {
            if (s.sources && typeof s.sources[sk] === 'boolean') merged.sources[sk] = s.sources[sk];
          });
        } else {
          merged[k] = s[k];
        }
      }
    });
    return merged;
  }

  function saveRadarSettings(s) { radarWrite(RADAR_SET_KEY, s); }

  function radarMessages() {
    var list = radarRead(RADAR_MSG_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function saveRadarMessages(list) { radarWrite(RADAR_MSG_KEY, list); }

  function radarTasks() {
    var list = radarRead(RADAR_TASK_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function saveRadarTasks(list) { radarWrite(RADAR_TASK_KEY, list); }

  function radarConnRuntime() {
    var v = radarRead(RADAR_CONN_KEY, {});
    return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
  }

  function saveRadarConnRuntime(v) { radarWrite(RADAR_CONN_KEY, v); }

  /* ---------------- 雷达纯函数（可单元测试） ---------------- */

  /** djb2 文本哈希，配合 normalizeForMatch 做消息/任务去重。
      再去掉全部非字母数字汉字字符：转发/复制常带来标点与空白差异，
      去重只关心内容实质，不应因标点不同而重复建卡。 */
  function hashText(s) {
    var t = normalizeForMatch(s).replace(/[^0-9a-z\u4e00-\u9fa5]+/g, '');
    var h = 5381;
    for (var i = 0; i < t.length; i++) {
      h = ((h << 5) + h + t.charCodeAt(i)) & 0x7FFFFFFF;
    }
    return h.toString(16) + '-' + t.length.toString(16);
  }

  /** 从原文推导消息标题：第一条非空行，截 42 字 */
  function deriveTitle(text) {
    var lines = String(text || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (!l) continue;
      return l.length > 42 ? l.slice(0, 42) + '…' : l;
    }
    return '（无文本）';
  }

  function dayKey(d) {
    var p = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function dateAddDays(d, n) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  }

  /** bKey - aKey 的天数差（按本地日期） */
  function diffDays(aKey, bKey) {
    var a = new Date(aKey + 'T00:00:00');
    var b = new Date(bKey + 'T00:00:00');
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return NaN;
    return Math.round((b - a) / 86400000);
  }

  /** 解析结果的置信度：行动明确度 + 原文依据充分度 + 时间清晰度 + 待核实数量 */
  function computeConfidence(card) {
    var reasons = [];
    var items = (card.tasks || []).concat(card.materials || []);
    var grounded = items.filter(function (x) { return x.grounded && !x.needs_confirmation; });
    var hasAction = (card.tasks && card.tasks.length > 0) || (card.steps && card.steps.length > 0);
    if (!hasAction) {
      return { level: 'low', reasons: ['未提取到明确的行动事项'] };
    }
    var level = 'high';
    var d = card.deadline || {};
    if (d.original_text) {
      if (d.bears_deadline === false) {
        level = 'low';
        reasons.push('原文时间没有期限语义，不能确定是截止时间');
      } else if (d.needs_confirmation || !d.normalized_date) {
        level = 'medium';
        reasons.push('截止时间表述模糊，未换算出具体日期');
      }
    }
    if (card.questions_to_confirm && card.questions_to_confirm.length > 0) {
      if (level === 'high') level = 'medium';
      reasons.push('有 ' + card.questions_to_confirm.length + ' 处需要核实');
    }
    if (items.length > 0 && grounded.length < items.length) {
      if (level === 'high') level = 'medium';
      reasons.push('部分条目缺少原文依据');
    }
    if (!grounded.length && card.questions_to_confirm && card.questions_to_confirm.length >= 2) {
      level = 'low';
    }
    return { level: level, reasons: reasons };
  }

  var CONF_RANK = { low: 0, medium: 1, high: 2 };

  /** 按置信度与设置决定这条消息生成什么状态的任务 */
  function decideRoute(conf, settings) {
    if (settings.reviewAll) {
      return { origin: 'review', status: '待确认', reason: '审核模式已开启，所有新事项先确认' };
    }
    if (conf.level === 'high' && settings.autoCreateHigh) {
      return { origin: 'auto', status: '进行中', reason: '高置信度，自动生成' };
    }
    if (conf.level === 'high') {
      return { origin: 'review', status: '待确认', reason: '未开启"高置信度自动生成"' };
    }
    return { origin: 'review', status: '待确认', reason: '置信度不足（' + conf.level + '）' };
  }

  function taskIsActive(t) {
    return t.status === '进行中' || t.status === '待确认';
  }

  /** 按截止日期把任务分进 今日/明日/待确认/即将截止 桶。
      日期桶只含「进行中」的任务（待确认的日期还没核实，不算截止）。 */
  function taskBuckets(tasks, now) {
    var today = dayKey(now);
    var tomorrow = dayKey(dateAddDays(now, 1));
    var soonEnd = dayKey(dateAddDays(now, 7));
    var b = { today: [], tomorrow: [], soon: [], pending: [], all: [], overdueCount: 0 };
    (tasks || []).forEach(function (t) {
      if (t.status === '已忽略') return;
      b.all.push(t);
      if (t.status === '待确认') b.pending.push(t);
      if (t.status !== '进行中') return;
      if (!t.deadline_date) return;
      var dd = diffDays(today, t.deadline_date);
      if (isNaN(dd)) return;
      if (dd <= 0) { b.today.push(t); if (dd < 0) b.overdueCount++; }
      else if (t.deadline_date === tomorrow) b.tomorrow.push(t);
      else if (dd <= 7) b.soon.push(t);
    });
    return b;
  }

  function radarStats(tasks, now) {
    var b = taskBuckets(tasks, now);
    return {
      today: b.today.length,
      soon: b.tomorrow.length + b.soon.length,
      pending: b.pending.length
    };
  }

  function isQuietNow(settings, now) {
    if (!settings.quietEnabled) return false;
    var m = now.getHours() * 60 + now.getMinutes();
    function toMin(hhmm) {
      var p = String(hhmm || '').split(':');
      var h = parseInt(p[0], 10), mm = parseInt(p[1], 10);
      if (isNaN(h) || isNaN(mm)) return NaN;
      return h * 60 + mm;
    }
    var s = toMin(settings.quietStart), e = toMin(settings.quietEnd);
    if (isNaN(s) || isNaN(e)) return false;
    if (s === e) return false;
    return s > e ? (m >= s || m < e) : (m >= s && m < e);
  }

  /** 当前应发送的到期提醒。firedKeys 里已有的 key 不再发。 */
  function notifyCandidates(tasks, settings, now, firedKeys) {
    var out = [];
    var leadDays = Math.max(1, Math.ceil((settings.remindLeadMinutes || 1440) / 1440));
    var today = dayKey(now);
    (tasks || []).forEach(function (t) {
      if (!taskIsActive(t) || !t.deadline_date) return;
      var dleft = diffDays(today, t.deadline_date);
      if (isNaN(dleft)) return;
      if (dleft > leadDays) return;
      var key = t.id + '|' + (dleft < 0 ? 'overdue-' + today : 'left-' + dleft);
      if (firedKeys[key]) return;
      var phrase = dleft < 0 ? '已过期 ' + (-dleft) + ' 天'
        : dleft === 0 ? '今天截止'
        : dleft === 1 ? '明天截止'
        : '还剩 ' + dleft + ' 天';
      out.push({
        key: key,
        title: '办事雷达 · ' + phrase,
        body: '「' + t.title + '」' + phrase +
          (t.deadline_text ? '，截止表述：' + t.deadline_text : '') +
          '。点击打开应用处理。'
      });
    });
    return out;
  }

  function icsEscape(s) {
    return String(s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  function icsStamp(d) {
    var p = function (n) { return n < 10 ? '0' + n : String(n); };
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
      'T' + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z';
  }

  /** 生成日历文件。只含有明确截止日期、仍在进行中的任务；模糊日期不导出。 */
  function buildICS(tasks, now, leadMinutes) {
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TaskCard//BanShiLeiDa//CN',
      'CALSCALE:GREGORIAN'
    ];
    var stamp = icsStamp(now || new Date());
    var count = 0;
    (tasks || []).forEach(function (t) {
      if (t.status !== '进行中' || !t.deadline_date) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.deadline_date)) return;
      var ymd = t.deadline_date.replace(/-/g, '');
      var endYmd = dayKey(dateAddDays(new Date(t.deadline_date + 'T00:00:00'), 1)).replace(/-/g, '');
      var lead = leadMinutes || 1440;
      count++;
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + t.id + '@taskcard-radar');
      lines.push('DTSTAMP:' + stamp);
      lines.push('DTSTART;VALUE=DATE:' + ymd);
      lines.push('DTEND;VALUE=DATE:' + endYmd);
      lines.push('SUMMARY:' + icsEscape('截止：' + t.title));
      lines.push('DESCRIPTION:' + icsEscape(
        (t.deadline_text ? '原文表述：' + t.deadline_text + '。' : '') +
        '来源：办事雷达 · TaskCard'));
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:-PT' + lead + 'M');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:' + icsEscape('「' + t.title + '」即将截止'));
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return { text: lines.join('\r\n') + '\r\n', count: count };
  }

  function buildDigestText(tasks, now) {
    var b = taskBuckets(tasks, now);
    var L = [];
    L.push('【办事雷达 · 今日概览】' + dayKey(now));
    L.push('今日截止：' + b.today.length + ' 件' + (b.overdueCount ? '（含已过期 ' + b.overdueCount + ' 件）' : ''));
    b.today.forEach(function (t) {
      L.push('  · ' + t.title + (t.deadline_date && t.deadline_date !== dayKey(now) ? '（已过期，原定 ' + t.deadline_date + '）' : ''));
    });
    L.push('明日截止：' + b.tomorrow.length + ' 件');
    b.tomorrow.forEach(function (t) { L.push('  · ' + t.title); });
    L.push('即将截止（3-7 天内）：' + b.soon.length + ' 件');
    b.soon.forEach(function (t) { L.push('  · ' + t.title + '（' + t.deadline_date + '）'); });
    L.push('待确认：' + b.pending.length + ' 件');
    b.pending.forEach(function (t) { L.push('  · ' + t.title); });
    if (!b.today.length && !b.tomorrow.length && !b.soon.length && !b.pending.length) {
      L.push('（当前没有需要关注的事项）');
    }
    L.push('—— 由办事雷达 · TaskCard 生成');
    return L.join('\n');
  }

  /** 备份合并：相同 ID 以备份为准，本地独有保留；备份记录在前，结果去重保序 */
  function mergeBackupById(localList, backupList) {
    var byId = {};
    backupList.forEach(function (x) { if (x && x.id) byId[x.id] = x; });
    localList.forEach(function (x) { if (x && x.id && !byId[x.id]) byId[x.id] = x; });
    var out = [], seen = {};
    backupList.forEach(function (x) { if (x && x.id && !seen[x.id]) { seen[x.id] = 1; out.push(x); } });
    localList.forEach(function (x) { if (x && x.id && !seen[x.id]) { seen[x.id] = 1; out.push(x); } });
    return out;
  }

  /** 相对时间：1 小时内「N 分钟前」，24 小时内「N 小时前」，7 天内「N 天前」，否则绝对时间 */
  function formatRelative(iso) {
    var t = new Date(iso);
    if (isNaN(t.getTime())) return formatTime(iso);
    var diff = Date.now() - t.getTime();
    if (diff < 0) return formatTime(iso);
    var min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    var h = Math.floor(min / 60);
    if (h < 24) return h + ' 小时前';
    var d = Math.floor(h / 24);
    if (d < 7) return d + ' 天前';
    return formatTime(iso);
  }

  /* ---------------- 雷达 DOM 与状态 ---------------- */

  var R = {};   // 雷达视图的 DOM 引用，radarInit 时收集
  var radarSettingsCache = null;

  function radarGetSettings() {
    if (!radarSettingsCache) radarSettingsCache = radarSettings();
    return radarSettingsCache;
  }

  function findRadarTask(id) {
    var list = radarTasks();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function findRadarMessage(id) {
    var list = radarMessages();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  /** 结果页编辑的是雷达任务卡时，把改动落回本地存储 */
  function touchRadarCard() {
    if (!state.radarTaskOpen) return;
    var t = findRadarTask(state.radarTaskOpen);
    if (!t) return;
    t.updated_at = new Date().toISOString();
    syncTaskDeadline(t);
    saveRadarTasks(radarTasks());
    updateRadarBadges();
  }

  function syncTaskDeadline(t) {
    var d = t.card && t.card.deadline;
    t.deadline_date = (d && d.normalized_date && d.bears_deadline !== false)
      ? d.normalized_date : null;
    t.deadline_text = d ? (d.original_text || '') : '';
  }

  /* ---------------- 收件箱：导入 → 解析 → 路由 ---------------- */

  function showMsgError(msg) {
    R.msgError.textContent = msg;
    R.msgError.hidden = false;
  }
  function hideMsgError() {
    R.msgError.hidden = true;
  }

  /** 导入一条消息。返回 null 表示被拒绝（来源关闭/为空/去重）。 */
  function importMessage(source, text, opts) {
    opts = opts || {};
    var s = radarGetSettings();
    var srcName = RADAR_SOURCE_NAMES[source] || source;

    if (!s.sources[source]) {
      toast('「' + srcName + '」来源已在设置中关闭', 'error');
      return null;
    }
    var t = String(text || '').trim();
    if (!t) {
      if (!opts.silentEmpty) toast('没有可导入的文本内容', 'error');
      return null;
    }
    if (t.length > RADAR_MAX_LEN) {
      showMsgError('内容超过 ' + RADAR_MAX_LEN + ' 字（当前 ' + t.length + ' 字），请精简后再导入。');
      return null;
    }

    var hash = hashText(t);
    var dup = findDuplicateMessage(hash);
    if (dup) {
      if (!opts.silentDup) {
        toast('该消息已在收件箱中（' + dup.status + '），已自动去重', 'success');
      }
      return null;
    }

    var nowIso = new Date().toISOString();
    var msg = {
      id: uid('msg'),
      source: source,
      source_name: srcName,
      source_message_id: opts.sourceMessageId || null,
      title: deriveTitle(t),
      original_text: t,
      text_hash: hash,
      received_at: opts.receivedAt || nowIso,
      received_at_source: opts.receivedAtSource === true,
      status: '待处理',
      status_note: '',
      parse_error: '',
      card_id: null,
      confidence: null,
      created_at: nowIso,
      updated_at: nowIso
    };

    var list = radarMessages();
    list.unshift(msg);
    saveRadarMessages(list);

    var conn = radarConnRuntime();
    conn[source] = conn[source] || {};
    conn[source].lastOkAt = nowIso;
    conn[source].lastError = null;
    saveRadarConnRuntime(conn);

    updateRadarBadges();
    if (state.view === 'inbox') renderInbox();

    if (s.autoCapture) {
      parseRadarMessage(msg.id);
    }
    return msg;
  }

  function findDuplicateMessage(hash) {
    var list = radarMessages();
    for (var i = 0; i < list.length; i++) {
      if (list[i].text_hash === hash && list[i].status !== '解析失败') return list[i];
    }
    return null;
  }

  /* 解析中的消息按 id 记忙：msg._busy 会在重渲染重建对象时丢失，
     按 id 记才能挡住"渲染间隙双击"导致的并发解析与重复 AI 调用 */
  var RADAR_BUSY = {};

  /** AI 解析一条消息并路由。msg._busy 只是运行时标记，不落盘。 */
  function parseRadarMessage(msgId) {
    var msg = findRadarMessage(msgId);
    if (!msg) return Promise.resolve();
    if (RADAR_BUSY[msgId]) return Promise.resolve();
    if (!msg.original_text || !String(msg.original_text).trim()) {
      msg.status = '解析失败';
      msg.parse_error = '消息原文已被清除（隐私设置），无法重新解析；请删除后重新导入。';
      persistMessageUpdate(msg);
      return Promise.resolve();
    }

    RADAR_BUSY[msgId] = true;
    msg._busy = true;
    // 立即重渲染一次：让"正在解析…"提示与按钮禁用即时可见，而不是等到落库
    if (state.view === 'inbox') renderInbox();
    var text = msg.original_text;
    return parseNotice(text)
      .then(function (obj) {
        var card = normalizeCard(obj, text);
        if (!card.tasks.length && !card.materials.length && !card.steps.length) {
          throw new Error('EMPTY_RESULT');
        }
        finishRadarParse(msg, card);
      })
      .catch(function (err) {
        var code = (err && err.error && err.error.code) || err.message || 'UNKNOWN';
        if (code === 'EMPTY_RESULT') {
          msg.status = '已忽略';
          msg.status_note = 'AI 未在这条消息里发现可执行事项，未创建待办。';
        } else {
          msg.status = '解析失败';
          if (code === 'NO_MODEL' || code === 'NO_SDK') msg.parse_error = '模型服务不可用，无法解析。可稍后重试。';
          else if (code === 'timeout' || code === 'AbortError') msg.parse_error = '解析超时。可点击重试。';
          else if (code === 'INVALID_JSON' || code === 'INVALID_SHAPE') msg.parse_error = '模型返回内容无法解析。可点击重试。';
          else msg.parse_error = '解析没有成功（' + code + '）。可点击重试。';
        }
        msg._busy = false;
        delete RADAR_BUSY[msgId];
        persistMessageUpdate(msg);
      });
  }

  /** 需求四.4：相对日期在「有可靠接收时间」时换算为具体日期。
      收件箱消息的接收时间就是导入时刻，因此 今日/明天/后天 可以安全换算；
      其他相对表述（本月底、三天内、尽快）没有可靠锚点，仍保留原文进待确认。
      原文同时写了具体日期时，normalizeCard 已处理，不走本分支。 */
  function resolveRelativeDeadline(card, receivedAtIso) {
    var d = card.deadline;
    if (!d || !d.original_text || d.normalized_date || d.bears_deadline === false) return false;
    var base = new Date(receivedAtIso);
    if (isNaN(base.getTime())) return false;
    var t = String(d.original_text);
    var delta = null;
    var word = '';
    if (/今日|今天/.test(t)) { delta = 0; word = '今日'; }
    else if (/明天/.test(t)) { delta = 1; word = '明天'; }
    else if (/后天/.test(t)) { delta = 2; word = '后天'; }
    if (delta === null) return false;
    d.normalized_date = dayKey(dateAddDays(base, delta));
    d.needs_confirmation = false;
    d.resolved_from_relative = word;
    return true;
  }

  function finishRadarParse(msg, card) {
    var resolved = resolveRelativeDeadline(card, msg.received_at);
    var s = radarGetSettings();
    var conf = computeConfidence(card);
    var route = decideRoute(conf, s);

    var task = createRadarTask(card, msg, route, conf);
    msg._busy = false;
    delete RADAR_BUSY[msg.id];
    if (task.duplicate) {
      msg.status = task.target.status === '待确认' ? '需确认' : '已生成';
      msg.card_id = task.target.id;
      msg.confidence = conf.level;
      msg.status_note = '与已有任务「' + task.target.title + '」内容相同，已合并，未重复创建。';
    } else {
      msg.status = route.status === '进行中' ? '已生成' : '需确认';
      msg.card_id = task.id;
      msg.confidence = conf.level;
      msg.status_note = route.reason + (conf.reasons.length ? '；' + conf.reasons.join('；') : '');
    }

    if (resolved) {
      msg.status_note += '；相对时间「' + card.deadline.resolved_from_relative + '」已按导入日期换算为 ' + card.deadline.normalized_date + '，如消息是转发件请自行核对。';
    }

    var s2 = radarGetSettings();
    if (!s2.keepOriginalText) {
      msg.original_text = '';
      msg.status_note += '（原文已按隐私设置清除，仅保留结构化结果与原文引用）';
    }
    persistMessageUpdate(msg);
  }

  function persistMessageUpdate(msg) {
    var list = radarMessages();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === msg.id) {
        var clean = {};
        Object.keys(msg).forEach(function (k) {
          if (k !== '_busy') clean[k] = msg[k];
        });
        clean.updated_at = new Date().toISOString();
        list[i] = clean;
        break;
      }
    }
    saveRadarMessages(list);
    updateRadarBadges();
    if (state.view === 'inbox') renderInbox();
  }

  /** 创建雷达任务；发现同内容任务时返回 {duplicate:true, target} */
  function createRadarTask(card, msg, route, conf) {
    var list = radarTasks();
    var hash = msg ? msg.text_hash : hashText(card.title + '|' + (card.summary || ''));
    for (var i = 0; i < list.length; i++) {
      if (list[i].source_hash === hash && list[i].status !== '已忽略') {
        return { duplicate: true, target: list[i] };
      }
    }
    var nowIso = new Date().toISOString();
    var t = {
      id: uid('rt'),
      title: card.title,
      summary: card.summary,
      category: card.category,
      card: card,
      origin: route.origin,
      status: route.status,
      source_msg_id: msg ? msg.id : null,
      source_name: msg ? msg.source_name : '手动添加',
      received_at: msg ? msg.received_at : nowIso,
      received_at_source: msg ? msg.received_at_source === true : false,
      source_hash: hash,
      confidence: conf ? conf.level : null,
      deadline_date: null,
      deadline_text: '',
      created_at: nowIso,
      updated_at: nowIso,
      completed_at: null
    };
    syncTaskDeadline(t);
    list.unshift(t);
    saveRadarTasks(list);
    updateRadarBadges();
    return t;
  }

  function setRadarTaskStatus(id, status) {
    var list = radarTasks();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list[i].status = status;
        list[i].updated_at = new Date().toISOString();
        list[i].completed_at = status === '已完成' ? new Date().toISOString() : null;
        break;
      }
    }
    saveRadarTasks(list);
    if (state.radarTaskOpen === id) syncRadarCardActions();
    updateRadarBadges();
  }

  function deleteRadarTask(id) {
    var list = radarTasks().filter(function (t) { return t.id !== id; });
    saveRadarTasks(list);
    // 相关消息保留，但指向已删除任务的消息不再可点"查看办事卡"
    if (state.radarTaskOpen === id) {
      state.radarTaskOpen = null;
      state.card = null;
      showInput();
    } else {
      renderTasksView();
    }
    updateRadarBadges();
  }

  /* ---------------- 收件箱渲染 ---------------- */

  var MSG_STATUS_CLASS = {
    '待处理': 'is-todo',
    '已生成': 'is-generated',
    '需确认': 'is-confirm',
    '已忽略': 'is-ignored',
    '解析失败': 'is-failed'
  };
  var CONF_LABEL = { high: '置信度高', medium: '置信度中', low: '置信度低' };
  var EXPANDED_MSGS = {};   // 展开全文的消息 id（运行时态）

  function renderInbox() {
    if (!R.msgList) return;
    clear(R.msgList);
    var all = radarMessages();
    var s = radarGetSettings();
    if (R.pauseBanner) R.pauseBanner.hidden = !!s.autoCapture;
    var filter = state.radarMsgFilter || '全部';
    var list = filter === '全部' ? all : all.filter(function (m) { return m.status === filter; });

    if (!all.length) {
      var wrap = textNode('div', 'inbox-empty-wrap');
      var empty = emptyNote('还没有消息。粘贴一条通知，或点击「捕捉剪贴板」试试。');
      empty.className = 'empty-note inbox-empty';
      wrap.appendChild(empty);
      var tryBtn = textNode('button', 'btn btn-ghost btn-sm', '导入示例消息，看看解析效果 →');
      tryBtn.type = 'button';
      tryBtn.addEventListener('click', function () {
        var created = importMessage('manual', RADAR_SAMPLE_MSG);
        if (created) toast('示例消息已导入，正在解析…');
      });
      wrap.appendChild(tryBtn);
      R.msgList.appendChild(wrap);
      renderRadarStats();
      return;
    }

    R.msgList.appendChild(textNode('p', 'inbox-summary-note',
      (filter === '全部'
        ? '共 ' + all.length + ' 条记录'
        : '筛选「' + filter + '」：' + list.length + '/' + all.length + ' 条') +
      '，保存在本设备浏览器中。' +
      (s.keepOriginalText ? '消息原文会一并保留以便重新解析。' : '消息原文在解析成功后即被清除。')));

    if (!list.length) {
      var none = emptyNote('没有「' + filter + '」状态的消息。');
      none.className = 'empty-note inbox-empty';
      R.msgList.appendChild(none);
    } else {
      list.forEach(function (msg) {
        R.msgList.appendChild(buildMsgItem(msg));
      });
    }
    renderRadarStats();
  }

  function buildMsgItem(msg) {
    var box = textNode('div', 'msg-item ' + (MSG_STATUS_CLASS[msg.status] || ''));

    var top = textNode('div', 'msg-top');
    top.appendChild(textNode('span', 'chip msg-source-chip', msg.source_name));
    top.appendChild(textNode('span', 'msg-time',
      (msg.received_at_source ? '接收于 ' : '导入于 ') + formatRelative(msg.received_at)));
    top.appendChild(textNode('span', 'msg-status chip ' + MSG_STATUS_CLASS[msg.status], msg.status));
    box.appendChild(top);

    box.appendChild(textNode('div', 'msg-title', msg.title));
    if (msg.original_text) {
      var full = String(msg.original_text).replace(/\s+/g, ' ');
      var expanded = EXPANDED_MSGS[msg.id];
      var snip = expanded ? full : (full.length > 120 ? full.slice(0, 120) + '…' : full);
      var sn = textNode('p', 'msg-snippet' + (expanded ? ' is-expanded' : ''), snip);
      if (full.length > 120) {
        sn.title = expanded ? '点击收起' : '点击展开全文';
        sn.addEventListener('click', function () {
          if (EXPANDED_MSGS[msg.id]) delete EXPANDED_MSGS[msg.id];
          else EXPANDED_MSGS[msg.id] = true;
          renderInbox();
        });
        var more = textNode('span', 'snippet-toggle', expanded ? ' 收起' : ' 展开全文');
        sn.appendChild(more);
      }
      box.appendChild(sn);
    } else if (msg.status === '已生成' || msg.status === '需确认') {
      box.appendChild(textNode('p', 'msg-snippet is-cleared', '（原文已按隐私设置清除，仅保留结构化结果）'));
    }

    if (msg.status_note) {
      box.appendChild(textNode('p', 'msg-note', msg.status_note));
    }
    if (msg.parse_error) {
      box.appendChild(textNode('p', 'msg-note is-error', msg.parse_error));
    }
    if (RADAR_BUSY[msg.id] && (msg.status === '待处理' || msg.status === '解析失败')) {
      box.appendChild(textNode('p', 'msg-note is-parsing', '正在解析…'));
    }

    var meta = textNode('div', 'msg-conf');
    if (msg.confidence && CONF_LABEL[msg.confidence]) {
      meta.appendChild(textNode('span', 'conf-tag conf-' + msg.confidence, CONF_LABEL[msg.confidence]));
    }
    if (meta.childNodes.length) box.appendChild(meta);

    var ops = textNode('div', 'msg-ops');
    if (msg.status === '待处理') {
      ops.appendChild(msgOpBtn('解析', 'btn btn-primary btn-sm', function () {
        parseRadarMessage(msg.id);
      }, msg));
    }
    if (msg.status === '解析失败') {
      ops.appendChild(msgOpBtn('重试解析', 'btn btn-primary btn-sm', function () {
        parseRadarMessage(msg.id);
      }, msg));
    }
    if ((msg.status === '已生成' || msg.status === '需确认') && msg.card_id) {
      ops.appendChild(msgOpBtn('查看办事卡', 'btn btn-ghost btn-sm', function () {
        var t = findRadarTask(msg.card_id);
        if (!t) {
          toast('对应的任务已被删除', 'error');
          return;
        }
        openRadarTask(t.id, 'inbox');
      }, msg));
    }
    if (msg.status === '待处理' || msg.status === '需确认') {
      ops.appendChild(msgOpBtn('忽略', 'btn btn-ghost btn-sm', function () {
        msg.status = '已忽略';
        msg.status_note = '你手动忽略了这条消息。';
        persistMessageUpdate(msg);
        toast('已忽略');
      }, msg));
    }
    ops.appendChild(msgOpBtn('删除', 'btn btn-ghost btn-sm is-danger-text', function () {
      var next = radarMessages().filter(function (x) { return x.id !== msg.id; });
      saveRadarMessages(next);
      updateRadarBadges();
      renderInbox();
      toast('已删除该消息记录');
    }, msg));
    box.appendChild(ops);
    return box;
  }

  function msgOpBtn(label, cls, onClick, msg) {
    var b = textNode('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', function () {
      if (RADAR_BUSY[msg.id]) { toast('正在解析中…'); return; }
      onClick();
    });
    if (msg && msg.status === '待处理' && RADAR_BUSY[msg.id]) b.disabled = true;
    return b;
  }

  /* ---------------- 我的任务渲染 ---------------- */

  function originBadge(t) {
    if (t.origin === 'auto') return '已自动生成';
    if (t.origin === 'manual') return '手动添加';
    return t.status === '待确认' ? '待确认' : '已确认';
  }

  function dueChip(t, now) {
    if (!t.deadline_date) return null;
    var dleft = diffDays(dayKey(now), t.deadline_date);
    if (isNaN(dleft)) return null;
    var label = dleft < 0 ? t.deadline_date + ' · 已过期 ' + (-dleft) + ' 天'
      : dleft === 0 ? '今天截止'
      : dleft === 1 ? '明天截止'
      : t.deadline_date + ' · 还剩 ' + dleft + ' 天';
    return { label: label, overdue: dleft < 0, urgent: dleft >= 0 && dleft <= 1 };
  }

  function renderTasksView() {
    if (!R.radarTaskList) return;
    var now = new Date();
    var tasks = radarTasks();
    var b = taskBuckets(tasks, now);
    var tab = state.radarTab || 'today';

    clear(R.radarTaskList);
    if (R.bucketNote) {
      var note = '';
      if (tab === 'today') note = b.overdueCount
        ? '共 ' + b.today.length + ' 件，含已过期 ' + b.overdueCount + ' 件。今日无明确截止日期的任务不在本列表。'
        : (b.today.length ? '共 ' + b.today.length + ' 件。今日无明确截止日期的任务不在本列表。' : '');
      else if (tab === 'pending') note = b.pending.length ? '共 ' + b.pending.length + ' 件。日期或内容尚未核实，请逐条确认。' : '';
      else if (tab === 'soon') note = b.soon.length ? '共 ' + b.soon.length + ' 件（3-7 天内到期）。' : '';
      else if (tab === 'tomorrow') note = b.tomorrow.length ? '共 ' + b.tomorrow.length + ' 件。' : '';
      R.bucketNote.textContent = note;
    }

    var shown = b[tab] || b.all;
    if (tab === 'all') shown = b.all;

    if (!shown.length) {
      var msgMap = {
        today: '今天没有明确截止且进行中的任务。',
        tomorrow: '明天没有截止的任务。',
        pending: '没有待确认的任务。新事项若置信度不足会出现在这里等你确认。',
        soon: '未来 3-7 天内没有截止的任务。',
        all: '还没有任务。在收件箱导入消息，或把解析好的办事卡「加入我的任务」。'
      };
      var empty = emptyNote(msgMap[tab] || '没有任务。');
      empty.className = 'empty-note inbox-empty';
      R.radarTaskList.appendChild(empty);
      renderRadarStats();
      return;
    }

    var sorted = shown.slice().sort(function (a, x) {
      var ad = a.deadline_date || '9999-12-31';
      var xd = x.deadline_date || '9999-12-31';
      if (ad !== xd) return ad < xd ? -1 : 1;
      return a.created_at < x.created_at ? 1 : -1;
    });

    sorted.forEach(function (t) {
      R.radarTaskList.appendChild(buildRadarTaskItem(t, now));
    });
    renderRadarStats();
  }

  function buildRadarTaskItem(t, now) {
    var box = textNode('div', 'radar-task' + (t.status === '已完成' ? ' is-done' : '') + (t.status === '已忽略' ? ' is-ignored' : ''));

    var top = textNode('div', 'rt-top');
    top.appendChild(textNode('span', 'chip chip-category', t.category || '其他'));
    top.appendChild(textNode('span', 'chip rt-origin' +
      (t.origin === 'auto' ? ' is-auto' : t.origin === 'manual' ? ' is-manual' : ' is-review'), originBadge(t)));
    var due = dueChip(t, now);
    if (due) {
      var dc = textNode('span', 'chip rt-due' + (due.overdue ? ' is-overdue' : due.urgent ? ' is-urgent' : ''), due.label);
      top.appendChild(dc);
    }
    if (t.card && t.card.questions_to_confirm && t.card.questions_to_confirm.length) {
      top.appendChild(textNode('span', 'chip rt-questions', '待核实 ' + t.card.questions_to_confirm.length + ' 处'));
    }
    box.appendChild(top);

    box.appendChild(textNode('div', 'rt-title', t.title || '未命名任务'));
    if (t.summary) box.appendChild(textNode('p', 'rt-summary', t.summary));
    if (t.deadline_text && !t.deadline_date) {
      box.appendChild(textNode('p', 'rt-deadline-vague', '截止表述（待确认）：' + t.deadline_text));
    }

    var inner = t.card && t.card.tasks ? t.card.tasks : [];
    var done = inner.filter(function (x) { return x.completed; }).length;
    var meta = textNode('div', 'rt-meta');
    var bits = [];
    bits.push(t.source_name + (t.received_at_source ? ' · 接收于 ' : ' · 导入于 ') + formatRelative(t.received_at));
    if (t.card && t.card.materials && t.card.materials.length) bits.push('材料 ' + t.card.materials.length + ' 项');
    meta.appendChild(textNode('span', null, bits.join(' · ')));
    box.appendChild(meta);

    if (inner.length) {
      var prog = textNode('div', 'rt-progress');
      var track = textNode('div', 'rt-progress-track');
      var fill = textNode('div', 'rt-progress-fill');
      var pct = Math.round((done / inner.length) * 100);
      fill.style.width = pct + '%';
      if (pct >= 100) prog.classList.add('is-complete');
      track.appendChild(fill);
      prog.appendChild(track);
      prog.appendChild(textNode('span', 'rt-progress-text', '待办 ' + done + '/' + inner.length + (pct >= 100 ? ' · 已全部完成' : '')));
      box.appendChild(prog);
    }

    var ops = textNode('div', 'rt-ops');
    ops.appendChild(radarTaskBtn('打开', 'btn btn-ghost btn-sm', function () { openRadarTask(t.id, 'tasks'); }));
    if (t.status === '待确认') {
      ops.appendChild(radarTaskBtn('确认无误', 'btn btn-primary btn-sm', function () {
        setRadarTaskStatus(t.id, '进行中');
        renderTasksView();
        toast('已确认，进入进行中', 'success');
      }));
    }
    if (t.status === '进行中') {
      ops.appendChild(radarTaskBtn('标记完成', 'btn btn-ghost btn-sm', function () {
        setRadarTaskStatus(t.id, '已完成');
        renderTasksView();
        toast('已完成，干得漂亮', 'success');
      }));
    }
    if (t.status === '已完成') {
      ops.appendChild(radarTaskBtn('重新打开', 'btn btn-ghost btn-sm', function () {
        setRadarTaskStatus(t.id, '进行中');
        renderTasksView();
        toast('已重新打开');
      }));
    }
    if (t.status !== '已忽略') {
      ops.appendChild(radarTaskBtn('忽略', 'btn btn-ghost btn-sm', function () {
        setRadarTaskStatus(t.id, '已忽略');
        renderTasksView();
        toast('已忽略该任务');
      }));
    }
    ops.appendChild(radarTaskBtn('删除', 'btn btn-ghost btn-sm is-danger-text', function () {
      if (!window.confirm('确定删除任务「' + (t.title || '未命名') + '」吗？相关列表和统计会同步更新，不可恢复。')) return;
      deleteRadarTask(t.id);
      renderTasksView();
      toast('已删除');
    }));
    box.appendChild(ops);
    return box;
  }

  function radarTaskBtn(label, cls, onClick) {
    var b = textNode('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function renderRadarStats() {
    var s = radarStats(radarTasks(), new Date());
    [['statTodayInbox', s.today], ['statSoonInbox', s.soon], ['statPendingInbox', s.pending],
     ['statTodayTasks', s.today], ['statSoonTasks', s.soon], ['statPendingTasks', s.pending]]
      .forEach(function (pair) {
        var node = document.getElementById(pair[0]);
        if (node) node.textContent = String(pair[1]);
      });
    updateRadarBadges();
  }

  function updateRadarBadges() {
    var msgs = radarMessages();
    var pendingMsgs = msgs.filter(function (m) { return m.status === '待处理' || m.status === '解析失败'; }).length;
    var pendingTasks = radarTasks().filter(function (t) { return t.status === '待确认'; }).length;
    setBadge('inboxBadge', pendingMsgs);
    setBadge('tasksBadge', pendingTasks);
  }

  function setBadge(id, n) {
    var node = document.getElementById(id);
    if (!node) return;
    node.textContent = String(n);
    node.hidden = !n;
  }

  /* ---------------- 打开任务 / 加入任务 ---------------- */

  function openRadarTask(id, fromView) {
    var t = findRadarTask(id);
    if (!t) {
      toast('该任务已不存在', 'error');
      return;
    }
    state.radarTaskOpen = id;
    state.returnView = fromView || state.view;
    state.card = t.card;          // 引用共享：结果页的编辑会直接落回存储
    state.originalText = '';
    state.isSample = false;
    state.sampleId = null;
    showResult();
  }

  function syncRadarCardActions() {
    if (!el.radarCardActions) return;
    var t = state.radarTaskOpen ? findRadarTask(state.radarTaskOpen) : null;

    if (el.cardSource) {
      if (t) {
        el.cardSource.textContent = '来源：' + t.source_name +
          (t.received_at_source ? ' · 接收于 ' : ' · 导入于 ') + formatTime(t.received_at);
        el.cardSource.hidden = false;
      } else {
        el.cardSource.hidden = true;
      }
    }

    if (el.addToTasksBtn) {
      el.addToTasksBtn.hidden = !!t || state.isSample || !state.card;
    }
    if (el.reminderBtn) {
      var hasDate = state.card && state.card.deadline && state.card.deadline.normalized_date;
      el.reminderBtn.hidden = !!t || state.isSample || !state.card || !hasDate;
    }

    if (!t) {
      el.radarCardActions.hidden = true;
      return;
    }

    el.radarCardActions.hidden = false;
    if (el.radarCardStateLabel) {
      el.radarCardStateLabel.textContent = '任务状态：' + t.status +
        (t.origin === 'auto' ? '（已自动生成）' : t.origin === 'manual' ? '（手动添加）' : '');
    }
    if (el.radarConfirmBtn) el.radarConfirmBtn.hidden = t.status !== '待确认';
    if (el.radarDoneBtn) el.radarDoneBtn.hidden = t.status !== '进行中';
    if (el.radarReopenBtn) el.radarReopenBtn.hidden = t.status !== '已完成';
    if (el.radarIgnoreBtn) el.radarIgnoreBtn.hidden = (t.status === '已忽略' || t.status === '已完成');
  }

  /* ---------------- 连接中心 ---------------- */

  function connStatusOf(def, runtime) {
    if (def.type === 'local') {
      var r = runtime[def.id] || {};
      if (radarGetSettings().sources[def.id] === false) {
        return { status: '未连接', note: '你已在设置中关闭该来源，可随时重新开启。' };
      }
      if (def.id === 'clipboard' && r.lastError) {
        return { status: '错误', note: r.lastError };
      }
      return { status: '已连接', note: '' };
    }
    return { status: def.initStatus || '未连接', note: '' };
  }

  function renderConnections() {
    if (!R.connList) return;
    clear(R.connList);
    var runtime = radarConnRuntime();

    RADAR_CONN_DEFS.forEach(function (def) {
      var r = runtime[def.id] || {};
      var st = connStatusOf(def, runtime);
      var card = textNode('div', 'conn-item is-' +
        ({ '已连接': 'ok', '待授权': 'wait', '错误': 'err' }[st.status] || 'off'));

      var head = textNode('div', 'conn-head');
      head.appendChild(textNode('span', 'conn-name', def.name));
      head.appendChild(textNode('span', 'chip conn-status is-' +
        ({ '已连接': 'ok', '待授权': 'wait', '连接中': 'wait', '错误': 'err' }[st.status] || 'off'), st.status));
      card.appendChild(head);

      var rows = textNode('div', 'conn-rows');
      rows.appendChild(connRow('已验证的数据权限', def.permissions));
      rows.appendChild(connRow('最近一次成功接收',
        r.lastOkAt ? formatTime(r.lastOkAt) : '—（还没有从这里收到过消息）'));
      rows.appendChild(connRow('最近一次连接错误', r.lastError || '无'));
      rows.appendChild(connRow('最近一次检查', r.lastCheckedAt ? formatTime(r.lastCheckedAt) : '—'));
      card.appendChild(rows);

      if (st.note) card.appendChild(textNode('p', 'conn-note', st.note));
      if (def.boundary) card.appendChild(textNode('p', 'conn-boundary', def.boundary));

      var ops = textNode('div', 'conn-ops');
      if (def.id === 'clipboard') {
        ops.appendChild(radarTaskBtn('重新检查授权', 'btn btn-ghost btn-sm', function () {
          checkClipboardPermission(function (stateStr, detail) {
            var rt = radarConnRuntime();
            rt.clipboard = rt.clipboard || {};
            rt.clipboard.lastCheckedAt = new Date().toISOString();
            if (stateStr === 'denied') {
              rt.clipboard.lastError = '浏览器已拒绝剪贴板读取权限（' + detail + '）。请在浏览器站点设置中允许后重试。';
            } else {
              rt.clipboard.lastError = null;
            }
            saveRadarConnRuntime(rt);
            renderConnections();
            toast('检查完成：' + detail, stateStr === 'denied' ? 'error' : 'success');
          });
        }));
        ops.appendChild(radarTaskBtn(
          radarGetSettings().sources.clipboard ? '断开（关闭该来源）' : '重新启用',
          'btn btn-ghost btn-sm', function () {
            var s = radarGetSettings();
            s.sources.clipboard = !s.sources.clipboard;
            saveRadarSettings(s);
            renderConnections();
            toast(s.sources.clipboard ? '剪贴板捕捉已启用' : '剪贴板捕捉已关闭');
          }));
      } else if (def.type === 'local') {
        ops.appendChild(radarTaskBtn(
          radarGetSettings().sources[def.id] ? '关闭该来源' : '重新启用',
          'btn btn-ghost btn-sm', function () {
            var s = radarGetSettings();
            s.sources[def.id] = !s.sources[def.id];
            saveRadarSettings(s);
            renderConnections();
            toast(s.sources[def.id] ? '来源已启用' : '来源已关闭');
          }));
      } else {
        ops.appendChild(radarTaskBtn('重新检查', 'btn btn-ghost btn-sm', function () {
          var rt = radarConnRuntime();
          rt[def.id] = rt[def.id] || {};
          rt[def.id].lastCheckedAt = new Date().toISOString();
          saveRadarConnRuntime(rt);
          renderConnections();
          toast('已检查：网页应用无法探测平台连接状态，请到 WorkBuddy 应用内确认。' +
            (def.id === 'wecom' ? '平台侧能力边界见下方说明。' : ''));
        }));
      }
      card.appendChild(ops);
      R.connList.appendChild(card);
    });
  }

  function connRow(label, value) {
    var row = textNode('div', 'conn-row');
    row.appendChild(textNode('span', 'conn-row-label', label));
    row.appendChild(textNode('span', 'conn-row-value', value));
    return row;
  }

  /** 真实检查剪贴板读取权限（支持 Permissions API 的浏览器） */
  function checkClipboardPermission(cb) {
    if (!navigator.permissions || !navigator.permissions.query) {
      cb('unknown', '此浏览器不支持权限查询，实际可用性以点击「捕捉剪贴板」为准');
      return;
    }
    navigator.permissions.query({ name: 'clipboard-read' }).then(function (res) {
      if (res.state === 'granted') cb('granted', '剪贴板读取权限已授予');
      else if (res.state === 'denied') cb('denied', '剪贴板读取权限被拒绝');
      else cb('prompt', '尚未授权，首次使用时浏览器会询问');
    }).catch(function () {
      cb('unknown', '无法查询剪贴板权限，实际可用性以点击「捕捉剪贴板」为准');
    });
  }

  /* ---------------- 设置页 ---------------- */

  function bindSetting(id, key, transform) {
    var node = document.getElementById(id);
    if (!node) return;
    node.addEventListener('change', function () {
      var s = radarGetSettings();
      var v = node.type === 'checkbox' ? node.checked : node.value;
      s[key] = transform ? transform(v) : v;
      saveRadarSettings(s);
      if (state.view === 'inbox') renderInbox();
      if (state.view === 'connections') renderConnections();
      toast('设置已保存');
      // 重新开启自动捕捉时，把暂停期间积压的待处理消息补解析掉
      if (key === 'autoCapture' && s.autoCapture) {
        processPendingMessages();
      }
    });
  }

  function processPendingMessages() {
    var pending = radarMessages().filter(function (m) { return m.status === '待处理'; });
    pending.forEach(function (m) { parseRadarMessage(m.id); });
    if (pending.length) toast('正在补处理 ' + pending.length + ' 条待处理消息…');
  }

  function bindSourceSetting(id, key) {
    var node = document.getElementById(id);
    if (!node) return;
    node.addEventListener('change', function () {
      var s = radarGetSettings();
      s.sources[key] = node.checked;
      saveRadarSettings(s);
      toast('来源已' + (node.checked ? '启用' : '关闭'));
    });
  }

  function syncSettingsUI() {
    var s = radarGetSettings();
    setCheck('setAutoCapture', s.autoCapture);
    setCheck('setSrcManual', s.sources.manual);
    setCheck('setSrcClipboard', s.sources.clipboard);
    setCheck('setSrcLink', s.sources.link);
    setCheck('setAutoCreate', s.autoCreateHigh);
    setCheck('setReviewAll', s.reviewAll);
    setVal('setLead', String(s.remindLeadMinutes));
    setCheck('setMerge', s.mergeReminders);
    setCheck('setQuietOn', s.quietEnabled);
    setVal('setQuietStart', s.quietStart);
    setVal('setQuietEnd', s.quietEnd);
    setCheck('setDigestOn', s.dailyDigest);
    setVal('setDigestTime', s.digestTime);
    setCheck('setKeepOriginal', s.keepOriginalText);
    updateNotifPermUI();

    var msgs = radarMessages().length;
    var tasks = radarTasks().length;
    var summary = document.getElementById('setDataSummary');
    if (summary) summary.textContent = '当前本设备保存了 ' + msgs + ' 条消息记录、' + tasks + ' 个任务。';
  }

  function setCheck(id, v) {
    var n = document.getElementById(id);
    if (n) n.checked = !!v;
  }
  function setVal(id, v) {
    var n = document.getElementById(id);
    if (n) n.value = v;
  }

  function updateNotifPermUI() {
    var txt = document.getElementById('notifPermText');
    var btn = document.getElementById('notifPermBtn');
    if (!txt || !btn) return;
    if (!('Notification' in window)) {
      txt.textContent = '此浏览器不支持桌面通知';
      btn.disabled = true;
      return;
    }
    var p = Notification.permission;
    txt.textContent = p === 'granted' ? '已授权，页面打开时会发送提醒'
      : p === 'denied' ? '已被拒绝，请在浏览器站点设置中重新允许'
      : '未申请（仅页面打开时有效）';
    btn.disabled = p === 'granted';
  }

  /* ---------------- 提醒：浏览器通知 / ICS / 摘要 ---------------- */

  function fireNotification(cands) {
    try {
      if (cands.length === 1) {
        var n1 = new Notification(cands[0].title, { body: cands[0].body, tag: cands[0].key });
        n1.addEventListener('click', function () { window.focus(); });
        return;
      }
      var body = cands.map(function (c) { return c.body; }).join('\n');
      var n2 = new Notification('办事雷达 · ' + cands.length + ' 件事项需要关注', {
        body: body,
        tag: 'radar-merged-' + Date.now()
      });
      n2.addEventListener('click', function () { window.focus(); });
    } catch (e) { /* 通知失败不影响页面 */ }
  }

  function checkReminders() {
    var s = radarGetSettings();
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var now = new Date();
    var fired = radarRead(RADAR_NOTIFIED_KEY, {});
    if (Object.keys(fired).length > 800) fired = {};   // 防膨胀；最坏重发一次

    if (s.dailyDigest && !isQuietNow(s, now)) {
      var dk = 'digest|' + dayKey(now);
      if (!fired[dk]) {
        var parts = String(s.digestTime || '08:30').split(':');
        var dh = parseInt(parts[0], 10), dm = parseInt(parts[1], 10);
        var cur = now.getHours() * 60 + now.getMinutes();
        if (!isNaN(dh) && !isNaN(dm) && cur >= dh * 60 + dm) {
          var tasks = radarTasks();
          var st = radarStats(tasks, now);
          var d = new Notification('办事雷达 · 今日概览', {
            body: '今日截止 ' + st.today + ' 件，即将截止 ' + st.soon + ' 件，待确认 ' + st.pending + ' 件。打开应用查看详情。',
            tag: dk
          });
          d.addEventListener('click', function () { window.focus(); });
          fired[dk] = 1;
        }
      }
    }

    var cands = notifyCandidates(radarTasks(), s, now, fired);
    if (!cands.length) { saveNotified(fired); return; }
    if (isQuietNow(s, now)) { saveNotified(fired); return; }   // 静默期不发，也不记录，静默结束后会补发

    if (s.mergeReminders) {
      fireNotification(cands);
      cands.forEach(function (c) { fired[c.key] = 1; });
    } else {
      cands.slice(0, 5).forEach(function (c) {
        fireNotification([c]);
        fired[c.key] = 1;
      });
      if (cands.length > 5) toast('还有 ' + (cands.length - 5) + ' 条到期提醒未弹出，请到「我的任务」查看');
    }
    saveNotified(fired);
  }

  function saveNotified(fired) { radarWrite(RADAR_NOTIFIED_KEY, fired); }

  function downloadICS() {
    var tasks = radarTasks();
    var res = buildICS(tasks, new Date(), radarGetSettings().remindLeadMinutes);
    var vague = tasks.filter(function (t) {
      return taskIsActive(t) && t.card && t.card.deadline && t.card.deadline.original_text && !t.deadline_date;
    }).length;
    if (!res.count) {
      toast(vague ? '没有可导出的任务：' + vague + ' 件任务截止日期待确认' : '没有可导出的任务', 'error');
      return;
    }
    var blob = new Blob([res.text], { type: 'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '办事雷达-提醒.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    toast('已导出 ' + res.count + ' 件日程' + (vague ? '；另有 ' + vague + ' 件日期待确认未导出' : '') + '。导入日历后由日历应用提醒。', 'success');
  }

  function copyDigest() {
    var text = buildDigestText(radarTasks(), new Date());
    copyToClipboard(text).then(function () {
      toast('今日摘要已复制到剪贴板', 'success');
    }).catch(function () {
      window.prompt('浏览器未授权剪贴板，请手动复制下面的内容：', text);
    });
  }

  /* ---------------- 外观（浅色/深色/跟随系统） ---------------- */

  var APPEARANCE_KEY = 'taskcard.appearance';
  var APPEARANCE_MQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function getAppearance() {
    try {
      var a = localStorage.getItem(APPEARANCE_KEY);
      return (a === 'light' || a === 'dark') ? a : 'system';
    } catch (e) { return 'system'; }
  }

  function applyAppearance() {
    var mode = getAppearance();
    var dark = mode === 'dark' || (mode === 'system' && APPEARANCE_MQ && APPEARANCE_MQ.matches);
    document.documentElement.classList.toggle('dark', dark);
    // PWA 状态栏颜色跟随主题
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0A0A0A' : '#FAFAFA');
  }

  function setAppearance(mode) {
    try { localStorage.setItem(APPEARANCE_KEY, mode); } catch (e) { }
    applyAppearance();
  }

  /* UI 状态记忆：收件箱筛选 / 任务标签页，刷新后保持 */
  function rememberUI(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { }
  }
  function recallUI(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; }
  }

  /* 全局错误兜底：记录 + 温和提示，绝不白屏 */
  var LAST_ERROR_KEY = 'taskcard.lastError';
  var lastErrorToastAt = 0;
  function reportGlobalError(kind, message) {
    try {
      localStorage.setItem(LAST_ERROR_KEY, JSON.stringify({
        kind: kind, message: String(message).slice(0, 500),
        at: new Date().toISOString(), version: APP_VERSION
      }));
    } catch (e) { }
    var now = Date.now();
    if (now - lastErrorToastAt > 10000) {
      lastErrorToastAt = now;
      toast('页面出现了一点小问题，已记录（你的数据不受影响）', 'error');
    }
  }

  /* ---------------- 雷达初始化 ---------------- */

  function radarInit() {
    radarSettingsCache = radarSettings();

    R.msgInput = document.getElementById('msgInput');
    R.msgCharCount = document.getElementById('msgCharCount');
    R.msgError = document.getElementById('msgError');
    R.importBtn = document.getElementById('importBtn');
    R.captureClipboardBtn = document.getElementById('captureClipboardBtn');
    R.msgList = document.getElementById('msgList');
    R.pauseBanner = document.getElementById('pauseBanner');
    R.clearMsgsBtn = document.getElementById('clearMsgsBtn');
    R.radarTaskList = document.getElementById('radarTaskList');
    R.bucketNote = document.getElementById('bucketNote');
    R.taskTabs = document.getElementById('taskTabs');
    R.connList = document.getElementById('connList');

    // 导航
    var nav = document.getElementById('topbarNav');
    if (nav) {
      nav.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.nav-btn') : null;
        if (!btn) return;
        var target = btn.getAttribute('data-nav');
        if (target) showView(target);
      });
    }

    // 收件箱：输入计数
    if (R.msgInput) {
      R.msgInput.addEventListener('input', function () {
        var len = R.msgInput.value.length;
        R.msgCharCount.textContent = String(len);
        R.msgCharCount.parentElement.classList.toggle('is-over', len > RADAR_MAX_LEN);
        R.msgCharCount.parentElement.classList.toggle('is-near', len > RADAR_MAX_LEN * 0.9 && len <= RADAR_MAX_LEN);
        if (len <= RADAR_MAX_LEN) hideMsgError();
      });
    }

    // 导入
    if (R.importBtn) {
      R.importBtn.addEventListener('click', function () {
        hideMsgError();
        var text = R.msgInput.value;
        if (!text.trim()) {
          showMsgError('请先粘贴需要处理的消息内容。');
          R.msgInput.focus();
          return;
        }
        if (text.length > RADAR_MAX_LEN) {
          showMsgError('内容超过 ' + RADAR_MAX_LEN + ' 字（当前 ' + text.length + ' 字），请精简后再导入。');
          return;
        }
        var created = importMessage('manual', text);
        if (created) {
          R.msgInput.value = '';
          R.msgCharCount.textContent = '0';
          toast(radarGetSettings().autoCapture ? '已导入，正在解析…' : '已导入（自动捕捉已暂停，待你手动解析）');
        }
      });
    }

    // 剪贴板捕捉（用户点击时读取一次）
    if (R.captureClipboardBtn) {
      R.captureClipboardBtn.addEventListener('click', function () {
        var s = radarGetSettings();
        if (!s.sources.clipboard) {
          toast('剪贴板捕捉来源已在设置中关闭', 'error');
          return;
        }
        if (!navigator.clipboard || !navigator.clipboard.readText) {
          var rt0 = radarConnRuntime();
          rt0.clipboard = rt0.clipboard || {};
          rt0.clipboard.lastError = '此浏览器或环境不支持剪贴板读取。';
          saveRadarConnRuntime(rt0);
          toast('此浏览器不支持读取剪贴板，请手动粘贴', 'error');
          return;
        }
        navigator.clipboard.readText().then(function (text) {
          var created = importMessage('clipboard', text);
          if (created) toast(radarGetSettings().autoCapture ? '已从剪贴板捕捉，正在解析…' : '已捕捉（自动捕捉已暂停）');
        }).catch(function (err) {
          var rt = radarConnRuntime();
          rt.clipboard = rt.clipboard || {};
          rt.clipboard.lastError = '读取剪贴板失败：' + (err && err.message ? err.message : '浏览器拒绝了访问');
          saveRadarConnRuntime(rt);
          toast('无法读取剪贴板（' + rt.clipboard.lastError + '）', 'error');
          if (state.view === 'connections') renderConnections();
        });
      });
    }

    // 清理记录
    var clearAllMsgs = function () {
      if (!window.confirm('确定清空全部消息记录吗？已生成的任务不受影响。此操作不可恢复。')) return;
      saveRadarMessages([]);
      updateRadarBadges();
      renderInbox();
      toast('消息记录已清空', 'success');
    };
    if (R.clearMsgsBtn) R.clearMsgsBtn.addEventListener('click', clearAllMsgs);
    var clearMsgsBtn2 = document.getElementById('clearMsgsBtn2');
    if (clearMsgsBtn2) clearMsgsBtn2.addEventListener('click', clearAllMsgs);

    // 收件箱状态筛选
    R.msgFilterRow = document.getElementById('msgFilterRow');
    if (R.msgFilterRow) {
      R.msgFilterRow.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.filter-chip') : null;
        if (!btn) return;
        state.radarMsgFilter = btn.getAttribute('data-filter') || '全部';
        rememberUI('taskcard.ui.msgFilter', state.radarMsgFilter);
        Array.prototype.forEach.call(R.msgFilterRow.querySelectorAll('.filter-chip'), function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        renderInbox();
      });
    }

    var clearTasksBtn = document.getElementById('clearTasksBtn');
    if (clearTasksBtn) {
      clearTasksBtn.addEventListener('click', function () {
        if (!window.confirm('确定删除全部任务吗？消息记录会保留。此操作不可恢复。')) return;
        saveRadarTasks([]);
        updateRadarBadges();
        syncSettingsUI();
        toast('全部任务已删除', 'success');
      });
    }

    var resetSettingsBtn = document.getElementById('resetSettingsBtn');
    if (resetSettingsBtn) {
      resetSettingsBtn.addEventListener('click', function () {
        if (!window.confirm('恢复全部默认设置吗？')) return;
        radarSettingsCache = JSON.parse(JSON.stringify(RADAR_DEFAULT_SETTINGS));
        saveRadarSettings(radarSettingsCache);
        syncSettingsUI();
        toast('已恢复默认设置', 'success');
      });
    }

    // 任务标签页
    if (R.taskTabs) {
      R.taskTabs.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.tab-btn') : null;
        if (!btn) return;
        state.radarTab = btn.getAttribute('data-tab') || 'today';
        rememberUI('taskcard.ui.taskTab', state.radarTab);
        Array.prototype.forEach.call(R.taskTabs.querySelectorAll('.tab-btn'), function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        renderTasksView();
      });
    }

    // 统计条 → 跳到对应任务标签
    Array.prototype.forEach.call(document.querySelectorAll('.stat-pill'), function (p) {
      p.addEventListener('click', function () {
        var tab = p.getAttribute('data-stat-tab') || 'today';
        state.radarTab = tab;
        showView('tasks');
        if (R.taskTabs) {
          Array.prototype.forEach.call(R.taskTabs.querySelectorAll('.tab-btn'), function (b) {
            b.classList.toggle('is-active', b.getAttribute('data-tab') === tab);
          });
        }
        renderTasksView();
      });
    });

    // 外观设置
    applyAppearance();
    if (APPEARANCE_MQ && APPEARANCE_MQ.addEventListener) {
      APPEARANCE_MQ.addEventListener('change', function () {
        if (getAppearance() === 'system') applyAppearance();
      });
    }
    var setAppearanceSel = document.getElementById('setAppearance');
    if (setAppearanceSel) {
      setAppearanceSel.value = getAppearance();
      setAppearanceSel.addEventListener('change', function () {
        setAppearance(setAppearanceSel.value);
        toast(setAppearanceSel.value === 'system' ? '已跟随系统主题' : setAppearanceSel.value === 'dark' ? '已切换深色' : '已切换浅色');
      });
    }

    // 全局错误兜底
    window.addEventListener('error', function (e) {
      reportGlobalError('error', e && e.message);
    });
    window.addEventListener('unhandledrejection', function (e) {
      reportGlobalError('unhandledrejection', e && e.reason && (e.reason.message || e.reason));
    });

    // 关于信息
    var aboutVersion = document.getElementById('aboutVersion');
    if (aboutVersion) aboutVersion.textContent = 'v' + APP_VERSION;
    var aboutOnline = document.getElementById('aboutOnline');
    if (aboutOnline) aboutOnline.textContent = ONLINE_URL;
    var aboutCopyLinkBtn = document.getElementById('aboutCopyLinkBtn');
    if (aboutCopyLinkBtn) {
      aboutCopyLinkBtn.addEventListener('click', function () {
        copyToClipboard(ONLINE_URL).then(function () {
          toast('线上链接已复制', 'success');
        }).catch(function () {
          window.prompt('浏览器未授权剪贴板，请手动复制：', ONLINE_URL);
        });
      });
    }

    // UI 状态恢复
    state.radarTab = recallUI('taskcard.ui.taskTab', 'today');
    state.radarMsgFilter = recallUI('taskcard.ui.msgFilter', '全部');
    if (R.taskTabs) {
      Array.prototype.forEach.call(R.taskTabs.querySelectorAll('.tab-btn'), function (b) {
        b.classList.toggle('is-active', (b.getAttribute('data-tab') || 'today') === state.radarTab);
      });
    }
    if (R.msgFilterRow) {
      Array.prototype.forEach.call(R.msgFilterRow.querySelectorAll('.filter-chip'), function (b) {
        b.classList.toggle('is-active', (b.getAttribute('data-filter') || '全部') === state.radarMsgFilter);
      });
    }

    // 设置项
    bindSetting('setAutoCapture', 'autoCapture');
    bindSourceSetting('setSrcManual', 'manual');
    bindSourceSetting('setSrcClipboard', 'clipboard');
    bindSourceSetting('setSrcLink', 'link');
    bindSetting('setAutoCreate', 'autoCreateHigh');
    bindSetting('setReviewAll', 'reviewAll');
    bindSetting('setLead', 'remindLeadMinutes', function (v) { return parseInt(v, 10) || 1440; });
    bindSetting('setMerge', 'mergeReminders');
    bindSetting('setQuietOn', 'quietEnabled');
    bindSetting('setQuietStart', 'quietStart');
    bindSetting('setQuietEnd', 'quietEnd');
    bindSetting('setDigestOn', 'dailyDigest');
    bindSetting('setDigestTime', 'digestTime');
    bindSetting('setKeepOriginal', 'keepOriginalText');

    var notifPermBtn = document.getElementById('notifPermBtn');
    if (notifPermBtn) {
      notifPermBtn.addEventListener('click', function () {
        if (!('Notification' in window)) { updateNotifPermUI(); return; }
        Notification.requestPermission().then(function () {
          updateNotifPermUI();
        });
      });
    }

    var icsBtn = document.getElementById('icsBtn');
    if (icsBtn) icsBtn.addEventListener('click', downloadICS);
    var digestCopyBtn = document.getElementById('digestCopyBtn');
    if (digestCopyBtn) digestCopyBtn.addEventListener('click', copyDigest);

    // 备份导出 / 导入
    var backupExportBtn = document.getElementById('backupExportBtn');
    if (backupExportBtn) {
      backupExportBtn.addEventListener('click', function () {
        var payload = {
          app: 'taskcard-radar',
          version: 1,
          exportedAt: new Date().toISOString(),
          messages: radarMessages(),
          tasks: radarTasks(),
          settings: radarGetSettings()
        };
        var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        var p = function (n) { return n < 10 ? '0' + n : String(n); };
        var d = new Date();
        a.download = '办事雷达-备份-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        toast('备份已导出（' + payload.messages.length + ' 条消息、' + payload.tasks.length + ' 个任务）', 'success');
      });
    }

    var backupImportFile = document.getElementById('backupImportFile');
    var backupImportBtn = document.getElementById('backupImportBtn');
    if (backupImportBtn && backupImportFile) {
      backupImportBtn.addEventListener('click', function () { backupImportFile.click(); });
      backupImportFile.addEventListener('change', function () {
        var file = backupImportFile.files && backupImportFile.files[0];
        backupImportFile.value = '';
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          var data;
          try { data = JSON.parse(String(reader.result)); }
          catch (e) { toast('备份文件无法解析', 'error'); return; }
          if (!data || data.app !== 'taskcard-radar' || !Array.isArray(data.messages) || !Array.isArray(data.tasks)) {
            toast('这不是本应用的备份文件', 'error');
            return;
          }
          var nMsg = data.messages.length, nTask = data.tasks.length;
          if (!window.confirm('导入备份：' + nMsg + ' 条消息、' + nTask + ' 个任务' +
            (data.exportedAt ? '（导出于 ' + formatTime(data.exportedAt) + '）' : '') +
            '。相同 ID 的记录以备份为准，确定继续吗？')) return;
          // 合并：相同 ID 以备份为准，本地独有保留
          saveRadarMessages(mergeBackupById(radarMessages(), data.messages));
          saveRadarTasks(mergeBackupById(radarTasks(), data.tasks));
          if (data.settings && typeof data.settings === 'object') {
            var cur = radarGetSettings();
            Object.keys(RADAR_DEFAULT_SETTINGS).forEach(function (k) {
              if (data.settings[k] !== undefined) {
                if (k === 'sources' && data.settings.sources) {
                  Object.keys(RADAR_DEFAULT_SETTINGS.sources).forEach(function (sk) {
                    if (typeof data.settings.sources[sk] === 'boolean') cur.sources[sk] = data.settings.sources[sk];
                  });
                } else {
                  cur[k] = data.settings[k];
                }
              }
            });
            saveRadarSettings(cur);
            radarSettingsCache = radarSettings();
          }
          updateRadarBadges();
          renderRadarStats();
          syncSettingsUI();
          if (state.view === 'inbox') renderInbox();
          if (state.view === 'tasks') renderTasksView();
          toast('备份已导入', 'success');
        };
        reader.readAsText(file, 'utf-8');
      });
    }

    // 结果页：雷达任务操作
    if (el.radarConfirmBtn) el.radarConfirmBtn.addEventListener('click', function () {
      if (!state.radarTaskOpen) return;
      setRadarTaskStatus(state.radarTaskOpen, '进行中');
      syncRadarCardActions();
      toast('已确认，进入进行中', 'success');
    });
    if (el.radarDoneBtn) el.radarDoneBtn.addEventListener('click', function () {
      if (!state.radarTaskOpen) return;
      setRadarTaskStatus(state.radarTaskOpen, '已完成');
      syncRadarCardActions();
      toast('已完成，干得漂亮', 'success');
    });
    if (el.radarReopenBtn) el.radarReopenBtn.addEventListener('click', function () {
      if (!state.radarTaskOpen) return;
      setRadarTaskStatus(state.radarTaskOpen, '进行中');
      syncRadarCardActions();
      toast('已重新打开');
    });
    if (el.radarIgnoreBtn) el.radarIgnoreBtn.addEventListener('click', function () {
      if (!state.radarTaskOpen) return;
      setRadarTaskStatus(state.radarTaskOpen, '已忽略');
      syncRadarCardActions();
      toast('已忽略该任务');
    });
    if (el.addToTasksBtn) el.addToTasksBtn.addEventListener('click', function () {
      if (!state.card || state.isSample) return;
      var pseudoMsg = null;
      if (state.originalText) {
        pseudoMsg = { text_hash: hashText(state.originalText), source_name: '手动解析', received_at: new Date().toISOString(), received_at_source: false };
      }
      var conf = computeConfidence(state.card);
      var created = createRadarTask(state.card, pseudoMsg, { origin: 'manual', status: '进行中', reason: '' }, conf);
      if (created && created.duplicate) {
        toast('已存在相同内容的任务（' + created.target.status + '），未重复创建');
      } else {
        toast('已加入我的任务', 'success');
      }
      updateRadarBadges();
    });

    // 提醒轮询：仅页面打开时有效（没有服务端推送通道，如实工作）
    setInterval(checkReminders, 60000);
    setTimeout(checkReminders, 2500);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkReminders();
    });

    // 链接导入：?msg= 或 #msg=
    try {
      var params = new URLSearchParams(window.location.search);
      var linkMsg = params.get('msg');
      if (!linkMsg && window.location.hash.indexOf('#msg=') === 0) {
        linkMsg = decodeURIComponent(window.location.hash.slice(5));
      }
      if (linkMsg && String(linkMsg).trim()) {
        importMessage('link', String(linkMsg), { silentDup: false });
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', window.location.pathname);
        }
        if (radarGetSettings().autoCapture) showView('inbox');
      }
    } catch (e) { /* 解析链接失败不阻塞页面 */ }

    updateRadarBadges();
    renderRadarStats();
  }

  /* Node 环境下的纯函数单元测试出口（浏览器运行时不会走到这里，不影响线上） */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      scanUnsupportedFacts: scanUnsupportedFacts,
      isDeadlineBearing: isDeadlineBearing,
      normalizeForMatch: normalizeForMatch,
      verifyQuote: verifyQuote,
      dateGrounded: dateGrounded,
      looksRelative: looksRelative,
      hashText: hashText,
      deriveTitle: deriveTitle,
      dayKey: dayKey,
      dateAddDays: dateAddDays,
      diffDays: diffDays,
      computeConfidence: computeConfidence,
      decideRoute: decideRoute,
      resolveRelativeDeadline: resolveRelativeDeadline,
      taskBuckets: taskBuckets,
      radarStats: radarStats,
      isQuietNow: isQuietNow,
      notifyCandidates: notifyCandidates,
      buildICS: buildICS,
      buildDigestText: buildDigestText,
      mergeBackupById: mergeBackupById,
      formatRelative: formatRelative,
      isQuotaLikeError: isQuotaLikeError
    };
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

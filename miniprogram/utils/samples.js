// 内置示例卡（移植自网页版，用于离线演示，明确标注为「示例预览」，非真实 AI 解析）
// 每条都带 source_quote 原文依据，体现产品「原文可核对」的核心承诺。
module.exports = [
    {
        id: 'school',
        title: '学校报名通知',
        desc: '有明确截止日期、多个材料和提交步骤',
        text: '【XX大学创新创业训练计划项目申报通知】\n\n各学院同学：\n\n2026届本科生创新创业训练计划项目申报工作现已开始，申报截止时间为2026年11月20日17:00前，逾期系统将关闭不再受理。\n\n请于截止前完成以下事项：\n1. 提交《创新创业训练计划项目申报表》，须由指导教师签字；\n2. 上传个人简历与成绩单扫描件（PDF格式）；\n3. 提交团队介绍PPT（不超过15页）；\n4. 由指导教师在教务系统"大创"模块完成审核确认。\n\n注意：本次申报不收取任何费用。请各班班主任于11月18日前将名单汇总至学院教务秘书处。',
        card: {
            title: 'XX大学创新创业训练计划项目申报',
            summary: '2026届本科生创新创业训练计划项目申报已开始，需在 2026年11月20日17:00 前提交申报表、简历成绩单扫描件与团队介绍PPT，并由指导教师在教务系统完成审核。',
            category: '报名',
            deadline: {
                original_text: '2026年11月20日17:00前',
                normalized_date: '2026-11-20',
                needs_confirmation: false,
                source_quote: '申报截止时间为2026年11月20日17:00前，逾期系统将关闭不再受理。'
            },
            tasks: [
                { id: 't1', title: '提交《创新创业训练计划项目申报表》（须指导教师签字）', completed: false, source_quote: '1. 提交《创新创业训练计划项目申报表》，须由指导教师签字；', needs_confirmation: false },
                { id: 't2', title: '上传个人简历与成绩单扫描件（PDF格式）', completed: false, source_quote: '2. 上传个人简历与成绩单扫描件（PDF格式）；', needs_confirmation: false },
                { id: 't3', title: '提交团队介绍PPT（不超过15页）', completed: false, source_quote: '3. 提交团队介绍PPT（不超过15页）；', needs_confirmation: false },
                { id: 't4', title: '请指导教师在教务系统"大创"模块完成审核确认', completed: false, source_quote: '4. 由指导教师在教务系统"大创"模块完成审核确认。', needs_confirmation: false }
            ],
            materials: [
                { id: 'm1', name: '《创新创业训练计划项目申报表》（须指导教师签字）', completed: false, source_quote: '1. 提交《创新创业训练计划项目申报表》，须由指导教师签字；', needs_confirmation: false },
                { id: 'm2', name: '个人简历与成绩单扫描件（PDF格式）', completed: false, source_quote: '2. 上传个人简历与成绩单扫描件（PDF格式）；', needs_confirmation: false },
                { id: 'm3', name: '团队介绍PPT（不超过15页）', completed: false, source_quote: '3. 提交团队介绍PPT（不超过15页）；', needs_confirmation: false }
            ],
            steps: [
                { id: 's1', text: '提交《创新创业训练计划项目申报表》，须由指导教师签字', source_quote: '1. 提交《创新创业训练计划项目申报表》，须由指导教师签字；' },
                { id: 's2', text: '上传个人简历与成绩单扫描件（PDF格式）', source_quote: '2. 上传个人简历与成绩单扫描件（PDF格式）；' },
                { id: 's3', text: '提交团队介绍PPT（不超过15页）', source_quote: '3. 提交团队介绍PPT（不超过15页）；' },
                { id: 's4', text: '由指导教师在教务系统"大创"模块完成审核确认', source_quote: '4. 由指导教师在教务系统"大创"模块完成审核确认。' }
            ],
            questions_to_confirm: [
                { id: 'q1', question: '班主任汇总名单的"11月18日前"是指哪一年的11月18日？', reason: '通知中只写了"11月18日前"，未写明年份，因此没有换算成具体日期，建议向学院确认。' }
            ]
        }
    },
    {
        id: 'property',
        title: '物业登记通知',
        desc: '时间表述模糊、材料清单缺失',
        text: '【物业服务中心通知】\n\n接物业通知，本周五前完成电梯年检登记，携带相关材料到物业服务中心提交。逾期未登记将影响电梯正常使用，恢复时间另行通知。\n\n费用说明按国家标准执行，具体金额以最终公示为准，本月内缴清即可。',
        card: {
            title: '电梯年检登记及费用缴纳通知',
            summary: '需在"本周五前"完成电梯年检登记并提交相关材料；逾期未登记将影响电梯正常使用，恢复时间另行通知。费用金额以最终公示为准，需在本月内缴清。',
            category: '物业',
            deadline: {
                original_text: '本周五前',
                normalized_date: null,
                needs_confirmation: true,
                source_quote: '本周五前完成电梯年检登记，携带相关材料到物业服务中心提交。'
            },
            tasks: [
                { id: 't1', title: '完成电梯年检登记', completed: false, source_quote: '本周五前完成电梯年检登记，携带相关材料到物业服务中心提交。', needs_confirmation: false },
                { id: 't2', title: '携带相关材料到物业服务中心提交', completed: false, source_quote: '携带相关材料到物业服务中心提交', needs_confirmation: false },
                { id: 't3', title: '在本月内缴清电梯年检费用', completed: false, source_quote: '具体金额以最终公示为准，本月内缴清即可', needs_confirmation: true }
            ],
            materials: [
                { id: 'm1', name: '相关材料（原文未列明清单）', completed: false, source_quote: '携带相关材料到物业服务中心提交', needs_confirmation: true }
            ],
            steps: [
                { id: 's1', text: '完成电梯年检登记', source_quote: '本周五前完成电梯年检登记，携带相关材料到物业服务中心提交。' },
                { id: 's2', text: '携带相关材料到物业服务中心提交', source_quote: '携带相关材料到物业服务中心提交' },
                { id: 's3', text: '按最终公示金额在本月内缴清费用', source_quote: '具体金额以最终公示为准，本月内缴清即可' }
            ],
            questions_to_confirm: [
                { id: 'q1', question: '"本周五前"具体指哪一天？', reason: '通知用的是相对时间，没有写明具体年月日，因此未换算成日期。' },
                { id: 'q2', question: '"相关材料"具体包括哪些？', reason: '通知只提到"相关材料"，没有列出材料清单，建议向物业服务中心确认。' },
                { id: 'q3', question: '电梯年检费用的具体金额是多少？', reason: '通知写明"按国家标准执行，具体金额以最终公示为准"，当前金额未定。' },
                { id: 'q4', question: '电梯恢复使用的具体时间是什么时候？', reason: '通知写的是"恢复时间另行通知"，目前无法确定。' }
            ]
        }
    },
    {
        id: 'refund',
        title: '退款规则',
        desc: '条件式表述，无单一截止时间',
        text: '【电商平台退款规则说明】\n\n关于订单退款事宜，现说明如下：\n\n自签收之日起七天内，商品不影响二次销售的可申请无理由退款，运费由买家承担；签收超过七天的订单，如商品存在质量问题，需在收到商品后十五天内提交质量问题照片及订单编号，由客服审核。审核通过后款项将在三至五个工作日内原路退回。\n\n存在争议的订单将由平台介入处理，具体以客服与商家协商结果为准。',
        card: {
            title: '电商平台退款规则说明',
            summary: '签收七天内且不影响二次销售可申请无理由退款（运费自付）；超过七天如存在质量问题，需在收到商品后十五天内提交问题照片及订单编号，由客服审核后三至五个工作日原路退回。',
            category: '退款',
            deadline: {
                original_text: '自签收之日起七天内',
                normalized_date: null,
                needs_confirmation: true,
                source_quote: '自签收之日起七天内，商品不影响二次销售的可申请无理由退款，运费由买家承担'
            },
            tasks: [
                { id: 't1', title: '确认订单是否在签收七天内、且商品不影响二次销售', completed: false, source_quote: '自签收之日起七天内，商品不影响二次销售的可申请无理由退款，运费由买家承担', needs_confirmation: true },
                { id: 't2', title: '如为质量问题，提交问题照片与订单编号申请售后', completed: false, source_quote: '需在收到商品后十五天内提交质量问题照片及订单编号，由客服审核', needs_confirmation: false },
                { id: 't3', title: '等待客服审核通过后确认款项原路退回', completed: false, source_quote: '审核通过后款项将在三至五个工作日内原路退回', needs_confirmation: false }
            ],
            materials: [
                { id: 'm1', name: '质量问题照片', completed: false, source_quote: '需在收到商品后十五天内提交质量问题照片及订单编号，由客服审核', needs_confirmation: false },
                { id: 'm2', name: '订单编号', completed: false, source_quote: '需在收到商品后十五天内提交质量问题照片及订单编号，由客服审核', needs_confirmation: false }
            ],
            steps: [
                { id: 's1', text: '确认是否满足无理由退款条件：签收七天内且商品不影响二次销售', source_quote: '自签收之日起七天内，商品不影响二次销售的可申请无理由退款，运费由买家承担' },
                { id: 's2', text: '如属质量问题，在收到商品后十五天内提交问题照片及订单编号', source_quote: '需在收到商品后十五天内提交质量问题照片及订单编号，由客服审核' },
                { id: 's3', text: '由客服审核，审核通过后款项在三至五个工作日内原路退回', source_quote: '审核通过后款项将在三至五个工作日内原路退回' },
                { id: 's4', text: '如存在争议，由平台介入处理', source_quote: '存在争议的订单将由平台介入处理，具体以客服与商家协商结果为准' }
            ],
            questions_to_confirm: [
                { id: 'q1', question: '本订单的签收日期是哪一天？', reason: '退款期限从签收之日起算，没有签收日期就无法确定是否还在七天内。' },
                { id: 'q2', question: '本次申请属于无理由退款还是质量问题退款？', reason: '两条路径的材料和期限不同，需要先确认走哪一条。' },
                { id: 'q3', question: '商品是否影响二次销售？', reason: '这是无理由退款的前提条件，原文未给出判断标准。' }
            ]
        }
    }
];

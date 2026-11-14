/* @zuelwyw/hermes-loop — browser half (hand-rolled loader bundle, no build step).
 *
 * One tab in the conversation view ring ("Hermes Loop"), next to 对话/轨迹/上下文.
 * Data comes exclusively from the host half's /hermes-loop/api/* routes — the
 * client holds no loop state of its own. Function components only (class
 * components silently never render in the plugin loader) and no createRoot
 * (render through the slot tree). Colors ride the --dsw-* theme tokens.
 */
window.__ModuleLoader__.load({
  id: '@zuelwyw/hermes-loop',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var h = React.createElement

    // 宿主 Markdown 渲染原语（skills-management 详情弹窗同源）：渲染 SKILL.md 正文。
    // 原语缺席（版本漂移/测试环境）时退回 pre 纯文本，弹窗功能不受影响。
    var MarkdownText = null
    try {
      var uiPrim = require('@deepseek-ai/dsh-client-ui-primitives')
      if (uiPrim && typeof uiPrim.MarkdownText === 'function') MarkdownText = uiPrim.MarkdownText
    } catch (e) { MarkdownText = null }

    var DICT = {
      zh: {
        tab: 'Hermes Loop',
        loading: '加载中…',
        disabled: '学习循环未启用',
        enabled: '运行中',
        mode: '模式',
        'mode.auto': '自动写入',
        'mode.approval': '待审批',
        'mode.log-only': '仅记录',
        thresholds: '触发阈值',
        turns: '轮次',
        toolCalls: '工具调用',
        progress: '本会话进度',
        cooldown: '冷却',
        cooldownReady: '已就绪',
        cooldownWait: '{s}s 后可用',
        running: 'review 正在运行…',
        queued: '{n} 个 review 排队中',
        idle: '当前无 review',
        written: '沉淀的技能',
        usage: '技能使用统计',
        'usage.calls': '调用',
        'usage.last': '最近使用',
        'usage.status': '状态',
        'usage.modelVisible': '模型可见',
        'usage.modelDisabled': '已隐藏',
        'usage.statusHelp': '状态说明——模型可见：技能会注入到每个对话的技能目录，模型可用 skill 工具加载它；已隐藏：技能标记了 disable-model-invocation，保留在库里但不再注入目录；横杠（—）：调用列的横杠表示从未被模型调用过，状态列的横杠表示该技能当前不在模型目录里（可能已被隐藏或卸载）。',
        'usage.summary': '总调用 {n} 次 · 目录曝光 {c} 条 · 其中 {z} 条从未被调用',
        'usage.empty': '还没有技能调用记录 —— 模型通过 skill 工具加载技能时会在这里计数',
        'usage.skill': '技能',
        'written.tab.session': '本对话',
        'written.tab.plugin': '本插件',
        'written.sessionEmpty': '本对话还没有沉淀 —— 攒够触发阈值后，后台复盘的产物会出现在这里',
        'written.pluginEmpty': '还没有任何沉淀记录',
        activity: '活动时间线',
        activityEmpty: '暂无活动',
        refresh: '刷新',
        manual: '立即复盘',
        manualQueued: '已加入复盘队列',
        preview: 'review 实时输出',
        elapsed: '已运行 {s}s',
        saved: '已保存',
        saveFailed: '保存失败',
        'action.create': '新建',
        'action.patch': '修补',
        'action.staged': '待审',
        curator: '技能库维护（Curator）',
        'curator.run': '立即巡检',
        'curator.lastRun': '上次巡检',
        'curator.never': '从未巡检',
        'curator.counts': '{a} 活跃 · {s} 待退休 · {r} 已归档',
        'curator.empty': '还没有由本插件创建的技能 —— 巡检只维护复盘沉淀的库，不碰手写/市场技能',
        'curator.state.active': '活跃',
        'curator.state.stale': '待退休',
        'curator.state.archived': '已归档',
        'curator.restore': '恢复',
        'curator.restored': '已恢复',
        'curator.uses': '调用',
        'curator.lastUsed': '最后使用',
        'curator.stateHelp': '状态说明——活跃：技能正常注入对话目录；待退休：超过 stale 天数未被调用（仅标记，仍可被模型使用）；已归档：超过归档天数未用，已从模型目录隐藏（文件保留，可随时恢复）。巡检每天自动跑一次，也可点上方按钮立即执行。',
        'curator.skill': '技能',
        'signal.title': '信号加速',
        'signal.on': '开',
        'signal.off': '关',
        'signal.failures': '工具失败 ≥',
        'signal.words': '纠正词',
        'signal.help': '三类信号命中即标记窗口，下一个 turn 尾无视阈值提前复盘（冷却仍生效）：用户中断对话、窗口内工具连续失败、用户消息含纠正词。误触发的代价只是一次轻量复盘——精确性由复盘 agent 判断。词表逗号分隔，可自由改写（改动失焦即保存）。',
        'signal.stats': '近期信号 {t} 次（中断 {a} · 失败 {f} · 纠正 {c}），触发复盘 {r} 次，产出 {y} 个',
        'signal.none': '近期无加速信号',
        'signal.accelerated': '已加速（{k}），下一个 turn 尾立即复盘',
        'signal.kind.abort': '中断',
        'signal.kind.tool-failure': '工具失败',
        'signal.kind.correction': '纠正词',
        memory: '记忆（跨会话）',
        'memory.help': '后台复盘按需写入的长期记忆：MEMORY 存环境/项目事实、约定与教训，USER 存用户画像与偏好。记忆全文以「会话首冻结」方式注入每个对话——写入或手改文件后下个会话生效，当前会话保持开局快照；多数复盘不会产生记忆，不为写而写。手动维护直接改文件：' + '~/.dsh/memory/。',
        'memory.entries': '条',
        'memory.disabled': '已关闭',
        'memory.empty': '两个记忆库都是空的 —— 复盘发现值得长期记住的事实/偏好时会出现在这里',
        'memory.lastWrite': '最近写入',
        'memory.view': '查看条目',
        'memory.hide': '收起',
        pending: '待审批',
        'pending.help': '审批模式下的候选堆在收件箱里等人决定。技能、记忆、治理三条通道各自独立：混合候选可以只处理一条通道，其余保持待审，整条候选也继续留在收件箱。「通过」按预览写入磁盘；「跳过」放弃这条通道的写入但保留记录；「拒绝」标记为拒绝，全部通道都拒绝后整条候选归档。',
        'pending.empty': '没有待审候选 —— 审批模式下后台复盘产出的候选会出现在这里',
        'pending.total': '{n} 条待审',
        'pending.loadMore': '加载更多',
        'pending.loading': '读取收件箱…',
        'pending.open': '审阅',
        'pending.mixed': '混合',
        'pending.channels': '{n} 通道',
        'pending.tab.session': '本对话',
        'pending.tab.all': '全部',
        'ch.skill': '技能',
        'ch.memory': '记忆',
        'ch.governance': '治理',
        'ch.store.memory': 'MEMORY',
        'ch.store.user': 'USER',
        'act.apply': '通过',
        'act.skip': '跳过',
        'act.reject': '拒绝',
        'act.add': '新增',
        'act.replace': '替换',
        'act.remove': '删除',
        'act.archive': '归档（隐藏）',
        'act.restore': '恢复',
        'state.pending': '待审',
        'state.applied': '已写入',
        'state.skipped': '已跳过',
        'state.rejected': '已拒绝',
        'state.conflict': '冲突',
        'state.failed': '失败',
        'state.applying': '写入中',
        'state.reconciliation-required': '需核对',
        'pd.title': '候选详情',
        'pd.revision': '版本 {n}',
        'pd.rationale': '复盘理由',
        'pd.warnings': '警告',
        'pd.conflict': '冲突',
        'pd.detail': '说明',
        'pd.wouldResult': '预案结果',
        'pd.store': '库',
        'pd.limit': '上限',
        'pd.entries': '现有条目',
        'pd.oldText': '定位片段',
        'pd.reqTitle': '提出修改要求',
        'pd.reqHelp': '这条要求会进入一次聚焦复盘，由模型据此产出新的待审候选。原候选不会被就地修改，也不会因此被批准。',
        'pd.reqPlaceholder': '例如：description 太长，压到 60 字内；把「何时使用」补上三条触发短语。',
        'pd.reqSubmit': '提交修改要求',
        'pd.reqBusy': '提交中…',
        'pd.reqStarted': '已开始定向复盘：完成后会出现新的待审候选，原候选仍在。',
        'pd.reqQueued': '已排队：当前有复盘在跑，完成后接着执行，随后出现新的待审候选。',
        'pd.reqEmpty': '先写下具体要改什么',
        'pd.reqUnknown': '提交结果未知（网络中断）。先刷新列表，确认是否已产生新候选，不要重复提交。',
        'pd.noSource': '这条候选没有可用的来源会话（例如由 curator 产生，或原会话已不在本进程），无法据此复盘。请在新对话里直接提出修改要求。',
        'pd.sourceSession': '来源会话',
        'pd.sourceUnknown': '来源未知',
        'pd.revisionOf': '修订自',
        'pd.readonlyNote': '审批面只做查看与通过/拒绝，不编辑候选正文。',
        'pd.current': '当前内容',
        'pd.proposed': '候选内容',
        'pd.show': '展开内容',
        'pd.hide': '收起内容',
        'pd.appliedRule': '该通道已处理，按钮停用',
        'pd.absent': '本候选不含该通道',
        'pd.submit': '提交中…',
        'pd.partial': '部分成功（{s} 已处理），其余通道仍在等待决定',
        'pd.allApplied': '全部通道已写入，候选已归档',
        'pd.rejectedAll': '已拒绝并入档',
        'pd.verified': '已验证',
        'pd.unverified': '未验证',
        'pd.revisionMoved': '候选已被改动（页面版本 {a} 已过期）。为免覆盖他人改动，请先重载再提交。',
        'pd.reload': '重载',
        'pd.discardConfirm': '丢弃改动并重载？',
        'pd.unknown': '网络中断，提交结果未知；已查操作回执：{s}。不要重复提交，先点「重新查询」。',
        'pd.recheck': '重新查询',
        'pd.running': '回执仍在运行',
        'pd.receiptMissing': '回执尚未出现',
        'pd.gone': '候选已不存在（可能已被处理）：{msg}',
        view: '查看',
        close: '关闭',
        'skillContent.failed': '内容加载失败',
        'candidate.preview': '候选正文（非已安装技能）',
        'state.unavailable': '候选不可用',
        'md.copy': '复制内容',
        'md.copied': '已复制',
        'md.code': '代码',
        'md.wrap': '自动换行',
        'md.unwrap': '取消换行',
        'md.footnotes': '脚注',
      },
      en: {
        tab: 'Hermes Loop',
        loading: 'Loading…',
        disabled: 'Learning loop disabled',
        enabled: 'Active',
        mode: 'Mode',
        'mode.auto': 'Auto write',
        'mode.approval': 'Approval',
        'mode.log-only': 'Log only',
        thresholds: 'Trigger thresholds',
        turns: 'turns',
        toolCalls: 'tool calls',
        progress: 'This session',
        cooldown: 'Cooldown',
        cooldownReady: 'ready',
        cooldownWait: 'in {s}s',
        running: 'review running…',
        queued: '{n} review(s) queued',
        idle: 'no review in flight',
        written: 'Distilled skills',
        usage: 'Skill usage stats',
        'usage.calls': 'calls',
        'usage.last': 'last used',
        'usage.status': 'status',
        'usage.modelVisible': 'model-visible',
        'usage.modelDisabled': 'hidden',
        'usage.statusHelp': 'Status legend — model-visible: injected into every conversation catalog, loadable via the skill tool; hidden: marked disable-model-invocation, kept in the library but not injected; dash (—): in the calls column it means never invoked by the model, in the status column it means the skill is not in the current model catalog.',
        'usage.summary': '{n} calls total · {c} catalog entries · {z} never invoked',
        'usage.empty': 'No usage yet — counts land here when the model loads a skill',
        'usage.skill': 'Skill',
        'written.tab.session': 'This session',
        'written.tab.plugin': 'This plugin',
        'written.sessionEmpty': 'Nothing from this conversation yet — reviews appear here once the threshold fires',
        'written.pluginEmpty': 'No distilled skills yet',
        activity: 'Activity timeline',
        activityEmpty: 'No activity',
        refresh: 'Refresh now',
        manual: 'Review now',
        manualQueued: 'Queued for review',
        preview: 'Live review output',
        elapsed: 'running {s}s',
        saved: 'Saved',
        saveFailed: 'Save failed',
        'action.create': 'create',
        'action.patch': 'patch',
        'action.staged': 'staged',
        curator: 'Skill library maintenance (Curator)',
        'curator.run': 'Run inspection',
        'curator.lastRun': 'Last inspection',
        'curator.never': 'never ran',
        'curator.counts': '{a} active · {s} stale · {r} archived',
        'curator.empty': 'No plugin-created skills yet — inspection only maintains skills distilled by reviews, never hand-written or market skills',
        'curator.state.active': 'active',
        'curator.state.stale': 'stale',
        'curator.state.archived': 'archived',
        'curator.restore': 'Restore',
        'curator.restored': 'Restored',
        'curator.uses': 'calls',
        'curator.lastUsed': 'last used',
        'curator.stateHelp': 'Status legend — active: injected into conversation catalogs; stale: unused beyond the stale threshold (marker only, still model-usable); archived: unused beyond the archive threshold, hidden from the model catalog (file kept, restorable anytime). Inspection runs daily, or on demand via the button above.',
        'curator.skill': 'Skill',
        'signal.title': 'Signal trigger',
        'signal.on': 'on',
        'signal.off': 'off',
        'signal.failures': 'tool failures ≥',
        'signal.words': 'correction words',
        'signal.help': 'A hit on any signal marks the window; the next completed turn-end fires a review regardless of thresholds (cooldown still applies). Signals: user aborting a turn, a burst of tool failures, or a correction word in a user message. A false trigger costs one cheap review — precision is the review agent’s job. Comma-separated word list, editable (saved on blur).',
        'signal.stats': 'Recent signals: {t} (abort {a} · failures {f} · correction {c}) · triggered {r} reviews · yielded {y}',
        'signal.none': 'no recent acceleration signals',
        'signal.accelerated': 'accelerated ({k}) — review fires at the next turn end',
        'signal.kind.abort': 'abort',
        'signal.kind.tool-failure': 'tool failures',
        'signal.kind.correction': 'correction',
        memory: 'Memory (cross-session)',
        'memory.help': 'Long-term memory written on demand by background reviews: MEMORY holds environment/project facts, conventions and lessons; USER holds user profile and preferences. Memory is injected frozen at session start — writes (or hand edits) take effect at the NEXT session; the current session keeps its opening snapshot. Most reviews produce no memory. Edit files directly under ' + '~/.dsh/memory/.',
        'memory.entries': ' entries',
        'memory.disabled': 'off',
        'memory.empty': 'Both memory stores are empty — facts/preferences worth remembering will land here when a review spots them',
        'memory.lastWrite': 'last write',
        'memory.view': 'View entries',
        'memory.hide': 'Collapse',
        pending: 'Pending',
        'pending.help': 'In approval mode, candidates wait in an inbox for a human decision. Skill, memory and governance are independent channels: a mixed candidate can be settled channel by channel — the untouched channels stay pending and the candidate stays in the inbox. Apply writes the preview to disk; Skip drops that channel’s write but keeps the record; Reject marks it rejected, and rejecting every channel archives the candidate.',
        'pending.empty': 'No pending candidates — approval-mode review output lands here',
        'pending.total': '{n} pending',
        'pending.loadMore': 'Load more',
        'pending.loading': 'Reading inbox…',
        'pending.open': 'Review',
        'pending.mixed': 'mixed',
        'pending.channels': '{n} channels',
        'pending.tab.session': 'This session',
        'pending.tab.all': 'All',
        'ch.skill': 'Skill',
        'ch.memory': 'Memory',
        'ch.governance': 'Governance',
        'ch.store.memory': 'MEMORY',
        'ch.store.user': 'USER',
        'act.apply': 'Apply',
        'act.skip': 'Skip',
        'act.reject': 'Reject',
        'act.add': 'add',
        'act.replace': 'replace',
        'act.remove': 'remove',
        'act.archive': 'archive (hide)',
        'act.restore': 'restore',
        'state.pending': 'pending',
        'state.applied': 'applied',
        'state.skipped': 'skipped',
        'state.rejected': 'rejected',
        'state.conflict': 'conflict',
        'state.failed': 'failed',
        'state.applying': 'applying',
        'state.reconciliation-required': 'check required',
        'pd.title': 'Candidate detail',
        'pd.revision': 'rev {n}',
        'pd.rationale': 'Rationale',
        'pd.warnings': 'Warnings',
        'pd.conflict': 'Conflict',
        'pd.detail': 'Detail',
        'pd.wouldResult': 'Would result',
        'pd.store': 'Store',
        'pd.limit': 'Limit',
        'pd.entries': 'existing entries',
        'pd.oldText': 'Anchor text',
        'pd.reqTitle': 'Request a change',
        'pd.reqHelp': 'The requirement goes into a focused review; the model produces a NEW staged candidate from it. The current candidate is not edited in place and is not approved by this.',
        'pd.reqPlaceholder': 'e.g. shorten the description to under 60 chars; add three trigger phrases under When to Use.',
        'pd.reqSubmit': 'Send requirement',
        'pd.reqBusy': 'Sending…',
        'pd.reqStarted': 'Focused review started: a new candidate will appear when it finishes; this one stays.',
        'pd.reqQueued': 'Queued behind a running review; a new candidate appears when it runs.',
        'pd.reqEmpty': 'Write what should change first',
        'pd.reqUnknown': 'Outcome unknown (network drop). Refresh the list to see whether a new candidate appeared; do not resubmit.',
        'pd.noSource': 'This candidate has no usable source conversation (it came from the curator, or the session is no longer live here), so it cannot be revised by review. Ask for the change in a new conversation instead.',
        'pd.sourceSession': 'Source session',
        'pd.sourceUnknown': 'Source unknown',
        'pd.revisionOf': 'Revises',
        'pd.readonlyNote': 'This surface only views and approves or rejects; it does not edit candidate text.',
        'pd.current': 'Current',
        'pd.proposed': 'Proposed',
        'pd.show': 'Show content',
        'pd.hide': 'Hide content',
        'pd.appliedRule': 'This channel is already settled; buttons disabled',
        'pd.absent': 'This candidate has no such channel',
        'pd.submit': 'Submitting…',
        'pd.partial': 'Partial success ({s} settled) — remaining channels still await a decision',
        'pd.allApplied': 'All channels written; candidate archived',
        'pd.rejectedAll': 'Rejected and archived',
        'pd.verified': 'verified',
        'pd.unverified': 'unverified',
        'pd.revisionMoved': 'The candidate changed (page revision {a} is stale). Press Reload before submitting so nothing is overwritten.',
        'pd.reload': 'Reload',
        'pd.discardConfirm': 'Discard edits and reload?',
        'pd.unknown': 'Network interrupted, outcome unknown. Operation receipt says: {s}. Do not resubmit — press Recheck first.',
        'pd.recheck': 'Recheck',
        'pd.running': 'receipt still running',
        'pd.receiptMissing': 'receipt not found yet',
        'pd.gone': 'Candidate is gone (possibly already handled): {msg}',
        view: 'View',
        close: 'Close',
        'skillContent.failed': 'Failed to load content',
        'candidate.preview': 'Proposal (not the installed skill)',
        'state.unavailable': 'Candidate unavailable',
        'md.copy': 'Copy content',
        'md.copied': 'Copied',
        'md.code': 'Code',
        'md.wrap': 'Wrap lines',
        'md.unwrap': 'No wrap',
        'md.footnotes': 'Footnotes',
      },
    }

    var STYLES = [
      '.hl-wrap{display:flex;flex-direction:column;gap:14px;padding:16px 20px;overflow:auto;height:100%;',
      '  font-size:13px;color:var(--dsw-alias-label-1,inherit);box-sizing:border-box}',
      '.hl-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.hl-title{font-weight:600;font-size:15px}',
      '.hl-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-positive,#3aa76d);display:inline-block}',
      '.hl-dot.off{background:var(--dsw-alias-state-negative,#c75050)}',
      '.hl-dot.busy{background:var(--dsw-alias-state-warning,#d99a2b);animation:hl-pulse 1.2s infinite}',
      '@keyframes hl-pulse{50%{opacity:.35}}',
      '.hl-loading{animation:hl-pulse 1.2s infinite}',
      '.hl-card{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.08));border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.25));border-radius:10px;padding:12px 14px}',
      '.hl-card h3{margin:0 0 8px;font-size:12px;font-weight:600;opacity:.7;text-transform:uppercase;letter-spacing:.04em}',
      '.hl-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:4px 0}',
      '.hl-bar{flex:1;min-width:120px;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.2));overflow:hidden}',
      '.hl-bar>i{display:block;height:100%;background:var(--dsw-alias-state-positive,#3aa76d);border-radius:3px}',
      '.hl-bar.warn>i{background:var(--dsw-alias-state-warning,#d99a2b)}',
      '.hl-num{font-variant-numeric:tabular-nums;opacity:.75;white-space:nowrap}',
      '.hl-chip{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:999px;padding:2px 10px;font-size:12px;cursor:pointer;background:transparent;color:inherit}',
      '.hl-chip.on{background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.2));font-weight:600}',
      '.hl-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
      '.hl-list li{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}',
      '.hl-skill{font-weight:600;font-family:ui-monospace,monospace;font-size:12px}',
      '.hl-path{opacity:.55;font-size:11px;font-family:ui-monospace,monospace;word-break:break-all}',
      '.hl-tag{font-size:11px;border-radius:4px;padding:1px 6px;background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.2))}',
      '.hl-err{color:var(--dsw-alias-state-negative,#c75050)}',
      '.hl-mut{opacity:.55}',
      '.hl-table{width:100%;border-collapse:collapse;font-size:12px}',
      '.hl-table th{text-align:left;font-weight:500;padding:2px 8px 4px 0;color:var(--dsw-alias-label-secondary,inherit)}',
      '.hl-table td{padding:3px 8px 3px 0;border-top:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.15));font-variant-numeric:tabular-nums}',
      '.hl-scroll{max-height:260px;overflow:auto}',
      '.hl-help{position:relative;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));border-radius:50%;font-size:10px;color:var(--dsw-alias-label-secondary,inherit);cursor:help;vertical-align:middle}',
      '.hl-help::after{content:attr(data-tip);position:absolute;top:calc(100% + 8px);right:-6px;z-index:60;width:min(360px,72vw);white-space:normal;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-1,inherit);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:8px;padding:10px 12px;font-size:12px;font-weight:400;line-height:1.7;text-align:left;box-shadow:0 6px 20px rgba(0,0,0,.25);opacity:0;pointer-events:none;transition:opacity .12s}',
      '.hl-help:hover::after{opacity:1}',
      '.hl-input{background:var(--dsw-alias-bg-layer-1,transparent);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:6px;padding:2px 8px;font-size:12px;color:inherit}',
      // 技能内容查看按钮 + 弹窗（结构借鉴 skills-management 的 SkDialog）
      '.hl-view{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:6px;padding:0 7px;font-size:11px;line-height:1.6;cursor:pointer;background:transparent;color:inherit;font-family:inherit}',
      '.hl-view:hover{background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.2))}',
      '.hl-dlg-backdrop{position:fixed;inset:0;z-index:2147483200;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px}',
      '.hl-dlg{background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:12px;min-width:320px;max-width:880px;width:88vw;max-height:82vh;overflow:auto;padding:16px;box-shadow:0 10px 40px rgba(0,0,0,.35);color:var(--dsw-alias-label-1,inherit)}',
      '.hl-dlg-title{margin:0 0 8px;display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;font-family:ui-monospace,monospace;word-break:break-all}',
      '.hl-dlg-desc{margin:0 0 10px;opacity:.7;font-size:12px;line-height:1.6}',
      '.hl-dlg-body{max-height:58vh;overflow:auto;border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.15));border-radius:8px;padding:12px;background:var(--dsw-alias-bg-layer-1,transparent);font-size:12.5px;line-height:1.7}',
      '.hl-dlg-foot{display:flex;justify-content:flex-end;margin-top:10px}',
      // 待审批：通道级动作按钮 + 可编辑草稿 + 只读内容预览（全部纯文本）
      '.hl-dlg.hl-wide{max-width:1024px;width:94vw}',
      '.hl-sect{border-top:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.15));padding-top:10px;margin-top:12px}',
      '.hl-sect:first-of-type{border-top:none;padding-top:0;margin-top:0}',
      '.hl-h4{margin:0 0 6px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.hl-acts{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}',
      '.hl-btn{font:inherit;font-size:12px;line-height:1.7;border-radius:6px;padding:1px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;color:inherit;cursor:pointer}',
      '.hl-btn:hover:enabled{background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.2))}',
      '.hl-btn:disabled{opacity:.4;cursor:not-allowed}',
      '.hl-btn.apply{border-color:var(--dsw-alias-state-positive,#3aa76d);color:var(--dsw-alias-state-positive,#3aa76d)}',
      '.hl-btn.reject{border-color:var(--dsw-alias-state-negative,#c75050);color:var(--dsw-alias-state-negative,#c75050)}',
      '.hl-btn.primary{background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.2));font-weight:600}',
      '.hl-ta{width:100%;box-sizing:border-box;min-height:130px;display:block;margin:4px 0;background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:6px;padding:8px;font-family:ui-monospace,monospace;font-size:11.5px;line-height:1.7;resize:vertical}',
      '.hl-ta.dirty{border-color:var(--dsw-alias-state-warning,#d99a2b)}',
      '.hl-pre{white-space:pre-wrap;word-break:break-word;margin:4px 0;font-family:ui-monospace,monospace;font-size:11.5px;line-height:1.7;max-height:260px;overflow:auto;background:var(--dsw-alias-bg-layer-1,transparent);border:1px solid var(--dsw-alias-border-l3,rgba(128,128,128,.15));border-radius:6px;padding:8px}',
      '.hl-cols{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
      '@media (max-width:720px){.hl-cols{grid-template-columns:1fr}}',
      '.hl-ok{color:var(--dsw-alias-state-positive,#3aa76d)}',
      '.hl-warn{color:var(--dsw-alias-state-warning,#d99a2b)}',
      '.hl-note{border-radius:8px;padding:6px 10px;margin:6px 0;font-size:12px;line-height:1.7;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.1))}',
      '.hl-note.bad{border-color:var(--dsw-alias-state-negative,#c75050);color:var(--dsw-alias-state-negative,#c75050)}',
      '.hl-note.warn{border-color:var(--dsw-alias-state-warning,#d99a2b)}',
      '.hl-hist{list-style:none;margin:6px 0 0;padding:0;font-size:11px;opacity:.6;font-family:ui-monospace,monospace}',
    ].join('')

    var fmtTime = function (iso) {
      if (!iso) return ''
      var d = new Date(iso)
      return isNaN(d.getTime()) ? '' : ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2)
    }
    // Curator 的时间跨度以天计，纯时分秒没意义
    var fmtDate = function (iso) {
      if (!iso) return ''
      var d = new Date(iso)
      if (isNaN(d.getTime())) return ''
      return ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2)
    }
    var pct = function (v, max) { return max > 0 ? Math.min(100, Math.round(v / max * 100)) : 0 }
    // 审批提交的幂等键：后端要求 ^[A-Za-z0-9_-]{8,80}$。crypto.randomUUID 缺席
    // （旧内核/测试环境）时退回时间戳+随机，满足同一正则。
    var newOperationId = function () {
      try {
        if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
      } catch (e) { /* fall through */ }
      var rnd = ''
      for (var i = 0; i < 4; i++) rnd += Math.random().toString(36).slice(2, 8)
      return 'op-' + Date.now().toString(36) + '-' + rnd.slice(0, 24)
    }

    var Bar = function (props) {
      return h('div', { className: 'hl-row' },
        h('span', null, props.label),
        h('div', { className: 'hl-bar' + (props.pct >= 100 ? ' warn' : '') },
          h('i', { style: { width: props.pct + '%' } })),
        h('span', { className: 'hl-num' }, props.value + ' / ' + props.max))
    }

    var makeView = function (t) {
      // 技能内容弹窗（逻辑借鉴 skills-management 的 DetailModal + SkDialog）：
      // backdrop 点击/Esc 关闭、内容区 stopPropagation；候选按 ID 拉取 /api/candidate，正式技能按名字拉取 /api/skill，
      // MarkdownText 原语缺席时退回 pre 纯文本。
      var SkillContentDialog = function (props) {
        var _ld = React.useState(null)
        var data = _ld[0]
        var setData = _ld[1]
        var _le = React.useState(null)
        var failed = _le[0]
        var setFailed = _le[1]
        React.useEffect(function () {
          var alive = true
          setData(null)
          setFailed(null)
          var url = props.candidateId
            ? '/hermes-loop/api/candidate?id=' + encodeURIComponent(props.candidateId)
            : '/hermes-loop/api/skill?name=' + encodeURIComponent(props.name)
          fetch(url)
            .then(function (r) {
              return r.json().then(function (d) { return { ok: r.ok === true, body: d } })
            })
            .then(function (out) {
              if (!alive) return
              if (out.ok && out.body && typeof out.body.content === 'string') setData(out.body)
              else setFailed((out.body && out.body.error) || 'HTTP ' + '?')
            })
            .catch(function (e) { if (alive) setFailed(String(e && e.message || e)) })
          return function () { alive = false }
        }, [props.name, props.candidateId])
        React.useEffect(function () {
          var onKey = function (e) { if (e.key === 'Escape') props.onClose() }
          try { document.addEventListener('keydown', onKey) } catch (e) { /* 无 document（测试环境） */ }
          return function () { try { document.removeEventListener('keydown', onKey) } catch (e) {} }
        }, [])
        // MarkdownText 的 labels 是宿主必填（正文含 ``` 围栏时缺失会抛 TypeError，
        // 见 skills-management markdownLabels 注释），且要求按文案引用稳定。
        var labels = React.useMemo(function () {
          return {
            code: {
              copyLabel: t('md.copy'),
              copiedLabel: t('md.copied'),
              toolbarLabels: { codeLabel: t('md.code'), wrapLabel: t('md.wrap'), unwrapLabel: t('md.unwrap') },
            },
            footnotes: t('md.footnotes'),
          }
        }, [t('md.copy'), t('md.copied'), t('md.code'), t('md.wrap'), t('md.unwrap'), t('md.footnotes')])
        return h('div', { className: 'hl-dlg-backdrop', onClick: props.onClose },
          h('div', { className: 'hl-dlg', onClick: function (e) { e.stopPropagation() } },
            h('div', { className: 'hl-dlg-title' },
              h('span', null, props.name),
              h('span', { className: 'hl-tag' }, props.candidateId ? t('candidate.preview') : 'SKILL.md'),
              props.candidateId && data ? h('span', { className: 'hl-tag' }, stateText(data.state)) : null),
            failed !== null
              ? h('div', { className: 'hl-err' }, t('skillContent.failed') + ': ' + failed)
              : data === null
                ? h('div', { className: 'hl-mut hl-loading' }, t('loading'))
                : [
                  data.description ? h('p', { key: 'd', className: 'hl-dlg-desc' }, data.description) : null,
                  h('div', { key: 'b', className: 'hl-dlg-body' },
                    MarkdownText !== null
                      ? h(MarkdownText, { text: data.content, labels: labels })
                      : h('pre', { style: { whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'ui-monospace,monospace', fontSize: '11.5px' } }, data.content)),
                ],
            h('div', { className: 'hl-dlg-foot' },
              h('button', { className: 'hl-chip', onClick: props.onClose }, t('close')))))
      }

      // ── 待审批（approval mode inbox）──────────────────────────────────
      // 一条候选可能同时带 skill / memory / governance 三种结论。三通道各自独立
      // 提交（body 只放被点的那个通道），未处理通道在后端保持 pending，候选继续
      // 留在收件箱——所以这里没有「全部通过」。operationId 在点击瞬间生成并留在
      // 状态里：网络断了先查 /operations 回执，确认没写成功才允许用户重新点。
      var useMdLabels = function () {
        return React.useMemo(function () {
          return {
            code: {
              copyLabel: t('md.copy'),
              copiedLabel: t('md.copied'),
              toolbarLabels: { codeLabel: t('md.code'), wrapLabel: t('md.wrap'), unwrapLabel: t('md.unwrap') },
            },
            footnotes: t('md.footnotes'),
          }
        }, [t('md.copy'), t('md.copied'), t('md.code'), t('md.wrap'), t('md.unwrap'), t('md.footnotes')])
      }

      // 纯文本 / Markdown 预览：MarkdownText 原语在就用它，缺席退回 pre（同弹窗）
      var MdBlock = function (props) {
        var labels = useMdLabels()
        var text = typeof props.text === 'string' ? props.text : String(props.text === undefined || props.text === null ? '' : props.text)
        if (MarkdownText !== null && props.plain !== true) return h(MarkdownText, { text: text, labels: labels })
        return h('pre', { className: 'hl-pre' }, text)
      }

      var stateText = function (state) {
        var key = 'state.' + state
        var text = t(key)
        return text === key ? String(state || '') : text
      }
      var stateTone = function (state) {
        if (state === 'applied') return ' hl-ok'
        if (state === 'conflict' || state === 'failed' || state === 'reconciliation-required') return ' hl-err'
        return ''
      }
      var channelLabel = function (ch) {
        var key = 'ch.' + ch
        var text = t(key)
        return text === key ? String(ch) : text
      }
      var actionText = function (action) {
        if (!action) return ''
        var key = 'action.' + action
        var text = t(key)
        if (text !== key) return text
        var actKey = 'act.' + action
        var act = t(actKey)
        if (act !== actKey) return act
        var chKey = 'ch.' + action
        var ch = t(chKey)
        return ch === chKey ? String(action) : ch
      }
      var SETTLED_STATES = { applied: true, skipped: true, rejected: true }

      var ChannelActions = function (props) {
        var disabled = props.disabled === true
        return h('div', { className: 'hl-acts' }, ['apply', 'skip', 'reject'].map(function (act) {
          return h('button', {
            key: act,
            className: 'hl-btn ' + act,
            disabled: disabled,
            title: disabled ? (props.tip || undefined) : undefined,
            onClick: function () { if (!disabled) props.onDecide(act) },
          }, t('act.' + act))
        }))
      }

      var PendingDetail = function (props) {
        var id = props.id
        var _d = React.useState(null); var detail = _d[0]; var setDetail = _d[1]
        var _ld = React.useState(true); var loading = _ld[0]; var setLoading = _ld[1]
        var _le = React.useState(null); var loadErr = _le[0]; var setLoadErr = _le[1]
        // A requirement is prompt text for a focused review, not an edit buffer:
        // the candidate body is never modified here.
        var _rq = React.useState(''); var request = _rq[0]; var setRequest = _rq[1]
        var _bs = React.useState(null); var busy = _bs[0]; var setBusy = _bs[1] // decide:<ch> | improve | receipt
        var _fl = React.useState(null); var flash = _fl[0]; var setFlash = _fl[1] // {kind,text}
        var _oc = React.useState(null); var outcome = _oc[0]; var setOutcome = _oc[1]
        var _st = React.useState(null); var stale = _st[0]; var setStale = _st[1] // {pageRev,currentRev}
        var _op = React.useState(null); var pendingOp = _op[0]; var setPendingOp = _op[1]
        var _cf = React.useState(false); var confirmReload = _cf[0]; var setConfirmReload = _cf[1]
        var _ex = React.useState({ skill: false, memory: false, governance: false }); var expanded = _ex[0]; var setExpanded = _ex[1]

        var toggleExpanded = function (ch) {
          setExpanded(function (prev) {
            var next = { skill: prev.skill, memory: prev.memory, governance: prev.governance }
            next[ch] = !next[ch]
            return next
          })
        }

        // 服务端计划 → 视图状态。需求输入框（request）不受刷新影响：
        // 轮询或结果回读都不得冲掉用户正在写的修改要求。
        var absorb = function (next) {
          setDetail(next)
          setLoading(false)
        }

        var load = function (opts) {
          setLoading(true)
          fetch('/hermes-loop/api/pending/detail?id=' + encodeURIComponent(id), { credentials: 'same-origin' })
            .then(function (r) {
              return r.json().catch(function () { return {} }).then(function (body) { return { ok: r.ok === true, status: r.status, body: body } })
            })
            .then(function (out) {
              if (out.ok === true && out.body && typeof out.body === 'object' && out.body.id) { setLoadErr(null); absorb(out.body); return }
              setLoading(false)
              setLoadErr({ status: out.status, code: (out.body && out.body.code) || '', message: (out.body && out.body.error) || ('HTTP ' + out.status) })
            })
            .catch(function (e) { setLoading(false); setLoadErr({ status: 0, code: '', message: String(e && e.message || e) }) })
        }

        React.useEffect(function () { load() }, [id])
        React.useEffect(function () {
          var onKey = function (e) { if (e.key === 'Escape') props.onClose() }
          try { document.addEventListener('keydown', onKey) } catch (e) { /* 无 document（测试环境） */ }
          return function () { try { document.removeEventListener('keydown', onKey) } catch (e) {} }
        }, [])

        var postJson = function (url, payload) {
          return fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload),
          }).then(function (r) {
            return r.json().catch(function () { return {} }).then(function (body) { return { ok: r.ok === true, status: r.status, body: body } })
          })
        }

        var dirty = function () {
          return String(request || '').trim() !== ''
        }

        var markStale = function (message, pageRevision) {
          var m = /current (\d+)/.exec(String(message || ''))
          var cur = m ? parseInt(m[1], 10) : null
          setStale({ pageRev: pageRevision, currentRev: cur })
          setFlash({ kind: 'bad', text: t('pd.revisionMoved', { a: pageRevision }) })
        }

        // 决定结果回读：status 为 partial 时只列出已处理的通道，其余仍在等决定。
        var showResult = function (result) {
          var b = result || {}
          var names = Object.keys(b.results || {})
          var settled = names.filter(function (k) { return b.results[k] && SETTLED_STATES[b.results[k].state] === true })
          var head = b.status === 'rejected' ? t('pd.rejectedAll')
            : b.status === 'applied' ? t('pd.allApplied')
              : t('pd.partial', { s: settled.map(function (k) { return channelLabel(k) }).join(' / ') })
          return { status: b.status, revision: b.revision, head: head, results: b.results || {} }
        }
        var settle = function (result) {
          setBusy(null)
          setPendingOp(null)
          setStale(null)
          setOutcome(showResult(result))
          load()
          if (typeof props.onChanged === 'function') props.onChanged()
        }

        // 网络断了不重放：先看回执。done → 用回执结果收尾；failed → 报错；
        // running/缺失 → 留在 pendingOp 上让用户手动「重新查询」。
        var checkReceipt = function (opId) {
          if (!opId) return Promise.resolve()
          setBusy('receipt')
          return fetch('/hermes-loop/api/operations?operationId=' + encodeURIComponent(opId), { credentials: 'same-origin' })
            .then(function (r) {
              return r.json().catch(function () { return {} }).then(function (body) { return { ok: r.ok === true, status: r.status, body: body } })
            })
            .then(function (out) {
              var b = out.body || {}
              if (out.ok !== true) {
                setBusy(null)
                setFlash({ kind: 'warn', text: t('pd.unknown', { s: b.error || (b.code || ('HTTP ' + out.status)) }) })
                return
              }
              if (b.state === 'done' && b.result) { settle(b.result); return }
              if (b.state === 'failed') {
                setBusy(null)
                setPendingOp(null)
                setFlash({ kind: 'bad', text: (b.error && (b.error.message || b.error.code)) || 'failed' })
                load()
                return
              }
              setBusy(null)
              setFlash({ kind: 'warn', text: t('pd.unknown', { s: t('pd.running') }) })
            })
            .catch(function () {
              setBusy(null)
              setFlash({ kind: 'warn', text: t('pd.unknown', { s: t('pd.receiptMissing') }) })
            })
        }

        var submitChannel = function (channel, action) {
          if (busy !== null || detail === null) return
          if (stale !== null) { setFlash({ kind: 'bad', text: t('pd.revisionMoved', { a: stale.pageRev }) }); return }
          var operationId = newOperationId()
          var payload = { id: id, expectedRevision: detail.revision, operationId: operationId }
          payload[channel] = action
          setBusy('decide:' + channel)
          setFlash(null)
          setOutcome(null)
          setPendingOp(operationId)
          postJson('/hermes-loop/api/pending/decide', payload)
            .then(function (res) {
              var b = res.body || {}
              // 后端已在跑/已跑完同一指纹：立刻读回执，绝不重放写操作
              if (res.status === 409 && (b.code === 'EINPROGRESS' || b.code === 'EOPCONFLICT')) { checkReceipt(operationId); return }
              if (res.ok === true && b.ok === true) { settle(b); return }
              if (res.status === 409 && b.code === 'EREVISION') {
                setBusy(null)
                setPendingOp(null)
                markStale(b.error, detail.revision)
                return
              }
              setBusy(null)
              setPendingOp(null)
              setFlash({ kind: 'bad', text: (b.error || ('HTTP ' + res.status)) + (b.code ? ' [' + b.code + ']' : '') })
              if (b.code === 'ENOTFOUND') load()
            })
            .catch(function () { checkReceipt(operationId) })
        }

        // 提出修改要求：把要求送进一次聚焦复盘，由模型产出新候选。
        // 这里不改候选正文，也不代表已批准。
        var requestImprovement = function () {
          if (busy !== null || detail === null) return
          var text = String(request || '').trim()
          if (text === '') { setFlash({ kind: 'bad', text: t('pd.reqEmpty') }); return }
          if (detail.sourceKnown === false) { setFlash({ kind: 'bad', text: t('pd.noSource') }); return }
          setBusy('improve')
          setFlash(null)
          postJson('/hermes-loop/api/pending/improve', { id: id, instruction: text })
            .then(function (res) {
              var b = res.body || {}
              setBusy(null)
              if (res.ok === true && b.ok === true) {
                setFlash({ kind: 'ok', text: b.state === 'queued' ? t('pd.reqQueued') : t('pd.reqStarted') })
                setRequest('')
                if (typeof props.onChanged === 'function') props.onChanged()
                return
              }
              if (b.code === 'ENOSOURCE' || b.code === 'ESESSIONGONE') { setFlash({ kind: 'bad', text: t('pd.noSource') }); return }
              setFlash({ kind: 'bad', text: (b.error || ('HTTP ' + res.status)) + (b.code ? ' [' + b.code + ']' : '') })
            })
            .catch(function () {
              setBusy(null)
              // 结果未知：不重放，提示先刷新确认是否已产生新候选
              setFlash({ kind: 'warn', text: t('pd.reqUnknown') })
            })
        }

        var reload = function () {
          if (dirty() && confirmReload !== true) { setConfirmReload(true); return }
          setConfirmReload(false)
          setStale(null)
          setFlash(null)
          setOutcome(null)
          setPendingOp(null)
          load()
        }

        var flashNode = function () {
          if (flash === null) return null
          var cls = flash.kind === 'bad' ? 'hl-note bad' : flash.kind === 'warn' ? 'hl-note warn' : flash.kind === 'ok' ? 'hl-note hl-ok' : 'hl-note'
          return h('div', { className: cls }, flash.text)
        }

        if (loadErr !== null) {
          var gone = loadErr.status === 404
          return h('div', { className: 'hl-dlg-backdrop', onClick: props.onClose },
            h('div', { className: 'hl-dlg', onClick: function (e) { e.stopPropagation() } },
              h('div', { className: 'hl-dlg-title' }, h('span', null, t('pd.title')), h('span', { className: 'hl-tag' }, id)),
              h('div', { className: 'hl-err' }, gone ? t('pd.gone', { msg: loadErr.message }) : (loadErr.message + (loadErr.code ? ' [' + loadErr.code + ']' : ''))),
              h('div', { className: 'hl-dlg-foot' },
                h('button', { className: 'hl-btn', onClick: reload }, t('pd.reload')),
                h('button', { className: 'hl-chip', onClick: props.onClose }, t('close')))))
        }
        if (detail === null) {
          return h('div', { className: 'hl-dlg-backdrop', onClick: props.onClose },
            h('div', { className: 'hl-dlg', onClick: function (e) { e.stopPropagation() } },
              h('div', { className: 'hl-dlg-title' }, h('span', null, t('pd.title'))),
              h('div', { className: 'hl-mut hl-loading' }, t('loading')),
              h('div', { className: 'hl-dlg-foot' }, h('button', { className: 'hl-chip', onClick: props.onClose }, t('close')))))
        }

        var channels = detail.channels || {}
        var states = detail.states || {}
        var staleBlock = stale !== null

        var skillCh = channels.skill || {}
        var memCh = channels.memory || {}
        var govCh = channels.governance || {}

        // detail.states 是 record.channels（对象 {state,verified,...}），list.states 是字符串：
        // 两种形状都要吃得下，否则契约漂移会让按钮全部误判成待审。
        var stateOf = function (raw) {
          if (raw === undefined || raw === null) return { state: 'pending' }
          if (typeof raw === 'string') return { state: raw }
          return raw
        }

        var channelHead = function (channel, ch) {
          var st = stateOf(states[channel])
          var state = st.state || 'pending'
          var settled = SETTLED_STATES[state] === true
          return h('div', { className: 'hl-row' },
            h('span', { className: 'hl-h4', style: { margin: 0 } }, channelLabel(channel)),
            ch.action ? h('span', { className: 'hl-tag' }, actionText(ch.action)) : null,
            ch.name || ch.skill ? h('span', { className: 'hl-skill' }, String(ch.name || ch.skill)) : null,
            ch.file ? h('span', { className: 'hl-path' }, String(ch.file)) : null,
            h('span', { className: 'hl-tag' + stateTone(state) }, stateText(state)),
            st.verified === true ? h('span', { className: 'hl-tag hl-ok' }, '✓ ' + t('pd.verified')) : null,
            st.verified === false ? h('span', { className: 'hl-tag hl-err' }, t('pd.unverified')) : null,
            settled ? h('span', { className: 'hl-mut' }, t('pd.appliedRule')) : null,
            // 候选里没有这条通道时不给按钮：点了也没有东西可写，只会造成误解
            ch.present === true
              ? h(ChannelActions, {
                disabled: busy !== null || settled || staleBlock,
                tip: settled ? t('pd.appliedRule') : (staleBlock ? t('pd.revisionMoved', { a: stale.pageRev }) : undefined),
                onDecide: function (act) { submitChannel(channel, act) },
              })
              : null)
        }

        var conflictNote = function (ch) {
          if (!ch || ch.conflict === undefined) return null
          return h('div', { className: 'hl-note warn' },
            h('strong', null, t('pd.conflict') + ': '),
            String(ch.conflict),
            ch.detail ? h('span', { className: 'hl-mut' }, ' — ' + String(ch.detail)) : null)
        }

        var contentToggle = function (channel, ch) {
          var hasAny = typeof ch.currentContent === 'string' || typeof ch.proposedContent === 'string'
          if (!hasAny) return null
          return h('div', null,
            h('button', { className: 'hl-view', onClick: function () { toggleExpanded(channel) } },
              expanded[channel] ? t('pd.hide') : t('pd.show')),
            expanded[channel]
              ? h('div', { className: 'hl-cols', style: { marginTop: '6px' } },
                h('div', null,
                  h('div', { className: 'hl-mut' }, t('pd.current')),
                  h(MdBlock, { text: typeof ch.currentContent === 'string' ? ch.currentContent : '—' })),
                h('div', null,
                  h('div', { className: 'hl-mut' }, t('pd.proposed')),
                  h(MdBlock, { text: typeof ch.proposedContent === 'string' ? ch.proposedContent : '—' })))
              : null)
        }

        var skillSection = h('div', { className: 'hl-sect', key: 's' },
          channelHead('skill', skillCh),
          skillCh.present !== true
            ? h('div', { className: 'hl-mut' }, t('pd.absent'))
            : [
              conflictNote(skillCh),
              skillCh.artifactNote ? h('div', { className: 'hl-row hl-mut' }, String(skillCh.artifactNote)) : null,
              contentToggle('skill', skillCh),
            ])

        var memSection = h('div', { className: 'hl-sect', key: 'm' },
          channelHead('memory', memCh),
          memCh.present !== true
            ? h('div', { className: 'hl-mut' }, t('pd.absent'))
            : [
              conflictNote(memCh),
              h('div', { className: 'hl-row hl-mut', key: 'i' },
                t('pd.store') + ': ' + (memCh.store === 'user' ? t('ch.store.user') : t('ch.store.memory')),
                ' · ' + t('pd.entries') + ': ' + (memCh.entries === undefined ? '—' : memCh.entries),
                memCh.scope ? ' · ' + String(memCh.scope) : '',
                memCh.limit ? ' · ' + t('pd.limit') + ' ' + memCh.limit : '',
                memCh.wouldResult ? ' · ' + t('pd.wouldResult') + ': ' + String(memCh.wouldResult) : '',
                memCh.enabled === false ? h('span', { className: 'hl-tag hl-err' }, t('memory.disabled')) : null),
              memCh.detail ? h('div', { className: 'hl-row hl-mut' }, t('pd.detail') + ': ' + String(memCh.detail)) : null,
              memCh.oldText ? h('div', { className: 'hl-row hl-mut' }, t('pd.oldText') + ': ' + String(memCh.oldText)) : null,
              contentToggle('memory', memCh),
            ])

        var govSection = h('div', { className: 'hl-sect', key: 'g' },
          channelHead('governance', govCh),
          govCh.present !== true
            ? h('div', { className: 'hl-mut' }, t('pd.absent'))
            : [conflictNote(govCh), contentToggle('governance', govCh)])

        // 修改要求输入：要求进模型，不进候选正文。
        var requirementBox = h('div', { className: 'hl-sect', key: 'r' },
          h('div', { className: 'hl-mut' }, t('pd.reqTitle')),
          h('div', { className: 'hl-mut', style: { fontSize: '11px', marginTop: '2px' } }, t('pd.reqHelp')),
          h('textarea', {
            className: 'hl-ta',
            style: { minHeight: '70px' },
            value: request,
            spellCheck: false,
            placeholder: t('pd.reqPlaceholder'),
            disabled: detail === null || detail.sourceKnown === false,
            onChange: function (e) { setRequest(e.target.value) },
          }),
          h('div', { className: 'hl-row' },
            h('button', {
              className: 'hl-btn primary',
              disabled: busy !== null || staleBlock || detail === null || detail.sourceKnown === false || String(request || '').trim() === '',
              onClick: requestImprovement,
            }, busy === 'improve' ? t('pd.reqBusy') : t('pd.reqSubmit')),
            detail !== null && detail.sourceKnown === false
              ? h('span', { className: 'hl-warn' }, t('pd.noSource'))
              : null))

        var outcomeNode = null
        if (outcome !== null) {
          var okNames = Object.keys(outcome.results || {})
          outcomeNode = h('div', { className: 'hl-note' + (outcome.status === 'rejected' ? ' warn' : '') },
            h('div', { className: outcome.status === 'partial' ? 'hl-warn' : 'hl-ok' }, outcome.head),
            okNames.length > 0
              ? h('ul', { className: 'hl-list', style: { marginTop: '4px' } }, okNames.map(function (ch) {
                var r = outcome.results[ch] || {}
                return h('li', { key: ch },
                  h('span', { className: 'hl-tag' }, channelLabel(ch)),
                  h('span', null, stateText(r.state || '')),
                  r.note ? h('span', { className: 'hl-mut' }, String(r.note)) : null,
                  r.reason ? h('span', { className: 'hl-mut' }, String(r.reason)) : null,
                  r.verified === true ? h('span', { className: 'hl-tag hl-ok' }, '✓ ' + t('pd.verified')) : null,
                  r.verified === false ? h('span', { className: 'hl-tag hl-err' }, t('pd.unverified')) : null,
                  r.target ? h('span', { className: 'hl-path' }, String(r.target)) : null)
              }))
              : null)
        }

        var warnings = Array.isArray(detail.warnings) ? detail.warnings : []
        var history = Array.isArray(detail.history) ? detail.history : []

        return h('div', { className: 'hl-dlg-backdrop', onClick: function () { if (busy === null) props.onClose() } },
          h('div', { className: 'hl-dlg hl-wide', onClick: function (e) { e.stopPropagation() } },
            h('div', { className: 'hl-dlg-title' },
              h('span', null, t('pd.title')),
              h('span', { className: 'hl-tag' }, id),
              h('span', { className: 'hl-mut', style: { fontFamily: 'inherit', fontSize: '11px', fontWeight: 400 } },
                fmtDate(detail.at) + ' · ' + t('pd.revision', { n: detail.revision })),
              h('span', { style: { flex: 1 } }),
              h('button', { className: 'hl-btn', onClick: reload, disabled: busy !== null },
                confirmReload ? t('pd.discardConfirm') : t('pd.reload')),
              h('button', { className: 'hl-chip', onClick: function () { if (busy === null) props.onClose() } }, t('close'))),
            detail.rationale ? h('p', { className: 'hl-dlg-desc' }, t('pd.rationale') + '：' + String(detail.rationale)) : null,
            h('div', { className: 'hl-row hl-mut' },
              detail.sourceKnown === false
                ? h('span', { className: 'hl-tag hl-warn' }, t('pd.sourceUnknown'))
                : h('span', { className: 'hl-tag' }, t('pd.sourceSession') + ': ' + String(detail.sourceSession).slice(0, 12)),
              detail.revisionOf ? h('span', { className: 'hl-tag' }, t('pd.revisionOf') + ': ' + String(detail.revisionOf).slice(0, 10)) : null,
              detail.cwd ? h('span', { className: 'hl-path' }, String(detail.cwd)) : null),
            h('div', { className: 'hl-mut', style: { fontSize: '11px' } }, t('pd.readonlyNote')),
            flashNode(),
            pendingOp !== null
              ? h('div', { className: 'hl-row' },
                h('button', { className: 'hl-btn', disabled: busy !== null, onClick: function () { checkReceipt(pendingOp) } }, t('pd.recheck')),
                h('span', { className: 'hl-mut hl-path' }, pendingOp))
              : null,
            staleBlock
              ? h('div', { className: 'hl-note bad' },
                t('pd.revisionMoved', { a: stale.pageRev }),
                h('div', { style: { marginTop: '4px' } },
                  h('button', { className: 'hl-btn', onClick: reload }, t('pd.reload'))))
              : null,
            outcomeNode,
            warnings.length > 0
              ? h('div', { className: 'hl-note warn' },
                h('strong', null, t('pd.warnings') + ': '),
                warnings.map(function (w, i) {
                  return h('span', { key: i }, (i > 0 ? ' · ' : '') + (typeof w === 'string' ? w : JSON.stringify(w)))
                }))
              : null,
            h('div', { className: 'hl-dlg-body' },
              skillSection,
              memSection,
              govSection,
              requirementBox,
              busy !== null ? h('div', { className: 'hl-mut hl-loading', style: { marginTop: '8px' } }, t('pd.submit')) : null),
            history.length > 0
              ? h('ul', { className: 'hl-hist' }, history.slice(-6).map(function (hEntry, i) {
                return h('li', { key: i }, fmtDate(hEntry.at) + ' · ' + String(hEntry.op || '') + (hEntry.channels ? ' · ' + [].concat(hEntry.channels).join(',') : ''))
              }))
              : null)
        )
      }

      var PendingInbox = function (props) {
        var sessionId = props.sessionId
        var _r = React.useState(null); var page = _r[0]; var setPage = _r[1]
        var _ld = React.useState(true); var loading = _ld[0]; var setLoading = _ld[1]
        var _er = React.useState(null); var err = _er[0]; var setErr = _er[1]
        var _tb = React.useState('all'); var tab = _tb[0]; var setTab = _tb[1]
        var _op = React.useState(null); var openId = _op[0]; var setOpenId = _op[1]
        var _n = React.useState(0); var nonce = _n[0]; var setNonce = _n[1]
        var _bs = React.useState(false); var loadingMore = _bs[0]; var setLoadingMore = _bs[1]

        // 详情开着时暂停列表轮询：详情里可能有未保存的编辑，刷新列表只会造成困惑
        var openRef = React.useRef(null)
        openRef.current = openId

        var buildQuery = function (cursor) {
          var q = []
          if (tab === 'session' && sessionId) q.push('sourceSession=' + encodeURIComponent(sessionId))
          q.push('limit=20')
          if (typeof cursor === 'number') q.push('cursor=' + String(cursor))
          return '/hermes-loop/api/pending?' + q.join('&')
        }

        var fetchPage = function (cursor) {
          return fetch(buildQuery(cursor), { credentials: 'same-origin' })
            .then(function (r) {
              return r.json().catch(function () { return {} }).then(function (body) { return { ok: r.ok === true, status: r.status, body: body } })
            })
        }

        React.useEffect(function () {
          var alive = true
          setLoading(true)
          fetchPage()
            .then(function (out) {
              if (!alive) return
              setLoading(false)
              if (out.ok !== true) { setErr((out.body && out.body.error) || ('HTTP ' + out.status)); return }
              setErr(null)
              setPage(out.body)
            })
            .catch(function (e) { if (alive) { setLoading(false); setErr(String(e && e.message || e)) } })
          var timer = setInterval(function () {
            if (!alive || openRef.current !== null) return
            if (typeof document !== 'undefined' && document.hidden === true) return
            fetchPage().then(function (out) {
              if (!alive || openRef.current !== null) return
              if (out.ok === true) setPage(out.body)
            }).catch(function () { /* 轮询失败保持上次结果 */ })
          }, 8000)
          return function () { alive = false; clearInterval(timer) }
        }, [sessionId, tab, nonce])

        var loadMore = function () {
          if (page === null || page.nextCursor === undefined || page.nextCursor === null) return
          setLoadingMore(true)
          fetchPage(page.nextCursor)
            .then(function (out) {
              setLoadingMore(false)
              if (out.ok !== true) { setErr((out.body && out.body.error) || ('HTTP ' + out.status)); return }
              var next = out.body || {}
              setPage({
                total: next.total,
                nextCursor: next.nextCursor,
                rows: [].concat(page.rows || [], next.rows || []),
              })
            })
            .catch(function () { setLoadingMore(false) })
        }

        var rows = page !== null && Array.isArray(page.rows) ? page.rows : []
        var total = page !== null && typeof page.total === 'number' ? page.total : rows.length
        var nextCursor = page !== null ? page.nextCursor : undefined

        var rowChannels = function (row) {
          var hasSkill = row.action === 'create' || row.action === 'patch'
          var hasMemory = row.memory !== undefined && row.memory !== null
          var hasGovernance = row.governance !== undefined && row.governance !== null
          var states = row.states || {}
          var out = []
          if (hasSkill) out.push({ key: 'skill', state: states.skill || 'pending' })
          if (hasMemory) out.push({ key: 'memory', state: states.memory || 'pending' })
          if (hasGovernance) out.push({ key: 'governance', state: states.governance || 'pending' })
          return out
        }

        return h('div', { className: 'hl-card' },
          h('h3', null, t('pending'), ' ',
            h('span', { className: 'hl-help', 'data-tip': t('pending.help') }, '?'),
            h('span', { className: 'hl-mut', style: { fontWeight: 400, textTransform: 'none', letterSpacing: 0 } },
              ' — ' + t('pending.total', { n: total }))),
          h('div', { className: 'hl-row' },
            h('button', { className: 'hl-chip' + (tab === 'all' ? ' on' : ''), onClick: function () { setTab('all') } }, t('pending.tab.all')),
            h('button', {
              className: 'hl-chip' + (tab === 'session' ? ' on' : ''),
              disabled: !sessionId,
              onClick: function () { if (sessionId) setTab('session') },
            }, t('pending.tab.session')),
            h('span', { style: { flex: 1 } }),
            h('button', { className: 'hl-chip', onClick: function () { setNonce(function (n) { return n + 1 }) } }, t('refresh'))),
          err !== null ? h('div', { className: 'hl-err' }, err) : null,
          rows.length > 0
            ? h('ul', { className: 'hl-list' }, rows.map(function (row) {
              var chs = rowChannels(row)
              return h('li', { key: row.id, style: { alignItems: 'flex-start' } },
                h('span', { className: 'hl-tag' }, actionText(row.action)),
                h('span', { className: 'hl-skill' }, String(row.skill || (row.governance && row.governance.skill) || row.id)),
                row.memory
                  ? h('span', { className: 'hl-tag' },
                    t('ch.memory') + ' · ' + (row.memory.store === 'user' ? t('ch.store.user') : t('ch.store.memory')) + ' · ' + actionText(row.memory.action))
                  : null,
                row.governance
                  ? h('span', { className: 'hl-tag' }, t('ch.governance') + ' · ' + actionText(row.governance.action))
                  : null,
                row.mixed === true ? h('span', { className: 'hl-tag hl-warn' }, t('pending.mixed')) : null,
                h('span', { className: 'hl-mut hl-num' }, t('pending.channels', { n: row.channels || chs.length })),
                h('span', { className: 'hl-mut hl-num' }, fmtDate(row.at)),
                h('span', { className: 'hl-mut hl-path' }, 'r' + String(row.revision === undefined ? '?' : row.revision)),
                row.revisionOf ? h('span', { className: 'hl-tag' }, t('pd.revisionOf') + ': ' + String(row.revisionOf).slice(0, 10)) : null,
                row.sourceKnown === false ? h('span', { className: 'hl-tag hl-warn' }, t('pd.sourceUnknown')) : null,
                h('span', { className: 'hl-acts' }, h('button', {
                  className: 'hl-view',
                  onClick: function () { setOpenId(row.id) },
                }, t('pending.open'))),
                chs.length > 0
                  ? h('span', { className: 'hl-row', style: { margin: 0, gap: '4px' } }, chs.map(function (c) {
                    return h('span', { key: c.key, className: 'hl-tag' + stateTone(c.state) },
                      channelLabel(c.key) + ':' + stateText(c.state))
                  }))
                  : null)
            }))
            : h('div', { className: 'hl-mut' }, loading ? t('pending.loading') : t('pending.empty')),
          nextCursor !== undefined && nextCursor !== null
            ? h('div', { className: 'hl-row' },
              h('button', { className: 'hl-chip', disabled: loadingMore, onClick: loadMore },
                loadingMore ? t('loading') : t('pending.loadMore')))
            : null,
          openId !== null
            ? h(PendingDetail, {
              id: openId,
              onClose: function () { setOpenId(null) },
              onChanged: function () { setNonce(function (n) { return n + 1 }) },
            })
            : null)
      }

      return function HermesLoopView(props) {
        var sessionId = props.sessionId
        var _s = React.useState(null)
        var data = _s[0]
        var setData = _s[1]
        var _e = React.useState(null)
        var error = _e[0]
        var setError = _e[1]
        var _n = React.useState(0)
        var nonce = _n[0]
        var setNonce = _n[1]
        var _f = React.useState(false)
        var flash = _f[0]
        var setFlash = _f[1]
        var _w = React.useState('session')
        var writtenTab = _w[0]
        var setWrittenTab = _w[1]
        var _mx = React.useState(false)
        var memoryExpanded = _mx[0]
        var setMemoryExpanded = _mx[1]
        var _sv = React.useState(null)
        var viewing = _sv[0]
        var setViewing = _sv[1]
        var openSkill = function (name) { if (name) setViewing({ name: String(name) }) }
        var openWritten = function (row) {
          if (row.action === 'staged') {
            if (row.candidateId) setViewing({ name: row.skill || row.candidateId, candidateId: row.candidateId })
          } else if (row.result === 'created' || row.result === 'patched') openSkill(row.skill)
        }

        React.useEffect(function () {
          var alive = true
          var load = function () {
            fetch('/hermes-loop/api/status?sessionId=' + encodeURIComponent(sessionId || ''))
              .then(function (r) { return r.json() })
              .then(function (d) { if (alive) { setData(d); setError(null) } })
              .catch(function (e) { if (alive) setError(String(e && e.message || e)) })
          }
          load()
          var timer = setInterval(load, 4000)
          return function () { alive = false; clearInterval(timer) }
        }, [sessionId, nonce])

        var saveMode = function (mode) { savePatch({ mode: mode }) }
        var _fe = React.useState(false)
        var flashErr = _fe[0]
        var setFlashErr = _fe[1]
        var savePatch = function (patch) {
          fetch('/hermes-loop/api/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ patch: patch }),
          }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status)
            setNonce(function (n) { return n + 1 }); setFlash(true); setTimeout(function () { setFlash(false) }, 1500)
          }).catch(function () { setFlashErr(true); setTimeout(function () { setFlashErr(false) }, 2500) })
        }

        var manualState = React.useState(null) // null | 'queued' | 'started' | 'already-running'
        var manualFlash = manualState[0]
        var setManualFlash = manualState[1]
        var reviewNow = function () {
          fetch('/hermes-loop/api/review-now', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: sessionId || '' }),
          }).then(function (r) { return r.json() })
            .then(function (d) {
              // 失败响应（非活会话 404 等）body 是 { error }——不能再假装已入队
              setManualFlash(d && d.error ? 'error:' + d.error : (d.state || 'started'))
              setTimeout(function () { setManualFlash(null) }, 3500)
              setNonce(function (n) { return n + 1 })
            })
            .catch(function () { setManualFlash('error:network'); setTimeout(function () { setManualFlash(null) }, 3500) })
        }

        var _cur = React.useState(null)
        var curatorFlash = _cur[0]
        var setCuratorFlash = _cur[1]
        var flashCurator = function (text) { setCuratorFlash(text); setTimeout(function () { setCuratorFlash(null) }, 3500) }
        var curatorRun = function () {
          fetch('/hermes-loop/api/curator/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
            .then(function (r) { return r.json() })
            .then(function (d) {
              var rep = d && d.report || {}
              flashCurator(rep.skipped ? 'skipped: ' + rep.skipped : (rep.summary || t('curator.run')))
              setNonce(function (n) { return n + 1 })
            })
            .catch(function () {})
        }
        var restoreSkill = function (name) {
          fetch('/hermes-loop/api/curator/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name }) })
            .then(function (r) { return r.json() })
            .then(function (d) { flashCurator(d && d.ok ? t('curator.restored') + ': ' + name : (d && d.error || '')); setNonce(function (n) { return n + 1 }) })
            .catch(function () {})
        }

        if (error !== null && data === null) {
          return h('div', { className: 'hl-wrap' }, h('div', { className: 'hl-err' }, error))
        }
        if (data === null) return h('div', { className: 'hl-wrap hl-mut hl-loading' }, t('loading'))

        var eff = data.settings || {}
        var cur = data.current || {}
        var runningReview = data.running !== null && data.running !== undefined
        var cooldownLeft = 0
        if (eff.cooldownMinutes > 0 && cur.lastReviewAt) {
          var remainMs = eff.cooldownMinutes * 60000 - (Date.now() - cur.lastReviewAt)
          if (remainMs > 0) cooldownLeft = Math.ceil(remainMs / 1000)
        }
        var turnsMax = eff.turnInterval > 0 ? eff.turnInterval : 0
        var toolsMax = eff.toolCallInterval > 0 ? eff.toolCallInterval : 0

        return h('div', { className: 'hl-wrap' },
          // 状态头
          h('div', { className: 'hl-head' },
            h('span', { className: 'hl-dot' + (eff.enabled === false ? ' off' : runningReview ? ' busy' : '') }),
            h('span', { className: 'hl-title' }, t('tab')),
            h('span', { className: 'hl-mut' },
              eff.enabled === false ? t('disabled')
                : runningReview ? t('running')
                : (data.queuedCount > 0 ? t('queued', { n: data.queuedCount }) : t('idle'))),
            h('span', { style: { flex: 1 } }),
            h('button', {
              className: 'hl-chip' + (runningReview ? ' on' : ''),
              disabled: runningReview === true,
              title: runningReview ? t('running') : undefined,
              onClick: reviewNow,
            }, t('manual')),
            h('button', { className: 'hl-chip', onClick: function () { setNonce(function (n) { return n + 1 }) } }, t('refresh')),
            flash ? h('span', { className: 'hl-mut' }, t('saved')) : null,
            flashErr ? h('span', { className: 'hl-err' }, t('saveFailed')) : null),
          runningReview && data.running.preview
            ? h('div', { className: 'hl-card' },
              h('h3', null, t('preview')),
              h('div', { style: { whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace,monospace', fontSize: '11px', opacity: .75, maxHeight: '160px', overflow: 'auto' } },
                String(data.running.preview).slice(-800)))
            : null,
          manualFlash && manualFlash !== 'started'
            ? h('div', { className: manualFlash.indexOf('error:') === 0 ? 'hl-err' : 'hl-mut' },
              manualFlash.indexOf('error:') === 0 ? manualFlash.slice(6) : t('manualQueued'))
            : null,

          // 设置卡：模式 + 阈值
          h('div', { className: 'hl-card' },
            h('h3', null, t('thresholds')),
            h('div', { className: 'hl-row' },
              h('span', { className: 'hl-mut' }, t('mode')),
              ['auto', 'approval', 'log-only'].map(function (m) {
                return h('button', {
                  key: m,
                  className: 'hl-chip' + (eff.mode === m ? ' on' : ''),
                  onClick: function () { saveMode(m) },
                }, t('mode.' + m))
              }),
              flash ? h('span', { className: 'hl-mut' }, t('saved')) : null),
            h('div', { className: 'hl-row hl-mut' },
              t('turns') + ' ≥ ' + eff.turnInterval,
              ' · ',
              t('toolCalls') + ' ≥ ' + eff.toolCallInterval,
              ' · ',
              t('cooldown') + ' ' + eff.cooldownMinutes + 'min'),

            // 信号加速：开关 + 失败阈值 + 纠正词表 + 近期信号统计
            h('div', { className: 'hl-row' },
              h('span', { className: 'hl-mut' }, t('signal.title')),
              h('button', {
                className: 'hl-chip' + (eff.signalTriggerEnabled !== false ? ' on' : ''),
                onClick: function () { savePatch({ signalTriggerEnabled: eff.signalTriggerEnabled === false }) },
              }, eff.signalTriggerEnabled !== false ? t('signal.on') : t('signal.off')),
              h('span', { className: 'hl-help', 'data-tip': t('signal.help') }, '?'),
              h('span', { style: { flex: 1 } }),
              (function () {
                var sg = data.signals || { total: 0 }
                return h('span', null,
                  sg.total > 0
                    ? t('signal.stats', { t: sg.total, a: sg.abort || 0, f: sg.toolFailure || 0, c: sg.correction || 0, r: sg.triggeredReviews || 0, y: sg.yieldedReviews || 0 })
                    : t('signal.none'))
              })()),
            eff.signalTriggerEnabled !== false ? h('div', { className: 'hl-row' },
              h('span', { className: 'hl-mut' }, t('signal.failures')),
              h('input', {
                key: 'f' + eff.signalToolFailureMin,
                className: 'hl-input',
                type: 'number', min: 0, max: 20,
                defaultValue: eff.signalToolFailureMin,
                style: { width: '60px' },
                onKeyDown: function (e) { if (e.key === 'Enter') e.target.blur() },
                onBlur: function (e) {
                  var v = parseInt(e.target.value, 10)
                  if (!isNaN(v) && v >= 0 && v !== eff.signalToolFailureMin) savePatch({ signalToolFailureMin: v })
                },
              })) : null,
            eff.signalTriggerEnabled !== false ? h('div', { className: 'hl-row' },
              h('span', { className: 'hl-mut' }, t('signal.words')),
              h('input', {
                key: 'w' + eff.signalCorrectionWords,
                className: 'hl-input',
                defaultValue: eff.signalCorrectionWords,
                style: { flex: 1, minWidth: '240px' },
                onKeyDown: function (e) { if (e.key === 'Enter') e.target.blur() },
                onBlur: function (e) {
                  if (e.target.value !== eff.signalCorrectionWords) savePatch({ signalCorrectionWords: e.target.value })
                },
              })) : null),

          // 待审批收件箱（approval 模式；自动写入/仅记录模式下通常为空）
          h(PendingInbox, { sessionId: sessionId }),

          // 本会话进度
          h('div', { className: 'hl-card' },
            h('h3', null, t('progress')),
            turnsMax > 0 ? h(Bar, { label: t('turns'), value: cur.turns || 0, max: turnsMax, pct: pct(cur.turns || 0, turnsMax) }) : null,
            toolsMax > 0 ? h(Bar, { label: t('toolCalls'), value: cur.toolCalls || 0, max: toolsMax, pct: pct(cur.toolCalls || 0, toolsMax) }) : null,
            h('div', { className: 'hl-row hl-mut' },
              t('cooldown') + ': ' + (cooldownLeft > 0 ? t('cooldownWait', { s: cooldownLeft }) : t('cooldownReady'))),
            cur.signal ? h('div', { className: 'hl-row' },
              h('span', { className: 'hl-tag' }, t('signal.accelerated', { k: t('signal.kind.' + cur.signal) }))) : null),

          // 沉淀产物：本对话（默认）/ 本插件 两个子 tab
          (function () {
            var all = data.written || []
            var rows = writtenTab === 'session'
              ? all.filter(function (w) { return w.sessionId && w.sessionId === sessionId })
              : all
            var emptyText = writtenTab === 'session' ? t('written.sessionEmpty') : t('written.pluginEmpty')
            return h('div', { className: 'hl-card' },
              h('h3', null, t('written')),
              h('div', { className: 'hl-row', style: { marginBottom: '6px' } },
                ['session', 'plugin'].map(function (tabKey) {
                  return h('button', {
                    key: tabKey,
                    className: 'hl-chip' + (writtenTab === tabKey ? ' on' : ''),
                    onClick: function () { setWrittenTab(tabKey) },
                  }, t('written.tab.' + tabKey))
                }),
              h('span', { className: 'hl-mut hl-num' }, rows.length)),
              rows.length > 0
                ? h('ul', { className: 'hl-list' }, rows.map(function (w, i) {
                  return h('li', { key: i },
                    h('span', { className: 'hl-tag' }, w.action === 'staged' ? stateText(w.candidateState || 'unavailable') : t('action.' + (w.action || 'create'))),
                    h('span', { className: 'hl-skill' }, w.skill),
                    h('button', { className: 'hl-view', title: t('view'),
                      disabled: w.action === 'staged' ? !w.candidateId || w.candidateState === 'unavailable' : w.result !== 'created' && w.result !== 'patched',
                      onClick: function () { openWritten(w) } }, t('view')),
                    h('span', { className: 'hl-mut' }, fmtDate(w.at)),
                    w.result && w.result !== 'created' && w.result !== 'patched' && w.action !== 'staged'
                      ? h('span', { className: 'hl-err hl-mut' }, w.result) : null,
                    w.path ? h('span', { className: 'hl-path' }, w.path) : null)
                }))
                : h('div', { className: 'hl-mut' }, emptyText))
          })(),

          // 技能使用统计（模型经 skill 工具的真实调用 + 目录曝光）
          (function () {
            var u = data.usage || { rows: [], totalCalls: 0, catalogEntries: 0, neverCalled: 0 }
            var rows = Array.isArray(u.rows) ? u.rows : [] // 防御：契约漂移也不能让整个 tab 静默崩
            return h('div', { className: 'hl-card' },
              h('h3', null, t('usage')),
              rows.length > 0
                ? h('div', null,
                  h('div', { className: 'hl-row hl-mut' }, t('usage.summary', { n: u.totalCalls || 0, c: u.catalogEntries || 0, z: u.neverCalled || 0 })),
                  h('div', { className: 'hl-scroll' },
                    h('table', { className: 'hl-table' },
                      h('thead', null, h('tr', null,
                        h('th', null, t('usage.skill')),
                        h('th', null, t('usage.calls')),
                        h('th', null, t('usage.last')),
                        h('th', null, t('usage.status'), ' ',
                          h('span', { className: 'hl-help', 'data-tip': t('usage.statusHelp') }, '?')))),
                      h('tbody', null, rows.map(function (row, i) {
                        var zombie = row.count === 0
                        var statusText = row.modelInvocable === undefined ? '—' : (row.modelInvocable ? t('usage.modelVisible') : t('usage.modelDisabled'))
                        return h('tr', { key: i, style: zombie ? { opacity: .6 } : null },
                          h('td', null,
                            h('span', { className: 'hl-skill' }, row.skill),
                            h('button', { className: 'hl-view', style: { marginLeft: '6px' }, title: t('view'), onClick: function () { openSkill(row.skill) } }, t('view'))),
                          h('td', null, zombie ? h('span', { className: 'hl-help hl-mut', 'data-tip': t('usage.statusHelp') }, '—') : row.count),
                          h('td', { className: 'hl-mut' }, row.lastUsedAt ? fmtDate(row.lastUsedAt) : h('span', { className: 'hl-help', 'data-tip': t('usage.statusHelp') }, '—')),
                          h('td', null, h('span', { className: 'hl-tag' + (row.modelInvocable === false ? ' hl-err' : '') }, statusText)))
                      })))))
                : h('div', { className: 'hl-mut' }, t('usage.empty')))
          })(),

          // 技能库维护（Curator）：摘要 + 立即巡检 + 纳管技能状态表
          (function () {
            var c = data.curator || { skills: [], counts: {} }
            var counts = c.counts || { active: 0, stale: 0, archived: 0 }
            var skills = c.skills || []
            return h('div', { className: 'hl-card' },
              h('h3', null, t('curator')),
              h('div', { className: 'hl-row' },
                h('span', { className: 'hl-mut' },
                  t('curator.lastRun') + ': ' + (c.lastRunAt ? fmtDate(c.lastRunAt) : t('curator.never'))),
                h('span', { className: 'hl-mut' },
                  t('curator.counts', { a: counts.active || 0, s: counts.stale || 0, r: counts.archived || 0 })),
                h('span', { className: 'hl-help', 'data-tip': t('curator.stateHelp') }, '?'),
                h('span', { style: { flex: 1 } }),
                h('button', { className: 'hl-chip', onClick: curatorRun }, t('curator.run')),
                curatorFlash ? h('span', { className: 'hl-mut' }, curatorFlash) : null),
              c.lastSummary ? h('div', { className: 'hl-row hl-mut' }, c.lastSummary) : null,
              skills.length > 0
                ? h('div', { className: 'hl-scroll' },
                  h('table', { className: 'hl-table' },
                    h('thead', null, h('tr', null,
                      h('th', null, t('curator.skill')),
                      h('th', null, t('usage.status')),
                      h('th', null, t('curator.uses')),
                      h('th', null, t('curator.lastUsed')),
                      h('th', null, ''))),
                    h('tbody', null, skills.map(function (row, i) {
                      return h('tr', { key: i, style: row.state !== 'active' ? { opacity: .75 } : null },
                        h('td', null,
                          h('span', { className: 'hl-skill' }, row.skill),
                          h('button', { className: 'hl-view', style: { marginLeft: '6px' }, title: t('view'), onClick: function () { openSkill(row.skill) } }, t('view'))),
                        h('td', null, h('span', { className: 'hl-tag' + (row.state === 'archived' ? ' hl-err' : '') },
                          t('curator.state.' + row.state))),
                        h('td', null, row.useCount),
                        h('td', { className: 'hl-mut' }, row.lastUsedAt ? fmtDate(row.lastUsedAt) : '—'),
                        h('td', null,
                          row.state === 'archived'
                            ? h('button', { className: 'hl-chip', onClick: function () { restoreSkill(row.skill) } }, t('curator.restore'))
                            : null))
                    }))))
                : h('div', { className: 'hl-mut' }, t('curator.empty')))
          })(),

          // 记忆（跨会话）：双库用量条 + 条目数 + 只读条目列表（§12.5；
          // 文件即界面——增删改仍走手改文件，这里只解决"看"）
          (function () {
            var mem = data.memory || { stores: {} }
            var stores = mem.stores || {}
            var rows = ['memory', 'user'].map(function (key) {
              var st = stores[key] || {}
              return {
                key: key,
                label: key === 'user' ? 'USER' : 'MEMORY',
                on: st.enabled !== false,
                chars: st.chars || 0,
                limit: st.limit || 0,
                entries: st.entries || 0,
                items: Array.isArray(st.items) ? st.items : [],
                lastWriteAt: st.lastWriteAt,
              }
            })
            var totalEntries = rows.reduce(function (n, r) { return n + r.entries }, 0)
            var allItems = memoryExpanded ? rows.reduce(function (acc, r) {
              if (r.on) r.items.forEach(function (item) { acc.push({ store: r.label, text: item }) })
              return acc
            }, []) : []
            return h('div', { className: 'hl-card' },
              h('h3', null, t('memory'), ' ',
                h('span', { className: 'hl-help', 'data-tip': t('memory.help') }, '?'),
                mem.lastOutcome && mem.lastOutcome.at
                  ? h('span', { className: 'hl-mut', style: { fontWeight: 400, textTransform: 'none', letterSpacing: 0 } },
                    ' — ' + t('memory.lastWrite') + ' ' + fmtDate(mem.lastOutcome.at) + ' ' + (mem.lastOutcome.result || ''))
                  : null,
                totalEntries > 0
                  ? h('button', {
                    className: 'hl-chip', style: { marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 },
                    onClick: function () { setMemoryExpanded(function (v) { return !v }) },
                  }, memoryExpanded ? t('memory.hide') : t('memory.view'))
                  : null),
              rows.map(function (r) {
                var p = r.limit > 0 ? pct(r.chars, r.limit) : 0
                return h('div', { className: 'hl-row', key: r.key, style: r.on ? null : { opacity: .5 } },
                  h('span', { className: 'hl-mut', style: { minWidth: '52px' } }, r.label),
                  r.on
                    ? [
                      h('div', { className: 'hl-bar' + (p >= 100 ? ' warn' : '') }, h('i', { style: { width: p + '%' } })),
                      h('span', { className: 'hl-num' }, r.chars + ' / ' + r.limit + ' · ' + r.entries + t('memory.entries')),
                    ]
                    : h('span', { className: 'hl-mut' }, t('memory.disabled')))
              }),
              allItems.length > 0
                ? h('div', { className: 'hl-scroll' },
                  h('ul', { className: 'hl-list' }, allItems.map(function (item, i) {
                    return h('li', { key: i },
                      h('span', { className: 'hl-tag' }, item.store),
                      h('span', { style: { wordBreak: 'break-all' } }, item.text))
                  })))
                : null,
              totalEntries === 0 ? h('div', { className: 'hl-mut' }, t('memory.empty')) : null)
          })(),

          // 技能内容弹窗（三处「查看」按钮共用）
          viewing !== null
            ? h(SkillContentDialog, { name: viewing.name, candidateId: viewing.candidateId, onClose: function () { setViewing(null) } })
            : null,
        )
      }
    }

    module.exports = {
      name: '@zuelwyw/hermes-loop',
      inject: ['slots', 'locale'],
      apply: function (ctx) {
        var NS = 'hermes-loop'
        try { ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }) } catch (e) { /* locale service contract drift: fall back to zh */ }
        var t = function (key, params) {
          var dict = DICT.zh
          var text = dict[key]
          if (text === undefined) return key
          if (params !== undefined && params !== null) {
            for (var k in params) text = text.split('{' + k + '}').join(String(params[k]))
          }
          return text
        }
        try {
          var bound = ctx.locale.bind(NS)
          if (typeof bound === 'function') t = function (key, params) {
            var text = bound(key, params)
            return text === undefined || text === null || text === key ? (function () {
              var zh = DICT.zh[key]
              if (zh === undefined) return key
              if (params !== undefined && params !== null) {
                for (var k in params) zh = zh.split('{' + k + '}').join(String(params[k]))
              }
              return zh
            })() : text
          }
        } catch (e) { /* keep zh fallback */ }

        ctx.effect(function () {
          var tag = document.createElement('style')
          tag.setAttribute('data-plugin', 'dsh-plugin-hermes-loop')
          tag.textContent = STYLES
          document.head.appendChild(tag)
          return function () { if (tag.parentNode !== null) tag.parentNode.removeChild(tag) }
        }, 'hermes-loop: client styles')

        var View = makeView(t)
        ctx.slots.inject('conversation.view', function () {
          return ctx.slots.register(
            // order 25：排在 Chat(0)/Trajectory(10)/Context(20) 之后
            { name: 'conversation.view', id: 'hermes-loop', order: 25, locale: NS, label: function () { return t('tab') } },
            function (props) { return h(View, props) }
          )
        })
      },
    }

    return module.exports
  },
})

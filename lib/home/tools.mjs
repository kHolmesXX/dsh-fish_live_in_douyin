/**
 * lib/home/tools.mjs —— 她的家：9 个工具（2026-10-27 阶段 3b 外移）
 * ============================================================================
 * 从 index.js **原样搬出来**（描述 / 参数 / 逻辑 / 返回值一个字都没改），
 * 只把「必须在闭包里」的东西改成 deps 注入，升级时只需要重打 index.js 里那一段循环。
 *
 *   createHomeTools(deps) → 数组，元素是 {name, description, parameters, execute}
 *   index.js: `for (const spec of createHomeTools({...})) tool(spec)`（tool() 仍是宿主包装器）
 *
 * 搬出来的 9 个：
 *   douyin_relation / douyin_archive / douyin_diary / douyin_home /
 *   douyin_plan_next / douyin_check_plan / douyin_cancel_plan / douyin_reach_out /
 *   douyin_note_activity
 *
 * ⚠️ 不自己注册工具、不 import 宿主的 defineTool —— 这里只产 spec，注册留在 index.js。
 * ============================================================================
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  listProfiles, listGroups, loadGroup, updateGroup, loadProfile, updateProfile,
  findProfileByNick, searchArchive, diaryDates, readDiary, writeDiary,
} from '../relation.mjs'
import { readHomePersona, renderHomePersona, readHomeSelf } from './persona.mjs'
import { appendSent } from './ledger.mjs'
import { hhmm, parsePlanAt } from './life.mjs'
// ⭐ fish.5：主动联系策略（reach.json 的 policy + reach-blocked.jsonl 拦截记录）
import { readReach, writeReach, reachPolicy, recordBlocked, inQuietHours } from './reach.mjs'
// ⭐ fish.9：主动找人（上线搭话 / 他不回连发）——待回记录在这里记，anxiousTick 读它
import { appendPending, readPending } from './anxious.mjs'
// ⭐ fish.13：群友分享视频（挑着看 / 截图 / 外部分析）
import * as groupvid from './groupvid.mjs'
// ⭐ fish.14：群助手昵称等设置（settings.groupPatrol.groupAssistantName）
import { readSettings } from './settings.mjs'

/**
 * 造出这些工具 spec（2026-10-27 fish.10：10 个 —— 新增 douyin_group_say）。
 *
 * @param {object} deps
 * @param {string} deps.stateDir      插件家目录（memory/ 在它下面）
 * @param {string} deps.homeDir       她家（home/）
 * @param {string} [deps.roomDir]     她的房间（这批工具目前不用，留给以后）
 * @param {Function} deps.log
 * @param {Function} deps.dayKey      本地日期
 * @param {Function} deps.runNodeToolAsync  async spawn 工具（reach_out 发私信用）
 * @param {Function} deps.dmPeersOf / deps.dmPrimary   私信对象
 * @param {Function} deps.loadProfile
 * @param {Function} deps.noteSent
 * @param {Function} deps.readLife / deps.patchLife    已绑定 lifeFile 的读写（index.js 注入）
 * @param {Function} deps.noteActivity 写活动台账（home/journal.jsonl）
 * @param {string}   deps.journalFile  活动台账文件（note_activity 返回给模型看）
 * @param {Function} [deps.runPy] / [deps.pickJson]    reach_out 的 IM 协议侧回读（闭包依赖）
 * @param {Function} [deps.dutyInfo]         () => { sessionId, live }（douyin_home 用）
 * @param {Function} [deps.dutySessionEnsure] （douyin_home op=ensure 用）
 * @returns {Array<{name:string, description:string, parameters:object, execute:Function}>}
 */
export function createHomeTools(deps = {}) {
  const {
    stateDir = '', homeDir = '', roomDir = '', log = () => {},
    dayKey = () => new Date().toISOString().slice(0, 10),
    runNodeToolAsync, dmPeersOf, dmPrimary, loadProfile: loadProfileDep, noteSent,
    readLife, patchLife, noteActivity,
    journalFile = join(homeDir, 'journal.jsonl'),
    runPy, pickJson,
    // ⭐ fish.13：同步 spawn（群视频详情/截图用；插件里注入，工具单测可缺省）
    runNodeTool,
    dutyInfo = () => ({ sessionId: '', live: false }),
    dutySessionEnsure,
    // ⭐ fish.6：发送失败进故障面板（index.js 注入；缺省不记，工具单测也能跑）
    fault = () => {}, unfault = () => {},
  } = deps
  void roomDir

  /* 她家这几条路径由 homeDir 推出来（跟 index.js 里原来的 join 完全一致） */
  const personaFile = join(homeDir, 'persona.md')
  const selfFile = join(homeDir, 'whoami.md')
  // ⭐ fish.5：reach.json 的读写/策略/拦截记录都在 lib/home/reach.mjs（这里不再自己算路径）

  /** 把「上次活动」推到现在（reach_out 走完算活动；跟 index.js 的 touchActivity 同效）。 */
  const touchActivity = () => {
    try { patchLife((l) => ({ ...l, lastActivityAt: new Date().toISOString() })) } catch { /* 不影响主流程 */ }
  }
  /** reach_out 的发送账本（跟 index.js 里同一个 appendSent 口径） */
  const noteSentLedger = (row) => appendSent({ homeDir, row, log })

  /**
   * ⭐ fish.14：在群里说话（douyin_group_say 与 delegate 复用）。
   * 走 im-send --to 群名 [--at 昵称]；失败记 ledger + fault，不抛。
   */
  const sendGroupSay = async ({ group = '', text = '', at = '' } = {}) => {
  text = stripBodyActions(text)
    const g = String(group || '').trim()
    const t = String(text || '').trim()
    const a = String(at || '').trim()
    if (!g) return { ok: false, error: 'group 必填（群名）' }
    if (!t) return { ok: false, error: 'text 必填' }
    if (t.length > 200) return { ok: false, error: `text 最多 200 字（现在 ${t.length} 字）` }
    const argv = ['--to', g, '--text', t]
    if (a) argv.push('--at', a)
    let r
    try {
      r = await runNodeToolAsync('im-send.mjs', argv, { timeout: 240_000 })
    } catch (e) {
      const msg = String(e?.message ?? e).slice(0, 200)
      noteSentLedger({ aweme_id: '', to: g, to_id: '', kind: 'group', sent: false, readback: false, error: msg, src: 'host' })
      fault('send', `群里说话没发出去：${msg.slice(0, 120)}（看「连接」登录态/网络；403 等十分钟）`)
      return { ok: false, error: msg, text: t, ...(a ? { at: a } : {}) }
    }
    const j = pickJson(r.stdout)
    const sent = Boolean(j && j.ok === true && j.sent === true)
    const readback = Boolean(j && j.readback === true)
    noteSentLedger({
      aweme_id: '', to: g, to_id: '', kind: 'group', sent, readback,
      error: sent ? '' : String((j && (j.error || j.warning)) || r.stderr || '没发出去').slice(0, 200),
      src: 'host',
    })
    if (!sent) {
      const err = String((j && j.error) || '没发出去').slice(0, 300)
      fault('send', `群里说话没发出去：${err.slice(0, 120)}（看「连接」登录态/网络；403 等十分钟）`)
      return { ok: false, error: err, text: t, ...(a ? { at: a } : {}), ...(j && j.warning ? { warned: String(j.warning) } : {}) }
    }
    unfault('send')
    touchActivity()
    log(`群里说话：→「${g}」${a ? ` @${a}` : ''}（${t.length} 字）`)
    return {
      ok: true, text: t,
      ...(a ? { at: a } : {}),
      ...(j && j.mention ? { mention: String(j.mention) } : {}),
      ...(j && j.warning ? { warned: String(j.warning) } : {}),
      readback,
    }
  }

  return [
    /**
     * ⭐ 2026-10-27 P0：关系档案（像人一样「记住一部分人」）。
     *   只记大概：阶段（生/熟/自己人）、一句印象、喜欢什么、别提什么、上次说到哪、答应过什么。
     *   不逐句背 —— 原话在 archive 里，需要时用 douyin_archive 翻。
     */
    {
      name: 'douyin_relation',
      description: '⭐ 关系档案：查/改「我记住的这个人 / 这个群大概是什么样」。'
        + 'op=list 列所有人和群；op=get 看一个（who 给 sec_uid 或昵称，群直接给群名）；'
        + 'op=update 写：人的字段 stage（生/熟/自己人）/ call / impression / likes / avoid / lastTopic / promises，'
        + '群的字段 impression / member（{name, impression, quote} 记某个群友的大概印象）。只写大概，别写成长篇。',
      parameters: {
        op: { type: 'string', description: 'list | get | update（默认 list）' },
        who: { type: 'string', description: '人的 sec_uid 或昵称；群就给群名' },
        kind: { type: 'string', description: 'person | group（不给就按 who 猜：MS4w 开头当人，否则先找群名）' },
        patch: {
          type: 'object',
          additionalProperties: true,
          description: 'update 用：{stage,call,impression,likes,avoid,lastTopic,promises} 或群的 {impression,member:{name,impression,quote}}',
        },
      },
      async execute(args = {}) {
        const op = String(args.op || 'list').toLowerCase()
        const who = String(args.who || '').trim()
        try {
          if (op === 'list' || !who) {
            return { ok: true, people: listProfiles(stateDir), groups: listGroups(stateDir) }
          }
          const looksPerson = /^MS4w/.test(who)
          const kindGuess = String(args.kind || (looksPerson ? 'person' : 'group')).toLowerCase()
          if (kindGuess === 'group') {
            if (op === 'get') return { ok: true, group: loadGroup(stateDir, who) }
            const patch = args.patch || {}
            // 支持两种写法：{member:{name,impression,quote}} 单个，或 {member:{'某人':{impression}}} 多个
            const rawMember = patch.member && typeof patch.member === 'object' ? patch.member : null
            const memberMap = rawMember
              ? (rawMember.name
                ? { [String(rawMember.name)]: { impression: rawMember.impression, quote: rawMember.quote } }
                : Object.fromEntries(Object.entries(rawMember).map(([n, v]) => [n, v && typeof v === 'object' ? v : { impression: String(v || '') }])))
              : null
            const next = updateGroup(stateDir, who, {
              impression: patch.impression,
              ...(memberMap && Object.keys(memberMap).length ? { members: memberMap } : {}),
            })
            return { ok: true, group: next }
          }
          // person
          let secUid = looksPerson ? who : ''
          if (!secUid) {
            const hit = findProfileByNick(stateDir, who)
            if (!hit) return { ok: false, error: `没找到「${who}」的档案 —— 先让我读到跟他的私信，或者给 sec_uid` }
            secUid = hit.sec_uid
          }
          if (op === 'get') return { ok: true, profile: loadProfile(stateDir, secUid) }
          const next = updateProfile(stateDir, secUid, args.patch || {})
          log(`关系档案：更新 ${who}（${Object.keys(args.patch || {}).join(',')}）`)
          return { ok: true, profile: next }
        } catch (e) { return { ok: false, error: String(e?.message ?? e) } }
      },
    },

    /** ⭐ 2026-10-27 P0：翻归档（一天一个 jsonl）。想不起以前聊过什么就用它，别凭印象编。 */
    {
      name: 'douyin_archive',
      description: '⭐ 翻聊天归档：按关键词或日期查以前的原话（私信+群都在这）。'
        + 'q 给关键词（子串匹配），date 给 YYYY-MM-DD；两个都不给就返回最近一天的。只读。',
      parameters: {
        q: { type: 'string', description: '关键词（子串匹配，比如「示例视频」）' },
        date: { type: 'string', description: 'YYYY-MM-DD；给了就只看那天' },
        limit: { type: 'number', description: '最多返回几条（默认 40，最多 200）' },
      },
      async execute(args = {}) {
        try {
          const rows = searchArchive(stateDir, { q: String(args.q || ''), date: String(args.date || ''), limit: Number(args.limit) || 40 })
          return { ok: true, count: rows.length, rows }
        } catch (e) { return { ok: false, error: String(e?.message ?? e) } }
      },
    },

    /**
     * ⭐ 2026-10-27 P1：关系日记（一天一篇，`memory/diary/YYYY-MM-DD.md`）。
     *   参考 dsh-world：日记是她的长期记忆，由她自己写，插件只管存取。
     */
    {
      name: 'douyin_diary',
      description: '⭐ 关系日记：op=get 读某天（默认今天）；op=write 写（默认今天，追加到末尾）；op=list 有哪些天。'
        + '写的时候用第一人称、只写大概（今天跟谁聊了什么、他的态度、我哪句回得好/不好、明天要接的话），别逐句抄原话。',
      parameters: {
        op: { type: 'string', description: 'get | write | list（默认 get）' },
        date: { type: 'string', description: 'YYYY-MM-DD，默认今天' },
        text: { type: 'string', description: 'write 时的正文（markdown，几段话）' },
      },
      async execute(args = {}) {
        const today = dayKey()
        const date = String(args.date || today)
        const op = String(args.op || 'get').toLowerCase()
        try {
          if (op === 'list') return { ok: true, dates: diaryDates(stateDir) }
          if (op === 'write') {
            const r = writeDiary(stateDir, date, String(args.text || ''))
            if (r.ok) log(`日记：已写 ${date}（${String(args.text || '').length} 字）`)
            return r
          }
          return { ok: true, date, text: readDiary(stateDir, date), dates: diaryDates(stateDir) }
        } catch (e) { return { ok: false, error: String(e?.message ?? e) } }
      },
    },

    /**
     * ⭐ 2026-10-27 A 期：她的家（值班会话）自检。
     *   op=ensure：确保会话在（create/resume 时会把 人设/我是谁/记忆索引 三段系统提示挂上）
     *   op=status：只报状态，不拉起
     */
    {
      name: 'douyin_home',
      description: '⭐ 她的家（值班会话）状态/自检：op=ensure 确保会话在（顺带把人格与记忆索引挂上），op=status 只看。'
        + '报：会话 id、人设来源（home/persona.md 还是老那份）、我是谁多少字、记忆目录在不在。不发任何消息。'
        + '（主动联系可在「她的家 → 主动联系」里开关 / 限条数 / 演练）',
      parameters: { op: { type: 'string', description: 'ensure | status（默认 status）' } },
      async execute(args = {}) {
        const op = String(args.op || 'status').toLowerCase()
        try {
          const layers = readHomePersona(personaFile)
          const info = {
            homeDir,
            personaSource: layers ? 'home/persona.md（六层）' : (existsSync(join(stateDir, 'persona.md')) ? '$DOUYIN_HOME/persona.md（三层，老那份）' : '默认中性人设'),
            personaChars: layers ? renderHomePersona(layers).length : 0,
            selfChars: readHomeSelf(selfFile).length,
            memoryDirs: ['archive', 'diary'].map((d) => ({ dir: join(stateDir, 'memory', d), exists: existsSync(join(stateDir, 'memory', d)) })),
          }
          if (op !== 'ensure') {
            const di = dutyInfo()
            return { ok: true, ...info, sessionId: di.sessionId, live: Boolean(di.live) }
          }
          const handle = await dutySessionEnsure()
          const di = dutyInfo()
          // ⚠️ live 看**这一次**拿到的 handle（跟搬家前一样）—— 不用全局 _dutyHandle，
          //    否则"上一拍还活着、这一拍拉失败"会被报成 live:true。
          return { ok: Boolean(handle?.agent), ...info, sessionId: di.sessionId, live: Boolean(handle?.agent), reason: handle?.agent ? '' : '会话没拉起来（看 duty.log）' }
        } catch (e) { return { ok: false, error: String(e?.message ?? e) } }
      },
    },

    /* ⭐ 2026-10-27 B 期：她自己的闹钟（只存一个待办，定新的替掉旧的） */
    {
      name: 'douyin_plan_next',
      description: '⭐ 给自己定下一件事（像给自己上闹钟）：到点插件会叫醒你，告诉你「定的什么、这期间发生了什么」。'
        + '参数二选一：at="11:00"（今天过了就明天）或 after_minutes=30；note 必填（要做什么）。'
        + '只存一个待办，定新的会替掉旧的。什么都不定，第二天 09:00 会兜底叫你一次。',
      parameters: {
        at: { type: 'string', description: 'HH:MM 或 ISO 时间；与 after_minutes 二选一' },
        after_minutes: { type: 'number', description: '多少分钟后（1–1440）' },
        note: { type: 'string', description: '要做什么（必填，一句话）' },
      },
      async execute(args = {}) {
        const note = String(args.note || '').trim()
        if (!note) return { ok: false, error: 'note 必填：写清到点要做什么' }
        const d = parsePlanAt({ at: args.at, after_minutes: args.after_minutes })
        if (!d) return { ok: false, error: '给 at（HH:MM 或 ISO）或 after_minutes' }
        const plan = { at: d.toISOString(), note: note.slice(0, 200), setAt: new Date().toISOString() }
        let ok = patchLife((l) => ({ ...l, plan }))
        /**
         * 🔴 2026-10-27 实测：定完计划后它可能被**另一次并发写**覆盖掉（16:05 定了 17:05，
         *   几秒后 life.json 里 plan=null）。写完立刻回读核验，没了就重写一次并留日志，
         *   别再静默吞掉她的计划。
         */
        if (ok) {
          const back = readLife()
          if (!back || !back.plan || back.plan.at !== plan.at) {
            log('她的闹钟：写完回读没看到计划（被并发写覆盖了）—— 重写一次')
            ok = patchLife((l) => ({ ...l, plan }))
          }
        }
        if (ok) log(`她的闹钟：定了 ${hhmm(d)} —— ${note.slice(0, 40)}`)
        return ok ? { ok: true, plan, local: hhmm(d) } : { ok: false, error: '写入失败（home/life.json）' }
      },
    },

    {
      name: 'douyin_check_plan',
      description: '看她给自己定的待办还在不在（只读）。',
      parameters: {},
      async execute() {
        const life = readLife()
        return { ok: true, plan: life.plan || null, lastFire: life.lastFire || null, morningFired: life.morningFired || '' }
      },
    },

    {
      name: 'douyin_cancel_plan',
      description: '取消她给自己定的待办（比如改主意了、想直接歇着）。',
      parameters: {},
      async execute() {
        const life = readLife()
        const had = life.plan || null
        patchLife((l) => ({ ...l, plan: null }))
        if (had) log(`她的闹钟：取消了（${String(had.note || '').slice(0, 30)}）`)
        return { ok: true, cancelled: had }
      },
    },

    /* ══════════════════════════════════════════════════════════════════════════
       ⭐ 2026-10-27 C 期：主动找他（reach_out）→ fish.5 起改走「主动联系」策略
       策略在 home/reach.json 的 policy（面板「她的家 → 主动联系」可改）：
         · enabled=false        关了就不主动
         · quietFrom–quietTo    免打扰时段（支持跨零点；默认 00:00–08:00）
         · limit                今天最多几条（默认 3）
         · stages               只找这些 stage（默认 熟/自己人 —— 生人不主动）
         · dryRun=true          演练：只判断，不真的发
       任何一条拒掉都会 append 到 home/reach-blocked.jsonl（失败只 log 不抛）。
       通过后照旧发，发完仍写 count/history + 私信记忆 + 发送账本。
       ══════════════════════════════════════════════════════════════════════════ */
    {
      name: 'douyin_reach_out',
      description: '⭐ 主动找他：想他了、刷到他在意的东西、或者有件事想跟他说 —— 发一条私信过去（不是回复，是你自己开口）。'
        + '护栏：只能找 stage=熟/自己人（默认 示例主人）；每天最多 3 条；免打扰时段不发。'
        + '这些限制可在「她的家 → 主动联系」里改（开关 / 演练 / 条数 / 免打扰时段）。'
        + '一两句就够，别写成汇报；发完不用再解释自己。',
      parameters: {
        text: { type: 'string', description: '要说的那一两句（纯文字，别发链接）' },
        to: { type: 'string', description: '找谁：昵称或 sec_uid；留空 = 主联系人（示例主人）' },
      },
      async execute(args = {}) {
        const text = stripBodyActions(String(args.text || '').trim())
        if (!text) return { ok: false, error: 'text 必填' }
        const policy = reachPolicy(homeDir)
        const now = new Date()
        const today = dayKey()
        /** 被策略拦下：先记 blocked（能带收件人就带上），再返回带原因的结果 */
        const blocked = (reason, rec = {}, extra = {}) => {
          try { recordBlocked(homeDir, { to: rec.to, to_id: rec.to_id, stage: rec.stage, reason }, log) } catch { /* 记不上也要拒 */ }
          log(`主动联系被拦：${reason}`)
          return { ok: false, error: reason, ...extra }
        }
        // ① 总开关
        if (policy.enabled !== true) return blocked('主动联系已关（去「她的家 → 主动联系」打开）')
        // ② 免打扰时段（支持跨零点）
        if (inQuietHours(now, policy.quietFrom, policy.quietTo)) {
          return blocked(`免打扰时段（${policy.quietFrom}–${policy.quietTo}）`)
        }
        // ③ 今日额度
        const rec = readReach(homeDir)
        const count = rec.day === today ? Number(rec.count) || 0 : 0
        if (count >= policy.limit) return blocked(`今天已经主动开口 ${count} 次（上限 ${policy.limit}），留到明天`)
        // ④ 收件人 + stage（生人不主动）
        const who = String(args.to || '').trim()
        let target = null
        try {
          const peers = dmPeersOf()
          target = who ? (peers.find((p) => p.nick === who || p.sec_uid === who) || null) : (dmPrimary() || null)
        } catch { target = null }
        if (!target?.sec_uid) return { ok: false, error: '找不到这个人（给昵称/稳定 id，或先配「私信发给谁」）' }
        const prof = loadProfileDep(stateDir, target.sec_uid)
        const stage = String(prof.stage || '生')
        if (!policy.stages.includes(stage)) {
          return blocked(`「${prof.nick || target.nick}」还是「${stage}」—— 生人不能主动找他，先聊熟了再说`,
            { to: target.nick, to_id: target.sec_uid, stage })
        }
        // ⑤ 演练模式：只判断，不真的发
        if (policy.dryRun === true) {
          return blocked('演练模式：只判断，不真的发',
            { to: target.nick, to_id: target.sec_uid, stage },
            { dryRun: true, preview: text })
        }
        // ── 通过全部策略：照旧发送 ──
        const r = await runNodeToolAsync('im-send.mjs', ['--to', target.nick, '--to-id', target.sec_uid, '--text', text], { timeout: 240_000 })
        const j = pickJson(r.stdout)
        /**
         * 🔴 2026-10-27 实测的坑：im-send 的 `readback` 靠头像左右判，**会假阴性**
         *   （这条明明进了会话，它报 false）。所以这里不信它一个人的话：
         *   ① im-send 说 sent=true 就算发过；
         *   ② 它说没发，也要用 IM 协议侧回读一次（真发出去的一定读得到），再下结论。
         */
        let sent = Boolean(j && (j.sent === true || j.ok === true))
        let readback = Boolean(j && j.readback === true)
        if (!sent) {
          try {
            const v = runPy('im-http.py', ['--read', '--peer-sec-uid', target.sec_uid, '--limit', '5'], { timeout: 20_000 })
            const vj = pickJson(v.stdout)
            const list = Array.isArray(vj?.matched?.messages) ? vj.matched.messages : []
            const probe = text.slice(0, 20)
            if (list.some((m) => String(m.text || '').includes(probe))) { sent = true; readback = true }
          } catch { /* 读不到就按没发处理 */ }
        }
        if (!sent) {
          const errText = String((j && (j.error || j.note)) || r.stderr || '发送失败').slice(0, 200)
          // ⭐ 阶段2：试过没发出去也要记账（否则控制台会以为她今天什么都没说）
          noteSentLedger({ aweme_id: '', to: target.nick, to_id: target.sec_uid, kind: 'reach', sent: false, readback, error: errText, src: 'reach' })
          // ⭐ fish.6：主动联系发送失败也进故障面板（带「怎么修」）
          fault('send', `主动联系没发出去：${errText.slice(0, 120)}（看「连接」登录态/网络；403 就等十分钟再试）`)
          return { ok: false, error: errText }
        }
        try { noteSent(stateDir, target.sec_uid, target.nick, text, 'text') } catch { /* 记忆失败不影响 */ }
        // ⭐ 阶段2：主动开口也进账本（src=reach，跟值班轮自动发的 host 区分开）
        noteSentLedger({ aweme_id: '', to: target.nick, to_id: target.sec_uid, kind: 'reach', sent: true, readback, error: '', src: 'reach' })
        unfault('send')   // ⭐ fish.6：发成功了就把 send 故障清掉
        // ⭐ fish.9：记进「待回记录」—— 他要是没回，anxiousTick 能看出来（对方回话时清掉）
        appendPending(homeDir, { at: new Date().toISOString(), to: target.nick, to_id: target.sec_uid, kind: 'text', text }, log)
        // ⭐ fish.5：额度记账仍在同一个 reach.json（保持旧字段：day/count/history）
        writeReach(homeDir, {
          day: today,
          count: count + 1,
          history: [...(Array.isArray(rec.history) ? rec.history : []), { at: new Date().toISOString(), to: target.nick, text: text.slice(0, 200) }].slice(-50),
        })
        log(`主动找他：→ ${target.nick}（今天第 ${count + 1}/${policy.limit} 次）「${text.slice(0, 40)}」`)
        touchActivity()
        return { ok: true, sent: true, to: target.nick, todayCount: count + 1, limit: policy.limit, readback }
      },
    },

    /* ══════════════════════════════════════════════════════════════════════════
       ⭐ fish.9 ④：连发（douyin_reach_burst）——「他还没回 / 想多说两句」时用
       安全上限（防账号被风控，硬性）：
         · 一次最多 3 条，每条 ≤200 字，间隔随机 3–6 秒
         · 每天所有主动消息合计 ≤ policy.limit（默认 20；跟 reach_out 共用额度）
         · 同一个人 10 分钟内不许两轮连发（看 home/pending.jsonl 的 burst 记录）
       策略检查：只检查 enabled / 生人(stages) / 额度 —— **不检查静默时段**（主人明确要自由），
       也不检查 dryRun（这条连发是"主人拍板"的动作，dryRun 只管单条 reach_out）。
       ══════════════════════════════════════════════════════════════════════════ */
    {
      name: 'douyin_reach_burst',
      description: '⭐ 连发 2–3 条（他还没回、或者想多说两句）：一次最多 3 条、每条 ≤200 字、间隔 3–6 秒；'
        + '每天所有主动消息合计 ≤20 条；同一个人 10 分钟内只能连发一轮。'
        + '想发一两句用 douyin_reach_out 就行。',
      parameters: {
        texts: {
          type: 'array',
          description: '要连发的 1–3 条（每条 ≤200 字）',
          items: { type: 'string' },
        },
        to: { type: 'string', description: '找谁：昵称或 sec_uid；留空 = 主联系人（示例主人）' },
      },
      async execute(args = {}) {
        const texts = stripBodyActionsAll((Array.isArray(args.texts) ? args.texts : []).map((t) => String(t ?? '').trim())).filter(Boolean)
        if (!texts.length) return { ok: false, error: 'texts 必填：给 1–3 条要说的话' }
        if (texts.length > 3) return { ok: false, error: '一次最多连发 3 条（防刷屏/防风控）' }
        const tooLong = texts.find((t) => t.length > 200)
        if (tooLong) return { ok: false, error: `每条最多 200 字（有一条 ${tooLong.length} 字）` }
        const policy = reachPolicy(homeDir)
        const today = dayKey()
        // ① 总开关
        if (policy.enabled !== true) return { ok: false, error: '主动联系已关（去「她的家 → 主动联系」打开）' }
        // ② 额度（每天所有主动消息合计 ≤ limit；默认 20）
        const rec = readReach(homeDir)
        const count = rec.day === today ? Number(rec.count) || 0 : 0
        if (count + texts.length > policy.limit) {
          return { ok: false, error: `今天主动消息已经 ${count} 条（上限 ${policy.limit}），这批 ${texts.length} 条发不下，留到明天` }
        }
        // ③ 收件人 + stage（生人不主动 —— 红线不动）
        const who = String(args.to || '').trim()
        let target = null
        try {
          const peers = dmPeersOf()
          target = who ? (peers.find((p) => p.nick === who || p.sec_uid === who) || null) : (dmPrimary() || null)
        } catch { target = null }
        if (!target?.sec_uid) return { ok: false, error: '找不到这个人（给昵称/稳定 id，或先配「私信发给谁」）' }
        const prof = loadProfileDep(stateDir, target.sec_uid)
        const stage = String(prof.stage || '生')
        if (!policy.stages.includes(stage)) {
          try { recordBlocked(homeDir, { to: target.nick, to_id: target.sec_uid, stage, reason: '连发：生人不主动' }, log) } catch { /* 记不上也要拒 */ }
          return { ok: false, error: `「${prof.nick || target.nick}」还是「${stage}」—— 生人不能主动找他，先聊熟了再说` }
        }
        // ④ 安全上限：同一个人 10 分钟内不许两轮连发
        const lastBurst = readPending(homeDir)
          .filter((r) => r.kind === 'burst' && (r.to_id === target.sec_uid || r.to === target.nick))
          .map((r) => Date.parse(r.at) || 0)
          .sort((a, b) => b - a)[0]
        if (Number.isFinite(lastBurst) && Date.now() - lastBurst < 10 * 60_000) {
          return { ok: false, error: '10 分钟内已经给他连发过一轮了（同一个人不许两轮连发），歇会儿再发' }
        }
        // ── 逐条发：成功一条记一条账/额度；失败就停，已发的照实算 ──
        const sentTexts = []
        const persistQuota = () => {
          if (!sentTexts.length) return
          writeReach(homeDir, {
            day: today,
            count: count + sentTexts.length,
            history: [...(Array.isArray(rec.history) ? rec.history : []), ...sentTexts.map((t) => ({ at: new Date().toISOString(), to: target.nick, text: t.slice(0, 200) }))].slice(-50),
          })
          touchActivity()
        }
        for (let i = 0; i < texts.length; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, 3000 + Math.floor(Math.random() * 3001)))   // 间隔 3–6 秒
          const r = await runNodeToolAsync('im-send.mjs', ['--to', target.nick, '--to-id', target.sec_uid, '--text', texts[i]], { timeout: 240_000 })
          const j = pickJson(r.stdout)
          let sent = Boolean(j && (j.sent === true || j.ok === true))
          const readback = Boolean(j && j.readback === true)
          if (!sent) {
            try {
              const v = runPy('im-http.py', ['--read', '--peer-sec-uid', target.sec_uid, '--limit', '5'], { timeout: 20_000 })
              const vj = pickJson(v.stdout)
              const list = Array.isArray(vj?.matched?.messages) ? vj.matched.messages : []
              const probe = texts[i].slice(0, 20)
              if (list.some((m) => String(m.text || '').includes(probe))) sent = true
            } catch { /* 读不到就按没发处理 */ }
          }
          if (!sent) {
            const errText = String((j && (j.error || j.note)) || r.stderr || '发送失败').slice(0, 200)
            noteSentLedger({ aweme_id: '', to: target.nick, to_id: target.sec_uid, kind: 'text', sent: false, readback, error: errText, src: 'reach' })
            fault('send', `连发第 ${i + 1} 条没发出去：${errText.slice(0, 120)}（看「连接」登录态/网络；403 等十分钟再试）`)
            persistQuota()
            log(`主动找他（连发）：→ ${target.nick} 第 ${i + 1} 条失败，已停（发出 ${sentTexts.length} 条）`)
            return { ok: false, sent: sentTexts.length, texts: sentTexts, todayCount: count + sentTexts.length, error: `第 ${i + 1} 条没发出去，已停：${errText}` }
          }
          sentTexts.push(texts[i])
          try { noteSent(stateDir, target.sec_uid, target.nick, texts[i], 'text') } catch { /* 记忆失败不影响 */ }
          noteSentLedger({ aweme_id: '', to: target.nick, to_id: target.sec_uid, kind: 'text', sent: true, readback, error: '', src: 'reach' })
          appendPending(homeDir, { at: new Date().toISOString(), to: target.nick, to_id: target.sec_uid, kind: 'burst', text: texts[i] }, log)
          unfault('send')
        }
        persistQuota()
        log(`主动找他（连发）：→ ${target.nick}（${sentTexts.length} 条，今天第 ${count + sentTexts.length}/${policy.limit} 条）`)
        return { ok: true, sent: sentTexts.length, texts: sentTexts, todayCount: count + sentTexts.length }
      },
    },

    /* ═══════════════════════════════════════════════════════════════════════
       ⭐ fish.10 B：在群里说话（可选 at 真 @ 某人）—— 走浏览器 im-send，发群可能不分发（7523）
       ═══════════════════════════════════════════════════════════════════════ */
    {
      name: 'douyin_group_say',
      description: '⭐ 在群里说一句（group=群名，text≤200 字）：可选 at=群友昵称 真 @ 他。'
        + '走浏览器发群（im-send --to 群名 --at 昵称）。⚠️ 网页端发群可能不分发（回执 7523）——'
        + '返回里的 warning 照实看，别当成群里人都收到了。',
      parameters: {
        group: { type: 'string', description: '群名（跟「聊天模式」里那个群一致）' },
        text: { type: 'string', description: '要说的话（≤200 字；别刷屏，一次一两句）' },
        at: { type: 'string', description: '要 @ 的群友昵称（可选；不填就是普通发言）' },
      },
      async execute(args = {}) {
        return sendGroupSay(args)
      },
    },

    /* ═══════════════════════════════════════════════════════════════════════
       ⭐ fish.14：群友分享视频 —— 两档看（>30s 且想看/@ → 3 帧；否则第 5 秒 1 帧）+
       delegate（@群聊小助手 让它总结）。summarize 保留但已停用（不接外部 AI）。
       ═══════════════════════════════════════════════════════════════════════ */
    {
      name: 'douyin_group_video',
      description: '⭐ 群友分享的视频，挑着看：action="look" 截图自己看——>30 秒且（你自己想看/有人@你）给 3 张'
        + '（10%/50%/90%），否则只有第 5 秒一张；看不清就 action="delegate" @群聊小助手 让它总结'
        + '（同一条 24 小时只喊一次）。action="summarize" 已停用（不接外部 AI），会返回提示。',
      parameters: {
        aweme_id: { type: 'string', description: '视频 id（群分享卡片里的 item / aweme_id）' },
        action: { type: 'string', enum: ['look', 'delegate', 'summarize'], description: 'look=截图看；delegate=@群聊小助手 让它总结；summarize=已停用' },
        group: { type: 'string', description: '群名（delegate 要用；look 只做日志标注）' },
        dry: { type: 'boolean', description: 'delegate 时只拼文案不发送（测试/预览用）' },
      },
      async execute(args = {}) {
        const id = String(args.aweme_id || '').trim()
        const action = String(args.action || 'look').trim().toLowerCase()
        if (!id) return { ok: false, error: 'aweme_id 必填' }
        if (!['look', 'delegate', 'summarize'].includes(action)) return { ok: false, error: 'action 只能是 look / delegate / summarize' }
        if (typeof runNodeTool !== 'function') return { ok: false, error: '缺 runNodeTool 依赖（插件里才可用）' }
        const framesDir = join(stateDir, 'out', 'frames')
        const groupArg = String(args.group || '').trim()

        if (action === 'summarize') {
          return { ...(await groupvid.summarizeVideo({ awemeId: id })), action: 'summarize', aweme_id: id }
        }

        if (action === 'look') {
          const r = groupvid.lookVideo({ homeDir, awemeId: id, framesDir, runNodeTool, log })
          log(`群视频：look ${id}${groupArg ? `（${groupArg}）` : ''} → ${r.mode}（${r.frames.length} 帧${r.at !== null ? `，第 ${r.at}s` : ''}）`)
          return {
            ok: r.ok, action: 'look', aweme_id: r.aweme_id, wants: r.wants, atMe: r.atMe,
            mode: r.mode, at: r.at, ...(r.hint ? { hint: r.hint } : {}),
            desc: r.desc, author: r.author, duration: r.duration, digg: r.digg,
            url: r.url, frames: r.frames, frameFiles: r.frameFiles,
            ...(r.errors && r.errors.length ? { errors: r.errors } : {}),
          }
        }

        /* ── action = 'delegate'：@群聊小助手 让它总结 ── */
        const dry = args.dry === true
        // 24h 去重
        if (groupvid.delegatedRecently(homeDir, id)) {
          return {
            ok: false, already: true, action: 'delegate', aweme_id: id, dry,
            reason: '这条 24 小时内已经喊过群助手了（同一条只喊一次，等它回）',
          }
        }
        const row = groupvid.findGroupVideoRow(homeDir, id) || {}
        const detail = groupvid.fetchVideoDetail({ awemeId: id, runNodeTool, log })
        const group = groupArg || String(row.group || '').trim()
        let assistant = '群聊小助手'
        try {
          const gp = readSettings(homeDir).groupPatrol || {}
          if (String(gp.groupAssistantName || '').trim()) assistant = String(gp.groupAssistantName).trim()
        } catch { /* 设置读不到就用默认 */ }
        const text = groupvid.renderDelegateText({
          shareUrl: detail.url || `https://www.douyin.com/video/${encodeURIComponent(id)}`,
          desc: row.text || detail.desc || '',
          assistant,
        })
        if (dry) {
          groupvid.markDelegated(homeDir, id)   // dry 也记，第二次 dry 会返回 already
          return { ok: true, action: 'delegate', aweme_id: id, dry: true, text, at: assistant, mention: 'dry（没发）', group: group || null }
        }
        if (!group) return { ok: false, error: 'delegate 需要 group（群名）', action: 'delegate', aweme_id: id, text, at: assistant }
        const sent = await sendGroupSay({ group, text, at: assistant })
        if (sent.ok) groupvid.markDelegated(homeDir, id)
        log(`群视频：delegate ${id} → ${sent.ok ? 'ok' : '失败'}（@${assistant}${sent.mention ? `，${sent.mention}` : ''}）`)
        return {
          ...sent,
          action: 'delegate', aweme_id: id, dry: false, text, at: assistant, group,
          ...(sent.ok ? {} : { error: sent.error || '发群失败' }),
        }
      },
    },

    /* ⭐ 2026-10-27 家：她自己的活动台账（比插件记账更细，也是她对账用的一半） */
    {
      name: 'douyin_note_activity',
      description: '⭐ 记一行「我刚做了什么」到你的活动台账（home/journal.jsonl）。'
        + '做了什么值得记一句：翻了几天的档案、补了谁的印象、写了一篇日记、刷了一轮、把某条视频发给了主人。'
        + '不用长，一行就够；这既是你的日记素材，也是叫醒时对账用的。',
      parameters: { text: { type: 'string', description: '一行话，比如「翻了三天的档案，把示例好友的喜好补上了」' } },
      async execute(args = {}) {
        const t = String(args.text || '').trim()
        if (!t) return { ok: false, error: 'text 必填' }
        noteActivity(t)
        log(`她的台账：${t.slice(0, 50)}`)
        return { ok: true, logged: t.slice(0, 300), file: journalFile }
      },
    },
  ]
}

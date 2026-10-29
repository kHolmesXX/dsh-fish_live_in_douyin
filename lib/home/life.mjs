/**
 * lib/home/life.mjs —— 她的节奏：life.json / 闹钟 / 叫醒词（2026-10-27 阶段 3b 外移）
 * ============================================================================
 * 从 index.js 原样搬出来的纯逻辑，**不依赖 ctx / 宿主**（投递与定时器留在 index.js）。
 *
 *   readLife(file) / writeLife(file, v) / patchLife(file, fn)
 *   parsePlanAt({at, after_minutes})    at="11:00"（今天过了就明天）或 ISO；after_minutes 相对
 *   hhmm(d)                            Date → "HH:MM"（本地）
 *   didSince({logFile, journalFile, sinceIso, hhmm})
 *                                      两栏对账：插件从 duty.log 数（转达几条/跑了几轮）；
 *                                      她自己记的从 home/journal.jsonl 数。
 *   renderPlanWakeText({plan, morning, now, roomDir, didSince})
 *                                      到点叫醒 / 09:00 兜底叫醒的词（morning 那句要报房间路径）
 *   renderIdleInvite({now, roomDir})   空闲邀请的词（09:00–22:00，三小时没动）
 *
 * ⚠️ 只搬纯 helper —— `lifeTick`（定时器 + deliverToDutyFish 投递）留在 index.js。
 * ============================================================================
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 读 life.json（读不到/坏文件 ⇒ {}；BOM 先剥再 parse，跟 lib/state.mjs 的 readJson 同口径）。 */
export function readLife(file) {
  try {
    const raw = readFileSync(file, 'utf8')
    return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
  } catch { return {} }
}

/** 写 life.json（缩进 1，保持原格式；建父目录；失败返回 false 不抛）。 */
export function writeLife(file, value) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(value, null, 1), 'utf8')
    return true
  } catch { return false }
}

/**
 * 🔴 2026-10-27 实测的竞态：`lifeTick` 先读 life → await 投递（几秒）→ 再把读到的旧快照写回去。
 *   就在这几秒里，她可能刚用 douyin_plan_next 定了下一件 ⇒ 被旧快照覆盖，计划**静默丢失**。
 *   ⇒ 所有写 life 的地方一律「写之前重读一遍再合并」，不拿 await 之前的对象写回。
 */
export function patchLife(file, fn) {
  try {
    const cur = readLife(file)
    const next = fn({ ...cur }) || cur
    return writeLife(file, next)
  } catch { return false }
}

/** Date → "HH:MM"（本地） */
export function hhmm(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** at 支持 "HH:MM"（今天已过就明天）或 ISO；after_minutes 直接算相对时间。 */
export function parsePlanAt({ at, after_minutes } = {}) {
  const mins = Number(after_minutes)
  if (Number.isFinite(mins) && mins > 0) return new Date(Date.now() + Math.min(mins, 24 * 60) * 60_000)
  const s = String(at || '').trim()
  if (!s) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (m) {
    const d = new Date()
    d.setHours(Number(m[1]), Number(m[2]), 0, 0)
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
    return d
  }
  const t = new Date(s)
  return Number.isNaN(t.getTime()) ? null : t
}

/** 台账里自从 sinceIso 之后的条目（最多 limit 条）。读不到 ⇒ []。 */
function readJournalSince(file, iso, limit = 20) {
  const from = Date.parse(iso || '')
  try {
    const rows = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    const hit = Number.isFinite(from) ? rows.filter((r) => Date.parse(r.at) >= from) : rows
    return hit.slice(-limit)
  } catch { return [] }
}

/**
 * 这期间发生了什么 —— 两栏对账：
 *   ① 插件这块：从 duty.log 数（转达几条、跑了几轮），不听她说；
 *   ② 她自己记的：home/journal.jsonl 里这段时间的条目（她用 douyin_note_activity 写的）。
 * @param {{logFile:string, journalFile:string, sinceIso?:string, hhmm?:Function}} opt
 */
export function didSince({ logFile, journalFile, sinceIso, hhmm: hhmmFn } = {}) {
  const fmt = typeof hhmmFn === 'function' ? hhmmFn : hhmm
  const from = Date.parse(sinceIso || '')
  let relays = 0, rounds = 0
  if (Number.isFinite(from)) {
    try {
      const lines = readFileSync(logFile, 'utf8').trim().split('\n').slice(-400)
      for (const l of lines) {
        const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/.exec(l)
        if (!m) continue
        const t = Date.parse(m[1])
        if (!Number.isFinite(t) || t < from) continue
        if (l.includes('自动转达')) relays += 1
        if (l.includes('刷抖音开跑')) rounds += 1
      }
    } catch { /* 读不到就不说 */ }
  }
  const bits = []
  const mineBits = []
  if (relays) mineBits.push(`转达了 ${relays} 次私信/群消息`)
  if (rounds) mineBits.push(`跑了 ${rounds} 轮值班`)
  if (mineBits.length) bits.push(`插件这块：${mineBits.join('、')}`)
  const mine = readJournalSince(journalFile, sinceIso, 12).map((r) => {
    const when = fmt(new Date(r.at))
    // ⭐ fish.7 C：自动台账的行没有 text，只有 {auto,tool,summary} —— 读成人话
    if (r.auto) {
      const tool = String(r.tool || '工具').slice(0, 30)
      const sum = String(r.summary || '').slice(0, 24)
      return `${when} 调了 ${tool}${sum ? `（${sum}）` : ''}`
    }
    return `${when} ${String(r.text || '')}`
  }).filter((s) => s.trim())
  if (mine.length) bits.push(`你自己记的：${mine.join('；')}`)
  return bits.length ? bits.join('。') : '没什么事发生'
}

/**
 * 到点叫醒 / 09:00 兜底叫醒的词。
 * @param {{plan?:object|null, morning?:boolean, now?:Date, roomDir?:string, didSince?:Function}} opt
 *        didSince(iso) ⇒ 这期间发生了什么（它读 duty.log，index.js 注入）
 */
export function renderPlanWakeText({ plan, morning = false, now = new Date(), roomDir = '', didSince: didSinceFn } = {}) {
  const between = typeof didSinceFn === 'function' ? didSinceFn : () => '没什么事发生'
  if (morning) {
    return [
      `【我的时间】早上好，现在 ${hhmm(now)}。今天还没给自己定事。`,
      `想定一件就用 \`douyin_plan_next\`（at="11:00" 或 after_minutes=30，note 写要做什么）；不想定就歇着——明天 ${hhmm(now)} 我还会再叫你。`,
      `你的房间在 ${roomDir}，随便用；想做点自己的事随时可以。`,
      `（这条不是主人在说话，是你自己的闹钟。）`,
    ].join('\n')
  }
  const setAt = plan?.setAt ? new Date(plan.setAt) : null
  const span = setAt ? ((Date.now() - setAt.getTime()) / 3600_000).toFixed(1) : ''
  return [
    `【我的时间】你给自己定的时间到了：${String(plan?.note || '（没写要做什么）').slice(0, 120)}`,
    setAt ? `定于 ${hhmm(setAt)}${span ? `，到现在 ${span} 小时` : ''}。` : '',
    `这期间发生的事：${between(plan?.setAt)}。`,
    `现在 ${hhmm(now)}。接着做、换一件、还是歇着，你自己定；想定下一件就 \`douyin_plan_next\`。`,
    `（这条不是主人在说话，是你自己的闹钟。）`,
  ].filter(Boolean).join('\n')
}

/**
 * 空闲 / 定点自由时间的邀请（fish.7 A：定点也复用它）——清单式「你可以做什么」，
 * 末尾「今天你已经：…」来自 didSince（含 C 的自动台账）。对齐 dsh-world 的 self-drive 提示。
 * @param {{now?:Date, roomDir?:string, didSinceText?:string}} opt
 */
export function renderIdleInvite({ now = new Date(), roomDir = '', didSinceText = '' } = {}) {
  void roomDir
  return [
    `【我的时间】现在 ${hhmm(now)}，接下来的时间是自己的。`,
    '你可以（挑一件，也可以什么都不做）：',
    '· 去房间随便弄点什么（建个文件、写张清单、整理一下）',
    '· 写点日记草稿 / 翻某天的归档看看那时候说过什么',
    '· 给谁补一条印象（memory/profile-*.json）',
    '· 给主人准备一句想说的话（想发就 douyin_reach_out，每天 3 条）',
    '· 挑一条你觉得他会喜欢的视频，用分享卡片发给他',
    '· 学点新东西：翻翻评论、记一个新梗',
    `今天你已经：${didSinceText || '（还没记）'}`,
  ].join('\n')
}

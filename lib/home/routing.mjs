/**
 * lib/home/routing.mjs —— 分流模式的**主机侧硬约束**（2026-10-28 fish.20）
 * ============================================================================
 * 主人在 duty.md 定的分流：擦边 → 私信卡片；其它类 → 看标题，能懂就评论区 @，
 * 看不懂就 @豆包 等它总结，值得才 @。提示词只是"让模型想这么干"，
 * 这里放**拦得住**的硬约束：
 *   · 评论区 @ 每天最多 10 条（2026-10-28 主人改口径；`home/comment-ats.json`，跨天清零）
 *   · 同一条视频只 @ 一次（awemes 去重）
 *   · 同一条视频**不能既发卡片又 @**（alreadySharedCard 读 `home/sent.jsonl`）
 *   · 兴趣账本下发（topKeywords / 最近 liked）——「其它类」是否值得 @ 以它为准
 * ============================================================================
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const COMMENT_AT_CAP = 10
export const CARD_LOOKBACK_DAYS = 7

export const commentAtsFile = (homeDir) => join(String(homeDir || ''), 'comment-ats.json')
export const sentFile = (homeDir) => join(String(homeDir || ''), 'sent.jsonl')

const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}
const readJsonSafe = (file) => { try { return JSON.parse(stripBom(readFileSync(file, 'utf8'))) } catch { return null } }

export function dayKey(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

function writeAtomic(file, value) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`, 'utf8')
    try { renameSync(tmp, file) } catch {
      try { renameSync(tmp, file) } catch (e) {
        try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
        throw e
      }
    }
    return true
  } catch { return false }
}

/** 空的当天结构 */
export function emptyCommentAts(now = new Date()) {
  return { day: dayKey(now), n: 0, awemes: [] }
}

/**
 * 读计数；坏 JSON / 旧格式自愈成空结构；不是今天 ⇒ 视为跨天清零（不立刻写盘）。
 * @returns {{day:string,n:number,awemes:string[]}}
 */
export function readCommentAts(homeDir, now = new Date()) {
  const file = commentAtsFile(homeDir)
  const today = dayKey(now)
  const j = readJsonSafe(file)
  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    const fresh = emptyCommentAts(now)
    // 坏 JSON（或没有文件）⇒ 自愈成空结构，别让一轮全挂
    writeAtomic(file, fresh)
    return fresh
  }
  const day = typeof j.day === 'string' && j.day ? j.day : today
  const n = Math.max(0, Math.trunc(Number(j.n) || 0))
  const awemes = (Array.isArray(j.awemes) ? j.awemes : []).map(String).filter(Boolean)
  if (day !== today) return { day: today, n: 0, awemes: [] }
  return { day: today, n, awemes: [...new Set(awemes)] }
}

/** 今天已经 @ 了几条 */
export function commentAtCount(homeDir, now = new Date()) {
  return readCommentAts(homeDir, now).n
}

/**
 * 能不能再发一条评论区 @。硬约束：每天 ≤cap 条；同一条视频只 @ 一次。
 * @returns {{ok:boolean, reason?:'cap'|'dup', n:number, remaining:number, aweme:string}}
 */
export function canCommentAt(homeDir, { aweme = '', cap = COMMENT_AT_CAP, now = new Date() } = {}) {
  const id = String(aweme || '').trim()
  const cur = readCommentAts(homeDir, now)
  const remaining = Math.max(0, Math.max(0, Math.trunc(Number(cap) || COMMENT_AT_CAP)) - cur.n)
  // 先判「同视频已 @」再判总量：这样满额时也如实告诉她是"这条已经 @ 过"
  if (id && cur.awemes.includes(id)) return { ok: false, reason: 'dup', n: cur.n, remaining, aweme: id }
  if (cur.n >= (Number(cap) || COMMENT_AT_CAP)) return { ok: false, reason: 'cap', n: cur.n, remaining: 0, aweme: id }
  return { ok: true, n: cur.n, remaining, aweme: id }
}

/** 记一条成功的 @（只该在 verified / readback visible 之后调） */
export function recordCommentAt(homeDir, { aweme = '', now = new Date() } = {}) {
  const id = String(aweme || '').trim()
  const cur = readCommentAts(homeDir, now)
  const next = {
    day: dayKey(now),
    n: cur.n + 1,
    awemes: [...new Set([...cur.awemes, ...(id ? [id] : [])])],
  }
  writeAtomic(commentAtsFile(homeDir), next)
  return next
}

/* ───────────────────── 同一条视频是否已经发过卡片 ───────────────────── */

const parseTime = (s) => {
  const t = Date.parse(String(s || ''))
  return Number.isFinite(t) ? t : 0
}

/**
 * 读 `home/sent.jsonl`：这条视频是否已经私信（卡片/文字）发过。
 * 规则：aweme_id 匹配 && sent!==false && kind 属于发送记录（card/reason/text/comment 不算）；
 *       给了 days>0 时只看最近 days 天（time 解析不出来的按"算"处理，宁可拦）。
 * @returns {object|null} 命中的发送记录
 */
export function alreadySharedCard(homeDir, aweme, { days = CARD_LOOKBACK_DAYS, now = new Date() } = {}) {
  const id = String(aweme || '').trim()
  if (!id) return null
  const cutoff = days > 0 ? now.getTime() - days * 86_400_000 : 0
  let text = ''
  try { text = readFileSync(sentFile(homeDir), 'utf8') } catch { return null }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let row = null
    try { row = JSON.parse(line) } catch { continue }
    if (!row || String(row.aweme_id || '') !== id) continue
    if (row.sent === false) continue
    const kind = String(row.kind || '')
    if (kind === 'comment') continue   // 评论不算"私信发过"
    const t = parseTime(row.at)
    if (days > 0 && t && t < cutoff) continue
    return row
  }
  return null
}

/* ───────────────────── 提示词片段 ───────────────────── */

/**
 * 分流规则（写进 duty 提示词）。返回纯文本，方便单测。
 * caps 与 routing 里的常量保持一致，避免"提示词说 2 条、主机放 3 条"。
 */
export function renderRoutingRules() {
  return [
    '🔀 **分流（先看画面再决定用什么通道）**：',
    '   擦边 / 美女 / 颜值类 → **私信发卡片**（`douyin_share_card`，不 @）。',
    '   其它类（范围**由兴趣账本动态决定**，不限于知识/科普）→ 只看标题、不多截帧：',
    '     · 标题能看懂 → 评论区 @他一句「这条我觉得你会感兴趣：…」（`douyin_comment_mention`）',
    '     · 标题看不懂 → 评论区 @豆包 让它总结（`douyin_ask_doubao`，**异步，发完立刻返回，不要等**）→',
    '       等下次被叫醒看到「豆包回你了」→ 判断他喜不喜欢 → 值得才 @他',
    '     · 都不值得 → 不发',
    '   硬上限（主机也会拦，别试）：',
    `   · 私信卡片每轮 3–7 条（保持现状）`,
    `   · 评论区 @ 每天最多 ${COMMENT_AT_CAP} 条（含 @豆包 前的判断流程；没核实到不算）`,
    '   · 同一条视频只 @ 一次；**同一条视频不要既发卡片又 @**',
    '   · @ 失败**不许降级**发普通评论（那是刷屏）；如实写报告',
  ].join('\n')
}

/**
 * 兴趣账本片段（动态）：「其它类」是否值得 @ 以它为准。
 * @param {{topKeywords?:Array<{word:string,score:number}>, recentLiked?:Array<{desc?:string,keywords?:string[],at?:string}>}} data
 */
export function renderInterestBrief({ topKeywords = [], recentLiked = [] } = {}) {
  try {
    const kws = (Array.isArray(topKeywords) ? topKeywords : [])
      .map((k) => String((k && k.word) || k || '').trim()).filter(Boolean).slice(0, 8)
    const liked = (Array.isArray(recentLiked) ? recentLiked : [])
      .map((x) => {
        const desc = String((x && x.desc) || '').trim()
        const ks = Array.isArray(x && x.keywords) ? x.keywords.map(String).filter(Boolean) : []
        return [desc, ks.length ? `（${ks.join('/')}）` : ''].join('').trim()
      }).filter(Boolean).slice(0, 3)
    if (!kws.length && !liked.length) return '主人兴趣账本（动态）：还没有账本 —— 按中性判断，别硬猜。'
    const lines = ['主人兴趣账本（动态）——「其它类」值不值得 @ 他，**以这里为准**：']
    if (kws.length) lines.push(`· 关键词偏好（score 高→低）：${kws.join('、')}`)
    if (liked.length) lines.push(`· 最近喜欢（${liked.length} 条）：${liked.join('；')}`)
    return lines.join('\n')
  } catch {
    return '主人兴趣账本（动态）：还没有账本 —— 按中性判断，别硬猜。'
  }
}

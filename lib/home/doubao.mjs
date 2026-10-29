/**
 * lib/home/doubao.mjs —— @豆包 异步提问（2026-10-28 fish.19）
 * ============================================================================
 * 为什么异步：mention-ui 发 @ 评论后豆包不一定马上回（可能审核/延迟），不能卡在工具里等。
 *   · douyin_ask_doubao 发完立刻返回，写一条 pending 到 `home/doubao-asks.jsonl`
 *   · doubaoRepliesTick（lifeTick 30s 那套）去互动消息里找豆包的回复，命中了才叫醒她
 *
 * 文件 `home/doubao-asks.jsonl`，一行一条：
 *   { at, aweme_id, question, status:'pending'|'replied'|'expired', reply_text, reply_at }
 * 节流状态：`home/doubao-watch.json` = {lastAt}
 *
 * 护栏（工具里用）：
 *   · 每天最多 2 次；同一视频只问一次；世界关着不发。
 *   · pending 超 2 小时 ⇒ expired（只 log，不叫醒）。
 * ============================================================================
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 豆包的 uid（Lead 实测给的值；昵称也会匹配「豆包」） */
export const DOUBAO_UID = '1994962122842643'
export const DOUBAO_MAX_PER_DAY = 2
export const DOUBAO_EXPIRE_MS = 2 * 3_600_000

/** settings.doubaoWatch 默认值 */
export const DEFAULT_DOUBAO_WATCH = { enabled: true, everyMin: 8 }

export const asksFile = (homeDir) => join(String(homeDir || ''), 'doubao-asks.jsonl')
export const watchStateFile = (homeDir) => join(String(homeDir || ''), 'doubao-watch.json')

const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}
const readJsonSafe = (file) => { try { return JSON.parse(stripBom(readFileSync(file, 'utf8'))) } catch { return null } }
const localDay = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function normalizeDoubaoWatch(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const n = Number(src.everyMin)
  return {
    enabled: src.enabled !== false,
    everyMin: Number.isFinite(n) ? Math.max(1, Math.min(Math.trunc(n), 1440)) : DEFAULT_DOUBAO_WATCH.everyMin,
  }
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

/* ───────────────────── asks jsonl ───────────────────── */

/** 读所有提问（坏行跳过） */
export function readAsks(homeDir) {
  const out = []
  let text = ''
  try { text = readFileSync(asksFile(homeDir), 'utf8') } catch { return out }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (!r || typeof r !== 'object') continue
      out.push({
        at: String(r.at || ''),
        aweme_id: String(r.aweme_id || ''),
        question: String(r.question || ''),
        status: ['pending', 'replied', 'expired'].includes(String(r.status)) ? String(r.status) : 'pending',
        reply_text: String(r.reply_text || ''),
        reply_at: String(r.reply_at || ''),
      })
    } catch { /* 坏行跳过 */ }
  }
  return out
}

/** 追加一条 pending（写失败只 log） */
export function appendAsk(homeDir, row = {}, log) {
  try {
    const file = asksFile(homeDir)
    mkdirSync(dirname(file), { recursive: true })
    const line = JSON.stringify({
      at: String(row.at || new Date().toISOString()),
      aweme_id: String(row.aweme_id || ''),
      question: String(row.question || ''),
      status: 'pending',
      reply_text: '',
      reply_at: '',
    })
    appendFileSync(file, `${line}\n`, 'utf8')
    return true
  } catch (e) {
    try { log?.(`豆包提问记录写不进去：${e?.message ?? e}`) } catch { /* ignore */ }
    return false
  }
}

/** 改某条（按 aweme_id 找最后一条）；返回更新后的行 | null */
export function updateAsk(homeDir, awemeId, patch = {}, log) {
  try {
    const id = String(awemeId || '').trim()
    const rows = readAsks(homeDir)
    let idx = -1
    for (let i = rows.length - 1; i >= 0; i--) if (String(rows[i].aweme_id) === id) { idx = i; break }
    if (idx < 0) return null
    rows[idx] = { ...rows[idx], ...patch, aweme_id: id }
    const file = asksFile(homeDir)
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8')
    try { renameSync(tmp, file) } catch {
      try { renameSync(tmp, file) } catch (e) {
        try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
        throw e
      }
    }
    return rows[idx]
  } catch (e) {
    try { log?.(`豆包提问更新失败：${e?.message ?? e}`) } catch { /* ignore */ }
    return null
  }
}

/** 今天已经问了几次 */
export function asksToday(homeDir, now = new Date()) {
  const day = localDay(now)
  return readAsks(homeDir).filter((r) => r.at && localDay(new Date(r.at)) === day).length
}

/** 这条视频是否问过（任何状态都算，同一视频只问一次） */
export function alreadyAsked(homeDir, awemeId) {
  const id = String(awemeId || '').trim()
  if (!id) return null
  const rows = readAsks(homeDir)
  for (let i = rows.length - 1; i >= 0; i--) if (String(rows[i].aweme_id) === id) return rows[i]
  return null
}

/** pending 超 2 小时 ⇒ expired（返回被标过期的行；只 log，不叫醒） */
export function expirePending(homeDir, { now = new Date(), log } = {}) {
  const expired = []
  for (const r of readAsks(homeDir)) {
    if (r.status !== 'pending') continue
    const t = Date.parse(r.at)
    if (!Number.isFinite(t)) continue
    if (now.getTime() - t < DOUBAO_EXPIRE_MS) continue
    const updated = updateAsk(homeDir, r.aweme_id, { status: 'expired' }, log)
    if (updated) {
      expired.push(updated)
      try { log?.(`豆包回复：${r.aweme_id} 超 2 小时没等到，已过期`) } catch { /* ignore */ }
    }
  }
  return expired
}

/* ───────────────────── 匹配豆包回复 ───────────────────── */

/** 这条互动通知是不是豆包发的（昵称含「豆包」或 uid 匹配） */
export function isDoubaoItem(item) {
  const u = item && typeof item === 'object' ? item : {}
  const nick = String(u.nickname || '')
  if (nick.includes('豆包')) return true
  if (String(u.uid || '') === DOUBAO_UID) return true
  return false
}

/** 是不是「回复/艾特」类通知（readAtMe 的 kind） */
export function isReplyKind(item) {
  const kind = String((item && item.kind) || '')
  return kind === '回复了我的评论' || kind === '@ 了我'
}

/**
 * 从互动通知里找豆包对某个 pending 提问的回复。
 * @param {Array} pending readAsks 里 status=pending 的行
 * @param {Array} atMeList readAtMe().list
 * @returns {{ask:object, item:object}|null}
 */
export function matchPendingReply(pending = [], atMeList = []) {
  const asks = (Array.isArray(pending) ? pending : []).filter((r) => r && r.status === 'pending')
  if (!asks.length) return null
  for (const it of Array.isArray(atMeList) ? atMeList : []) {
    if (!it || typeof it !== 'object') continue
    if (!isDoubaoItem(it) || !isReplyKind(it)) continue
    const aweme = String(it.aweme_id || '')
    if (!aweme) continue
    const ask = asks.find((r) => String(r.aweme_id) === aweme)
    if (ask) return { ask, item: it }
  }
  return null
}

/** 豆包回复的叫醒词（照 Lead 定的文案） */
export function renderDoubaoWake({ awemeId = '', replyText = '', ownerNick = '主人' } = {}) {
  return [
    `【豆包回你了】视频 ${awemeId} 的评论里，豆包回复：「${String(replyText || '').slice(0, 200)}」`,
    `如果这条值得让主人看，就用 douyin_comment_reply mode:"ui"（mention_name="${String(ownerNick || '主人')}"）在评论区 @ 他，`,
    '正文用一句话说清「这视频讲了什么 + 为什么他会感兴趣」；不值得就别发。',
  ].join('\n')
}

/* ───────────────────── 节流状态 ───────────────────── */

export function readWatchState(homeDir) {
  const j = readJsonSafe(watchStateFile(homeDir))
  return { lastAt: typeof (j && j.lastAt) === 'string' ? j.lastAt : '' }
}

export function writeWatchState(homeDir, patch = {}) {
  const cur = readWatchState(homeDir)
  return writeAtomic(watchStateFile(homeDir), { ...cur, ...(patch && typeof patch === 'object' ? patch : {}) })
}

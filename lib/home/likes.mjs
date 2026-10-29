/**
 * lib/home/likes.mjs —— 她自己双击点赞的台账 + 护栏（2026-10-28 fish.21）
 * ============================================================================
 * 文件：`$DOUYIN_HOME/home/likes.jsonl`，一行一次尝试：
 *   { at, aweme_id, why, via:'ui'|'api', ok:boolean }
 *   · ok:true 的行 = 真赞了（同一条视频永久只赞一次）
 *   · ok:false 的行 = 一次失败尝试（同一天同一条最多 2 次，别硬刷）
 * 每天上限来自 `settings.likes = { enabled, perDay:10, perRun:5 }`。
 *
 * 这个模块只做纯逻辑（读/写/计数/拦截/请求构造），真正点 UI 在 tools/like-ui.mjs。
 * ============================================================================
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const DEFAULT_LIKES = { enabled: true, perDay: 10, perRun: 5 }
/** 同一条视频同一天最多尝试几次（失败重试用） */
export const LIKE_ATTEMPT_MAX = 2
export const PER_DAY_MAX = 50
/** 面板「每轮上限」范围是 1–20（fish.22）；工具侧也按这个上限收（否则面板存 20 会被夹回 10） */
export const PER_RUN_MAX = 20

export const likesFile = (homeDir) => join(String(homeDir || ''), 'likes.jsonl')

const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}
export const dayKey = (now = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** settings.likes 归一化（坏值夹范围；缺省 enabled+10/5） */
export function normalizeLikeSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const perDay = Math.max(1, Math.min(Math.trunc(Number(src.perDay) || DEFAULT_LIKES.perDay), PER_DAY_MAX))
  const perRun = Math.max(1, Math.min(Math.trunc(Number(src.perRun) || DEFAULT_LIKES.perRun), PER_RUN_MAX))
  return { enabled: src.enabled !== false, perDay, perRun: Math.min(perRun, perDay) }
}

/** 读台账（坏行跳过、不抛） */
export function readLikes(homeDir) {
  let text = ''
  try { text = readFileSync(likesFile(homeDir), 'utf8') } catch { return [] }
  const out = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(stripBom(line))
      if (!r || typeof r !== 'object') continue
      out.push({
        at: String(r.at || ''),
        aweme_id: String(r.aweme_id || ''),
        why: String(r.why || ''),
        via: String(r.via || ''),
        ok: r.ok === true,
      })
    } catch { /* 坏行跳过 */ }
  }
  return out
}

/** 追加一行尝试记录（写失败只 log，不影响点赞本身） */
export function appendLike(homeDir, row = {}, log) {
  try {
    const file = likesFile(homeDir)
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify({
      at: String(row.at || new Date().toISOString()),
      aweme_id: String(row.aweme_id || ''),
      why: String(row.why || '').slice(0, 200),
      via: String(row.via || ''),
      ok: row.ok === true,
    })}\n`, 'utf8')
    return true
  } catch (e) {
    try { log?.(`点赞台账写不进去：${e?.message ?? e}`) } catch { /* ignore */ }
    return false
  }
}

/** 今天成功点赞了几条（只算 ok:true） */
export function likesToday(homeDir, now = new Date()) {
  const day = dayKey(now)
  return readLikes(homeDir).filter((r) => r.ok && r.at && dayKey(new Date(r.at)) === day).length
}

/** 这条视频是否已经赞过（成功过就永久算赞过） */
export function likedBefore(homeDir, awemeId) {
  const id = String(awemeId || '').trim()
  if (!id) return null
  const rows = readLikes(homeDir)
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].aweme_id === id && rows[i].ok) return rows[i]
  return null
}

/** 今天对这条视频尝试过几次（失败重试预算） */
export function attemptsToday(homeDir, awemeId, now = new Date()) {
  const id = String(awemeId || '').trim()
  const day = dayKey(now)
  return readLikes(homeDir).filter((r) => r.aweme_id === id && r.at && dayKey(new Date(r.at)) === day).length
}

/**
 * 能不能赞这条（硬拦截）。
 * @returns {{ok:boolean, reason?:'off'|'bad'|'dup'|'attempts'|'cap', count:number, remaining:number, attempts:number}}
 */
export function canLike(homeDir, { aweme_id = '', settings = DEFAULT_LIKES, now = new Date() } = {}) {
  const id = String(aweme_id || '').trim()
  const st = normalizeLikeSettings(settings)
  const count = likesToday(homeDir, now)
  const remaining = Math.max(0, st.perDay - count)
  const attempts = id ? attemptsToday(homeDir, id, now) : 0
  if (!id) return { ok: false, reason: 'bad', count, remaining, attempts, error: '缺 aweme_id' }
  if (!st.enabled) return { ok: false, reason: 'off', count, remaining, attempts, error: '点赞开关关着（settings.likes.enabled=false）' }
  if (likedBefore(homeDir, id)) return { ok: false, reason: 'dup', count, remaining, attempts, error: '这条已经赞过了（同一条视频只赞一次）' }
  if (attempts >= LIKE_ATTEMPT_MAX) {
    return { ok: false, reason: 'attempts', count, remaining, attempts, error: `这条今天已经试过 ${attempts} 次了（失败两次就放弃，别硬刷）` }
  }
  if (count >= st.perDay) return { ok: false, reason: 'cap', count, remaining: 0, attempts, error: `今天已经点赞 ${count} 条了（每天最多 ${st.perDay} 条）` }
  return { ok: true, count, remaining, attempts, perDay: st.perDay }
}

/* ───────────────────── API 兜底：点赞请求构造（纯函数，可单测） ───────────────────── */

/** 网页版公共参数（跟 comment-api.mjs 同一套） */
export const WEB_COMMON = {
  device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web',
  pc_client_type: '1', version_code: '190500', version_name: '19.5.0',
  cookie_enabled: 'true', screen_width: '1920', screen_height: '1080',
  browser_language: 'zh-CN', browser_platform: 'Win32',
  browser_name: 'Chrome', browser_version: '141.0.0.0',
  engine_name: 'Blink', engine_version: '141.0.0.0',
  os_name: 'Windows', os_version: '10', platform: 'PC',
}

export const DIGG_PATH = '/aweme/v1/web/commit/item/digg/'

/**
 * 构造点赞 API 的相对 URL（页面上下文 fetch 时由抖音页面自己的签名器补 a_bogus/签名）。
 * @returns {string} `/aweme/v1/web/commit/item/digg/?device_platform=…&aweme_id=…&type=1`
 */
export function buildDiggUrl(awemeId, common = WEB_COMMON) {
  const p = { ...WEB_COMMON, ...(common && typeof common === 'object' ? common : {}), aweme_id: String(awemeId || ''), type: '1' }
  const qs = Object.keys(p).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(p[k])}`).join('&')
  return `${DIGG_PATH}?${qs}`
}

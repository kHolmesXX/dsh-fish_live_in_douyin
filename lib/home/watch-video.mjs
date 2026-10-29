/**
 * lib/home/watch-video.mjs —— 「看懂视频」的限额台账 + 护栏（2026-10-28 fish.25）
 * ============================================================================
 * 需求：主人给她分享视频时，她要能真的**看**这个视频（抽帧看图），
 *   以后能回答「这视频讲了什么」。抽帧/图版交给 tools/vw-watch.mjs（video-watch-plus）。
 *
 * 文件：`$DOUYIN_HOME/home/watch-video.jsonl`，一行一次尝试：
 *   { at, aweme_id, ok }
 * 护栏（settings.watchVideo）：
 *   · enabled  开关（默认 true）
 *   · perDay   每天最多看几条（默认 10，夹 1–50）
 *
 * 这个模块只做纯逻辑；真正抽帧的是 tools/vw-watch.mjs。
 * ============================================================================
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const DEFAULT_WATCH_VIDEO = { enabled: true, perDay: 10 }
export const PER_DAY_MAX = 50
/** 每次最多给模型几张帧图（图版之外单看的那些）—— 太多会烧 token，太少会看不全 */
export const FRAME_HINT_MAX = 12

export const watchFile = (homeDir) => join(String(homeDir || ''), 'watch-video.jsonl')

const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}
export const dayKey = (now = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** settings.watchVideo 归一化（坏值夹范围；缺省 enabled + 10 条/天） */
export function normalizeWatchSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const perDay = Math.max(1, Math.min(Math.trunc(Number(src.perDay) || DEFAULT_WATCH_VIDEO.perDay), PER_DAY_MAX))
  return { enabled: src.enabled !== false, perDay }
}

/** 读台账（坏行跳过、不抛） */
export function readWatchRows(homeDir) {
  let text = ''
  try { text = readFileSync(watchFile(homeDir), 'utf8') } catch { return [] }
  const out = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(stripBom(line))
      if (!r || typeof r !== 'object') continue
      out.push({
        at: String(r.at || ''),
        aweme_id: String(r.aweme_id || ''),
        ok: r.ok === true,
      })
    } catch { /* 坏行跳过 */ }
  }
  return out
}

/** 追加一行尝试记录（写失败只 log，不影响看视频本身） */
export function appendWatch(homeDir, row = {}, log) {
  try {
    const file = watchFile(homeDir)
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify({
      at: String(row.at || new Date().toISOString()),
      aweme_id: String(row.aweme_id || '').slice(0, 40),
      ok: row.ok === true,
    })}\n`, 'utf8')
    return true
  } catch (e) {
    try { log?.(`看视频台账写不进去：${e?.message ?? e}`) } catch { /* ignore */ }
    return false
  }
}

/** 今天已经看/试了几次（成功失败都算 —— 防刷） */
export function watchesToday(homeDir, now = new Date()) {
  const day = dayKey(now)
  return readWatchRows(homeDir).filter((r) => r.at && dayKey(new Date(r.at)) === day).length
}

/**
 * 现在能不能看。
 * @returns {{ok:boolean, reason?:'off'|'cap'|'bad', count:number, perDay:number, remaining:number, error?:string}}
 */
export function canWatch(homeDir, { aweme_id = '', settings = DEFAULT_WATCH_VIDEO, now = new Date() } = {}) {
  const st = normalizeWatchSettings(settings)
  const count = watchesToday(homeDir, now)
  const remaining = Math.max(0, st.perDay - count)
  if (!st.enabled) {
    return { ok: false, reason: 'off', count, perDay: st.perDay, remaining, error: '看视频开关关着（settings.watchVideo.enabled=false）' }
  }
  if (count >= st.perDay) {
    return { ok: false, reason: 'cap', count, perDay: st.perDay, remaining: 0, error: `今天已经看了 ${count} 条视频（每天最多 ${st.perDay} 条）` }
  }
  return { ok: true, count, perDay: st.perDay, remaining, aweme_id: String(aweme_id || '') }
}

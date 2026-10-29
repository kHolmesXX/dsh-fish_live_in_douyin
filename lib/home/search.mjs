/**
 * lib/home/search.mjs —— 搜索视频的限额台账 + 请求构造（2026-10-28 fish.24）
 * ============================================================================
 * 文件：`$DOUYIN_HOME/home/searches.jsonl`，一行一次尝试：
 *   { at, keyword, count, ok }
 * 护栏（settings.search）：
 *   · enabled  开关（默认 true）
 *   · perDay   每天最多几次（默认 20，夹 1–100）
 *   · minGapSec 两次之间至少隔几秒（默认 30，夹 0–600）
 *
 * 这个模块只做纯逻辑；真正去页面上下文 fetch 的是 tools/douyin-search.mjs。
 * ============================================================================
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const DEFAULT_SEARCH = { enabled: true, perDay: 20, minGapSec: 30 }
export const PER_DAY_MAX = 100
export const MIN_GAP_MAX = 600
export const DEFAULT_CHANNEL = 'aweme_video_web'
export const SEARCH_PATH = '/aweme/v1/web/general/search/single/'

export const searchesFile = (homeDir) => join(String(homeDir || ''), 'searches.jsonl')

const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}
export const dayKey = (now = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** settings.search 归一化（坏值夹范围；缺省 enabled + 20 次/天 + 30 秒间隔） */
export function normalizeSearchSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const perDay = Math.max(1, Math.min(Math.trunc(Number(src.perDay) || DEFAULT_SEARCH.perDay), PER_DAY_MAX))
  const n = Number(src.minGapSec)
  const minGapSec = Number.isFinite(n) ? Math.max(0, Math.min(Math.trunc(n), MIN_GAP_MAX)) : DEFAULT_SEARCH.minGapSec
  return { enabled: src.enabled !== false, perDay, minGapSec }
}

/** 读台账（坏行跳过、不抛） */
export function readSearches(homeDir) {
  let text = ''
  try { text = readFileSync(searchesFile(homeDir), 'utf8') } catch { return [] }
  const out = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(stripBom(line))
      if (!r || typeof r !== 'object') continue
      out.push({
        at: String(r.at || ''),
        keyword: String(r.keyword || ''),
        count: Math.max(0, Math.trunc(Number(r.count) || 0)),
        ok: r.ok === true,
      })
    } catch { /* 坏行跳过 */ }
  }
  return out
}

/** 追加一行尝试记录（写失败只 log，不影响搜索本身） */
export function appendSearch(homeDir, row = {}, log) {
  try {
    const file = searchesFile(homeDir)
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify({
      at: String(row.at || new Date().toISOString()),
      keyword: String(row.keyword || '').slice(0, 80),
      count: Math.max(0, Math.trunc(Number(row.count) || 0)),
      ok: row.ok === true,
    })}\n`, 'utf8')
    return true
  } catch (e) {
    try { log?.(`搜索台账写不进去：${e?.message ?? e}`) } catch { /* ignore */ }
    return false
  }
}

/** 今天已经搜了几次（成功与否都算——防刷） */
export function searchesToday(homeDir, now = new Date()) {
  const day = dayKey(now)
  return readSearches(homeDir).filter((r) => r.at && dayKey(new Date(r.at)) === day).length
}

/** 最近一次搜索时间（毫秒；没有 ⇒ 0） */
export function lastSearchAt(homeDir) {
  const rows = readSearches(homeDir)
  let max = 0
  for (const r of rows) {
    const t = Date.parse(r.at)
    if (Number.isFinite(t) && t > max) max = t
  }
  return max
}

/**
 * 现在能不能搜。
 * @returns {{ok:boolean, reason?:'off'|'cap'|'gap', waitSec:number, count:number, perDay:number}}
 */
export function canSearch(homeDir, { settings = DEFAULT_SEARCH, now = new Date() } = {}) {
  const st = normalizeSearchSettings(settings)
  const count = searchesToday(homeDir, now)
  const waitBase = { waitSec: 0, count, perDay: st.perDay }
  if (!st.enabled) return { ok: false, reason: 'off', ...waitBase }
  if (count >= st.perDay) return { ok: false, reason: 'cap', ...waitBase }
  const last = lastSearchAt(homeDir)
  if (last && st.minGapSec > 0) {
    const elapsed = now.getTime() - last
    const need = st.minGapSec * 1000 - elapsed
    if (need > 0) return { ok: false, reason: 'gap', ...waitBase, waitSec: Math.ceil(need / 1000) }
  }
  return { ok: true, ...waitBase, remaining: Math.max(0, st.perDay - count) }
}

/**
 * 构造搜索 API 的相对 URL（页面上下文 fetch 时由抖音页面自己的 fetch 带签名/token）。
 * @returns {string} `/aweme/v1/web/general/search/single/?keyword=…&search_channel=…&offset=…&count=…&aid=6383&device_platform=webapp`
 */
export function buildSearchUrl(keyword, { count = 10, offset = 0, channel = DEFAULT_CHANNEL } = {}) {
  const c = Math.max(1, Math.min(Math.trunc(Number(count) || 10), 30))
  const o = Math.max(0, Math.trunc(Number(offset) || 0))
  const q = [
    `keyword=${encodeURIComponent(String(keyword || ''))}`,
    `search_channel=${encodeURIComponent(String(channel || DEFAULT_CHANNEL))}`,
    `offset=${o}`,
    `count=${c}`,
    'aid=6383',
    'device_platform=webapp',
  ].join('&')
  return `${SEARCH_PATH}?${q}`
}

/**
 * lib/home/rest.mjs —— 久坐 / 刷太久提醒（2026-10-27 fish.12）
 * ============================================================================
 * 信号沿用 fish.9 的「主人在线」：`home/presence.json` 的 `lastAt/prevAt`
 * （`session/event` 的 `user/message` 更新它）。规则（主人原话落地）：
 *
 *   · 连续在线 ≥ `afterMin`（默认 40 分钟）就开始提醒休息；
 *   · 一次长会话里最多提醒 `maxTimes`（默认 4 次）；相邻提醒间隔 ≥ `intervalMin`（默认 8 分钟，≤10）；
 *   · 中间断开（距上次活动 > 15 分钟）⇒ 新会话：`sessionStart=now, count=0`。
 *
 * 文件：`$DOUYIN_HOME/home/rest.json`
 *   { enabled, afterMin, maxTimes, intervalMin, sessionStart:'ISO', count:0, lastAt:'', day:'' }
 * 用户可改的配置在 `settings.json` 的 `rest` 段（本模块 readRest 时叠加，
 * 缺省/坏值由 normalizeRestSettings 夹到 afterMin 20–180 / maxTimes 1–6 / intervalMin 5–30）。
 * ============================================================================
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readSettings } from './settings.mjs'

/** 默认值（settings.rest 缺省时用） */
export const REST_DEFAULTS = { enabled: true, afterMin: 40, maxTimes: 4, intervalMin: 8 }
/** 静默多久算「断开」，重开一个会话（分钟） */
export const REST_GAP_MIN = 15
/** 在线判定窗口（分钟）：presence.lastAt 在这之内算在线 */
export const REST_ONLINE_WINDOW_MIN = 2

export const restFile = (homeDir) => join(String(homeDir || ''), 'rest.json')

const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}
const readJsonSafe = (file) => { try { return JSON.parse(stripBom(readFileSync(file, 'utf8'))) } catch { return null } }
const localDay = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 把 settings.rest / rest.json 的配置收成合法值（坏值回默认，不抛） */
export function normalizeRestSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const clamp = (v, min, max, fb) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(min, Math.min(Math.trunc(n), max)) : fb
  }
  return {
    enabled: src.enabled !== false,
    afterMin: clamp(src.afterMin, 20, 180, REST_DEFAULTS.afterMin),
    maxTimes: clamp(src.maxTimes, 1, 6, REST_DEFAULTS.maxTimes),
    intervalMin: clamp(src.intervalMin, 5, 30, REST_DEFAULTS.intervalMin),
  }
}

function writeJsonAtomic(file, value) {
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

/**
 * 读 rest 状态 + 生效配置（settings.rest 优先，其次 rest.json 里的旧值，最后默认）。
 * @returns {{enabled:boolean, afterMin:number, maxTimes:number, intervalMin:number,
 *            sessionStart:string, count:number, lastAt:string, day:string}}
 */
export function readRest(homeDir) {
  const st = readJsonSafe(restFile(homeDir)) || {}
  let settingsRest = null
  try { settingsRest = readSettings(homeDir).rest } catch { settingsRest = null }
  const config = normalizeRestSettings(
    settingsRest && typeof settingsRest === 'object' && !Array.isArray(settingsRest)
      ? settingsRest
      : { enabled: st.enabled, afterMin: st.afterMin, maxTimes: st.maxTimes, intervalMin: st.intervalMin },
  )
  return {
    ...config,
    sessionStart: typeof st.sessionStart === 'string' ? st.sessionStart : '',
    count: Math.max(0, Math.min(Number(st.count) || 0, config.maxTimes)),
    lastAt: typeof st.lastAt === 'string' ? st.lastAt : '',
    day: typeof st.day === 'string' ? st.day : '',
  }
}

/** 改 rest.json（嵌套合并；不抛） */
export function writeRest(homeDir, patch = {}) {
  const cur = readRest(homeDir)
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  const next = { ...cur, ...p }
  writeJsonAtomic(restFile(homeDir), next)
  return next
}

/**
 * ⭐ 每次主人活动时调（index.js 的 session/event → user/message）：
 *   距上次活动 > 15 分钟 ⇒ 新会话（sessionStart=now, count=0, lastAt 清空）；否则保持 sessionStart。
 * @param {{homeDir:string, now?:Date, lastActivityIso?:string}} opt
 */
export function touchRestSession(homeDir, { now = new Date(), lastActivityIso = '' } = {}) {
  try {
    const at = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
    const cur = readRest(homeDir)
    const lastMs = Date.parse(String(lastActivityIso || ''))
    const gapMin = Number.isFinite(lastMs) ? (at.getTime() - lastMs) / 60_000 : Infinity
    if (!cur.sessionStart || !Number.isFinite(gapMin) || gapMin > REST_GAP_MIN) {
      return writeRest(homeDir, { sessionStart: at.toISOString(), count: 0, lastAt: '' })
    }
    return cur
  } catch { return null }
}

/**
 * 该不该提醒？纯判定，不投递。
 * @param {{homeDir:string, now?:Date, isOnline?:boolean}} opt
 * @returns {{due:true, minutes:number, n:number, maxTimes:number} | {due:false, reason?:string}}
 */
export function restDue(homeDir, { now = new Date(), isOnline = false } = {}) {
  try {
    if (!isOnline) return { due: false, reason: '主人不在线' }
    const st = readRest(homeDir)
    if (!st.enabled) return { due: false, reason: '久坐提醒已关' }
    const start = Date.parse(String(st.sessionStart || ''))
    if (!Number.isFinite(start)) return { due: false, reason: '还没开始算会话' }
    const minutes = Math.round((now.getTime() - start) / 60_000)
    if (minutes < st.afterMin) return { due: false, reason: `才连续 ${minutes} 分钟（< ${st.afterMin}）` }
    if (st.count >= st.maxTimes) return { due: false, reason: `这次会话已经提醒 ${st.count} 次（上限 ${st.maxTimes}）` }
    const last = Date.parse(String(st.lastAt || ''))
    if (Number.isFinite(last) && now.getTime() - last < st.intervalMin * 60_000) {
      return { due: false, reason: `离上次提醒还不到 ${st.intervalMin} 分钟` }
    }
    return { due: true, minutes, n: st.count + 1, maxTimes: st.maxTimes }
  } catch { return { due: false, reason: '判定出错' } }
}

/** 投递成功后记一次（count+1 / lastAt / day）。 */
export function markRestSent(homeDir, { now = new Date() } = {}) {
  try {
    const at = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
    const cur = readRest(homeDir)
    return writeRest(homeDir, { count: Math.max(0, cur.count) + 1, lastAt: at.toISOString(), day: localDay(at) })
  } catch { return null }
}

/** 叫醒词（原文给她的指令；「用你自己的说」——不代写） */
export function renderRestWake({ minutes = 0, n = 1, maxTimes = 4 } = {}) {
  return [
    `【该让主人歇会儿了】他已经连续在线 ${minutes} 分钟了（这是今天第 ${n} 次提醒，最多 ${maxTimes} 次）。`,
    '用你自己的话说一句让他起来走两步 / 喝口水 / 歇会儿眼睛，别用模板，别念经；',
    '发就 douyin_reach_out（不算多次也没关系，这个提醒不占「主动开口」额度，但每天总共别超过 4 次）。',
  ].join('\n')
}

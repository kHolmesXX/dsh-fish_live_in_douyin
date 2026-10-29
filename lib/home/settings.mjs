/**
 * lib/home/settings.mjs —— 归档保留范围（2026-10-27 fish.6）
 * ============================================================================
 * 文件：`$DOUYIN_HOME/home/settings.json`
 *   { "retention": { "archiveDays":30, "dmKeepPerPerson":80, "diaryDays":365,
 *                    "journalDays":90, "compactionsKeep":200 },
 *     "lastPruneAt": "ISO" }
 *
 * 真正的清理分两块（各自都在自己的模块里，这里只做「读策略 + 24h 限一次 + 汇总日志」）：
 *   · lib/home/ledger.mjs  → pruneLedger：rounds/ 旧文件、sent.jsonl / journal.jsonl 裁旧行
 *   · lib/relation.mjs     → pruneMemory：memory/archive 旧文件、memory/diary 旧文件、dm-*.json 裁条数
 * 另外 compactions.jsonl 只留最近 compactionsKeep 条。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pruneLedger } from './ledger.mjs'
import { trimCompactions } from './compactions.mjs'
import { pruneMemory } from '../relation.mjs'

/** 保留范围默认值（跟 fish 之前的行为一致；老数据不会被立刻清光） */
export const DEFAULT_RETENTION = {
  archiveDays: 30,
  dmKeepPerPerson: 80,
  diaryDays: 365,
  journalDays: 90,
  compactionsKeep: 200,
}

/** 每个字段的校验范围：天数 1–3650 / 条数 10–2000 */
export const RETENTION_RULES = {
  archiveDays: { kind: 'days', min: 1, max: 3650 },
  diaryDays: { kind: 'days', min: 1, max: 3650 },
  journalDays: { kind: 'days', min: 1, max: 3650 },
  dmKeepPerPerson: { kind: 'counts', min: 10, max: 2000 },
  compactionsKeep: { kind: 'counts', min: 10, max: 2000 },
}

/**
 * ⭐ fish.7 A：她的「定点自由时间」（每个时间点后面 10 分钟窗口内叫一次，无条件）。
 * 跟 retention 同层放在 settings.json；默认 14:30 / 20:30。
 */
export const DEFAULT_FREE_TIMES = ['14:30', '20:30']
export const FREE_TIMES_MAX = 4
const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** FreeTimes 规范化：只留合法 HH:MM、去重、补零、最多 4 个；不是数组 ⇒ 用默认值 */
export function normalizeFreeTimes(raw, fallback = DEFAULT_FREE_TIMES) {
  if (!Array.isArray(raw)) return [...fallback]
  const out = []
  for (const item of raw) {
    const v = String(item ?? '').trim()
    if (!HHMM_RE.test(v)) continue
    const t = v.padStart(5, '0')
    if (!out.includes(t)) out.push(t)
  }
  return out.slice(0, FREE_TIMES_MAX)
}

export const settingsFile = (homeDir) => join(String(homeDir || ''), 'settings.json')

const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}

function readJsonSafe(file) {
  try { return JSON.parse(stripBom(readFileSync(file, 'utf8'))) } catch { return null }
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

const clamp = (n, min, max, fallback) => {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.max(min, Math.min(Math.trunc(v), max))
}

/** 把任意输入收成合法 settings（超范围自动夹到边界；手改坏了也不炸） */
export function normalizeSettings(j) {
  const src = j && typeof j === 'object' && !Array.isArray(j) ? j : {}
  const r = src.retention && typeof src.retention === 'object' && !Array.isArray(src.retention) ? src.retention : {}
  const retention = {}
  for (const [k, rule] of Object.entries(RETENTION_RULES)) {
    retention[k] = clamp(r[k], rule.min, rule.max, DEFAULT_RETENTION[k])
  }
  // ⭐ fish.14：groupPatrol 段保住 + 群助手昵称默认值（delegate 用；缺省「群聊小助手」）
  const gp = src.groupPatrol && typeof src.groupPatrol === 'object' && !Array.isArray(src.groupPatrol) ? { ...src.groupPatrol } : {}
  if (!String(gp.groupAssistantName || '').trim()) gp.groupAssistantName = '群聊小助手'
  return {
    ...src,
    groupPatrol: gp,
    retention,
    // ⭐ fish.7 A：定点自由时间（跟 retention 同层；缺/坏 ⇒ 默认 14:30/20:30）
    freeTimes: normalizeFreeTimes(src.freeTimes, DEFAULT_FREE_TIMES),
    lastPruneAt: typeof src.lastPruneAt === 'string' ? src.lastPruneAt : '',
  }
}

/**
 * 读 settings。缺文件 ⇒ 补默认；坏 JSON ⇒ 默认且**不覆盖**（留着手改的东西）。
 */
export function readSettings(homeDir) {
  const file = settingsFile(homeDir)
  const j = readJsonSafe(file)
  if (!j) {
    if (!existsSync(file)) {
      const init = normalizeSettings({ retention: { ...DEFAULT_RETENTION } })
      writeJsonAtomic(file, init)
      return init
    }
    return normalizeSettings({})
  }
  return normalizeSettings(j)
}

/**
 * 改 settings（retention 做嵌套合并，不传的字段保留）。返回合并后的完整 settings。
 */
export function writeSettings(homeDir, patch = {}) {
  const cur = readSettings(homeDir)
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  const next = normalizeSettings({
    ...cur,
    ...p,
    retention: { ...cur.retention, ...(p.retention && typeof p.retention === 'object' ? p.retention : {}) },
  })
  writeJsonAtomic(settingsFile(homeDir), next)
  return next
}

/**
 * 校验 POST /retention 送来的补丁（retention 字段 + 可选 freeTimes）。
 * ⭐ fish.7 A：freeTimes 是 HH:MM 字符串数组，最多 4 个；空数组 = 关掉定点自由时间。
 * @returns {{ok:true, retention:object, freeTimes?:string[]} | {ok:false, error:string}}
 */
export function validateRetentionPatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'retention 要是一个对象' }
  const retention = {}
  for (const [k, rule] of Object.entries(RETENTION_RULES)) {
    if (!(k in raw)) continue
    const v = Number(raw[k])
    if (!Number.isInteger(v) || v < rule.min || v > rule.max) {
      const what = rule.kind === 'days' ? '天' : '条'
      return { ok: false, error: `${k} 要是 ${rule.min}–${rule.max} 的整数（${what}）` }
    }
    retention[k] = v
  }
  const out = { ok: true, retention }
  if (raw.freeTimes !== undefined) {
    if (!Array.isArray(raw.freeTimes)) return { ok: false, error: 'freeTimes 要是 HH:MM 字符串数组（最多 4 个）' }
    if (raw.freeTimes.length > FREE_TIMES_MAX) return { ok: false, error: `freeTimes 最多 ${FREE_TIMES_MAX} 个时间点` }
    const times = []
    for (const item of raw.freeTimes) {
      const v = String(item ?? '').trim()
      if (!HHMM_RE.test(v)) return { ok: false, error: `freeTimes 里的「${v}」不是 HH:MM` }
      const t = v.padStart(5, '0')
      if (!times.includes(t)) times.push(t)
    }
    out.freeTimes = times
  }
  if (!Object.keys(retention).length && out.freeTimes === undefined) {
    return { ok: false, error: '没有要改的字段（archiveDays / dmKeepPerPerson / diaryDays / journalDays / compactionsKeep / freeTimes）' }
  }
  return out
}

/**
 * 按保留策略清理一次（**24 小时最多跑一次**，靠 settings.lastPruneAt 记上次时间；force 可绕过）。
 * 日志只记一行：「清理：删了 N 个文件 / 裁了 M 行」。
 * @returns {{skipped:boolean, files:number, lines:number, at:string}}
 */
export function pruneByRetention({ stateDir, homeDir, log, now = new Date(), force = false } = {}) {
  try {
    const settings = readSettings(homeDir)
    const last = Date.parse(String(settings.lastPruneAt || ''))
    if (!force && Number.isFinite(last) && now.getTime() - last < 24 * 3_600_000) {
      return { skipped: true, files: 0, lines: 0, at: settings.lastPruneAt }
    }
    const retention = settings.retention
    let files = 0
    let lines = 0
    try {
      const r = pruneLedger({ homeDir, retention, now, log })
      files += Number(r.files) || 0
      lines += Number(r.lines) || 0
    } catch (e) { try { log?.(`清理（账本）出错：${e?.message ?? e}`) } catch { /* ignore */ } }
    try {
      const r = pruneMemory({ stateDir, retention, now, log })
      files += Number(r.files) || 0
      lines += Number(r.lines) || 0
    } catch (e) { try { log?.(`清理（记忆）出错：${e?.message ?? e}`) } catch { /* ignore */ } }
    try { lines += trimCompactions(homeDir, retention.compactionsKeep) } catch { /* ignore */ }
    const at = now.toISOString()
    writeSettings(homeDir, { lastPruneAt: at })
    try { log?.(`清理：删了 ${files} 个文件 / 裁了 ${lines} 行`) } catch { /* ignore */ }
    return { skipped: false, files, lines, at }
  } catch (e) {
    try { log?.(`清理出错（已兜住）：${e?.message ?? e}`) } catch { /* ignore */ }
    return { skipped: true, files: 0, lines: 0, at: '' }
  }
}

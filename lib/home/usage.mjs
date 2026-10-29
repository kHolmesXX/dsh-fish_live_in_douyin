/**
 * lib/home/usage.mjs —— 她今天花了多少 token / 折多少钱（2026-10-27 fish.6）
 * ============================================================================
 * 数据从 DSH 的会话事件拿（见 index.js 的 ctx.on('session/event')）：
 *   event.type === 'assistant/message' 且 event.data.usage 存在 ⇒
 *   { inputTokens, outputTokens, cacheReadTokens }（字段名照 dsh-world/lib/life/pricing.js）
 *   model = event.data.message.source.model（拿不到就记 'unknown'）
 *
 * 落盘：`$DOUYIN_HOME/home/usage/<YYYY-MM-DD>.json`
 *   { day, calls, inputTokens, outputTokens, cacheReadTokens,
 *     byModel: { <model>: { calls, inputTokens, outputTokens, cacheReadTokens } }, updatedAt }
 *
 * 价目表：`$DOUYIN_HOME/home/pricing.json`（**不硬编码任何价格**）
 *   { "_comment": "…", "currency": "CNY", "models": {
 *       "deepseek-flash": { "cacheHit": 0.02, "cacheMiss": 1, "output": 4 } } }
 *   单位：元 / 百万 token。没填（或某个模型没填）⇒ estCost 返回 null，只报 token。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 缺省价目表：**故意不填价格**（别猜），只留一行注释教用户怎么填 */
export const DEFAULT_PRICING = {
  _comment: '单价自己填（单位：元 / 百万 token）。models 里键名是模型 id（可写子串，比如 "deepseek-flash"）；不填就不算金额，只报 token。例：{"currency":"CNY","models":{"deepseek-flash":{"cacheHit":0.02,"cacheMiss":1,"output":4}}}',
  currency: 'CNY',
  models: {},
}

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

const usageFile = (homeDir, day) => join(String(homeDir || ''), 'usage', `${day}.json`)
/** `$DOUYIN_HOME/home/pricing.json` */
export const pricingFile = (homeDir) => join(String(homeDir || ''), 'pricing.json')

/** 本地日期（读不到事件时间时的兜底；正式调用方会注入 day） */
function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const emptyDay = (day) => ({
  day,
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  byModel: {},
  updatedAt: '',
})

/** 读某天的用量（不存在/坏文件 ⇒ null）。 */
export function readUsage(homeDir, day) {
  const d = DATE_RE.test(String(day || '')) ? String(day) : localDay()
  const j = readJsonSafe(usageFile(homeDir, d))
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null
  const byModel = j.byModel && typeof j.byModel === 'object' && !Array.isArray(j.byModel) ? j.byModel : {}
  return {
    day: d,
    calls: Number(j.calls) || 0,
    inputTokens: Number(j.inputTokens) || 0,
    outputTokens: Number(j.outputTokens) || 0,
    cacheReadTokens: Number(j.cacheReadTokens) || 0,
    byModel,
    updatedAt: String(j.updatedAt || ''),
  }
}

/** 最近有记录的几天（新的在前，最多 limit 天）。 */
export function usageDays(homeDir, limit = 31) {
  try {
    return readdirSync(join(String(homeDir || ''), 'usage'))
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
      .map((n) => n.slice(0, 10))
      .sort()
      .reverse()
      .slice(0, Math.max(1, Math.min(Number(limit) || 31, 366)))
  } catch { return [] }
}

/**
 * 记一次模型调用的用量（只给**她家会话**调；读-改-写，失败不抛）。
 * @param {{homeDir:string, day?:string, model?:string, usage:object, now?:Date}} opt
 * @returns 更新后的当天记录 | null（写失败）
 */
export function recordUsage({ homeDir, day, model, usage, now = new Date() } = {}) {
  try {
    const d = DATE_RE.test(String(day || '')) ? String(day) : localDay(now)
    const u = usage && typeof usage === 'object' ? usage : {}
    const cur = readUsage(homeDir, d) || emptyDay(d)
    const m = String(model || 'unknown').slice(0, 120) || 'unknown'
    const input = Number(u.inputTokens) || 0
    const output = Number(u.outputTokens) || 0
    const cacheRead = Number(u.cacheReadTokens) || 0
    const bm = cur.byModel[m] && typeof cur.byModel[m] === 'object' ? cur.byModel[m] : { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
    cur.calls += 1
    cur.inputTokens += input
    cur.outputTokens += output
    cur.cacheReadTokens += cacheRead
    cur.byModel[m] = {
      calls: (Number(bm.calls) || 0) + 1,
      inputTokens: (Number(bm.inputTokens) || 0) + input,
      outputTokens: (Number(bm.outputTokens) || 0) + output,
      cacheReadTokens: (Number(bm.cacheReadTokens) || 0) + cacheRead,
    }
    cur.updatedAt = now.toISOString()
    return writeJsonAtomic(usageFile(homeDir, d), cur) ? cur : null
  } catch { return null }
}

/**
 * 读价目表。缺文件 ⇒ 补一份默认（只有注释、没有价格）；坏文件 ⇒ 默认、**不覆盖**。
 * @returns {{currency:string, models:object}}
 */
export function readPricing(homeDir) {
  const file = pricingFile(homeDir)
  let j = null
  try { j = readJsonSafe(file) } catch { j = null }
  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    if (!existsSync(file)) writeJsonAtomic(file, DEFAULT_PRICING)
    return { currency: DEFAULT_PRICING.currency, models: {} }
  }
  const models = j.models && typeof j.models === 'object' && !Array.isArray(j.models) ? j.models : {}
  return { currency: String(j.currency || 'CNY').slice(0, 8) || 'CNY', models }
}

/** 模型名 → 价目表里的那一行（先精确、再双向子串；没有 ⇒ null） */
function findPrice(models, model) {
  const name = String(model || '').toLowerCase()
  if (!name) return null
  const keys = Object.keys(models || {})
  const exact = keys.find((k) => k.toLowerCase() === name)
  if (exact) return models[exact]
  const sub = keys.find((k) => name.includes(k.toLowerCase()) || k.toLowerCase().includes(name))
  return sub ? models[sub] : null
}

/**
 * 估花费（元）。**没有价目就不猜**：任何用到的模型没价格 ⇒ estCost=null。
 * @returns {{estCost:number|null, currency:string, missingModels:string[], pricedModels:string[]}}
 */
export function estimateCost(record, pricing) {
  const models = (pricing && pricing.models) || {}
  const currency = (pricing && pricing.currency) || 'CNY'
  const byModel = record && record.byModel && typeof record.byModel === 'object' ? record.byModel : {}
  const missing = []
  const priced = []
  let total = 0
  for (const [model, u] of Object.entries(byModel)) {
    const price = findPrice(models, model)
    const miss = price ? Number(price.cacheMiss) : NaN
    const out = price ? Number(price.output) : NaN
    const hit = price && price.cacheHit !== undefined ? Number(price.cacheHit) : miss
    if (!Number.isFinite(miss) || !Number.isFinite(out) || !Number.isFinite(hit)) { missing.push(model); continue }
    priced.push(model)
    total += ((Number(u.cacheReadTokens) || 0) * hit + (Number(u.inputTokens) || 0) * miss + (Number(u.outputTokens) || 0) * out) / 1e6
  }
  if (missing.length || !priced.length) {
    return { estCost: null, currency, missingModels: missing, pricedModels: priced }
  }
  return { estCost: Math.round(total * 1e10) / 1e10, currency, missingModels: [], pricedModels: priced }
}

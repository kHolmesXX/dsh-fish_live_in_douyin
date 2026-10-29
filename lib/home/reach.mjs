/**
 * lib/home/reach.mjs —— 「主动联系」策略 + 账（2026-10-27 fish.5）
 * ============================================================================
 * 一个文件两种用途（`$DOUYIN_HOME/home/reach.json`）：
 *   现有字段（**别破坏**）：{ day, count, history:[{at,to,text}] }   ← 今天的额度记账
 *   新增策略（面板「她的家 → 主动联系」可改）：
 *     policy: { enabled:true, dryRun:false, limit:20,
 *               quietFrom:'00:00', quietTo:'00:00', stages:['熟','自己人'] }
 *     （fish.9 放宽：limit 20；quietFrom===quietTo ⇒ 不设静默；stages 不动 —— 生人红线）
 *   另外：
 *     home/reach-blocked.jsonl   每次被策略拦住一行 {at,to,to_id,stage,reason}
 *     home/sent.jsonl            发送账本（这里只读 kind==='reach' 的行，算曲线）
 *
 * 保守规矩（同 world.mjs）：
 *   ① 缺文件 ⇒ 补一份默认（enabled:true，保持既有行为）；
 *   ② 坏 JSON ⇒ 用默认**但不覆盖**（别把一个手改坏的文件直接抹了）；
 *   ③ 读失败一律按默认跑，绝不抛 —— 拦不住的策略比"她永远不能主动"好。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { appendLine, readJsonl } from './ledger.mjs'

/** 策略默认值：跟 fish 前的硬编码完全一致（3 条 / 00:00–08:00 / 熟+自己人） */
/** 策略默认值：fish.9 起放宽（主人拍板：「别被规矩限制住」）
 *  · limit 20：每天所有主动消息合计上限（reach_out + burst 共用这个额度）
 *  · quietFrom === quietTo ⇒ 不设静默时段（inQuietHours 里 from===to 返回 false）
 *  · stages 仍是 熟/自己人 —— 生人不主动，这条红线不动 */
export const DEFAULT_POLICY = {
  enabled: true,
  dryRun: false,
  limit: 20,
  quietFrom: '00:00',
  quietTo: '00:00',
  stages: ['熟', '自己人'],
}

/** 额度最多允许改成多少条（POST /reach 校验用；也防手改出 999） */
export const REACH_LIMIT_MAX = 20
const MAX_HISTORY = 50
const STAGE_SET = ['生', '熟', '自己人']

const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}

/** `$DOUYIN_HOME/home/reach.json` */
export const reachFile = (homeDir) => join(String(homeDir || ''), 'reach.json')
/** `$DOUYIN_HOME/home/reach-blocked.jsonl` */
export const blockedFile = (homeDir) => join(String(homeDir || ''), 'reach-blocked.jsonl')

/** 原子写 JSON（tmp → rename，Windows 上失败重试一次；失败不抛） */
function writeJsonAtomic(file, value) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`, 'utf8')
    try { renameSync(tmp, file) } catch {
      try { renameSync(tmp, file) } catch (e) {
        try { rmSync(tmp, { force: true }) } catch { /* 清不掉就算了 */ }
        throw e
      }
    }
    return true
  } catch { return false }
}

/** 'H:MM' / 'HH:MM' → 当天分钟数；不合法 ⇒ null */
function parseHm(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim())
  if (!m) return null
  const h = Number(m[1]); const mi = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(mi) || h > 23 || mi > 59) return null
  return h * 60 + mi
}

/** 规范成 HH:MM（补零）；不合法 ⇒ 默认值 */
function hhmmOr(v, fallback) {
  const mins = parseHm(v)
  if (mins === null) return fallback
  const p = (n) => String(n).padStart(2, '0')
  return `${p(Math.floor(mins / 60))}:${p(mins % 60)}`
}

/** 把任意输入（含 undefined/手改的垃圾）收成合法 policy */
export function normalizePolicy(p) {
  const src = p && typeof p === 'object' && !Array.isArray(p) ? p : {}
  const rawLimit = Number(src.limit)
  const limit = Number.isFinite(rawLimit) ? Math.max(0, Math.min(Math.trunc(rawLimit), REACH_LIMIT_MAX)) : DEFAULT_POLICY.limit
  const stages = Array.isArray(src.stages)
    ? [...new Set(src.stages.map((s) => String(s || '').trim()).filter((s) => STAGE_SET.includes(s)))]
    : []
  return {
    enabled: src.enabled !== false,
    dryRun: src.dryRun === true,
    limit,
    quietFrom: hhmmOr(src.quietFrom, DEFAULT_POLICY.quietFrom),
    quietTo: hhmmOr(src.quietTo, DEFAULT_POLICY.quietTo),
    // 空数组/全是脏值 ⇒ 退回默认（不能因为手滑把"能给谁发"清空）
    stages: stages.length ? stages : [...DEFAULT_POLICY.stages],
  }
}

const emptyReach = () => ({ day: '', count: 0, history: [], policy: { ...DEFAULT_POLICY, stages: [...DEFAULT_POLICY.stages] } })

/**
 * 读 reach.json（永远返回完整对象，绝不抛）。
 * 缺文件 ⇒ 首次读到补一份默认；坏 JSON ⇒ 返回默认、**不覆盖**原文件。
 */
export function readReach(homeDir) {
  const file = reachFile(homeDir)
  let raw = null
  try { raw = readFileSync(file, 'utf8') } catch { raw = null }
  if (raw === null) {
    if (!existsSync(file)) {
      const init = emptyReach()
      writeJsonAtomic(file, init)
      return init
    }
    return emptyReach()
  }
  let j = null
  try { j = JSON.parse(stripBom(raw)) } catch { return emptyReach() }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return emptyReach()
  return {
    ...j,                                        // 保留未知字段，别把别的程序写的东西吃掉
    day: typeof j.day === 'string' ? j.day : '',
    count: Number(j.count) || 0,
    history: Array.isArray(j.history)
      ? j.history.filter((x) => x && typeof x === 'object' && !Array.isArray(x)).slice(-MAX_HISTORY)
      : [],
    policy: normalizePolicy(j.policy),
  }
}

/**
 * 改 reach.json（先读后合并；policy 做**嵌套合并**，不会丢没传的字段）。
 * @returns 合并后的完整对象（写失败也返回，别让调用方炸）
 */
export function writeReach(homeDir, patch = {}) {
  const cur = readReach(homeDir)
  const p = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  const next = {
    ...cur,
    ...p,
    day: p.day !== undefined ? String(p.day || '') : cur.day,
    count: p.count !== undefined ? Number(p.count) || 0 : cur.count,
    history: Array.isArray(p.history) ? p.history.slice(-MAX_HISTORY) : cur.history,
    policy: normalizePolicy({ ...cur.policy, ...(p.policy && typeof p.policy === 'object' ? p.policy : {}) }),
  }
  writeJsonAtomic(reachFile(homeDir), next)
  return next
}

/** 只读策略（热路径用；读失败 = 默认策略）。 */
export function reachPolicy(homeDir) {
  try { return readReach(homeDir).policy } catch { return { ...DEFAULT_POLICY, stages: [...DEFAULT_POLICY.stages] } }
}

/**
 * 免打扰判断（支持跨零点，比如 23:00–07:00）。
 * from === to ⇒ 不设免打扰（别把一整天都锁死）。
 */
export function inQuietHours(now, quietFrom = DEFAULT_POLICY.quietFrom, quietTo = DEFAULT_POLICY.quietTo) {
  const f = parseHm(quietFrom)
  const t = parseHm(quietTo)
  if (f === null || t === null || f === t) return false
  const cur = now.getHours() * 60 + now.getMinutes()
  return f < t ? (cur >= f && cur < t) : (cur >= f || cur < t)
}

/**
 * 记一次「被策略拦住」（append 到 home/reach-blocked.jsonl）。
 * 失败只调 log、绝不抛 —— 拦都拦了，记账坏了不能反过来打断。
 * @param {{to?:string, to_id?:string, stage?:string, reason:string, at?:string}} row
 */
export function recordBlocked(homeDir, row = {}, log) {
  try {
    return appendLine(blockedFile(homeDir), {
      at: new Date().toISOString(),
      to: String(row.to || ''),
      to_id: String(row.to_id || ''),
      stage: String(row.stage || ''),
      reason: String(row.reason || ''),
    }, log)
  } catch { return false }
}

/** 读拦截记录（最近 days 天，最多 limit 条；新的在前）。 */
export function readBlocked(homeDir, { days = 7, limit = 50 } = {}) {
  try {
    const since = Date.now() - Math.max(1, Number(days) || 7) * 86_400_000
    const rows = readJsonl(blockedFile(homeDir))
      .filter((r) => r && typeof r === 'object' && typeof r.at === 'string')
      .filter((r) => { const t = Date.parse(r.at); return Number.isFinite(t) && t >= since })
      .map((r) => ({
        at: String(r.at || ''),
        to: String(r.to || ''),
        to_id: String(r.to_id || ''),
        stage: String(r.stage || ''),
        reason: String(r.reason || ''),
      }))
    rows.sort((a, b) => String(b.at).localeCompare(String(a.at)))
    return rows.slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)))
  } catch { return [] }
}

/** ISO → 本地日期（YYYY-MM-DD） */
function localDayOf(iso) {
  const t = Date.parse(String(iso || ''))
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 最近 days 天的「主动联系」曲线：当天发出去几条 + 被拦下几条。
 * 发送侧只数 sent.jsonl 里 kind==='reach' 且 sent===true 的行（失败的不算"发出去了"）。
 * @returns {Array<{day:string, sent:number, blocked:number}>} 旧的在前、今天在最后
 */
export function reachSeries(homeDir, { days = 7 } = {}) {
  const root = String(homeDir || '')
  const n = Math.max(1, Math.min(Math.trunc(Number(days) || 7), 60))
  const p = (x) => String(x).padStart(2, '0')
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    out.push({ day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, sent: 0, blocked: 0 })
  }
  const byDay = new Map(out.map((x) => [x.day, x]))
  try {
    for (const r of readJsonl(join(root, 'sent.jsonl'))) {
      if (String(r.kind || '') !== 'reach' || r.sent !== true) continue
      const x = byDay.get(localDayOf(r.at))
      if (x) x.sent += 1
    }
    for (const r of readJsonl(blockedFile(root))) {
      const x = byDay.get(localDayOf(r.at))
      if (x) x.blocked += 1
    }
  } catch { /* 读不到就全 0（别让控制台炸） */ }
  return out
}

/**
 * lib/home-console.mjs —— 「她的家」控制台的后端（2026-10-27，阶段 2「让控制台说真话」）
 * ============================================================================
 * 给 client.js 的「她的家」那一页用：**一次快照看全家底 + 三处写入 + 三张真账**。
 *
 *   GET  /api/douyin-home/snapshot   人设六层 / life / reach / 台账 / 日记 / 归档 /
 *                                    关系档案 / 群印象 / 健康 / 房间，一次读完（前端不用来回请求）
 *   GET  /api/douyin-home/today      今天这一轮真要看的账：轮次 / 发了什么 / 候选证据 /
 *                                    私信进出 / 她自己的台账（ledger 缺失才退回 out/<day>.md，且标 degraded）
 *   GET  /api/douyin-home/account    登录态 / 账号 / Cookie / 聊天模式 / 浏览器 CDP / 健康（默认不探活）
 *   GET  /api/douyin-home/chat       私信记忆 + 当天群消息（只读本地文件，**绝不**调 chat/read）
 *   GET  /api/douyin-home/diary      某天的日记（默认今天）
 *   GET  /api/douyin-home/journal    她的活动台账（按天过滤）
 *   GET  /api/douyin-home/archive    归档里按关键词/日期翻（走 relation.mjs 的 searchArchive）
 *   POST /api/douyin-home/persona    写 home/persona.md（六层；全空 = 删掉，退回后备人设）
 *   POST /api/douyin-home/plan       改 home/life.json 的 plan（她的闹钟）
 *   POST /api/douyin-home/profile    改 memory/profile-<sec_uid>.json（走 relation.mjs 的 updateProfile）
 *
 * 规矩（跟 lib/relation.mjs、lib/state.mjs 一脉相承）：
 *   ① **只读为主**：除了三个 POST，别的都是读；写盘永远先写 `.tmp` 再 rename
 *      （Windows 上有杀软/句柄竞态，rename 失败重试一次），文本 UTF-8 无 BOM、结尾补 \n。
 *   ② **绝不抛**：所有读都 try/catch，坏文件当空；异常一律变成 {ok:false,error} 回给前端，
 *      不让它冒到宿主（宿主那边再兜一层 500）。
 *   ③ 写护栏：POST 必须带 `x-douyin-home: 1`（挡住别的网页顺手改她的家）、body ≤ 64KB、
 *      只收 JSON 对象、未知字段一律忽略。
 *   ④ **不碰 `$DOUYIN_HOME/persona.md` 那份旧的**（主人跟别的程序共用）：读可以（作为后备来源
 *      报告给面板），写永远只写 `home/persona.md`。
 *   ⑤ 三个只读接口都**不联网、不 spawn**：只读本地文件；5 秒内存缓存（三个 POST 写完会 invalidate）。
 *
 * ⭐ 阶段 2 的数据源（两本 append-only 的账，见 index.js / tools/mcp-server.mjs 的发送现场记账）：
 *   home/rounds/<YYYY-MM-DD>.jsonl  {at,why,candidates,picked:[],dropped:{}}   每开一轮一行
 *   home/sent.jsonl                 {at,aweme_id,to,to_id,kind,sent,readback,error,src}  每发/试一条一行
 *   旧数据不能当账：round-evidence.json 每轮覆盖、out/<day>.md 是模型写的报告 ⇒ 只在账本缺失时兜底。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { connect as netConnect } from 'node:net'
import { dirname, join } from 'node:path'
import {
  searchArchive, diaryDates, readDiary,
  loadProfile, updateProfile, listProfiles, listGroups,
} from './relation.mjs'
import { credentialInfo } from './credential.mjs'
// ⭐ fish.3：「她的世界」总开关 + 世界提示词（home/world.json / home/world.md）
import { readWorld, writeWorld, readWorldPrompt, writeWorldPrompt, WORLD_PROMPT_MAX } from './home/world.mjs'
// ⭐ fish.5：「主动联系」策略 + 拦截记录 + 曲线（home/reach.json / reach-blocked.jsonl）
import { readReach, writeReach, reachPolicy, readBlocked, reachSeries, REACH_LIMIT_MAX, DEFAULT_POLICY } from './home/reach.mjs'
// ⭐ fish.9：主动找人（上线搭话的选择性参数 / 待回记录）
import { normalizePresenceSettings, readPresenceState } from './home/presence.mjs'
import { readPending } from './home/anxious.mjs'
// ⭐ fish.12：久坐提醒状态（home/rest.json + settings.rest）
import { readRest } from './home/rest.mjs'
// ⭐ fish.15：主人的兴趣账本（只读进快照）
import { interestsSummary } from './home/interests.mjs'
// ⭐ fish.6：故障表 / 今日花费 / 压缩记录 / 归档保留范围
import { readFaults, faultsFile } from './home/faults.mjs'
import { readUsage, readPricing, estimateCost, pricingFile } from './home/usage.mjs'
import { readCompactions } from './home/compactions.mjs'
import { readSettings, writeSettings, validateRetentionPatch, settingsFile, DEFAULT_RETENTION } from './home/settings.mjs'
// ⭐ fish.22：她自己点赞的开关/上限（面板卡片 → settings.likes）+ 今天已赞
import { normalizeLikeSettings, likesToday, DEFAULT_LIKES } from './home/likes.mjs'
// ⭐ fish.23：她的口味清单（home/taste.md，面板只读/编辑；下一轮值班现读）
import { readTaste } from './home/taste.mjs'

/* ───────────────────────────── 常量 ───────────────────────────── */

/** 写接口的 body 上限：面板只会发几个文本框，64KB 足够；超过直接拒。 */
const MAX_BODY = 64 * 1024
/** 六层的固定顺序（写文件时按这个顺序拼，读的时候不认顺序）。 */
const LAYER_ORDER = ['名字', '她是谁', '性格', '说话方式', '愿景', '补充']
/** 渲染时进正文的三层（名字/她是谁 拼开头，补充放最后）。照 index.js 的 renderHomePersona。 */
const RENDER_BODY = ['性格', '说话方式', '愿景']
/** 主动开口的每日额度（跟 index.js 的 REACH_PER_DAY / reach.json 记账一致，只用于显示）。 */
const REACH_PER_DAY = 3
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** 只读接口的内存缓存时长（她的家是实时状态，5 秒够用；写操作会主动 invalidate）。 */
const CACHE_MS = 5000
/** 只对**本机回环**放开 CORS（面板跟宿主可能不同 origin，但不给外部网页开门）。 */
const LOOPBACK_RE = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i
/** CDP 探活只管本机：连上就算浏览器在，连不上就报 false（400ms 超时，别拖慢面板）。 */
const CDP_PROBE_MS = 400
const PACKAGE_URL = new URL('../package.json', import.meta.url)
const DEFAULT_PERSONA_URL = new URL('../prompts/persona.default.md', import.meta.url)

/* ─────────────────────── 小工具（全部不抛） ─────────────────────── */

/** 读出来的文本先剥 BOM —— 用 PowerShell 写出来的文件常带 EF BB BF，肉眼看不出、解析会坏。 */
const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}

/** 本地日期（跟 state.mjs 的 dayKey 同口径；factory 里会优先用外面注入的那个）。 */
function localDayKey(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

function ensureDir(dir) {
  try { mkdirSync(dir, { recursive: true }) } catch { /* 建不了也别拦着 */ }
}

/** 读文本文件：不存在/读不出都返回 null（区分「文件在但空」和「没这个文件」）。 */
function readTextOrNull(file) {
  try {
    if (!existsSync(file)) return null
    return stripBom(readFileSync(file, 'utf8'))
  } catch { return null }
}

/** 读 JSON：不存在/坏文件都当 fallback（BOM 先剥再 parse）。 */
function readJsonOr(file, fallback) {
  const text = readTextOrNull(file)
  if (text === null || !text.trim()) return fallback
  try { return JSON.parse(text) } catch { return fallback }
}

/**
 * 读 JSONL：一行一个对象，坏行/空行跳过（账本只追加，半行是正常的）。
 * 返回对象数组；整个文件不在就是空数组。
 */
function readJsonlOr(file) {
  const out = []
  const text = readTextOrNull(file)
  if (!text) return out
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    out.push(row)
  }
  return out
}

/**
 * 原子写文本：strip BOM → 补齐结尾 \n → 先写同目录 `.tmp` → rename。
 * Windows 上 rename 覆盖已有文件偶尔 EPERM（杀软/句柄），**重试一次**；两次都失败就清掉 tmp 再抛。
 */
function writeTextAtomic(file, text) {
  const body = stripBom(String(text ?? ''))
  const out = body.endsWith('\n') ? body : `${body}\n`
  ensureDir(dirname(file))
  const tmp = `${file}.tmp`
  writeFileSync(tmp, out, 'utf8')
  try {
    renameSync(tmp, file)
  } catch {
    try { renameSync(tmp, file) } catch (e) {
      try { rmSync(tmp, { force: true }) } catch { /* 清不掉就算了 */ }
      throw e
    }
  }
  return out.length
}

/** 原子写 JSON（缩进 1，跟 index.js 里 writeLife 落盘的 life.json 形状一致）。 */
function writeJsonAtomic(file, value) {
  return writeTextAtomic(file, JSON.stringify(value, null, 1))
}

/**
 * 读请求体：≤64KB、只收 JSON 对象。
 * 返回 {value} / {error, code}（code=413 太大、400 不是合法对象）。
 * ⚠️ 超限时**不 destroy**（destroy 会把响应也带走，前端只看到 Failed to fetch）——
 *    而是把剩下的一路丢掉，让 413 还能正常发出去。
 */
function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve) => {
    let size = 0
    let done = false
    const chunks = []
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    req.on('data', (c) => {
      if (done) return
      size += Number(c?.length) || 0
      if (size > limit) {
        finish({ error: `body 太大（上限 ${Math.round(limit / 1024)}KB）`, tooLarge: true, code: 413 })
        try { req.resume() } catch { /* 把剩余流量排掉 */ }
        return
      }
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)))
    })
    req.on('end', () => {
      if (done) return
      let raw = ''
      try { raw = Buffer.concat(chunks).toString('utf8') } catch { raw = '' }
      raw = stripBom(raw)
      if (!raw.trim()) return finish({ value: {} })
      let v
      try { v = JSON.parse(raw) } catch { return finish({ error: 'body 不是合法 JSON', code: 400 }) }
      if (!v || typeof v !== 'object' || Array.isArray(v)) return finish({ error: 'body 必须是 JSON 对象', code: 400 })
      finish({ value: v })
    })
    req.on('error', () => finish({ error: '读请求体失败', code: 400 }))
  })
}

/** 六层的空壳（字段永远齐全，前端不用判 undefined）。 */
const emptyLayers = () => Object.fromEntries(LAYER_ORDER.map((k) => [k, '']))

/**
 * 解析 home/persona.md 的六层：`## 名字` 这种标题，正文到下一个 `##` 之前。
 * 段顺序不定，认的是标题本身（跟 index.js 的 readHomePersona 同一套规则）。
 */
function parseLayers(text) {
  const layers = {}
  let cur = ''
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) { cur = m[1].trim(); layers[cur] = ''; continue }
    if (cur) layers[cur] += `${line}\n`
  }
  for (const k of Object.keys(layers)) layers[k] = layers[k].trim()
  return layers
}

/** 照 dsh-world 的写法拼：`我是<名字>。<她是谁>` + 空行 + 性格/说话方式/愿景（带 # 标题）+ 补充。 */
function renderLayers(layers) {
  const get = (k) => String(layers?.[k] ?? '').trim()
  const name = get('名字')
  const who = get('她是谁')
  const opening = [name ? `我是${name}。` : '', who].filter(Boolean).join('')
  const body = RENDER_BODY.map((k) => (get(k) ? `# ${k}\n${get(k)}` : '')).filter(Boolean)
  const extra = get('补充')
  return [opening, ...body, extra].filter(Boolean).join('\n\n')
}

/** 'HH:MM' → 今天几点几分（今天已过就明天）；after_minutes 走相对时间。跟 index.js 的 parsePlanAt 一致。 */
function parsePlanAt({ at, after_minutes } = {}) {
  const mins = Number(after_minutes)
  if (Number.isFinite(mins) && mins > 0) return new Date(Date.now() + Math.min(mins, 24 * 60) * 60_000)
  const s = String(at ?? '').trim()
  if (!s) return null
  const hm = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (hm) {
    const d = new Date()
    d.setHours(Number(hm[1]), Number(hm[2]), 0, 0)
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
    return d
  }
  const t = new Date(s)
  return Number.isNaN(t.getTime()) ? null : t
}

const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** 读台账（home/journal.jsonl）：一行一条 {at,text}，坏行跳过。 */
function readJournalRows(file) {
  const out = []
  const text = readTextOrNull(file)
  if (!text) return out
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    out.push({ at: String(row.at || ''), text: String(row.text || '') })
  }
  return out
}

/** 数某天归档里有几条能 parse 的行（坏行不算）。 */
function countArchiveLines(file) {
  const text = readTextOrNull(file)
  if (!text) return 0
  let n = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { JSON.parse(line); n += 1 } catch { /* 半行坏行跳过 */ }
  }
  return n
}

/** limit 参数：非法/≤0 用默认值，超过上限就截断。 */
function clampLimit(v, def, max) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return def
  return Math.min(Math.floor(n), max)
}

/**
 * 本机 TCP 探活（只连 127.0.0.1，不连外网）—— 看无头浏览器的 CDP 端口在不在。
 * 连上 = 在，连不上/超时 = 不在；最多等 400ms，别拖慢面板。
 */
function probeTcpPort(port, timeoutMs = CDP_PROBE_MS) {
  return new Promise((resolve) => {
    const p = Number(port)
    if (!Number.isFinite(p) || p <= 0) return resolve(false)
    let done = false
    let sock = null
    const timer = setTimeout(() => finish(false), timeoutMs)
    timer.unref?.()
    function finish(v) {
      if (done) return
      done = true
      try { clearTimeout(timer) } catch { /* 无所谓 */ }
      try { sock?.destroy() } catch { /* 已经关了 */ }
      resolve(v)
    }
    try {
      sock = netConnect({ host: '127.0.0.1', port: p }, () => finish(true))
      sock.on('error', () => finish(false))
      sock.unref?.()
    } catch { finish(false) }
  })
}

/* ═══════════════════════════════ 工厂 ═══════════════════════════════ */

/**
 * 造一个「她的家」控制台后端。
 *
 * @param {object}   opt
 * @param {string}   opt.stateDir       插件家目录（`$DOUYIN_HOME/douyin-duty`）
 * @param {Function} [opt.log]          日志函数（缺省不记；别塞慢活，它在 HTTP 线程上）
 * @param {Function} [opt.dayKey]       本地日期函数（缺省用内置的，跟 state.mjs 同口径）
 * @param {Function} [opt.accountRefresh]  `/account?refresh=1` 才用：现成的探活（session-guard.py）。
 *                                        不注入就只给缓存，并在 degraded 里说明。
 * @param {string}   [opt.dutySessionId]  值班会话 id（`/world` 里报出去，让面板知道自己在控制谁）
 * @returns {{ snapshot: () => object, handle: (req: any, res: any) => Promise<void> }}
 */
export function createHomeConsole({ stateDir, log, dayKey, accountRefresh, dutySessionId = 'douyin-fish-chat-v2' } = {}) {
  const root = String(stateDir || '')
  if (!root) throw new Error('createHomeConsole: stateDir 必填')
  const logger = typeof log === 'function' ? log : () => {}
  const todayKey = typeof dayKey === 'function' ? dayKey : localDayKey
  const refreshAccount = typeof accountRefresh === 'function' ? accountRefresh : null

  const homeDir = join(root, 'home')
  const personaFile = join(homeDir, 'persona.md')
  /** 旧的那份（主人跟别的程序共用）：**只读**，作为「后备人设来源」报告给面板。 */
  const legacyPersonaFile = join(root, 'persona.md')
  const lifeFile = join(homeDir, 'life.json')
  const reachFile = join(homeDir, 'reach.json')
  const journalFile = join(homeDir, 'journal.jsonl')
  const roomDir = join(homeDir, 'room')
  /** ⭐ 阶段2 的两本账（index.js / tools/mcp-server.mjs 在发送现场 append） */
  const roundsDir = join(homeDir, 'rounds')
  const sentFile = join(homeDir, 'sent.jsonl')
  const evidenceFile = join(root, 'round-evidence.json')
  const outDir = join(root, 'out')
  const healthFile = join(root, 'health.json')
  const accountFile = join(root, 'account.json')
  const chatWatchFile = join(root, 'chat-watch-state.json')
  const configFile = join(root, 'config.json')
  const runtimeFile = join(root, 'runtime.json')
  /** ⭐ fish.3：世界开关的两份文件（读写走 lib/home/world.mjs，这里只要路径做缓存签名） */
  const worldJsonFile = join(homeDir, 'world.json')
  const worldMdFile = join(homeDir, 'world.md')
  /** ⭐ fish.6：故障表 / 压缩记录 / 保留策略（同样只做缓存签名；读写走各自模块） */
  const faultsFilePath = faultsFile(homeDir)
  const compactionsFile = join(homeDir, 'compactions.jsonl')
  const settingsFilePath = settingsFile(homeDir)
  const pricingFilePath = pricingFile(homeDir)
  const memoryDir = join(root, 'memory')
  const diaryDir = join(memoryDir, 'diary')
  const archiveDir = join(memoryDir, 'archive')

  /** 任何一段读取坏了都不许拖垮整份快照。 */
  const safe = (fn, fallback) => {
    try { return fn() } catch { return fallback }
  }

  /** 插件版本号（面板角标用；读不到就空串）。 */
  const versionOf = () => safe(() => {
    const text = readTextOrNull(PACKAGE_URL)
    if (!text) return ''
    return String(JSON.parse(text).version || '')
  }, '')

  /** ISO → 本地日期（判断某条账是不是今天的；解析不了返空串，绝不猜）。 */
  const dayOfIso = (iso) => {
    const t = Date.parse(String(iso || ''))
    return Number.isFinite(t) ? todayKey(new Date(t)) : ''
  }

  /** ISO → 多少秒前（没有/坏掉返回 null）。 */
  const ageSecOf = (iso) => {
    const t = Date.parse(String(iso || ''))
    return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 1000)) : null
  }

  /* ── 缓存：只读接口 5 秒；写操作 = invalidate。key 用相关文件 mtimeMs，别的进程改了也立刻失效 ── */
  const routeCache = new Map()
  let snapCache = { at: 0, sig: '', value: null }
  function invalidate() {
    routeCache.clear()
    snapCache = { at: 0, sig: '', value: null }
  }
  function cacheGet(key, fn) {
    const hit = routeCache.get(key)
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
    const value = fn()
    routeCache.set(key, { at: Date.now(), value })
    return value
  }
  async function cacheGetAsync(key, fn) {
    const hit = routeCache.get(key)
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
    const value = await fn()
    routeCache.set(key, { at: Date.now(), value })
    return value
  }
  /** 快照缓存签名：这些文件变了她家里就有变化，立刻重算（不必等 5 秒）。 */
  function snapshotSig() {
    const files = [
      personaFile, legacyPersonaFile, lifeFile, reachFile, journalFile, healthFile,
      worldJsonFile, worldMdFile, faultsFilePath, compactionsFile, settingsFilePath, pricingFilePath,
      // ⭐ fish.12：久坐状态变化也要让快照缓存失效
      join(homeDir, 'rest.json'),
      // ⭐ fish.15：兴趣账本变了也让快照缓存失效
      join(homeDir, 'interests.json'),
    ]
    return files.map((f) => safe(() => {
      const st = statSync(f)
      return `${st.mtimeMs}:${st.size}`
    }, '0')).join('|')
  }

  /** 人设：home 那份 → $DOUYIN_HOME 那份（只读）→ 默认中性。 */
  function personaState() {
    const homeText = readTextOrNull(personaFile)
    if (homeText !== null) {
      const layers = { ...emptyLayers(), ...parseLayers(homeText) }
      // 有六层就按六层拼；文件里不是 `##` 结构（比如手写的一段话）就原样当渲染结果，别丢内容
      return { source: 'home/persona.md', layers, rendered: renderLayers(layers) || homeText.trim() }
    }
    const legacyText = readTextOrNull(legacyPersonaFile)
    if (legacyText !== null) {
      const layers = { ...emptyLayers(), ...parseLayers(legacyText) }
      return { source: '$DOUYIN_HOME/persona.md', layers, rendered: renderLayers(layers) || legacyText.trim() }
    }
    const defText = readTextOrNull(DEFAULT_PERSONA_URL)
    return { source: 'default', layers: emptyLayers(), rendered: defText ? defText.trim() : '' }
  }

  /** 空闲小时数：没有/坏掉的 lastActivityAt 返回 null（别编一个 0 出来）。 */
  function idleHoursOf(iso) {
    const t = Date.parse(String(iso || ''))
    if (!Number.isFinite(t)) return null
    return Math.max(0, Math.round(((Date.now() - t) / 3600_000) * 10) / 10)
  }

  /** 关系档案：listProfiles 给排序和基本字段，再补 lastTopic。 */
  function profilesOf() {
    return safe(() => listProfiles(root).slice(0, 200).map((p) => {
      const full = p?.sec_uid ? safe(() => loadProfile(root, p.sec_uid), {}) : {}
      return {
        sec_uid: String(p?.sec_uid || full?.sec_uid || ''),
        nick: String(p?.nick || full?.nick || ''),
        call: String(p?.call || full?.call || ''),
        stage: String(p?.stage || full?.stage || '生'),
        impression: String(p?.impression || full?.impression || ''),
        lastTopic: String(full?.lastTopic || ''),
        rounds: Number(p?.rounds || full?.rounds || 0),
        lastSeenAt: String(p?.lastSeenAt || full?.lastSeenAt || ''),
      }
    }).filter((p) => p.sec_uid), [])
  }

  /** ⭐ fish.10 D：群印象带上每个人的 impression（members 仍是数组，元素升级为 {name,impression,count,lastSeenAt}），
   *  另给 memberNames / memberCount 方便老 UI 显示。 */
  function groupsOf() {
    return safe(() => {
      const dir = join(root, 'memory')
      let files = []
      try { files = readdirSync(dir).filter((n) => /^group-.*\.json$/.test(n)) } catch { return [] }
      return files.map((n) => {
        let j = null
        try { j = JSON.parse(readFileSync(join(dir, n), 'utf8')) } catch { return null }
        if (!j || typeof j !== 'object' || Array.isArray(j)) return null
        const membersObj = j.members && typeof j.members === 'object' && !Array.isArray(j.members) ? j.members : {}
        const members = Object.entries(membersObj).map(([name, v]) => ({
          name: String(name),
          impression: String((v && v.impression) || ''),
          count: Number(v && v.count) || Number(v && v.seen) || 0,
          lastSeenAt: String((v && v.lastSeenAt) || ''),
        }))
        return {
          title: String(j.title || n.replace(/^group-|\.json$/g, '')),
          impression: String(j.impression || ''),
          members,
          memberNames: members.map((m) => m.name),
          memberCount: members.length,
        }
      }).filter(Boolean).slice(0, 100)
    }, [])
  }

  /** 房间：只列文件（子目录不算「房间里的东西」），名字排一下序。 */
  function roomFiles() {
    return safe(() => readdirSync(roomDir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .sort(), [])
  }

  /**
   * 全家底快照。契约固定（前端按这个写）：
   * { ok, now, version, persona:{source,layers,rendered}, life, reach, journal, diary,
   *   profiles, groups, archive, health, room }
   */
  function buildSnapshot() {
    try {
      const now = new Date()
      const today = todayKey(now)
      const version = versionOf()

      // ── 人设 ──
      const pn = safe(() => personaState(), { source: 'default', layers: emptyLayers(), rendered: '' })
      const persona = { source: pn.source, layers: pn.layers, rendered: pn.rendered }

      // ── 她的节奏（life.json）──
      const life = readJsonOr(lifeFile, {}) || {}
      const invites = life.invites && typeof life.invites === 'object' && !Array.isArray(life.invites)
        ? { day: String(life.invites.day || ''), n: Number(life.invites.n) || 0 }
        : { day: '', n: 0 }
      const lifeOut = {
        plan: life.plan || null,
        lastFire: life.lastFire || null,
        lastActivityAt: String(life.lastActivityAt || ''),
        idleHours: idleHoursOf(life.lastActivityAt),
        invites,
      }

      // ── 主动开口（reach.json）：跨天自动归零，别把昨天的额度显示成今天的 ──
      const reach = readJsonOr(reachFile, {}) || {}
      const reachPolicyNow = safe(() => reachPolicy(homeDir), { ...DEFAULT_POLICY })
      const reachDay = String(reach.day || '')
      const reachOut = {
        day: reachDay === today ? reachDay : today,
        count: reachDay === today ? Number(reach.count) || 0 : 0,
        limit: Number(reachPolicyNow.limit) || REACH_PER_DAY,
        history: Array.isArray(reach.history) ? reach.history : [],
        // ⭐ fish.5：只**加**键（旧键 day/count/limit/history 一个不动）
        policy: reachPolicyNow,
      }

      // ── 台账（journal.jsonl）──
      const jrows = safe(() => readJournalRows(journalFile), [])
      const journalOut = { count: jrows.length, latest: jrows.slice(-10) }

      // ── 日记 ──
      const dtext = safe(() => readDiary(root, today), '')
      const diaryOut = {
        dates: safe(() => diaryDates(root), []),
        todayDate: today,
        todayChars: String(dtext || '').trim().length,
      }

      // ── 归档（数天数 + 今天几条）──
      const archiveDays = safe(() => readdirSync(archiveDir)
        .filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).length, 0)
      const archiveOut = { days: archiveDays, todayCount: countArchiveLines(join(archiveDir, `${today}.jsonl`)) }

      // ── 健康 / 房间 ──
      const healthRaw = readJsonOr(healthFile, {})
      const health = healthRaw && typeof healthRaw === 'object' && !Array.isArray(healthRaw) ? healthRaw : {}

      // ── 她的世界（fish.3）：总开关 + 世界提示词字数 ──
      const w = safe(() => readWorld(homeDir), { enabled: true, startedAt: '', stoppedAt: null })
      const worldOut = {
        enabled: w.enabled !== false,
        startedAt: String(w.startedAt || ''),
        stoppedAt: w.stoppedAt || null,
      }
      const worldPromptOut = { chars: safe(() => readWorldPrompt(homeDir).length, 0) }

      // ── ⭐ fish.12：久坐提醒（只读；方便以后做 UI）──
      const restOut = safe(() => {
        const st = readRest(homeDir)
        const pr = readPresenceState(homeDir)
        const lastMs = Date.parse(String(pr.lastAt || ''))
        const online = Number.isFinite(lastMs) && Date.now() - lastMs <= 2 * 60_000
        const startMs = Date.parse(String(st.sessionStart || ''))
        const sessionMinutes = online && Number.isFinite(startMs) ? Math.max(0, Math.round((Date.now() - startMs) / 60_000)) : 0
        return {
          enabled: st.enabled,
          afterMin: st.afterMin,
          maxTimes: st.maxTimes,
          intervalMin: st.intervalMin,
          sessionMinutes,
          count: Number(st.count) || 0,
          lastAt: String(st.lastAt || ''),
        }
      }, { enabled: true, afterMin: 40, maxTimes: 4, intervalMin: 8, sessionMinutes: 0, count: 0, lastAt: '' })

      // ── ⭐ fish.15：主人的兴趣账本（只读：stats / topKeywords / lastShared）──
      const interestsOut = safe(() => interestsSummary(homeDir), {
        stats: { shared: 0, liked: 0, disliked: 0 }, topKeywords: [], lastShared: null,
      })

      return {
        ok: true,
        now: now.toISOString(),
        version,
        persona,
        life: lifeOut,
        reach: reachOut,
        journal: journalOut,
        diary: diaryOut,
        profiles: profilesOf(),
        groups: groupsOf(),
        archive: archiveOut,
        health,
        room: { files: roomFiles() },
        world: worldOut,
        worldPrompt: worldPromptOut,
        // ⭐ fish.6：只加键（故障表 / 最近 3 条压缩记录）
        faults: safe(() => readFaults(homeDir), []),
        compactions: safe(() => readCompactions(homeDir, 3), []),
        // ⭐ fish.12：只加键（久坐提醒状态）
        rest: restOut,
        // ⭐ fish.15：只加键（主人的兴趣账本）
        interests: interestsOut,
      }
    } catch (e) {
      // 快照本身也不许抛：给前端一个「哪儿都没读到」的空壳，但把原因带上
      return { ok: false, error: String(e?.message ?? e), now: new Date().toISOString(), version: '' }
    }
  }

  /** 快照带缓存：5 秒内且相关文件没变 ⇒ 直接给上次的；POST 写完会 invalidate。 */
  function snapshot() {
    try {
      const sig = snapshotSig()
      const now = Date.now()
      if (snapCache.value && snapCache.sig === sig && now - snapCache.at < CACHE_MS) return snapCache.value
      const value = buildSnapshot()
      snapCache = { at: now, sig, value }
      return value
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e), now: new Date().toISOString(), version: '' }
    }
  }

  /* ═══════════════════════ ⭐ 她的世界（fish.3：开始/停止） ═══════════════════════ */

  /** /world 的返回体（GET 与 POST 共用）：开关状态 + 已运行秒数 + 世界提示词字数。 */
  function worldPayload() {
    const w = safe(() => readWorld(homeDir), { enabled: true, startedAt: '', stoppedAt: null })
    const text = safe(() => readWorldPrompt(homeDir), '')
    const enabled = w.enabled !== false
    const startMs = Date.parse(String(w.startedAt || ''))
    return {
      ok: true,
      enabled,
      startedAt: String(w.startedAt || ''),
      stoppedAt: w.stoppedAt || null,
      // 没开始过 / 已暂停 ⇒ null（别编一个 0 出来）；前端显示「—」就行
      uptimeSec: enabled && Number.isFinite(startMs) ? Math.max(0, Math.round((Date.now() - startMs) / 1000)) : null,
      sessionId: dutySessionId,
      worldPromptChars: text.length,
    }
  }

  /* ═══════════════════════ ⭐ 主动联系（fish.5：策略 / 额度 / 拦截 / 曲线） ═══════════════════════ */

  /**
   * /reach 的返回体（GET 与 POST 共用）。
   * recent = reach.history（发送，只有它保留正文）+ blocked（拦截）按时间倒序合并，≤20。
   * ⚠️ sent.jsonl 里 kind=reach 的行**没有正文**（只有 to），所以 recent 的发送侧用 history。
   */
  function reachSummary() {
    const info = safe(() => readReach(homeDir), { day: '', count: 0, history: [], policy: { ...DEFAULT_POLICY } })
    const policy = safe(() => reachPolicy(homeDir), info.policy || { ...DEFAULT_POLICY })
    const today = todayKey(new Date())
    const count = String(info.day || '') === today ? Number(info.count) || 0 : 0
    const history = (Array.isArray(info.history) ? info.history : []).slice(-50).map((h) => ({
      at: String(h?.at || ''), to: String(h?.to || ''), text: String(h?.text || ''),
    }))
    const blocked = safe(() => readBlocked(homeDir, { days: 7, limit: 50 }), [])
      .map((b) => ({ at: String(b.at || ''), to: String(b.to || ''), reason: String(b.reason || '') }))
    const series = safe(() => reachSeries(homeDir, { days: 7 }), [])
    // ⭐ fish.9：上线搭话的选择性参数（settings.presence）+ 待回记录
    const settings = safe(() => readSettings(homeDir), null)
    const presence = normalizePresenceSettings((settings && settings.presence) || {})
    const pendingRows = safe(() => readPending(homeDir), [])
    const pendingItems = pendingRows.slice(-20).map((r) => ({ at: r.at, to: r.to, kind: r.kind, text: r.text }))
    const recent = [
      ...history.map((h) => ({ at: h.at, kind: 'sent', to: h.to, text: h.text, reason: '' })),
      ...blocked.map((b) => ({ at: b.at, kind: 'blocked', to: b.to, text: '', reason: b.reason })),
    ].filter((x) => x.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20)
    return {
      ok: true,
      enabled: policy.enabled !== false,
      dryRun: policy.dryRun === true,
      policy: { limit: policy.limit, quietFrom: policy.quietFrom, quietTo: policy.quietTo, stages: policy.stages },
      today: { day: today, count, limit: policy.limit },
      history,
      blocked,
      series,
      recent,
      // ⭐ fish.9：presence 只有选择性参数（enabled/chance/cooldownMin/maxPerDay）；pending 是他还没回的消息
      presence: { enabled: presence.enabled, chance: presence.chance, cooldownMin: presence.cooldownMin, maxPerDay: presence.maxPerDay },
      pending: { count: pendingRows.length, items: pendingItems },
    }
  }

  /* ═══════════════════════ ⭐ 今天到底发生了什么（真账） ═══════════════════════ */

  /** 读某天的轮次账本；账本不存在返回 null（让上层决定要不要退回 md 兜底）。 */
  function readRounds(day) {
    const file = join(roundsDir, `${day}.jsonl`)
    if (!existsSync(file)) return null
    return readJsonlOr(file).map((r) => ({
      at: String(r.at || ''),
      why: String(r.why || ''),
      candidates: Number(r.candidates) || 0,
      pickedCount: Array.isArray(r.picked) ? r.picked.length : 0,
    }))
  }

  /**
   * 旧数据兜底：解析 out/<day>.md。
   * ⚠️ 这是**模型写的报告**，不是账 —— 只在账本缺失时用，结果必须标 degraded。
   *   能拿到：轮次时间（本轮 HH:MM）、每轮证据包条数（证据包 N 条）、已发卡片（已发卡片：<id>（谁、谁））。
   */
  function parseOutMd(day) {
    const text = readTextOrNull(join(outDir, `${day}.md`))
    if (text === null) return null
    // 证据包条数的位置（给每轮配对用）
    const cands = []
    for (const m of text.matchAll(/证据包\s*(\d+)\s*条/g)) cands.push({ pos: m.index, n: Number(m[1]) })
    const rounds = []
    let ci = 0
    for (const m of text.matchAll(/本轮\s*(\d{1,2}:\d{2})/g)) {
      const hm = m[1].split(':')
      const d = new Date(`${day}T00:00:00`)
      if (Number.isNaN(d.getTime())) continue
      d.setHours(Number(hm[0]), Number(hm[1]), 0, 0)
      while (ci < cands.length && cands[ci].pos < m.index) ci += 1
      rounds.push({
        at: d.toISOString(),
        why: 'md-fallback',
        candidates: ci < cands.length ? cands[ci].n : 0,
        pickedCount: 0,
      })
    }
    const cards = []
    // ✓ 两种都见过：`已发卡片：<id>（示例主人、示例好友）` 和光秃秃的 `已发卡片：<id>` —— 括号是可选的
    for (const m of text.matchAll(/已发卡片\s*[：:]\s*(\d{15,25})(?:\s*（([^）]*)）)?/g)) {
      cards.push({ aweme_id: m[1], to: String(m[2] || '').trim() })
    }
    return { rounds, cards }
  }

  /** /today：轮次 / 发送 / 候选证据 / 私信进出 / 她的台账。每块都独立降级，缺什么说什么。 */
  function todayPayload(day) {
    const degraded = []

    // ── ① 她自己的活动台账（home/journal.jsonl）──
    const journal = safe(() => readJournalRows(journalFile).filter((r) => dayOfIso(r.at) === day), [])
    if (!journal.length) degraded.push('她的活动台账今天还是空的（home/journal.jsonl）')

    // ── ② 轮次账本；缺了才退回 out/<day>.md ──
    let md = null
    let rounds = safe(() => readRounds(day), null)
    if (!rounds) {
      md = safe(() => parseOutMd(day), null)
      if (md && md.rounds.length) {
        rounds = md.rounds
        degraded.push(`轮次账本缺失（home/rounds/${day}.jsonl）—— 轮次是从 out/${day}.md 兜底解析的（模型写的报告，不是账）`)
      } else {
        rounds = []
        degraded.push(`轮次账本和 out/${day}.md 都没有 —— 今天没有可查的轮次`)
      }
    }

    // ── ③ 发送账本；没有就问 md 要（md 只记"发成功的卡片"，失败/回读拿不到）──
    const sentHasFile = existsSync(sentFile)
    let sent = []
    if (sentHasFile) {
      sent = readJsonlOr(sentFile)
        .filter((r) => dayOfIso(r.at) === day)
        .map((r) => ({
          at: String(r.at || ''),
          aweme_id: String(r.aweme_id || ''),
          to: String(r.to || ''),
          ok: r.sent === true,
          readback: r.readback === true,
          reason: String(r.error || ''),
          kind: String(r.kind || ''),
          src: String(r.src || ''),
        }))
    } else {
      if (!md) md = safe(() => parseOutMd(day), null)
      // md 里同一条卡片可能被报告重复写（模型按轮复述）⇒ 只去重「id+收件人」完全相同的行
      const seenCard = new Set()
      const cards = (md ? md.cards : []).filter((c) => {
        const k = `${c.aweme_id}|${c.to}`
        if (seenCard.has(k)) return false
        seenCard.add(k)
        return true
      })
      sent = cards.map((c) => ({
        at: '',
        aweme_id: c.aweme_id,
        to: c.to,
        ok: true,
        readback: null,
        reason: '',
        kind: 'card',
        src: 'md',
      }))
      degraded.push(cards.length
        ? `发送账本缺失（home/sent.jsonl）—— 已发卡片是从 out/${day}.md 兜底解析的：只有"发成功"，没有失败/回读`
        : `发送账本缺失（home/sent.jsonl），out/${day}.md 里也没解析出已发卡片`)
    }

    // ── ④ 候选证据（round-evidence.json 是"最近一轮"的快照，不是按天存的）──
    const ev = readJsonOr(evidenceFile, null)
    let candidates = null
    if (ev && typeof ev === 'object' && !Array.isArray(ev) && dayOfIso(ev.builtAt) === day) {
      const list = Array.isArray(ev.list) ? ev.list : []
      candidates = {
        builtAt: String(ev.builtAt || ''),
        count: Number(ev.count) || list.length,
        dropped: ev.dropped && typeof ev.dropped === 'object' && !Array.isArray(ev.dropped) ? ev.dropped : {},
        list: list.slice(0, 40).map((it) => ({
          aweme_id: String(it?.aweme_id || ''),
          desc: String(it?.desc || '').slice(0, 160),
          author: String(it?.author || ''),
          duration_s: Number(it?.duration_s) || 0,
          ratios: it?.ratios && typeof it.ratios === 'object' && !Array.isArray(it.ratios) ? it.ratios : {},
          web_url: String(it?.web_url || ''),
        })),
      }
    } else {
      degraded.push(ev
        ? `round-evidence.json 是别的日子的（${String(ev.builtAt || '?')}）—— 今天的候选证据读不到`
        : 'round-evidence.json 不存在 —— 今天的候选证据读不到')
    }
    const picked = candidates
      ? candidates.list.map((it) => ({ aweme_id: it.aweme_id, desc: it.desc, author: it.author, url: it.web_url, at: candidates.builtAt }))
      : []

    // ── ⑤ 私信进出（只从当天的聊天归档数，别拿记忆文件冒充）──
    const arch = safe(() => readJsonlOr(join(archiveDir, `${day}.jsonl`)), [])
    if (!arch.length) degraded.push(`没有 ${day} 的聊天归档（memory/archive/${day}.jsonl）—— 私信进出数量读不到`)
    const dmRows = arch.filter((r) => String(r.channel || '') === 'dm')
    const dmIn = dmRows.filter((r) => r.from === 'them').length
    const dmOut = dmRows.filter((r) => r.from === 'me').length

    return {
      ok: true,
      day,
      now: new Date().toISOString(),
      counts: {
        rounds: rounds.length,
        picked: picked.length,
        sent: sent.filter((x) => x.ok).length,
        dmIn,
        dmOut,
      },
      rounds,
      picked,
      sent,
      candidates,
      journal,
      degraded,
    }
  }

  /* ═══════════════════════ ⭐ 账号 / 登录 / 浏览器（不探活是默认） ═══════════════════════ */

  async function accountPayload(force) {
    const degraded = []
    const cfg = readJsonOr(configFile, {}) || {}
    const cred = safe(() => credentialInfo(root), {
      hasCredential: false, keys: [], important: [], bytes: 0, at: null,
    })

    const normalized = (a) => (a && typeof a === 'object' && !Array.isArray(a)
      ? { nick: String(a.nick || ''), uid: String(a.uid || ''), alive: a.alive === true, at: String(a.at || '') }
      : null)
    let account = normalized(readJsonOr(accountFile, null))
    let loggedIn = cred.hasCredential === true
    if (!loggedIn) degraded.push('还没登录：douyin_cookie.txt 是空的')

    // 默认**不探活**：只有 refresh=1 才走 index.js 那套现成的 /api/douyin-duty/account（session-guard.py）
    if (force) {
      if (refreshAccount) {
        try {
          const r = await refreshAccount()
          if (r && r.account) account = normalized(r.account) || account
          if (r && r.logged_in === false) loggedIn = false
          if (!r || r.ok === false) degraded.push(`实时探活没成功：${String(r?.error || r?.hint || '未知原因')}`)
        } catch (e) { degraded.push(`实时探活出错：${String(e?.message ?? e)}`) }
      } else {
        degraded.push('没接上实时探活（accountRefresh 没注入）—— 只能给缓存')
      }
    }

    // Cookie 概览（**只给名字和大小，绝不给值**）
    const cookie = {
      keys: Array.isArray(cred.important) && cred.important.length
        ? cred.important
        : (Array.isArray(cred.keys) ? cred.keys.slice(0, 8) : []),
      keyCount: Array.isArray(cred.keys) ? cred.keys.length : 0,
      bytes: Number(cred.bytes) || 0,
      at: cred.at || null,
    }

    // 聊天模式（chat-watch-state.json 是最后已知状态；开关值以配置里的为准，别把"关掉了但残留的 on:true"当真）
    const cw = readJsonOr(chatWatchFile, {}) || {}
    const on = cfg.chatWatch === true
    const sec = Number(cw.sec || cfg.chatWatchSec || 30) || 30
    const lastCheckMs = Number(cw.lastCheckAt || cw.ts || 0) || 0
    const chatWatch = {
      on,
      sec,
      lastCheckAt: lastCheckMs ? new Date(lastCheckMs).toISOString() : null,
      lastResult: String(cw.lastResult || ''),
      ageSec: lastCheckMs ? Math.max(0, Math.round((Date.now() - lastCheckMs) / 1000)) : null,
    }

    // 无头浏览器：只连本机 CDP 端口探一下（不启浏览器、不联网）
    const rt = readJsonOr(runtimeFile, {}) || {}
    const cdpPort = Number(rt.cdpPort) || 0
    if (!cdpPort) degraded.push('runtime.json 里没有 cdpPort —— 不知道无头浏览器在哪个端口')
    const alive = cdpPort > 0 ? await probeTcpPort(cdpPort) : false

    // 健康信号
    const h = readJsonOr(healthFile, {}) || {}
    const health = {
      ts: String(h.ts || ''),
      ageSec: ageSecOf(h.ts),
      dutyRunning: h.dutyRunning === true,
      venvReady: h.venvReady === true,
      alerts: Array.isArray(h.alerts) ? h.alerts : [],
    }

    return {
      ok: true,
      logged_in: loggedIn,
      account: account ? { ...account, ageSec: ageSecOf(account.at) } : null,
      cookie,
      chatWatch,
      browser: { cdpPort, alive },
      health,
      degraded,
    }
  }

  /* ═══════════════════════ ⭐ 聊天（只读记忆 + 当天归档） ═══════════════════════ */

  /**
   * /chat：私信记忆（每人最近 80 条，来自 memory/dm-*.json）+ 当天群消息（来自 memory/archive/<day>.jsonl）。
   * ⭐ 只读本地文件 —— **绝不**调用 chat/read / im-send --read（那会起浏览器、还会写记忆文件）。
   * needsReply = 这个人的最后一条是 them（她还没回）。
   */
  function chatPayload(date, person, limit) {
    const degraded = []
    const want = String(person || '').trim()
    const people = []

    let dmFiles = []
    try { dmFiles = readdirSync(memoryDir).filter((n) => /^dm-.*\.json$/.test(n)) } catch { dmFiles = [] }
    if (!dmFiles.length) degraded.push('没有私信记忆（memory/dm-*.json 不存在）—— 她还没记住任何人的对话')

    for (const f of dmFiles) {
      const j = readJsonOr(join(memoryDir, f), null)
      if (!j || typeof j !== 'object' || Array.isArray(j)) continue
      const who = j.who && typeof j.who === 'object' ? j.who : {}
      const secUid = String(who.sec_uid || '')
      const nick = String(who.nick || '')
      if (want && !(nick === want || secUid === want || (nick && nick.includes(want)) || (secUid && secUid.includes(want)))) continue
      const msgs = (Array.isArray(j.messages) ? j.messages : [])
        .filter((m) => m && String(m.text || '').trim())
        .map((m) => ({
          at: String(m.at || ''),
          from: m.from === 'me' ? 'me' : (m.from === 'them' ? 'them' : 'unknown'),
          text: String(m.text || '').slice(0, 400),
          kind: String(m.kind || 'text'),
        }))
      const last = msgs.length ? msgs[msgs.length - 1] : null
      const prof = secUid ? safe(() => loadProfile(root, secUid), {}) : {}
      people.push({
        nick: nick || String(prof.nick || ''),
        sec_uid: secUid,
        stage: String(prof.stage || '生'),
        lastAt: (last && last.at) || String(j.updatedAt || ''),
        lastFrom: (last && last.from) || '',
        needsReply: Boolean(last && last.from === 'them'),
        messages: msgs.slice(-limit),
      })
    }
    people.sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')))

    // 群：归档是按天存的 —— 只有群消息能按 date 过滤
    const groups = []
    const arch = safe(() => readJsonlOr(join(archiveDir, `${date}.jsonl`)), [])
    if (!arch.length) degraded.push(`没有 ${date} 的归档（memory/archive/${date}.jsonl）—— 群里今天说了什么读不到`)
    const byGroup = new Map()
    for (const r of arch) {
      if (String(r.channel || '') !== 'group') continue
      const title = String(r.who || '')
      if (!title) continue
      if (!byGroup.has(title)) byGroup.set(title, [])
      byGroup.get(title).push({
        at: String(r.at || ''),
        from: r.from === 'me' ? 'me' : (r.from === 'them' ? 'them' : 'unknown'),
        text: String(r.text || '').slice(0, 400),
        kind: String(r.kind || 'text'),
      })
    }
    for (const [title, msgs] of byGroup) {
      groups.push({ title, lastAt: (msgs[msgs.length - 1] || {}).at || '', messages: msgs.slice(-limit) })
    }
    groups.sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')))
    if (date !== todayKey(new Date())) {
      degraded.push(`私信部分来自记忆（每人最近 80 条），不按 ${date} 过滤 —— 只有群消息是按天的`)
    }

    return { ok: true, date, people, groups, degraded }
  }

  /* ─────────────── HTTP：自己解析 URL、自己回 JSON ─────────────── */

  /** 只对回环 origin 放开（面板/桌宠可能不同端口，但外部网页一律不开门）。 */
  function applyCors(req, res) {
    try {
      const origin = String(req?.headers?.origin || '')
      res.setHeader?.('vary', 'Origin')
      res.setHeader?.('access-control-allow-methods', 'GET,POST,OPTIONS')
      res.setHeader?.('access-control-allow-headers', 'content-type,x-douyin-home')
      res.setHeader?.('access-control-max-age', '600')
      if (LOOPBACK_RE.test(origin)) res.setHeader?.('access-control-allow-origin', origin)
    } catch { /* 头写不进去不该影响业务 */ }
  }

  /** 唯一的回包口子：JSON + no-store（她的家是实时状态，别让中间层缓存）。 */
  function sendJson(res, code, body) {
    try {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    } catch { try { res.end?.() } catch { /* 已经发过头了 */ } }
  }

  const bad = (res, code, error, extra) => sendJson(res, code, { ok: false, error, ...(extra || {}) })

  const normalizePath = (p) => {
    const s = String(p || '/')
    const t = s.length > 1 ? s.replace(/\/+$/, '') : s
    return t || '/'
  }

  /** 写接口的 body：读 + 拆包，失败直接回 400/413。 */
  async function jsonBodyOrReject(req, res) {
    const r = await readBody(req)
    if (r.error) { bad(res, r.code || 400, r.error); return null }
    return r.value
  }

  async function handle(req, res) {
    const method = String(req?.method || 'GET').toUpperCase()
    let path = '/'
    try {
      applyCors(req, res)
      const url = new URL(String(req?.url || '/'), 'http://127.0.0.1')
      path = normalizePath(url.pathname)

      // 预检：浏览器带自定义头 POST 之前会先来一发 OPTIONS
      if (method === 'OPTIONS') {
        try { res.writeHead(204); res.end() } catch { /* 发不出就算了 */ }
        return
      }

      // 🔴 写护栏：所有 POST 都必须带 `x-douyin-home: 1`（防别的网页顺手改她的家）
      if (method === 'POST' && String(req?.headers?.['x-douyin-home'] ?? '') !== '1') {
        return bad(res, 403, '写操作要带请求头 x-douyin-home: 1')
      }

      /* ── GET /snapshot ── */
      if (method === 'GET' && path === '/api/douyin-home/snapshot') {
        return sendJson(res, 200, snapshot())
      }

      /* ── GET /world ── 她的世界总开关（停止 = 她不再醒来、不再活动） */
      if (method === 'GET' && path === '/api/douyin-home/world') {
        return sendJson(res, 200, worldPayload())
      }

      /* ── POST /world {enabled:true|false} ──
       * 开：记 startedAt（重新计时）；关：记 stoppedAt、清 startedAt；两次都留 history（最近 20 次）。
       * 状态没变就只回当前值，不动时间戳（防前端重复点把 uptime 清零）。 */
      if (method === 'POST' && path === '/api/douyin-home/world') {
        const body = await jsonBodyOrReject(req, res)
        if (!body) return
        if (typeof body.enabled !== 'boolean') return bad(res, 400, 'enabled 要布尔值 true 或 false')
        const cur = safe(() => readWorld(homeDir), { enabled: true, startedAt: '', stoppedAt: null, history: [] })
        const now = new Date().toISOString()
        if ((cur.enabled !== false) !== body.enabled) {
          const history = [...(Array.isArray(cur.history) ? cur.history : []), { at: now, enabled: body.enabled }].slice(-20)
          writeWorld(homeDir, body.enabled
            ? { enabled: true, startedAt: now, stoppedAt: null, history }      // 开：从现在重新计时
            : { enabled: false, startedAt: '', stoppedAt: now, history })      // 关：清 startedAt、留 stoppedAt
          invalidate()
          logger(`她的世界：${body.enabled ? '开始（她可以醒了）' : '暂停（她不再醒来）'}`)
        }
        return sendJson(res, 200, worldPayload())
      }

      /* ── GET /world-prompt ── 她的世界提示词（排在人设之前，她自己也能改） */
      if (method === 'GET' && path === '/api/douyin-home/world-prompt') {
        const text = safe(() => readWorldPrompt(homeDir), '')
        return sendJson(res, 200, { ok: true, text, chars: text.length, max: WORLD_PROMPT_MAX })
      }

      /* ── POST /world-prompt {text} ── 写 home/world.md（≤4000 字；空 = 删文件） */
      if (method === 'POST' && path === '/api/douyin-home/world-prompt') {
        const body = await jsonBodyOrReject(req, res)
        if (!body) return
        const raw = typeof body.text === 'string' ? body.text : ''
        const text = stripBom(raw).replace(/\r\n?/g, '\n').trim()
        if (text.length > WORLD_PROMPT_MAX) {
          return bad(res, 400, `世界提示词最多 ${WORLD_PROMPT_MAX} 字（现在 ${text.length} 字）`)
        }
        const r = writeWorldPrompt(homeDir, text)
        if (!r.ok) return bad(res, 500, '写 home/world.md 失败（看 duty.log）')
        invalidate()
        logger(`她的世界：世界提示词已保存（${r.chars} 字）${r.chars ? '' : '（空 = 已删掉 home/world.md）'}`)
        return sendJson(res, 200, { ok: true, text: r.text, chars: r.chars, max: WORLD_PROMPT_MAX })
      }

      /* ── GET /reach ── 主动联系：策略 + 今天额度 + 拦截记录 + 最近 7 天曲线 ── */
      if (method === 'GET' && path === '/api/douyin-home/reach') {
        return sendJson(res, 200, reachSummary())
      }

      /* ── POST /reach {enabled?,dryRun?,limit?,quietFrom?,quietTo?,presence?} ──
       * 只认这五个策略字段 + presence 选择性参数（未知字段忽略）；非法值直接 400。 */
      if (method === 'POST' && path === '/api/douyin-home/reach') {
        const body = await jsonBodyOrReject(req, res)
        if (!body) return
        const patch = {}
        for (const k of ['enabled', 'dryRun']) {
          if (body[k] === undefined) continue
          if (typeof body[k] !== 'boolean') return bad(res, 400, `${k} 要布尔值 true/false`)
          patch[k] = body[k]
        }
        if (body.limit !== undefined) {
          const n = Number(body.limit)
          if (!Number.isInteger(n) || n < 0 || n > REACH_LIMIT_MAX) {
            return bad(res, 400, `limit 要是 0–${REACH_LIMIT_MAX} 的整数`)
          }
          patch.limit = n
        }
        for (const k of ['quietFrom', 'quietTo']) {
          if (body[k] === undefined) continue
          const v = String(body[k] || '').trim()
          if (!/^([01]?\d|2[0-3]):([0-5]\d)$/.test(v)) return bad(res, 400, `${k} 要 HH:MM（00:00–23:59）`)
          patch[k] = v.padStart(5, '0')
        }
        /* ⭐ fish.9：presence = 看到主人上线时的「搭话」选择性（enabled/chance/cooldownMin/maxPerDay） */
        let presencePatch = null
        if (body.presence !== undefined) {
          const raw = body.presence
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad(res, 400, 'presence 要是一个对象')
          const curSettings = safe(() => readSettings(homeDir), null)
          const next = normalizePresenceSettings((curSettings && curSettings.presence) || {})
          if (raw.enabled !== undefined) {
            if (typeof raw.enabled !== 'boolean') return bad(res, 400, 'presence.enabled 要布尔值 true/false')
            next.enabled = raw.enabled
          }
          if (raw.chance !== undefined) {
            const n = Number(raw.chance)
            if (!Number.isFinite(n) || n < 0 || n > 1) return bad(res, 400, 'presence.chance 要是 0–1 的数（0.25 = 每次上线 25% 概率）')
            next.chance = n
          }
          if (raw.cooldownMin !== undefined) {
            const n = Number(raw.cooldownMin)
            if (!Number.isInteger(n) || n < 5 || n > 1440) return bad(res, 400, 'presence.cooldownMin 要是 5–1440 的整数（分钟）')
            next.cooldownMin = n
          }
          if (raw.maxPerDay !== undefined) {
            const n = Number(raw.maxPerDay)
            if (!Number.isInteger(n) || n < 0 || n > 20) return bad(res, 400, 'presence.maxPerDay 要是 0–20 的整数（每天最多搭话几次）')
            next.maxPerDay = n
          }
          presencePatch = next
        }
        if (Object.keys(patch).length) writeReach(homeDir, { policy: patch })
        if (presencePatch) writeSettings(homeDir, { presence: presencePatch })
        if (Object.keys(patch).length || presencePatch) {
          invalidate()
          logger(`主动联系：策略已更新（${JSON.stringify({ ...patch, ...(presencePatch ? { presence: presencePatch } : {}) })}）`)
        }
        return sendJson(res, 200, reachSummary())
      }

      /* ── GET /likes ── 她会自己点赞：开关 + 上限 + 今天已赞 ── */
      if (method === 'GET' && path === '/api/douyin-home/likes') {
        const likes = safe(() => normalizeLikeSettings((readSettings(homeDir) || {}).likes), { ...DEFAULT_LIKES })
        const today = safe(() => likesToday(homeDir), 0)
        return sendJson(res, 200, { ok: true, likes, today })
      }

      /* ── POST /likes {enabled?, perDay?, perRun?} ──
       * 只改 settings.likes，别的段原样保留（writeSettings 是顶层合并）。
       * 坏 JSON 自愈成默认值；越界值由 normalizeLikeSettings 夹范围（enabled 布尔、perDay 1–50、perRun 1–20）。 */
      if (method === 'POST' && path === '/api/douyin-home/likes') {
        const body = await jsonBodyOrReject(req, res)
        if (!body) return
        const raw = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
        const cur = safe(() => normalizeLikeSettings((readSettings(homeDir) || {}).likes), { ...DEFAULT_LIKES })
        const merged = { ...cur }
        if (raw.enabled !== undefined) {
          if (typeof raw.enabled !== 'boolean') return bad(res, 400, 'enabled 要布尔值 true/false')
          merged.enabled = raw.enabled
        }
        if (raw.perDay !== undefined) merged.perDay = Number(raw.perDay)
        if (raw.perRun !== undefined) merged.perRun = Number(raw.perRun)
        const next = normalizeLikeSettings(merged)
        try {
          writeSettings(homeDir, { likes: next })
          invalidate()
          logger(`点赞：设置已更新（${next.enabled ? '开' : '关'}，每天 ${next.perDay}、每轮 ${next.perRun}）`)
        } catch (e) {
          return bad(res, 500, '写 settings.json 失败：' + String(e?.message ?? e).slice(0, 120))
        }
        const today = safe(() => likesToday(homeDir), 0)
        return sendJson(res, 200, { ok: true, likes: next, today })
      }

      /* ── GET /taste ── 她的口味清单（home/taste.md；值班轮现读，改了下一轮生效） ── */
      if (method === 'GET' && path === '/api/douyin-home/taste') {
        const text = safe(() => readTaste(homeDir), '')
        let updatedAt = null
        try { updatedAt = new Date(statSync(join(homeDir, 'taste.md')).mtimeMs).toISOString() } catch { updatedAt = null }
        return sendJson(res, 200, { ok: true, text, chars: text.length, path: 'home/taste.md', updatedAt })
      }

      /* ── POST /taste {text} ── 写 home/taste.md（≤20000 字，允许空；UTF-8 无 BOM + 末尾换行） ── */
      if (method === 'POST' && path === '/api/douyin-home/taste') {
        const body = await jsonBodyOrReject(req, res)
        if (!body) return
        if (typeof body.text !== 'string') return bad(res, 400, 'text 要是字符串')
        const MAX_TASTE = 20000
        const content = stripBom(body.text).replace(/\r\n?/g, '\n')
        if (content.length > MAX_TASTE) {
          return bad(res, 400, `text 太长（${content.length} 字 > ${MAX_TASTE} 字上限）`)
        }
        try {
          writeTextAtomic(join(homeDir, 'taste.md'), content)
        } catch (e) {
          return bad(res, 500, '写 home/taste.md 失败：' + String(e?.message ?? e).slice(0, 120))
        }
        invalidate()
        const warning = content.trim() ? undefined : '空清单 = 她的点赞没有判据'
        logger(`口味清单：已保存（${content.length} 字）${warning ? '（现在是空的）' : ''}`)
        return sendJson(res, 200, {
          ok: true, chars: content.length, updatedAt: new Date().toISOString(),
          ...(warning ? { warning } : {}),
        })
      }

      /* ── GET /today?day=YYYY-MM-DD ── */
      if (method === 'GET' && path === '/api/douyin-home/today') {
        const want = String(url.searchParams.get('day') || '').trim()
        const day = want || todayKey(new Date())
        if (!DATE_RE.test(day)) return bad(res, 400, 'day 要 YYYY-MM-DD')
        return sendJson(res, 200, cacheGet(`today:${day}`, () => todayPayload(day)))
      }

      /* ── GET /account?refresh=1 ── */
      if (method === 'GET' && path === '/api/douyin-home/account') {
        const force = String(url.searchParams.get('refresh') || '') === '1'
        return sendJson(res, 200, await cacheGetAsync(`account:${force ? 1 : 0}`, () => accountPayload(force)))
      }

      /* ── GET /chat?date=&person=&limit= ── */
      if (method === 'GET' && path === '/api/douyin-home/chat') {
        const want = String(url.searchParams.get('date') || '').trim()
        const date = want || todayKey(new Date())
        if (!DATE_RE.test(date)) return bad(res, 400, 'date 要 YYYY-MM-DD')
        const person = String(url.searchParams.get('person') || '').trim().slice(0, 60)
        const limit = clampLimit(url.searchParams.get('limit'), 20, 60)
        return sendJson(res, 200, cacheGet(`chat:${date}:${person}:${limit}`, () => chatPayload(date, person, limit)))
      }

      /* ── GET /diary?date=YYYY-MM-DD ── */
      if (method === 'GET' && path === '/api/douyin-home/diary') {
        const want = String(url.searchParams.get('date') || '').trim()
        const date = want || todayKey(new Date())
        if (!DATE_RE.test(date)) return bad(res, 400, 'date 要 YYYY-MM-DD')
        const text = safe(() => readDiary(root, date), '')
        return sendJson(res, 200, {
          ok: true,
          date,
          text: stripBom(String(text || '')),
          dates: safe(() => diaryDates(root), []),
        })
      }

      /* ── GET /journal?date=&limit= ── */
      if (method === 'GET' && path === '/api/douyin-home/journal') {
        const want = String(url.searchParams.get('date') || '').trim()
        const date = want || todayKey(new Date())
        if (!DATE_RE.test(date)) return bad(res, 400, 'date 要 YYYY-MM-DD')
        const limit = clampLimit(url.searchParams.get('limit'), 100, 500)
        const rows = safe(() => readJournalRows(journalFile), [])
          .filter((r) => dayOfIso(r.at) === date)
          .slice(-limit)
        return sendJson(res, 200, { ok: true, date, rows })
      }

      /* ── GET /archive?q=&date=&limit= ── */
      if (method === 'GET' && path === '/api/douyin-home/archive') {
        const q = String(url.searchParams.get('q') || '').trim().slice(0, 100)
        const want = String(url.searchParams.get('date') || '').trim()
        const date = DATE_RE.test(want) ? want : ''   // 归档是搜索，日期坏了就当没筛，别报错
        const limit = clampLimit(url.searchParams.get('limit'), 40, 200)
        const rows = safe(() => searchArchive(root, { q, date, limit }), [])
        const list = Array.isArray(rows) ? rows : []
        return sendJson(res, 200, { ok: true, count: list.length, rows: list })
      }

      /* ── POST /persona  {layers:{名字,她是谁,性格,说话方式,愿景,补充}} ── */
      if (method === 'POST' && path === '/api/douyin-home/persona') {
        const body = await jsonBodyOrReject(req, res)
        if (!body) return
        const raw = body.layers
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          return bad(res, 400, 'layers 要是一个对象：{名字,她是谁,性格,说话方式,愿景,补充}')
        }
        const layers = emptyLayers()
        for (const k of LAYER_ORDER) {
          const v = raw[k]
          if (v === undefined || v === null) continue
          layers[k] = stripBom(String(v)).replace(/\r\n?/g, '\n').trim()
        }
        // 全空 = 删掉 home/persona.md，退回后备那份（不是写一个空文件）
        if (!LAYER_ORDER.some((k) => layers[k])) {
          let removed = false
          safe(() => {
            if (existsSync(personaFile)) { rmSync(personaFile, { force: true }); removed = true }
          }, null)
          invalidate()
          logger(`她的家：人设清空${removed ? '（已删 home/persona.md）' : ''}`)
          return sendJson(res, 200, { ok: true, cleared: true, deleted: removed, source: safe(() => personaState().source, 'default') })
        }
        const text = LAYER_ORDER.filter((k) => layers[k]).map((k) => `## ${k}\n${layers[k]}`).join('\n\n')
        writeTextAtomic(personaFile, text)
        invalidate()
        logger(`她的家：人设已保存（${text.length} 字）→ ${personaFile}`)
        return sendJson(res, 200, { ok: true, layers, chars: text.length })
      }

      /* ── POST /plan  {at?|after_minutes?|note?, cancel?} ──
       * 注意：契约里没写 note，但它就在 life.json 的 plan 里（到点叫醒要说「定的什么」），
       * 所以这里**可选地**收 note；不传就空着，别拿旧 note 冒充。
       */
      if (method === 'POST' && path === '/api/douyin-home/plan') {
        const body = await jsonBodyOrReject(req, res)
        if (!body) return
        const life = readJsonOr(lifeFile, {}) || {}
        const cancel = body.cancel === true || String(body.cancel ?? '') === '1' || String(body.cancel ?? '').toLowerCase() === 'true'
        if (cancel) {
          writeJsonAtomic(lifeFile, { ...life, plan: null })
          invalidate()
          logger('她的家：闹钟已取消')
          return sendJson(res, 200, { ok: true, plan: null })
        }
        const when = parsePlanAt({ at: body.at, after_minutes: body.after_minutes })
        if (!when) return bad(res, 400, '给 at（HH:MM 或 ISO）或 after_minutes，或 cancel=true')
        const note = stripBom(String(body.note ?? '')).replace(/\s+/g, ' ').trim().slice(0, 200)
        const plan = { at: when.toISOString(), note, setAt: new Date().toISOString() }
        // ⚠️ 先读后写：life.json 里还有 lastFire / morningFired / lastActivityAt / invites，别覆盖掉
        writeJsonAtomic(lifeFile, { ...life, plan })
        invalidate()
        logger(`她的家：闹钟定到 ${hhmm(when)} —— ${note.slice(0, 40) || '（没写要做什么）'}`)
        return sendJson(res, 200, { ok: true, plan, local: hhmm(when) })
      }

      /* ── POST /profile  {sec_uid, patch:{stage?,call?,impression?,likes?,avoid?,lastTopic?,promises?,facts?}} ── */
      if (method === 'POST' && path === '/api/douyin-home/profile') {
        const body = await jsonBodyOrReject(req, res)
        if (!body) return
        const secUid = String(body.sec_uid || '').trim()
        if (!secUid) return bad(res, 400, 'sec_uid 必填')
        const patch = body.patch
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
          return bad(res, 400, 'patch 要是一个对象（未知字段会被忽略）')
        }
        // updateProfile 只认已知字段、数组是**合并**不是覆盖 —— 清空字段这件事这里做不到，
        // 要清就等她自己在会话里改，或者手工改档案文件（保守做法：不给她一个「一键清记忆」的按钮）。
        const profile = updateProfile(root, secUid, patch)
        if (!profile) return bad(res, 400, '这个人没写成（sec_uid 空？）')
        invalidate()
        logger(`她的家：关系档案已更新（${profile.nick || secUid}，stage=${profile.stage}）`)
        return sendJson(res, 200, { ok: true, profile })
      }

      /* ── GET /faults ── 什么坏了、还没好（每条都带「怎么修」的半句） ── */
      if (method === 'GET' && path === '/api/douyin-home/faults') {
        return sendJson(res, 200, {
          ok: true,
          faults: safe(() => readFaults(homeDir), []),
          checkedAt: new Date().toISOString(),
        })
      }

      /* ── GET /cost?day=YYYY-MM-DD ── 她今天花了多少 token / 折多少钱（价目表在 home/pricing.json） ── */
      if (method === 'GET' && path === '/api/douyin-home/cost') {
        const want = String(url.searchParams.get('day') || '').trim()
        const day = want || todayKey(new Date())
        if (!DATE_RE.test(day)) return bad(res, 400, 'day 要 YYYY-MM-DD')
        const record = safe(() => readUsage(homeDir, day), null)
        const pricing = safe(() => readPricing(homeDir), { currency: 'CNY', models: {} })
        const cost = safe(() => estimateCost(record || { byModel: {} }, pricing), { estCost: null, currency: 'CNY', missingModels: [], pricedModels: [] })
        const available = Boolean(record && (Number(record.calls) || 0) > 0)
        const missing = Array.isArray(cost.missingModels) ? cost.missingModels : []
        return sendJson(res, 200, {
          ok: true,
          available,
          day,
          calls: Number(record?.calls) || 0,
          inputTokens: Number(record?.inputTokens) || 0,
          outputTokens: Number(record?.outputTokens) || 0,
          estCost: cost.estCost,
          currency: cost.currency || 'CNY',
          byModel: record?.byModel && typeof record.byModel === 'object' && !Array.isArray(record.byModel) ? record.byModel : {},
          // 附加说明（UI 直接显示）：没数据 / 价目表没填 —— 都别编金额
          ...(available ? {} : { note: 'provider 未上报用量（今天她家会话还没有模型调用记录）' }),
          ...(available && missing.length ? { note: `价目表没填：${missing.join('、')} —— 填 home/pricing.json 才报金额（见 _comment）` } : {}),
        })
      }

      /* ── GET /compactions?limit=20 ── 她被压缩过几次、每次压掉多少 ── */
      if (method === 'GET' && path === '/api/douyin-home/compactions') {
        const limit = clampLimit(url.searchParams.get('limit'), 20, 200)
        return sendJson(res, 200, { ok: true, rows: safe(() => readCompactions(homeDir, limit), []) })
      }

      /* ── GET /retention ── 归档保留范围（天 / 条）+ 定点自由时间（fish.7 A） ── */
      if (method === 'GET' && path === '/api/douyin-home/retention') {
        const s = safe(() => readSettings(homeDir), { retention: { ...DEFAULT_RETENTION }, freeTimes: [], lastPruneAt: '' })
        return sendJson(res, 200, { ok: true, retention: s.retention, freeTimes: s.freeTimes || [], lastPruneAt: s.lastPruneAt || '' })
      }

      /* ── POST /retention {retention:{…}, freeTimes?} ──
       * 也兼容平铺字段；天数 1–3650 / 条数 10–2000；freeTimes: HH:MM 数组（≤4，空数组=关掉）。 */
      if (method === 'POST' && path === '/api/douyin-home/retention') {
        const body = await jsonBodyOrReject(req, res)
        if (!body) return
        const raw = body.retention && typeof body.retention === 'object' && !Array.isArray(body.retention)
          ? { ...body.retention }
          : { ...body }
        if (body.freeTimes !== undefined) raw.freeTimes = body.freeTimes
        const v = validateRetentionPatch(raw)
        if (!v.ok) return bad(res, 400, v.error)
        const patch = {}
        if (Object.keys(v.retention || {}).length) patch.retention = v.retention
        if (v.freeTimes !== undefined) patch.freeTimes = v.freeTimes
        const s = writeSettings(homeDir, patch)
        invalidate()
        logger(`保留策略已更新（${JSON.stringify(v)}）`)
        return sendJson(res, 200, { ok: true, retention: s.retention, freeTimes: s.freeTimes || [], lastPruneAt: s.lastPruneAt || '' })
      }

      return bad(res, 404, `unknown ${method} ${path}`)
    } catch (e) {
      const msg = String(e?.message ?? e)
      try { logger(`她的家控制台：${method} ${path} 出错（已兜住）：${msg}`) } catch { /* 日志也不许抛 */ }
      return bad(res, 500, msg)
    }
  }

  return { snapshot, handle }
}

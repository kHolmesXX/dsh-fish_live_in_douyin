/**
 * lib/home/presence.mjs —— 「看到主人上线 → 选择性搭话」（2026-10-27 fish.9 ①）
 * ============================================================================
 * 在线信号：DSH 的 `session/event`，`event.type === 'user/message'`（主人说话/操作都会落一条）。
 *   index.js 在**现有的** session/event handler 里调 recordUserSeen()：
 *   · 不是她自己的会话（DUTY_SESSION_ID / PLUGIN_SESSIONS / subagent）才记
 *   · 记 `home/presence.json`：{lastAt, prevAt, gapMin, lastDay, greeted, rolled, wake}
 *
 * 上线判定（presenceTick，跟 lifeTick 同拍 30 秒）：
 *   lastAt 在最近 2 分钟内 + 这次上线距上次活动 > 30 分钟（gapMin）
 *   + 世界开着（index 已闸）+ settings.presence 选择性：
 *     enabled / chance 掷骰子（**每次上线只掷一次**，没中就不再掷）/ 距上次搭话 > cooldownMin /
 *     当天 < maxPerDay。
 *   不满足 ⇒ 什么都不做（最多记一行 debug，不产生噪音）。
 *   满足 ⇒ 返回 due，由 index.js 把「叫她主动问一句」投进她的家会话。
 *
 * 文件：`$DOUYIN_HOME/home/presence.json`
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 选择性默认值（防粘人） */
export const PRESENCE_DEFAULTS = { enabled: true, chance: 0.25, cooldownMin: 90, maxPerDay: 3 }
/** lastUserAt 在这窗口内算「刚上线」 */
export const ONLINE_WINDOW_MIN = 2
/** 上一次活动距这次超过这么多分钟 = 刚从离线变在线 */
export const ONLINE_GAP_MIN = 30
const GREETED_KEEP = 100

const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}
const readJsonSafe = (file) => { try { return JSON.parse(stripBom(readFileSync(file, 'utf8'))) } catch { return null } }
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

export const presenceFile = (homeDir) => join(String(homeDir || ''), 'presence.json')

const localDay = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** 把 settings.presence 收成合法值（坏值回默认；不抛） */
export function normalizePresenceSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const chance = Number(src.chance)
  const cooldown = Number(src.cooldownMin)
  const maxPerDay = Number(src.maxPerDay)
  return {
    enabled: src.enabled !== false,
    chance: Number.isFinite(chance) ? Math.max(0, Math.min(chance, 1)) : PRESENCE_DEFAULTS.chance,
    cooldownMin: Number.isFinite(cooldown) ? Math.max(5, Math.min(Math.trunc(cooldown), 1440)) : PRESENCE_DEFAULTS.cooldownMin,
    maxPerDay: Number.isFinite(maxPerDay) ? Math.max(0, Math.min(Math.trunc(maxPerDay), 20)) : PRESENCE_DEFAULTS.maxPerDay,
  }
}

const emptyState = () => ({
  lastAt: '', prevAt: '', gapMin: null, lastDay: '',
  greeted: {}, rolled: { key: '', hit: false, at: '' },
  wake: { lastAt: '', day: '', count: 0 },
})

/** 读 presence.json（缺文件补默认；坏 JSON 用默认不覆盖） */
export function readPresenceState(homeDir) {
  const file = presenceFile(homeDir)
  const j = readJsonSafe(file)
  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    if (!existsSync(file)) writeJsonAtomic(file, emptyState())
    return emptyState()
  }
  const greeted = j.greeted && typeof j.greeted === 'object' && !Array.isArray(j.greeted) ? j.greeted : {}
  const rolled = j.rolled && typeof j.rolled === 'object' ? j.rolled : {}
  const wake = j.wake && typeof j.wake === 'object' ? j.wake : {}
  return {
    lastAt: typeof j.lastAt === 'string' ? j.lastAt : '',
    prevAt: typeof j.prevAt === 'string' ? j.prevAt : '',
    gapMin: Number.isFinite(Number(j.gapMin)) ? Number(j.gapMin) : null,
    lastDay: typeof j.lastDay === 'string' ? j.lastDay : '',
    greeted,
    rolled: { key: String(rolled.key || ''), hit: rolled.hit === true, at: String(rolled.at || '') },
    wake: { lastAt: String(wake.lastAt || ''), day: String(wake.day || ''), count: Number(wake.count) || 0 },
  }
}

/** 改 presence.json（嵌套合并；失败不抛） */
export function writePresenceState(homeDir, patch = {}) {
  const cur = readPresenceState(homeDir)
  const p = patch && typeof patch === 'object' ? patch : {}
  const next = {
    ...cur,
    ...p,
    greeted: { ...cur.greeted, ...(p.greeted && typeof p.greeted === 'object' ? p.greeted : {}) },
    rolled: { ...cur.rolled, ...(p.rolled && typeof p.rolled === 'object' ? p.rolled : {}) },
    wake: { ...cur.wake, ...(p.wake && typeof p.wake === 'object' ? p.wake : {}) },
  }
  writeJsonAtomic(presenceFile(homeDir), next)
  return next
}

/**
 * ⭐ 记一次「主人活动」（index.js 的 session/event → user/message 调）。
 * 同时算好「这次距上次活动多少分钟」——上线判定要看这个。
 * @param {string} homeDir
 * @param {number|string} atMs 事件时间（ms 或 ISO；拿不到用现在）
 */
export function recordUserSeen(homeDir, atMs) {
  try {
    const at = Number.isFinite(Number(atMs)) ? new Date(Number(atMs)) : new Date(String(atMs || ''))
    const when = Number.isNaN(at.getTime()) ? new Date() : at
    const cur = readPresenceState(homeDir)
    const prevMs = Date.parse(String(cur.lastAt || ''))
    const gapMin = Number.isFinite(prevMs) ? Math.max(0, Math.round((when.getTime() - prevMs) / 60_000)) : null
    return writePresenceState(homeDir, {
      prevAt: cur.lastAt || '',
      lastAt: when.toISOString(),
      gapMin,
      lastDay: localDay(when),
    })
  } catch { return null }
}

/** 当前时段（决定参考方向）：工作时间 / 午休 / 晚上 / 其他时段 */
export function periodOf(now = new Date()) {
  const mins = now.getHours() * 60 + now.getMinutes()
  const day = now.getDay()
  if (now.getHours() >= 22 || now.getHours() < 6) return { key: 'night', label: '晚上' }
  if (mins >= 11 * 60 + 30 && mins <= 13 * 60 + 30) return { key: 'lunch', label: '午休' }
  if (day >= 1 && day <= 5 && mins >= 9 * 60 && mins < 18 * 60) return { key: 'work', label: '工作时间' }
  return { key: 'other', label: '其他时段' }
}

/** 到点叫醒她的那段话（投进她的家会话，不是直接替她发消息） */
export function renderPresenceWake({ now = new Date(), period = periodOf(now) } = {}) {
  return [
    `【看到主人上线了】现在 ${hhmm(now)}（${period.label}）。你要不要主动问一句？`,
    '参考方向：工作时段 → 调侃他「是不是摸鱼了」；午休（11:30–13:30）→ 问吃了吗/歇会儿；',
    '晚上 22:00 后 → 催他早点休息；其他时段 → 随口找个由头（看到他前天说的那句话、刷到的东西）。',
    '想发就 douyin_reach_out（一句）或 douyin_reach_burst（2–3 条连发）；不想发就歇着，别硬找话。',
  ].join('\n')
}

/**
 * 上线判定（纯决策，不投递）。返回 {due, key, period, debug?}
 * @param {{homeDir:string, now?:Date, settings?:object, random?:Function}} opt
 */
export function presenceTick({ homeDir, now = new Date(), settings = {}, random = Math.random } = {}) {
  try {
    const s = normalizePresenceSettings(settings)
    if (!s.enabled) return { due: false }
    const st = readPresenceState(homeDir)
    const lastMs = Date.parse(String(st.lastAt || ''))
    if (!Number.isFinite(lastMs)) return { due: false }
    const ageMs = now.getTime() - lastMs
    if (ageMs < 0 || ageMs > ONLINE_WINDOW_MIN * 60_000) return { due: false }
    // 刚从离线变在线：上一次活动距这次 > 30 分钟（从没有上一次 ⇒ 也算「刚上线」）
    if (st.gapMin !== null && st.gapMin <= ONLINE_GAP_MIN) return { due: false }
    const key = st.lastAt
    if (st.greeted && st.greeted[key]) return { due: false }
    // 防粘人：冷却 + 当天额度
    const wakeMs = Date.parse(String(st.wake.lastAt || ''))
    if (Number.isFinite(wakeMs) && now.getTime() - wakeMs < s.cooldownMin * 60_000) return { due: false }
    const today = localDay(now)
    const dayCount = st.wake.day === today ? st.wake.count : 0
    if (dayCount >= s.maxPerDay) return { due: false }
    // 掷骰子：每次上线只掷一次（没中就记住这一发，别每 30 秒重掷）
    let hit = st.rolled.key === key ? st.rolled.hit === true : null
    if (hit === null) {
      hit = random() < s.chance
      writePresenceState(homeDir, { rolled: { key, hit, at: now.toISOString() } })
      if (!hit) return { due: false, debug: `她的主动：看到上线 → 掷骰子没中（chance ${s.chance}），这次不叫` }
    }
    if (!hit) return { due: false }
    return { due: true, key, period: periodOf(now) }
  } catch { return { due: false } }
}

/** 叫醒成功后记一笔（greeted + 冷却/当天计数） */
export function markPresenceGreeted(homeDir, { key = '', now = new Date() } = {}) {
  try {
    const st = readPresenceState(homeDir)
    const today = localDay(now)
    const count = st.wake.day === today ? st.wake.count + 1 : 1
    // greeted 只留最近 100 条（key 是 ISO 时间串）
    const entries = Object.entries({ ...st.greeted, [key || now.toISOString()]: now.toISOString() })
      .sort((a, b) => String(b[1]).localeCompare(String(a[1])))
      .slice(0, GREETED_KEEP)
    return writePresenceState(homeDir, {
      greeted: Object.fromEntries(entries),
      wake: { lastAt: now.toISOString(), day: today, count },
    })
  } catch { return null }
}

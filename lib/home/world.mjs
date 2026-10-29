/**
 * lib/home/world.mjs —— 「她的世界」总开关 + 世界提示词（2026-10-27 fish.3）
 * ============================================================================
 * 参考 dsh-world 的「开始/停止世界」，但这里控制的是**她的作息**（不是插件安装）：
 *   关 = 她不再醒来：定时轮次 / 她的闹钟 / 每日回顾 / 私信盯梢 / 投递 全部停；
 *   开 = 照常。
 *
 * 两个文件（都在 `$DOUYIN_HOME/home/` 下）：
 *   world.json  {enabled, startedAt, stoppedAt, edition:1, history:[{at,enabled}]}（history 最近 20 次）
 *   world.md    她的「世界提示词」——她自己也能改（≤4000 字），排在人设之前
 *
 * 三条保守规矩（按重要性排）：
 *   ① 缺文件 ⇒ 默认 enabled:true（老用户/首次装上不该被锁死），**首次读到时补写**一份；
 *   ② 坏文件 ⇒ 按 true 读（一个坏 JSON 绝不能让她永远不醒），但**不覆盖**坏文件；
 *   ③ `isWorldOn` 在热路径上（lifeTick/diaryTick/chat-watch…）⇒ 读失败一律 true，绝不抛。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const EDITION = 1
const MAX_HISTORY = 20
/** 世界提示词上限（跟面板/工具说的一致，改这里就都跟着变） */
export const WORLD_PROMPT_MAX = 4000

const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}

/** `$DOUYIN_HOME/home/world.json` */
export const worldFile = (homeDir) => join(String(homeDir || ''), 'world.json')
/** `$DOUYIN_HOME/home/world.md` */
export const worldPromptFile = (homeDir) => join(String(homeDir || ''), 'world.md')

/** 原子写文本（tmp → rename，Windows 上失败重试一次；失败返回 false 不抛） */
function writeTextFileAtomic(file, text) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, String(text ?? ''), 'utf8')
    try {
      renameSync(tmp, file)
    } catch {
      try { renameSync(tmp, file) } catch (e) {
        try { rmSync(tmp, { force: true }) } catch { /* 清不掉就算了 */ }
        throw e
      }
    }
    return true
  } catch { return false }
}

function writeJsonFile(file, value) {
  return writeTextFileAtomic(file, `${JSON.stringify(value, null, 1)}\n`)
}

const emptyWorld = () => ({ enabled: true, startedAt: '', stoppedAt: null, edition: EDITION, history: [] })
const dateIso = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString())

/**
 * 读世界状态（永远返回完整对象，绝不抛）。
 * 缺文件 ⇒ 补写默认（enabled:true，startedAt=现在）；坏文件 ⇒ 返回默认但**不覆盖**。
 * @param {string} homeDir `$DOUYIN_HOME/home`
 */
export function readWorld(homeDir) {
  const file = worldFile(homeDir)
  let raw = null
  try { raw = readFileSync(file, 'utf8') } catch { raw = null }

  if (raw === null) {
    // 文件不在 ⇒ 首次读到时补写一份（坏文件读不出来是另一条路：raw 会是内容，不是 null）
    if (!existsSync(file)) {
      const init = { ...emptyWorld(), startedAt: dateIso(new Date()) }
      const ok = writeJsonFile(file, init)
      if (!ok) return init
      return init
    }
    return emptyWorld()
  }

  let j = null
  try { j = JSON.parse(stripBom(raw)) } catch { return emptyWorld() }   // 坏 JSON：按 true 读，不动文件
  if (!j || typeof j !== 'object' || Array.isArray(j)) return emptyWorld()
  const history = Array.isArray(j.history)
    ? j.history.filter((x) => x && typeof x === 'object' && !Array.isArray(x)).slice(-MAX_HISTORY)
    : []
  return {
    enabled: j.enabled !== false,                    // 只有显式 false 才算关
    startedAt: typeof j.startedAt === 'string' ? j.startedAt : '',
    stoppedAt: typeof j.stoppedAt === 'string' ? j.stoppedAt : null,
    edition: Number(j.edition) || EDITION,
    history,
  }
}

/**
 * 改世界状态（先读后合并，保留 history 等字段）。返回合并后的完整对象（写失败也返回，别让调用方炸）。
 * @param {string} homeDir
 * @param {object} patch  要覆盖的字段（enabled / startedAt / stoppedAt / history …）
 */
export function writeWorld(homeDir, patch = {}) {
  const cur = readWorld(homeDir)
  const next = { ...cur, ...(patch || {}), edition: Number((patch || {}).edition) || cur.edition || EDITION }
  next.enabled = next.enabled !== false
  next.history = Array.isArray(next.history) ? next.history.slice(-MAX_HISTORY) : []
  writeJsonFile(worldFile(homeDir), next)
  return next
}

/**
 * 热路径闸：世界开着吗？（读失败/坏文件/没文件一律 true —— 绝不能因为读不到就把她锁死）
 * ⚠️ 每次读文件、**不要缓存**：开关要立刻生效。
 */
export function isWorldOn(homeDir) {
  try { return readWorld(homeDir).enabled !== false } catch { return true }
}

/** 读她的世界提示词（没有/读不出 ⇒ ''）。 */
export function readWorldPrompt(homeDir) {
  try {
    if (!existsSync(worldPromptFile(homeDir))) return ''
    return stripBom(readFileSync(worldPromptFile(homeDir), 'utf8')).trim()
  } catch { return '' }
}

/**
 * 写她的世界提示词（自动 trim、补结尾换行、原子写；空串 = 删文件）。
 * @returns {{ok:boolean, chars:number, text:string}}
 */
export function writeWorldPrompt(homeDir, text) {
  const body = stripBom(String(text ?? '')).replace(/\r\n?/g, '\n').trim()
  const file = worldPromptFile(homeDir)
  if (!body) {
    try { if (existsSync(file)) rmSync(file, { force: true }) } catch { /* 已经没了 */ }
    return { ok: true, chars: 0, text: '' }
  }
  const capped = body.slice(0, WORLD_PROMPT_MAX)
  const ok = writeTextFileAtomic(file, `${capped}\n`)
  return { ok, chars: capped.length, text: capped }
}

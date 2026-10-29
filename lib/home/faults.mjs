/**
 * lib/home/faults.mjs —— 「什么坏了、还没好」故障表（2026-10-27 fish.6，照 dsh-world 的 faults.js）
 * ============================================================================
 * 语义跟 dsh-world 一样：**失败时 set(key, 人话)，下一次成功就 clear(key)**。
 * 但我们要能跨重启看「上次坏过」⇒ 内存一份 + 落盘 `$DOUYIN_HOME/home/faults.json`：
 *   { "checkedAt": ISO, "entries": { "send": { "text": "…", "at": ISO }, … } }
 *
 * 规矩：
 *   ① 每条 text 都要带「怎么修」的半句（面板直接念给用户听）；
 *   ② 读/写失败绝不抛 —— 故障表坏了不能反过来弄坏主流程；
 *   ③ 另给 recordFault()/clearFault() 两个**文件级**函数，给别的进程（如 MCP server）用。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 故障类别 → 面板上的短标题（说明用；真正的文案在 set 时给） */
export const FAULT_KEYS = ['round', 'deliver', 'send', 'login', 'alarm', 'tick', 'usage', 'compaction', 'storage', 'group', 'comment']

export const errorText = (e) => (e instanceof Error ? e.message : String(e ?? ''))

/** `$DOUYIN_HOME/home/faults.json` */
export const faultsFile = (homeDir) => join(String(homeDir || ''), 'faults.json')

function readRaw(homeDir) {
  try {
    const raw = readFileSync(faultsFile(homeDir), 'utf8')
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
    const j = JSON.parse(text)
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null
  } catch { return null }
}

function writeRaw(homeDir, value) {
  try {
    const file = faultsFile(homeDir)
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

/** 文件里的条目（{key,text,at} 数组，新的在前）。坏文件 ⇒ []。 */
export function readFaults(homeDir) {
  const j = readRaw(homeDir)
  const entries = j && j.entries && typeof j.entries === 'object' && !Array.isArray(j.entries) ? j.entries : {}
  return Object.entries(entries)
    .filter(([, v]) => v && typeof v === 'object' && v.text)
    .map(([key, v]) => ({ key, text: String(v.text || ''), at: String(v.at || '') }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

/** 从文件读一个条目（给跨进程用；读不到 ⇒ null） */
export function readFault(homeDir, key) {
  return readFaults(homeDir).find((f) => f.key === key) || null
}

/**
 * 文件级 set：给别的进程（MCP server / CLI）用 —— 读-改-写，失败只 log 不抛。
 * @returns {boolean} 写成功没
 */
export function recordFault(homeDir, key, text, log) {
  try {
    const cur = readRaw(homeDir) || {}
    const entries = cur.entries && typeof cur.entries === 'object' && !Array.isArray(cur.entries) ? cur.entries : {}
    entries[String(key)] = { text: String(text || ''), at: new Date().toISOString() }
    return writeRaw(homeDir, { ...cur, checkedAt: new Date().toISOString(), entries })
  } catch (e) { try { log?.(`故障表写不进去（${key}）：${errorText(e)}`) } catch { /* ignore */ } ; return false }
}

/** 文件级 clear：成功一次就把这条删掉（跨进程用）。 */
export function clearFault(homeDir, key, log) {
  try {
    const cur = readRaw(homeDir)
    if (!cur) return true
    const entries = cur.entries && typeof cur.entries === 'object' && !Array.isArray(cur.entries) ? { ...cur.entries } : {}
    if (!(String(key) in entries)) return true
    delete entries[String(key)]
    return writeRaw(homeDir, { ...cur, checkedAt: new Date().toISOString(), entries })
  } catch (e) { try { log?.(`故障表清不掉（${key}）：${errorText(e)}`) } catch { /* ignore */ } ; return false }
}

/**
 * 内存 + 落盘两层的故障表（index.js 主进程用）。
 * @param {string} homeDir 她的家（`$DOUYIN_HOME/home`）
 * @param {Function} [log]
 */
export function createFaults(homeDir, log) {
  const fileEntries = (() => {
    const j = readRaw(homeDir)
    const e = j && j.entries && typeof j.entries === 'object' && !Array.isArray(j.entries) ? j.entries : {}
    const out = new Map()
    for (const [key, v] of Object.entries(e)) {
      if (v && typeof v === 'object' && v.text) out.set(key, { text: String(v.text || ''), at: String(v.at || '') })
    }
    return out
  })()
  const entries = fileEntries
  const flush = () => writeRaw(homeDir, {
    checkedAt: new Date().toISOString(),
    entries: Object.fromEntries(entries),
  })
  return {
    /** 记一条故障（重复 set 同一 key 只保留最新文案/时间） */
    set(key, text) {
      try {
        entries.set(String(key), { text: String(text || ''), at: new Date().toISOString() })
        flush()
      } catch (e) { try { log?.(`故障表 set 失败（${key}）：${errorText(e)}`) } catch { /* ignore */ } }
    },
    /** 成功一次就清（可一次清多个 key） */
    clear(...keys) {
      try {
        let changed = false
        for (const k of keys) if (entries.delete(String(k))) changed = true
        if (changed) flush()
      } catch (e) { try { log?.(`故障表 clear 失败：${errorText(e)}`) } catch { /* ignore */ } }
    },
    /** 当前所有故障（新的在前） */
    list() {
      return [...entries.entries()]
        .map(([key, v]) => ({ key, text: String(v.text || ''), at: String(v.at || '') }))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    },
    /** 跑一段异步活：失败 = 故障 key，成功 = 自动清；失败照常抛给调用方 */
    track(key, label, work) {
      return Promise.resolve().then(work).then(
        (v) => { this.clear(key); return v },
        (e) => { this.set(key, `${label}：${errorText(e)}`); throw e },
      )
    },
  }
}

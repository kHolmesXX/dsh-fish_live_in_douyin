/**
 * lib/home/ledger.mjs —— 她的家的两本 append-only 账（2026-10-27 阶段 3b 外移）
 * ============================================================================
 * 从 index.js 原样搬出来的纯 fs 逻辑，**不依赖 ctx / 宿主**。
 *
 *   home/rounds/<YYYY-MM-DD>.jsonl  {at,why,candidates,picked:[],dropped:{}}
 *     每开一轮记一行（window:custom:5 / manual），谁触发 + 捞到几条候选 + 硬筛掉了什么。
 *   home/sent.jsonl                 {at,aweme_id,to,to_id,kind,sent,readback,error,src}
 *     每发一条 / 每试一条记一行（kind: card|reason|text|reach|greet|comment；src: host|mcp|reach）。
 *
 * 为什么要有这两本账：round-evidence.json 每轮覆盖只剩最后一轮；out/<day>.md 是模型写的
 * 报告（文案重复、发没发出去混在一起）⇒ 都不能当账。现场 append 一行才是真账。
 *
 * ⭐ 跨进程安全：宿主进程和 MCP 子进程都往 home/sent.jsonl append **一整行**（O_APPEND），
 *   不会互相截断；写失败只记日志、绝不抛 —— 账本坏了不能影响发送。
 * ============================================================================
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * append 一行 JSON（自动补 at、自动 mkdir -p）。失败不抛。
 * @param {string} file
 * @param {object} obj
 * @param {Function} [log] 可选日志函数（写失败时喊一声）
 * @returns {boolean} 写成功没
 */
export function appendLine(file, obj, log) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...(obj || {}) })}\n`, 'utf8')
    return true
  } catch (e) {
    try { log?.(`账本写不进去（${file}）：${e?.message ?? e}`) } catch { /* 日志也不许抛 */ }
    return false
  }
}

/**
 * 记一轮：`<homeDir>/rounds/<YYYY-MM-DD>.jsonl`（日期取注入的 dayKey，默认本地日期）。
 * @param {{homeDir:string, dayKey?:Function, row:object, log?:Function}} opt
 */
export function appendRound({ homeDir, dayKey, row, log } = {}) {
  const day = typeof dayKey === 'function' ? dayKey() : localDay(new Date())
  return appendLine(join(homeDir, 'rounds', `${day}.jsonl`), row, log)
}

/**
 * 记一条发送：`<homeDir>/sent.jsonl`。
 * @param {{homeDir:string, row:object, log?:Function}} opt
 */
export function appendSent({ homeDir, row, log } = {}) {
  return appendLine(join(homeDir, 'sent.jsonl'), row, log)
}

/** 读 JSONL：一行一个对象，空行/坏行跳过；文件不在就是空数组。 */
export function readJsonl(file) {
  const out = []
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return out }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    out.push(row)
  }
  return out
}

/** 本地日期（只给 appendRound 的默认 dayKey 用；正式调用方都会注入 state.mjs 的 dayKey） */
function localDay(now) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/* ═══════════════════════ fish.6：按保留策略清理账本 ═══════════════════════ */

const DAY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.jsonl$/
const dayMs = 86_400_000
const clampDays = (v, fb) => { const n = Number(v); return Number.isFinite(n) ? Math.max(1, Math.min(Math.trunc(n), 3650)) : fb }

/** 某行的时间戳（ms；解析不了 ⇒ NaN） */
const rowTs = (row) => Date.parse(String((row && (row.at || row.time)) || ''))

/**
 * 裁 JSONL：只留 at/time >= cutoff 的行（坏行保留 —— 宁可留着也别把半行删成"账本缺口"）。
 * 没有要删的行就**不动文件**。返回删掉的行数。
 */
function trimJsonlByTs(file, cutoff, log) {
  try {
    if (!existsSync(file)) return 0
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim())
    if (!lines.length) return 0
    const kept = []
    let removed = 0
    for (const line of lines) {
      let row = null
      try { row = JSON.parse(line) } catch { kept.push(line); continue }   // 坏行保留
      const t = rowTs(row)
      if (Number.isFinite(t) && t < cutoff) removed += 1
      else kept.push(line)
    }
    if (!removed) return 0
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, `${kept.join('\n')}\n`, 'utf8')
    try { renameSync(tmp, file) } catch {
      try { renameSync(tmp, file) } catch (e) {
        try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
        throw e
      }
    }
    return removed
  } catch (e) {
    try { log?.(`裁 ${file} 失败（已跳过）：${e?.message ?? e}`) } catch { /* ignore */ }
    return 0
  }
}

/**
 * 清理账本（由 lib/home/settings.mjs 的 pruneByRetention 调；**自己不做 24h 节流**，那边管）。
 *   · home/rounds/<日期>.jsonl：日期早于 archiveDays ⇒ 删整份
 *   · home/sent.jsonl          ：at 早于 archiveDays ⇒ 删行
 *   · home/journal.jsonl       ：at 早于 journalDays ⇒ 删行
 * @returns {{files:number, lines:number}}
 */
export function pruneLedger({ homeDir, retention = {}, now = new Date(), log } = {}) {
  const root = String(homeDir || '')
  if (!root) return { files: 0, lines: 0 }
  const archiveDays = clampDays(retention.archiveDays, 30)
  const journalDays = clampDays(retention.journalDays, 90)
  const nowMs = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : Date.now()
  const cutoffArchive = nowMs - archiveDays * dayMs
  const cutoffJournal = nowMs - journalDays * dayMs
  let files = 0
  let lines = 0

  // rounds：按文件名日期整份删
  try {
    for (const name of readdirSync(join(root, 'rounds'))) {
      if (!DAY_FILE_RE.test(name)) continue
      const t = Date.parse(`${name.slice(0, 10)}T00:00:00`)
      if (!Number.isFinite(t) || t >= cutoffArchive) continue
      try { rmSync(join(root, 'rounds', name), { force: true }); files += 1 } catch { /* 单份删不掉就跳过 */ }
    }
  } catch { /* 没有 rounds/ 就算了 */ }

  // sent：裁旧行
  lines += trimJsonlByTs(join(root, 'sent.jsonl'), cutoffArchive, log)
  // journal：裁旧行
  lines += trimJsonlByTs(join(root, 'journal.jsonl'), cutoffJournal, log)
  return { files, lines }
}

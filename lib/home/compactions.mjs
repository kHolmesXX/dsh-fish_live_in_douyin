/**
 * lib/home/compactions.mjs —— 「她什么时候被压缩过、压掉了多少」（2026-10-27 fish.6）
 * ============================================================================
 * 数据来源（DSH 会话事件，字段名照 dsh-world/lib/life/journal.js + compactionRegion.js）：
 *   event.type === 'compaction/summary'  ⇒ data.{compactionId, shadowedSeqs[], shadowedTokenCount,
 *                                            summary[blocks], sourceCommandId?, model, usage?}
 *   event.type === 'compaction/end'      ⇒ data.{compactionId, error?, sourceCommandId?}
 *   event.type === 'compaction/start'    ⇒ data.{compactionId, sourceCommandId?}
 *   trigger：带的 `sourceCommandId`（手动触发会有）⇒ manual，否则 auto。
 *
 * 落盘：`$DOUYIN_HOME/home/compactions.jsonl`，一行一条：
 *   {at, sessionId, trigger:'auto'|'manual', beforeTokens, afterTokens,
 *    shadowedSeqs, summaryChars, ok, error?}
 *   · beforeTokens  = 被压掉那段的 token 数（shadowedTokenCount，DSH 给的）
 *   · afterTokens   = 压缩后整个会话的 token 数（只有能拿到 tokenMeter 时才有，否则 null —— 不编）
 * ============================================================================
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendLine, readJsonl } from './ledger.mjs'

const compactionsFile = (homeDir) => join(String(homeDir || ''), 'compactions.jsonl')

/** 压缩摘要的字符数（summary 是 block 数组，只数 text） */
function summaryCharsOf(summary) {
  try {
    if (typeof summary === 'string') return summary.length
    if (!Array.isArray(summary)) return 0
    return summary.reduce((n, b) => n + (b && b.type === 'text' ? String(b.text || '').length : 0), 0)
  } catch { return 0 }
}

/** 读压缩记录（新的在前）。 */
export function readCompactions(homeDir, limit = 20) {
  try {
    const rows = readJsonl(compactionsFile(homeDir))
      .filter((r) => r && typeof r === 'object' && typeof r.at === 'string')
    rows.sort((a, b) => String(b.at).localeCompare(String(a.at)))
    return rows.slice(0, Math.max(1, Math.min(Number(limit) || 20, 200)))
  } catch { return [] }
}

/** append 一条（失败只 log 不抛；跨进程 append 一行是安全的）。 */
export function appendCompaction(homeDir, row, log) {
  try { return appendLine(compactionsFile(homeDir), row || {}, log) } catch { return false }
}

/**
 * 保留最近 keep 条（归档保留策略用）。返回删掉的条数。
 * 文件不存在/只有 ≤keep 条 ⇒ 0，不动文件。
 */
export function trimCompactions(homeDir, keep = 200) {
  const file = compactionsFile(homeDir)
  try {
    if (!existsSync(file)) return 0
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim())
    const k = Math.max(1, Number(keep) || 200)
    if (lines.length <= k) return 0
    const kept = lines.slice(-k)
    writeFileSync(file, `${kept.join('\n')}\n`, 'utf8')
    return lines.length - kept.length
  } catch { return 0 }
}

/**
 * 会话事件 → 压缩记录的转换器（index.js 在 ctx.on('session/event') 里喂它）。
 * @param {{homeDir:string, log?:Function, tokenMeterOf?:Function}} deps
 */
export function createCompactionRecorder({ homeDir, log, tokenMeterOf } = {}) {
  /** compactionId → 摘要事件里的信息（等 compaction/end 时再落盘） */
  const pending = new Map()
  const says = (m) => { try { log?.(m) } catch { /* ignore */ } }

  return {
    /** @returns {boolean} 这条事件被处理了吗 */
    handle(session, event) {
      const type = String(event?.type || '')
      const data = event?.data && typeof event.data === 'object' ? event.data : {}
      const id = String(data.compactionId || '')
      if (type === 'compaction/start') {
        if (!id) return false
        pending.set(id, {
          trigger: data.sourceCommandId ? 'manual' : 'auto',
          at: new Date(Number(event.time) || Date.now()).toISOString(),
        })
        return true
      }
      if (type === 'compaction/summary') {
        if (!id) return false
        const prev = pending.get(id) || {}
        pending.set(id, {
          ...prev,
          trigger: prev.trigger || (data.sourceCommandId ? 'manual' : 'auto'),
          at: prev.at || new Date(Number(event.time) || Date.now()).toISOString(),
          beforeTokens: Number.isFinite(Number(data.shadowedTokenCount)) ? Number(data.shadowedTokenCount) : null,
          shadowedSeqs: Array.isArray(data.shadowedSeqs) ? data.shadowedSeqs.length : null,
          summaryChars: summaryCharsOf(data.summary),
        })
        return true
      }
      if (type !== 'compaction/end') return false
      const info = pending.get(id) || {}
      pending.delete(id)
      // 压缩后的会话 token 数（只有拿得到 tokenMeter 才有；拿不到就 null，不编）
      let afterTokens = null
      try {
        const meter = typeof tokenMeterOf === 'function' ? tokenMeterOf() : null
        const measured = meter && typeof meter.measure === 'function' ? meter.measure(session) : null
        if (measured && Number.isFinite(Number(measured.totalTokens))) afterTokens = Number(measured.totalTokens)
      } catch { /* 量不到就 null */ }
      const ok = data.error === undefined
      const row = {
        at: new Date(Number(event.time) || Date.now()).toISOString(),
        sessionId: String(session?.id || ''),
        trigger: info.trigger || (data.sourceCommandId ? 'manual' : 'auto'),
        beforeTokens: info.beforeTokens ?? null,
        afterTokens,
        shadowedSeqs: info.shadowedSeqs ?? null,
        summaryChars: info.summaryChars ?? 0,
        ok,
        ...(ok ? {} : { error: String((data.error && (data.error.message || data.error.code)) || data.error || '压缩失败').slice(0, 300) }),
      }
      if (appendCompaction(homeDir, row, log)) {
        says(`压缩记录：${row.trigger}，压掉 ${row.beforeTokens ?? '?'} tokens / ${row.shadowedSeqs ?? '?'} 个节点，摘要 ${row.summaryChars} 字`)
        return true
      }
      says('压缩记录写入失败（看 home/compactions.jsonl 权限）')
      return false
    },
  }
}

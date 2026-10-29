/**
 * lib/home/groupvid.mjs —— 群友分享视频：挑着看 / 截图 / 外部分析（2026-10-27 fish.13）
 * ============================================================================
 * 需求原话：「不用每一个视频都看，挑着看；如果看视频的话，可以截屏看看大概是什么，再评论；
 *   或者调用外部的 ai，例如把视频链接丢给豆包让她总结。真的需要丢豆包的话，要满足：
 *   1 你自己想看 2 别人@你去看那条视频 3 这条视频时长在 30 秒以上」
 *
 * 本模块：
 *   lookVideo()      → cdp-fetch 详情（标题/作者/时长/赞/分享链接）+ frame-grab 取 3 帧
 *                      （10%/50%/90%），写回 home/group-videos.jsonl（duration/frames/status:looked）
 *   summarizeVideo() → 三条件全部满足才丢外部 AI；否则 denied；没配/失败降级 local-frames
 *
 * 外部 AI 配置在 `home/settings.json` 的 `externalAI`（OpenAI 兼容 chat/completions）：
 *   { enabled:false, provider:'doubao', endpoint:'', apiKey:'', model:'' }
 *   例：endpoint 填 `https://ark.cn-beijing.volces.com/api/v3/chat/completions`，
 *       model 填豆包/方舟的模型名（或推理接入点 id），apiKey 填方舟的 API Key。
 * 隐私：只发公开视频的截图 + 文案 + 时长，**不发主人任何聊天内容**。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readSettings } from './settings.mjs'
import { videosFile } from './groups.mjs'

/** 外部 AI 默认配置（缺省关闭 —— 主人明确配了才发出去） */
export const EXTERNAL_AI_DEFAULTS = { enabled: false, provider: 'doubao', endpoint: '', apiKey: '', model: '' }
/** 三条件之一：时长门槛（秒） */
export const MIN_SUMMARY_SECONDS = 30
const MAX_FRAME_BYTES = 1024 * 1024   // 单帧 <1MB（超了也保留，但在结果里标出来）
/** 读 JSON 文件（坏文件/不存在 ⇒ null；写失败不抛） */
const readJsonSafe = (file) => {
  try {
    const raw = readFileSync(file, 'utf8')
    const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
    const j = JSON.parse(text)
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null
  } catch { return null }
}

export function normalizeExternalAI(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    enabled: src.enabled === true,
    provider: String(src.provider || EXTERNAL_AI_DEFAULTS.provider).slice(0, 40),
    endpoint: String(src.endpoint || '').slice(0, 500),
    apiKey: String(src.apiKey || '').slice(0, 200),
    model: String(src.model || '').slice(0, 120),
  }
}

export function readExternalAI(homeDir) {
  try { return normalizeExternalAI(readSettings(homeDir).externalAI) } catch { return { ...EXTERNAL_AI_DEFAULTS } }
}

/* ───────────────────── group-videos.jsonl 读写 ───────────────────── */

/** 读全部行（坏行跳过） */
export function readGroupVideoRows(homeDir) {
  const out = []
  let text = ''
  try { text = readFileSync(videosFile(homeDir), 'utf8') } catch { return out }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      if (row && typeof row === 'object') out.push(row)
    } catch { /* 坏行跳过 */ }
  }
  return out
}

function writeGroupVideoRows(homeDir, rows) {
  try {
    const file = videosFile(homeDir)
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    const text = rows.length ? `${rows.map((r) => JSON.stringify(r)).join('\n')}\n` : ''
    writeFileSync(tmp, text, 'utf8')
    try { renameSync(tmp, file) } catch {
      try { renameSync(tmp, file) } catch (e) {
        try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
        throw e
      }
    }
    return true
  } catch { return false }
}

/** 找一条（aweme_id 匹配；最后一条优先） */
export function findGroupVideoRow(homeDir, awemeId) {
  const id = String(awemeId || '').trim()
  if (!id) return null
  const rows = readGroupVideoRows(homeDir)
  for (let i = rows.length - 1; i >= 0; i--) if (String(rows[i].aweme_id || '') === id) return rows[i]
  return null
}

/**
 * 改一条（aweme_id 匹配；没有就不改）。返回更新后的行 | null。
 */
export function patchGroupVideoRow(homeDir, awemeId, patch = {}) {
  try {
    const id = String(awemeId || '').trim()
    const rows = readGroupVideoRows(homeDir)
    let idx = -1
    for (let i = rows.length - 1; i >= 0; i--) if (String(rows[i].aweme_id || '') === id) { idx = i; break }
    if (idx < 0) return null
    const next = { ...rows[idx], ...patch, aweme_id: id }
    rows[idx] = next
    if (!writeGroupVideoRows(homeDir, rows)) return null
    return next
  } catch { return null }
}

/* ───────────────────── 详情 / 截图 ───────────────────── */

function parseToolJson(stdout, lastLine = false) {
  const text = String(stdout || '').trim()
  if (!text) return null
  const tries = lastLine ? text.split(/\r?\n/).reverse() : [text]
  for (const t of tries) {
    const s = t.trim()
    if (!s) continue
    const candidates = [s]
    const i = s.indexOf('{')
    if (i > 0) candidates.push(s.slice(i))
    for (const c of candidates) { try { return JSON.parse(c) } catch { /* next */ } }
  }
  return null
}

/** 递归找 aweme 详情对象（跟 groups.mjs 同一套，但这里还要 duration） */
function findAweme(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null
  if (Array.isArray(obj)) {
    for (const v of obj) { const hit = findAweme(v, depth + 1); if (hit) return hit }
    return null
  }
  if (obj.aweme_id && (obj.desc !== undefined || obj.statistics)) return obj
  if (obj.desc !== undefined && obj.statistics && typeof obj.statistics === 'object') return obj
  for (const v of Object.values(obj)) { const hit = findAweme(v, depth + 1); if (hit) return hit }
  return null
}

/** 抖音详情里的 duration 通常是毫秒（6900 = 6.9s）⇒ 统一成秒；小于 100 的当已经是秒 */
function durationSec(d) {
  try {
    let v = Number(d && d.duration)
    if (!Number.isFinite(v) || v <= 0) v = Number(d && d.video && d.video.duration)
    if (!Number.isFinite(v) || v <= 0) return null
    if (v > 100) v = v / 1000
    return Math.round(v * 10) / 10
  } catch { return null }
}

/**
 * 取视频详情（标题/作者/时长/赞/分享链接）。失败不抛。
 * @returns {{ok:boolean, desc:string, author:string, duration:number|null, digg:number, comments:number, url:string, errors:string[]}}
 */
export function fetchVideoDetail({ awemeId, runNodeTool, log } = {}) {
  const out = { ok: false, desc: '', author: '', duration: null, digg: 0, comments: 0, url: 'https://www.douyin.com/video/' + encodeURIComponent(String(awemeId || '')), errors: [] }
  try {
    if (!awemeId) { out.errors.push('缺 aweme_id'); return out }
    if (typeof runNodeTool !== 'function') { out.errors.push('缺 runNodeTool 依赖'); return out }
    const path = `/aweme/v1/web/aweme/detail/?aweme_id=${encodeURIComponent(String(awemeId))}&aid=6383&device_platform=webapp`
    const r = runNodeTool('cdp-fetch.mjs', ['--path', path], { timeout: 180_000 })
    const j = parseToolJson(r.stdout)
    const d = j ? findAweme(j) : null
    if (!d) {
      out.errors.push('详情没解析出 aweme（可能被风控/页面未就绪）')
      try { log?.(`群视频详情没拿到（${awemeId}）：${String(r.stderr || '').slice(0, 160)}`) } catch { /* ignore */ }
      return out
    }
    out.ok = true
    out.desc = String(d.desc || '')
    out.author = String((d.author && d.author.nickname) || '')
    out.duration = durationSec(d)
    out.digg = Number(d.statistics && d.statistics.digg_count) || 0
    out.comments = Number(d.statistics && d.statistics.comment_count) || 0
    const share = d.share_info && (d.share_info.share_url || d.share_info.shareUrl)
    if (share) out.url = String(share)
    return out
  } catch (e) {
    out.errors.push(String(e?.message ?? e).slice(0, 160))
    return out
  }
}

/**
 * ⭐ 挑着看（fish.14 两档）：先取详情拿时长，再决定截几张。
 *   · `duration > 30 && (wants || atMe)` ⇒ 3 帧（10%/50%/90%），mode:'3frames'
 *   · 否则 ⇒ 1 帧，**取第 5 秒**；duration<=5 时取 duration*0.8（至少 0.5 秒），mode:'1frame'
 *   wants = 她主动调 look（调用即 true）；atMe 从 group-videos 记录读。
 * @returns {{ok, aweme_id, wants, atMe, mode:'3frames'|'1frame', at:number|null,
 *            desc, author, duration, digg, comments, url, frames, frameFiles, hint?, errors}}
 */
export function lookVideo({ homeDir, awemeId, framesDir, runNodeTool, log } = {}) {
  const id = String(awemeId || '').trim()
  const out = {
    ok: false, aweme_id: id, wants: true, atMe: false, mode: '1frame', at: null,
    desc: '', author: '', duration: null, digg: 0, comments: 0, url: '',
    frames: [], frameFiles: [], errors: [],
  }
  try {
    if (!id) { out.errors.push('缺 aweme_id'); return out }
    const detail = fetchVideoDetail({ awemeId: id, runNodeTool, log })
    out.desc = detail.desc
    out.author = detail.author
    out.duration = detail.duration
    out.digg = detail.digg
    out.comments = detail.comments
    out.url = detail.url
    if (!detail.ok) out.errors.push(...detail.errors)

    // atMe 从 group-videos 记录读（落盘里 atMe === true）
    const row = findGroupVideoRow(homeDir, id) || {}
    out.atMe = row.atMe === true
    // 详情没拿到时用记录里的时长兜底（null/'' 不能当 0 用）
    const rowDur = row.duration === null || row.duration === undefined || row.duration === ''
      ? null
      : (Number.isFinite(Number(row.duration)) ? Number(row.duration) : null)
    const detailDur = out.duration === null || out.duration === undefined ? null : Number(out.duration)
    const dur = Number.isFinite(detailDur) ? detailDur : rowDur
    if (out.duration === null && dur !== null) out.duration = dur
    // 两档判定：>30 秒 且（她自己想看 / 有人 @ 她）⇒ 3 帧；否则 1 帧第 5 秒
    const threeFrames = Number(dur) > 30 && (out.wants || out.atMe)
    out.mode = threeFrames ? '3frames' : '1frame'
    let atArg = '0.1,0.5,0.9'
    if (!threeFrames) {
      // 第 5 秒；视频比 5 秒短就取 80% 处（至少 0.5 秒），别 seek 到不存在的帧
      const target = Number(dur) > 5 ? 5 : Math.max(0.5, Math.round((Number(dur) > 0 ? Number(dur) * 0.8 : 5) * 10) / 10)
      out.at = target
      atArg = String(target)
      out.hint = '只有一张，看不出来就 action:"delegate" 喊群助手'
    }

    const outDir = String(framesDir || '').trim()
    if (!outDir) out.errors.push('缺 framesDir')
    else {
      try {
        mkdirSync(outDir, { recursive: true })
        const r = runNodeTool('frame-grab.mjs', ['--aweme', id, '--out', outDir, '--at', atArg], { timeout: 240_000 })
        const j = parseToolJson(r.stdout, true)
        const list = j && Array.isArray(j.frames) ? j.frames : []
        for (const f of list) {
          const p = String((f && f.frame) || '')
          if (!p || !existsSync(p)) continue
          let bytes = 0
          try { bytes = statSync(p).size } catch { bytes = 0 }
          out.frames.push(p)
          out.frameFiles.push({ path: p, bytes })
        }
        const wantN = threeFrames ? 3 : 1
        if (!out.frames.length) out.errors.push(`${wantN} 帧没截到${j && j.errors && j.errors[0] ? '：' + String(j.errors[0].error || '').slice(0, 100) : ''}`)
      } catch (e) { out.errors.push(`截图：${String(e?.message ?? e).slice(0, 120)}`) }
    }

    out.ok = Boolean(out.frames.length || detail.ok)
    const keep = threeFrames ? 3 : 1
    out.frames = out.frames.slice(0, keep)
    out.frameFiles = out.frameFiles.slice(0, keep)
    // 写回 group-videos.jsonl（没这条记录就不硬造，只返回结果）
    patchGroupVideoRow(homeDir, id, {
      ...(out.duration === null ? {} : { duration: out.duration }),
      frames: out.frames,
      status: out.frames.length ? 'looked' : 'detail-only',
      mode: out.mode,
      lookedAt: new Date().toISOString(),
    })
    try { log?.(`群视频：look ${id} → ${out.mode}（${out.frames.length} 帧${out.at !== null ? `，第 ${out.at}s` : ''}，时长 ${out.duration ?? '?'}s）`) } catch { /* ignore */ }
    return out
  } catch (e) {
    out.errors.push(String(e?.message ?? e).slice(0, 160))
    return out
  }
}

/* ───────────────────── 外部分析（fish.14：已停用） ───────────────────── */

/**
 * ⭐ fish.14：不接外部 AI 了 —— `summarize` 动作保留但默认 disabled，只返回提示。
 * 看不清视频就去 `action:'delegate'` @群聊小助手 让它总结（见下面 delegate 段）。
 */
export async function summarizeVideo({ awemeId } = {}) {
  return {
    ok: false, disabled: true, mode: 'disabled', aweme_id: String(awemeId || ''),
    reason: '外部分析已停用（不接外部 AI）；看不清就 action:"delegate" @群聊小助手 让它总结',
  }
}

/* ───────────────────── delegate：@群聊小助手 让它总结 ───────────────────── */

/** 24 小时去重文件：`home/group-delegated.json` = { "<aweme_id>": ISO } */
export const delegatedFile = (homeDir) => join(String(homeDir || ''), 'group-delegated.json')

/** 读去重记录（坏文件 ⇒ {}） */
export function readDelegated(homeDir) {
  const j = readJsonSafe(delegatedFile(homeDir))
  if (!j || typeof j !== 'object' || Array.isArray(j)) return {}
  const out = {}
  for (const [k, v] of Object.entries(j)) if (String(k) && typeof v === 'string') out[String(k)] = v
  return out
}

function writeDelegated(homeDir, map) {
  try {
    const file = delegatedFile(homeDir)
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(map, null, 1)}\n`, 'utf8')
    try { renameSync(tmp, file) } catch {
      try { renameSync(tmp, file) } catch (e) {
        try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
        throw e
      }
    }
    return true
  } catch { return false }
}

/** 同一 aweme_id 24 小时内是否已经喊过群助手 */
export function delegatedRecently(homeDir, awemeId, now = new Date(), hours = 24) {
  const id = String(awemeId || '').trim()
  if (!id) return false
  const map = readDelegated(homeDir)
  const t = Date.parse(String(map[id] || ''))
  return Number.isFinite(t) && now.getTime() - t < Math.max(1, Number(hours) || 24) * 3_600_000
}

/** 记一次 delegate（dry 也记 —— 这样第二次 dry 会返回 already） */
export function markDelegated(homeDir, awemeId, now = new Date()) {
  const id = String(awemeId || '').trim()
  if (!id) return null
  const map = readDelegated(homeDir)
  map[id] = (now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()).toISOString()
  writeDelegated(homeDir, map)
  return map[id]
}

/** 拼 @群聊小助手 的那句话（自然点、她自己的口吻；不自称主人） */
export function renderDelegateText({ shareUrl = '', desc = '', assistant = '群聊小助手' } = {}) {
  const url = String(shareUrl || '').trim()
  const brief = String(desc || '').trim().slice(0, 30)
  const at = String(assistant || '群聊小助手').trim() || '群聊小助手'
  return `@${at} 帮本鲸看下这个视频讲了啥：${url}${brief ? `（${brief}）` : ''}`
}

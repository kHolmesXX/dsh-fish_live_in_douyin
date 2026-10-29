/**
 * lib/home/groups.mjs —— 群的一整套后端能力（2026-10-27 fish.10）
 * ============================================================================
 * 群读走浏览器路：`im-send.mjs --read --to <群名>`（`im-http` 的身份铁闸只认 sec_uid，群过不去）。
 * 返回的 messages 是 `{from,text}`，**没有时间戳**，发送者常是 unknown/them ——
 * 所以去重只能按「发送者 + 文本前 160 字」记 seen 数组（最多 80 条，跟 chat-watch 同口径）。
 *
 *   A. 群巡场：readGroupViaTool → archiveGroupLines / updateGroupMemory → 台账一行
 *   C. 分享视频：detectVideoShare 抠 aweme_id / 短链 → appendGroupVideos + 证据（详情+首页图）→ 选择性叫醒
 *   D. 群记忆结构：{ title, impression, members:{ 昵称:{lastSeenAt,count,samples:[最近3句],impression} }, updatedAt }
 *      保留旧字段（quotes / seen）兼容老文件。
 *
 * 文件（都在 `$DOUYIN_HOME/home/`）：
 *   group-seen.json         { groups: { 群名: [去重键…] } }（最多 80/群）
 *   group-patrol.json       { lastAt }（巡场节流）
 *   group-videos.jsonl      { at, group, from, text, aweme_id?, link? }
 *   group-video-state.json  { lastWakeAt }（同类视频 30 分钟冷却）
 * 群印象落在 `$DOUYIN_HOME/memory/group-<群名>.json`（跟 lib/relation.mjs 同一路径规则）。
 * ============================================================================
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { archiveDay } from '../relation.mjs'
import { appendLine } from './ledger.mjs'

/** 巡场默认值（settings.json 的 groupPatrol 段；缺省即这些） */
export const GROUP_DEFAULTS = {
  enabled: true,
  everyMin: 25,
  windowFrom: '09:00',
  windowTo: '23:00',
  videoChance: 0.35,
  videoCooldownMin: 30,
}
export const GROUP_SEEN_MAX = 80
const MEMBERS_MAX = 60

const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}
const readText = (file) => { try { return stripBom(readFileSync(file, 'utf8')) } catch { return '' } }
const readJsonSafe = (file) => { try { return JSON.parse(readText(file)) } catch { return null } }

const safeKey = (s) => String(s || '').replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 60) || 'unknown'
const localDay = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

export const seenFile = (homeDir) => join(String(homeDir || ''), 'group-seen.json')
export const patrolFile = (homeDir) => join(String(homeDir || ''), 'group-patrol.json')
export const videosFile = (homeDir) => join(String(homeDir || ''), 'group-videos.jsonl')
export const videoStateFile = (homeDir) => join(String(homeDir || ''), 'group-video-state.json')
export const groupMemoryFile = (stateDir, title) => join(String(stateDir || ''), 'memory', `group-${safeKey(title)}.json`)

/* ───────────────────────── 设置 ───────────────────────── */

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/
const clampNum = (v, min, max, fb) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(min, Math.min(Math.trunc(n), max)) : fb
}

/** 把 settings.groupPatrol 收成合法值（坏值回默认，不抛） */
export function normalizeGroupSettings(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const chance = Number(src.videoChance)
  const from = String(src.windowFrom ?? '').trim()
  const to = String(src.windowTo ?? '').trim()
  return {
    enabled: src.enabled !== false,
    everyMin: clampNum(src.everyMin, 5, 1440, GROUP_DEFAULTS.everyMin),
    windowFrom: HHMM_RE.test(from) ? from.padStart(5, '0') : GROUP_DEFAULTS.windowFrom,
    windowTo: HHMM_RE.test(to) ? to.padStart(5, '0') : GROUP_DEFAULTS.windowTo,
    videoChance: Number.isFinite(chance) ? Math.max(0, Math.min(chance, 1)) : GROUP_DEFAULTS.videoChance,
    videoCooldownMin: clampNum(src.videoCooldownMin, 1, 1440, GROUP_DEFAULTS.videoCooldownMin),
  }
}

const parseHm = (s) => {
  const m = HHMM_RE.exec(String(s || ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}

/** now 在 windowFrom–windowTo 之间（支持跨零点；from==to = 全天） */
export function inGroupWindow(settings, now = new Date()) {
  const s = normalizeGroupSettings(settings)
  const from = parseHm(s.windowFrom)
  const to = parseHm(s.windowTo)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return true
  const cur = now.getHours() * 60 + now.getMinutes()
  return from < to ? (cur >= from && cur < to) : (cur >= from || cur < to)
}

/** 群列表来源：chatWatchPeers / listeners 里「没有 sec_uid 的项」就是群 */
export function groupNamesFromPeers(peers = []) {
  try {
    return (Array.isArray(peers) ? peers : [])
      .filter((p) => p && !p.sec_uid && String(p.nick || '').trim())
      .map((p) => String(p.nick).trim())
      .filter((n, i, arr) => arr.indexOf(n) === i)
  } catch { return [] }
}

/** 巡场状态：{lastAt} */
export function readGroupPatrolState(homeDir) {
  const j = readJsonSafe(patrolFile(homeDir))
  return { lastAt: typeof (j && j.lastAt) === 'string' ? j.lastAt : '' }
}
export function writeGroupPatrolState(homeDir, patch = {}) {
  const cur = readGroupPatrolState(homeDir)
  try {
    mkdirSync(dirname(patrolFile(homeDir)), { recursive: true })
    const tmp = `${patrolFile(homeDir)}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify({ ...cur, ...patch }, null, 1)}\n`, 'utf8')
    try { renameSync(tmp, patrolFile(homeDir)) } catch {
      try { renameSync(tmp, patrolFile(homeDir)) } catch (e) {
        try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
        throw e
      }
    }
    return true
  } catch { return false }
}

/* ───────────────────────── A. 读群 + 归档 + 群记忆 ───────────────────────── */

const msgKey = (m) => `${String(m?.from || '')}|${String(m?.text || '').slice(0, 160)}`

/** seen 数组（最多 80/群） */
function readSeen(homeDir) {
  const j = readJsonSafe(seenFile(homeDir))
  const groups = j && j.groups && typeof j.groups === 'object' && !Array.isArray(j.groups) ? j.groups : {}
  const out = {}
  for (const [g, arr] of Object.entries(groups)) out[g] = (Array.isArray(arr) ? arr : []).map(String).slice(0, GROUP_SEEN_MAX)
  return out
}
function writeSeen(homeDir, map) {
  try {
    mkdirSync(dirname(seenFile(homeDir)), { recursive: true })
    const tmp = `${seenFile(homeDir)}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify({ groups: map }, null, 1)}\n`, 'utf8')
    try { renameSync(tmp, seenFile(homeDir)) } catch {
      try { renameSync(tmp, seenFile(homeDir)) } catch (e) {
        try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
        throw e
      }
    }
    return true
  } catch { return false }
}

/**
 * 读一个群（浏览器路），按「发送者+文本」去重。
 * @param {{homeDir:string, group:string, runNodeTool:Function, pickJson:Function, log?:Function, timeoutMs?:number}} deps
 * @returns {{ok:boolean, fresh:Array<{from:string,text:string}>, total?:number, error?:string}}
 */
export function readGroupViaTool({ homeDir, group, runNodeTool, pickJson, log, timeoutMs = 240_000 } = {}) {
  const name = String(group || '').trim()
  if (!name) return { ok: false, fresh: [], error: '群名空' }
  try {
    if (typeof runNodeTool !== 'function') return { ok: false, fresh: [], error: '缺 runNodeTool 依赖' }
    const r = runNodeTool('im-send.mjs', ['--read', '--to', name], { timeout: timeoutMs })
    const j = typeof pickJson === 'function' ? pickJson(r.stdout) : (() => { try { return JSON.parse(r.stdout) } catch { return null } })()
    if (!j || !j.ok) return { ok: false, fresh: [], error: String((j && (j.error || j.hint)) || r.stderr || '读不到').slice(0, 160) }
    const msgs = Array.isArray(j.messages) ? j.messages : []
    const seenMap = readSeen(homeDir)
    const seen = Array.isArray(seenMap[name]) ? seenMap[name] : []
    const fresh = []
    for (const m of msgs) {
      const key = msgKey(m)
      if (String(m?.from || '') === 'me') continue   // 自己发的不算群聊素材
      if (seen.includes(key)) continue
      fresh.push({
        from: String(m?.from || 'unknown'),
        text: String(m?.text || '').slice(0, 160),
        // ⭐ fish.11：接口字段（awe/item 判分享视频；sender 是尽力取到的群发言人昵称）
        awe: Number(m?.awe) || 0,
        item: String(m?.item || ''),
        sender: String(m?.sender || '').slice(0, 40),
      })
    }
    const merged = [...msgs.map(msgKey), ...seen].slice(0, GROUP_SEEN_MAX)
    writeSeen(homeDir, { ...seenMap, [name]: merged })
    return { ok: true, fresh, total: msgs.length }
  } catch (e) {
    try { log?.(`读群「${name}」出错：${e?.message ?? e}`) } catch { /* ignore */ }
    return { ok: false, fresh: [], error: String(e?.message ?? e).slice(0, 160) }
  }
}

/**
 * ⭐ fish.11：判断一条群消息是不是「分享视频」——**优先用接口字段**：
 *   `awe === 800 && item` ⇒ 就是视频，aweme_id = item（实测：awe:700 是普通文字，awe:800 带 item 是视频）。
 *   接口字段不认时才退回文本正则（兜底，网络/字段变化时用）。
 * @returns {{isVideo:boolean, aweme_id:string, source:string}}
 */
export function videoShareOfMessage(m) {
  try {
    const awe = Number(m && m.awe) || 0
    const item = String((m && m.item) || '').trim()
    if (awe === 800 && item) return { isVideo: true, aweme_id: item, source: 'awe800' }
    const d = detectVideoShare(m && m.text)
    return { isVideo: Boolean(d.isShare), aweme_id: d.aweme_id || '', source: d.reason || 'text' }
  } catch { return { isVideo: false, aweme_id: '', source: '' } }
}

/** 群消息写进当天归档（channel:'group'；who=发言人昵称，取不到记「（未识别）」） */
export function archiveGroupLines({ stateDir, group, lines = [], now = new Date() } = {}) {
  try {
    const rows = (Array.isArray(lines) ? lines : []).map((m) => ({
      at: new Date(now).toISOString(),
      channel: 'group',
      who: String((m && m.sender) || '（未识别）'),
      group: String(group || ''),
      from: 'them',
      text: String(m?.text || ''),
    })).filter((r) => r.text)
    if (!rows.length) return 0
    return archiveDay(stateDir, rows)
  } catch { return 0 }
}

/** 从群消息猜发言人名字（浏览器读群拿不到昵称；猜不到记「（未识别）」）
 *  @param {string} text
 *  @param {{ignoreAtNames?:string[]}} [opts] 这些名字出现在 @ 后面时不算发言人（一般传 herself / 主人昵称） */
export function guessGroupMemberName(text, opts = {}) {
  const t = String(text || '')
  const head = /^([^\s:：@]{1,12})[:：]/.exec(t)
  if (head) {
    const n = head[1].trim()
    if (!/^(https?|douyin|视频|分享)$/i.test(n)) return n
  }
  const at = /@([^\s@:：,，。]{1,20})/.exec(t)
  if (at) {
    const n = at[1].trim()
    // 那是别人 @ 她 / 主人的名字，不是发言人（名字由调用方传入；默认只挡 @所有人/all）
    const ignores = Array.isArray(opts?.ignoreAtNames) ? opts.ignoreAtNames : []
    if (!ignores.some((x) => String(x || '').trim() && String(x).trim() === n) && !/^(@)?(所有人|all)$/i.test(n)) return n
  }
  return '（未识别）'
}

/**
 * 维护 `memory/group-<名>.json`（D：members.{昵称:{lastSeenAt,count,samples,impression}}，保留旧字段）
 * @returns {number} 本次更新的成员条数；失败返回 0
 */
export function updateGroupMemory({ stateDir, group, lines = [], now = new Date(), log } = {}) {
  try {
    const title = String(group || '').trim()
    if (!title) return 0
    const file = groupMemoryFile(stateDir, title)
    const cur = readJsonSafe(file)
    const base = cur && typeof cur === 'object' && !Array.isArray(cur)
      ? { title, impression: '', members: {}, updatedAt: '', ...cur }
      : { title, impression: '', members: {}, updatedAt: '' }
    const members = base.members && typeof base.members === 'object' && !Array.isArray(base.members) ? { ...base.members } : {}
    let touched = 0
    for (const m of Array.isArray(lines) ? lines : []) {
      const text = String(m?.text || '').trim()
      if (!text) continue
      // ⭐ fish.11：只认接口给的 sender；确实拿不到就不建「（未识别）」成员（群印象只按群级记）
      const name = String((m && m.sender) || '').trim().slice(0, 40)
      if (!name) continue
      const prev = members[name] && typeof members[name] === 'object' ? members[name] : {}
      const samples = (Array.isArray(prev.samples) ? prev.samples : []).map(String)
      samples.push(text.slice(0, 80))
      members[name] = {
        ...prev,
        lastSeenAt: new Date(now).toISOString(),
        count: (Number(prev.count) || Number(prev.seen) || 0) + 1,
        samples: samples.slice(-3),
        impression: String(prev.impression || ''),
        // 旧字段保留（quotes/seen），别让老格式读不出来
        quotes: Array.isArray(prev.quotes) ? prev.quotes : [],
        seen: Number(prev.seen) || Number(prev.count) || 0,
      }
      touched += 1
    }
    // ⭐ fish.11：老文件里可能已经有「（未识别）」成员 —— 写回时顺手删掉，不再新增
    delete members['（未识别）']
    const keys = Object.keys(members)
    if (keys.length > MEMBERS_MAX) {
      // 只留最近出现的 MEMBERS_MAX 个（按 lastSeenAt 排序）
      const keep = keys.sort((a, b) => String(members[b]?.lastSeenAt || '').localeCompare(String(members[a]?.lastSeenAt || ''))).slice(0, MEMBERS_MAX)
      for (const k of keys) if (!keep.includes(k)) delete members[k]
    }
    const next = { ...base, title, members, updatedAt: new Date(now).toISOString() }
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(next, null, 1)}\n`, 'utf8')
    try { renameSync(tmp, file) } catch {
      try { renameSync(tmp, file) } catch (e) {
        try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
        throw e
      }
    }
    return touched
  } catch (e) {
    try { log?.(`群记忆写不进去（${group}）：${e?.message ?? e}`) } catch { /* ignore */ }
    return 0
  }
}

/* ───────────────────────── C. 分享视频识别/记录/叫醒 ───────────────────────── */

const VIDEO_LINK_RE = /(https?:\/\/(?:www\.)?douyin\.com\/video\/(\d{15,20})|v\.douyin\.com\/([A-Za-z0-9_-]{6,}))/i
const BARE_ID_RE = /\b(\d{19})\b/

/**
 * 判断是不是「疑似分享」：含 [视频] / #话题 / douyin 链接 / 19 位 aweme_id / 「分享视频」这类话。
 * @returns {{isShare:boolean, aweme_id:string, link:string, reason:string}}
 */
export function detectVideoShare(text) {
  const t = String(text || '').trim()
  if (!t) return { isShare: false, aweme_id: '', link: '', reason: '' }
  const m = VIDEO_LINK_RE.exec(t)
  const idm = (m && m[2]) ? m[2] : (BARE_ID_RE.exec(t)?.[1] || '')
  const link = (m && m[3]) ? m[0] : ''
  const tag = /#[^\s#]{1,30}/.test(t)
  const videoWord = /\[视频\]|分享(了|一段|一条)?视频|这个视频/.test(t)
  const isShare = Boolean(m) || Boolean(idm) || tag || videoWord
  const reason = m ? '链接' : idm ? 'aweme_id' : tag ? '话题' : videoWord ? '文案' : ''
  return { isShare, aweme_id: idm || '', link: link || '', reason }
}

/** 追加群分享视频记录（写失败只 log） */
export function appendGroupVideos({ homeDir, rows = [], log } = {}) {
  try {
    const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.text)
    if (!list.length) return 0
    const file = videosFile(homeDir)
    mkdirSync(dirname(file), { recursive: true })
    let n = 0
    for (const r of list) {
      const line = JSON.stringify({
        at: String(r.at || new Date().toISOString()),
        group: String(r.group || ''),
        from: String(r.from || '（未识别）'),
        sender: String(r.sender || '').slice(0, 40),
        text: String(r.text || '').slice(0, 200),
        aweme_id: String(r.aweme_id || ''),
        // ⭐ fish.13：挑着看的元信息（先不截图不取详情，省成本）
        atMe: r.atMe === true,
        duration: r.duration === undefined || r.duration === null ? null : Number(r.duration) || null,
        frames: Array.isArray(r.frames) ? r.frames.map(String) : [],
        status: String(r.status || 'new'),
        ...(r.link ? { link: String(r.link) } : {}),
      })
      appendFileSync(file, `${line}\n`, 'utf8')
      n += 1
    }
    return n
  } catch (e) {
    try { log?.(`群视频记录写不进去：${e?.message ?? e}`) } catch { /* ignore */ }
    return 0
  }
}

/** 同类视频冷却状态：{lastWakeAt} */
export function readVideoState(homeDir) {
  const j = readJsonSafe(videoStateFile(homeDir))
  return { lastWakeAt: typeof (j && j.lastWakeAt) === 'string' ? j.lastWakeAt : '' }
}
function writeVideoState(homeDir, patch = {}) {
  try {
    mkdirSync(dirname(videoStateFile(homeDir)), { recursive: true })
    const tmp = `${videoStateFile(homeDir)}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify({ ...readVideoState(homeDir), ...patch }, null, 1)}\n`, 'utf8')
    try { renameSync(tmp, videoStateFile(homeDir)) } catch {
      try { renameSync(tmp, videoStateFile(homeDir)) } catch (e) {
        try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
        throw e
      }
    }
    return true
  } catch { return false }
}

/**
 * 看到分享视频要不要叫醒她：概率 + 30 分钟同类冷却（只在命中时记 lastWakeAt，防连续叫）。
 * @returns {{due:boolean, reason?:string}}
 */
export function videoWakeDecision({ homeDir, settings = {}, now = new Date(), random = Math.random } = {}) {
  try {
    const s = normalizeGroupSettings(settings)
    const st = readVideoState(homeDir)
    const last = Date.parse(st.lastWakeAt || '')
    if (Number.isFinite(last) && now.getTime() - last < s.videoCooldownMin * 60_000) {
      return { due: false, reason: `视频叫醒冷却中（${s.videoCooldownMin} 分钟）` }
    }
    const roll = Number(random())
    if (!(roll < s.videoChance)) return { due: false, reason: `掷骰子没中（chance ${s.videoChance}）` }
    writeVideoState(homeDir, { lastWakeAt: new Date(now).toISOString() })
    return { due: true }
  } catch { return { due: false, reason: '判断出错' } }
}

/** 从 JSON 里递归找 aweme 详情（详情接口的 body 可能是 {aweme_detail:{…}} 或更深的列表） */
function findAweme(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return null
  if (Array.isArray(obj)) {
    for (const v of obj) { const hit = findAweme(v, depth + 1); if (hit) return hit }
    return null
  }
  if (obj.aweme_id && (obj.desc !== undefined || obj.statistics)) return obj
  // 有些详情 body 只给 desc+statistics（aweme_id 在外层/被裁剪）——也给一次机会
  if (obj.desc !== undefined && obj.statistics && typeof obj.statistics === 'object') return obj
  for (const v of Object.values(obj)) { const hit = findAweme(v, depth + 1); if (hit) return hit }
  return null
}

/** cdp-fetch/frame-grab 的 stdout → JSON（cdp-fetch 吐原始响应体；frame-grab 最后一行是 JSON） */
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
    for (const c of candidates) {
      try { return JSON.parse(c) } catch { /* next */ }
    }
  }
  return null
}

/**
 * 拿视频证据：详情（标题/作者/赞评，走 cdp-fetch 页面签名 XHR）+ 首页图（frame-grab → out/frames/）。
 * 任何一步失败都只记 errors，不抛。
 * @returns {{ok:boolean, desc:string, title:string, author:string, digg:number, comments:number, frame:string, errors:string[]}}
 */
export function fetchVideoEvidence({ awemeId, framesDir, runNodeTool, log } = {}) {
  const out = { ok: false, desc: '', title: '', author: '', digg: 0, comments: 0, frame: '', errors: [] }
  try {
    if (!awemeId) { out.errors.push('缺 aweme_id'); return out }
    try {
      const path = `/aweme/v1/web/aweme/detail/?aweme_id=${encodeURIComponent(String(awemeId))}&aid=6383&device_platform=webapp`
      const r = runNodeTool('cdp-fetch.mjs', ['--path', path], { timeout: 180_000 })
      const j = parseToolJson(r.stdout)
      const d = j ? findAweme(j) : null
      if (d) {
        out.desc = String(d.desc || '')
        out.title = out.desc || String(d.caption || '')
        out.author = String(d.author && d.author.nickname ? d.author.nickname : '')
        out.digg = Number(d.statistics && d.statistics.digg_count) || 0
        out.comments = Number(d.statistics && d.statistics.comment_count) || 0
        // ⭐ fish.11：接口带的官方分享链接优先（带签名，点得开）
        const share = d.share_info && (d.share_info.share_url || d.share_info.shareUrl)
        if (share) out.url = String(share)
      } else {
        out.errors.push('详情没解析出 aweme（可能被风控/页面未就绪）')
      }
    } catch (e) { out.errors.push(`详情：${String(e?.message ?? e).slice(0, 120)}`) }
    // 官方视频页 URL 兜底（详情没给 share_url 时用）
    if (!out.url) out.url = `https://www.douyin.com/video/${encodeURIComponent(String(awemeId))}`
    try {
      const r = runNodeTool('frame-grab.mjs', ['--aweme', String(awemeId), '--out', String(framesDir || '.')], { timeout: 180_000 })
      const j = parseToolJson(r.stdout, true)
      const f = j && Array.isArray(j.frames) ? j.frames.find((x) => x && x.frame) : null
      if (f) out.frame = String(f.frame)
      else out.errors.push(`首页图没拿到${j && j.errors && j.errors[0] ? '：' + String(j.errors[0].error || '').slice(0, 80) : ''}`)
    } catch (e) { out.errors.push(`首页图：${String(e?.message ?? e).slice(0, 120)}`) }
    out.ok = Boolean(out.frame || out.desc)
    if (!out.ok) try { log?.(`视频证据没拿到（${awemeId}）：${out.errors.join('；').slice(0, 200)}`) } catch { /* ignore */ }
    return out
  } catch (e) {
    out.errors.push(String(e?.message ?? e).slice(0, 120))
    return out
  }
}

/**
 * ⭐ fish.13：谁 @ 了她 —— 同一批新消息里，@ 出现在视频那条或紧邻 ±span 条内都算「叫她看」。
 */
/** 默认只认「@所有人 / @all」；她的名字由调用方传（不写死任何人的昵称） */
export const GROUP_MENTION_RE = /(@所有人|@\s*all\b)/i
/** 按名字构造「有人 @ 她」判据：她自己的昵称（可多个）+ @所有人/@all */
export function buildGroupMentionRe(names = []) {
  const list = (Array.isArray(names) ? names : [names]).map((x) => String(x || '').trim()).filter(Boolean)
  if (!list.length) return GROUP_MENTION_RE
  const esc = list.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`(@?\\s*(${esc.join('|')})|@所有人|@\\s*all\\b)`, 'i')
}
export function atMeNear(fresh = [], idx = -1, span = 2, names = []) {
  try {
    const list = Array.isArray(fresh) ? fresh : []
    if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return false
    for (let i = Math.max(0, idx - span); i <= Math.min(list.length - 1, idx + span); i++) {
      const re = names && (Array.isArray(names) ? names.length : String(names).trim()) ? buildGroupMentionRe(names) : GROUP_MENTION_RE
      if (re.test(String(list[i] && list[i].text || ''))) return true
    }
    return false
  } catch { return false }
}

/** 群里有人分享视频 → 叫醒词（fish.13：不直接给结论，只说「想看就 look」） */
export function renderGroupVideoWake({ group = '', from = '', sender = '', text = '', aweme_id = '', atMe = false } = {}) {
  const brief = String(text || '').slice(0, 60)
  const who = String(sender || '').trim() || '（未识别）'
  const lines = [
    `【群里有人分享视频】「${group}」的 ${who} 发了个视频（文案：${brief}）${atMe ? '，这条有人 @ 你' : ''}。要不要看看？`,
    `想看就 douyin_group_video {aweme_id:"${aweme_id}", action:"look"}（会截 3 张图，你看完自己决定要不要锐评）；`,
    '不想管就歇着，不是每条都得看。',
  ]
  if (String(sender || '').trim()) lines.push(`（想锐评就用 douyin_group_say，可以 at="${String(sender).trim()}"）`)
  return lines.join('\n')
}

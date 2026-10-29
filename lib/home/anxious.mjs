/**
 * lib/home/anxious.mjs —— 「看到主人不回，她会急 → 连发」（2026-10-27 fish.9 ②）
 * ============================================================================
 * 两条链：
 *   ① 发送现场记 `home/pending.jsonl`：{at, to, to_id, kind, text}（reach_out / douyin_dm / burst 成功时）
 *      收到对方新消息（chat-watch 读到 them / 群消息）⇒ 把这个人的 pending 清掉。
 *   ② anxiousTick（跟 lifeTick 同拍）：某个人最近一条是**她发的**、超过 10 分钟没回、
 *      这条线 60 分钟内还没追问过、且未回条数 < 3 ⇒ 返回 due，由 index.js 叫醒她一次。
 *      状态 `home/anxious.json`：{fired:[{to,at}]}（同一人 60 分钟最多一次；每天最多 5 次）。
 *
 * 文件：
 *   home/pending.jsonl  待回记录（append；对方回话时整条删掉，重写文件）
 *   home/anxious.json   追问记录（{fired:[{to,at}]}，留最近 200 条）
 * ============================================================================
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 判定参数 */
export const ANXIOUS = {
  afterMin: 10,          // 超过 10 分钟没回才算
  cooldownMin: 60,       // 同一个人 60 分钟内最多追问一次
  maxPerDay: 5,          // 每天最多 5 次
  maxUnanswered: 3,      // 未回条数 <3 才催（连发到 3 条就停）
  keepFired: 200,
}

const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}
const readText = (file) => { try { return stripBom(readFileSync(file, 'utf8')) } catch { return '' } }
const readJsonSafe = (file) => { try { return JSON.parse(readText(file)) } catch { return null } }

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

const localDay = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
export const hhmm = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

export const pendingFile = (homeDir) => join(String(homeDir || ''), 'pending.jsonl')
export const anxiousFile = (homeDir) => join(String(homeDir || ''), 'anxious.json')

/** 读 pending（坏行跳过；按时间旧→新） */
export function readPending(homeDir) {
  const out = []
  const text = readText(pendingFile(homeDir))
  if (!text) return out
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let r
    try { r = JSON.parse(line) } catch { continue }
    if (!r || typeof r !== 'object') continue
    out.push({
      at: String(r.at || ''),
      to: String(r.to || ''),
      to_id: String(r.to_id || ''),
      kind: String(r.kind || 'text'),
      text: String(r.text || '').slice(0, 200),
    })
  }
  return out
}

/** append 一条 pending（写失败只 log 不抛）。 */
export function appendPending(homeDir, row = {}, log) {
  try {
    const file = pendingFile(homeDir)
    mkdirSync(dirname(file), { recursive: true })
    const line = JSON.stringify({
      at: String(row.at || new Date().toISOString()),
      to: String(row.to || ''),
      to_id: String(row.to_id || ''),
      kind: String(row.kind || 'text'),
      text: String(row.text || '').slice(0, 200),
    })
    writeFileSync(file, `${line}\n`, { encoding: 'utf8', flag: 'a' })
    return true
  } catch (e) {
    try { log?.(`待回记录写不进去：${e?.message ?? e}`) } catch { /* ignore */ }
    return false
  }
}

const samePerson = (row, who) => {
  const to = String((who && who.to) || '')
  const toId = String((who && who.to_id) || '')
  if (toId && row.to_id && toId === row.to_id) return true
  if (to && row.to && to === row.to) return true
  return false
}

/**
 * 对方回话了 ⇒ 清掉这个人的 pending。
 * @returns {number} 清掉几条
 */
export function clearPendingFor(homeDir, who = {}, log) {
  try {
    const rows = readPending(homeDir)
    if (!rows.length) return 0
    const kept = rows.filter((r) => !samePerson(r, who))
    const removed = rows.length - kept.length
    if (!removed) return 0
    const file = pendingFile(homeDir)
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, kept.length ? `${kept.map((r) => JSON.stringify(r)).join('\n')}\n` : '', 'utf8')
    try { renameSync(tmp, file) } catch {
      try { renameSync(tmp, file) } catch (e) {
        try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
        throw e
      }
    }
    return removed
  } catch (e) {
    try { log?.(`清待回记录失败：${e?.message ?? e}`) } catch { /* ignore */ }
    return 0
  }
}

/** 读追问记录（{fired:[{to,at}]}） */
export function readAnxiousState(homeDir) {
  const j = readJsonSafe(anxiousFile(homeDir))
  const fired = j && Array.isArray(j.fired) ? j.fired.filter((x) => x && typeof x === 'object' && x.to && x.at).map((x) => ({ to: String(x.to), at: String(x.at) })) : []
  return { fired: fired.slice(-ANXIOUS.keepFired) }
}

/** 记一次追问（同一人 60 分钟内不重复；文件里只留最近 200 条） */
export function markAnxiousFired(homeDir, to, now = new Date()) {
  const cur = readAnxiousState(homeDir)
  const fired = [...cur.fired, { to: String(to), at: now.toISOString() }].slice(-ANXIOUS.keepFired)
  writeJsonAtomic(anxiousFile(homeDir), { fired })
  return { fired }
}

/** 读某个人的会话记忆（dm-*.json）→ [{sec_uid, nick, messages}] */
function readDmMemories(stateDir) {
  const out = []
  const dir = join(String(stateDir || ''), 'memory')
  let files = []
  try { files = readdirSync(dir) } catch { files = [] }
  for (const name of files) {
    if (!/^dm-.*\.json$/.test(name)) continue
    const j = readJsonSafe(join(dir, name))
    if (!j || typeof j !== 'object' || Array.isArray(j)) continue
    const who = j.who && typeof j.who === 'object' ? j.who : {}
    const messages = (Array.isArray(j.messages) ? j.messages : []).filter((m) => m && String(m.text || '').trim())
    if (!messages.length) continue
    out.push({ sec_uid: String(who.sec_uid || ''), nick: String(who.nick || ''), messages })
  }
  return out
}

/**
 * 选出「该催一次」的人（纯决策，不投递）。
 * @returns {{due:boolean, to?:string, nick?:string, lastMeAt?:string}}
 */
export function anxiousTick({ stateDir, homeDir, now = new Date() } = {}) {
  try {
    const st = readAnxiousState(homeDir)
    const day = localDay(now)
    const todayCount = st.fired.filter((f) => localDay(new Date(f.at)) === day).length
    if (todayCount >= ANXIOUS.maxPerDay) return { due: false }
    const candidates = []
    for (const dm of readDmMemories(stateDir)) {
      const msgs = dm.messages
      const last = msgs[msgs.length - 1]
      if (!last || last.from !== 'me') continue
      // 未被回复的连发条数：最后一条 them 之后有几条 me
      let lastThem = -1
      for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].from === 'them') { lastThem = i; break } }
      const unanswered = msgs.length - (lastThem + 1)
      if (unanswered < 1 || unanswered >= ANXIOUS.maxUnanswered) continue
      const lastMs = Date.parse(String(last.at || ''))
      if (!Number.isFinite(lastMs)) continue
      if (now.getTime() - lastMs < ANXIOUS.afterMin * 60_000) continue
      const key = dm.sec_uid || dm.nick
      const recent = st.fired.find((f) => f.to === key && now.getTime() - Date.parse(f.at) < ANXIOUS.cooldownMin * 60_000)
      if (recent) continue
      candidates.push({ to: key, nick: dm.nick, lastMeAt: String(last.at), lastMs })
    }
    if (!candidates.length) return { due: false }
    candidates.sort((a, b) => a.lastMs - b.lastMs)   // 等得最久的先催
    const pick = candidates[0]
    return { due: true, to: pick.to, nick: pick.nick, lastMeAt: pick.lastMeAt }
  } catch { return { due: false } }
}

/** 叫醒词（他还没回） */
export function renderAnxiousWake({ lastMeAt = '', nick = '' } = {}) {
  const at = Date.parse(String(lastMeAt || ''))
  const when = Number.isFinite(at) ? hhmm(new Date(at)) : '刚才'
  return [
    `【他还没回】你 ${when} 给${nick ? `「${nick}」` : '他'}发的那句，他到现在没回。`,
    '你要是心里打鼓，可以再发一条（甚至连发 2–3 条）——douyin_reach_burst；但别超过 3 条，也别刷屏。',
  ].join('\n')
}

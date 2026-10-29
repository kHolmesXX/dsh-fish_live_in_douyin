/**
 * lib/home/memory.mjs —— 她的「近期记忆」两块（2026-10-27 fish.2，参考 dsh-world）
 * ============================================================================
 * 为什么要有：
 *   `memory/archive/` 是按天存的原话，但她**不会主动去翻** —— 那等于每次聊天都从零开始。
 *   dsh-world 的做法是两段分工，这里照搬：
 *     ① 近期原文**放在她眼前**（值班会话的系统提示里，最近几天、每人几条，按字数封顶）；
 *     ② 更早的东西**每晚她自己压缩**成一段长期接续（`memory/recent-summary.md`）。
 *   ⇒ 不引新依赖、不碰 DSH 的上下文压缩，纯读本机文件。
 *
 * 两个纯函数（fs 读；任何异常一律降级成空串，绝不抛）：
 *   renderRecentMemory({stateDir, now, days, perPerson, maxPerGroup, maxChars})
 *     · 私信：`memory/dm-*.json` 每人最近 perPerson 条 → `- 「昵称」（stage）：他：… / 我：…`
 *     · 群：`memory/archive/<day>.jsonl` 里 channel:group 的最近 maxPerGroup 条 → `- 群「群名」：…`
 *     · 按最后一条时间倒序；超过 maxChars **从最旧的整条丢**；末尾加一句「更早的用 douyin_archive 翻」
 *   renderRecentSummary({stateDir, maxChars})
 *     · `memory/recent-summary.md`（她每晚 23:00 自己写的）→ `【最近这阵子】\n<内容>`
 * ============================================================================
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 跟 relation.mjs 同一套文件名规则（profile-<safeKey>.json）；只用来"文件在不在"，不做别的 */
const safeKey = (s) => String(s || '').replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 60) || 'unknown'

/** 剥 BOM（Windows/PowerShell 写出来的文件常带 EF BB BF，肉眼看不出、解析会坏） */
const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}

/** 读文本：不存在/读不出 ⇒ ''（不抛） */
function readText(file) {
  try { return stripBom(readFileSync(file, 'utf8')) } catch { return '' }
}

/** 读 JSON：不存在/坏文件 ⇒ null（不抛） */
function readJson(file) {
  const text = readText(file)
  if (!text.trim()) return null
  try { return JSON.parse(text) } catch { return null }
}

/** 压成一行（记忆块要省字数，换行会撑爆排版） */
const oneLine = (s, max = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** 本地日期 YYYY-MM-DD（跟 state.mjs 的 dayKey 同口径；这里不 import 是为了保持模块独立） */
function dayKeyOf(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 把「最近几天她还记得的原文」压成一段给值班会话读的系统提示（空数据返回 ''）。
 *
 * @param {object} opt
 * @param {string} opt.stateDir    插件家目录（memory/ 在它下面）
 * @param {Date}   [opt.now]       当前时间（测试可注入）
 * @param {number} [opt.days=2]    群归档取最近几天（今天往前后 days 天）
 * @param {number} [opt.perPerson=6] 每个私信对象最多几条
 * @param {number} [opt.maxPerGroup=6] 每个群最多几条
 * @param {number} [opt.maxChars=2500] 整块封顶（超过就从最旧的整条丢）
 * @returns {string}
 */
export function renderRecentMemory({
  stateDir, now = new Date(), days = 2, perPerson = 6, maxPerGroup = 6, maxChars = 2500,
} = {}) {
  try {
    const root = String(stateDir || '')
    if (!root) return ''
    const memDir = join(root, 'memory')
    /** @type {Array<{at:number, text:string}>} */
    const entries = []

    // ── ① 私信：每人最近 perPerson 条（dm-*.json 每人最多留 80 条，本身就是近期）──
    let dmFiles = []
    try { dmFiles = readdirSync(memDir).filter((n) => /^dm-.*\.json$/.test(n)) } catch { dmFiles = [] }
    for (const f of dmFiles) {
      const j = readJson(join(memDir, f))
      if (!j || typeof j !== 'object' || Array.isArray(j)) continue
      const who = j.who && typeof j.who === 'object' ? j.who : {}
      const msgs = (Array.isArray(j.messages) ? j.messages : []).filter((m) => m && String(m.text || '').trim())
      if (!msgs.length) continue
      const nick = String(who.nick || '').trim() || '（没名字的人）'
      const secUid = String(who.sec_uid || '')
      // stage 只在**档案文件真的存在**时才写 —— relation.loadProfile 会兜底成「生」，
      // 拿它当"有档案"会把所有陌生人都标成「生」，等于编。
      const stage = (() => {
        if (!secUid) return ''
        const prof = readJson(join(memDir, `profile-${safeKey(secUid)}.json`))
        return prof && typeof prof === 'object' && !Array.isArray(prof) ? String(prof.stage || '').trim() : ''
      })()
      const last = msgs[msgs.length - 1]
      /**
       * ⭐ 2026-10-27 修：以前取"最近 N 条"，结果全是她自己发的卡片文案（值班轮一小时发 5 条），
       *   他说的一个字都没有 —— 那不是"记得他"，那是"记得自己发过什么"。
       *   现在按说话人各取一半（对方优先），再按时间合并，至少保证他的原话在眼前。
       */
      const half = Math.max(1, Math.ceil(Math.max(1, perPerson) / 2))
      const theirs = msgs.filter((m) => m.from === 'them').slice(-half)
      const mine = msgs.filter((m) => m.from !== 'them').slice(-half)
      const merged = [...theirs, ...mine]
        .map((m, i) => ({ m, i }))
        .sort((a, b) => (Date.parse(String(a.m.at || '')) || 0) - (Date.parse(String(b.m.at || '')) || 0) || a.i - b.i)
        .map(({ m }) => `${m.from === 'them' ? '他' : '我'}：${oneLine(m.text)}`)
      const parts = merged.slice(-Math.max(1, perPerson))
      entries.push({
        at: Date.parse(String(last.at || j.updatedAt || '')) || 0,
        text: `- 「${nick}」${stage ? `（${stage}）` : ''}：${parts.join(' / ')}`,
      })
    }

    // ── ② 群：最近 days 天的归档里，每个群最近 maxPerGroup 条 ──
    const byGroup = new Map()   // 群名 → 该群所有最近几天的行（按时间旧→新）
    for (let i = 0; i < Math.max(1, days); i++) {
      const d = new Date(now.getTime() - i * 86_400_000)
      const text = readText(join(memDir, 'archive', `${dayKeyOf(d)}.jsonl`))
      if (!text) continue
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        let r
        try { r = JSON.parse(line) } catch { continue }
        if (!r || typeof r !== 'object' || String(r.channel || '') !== 'group') continue
        const title = String(r.who || '').trim()
        if (!title || !String(r.text || '').trim()) continue
        if (!byGroup.has(title)) byGroup.set(title, [])
        byGroup.get(title).push(r)
      }
    }
    for (const [title, rows] of byGroup) {
      if (!rows.length) continue
      rows.sort((a, b) => (Date.parse(String(a.at || '')) || 0) - (Date.parse(String(b.at || '')) || 0))
      const parts = rows.slice(-Math.max(1, maxPerGroup))
        .map((r) => `${r.from === 'me' ? '我' : '他'}：${oneLine(r.text)}`)
      entries.push({
        at: Date.parse(String(rows[rows.length - 1].at || '')) || 0,
        text: `- 群「${title}」：${parts.join(' / ')}`,
      })
    }

    if (!entries.length) return ''

    // ── ③ 按最后一条时间倒序；超字数**从最旧的整条丢** ──
    entries.sort((a, b) => b.at - a.at)
    const kept = entries.slice()
    const body = () => kept.map((e) => e.text).join('\n')
    while (kept.length > 0 && body().length > maxChars) kept.pop()
    if (!kept.length) return ''

    // 末尾这句不是装饰：它把「更早的事」明确推给 douyin_archive，省得她凭印象编
    return `${body()}\n（更早的用 douyin_archive 翻，别凭印象编）`
  } catch { return '' }
}

/**
 * 她自己每晚写的「最近这阵子」长期接续（`memory/recent-summary.md`）。
 * 没有 / 空文件 ⇒ ''（这时只有近期原文那一块，不编造摘要）。
 *
 * @param {{stateDir?:string, maxChars?:number}} opt
 * @returns {string}
 */
export function renderRecentSummary({ stateDir, maxChars = 800 } = {}) {
  try {
    const root = String(stateDir || '')
    if (!root) return ''
    const text = readText(join(root, 'memory', 'recent-summary.md')).trim()
    if (!text) return ''
    return `【最近这阵子】\n${text.slice(0, Math.max(1, maxChars))}`
  } catch { return '' }
}

/**
 * lib/home/selfdrive.mjs —— 「她自己找事做」纯逻辑（2026-10-27 fish.7 A+C）
 * ============================================================================
 * 两个纯函数（不依赖 ctx，方便单测）：
 *
 *   ① freeTimeHit(freeTimes, now, fired)
 *      A：定点自由时间。now 落在某个时间点**后面 10 分钟窗口内**、且今天这个点还没发过
 *      ⇒ 返回命中的 'HH:MM'，否则 ''。窗口 [起点, 起点+10)：例如 14:30 的窗口是 14:30–14:39。
 *      `fired` 是 life.json 的 freeFired.keys（当天已发的点位）。
 *
 *   ② toolActivityRow(event)
 *      C：从 DSH 的会话事件里识别「她调了个工具」，转成 home/journal.jsonl 的一行
 *      `{at, auto:true, tool, summary}`。字段名照 dsh-world 的 lib/life/journal.js：
 *        event.type === 'tool/call'；event.data.name / event.data.arguments；event.time（ms）
 *      跳过 douyin_note_activity（她自己写台账那条别重复记）；不是工具调用 ⇒ null。
 * ============================================================================
 */

/** 每轮最多记多少条工具台账（防刷屏；index.js 的 turn/start、turn/end 归零） */
export const JOURNAL_AUTO_LIMIT = 20
/** 定点自由时间的窗口长度（分钟）：到点后 10 分钟内叫一次 */
export const FREE_WINDOW_MIN = 10

/**
 * @param {string[]} freeTimes  形如 ['14:30','20:30']
 * @param {Date} [now]
 * @param {string[]} [fired]    今天已经发过的点位
 * @returns {string} 命中的 'HH:MM'（没命中 ⇒ ''）
 */
export function freeTimeHit(freeTimes, now = new Date(), fired = []) {
  try {
    const times = Array.isArray(freeTimes) ? freeTimes : []
    const keys = Array.isArray(fired) ? fired.map(String) : []
    if (!times.length) return ''
    const cur = now.getHours() * 60 + now.getMinutes()
    for (const t of times) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? ''))
      if (!m) continue
      const diff = cur - (Number(m[1]) * 60 + Number(m[2]))
      if (diff >= 0 && diff < FREE_WINDOW_MIN && !keys.includes(String(t))) return String(t)
    }
    return ''
  } catch { return '' }
}

/**
 * 工具调用事件 → 台账行（不是工具调用/不该记的 ⇒ null）。
 * @param {{type?:string, time?:number, data?:object}} event
 * @returns {{at:string, auto:true, tool:string, summary:string} | null}
 */
export function toolActivityRow(event) {
  try {
    if (!event || event.type !== 'tool/call') return null
    const data = event.data && typeof event.data === 'object' ? event.data : {}
    const tool = String(data.name || '').slice(0, 60)
    if (!tool) return null
    if (tool === 'douyin_note_activity') return null   // 她自己写台账那条，别重复记
    let summary = ''
    try { summary = JSON.stringify(data.arguments === undefined ? {} : data.arguments).slice(0, 80) } catch { summary = '' }
    const at = new Date(Number(event.time) || Date.now()).toISOString()
    return { at, auto: true, tool, summary }
  } catch { return null }
}

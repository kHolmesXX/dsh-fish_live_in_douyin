/**
 * dsh-douyin-scroll —— 浏览器半端（设置在「设置」里的一页，中文名「刷抖音」）
 * ============================================================================
 * 2026-10-22 从零重写的最小可用版：先确保**面板一定能显示**，再谈功能。
 * 之前那版 700+ 行、7 个折叠区，一旦某处报错整页就没了。
 * 这一版只有 4 块：状态 / 三步装机 / 刷什么 / 什么时候跑。
 *
 * ⭐ 关键设计：整个面板包在 Boundary（error boundary）里 ——
 *    任何子组件抛错只显示"这页出错了 + 重试"，不会再整块消失。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-douyin-scroll',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/douyin-duty'

    /**
     * ⭐ 面板构建号 —— **每次改完 client.js 就 +1**。
     *    为什么需要它：改 client.js 后如果不重启/刷新，浏览器会一直用缓存的旧 bundle，
     *    面板看起来"没变化"，很难判断是代码错了还是没加载。
     *    对一下面板右上角显示的 `v<版本>·b<N>` 就知道。
     */
    const PANEL_BUILD = 33

    const asJson = async (res) => {
      if (res.ok) return res.json()
      const why = res.status === 401 ? '（未登录 / 没权限）' : res.status === 403 ? '（被宿主拦了）' : ''
      throw new Error('HTTP ' + res.status + why)
    }
    const jget = async (p) => asJson(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) => asJson(await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }))
    // jpost 但失败/404 返回 null（用在新旧宿主兼容探测上，不炸面板）
    const jpostSoft = async (p, body) => { try { return await jpost(p, body) } catch { return null } }

    const CSS = `
[data-dy-page]{display:flex;flex-direction:column;gap:16px;padding:4px 2px 10px;max-width:660px;font-size:13px;}
[data-dy-card]{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:12px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.06));}
[data-dy-title]{font-size:13px;font-weight:600;}
[data-dy-sub]{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-dy-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-dy-grow]{flex:1;min-width:0;}
[data-dy-btn]{padding:7px 13px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.14));color:inherit;}
[data-dy-btn]:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.24));}
[data-dy-btn][data-primary]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-dy-btn][disabled]{opacity:.5;cursor:default;}
[data-dy-input]{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;font-size:12px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.12));color:inherit;font-family:inherit;}
[data-dy-input]:focus{outline:none;border-color:#3b82f6;}
[data-dy-badge]{font-size:11px;padding:3px 8px;border-radius:6px;
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.14));
  color:var(--dsw-alias-label-secondary,#c9ccd1);}
[data-dy-badge][data-on]{background:rgba(34,197,94,.16);color:#22c55e;}
[data-dy-badge][data-off]{background:rgba(245,158,11,.16);color:#f59e0b;}
[data-dy-msg]{font-size:11px;line-height:17px;padding:8px 10px;border-radius:8px;
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.12));
  color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-dy-msg][data-good]{color:#22c55e;}
[data-dy-msg][data-warn]{color:#f59e0b;}
[data-dy-kv]{font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-dy-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;padding:0;}
[data-dy-sw][data-on]{background:#3b82f6;}
[data-dy-sw] i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;
  background:#fff;transition:left .15s;display:block;}
[data-dy-sw][data-on] i{left:19px;}
[data-dy-seg]{display:inline-flex;flex:none;border-radius:8px;overflow:hidden;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));}
[data-dy-segbtn]{border:0;background:transparent;color:var(--dsw-alias-label-secondary,#c9ccd1);
  font-size:11px;padding:4px 10px;cursor:pointer;}
[data-dy-segbtn][data-on]{background:#3b82f6;color:#fff;}
[data-dy-pre]{margin:0;padding:9px 10px;border-radius:8px;max-height:180px;overflow:auto;
  font-size:11px;line-height:15px;white-space:pre-wrap;word-break:break-all;
  background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.25));
  color:var(--dsw-alias-label-secondary,#c9ccd1);}
[data-dy-time]{flex:none;width:78px;box-sizing:border-box;padding:6px 8px;border-radius:7px;
  font-size:12px;font-family:inherit;text-align:center;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.12));color:inherit;}
[data-dy-time]:focus{outline:none;border-color:#3b82f6;}
[data-dy-mini]{padding:5px 10px;border-radius:7px;font-size:11px;cursor:pointer;font-family:inherit;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.14));color:inherit;}
[data-dy-mini]:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.24));}
[data-dy-mini][disabled]{opacity:.5;cursor:default;}
[data-dy-mini][data-danger]{color:#f87171;}
/* 桌宠人格卡（2026-10-24 v5） */
[data-dy-personas]{display:flex;gap:8px;flex-wrap:wrap;}
[data-dy-pcard]{flex:1;min-width:150px;padding:10px;border-radius:10px;cursor:pointer;text-align:left;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.1));color:inherit;font-family:inherit;}
[data-dy-pcard][data-on]{border-color:#3b82f6;background:rgba(59,130,246,.14);}
[data-dy-pcard-name]{font-size:12px;font-weight:600;}
[data-dy-pcard-desc]{font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);margin-top:3px;line-height:15px;}
[data-dy-wrow]{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;}
[data-dy-sep]{font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-dy-step]{flex:none;width:20px;height:20px;border-radius:50%;font-size:11px;font-weight:600;
  display:inline-flex;align-items:center;justify-content:center;
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.18));
  color:var(--dsw-alias-label-secondary,#c9ccd1);}
[data-dy-step][data-done]{background:rgba(34,197,94,.18);color:#22c55e;}
[data-dy-loginbox]:empty{display:none;}
[data-dy-qr]{display:block;}
[data-dy-people]{display:flex;flex-direction:column;gap:4px;max-height:260px;overflow:auto;
  padding:4px;border-radius:9px;background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.16));}
[data-dy-person]{display:flex;align-items:center;gap:8px;width:100%;text-align:left;cursor:pointer;
  padding:7px 9px;border-radius:7px;border:0;background:transparent;color:inherit;font-family:inherit;font-size:12px;}
[data-dy-person]:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.22));}
[data-dy-person][data-picked]{background:rgba(59,130,246,.14);}
[data-dy-person][disabled]{cursor:default;opacity:.6;}
[data-dy-person-name]{font-weight:600;flex:none;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
[data-dy-person-sub]{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-dy-tag]{flex:none;font-size:10px;padding:1px 6px;border-radius:5px;
  background:rgba(245,158,11,.16);color:#f59e0b;}
[data-dy-tag][data-ok]{background:rgba(34,197,94,.16);color:#22c55e;}
[data-dy-msgrow]{padding:7px 9px;border-radius:8px;background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.14));}
[data-dy-chat]{display:flex;flex-direction:column;gap:6px;max-height:320px;overflow:auto;
  padding:8px;border-radius:9px;background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.16));}
[data-dy-bubble]{max-width:78%;padding:7px 10px;border-radius:10px;font-size:12px;line-height:17px;
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.2));align-self:flex-start;}
[data-dy-bubble][data-mine]{align-self:flex-end;background:rgba(59,130,246,.22);}
[data-dy-bubble][data-them]{align-self:flex-start;background:rgba(128,128,128,.24);}
[data-dy-bubble-text]{white-space:pre-wrap;word-break:break-word;}
/* ── 面板三组（2026-10-25 重排）：20+ 张卡压成 7 张，分「常开必看 / 出问题才看 / 一次配好」──
 * 实际 DOM 结构（两层，别忘了）：
 *   div[data-dy-group]                 组容器（一组一行，flex）
 *     ├─ span[data-dy-groupname]       组名（常开必看 / 出问题才看 / 一次配好）
 *     └─ button[data-dy-groupbtn]      **只有折叠组有**：能点，带 data-open / aria-expanded
 *          └─ span[data-dy-groupchev]  「展开看 ▼ / 收起 ▲」或组①的提示文字
 * 组容器自己**不**带 data-dy-card ⇒ 卡片计数才正好 7。
 * [data-dy-subblock] 合并进同一张卡里的子块（带上分隔线；卡里第一块不出线）
 * [data-dy-inner]    原本就嵌在卡里的透明小卡（不参与顶层卡片计数）
 * [data-dy-subflat]  那两个状态屏（她的所思所想 / 聊天模式状态）的虚线框 */
[data-dy-group]{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;
  letter-spacing:.04em;color:var(--dsw-alias-label-secondary,#c9ccd1);}
div[data-dy-group]{padding:2px 4px 0;}
/* 折叠组：整行做成一颗大按钮，一眼看得出能点 */
button[data-dy-groupbtn]{width:100%;box-sizing:border-box;text-align:left;padding:10px 12px;
  border-radius:10px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;
  letter-spacing:.04em;display:flex;align-items:center;gap:8px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.08));color:inherit;}
button[data-dy-groupbtn]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.2));}
button[data-dy-groupbtn][data-open]{color:var(--dsw-alias-label-secondary,#c9ccd1);}
[data-dy-grouphint]{font-size:11px;font-weight:400;letter-spacing:0;
  color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-dy-groupchev]{margin-left:auto;font-size:11px;font-weight:400;letter-spacing:0;
  color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-dy-inner]{display:flex;flex-direction:column;gap:10px;}
[data-dy-subblock]{display:flex;flex-direction:column;gap:10px;margin-top:10px;padding-top:10px;
  border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));}
[data-dy-subblock]:first-child{margin-top:0;padding-top:0;border-top:0;}
[data-dy-subflat]{display:flex;flex-direction:column;border-radius:10px;box-sizing:border-box;}
/* （旧版 GUI 浮层小宠的样式已随 v3 迁往 dsh-deskpet 删除） */
`

    function Switch({ on, onChange, disabled }) {
      return h('button', {
        'data-dy-sw': '', 'data-on': on ? '' : undefined,
        disabled: Boolean(disabled),
        onClick: () => { if (!disabled) onChange(!on) },
      }, h('i'))
    }

    /**
     * ⭐ 聊天模式的实时状态屏（2026-10-24，使用者两轮反馈打磨成拟人版）。
     *    使用者原话：「显示 AI 现在在干嘛」→「要拟人，小鱼在干啥干啥，
     *    最后是小鱼抱着手机等着你发消息呢，还有正在发送之类的」。
     *    设计：一条**小鱼的动作**（emoji + 一句话）+ 一行小字（技术参数，给排障用）。
     *    每 15 秒拉一次 /chat/watch（读状态文件，很轻）。
     */
    function ChatWatchStatus() {
      const [s, setS] = React.useState(null)
      const [tick, setTick] = React.useState(0) // 本地 1 秒一跳：让"下次还有 X 秒"活起来
      React.useEffect(() => {
        let alive = true
        const pull = async () => {
          try { const r = await jget('/chat/watch'); if (alive && r && r.ok) setS(r) } catch { /* 拉不到等下一拍 */ }
        }
        pull()
        const t = setInterval(pull, 15_000)
        const t2 = setInterval(() => setTick((x) => x + 1), 1000)
        return () => { alive = false; clearInterval(t); clearInterval(t2) }
      }, [])
      if (!s) return h('div', { 'data-dy-sub': '' }, '🐟 小鱼正在游过来…（状态加载中）')
      void tick // tick 只用于触发重渲染，不直接读
      const ago = s.lastCheckAt ? Math.max(0, Math.round((Date.now() - s.lastCheckAt) / 1000)) : null
      const sec = Number(s.sec || 30)
      const nextIn = s.lastCheckAt ? Math.max(0, sec - ago) : sec
      /* ⭐⭐ 2026-10-26 凌晨（主人：「如果是普通用户，他该怎么办，没那么聪明啊」）
       *   面板不再让用户读内部字段（lastResult / lastError 是给排障的），
       *   分两层显示：
       *     第一层 = 后端给的一句人话（s.human）+ 该干什么（s.action）—— 普通人只看这层
       *     第二层 = 技术细节（几秒前 · 走了哪条路 · 看了几次）—— 默认小字，排障才看
       *   health=broken 时把 action 高亮成橙色，warning 黄色，ok 绿点。
       */
      const health = s.health || (s.lastResult === 'error' ? 'warning' : 'ok')
      const DOT = { ok: '🟢', warning: '🟡', broken: '🔴', off: '⚪' }
      const FISH = {
        ok: `🐟 小鱼抱着手机趴在缸边等着呢——刚看过（${ago} 秒前），还没有新消息。下次去看还有 ${nextIn} 秒`,
        ok_prime: `🐳 小鱼刚接班，正在把聊天记录翻到最新一页（之前的不重播，从现在起只等新的）`,
        ok_new: `🔔 小鱼看到新消息了：「${s.lastNewText || ''}」——已经转给值班的小鱼接话`,
        error: `😵 小鱼撞缸了`,
        no_match: `🤔 小鱼在已建立会话里没找到「${s.to || '这个人'}」：${s.lastNote || '陌生人消息走不了这条路'}`,
        off: `😴 开关关了，小鱼在缸底睡觉（这条是旧状态）`,
        skip_no_to: `🫥 小鱼不知道该盯谁——还没选私信对象`,
        skip_no_login: `🫥 小鱼进不去抖音——还没登录`,
      }
      // 后端给了人话就用它（普通人只看得懂那个）；没给才退回老的拟人句
      const line = s.human || FISH[s.lastResult] || `🐟 小鱼状态：${s.lastResult || '刚下水，还没跑第一拍'}`
      const tone = health === 'broken' ? '#f59e0b' : health === 'warning' ? '#fbbf24' : null
      return h('div', { 'data-dy-inner': '', 'data-dy-subflat': '', style: { background: 'transparent', border: '1px dashed var(--dsw-alias-border-l2,rgba(255,255,255,.14))', padding: '8px 10px', gap: '4px' } },
        h('div', { 'data-dy-sub': '', style: { opacity: '.95' } }, `${DOT[health] || '🐟'} ${line}`),
        // 该干什么：只有真需要用户动手时才显示（action 为空 = 不用管）
        s.action
          ? h('div', { 'data-dy-sub': '', style: { color: tone || 'inherit', fontWeight: '500' } }, `👉 ${s.action}`)
          : null,
        h('div', { 'data-dy-sub': '', style: { opacity: '.7' } },
          `每 ${sec} 秒看一眼「${s.to || '私信对象'}」· 走 ${s.via || 'http'} · 已看 ${s.checks || 0} 次 · 提醒过 ${s.notified || 0} 条${s.failStreak ? ` · 连续失败 ${s.failStreak} 次` : ''}`))
    }

    /**
     * ⭐ 关键：绝不能让组件抛错把整页搞没。
     *    用 error boundary 包住 —— 任何子组件炸了只显示一句提示 + 重试，
     *    而不是像之前那样整块空白（一个 TDZ 错误就能让面板彻底消失）。
     */
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { err: null }
      }
      static getDerivedStateFromError(err) {
        return { err: String((err && err.message) || err) }
      }
      render() {
        if (this.state.err) {
          return h('div', { 'data-dy-card': '' },
            h('div', { 'data-dy-title': '' }, '⚠️ 这个面板出错了'),
            h('div', { 'data-dy-sub': '' }, this.state.err),
            h('div', { 'data-dy-row': '' },
              h('button', {
                'data-dy-btn': '',
                onClick: () => this.setState({ err: null }),
              }, '重试')))
        }
        return this.props.children
      }
    }

    function Panel() {
      const [st, setSt] = React.useState(null)
      const [cfg, setCfg] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [msgTone, setMsgTone] = React.useState('')
      const [kws, setKws] = React.useState(null)
      /** ⭐ 一键自救的结果（{ok, human, need_user, fixed}）—— null = 还没点过 */
      const [chatFix, setChatFix] = React.useState(null)
      const [doctor, setDoctor] = React.useState(null)
      const [report, setReport] = React.useState(null)
      const [wins, setWins] = React.useState(null)
      const [upd, setUpd] = React.useState(null)
      const [ai, setAi] = React.useState(null)
      const [copied, setCopied] = React.useState('')
      // ⭐ 共享登录状态（单例；与「她的家」共用一份，见文件末尾 loginStore）
      const login = useDouyinLogin()
      // 私信对象：列表 + 选中的那个人
      const [people, setPeople] = React.useState(null)
      const [peopleHint, setPeopleHint] = React.useState('')
      // 新手流程说明
      const [guide, setGuide] = React.useState(null)
      // 当前登录的账号
      const [acc, setAcc] = React.useState(null)
      // 人设（使用者自己那份）
      const [persona, setPersona] = React.useState(null)
      // 私信对象：手动填的模式
      const [manualDm, setManualDm] = React.useState(null)
      // 每天挑几条（输入框草稿）
      const [perDayDraft, setPerDayDraft] = React.useState(null)
      // 记忆统计
      const [mem, setMem] = React.useState(null)
      // 消息（收件箱）：评论区 @ 我 + 谁私信我
      const [inbox, setInbox] = React.useState(null)
      // 聊天：当前跟谁聊、消息列表、输入框
      const [chat, setChat] = React.useState(null)
      const [chatText, setChatText] = React.useState('')
      // 最近一轮的日志
      const [runLog, setRunLog] = React.useState(null)
      // 「评论区 @ 提醒」（0.5.9）：开关 = 总闸，atPeers 多选 = 范围；会话列表只读一次
      // 聊天盯梢间隔的输入草稿（2026-10-24）
      const [cwSecDraft, setCwSecDraft] = React.useState(null)
      // dsh 入口路径（输入框草稿）—— 2026-10-23 加，见「出问题了？」卡片
      const [dshBinDraft, setDshBinDraft] = React.useState(null)
      /* ⭐ 面板三组折叠（2026-10-25 重排）—— 两个状态，默认都收起。
       * 🔴 必须放在这里（和其它 useState 一起、在 `if (!st || !cfg) return` 之前），
       *    绝不能塞进条件分支：React 的 hook 顺序一变，整页就白。
       *    · foldErr = 「出问题才看」（体检 / dsh 入口 / 关于 / MCP）
       *    · foldCfg = 「一次配好」（策略 / 桌宠 / 消息与记忆） */
      const [foldErr, setFoldErr] = React.useState(false)
      const [foldCfg, setFoldCfg] = React.useState(false)

      const say = (t, tone) => { setMsg(t); setMsgTone(tone || '') }

      /**
       * ⭐ 查登录的号：带重试的账号查询（主人 2026-10-24 验收「一直显示正在查登录的号」）。
       *    旧版只在面板打开时查一次，/account 慢或失败就永远停在「正在查…」。
       *    现在：先拿缓存（秒回）；空/失败则带 refresh=1 强查，最多重试 3 次（间隔 4s）。
       */
      const loadAccount = async (attempt) => {
        try {
          let a = null
          try { a = await jget('/account') } catch { a = null }
          if (a && a.account && a.account.nick) { setAcc(a.account); return true }
          // 缓存空/没昵称 ⇒ 强制查一次（宿主跑体检，慢但准）
          a = await jget('/account?refresh=1')
          if (a && a.account && (a.account.nick || a.account.uid)) { setAcc(a.account); return true }
          return false
        } catch {
          if ((attempt || 0) < 2) {   // 还有得救：4 秒后再来（宿主可能正忙）
            await new Promise((r) => setTimeout(r, 4000))
            return loadAccount((attempt || 0) + 1)
          }
          return false
        }
      }

      React.useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const [s, c] = await Promise.all([jget('/status'), jget('/config')])
            if (!alive) return
            setSt(s)
            if (c && c.config) setCfg(c.config)
            if (s && s.loggedIn) {
              // 账号昵称：带重试，查到才把「正在查登录的号…」换下来
              const okAcc = alive ? await loadAccount(0) : false
              if (alive && !okAcc) {
                // 查了三轮还是空：挂一句实话，别让主人盯着"正在查"干等
                setAcc({ nick: '', uid: '', alive: false, at: '', failed: true })
                say('登录态在，但昵称没查到 —— 不影响使用', 'warn')
              }
            }
          } catch (e) {
            if (alive) say('读设置失败：' + String((e && e.message) || e), 'warn')
          }
        })()
        return () => { alive = false }
      }, [])

      const patch = async (p, label) => {
        setBusy('patch')
        try {
          const r = await jpost('/config', p)
          if (r && r.config) setCfg(r.config)
          say(label || '已保存', 'good')
        } catch (e) { say('保存失败：' + String((e && e.message) || e), 'warn') }
        finally { setBusy('') }
      }

      const onDoctor = async () => {
        setBusy('doctor')
        try {
          const r = await jpost('/doctor', {})
          setDoctor(r)
          const bad = (r.must_fix || []).length
          say(bad ? ('检查完：' + bad + ' 项要修') : '检查完：环境没问题', bad ? 'warn' : 'good')
        } catch (e) { say('检查失败：' + String((e && e.message) || e), 'warn') }
        finally { setBusy('') }
      }

      const onInstall = async () => {
        setBusy('install')
        try { await jpost('/install', {}); say('开始装依赖，进度看日志', 'good') }
        catch (e) { say('装依赖失败：' + String((e && e.message) || e), 'warn') }
        finally { setBusy('') }
      }

      /** 刷新状态（登录成功 / 装完之后要让按钮和进度条变） */
      const refresh = async () => {
        try {
          const [s, c] = await Promise.all([jget('/status'), jget('/config')])
          if (s) setSt(s)
          if (c && c.config) setCfg(c.config)
          if (s && s.loggedIn) {
            const okAcc = await loadAccount(0)
            if (!okAcc) setAcc({ nick: '', uid: '', alive: false, at: '', failed: true })
          } else setAcc(null)
        } catch { /* 刷不动就留着旧的 */ }
      }

      /* 共享登录卡不直接改本面板的 st —— 登录态一变就重刷整页状态（退出也刷） */
      React.useEffect(() => {
        if (login.loggedIn === null) return undefined
        refresh()
        const t = setTimeout(refresh, 1200)   // 扫码成功后 account.json 可能晚半拍落盘
        return () => clearTimeout(t)
      }, [login.loggedIn])

      /* ⭐ 2026-10-27：扫码登录的 state / 轮询 / 出码 / 关窗 / 退出全部搬进
       *   **共享登录单例**（loginStore，见文件末尾「她的家」段）。
       *   原来这里有一套 onQr / onWaitLogin / onCloseLogin / onLogout，两个面板各一份
       *   会互相把共用 chrome-profile 的浏览器关掉 —— 现在只留一份，本面板用
       *   useDouyinLogin() + <DhLoginCard compact /> 消费它。
       *   🔴 历史 bug：旧代码 `onClick: onQr` 把事件对象当 force 传 ⇒ 每次点「扫码登录」
       *      都 force=1（先杀掉共用浏览器）。共享卡里普通按钮走 start(false)，
       *      只有「重新出码」才 start(true)。 */

      /**
       * ⭐ 列出会话里的人 —— 让用户点选，不用手填 sec_uid。
       *    （2026-10-22 用户指出：新手不可能知道「稳定 id」是什么，更找不到）
       */
      const loadPeople = async () => {
        setBusy('people'); setPeopleHint('')
        try {
          const r = await jpost('/dm/people', {})
          if (r && r.ok) {
            setPeople(r.people || [])
            setPeopleHint(r.hint || '')
            if (!(r.people || []).length) say('会话列表是空的', 'warn')
            else say(`找到 ${r.people.length} 个人`, 'good')
          } else {
            setPeople([])
            setPeopleHint((r && (r.hint || r.error)) || '读不到会话列表')
            say('读不到会话列表', 'warn')
          }
        } catch (e) { setPeopleHint('读不到会话列表：' + String((e && e.message) || e)); say('读失败', 'warn') }
        finally { setBusy('') }
      }

      /** 0.5.5 私信对象列表：点选 = 追加进 dmPeers（去重），不再覆盖单值 */
      const pickPerson = async (p) => {
        const cur = Array.isArray(cfg.dmPeers) ? cfg.dmPeers : []
        const same = cur.some((x) => (p.sec_uid && x.sec_uid === p.sec_uid) || (!p.sec_uid && x.nick === p.nick))
        if (same) { say(`「${p.nick}」已经在列表里了`, 'warn'); return }
        const next = [...cur, { nick: p.nick, sec_uid: p.sec_uid || '' }]
        await patch({ dmPeers: next }, `已把「${p.nick}」加进私信对象（共 ${next.length} 人）`)
      }

      /* 0.5.7 「听他的话」开关已删（主人定稿：聊天模式开着 = 谁私信都接，列表只管发给谁） */

      /** 0.5.9 「评论区 @ 提醒」多选：开关管总闸，列表管范围；点人 = 加入/移除
       *  会话列表复用私信区读到的 people（读一次，不反复拉）
       *  🔴 移除到「一个不剩」时必须带 __clearKeys —— 否则空数组会被空值守卫保回磁盘旧值（清不掉） */
      const patchAtPeers = async (cur, msg) => {
        await patch(cur.length
          ? { atPeers: cur }
          : { atPeers: [], __clearKeys: ['atPeers'] }, msg)
      }
      const toggleAt = async (p) => {
        const cur = Array.isArray(cfg.atPeers) ? [...cfg.atPeers] : []
        const idx = cur.findIndex((x) => x.nick === p.nick)
        let msg
        if (idx >= 0) { cur.splice(idx, 1); msg = `已把「${p.nick}」移出 @ 名单` }
        else { cur.push({ nick: p.nick }); msg = `@ 名单加了「${p.nick}」（共 ${cur.length} 人）` }
        await patchAtPeers(cur, msg)
      }
      const removeAt = async (idx) => {
        const cur = Array.isArray(cfg.atPeers) ? [...cfg.atPeers] : []
        if (!cur[idx]) return
        const gone = cur.splice(idx, 1)[0]
        await patchAtPeers(cur, `已把「${gone.nick}」移出 @ 名单`)
      }
      const clearAt = async () => {
        // 🔴 数组守卫同款：真清空必须带 __clearKeys 显式口子，否则空数组会被保回磁盘旧值（清不掉）
        await patch({ atPeers: [], __clearKeys: ['atPeers'] }, '@ 名单已清空 —— 开关开着也不会 @ 任何人')
      }

      /** 0.5.5 把某人从列表里移除
       *  🔴 移除到「一个不剩」必须带 __clearKeys（空数组会被守卫保回磁盘旧值） */
      const removePeer = async (idx) => {
        const cur = Array.isArray(cfg.dmPeers) ? [...cfg.dmPeers] : []
        if (!cur[idx]) return
        const gone = cur.splice(idx, 1)[0]
        await patch(cur.length
          ? { dmPeers: cur }
          : { dmPeers: [], __clearKeys: ['dmPeers'] },
          `已把「${gone.nick || gone.sec_uid}」移出私信对象`)
      }

      /** 展开 / 收起「怎么用」（新手流程） */
      const toggleGuide = async () => {
        if (guide !== null) { setGuide(null); return }
        setBusy('guide')
        try {
          const r = await jget('/guide')
          setGuide((r && r.text) || '(说明文件缺失)')
        } catch (e) { say('读说明失败：' + String((e && e.message) || e), 'warn') }
        finally { setBusy('') }
      }

      /* ── 最近一轮发生了什么 ── */
      const loadRunLog = async () => {
        if (runLog !== null) { setRunLog(null); return }
        setBusy('log')
        try {
          const r = await jget('/log')
          setRunLog(r || { tail: '(读不到)' })
        } catch (e) { say('读日志失败：' + String((e && e.message) || e), 'warn') }
        finally { setBusy('') }
      }

      /* ── 消息收件箱 ── */
      const loadInbox = async () => {
        if (inbox !== null) { setInbox(null); return }
        setBusy('inbox')
        try {
          const r = await jget('/inbox')
          if (r && r.ok) {
            setInbox(r)
            const n = (r.at_n || 0) + (r.dm_n || 0)
            say(n ? `有 ${n} 条可能要回` : '没有需要回的消息', n ? 'warn' : 'good')
          } else {
            setInbox({ ok: false, at: [], dm: [], errors: [(r && (r.error || r.hint)) || '读不到'] })
            say('读消息失败', 'warn')
          }
        } catch (e) {
          setInbox({ ok: false, at: [], dm: [], errors: [String((e && e.message) || e)] })
          say('读消息失败', 'warn')
        } finally { setBusy('') }
      }

      /* ── 聊天模式 ── */
      const openChat = async (who) => {
        setBusy('chat')
        try {
          const r = await jpost('/chat/read', { to: who.nick, to_id: who.sec_uid || '' })
          if (r && r.ok) {
            setChat({ who: { nick: r.to || who.nick, sec_uid: r.to_sec_uid || who.sec_uid }, data: r })
            setChatText('')
            say(`打开了和「${r.to || who.nick}」的对话`, 'good')
          } else {
            say('读不到会话：' + ((r && (r.error || r.hint)) || '未知'), 'warn')
          }
        } catch (e) { say('读不到会话：' + String((e && e.message) || e), 'warn') }
        finally { setBusy('') }
      }

      /** ⭐ 聊天界面开着时自动刷新（2026-10-24 会话模式）：30 秒拉一次新消息，
       *  走 HTTP 快路径所以很轻；关掉聊天界面就停。正在输入/发送中不打扰。 */
      React.useEffect(() => {
        if (!chat || !chat.who) return undefined
        const t = setInterval(async () => {
          try {
            if (busy === 'send') return
            const r = await jpost('/chat/read', { to: chat.who.nick, to_id: chat.who.sec_uid || '' })
            if (r && r.ok) setChat((prev) => (prev && prev.who.sec_uid === (r.to_sec_uid || prev.who.sec_uid) ? { ...prev, data: r } : prev))
          } catch { /* 刷不到就等下一拍 */ }
        }, 30_000)
        return () => clearInterval(t)
      }, [chat && chat.who && chat.who.sec_uid, busy === 'send'])

      const sendChat = async () => {
        const text = String(chatText || '').trim()
        if (!text || !chat) return
        setBusy('send')
        try {
          const r = await jpost('/chat/send', { to: chat.who.nick, to_id: chat.who.sec_uid || '', text, confirm: true })
          if (r && r.ok && r.sent) {
            setChatText('')
            say('已发送', 'good')
            // 重新读一遍，让新消息和记忆都刷新
            const again = await jpost('/chat/read', { to: chat.who.nick, to_id: chat.who.sec_uid || '' })
            if (again && again.ok) setChat({ ...chat, data: again })
          } else {
            say('发送失败：' + ((r && (r.error || r.hint)) || '未知'), 'warn')
          }
        } catch (e) { say('发送失败：' + String((e && e.message) || e), 'warn') }
        finally { setBusy('') }
      }

      /** 记忆：看统计 / 清空 */      const loadMem = async () => {
        if (mem !== null) { setMem(null); return }
        setBusy('mem')
        try {
          const r = await jget('/memory')
          setMem((r && r.stats) || { dm: 0, comment: 0, bytes: 0 })
        } catch (e) { say('读记忆失败：' + String((e && e.message) || e), 'warn') }
        finally { setBusy('') }
      }
      const clearMem = async () => {
        setBusy('mem')
        try {
          const r = await jpost('/memory/clear', {})
          setMem((r && r.stats) || { dm: 0, comment: 0, bytes: 0 })
          say('记忆已清空（私信和评论区的记录都删了）', 'good')
        } catch (e) { say('清空失败：' + String((e && e.message) || e), 'warn') }
        finally { setBusy('') }
      }

      /**
       * 读人设。
       * ⭐ 2026-10-26：后端现在会多给三样，面板要靠它们说真话：
       *    effective       = **真正生效的那份内容**（自己写 → 插件自带 → 中性默认）
       *    effective_label = 那一份叫什么（给用户看的来源说明）
       *    default_text    = 中性默认（「填入中性默认」按钮用）
       * 以前只读 text（= 自己那份），没写就空框 ⇒ 用户以为人设丢了。
       */
      const loadPersona = async () => {
        if (persona !== null) { setPersona(null); return }
        setBusy('persona')
        try {
          const r = await jget('/persona')
          setPersona({
            text: String((r && r.text) || ''),
            custom: Boolean(r && r.custom),
            effective: String((r && r.effective) || ''),
            effectiveLabel: String((r && r.effective_label) || ''),
            defaultText: String((r && r.default_text) || ''),
            hint: (r && r.hint) || '',
          })
        } catch (e) { say('读人设失败：' + String((e && e.message) || e), 'warn') }
        finally { setBusy('') }
      }

      /** 存人设（空 = 删掉自己那份，退回默认） */
      const savePersona = async () => {
        if (!persona) return
        setBusy('persona')
        try {
          const r = await jpost('/persona', { text: persona.text })
          if (r && r.ok) {
            say(persona.text.trim() ? '人设已保存（下一轮生效）' : '已清空自定义人设，退回默认', 'good')
            setPersona({ ...persona, custom: Boolean(r.custom) })
          } else say('保存失败：' + ((r && r.error) || '未知'), 'warn')
        } catch (e) { say('保存失败：' + String((e && e.message) || e), 'warn') }
        finally { setBusy('') }
      }

      const onRun = async () => {
        setBusy('run')
        try {
          const r = await jpost('/run', {})
          /**
           * 🔴 2026-10-22 修：以前不管有没有真跑起来都说"已经开跑了"。
           *    现在按返回的 ok 分流，并把**真原因**显示出来
           *    （最常见的是上游模型 429 限流）。
           */
          if (r && r.ok) {
            say(r.message || '已经开跑了，跑完会弹通知', 'good')
          } else {
            const why = (r && (r.error || r.message || r.hint)) || '没跑起来'
            say('没跑起来：' + why, 'warn')
          }
        } catch (e) { say('跑失败：' + String((e && e.message) || e), 'warn') }
        finally { setBusy('') }
      }

      const onShowReport = async () => {
        setBusy('report')
        try {
          const r = await jget('/report')
          setReport(r && r.text ? r.text : '(今天还没有报告)')
        } catch (e) { say('读报告失败：' + String((e && e.message) || e), 'warn') }
        finally { setBusy('') }
      }

      const saveKws = async () => {
        const lines = String(kws || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
        /* 🔴 2026-10-25 晚：后端守卫「空数组不许盖掉非空列表」（keywords 就是这么丢的）。
         *    真想清空 = 把框删空再点保存 ⇒ 带 __clearKeys 显式口子，守卫放行。 */
        await patch(
          lines.length ? { keywords: lines } : { keywords: [], __clearKeys: ['keywords'] },
          lines.length ? '关键词已保存' : '关键词已清空',
        )
      }

      /** 当前编辑中的自定义时段（`null` = 还没动过，跟随 cfg） */
      const winList = wins !== null ? wins : (Array.isArray(cfg && cfg.windows) ? cfg.windows : [])
      const setWinAt = (i, k, v) => {
        const next = winList.map((w, j) => (j === i ? { ...w, [k]: v } : w))
        setWins(next)
      }
      const addWin = () => { setWins([...winList, { start: '09:00', end: '11:00', label: '' }]) }
      const delWin = (i) => { setWins(winList.filter((_, j) => j !== i)) }
      const saveWins = async () => {
        // ⚠️ 只挑合法的时间，别把半截输入存进去（存了也不会跑，只会让人以为配好了）
        const clean = winList
          .map((w) => ({
            start: String((w && w.start) || '').trim(),
            end: String((w && w.end) || '').trim(),
            label: String((w && w.label) || '').trim(),
          }))
          .filter((w) => /^\d{1,2}:\d{2}$/.test(w.start) && /^\d{1,2}:\d{2}$/.test(w.end))
        const dropped = winList.length - clean.length
        /* 🔴 2026-10-25 晚：数组守卫同款 —— 真清空走 __clearKeys 显式口子 */
        await patch(
          clean.length ? { windows: clean } : { windows: [], __clearKeys: ['windows'] },
          dropped
            ? `已保存 ${clean.length} 个时段（${dropped} 个时间格式不对，没存）`
            : (clean.length ? `已保存 ${clean.length} 个时段` : '已清空自定义时段'),
        )
        setWins(null)
      }

      const onCheckUpdate = async (force) => {
        setBusy('update')
        try {
          const r = await jget('/update' + (force ? '?force=1' : ''))
          setUpd(r)
          if (!r.checked) say('查不到最新版本（没发布或没网）', 'warn')
          else if (r.hasUpdate) say(`有新版本 v${r.latest}（当前 v${r.current}）`, 'warn')
          else say('已经是最新版 v' + r.current, 'good')
        } catch (e) { say('检查更新失败：' + String((e && e.message) || e), 'warn') }
        finally { setBusy('') }
      }

      /* ⭐ 0.5.5 自动检查更新（主人 2026-10-26：「自动检查更新放最上面」）：
       *    面板打开 3 秒后静默查一次（force=1 不吃缓存），有新版本就弹在顶部卡里，
       *    不打扰、不自动装（「检查更新只查不装」是 selfcheck 的红线）。 */
      React.useEffect(() => {
        let alive = true
        const t = setTimeout(async () => {
          try {
            const r = await jget('/update?force=1')
            if (alive) setUpd(r)
          } catch { /* 静默：查不到不打扰 */ }
        }, 3000)
        return () => { alive = false; clearTimeout(t) }
      }, [])

      const loadAi = async () => {
        setBusy('ai')
        try {
          const r = await jget('/ai-usage')
          setAi(r)
          if (!(r.mcp && r.mcp.exists)) say('MCP server 文件缺失，插件包可能不完整', 'warn')
        } catch (e) { say('读使用说明失败：' + String((e && e.message) || e), 'warn') }
        finally { setBusy('') }
      }

      const copy = async (text, what) => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text)
          else {
            const ta = document.createElement('textarea')
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
            document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove()
          }
          setCopied(what)
          say('已复制' + what, 'good')
          setTimeout(() => setCopied(''), 2000)
        } catch (e) { say('复制失败，手动选中吧', 'warn') }
      }

      if (!st || !cfg) {
        return h('div', { 'data-dy-page': '' },
          h('div', { 'data-dy-card': '' },
            h('div', { 'data-dy-sub': '' }, '读设置中…')))
      }

      const kwText = kws !== null ? kws : (Array.isArray(cfg.keywords) ? cfg.keywords.join('\n') : '')

      /* ⭐ 0.5.5 私信对象列表的小工具（面板侧只读展示用）；0.5.9 @ 多选列表 */
      const dmPeers = Array.isArray(cfg.dmPeers) ? cfg.dmPeers.filter((p) => p && (p.nick || p.sec_uid)) : []
      const atPeers = Array.isArray(cfg.atPeers) ? cfg.atPeers.filter((p) => p && String(p.nick || '').trim()) : []

      /* ════════════════════════════════════════════════════════════════════════
       * 面板结构（2026-10-25 重排：20+ 张卡 → 3 组 / 7 张卡）
       *   组 ①「常开必看」永远展开 —— 卡①开始使用 / 卡②刷抖音 / 卡③自动发送
       *   组 ②「出问题才看」默认收起 —— 卡④出问题了？（体检 / dsh 入口 / 报告 / MCP / 关于）
       *   组 ③「一次配好」默认收起 —— 卡⑤刷抖音的策略 / 卡⑥桌宠 / 卡⑦消息与记忆
       *   组标题用 data-dy-group（**不是** data-dy-card），所以卡片计数正好 7。
       *   折叠状态 = Panel 顶部那两个 useState（foldErr / foldCfg）。
       *   ⚠️ 这里的 h(...) 里**不许加 hook** —— 条件分支里加 hook 会让整页白屏。
       * ════════════════════════════════════════════════════════════════════════ */
      return h('div', { 'data-dy-page': '' },

        /* ══════ 组 ①「常开必看」—— **永远展开**（新手上手先看这三张，不折叠）══════ */
        h('div', { 'data-dy-group': '' },
          h('span', { 'data-dy-groupname': '' }, '常开必看'),
          h('span', { 'data-dy-grouphint': '' }, '装好之后天天要用的三张')),

        /* ── 卡 ⓪ 检查更新（0.5.5 主人令：放最上面）──
         *    面板打开 3 秒自动查一次；有新版就黄条提醒 + 给升级命令，没有就轻描淡写一行。 */
        (upd && upd.checked && upd.hasUpdate)
          ? h('div', { 'data-dy-card': '', 'data-dy-highlight': '' },
            h('div', { 'data-dy-row': '' },
              h('div', { 'data-dy-grow': '' },
                h('div', { 'data-dy-title': '' }, `🆙 有新版本 v${upd.latest}（当前 v${upd.current}）`),
                h('div', { 'data-dy-sub': '' }, (upd.source ? '来源：' + upd.source + '。' : '')
                  + (upd.how || '用命令行升级，装完重启 dsh 生效。'))),
              h('button', { 'data-dy-mini': '', disabled: busy === 'update', onClick: () => onCheckUpdate(true) }, '再查一次')))
          : null,

        /* ── 卡 ① 开始使用 ── */
  /* ── 开始使用：三步装机 + 扫码登录（⭐ 2026-10-24 主人令：放最上面，
           *    已登录时这里带「退出登录」按钮；第二个才是「刷抖音」状态卡）──
           * 🔴 2026-10-22：以前这里只写一句「命令行跑 node tools/qr-login.mjs start」——
           *    对新手等于"你自己去折腾"。现在做成**点按钮 → 出二维码 → 手机扫 → 点我扫完了**。
           *    进度条按状态自己算：没环境 → 没登录 → 能用了。 */
          h('div', { 'data-dy-card': '' },
            h('div', { 'data-dy-row': '' },
              h('div', { 'data-dy-grow': '' },
                h('div', { 'data-dy-title': '' }, '开始使用'),
                h('div', { 'data-dy-sub': '' },
                  st.venvReady && st.loggedIn
                    ? '✅ 都装好了，可以直接用'
                    : `还差 ${!st.venvReady ? '两步' : '一步'} —— 跟着数字点就行`)),
              h('span', {
                'data-dy-badge': '',
                'data-on': (st.venvReady && st.loggedIn) ? '' : undefined,
              }, (st.venvReady && st.loggedIn) ? '就绪' : '未就绪')),

            /* 第 ① 步 */
            h('div', { 'data-dy-row': '' },
              h('span', { 'data-dy-step': '', 'data-done': st.venvReady ? '' : undefined }, st.venvReady ? '✓' : '1'),
              h('div', { 'data-dy-grow': '' },
                h('div', { 'data-dy-sub': '' }, st.venvReady ? '运行环境好了' : '装运行环境（约 30 秒，一次就够）')),
              st.venvReady
                ? null
                : h('button', { 'data-dy-btn': '', 'data-primary': '', disabled: busy === 'install', onClick: onInstall },
                  busy === 'install' ? '装着…' : '装环境')),

            /* 第 ② 步 —— 扫码登录（新手最容易卡的地方，做成主按钮）
             * ⭐ 2026-10-27：二维码/轮询/关窗/退出全在**共享登录卡**里（和「她的家」同一份
             *    状态）。compact 模式沿用本面板的 data-dy-* 样式，三步装机外观不变。 */
            h('div', { 'data-dy-row': '' },
              h('span', { 'data-dy-step': '', 'data-done': login.loggedIn ? '' : undefined }, login.loggedIn ? '✓' : '2'),
              h('div', { 'data-dy-grow': '' },
                h('div', { 'data-dy-sub': '' },
                  login.loggedIn === true ? '已登录，可以刷了'
                    : login.loggedIn === null ? '正在读登录状态…'
                      : '扫码登录抖音（用手机抖音扫一下）'))),
            h(DhLoginCard, { login, compact: true, say })),

        /* ── 卡 ② 刷抖音（状态 / 现在跑一轮 / 看日志 / 怎么用 / 已登录账号）── */
  /* ── 状态 ── */
          h('div', { 'data-dy-card': '' },
            h('div', { 'data-dy-row': '' },
              h('div', { 'data-dy-grow': '' },
                h('div', { 'data-dy-title': '' }, '刷抖音'),
                h('div', { 'data-dy-sub': '' },
                  '峰谷时段自动刷一轮，把值得看的挑出来写成日报。不催你、不刷屏。')),
              h('button', { 'data-dy-mini': '', disabled: busy === 'guide', onClick: toggleGuide },
                guide === null ? '怎么用？' : '收起说明'),
              /* ⭐ 面板构建号 —— 改完面板对一下这个数，就知道浏览器有没有拿到新代码。
               *    括号里是**宿主**那边的构建号（宿主读磁盘上的 client.js）：
               *    两者不一致 = 浏览器还在跑旧 bundle（刷新页面 / 重启 dsh）。 */
              h('span', {
                'data-dy-badge': '', title: '面板构建版本（改完面板对一下这个数）',
                style: { fontVariantNumeric: 'tabular-nums' },
              }, 'v' + (st.version || '?') + '·b' + PANEL_BUILD
                + (st.panelBuild && st.panelBuild !== PANEL_BUILD
                  ? `（宿主 b${st.panelBuild} ≠ 浏览器 b${PANEL_BUILD} ⇒ 刷新页面）` : ''))),
            h('div', { 'data-dy-row': '' },
              h('span', {
                'data-dy-badge': '',
                'data-on': st.loggedIn ? '' : undefined,
                'data-off': st.loggedIn ? undefined : '',
              }, st.loggedIn ? '已登录' : '未登录'),
              /* ⭐ 登录的是哪个号 —— 只显示昵称就够（ID 太长，对用户没用） */
              st.loggedIn && acc && acc.nick
                ? h('span', { 'data-dy-account': '' }, '👤 ' + acc.nick)
                : (st.loggedIn
                  ? h('span', { 'data-dy-sub': '' }, acc && acc.failed ? '（昵称没查到，不影响用）' : '正在查登录的号…')
                  : null),
              h('span', {
                'data-dy-badge': '',
                'data-on': st.venvReady ? '' : undefined,
                'data-off': st.venvReady ? undefined : '',
              }, st.venvReady ? '环境就绪' : '环境未装'),
              h('span', { 'data-dy-badge': '' },
                '今天 ' + (st.pickedToday != null ? st.pickedToday : 0) + ' / ' + (cfg.perDay != null ? cfg.perDay : 0)),
              h('div', { 'data-dy-grow': '' }),
              h('button', {
                'data-dy-btn': '', 'data-primary': '',
                disabled: busy === 'run', onClick: onRun,
              }, busy === 'run' ? '跑着呢…' : '现在跑一轮')),
            msg ? h('div', {
              'data-dy-msg': '',
              'data-good': msgTone === 'good' ? '' : undefined,
              'data-warn': msgTone === 'warn' ? '' : undefined,
            }, msg) : null,
            /* ⭐ 「看日志」—— 点一轮没反应时，让用户能自己看清发生了什么 */
            h('div', { 'data-dy-row': '' },
              h('button', { 'data-dy-mini': '', disabled: busy === 'log', onClick: loadRunLog },
                runLog === null ? '看日志（跑一轮没反应就点这）' : '收起日志')),
            runLog !== null
              ? h('div', { 'data-dy-inner': '', style: { background: 'transparent', border: 'none', padding: 0, gap: '6px' } },
                h('div', { 'data-dy-kv': '' },
                  `上次跑：${runLog.lastRunAt ? new Date(runLog.lastRunAt).toLocaleString('zh-CN') : '从没跑过'}`
                  + `　今天已挑 ${runLog.pickedToday || 0} / ${runLog.perDay || 0}`),
                runLog.canRun === false
                  ? h('div', { 'data-dy-msg': '', 'data-warn': '' },
                    runLog.roundActive ? '⚠️ 上一轮还在跑 —— 等它结束再点'
                      : (runLog.pickedToday >= runLog.perDay ? '⚠️ 今天的配额用完了（改「每天挑几条」或等明天）' : '现在不能跑'))
                  : null,
                h('pre', { 'data-dy-pre': '', style: { maxHeight: '300px' } }, runLog.tail || '(日志是空的)'))
              : null,
            guide !== null
              ? h('pre', { 'data-dy-pre': '', style: { maxHeight: '380px' } }, guide)
              : null),

        /* ── 卡 ③ 自动发送（含「私信发给谁」·评论区 @ 你 · 聊天模式）────────────────────────
         *    私信对象紧跟在自动发送开关下面（0.5.5 主人令）—— 它们本来就是一件事：发给谁、发什么、发不发。
         *    2026-10-25 重排：20+ 张卡压成 7 张，功能一个不删，只合并。 */
        h('div', { 'data-dy-card': '', 'data-dy-highlight': cfg.autoSend ? '' : undefined },
          /* 合并卡的总标题：说清这张里装了什么（不然只见「自动发送」，找不到私信对象） */
          h('div', { 'data-dy-title': '' }, '自动发送（发给谁 · 评论区 @ 你 · 聊天模式）'),
          /* ── 自动发送开关（放在**最上面**，别埋在长面板底部） ── */
          h('div', { 'data-dy-subblock': '', 'data-dy-highlight': cfg.autoSend ? '' : undefined },
            h('div', { 'data-dy-row': '' },
              h('div', { 'data-dy-grow': '' },
                h('div', { 'data-dy-title': '' }, '自动发送'),
                h('div', { 'data-dy-sub': '' },
                  (cfg.autoSend
                    ? '✅ 开着（默认）：插件自己跑一轮时，会把值得的视频发给你'
                      + (cfg.autoComment ? '，也会发评论' : '') + '。'
                    : '关着：插件自己跑一轮只写报告 + 弹通知，不往抖音发任何东西。'))),
              h(Switch, {
                on: Boolean(cfg.autoSend),
                onChange: (v) => patch({ autoSend: v }, v
                  ? '✅ 已打开自动发送'
                  : '已关闭自动发送 —— 后台跑一轮只写报告'),
              })),
            h('div', { 'data-dy-row': '' },
              h('span', { 'data-dy-badge': '', 'data-on': cfg.autoSend ? '' : undefined, 'data-off': cfg.autoSend ? undefined : '' },
                cfg.autoSend ? '会自动发' : '只写报告'),
              h('span', { 'data-dy-sub': '' },
                '发给：' + (dmPeers.length
                  ? dmPeers.map((p) => p.nick || (p.sec_uid || '').slice(0, 8) + '…').join('、')
                  : (cfg.dmTo || '（还没选私信对象，去下面「私信发给谁」选）')))),
            h('div', { 'data-dy-sub': '' },
              '⚠️ 只管「插件自己在后台跑的轮次」。你当场在对话里让它发，不受这个开关影响。'),
  /* ── 私信发给谁（0.5.5：放自动发送正下方 —— 主人 2026-10-26 令；多人列表 + 每人「听他的话」开关） ── */
          h('div', { 'data-dy-subblock': '', style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08))' } },
            h('div', { 'data-dy-row': '' },
              h('div', { 'data-dy-grow': '' },
                h('div', { 'data-dy-title': '' }, '私信发给谁'),
                h('div', { 'data-dy-sub': '' },
                  dmPeers.length
                    ? `已选 ${dmPeers.length} 人：${dmPeers.map((p) => p.nick || (p.sec_uid || '').slice(0, 8) + '…').join('、')}。日报和分享卡片发给每一个人。`
                    : '想让插件把好玩的发给你，先在这里选一个人（可以多选）。不选也行 —— 那就只写日报，不发私信。')),
              h('button', {
                'data-dy-btn': '', disabled: busy === 'people' || !st.loggedIn, onClick: loadPeople,
              }, busy === 'people' ? '读取中…' : (people === null ? '从我的会话里选' : '重新读取'))),

            !st.loggedIn
              ? h('div', { 'data-dy-sub': '' }, '（要先在上面扫码登录，才能读到你的人）')
              : null,

            /* ⭐ 0.5.5 已选列表：每人一行 —— 昵称 + 「听他的话」开关 + 移除 */
            dmPeers.length
              ? h('div', { 'data-dy-people': '' },
                dmPeers.map((p, i) => h('div', {
                  key: 'peer' + i,
                  'data-dy-person': '',
                  'data-picked': p.sec_uid ? '' : undefined,
                },
                  h('span', { 'data-dy-person-name': '' }, p.nick || (p.sec_uid || '').slice(0, 10) + '…'),
                  p.sec_uid
                    ? null
                    : h('span', { 'data-dy-tag': '', title: '群里可能发不出消息：在我这个号上试的，网页端发的别人收不到，手机端正常。别的号不一定这样。' }, '群聊 · 可能发不出'),
                  h('span', { 'data-dy-grow': '' }),
                  h('button', {
                    'data-dy-mini': '', disabled: Boolean(busy),
                    onClick: () => removePeer(i),
                  }, '移除'))))
              : null,

            /* 🔴 群聊限制写在明面上（不是 hover 小字）—— 主人 2026-10-26 令：
             *    「不在选项上说清吗」—— 选了群的人一眼就能看到这条限制。
             *    ⚠️ 措辞留余地：只在鱼号上试过，别把一次观察说成铁律（主人 2026-10-26 令）。 */
            dmPeers.some((p) => !p.sec_uid)
              ? h('div', { 'data-dy-msg': '', 'data-warn': '' },
                '⚠️ **群里可能发不出消息**：在我这个号上试的，网页端发的群里人收不到，手机端正常。'
                + '别的号不一定这样。看群消息没问题，要说话请用手机端。')
              : null,

            people && people.length
              ? h('div', { 'data-dy-people': '' },
                people.map((p, i) => {
                  const added = dmPeers.some((x) => (p.sec_uid && x.sec_uid === p.sec_uid) || (!p.sec_uid && x.nick === p.nick))
                  return h('button', {
                    key: 'p' + i,
                    'data-dy-person': '',
                    'data-picked': added ? '' : undefined,
                    disabled: Boolean(busy) || added,
                    onClick: () => pickPerson(p),
                  },
                    h('span', { 'data-dy-person-name': '' }, p.nick),
                    p.is_group
                      ? h('span', {
                        'data-dy-tag': '',
                        title: '群里可能发不出消息：在我这个号上试的，网页端发的别人收不到，手机端正常。别的号不一定这样。',
                      }, '群聊 · 可能发不出')
                      : null,
                    p.duplicate && !p.is_group ? h('span', { 'data-dy-tag': '' }, '重名') : null,
                    added ? h('span', { 'data-dy-tag': '', 'data-ok': '' }, '✓ 已在列表') : null,
                    p.preview ? h('span', { 'data-dy-person-sub': '' }, p.preview) : null)
                }))
              : null,

            people && !people.length
              ? h('div', { 'data-dy-msg': '', 'data-warn': '' }, peopleHint || '会话列表是空的')
              : null,
            peopleHint && people && people.length
              ? h('div', { 'data-dy-sub': '' }, peopleHint)
              : null,

            /* ⭐ 手动补一个会话列表里没有的人（留活路，但不再是主路径） */
            h('div', { 'data-dy-row': '' },
              h('button', {
                'data-dy-mini': '',
                onClick: () => setManualDm(manualDm === null ? { nick: '', id: '' } : null),
              }, manualDm === null ? '手动加一个（会话列表里没有的人）' : '收起')),
            manualDm !== null
              ? h('div', { 'data-dy-inner': '', style: { background: 'transparent', border: 'none', padding: 0, gap: '8px' } },
                h('div', { 'data-dy-sub': '' }, '昵称（显示用）'),
                h('input', {
                  'data-dy-input': '', value: manualDm.nick, placeholder: '比如：示例好友',
                  onChange: (e) => setManualDm({ ...manualDm, nick: e.target.value }),
                }),
                h('div', { 'data-dy-sub': '' }, '稳定 ID（sec_uid，从「从我的会话里选」拿最方便；没有它没法精确认人）'),
                h('input', {
                  'data-dy-input': '', value: manualDm.id, placeholder: 'MS4wLjABAAAA…',
                  onChange: (e) => setManualDm({ ...manualDm, id: e.target.value }),
                }),
                h('div', { 'data-dy-row': '' },
                  h('button', {
                    'data-dy-btn': '', 'data-primary': '', disabled: Boolean(busy) || !(manualDm.nick.trim() || manualDm.id.trim()),
                    onClick: async () => {
                      const cur = Array.isArray(cfg.dmPeers) ? cfg.dmPeers : []
                      const next = [...cur, { nick: manualDm.nick.trim(), sec_uid: manualDm.id.trim() }]
                      await patch({ dmPeers: next }, `已把「${manualDm.nick.trim() || manualDm.id.trim()}」加进私信对象`)
                      setManualDm(null)
                    },
                  }, '加进列表')))
              : null),


            /* ⭐⭐ 评论区 @ 提醒（0.5.9 主人定稿）—— 开关 = 总闸，选人 = 范围（可多个）：
             *    开关开着 + 名单有人 = 会 @；开关关 = 选了人也不 @；开着没选 = 待命（值班跳过）。
             *    会话列表只读一次（复用私信区的 people），不反复拉。 */
            h('div', { 'data-dy-row': '', style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08))' } },
              h('div', { 'data-dy-grow': '' },
                h('div', { 'data-dy-title': '' }, '评论区 @ 提醒'),
                h('div', { 'data-dy-sub': '' },
                  !cfg.autoSend
                    ? '先打开上面的「自动发送」，这个才有用。'
                    : !cfg.commentAtMe
                      ? '总闸关着 —— 选了人也不 @。'
                      : atPeers.length
                        ? `开：挑到最值得的那条时，在评论区 @ ${atPeers.map((p) => p.nick).join('、')}（他刷抖音就能收到通知）。`
                        : '开着但还没选人 —— 待命中，选了人就开始 @。')),
              h(Switch, {
                on: Boolean(cfg.commentAtMe),
                disabled: !cfg.autoSend || busy === 'patch',
                onChange: (v) => {
                  // 🔴 0.5.9d：这里以前调 setShowAtPicker（那版 state 已删）⇒ 运行时
                  //    ReferenceError ⇒ onChange 整个崩 ⇒ patch 从没执行 ⇒ 主人点开关「没反应」。
                  //    教训：删 state 时要连引用一起删光；这类崩 node --check 查不出来。
                  if (!atPeers.length && v && !people) loadPeople()
                  patch({ commentAtMe: v }, v ? '✅ 评论区 @ 提醒：开（选了人就开始 @）' : '已关闭 —— 选了人也不 @')
                },
              })),
            cfg.autoSend && cfg.commentAtMe
              ? h('div', { 'data-dy-sub': '' },
                atPeers.length
                  ? `要 @ 的人（${atPeers.length}）：${atPeers.map((p) => p.nick).join('、')}`
                  : '要 @ 的人：（还没选 —— 点下面列表里的人）')
              : null,
            cfg.autoSend && cfg.commentAtMe && !people
              ? h('div', { 'data-dy-row': '' },
                h('button', {
                  'data-dy-mini': '', disabled: busy === 'people' || !st.loggedIn, onClick: loadPeople,
                }, busy === 'people' ? '读取会话列表中…' : '读一次会话列表（两个选人区共用，不反复拉）'))
              : null,
            cfg.autoSend && cfg.commentAtMe
              ? h('div', { 'data-dy-people': '' },
                people && people.length
                  ? people.map((p, i) => {
                    const added = atPeers.some((x) => x.nick === p.nick)
                    return h('button', {
                      key: 'at' + i,
                      'data-dy-person': '',
                      'data-picked': added ? '' : undefined,
                      disabled: Boolean(busy) || p.is_group,
                      onClick: () => toggleAt(p),
                    },
                      h('span', { 'data-dy-person-name': '' }, p.nick),
                      p.is_group ? h('span', { 'data-dy-tag': '' }, '群不能 @') : null,
                      added ? h('span', { 'data-dy-tag': '', 'data-ok': '' }, '✓ 要 @') : null)
                  })
                  : h('div', { 'data-dy-sub': '' }, busy === 'people' ? '读取中…' : '会话列表还没读'))
              : null,
            atPeers.length
              ? h('div', { 'data-dy-row': '' },
                atPeers.map((p, i) => h('span', {
                  key: 'atp' + i, 'data-dy-tag': '', 'data-ok': '', style: { marginRight: '6px' },
                },
                  p.nick + ' ',
                  h('button', {
                    'data-dy-mini': '', disabled: Boolean(busy), style: { marginLeft: '2px' },
                    onClick: () => removeAt(i),
                  }, '×'))),
                h('span', { 'data-dy-grow': '' }),
                h('button', { 'data-dy-mini': '', disabled: Boolean(busy), onClick: clearAt }, '全清（不 @ 了）'))
              : null,
            cfg.commentAtMe && cfg.autoSend
              ? h('div', { 'data-dy-sub': '', style: { marginTop: '4px', opacity: '.78' } },
                '💡 真 @ 需要起无头 Chrome 走「点选弹层」流程（约 20-40 秒）；@ 的昵称必须能在弹层里搜到（一般是关注/互关的人）。')
              : null,

            /* ⭐⭐ 聊天模式（2026-10-24）：使用者实测的「会话模式」进插件。
             *   每 N 秒静默读一次私信对象的会话（HTTP 快路径，不起浏览器），
             *   他来新消息就弹 Windows 通知。回话还是你来（或叫值班轮）。 */
            h('div', { 'data-dy-row': '', style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08))' } },
              h('div', { 'data-dy-grow': '' },
                h('div', { 'data-dy-title': '' }, '聊天模式'),
                /* 🔴🔴 2026-10-25 主人：「聊天模式怎么打开了，关闭不了」
                 *
                 * 真因不是开关坏了：`dmToId` 被一次配置事故清空，而这里
                 *   `disabled: !cfg.dmToId`
                 * 让开关**永久变灰**——点它没反应。更糟的是右边那段说明文字
                 * 还写着"✅ 开着"，主人看到的就是"显示开着、关不掉"。
                 *
                 * ✅ 规矩（这条比修 bug 本身重要）：
                 *    **任何 disabled 都必须当场说清为什么**，不许只变灰。
                 *    变灰而不解释 = 让主人猜 = 他会以为软件坏了。
                 *    所以这里分成三档文案：
                 *      ① 没选私信对象 ⇒ 明说"开关是灰的，点不了不是坏了，先选人"
                 *      ② 正在保存     ⇒ 明说"保存中"
                 *      ③ 正常         ⇒ 说功能状态
                 */
                h('div', { 'data-dy-sub': '' },
                  !dmPeers.length
                    ? '⚠️ 还没选私信对象 —— 去下面「私信发给谁」点选一个人，小鱼才知道有消息时状态屏该显示谁。'
                    : busy === 'patch'
                      ? '保存中…'
                      : (cfg.chatWatch
                        ? `✅ 开着：每 ${Math.max(10, Math.min(Number(cfg.chatWatchSec || 30), 300))} 秒看一眼私信，**谁来的都看**（${dmPeers.map((p) => p.nick || (p.sec_uid || '').slice(0, 8) + '…').join('、')}）；有新消息就转给值班的小鱼接。不弹桌面通知，不起浏览器，很轻。`
                        : '关着（默认是开的）。关了之后来消息就没人接话——小鱼睡缸底。想恢复再打开。'))),
              h(Switch, {
                on: Boolean(cfg.chatWatch),
                disabled: busy === 'patch',
                /* 变灰时点它也给一句话——比"毫无反应"好，主人至少知道点到了 */
                onChange: (v) => {
                  patch({ chatWatch: v }, v
                    ? (dmPeers.length ? '✅ 已打开聊天模式（谁私信都接）' : '聊天模式开了 —— 建议先去「私信发给谁」点选对象，状态屏才好显示')
                    : '已关闭聊天模式')
                },
              })),
            busy === 'patch'
              ? h('div', { 'data-dy-sub': '' }, '保存中…')
              : null,
            !dmPeers.length
              ? h('div', { 'data-dy-sub': '' }, '（还没选私信对象 —— 在下面「私信发给谁」里点选）')
              : null,
            cfg.chatWatch
              ? h('div', { 'data-dy-row': '' },
                h('span', { 'data-dy-sub': '' }, '看消息的间隔（秒，10–300）'),
                h('input', {
                  'data-dy-input': '', style: { width: '90px' }, type: 'number', min: 10, max: 300,
                  value: cwSecDraft !== null ? cwSecDraft : String(cfg.chatWatchSec || 30),
                  onChange: (e) => setCwSecDraft(e.target.value),
                }),
                h('button', {
                  'data-dy-mini': '', disabled: Boolean(busy) || cwSecDraft === null,
                  onClick: async () => {
                    const n = Math.max(10, Math.min(Number(cwSecDraft) || 30, 300))
                    await patch({ chatWatchSec: n }, `聊天模式间隔已存：${n} 秒`)
                    setCwSecDraft(null)
                  },
                }, '保存'))
              : null,
            /* ⭐ 私信投给谁（2026-10-25 深夜「探明呗」后新增；2026-10-26 深夜改成两个对话框）：
             *    lead = 前台会话（排队等当前轮跑完，私聊夹在工作流里）
             *    duty = 小肥鱼聊天（独立**顶层**会话：侧栏可见、能打开看她的聊天和思考；
             *           这个窗口就留给主人调试插件用，私聊不占这里）
             *    她不在时后端自动退回前台，状态屏会写明。 */
            cfg.chatWatch
              ? h('div', { 'data-dy-row': '' },
                h('span', { 'data-dy-sub': '' }, '消息投给'),
                h('div', { 'data-dy-seg': '', role: 'group' },
                  [['lead', '前台会话'], ['duty', '小肥鱼聊天']].map(([v, label]) =>
                    h('button', {
                      key: 'cwt-' + v,
                      'data-dy-segbtn': '', 'data-on': (cfg.chatWatchTarget || 'lead') === v ? '' : undefined,
                      disabled: busy === 'patch',
                      onClick: () => patch({ chatWatchTarget: v },
                        v === 'duty'
                          ? '以后私信投给「小肥鱼聊天」这个独立会话（侧栏能看到她的聊天和思考；本窗口不再被打扰；她不在会自动退回前台）'
                          : '以后私信投进前台会话（跟工作对话排一个队）'),
                    }, label))))
              : null,
            /* ⭐ 实时状态屏（2026-10-24 使用者要求：「我哪知道它有什么用、错在哪了」）：
             *    开着聊天模式时每 15 秒拉一次后端状态，显示几秒前看过、结果、通知弹没弹。 */
            cfg.chatWatch ? h(ChatWatchStatus, { key: 'cw-status' }) : null,
            /* ⭐⭐ 2026-10-26 凌晨（主人：「如果是普通用户，他该怎么办，没那么聪明啊」）
             *   一句话说明 + 一个按钮：不懂的人只会点这个。
             *   按钮背后是 /chat/fix —— 后端自动判断、能修的自己修，修不了的用
             *   「还差一步：……」告诉他去点哪儿。绝不让用户读日志。 */
            h('div', { 'data-dy-row': '', style: { marginTop: '8px', alignItems: 'center' } },
              h('button', {
                'data-dy-btn': '',
                disabled: busy === 'chatfix',
                onClick: async () => {
                  setBusy('chatfix')
                  try {
                    const r = await jpost('/chat/fix', {})
                    setChatFix(r)
                    say(r.ok ? '好了，现在能收发了' : (r.need_user ? `还差一步：${r.need_user.what}` : '还有问题，看下面的说明'), r.ok ? 'good' : 'warn')
                  } catch (e) { say('自检失败：' + String((e && e.message) || e), 'warn') }
                  finally { setBusy('') }
                },
              }, busy === 'chatfix' ? '检查中…' : '🔧 一键修好（不聊天时点这个）'),
              h('span', { 'data-dy-sub': '' }, '收到消息不回？先点这个，它自己会修。')),
            chatFix
              ? h('div', { 'data-dy-sub': '', style: { color: chatFix.ok ? '#22c55e' : '#f59e0b' } },
                `${chatFix.ok ? '✅' : '👉'} ${chatFix.human || ''}`
                  + (chatFix.need_user && chatFix.need_user.how ? `\n${chatFix.need_user.how}` : ''))
              : null),
        ),

        /* ══════ 组「出问题才看」—— **默认收起**（foldErr 初始 false），点标题行展开 ══════
         * 🔴 折叠状态是 Panel 顶部那两个 useState；这里只读、只 set，**绝不在条件分支里加 hook**。 */
        h('div', { 'data-dy-group': '' },
          h('button', {
            'data-dy-groupbtn': '', 'data-open': foldErr ? '' : undefined,
            'aria-expanded': foldErr ? 'true' : 'false',
            onClick: () => setFoldErr((v) => !v),
          },
            h('span', { 'data-dy-groupname': '' }, '出问题才看'),
            h('span', { 'data-dy-groupchev': '' }, foldErr ? '收起 ▲' : '展开看 ▼'))),

        /* ── 卡 ④ 出问题了？（体检 + dsh 入口 + 看报告 + 给别的 AI 用 + 关于）──
         *    都是「平时不看、出问题才翻」的东西，收进一张卡，默认折叠。 */
        foldErr
          ? h('div', { 'data-dy-card': '' },
      /* ── 环境体检 ── */
              h('div', { 'data-dy-subblock': '' },
                h('div', { 'data-dy-row': '' },
                  h('div', { 'data-dy-grow': '' },
                    h('div', { 'data-dy-title': '' }, '出问题了？'),
                    h('div', { 'data-dy-sub': '' }, '点一下，9 项环境逐个查，哪项红了直接告诉你怎么办')),
                  h('button', { 'data-dy-btn': '', disabled: busy === 'doctor', onClick: onDoctor },
                    busy === 'doctor' ? '查着…' : '检查环境')),
                doctor
                  ? h('div', { 'data-dy-kv': '' },
                    (doctor.items || []).map((it, i) => h('div', { key: 'd' + i },
                      (it.state === 'ok' ? '✅ ' : it.state === 'warn' ? '⚠️ ' : '❌ ')
                      + it.item + '：' + it.detail)))
                  : null,
                h('div', { 'data-dy-row': '' },
                  h('button', { 'data-dy-mini': '', disabled: busy === 'report', onClick: onShowReport }, '看今天的报告')),

                /**
                 * ⭐⭐ 2026-10-23 加：**dsh 入口路径**（起因：使用者反馈「总是显示找不到 dsh」）
                 * 🔴 桌面版不是 npm 全局装的，插件以前只能猜路径；猜不到就报"找不到 dsh"，
                 *    而面板上**根本没有地方填** —— 使用者彻底卡死。
                 *    现在：自动探测（多半能中）+ 这里可手填兜底 + 「自动找」清空回到探测。
                 */
                h('div', { 'data-dy-row': '', style: { marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08))' } },
                  h('div', { 'data-dy-grow': '' },
                    h('div', { 'data-dy-title': '' }, 'dsh 入口（后台跑一轮要用）'),
                    h('div', { 'data-dy-sub': '' },
                      cfg.dshBin
                        ? '已手填路径。点「自动找」清空，回到自动探测。'
                        : '留空 = 自动找（桌面版会去 app.asar 里找，一般能中）。只有报「找不到 dsh」时才需要填。'))),
                h('div', { 'data-dy-row': '' },
                  h('input', {
                    'data-dy-input': '', style: { flex: '1' },
                    placeholder: '…\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js',
                    value: dshBinDraft !== null ? dshBinDraft : String(cfg.dshBin || ''),
                    onChange: (e) => setDshBinDraft(e.target.value),
                  }),
                  h('button', {
                    'data-dy-mini': '', disabled: Boolean(busy) || dshBinDraft === null,
                    onClick: async () => { await patch({ dshBin: String(dshBinDraft || '').trim() }, '已保存 dsh 入口路径'); setDshBinDraft(null) },
                  }, '保存'),
                  h('button', {
                    'data-dy-mini': '', disabled: Boolean(busy),
                    onClick: async () => { await patch({ dshBin: '' }, '已清空 ⇒ 回到自动探测'); setDshBinDraft(null) },
                  }, '自动找')),
                h('div', { 'data-dy-sub': '', style: { opacity: '.78' } },
                  '填这两个之一：<安装目录>\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\'
                  + 'dsh-desktop-host\\lib\\cli.js 或 …\\@deepseek-ai\\dsh\\lib\\bin.js')),
      /* ── 给别的 AI 用（MCP） ── */
              h('div', { 'data-dy-subblock': '' },
                h('div', { 'data-dy-row': '' },
                  h('div', { 'data-dy-grow': '' },
                    h('div', { 'data-dy-title': '' }, '给别的 AI 用'),
                    h('div', { 'data-dy-sub': '' },
                      '想让 Claude Code / Cursor / 别的 agent 也能刷抖音？这插件自带一个 MCP server，配一段 JSON 就能接。'))),
                h('div', { 'data-dy-row': '' },
                  h('button', {
                    'data-dy-btn': '', disabled: busy === 'ai', onClick: loadAi,
                  }, busy === 'ai' ? '读说明中…' : '看接入方式')),
                ai
                  ? h('div', { 'data-dy-inner': '', style: { background: 'transparent', border: 'none', padding: 0, gap: '8px' } },
                    h('div', { 'data-dy-kv': '' }, 'MCP server：' + ((ai.mcp && ai.mcp.server) || '(缺失)')),
                    ai.mcp && ai.mcp.exists
                      ? null
                      : h('div', { 'data-dy-msg': '', 'data-warn': '' }, '⚠️ 找不到 tools/mcp-server.mjs —— 插件包不完整，重新安装'),
                    h('div', { 'data-dy-sub': '' }, '把下面这段填进那个工具的 MCP 配置（路径已经按这台机器算好了）：'),
                    h('pre', { 'data-dy-pre': '' }, (ai.mcp && ai.mcp.configText) || ''),
                    h('div', { 'data-dy-row': '' },
                      h('button', {
                        'data-dy-mini': '',
                        onClick: () => copy((ai.mcp && ai.mcp.configText) || '', 'MCP 配置'),
                      }, copied === 'MCP 配置' ? '✓ 已复制' : '复制 MCP 配置'),
                      h('button', {
                        'data-dy-mini': '',
                        onClick: () => copy((ai.mcp && ai.mcp.selfTest) || '', '自测命令'),
                      }, copied === '自测命令' ? '✓ 已复制' : '复制自测命令')),
                    h('div', { 'data-dy-sub': '' }, '自测（不接任何客户端，先看它自己通不通）：'),
                    h('pre', { 'data-dy-pre': '' }, (ai.mcp && ai.mcp.selfTest) || ''),
                    ai.doc
                      ? h('div', { 'data-dy-row': '' },
                        h('button', {
                          'data-dy-mini': '',
                          onClick: () => copy(ai.doc, '使用说明'),
                        }, copied === '使用说明' ? '✓ 已复制' : '复制完整使用说明（贴给那个 AI 看）'))
                      : h('div', { 'data-dy-msg': '', 'data-warn': '' }, '读不到 AI-USAGE.md：' + (ai.doc_error || '未知原因')))
                  : h('div', { 'data-dy-sub': '' }, '点「看接入方式」会显示：MCP 配置、自测命令、给 AI 看的使用说明。')),
      /* ── 关于 / 检查更新 ── */
              h('div', { 'data-dy-subblock': '' },
                h('div', { 'data-dy-row': '' },
                  h('div', { 'data-dy-grow': '' },
                    h('div', { 'data-dy-title': '' }, '关于'),
                    h('div', { 'data-dy-sub': '' }, '当前版本 v' + (st.version || '?') + ' · 报告在 ' + (st.report || 'out/'))),
                  h('button', {
                    'data-dy-btn': '', disabled: busy === 'update', onClick: () => onCheckUpdate(true),
                  }, busy === 'update' ? '查着呢…' : '检查更新')),
                upd
                  ? h('div', { 'data-dy-kv': '' },
                    upd.checked
                      ? (upd.hasUpdate
                        ? `有新版本 v${upd.latest}（当前 v${upd.current}）`
                        : `已是最新版（v${upd.current}）`) + (upd.source ? `　来源：${upd.source}` : '')
                      : (upd.note || '查不到最新版本'),
                    upd.hasUpdate && upd.how ? h('div', { style: { marginTop: '4px' } }, '升级：' + upd.how) : null)
                  : null,
                upd && upd.tried && !upd.checked
                  ? h('div', { 'data-dy-sub': '' }, '试过：' + upd.tried.map((t) => t.source + (t.ok ? ' ✓' : ' ✗')).join('、'))
                  : null),
      /* ── 报告 ── */
              report !== null
                ? h('div', { 'data-dy-subblock': '' },
                  h('div', { 'data-dy-title': '' }, '报告'),
                  h('pre', { 'data-dy-pre': '' }, report))
                : null,
            )
          : null,

        /* ══════ 组「一次配好」—— **默认收起**（foldCfg 初始 false），点标题行展开 ══════
         * 🔴 折叠状态是 Panel 顶部那两个 useState；这里只读、只 set，**绝不在条件分支里加 hook**。 */
        h('div', { 'data-dy-group': '' },
          h('button', {
            'data-dy-groupbtn': '', 'data-open': foldCfg ? '' : undefined,
            'aria-expanded': foldCfg ? 'true' : 'false',
            onClick: () => setFoldCfg((v) => !v),
          },
            h('span', { 'data-dy-groupname': '' }, '一次配好'),
            h('span', { 'data-dy-groupchev': '' }, foldCfg ? '收起 ▲' : '展开看 ▼'))),

        /* ── 卡 ⑤ 刷抖音的策略：刷什么 / 什么时候自己跑 / 每天挑几条 / 日报多细 / 通知方式 ── */
        foldCfg
          ? h('div', { 'data-dy-card': '' },
              h('div', { 'data-dy-title': '' }, '刷抖音的策略'),
              h('div', { 'data-dy-sub': '' },
                '刷什么、什么时候自己跑、每天挑几条、日报写多细、消息怎么通知你 —— 一次配好就不用再管。'),
      /* ── 刷什么 ── */
              h('div', { 'data-dy-subblock': '' },
                h('div', { 'data-dy-title': '' }, '刷什么'),
                h('div', { 'data-dy-sub': '' }, '偏好关键词，一行一个（命中会加分 / 放宽硬筛；⚠️ 不会去抖音搜词 —— web 没有搜索接口，供给靠推荐流）'),
                h('textarea', {
                  'data-dy-input': '', rows: 5, value: kwText,
                  placeholder: '搞笑\n美食\n猫',
                  onChange: (e) => setKws(e.target.value),
                }),
                h('div', { 'data-dy-row': '' },
                  h('button', {
                    'data-dy-btn': '', 'data-primary': '',
                    disabled: Boolean(busy), onClick: saveKws,
                  }, '保存'))),
      /* ── 什么时候跑 ── */
              h('div', { 'data-dy-subblock': '' },
                h('div', { 'data-dy-row': '' },
                  h('div', { 'data-dy-grow': '' },
                    h('div', { 'data-dy-title': '' }, '什么时候自己跑'),
                    h('div', { 'data-dy-sub': '' }, '只在谷时跑（便宜）。全关 = 只在你点「现在跑一轮」时跑。'))),
                h('div', { 'data-dy-row': '' },
                  h('div', { 'data-dy-grow': '' }, h('div', { 'data-dy-sub': '' }, '中午谷时 12:00–14:00')),
                  h(Switch, {
                    on: Boolean(cfg.noon),
                    onChange: (v) => patch({ noon: v }, v ? '中午自动跑：开' : '中午自动跑：关'),
                  })),
                h('div', { 'data-dy-row': '' },
                  h('div', { 'data-dy-grow': '' }, h('div', { 'data-dy-sub': '' }, '晚上谷时 18:00–次日 09:00')),
                  h(Switch, {
                    on: Boolean(cfg.night),
                    onChange: (v) => patch({ night: v }, v ? '晚上自动跑：开' : '晚上自动跑：关'),
                  })),

                /* ⭐ 自定义时段：和上面两个开关**叠加**（任意一个命中就跑），每个时段每天只跑一次 */
                h('div', { 'data-dy-sub': '', style: { marginTop: '4px' } }, '自定义时段（可选，跟上面两个叠加）'),
                winList.length
                  ? winList.map((w, i) => h('div', { 'data-dy-wrow': '', key: 'w' + i },
                    h('input', {
                      'data-dy-time': '', type: 'time', value: String(w.start || ''),
                      onChange: (e) => setWinAt(i, 'start', e.target.value),
                    }),
                    h('span', { 'data-dy-sep': '' }, '→'),
                    h('input', {
                      'data-dy-time': '', type: 'time', value: String(w.end || ''),
                      onChange: (e) => setWinAt(i, 'end', e.target.value),
                    }),
                    h('input', {
                      'data-dy-input': '', style: { flex: '1', minWidth: '60px' },
                      placeholder: '备注（可空）', value: String(w.label || ''),
                      onChange: (e) => setWinAt(i, 'label', e.target.value),
                    }),
                    h('button', { 'data-dy-mini': '', 'data-danger': '', onClick: () => delWin(i) }, '删')))
                  : null,
                h('div', { 'data-dy-row': '' },
                  h('button', { 'data-dy-mini': '', onClick: addWin }, '+ 加一个时段'),
                  winList.length
                    ? h('button', {
                      'data-dy-mini': '', 'data-primary': '',
                      disabled: Boolean(busy), onClick: saveWins,
                    }, '保存时段')
                    : null,
                  h('div', { 'data-dy-grow': '' }),
                  winList.length
                    ? h('span', { 'data-dy-sub': '' }, '跨零点也行（23:00 → 02:00）')
                    : null),

                h('div', { 'data-dy-sub': '' }, '两个都关 = 只在点「现在跑一轮」时跑。')),
      /* ── 每天挑几条 / 日报多细 ── */
              h('div', { 'data-dy-subblock': '' },
                h('div', { 'data-dy-title': '' }, '每天挑几条'),
                h('div', { 'data-dy-sub': '' },
                  '全天总量（不是每轮）。0 = 不自动刷，只在你点「现在跑一轮」时跑。'),
                h('div', { 'data-dy-row': '' },
                  h('input', {
                    'data-dy-time': '', type: 'number', min: 0, max: 300,
                    style: { width: '72px' },
                    value: String(perDayDraft !== null ? perDayDraft : (cfg.perDay != null ? cfg.perDay : 5)),
                    onChange: (e) => setPerDayDraft(e.target.value),
                  }),
                  h('span', { 'data-dy-sub': '' }, '条 / 天'),
                  h('div', { 'data-dy-grow': '' }),
                  h('button', {
                    'data-dy-mini': '', 'data-primary': '',
                    disabled: Boolean(busy) || perDayDraft === null,
                    onClick: async () => {
                      const n = Math.max(0, Math.min(Number(perDayDraft) || 0, 300))
                      await patch({ perDay: n }, `每天最多 ${n} 条`)
                      setPerDayDraft(null)
                    },
                  }, '保存')),
                h('div', { 'data-dy-row': '' },
                  h('span', { 'data-dy-sub': '' }, '日报写多细：'),
                  h('select', {
                    'data-dy-input': '', style: { flex: '1', maxWidth: '180px' },
                    value: String(cfg.reportLevel || 'full'),
                    onChange: (e) => patch({ reportLevel: e.target.value }, '日报详细程度已保存'),
                  },
                    h('option', { value: 'full' }, '完整版（为什么值得 + 一句话）'),
                    h('option', { value: 'brief' }, '薄版（每条一两行）'),
                    h('option', { value: 'off' }, '不写日报')),

                  h('span', { 'data-dy-sub': '', style: { marginLeft: '12px' } }, '通知：'),
                  h('select', {
                    'data-dy-input': '', style: { flex: '1', maxWidth: '150px' },
                    value: String(cfg.notifyMode || 'toast'),
                    onChange: (e) => patch({ notifyMode: e.target.value }, '通知方式已保存'),
                  },
                    h('option', { value: 'toast' }, '弹 Windows 通知'),
                    h('option', { value: 'file' }, '只写文件（不打扰）'),
                    h('option', { value: 'webhook' }, '推 webhook'),
                    h('option', { value: 'both' }, '通知 + webhook')))),
            )
          : null,

        /* ── 卡 ⑥ 我的人设（桌宠联动开关 2026-10-26 按主人要求隐藏） ──
         *   主人：「人设是不是该改成我的人设」⇒ 对，这份是**你的**那份，
         *   不是泛称的"人设"。标题就叫「我的人设」。 */
        foldCfg
          ? h('div', { 'data-dy-card': '' },
              h('div', { 'data-dy-title': '' }, '我的人设'),
      /* ⭐⭐ 2026-10-25 拆分：卡⑥从「桌宠控制台」变成「联动桌宠」一个开关。
       *   为什么缩水：桌宠独立成插件了（dsh-deskpet），她的开关 / 人格 / 弹幕三态 /
       *   语音 / 按钮条全在**设置 → 桌宠**那边。在这里控制它们就是跨插件伸手，
       *   两份配置互相覆盖的坑我们踩过一次（dmTo 被清空那次就是这么来的）。
       *   这里只回答一个问题：**刷抖音的状态要不要喂给她**。
       *
       * 🔴 2026-10-26 主人：「联动桌宠选项暂时不要出现」⇒ 用 HIDE_PET_LINK 关掉。
       *   为什么用常量而不是删代码：
       *     · 删了以后要恢复就得重写一遍（这块逻辑+文案不短）
       *     · 后端 petLinkTo 还在工作（默认 true，状态源照常注册），
       *       只是**面板不让人看见/改它** —— 主人要的是"别出现在界面上"，
       *       不是"断掉联动"。
       *   要恢复：把下面的 HIDE_PET_LINK 改成 false 即可，别改别的。 */
              (() => {
                const HIDE_PET_LINK = true
                if (HIDE_PET_LINK) return null
                return h('div', { 'data-dy-subblock': '' },
                  h('div', { 'data-dy-row': '' },
                    h('div', { 'data-dy-grow': '' },
                      h('div', { 'data-dy-title': '' }, '联动桌宠'),
                      h('div', { 'data-dy-sub': '' },
                        (cfg.petLinkTo !== false
                          ? '✅ 开着：刷抖音的状态会喂给桌宠 —— 她在气泡里说「正一条条看视频文案」这种话，就是从这里来的。'
                          : '关着：桌宠不知道你在刷抖音，她自己待着（这不是故障）。'))),
                    h(Switch, {
                      on: cfg.petLinkTo !== false,
                      disabled: busy === 'patch',
                      onChange: (v) => patch({ petLinkTo: v },
                        v ? '✅ 联动开了：她知道你在刷抖音了' : '联动关了：她不再知道抖音的状态'),
                    })))
              })(),
                /* ⚠️ 2026-10-25 主人：「走动模式去掉，不生效也没动画」⇒ 这块直接删掉。 */
      /* ── 我的人设
       *   🔴 2026-10-26 主人：「人设默认的是不是有问题，人设是不是该改成我的人设」
       *      两件事一起改：
       *        ① 叫法 —— 卡片标题「人设」→「我的人设」（这是**你的**那份，不是泛称）
       *        ② 默认有真问题 —— 面板原来只读 $DOUYIN_HOME/persona.md，
       *           而实际生效的是**插件自带那份**（16970 字节完整人设），
       *           于是文本框空着、提示写"用的是默认"，看着就像人设丢了。
       *           现在后端会返回 effective（真正生效的内容）+ effective_label（哪一份），
       *           面板直接展示它，并在上面写清"现在用的是哪一份"。
       */
              h('div', { 'data-dy-subblock': '' },
                h('div', { 'data-dy-row': '' },
                  h('div', { 'data-dy-grow': '' },
                    h('div', { 'data-dy-sub': '' },
                      '人格是性格档位，这里补几句你额外想让她遵守的话（写日报时也用这份）。')),
                  h('button', { 'data-dy-mini': '', disabled: busy === 'persona', onClick: loadPersona },
                    persona === null ? '展开' : '收起')),
                persona !== null
                  ? h('div', { 'data-dy-inner': '', style: { background: 'transparent', border: 'none', padding: 0, gap: '8px' } },
                    // ⭐ 说清"现在生效的是哪一份"（别再让用户以为自己的人设丢了）
                    h('div', { 'data-dy-sub': '', style: { fontWeight: '500' } },
                      persona.custom
                        ? '✅ 正在用你写的这份'
                        : `ℹ️ 你没写自己的 —— 现在用的是「${persona.effective_label || '插件自带的那份'}」，内容就在下面`),
                    h('textarea', {
                      'data-dy-input': '', rows: 8,
                      // 没有自己那份时，把**真正生效的内容**显示出来（而不是空框）
                      value: persona.text || (persona.custom ? '' : (persona.effective || '')),
                      placeholder: '比如：\n- 说话软一点、别腻\n- 简短，别写成客服\n- 不透露任何私人信息',
                      onChange: (e) => setPersona({ ...persona, text: e.target.value }),
                    }),
                    h('div', { 'data-dy-row': '' },
                      h('button', {
                        'data-dy-btn': '', 'data-primary': '', disabled: Boolean(busy), onClick: savePersona,
                      }, persona.custom ? '保存' : '保存为我的人设'),
                      h('button', {
                        'data-dy-mini': '', disabled: Boolean(busy),
                        onClick: () => setPersona({ ...persona, text: persona.defaultText || '' }),
                      }, '填入中性默认'),
                      h('div', { 'data-dy-grow': '' }),
                      h('span', { 'data-dy-sub': '' }, '留空保存 = 退回上一份（自己写 → 插件自带 → 中性默认）')))
                  : null),
            )
          : null,

        /* ── 卡 ⑦ 消息与记忆：收件箱（谁找我）+ 聊天窗口 + 对话记忆（含清空） ── */
        foldCfg
          ? h('div', { 'data-dy-card': '' },
              h('div', { 'data-dy-title': '' }, '消息与记忆'),
              h('div', { 'data-dy-sub': '' },
                '谁在评论区 @ 了你、谁给你发了私信；点一条就能回。聊过的话记在本机，不上传。'),
      /* ── 消息：评论区 @ 我 + 谁私信我 ── */
              h('div', { 'data-dy-subblock': '' },
                h('div', { 'data-dy-row': '' },
                  h('div', { 'data-dy-grow': '' },
                    h('div', { 'data-dy-title': '' }, '消息'),
                    h('div', { 'data-dy-sub': '' },
                      '谁在评论区 @ 了你、谁最近给你发了私信。点一条就能回。')),
                  h('button', { 'data-dy-btn': '', disabled: busy === 'inbox' || !st.loggedIn, onClick: loadInbox },
                    busy === 'inbox' ? '读取中…' : (inbox === null ? '看看谁找我' : '收起'))),
                !st.loggedIn ? h('div', { 'data-dy-sub': '' }, '（要先扫码登录）') : null,

                inbox !== null && inbox.ok
                  ? h('div', { 'data-dy-inner': '', style: { background: 'transparent', border: 'none', padding: 0, gap: '10px' } },
                    /* 评论区 @ */
                    h('div', { 'data-dy-sub': '' }, `评论区 @ 我：${inbox.at_n || 0} 条`),
                    (inbox.at || []).length
                      ? h('div', { 'data-dy-people': '' },
                        inbox.at.map((a, i) => h('div', { key: 'at' + i, 'data-dy-msgrow': '' },
                          h('div', { 'data-dy-row': '' },
                            h('span', { 'data-dy-person-name': '' }, a.nickname || '（不知道是谁）'),
                            h('span', { 'data-dy-tag': '', ...(a.before === '回过' ? { 'data-ok': '' } : {}) }, a.before),
                            h('div', { 'data-dy-grow': '' }),
                            a.video_url
                              ? h('a', { href: a.video_url, target: '_blank', rel: 'noreferrer', 'data-dy-mini': '', style: { textDecoration: 'none' } }, '看视频')
                              : null),
                          h('div', { 'data-dy-person-sub': '', style: { whiteSpace: 'normal', marginTop: '2px' } }, a.content || ''),
                          a.my_comments_here && a.my_comments_here.length
                            ? h('div', { 'data-dy-sub': '', style: { marginTop: '2px' } },
                              '我在这条视频下说过：' + a.my_comments_here[a.my_comments_here.length - 1].text.slice(0, 40))
                            : null)))
                      : h('div', { 'data-dy-sub': '' }, (inbox.at_n ? '都回过了' : '最近没有人在评论区 @ 你')),

                    /* 私信 */
                    h('div', { 'data-dy-sub': '', style: { marginTop: '6px' } }, `最近私信：${inbox.dm_n || 0} 个可能要回`),
                    (inbox.dm || []).length
                      ? h('div', { 'data-dy-people': '' },
                        inbox.dm.map((p, i) => h('button', {
                          key: 'dm' + i, 'data-dy-person': '', 'data-dy-inbox-dm': '', disabled: Boolean(busy),
                          onClick: () => openChat(p),
                        },
                          h('span', { 'data-dy-person-name': '' }, p.nick),
                          p.duplicate ? h('span', { 'data-dy-tag': '' }, '重名') : null,
                          p.needs_reply ? h('span', { 'data-dy-tag': '' }, '该回了') : null,
                          h('span', { 'data-dy-person-sub': '' },
                            (p.their_last ? '他：' + String(p.their_last.text).slice(0, 26) : (p.preview || ''))),
                          h('span', { 'data-dy-tag': '' }, `记 ${p.remembered || 0}`))))
                      : h('div', { 'data-dy-sub': '' }, '最近没有私信'),
                    (inbox.errors && inbox.errors.length)
                      ? h('div', { 'data-dy-msg': '', 'data-warn': '' }, '有些读不到：' + inbox.errors.join('；'))
                      : null)
                  : null,
                inbox !== null && !inbox.ok
                  ? h('div', { 'data-dy-msg': '', 'data-warn': '' }, (inbox.errors || []).join('；') || '读不到消息')
                  : null),
      /* ── 聊天（带记忆） ── */
              chat !== null
                ? h('div', { 'data-dy-subblock': '' },
                  h('div', { 'data-dy-row': '' },
                    h('div', { 'data-dy-grow': '' },
                      h('div', { 'data-dy-title': '' }, '跟 ' + chat.who.nick + ' 聊'),
                      h('div', { 'data-dy-sub': '' },
                        chat.data.context && chat.data.context.facts && chat.data.context.facts.length
                          ? '记得关于他的：' + chat.data.context.facts.join('、')
                          : (chat.data.context && chat.data.context.note) ? chat.data.context.note : '记忆里还没有这个人')),
                    h('button', { 'data-dy-mini': '', onClick: () => { setChat(null); setChatText('') } }, '关掉')),

                  /* 消息气泡 */
                  h('div', { 'data-dy-chat': '' },
                    (chat.data.messages || []).map((m, i) => h('div', {
                      key: 'm' + i,
                      'data-dy-bubble': '',
                      'data-mine': m.from === 'me' ? '' : undefined,
                      'data-them': m.from === 'them' ? '' : undefined,
                    },
                      h('div', { 'data-dy-bubble-text': '' }, String(m.text || '').slice(0, 300)),
                      m.awe === 800 ? h('div', { 'data-dy-tag': '' }, '分享卡片') : null))),

                  /* 输入 */
                  h('div', { 'data-dy-row': '' },
                    h('input', {
                      'data-dy-input': '', style: { flex: '1' },
                      placeholder: '说点什么…（发出去会进记忆）',
                      value: chatText,
                      onChange: (e) => setChatText(e.target.value),
                      onKeyDown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() } },
                    }),
                    h('button', {
                      'data-dy-btn': '', 'data-primary': '',
                      disabled: busy === 'send' || !String(chatText || '').trim(),
                      onClick: sendChat,
                    }, busy === 'send' ? '发送中…' : '发送')),
                  h('div', { 'data-dy-sub': '' },
                    '发出去的话会记进记忆，下次打开就知道聊到哪了。'))
                : null,
      /* ── 对话记忆 ── */
              h('div', { 'data-dy-subblock': '' },
                h('div', { 'data-dy-row': '' },
                  h('div', { 'data-dy-grow': '' },
                    h('div', { 'data-dy-title': '' }, '对话记忆'),
                    h('div', { 'data-dy-sub': '' },
                      '回私信、回评论时会记住聊过什么（存在本机，不上传）。这样它才不会把人当陌生人、重复问已经说过的事。')),
                  h('button', {
                    'data-dy-btn': '', disabled: busy === 'mem', onClick: loadMem,
                  }, mem === null ? '看记忆' : '收起')),
                mem !== null
                  ? h('div', { 'data-dy-inner': '', style: { background: 'transparent', border: 'none', padding: 0, gap: '8px' } },
                    h('div', { 'data-dy-kv': '' },
                      `私信记忆 ${mem.dm} 个人 · 评论区记忆 ${mem.comment} 条视频 · 共 ${Math.round((mem.bytes || 0) / 1024)} KB`),
                    h('div', { 'data-dy-sub': '' },
                      mem.dm || mem.comment
                        ? '想忘掉某个人：在对话里说「忘掉他」，或者清空全部。'
                        : '还没有记忆 —— 用它聊过天之后才会有。'),
                    h('div', { 'data-dy-row': '' },
                      h('button', {
                        'data-dy-mini': '', 'data-danger': '', disabled: Boolean(busy) || (!mem.dm && !mem.comment),
                        onClick: clearMem,
                      }, '清空全部记忆')))
                  : null),
            )
          : null,
      )
    }

    /* ════════════════════════════════════════════════════════════════════════
     * ⭐ 「她的家」控制台（2026-10-27）—— 独立一段，和上面的「刷抖音」段互不引用
     * ------------------------------------------------------------------------
     * 上面那段是**主人的配置**（怎么刷、发给谁）；这一段是**她自己的家**：
     * 人设 / 记忆 / 节奏 / 记录。两者共享同一个 client bundle，但：
     *   · 状态、hook、组件全部独立（不碰上面任何 useState / Panel）
     *   · 样式独立：HOME_CSS + <style data-plugin-css="...-home">，前缀 .dh-* / data-dh-*
     *   · 注册独立：第二个 settings.section（id: douyin-home，order 比 31 大）
     *
     * 后端契约（固定，前端只按这个 fetch）：前缀 /api/douyin-home
     *   GET  /snapshot
     *   GET  /diary?date=
     *   GET  /journal?date=&limit=
     *   GET  /archive?q=&date=&limit=
     *   POST /persona  {layers:{…六层}}
     *   POST /plan     {at?|after_minutes?|cancel?}
     *   POST /profile  {sec_uid, patch:{stage?,call?,impression?,likes?,avoid?,lastTopic?,promises?}}
     *   ⚠️ POST 必须带请求头 x-douyin-home: 1（否则 403），见 homePost()。
     *
     * 前端三条铁律：
     *   1. 后端任何字段都可能缺（home 文件没建 / 被删）⇒ 全部空值兜底，绝不白屏。
     *   2. 进页立即 GET /snapshot；之后 10 秒一次，只在 visibilityState==='visible' 时；
     *      切 tab 不重复拉全量（各 tab 只在第一次激活时拉它自己的接口）。
     *   3. 写成功 ⇒ 立刻重拉一次 snapshot + 顶部一行「已保存」。
     * ════════════════════════════════════════════════════════════════════════ */

    const HOME_API = '/api/douyin-home'

    const homeJson = async (res) => {
      if (res.ok) return res.json()
      const why = res.status === 401 ? '（未登录 / 没权限）'
        : res.status === 403 ? '（被宿主拦了 / 没带 x-douyin-home）'
        : res.status === 404 ? '（后端还没提供这个接口）' : ''
      // 400 之类：把后端那句人话带出来（例如「archiveDays 要在 0–3650」），比「HTTP 400」有用
      let detail = ''
      if (res.status !== 404) {
        try {
          const body = typeof res.clone === 'function' ? await res.clone().json() : null
          detail = String((body && (body.error || body.hint)) || '').trim()
        } catch { /* 不是 JSON 就算 */ }
      }
      throw new Error(detail ? detail + '（HTTP ' + res.status + '）' : 'HTTP ' + res.status + why)
    }
    const homeGet = async (p) => homeJson(await fetch(HOME_API + p, { credentials: 'same-origin' }))
    const homePost = async (p, body) => homeJson(await fetch(HOME_API + p, {
      method: 'POST',
      credentials: 'same-origin',
      // ⭐ 后端契约：所有 POST 必须带这个头，否则 403
      headers: { 'content-type': 'application/json', 'x-douyin-home': '1' },
      body: JSON.stringify(body || {}),
    }))
    const homeErrText = (e) => String((e && e.message) || e || '未知错误')

    /* ── 小工具（全部防 undefined / 非法值，绝不让渲染炸） ── */
    const dhPad = (n) => String(n).padStart(2, '0')
    const dhText = (v, d) => {
      if (v === null || v === undefined || v === '') return d === undefined ? '—' : d
      if (typeof v === 'boolean') return v ? '是' : '否'
      if (typeof v === 'object') { try { return JSON.stringify(v) } catch { return '—' } }
      return String(v)
    }
    const dhNum = (v, d) => {
      if (typeof v === 'number' && isFinite(v)) return String(v)
      if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return String(Number(v))
      return d === undefined ? '—' : d
    }
    /** 把 秒/毫秒/ISO 字符串 统一成毫秒时间戳；认不出来返回 null */
    const dhMs = (v) => {
      if (typeof v === 'number' && isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v
      if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v)
        if (isFinite(n) && n > 1e9) return n < 1e12 ? n * 1000 : n
        const t = Date.parse(v)
        if (!isNaN(t)) return t
      }
      return null
    }
    const dhTime = (v) => {
      const ms = dhMs(v)
      if (ms === null) return dhText(v)
      const d = new Date(ms)
      if (isNaN(d.getTime())) return dhText(v)
      return d.getFullYear() + '-' + dhPad(d.getMonth() + 1) + '-' + dhPad(d.getDate())
        + ' ' + dhPad(d.getHours()) + ':' + dhPad(d.getMinutes())
    }
    const dhRel = (v) => {
      const ms = dhMs(v)
      if (ms === null) return dhText(v)
      const diff = Date.now() - ms
      if (diff < 0) {
        const mins = Math.max(1, Math.round(-diff / 60000))
        if (mins < 60) return mins + ' 分钟后'
        if (mins < 1440) return Math.round(mins / 60) + ' 小时后'
        return Math.round(mins / 1440) + ' 天后'
      }
      const s = Math.round(diff / 1000)
      if (s < 60) return s + ' 秒前'
      const m = Math.round(s / 60)
      if (m < 60) return m + ' 分钟前'
      const hr = Math.round(m / 60)
      if (hr < 48) return hr + ' 小时前'
      return Math.round(hr / 24) + ' 天前'
    }
    const dhToday = () => {
      const d = new Date()
      return d.getFullYear() + '-' + dhPad(d.getMonth() + 1) + '-' + dhPad(d.getDate())
    }
    /** 一个时间点的人话：ISO / 毫秒 → 「2026-10-27 23:30（5 小时后）」；HH:MM 原样 */
    const dhWhen = (v) => {
      const ms = dhMs(v)
      if (ms === null) return dhText(v)
      return dhTime(ms) + '（' + dhRel(ms) + '）'
    }
    /** 后端一个字段可能是数组（journal.latest = 最近 10 条）也可能是单条 —— 统一成数组 */
    const dhRows = (v) => {
      if (Array.isArray(v)) return v
      if (v === null || v === undefined || v === '') return []
      return [v]
    }
    /** 待办可能是字符串 / {at,note} / {after_minutes,note} / null —— 都说得明白 */
    const dhPlanText = (p) => {
      if (p === null || p === undefined || p === '') return '没有待办'
      if (typeof p === 'string') return p
      if (typeof p === 'number') return String(p)
      if (typeof p !== 'object') return String(p)
      const at = p.at || p.time || p.when || ''
      const after = p.after_minutes || p.afterMinutes || ''
      const note = p.note || p.text || p.what || p.title || ''
      let when = ''
      if (at) when = dhWhen(at)
      else if (after || after === 0) when = dhNum(after) + ' 分钟后'
      if (when && note) return when + ' · ' + note
      if (when) return when
      if (note) return String(note)
      if (typeof p === 'object' && Object.keys(p).length === 0) return '没有待办'
      try { return JSON.stringify(p) } catch { return '—' }
    }
    /** 待办是不是「真的有一个」—— null / '' / 空对象 都算没有 */
    const dhHasPlan = (p) => {
      if (p === null || p === undefined || p === '' || p === false) return false
      if (typeof p === 'object' && !Array.isArray(p)) {
        const when = p.at || p.time || p.when || p.after_minutes || p.afterMinutes
        const note = p.note || p.text || p.what || p.title
        return Boolean(when || note)
      }
      return true
    }
    /** 后端一行记录形状不固定（{at,text} / {at,channel,who,from,kind,text} / 纯字符串）
     *  —— 摊平成「时间 + 谁 + 一句话」。数组传进来也不炸（当没有）。 */
    const dhLine = (row) => {
      if (row === null || row === undefined) return { at: '', who: '', text: '' }
      if (typeof row === 'string') return { at: '', who: '', text: row }
      if (typeof row !== 'object' || Array.isArray(row)) return { at: '', who: '', text: String(row) }
      const at = row.at || row.time || row.ts || row.date || row.when || ''
      const who = row.who || row.to || row.nick || row.target || ''
      const text = row.text || row.note || row.msg || row.line || row.content || row.summary || row.title || ''
      if (!at && !text && !who) { try { return { at: '', who: '', text: JSON.stringify(row) } } catch { return { at: '', who: '', text: '—' } } }
      return { at: at ? dhTime(at) : '', who: who ? String(who) : '', text: String(text) }
    }
    /** health 里的小字段：ISO 时间给相对时间，布尔给是/否，其它原样 */
    const dhHealthVal = (v) => {
      if (v === null || v === undefined || v === '') return '—'
      if (typeof v === 'boolean') return v ? '是' : '否'
      if (typeof v === 'string' && v.length >= 10 && dhMs(v) !== null) return dhRel(v) + '（' + dhTime(v) + '）'
      if (typeof v === 'object') { try { return JSON.stringify(v) } catch { return '—' } }
      return String(v)
    }

    /* ════════════════════════════════════════════════════════════════════════
     * ⭐ 共享登录状态（单例，2026-10-27）
     * ------------------------------------------------------------------------
     * 为什么要有它：登录流程以前长在「刷抖音」面板里（qr / qrHint / busy 三个
     * state）。现在「她的家」也要登录，如果各写一份：
     *   ① 两边各出一份二维码、各自轮询 = 双倍请求、两套状态；
     *   ② 更糟：扫码窗口和后台无头浏览器**共用同一个 chrome-profile**，任何一边
     *      点「重新出码」都会先 `qr-login close` 把浏览器杀掉 ⇒ 另一边正在等的
     *     二维码立刻失效（2026-10-27 的 bug）。
     * 所以改成**全插件只有一份**：一份状态 + 一份订阅者 + 唯一一条轮询。
     *
     * 状态机：idle → preparing → ready → waiting → ok
     *                              ↘ expired / closed / err
     *   · start(false)：只出码，不杀共用浏览器（普通「扫码登录」/重试）
     *   · start(true) ：只有明确的「重新出码」才先 close 再出
     *   · wait()      ：≤40 次 /login/check（约 1.8s 一次），同一时间只允许一份在跑
     *
     * ⚠️ /login/* 是 duty 前缀，必须用现有 jpost（不要带 x-douyin-home 头）。
     * ════════════════════════════════════════════════════════════════════════ */
    const loginStore = (() => {
      let state = {
        phase: 'idle',      // idle | preparing | ready | waiting | ok | expired | closed | err
        qrUrl: '',
        hint: '',
        verify: [],
        loggedIn: null,     // null = 还没查过；true / false = 已知
        account: null,
        busy: false,        // preparing / waiting 时为 true（UI 禁用按钮用）
      }
      const listeners = new Set()
      let polling = false

      const errTextOf = (e) => String((e && e.message) || e || '未知错误')
      const emit = (patch) => {
        state = Object.assign({}, state, patch || {})
        state.busy = state.phase === 'preparing' || state.phase === 'waiting'
        listeners.forEach((fn) => { try { fn() } catch { /* 某个订阅者炸了别连累别人 */ } })
      }

      /** 查登录态（/status 里就带 loggedIn / account，比 /account 快得多） */
      const refresh = async () => {
        try {
          const r = await jget('/status')
          if (!r) return
          if (r.loggedIn === true) {
            emit({
              loggedIn: true,
              account: r.account || state.account || null,
              phase: (state.phase === 'idle' || state.phase === 'closed' || state.phase === 'err') ? 'ok' : state.phase,
            })
          } else if (r.loggedIn === false) {
            emit({
              loggedIn: false,
              account: null,
              phase: state.phase === 'ok' ? 'idle' : state.phase,
            })
          }
        } catch { /* 读不到就保留旧状态，别把已登录吓成未登录 */ }
      }

      /** 出二维码。force=true 才会先关掉共用浏览器（只给「重新出码」用）。 */
      const start = async (force) => {
        if (state.phase === 'preparing' || state.phase === 'waiting') return
        emit({ phase: 'preparing', qrUrl: '', hint: '', verify: [] })
        try {
          const r = await jpost('/login/qr', { force: force ? '1' : '' })
          if (r && r.ok && r.qr_url) { emit({ phase: 'ready', qrUrl: r.qr_url, hint: '' }); return }
          if (r && r.ok && r.already_logged_in) {
            await refresh()
            emit({ phase: 'ok', hint: '这个浏览器里本来就登录着，已经直接登录好了' })
            return
          }
          if (r && r.ok && r.no_qr_element) {
            emit({ phase: 'err', hint: r.hint || '没能自动截到二维码，请直接看那个 Chrome 窗口' })
            return
          }
          if (r && r.conflict === 'profile_in_use') {
            emit({
              phase: 'err',
              hint: (r.error || '后台浏览器占着窗口') + ' —— 点「重新出码」会先把它关掉再出，不用自己关。',
            })
            return
          }
          emit({ phase: 'err', hint: (r && (r.error || r.detail || r.hint)) || '出二维码失败' })
        } catch (e) {
          emit({ phase: 'err', hint: '出二维码失败：' + errTextOf(e) })
        }
      }

      /** 「我扫完了」：小步轮询（≤40 次），成功就地收掉登录窗口 */
      const wait = async () => {
        if (polling) return
        polling = true
        const wasStarted = state.phase === 'ready' || state.phase === 'waiting' || state.phase === 'err' || state.phase === 'expired'
        emit({ phase: 'waiting', verify: [], hint: '' })
        try {
          let done = false
          let usedCheck = true
          for (let i = 0; i < 40 && !done; i++) {
            let r = null
            try { r = await jpost('/login/check', {}) } catch { usedCheck = false; break }
            if (r && r.ok) { done = true; break }
            if (r && r.up === false) {
              emit({ phase: 'expired', hint: r.hint || '登录用的浏览器还没开 —— 先点「扫码登录」' })
              return
            }
            if (r && Array.isArray(r.verify) && r.verify.length) {
              emit({ verify: r.verify, hint: '卡在验证：' + r.verify.join(' / ') + ' —— 在那个浏览器窗口里做完，不用重扫' })
            } else if (i === 3) {
              emit({ hint: '在等你扫码…（手机抖音 → 扫一扫）' })
            }
            await new Promise((res) => setTimeout(res, 1800))
          }
          if (done) {
            emit({ phase: 'ok', qrUrl: '', hint: '', verify: [], loggedIn: true })
            await refresh()
            return
          }
          if (!usedCheck) {
            // 老宿主没有 /login/check：退回一次 /login/wait（最多 20 秒，宿主侧异步，不会堵）
            try {
              const r = await jpost('/login/wait', { seconds: 20 })
              if (r && r.ok) {
                emit({ phase: 'ok', qrUrl: '', hint: '', verify: [], loggedIn: true })
                await refresh()
                return
              }
              emit({ phase: 'expired', hint: (r && (r.hint || r.error)) || '还没好 —— 再点一次「我扫完了」' })
            } catch (e) { emit({ phase: 'expired', hint: '等待失败：' + errTextOf(e) }) }
            return
          }
          emit({ phase: 'expired', hint: wasStarted ? '等了一会儿还没扫上 —— 二维码可能过期了，点「重新出码」再来' : '还没开始扫码 —— 先点「扫码登录」' })
        } finally { polling = false }
      }

      const close = async () => {
        try { await jpost('/login/close', {}) } catch { /* 关不掉也无所谓 */ }
        emit({ phase: 'closed', qrUrl: '', hint: '登录窗口已关。想继续就再点一次「扫码登录」。' })
      }

      const logout = async () => {
        try {
          await jpost('/login/clear', {})
          emit({ phase: 'closed', qrUrl: '', hint: '已退出登录（Cookie 删了）', loggedIn: false, account: null })
          await refresh()
        } catch (e) { emit({ hint: '退出失败：' + errTextOf(e) }) }
      }

      return {
        getState: () => state,
        subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
        refresh,
        start,
        check: wait,        // 契约名：check() = 小步轮询
        wait,
        close,
        clear: logout,      // 契约名：clear() = 退出登录（删 Cookie）
        logout,
      }
    })()

    /** 订阅共享登录状态（React 18 用 useSyncExternalStore；拿不到就 useState+订阅兜底） */
    const useLoginSnapshot = (() => {
      const get = () => loginStore.getState()
      if (typeof React.useSyncExternalStore === 'function') {
        return function useLoginSnapshot() {
          return React.useSyncExternalStore(loginStore.subscribe, get, get)
        }
      }
      return function useLoginSnapshot() {
        const [, bump] = React.useState(0)
        React.useEffect(() => loginStore.subscribe(() => bump((x) => x + 1)), [])
        return get()
      }
    })()

    /** 登录状态 + 操作（两个面板共用；不要各自再写一份登录逻辑） */
    function useDouyinLogin() {
      const s = useLoginSnapshot()
      // 每次挂载轻量查一次登录态 —— 另一个面板可能刚登录/退出
      React.useEffect(() => { loginStore.refresh() }, [])
      return {
        phase: s.phase || 'idle',
        busy: Boolean(s.busy),
        qrUrl: s.qrUrl || '',
        hint: s.hint || '',
        verify: Array.isArray(s.verify) ? s.verify : [],
        loggedIn: s.loggedIn === true ? true : (s.loggedIn === false ? false : null),
        account: s.account || null,
        start: () => loginStore.start(false),
        restart: () => loginStore.start(true),
        wait: () => loginStore.check(),
        close: () => loginStore.close(),
        logout: () => loginStore.clear(),
        refresh: () => loginStore.refresh(),
      }
    }

    /**
     * 登录卡（纯展示 + 调共享 store；两个面板共用）
     *   compact = 嵌进「刷抖音」三步装机里：沿用 data-dy-*，外观不变
     *   bare    = 不留卡片外壳（嵌进「连接」的三步卡）
     *   默认    = 独立 .dh-card（她的家 · 连接 tab）
     */
    function DhLoginCard({ login, compact, bare, say }) {
      const [localMsg, setLocalMsg] = React.useState(null)
      const [confirmOut, setConfirmOut] = React.useState(false)
      /* ⭐ 2026-10-27：已登录时也要能「重新扫码 / 换号」—— 原来只有刷新/退出，
         用户找不到「登录」在哪（截图反馈）。重新扫码会重启那个共用浏览器并覆盖 Cookie，所以要二次确认。 */
      const [confirmRelogin, setConfirmRelogin] = React.useState(false)
      const notify = (text, tone) => {
        if (typeof say === 'function') say(text, tone)
        else setLocalMsg({ text: String(text || ''), tone: tone || '' })
      }
      const st = login || {}
      const loggedIn = st.loggedIn === true
      const unknown = st.loggedIn === null
      const phase = st.phase || 'idle'
      const account = st.account || {}
      const nick = String(account.nick || '').trim()
      const alive = account.alive
      const at = account.at || ''

      /* 样式映射：compact 用原面板的 data-dy-*（外观不变），否则用独立的 .dh-* */
      const T = (n, extra) => Object.assign({}, compact ? { ['data-dy-' + n]: '' } : { className: 'dh-' + n }, extra || {})
      const Btn = (label, onClick, opts) => {
        const o = opts || {}
        const props = Object.assign({ onClick, disabled: Boolean(o.disabled) },
          compact ? { 'data-dy-btn': '' } : { className: 'dh-btn' })
        if (o.primary) props[compact ? 'data-primary' : 'data-dh-primary'] = ''
        if (!compact && o.plain) props.className = 'dh-mini'
        return h('button', props, label)
      }
      const Mini = (label, onClick) => h('button',
        compact ? { 'data-dy-mini': '', onClick } : { className: 'dh-mini', onClick }, label)
      const Row = (children, extra) => h('div', T('row', extra), children)
      const Sub = (children) => h('div', T('sub'), children)
      const Msg = (text, tone) => h('div',
        compact
          ? { 'data-dy-msg': '', 'data-good': tone === 'good' ? '' : undefined, 'data-warn': tone === 'warn' ? '' : undefined }
          : { className: 'dh-msg', 'data-dh-tone': tone || undefined },
        text)
      const Tip = () => Sub('扫完如果抖音还弹「短信验证码」或「拖动滑块」—— 在那个弹出的浏览器窗口里做完，再点「我扫完了」。不用重新扫。')
      const Qr = () => h('img', Object.assign(
        {
          src: st.qrUrl,
          alt: '抖音登录二维码',
          style: { width: '190px', height: '190px', borderRadius: '10px', background: '#fff', padding: '6px', objectFit: 'contain' },
        },
        compact ? { 'data-dy-qr': '' } : { className: 'dh-qr' },
      ))
      const localMsgEl = localMsg ? Msg(localMsg.text, localMsg.tone) : null
      /* store 只改状态、不弹人话 —— 这里统一补一句（面板顶部 / 卡片里都能看到） */
      const afterStart = (verb) => {
        const s2 = loginStore.getState()
        if (s2.phase === 'ready') notify('二维码出来了 —— 用手机抖音扫一下', 'good')
        else if (s2.hint) notify(s2.hint, 'warn')
        void verb
      }
      const doStart = async () => { await st.start(); afterStart('start') }
      const doRestart = async () => { await st.restart(); afterStart('restart') }
      const doWait = async () => {
        await st.wait()
        const s2 = loginStore.getState()
        if (s2.loggedIn === true) notify('登录成功 —— 可以刷了', 'good')
        else notify(s2.hint || '还没等到 —— 再试一次「我扫完了」', 'warn')
      }
      const doClose = async () => { await st.close() }

      const loggedInBody = () => h('div', T('stack'),
        Row([
          compact ? null : h('div', { className: 'dh-avatar' }, (nick || '鱼').slice(0, 1)),
          h('div', T('grow'),
            h('div', T('title'), nick || '已登录'),
            Sub([
              alive === true ? '在线' : alive === false ? '会话可能掉了（去抖音网页确认下）' : '是否在线：未知',
              at ? '登录时间 ' + dhTime(at) : '',
            ].filter(Boolean).join(' · '))),
          confirmOut || confirmRelogin ? null : Mini('重新扫码（换号）', () => setConfirmRelogin(true)),
          confirmOut || confirmRelogin ? null : Mini('刷新', () => st.refresh()),
          confirmOut || confirmRelogin ? null : Btn('退出登录', () => setConfirmOut(true)),
        ]),
        confirmRelogin
          ? Row([
            Sub('重新扫码会关掉后台那个浏览器，并用新扫的号覆盖本机 Cookie —— 现在是「' + (nick || '已登录') + '」。确定换号吗？'),
            Btn('确定重新扫码', async () => {
              setConfirmRelogin(false)
              await doRestart()
            }, { primary: true }),
            Btn('取消', () => setConfirmRelogin(false)),
          ])
          : null,
        confirmOut
          ? Row([
            Sub('确定要退出登录吗？（会删掉本机 Cookie，不影响手机端）'),
            Btn('确定退出', async () => {
              setConfirmOut(false)
              await st.logout()
              notify('已退出登录（Cookie 删了）', 'good')
            }, { primary: true }),
            Btn('取消', () => setConfirmOut(false)),
          ])
          : null,
        localMsgEl)

      const loggedOutBody = () => {
        if (unknown) return h('div', T('stack'), Sub('正在读登录状态…'), localMsgEl)
        if (phase === 'preparing') return h('div', T('stack'), Sub('正在准备二维码…（会弹出一个浏览器窗口，等它出来）'), localMsgEl)
        if (phase === 'ready' || phase === 'waiting') {
          return h('div', T('stack'),
            h('div', compact ? { 'data-dy-loginbox': '' } : { 'data-dh-stack': '' },
              st.qrUrl
                ? h('div', T('row', { style: { flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '6px 0' } }),
                  Qr(),
                  Sub('手机抖音 → 右上角「≡」→ 扫一扫'))
                : Sub('二维码生成中…')),
            phase === 'waiting'
              ? Sub(st.hint || '在等你扫码…（手机抖音 → 扫一扫）')
              : (st.hint ? Sub(st.hint) : null),
            st.verify.length
              ? Msg('卡在验证：' + st.verify.join(' / ') + ' —— 在那个浏览器窗口里做完，不用重扫', 'warn')
              : null,
            Row([
              Btn(phase === 'waiting' ? '等你扫…' : '我扫完了', doWait, { primary: true, disabled: phase === 'waiting' }),
              Btn('重新出码', doRestart),
              Btn('关掉窗口', doClose),
            ]),
            Tip(),
            localMsgEl)
        }
        return h('div', T('stack'),
          Sub(st.hint || '点「扫码登录」，会弹出一个浏览器窗口显示二维码，手机扫一下就行。'),
          Row([
            Btn('扫码登录', doStart, { primary: true }),
            st.hint ? Btn('重新出码', doRestart) : null,
          ]),
          Tip(),
          localMsgEl)
      }

      const body = loggedIn ? loggedInBody() : loggedOutBody()
      if (compact) {
        return h('div', {
          'data-dy-subblock': '',
          style: { marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08))' },
        }, body)
      }
      if (bare) return h('div', { 'data-dh-stack': '' }, body)
      return h('div', { className: 'dh-card', 'data-dh-login': '' },
        h('div', { className: 'dh-row' },
          h('div', { className: 'dh-grow', 'data-dh-stack': '' },
            h('div', { className: 'dh-card-title' }, '抖音登录'),
            h('div', { className: 'dh-sub' }, '登录后她才能刷流、才能分享。「刷抖音」和「她的家」共用这一份登录状态。')),
          h('span', {
            className: 'dh-badge',
            'data-dh-tone': loggedIn ? 'good' : (unknown ? undefined : 'warn'),
          }, loggedIn ? '已登录' : (unknown ? '读取中' : '未登录'))),
        body)
    }

    /* ── 日报解析（今天 tab 用；只读 markdown，不引新依赖） ── */
    const dhCnNum = (s) => {
      const t = String(s || '').trim()
      if (/^\d+$/.test(t)) return Number(t)
      const d = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
      if (t === '十') return 10
      const m = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(t)
      if (m) return (m[1] ? d[m[1]] : 1) * 10 + (m[2] ? d[m[2]] : 0)
      return d[t] !== undefined ? d[t] : null
    }
    const dhVideoUrl = (id) => 'https://www.douyin.com/video/' + String(id || '')
    /** `**标题** · @作者 · 12 秒 · 8 小时前` → { title, author } */
    const dhReportMeta = (line) => {
      const t = String(line || '').replace(/\*\*/g, '').trim()
      if (!t) return { title: '', author: '' }
      const parts = t.split(/\s*·\s*/)
      let author = ''
      for (let i = 1; i < parts.length; i++) {
        if (/^@/.test(parts[i])) { author = parts[i]; break }
      }
      const title = String(parts[0] || '').replace(/^["“「]|["”」]$/g, '').trim()
      return { title, author }
    }
    /**
     * 把 `<家>/out/<日期>.md` 解析成「本轮」块（真实报告格式见 prompts/duty.md）：
     *   · 轮次边界：`## 本轮 10:00（今天第二轮，追加）` 或首轮 `> 本轮 09:01：…`
     *   · 每轮：候选（证据包）/ 挑中（推荐）/ 发出（已发卡片去重）/ 顺带 / 判断不了
     *   · 挑中条目：`### <19位ID>`，下一行是 `**标题** · @作者…`
     *   · 发出记录：`已发卡片：<ID>`（后面括号里常写发给谁）
     * 解析不到就返回空 rounds，由 UI 走「今天还没有报告」+ 原文折叠兜底。
     */
    const dhParseReport = (text) => {
      const src = String(text || '')
      const empty = { rounds: [], raw: src, picked: 0, sent: 0 }
      if (!src.trim()) return empty
      const lines = src.split(/\r?\n/)
      const isRoundMark = (ln) => {
        const t = String(ln || '').trim()
        if (/^##\s*本轮统计/.test(t)) return false
        if (/^##\s*本轮/.test(t)) return true
        if (/^>\s*\*{0,2}本轮\s*\d{1,2}:\d{2}/.test(t)) return true
        return false
      }
      const blocks = []
      let cur = null
      for (const ln of lines) {
        if (isRoundMark(ln)) { cur = { mark: ln.trim(), lines: [] }; blocks.push(cur); continue }
        if (cur) cur.lines.push(ln)
      }
      if (!blocks.length && /###\s+\d{15,20}/.test(src)) blocks.push({ mark: '', lines })
      const numOf = (re, s) => { const m = re.exec(s); return m ? Number(m[1]) : null }
      const rounds = blocks.map((b, idx) => {
        const all = [b.mark].concat(b.lines).join('\n')
        const time = ((/(\d{1,2}:\d{2})/.exec(b.mark) || [])[1]) || ((/(\d{1,2}:\d{2})/.exec(b.lines.join('\n')) || [])[1]) || ''
        const cnNo = /今天第([一二三四五六七八九十\d]+)轮/.exec(b.mark)
        const roundNo = (cnNo && dhCnNum(cnNo[1])) || null
        const items = []
        const ls = b.lines
        for (let i = 0; i < ls.length; i++) {
          const m = /^###\s+(\d{15,20})\s*$/.exec(String(ls[i] || '').trim())
          if (!m) continue
          let meta = ''
          for (let j = i + 1; j < Math.min(i + 5, ls.length); j++) {
            const t = String(ls[j] || '').trim()
            if (!t) continue
            if (/^#{1,6}\s/.test(t) || /^🔗|^📊|^已发卡片/.test(t)) break
            meta = t
            break
          }
          const mm = dhReportMeta(meta)
          items.push({ id: m[1], title: mm.title || '', author: mm.author || '' })
        }
        const sends = []
        const sendRe = /已发卡片[：:]\s*(\d{15,20})\s*(?:[（(]([^）)]{0,90})[）)])?/g
        let sm
        while ((sm = sendRe.exec(all))) sends.push({ id: sm[1], who: String(sm[2] || '').trim() })
        const picked = numOf(/(?:推荐|挑中)\s*(\d+)/, all)
        return {
          time,
          roundNo: roundNo || idx + 1,
          cand: numOf(/证据包\s*(\d+)/, all),
          picked: picked !== null ? picked : items.length,
          sent: sends.length,
          side: numOf(/顺带一提\s*(\d+)/, all),
          unsure: numOf(/(?:判断不了|没把握|不推)[^0-9]{0,6}(\d+)/, all),
          items,
          sends,
        }
      })
      // 发出记录按人去重（同一 ID 可能同时在「值得看」小行和「发送」区出现）
      // 报告里常写「（示例主人、示例好友不是小小🎄）」⇒ 拆成多个人，各自记一张
      const sentByWho = new Map()
      const sentIds = new Set()
      rounds.forEach((r) => r.sends.forEach((s) => {
        if (sentIds.has(s.id)) return
        sentIds.add(s.id)
        const people = String(s.who || '').split(/[、,，;；/]+/).map((x) => x.trim()).filter(Boolean)
        const whoList = people.length ? people : ['未注明']
        whoList.forEach((who) => {
          if (!sentByWho.has(who)) sentByWho.set(who, [])
          sentByWho.get(who).push(s.id)
        })
      }))
      return {
        rounds,
        raw: src,
        picked: rounds.reduce((n, r) => n + (Number(r.picked) || 0), 0),
        sent: sentIds.size,
        sentByWho: Array.from(sentByWho.entries()).map(([who, ids]) => ({ who, ids })),
        unparsed: rounds.length === 0,
      }
    }

    /* ── /today、/account、/chat 的展示小工具（2026-10-27 真数据接口） ── */
    /** HH:MM（时间戳/ISO 都行）；认不出来原样给 */
    const dhClock = (v) => {
      const ms = dhMs(v)
      if (ms === null) return dhText(v)
      const d = new Date(ms)
      return dhPad(d.getHours()) + ':' + dhPad(d.getMinutes())
    }
    /** 秒数 → 人话时长：「不到 1 分钟 / 3 小时 20 分钟」 */
    const dhDur = (sec) => {
      const n = Math.max(0, Math.round(Number(sec) || 0))
      if (n < 60) return '不到 1 分钟'
      const m = Math.floor(n / 60)
      if (m < 60) return m + ' 分钟'
      const h = Math.floor(m / 60)
      const mm = m % 60
      return h + ' 小时' + (mm ? ' ' + mm + ' 分钟' : '')
    }
    /** 时间戳/ISO → 本地 YYYY-MM-DD（认不出来给空串） */
    const dhDay = (v) => {
      const ms = dhMs(v)
      if (ms === null) return ''
      const d = new Date(ms)
      return d.getFullYear() + '-' + dhPad(d.getMonth() + 1) + '-' + dhPad(d.getDate())
    }
    /** 主动联系里「被拦下」的原因代号 → 人话 */
    const dhReachReason = (r) => {
      const t = String(r || '').trim()
      if (!t) return '未说明'
      const M = {
        quit: '免打扰', quiet: '免打扰', quiet_hours: '免打扰', quiet_hours_blocked: '免打扰',
        limit: '到上限', daily_limit: '到上限', over_limit: '到上限',
        stage: '关系不够', not_close: '关系不够', disabled: '开关关着',
        dry_run: '演练模式', cooldown: '冷却中', self: '不找自己',
      }
      return M[t.toLowerCase()] || t
    }
    /** 千分位：1234567 → 1,234,567；非数字给 — */
    const dhThousands = (v) => {
      const n = Number(v)
      if (!isFinite(n)) return '—'
      return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }
    /** token 短写法：12345 → 12.3k（压缩记录用） */
    const dhTokensShort = (v) => {
      const n = Number(v)
      if (!isFinite(n)) return '—'
      if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
      if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
      return String(Math.round(n))
    }
    /** 故障 key → 人话前缀（后端 text 没带标签时补上） */
    const dhFaultText = (f) => {
      const K = {
        login: '登录', cookie: '登录', cred: '登录',
        chrome: '浏览器', browser: '浏览器',
        venv: '运行环境', env: '运行环境',
        duty: '值班', stuck: '值班',
        net: '网络', network: '网络',
        disk: '磁盘', space: '磁盘',
        world: '她的世界',
      }
      const key = String((f && f.key) || '').toLowerCase()
      const label = K[key] || ''
      const text = String((f && f.text) || '').trim()
      if (!text) return label ? label + '：未知故障' : '未知故障'
      if (!label || text.indexOf('：') >= 0) return text
      return label + '：' + text
    }
    /** 金额：CNY→¥ / USD→$ / 其它原样；没有 estCost 返回空串 */
    const dhCostText = (est, cur) => {
      const n = Number(est)
      if (est === null || est === undefined || !isFinite(n)) return ''
      const sym = ({ CNY: '¥', USD: '$', EUR: '€', JPY: 'JP¥' })[String(cur || '').toUpperCase()] || ''
      return '≈ ' + sym + n.toFixed(2)
    }
    /** 轮次的触发原因：manual/noon/night… → 人话 */
    const dhWhy = (v) => {
      const t = String(v || '').trim()
      const MAP = { manual: '手动', noon: '午间谷时', night: '夜间谷时', morning: '早上兜底', timer: '定时', peak: '峰时' }
      return t ? (MAP[t.toLowerCase()] || t) : '触发'
    }
    /** sent.to 可能是昵称 / {nick} / {nick,sec_uid} —— 统一取人话名字 */
    const dhPersonName = (v) => {
      if (v === null || v === undefined || v === '') return '未注明'
      if (typeof v === 'string') return v
      if (typeof v === 'object') return String(v.nick || v.name || v.title || v.to || '未注明')
      return String(v)
    }
    /** 今天 tab 的「卡片 / 理由 / 回读」三项：成没成一眼看到（未知给 —，别瞎判） */
    const dhFlag = (label, v) => {
      const on = v === true || (typeof v === 'string' && v.trim() !== '') || (typeof v === 'number' && v > 0)
      const unknown = v === null || v === undefined || v === ''
      return {
        text: label + (on ? ' ✓' : unknown ? ' —' : ' ✗'),
        tone: on ? 'good' : unknown ? undefined : 'warn',
      }
    }
    /** 私信消息方向：me / them / unknown → 我 / 他 / ？ */
    const dhFromLabel = (f) => (f === 'me' ? '我' : f === 'them' ? '他' : '？')
    /** 消息类型（kind）→ 中文小标签；text 不显示 */
    const dhKindLabel = (k) => {
      const M = {
        text: '', card: '分享卡片', image: '图片', video: '视频',
        emoji: '表情', sticker: '表情', audio: '语音', file: '文件',
      }
      const t = String(k || '').toLowerCase()
      return M[t] !== undefined ? M[t] : String(k || '')
    }
    /** 聊天列表里一个人/群的名字 */
    const dhChatName = (p) => String((p && (p.nick || p.title || p.name)) || '（没名字）')

    /* ── 「她的家」独立样式：前缀 .dh-* / data-dh-*，不入侵 .dy-* ── */
    const HOME_CSS = `
[data-dh-page],.dh-page{display:flex;flex-direction:column;gap:14px;padding:4px 2px 10px;max-width:660px;font-size:13px;}
[data-dh-head]{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;}
[data-dh-stack]{display:flex;flex-direction:column;gap:10px;}
[data-dh-tabs]{display:flex;gap:6px;flex-wrap:wrap;padding-bottom:2px;}
.dh-tab{padding:6px 12px;border-radius:8px;font-size:12px;font-family:inherit;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.1));color:inherit;}
.dh-tab:hover:not([data-dh-active]){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.24));}
.dh-tab[data-dh-active]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
[data-dh-tabpane]{display:flex;flex-direction:column;gap:14px;}
.dh-card{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:12px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.06));}
.dh-card-title{font-size:12px;font-weight:600;}
.dh-title{font-size:13px;font-weight:600;}
.dh-sub{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
.dh-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.dh-grow{flex:1;min-width:0;}
.dh-kv{display:flex;gap:8px;font-size:11px;line-height:18px;align-items:baseline;}
.dh-k{flex:none;width:64px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
.dh-v{color:var(--dsw-alias-label-secondary,#c9ccd1);word-break:break-word;min-width:0;}
.dh-btn{padding:7px 13px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.14));color:inherit;}
.dh-btn:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.24));}
.dh-btn[data-dh-primary]{background:#3b82f6;border-color:#3b82f6;color:#fff;}
.dh-btn[data-dh-danger]{color:#f87171;}
.dh-btn[disabled],.dh-mini[disabled]{opacity:.5;cursor:default;}
.dh-mini{padding:5px 10px;border-radius:7px;font-size:11px;cursor:pointer;font-family:inherit;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.14));color:inherit;}
.dh-mini:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.24));}
.dh-mini[data-dh-danger]{color:#f87171;}
.dh-input,.dh-textarea,.dh-select{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;
  font-size:12px;font-family:inherit;line-height:18px;
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.12));color:inherit;}
.dh-input:focus,.dh-textarea:focus,.dh-select:focus{outline:none;border-color:#3b82f6;}
.dh-textarea{resize:vertical;min-height:56px;}
.dh-field{display:flex;flex-direction:column;gap:4px;min-width:0;}
.dh-label{font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
.dh-time{flex:none;width:120px;}
.dh-num{flex:none;width:90px;}
.dh-date{flex:none;width:150px;}
.dh-select{flex:none;width:110px;padding:6px 8px;}
.dh-msg{font-size:11px;line-height:17px;padding:8px 10px;border-radius:8px;
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.12));
  color:var(--dsw-alias-label-tertiary,#9aa0a6);}
.dh-msg[data-dh-tone="good"]{color:#22c55e;}
.dh-msg[data-dh-tone="warn"]{color:#f59e0b;}
.dh-badge{font-size:11px;padding:3px 8px;border-radius:6px;flex:none;
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.14));
  color:var(--dsw-alias-label-secondary,#c9ccd1);}
.dh-badge[data-dh-tone="good"]{background:rgba(34,197,94,.16);color:#22c55e;}
.dh-badge[data-dh-tone="warn"]{background:rgba(245,158,11,.16);color:#f59e0b;}
.dh-pre{margin:0;padding:10px;border-radius:9px;max-height:260px;overflow:auto;
  font-size:11px;line-height:17px;white-space:pre-wrap;word-break:break-word;
  background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.22));
  color:var(--dsw-alias-label-secondary,#c9ccd1);}
.dh-list{display:flex;flex-direction:column;gap:6px;max-height:300px;overflow:auto;}
.dh-item{padding:8px 10px;border-radius:8px;font-size:12px;line-height:17px;
  background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.14));word-break:break-word;}
.dh-item-title{font-size:12px;font-weight:600;}
.dh-item-time{color:var(--dsw-alias-label-tertiary,#9aa0a6);font-size:11px;margin-right:6px;
  font-variant-numeric:tabular-nums;}
.dh-sep{height:1px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.08));margin:2px 0;}
.dh-tag{font-size:10px;padding:1px 6px;border-radius:5px;background:rgba(59,130,246,.16);color:#93c5fd;margin-right:6px;}
[data-dh-seg]{display:inline-flex;gap:6px;flex-wrap:wrap;}
/* 档案卡在「档案」大卡里不重复边框，用分隔线（跟 .dy-subblock 一个观感） */
.dh-card > [data-dh-stack] > [data-dh-profile]{background:transparent;border:0;border-radius:0;
  padding:10px 0 0;border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));}
.dh-card > [data-dh-stack] > [data-dh-profile]:first-child{border-top:0;padding-top:0;}
/* ── 登录卡 / 连接 tab / 今天 tab 的小件 ── */
.dh-avatar{flex:none;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:15px;font-weight:600;background:rgba(59,130,246,.25);color:#dbeafe;}
.dh-qr{display:block;width:190px;height:190px;border-radius:10px;background:#fff;padding:6px;object-fit:contain;}
[data-dh-step]{flex:none;width:20px;height:20px;border-radius:50%;font-size:11px;font-weight:600;
  display:inline-flex;align-items:center;justify-content:center;
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.18));
  color:var(--dsw-alias-label-secondary,#c9ccd1);}
[data-dh-step][data-dh-done]{background:rgba(34,197,94,.18);color:#22c55e;}
[data-dh-pick]{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:7px;
  background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.12));}
[data-dh-pick] a{color:#93c5fd;text-decoration:none;font-size:12px;line-height:17px;word-break:break-word;}
[data-dh-pick] a:hover{text-decoration:underline;}
[data-dh-round]{display:flex;flex-direction:column;gap:6px;padding:9px 10px;border-radius:8px;
  background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.14));}
/* ── 今天 tab：四个数字 / 聊天卡（2026-10-27 真数据） ── */
[data-dh-stats]{display:flex;gap:8px;flex-wrap:wrap;}
.dh-stat{flex:1;min-width:92px;display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:10px;
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.1));
  border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));}
.dh-stat-n{font-size:18px;font-weight:600;line-height:22px;font-variant-numeric:tabular-nums;}
.dh-stat-l{font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-dh-chat-person]{display:flex;align-items:center;gap:8px;width:100%;text-align:left;cursor:pointer;
  padding:7px 9px;border-radius:8px;border:0;background:transparent;color:inherit;font-family:inherit;font-size:12px;}
[data-dh-chat-person]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.2));}
[data-dh-chat-person][data-dh-open]{background:rgba(59,130,246,.12);}
.dh-avatar-sm{flex:none;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:12px;font-weight:600;background:rgba(59,130,246,.22);color:#dbeafe;}
.dh-chat-name{flex:none;font-weight:600;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dh-chat-last{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-dh-chat-box]{display:flex;flex-direction:column;gap:6px;max-height:320px;overflow:auto;
  padding:8px;border-radius:9px;background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.16));}
.dh-bubble{max-width:82%;padding:7px 10px;border-radius:10px;font-size:12px;line-height:17px;
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.2));align-self:flex-start;word-break:break-word;white-space:pre-wrap;}
.dh-bubble[data-dh-mine]{align-self:flex-end;background:rgba(59,130,246,.22);}
.dh-bubble-meta{font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,#9aa0a6);margin-bottom:2px;}
/* ── 主动联系：勾选项 / 进度条 ── */
.dh-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;cursor:pointer;}
.dh-check input{width:15px;height:15px;margin:0;accent-color:#3b82f6;cursor:pointer;}
.dh-check input[disabled]{cursor:default;}
.dh-bar{height:8px;border-radius:4px;overflow:hidden;
  background:var(--dsw-alias-bg-overlay,rgba(128,128,128,.2));}
.dh-bar i{display:block;height:100%;border-radius:4px;background:#3b82f6;}
/* ── 故障 / 花费 / 压缩记录 / 保留范围 ── */
.dh-dot{flex:none;width:8px;height:8px;border-radius:50%;background:#22c55e;display:inline-block;margin-top:5px;}
.dh-dot[data-dh-bad]{background:#ef4444;}
[data-dh-fault]{display:flex;gap:8px;align-items:flex-start;padding:6px 9px;border-radius:8px;
  background:var(--dsw-alias-bg-overlay,rgba(0,0,0,.14));font-size:12px;line-height:17px;word-break:break-word;}
[data-dh-ok]{color:#22c55e;font-size:12px;line-height:18px;}
`

    /* ── 「她的家」：六层人设（键名和后端约定一致） ── */
    const HOME_LAYERS = [
      ['名字', '她叫什么（默认「小鱼」）'],
      ['她是谁', '一句话：她是谁、跟主人什么关系'],
      ['性格', '性格底色，比如爱玩、会闹、护短'],
      ['说话方式', '口头禅、语气、短句还是长句'],
      ['愿景', '她想成为什么样的存在、想做成什么'],
      ['补充', '其它要她记住的规矩或背景'],
    ]
    const HOME_STAGES = ['生', '熟', '自己人']

    const homeLayerDraft = (src) => {
      const o = src && typeof src === 'object' ? src : {}
      const out = {}
      HOME_LAYERS.forEach((f) => { out[f[0]] = typeof o[f[0]] === 'string' ? o[f[0]] : (o[f[0]] === null || o[f[0]] === undefined ? '' : String(o[f[0]])) })
      return out
    }

    /* ── 健康块：health 形状不固定，给什么说什么，缺了也不白 ── */
    function DhHealth({ health }) {
      if (health === null || health === undefined) {
        return h('div', { className: 'dh-sub' }, '没有健康数据（后端还没给 health）')
      }
      if (typeof health !== 'object') return h('div', { className: 'dh-sub' }, String(health))
      const alerts = Array.isArray(health.alerts) ? health.alerts : []
      const lastRunAt = health.lastRunAt || health.last_run_at || health.lastCheckAt || ''
      const rest = Object.keys(health).filter((k) => k !== 'alerts' && k !== 'lastRunAt' && k !== 'last_run_at' && k !== 'lastCheckAt')
        .filter((k) => { const v = health[k]; return v === null || typeof v !== 'object' })
      return h('div', { 'data-dh-stack': '' },
        lastRunAt
          ? h('div', { className: 'dh-kv' },
            h('span', { className: 'dh-k' }, '上次跑'),
            h('span', { className: 'dh-v' }, dhRel(lastRunAt) + '（' + dhTime(lastRunAt) + '）'))
          : null,
        alerts.length
          ? h('div', { 'data-dh-stack': '' },
            alerts.map((a, i) => h('div', { key: 'ha' + i, className: 'dh-msg', 'data-dh-tone': 'warn' },
              '⚠️ ' + (typeof a === 'string' ? a : dhText(a && (a.text || a.message || a.hint), JSON.stringify(a))))))
          : h('div', { className: 'dh-msg', 'data-dh-tone': 'good' }, '没有告警'),
        rest.slice(0, 8).map((k) => h('div', { key: 'hk' + k, className: 'dh-kv' },
          h('span', { className: 'dh-k' }, k),
          h('span', { className: 'dh-v' }, dhHealthVal(health[k])))),
        !lastRunAt && !alerts.length && !rest.length
          ? h('div', { className: 'dh-sub' }, 'health 是空的（后端还没跑过）')
          : null)
    }

    /* ── 档案卡：每个人一张，改完点自己那张的「保存」 ── */
    function DhProfileCard({ p, reload, say }) {
      const src = p || {}
      const [stage, setStage] = React.useState(src.stage || '生')
      const [call, setCall] = React.useState(src.call || '')
      const [impression, setImpression] = React.useState(src.impression || '')
      const [topic, setTopic] = React.useState(src.lastTopic || src.last_topic || '')
      const [busy, setBusy] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const dirty = React.useRef(false)

      // snapshot 每 10 秒刷新：没动过的字段跟着后端走，动过的不覆盖
      React.useEffect(() => {
        if (dirty.current) return
        setStage(src.stage || '生')
        setCall(src.call || '')
        setImpression(src.impression || '')
        setTopic(src.lastTopic || src.last_topic || '')
      }, [src.stage, src.call, src.impression, src.lastTopic, src.last_topic])

      const touch = (fn) => (e) => { dirty.current = true; fn(e.target.value) }

      const save = async () => {
        if (busy) return
        if (!src.sec_uid) { setMsg('这个人没有 sec_uid，存不了'); return }
        setBusy('save')
        try {
          const r = await homePost('/profile', {
            sec_uid: src.sec_uid,
            patch: { stage, call, impression, lastTopic: topic },
          })
          if (r && r.ok === false) throw new Error(r.error || r.hint || '保存被拒绝')
          dirty.current = false
          setMsg('已保存')
          say('已保存「' + (src.nick || call || '这个人') + '」的档案', 'good')
          await reload()
        } catch (e) {
          const t = homeErrText(e)
          setMsg('保存失败：' + t)
          say('保存失败：' + t, 'warn')
        } finally { setBusy('') }
      }

      const meta = [
        src.rounds !== undefined && src.rounds !== null ? '聊过 ' + dhNum(src.rounds) + ' 轮' : '',
        src.lastSeenAt || src.last_seen_at ? '上次 ' + dhRel(src.lastSeenAt || src.last_seen_at) : '',
      ].filter(Boolean).join(' · ')

      return h('div', { className: 'dh-card', 'data-dh-profile': '' },
        h('div', { className: 'dh-row' },
          h('div', { className: 'dh-grow', 'data-dh-stack': '' },
            h('div', { className: 'dh-item-title' }, src.nick || src.call || '（没名字）'),
            h('div', { className: 'dh-sub' }, meta || '还没有聊天记录')),
          h('button', { className: 'dh-mini', disabled: Boolean(busy), onClick: save },
            busy === 'save' ? '保存中…' : '保存')),
        h('div', { className: 'dh-field' },
          h('span', { className: 'dh-label' }, '称呼（她怎么叫他）'),
          h('input', { className: 'dh-input', value: call, placeholder: '比如：主人 / 老板', onChange: touch(setCall) })),
        h('div', { className: 'dh-field' },
          h('span', { className: 'dh-label' }, '关系（stage）'),
          h('select', { className: 'dh-input dh-select', value: stage, onChange: touch(setStage) },
            HOME_STAGES.map((x) => h('option', { key: x, value: x }, x)))),
        h('div', { className: 'dh-field' },
          h('span', { className: 'dh-label' }, '她记住的印象'),
          h('textarea', {
            className: 'dh-input dh-textarea', rows: 3, value: impression,
            placeholder: '这个人大概什么样、在意什么', onChange: touch(setImpression),
          })),
        h('div', { className: 'dh-field' },
          h('span', { className: 'dh-label' }, '上次聊到'),
          h('input', { className: 'dh-input', value: topic, placeholder: '下次可以接的话头', onChange: touch(setTopic) })),
        msg ? h('div', { className: 'dh-msg', 'data-dh-tone': msg.indexOf('失败') === 0 ? 'warn' : 'good' }, msg) : null)
    }

    /* ── Tab 1：概览（snapshot + duty status；四盏灯 + 叫她现在刷一轮 + 她的节奏） ── */
    function DhOverviewTab({ snap, snapErr, reload, duty, reloadDuty, acctData, reloadAcct, active, say }) {
      const s = snap || {}
      const life = s.life || {}
      const diary = s.diary || {}
      const journal = s.journal || {}
      const archive = s.archive || {}
      const reach = s.reach || {}
      const room = s.room || {}
      const persona = s.persona || {}
      const profiles = Array.isArray(s.profiles) ? s.profiles : []
      const groups = Array.isArray(s.groups) ? s.groups : []
      const diaryDates = Array.isArray(diary.dates) ? diary.dates : []
      const roomFiles = Array.isArray(room.files) ? room.files
        : (room.files && typeof room.files === 'object' ? Object.keys(room.files) : [])
      /* ⭐ 后端真实契约：journal.latest 是**最近 10 条数组**（{at,text}），取最后一条当「最近一条」 */
      const latestRows = dhRows(journal.latest)
      const latest = latestRows.length ? dhLine(latestRows[latestRows.length - 1]) : null

      /* 「叫她现在刷一轮」的 60 秒冷却（hook 必须在任何 return 之前） */
      const [runCool, setRunCool] = React.useState(0)
      const [runMsg, setRunMsg] = React.useState('')
      const [runTone, setRunTone] = React.useState('')
      const [, setRunTick] = React.useState(0)
      React.useEffect(() => {
        if (!runCool) return undefined
        const t = setInterval(() => setRunTick((x) => x + 1), 1000)
        return () => clearInterval(t)
      }, [runCool])

      /* ⭐ 「她的世界」开关（2026-10-27）：snapshot.world 是主数据，/world 补 startedAt/uptime；
       *    后端接口没上线时（404）也要优雅降级 —— 卡片显示「还读不到世界状态」、按钮禁用，不白屏。 */
      const [worldInfo, setWorldInfo] = React.useState(null)
      const [worldErr, setWorldErr] = React.useState('')
      const [worldBusy, setWorldBusy] = React.useState('')
      const [worldConfirm, setWorldConfirm] = React.useState(false)
      const [worldMsg, setWorldMsg] = React.useState(null)
      const worldInited = React.useRef(false)
      const loadWorld = async () => {
        try {
          const r = await homeGet('/world')
          if (!r || r.ok === false) throw new Error((r && (r.error || r.hint)) || '返回不完整')
          setWorldInfo(r); setWorldErr('')
        } catch (e) { setWorldErr(homeErrText(e)) }
      }
      React.useEffect(() => {
        if (!active || worldInited.current) return
        worldInited.current = true
        loadWorld()
      }, [active])

      /* ⭐ 三块「真数据」卡（2026-10-27 最后一轮）：故障 / 今日花费 / 压缩记录。
       *    各管各的降级：接口 404 只在自己卡里说「还读不到…」，不白屏。 */
      const [faults, setFaults] = React.useState(null)
      const [faultsErr, setFaultsErr] = React.useState('')
      const [faultsBusy, setFaultsBusy] = React.useState(false)
      const [cost, setCost] = React.useState(null)
      const [costErr, setCostErr] = React.useState('')
      const [compactions, setCompactions] = React.useState(null)
      const [compactionsErr, setCompactionsErr] = React.useState('')
      const extrasInited = React.useRef(false)
      const loadFaults = async () => {
        setFaultsBusy(true)
        try {
          const r = await homeGet('/faults')
          if (!r || r.ok === false) throw new Error((r && (r.error || r.hint)) || '返回不完整')
          setFaults(r); setFaultsErr('')
        } catch (e) { setFaultsErr(homeErrText(e)) }
        finally { setFaultsBusy(false) }
      }
      const loadCost = async () => {
        try {
          const r = await homeGet('/cost?day=' + encodeURIComponent(dhToday()))
          if (!r || r.ok === false) throw new Error((r && (r.error || r.hint)) || '返回不完整')
          setCost(r); setCostErr('')
        } catch (e) { setCostErr(homeErrText(e)) }
      }
      const loadCompactions = async () => {
        try {
          const r = await homeGet('/compactions?limit=20')
          if (!r || r.ok === false) throw new Error((r && (r.error || r.hint)) || '返回不完整')
          setCompactions(r); setCompactionsErr('')
        } catch (e) { setCompactionsErr(homeErrText(e)) }
      }
      React.useEffect(() => {
        if (!active || extrasInited.current) return
        extrasInited.current = true
        loadFaults(); loadCost(); loadCompactions()
      }, [active])

      /* ⭐ fish.22：她会自己点赞（概览卡：开关 + 每天/每轮上限 + 今天已赞；第一次激活拉一次） */
      const [likesInfo, setLikesInfo] = React.useState(null)
      const [likesErr, setLikesErr] = React.useState('')
      const [likesForm, setLikesForm] = React.useState(null)
      const [likesBusy, setLikesBusy] = React.useState('')
      const [likesMsg, setLikesMsg] = React.useState(null)
      const likesInited = React.useRef(false)
      const loadLikes = async () => {
        try {
          const r = await homeGet('/likes')
          if (!r || r.ok === false) throw new Error((r && (r.error || r.hint)) || '返回不完整')
          const lk = (r && r.likes) || {}
          const enabled = lk.enabled === true
          const perDay = Number(lk.perDay) || 10
          const perRun = Number(lk.perRun) || 5
          setLikesInfo({ likes: { enabled, perDay, perRun }, today: Number(r.today) || 0 })
          setLikesForm({ enabled, perDay: String(perDay), perRun: String(perRun) })
          setLikesErr('')
        } catch (e) { setLikesErr(homeErrText(e)) }
      }
      React.useEffect(() => {
        if (!active || likesInited.current) return
        likesInited.current = true
        loadLikes()
        loadTaste()
      }, [active])
      const likeNum = (v, min, max, d) => Math.max(min, Math.min(max, Math.round(Number(v) || d)))
      const saveLikes = async (override) => {
        const base = likesForm || { enabled: false, perDay: '10', perRun: '5' }
        const next = Object.assign({}, base, override || {})
        const body = {
          enabled: next.enabled === true,
          perDay: likeNum(next.perDay, 1, 50, 10),
          perRun: likeNum(next.perRun, 1, 20, 5),
        }
        setLikesBusy('save'); setLikesMsg(null)
        try {
          const r = await homePost('/likes', body)
          if (!r || r.ok === false) throw new Error((r && (r.error || r.hint)) || '被拒绝')
          const lk = (r && r.likes) || body
          const enabled = lk.enabled === true
          const perDay = Number(lk.perDay) || body.perDay
          const perRun = Number(lk.perRun) || body.perRun
          setLikesInfo((prev) => ({
            likes: { enabled, perDay, perRun },
            today: r && r.today !== undefined ? Number(r.today) || 0 : (prev && prev.today) || 0,
          }))
          setLikesForm({ enabled, perDay: String(perDay), perRun: String(perRun) })
          setLikesMsg({ text: '已保存：点赞 ' + (enabled ? '开' : '关'), tone: 'good' })
          if (typeof say === 'function') say('已保存：点赞 ' + (enabled ? '开' : '关'), 'good')
        } catch (e) {
          setLikesMsg({ text: '保存失败：' + homeErrText(e), tone: 'warn' })
          if (typeof say === 'function') say('点赞设置保存失败：' + homeErrText(e), 'warn')
          if (override && override.__rollback) setLikesForm(base)
        } finally { setLikesBusy('') }
      }
      const toggleLikes = (v) => {
        const base = likesForm || {}
        setLikesForm(Object.assign({}, base, { enabled: v }))
        saveLikes(Object.assign({}, base, { enabled: v, __rollback: true }))
      }

      /* ⭐ fish.23：她的口味清单（home/taste.md）——面板可看/可改，下一轮值班现读生效 */
      const [tasteText, setTasteText] = React.useState('')
      const [tasteErr, setTasteErr] = React.useState('')
      const [tasteEditing, setTasteEditing] = React.useState(false)
      const [tasteDraft, setTasteDraft] = React.useState('')
      const [tasteBusy, setTasteBusy] = React.useState('')
      const [tasteMsg, setTasteMsg] = React.useState(null)
      const loadTaste = async () => {
        try {
          const r = await homeGet('/taste')
          if (!r || r.ok === false) throw new Error((r && (r.error || r.hint)) || '返回不完整')
          setTasteText(String(r.text || ''))
          setTasteErr('')
        } catch (e) { setTasteErr(homeErrText(e)) }
      }
      const startTasteEdit = () => { setTasteDraft(tasteText); setTasteEditing(true); setTasteMsg(null) }
      const cancelTaste = () => { setTasteEditing(false); setTasteDraft(''); setTasteMsg(null) }
      const saveTaste = async () => {
        const text = String(tasteDraft || '')
        setTasteBusy('save'); setTasteMsg(null)
        try {
          const r = await homePost('/taste', { text })
          if (!r || r.ok === false) throw new Error((r && (r.error || r.hint)) || '被拒绝')
          setTasteText(text)
          setTasteEditing(false)
          const empty = !text.trim()
          setTasteMsg({
            text: empty ? '已保存（下一轮生效）——现在是空的，她点赞就没有判据了' : '已保存（下一轮生效）',
            tone: empty ? 'warn' : 'good',
          })
          if (typeof say === 'function') say(empty ? '口味清单已保存（现在是空的）' : '口味清单已保存，下一轮生效', empty ? 'warn' : 'good')
        } catch (e) {
          setTasteMsg({ text: '保存失败：' + homeErrText(e), tone: 'warn' })
          if (typeof say === 'function') say('口味清单保存失败：' + homeErrText(e), 'warn')
        } finally { setTasteBusy('') }
      }

      if (snap === null) {
        return h('div', { className: 'dh-card' },
          h('div', { className: 'dh-title' }, '正在读她的家…'),
          snapErr
            ? h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '读取失败：' + snapErr)
            : h('div', { className: 'dh-sub' }, '第一次打开会慢一点；拉不到就等 10 秒自动重试。'),
          h('div', { className: 'dh-row' },
            h('button', { className: 'dh-mini', onClick: reload }, '立刻重试')))
      }

      const runLeft = runCool > 0 ? Math.max(0, Math.ceil((runCool - Date.now()) / 1000)) : 0
      const runBusy = runLeft > 0
      const onRun = async () => {
        if (runBusy) return
        try {
          const r = await jpost('/run', {})
          if (r && r.ok) {
            setRunMsg(r.message || '已经开跑了，跑完会弹通知')
            setRunTone('good')
            setRunCool(Date.now() + 60_000)
            if (typeof say === 'function') say('已经开跑了', 'good')
          } else {
            const why = (r && (r.error || r.message || r.hint)) || '没跑起来'
            setRunMsg('没跑起来：' + why)
            setRunTone('warn')
            if (typeof say === 'function') say('没跑起来：' + why, 'warn')
          }
        } catch (e) {
          const t = String((e && e.message) || e)
          setRunMsg('跑失败：' + t)
          setRunTone('warn')
          if (typeof say === 'function') say('跑失败：' + t, 'warn')
        } finally {
          if (typeof reloadDuty === 'function') reloadDuty()
          if (typeof reloadAcct === 'function') reloadAcct()
        }
      }
      const d = duty || {}
      const acct = acctData || null
      const acctAcc = (acct && acct.account) || null
      const acctBrowser = (acct && acct.browser) || null
      const acctHealth = (acct && acct.health) || null
      const lightTone = (ok) => ok === true ? 'good' : ok === false ? 'warn' : undefined
      /* 登录灯：/account 优先（有昵称 + 在线状态），/account 失败才退回 duty */
      const loginLight = (() => {
        if (acct && acct.logged_in === true) {
          const nick = (acctAcc && acctAcc.nick) || '已登录'
          const aliveOk = !(acctAcc && acctAcc.alive === false)
          return [nick, aliveOk ? 'good' : 'warn',
            aliveOk ? '登录：' + nick : '登录：' + nick + ' —— 在线状态掉了，去抖音网页确认下']
        }
        if (acct && acct.logged_in === false) return ['未登录', 'warn', '登录：未登录']
        if (duty) return [d.loggedIn === true ? '已登录' : '未登录', d.loggedIn === true ? 'good' : 'warn', '旧状态（/account 不可用）']
        return ['读取中', undefined, '']
      })()
      /* 无头 Chrome 灯：/account.browser 现在有真值（之前只能写"未知"） */
      const chromeLight = (() => {
        const b = acctBrowser
        if (b && typeof b.alive === 'boolean') {
          const port = b.cdpPort ? '(' + b.cdpPort + ')' : ''
          return b.alive
            ? ['在跑' + port, 'good', '无头 Chrome 在跑' + (b.cdpPort ? '，CDP 端口 ' + b.cdpPort : '')]
            : ['没起（下次需要时才起）', undefined, '无头 Chrome 没起 —— 不影响她闲着，需要的时候插件会自己起']
        }
        return ['未知', undefined, '后端 /account 没给浏览器状态（旧版）']
      })()
      /* 环境灯：/account.health.venvReady 优先，失败退回 duty */
      const venvVal = (acctHealth && typeof acctHealth.venvReady === 'boolean') ? acctHealth.venvReady
        : (duty && typeof duty.venvReady === 'boolean' ? duty.venvReady : null)
      /* 今日额度仍用 duty（/account 契约里没有） */
      const quotaVal = !duty ? null
        : (Number(d.perDay) > 0 ? Number(d.pickedToday || 0) < Number(d.perDay) : null)
      const lights = [
        ['登录', loginLight[0], loginLight[1], loginLight[2]],
        ['无头 Chrome', chromeLight[0], chromeLight[1], chromeLight[2]],
        ['环境', venvVal === null ? '读取中' : (venvVal ? '就绪' : '未装'), lightTone(venvVal), '运行环境（venv）'],
        ['今日额度', !duty ? '读取中' : (dhNum(d.pickedToday, '0') + ' / ' + dhNum(d.perDay, '0')), quotaVal, '今天已挑 / 每天上限'],
      ]
      const canWork = loginLight[1] === 'good' && venvVal === true

      /* ── 「她的世界」状态推导：snapshot.world 优先（10 秒自动刷新），/world 补时长 ── */
      const snapWorld = (s && s.world) || null
      const wInfo = worldInfo || null
      const worldEnabled = (snapWorld && typeof snapWorld.enabled === 'boolean') ? snapWorld.enabled
        : (wInfo && typeof wInfo.enabled === 'boolean' ? wInfo.enabled : null)
      const worldStartedAt = (snapWorld && snapWorld.startedAt) || (wInfo && wInfo.startedAt) || ''
      const worldStoppedAt = (snapWorld && snapWorld.stoppedAt) || (wInfo && wInfo.stoppedAt) || ''
      const worldUptimeSec = (() => {
        if (worldEnabled !== true) return 0
        const startedMs = dhMs(worldStartedAt)
        if (startedMs !== null) return Math.max(0, Math.round((Date.now() - startedMs) / 1000))
        if (wInfo && Number.isFinite(Number(wInfo.uptimeSec))) return Number(wInfo.uptimeSec)
        return 0
      })()
      const worldKnown = worldEnabled !== null
      const worldStateText = (snap === null && !worldInfo)
        ? '读取中'
        : !worldKnown ? '还读不到世界状态'
          : worldEnabled
            ? '已启动 · 运行 ' + dhDur(worldUptimeSec)
            : ('已暂停' + (worldStoppedAt ? ' · ' + dhClock(worldStoppedAt) + ' 停下' : ''))
      const toggleWorld = async (next) => {
        if (worldBusy) return
        setWorldBusy('toggle'); setWorldConfirm(false); setWorldMsg(null)
        try {
          // 兼容两种后端写法：{enabled} 或 {action}（后端会忽略未知字段）
          const r = await homePost('/world', { enabled: next, action: next ? 'start' : 'stop' })
          if (r && r.ok === false) throw new Error(r.error || r.hint || '被拒绝')
          setWorldInfo((prev) => Object.assign(
            {}, prev || {}, { ok: true, enabled: next },
            (r && typeof r.enabled === 'boolean') ? { enabled: r.enabled } : {},
            (r && r.startedAt) ? { startedAt: r.startedAt } : {},
            (r && r.stoppedAt) ? { stoppedAt: r.stoppedAt } : {},
          ))
          setWorldMsg({ text: next ? '已开始' : '已暂停', tone: 'good' })
          if (typeof say === 'function') say(next ? '她的世界已开始' : '她的世界已暂停', 'good')
          if (typeof reload === 'function') await reload()
          loadWorld()
        } catch (e) {
          const t = homeErrText(e)
          setWorldMsg({ text: '切换失败：' + t, tone: 'warn' })
          if (typeof say === 'function') say('切换失败：' + t, 'warn')
        } finally { setWorldBusy('') }
      }

      /* ── 故障 / 花费 / 压缩：渲染前的兜底取值 ── */
      const faultRows = Array.isArray(faults && faults.faults) ? faults.faults.filter(Boolean) : []
      const faultCheckedAt = (faults && faults.checkedAt) || ''
      const costAvailable = cost ? cost.available !== false : null
      const compactionRows = Array.isArray(compactions && compactions.rows) ? compactions.rows.filter(Boolean) : []

      return h('div', { 'data-dh-stack': '' },
        /* 她的世界（第一张卡）：这个开关管她的作息，不管插件安装 */
        h('div', { className: 'dh-card', 'data-dh-overview-world': '' },
          h('div', { className: 'dh-row' },
            h('div', { className: 'dh-grow', 'data-dh-stack': '' },
              h('div', { className: 'dh-card-title' }, '她的世界'),
              h('div', { className: 'dh-sub' }, worldStateText)),
            h('span', {
              className: 'dh-badge',
              'data-dh-tone': worldEnabled === true ? 'good' : (worldEnabled === false ? 'warn' : undefined),
            }, worldEnabled === true ? '运行中' : (worldEnabled === false ? '已暂停' : '未知'))),
          worldKnown
            ? (worldEnabled
              ? (worldConfirm
                ? h('div', { 'data-dh-stack': '' },
                  h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' },
                    '暂停后她不会醒来、不回私信、不刷视频；消息仍会记录，恢复后她能看到。确定暂停？'),
                  h('div', { className: 'dh-row' },
                    h('button', {
                      className: 'dh-btn', 'data-dh-danger': '', disabled: Boolean(worldBusy),
                      onClick: () => toggleWorld(false),
                    }, worldBusy ? '暂停中…' : '确定暂停'),
                    h('button', {
                      className: 'dh-btn', disabled: Boolean(worldBusy),
                      onClick: () => setWorldConfirm(false),
                    }, '取消')))
                : h('div', { className: 'dh-row' },
                  h('button', {
                    className: 'dh-btn', 'data-dh-danger': '', disabled: Boolean(worldBusy),
                    onClick: () => setWorldConfirm(true),
                  }, '暂停世界')))
              : h('div', { className: 'dh-row' },
                h('button', {
                  className: 'dh-btn', 'data-dh-primary': '', disabled: Boolean(worldBusy),
                  onClick: () => toggleWorld(true),
                }, worldBusy ? '开始中…' : '开始世界')))
            : h('div', { className: 'dh-row' },
              h('button', { className: 'dh-btn', disabled: true },
                (snap === null && !worldInfo) ? '读取中…' : '还读不到世界状态'),
              worldErr ? h('span', { className: 'dh-sub' }, '（' + dhText(worldErr, '接口未就绪') + '）') : null),
          h('div', { className: 'dh-sub' }, '这个开关管的是她的作息，不是插件安装。'),
          worldMsg ? h('div', { className: 'dh-msg', 'data-dh-tone': worldMsg.tone }, worldMsg.text) : null),
        /* ⭐ fish.22：她会自己点赞 —— 开关 + 上限 + 今天已赞（风控时先关着） */
        h('div', { className: 'dh-card', 'data-dh-overview-likes': '' },
          h('div', { className: 'dh-row' },
            h('div', { className: 'dh-grow', 'data-dh-stack': '' },
              h('div', { className: 'dh-card-title' }, '她会自己点赞'),
              h('div', { className: 'dh-sub' },
                likesInfo
                  ? (likesInfo.likes.enabled ? '开着：遇到对味的、主人会喜欢的，她会自己双击点赞。' : '关着：不会自己点赞（风控稳一点再开）。')
                  : (likesErr ? '读取失败：' + likesErr : '读取中…'))),
            h('span', {
              className: 'dh-badge',
              'data-dh-tone': likesInfo ? (likesInfo.likes.enabled ? 'good' : 'warn') : undefined,
            }, likesInfo ? (likesInfo.likes.enabled ? '开着' : '关着') : '未知')),
          likesInfo
            ? h('label', { className: 'dh-check' },
              h('input', {
                type: 'checkbox', checked: (likesForm && likesForm.enabled) === true,
                disabled: Boolean(likesBusy),
                onChange: (e) => toggleLikes(e.target.checked),
              }),
              h('span', null, '点赞（她会自己双击点赞 / 取消点赞）'))
            : h('div', { className: 'dh-row' },
              h('button', {
                className: 'dh-mini', disabled: !likesErr,
                onClick: loadLikes,
              }, likesErr ? '重试' : '读取中…')),
          likesInfo
            ? h('div', { className: 'dh-row' },
              h('span', { className: 'dh-label' }, '每天上限'),
              h('input', {
                className: 'dh-input dh-num', type: 'number', min: 1, max: 50,
                value: (likesForm && likesForm.perDay) || '10',
                disabled: Boolean(likesBusy),
                onChange: (e) => setLikesForm((prev) => Object.assign({}, prev || {}, { perDay: e.target.value })),
              }),
              h('span', { className: 'dh-label' }, '每轮上限'),
              h('input', {
                className: 'dh-input dh-num', type: 'number', min: 1, max: 20,
                value: (likesForm && likesForm.perRun) || '5',
                disabled: Boolean(likesBusy),
                onChange: (e) => setLikesForm((prev) => Object.assign({}, prev || {}, { perRun: e.target.value })),
              }),
              h('div', { className: 'dh-grow' }),
              h('button', {
                className: 'dh-btn', disabled: Boolean(likesBusy),
                onClick: () => saveLikes(),
              }, likesBusy ? '保存中…' : '保存'))
            : null,
          likesInfo ? h('div', { className: 'dh-sub' }, '今天已赞 ' + dhNum(likesInfo.today, '0') + ' 条') : null,
          h('div', { className: 'dh-sub' },
            '账号被风控时点赞会被平台静默拒绝（页面亮红心但刷新消失）——先关着，等风控过去再开。'),
          likesErr ? h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '读取失败：' + likesErr) : null,
          likesMsg ? h('div', { className: 'dh-msg', 'data-dh-tone': likesMsg.tone }, likesMsg.text) : null),
        /* ⭐ fish.23：她感兴趣 / 会点赞的内容（home/taste.md；可看可改，下一轮生效） */
        h('div', { className: 'dh-card', 'data-dh-overview-taste': '' },
          h('div', { className: 'dh-row' },
            h('div', { className: 'dh-grow', 'data-dh-stack': '' },
              h('div', { className: 'dh-card-title' }, '她感兴趣 / 会点赞的内容'),
              h('div', { className: 'dh-sub' }, '她的口味清单（home/taste.md）—— 每轮值班现读；改了下一轮就生效。')),
            h('span', {
              className: 'dh-badge',
              'data-dh-tone': tasteErr ? 'warn' : (tasteText.trim() ? 'good' : undefined),
            }, tasteErr ? '读不到' : (tasteText.trim() ? '有清单' : '空的')),
            !tasteEditing
              ? h('button', { className: 'dh-mini', disabled: Boolean(tasteErr), onClick: startTasteEdit }, '编辑')
              : null),
          tasteErr ? h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '读取失败：' + tasteErr) : null,
          tasteEditing
            ? h('div', { 'data-dh-stack': '' },
              h('textarea', {
                className: 'dh-input',
                style: {
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: '12px', lineHeight: '1.6', height: '260px', resize: 'vertical',
                },
                value: tasteDraft,
                onChange: (e) => setTasteDraft(e.target.value),
              }),
              h('div', { className: 'dh-row' },
                h('span', { className: 'dh-sub' }, tasteDraft.length + ' 字 / 上限 20000'),
                h('div', { className: 'dh-grow' }),
                h('button', { className: 'dh-btn', disabled: Boolean(tasteBusy), onClick: saveTaste },
                  tasteBusy ? '保存中…' : '保存'),
                h('button', { className: 'dh-btn', disabled: Boolean(tasteBusy), onClick: cancelTaste }, '取消')))
            : h('pre', {
              style: {
                margin: 0, maxHeight: '220px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                fontSize: '12px', lineHeight: '1.6', opacity: 0.9,
              },
            }, tasteText || '（还没有内容 —— 点「编辑」写她会对什么内容心动/点赞）'),
          tasteMsg ? h('div', { className: 'dh-msg', 'data-dh-tone': tasteMsg.tone }, tasteMsg.text) : null),
        /* 现在：四盏灯 + 叫她现在刷一轮 */
        h('div', { className: 'dh-card', 'data-dh-overview-live': '' },
          h('div', { className: 'dh-row' },
            h('div', { className: 'dh-grow', 'data-dh-stack': '' },
              h('div', { className: 'dh-card-title' }, '现在'),
              h('div', { className: 'dh-sub' }, '四盏灯 = 她能不能干活。灯不对就去「连接」里修。')),
            h('span', {
              className: 'dh-badge',
              'data-dh-tone': canWork ? 'good' : 'warn',
            }, canWork ? '能干活' : '先看灯')),
          h('div', { className: 'dh-row' },
            lights.map((x, i) => h('span', {
              key: 'lt' + i, className: 'dh-badge', 'data-dh-tone': x[2], title: x[3] || undefined,
            }, x[0] + '：' + x[1]))),
          h('div', { className: 'dh-row' },
            h('button', { className: 'dh-btn', 'data-dh-primary': '', disabled: runBusy, onClick: onRun },
              runBusy ? '冷却中 ' + runLeft + 's' : '叫她现在刷一轮'),
            h('span', { className: 'dh-sub' }, '跑完会弹通知，报告进「今天」。'),
            h('div', { className: 'dh-grow' }),
            h('button', {
              className: 'dh-mini',
              onClick: () => {
                if (typeof reloadDuty === 'function') reloadDuty()
                if (typeof reloadAcct === 'function') reloadAcct()
              },
            }, '刷新灯')),
          runMsg ? h('div', { className: 'dh-msg', 'data-dh-tone': runTone }, runMsg) : null),
        /* 她哪里坏了（故障清单，放四盏灯下面） */
        h('div', { className: 'dh-card', 'data-dh-overview-faults': '' },
          h('div', { className: 'dh-row' },
            h('div', { className: 'dh-grow', 'data-dh-stack': '' },
              h('div', { className: 'dh-card-title' }, '她哪里坏了'),
              h('div', { className: 'dh-sub' }, '登录 / 浏览器 / 运行环境这些硬故障，自动体检出来的。')),
            h('button', { className: 'dh-mini', disabled: faultsBusy, onClick: loadFaults },
              faultsBusy ? '检查中…' : (faultRows.length ? '重试' : '刷新'))),
          faultsErr
            ? h('div', { className: 'dh-sub' }, '还读不到故障状态（' + faultsErr + '）')
            : (faults === null
              ? h('div', { className: 'dh-sub' }, '检查中…')
              : (faultRows.length
                ? h('div', { 'data-dh-stack': '' }, faultRows.map((f0, i) => {
                  const f = f0 || {}
                  return h('div', { key: 'ft' + i, 'data-dh-fault': '' },
                    h('span', { className: 'dh-dot', 'data-dh-bad': '' }),
                    h('span', { style: { flex: '1', minWidth: '0' } }, dhFaultText(f)),
                    h('span', { className: 'dh-item-time', style: { flex: 'none', marginRight: '0' } },
                      f.at ? dhRel(f.at) : ''))
                }))
                : h('div', { 'data-dh-ok': '' },
                  '● 一切正常' + (faultCheckedAt ? '（检查于 ' + dhClock(faultCheckedAt) + '）' : ''))))),
        /* 今日花费 */
        h('div', { className: 'dh-card', 'data-dh-overview-cost': '' },
          h('div', { className: 'dh-row' },
            h('div', { className: 'dh-grow', 'data-dh-stack': '' },
              h('div', { className: 'dh-card-title' }, '今日花费'),
              h('div', { className: 'dh-sub' }, '只算她的会话，不算你在这儿的对话。')),
            (cost && costAvailable && dhCostText(cost.estCost, cost.currency)
              ? h('span', { className: 'dh-badge' }, dhCostText(cost.estCost, cost.currency))
              : null)),
          costErr
            ? h('div', { className: 'dh-row' },
              h('div', { className: 'dh-sub', style: { flex: '1' } }, '还读不到今日花费（' + costErr + '）'),
              h('button', { className: 'dh-mini', onClick: loadCost }, '重试'))
            : (cost === null
              ? h('div', { className: 'dh-sub' }, '读取中…')
              : (costAvailable === false
                ? h('div', { className: 'dh-msg' }, 'provider 没上报用量（不代表没花）')
                : h('div', { 'data-dh-stats': '' },
                  h('div', { className: 'dh-stat' },
                    h('div', { className: 'dh-stat-n' }, dhThousands(cost.calls)),
                    h('div', { className: 'dh-stat-l' }, '调用次数')),
                  h('div', { className: 'dh-stat' },
                    h('div', { className: 'dh-stat-n' }, dhThousands(cost.inputTokens)),
                    h('div', { className: 'dh-stat-l' }, '入 token')),
                  h('div', { className: 'dh-stat' },
                    h('div', { className: 'dh-stat-n' }, dhThousands(cost.outputTokens)),
                    h('div', { className: 'dh-stat-l' }, '出 token')))))),
        /* 压缩记录（最近 5 条） */
        h('div', { className: 'dh-card', 'data-dh-overview-compactions': '' },
          h('div', { className: 'dh-card-title' }, '压缩记录'),
          compactionsErr
            ? h('div', { className: 'dh-row' },
              h('div', { className: 'dh-sub', style: { flex: '1' } }, '暂不可用（' + compactionsErr + '）'),
              h('button', { className: 'dh-mini', onClick: loadCompactions }, '重试'))
            : (compactions === null
              ? h('div', { className: 'dh-sub' }, '读取中…')
              : (compactionRows.length
                ? h('div', { 'data-dh-stack': '' }, compactionRows.slice(0, 5).map((c0, i) => {
                  const c = c0 || {}
                  const trigRaw = String(c.trigger || '').toLowerCase()
                  const trig = trigRaw === 'auto' ? '自动压缩' : trigRaw === 'manual' ? '手动压缩' : (c.trigger ? dhText(c.trigger) : '压缩')
                  const bits = []
                  if (c.beforeTokens !== undefined || c.afterTokens !== undefined) {
                    bits.push(dhTokensShort(c.beforeTokens) + ' → ' + dhTokensShort(c.afterTokens) + ' token')
                  }
                  if (c.summaryChars) bits.push('摘要 ' + dhThousands(c.summaryChars) + ' 字')
                  return h('div', { key: 'cp' + i, className: 'dh-item' },
                    h('span', { className: 'dh-item-time' }, c.at ? dhClock(c.at) : '--:--'),
                    trig + (bits.length ? ' · ' + bits.join(' · ') : ''))
                }))
                : h('div', { className: 'dh-sub' }, '还没压缩过。')))),
        /* 此刻 */
        h('div', { className: 'dh-card', 'data-dh-overview-now': '' },
          h('div', { className: 'dh-card-title' }, '此刻'),
          h('div', { className: 'dh-kv' }, h('span', { className: 'dh-k' }, '待办'), h('span', { className: 'dh-v' }, dhPlanText(life.plan))),
          h('div', { className: 'dh-kv' }, h('span', { className: 'dh-k' }, '上次活动'), h('span', { className: 'dh-v' }, life.lastActivityAt ? dhRel(life.lastActivityAt) + '（' + dhTime(life.lastActivityAt) + '）' : '—')),
          h('div', { className: 'dh-kv' }, h('span', { className: 'dh-k' }, '空闲'), h('span', { className: 'dh-v' }, life.idleHours !== undefined && life.idleHours !== null ? dhNum(life.idleHours) + ' 小时' : '—')),
          h('div', { className: 'dh-kv' }, h('span', { className: 'dh-k' }, '上次叫醒'), h('span', { className: 'dh-v' }, life.lastFire ? dhRel(life.lastFire) : '—')),
          latest ? h('div', { className: 'dh-kv' }, h('span', { className: 'dh-k' }, '最近一条'), h('span', { className: 'dh-v' }, (latest.at ? latest.at + ' ' : '') + latest.text))
            : h('div', { className: 'dh-sub' }, '台账里还没有她的活动记录。')),
        /* 今天 */
        h('div', { className: 'dh-card', 'data-dh-overview-today': '' },
          h('div', { className: 'dh-card-title' }, '今天'),
          h('div', { className: 'dh-kv' },
            h('span', { className: 'dh-k' }, '日记'),
            h('span', { className: 'dh-v' },
              diary.todayChars
                ? '写了 ' + dhNum(diary.todayChars) + ' 字'
                : (diaryDates.indexOf(diary.todayDate || '') >= 0 ? '今天已经有一篇了' : '今天还没写'))),
          h('div', { className: 'dh-kv' }, h('span', { className: 'dh-k' }, '日记总数'), h('span', { className: 'dh-v' }, dhNum(diaryDates.length, '0') + ' 天')),
          h('div', { className: 'dh-kv' }, h('span', { className: 'dh-k' }, '归档'), h('span', { className: 'dh-v' }, '今天 ' + dhNum(archive.todayCount, '0') + ' 条 · 共 ' + dhNum(archive.days, '0') + ' 天')),
          h('div', { className: 'dh-kv' }, h('span', { className: 'dh-k' }, '台账'), h('span', { className: 'dh-v' }, dhNum(journal.count, '0') + ' 条')),
          h('div', { className: 'dh-kv' }, h('span', { className: 'dh-k' }, '主动开口'), h('span', { className: 'dh-v' }, dhNum(reach.count, '0') + ' / ' + dhNum(reach.limit, '3') + (reach.day ? '（' + reach.day + '）' : '')))),
        /* 她的节奏（原「节奏」tab 整块并进概览：待办 / 设置待办 / 主动开口 / 09:00 兜底） */
        h(DhRhythmTab, { snap, say, reload }),
        /* 健康 */
        h('div', { className: 'dh-card', 'data-dh-overview-health': '' },
          h('div', { className: 'dh-card-title' }, '健康'),
          h(DhHealth, { health: s.health })),
        /* 版本 */
        h('div', { className: 'dh-card', 'data-dh-overview-version': '' },
          h('div', { className: 'dh-card-title' }, '版本与来源'),
          h('div', { className: 'dh-kv' }, h('span', { className: 'dh-k' }, '版本'), h('span', { className: 'dh-v' }, dhText(s.version))),
          h('div', { className: 'dh-kv' }, h('span', { className: 'dh-k' }, '快照时间'), h('span', { className: 'dh-v' }, s.now ? dhTime(s.now) : '—')),
          h('div', { className: 'dh-kv' }, h('span', { className: 'dh-k' }, '人设来源'), h('span', { className: 'dh-v' }, dhText(persona.source))),
          h('div', { className: 'dh-kv' }, h('span', { className: 'dh-k' }, '记忆'), h('span', { className: 'dh-v' }, '人物 ' + profiles.length + ' · 群 ' + groups.length + ' · 房间文件 ' + roomFiles.length)),
          h('div', { className: 'dh-sub' }, '面板 b' + PANEL_BUILD + '（改完 client.js 会对上这个数）'))
      )
    }

    /* ── Tab 2：人设（六层 textarea + 实时预览 + 保存） ── */
    function DhPersonaTab({ snap, active, say, reload }) {
      const s = snap || {}
      const persona = s.persona || {}
      const serverLayers = persona.layers && typeof persona.layers === 'object' ? persona.layers : {}
      const [layers, setLayers] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const dirty = React.useRef(false)

      React.useEffect(() => {
        if (dirty.current) return
        setLayers(homeLayerDraft(serverLayers))
      }, [snap])

      const cur = layers || homeLayerDraft(serverLayers)
      const upd = (key) => (e) => {
        dirty.current = true
        const v = e.target.value
        setLayers((prev) => {
          const next = Object.assign({}, prev || homeLayerDraft(serverLayers))
          next[key] = v
          return next
        })
      }
      const reset = () => {
        dirty.current = false
        setLayers(homeLayerDraft(serverLayers))
        setErr('')
      }
      const save = async () => {
        if (busy) return
        setBusy('save'); setErr('')
        try {
          const r = await homePost('/persona', { layers: Object.assign({}, serverLayers, cur) })
          if (r && r.ok === false) throw new Error(r.error || r.hint || '保存被拒绝')
          dirty.current = false
          say('人设已保存（她下一轮醒来就用新的）', 'good')
          await reload()
        } catch (e) {
          const t = homeErrText(e)
          setErr('保存失败：' + t)
          say('保存失败：' + t, 'warn')
        } finally { setBusy('') }
      }

      /* 后端实际给的 source 有三种：home/persona.md（她写的）/ $DOUYIN_HOME/persona.md（旧的后备）/ default */
      const source = persona.source || ''
      const sourceIsHome = source === 'home/persona.md' || source === 'home'
      const sourceLabel = sourceIsHome ? '来源：home/persona.md（她自己写的）'
        : source === '$DOUYIN_HOME/persona.md' ? '来源：旧的 persona.md（后备）'
        : source === 'default' ? '来源：内置默认（还没写人设）'
        : '来源：' + dhText(source, '未知') + '（后备那份）'
      const rendered = typeof persona.rendered === 'string' ? persona.rendered : ''

      return h('div', { 'data-dh-stack': '' },
        h('div', { className: 'dh-card', 'data-dh-persona-edit': '' },
          h('div', { className: 'dh-row' },
            h('div', { className: 'dh-grow', 'data-dh-stack': '' },
              h('div', { className: 'dh-card-title' }, '她的人设（六层）'),
              h('div', { className: 'dh-sub' }, '这些是「她是谁」。改完点保存，她下一轮醒来生效。')),
            h('span', {
              className: 'dh-badge',
              'data-dh-tone': sourceIsHome ? 'good' : 'warn',
              title: '人设来源',
            }, sourceLabel)),
          HOME_LAYERS.map((f) => h('div', { key: f[0], className: 'dh-field' },
            h('span', { className: 'dh-label' }, f[0] + ' —— ' + f[1]),
            h('textarea', {
              className: 'dh-input dh-textarea',
              rows: f[0] === '补充' ? 4 : 3,
              value: cur[f[0]] || '',
              placeholder: f[1],
              onChange: upd(f[0]),
            }))),
          err ? h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, err) : null,
          h('div', { className: 'dh-row' },
            h('button', { className: 'dh-btn', 'data-dh-primary': '', disabled: Boolean(busy), onClick: save },
              busy === 'save' ? '保存中…' : '保存人设'),
            h('button', { className: 'dh-btn', disabled: Boolean(busy), onClick: reset }, '还原成后端那份'),
            h('span', { className: 'dh-sub' }, dirty.current ? '有未保存的改动' : '和已保存的一致'))),
        h('div', { className: 'dh-card', 'data-dh-persona-preview': '' },
          h('div', { className: 'dh-card-title' }, '她读到的样子（实时预览）'),
          h('div', { className: 'dh-sub' }, '这是拼好后真正塞进她 system prompt 的那份；只读。' + (rendered ? '（' + rendered.length + ' 字）' : '')),
          rendered
            ? h('pre', { className: 'dh-pre' }, rendered)
            : h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '后端没给 rendered —— 保存一次人设后再看，或者等后端补上。')))
    }

    /* ── Tab 4：世界提示词（独立 tab；排在她的六层人设之前的一层） ──
     *   GET/POST /world-prompt；后端没就绪（404）⇒「暂不可用」，不白屏。 */
    function DhWorldPromptTab({ snap, active, say, reload }) {
      const [wp, setWp] = React.useState(null)          // {ok,text,chars,max}
      const [wpErr, setWpErr] = React.useState('')
      const [wpBusy, setWpBusy] = React.useState('')
      const [wpDraft, setWpDraft] = React.useState('')
      const [wpMsg, setWpMsg] = React.useState(null)
      const inited = React.useRef(false)
      const wpMax = (wp && Number(wp.max)) || 4000
      const wpChars = String(wpDraft || '').length

      const loadWp = async () => {
        try {
          const r = await homeGet('/world-prompt')
          if (!r || r.ok === false) throw new Error((r && (r.error || r.hint)) || '返回不完整')
          setWp(r); setWpErr('')
          setWpDraft(typeof r.text === 'string' ? r.text : '')
        } catch (e) { setWpErr(homeErrText(e)); setWp(null) }
      }
      React.useEffect(() => {
        if (!active || inited.current) return
        inited.current = true
        loadWp()
      }, [active])

      const saveWp = async () => {
        if (wpBusy || wp === null) return
        const text = String(wpDraft || '')
        setWpBusy('save'); setWpMsg(null)
        try {
          const r = await homePost('/world-prompt', { text })
          if (r && r.ok === false) throw new Error(r.error || r.hint || '保存被拒绝')
          setWp((prev) => Object.assign({}, prev || {}, {
            ok: true,
            text,
            chars: (r && r.chars !== undefined) ? r.chars : text.length,
            max: (r && r.max) || wpMax,
          }))
          setWpMsg({ text: '已保存（下次组装生效）', tone: 'good' })
          if (typeof say === 'function') say('世界提示词已保存（下次组装生效）', 'good')
          if (typeof reload === 'function') await reload()
        } catch (e) {
          const t = homeErrText(e)
          setWpMsg({ text: '保存失败：' + t, tone: 'warn' })
          if (typeof say === 'function') say('保存失败：' + t, 'warn')
        } finally { setWpBusy('') }
      }

      return h('div', { 'data-dh-stack': '' },
        h('div', { className: 'dh-msg' }, '这层在她的六层人设之前；她自己也能改这个文件。'),
        h('div', { className: 'dh-card', 'data-dh-world-prompt': '' },
          h('div', { className: 'dh-row' },
            h('div', { className: 'dh-grow', 'data-dh-stack': '' },
              h('div', { className: 'dh-card-title' }, '她自己的世界提示词'),
              h('div', { className: 'dh-sub' }, '她怎么看待这个家、她要做什么、她给自己定的规矩…'
                + (wp ? '（' + dhNum(wp.chars, '0') + ' / ' + dhNum(wpMax, '4000') + ' 字）' : ''))),
            h('span', {
              className: 'dh-badge',
              'data-dh-tone': wp ? 'good' : undefined,
            }, wp ? '已生效' : (wpErr ? '不可用' : '读取中'))),
          wpErr
            ? h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '暂不可用：' + wpErr)
            : (wp === null
              ? h('div', { className: 'dh-sub' }, '读取中…')
              : h('div', { 'data-dh-stack': '' },
                h('textarea', {
                  className: 'dh-input dh-textarea',
                  rows: 8,
                  maxLength: wpMax,
                  value: wpDraft,
                  placeholder: '她自己的世界设定：她怎么看待这个家、她要做什么、她给自己定的规矩…（留空就不注入）',
                  onChange: (e) => setWpDraft(e.target.value),
                }),
                h('div', { className: 'dh-row' },
                  h('span', { className: 'dh-sub' }, wpChars + ' / ' + wpMax + ' 字'),
                  h('div', { className: 'dh-grow' }),
                  h('button', {
                    className: 'dh-btn', 'data-dh-primary': '', disabled: Boolean(wpBusy),
                    onClick: saveWp,
                  }, wpBusy === 'save' ? '保存中…' : '保存世界提示词')),
                wpMsg ? h('div', { className: 'dh-msg', 'data-dh-tone': wpMsg.tone }, wpMsg.text) : null))))
    }

    /* ── Tab 6：主动联系（她的主动开口：开关 / 演练 / 上限 / 免打扰 / 统计） ──
     *   GET/POST /api/douyin-home/reach（POST 走 homePost 自动带 x-douyin-home）。
     *   后端没就绪（404）⇒ 页面显示「还读不到主动联系状态（后端未就绪）」+ 全部控件禁用。 */
    function DhReachTab({ snap, active, say }) {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [saveMsg, setSaveMsg] = React.useState(null)
      const inited = React.useRef(false)
      const [pendingOpen, setPendingOpen] = React.useState(false)
      const [form, setForm] = React.useState({
        enabled: false, dryRun: false, limit: 3, quietFrom: '', quietTo: '',
        presenceEnabled: false, presenceChance: 20, presenceCooldownMin: 90, presenceMaxPerDay: 3,
      })

      const applyReach = (r) => {
        const pol = (r && r.policy) || {}
        const pr = (r && r.presence) || {}
        const numOr = (v, d) => {
          const n = Number(v)
          return (v !== undefined && v !== null && isFinite(n)) ? n : d
        }
        setForm({
          enabled: (r && typeof r.enabled === 'boolean') ? r.enabled : false,
          dryRun: (r && typeof r.dryRun === 'boolean') ? r.dryRun : false,
          limit: (pol.limit !== undefined && pol.limit !== null)
            ? Number(pol.limit) || 0
            : Number((r && r.today && r.today.limit) || 0),
          quietFrom: String(pol.quietFrom || ''),
          quietTo: String(pol.quietTo || ''),
          presenceEnabled: pr.enabled === true,
          presenceChance: numOr(pr.chance, 20),
          presenceCooldownMin: numOr(pr.cooldownMin, 90),
          presenceMaxPerDay: numOr(pr.maxPerDay, 3),
        })
      }
      const load = async () => {
        setBusy('load'); setErr(''); setSaveMsg(null)
        try {
          const r = await homeGet('/reach')
          if (!r || r.ok === false) throw new Error((r && (r.error || r.hint)) || '返回不完整')
          setData(r); applyReach(r)
        } catch (e) { setErr(homeErrText(e)); setData(null) }
        finally { setBusy('') }
      }
      React.useEffect(() => {
        if (!active || inited.current) return
        inited.current = true
        load()
      }, [active])

      /** 改完立刻重画（先落本地），再 POST 上屏；失败回滚到后端真实状态 */
      const patch = async (body) => {
        if (busy) return
        setBusy('save'); setSaveMsg(null)
        setForm((prev) => {
          const next = Object.assign({}, prev)
          Object.keys(body).forEach((k) => { if (k !== 'presence') next[k] = body[k] })
          if (body.presence) {
            const pr = body.presence
            if (pr.enabled !== undefined) next.presenceEnabled = pr.enabled === true
            if (pr.chance !== undefined) next.presenceChance = String(pr.chance)
            if (pr.cooldownMin !== undefined) next.presenceCooldownMin = String(pr.cooldownMin)
            if (pr.maxPerDay !== undefined) next.presenceMaxPerDay = String(pr.maxPerDay)
          }
          return next
        })
        setData((prev) => {
          if (!prev) return prev
          const next = Object.assign({}, prev)
          if (body.enabled !== undefined) next.enabled = body.enabled
          if (body.dryRun !== undefined) next.dryRun = body.dryRun
          if (body.limit !== undefined) next.today = Object.assign({}, next.today || {}, { limit: Number(body.limit) })
          if (body.presence) next.presence = Object.assign({}, next.presence || {}, body.presence)
          return next
        })
        try {
          const r = await homePost('/reach', body)
          if (r && r.ok === false) throw new Error(r.error || r.hint || '被拒绝')
          if (r && (r.policy || r.today || typeof r.enabled === 'boolean' || r.presence)) { setData(r); applyReach(r) }
          setSaveMsg({ text: '已保存', tone: 'good' })
        } catch (e) {
          const t = homeErrText(e)
          setSaveMsg({ text: '保存失败：' + t, tone: 'warn' })
          if (typeof say === 'function') say('保存失败：' + t, 'warn')
          load()
        } finally { setBusy('') }
      }

      const hasData = data !== null
      const enabled = hasData ? form.enabled === true : null
      const today = (data && data.today) || {}
      const history = Array.isArray(data && data.history) ? data.history : []
      const blocked = Array.isArray(data && data.blocked) ? data.blocked : []
      const series = Array.isArray(data && data.series) ? data.series : []
      const recent = Array.isArray(data && data.recent) ? data.recent : []
      /* 等回音（她发出去、主人还没回的消息） */
      const pendingObj = (data && data.pending) || {}
      const pendingItems = Array.isArray(pendingObj.items) ? pendingObj.items.filter(Boolean) : []
      const pendingCount = Number(
        pendingObj.count !== undefined && pendingObj.count !== null ? pendingObj.count : pendingItems.length,
      ) || 0
      const todayKey = String(today.day || dhToday())
      const todaySent = history.filter((x) => !x || !x.at || !dhDay(x.at) || dhDay(x.at) === todayKey)
      const todayBlocked = blocked.filter((x) => !x || !x.at || !dhDay(x.at) || dhDay(x.at) === todayKey)
      const reasonCount = {}
      todayBlocked.forEach((x) => {
        const k = dhReachReason(x && x.reason)
        reasonCount[k] = (reasonCount[k] || 0) + 1
      })
      const reasonText = Object.keys(reasonCount).map((k) => k + '×' + reasonCount[k]).join(' · ')
      const count = Number(today.count !== undefined && today.count !== null ? today.count : todaySent.length) || 0
      const limit = Number(today.limit !== undefined && today.limit !== null ? today.limit : form.limit) || 0
      const pct = limit > 0 ? Math.min(100, Math.round((count / limit) * 100)) : 0
      const disabled = !hasData || busy === 'save'
      const saveNum = () => {
        const n = Number(form.limit)
        if (!isFinite(n)) return
        const v = Math.max(0, Math.min(20, Math.round(n)))
        setForm((prev) => Object.assign({}, prev, { limit: v }))
        if (v !== Number(((data && data.policy) || {}).limit)) patch({ limit: v })
      }
      const saveQuiet = (key) => {
        const v = String(form[key] || '')
        if (!/^\d{2}:\d{2}$/.test(v)) return
        if (v !== String((((data && data.policy) || {})[key]) || '')) patch({ [key]: v })
      }
      /* ⭐ 主动找人（presence）：勾选/概率/冷却/每天上限 —— 统一走 {presence:{...}} 对象 */
      const presenceBody = (override) => Object.assign({
        enabled: form.presenceEnabled === true,
        chance: Math.max(0, Math.min(100, Math.round(Number(form.presenceChance) || 0))),
        cooldownMin: Math.max(0, Math.min(1440, Math.round(Number(form.presenceCooldownMin) || 90))),
        maxPerDay: Math.max(0, Math.min(20, Math.round(Number(form.presenceMaxPerDay) || 3))),
      }, override || {})
      const savePresence = (override) => {
        const cur = (data && data.presence) || {}
        const next = presenceBody(override)
        let changed = false
        Object.keys(next).forEach((k) => {
          if (typeof next[k] === 'boolean' ? (Boolean(cur[k]) !== next[k]) : (Number(cur[k]) !== Number(next[k]))) changed = true
        })
        if (!changed) return
        setForm((prev) => Object.assign({}, prev, {
          presenceEnabled: next.enabled,
          presenceChance: String(next.chance),
          presenceCooldownMin: String(next.cooldownMin),
          presenceMaxPerDay: String(next.maxPerDay),
        }))
        patch({ presence: next })
      }
      const recentLine = (x0) => {
        const x = x0 || {}
        const kind = String(x.kind || '').toLowerCase()
        const isBlocked = /block|skip|deny|reject/.test(kind) || (Boolean(x.reason) && !/sent|ok|dm|share/.test(kind))
        const nick = dhPersonName(x.to)
        const at = x.at ? dhClock(x.at) + ' ' : ''
        if (isBlocked) return at + '被拦（' + dhReachReason(x.reason) + '）' + (nick && nick !== '未注明' ? ' → ' + nick : '')
        return at + '发出 → ' + nick + '：' + String(x.text || '（没写内容）')
      }

      return h('div', { 'data-dh-stack': '' },
        /* 标题行 */
        h('div', { className: 'dh-card', 'data-dh-reach-head': '' },
          h('div', { className: 'dh-row' },
            h('div', { className: 'dh-grow', 'data-dh-stack': '' },
              h('div', { className: 'dh-card-title' }, '主动联系'),
              h('div', { className: 'dh-sub' },
                !hasData ? '还读不到主动联系状态（后端未就绪）'
                  : enabled ? '开着：她会自己找你说话。' : '关着：关掉就不再自己开口。')),
            h('span', {
              className: 'dh-badge',
              'data-dh-tone': enabled === true ? 'good' : (enabled === false ? 'warn' : undefined),
            }, enabled === true ? '开着' : (enabled === false ? '关着' : '未知'))),
          err ? h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '读取失败：' + err) : null,
          !hasData ? h('div', { className: 'dh-row' },
            h('button', { className: 'dh-mini', disabled: busy === 'load', onClick: load },
              busy === 'load' ? '读取中…' : '重试')) : null),
        /* 开关区 */
        h('div', { className: 'dh-card', 'data-dh-reach-settings': '' },
          h('div', { className: 'dh-card-title' }, '开关'),
          h('label', { className: 'dh-check' },
            h('input', {
              type: 'checkbox', checked: form.enabled === true, disabled,
              onChange: (e) => patch({ enabled: e.target.checked }),
            }),
            h('span', null, '主动联系'),
            h('span', { className: 'dh-sub' }, '（关掉就不再自己开口）')),
          h('label', { className: 'dh-check' },
            h('input', {
              type: 'checkbox', checked: form.dryRun === true, disabled,
              onChange: (e) => patch({ dryRun: e.target.checked }),
            }),
            h('span', null, '演练模式'),
            h('span', { className: 'dh-sub' }, '（只判断、不真的发）')),
          hasData ? h('label', { className: 'dh-check' },
            h('input', {
              type: 'checkbox', checked: form.presenceEnabled === true, disabled,
              onChange: (e) => savePresence({ enabled: e.target.checked }),
            }),
            h('span', null, '看到主人上线会搭话'),
            h('span', { className: 'dh-sub' }, '（不会每次都问，按概率来）')) : null,
          hasData ? h('div', { className: 'dh-row' },
            h('span', { className: 'dh-label' }, '每次概率'),
            h('input', {
              className: 'dh-input dh-num', type: 'number', min: 0, max: 100,
              value: form.presenceChance, disabled,
              onChange: (e) => setForm((prev) => Object.assign({}, prev, { presenceChance: e.target.value })),
              onBlur: () => savePresence(),
              onKeyDown: (e) => { if (e.key === 'Enter') savePresence() },
            }),
            h('span', { className: 'dh-sub' }, '%'),
            h('span', { className: 'dh-label' }, '冷却'),
            h('input', {
              className: 'dh-input dh-num', type: 'number', min: 0, max: 1440,
              value: form.presenceCooldownMin, disabled,
              onChange: (e) => setForm((prev) => Object.assign({}, prev, { presenceCooldownMin: e.target.value })),
              onBlur: () => savePresence(),
              onKeyDown: (e) => { if (e.key === 'Enter') savePresence() },
            }),
            h('span', { className: 'dh-sub' }, '分钟'),
            h('span', { className: 'dh-label' }, '每天最多'),
            h('input', {
              className: 'dh-input dh-num', type: 'number', min: 0, max: 20,
              value: form.presenceMaxPerDay, disabled,
              onChange: (e) => setForm((prev) => Object.assign({}, prev, { presenceMaxPerDay: e.target.value })),
              onBlur: () => savePresence(),
              onKeyDown: (e) => { if (e.key === 'Enter') savePresence() },
            }),
            h('span', { className: 'dh-sub' }, '次')) : null,
          h('div', { className: 'dh-row' },
            h('span', { className: 'dh-label' }, '每天上限'),
            h('input', {
              className: 'dh-input dh-num', type: 'number', min: 0, max: 20,
              value: form.limit, disabled,
              onChange: (e) => setForm((prev) => Object.assign({}, prev, { limit: e.target.value })),
              onBlur: saveNum,
              onKeyDown: (e) => { if (e.key === 'Enter') saveNum() },
            }),
            h('span', { className: 'dh-sub' }, '今天已用 ' + dhNum(today.count, '0') + ' / ' + dhNum(limit, '0'))),
          h('div', { className: 'dh-row' },
            h('span', { className: 'dh-label' }, '免打扰'),
            h('input', {
              className: 'dh-input dh-time', type: 'time', value: form.quietFrom, disabled,
              onChange: (e) => setForm((prev) => Object.assign({}, prev, { quietFrom: e.target.value })),
              onBlur: () => saveQuiet('quietFrom'),
            }),
            h('span', { className: 'dh-sub' }, '–'),
            h('input', {
              className: 'dh-input dh-time', type: 'time', value: form.quietTo, disabled,
              onChange: (e) => setForm((prev) => Object.assign({}, prev, { quietTo: e.target.value })),
              onBlur: () => saveQuiet('quietTo'),
            })),
          h('div', { className: 'dh-sub' }, '起止相同 = 不设免打扰（默认 00:00–00:00，也就是不设）'),
          busy === 'save' ? h('div', { className: 'dh-msg' }, '保存中…') : null,
          saveMsg ? h('div', { className: 'dh-msg', 'data-dh-tone': saveMsg.tone }, saveMsg.text) : null,
          h('div', { className: 'dh-sub' }, '改完就保存，不用等轮询刷新。')),
        /* 今天 */
        h('div', { className: 'dh-card', 'data-dh-reach-today': '' },
          h('div', { className: 'dh-card-title' }, '今天'),
          h('div', { className: 'dh-kv' },
            h('span', { className: 'dh-k' }, '主动开口'),
            h('span', { className: 'dh-v' }, dhNum(count, '0') + ' / ' + dhNum(limit, '0'))),
          h('div', { className: 'dh-bar' }, h('i', { style: { width: pct + '%' } })),
          h('div', { className: 'dh-kv' },
            h('span', { className: 'dh-k' }, '发出'),
            h('span', { className: 'dh-v' }, dhNum(todaySent.length, '0') + ' 条')),
          h('div', { className: 'dh-kv' },
            h('span', { className: 'dh-k' }, '被拦下'),
            h('span', { className: 'dh-v' }, dhNum(todayBlocked.length, '0') + ' 条' + (reasonText ? '（' + reasonText + '）' : '')))),
        /* 等回音（今天统计下面）——她发出去、主人还没回的消息，只读 */
        hasData ? h('div', { className: 'dh-card', 'data-dh-reach-pending': '' },
          h('div', { className: 'dh-row' },
            h('div', { className: 'dh-grow', 'data-dh-stack': '' },
              h('div', { className: 'dh-card-title' }, '等回音'),
              h('div', { className: 'dh-sub' }, '她发出去、你还没回的消息：' + dhNum(pendingCount, '0') + ' 条')),
            pendingCount
              ? h('button', { className: 'dh-mini', onClick: () => setPendingOpen(!pendingOpen) },
                pendingOpen ? '收起' : '点开看')
              : null),
          pendingOpen && pendingItems.length
            ? h('div', { 'data-dh-stack': '' }, pendingItems.map((it0, i) => {
              const it = it0 || {}
              return h('div', { key: 'pd' + i, className: 'dh-item', style: { fontSize: '11px' } },
                dhClock(it.at) + ' 发给 ' + dhPersonName(it.to) + '：' + String(it.text || ''))
            }))
            : null) : null,
        /* 近 7 天 */
        h('div', { className: 'dh-card', 'data-dh-reach-series': '' },
          h('div', { className: 'dh-card-title' }, '近 7 天'),
          series.length
            ? h('div', { 'data-dh-stack': '' },
              series.slice(-7).map((s0, i) => {
                const s = s0 || {}
                return h('div', { key: 'rs' + i, className: 'dh-row' },
                  h('span', { className: 'dh-item-time' }, dhText(s.day, '—')),
                  h('div', { className: 'dh-grow' }),
                  h('span', { className: 'dh-v' }, '发出 ' + dhNum(s.sent, '0') + ' · 被拦 ' + dhNum(s.blocked, '0')))
              }))
            : h('div', { className: 'dh-sub' }, hasData ? '还没有记录。' : '还读不到数据。')),
        /* 最近几次 */
        h('div', { className: 'dh-card', 'data-dh-reach-recent': '' },
          h('div', { className: 'dh-card-title' }, '最近几次'),
          recent.length
            ? h('div', { 'data-dh-stack': '' },
              recent.map((x, i) => h('div', { key: 'rr' + i, className: 'dh-item', style: { fontSize: '12px' } },
                recentLine(x))))
            : h('div', { className: 'dh-sub' }, hasData ? '还没有记录。' : '还读不到数据。')),
        /* 底部说明 */
        h('div', { 'data-dh-stack': '', style: { gap: '4px' } },
          h('div', { className: 'dh-sub' },
            '这里只管她自己开口（私信/分享）；你当场让她发的不受这个开关影响。'),
          hasData ? h('div', { className: 'dh-sub' },
            '她看到你上线，会按概率/时段挑不同的话（工作时段调侃摸鱼、午休问吃了吗、晚上催早点睡）；发出去你没回，她可能着急再发 1–2 条（每 10 分钟最多一轮，连发最多 3 条）。') : null))
    }

    /* ── Tab 3：记忆（日记 / 档案 / 群 / 归档检索） ── */
    function DhMemoryTab({ snap, active, say, reload }) {
      const s = snap || {}
      const diaryMeta = s.diary || {}
      const profiles = Array.isArray(s.profiles) ? s.profiles : []
      const groups = Array.isArray(s.groups) ? s.groups : []
      const [date, setDate] = React.useState('')
      const [diary, setDiary] = React.useState(null)
      const [diaryErr, setDiaryErr] = React.useState('')
      const [diaryBusy, setDiaryBusy] = React.useState('')
      const [q, setQ] = React.useState('')
      const [adate, setAdate] = React.useState('')
      const [archive, setArchive] = React.useState(null)
      const [archiveErr, setArchiveErr] = React.useState('')
      const [archiveBusy, setArchiveBusy] = React.useState('')
      const inited = React.useRef(false)

      /* ⭐ 保留范围（GET/POST /retention，2026-10-27 最后一轮）：超过就自动清理旧的。
       *    404 → 「还读不到保留设置」；非法值（后端 400）→ 内联报错。 */
      const [ret, setRet] = React.useState(null)
      const [retErr, setRetErr] = React.useState('')
      const [retMsg, setRetMsg] = React.useState(null)
      const [retBusy, setRetBusy] = React.useState(false)
      const [retDraft, setRetDraft] = React.useState(null)
      const retInited = React.useRef(false)
      const RET_FIELDS = [
        ['archiveDays', '归档保留（天）'],
        ['dmKeepPerPerson', '每人私信保留（条）'],
        ['diaryDays', '日记保留（天）'],
        ['journalDays', '台账保留（天）'],
        ['compactionsKeep', '压缩记录保留（条）'],
      ]
      const retDraftOf = (v) => {
        const o = v || {}
        const d = {}
        RET_FIELDS.forEach(([k]) => { d[k] = (o[k] !== undefined && o[k] !== null) ? String(o[k]) : '' })
        return d
      }
      const loadRet = async () => {
        try {
          const r = await homeGet('/retention')
          if (!r || r.ok === false) throw new Error((r && (r.error || r.hint)) || '返回不完整')
          const v = (r && r.retention) || {}
          setRet(v); setRetErr(''); setRetDraft(retDraftOf(v))
        } catch (e) {
          setRetErr(homeErrText(e)); setRet(null); setRetDraft(null)
        }
      }
      React.useEffect(() => {
        if (!active || retInited.current) return
        retInited.current = true
        loadRet()
      }, [active])
      const saveRet = async () => {
        if (retBusy || !retDraft) return
        const body = {}
        for (const [k, label] of RET_FIELDS) {
          const n = Number(retDraft[k])
          if (retDraft[k] === '' || !isFinite(n) || n < 0 || Math.floor(n) !== n) {
            setRetMsg({ text: '「' + label + '」要填非负整数', tone: 'warn' })
            return
          }
          body[k] = n
        }
        // 没改动就不发请求（失焦不白存）
        let changed = false
        for (const [k] of RET_FIELDS) {
          if (Number((ret || {})[k]) !== body[k]) { changed = true; break }
        }
        if (!changed) return
        setRetBusy(true); setRetMsg(null)
        try {
          const r = await homePost('/retention', body)
          if (r && r.ok === false) throw new Error(r.error || r.hint || '保存被拒绝')
          const v = (r && r.retention) || body
          setRet(v); setRetErr(''); setRetDraft(retDraftOf(v))
          setRetMsg({ text: '已保存，下次清理生效', tone: 'good' })
          if (typeof say === 'function') say('保留范围已保存', 'good')
        } catch (e) {
          const t = homeErrText(e)
          setRetMsg({ text: '保存失败：' + t, tone: 'warn' })
          if (typeof say === 'function') say('保存失败：' + t, 'warn')
        } finally { setRetBusy(false) }
      }

      const loadDiary = async (d) => {
        setDiaryBusy('load'); setDiaryErr('')
        try {
          const r = await homeGet('/diary' + (d ? '?date=' + encodeURIComponent(d) : ''))
          if (!r || r.ok === false) throw new Error((r && (r.error || r.hint)) || '返回不完整')
          setDiary(r)
          if (r.date) setDate(r.date)
          else if (d) setDate(d)
        } catch (e) { setDiaryErr(homeErrText(e)) }
        finally { setDiaryBusy('') }
      }

      // 只在第一次切到这个 tab 时拉一次日记（切走再回来不重复拉）
      React.useEffect(() => {
        if (!active || inited.current) return
        inited.current = true
        loadDiary('')
      }, [active])

      const searchArchive = async () => {
        setArchiveBusy('search'); setArchiveErr('')
        try {
          const qs = []
          const kw = String(q || '').trim()
          if (kw) qs.push('q=' + encodeURIComponent(kw))
          if (adate) qs.push('date=' + encodeURIComponent(adate))
          qs.push('limit=50')
          const r = await homeGet('/archive?' + qs.join('&'))
          if (!r || r.ok === false) throw new Error((r && (r.error || r.hint)) || '返回不完整')
          setArchive({
            count: r.count,
            rows: Array.isArray(r.rows) ? r.rows : (Array.isArray(r.list) ? r.list : []),
          })
        } catch (e) { setArchiveErr(homeErrText(e)) }
        finally { setArchiveBusy('') }
      }

      const dateList = (() => {
        const list = []
        const push = (x) => { if (x && list.indexOf(x) < 0) list.push(x) }
        push(date)
        push(diaryMeta.todayDate)
        ;(Array.isArray(diaryMeta.dates) ? diaryMeta.dates : []).forEach(push)
        ;(diary && Array.isArray(diary.dates) ? diary.dates : []).forEach(push)
        return list
      })()
      const curDate = dateList.indexOf(date) >= 0 ? date : (dateList[0] || '')
      const archiveRows = archive ? (Array.isArray(archive.rows) ? archive.rows : []) : null
      /* 顶部那行：她自己的世界提示词有多少字（内容在「人设」tab 改） */
      const worldPromptChars = (s.worldPrompt && s.worldPrompt.chars !== undefined && s.worldPrompt.chars !== null)
        ? s.worldPrompt.chars
        : 0

      return h('div', { 'data-dh-stack': '' },
        h('div', { className: 'dh-msg' },
          '她的世界提示词：' + dhNum(worldPromptChars, '0') + ' 字（在「世界提示词」tab 里改，排在她的六层人设之前）'),
        /* 日记 */
        h('div', { className: 'dh-card', 'data-dh-mem-diary': '' },
          h('div', { className: 'dh-card-title' }, '日记'),
          h('div', { className: 'dh-sub' },
            '她每天写的那一篇（只读）。' + (diaryMeta.todayDate ? '今天是 ' + diaryMeta.todayDate + '；' : '') + '共 ' + dhNum((Array.isArray(diaryMeta.dates) ? diaryMeta.dates.length : 0), '0') + ' 天有记录。'),
          h('div', { className: 'dh-row' },
            dateList.length
              ? h('select', {
                className: 'dh-input dh-select dh-date',
                value: curDate,
                disabled: diaryBusy === 'load',
                onChange: (e) => { setDate(e.target.value); loadDiary(e.target.value) },
              }, dateList.map((d) => h('option', { key: d, value: d }, d)))
              : h('span', { className: 'dh-sub' }, '还没有日记 —— 她写第一篇之后这里才会有。'),
            h('button', { className: 'dh-mini', disabled: diaryBusy === 'load', onClick: () => loadDiary(curDate) },
              diaryBusy === 'load' ? '读取中…' : '刷新这篇')),
          diaryErr ? h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '读取失败：' + diaryErr) : null,
          diary === null
            ? h('div', { className: 'dh-sub' }, diaryBusy === 'load' ? '正在读…' : '（还没读）')
            : h('pre', { className: 'dh-pre' }, dhText(diary.text, '这天还没有日记。'))),
        /* 档案 */
        h('div', { className: 'dh-card', 'data-dh-mem-profiles': '' },
          h('div', { className: 'dh-card-title' }, '档案（' + profiles.length + '）'),
          h('div', { className: 'dh-sub' }, '她记住的人。改了要按每张卡自己的「保存」；把字段清空不会删掉旧内容（后端保守做法）。'),
          profiles.length
            ? h('div', { 'data-dh-stack': '' },
              profiles.map((p, i) => h(DhProfileCard, { key: (p && p.sec_uid) || ('hp' + i), p: p || {}, reload, say })))
            : h('div', { className: 'dh-sub' }, '还没有人物档案 —— 聊过、评论过之后才会有。')),
        /* 群（只读） */
        h('div', { className: 'dh-card', 'data-dh-mem-groups': '' },
          h('div', { className: 'dh-card-title' }, '群（' + groups.length + '）'),
          h('div', { className: 'dh-sub' }, '群档案是只读的（她自己的印象，不在这里改）。'),
          groups.length
            ? h('div', { className: 'dh-list' },
              groups.map((g, i) => {
                const gg = g || {}
                const gname = gg.name || gg.nick || gg.group || gg.title || ('群 ' + (i + 1))
                const imp = gg.impression || gg.note || ''
                const memberMap = gg.member && typeof gg.member === 'object' && !Array.isArray(gg.member) ? gg.member : null
                const memberArr = Array.isArray(gg.members) ? gg.members : null
                const memCount = memberMap ? Object.keys(memberMap).length : (memberArr ? memberArr.length : null)
                return h('div', { key: 'hg' + i, className: 'dh-item' },
                  h('div', { className: 'dh-item-title' }, gname + (memCount !== null ? '（' + memCount + ' 人）' : '')),
                  imp ? h('div', { className: 'dh-sub', style: { marginTop: '2px' } }, imp) : null)
              }))
            : h('div', { className: 'dh-sub' }, '还没有群档案。')),
        /* 归档检索（只读） */
        h('div', { className: 'dh-card', 'data-dh-mem-archive': '' },
          h('div', { className: 'dh-card-title' }, '归档检索'),
          h('div', { className: 'dh-sub' }, '查她以前聊过什么（按关键词子串匹配，只读）。'),
          h('div', { className: 'dh-row' },
            h('input', {
              className: 'dh-input dh-grow', placeholder: '关键词，比如「示例视频」',
              value: q, onChange: (e) => setQ(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') searchArchive() },
            }),
            h('input', {
              className: 'dh-input dh-date', type: 'date', value: adate,
              onChange: (e) => setAdate(e.target.value),
            }),
            h('button', { className: 'dh-mini', disabled: archiveBusy === 'search', onClick: searchArchive },
              archiveBusy === 'search' ? '搜…' : '搜索')),
          archiveErr ? h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '读取失败：' + archiveErr) : null,
          archive === null
            ? h('div', { className: 'dh-sub' }, '还没搜过 —— 直接点「搜索」看最近的归档。')
            : (archiveRows.length
              ? h('div', { className: 'dh-list' },
                archiveRows.map((r, i) => {
                  const L = dhLine(r)
                  return h('div', { key: 'ha' + i, className: 'dh-item' },
                    L.at ? h('span', { className: 'dh-item-time' }, L.at) : null,
                    L.who ? h('span', { className: 'dh-tag' }, L.who) : null,
                    L.text)
                }))
              : h('div', { className: 'dh-sub' }, '没有匹配的（共 ' + dhNum(archive.count, '0') + ' 条）。'))),
        /* 保留范围 */
        h('div', { className: 'dh-card', 'data-dh-mem-retention': '' },
          h('div', { className: 'dh-row' },
            h('div', { className: 'dh-grow', 'data-dh-stack': '' },
              h('div', { className: 'dh-card-title' }, '保留范围'),
              h('div', { className: 'dh-sub' }, '超过就自动清理旧的；改完立刻保存。')),
            h('button', { className: 'dh-mini', disabled: retBusy, onClick: loadRet }, '刷新')),
          retErr
            ? h('div', { className: 'dh-sub' }, '还读不到保留设置（' + retErr + '）')
            : (retDraft === null
              ? h('div', { className: 'dh-sub' }, '读取中…')
              : h('div', { 'data-dh-stack': '' },
                h('div', { 'data-dh-stats': '' }, RET_FIELDS.map(([k, label]) => h('div', { key: k, className: 'dh-stat' },
                  h('div', { className: 'dh-stat-l' }, label),
                  h('input', {
                    className: 'dh-input', type: 'number', min: 0,
                    value: retDraft[k] === undefined || retDraft[k] === null ? '' : retDraft[k],
                    disabled: retBusy,
                    onChange: (e) => setRetDraft((prev) => Object.assign({}, prev || {}, { [k]: e.target.value })),
                    onBlur: saveRet,
                    onKeyDown: (e) => { if (e.key === 'Enter') saveRet() },
                  })))),
                retMsg ? h('div', { className: 'dh-msg', 'data-dh-tone': retMsg.tone }, retMsg.text) : null)))
      )
    }

    /* ── Tab 4：节奏（待办 / 主动开口 / 09:00 兜底） ── */
    function DhRhythmTab({ snap, say, reload }) {
      const s = snap || {}
      const life = s.life || {}
      const reach = s.reach || {}
      const plan = life.plan
      const hasPlan = dhHasPlan(plan)
      const [busy, setBusy] = React.useState('')
      const [mode, setMode] = React.useState('at')
      const [at, setAt] = React.useState('')
      const [minutes, setMinutes] = React.useState('30')
      const [note, setNote] = React.useState('')
      const [err, setErr] = React.useState('')

      const setPlan = async () => {
        if (busy) return
        const n = String(note || '').trim()
        if (!n) { setErr('note 是必填的：写一句到点要做什么'); return }
        const body = { note: n }
        if (mode === 'at') {
          if (!/^\d{1,2}:\d{2}$/.test(String(at || ''))) { setErr('先选个时间（HH:MM）'); return }
          body.at = at
        } else {
          const m = Number(minutes)
          if (!isFinite(m) || m <= 0 || m > 1440) { setErr('分钟数要在 1–1440 之间'); return }
          body.after_minutes = Math.round(m)
        }
        setErr(''); setBusy('plan')
        try {
          const r = await homePost('/plan', body)
          if (r && r.ok === false) throw new Error(r.error || r.hint || '被拒绝')
          setNote(''); setAt('')
          say('已保存：到点会叫醒她', 'good')
          await reload()
        } catch (e) {
          const t = homeErrText(e)
          setErr('设置失败：' + t)
          say('设置失败：' + t, 'warn')
        } finally { setBusy('') }
      }

      const cancelPlan = async () => {
        if (busy) return
        setBusy('cancel'); setErr('')
        try {
          const r = await homePost('/plan', { cancel: true })
          if (r && r.ok === false) throw new Error(r.error || r.hint || '被拒绝')
          say('待办已取消', 'good')
          await reload()
        } catch (e) {
          const t = homeErrText(e)
          setErr('取消失败：' + t)
          say('取消失败：' + t, 'warn')
        } finally { setBusy('') }
      }

      const history = Array.isArray(reach.history) ? reach.history : []

      return h('div', { 'data-dh-stack': '' },
        /* 当前待办 */
        h('div', { className: 'dh-card', 'data-dh-rhythm-plan': '' },
          h('div', { className: 'dh-card-title' }, '当前待办'),
          h('div', { className: 'dh-v' }, dhPlanText(plan)),
          h('div', { className: 'dh-sub' },
            hasPlan ? '到点插件会叫醒她，顺便告诉她这期间发生了什么。' : '现在没有待办。什么都不定的话，第二天 09:00 会兜底叫醒她一次。'),
          hasPlan
            ? h('div', { className: 'dh-row' },
              h('button', { className: 'dh-mini', 'data-dh-danger': '', disabled: Boolean(busy), onClick: cancelPlan },
                busy === 'cancel' ? '取消中…' : '取消这个待办'))
            : null),
        /* 设置待办 */
        h('div', { className: 'dh-card', 'data-dh-rhythm-set': '' },
          h('div', { className: 'dh-card-title' }, '定下一个待办'),
          h('div', { 'data-dh-seg': '' },
            [['at', '指定时间'], ['after', 'N 分钟后']].map((x) => h('button', {
              key: x[0], className: 'dh-tab', 'data-dh-active': mode === x[0] ? '' : undefined,
              style: { padding: '5px 10px' }, onClick: () => setMode(x[0]),
            }, x[1]))),
          mode === 'at'
            ? h('div', { className: 'dh-field' },
              h('span', { className: 'dh-label' }, '几点（今天过了就明天）'),
              h('input', {
                className: 'dh-input dh-time', type: 'time', value: at,
                onChange: (e) => setAt(e.target.value),
              }))
            : h('div', { className: 'dh-field' },
              h('span', { className: 'dh-label' }, '多少分钟后（1–1440）'),
              h('input', {
                className: 'dh-input dh-num', type: 'number', min: 1, max: 1440, value: minutes,
                onChange: (e) => setMinutes(e.target.value),
              })),
          h('div', { className: 'dh-field' },
            h('span', { className: 'dh-label' }, '到点要做什么（必填）'),
            h('input', {
              className: 'dh-input', value: note,
              placeholder: '比如：翻翻这几天谁找过她，挑两条回一下',
              onChange: (e) => setNote(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') setPlan() },
            })),
          err ? h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, err) : null,
          h('div', { className: 'dh-row' },
            h('button', { className: 'dh-btn', 'data-dh-primary': '', disabled: Boolean(busy), onClick: setPlan },
              busy === 'plan' ? '设置中…' : '定下这个待办'))),
        /* 主动开口 */
        h('div', { className: 'dh-card', 'data-dh-rhythm-reach': '' },
          h('div', { className: 'dh-card-title' }, '今天主动开口'),
          h('div', { className: 'dh-kv' },
            h('span', { className: 'dh-k' }, '已发'),
            h('span', { className: 'dh-v' }, dhNum(reach.count, '0') + ' / ' + dhNum(reach.limit, '3') + (reach.day ? '（' + reach.day + '）' : ''))),
          h('div', { className: 'dh-sub' }, '护栏：每天最多 ' + dhNum(reach.limit, '3') + ' 条；00:00–08:00 不发；只找「熟 / 自己人」。'),
          history.length
            ? h('div', { className: 'dh-list' },
              history.map((r, i) => {
                const L = dhLine(r)
                return h('div', { key: 'hr' + i, className: 'dh-item' },
                  L.at ? h('span', { className: 'dh-item-time' }, L.at) : null,
                  L.who ? h('span', { className: 'dh-tag' }, '→ ' + L.who) : null,
                  L.text)
              }))
            : h('div', { className: 'dh-sub' }, '今天还没主动找过谁。')),
        /* 兜底说明 */
        h('div', { className: 'dh-card', 'data-dh-rhythm-fallback': '' },
          h('div', { className: 'dh-card-title' }, '09:00 兜底'),
          h('div', { className: 'dh-sub' },
            '如果一直没定待办，第二天 09:00 会自动叫醒她一次；她醒来会先看这期间的通知、私信和台账，再决定要不要找主人。这里不需要你配。')))
    }

    /* ── 「她的聊天」卡（今天 tab 底部；只读，不回话） ──
     *  数据：GET /api/douyin-home/chat（homeGet）。
     *  ⚠️ 只有点「刷新最新」才 POST /api/douyin-duty/chat/read —— 那条会起浏览器、慢，
     *     所以绝不能放进轮询里（这里只在用户手动点击时调一次）。 */
    function DhChatCard({ active, say }) {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [openKey, setOpenKey] = React.useState('')
      const [note, setNote] = React.useState(null)
      const inited = React.useRef(false)

      const load = async () => {
        setBusy('load'); setErr('')
        try {
          const r = await homeGet('/chat?date=' + encodeURIComponent(dhToday()) + '&limit=20')
          if (!r || r.ok === false) throw new Error((r && (r.error || r.hint)) || '返回不完整')
          setData(r)
        } catch (e) { setErr(homeErrText(e)) }
        finally { setBusy('') }
      }
      React.useEffect(() => {
        if (!active || inited.current) return
        inited.current = true
        load()
      }, [active])

      /** 「刷新最新」：先让 duty 起浏览器读一次最新私信，再重拉 /chat（只在点击时调用） */
      const readLatest = async (p) => {
        if (busy) return
        const to = String(p.nick || '').trim()
        const toId = String(p.sec_uid || '').trim()
        if (!to && !toId) { setNote({ text: '这个人没有昵称/sec_uid，读不了', tone: 'warn' }); return }
        setBusy('read'); setNote(null)
        try {
          const r = await jpost('/chat/read', { to, to_id: toId })
          if (r && r.ok === false) throw new Error(r.error || r.hint || '读取被拒绝')
          setNote({ text: '已读到最新（' + (r && r.to ? r.to : (to || '这个人')) + '）', tone: 'good' })
          if (typeof say === 'function') say('已读到最新', 'good')
          await load()
        } catch (e) {
          const t = homeErrText(e)
          setNote({ text: '读最新失败：' + t, tone: 'warn' })
          if (typeof say === 'function') say('读最新失败：' + t, 'warn')
        } finally { setBusy('') }
      }

      const people = Array.isArray(data && data.people) ? data.people : []
      const groups = Array.isArray(data && data.groups) ? data.groups : []
      const degraded = Array.isArray(data && data.degraded) ? data.degraded.filter(Boolean) : []
      const personRow = (p0, i, isGroup) => {
        const p = p0 || {}
        const key = (isGroup ? 'g:' : 'p:') + String(p.sec_uid || p.nick || ('i' + i))
        const msgs = Array.isArray(p.messages) ? p.messages : []
        const last = msgs.length ? (msgs[msgs.length - 1] || {}) : null
        const opened = openKey === key
        const name = dhChatName(p)
        return h('div', { key, 'data-dh-stack': '', style: { gap: '4px' } },
          h('button', {
            'data-dh-chat-person': '', 'data-dh-open': opened ? '' : undefined,
            onClick: () => setOpenKey(opened ? '' : key),
          },
            h('span', { className: 'dh-avatar-sm' }, name.slice(0, 1)),
            h('span', { className: 'dh-chat-name' }, name),
            p.stage ? h('span', {
              className: 'dh-badge', 'data-dh-tone': p.stage === '自己人' ? 'good' : undefined,
            }, p.stage) : null,
            p.needsReply ? h('span', { className: 'dh-tag' }, '该回了') : null,
            h('span', { className: 'dh-chat-last' },
              last
                ? (last.from === 'me' ? '我：' : last.from === 'them' ? '他：' : '') + String(last.text || '')
                : '还没有消息'),
            h('span', { className: 'dh-item-time' }, p.lastAt ? dhClock(p.lastAt) : '')),
          opened
            ? h('div', { 'data-dh-stack': '', style: { paddingLeft: '8px' } },
              h('div', { 'data-dh-chat-box': '' },
                msgs.length
                  ? msgs.map((m0, j) => {
                    const m = m0 || {}
                    return h('div', {
                      key: 'cm' + j, className: 'dh-bubble', 'data-dh-mine': m.from === 'me' ? '' : undefined,
                    },
                      h('div', { className: 'dh-bubble-meta' },
                        dhFromLabel(m.from) + (m.at ? ' · ' + dhClock(m.at) : '')
                        + (dhKindLabel(m.kind) ? ' · ' + dhKindLabel(m.kind) : '')),
                      String(m.text || ''))
                  })
                  : h('div', { className: 'dh-sub' }, '这 20 条里没有消息。')),
              h('div', { className: 'dh-row' },
                isGroup
                  ? h('span', { className: 'dh-sub' }, '群里只能看，插件不往群里发卡片。')
                  : h('button', {
                    className: 'dh-mini', disabled: Boolean(busy),
                    onClick: () => readLatest(p),
                  }, busy === 'read' ? '正在起浏览器…' : '刷新最新'),
                h('span', { className: 'dh-sub' }, '要回她就回抖音，这里只看。')))
            : null)
      }

      return h('div', { className: 'dh-card', 'data-dh-today-chat': '' },
        h('div', { className: 'dh-row' },
          h('div', { className: 'dh-grow', 'data-dh-stack': '' },
            h('div', { className: 'dh-card-title' }, '她的聊天' + (data && data.date ? '（' + data.date + '）' : '')),
            h('div', { className: 'dh-sub' }, '按人分组看最近 20 条；只读。「刷新最新」会起一次浏览器（慢，几秒到几十秒），所以只在点击时读。')),
          h('button', { className: 'dh-mini', disabled: busy === 'load', onClick: load },
            busy === 'load' ? '读取中…' : '刷新列表')),
        err ? h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '读取失败：' + err) : null,
        note ? h('div', { className: 'dh-msg', 'data-dh-tone': note.tone }, note.text) : null,
        degraded.length ? h('div', { className: 'dh-msg' }, '部分数据是兜底：' + degraded.join('；')) : null,
        data === null
          ? h('div', { className: 'dh-sub' }, busy === 'load' ? '正在读…' : '（还没读）')
          : h('div', { 'data-dh-stack': '' },
            people.length
              ? h('div', { 'data-dh-stack': '', style: { gap: '2px' } }, people.map((p, i) => personRow(p, i, false)))
              : h('div', { className: 'dh-sub' }, '今天没有私信。'),
            groups.length
              ? h('div', { 'data-dh-stack': '', style: { gap: '2px', marginTop: '8px' } },
                h('div', { className: 'dh-sub' }, '群消息（只读）—— 群里只能看，插件不往群里发卡片。'),
                groups.map((g, i) => personRow(g, i, true)))
              : null))
    }

    /* ── Tab 2：今天（/today 真数据 + 日报兜底 + 她的聊天） ── */
    function DhTodayTab({ snap, active, say }) {
      const s = snap || {}
      const snapJournal = s.journal || {}
      const [today, setToday] = React.useState(null)      // /api/douyin-home/today
      const [source, setSource] = React.useState('')      // 'today' | 'report'
      const [todayErr, setTodayErr] = React.useState('')
      const [rep, setRep] = React.useState(null)          // 兜底：/api/douyin-duty/report 的旧解析
      const [err, setErr] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [rawOpen, setRawOpen] = React.useState(false)
      const [note, setNote] = React.useState(null)
      const inited = React.useRef(false)

      /** 先试真数据 /today；失败**自动退回**旧 /report 解析（页面不报错，只注明旧数据源） */
      const load = async () => {
        setBusy('load'); setErr('')
        try {
          const r = await homeGet('/today?day=' + encodeURIComponent(dhToday()))
          if (!r || r.ok === false) throw new Error((r && (r.error || r.hint)) || '返回不完整')
          setToday(r); setTodayErr(''); setSource('today'); setBusy('')
          return
        } catch (e) {
          setTodayErr(homeErrText(e))
          setSource('report')
        }
        try {
          const r = await jget('/report?day=' + encodeURIComponent(dhToday()))
          if (!r || r.ok === false) throw new Error((r && r.error) || '返回不完整')
          setRep(r); setErr('')
        } catch (e) { setErr(String((e && e.message) || e)) }
        finally { setBusy('') }
      }
      React.useEffect(() => {
        if (!active || inited.current) return
        inited.current = true
        load()
      }, [active])

      const openReport = async () => {
        setBusy('open')
        try {
          const r = await jpost('/open', {})
          const ok = Boolean(r && r.ok)
          setNote({ text: ok ? '已打开报告文件夹（out/）' : ('打开失败：' + ((r && r.error) || '未知')), tone: ok ? 'good' : 'warn' })
          if (ok && typeof say === 'function') say('已打开报告文件夹', 'good')
        } catch (e) {
          setNote({ text: '打开失败：' + String((e && e.message) || e), tone: 'warn' })
        } finally { setBusy('') }
      }

      const useToday = source === 'today' && Boolean(today)
      const t = today || {}
      const counts = t.counts || {}
      const rounds = Array.isArray(t.rounds) ? t.rounds : []
      const picked = Array.isArray(t.picked) ? t.picked : []
      const sent = Array.isArray(t.sent) ? t.sent : []
      const cands = t.candidates || {}
      const degraded = Array.isArray(t.degraded) ? t.degraded.filter(Boolean) : []
      const hasReport = Boolean(rep && rep.exists && String(rep.text || '').trim())
      const parsed = dhParseReport(rep && rep.text)
      const journalRows = useToday ? dhRows(t.journal).slice(-30) : dhRows(snapJournal.latest).slice(-10)
      const sentGroups = (() => {
        const map = new Map()
        sent.forEach((x0) => {
          const x = x0 || {}
          const who = dhPersonName(x.to)
          if (!map.has(who)) map.set(who, [])
          map.get(who).push(x)
        })
        return Array.from(map.entries()).map(([who, rows]) => ({ who, rows }))
      })()
      const stat = (label, value) => h('div', { className: 'dh-stat' },
        h('div', { className: 'dh-stat-n' }, value),
        h('div', { className: 'dh-stat-l' }, label))
      const flagEl = (label, v) => {
        const f = dhFlag(label, v)
        return h('span', { className: 'dh-badge', 'data-dh-tone': f.tone }, f.text)
      }
      const pickEl = (it0, key) => {
        const it = it0 || {}
        return h('div', { key, 'data-dh-pick': '' },
          h('a', {
            href: it.url || dhVideoUrl(it.aweme_id), target: '_blank', rel: 'noreferrer',
          }, it.desc || it.aweme_id || '（没标题）'),
          h('div', { className: 'dh-sub' }, [it.author, it.at ? dhClock(it.at) : '', it.aweme_id].filter(Boolean).join(' · ')))
      }
      const roundRow = (r0, i) => {
        const r = r0 || {}
        return h('div', { key: 'tr' + i, 'data-dh-round': '' },
          h('div', { className: 'dh-row' },
            h('span', { className: 'dh-item-time' }, r.at ? dhClock(r.at) : '--:--'),
            h('span', { className: 'dh-tag' }, dhWhy(r.why)),
            h('div', { className: 'dh-grow' }),
            h('span', { className: 'dh-sub' }, '候选 ' + dhNum(r.candidates, '?') + ' → 挑中 ' + dhNum(r.pickedCount, '0'))))
      }

      const todayView = () => h('div', { 'data-dh-stack': '' },
        h('div', { className: 'dh-card', 'data-dh-today-stats': '' },
          h('div', { className: 'dh-row' },
            h('div', { className: 'dh-grow', 'data-dh-stack': '' },
              h('div', { className: 'dh-card-title' }, '今天 ' + (t.day || dhToday())),
              h('div', { className: 'dh-sub' },
                '真数据（/today）：轮次、挑中、发出、私信都直接读盘。'
                + (cands.count !== undefined && cands.count !== null
                  ? '证据包 ' + dhNum(cands.count, '0') + ' 条'
                    + (cands.dropped !== undefined && cands.dropped !== null ? '（筛掉 ' + dhText(cands.dropped) + '）' : '') + '；'
                  : '')
                + (cands.builtAt ? '打包于 ' + dhClock(cands.builtAt) : ''))),
            h('button', { className: 'dh-mini', disabled: busy === 'load', onClick: load },
              busy === 'load' ? '读取中…' : '刷新'),
            h('button', { className: 'dh-mini', disabled: busy === 'open', onClick: openReport }, '打开报告文件夹')),
          h('div', { 'data-dh-stats': '' },
            stat('轮次', dhNum(counts.rounds, '0')),
            stat('挑中', dhNum(counts.picked, '0')),
            stat('发出', dhNum(counts.sent, '0')),
            stat('私信 收/发', dhNum(counts.dmIn, '0') + ' / ' + dhNum(counts.dmOut, '0'))),
          degraded.length ? h('div', { className: 'dh-msg' }, '部分数据来自报告兜底：' + degraded.join('；')) : null,
          note ? h('div', { className: 'dh-msg', 'data-dh-tone': note.tone }, note.text) : null),
        h('div', { className: 'dh-card', 'data-dh-today-rounds': '' },
          h('div', { className: 'dh-card-title' }, '轮次时间轴（' + rounds.length + '）'),
          rounds.length
            ? h('div', { 'data-dh-stack': '' }, rounds.map(roundRow))
            : h('div', { className: 'dh-sub' }, '今天还没跑过轮次。')),
        h('div', { className: 'dh-card', 'data-dh-today-picked': '' },
          h('div', { className: 'dh-card-title' }, '挑中的视频（' + picked.length + '）'),
          picked.length
            ? h('div', { 'data-dh-stack': '' }, picked.map((it, i) => pickEl(it, 'tp' + i)))
            : h('div', { className: 'dh-sub' }, '今天还没挑中任何视频。')),
        h('div', { className: 'dh-card', 'data-dh-today-sent': '' },
          h('div', { className: 'dh-card-title' }, '发出记录（按人）'),
          h('div', { className: 'dh-sub' }, '每行三项：卡片发出去没有 / 有没有带理由 / 有没有回读确认。'),
          sentGroups.length
            ? h('div', { 'data-dh-stack': '' }, sentGroups.map((g) => h('div', { key: 'ts' + g.who, className: 'dh-item' },
              h('div', { className: 'dh-item-title' }, g.who + '：' + g.rows.length + ' 张'),
              h('div', { 'data-dh-stack': '' }, g.rows.map((x, i) => h('div', { key: 'tsr' + i, className: 'dh-row' },
                h('span', { className: 'dh-item-time' }, x.at ? dhClock(x.at) : '--:--'),
                h('a', {
                  href: dhVideoUrl(x.aweme_id), target: '_blank', rel: 'noreferrer',
                  className: 'dh-sub', title: dhText(x.aweme_id),
                }, '#' + String(x.aweme_id || '').slice(-6)),
                flagEl('卡片', x.ok), flagEl('理由', x.reason), flagEl('回读', x.readback)))))))
            : h('div', { className: 'dh-sub' }, '今天还没往抖音发过东西。')))

      const reportView = () => h('div', { 'data-dh-stack': '' },
        h('div', { className: 'dh-msg' },
          '旧数据源：新接口 /today 不可用（' + dhText(todayErr, '未知原因') + '），下面是从日报 markdown 解析的，字段可能不全。'),
        err ? h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '读取失败：' + err) : null,
        h('div', { className: 'dh-card', 'data-dh-today-report': '' },
          h('div', { className: 'dh-row' },
            h('div', { className: 'dh-grow', 'data-dh-stack': '' },
              h('div', { className: 'dh-card-title' }, '今天的日报'),
              h('div', { className: 'dh-sub' }, '她一轮轮刷出来的报告（out/<日期>.md）。挑中的点标题能直接去抖音看。')),
            h('button', { className: 'dh-mini', disabled: busy === 'load', onClick: load },
              busy === 'load' ? '读取中…' : '刷新'),
            h('button', { className: 'dh-mini', disabled: busy === 'open', onClick: openReport }, '打开报告文件夹')),
          note ? h('div', { className: 'dh-msg', 'data-dh-tone': note.tone }, note.text) : null,
          !hasReport && !err && busy !== 'load'
            ? h('div', { 'data-dh-stack': '' },
              h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '今天还没有报告 —— 她还没跑过，或者这一轮说了「不写报告」。'),
              h('div', { className: 'dh-row' },
                h('button', { className: 'dh-btn', onClick: load }, '再看一眼'),
                h('button', { className: 'dh-btn', disabled: busy === 'open', onClick: openReport }, '打开报告文件夹')))
            : null,
          hasReport && parsed.rounds.length
            ? h('div', { 'data-dh-stack': '' },
              h('div', { className: 'dh-row' },
                h('span', { className: 'dh-badge' }, '共 ' + parsed.rounds.length + ' 轮'),
                h('span', { className: 'dh-badge' }, '挑中 ' + dhNum(parsed.picked, '0')),
                h('span', { className: 'dh-badge', 'data-dh-tone': parsed.sent ? 'good' : undefined }, '发出 ' + dhNum(parsed.sent, '0')),
                h('div', { className: 'dh-grow' }),
                h('button', { className: 'dh-mini', onClick: () => setRawOpen(!rawOpen) }, rawOpen ? '收起原文' : '看报告原文'),
                h('button', { className: 'dh-mini', disabled: busy === 'open', onClick: openReport }, '打开报告文件夹')),
              h('div', { className: 'dh-list', style: { maxHeight: '460px' } },
                parsed.rounds.map((r, i) => h('div', { key: 'rd' + i, 'data-dh-round': '' },
                  h('div', { className: 'dh-row' },
                    h('div', { className: 'dh-grow', 'data-dh-stack': '' },
                      h('div', { className: 'dh-item-title' },
                        (r.time ? r.time + ' ' : '') + '第 ' + r.roundNo + ' 轮 · 候选 '
                        + (r.cand === null ? '?' : r.cand) + ' → 挑中 ' + dhNum(r.picked, '0') + ' → 发出 ' + dhNum(r.sent, '0')),
                      (r.side !== null || r.unsure !== null)
                        ? h('div', { className: 'dh-sub' },
                          [r.side !== null ? '顺带一提 ' + r.side : '', r.unsure !== null ? '没把握/不推 ' + r.unsure : '']
                            .filter(Boolean).join(' · ') + '（落选只记数，不逐条编）')
                        : h('div', { className: 'dh-sub' }, '落选条目只记数')),
                    h('span', { className: 'dh-tag' }, r.cand === 0 ? '没候选' : (r.picked > 0 ? r.picked + ' 条挑中' : '没写挑中'))),
                  r.items.length ? h('div', { 'data-dh-stack': '' }, r.items.map((it) => h('div', {
                    key: 'pk' + it.id, 'data-dh-pick': '',
                  },
                    h('a', { href: dhVideoUrl(it.id), target: '_blank', rel: 'noreferrer' }, it.title || it.id),
                    h('div', { className: 'dh-sub' }, [it.author, it.id].filter(Boolean).join(' · '))))) : null))),
              rawOpen ? h('pre', { className: 'dh-pre' }, String(rep.text || '').slice(0, 20000)) : null)
            : null,
          hasReport && !parsed.rounds.length
            ? h('div', { 'data-dh-stack': '' },
              h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '报告在，但没解析到「本轮」块（格式可能变了）—— 下面给原文。'),
              h('div', { className: 'dh-row' },
                h('button', { className: 'dh-mini', onClick: () => setRawOpen(!rawOpen) }, rawOpen ? '收起原文' : '看报告原文'),
                h('button', { className: 'dh-mini', disabled: busy === 'open', onClick: openReport }, '打开报告文件夹')),
              rawOpen ? h('pre', { className: 'dh-pre' }, String(rep.text || '').slice(0, 20000)) : null)
            : null),
        h('div', { className: 'dh-card', 'data-dh-today-sent': '' },
          h('div', { className: 'dh-card-title' }, '发出记录（按人）'),
          h('div', { className: 'dh-sub' }, '从报告里的「已发卡片：<ID>」按人分组；报告没写名字的都归「未注明」。'),
          (parsed.sentByWho || []).length
            ? h('div', { 'data-dh-stack': '' },
              parsed.sentByWho.map((g) => h('div', { key: 'sw' + g.who, className: 'dh-item' },
                h('div', { className: 'dh-item-title' }, g.who + '：' + g.ids.length + ' 张'),
                h('div', { className: 'dh-sub' }, g.ids.join('、')))))
            : h('div', { className: 'dh-sub' },
              hasReport ? '报告里没写「已发卡片」—— 这轮可能没发，或者不是自动发送的轮次。' : '还没有报告，所以没有发出记录。')))

      const idleView = () => h('div', { className: 'dh-card' },
        h('div', { className: 'dh-card-title' }, '今天'),
        h('div', { className: 'dh-sub' }, busy === 'load' ? '正在读今天的真数据…' : '点「刷新」读今天的真数据。'),
        todayErr ? h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '真数据读取失败：' + todayErr) : null,
        err ? h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '旧数据源也读取失败：' + err) : null,
        h('div', { className: 'dh-row' },
          h('button', { className: 'dh-btn', onClick: load }, '刷新')))

      const journalCard = () => h('div', { className: 'dh-card', 'data-dh-today-journal': '' },
        h('div', { className: 'dh-card-title' },
          useToday ? '今天台账（' + journalRows.length + ' 条）' : '今天台账（最近 ' + journalRows.length + ' 条，来自 snapshot）'),
        journalRows.length
          ? h('div', { className: 'dh-list', style: { maxHeight: '240px' } },
            journalRows.map((r, i) => {
              const L = dhLine(r)
              return h('div', { key: 'tj' + i, className: 'dh-item' },
                L.at ? h('span', { className: 'dh-item-time' }, L.at) : null,
                L.text)
            }))
          : h('div', { className: 'dh-sub' }, useToday ? '今天还没写台账。' : '台账里还没有今天的记录。'))

      return h('div', { 'data-dh-stack': '' },
        useToday ? todayView() : (source === 'report' ? reportView() : idleView()),
        journalCard(),
        h(DhChatCard, { active, say }))
    }

    /* ── Tab 5：连接（登录 / 三步装机 / 分享对象；登录卡和「刷抖音」共用一份状态） ── */
    function DhConnectTab({ snap, duty, reloadDuty, active, say }) {
      const login = useDouyinLogin()
      const [cfg, setCfg] = React.useState(null)
      const [people, setPeople] = React.useState(null)
      const [hint, setHint] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [err, setErr] = React.useState('')
      const inited = React.useRef(false)
      const d = duty || {}
      const loggedIn = login.loggedIn === true
      const venvReady = d.venvReady === true
      const peers = Array.isArray(cfg && cfg.dmPeers) ? cfg.dmPeers.filter((p) => p && (p.nick || p.sec_uid)) : []

      const loadCfg = async () => {
        try {
          const r = await jget('/config')
          if (r && r.config) { setCfg(r.config); setErr('') }
          else setErr('配置返回不完整')
        } catch (e) { setErr(String((e && e.message) || e)) }
      }
      React.useEffect(() => {
        if (!active || inited.current) return
        inited.current = true
        loadCfg()
      }, [active])

      /* 登录态一变：刷新四盏灯 / 三步装机（共享登录卡不直接改 HomePanel 的 duty） */
      React.useEffect(() => {
        if (login.loggedIn === null) return
        if (typeof reloadDuty === 'function') reloadDuty()
      }, [login.loggedIn])

      const patchCfg = async (patch, label) => {
        setBusy('cfg')
        try {
          const r = await jpost('/config', patch)
          if (r && r.config) setCfg(r.config)
          setErr('')
          if (typeof say === 'function') say(label || '已保存', 'good')
        } catch (e) {
          const t = String((e && e.message) || e)
          setErr('保存失败：' + t)
          if (typeof say === 'function') say('保存失败：' + t, 'warn')
        } finally { setBusy('') }
      }
      const loadPeople = async () => {
        setBusy('people'); setHint(''); setErr('')
        try {
          const r = await jpost('/dm/people', {})
          if (r && r.ok) {
            setPeople(Array.isArray(r.people) ? r.people : [])
            setHint(r.hint || '')
          } else {
            setPeople([])
            setHint((r && (r.hint || r.error)) || '读不到会话列表')
          }
        } catch (e) {
          setPeople([])
          setErr('读不到会话列表：' + String((e && e.message) || e))
        } finally { setBusy('') }
      }
      const addPeer = async (p) => {
        if (!p || !(p.nick || p.sec_uid)) return
        const exists = peers.some((x) => (p.sec_uid && x.sec_uid === p.sec_uid) || (x.nick && x.nick === p.nick))
        if (exists) return
        await patchCfg({ dmPeers: peers.concat([{ nick: p.nick || '', sec_uid: p.sec_uid || '' }]) },
          '已把「' + (p.nick || '这个人') + '」加进分享对象')
      }
      const removePeer = async (i) => {
        await patchCfg({ dmPeers: peers.filter((_, j) => j !== i) }, '已移除一个分享对象')
      }
      const onInstall = async () => {
        setBusy('install')
        try {
          await jpost('/install', {})
          if (typeof say === 'function') say('开始装依赖，进度看日志', 'good')
          if (typeof reloadDuty === 'function') reloadDuty()
        } catch (e) { setErr('装依赖失败：' + String((e && e.message) || e)) }
        finally { setBusy('') }
      }
      const Step = (done, num) => h('span', { 'data-dh-step': '', 'data-dh-done': done ? '' : undefined }, done ? '✓' : String(num))

      return h('div', { 'data-dh-stack': '' },
        h(DhLoginCard, { login, say }),
        h('div', { className: 'dh-card', 'data-dh-connect-steps': '' },
          h('div', { className: 'dh-row' },
            h('div', { className: 'dh-grow', 'data-dh-stack': '' },
              h('div', { className: 'dh-card-title' }, '三步装机'),
              h('div', { className: 'dh-sub' }, '照 ①②③ 走一遍就能用；装环境和登录都由插件自己做。')),
            h('span', { className: 'dh-badge', 'data-dh-tone': (venvReady && loggedIn) ? 'good' : 'warn' },
              (venvReady && loggedIn) ? '就绪' : '未就绪')),
          h('div', { className: 'dh-row' },
            Step(venvReady, 1),
            h('div', { className: 'dh-grow' }, h('div', { className: 'dh-sub' }, venvReady ? '运行环境好了' : '装运行环境（约 30 秒，一次就够）')),
            venvReady ? null : h('button', {
              className: 'dh-btn', 'data-dh-primary': '', disabled: busy === 'install', onClick: onInstall,
            }, busy === 'install' ? '装着…' : '装环境')),
          h('div', { className: 'dh-row' },
            Step(loggedIn, 2),
            h('div', { className: 'dh-grow' }, h('div', { className: 'dh-sub' }, loggedIn ? '已登录，可以刷了' : '扫码登录抖音（点上面登录卡里的「扫码登录」）'))),
          h('div', { className: 'dh-row' },
            Step(venvReady && loggedIn, 3),
            h('div', { className: 'dh-grow' }, h('div', { className: 'dh-sub' },
              (venvReady && loggedIn) ? '都好了 —— 回「概览」点「叫她现在刷一轮」' : '装好 + 登录后就能用')),
            h('button', { className: 'dh-mini', onClick: () => { if (typeof reloadDuty === 'function') reloadDuty() } }, '刷新状态'))),
        h('div', { className: 'dh-card', 'data-dh-connect-share': '' },
          h('div', { className: 'dh-row' },
            h('div', { className: 'dh-grow', 'data-dh-stack': '' },
              h('div', { className: 'dh-card-title' }, '分享（发给谁）'),
              h('div', { className: 'dh-sub' }, '她刷到值得看的，会以分享卡片发给下面这些人；不选就只写报告、不往抖音发东西。')),
            cfg
              ? h('button', {
                className: 'dh-tab',
                'data-dh-active': cfg.autoSend ? '' : undefined,
                disabled: busy === 'cfg',
                onClick: () => patchCfg({ autoSend: !cfg.autoSend },
                  cfg.autoSend ? '已关闭自动发送（只写报告）' : '已打开自动发送'),
              }, cfg.autoSend ? '自动发送：开' : '自动发送：关')
              : null),
          h('div', { className: 'dh-sub' }, '⚠️ 只管「插件自己在后台跑的轮次」；你当场在对话里让它发，不受这个开关影响。'),
          h('div', { className: 'dh-row' },
            h('button', {
              className: 'dh-mini', disabled: !loggedIn || busy === 'people', onClick: loadPeople,
            }, busy === 'people' ? '读取中…' : (people === null ? '从我的会话里选' : '重新读取')),
            peers.length ? h('span', { className: 'dh-sub' }, '已选 ' + peers.length + ' 人') : null),
          !loggedIn ? h('div', { className: 'dh-sub' }, '（先在上面登录，才能读到你的会话列表）') : null,
          peers.length
            ? h('div', { className: 'dh-list' },
              peers.map((p, i) => h('div', { key: 'peer' + i, className: 'dh-item' },
                h('div', { className: 'dh-row' },
                  h('div', { className: 'dh-grow', 'data-dh-stack': '' },
                    h('div', { className: 'dh-item-title' }, p.nick || (p.sec_uid ? String(p.sec_uid).slice(0, 10) + '…' : '（没名字）')),
                    p.sec_uid ? null : h('div', { className: 'dh-sub' }, '群聊 · 可能发不出（网页端限制）')),
                  h('button', {
                    className: 'dh-mini', 'data-dh-danger': '', disabled: busy === 'cfg', onClick: () => removePeer(i),
                  }, '移除')))))
            : h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '还没选分享对象 —— 不选就只写报告，不往抖音发东西。'),
          people && people.length
            ? h('div', { className: 'dh-list', style: { maxHeight: '240px' } },
              people.map((p, i) => {
                const added = peers.some((x) => (p.sec_uid && x.sec_uid === p.sec_uid) || (x.nick && x.nick === p.nick))
                return h('button', {
                  key: 'pp' + i, className: 'dh-tab', style: { textAlign: 'left' },
                  'data-dh-active': added ? '' : undefined,
                  disabled: busy === 'cfg' || added,
                  onClick: () => addPeer(p),
                }, (p.nick || '（没名字）') + (p.is_group ? ' · 群' : '') + (added ? ' ✓ 已加入' : ''))
              }))
            : null,
          hint ? h('div', { className: 'dh-sub' }, hint) : null,
          err ? h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '读取失败：' + err) : null))
    }

    /* ── 总面板：tab 切换 + snapshot 拉取/轮询 ── */
    function HomePanel() {
      const [snap, setSnap] = React.useState(null)
      const [snapErr, setSnapErr] = React.useState('')
      const [duty, setDuty] = React.useState(null)   // /api/douyin-duty/status（登录 / 环境 / 今日额度）
      const [acct, setAcct] = React.useState(null)   // /api/douyin-home/account（四盏灯的真值）
      const [tab, setTab] = React.useState('overview')
      const [flash, setFlash] = React.useState(null)
      const flashTimer = React.useRef(null)
      const alive = React.useRef(true)

      const say = (text, tone) => {
        setFlash({ text: String(text || ''), tone: tone || '' })
        if (flashTimer.current) clearTimeout(flashTimer.current)
        flashTimer.current = setTimeout(() => { if (alive.current) setFlash(null) }, 4200)
      }

      /** 拉一次快照。失败不清空旧数据（只顶上挂一行「刷新失败」）。 */
      const loadSnap = async () => {
        try {
          const r = await homeGet('/snapshot')
          if (!r || r.ok === false) throw new Error((r && (r.error || r.hint)) || '返回不完整')
          setSnap(r)
          setSnapErr('')
        } catch (e) { setSnapErr(homeErrText(e)) }
      }

      /** 拉一次 duty 状态（登录 / 环境 / 今日额度）—— 概览的四盏灯和连接 tab 用 */
      const loadDuty = async () => {
        try {
          const r = await jget('/status')
          if (r) setDuty(r)
        } catch { /* duty 状态读不到就保留旧值（灯显示未知，不吓人） */ }
      }

      /** 拉一次「她的家」账号态（/account：昵称+alive、cookie、无头 Chrome、health）—— 四盏灯真值 */
      const loadAcct = async () => {
        try {
          const r = await homeGet('/account')
          if (r && r.ok !== false) setAcct(r)
        } catch { /* /account 挂了就保留旧值；四盏灯退回 duty 兜底 */ }
      }

      React.useEffect(() => {
        alive.current = true
        loadSnap()
        loadDuty()
        loadAcct()
        // 每 10 秒刷一次，但只在页面可见时（切到后台就不打扰）
        const t = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'visible') { loadSnap(); loadDuty(); loadAcct() }
        }, 10_000)
        const onVis = () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'visible') { loadSnap(); loadDuty(); loadAcct() }
        }
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', onVis)
        return () => {
          alive.current = false
          clearInterval(t)
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') document.removeEventListener('visibilitychange', onVis)
          if (flashTimer.current) clearTimeout(flashTimer.current)
        }
      }, [])

      const TABS = [
        ['overview', '概览', DhOverviewTab],
        ['today', '今天', DhTodayTab],
        ['persona', '人设', DhPersonaTab],
        ['worldprompt', '世界提示词', DhWorldPromptTab],
        ['memory', '记忆', DhMemoryTab],
        ['reach', '主动联系', DhReachTab],
        ['connect', '连接', DhConnectTab],
      ]
      const version = snap && snap.version
      const now = snap && snap.now

      return h('div', { className: 'dh-page', 'data-dh-page': '' },
        h('div', { 'data-dh-head': '' },
          h('div', { className: 'dh-grow', 'data-dh-stack': '' },
            h('div', { className: 'dh-title' }, '她的家'),
            h('div', { className: 'dh-sub' },
              '这一页改的是「她是谁」—— 人设、记忆、今天刷了什么；登录/装机/分享在「连接」里。'
              + (now ? '（数据时间 ' + dhTime(now) + '）' : ''))),
          h('span', {
            className: 'dh-badge',
            title: '面板构建号（改完面板对一下这个数就知道浏览器有没有拿到新代码）',
          }, '面板 b' + PANEL_BUILD + (version ? ' · v' + version : ''))),
        snapErr ? h('div', { className: 'dh-msg', 'data-dh-tone': 'warn' }, '刷新失败：' + snapErr) : null,
        flash ? h('div', { className: 'dh-msg', 'data-dh-tone': flash.tone || 'good' }, flash.text) : null,
        h('div', { 'data-dh-tabs': '' },
          TABS.map((x) => h('button', {
            key: x[0], className: 'dh-tab', 'data-dh-active': tab === x[0] ? '' : undefined,
            onClick: () => setTab(x[0]),
          }, x[1]))),
        TABS.map((x) => h('div', {
          key: x[0], 'data-dh-tabpane': x[0],
          style: tab === x[0] ? undefined : { display: 'none' },
        }, h(x[2], {
          snap, snapErr, duty, acctData: acct,
          active: tab === x[0], say,
          reload: loadSnap, reloadDuty: loadDuty, reloadAcct: loadAcct,
        }))))
    }

    /* ── 错误边界：这一段自己炸了不能连累「刷抖音」那段 ── */
    class HomeBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { err: null }
      }
      static getDerivedStateFromError(err) {
        return { err: String((err && err.message) || err) }
      }
      render() {
        if (this.state.err) {
          return h('div', { className: 'dh-card', 'data-dh-page': '' },
            h('div', { className: 'dh-title' }, '⚠️「她的家」这页出错了'),
            h('div', { className: 'dh-sub' }, this.state.err),
            h('div', { className: 'dh-row' },
              h('button', { className: 'dh-btn', onClick: () => this.setState({ err: null }) }, '重试')))
        }
        return this.props.children
      }
    }

    /** 注册「她的家」：独立样式 + 独立 settings.section（id/order 都和「刷抖音」分开）。
     *  任何一步失败都不影响已注册的「刷抖音」段。 */
    function applyHomeSection(ctx, slots) {
      try {
        if (typeof document !== 'undefined' && typeof HOME_CSS === 'string' && HOME_CSS) {
          const style = document.createElement('style')
          style.setAttribute('data-plugin-css', 'dsh-douyin-scroll-home')
          style.textContent = HOME_CSS
          document.head.appendChild(style)
          if (typeof ctx.effect === 'function') ctx.effect(() => () => style.remove(), 'dsh-douyin-scroll: 她的家样式')
        }
        if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'douyin-home', order: 32, label: '她的家' },
          () => h(HomeBoundary, null, h(HomePanel)),
        ))
      } catch (e) {
        try { console.warn('[douyin-home] 注册失败（不影响「刷抖音」段）', e) } catch { /* 忽略 */ }
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-douyin-scroll')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-douyin-scroll: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'douyin-scroll', order: 31, label: '刷抖音' },
          () => h(Boundary, null, h(Panel)),
        ))
        /* ⭐ 「她的家」控制台（2026-10-27）：**独立一段** —— 样式、组件、注册逻辑
         *    全部在文件末尾（HOME_CSS / HomePanel / applyHomeSection）。
         *    这里只留一行调用：不改动上面「刷抖音」段的任何 state / hook / 组件。 */
        applyHomeSection(ctx, slots)
        // ⭐ 桌面小宠（2026-10-24 v3）：她整个搬去独立插件 dsh-deskpet ——
        //    这里不再注册任何浮层/窗口（开关和功能都在 dsh-deskpet 插件里）。
      },
    }
  },
})

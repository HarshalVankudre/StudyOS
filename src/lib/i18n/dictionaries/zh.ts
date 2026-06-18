import type { Dictionary } from "./en";

// 简体中文（zh-CN）—— 规范英文字典的翻译。
export const zh = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS —— 由 AI 打造的学习工作空间",
    homeDescription:
      "描述你的课程与截止日期，StudyOS 即刻为你搭建仪表盘、计划表和作业追踪器。专为学生打造的 AI 学习工作空间。",
    appTitle: "你的工作空间 · StudyOS",
    generateTitle: "生成你的工作空间 · StudyOS",
    pricingTitle: "定价 · StudyOS",
    pricingDescription:
      "对比 StudyOS 免费版与 Pro 版。免费开始，想要最强大的模型、无限次生成和优先支持时再升级。",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "语言",
    choose: "选择语言",
  },

  // ---- Shared bits used on more than one surface ------------------------
  common: {
    openApp: "打开应用",
    signIn: "登录",
    getStarted: "开始使用",
    cancel: "取消",
  },

  // ---- Landing page ------------------------------------------------------
  landing: {
    nav: {
      howItWorks: "工作原理",
      features: "功能",
      pricing: "定价",
      openApp: "打开应用",
      signIn: "登录",
      getStarted: "开始使用",
    },
    hero: {
      badge: "为学生与研究者打造",
      titleLine1: "你的整个学期，",
      titleLine2: "井井有条。",
      subtitle:
        "用一句话描述你的课程，StudyOS 就为你搭建所需的仪表盘、计划表和追踪器 —— 而且已经填好内容。无需模板，没有空白页。",
      ctaGenerate: "生成我的工作空间",
      ctaDemo: "查看演示",
      finePrint: "免费开始 · 无需信用卡 · 几秒即成",
    },
    builtFor: {
      label: "适用于",
      items: [
        "计算机科学",
        "医学预科",
        "法律",
        "MBA",
        "高中",
        "研究生",
      ],
    },
    how: {
      title: "一句话，生成完整工作空间。",
      subtitle: "三步，约十秒钟。",
      steps: [
        {
          title: "描述你的课程",
          body: "一句话即可 —— “我是医学预科生，正在学解剖学、生物化学和生理学。”",
        },
        {
          title: "获得完整工作空间",
          body: "课程、作业看板、计划表和阅读清单 —— 已为你搭建并填好内容。",
        },
        {
          title: "学习并随时调整",
          body: "随意编辑、勾选任务、用日常语言提出修改。一切都会自动保存。",
        },
      ],
    },
    features: {
      title: "学期所需，应有尽有。",
      subtitle: "一步为你生成 —— 之后随你打磨。",
      items: {
        generate: {
          k: "生成",
          title: "为你量身打造的工作空间",
          body: "一句提示即可生成贴合你具体课程的完整工作空间。",
        },
        databases: {
          k: "数据库",
          title: "真正结构化的数据",
          body: "作业、成绩和阅读以带自定义字段的表格呈现 —— 而非零散的笔记。",
        },
        calendar: {
          k: "日历",
          title: "计划表与日历",
          body: "所有截止日期集中一处。一键在表格、看板和日历之间切换。",
        },
        dashboard: {
          k: "仪表盘",
          title: "清晰的大本营",
          body: "一个页面汇总你的整周安排，让你随时知道下一步该做什么。",
        },
        autosave: {
          k: "自动保存",
          title: "编辑即刻保存",
          body: "重命名、勾选、新增行 —— 每一处改动都会在你操作的瞬间自动保存。",
        },
        assistant: {
          k: "助手",
          title: "用日常语言提问",
          body: "“给计算机科学加一场期中考。”你的工作空间会当着你的面自动更新。",
        },
      },
    },
    pricing: {
      title: "简单、对学生友好的定价。",
      subtitle: "免费开始。需要更多时再升级。",
      perMonth: "/月",
      free: {
        name: "免费",
        price: "$0",
        features: [
          "生成 AI 工作空间",
          "编辑并自动保存一切",
          "仪表盘、数据库、日历",
          "用日常语言要求修改",
        ],
        cta: "开始使用",
      },
      pro: {
        badge: "最受欢迎",
        name: "Pro",
        price: "$5",
        features: [
          "包含免费版的全部功能",
          "无限次生成",
          "最聪明、最详尽的模型",
          "优先支持",
        ],
        cta: "免费开始，随时升级",
      },
    },
    closing: {
      titleLine1: "别再忙于搭建。",
      titleLine2: "开始学习吧。",
      subtitle: "你的第一个工作空间，只差一句话。",
      cta: "生成我的工作空间",
    },
    footer: {
      tagline: "专为学生打造的学习工作空间 · © 2026",
    },
    preview: {
      name: "计算机科学学习总部",
      thisWeek: "本周",
      columns: { todo: "待办", doing: "进行中", done: "已完成" },
      cards: ["证明测验", "链表实验", "实验报告 2"],
      coursesLabel: "课程",
      courses: ["数据结构", "离散数学", "物理 I"],
    },
  },

  // ---- Pricing page (/pricing) ------------------------------------------
  pricing: {
    nav: { openApp: "打开应用", signIn: "登录", getStarted: "开始使用" },
    badge: "简单、对学生友好的定价",
    title: "免费开始。准备好了再升级。",
    subtitle:
      "整理学期所需的一切都是免费的。Pro 版增加最强大的模型、无限次生成和优先支持。",
    free: {
      name: "免费",
      price: "$0",
      tagline: "整理所需，一应俱全。",
      bullets: [
        "AI 生成的学习工作空间",
        "完整的行内编辑与自动保存",
        "数据库 —— 表格、看板和日历",
        "在工作空间内与 AI 智能体对话",
      ],
      ctaSignedOut: "免费开始使用",
      ctaSignedIn: "打开你的工作空间",
      bulletCredits: "{count} 个入门 AI 积分",
    },
    pro: {
      badge: "最受欢迎",
      name: "Pro",
      price: "$5",
      perMonth: "/月",
      billed: "按月计费 · 随时取消。",
      bullets: [
        "包含免费版的全部功能",
        "无限次生成工作空间",
        "最强大、最详尽的模型",
        "优先支持与抢先体验",
      ],
      currentPlan: "✦ 你当前的方案",
      manageBilling: "管理账单",
      upgrade: "升级到 Pro",
      ctaSignedOut: "开始使用 Pro",
      bulletCredits: "包含 {count} 个 AI 积分",
    },
    comparison: {
      title: "方案对比",
      featuresHeader: "功能",
      freeHeader: "免费",
      proHeader: "Pro",
      included: "包含",
      notIncluded: "不包含",
      features: {
        aiWorkspaces: "AI 生成的工作空间",
        onboarding: "引导式上手问题",
        editing: "完整的行内编辑与自动保存",
        databases: "数据库 —— 表格、看板和日历",
        dragDrop: "拖放式编辑",
        agentChat: "可编辑工作空间的 AI 智能体对话",
        model: "生成模型",
        generations: "工作空间生成次数",
        support: "支持",
        earlyAccess: "新功能抢先体验",
        credits: "包含的 AI 积分",
        buyMore: "随时购买更多积分",
      },
      values: {
        standard: "标准",
        mostCapable: "最强大",
        generous: "充裕",
        unlimited: "无限",
        community: "社区",
        priority: "优先",
      },
    },
    credits: {
      heading: "AI 由积分驱动",
      intro:
        "每次 AI 请求都会按其工作量消耗积分 —— 一个小调整花费一点点，搭建整个工作空间则花费更多。Pro 自带充足积分，你也可以随时充值。",
      freeIncludes: "免费版包含 {count} 个入门积分",
      proIncludes: "Pro 版包含 {count} 个积分",
      neverExpire: "随时充值 —— 积分永不过期",
      balance: "你的余额：{count} 个积分",
      pack: "积分包",
      unit: "积分",
      buy: "购买 {count} 个积分",
      signUpToBuy: "注册以购买积分",
      oneTime: "一次性购买 · 安全结账",
    },
    faqTitle: "常见问题",
    faq: [
      {
        q: "StudyOS 真的可以免费开始吗？",
        a: "是的。创建账户即可在免费版上生成、编辑和使用你的工作空间 —— 无需信用卡。",
      },
      {
        q: "Pro 版能带给我什么？",
        a: "无限次生成、用于打造更丰富更精准工作空间的最强大模型、优先支持，以及新功能的抢先体验。",
      },
      {
        q: "我可以随时取消吗？",
        a: "随时都可以。在账单门户中管理或取消订阅 —— 在当前周期结束前你仍可继续使用 Pro。",
      },
      {
        q: "如果我降级，我的工作空间会怎样？",
        a: "不会删除任何内容。你的工作空间保持原样，在免费版上仍可完全编辑。",
      },
    ],
    ctaTitle: "你的第一个工作空间，只差一句话。",
    ctaSubtitle: "免费试用 StudyOS —— 想要更多时再升级。",
    ctaSignedIn: "生成一个工作空间",
    ctaSignedOut: "免费开始使用",
    footerTagline: "专为学生打造的学习工作空间 · © 2026",
  },

  // ---- Workspaces list (/app) -------------------------------------------
  app: {
    pro: "Pro",
    manage: "管理",
    upgrade: "升级到 Pro",
    generate: "生成",
    upgradedBanner: "你已是 Pro 用户 —— 你的工作空间现在使用更聪明的模型。",
    title: "你的工作空间",
    subtitle: "StudyOS 为你打造的一切。",
    total: "共 {count} 个",
    emptyTitle: "还没有工作空间",
    emptySubtitle: "生成一个，或加载演示来逛逛看。",
    emptyGenerate: "生成一个工作空间",
    loadDemo: "加载演示",
    updatedAt: "更新于 {date}",
    fallbackIcon: "📄",
  },

  // ---- Generate flow (/generate) ----------------------------------------
  generate: {
    backToWorkspaces: "你的工作空间 →",
    examples: [
      { emoji: "💻", text: "我是计算机科学大一学生，正在修 5 门课" },
      {
        emoji: "⚕️",
        text: "医学预科大二：解剖学、生物化学、生理学、有机化学",
      },
      { emoji: "🎓", text: "高二学生，正为期末备考 6 门科目" },
      {
        emoji: "📈",
        text: "MBA 学生，正在修微观经济学、会计和市场营销",
      },
    ],
    planSteps: [
      "正在阅读你的描述",
      "正在构思合适的问题",
      "正在定制你的方案",
    ],
    planningTitle: "正在了解你",
    errorGeneric: "出了点问题。请重试。",
    errorBuild: "生成你的工作空间时出了点问题。请重试。",
    describe: {
      step: "第 1 步，共 2 步",
      title: "你在学什么？",
      subtitle:
        "用日常语言描述你的课程和目标。StudyOS 会问几个简短的问题，然后围绕你的回答设计整个工作空间。",
      placeholder:
        "例如：我是计算机科学大一学生，本学期在修数据结构、离散数学、微积分 II 和学术写作。",
      shortcut: "⌘ / Ctrl + Enter",
      continue: "继续",
      examplesLabel: "拿不准？从示例开始",
      finePrint: "免费 · 无需信用卡 · 几秒即成",
    },
    questions: {
      back: "← 编辑描述",
      step: "第 2 步，共 2 步",
      title: "来定制一下",
      designingFor: "正在为以下内容设计：",
      pickAny: "可多选",
      pickOne: "请选一项",
      build: "搭建我的工作空间",
      answeredNone: "回答几个，或直接搭建 —— 由你决定",
      answeredCount: "已回答 {n} / {total}",
    },
  },

  // ---- Generation activity (full-screen build progress) -----------------
  genActivity: {
    building: "正在搭建你的工作空间",
    designing: "正在设计你的工作空间",
    componentsChosen: "已为你选好的组件",
    planningComponents: "正在规划组件",
    onlyRelevant: "只包含与你回答相关的页面和追踪器。",
    componentsCount: "{count} 个组件",
    everythingEditable:
      "生成的一切都可编辑 —— 页面、字段、视图、行和内容。",
    statusReady: "就绪",
    statusGenerating: "生成中…",
    statusQueued: "排队中",
    finishingUp: "正在收尾",
    yourWorkspace: "你的工作空间",
    pagesLabel: "页面",
    sectionsBuilt: "已搭建 {built} / {total} 个部分",
    choosingPieces: "正在为你挑选合适的组件……",
    stillEditable: "一切准备就绪后仍可随时编辑",
    writingItIn: "正在写入……",
    board: { todo: "待办", doing: "进行中", done: "已完成" },
    phase: {
      analyzing: "正在分析你的回答",
      planning: "正在选择组件",
      generating: "正在生成工作空间",
      validating: "正在校验数据",
      saving: "正在保存",
    },
  },

  // ---- AiActivity overlay (calm spinner used during planning) -----------
  aiActivity: {
    defaultTitle: "正在处理",
    defaultSteps: [
      "正在阅读你的工作空间",
      "正在规划改动",
      "正在设计布局",
      "正在写入",
    ],
  },

  // ---- Workspace editor chrome ------------------------------------------
  editor: {
    workspaceIcon: "工作空间图标",
    newPage: "新建页面",
    untitled: "无标题",
    allWorkspaces: "← 所有工作空间",
    deletePage: "删除页面",
    askAi: "询问 AI",
    closeAgent: "关闭智能体",
    saving: "正在保存…",
    saveFailed: "保存失败",
    saved: "已保存",
  },

  // ---- In-workspace AI agent chat ---------------------------------------
  agentChat: {
    title: "AI 智能体",
    subtitleIdle: "理解你的整个工作空间",
    closeChat: "关闭对话",
    suggestions: [
      "添加一个习惯追踪器",
      "制定一份为期两周的期末复习计划",
      "给每门课添加一场期中考",
      "本周我应该重点关注什么？",
    ],
    intro:
      "你可以让我修改某一项，也可以协调整个工作空间的更新。若有任何不清楚之处，我会在编辑前先询问你。",
    workspaceUpdated: "工作空间已更新",
    buildingUpdate: "正在生成你的更新",
    steps: {
      inspect: "检查工作空间",
      decide: "决定最稳妥的操作",
      prepare: "准备协调更新",
    },
    phase: {
      inspecting: "正在审阅你的工作空间",
      planning: "正在规划最稳妥的改动",
      updating: "正在协调工作空间的更新",
      validating: "正在检查每一处关联",
      saving: "正在保存你的改动",
    },
    areaStatus: { queued: "排队中", working: "更新中", complete: "就绪" },
    initialMessage: "正在打开你的工作空间",
    placeholderBusy: "智能体正在处理…",
    placeholderIdle: "让智能体搭建或修改点什么…",
    send: "发送",
    inputHint: "回车发送 · Shift+Enter 换行",
    errorRequestFailed: "智能体请求失败",
    errorEndedUnexpectedly: "智能体响应意外中断",
    errorSnag: "智能体遇到了点问题。请重试。",
    errorCouldntComplete:
      "我无法稳妥地完成该操作。请重试，或让请求更具体一些。",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    pageIcon: "页面图标",
    headingLevel: "标题级别",
    calloutIcon: "标注图标",
    addBlock: "+ 添加块",
    deleteBlock: "删除块",
    blockTypes: {
      paragraph: "文本",
      heading: "标题",
      todo: "待办",
      bulleted_list_item: "列表",
      numbered_list_item: "编号",
      quote: "引用",
      callout: "标注",
      divider: "分隔线",
      database: "表格",
    },
    placeholders: {
      paragraph: "输入点什么…",
      todo: "待办",
      listItem: "列表项",
      callout: "标注",
    },
    headingDefault: "标题",
    newTable: {
      name: "新建表格",
      propName: "名称",
      propStatus: "状态",
      propDue: "截止",
      statusTodo: "待办",
      statusInProgress: "进行中",
      statusDone: "已完成",
      viewTable: "表格",
    },
  },

  // ---- Database views (table / board / calendar) ------------------------
  db: {
    databaseIcon: "数据库图标",
    nameAria: "数据库名称",
    newRow: "+ 新建行",
    newCard: "+ 新建",
    untitled: "无标题",
    empty: "—",
    deleteRow: "删除行",
    deleteCard: "删除卡片",
    dragHint: "拖到另一列",
    prevMonth: "上一月",
    nextMonth: "下一月",
    addOnDay: "在这一天添加",
    clickToRename: "点击重命名",
    delete: "删除",
  },

  // ---- Database settings panel ------------------------------------------
  dbSettings: {
    customize: "自定义字段与视图",
    description: "描述",
    descriptionPlaceholder: "这个追踪器的用途",
    fields: "字段",
    addField: "+ 添加字段",
    fieldName: "字段名称",
    fieldType: "字段类型",
    deleteField: "删除字段",
    newField: "新字段",
    chooseRelatedDatabase: "选择关联数据库",
    optionLabel: "选项标签",
    addOption: "+ 选项",
    newOption: "新选项",
    views: "视图",
    addView: "+ 添加视图",
    viewName: "视图名称",
    newView: "新视图",
    deleteView: "删除视图",
    groupBy: "分组依据…",
    dateField: "日期字段…",
    deleteDatabase: "删除此数据库",
    deleteConfirm: "删除“{name}”并将其从每个页面移除？",
    propertyTypes: {
      text: "文本",
      number: "数字",
      checkbox: "复选框",
      date: "日期",
      select: "单选",
      multi_select: "多选",
      status: "状态",
      url: "网址",
      relation: "关联",
    },
    viewTypes: {
      table: "表格",
      board: "看板",
      calendar: "日历",
      list: "列表",
      gallery: "画廊",
    },
    defaults: {
      statusTodo: "待办",
      statusInProgress: "进行中",
      statusDone: "已完成",
      option1: "选项 1",
      option2: "选项 2",
    },
  },

  // ---- Default onboarding questions (no-API-key fallback) ----------------
  onboarding: {
    level: {
      question: "你的学习阶段是？",
      options: {
        hs: "高中",
        ug: "本科",
        grad: "硕士 / 研究生",
        self: "自学",
      },
    },
    load: { question: "你同时在应付多少门课？" },
    track: {
      question: "你最想追踪什么？",
      options: {
        assign: "作业",
        exams: "考试",
        read: "阅读",
        notes: "笔记",
        habits: "学习习惯",
        grades: "成绩",
      },
    },
    style: {
      question: "你喜欢怎样做计划？",
      options: { cal: "按日历", board: "按看板", list: "简单列表" },
    },
  },

  // ---- Server-emitted AI progress + errors ------------------------------
  ai: {
    generate: {
      phase: {
        analyzing: "正在阅读你的课程、目标和偏好",
        planning: "正在选择合适的工作空间组件",
        generating: "正在一次性生成你完整的工作空间",
        validating: "正在检查关联、视图、字段和起始数据",
        saving: "正在保存你可编辑的工作空间",
      },
      error:
        "无法生成工作空间。请用更简短的描述重试。",
      detail: {
        dashboard: "已连接 {count} 个可编辑页面",
        courses: "已添加 {count} 门课程",
        trackedItems: "已添加 {count} 个追踪项",
        scheduled: "已安排 {count} 个项目",
        readings: "已添加 {count} 个阅读项",
        habits: "已添加 {count} 项日常安排",
        grades: "已添加 {count} 行成绩",
        notes: "已创建可编辑的笔记结构",
        generic: "组件已创建并连接",
      },
    },
    agent: {
      inspecting: "正在审阅 {pages} 个页面和 {databases} 个数据库",
      inspectingArea: "正在审阅 {area}",
      planning: "正在理解请求并检查是否存在歧义",
      updating: "正在为你的工作空间应用协调一致的改动",
      validating: "正在检查引用、视图、字段和关联数据",
      saving: "正在保存更新后的工作空间",
      workspaceNotFound: "未找到工作空间。",
      error:
        "智能体无法稳妥地完成该请求。请重试，或让请求更具体一些。",
      fallbackReply: "已更新你的工作空间。",
    },
    errors: {
      notAuthenticated: "未通过身份验证",
      invalidAgentRequest: "无效的智能体请求",
      describeBeforeGenerating:
        "请先描述你的学习情况，再生成工作空间。",
    },
  },

  // ---- Credits ----------------------------------------------------------
  credits: {
    label: "AI 积分",
    amount: "{count} 个积分",
    buy: "购买积分",
    spentOn: "用于 AI 生成和智能体编辑。",
    addedBanner: "已添加 {added} 个积分 —— 你现在共有 {total} 个。",
    outGenerate:
      "你的 AI 积分已用完。请在定价页面添加更多积分以继续生成。",
    outAgent:
      "你的 AI 积分已用完。请在定价页面添加更多积分以继续使用智能体。",
  },

  // ---- Account menu -----------------------------------------------------
  account: {
    pro: "Pro",
    free: "免费",
    fallbackName: "账户",
    viewProfile: "查看个人资料",
    manageProfile: "管理个人资料",
    subscriptionPayments: "订阅与付款",
    buyCredits: "购买积分",
    settings: "设置",
    signOut: "退出登录",
    manageAccount: "管理账户",
    creditsAndPlan: "{credits} 个积分 · {plan}",
  },

  // ---- Account settings page --------------------------------------------
  settings: {
    metaTitle: "账户设置 · StudyOS",
    back: "← 工作空间",
    title: "账户设置",
    subtitle: "管理你的个人资料、方案、付款和积分。",
    profile: "个人资料",
    yourAccount: "你的账户",
    subscription: "订阅",
    proDesc:
      "你已是 Pro 用户 —— 享受最强大的模型和优先支持。可在下方管理你的订阅、付款方式和发票。",
    freeDesc:
      "你正在使用免费方案。升级到 Pro 即可获得最强大的模型、包含的积分和优先支持。",
    manageSubscription: "管理订阅与付款",
    upgrade: "升级到 Pro",
    comparePlans: "对比方案",
    creditsDesc:
      "积分为每次 AI 请求提供动力。随时充值 —— 积分永不过期。",
    buyPack: "购买 {count} 个积分 · ${price}",
    viewPricing: "查看定价",
    signOut: "退出登录",
  },

  // ---- Workspace card (delete control) ----------------------------------
  workspaceCard: {
    delete: "删除工作空间",
    deleteAria: "删除 {name}",
    deleteConfirm:
      "删除“{name}”？\n\n这将永久移除该工作空间及其中的一切。此操作无法撤销。",
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
  mock: {
    workspaceName: "学习总部",
    workspaceNameField: "{field}学习总部",
    welcome:
      "根据你的描述生成：“{summary}”。这里的一切都是起点，你都可以编辑。",
    tbd: "待定",
    status: { notStarted: "未开始", inProgress: "进行中", done: "已完成" },
    type: { homework: "作业", quiz: "测验", exam: "考试", project: "项目" },
    exam: { midterm: "期中考", final: "期末考" },
    courses: {
      name: "课程",
      description: "你本学期正在修的每一门课。",
      propCourse: "课程",
      propCode: "课程代码",
      propInstructor: "授课教师",
      propCredits: "学分",
      propSchedule: "上课时间",
      viewAll: "全部课程",
    },
    assignments: {
      name: "作业",
      description: "作业、测验、项目和考试。",
      propName: "作业",
      propCourse: "课程",
      propType: "类型",
      propStatus: "状态",
      propDue: "截止",
      propWeight: "权重 %",
      viewAll: "全部",
      viewBoard: "按状态",
      viewCalendar: "日历",
      projectMilestone: "项目里程碑 {n} —— {code}",
    },
    readings: {
      name: "阅读清单",
      description: "按课程整理的阅读内容。",
      propTitle: "标题",
      propCourse: "课程",
      propRead: "已读",
      propLink: "链接",
      viewAll: "阅读清单",
      coreReading: "{course}：核心阅读",
    },
    habits: {
      name: "学习习惯",
      description: "一个轻量的每周坚持度追踪器。",
      propHabit: "习惯",
      propDate: "日期",
      propDone: "已完成",
      propMinutes: "分钟数",
      viewAll: "全部习惯",
      viewCalendar: "日历",
      reviewNotes: "复习今天的笔记",
      practiceRecall: "练习回忆",
    },
    grades: {
      name: "成绩追踪器",
      description: "每门课可编辑的分数与权重。",
      propItem: "评估项",
      propCourse: "课程",
      propScore: "得分",
      propOutOf: "满分",
      propWeight: "权重 %",
      viewAll: "全部成绩",
      assessmentN: "评估项 {n}",
    },
    pages: {
      dashboard: "仪表盘",
      courses: "课程",
      assignments: "作业",
      planner: "计划表",
      readings: "阅读清单",
      exams: "备考",
      notes: "笔记",
      habits: "学习习惯",
      grades: "成绩追踪器",
    },
    dashboard: {
      assignmentsHeading: "📌 按状态划分的作业",
      coursesHeading: "📚 我的课程",
    },
    assignmentsPage: { intro: "你需要完成的一切，附带截止日期和权重。" },
    plannerPage: { intro: "你的截止日期，铺排在日历上。" },
    examsPage: {
      callout:
        "确认日期，然后把每场考试拆分成复习主题和练习场次。",
    },
    notesPage: {
      heading: "课程笔记",
      callout:
        "为每节课添加一个标题，然后在下面记录要点和疑问。",
      fallbackCourse: "课程",
      startWriting: "从这里开始写…",
    },
    gradesPage: {
      callout:
        "用你教学大纲里的权重和实际成绩替换这些起始评估项。",
    },
    plan: {
      summaryWith: "围绕{focus}打造的定制工作空间。",
      summaryGeneric:
        "为课程、截止日期和学习规划打造的定制工作空间。",
      components: {
        dashboard: {
          label: "仪表盘",
          description: "你的学期、优先事项和即将到来的截止日期。",
        },
        courses: {
          label: "课程",
          description: "课程详情、时间安排和授课教师。",
        },
        assignments: {
          label: "作业",
          description: "课业、截止日期、权重和状态。",
        },
        planner: {
          label: "计划表",
          description: "以日历视图呈现待办的工作。",
        },
        readings: {
          label: "阅读清单",
          description: "指定读物和阅读进度。",
        },
        exams: {
          label: "备考",
          description: "考试日期、主题和复习任务。",
        },
        notes: {
          label: "笔记",
          description: "为课程笔记提供结构化的归处。",
        },
        habits: {
          label: "学习习惯",
          description: "每日学习日常与坚持度。",
        },
        grades: {
          label: "成绩追踪器",
          description: "分数、权重和成绩目标。",
        },
      },
    },
  },
} satisfies Dictionary;

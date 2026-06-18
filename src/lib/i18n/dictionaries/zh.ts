import type { Dictionary } from "./en";

/** Simplified Chinese (zh-CN) — translation of the canonical English dictionary. */
export const zh = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS —— 由 AI 打造的学习工作空间",
    homeDescription:
      "只需描述你的课程与截止日期，StudyOS 便会即刻为你搭建仪表盘、计划表和作业追踪器。专为学生打造的 AI 学习工作空间。",
    appTitle: "你的工作空间 · StudyOS",
    generateTitle: "生成你的工作空间 · StudyOS",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "语言",
    choose: "选择语言",
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
      badge: "专为学生与研究者打造",
      titleLine1: "你的整个学期，",
      titleLine2: "井井有条。",
      subtitle:
        "用一句话描述你的课程，StudyOS 就会为你搭建好所需的仪表盘、计划表和追踪器——并且已经填好了内容。无需模板，没有空白页。",
      ctaGenerate: "生成我的工作空间",
      ctaDemo: "查看演示",
      finePrint: "免费起步 · 无需信用卡 · 数秒即成",
    },
    builtFor: {
      label: "适用于",
      items: [
        "计算机科学",
        "医学预科",
        "法律",
        "工商管理硕士",
        "高中",
        "研究生",
      ],
    },
    how: {
      title: "一句话，变成一个完整的工作空间。",
      subtitle: "三步搞定，约十秒钟。",
      steps: [
        {
          title: "描述你的课程",
          body: "一句话——「我是医学预科生，正在学解剖学、生物化学和生理学。」",
        },
        {
          title: "获得完整的工作空间",
          body: "课程、作业看板、计划表和阅读清单——已为你搭建好并填入内容。",
        },
        {
          title: "学习并随时调整",
          body: "随意编辑、勾选任务，用日常语言提出修改请求。一切都会自动保存。",
        },
      ],
    },
    features: {
      title: "一个学期所需的一切。",
      subtitle: "一步为你生成——之后随你塑造。",
      items: {
        generate: {
          k: "生成",
          title: "为你量身打造的工作空间",
          body: "一句提示，即可生成完全贴合你课程的完整工作空间。",
        },
        databases: {
          k: "数据库",
          title: "真实、结构化的数据",
          body: "作业、成绩和阅读以带自定义字段的表格呈现——而不是零散的笔记。",
        },
        calendar: {
          k: "日历",
          title: "计划表与日历",
          body: "所有截止日期集中一处。一键在表格、看板和日历之间切换。",
        },
        dashboard: {
          k: "仪表盘",
          title: "清晰的主页",
          body: "一个页面汇总你的整周安排，让你随时知道接下来要做什么。",
        },
        autosave: {
          k: "自动保存",
          title: "编辑即刻保存",
          body: "重命名、勾选、添加行——每一处改动都在你操作的瞬间自动保存。",
        },
        assistant: {
          k: "助手",
          title: "用日常语言提问",
          body: "「给 CS 加一场期中考。」你的工作空间会当着你的面自动更新。",
        },
      },
    },
    pricing: {
      title: "简单、对学生友好的定价。",
      subtitle: "免费起步。想要更多时再升级。",
      perMonth: "/月",
      free: {
        name: "免费",
        price: "$0",
        features: [
          "生成 AI 工作空间",
          "编辑并自动保存一切",
          "仪表盘、数据库、日历",
          "用日常语言提出修改",
        ],
        cta: "开始使用",
      },
      pro: {
        badge: "最受欢迎",
        name: "Pro",
        price: "$5",
        features: [
          "免费版的全部功能",
          "无限次生成",
          "最智能、最精细的模型",
          "优先支持",
        ],
        cta: "免费开始，随时升级",
      },
    },
    closing: {
      titleLine1: "别再忙于搭建。",
      titleLine2: "开始学习吧。",
      subtitle: "你的第一个工作空间，只需一句话。",
      cta: "生成我的工作空间",
    },
    footer: {
      tagline: "专为学生打造的学习工作空间 · © 2026",
    },
    // The little workspace mockup in the hero.
    preview: {
      name: "CS 学习总部",
      thisWeek: "本周",
      columns: { todo: "待办", doing: "进行中", done: "已完成" },
      cards: ["证明测验", "链表实验", "实验报告 2"],
      coursesLabel: "课程",
      courses: ["数据结构", "离散数学", "物理 I"],
    },
  },

  // ---- Workspaces list (/app) -------------------------------------------
  app: {
    pro: "Pro",
    manage: "管理",
    upgrade: "升级到 Pro",
    generate: "生成",
    upgradedBanner: "你已开通 Pro——你的工作空间现在使用更智能的模型。",
    title: "你的工作空间",
    subtitle: "StudyOS 为你打造的一切。",
    total: "共 {count} 个",
    emptyTitle: "还没有工作空间",
    emptySubtitle: "生成一个，或加载演示来四处看看。",
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
      { emoji: "🎓", text: "高三学生，正在为期末考备考 6 门科目" },
      {
        emoji: "📈",
        text: "工商管理硕士学生，正在修微观经济学、会计学和市场营销",
      },
    ],
    planSteps: [
      "正在阅读你的描述",
      "正在构思合适的问题",
      "正在为你定制设置",
    ],
    buildSteps: [
      "正在规划你的课程",
      "正在设计你的仪表盘",
      "正在排布你的计划表",
      "正在组装工作空间",
    ],
    planningTitle: "正在了解你",
    buildingTitle: "正在搭建你的工作空间",
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
      finePrint: "免费 · 无需信用卡 · 数秒即成",
    },
    questions: {
      back: "← 编辑描述",
      step: "第 2 步，共 2 步",
      title: "我们来量身定制",
      designingFor: "正在为以下内容设计：",
      pickAny: "任选",
      pickOne: "单选",
      build: "搭建我的工作空间",
      answeredNone: "答几个，或者直接搭建——由你决定",
      answeredCount: "已回答 {n} / {total}",
    },
  },

  // ---- AI activity overlay ----------------------------------------------
  aiActivity: {
    defaultTitle: "正在处理",
    defaultSteps: [
      "正在阅读你的工作空间",
      "正在规划改动",
      "正在设计布局",
      "正在写入",
    ],
    updatingTitle: "正在更新你的工作空间",
  },

  // ---- Workspace editor --------------------------------------------------
  editor: {
    newPage: "新建页面",
    untitled: "无标题",
    allWorkspaces: "← 全部工作空间",
    deletePage: "删除页面",
    askAi: "问 AI",
    aiPlaceholder:
      "让 AI 修改这个工作空间——「给 CS 加一场期中考」「制定期末复习计划」「添加习惯追踪器」……",
    aiWorking: "处理中……",
    aiApply: "应用",
    aiClose: "关闭",
    aiError: "无法应用——请尝试换个说法或简化请求。",
    saving: "保存中……",
    saveFailed: "保存失败",
    saved: "已保存",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    addBlock: "+ 添加块",
    cancel: "取消",
    deleteBlock: "删除块",
    blockTypes: {
      paragraph: "文本",
      heading: "标题",
      todo: "待办",
      bulleted_list_item: "列表",
      callout: "标注",
      divider: "分隔线",
      database: "表格",
    },
    placeholders: {
      paragraph: "输入点什么……",
      todo: "待办",
      listItem: "列表项",
      callout: "标注",
    },
    headingDefault: "标题",
    // Defaults for a brand-new table inserted via "+ Add block → Table".
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
    nameAria: "数据库名称",
    newRow: "+ 新建行",
    newCard: "+ 新建",
    untitled: "无标题",
    empty: "—",
    link: "链接 ↗",
    linked: "已关联 {count} 项",
    deleteRow: "删除行",
    deleteCard: "删除卡片",
    dragHint: "拖动到另一列",
    prevMonth: "上个月",
    nextMonth: "下个月",
    addOnDay: "添加到这一天",
    clickToRename: "点击重命名",
    delete: "删除",
  },

  // ---- Default onboarding questions (no-API-key fallback) ----------------
  onboarding: {
    level: {
      question: "你的学习阶段是？",
      options: {
        hs: "高中",
        ug: "本科",
        grad: "研究生 / 博士后",
        self: "自学",
      },
    },
    load: {
      question: "你同时在应对多少门课程？",
      // 1–2, 3–4, 5–6, 7+ stay numeric across locales (see onboarding.ts).
    },
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
      options: {
        cal: "按日历",
        board: "按看板",
        list: "简单清单",
      },
    },
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
  // The fixed labels the rule-based generator emits so the offline experience
  // is localized too. Course names derive from the user's own prompt.
  mock: {
    workspaceName: "学习总部",
    workspaceNameField: "{field} 学习总部",
    welcome:
      "根据你的描述生成：「{summary}」。这里的一切都是可供你编辑的起点。",
    tbd: "待定",
    status: { notStarted: "未开始", inProgress: "进行中", done: "已完成" },
    type: { homework: "作业", quiz: "测验", exam: "考试", project: "项目" },
    exam: { midterm: "期中考", final: "期末考" },
    courses: {
      name: "课程",
      description: "你本学期所修的每一门课。",
      propCourse: "课程",
      propCode: "代码",
      propInstructor: "授课老师",
      propCredits: "学分",
      propSchedule: "上课时间",
      viewAll: "所有课程",
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
      description: "一个轻量的每周坚持追踪器。",
      propHabit: "习惯",
      propDate: "日期",
      propDone: "已完成",
      propMinutes: "分钟",
      viewAll: "所有习惯",
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
      viewAll: "所有成绩",
      assessmentN: "评估项 {n}",
    },
    pages: {
      dashboard: "仪表盘",
      courses: "课程",
      assignments: "作业",
      planner: "计划表",
      readings: "阅读清单",
      exams: "考试备考",
      notes: "笔记",
      habits: "学习习惯",
      grades: "成绩追踪器",
    },
    dashboard: {
      assignmentsHeading: "📌 按状态划分的作业",
      coursesHeading: "📚 我的课程",
    },
    assignmentsPage: { intro: "你需要完成的一切，附带截止日期和权重。" },
    plannerPage: { intro: "你的截止日期在日历上一目了然。" },
    examsPage: {
      callout:
        "确认日期，然后把每场考试拆分成复习专题和练习环节。",
    },
    notesPage: {
      heading: "课程笔记",
      callout:
        "为每节课添加一个标题，然后在下面记录要点和疑问。",
      fallbackCourse: "课程",
      startWriting: "在这里开始书写……",
    },
    gradesPage: {
      callout:
        "把起始的评估项替换成你课程大纲中的权重和实际成绩。",
    },
    // Workspace component plan (labels + descriptions shown in the loader).
    plan: {
      summaryWith: "一个围绕 {focus} 量身打造的工作空间。",
      summaryGeneric:
        "一个用于课程、截止日期和学习规划的量身定制工作空间。",
      components: {
        dashboard: {
          label: "仪表盘",
          description: "你的学期、优先事项和接下来的截止日期。",
        },
        courses: {
          label: "课程",
          description: "课程详情、上课时间和授课老师。",
        },
        assignments: {
          label: "作业",
          description: "课业、截止日期、权重和状态。",
        },
        planner: {
          label: "计划表",
          description: "以日历视图呈现接下来的工作。",
        },
        readings: {
          label: "阅读清单",
          description: "指定读物和阅读进度。",
        },
        exams: {
          label: "考试备考",
          description: "考试日期、专题和复习任务。",
        },
        notes: {
          label: "笔记",
          description: "为课程笔记打造的结构化空间。",
        },
        habits: {
          label: "学习习惯",
          description: "每日学习例程与坚持度。",
        },
        grades: {
          label: "成绩追踪器",
          description: "分数、权重和成绩目标。",
        },
        projects: {
          label: "项目",
          description: "较大工作的里程碑与下一步行动。",
        },
      },
    },
  },
} satisfies Dictionary;

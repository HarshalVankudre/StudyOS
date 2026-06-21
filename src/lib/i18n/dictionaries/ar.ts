import type { Dictionary } from "./en";

// Arabic (ar) — ترجمة عربية فصحى للقاموس الإنجليزي المرجعي.
export const ar = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS — مساحة دراستك، يبنيها الذكاء الاصطناعي",
    homeDescription:
      "صِف موادك ومواعيدك النهائية، ويبني لك StudyOS فورًا لوحات المعلومات والمخططات ومتتبعات الواجبات. مساحة الدراسة المدعومة بالذكاء الاصطناعي للطلاب.",
    appTitle: "مساحات عملك · StudyOS",
    generateTitle: "أنشئ مساحة عملك · StudyOS",
    pricingTitle: "الأسعار · StudyOS",
    pricingDescription:
      "قارن بين StudyOS المجاني وPro. ابدأ مجانًا وارقَ عندما تريد النموذج الأقوى، وإنشاءات غير محدودة، ودعمًا ذا أولوية.",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "اللغة",
    choose: "اختر اللغة",
  },

  // ---- Shared bits used on more than one surface ------------------------
  common: {
    openApp: "افتح التطبيق",
    signIn: "تسجيل الدخول",
    getStarted: "ابدأ الآن",
    cancel: "إلغاء",
  },

  // ---- Landing page ------------------------------------------------------
  landing: {
    nav: {
      howItWorks: "كيف يعمل",
      features: "المزايا",
      pricing: "الأسعار",
      openApp: "افتح التطبيق",
      signIn: "تسجيل الدخول",
      getStarted: "ابدأ الآن",
    },
    hero: {
      badge: "مصمم للطلاب والباحثين",
      titleLine1: "فصلك الدراسي بالكامل،",
      titleLine2: "منظَّم.",
      subtitle:
        "صِف موادك في جملة واحدة، ويُعدّ لك StudyOS لوحات المعلومات والمخططات والمتتبعات التي تحتاجها — مُعبّأة مسبقًا. لا قوالب، ولا صفحات فارغة.",
      ctaGenerate: "أنشئ مساحة عملي",
      ctaDemo: "شاهد عرضًا توضيحيًا",
      finePrint: "ابدأ مجانًا · بلا بطاقة ائتمان · جاهز خلال ثوانٍ",
    },
    builtFor: {
      label: "مصمم لأجل",
      items: [
        "علوم الحاسوب",
        "الطب التحضيري",
        "القانون",
        "ماجستير إدارة الأعمال",
        "المرحلة الثانوية",
        "الدراسات العليا",
      ],
    },
    how: {
      title: "من جملة واحدة إلى مساحة عمل متكاملة.",
      subtitle: "ثلاث خطوات، نحو عشر ثوانٍ.",
      steps: [
        {
          title: "صِف موادك",
          body: "جملة واحدة — «أنا في الطب التحضيري وأدرس التشريح والكيمياء الحيوية ووظائف الأعضاء.»",
        },
        {
          title: "احصل على مساحة عمل كاملة",
          body: "المواد، ولوحة واجبات، ومخطِّط، وقائمة قراءة — جاهزة ومُعبّأة مسبقًا.",
        },
        {
          title: "ادرس وعدِّل",
          body: "عدِّل أي شيء، وأنجِز المهام، واطلب التغييرات بلغة بسيطة. كل شيء يُحفظ تلقائيًا.",
        },
      ],
    },
    features: {
      title: "كل ما يحتاجه الفصل الدراسي.",
      subtitle: "يُنشأ لك في خطوة واحدة — ثم يصبح ملكك لتشكّله كما تشاء.",
      items: {
        generate: {
          k: "إنشاء",
          title: "مساحات عمل مصممة لأجلك",
          body: "أمرٌ واحد يتحول إلى مساحة عمل كاملة مفصّلة على مقاس موادك بالضبط.",
        },
        databases: {
          k: "قواعد بيانات",
          title: "بيانات حقيقية ومنظَّمة",
          body: "الواجبات والدرجات والقراءات كجداول بحقول مخصّصة — لا مجرد ملاحظات متناثرة.",
        },
        calendar: {
          k: "تقويم",
          title: "مخطِّط وتقويم",
          body: "كل موعد نهائي في مكان واحد. بدِّل بين الجدول واللوحة والتقويم بنقرة.",
        },
        dashboard: {
          k: "لوحة المعلومات",
          title: "قاعدة انطلاق واضحة",
          body: "صفحة تجمع أسبوعك بأكمله كي تعرف دائمًا ما هو التالي.",
        },
        autosave: {
          k: "حفظ تلقائي",
          title: "عدِّل، ويُحفظ فورًا",
          body: "أعِد التسمية، وأنجِز المهام، وأضِف صفوفًا — كل تغيير يُحفظ من تلقاء نفسه لحظة إجرائه.",
        },
        assistant: {
          k: "مساعد",
          title: "اطلب بلغة بسيطة",
          body: "«أضِف اختبارًا نصفيًا لمادة علوم الحاسوب.» تتحدّث مساحة عملك بنفسها أمام عينيك.",
        },
      },
    },
    pricing: {
      title: "أسعار بسيطة وملائمة للطلاب.",
      subtitle: "ابدأ مجانًا. ارقَ فقط عندما تريد المزيد.",
      perMonth: "/شهر",
      free: {
        name: "مجاني",
        price: "$0",
        features: [
          "إنشاء مساحات عمل بالذكاء الاصطناعي",
          "تحرير كل شيء وحفظه تلقائيًا",
          "لوحات معلومات وقواعد بيانات وتقويم",
          "اطلب التحرير بلغة بسيطة",
        ],
        cta: "ابدأ الآن",
      },
      pro: {
        badge: "الأكثر رواجًا",
        name: "Pro",
        price: "$5",
        features: [
          "كل ما في الخطة المجانية",
          "إنشاءات غير محدودة",
          "النموذج الأذكى والأكثر تفصيلًا",
          "دعم ذو أولوية",
        ],
        cta: "ابدأ مجانًا، وارقَ في أي وقت",
      },
    },
    closing: {
      titleLine1: "توقّف عن الإعداد.",
      titleLine2: "ابدأ بالدراسة.",
      subtitle: "مساحة عملك الأولى على بُعد جملة واحدة.",
      cta: "أنشئ مساحة عملي",
    },
    footer: {
      tagline: "مساحة الدراسة للطلاب · © 2026",
    },
    preview: {
      name: "مركز دراسة علوم الحاسوب",
      thisWeek: "هذا الأسبوع",
      columns: { todo: "للإنجاز", doing: "قيد التنفيذ", done: "منجز" },
      cards: ["اختبار البراهين", "مختبر القائمة المترابطة", "تقرير المختبر 2"],
      coursesLabel: "المواد",
      courses: ["هياكل البيانات", "الرياضيات المتقطعة", "الفيزياء 1"],
    },
  },

  // ---- Pricing page (/pricing) ------------------------------------------
  pricing: {
    nav: { openApp: "افتح التطبيق", signIn: "تسجيل الدخول", getStarted: "ابدأ الآن" },
    badge: "أسعار بسيطة وملائمة للطلاب",
    title: "ابدأ مجانًا. ارقَ عندما تكون مستعدًا.",
    subtitle:
      "كل ما تحتاجه لتنظيم فصلك الدراسي مجاني. وتضيف خطة Pro النموذج الأقوى، وإنشاءات غير محدودة، ودعمًا ذا أولوية.",
    free: {
      name: "مجاني",
      price: "$0",
      tagline: "كل ما يلزم للتنظيم.",
      bullets: [
        "مساحات دراسة مُنشأة بالذكاء الاصطناعي",
        "تحرير ضمني كامل وحفظ تلقائي",
        "قواعد بيانات — جدول ولوحة وتقويم",
        "محادثة وكيل ذكاء اصطناعي داخل مساحة عملك",
      ],
      ctaSignedOut: "ابدأ مجانًا",
      ctaSignedIn: "افتح مساحات عملك",
      bulletCredits: "{count} رصيد ذكاء اصطناعي للبدء",
    },
    pro: {
      badge: "الأكثر رواجًا",
      name: "Pro",
      price: "$5",
      perMonth: "/شهر",
      billed: "يُفوتر شهريًا · ألغِ في أي وقت.",
      bullets: [
        "كل ما في الخطة المجانية",
        "إنشاءات غير محدودة لمساحات العمل",
        "النموذج الأقوى والأكثر تفصيلًا",
        "دعم ذو أولوية ووصول مبكر",
      ],
      currentPlan: "✦ خطتك الحالية",
      manageBilling: "إدارة الفوترة",
      upgrade: "الترقية إلى Pro",
      ctaSignedOut: "ابدأ مع Pro",
      bulletCredits: "{count} رصيد ذكاء اصطناعي مُضمَّن",
    },
    comparison: {
      title: "قارن الخطط",
      featuresHeader: "المزايا",
      freeHeader: "مجاني",
      proHeader: "Pro",
      included: "مُضمَّن",
      notIncluded: "غير مُضمَّن",
      features: {
        aiWorkspaces: "مساحات عمل مُنشأة بالذكاء الاصطناعي",
        onboarding: "أسئلة إعداد موجَّهة",
        editing: "تحرير ضمني كامل وحفظ تلقائي",
        databases: "قواعد بيانات — جدول ولوحة وتقويم",
        dragDrop: "تحرير بالسحب والإفلات",
        agentChat: "محادثة وكيل ذكاء اصطناعي يحرّر مساحة عملك",
        model: "نموذج الإنشاء",
        generations: "إنشاءات مساحات العمل",
        support: "الدعم",
        earlyAccess: "وصول مبكر إلى المزايا الجديدة",
        credits: "أرصدة الذكاء الاصطناعي المُضمَّنة",
        buyMore: "اشترِ مزيدًا من الأرصدة في أي وقت",
      },
      values: {
        standard: "قياسي",
        mostCapable: "الأقوى",
        generous: "سخيّ",
        unlimited: "غير محدود",
        community: "المجتمع",
        priority: "أولوية",
      },
    },
    credits: {
      heading: "يعمل الذكاء الاصطناعي بالأرصدة",
      intro:
        "يستهلك كل طلب ذكاء اصطناعي أرصدة بحسب حجم عمله — فالتعديل السريع يكلّف القليل، وبناء مساحة عمل كاملة يكلّف أكثر. تأتي Pro محمّلة بالأرصدة، ويمكنك إعادة الشحن في أي وقت.",
      freeIncludes: "تشمل الخطة المجانية {count} رصيدًا للبدء",
      proIncludes: "تشمل Pro {count} رصيدًا",
      neverExpire: "أعِد الشحن في أي وقت — الأرصدة لا تنتهي صلاحيتها",
      balance: "رصيدك: {count} رصيدًا",
      pack: "حزمة أرصدة",
      unit: "أرصدة",
      buy: "اشترِ {count} رصيدًا",
      signUpToBuy: "سجّل لشراء الأرصدة",
      oneTime: "شراء لمرة واحدة · دفع آمن",
    },
    faqTitle: "أسئلة",
    faq: [
      {
        q: "هل StudyOS مجاني فعلًا في البداية؟",
        a: "نعم. أنشئ حسابًا وأنشئ مساحات عملك وحرّرها واستخدمها على الخطة المجانية — دون الحاجة إلى بطاقة ائتمان.",
      },
      {
        q: "ماذا أحصل عليه مع Pro؟",
        a: "إنشاءات غير محدودة، والنموذج الأقوى لمساحات عمل أغنى وأدقّ، ودعم ذو أولوية، ووصول مبكر إلى المزايا الجديدة.",
      },
      {
        q: "هل يمكنني الإلغاء في أي وقت؟",
        a: "في أي وقت. أدِر اشتراكك أو ألغِه من بوابة الفوترة — وتحتفظ بـ Pro حتى نهاية الفترة.",
      },
      {
        q: "ماذا يحدث لمساحات عملي إذا خفّضت الخطة؟",
        a: "لا يُحذف شيء. تبقى مساحات عملك كما هي تمامًا وقابلة للتحرير بالكامل على الخطة المجانية.",
      },
    ],
    ctaTitle: "مساحة عملك الأولى على بُعد جملة واحدة.",
    ctaSubtitle: "جرّب StudyOS مجانًا — وارقَ فقط إن أردت المزيد.",
    ctaSignedIn: "أنشئ مساحة عمل",
    ctaSignedOut: "ابدأ مجانًا",
    footerTagline: "مساحة الدراسة للطلاب · © 2026",
  },

  // ---- Workspaces list (/app) -------------------------------------------
  app: {
    pro: "Pro",
    manage: "إدارة",
    upgrade: "الترقية إلى Pro",
    generate: "إنشاء",
    upgradedBanner: "أنت على خطة Pro — تستخدم مساحات عملك الآن النموذج الأذكى.",
    title: "مساحات عملك",
    subtitle: "كل ما بناه لك StudyOS.",
    total: "{count} الإجمالي",
    emptyTitle: "لا توجد مساحات عمل بعد",
    emptySubtitle: "أنشئ واحدة، أو حمِّل العرض التوضيحي لتستكشف.",
    emptyGenerate: "أنشئ مساحة عمل",
    loadDemo: "حمِّل العرض التوضيحي",
    updatedAt: "حُدِّثت في {date}",
    fallbackIcon: "📄",
  },

  // ---- Generate flow (/generate) ----------------------------------------
  generate: {
    backToWorkspaces: "مساحات عملك →",
    examples: [
      { emoji: "💻", text: "أنا طالب علوم حاسوب في السنة الأولى وأدرس 5 مواد" },
      {
        emoji: "⚕️",
        text: "طالب طب تحضيري في السنة الثانية: التشريح، الكيمياء الحيوية، وظائف الأعضاء، الكيمياء العضوية",
      },
      { emoji: "🎓", text: "طالب ثانوي في السنة قبل الأخيرة أدرس 6 مواد للاختبارات النهائية" },
      {
        emoji: "📈",
        text: "طالب ماجستير إدارة أعمال يدرس الاقتصاد الجزئي والمحاسبة والتسويق",
      },
    ],
    planSteps: [
      "نقرأ وصفك",
      "نفكّر في أسئلة جيدة",
      "نفصّل إعدادك على مقاسك",
    ],
    planningTitle: "نتعرّف إليك",
    errorGeneric: "حدث خطأ ما. يُرجى المحاولة مرة أخرى.",
    errorBuild: "حدث خطأ ما أثناء إنشاء مساحة عملك. حاول مرة أخرى.",
    describe: {
      step: "الخطوة 1 من 2",
      title: "ماذا تدرس؟",
      subtitle:
        "صِف موادك وأهدافك بلغة بسيطة. يطرح StudyOS سؤالين سريعين، ثم يصمّم مساحة العمل بأكملها حول إجاباتك.",
      placeholder:
        "مثال: أنا طالب علوم حاسوب في السنة الأولى وأدرس هياكل البيانات والرياضيات المتقطعة والتفاضل والتكامل 2 والكتابة الأكاديمية هذا الفصل.",
      shortcut: "⌘ / Ctrl + Enter",
      continue: "متابعة",
      examplesLabel: "غير متأكد؟ ابدأ من مثال",
      finePrint: "مجاني · بلا بطاقة ائتمان · جاهز خلال ثوانٍ",
    },
    questions: {
      back: "← تعديل الوصف",
      step: "الخطوة 2 من 2",
      title: "لنفصّلها على مقاسك",
      designingFor: "نصمّم لأجل:",
      pickAny: "اختر أيًّا منها",
      pickOne: "اختر واحدًا",
      build: "ابنِ مساحة عملي",
      answeredNone: "أجِب عن بعضها، أو ابنِها مباشرةً — القرار لك",
      answeredCount: "{n} / {total} تمت الإجابة عنها",
      other: "أخرى",
      otherPlaceholder: "اكتب تفضيلك الخاص…",
      otherAria: "إجابة أخرى عن {question}",
    },
  },

  // ---- Generation activity (full-screen build progress) -----------------
  genActivity: {
    building: "نبني مساحة عملك",
    designing: "نصمّم مساحة عملك",
    componentsChosen: "مكوّنات اختيرت لأجلك",
    planningComponents: "نخطّط للمكوّنات",
    onlyRelevant: "فقط الصفحات والمتتبعات ذات الصلة بإجاباتك.",
    componentsCount: "{count} مكوّنات",
    everythingEditable:
      "كل ما يُنشأ يبقى قابلًا للتحرير — الصفحات والحقول والعروض والصفوف والمحتوى.",
    statusReady: "جاهز",
    statusGenerating: "جارٍ الإنشاء…",
    statusQueued: "في قائمة الانتظار",
    finishingUp: "جارٍ الإنهاء",
    yourWorkspace: "مساحة عملك",
    pagesLabel: "الصفحات",
    sectionsBuilt: "تم إنشاء {built} من {total} أقسام",
    choosingPieces: "نختار لك العناصر المناسبة…",
    stillEditable: "يبقى كل شيء قابلًا للتحرير بمجرد أن يصبح جاهزًا",
    writingItIn: "جارٍ كتابته…",
    board: { todo: "للتنفيذ", doing: "قيد التنفيذ", done: "مكتمل" },
    phase: {
      analyzing: "نحلّل إجاباتك",
      planning: "نختار المكوّنات",
      generating: "ننشئ مساحة العمل",
      validating: "نتحقق من البيانات",
      saving: "جارٍ الحفظ",
    },
  },

  // ---- AiActivity overlay (calm spinner used during planning) -----------
  aiActivity: {
    defaultTitle: "نعمل على ذلك",
    defaultSteps: [
      "نقرأ مساحة عملك",
      "نخطّط للتغييرات",
      "نصمّم التخطيط",
      "ندوّنه",
    ],
  },

  // ---- Workspace editor chrome ------------------------------------------
  editor: {
    workspaceIcon: "أيقونة مساحة العمل",
    newPage: "صفحة جديدة",
    untitled: "بلا عنوان",
    allWorkspaces: "← كل مساحات العمل",
    deletePage: "حذف الصفحة",
    askAi: "اسأل الذكاء الاصطناعي",
    closeAgent: "إغلاق الوكيل",
    saving: "جارٍ الحفظ…",
    saveFailed: "فشل الحفظ",
    saved: "تم الحفظ",
  },

  // ---- In-workspace AI agent chat ---------------------------------------
  agentChat: {
    title: "وكيل الذكاء الاصطناعي",
    subtitleIdle: "يفهم مساحة عملك بأكملها",
    closeChat: "إغلاق المحادثة",
    suggestions: [
      "أضِف متتبع عادات",
      "ضع خطة دراسة للاختبارات النهائية مدتها أسبوعان",
      "أضِف اختبارًا نصفيًا لكل مادة",
      "علامَ ينبغي أن أركّز هذا الأسبوع؟",
    ],
    intro:
      "اطلب مني تغيير عنصر واحد أو تنسيق تحديثات عبر مساحة عملك بأكملها. وإن كان شيء غير واضح، فسأسأل قبل التحرير.",
    workspaceUpdated: "تم تحديث مساحة العمل",
    undo: "تراجع",
    undoing: "جارٍ التراجع…",
    undone: "تم التراجع عن التغيير",
    undoFailed: "لا يمكن التراجع عن هذا التغيير لأن مساحة العمل قد تغيّرت.",
    buildingUpdate: "نبني تحديثك",
    thinking: "يفكر…",
    stopTask: "إيقاف المهمة",
    stopping: "جارٍ الإيقاف…",
    taskStopped: "تم إيقاف المهمة.",
    stopFailed: "تعذر إيقاف المهمة. قد تكون لا تزال قيد التشغيل.",
    steps: {
      inspect: "فحص مساحة العمل",
      decide: "تحديد الإجراء الأكثر أمانًا",
      prepare: "إعداد تحديث منسَّق",
    },
    phase: {
      inspecting: "نراجع مساحة عملك",
      planning: "نخطّط للتغيير الأكثر أمانًا",
      updating: "ننسّق تحديثات مساحة العمل",
      validating: "نتحقق من كل ارتباط",
      saving: "نحفظ تغييراتك",
    },
    areaStatus: { queued: "في قائمة الانتظار", working: "جارٍ التحديث", complete: "جاهز" },
    initialMessage: "نفتح مساحة عملك",
    placeholderBusy: "الوكيل يعمل الآن…",
    placeholderIdle: "اطلب من الوكيل أن يبني أو يغيّر شيئًا…",
    send: "إرسال",
    inputHint: "Enter للإرسال · Shift+Enter لسطر جديد",
    errorRequestFailed: "فشل طلب الوكيل",
    errorEndedUnexpectedly: "انتهت استجابة الوكيل بشكل غير متوقع",
    errorSnag: "واجه الوكيل عائقًا. يُرجى المحاولة مرة أخرى.",
    errorCouldntComplete:
      "تعذّر عليّ إتمام ذلك بأمان. حاول مرة أخرى أو اجعل طلبك أكثر تحديدًا.",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    pageIcon: "أيقونة الصفحة",
    headingLevel: "مستوى العنوان",
    calloutIcon: "أيقونة التنبيه",
    addBlock: "+ إضافة كتلة",
    deleteBlock: "حذف الكتلة",
    blockTypes: {
      paragraph: "نص",
      heading: "عنوان",
      todo: "مهمة",
      bulleted_list_item: "قائمة",
      numbered_list_item: "مرقَّمة",
      quote: "اقتباس",
      callout: "تنبيه",
      divider: "فاصل",
      database: "جدول",
      media: "صورة",
    },
    placeholders: {
      paragraph: "اكتب شيئًا…",
      todo: "مهمة",
      listItem: "عنصر قائمة",
      callout: "تنبيه",
    },
    headingDefault: "عنوان",
    newTable: {
      name: "جدول جديد",
      propName: "الاسم",
      propStatus: "الحالة",
      propDue: "الاستحقاق",
      statusTodo: "للإنجاز",
      statusInProgress: "قيد التنفيذ",
      statusDone: "منجز",
      viewTable: "جدول",
    },
  },

  // ---- Database views (table / board / calendar) ------------------------
  db: {
    databaseIcon: "أيقونة قاعدة البيانات",
    nameAria: "اسم قاعدة البيانات",
    newRow: "+ صف جديد",
    newCard: "+ جديد",
    untitled: "بلا عنوان",
    empty: "—",
    deleteRow: "حذف الصف",
    deleteCard: "حذف البطاقة",
    dragHint: "اسحب إلى عمود آخر",
    prevMonth: "الشهر السابق",
    nextMonth: "الشهر التالي",
    addOnDay: "أضِف في هذا اليوم",
    clickToRename: "انقر لإعادة التسمية",
    delete: "حذف",
  },

  // ---- Database settings panel ------------------------------------------
  dbSettings: {
    customize: "تخصيص الحقول والعروض",
    description: "الوصف",
    descriptionPlaceholder: "ما الغرض من هذا المتتبع",
    fields: "الحقول",
    addField: "+ إضافة حقل",
    fieldName: "اسم الحقل",
    fieldType: "نوع الحقل",
    deleteField: "حذف الحقل",
    newField: "حقل جديد",
    chooseRelatedDatabase: "اختر قاعدة البيانات المرتبطة",
    optionLabel: "تسمية الخيار",
    addOption: "+ خيار",
    newOption: "خيار جديد",
    views: "العروض",
    addView: "+ إضافة عرض",
    viewName: "اسم العرض",
    newView: "عرض جديد",
    deleteView: "حذف العرض",
    groupBy: "تجميع حسب…",
    dateField: "حقل التاريخ…",
    deleteDatabase: "حذف قاعدة البيانات هذه",
    deleteConfirm: "هل تريد حذف «{name}» وإزالتها من كل صفحة؟",
    propertyTypes: {
      text: "نص",
      number: "رقم",
      checkbox: "مربع اختيار",
      date: "تاريخ",
      select: "اختيار",
      multi_select: "اختيار متعدد",
      status: "الحالة",
      url: "رابط",
      relation: "علاقة",
    },
    viewTypes: {
      table: "جدول",
      board: "لوحة",
      calendar: "تقويم",
      list: "قائمة",
      gallery: "معرض",
    },
    defaults: {
      statusTodo: "للإنجاز",
      statusInProgress: "قيد التنفيذ",
      statusDone: "منجز",
      option1: "الخيار 1",
      option2: "الخيار 2",
    },
  },

  // ---- Default onboarding questions (no-API-key fallback) ----------------
  onboarding: {
    level: {
      question: "ما مستواك الدراسي؟",
      options: {
        hs: "المرحلة الثانوية",
        ug: "البكالوريوس",
        grad: "الدراسات العليا / ما بعد التخرج",
        self: "الدراسة الذاتية",
      },
    },
    load: { question: "كم عدد المواد التي توازن بينها؟" },
    track: {
      question: "ما الذي تريد تتبّعه أكثر من غيره؟",
      options: {
        assign: "الواجبات",
        exams: "الاختبارات",
        read: "القراءات",
        notes: "الملاحظات",
        habits: "عادات الدراسة",
        grades: "الدرجات",
      },
    },
    style: {
      question: "كيف تحب أن تخطّط؟",
      options: { cal: "بالتقويم", board: "باللوحة", list: "قوائم بسيطة" },
    },
  },

  // ---- Server-emitted AI progress + errors ------------------------------
  ai: {
    generate: {
      phase: {
        analyzing: "نقرأ موادك وأهدافك وتفضيلاتك",
        planning: "نختار مكوّنات مساحة العمل المناسبة",
        generating: "ننشئ مساحة عملك الكاملة في مرة واحدة",
        validating: "نتحقق من الروابط والعروض والحقول والبيانات الأولية",
        saving: "نحفظ مساحة عملك القابلة للتحرير",
      },
      error:
        "تعذّر إنشاء مساحة العمل. يُرجى المحاولة مرة أخرى بوصف أقصر.",
      detail: {
        dashboard: "{count} صفحات قابلة للتحرير مرتبطة",
        courses: "أُضيفت {count} مواد",
        trackedItems: "أُضيف {count} عنصرًا متتبَّعًا",
        scheduled: "جُدوِل {count} عنصرًا",
        readings: "أُضيف {count} عنصر قراءة",
        habits: "أُضيف {count} روتينًا",
        grades: "أُضيف {count} صف درجات",
        notes: "أُنشئ هيكل ملاحظات قابل للتحرير",
        generic: "أُنشئ المكوّن ورُبط",
      },
    },
    agent: {
      inspecting: "نراجع {pages} صفحات و{databases} قواعد بيانات",
      inspectingArea: "نراجع {area}",
      planning: "نفهم الطلب ونتحقق من أي غموض",
      updating: "نطبّق تغييرات منسَّقة عبر مساحة عملك",
      validating: "نتحقق من المراجع والعروض والحقول والبيانات المرتبطة",
      saving: "نحفظ مساحة العمل المحدَّثة",
      workspaceNotFound: "لم يُعثر على مساحة العمل.",
      workspaceChanged: "تغيّرت مساحة العمل أثناء تنفيذ الطلب. يُرجى المحاولة مرة أخرى.",
      undoUnavailable: "لا يمكن التراجع عن هذا التغيير لأن مساحة العمل تحتوي على تعديلات أحدث.",
      error:
        "تعذّر على الوكيل إتمام ذلك الطلب بأمان. يُرجى المحاولة مرة أخرى أو جعل الطلب أكثر تحديدًا.",
      fallbackReply: "حُدِّثت مساحة عملك.",
    },
    errors: {
      notAuthenticated: "لم تتم المصادقة",
      invalidAgentRequest: "طلب وكيل غير صالح",
      describeBeforeGenerating:
        "صِف دراستك قبل إنشاء مساحة عمل.",
    },
  },

  // ---- Credits ----------------------------------------------------------
  credits: {
    label: "أرصدة الذكاء الاصطناعي",
    amount: "{count} رصيدًا",
    buy: "شراء أرصدة",
    metaTitle: "شراء أرصدة · StudyOS",
    pageIntro:
      "تُشغّل الأرصدة كل طلب للذكاء الاصطناعي — إنشاء مساحات العمل والدردشة مع الوكيل. اشحن في أي وقت؛ الأرصدة لا تنتهي صلاحيتها أبدًا.",
    oneTimeExpire: "شراء لمرة واحدة · دفع آمن · الأرصدة لا تنتهي صلاحيتها أبدًا",
    wantMore: "هل تريد النموذج الأكثر قدرة وأرصدة مضمّنة؟",
    spentOn: "تُنفَق على إنشاءات الذكاء الاصطناعي وتعديلات الوكيل.",
    addedBanner: "أُضيف {added} رصيدًا — لديك الآن {total}.",
    outGenerate:
      "نفدت أرصدة الذكاء الاصطناعي لديك. أضِف المزيد من صفحة الأسعار لمواصلة الإنشاء.",
    outAgent:
      "نفدت أرصدة الذكاء الاصطناعي لديك. أضِف المزيد من صفحة الأسعار لمواصلة استخدام الوكيل.",
  },

  // ---- Account menu -----------------------------------------------------
  account: {
    pro: "Pro",
    free: "مجاني",
    fallbackName: "الحساب",
    viewProfile: "عرض الملف الشخصي",
    manageProfile: "إدارة الملف الشخصي",
    subscriptionPayments: "الاشتراك والمدفوعات",
    buyCredits: "شراء أرصدة",
    settings: "الإعدادات",
    signOut: "تسجيل الخروج",
    manageAccount: "إدارة الحساب",
    creditsAndPlan: "{credits} رصيدًا · {plan}",
  },

  // ---- Account settings page --------------------------------------------
  settings: {
    metaTitle: "إعدادات الحساب · StudyOS",
    back: "← مساحات العمل",
    title: "إعدادات الحساب",
    subtitle: "أدِر ملفك الشخصي وخطتك ومدفوعاتك وأرصدتك.",
    profile: "الملف الشخصي",
    yourAccount: "حسابك",
    subscription: "الاشتراك",
    proDesc:
      "أنت على خطة Pro — النموذج الأقوى ودعم ذو أولوية. أدِر اشتراكك وطرق الدفع والفواتير أدناه.",
    freeDesc:
      "أنت على الخطة المجانية. ارقَ إلى Pro للحصول على النموذج الأقوى والأرصدة المُضمَّنة ودعم ذي أولوية.",
    manageSubscription: "إدارة الاشتراك والمدفوعات",
    upgrade: "الترقية إلى Pro",
    comparePlans: "قارن الخطط",
    creditsDesc:
      "تشغّل الأرصدة كل طلب ذكاء اصطناعي. أعِد الشحن في أي وقت — الأرصدة لا تنتهي صلاحيتها.",
    buyPack: "اشترِ {count} رصيدًا · ${price}",
    viewPricing: "عرض الأسعار",
    signOut: "تسجيل الخروج",
  },

  // ---- Workspace card (delete control) ----------------------------------
  workspaceCard: {
    delete: "حذف مساحة العمل",
    deleteAria: "حذف {name}",
    deleteConfirm:
      "هل تريد حذف «{name}»؟\n\nيؤدي هذا إلى إزالة مساحة العمل وكل ما فيها نهائيًا. لا يمكن التراجع عن ذلك.",
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
  mock: {
    workspaceName: "مركز الدراسة",
    workspaceNameField: "مركز دراسة {field}",
    welcome:
      "أُنشئت من وصفك: «{summary}». كل ما هنا نقطة انطلاق يمكنك تحريرها.",
    tbd: "يُحدَّد لاحقًا",
    status: { notStarted: "لم يبدأ", inProgress: "قيد التنفيذ", done: "منجز" },
    type: { homework: "واجب منزلي", quiz: "اختبار قصير", exam: "اختبار", project: "مشروع" },
    exam: { midterm: "نصفي", final: "نهائي" },
    courses: {
      name: "المواد",
      description: "كل مادة تدرسها هذا الفصل.",
      propCourse: "المادة",
      propCode: "الرمز",
      propInstructor: "المُحاضِر",
      propCredits: "الساعات المعتمدة",
      propSchedule: "الجدول",
      viewAll: "كل المواد",
    },
    assignments: {
      name: "الواجبات",
      description: "واجبات منزلية واختبارات قصيرة ومشاريع واختبارات.",
      propName: "الواجب",
      propCourse: "المادة",
      propType: "النوع",
      propStatus: "الحالة",
      propDue: "الاستحقاق",
      propWeight: "النسبة %",
      viewAll: "الكل",
      viewBoard: "حسب الحالة",
      viewCalendar: "التقويم",
      projectMilestone: "مرحلة المشروع {n} — {code}",
    },
    readings: {
      name: "قائمة القراءة",
      description: "ما ينبغي قراءته، منظَّمًا حسب المادة.",
      propTitle: "العنوان",
      propCourse: "المادة",
      propRead: "مقروء",
      propLink: "الرابط",
      viewAll: "قائمة القراءة",
      coreReading: "{course}: القراءة الأساسية",
    },
    habits: {
      name: "عادات الدراسة",
      description: "متتبع أسبوعي خفيف للمواظبة.",
      propHabit: "العادة",
      propDate: "التاريخ",
      propDone: "منجز",
      propMinutes: "الدقائق",
      viewAll: "كل العادات",
      viewCalendar: "التقويم",
      reviewNotes: "راجِع ملاحظات اليوم",
      practiceRecall: "تدرّب على الاستذكار",
    },
    grades: {
      name: "متتبع الدرجات",
      description: "درجات وأوزان قابلة للتحرير لكل مادة.",
      propItem: "التقييم",
      propCourse: "المادة",
      propScore: "الدرجة",
      propOutOf: "من أصل",
      propWeight: "النسبة %",
      viewAll: "كل الدرجات",
      assessmentN: "تقييم {n}",
    },
    pages: {
      dashboard: "لوحة المعلومات",
      courses: "المواد",
      assignments: "الواجبات",
      planner: "المخطِّط",
      readings: "قائمة القراءة",
      exams: "التحضير للاختبارات",
      notes: "الملاحظات",
      habits: "عادات الدراسة",
      grades: "متتبع الدرجات",
    },
    dashboard: {
      assignmentsHeading: "📌 الواجبات حسب الحالة",
      coursesHeading: "📚 موادي",
    },
    assignmentsPage: { intro: "كل ما عليك إنجازه، مع مواعيد الاستحقاق والأوزان." },
    plannerPage: { intro: "مواعيدك النهائية مرتّبة على تقويم." },
    examsPage: {
      callout:
        "أكّد التواريخ، ثم قسّم كل اختبار إلى مواضيع مراجعة وجلسات تدريب.",
    },
    notesPage: {
      heading: "ملاحظات المادة",
      callout:
        "أضِف عنوانًا لكل محاضرة، ثم دوّن الأفكار الرئيسية والأسئلة تحته.",
      fallbackCourse: "المادة",
      startWriting: "ابدأ الكتابة هنا…",
    },
    gradesPage: {
      callout:
        "استبدل بالتقييمات الأولية أوزان مقررك الدراسي ونتائجك الفعلية.",
    },
    plan: {
      summaryWith: "مساحة عمل مفصّلة مبنية حول {focus}.",
      summaryGeneric:
        "مساحة عمل مفصّلة للمواد والمواعيد النهائية وتخطيط الدراسة.",
      components: {
        dashboard: {
          label: "لوحة المعلومات",
          description: "فصلك الدراسي وأولوياتك ومواعيدك النهائية التالية.",
        },
        courses: {
          label: "المواد",
          description: "تفاصيل المواد والجداول والمُحاضِرين.",
        },
        assignments: {
          label: "الواجبات",
          description: "الأعمال الدراسية والمواعيد النهائية والأوزان والحالة.",
        },
        planner: {
          label: "المخطِّط",
          description: "عرض تقويمي للأعمال القادمة.",
        },
        readings: {
          label: "قائمة القراءة",
          description: "النصوص المقررة وتقدّم القراءة.",
        },
        exams: {
          label: "التحضير للاختبارات",
          description: "تواريخ الاختبارات والمواضيع ومهام المراجعة.",
        },
        notes: {
          label: "الملاحظات",
          description: "مكان منظَّم لملاحظات المواد.",
        },
        habits: {
          label: "عادات الدراسة",
          description: "روتين الدراسة اليومي والمواظبة.",
        },
        grades: {
          label: "متتبع الدرجات",
          description: "الدرجات والأوزان وأهداف الدرجات.",
        },
      },
    },
  },
} satisfies Dictionary;

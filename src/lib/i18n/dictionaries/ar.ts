import type { Dictionary } from "./en";

/** Arabic (ar) — translation of the canonical English dictionary. */
export const ar = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS — مساحة دراستك، مبنية بالذكاء الاصطناعي",
    homeDescription:
      "صِف موادك الدراسية ومواعيدك النهائية، وسيبني لك StudyOS فوراً لوحات المعلومات والمخططات ومتتبعات الواجبات. مساحة الدراسة المدعومة بالذكاء الاصطناعي للطلاب.",
    appTitle: "مساحات عملك · StudyOS",
    generateTitle: "أنشئ مساحة عملك · StudyOS",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "اللغة",
    choose: "اختر اللغة",
  },

  // ---- Landing page ------------------------------------------------------
  landing: {
    nav: {
      howItWorks: "كيف يعمل",
      features: "المميزات",
      pricing: "الأسعار",
      openApp: "افتح التطبيق",
      signIn: "تسجيل الدخول",
      getStarted: "ابدأ الآن",
    },
    hero: {
      badge: "صُمّم للطلاب والباحثين",
      titleLine1: "فصلك الدراسي بأكمله،",
      titleLine2: "منظَّم.",
      subtitle:
        "صِف موادك في جملة واحدة، وسيُعدّ لك StudyOS لوحات المعلومات والمخططات والمتتبعات التي تحتاجها — جاهزةً ومعبّأة. بلا قوالب، وبلا صفحات فارغة.",
      ctaGenerate: "أنشئ مساحة عملي",
      ctaDemo: "شاهد عرضاً توضيحياً",
      finePrint: "ابدأ مجاناً · بلا بطاقة ائتمان · جاهز في ثوانٍ",
    },
    builtFor: {
      label: "مصمم لأجل",
      items: [
        "علوم الحاسوب",
        "ما قبل الطب",
        "القانون",
        "ماجستير إدارة الأعمال",
        "المرحلة الثانوية",
        "الدراسات العليا",
      ],
    },
    how: {
      title: "من جملة واحدة إلى مساحة عمل متكاملة.",
      subtitle: "ثلاث خطوات، في عشر ثوانٍ تقريباً.",
      steps: [
        {
          title: "صِف موادك الدراسية",
          body: "جملة واحدة — «أنا طالب ما قبل الطب أدرس التشريح والكيمياء الحيوية وعلم وظائف الأعضاء.»",
        },
        {
          title: "احصل على مساحة عمل كاملة",
          body: "المواد الدراسية، ولوحة للواجبات، ومخطط، وقائمة قراءة — جاهزة ومعبّأة بالفعل.",
        },
        {
          title: "ادرس وعدّل",
          body: "عدّل أي شيء، وأنجز المهام، واطلب التغييرات بلغة بسيطة. كل شيء يُحفظ تلقائياً.",
        },
      ],
    },
    features: {
      title: "كل ما يحتاجه فصلك الدراسي.",
      subtitle: "يُنشأ لك في خطوة واحدة — ثم يصبح ملكك تشكّله كما تشاء.",
      items: {
        generate: {
          k: "إنشاء",
          title: "مساحات عمل مصممة لك",
          body: "تتحوّل جملة واحدة إلى مساحة عمل متكاملة مفصّلة لموادك الدراسية بالضبط.",
        },
        databases: {
          k: "قواعد البيانات",
          title: "بيانات حقيقية ومنظَّمة",
          body: "الواجبات والدرجات والقراءات على هيئة جداول بحقول مخصصة — لا مجرد ملاحظات متناثرة.",
        },
        calendar: {
          k: "التقويم",
          title: "مخطط وتقويم",
          body: "كل موعد نهائي في مكان واحد. انتقل بين الجدول واللوحة والتقويم بنقرة واحدة.",
        },
        dashboard: {
          k: "لوحة المعلومات",
          title: "مركز انطلاق واضح",
          body: "صفحة تجمع أسبوعك بأكمله كي تعرف دائماً ما هو التالي.",
        },
        autosave: {
          k: "الحفظ التلقائي",
          title: "عدّل، ويُحفظ فوراً",
          body: "أعد التسمية، وأنجز المهام، وأضف صفوفاً — كل تغيير يحفظ نفسه لحظة إجرائه.",
        },
        assistant: {
          k: "المساعد",
          title: "اطلب بلغة بسيطة",
          body: "«أضف اختباراً نصفياً لمادة علوم الحاسوب.» تتحدّث مساحة عملك بنفسها، أمام عينيك مباشرةً.",
        },
      },
    },
    pricing: {
      title: "أسعار بسيطة ومناسبة للطلاب.",
      subtitle: "ابدأ مجاناً. وارتقِ للأعلى فقط عندما تريد المزيد.",
      perMonth: "/شهر",
      free: {
        name: "مجاني",
        price: "$0",
        features: [
          "إنشاء مساحات عمل بالذكاء الاصطناعي",
          "تعديل وحفظ كل شيء تلقائياً",
          "لوحات المعلومات وقواعد البيانات والتقويم",
          "اطلب التعديل بلغة بسيطة",
        ],
        cta: "ابدأ الآن",
      },
      pro: {
        badge: "الأكثر شيوعاً",
        name: "Pro",
        price: "$5",
        features: [
          "كل ما في الباقة المجانية",
          "إنشاءات غير محدودة",
          "النموذج الأذكى والأكثر تفصيلاً",
          "دعم ذو أولوية",
        ],
        cta: "ابدأ مجاناً، وارتقِ في أي وقت",
      },
    },
    closing: {
      titleLine1: "توقّف عن الإعداد.",
      titleLine2: "ابدأ الدراسة.",
      subtitle: "مساحة عملك الأولى على بُعد جملة واحدة.",
      cta: "أنشئ مساحة عملي",
    },
    footer: {
      tagline: "مساحة الدراسة للطلاب · © 2026",
    },
    // The little workspace mockup in the hero.
    preview: {
      name: "مركز دراسة علوم الحاسوب",
      thisWeek: "هذا الأسبوع",
      columns: { todo: "للقيام به", doing: "قيد التنفيذ", done: "منجز" },
      cards: ["اختبار البراهين", "مختبر القوائم المترابطة", "تقرير المختبر 2"],
      coursesLabel: "المواد الدراسية",
      courses: ["هياكل البيانات", "الرياضيات المتقطعة", "الفيزياء I"],
    },
  },

  // ---- Workspaces list (/app) -------------------------------------------
  app: {
    pro: "Pro",
    manage: "إدارة",
    upgrade: "الترقية إلى Pro",
    generate: "إنشاء",
    upgradedBanner: "أنت الآن على باقة Pro — مساحات عملك تستخدم الآن النموذج الأذكى.",
    title: "مساحات عملك",
    subtitle: "كل ما بناه لك StudyOS.",
    total: "{count} في المجموع",
    emptyTitle: "لا توجد مساحات عمل بعد",
    emptySubtitle: "أنشئ واحدة، أو حمّل العرض التوضيحي لتتصفح.",
    emptyGenerate: "أنشئ مساحة عمل",
    loadDemo: "تحميل العرض التوضيحي",
    updatedAt: "حُدّثت في {date}",
    fallbackIcon: "📄",
  },

  // ---- Generate flow (/generate) ----------------------------------------
  generate: {
    backToWorkspaces: "مساحات عملك →",
    examples: [
      { emoji: "💻", text: "أنا طالب علوم حاسوب في السنة الأولى أدرس 5 مواد" },
      {
        emoji: "⚕️",
        text: "طالب ما قبل الطب في السنة الثانية: التشريح، الكيمياء الحيوية، علم وظائف الأعضاء، الكيمياء العضوية",
      },
      { emoji: "🎓", text: "طالب ثانوي في السنة قبل الأخيرة أدرس 6 مواد للامتحانات النهائية" },
      {
        emoji: "📈",
        text: "طالب ماجستير إدارة أعمال أدرس الاقتصاد الجزئي والمحاسبة والتسويق",
      },
    ],
    planSteps: [
      "نقرأ وصفك",
      "نفكّر في أسئلة جيدة",
      "نُفصّل إعدادك",
    ],
    buildSteps: [
      "نخطط لموادك الدراسية",
      "نصمم لوحة معلوماتك",
      "نرتّب مخططك",
      "نجمّع مساحة العمل",
    ],
    planningTitle: "نتعرّف عليك",
    buildingTitle: "نبني مساحة عملك",
    errorGeneric: "حدث خطأ ما. يرجى المحاولة مرة أخرى.",
    errorBuild: "حدث خطأ ما أثناء إنشاء مساحة عملك. حاول مرة أخرى.",
    describe: {
      step: "الخطوة 1 من 2",
      title: "ماذا تدرس؟",
      subtitle:
        "صِف موادك الدراسية وأهدافك بلغة بسيطة. يطرح StudyOS سؤالين سريعين، ثم يصمم مساحة العمل بأكملها حول إجاباتك.",
      placeholder:
        "مثال: أنا طالب علوم حاسوب في السنة الأولى أدرس هياكل البيانات والرياضيات المتقطعة وحساب التفاضل والتكامل II والكتابة الأكاديمية هذا الفصل.",
      shortcut: "⌘ / Ctrl + Enter",
      continue: "متابعة",
      examplesLabel: "غير متأكد؟ ابدأ من مثال",
      finePrint: "مجاني · بلا بطاقة ائتمان · جاهز في ثوانٍ",
    },
    questions: {
      back: "← تعديل الوصف",
      step: "الخطوة 2 من 2",
      title: "لنفصّلها لك",
      designingFor: "نصمم لأجل:",
      pickAny: "اختر ما تشاء",
      pickOne: "اختر واحداً",
      build: "ابنِ مساحة عملي",
      answeredNone: "أجب عن بعضها، أو ابنِ فقط — القرار لك",
      answeredCount: "تمت الإجابة عن {n} / {total}",
    },
  },

  // ---- AI activity overlay ----------------------------------------------
  aiActivity: {
    defaultTitle: "نعمل عليه",
    defaultSteps: [
      "نقرأ مساحة عملك",
      "نخطط للتغييرات",
      "نصمم التخطيط",
      "ندوّنها",
    ],
    updatingTitle: "نحدّث مساحة عملك",
  },

  // ---- Workspace editor --------------------------------------------------
  editor: {
    newPage: "صفحة جديدة",
    untitled: "بلا عنوان",
    allWorkspaces: "← كل مساحات العمل",
    deletePage: "حذف الصفحة",
    askAi: "اسأل الذكاء الاصطناعي",
    aiPlaceholder:
      "اطلب من الذكاء الاصطناعي تغيير مساحة العمل هذه — «أضف اختباراً نصفياً لمادة علوم الحاسوب»، «أنشئ خطة دراسة للامتحانات النهائية»، «أضف متتبع عادات»…",
    aiWorking: "جارٍ العمل…",
    aiApply: "تطبيق",
    aiClose: "إغلاق",
    aiError: "تعذّر تطبيق ذلك — حاول إعادة الصياغة أو تبسيط الطلب.",
    saving: "جارٍ الحفظ…",
    saveFailed: "فشل الحفظ",
    saved: "تم الحفظ",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    addBlock: "+ إضافة كتلة",
    cancel: "إلغاء",
    deleteBlock: "حذف الكتلة",
    blockTypes: {
      paragraph: "نص",
      heading: "عنوان",
      todo: "مهمة",
      bulleted_list_item: "قائمة",
      callout: "تنبيه",
      divider: "فاصل",
      database: "جدول",
    },
    placeholders: {
      paragraph: "اكتب شيئاً…",
      todo: "مهمة",
      listItem: "عنصر قائمة",
      callout: "تنبيه",
    },
    headingDefault: "عنوان",
    // Defaults for a brand-new table inserted via "+ Add block → Table".
    newTable: {
      name: "جدول جديد",
      propName: "الاسم",
      propStatus: "الحالة",
      propDue: "الاستحقاق",
      statusTodo: "للقيام به",
      statusInProgress: "قيد التنفيذ",
      statusDone: "منجز",
      viewTable: "جدول",
    },
  },

  // ---- Database views (table / board / calendar) ------------------------
  db: {
    nameAria: "اسم قاعدة البيانات",
    newRow: "+ صف جديد",
    newCard: "+ جديد",
    untitled: "بلا عنوان",
    empty: "—",
    link: "رابط ↗",
    linked: "{count} مرتبط",
    deleteRow: "حذف الصف",
    deleteCard: "حذف البطاقة",
    dragHint: "اسحب إلى عمود آخر",
    prevMonth: "الشهر السابق",
    nextMonth: "الشهر التالي",
    addOnDay: "أضف في هذا اليوم",
    clickToRename: "انقر لإعادة التسمية",
    delete: "حذف",
  },

  // ---- Default onboarding questions (no-API-key fallback) ----------------
  onboarding: {
    level: {
      question: "ما هو مستواك الدراسي؟",
      options: {
        hs: "المرحلة الثانوية",
        ug: "المرحلة الجامعية",
        grad: "الدراسات العليا / ما بعد التخرج",
        self: "دراسة ذاتية",
      },
    },
    load: {
      question: "كم عدد المواد التي توازن بينها؟",
      // 1–2, 3–4, 5–6, 7+ stay numeric across locales (see onboarding.ts).
    },
    track: {
      question: "ما الذي ترغب أكثر في تتبّعه؟",
      options: {
        assign: "الواجبات",
        exams: "الامتحانات",
        read: "القراءات",
        notes: "الملاحظات",
        habits: "عادات الدراسة",
        grades: "الدرجات",
      },
    },
    style: {
      question: "كيف تفضّل التخطيط؟",
      options: {
        cal: "حسب التقويم",
        board: "حسب اللوحة",
        list: "قوائم بسيطة",
      },
    },
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
  // The fixed labels the rule-based generator emits so the offline experience
  // is localized too. Course names derive from the user's own prompt.
  mock: {
    workspaceName: "مركز الدراسة",
    workspaceNameField: "مركز دراسة {field}",
    welcome:
      "أُنشئ من وصفك: «{summary}». كل ما هنا هو نقطة انطلاق يمكنك تعديلها.",
    tbd: "قيد التحديد",
    status: { notStarted: "لم يبدأ", inProgress: "قيد التنفيذ", done: "منجز" },
    type: { homework: "واجب منزلي", quiz: "اختبار قصير", exam: "امتحان", project: "مشروع" },
    exam: { midterm: "اختبار نصفي", final: "امتحان نهائي" },
    courses: {
      name: "المواد الدراسية",
      description: "كل مادة تدرسها هذا الفصل.",
      propCourse: "المادة",
      propCode: "الرمز",
      propInstructor: "المحاضر",
      propCredits: "الساعات المعتمدة",
      propSchedule: "الجدول",
      viewAll: "كل المواد",
    },
    assignments: {
      name: "الواجبات",
      description: "الواجبات المنزلية والاختبارات القصيرة والمشاريع والامتحانات.",
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
      description: "ما يجب قراءته، منظّماً حسب المادة.",
      propTitle: "العنوان",
      propCourse: "المادة",
      propRead: "مقروء",
      propLink: "الرابط",
      viewAll: "قائمة القراءة",
      coreReading: "{course}: القراءة الأساسية",
    },
    habits: {
      name: "عادات الدراسة",
      description: "متتبع أسبوعي خفيف للاستمرارية.",
      propHabit: "العادة",
      propDate: "التاريخ",
      propDone: "منجز",
      propMinutes: "الدقائق",
      viewAll: "كل العادات",
      viewCalendar: "التقويم",
      reviewNotes: "راجع ملاحظات اليوم",
      practiceRecall: "تدرّب على الاستذكار",
    },
    grades: {
      name: "متتبع الدرجات",
      description: "درجات وأوزان قابلة للتعديل لكل مادة.",
      propItem: "التقييم",
      propCourse: "المادة",
      propScore: "الدرجة",
      propOutOf: "من أصل",
      propWeight: "النسبة %",
      viewAll: "كل الدرجات",
      assessmentN: "التقييم {n}",
    },
    pages: {
      dashboard: "لوحة المعلومات",
      courses: "المواد الدراسية",
      assignments: "الواجبات",
      planner: "المخطط",
      readings: "قائمة القراءة",
      exams: "التحضير للامتحانات",
      notes: "الملاحظات",
      habits: "عادات الدراسة",
      grades: "متتبع الدرجات",
    },
    dashboard: {
      assignmentsHeading: "📌 الواجبات حسب الحالة",
      coursesHeading: "📚 موادي الدراسية",
    },
    assignmentsPage: { intro: "كل ما عليك من واجبات، مع مواعيد الاستحقاق والأوزان." },
    plannerPage: { intro: "مواعيدك النهائية موضوعة على تقويم." },
    examsPage: {
      callout:
        "أكّد التواريخ، ثم قسّم كل امتحان إلى مواضيع للمراجعة وجلسات تدريب.",
    },
    notesPage: {
      heading: "ملاحظات المادة",
      callout:
        "أضف عنواناً لكل محاضرة، ثم دوّن الأفكار الرئيسية والأسئلة تحته.",
      fallbackCourse: "المادة",
      startWriting: "ابدأ الكتابة هنا…",
    },
    gradesPage: {
      callout:
        "استبدل التقييمات الأولية بأوزان مقررك ونتائجك الفعلية.",
    },
    // Workspace component plan (labels + descriptions shown in the loader).
    plan: {
      summaryWith: "مساحة عمل مفصّلة مبنية حول {focus}.",
      summaryGeneric:
        "مساحة عمل مفصّلة للمواد الدراسية والمواعيد النهائية والتخطيط للدراسة.",
      components: {
        dashboard: {
          label: "لوحة المعلومات",
          description: "فصلك الدراسي، وأولوياتك، ومواعيدك النهائية القادمة.",
        },
        courses: {
          label: "المواد الدراسية",
          description: "تفاصيل المواد، والجداول، والمحاضرون.",
        },
        assignments: {
          label: "الواجبات",
          description: "الأعمال الدراسية، والمواعيد النهائية، والأوزان، والحالة.",
        },
        planner: {
          label: "المخطط",
          description: "عرض تقويمي للأعمال القادمة.",
        },
        readings: {
          label: "قائمة القراءة",
          description: "النصوص المقررة وتقدّم القراءة.",
        },
        exams: {
          label: "التحضير للامتحانات",
          description: "تواريخ الامتحانات، والمواضيع، ومهام المراجعة.",
        },
        notes: {
          label: "الملاحظات",
          description: "مكان منظّم لملاحظات المادة.",
        },
        habits: {
          label: "عادات الدراسة",
          description: "روتين الدراسة اليومي والاستمرارية.",
        },
        grades: {
          label: "متتبع الدرجات",
          description: "الدرجات، والأوزان، وأهداف التقدير.",
        },
        projects: {
          label: "المشاريع",
          description: "المراحل والإجراءات التالية للأعمال الأكبر.",
        },
      },
    },
  },
} satisfies Dictionary;

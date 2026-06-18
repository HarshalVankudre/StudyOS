import type { Dictionary } from "./en";

/** Japanese (ja-JP) — translation of the canonical English dictionary. */
export const ja = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS — AIがつくる、あなたの学習ワークスペース",
    homeDescription:
      "履修科目と締め切りを入力するだけで、StudyOSがダッシュボード、プランナー、課題トラッカーを即座に構築します。学生のためのAI学習ワークスペース。",
    appTitle: "あなたのワークスペース · StudyOS",
    generateTitle: "ワークスペースを生成 · StudyOS",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "言語",
    choose: "言語を選択",
  },

  // ---- Landing page ------------------------------------------------------
  landing: {
    nav: {
      howItWorks: "使い方",
      features: "機能",
      pricing: "料金",
      openApp: "アプリを開く",
      signIn: "サインイン",
      getStarted: "はじめる",
    },
    hero: {
      badge: "学生と研究者のために",
      titleLine1: "学期まるごと、",
      titleLine2: "整理整頓。",
      subtitle:
        "授業を一文で説明するだけで、StudyOSが必要なダッシュボード、プランナー、トラッカーを用意します。しかも、もう中身まで入った状態で。テンプレートも、白紙のページもありません。",
      ctaGenerate: "ワークスペースを生成",
      ctaDemo: "デモを見る",
      finePrint: "無料ではじめられます · クレジットカード不要 · 数秒で完成",
    },
    builtFor: {
      label: "対応分野",
      items: [
        "コンピューターサイエンス",
        "医学部進学課程",
        "法学",
        "MBA",
        "高校",
        "大学院",
      ],
    },
    how: {
      title: "一文から、まるごとワークスペースへ。",
      subtitle: "3ステップ、約10秒。",
      steps: [
        {
          title: "授業を説明する",
          body: "たった一文で。「医学部進学課程で、解剖学・生化学・生理学を履修しています。」",
        },
        {
          title: "完成したワークスペースを受け取る",
          body: "科目、課題ボード、プランナー、リーディングリスト。すべてセットアップ済み、中身も入った状態で。",
        },
        {
          title: "学習しながら調整する",
          body: "何でも編集でき、タスクにチェックを入れ、ふつうの言葉で変更を頼めます。すべて自動保存されます。",
        },
      ],
    },
    features: {
      title: "学期に必要なものすべて。",
      subtitle: "ワンステップで生成され、あとは自由にかたちづくれます。",
      items: {
        generate: {
          k: "生成",
          title: "あなたのためのワークスペース",
          body: "ひとつのプロンプトが、あなたの履修科目にぴったり合った完全なワークスペースになります。",
        },
        databases: {
          k: "データベース",
          title: "本格的で構造化されたデータ",
          body: "課題、成績、リーディングをカスタムフィールド付きのテーブルで管理。ばらばらのメモではありません。",
        },
        calendar: {
          k: "カレンダー",
          title: "プランナーとカレンダー",
          body: "すべての締め切りをひとつの場所に。テーブル、ボード、カレンダーをワンクリックで切り替え。",
        },
        dashboard: {
          k: "ダッシュボード",
          title: "わかりやすいホーム",
          body: "一週間をまとめて見渡せるページ。次に何をすべきか、いつでも把握できます。",
        },
        autosave: {
          k: "自動保存",
          title: "編集すれば、すぐ保存",
          body: "名前の変更、チェック、行の追加。変更した瞬間に、すべて自動で保存されます。",
        },
        assistant: {
          k: "アシスタント",
          title: "ふつうの言葉で頼むだけ",
          body: "「CSに中間試験を追加して。」ワークスペースが目の前で自動的に更新されます。",
        },
      },
    },
    pricing: {
      title: "シンプルで、学生にやさしい料金。",
      subtitle: "まずは無料で。もっと使いたくなったらアップグレード。",
      perMonth: "/月",
      free: {
        name: "無料",
        price: "$0",
        features: [
          "AIワークスペースの生成",
          "編集と自動保存はすべて対応",
          "ダッシュボード、データベース、カレンダー",
          "ふつうの言葉で編集を依頼",
        ],
        cta: "はじめる",
      },
      pro: {
        badge: "いちばん人気",
        name: "Pro",
        price: "$5",
        features: [
          "無料プランのすべて",
          "無制限の生成",
          "もっとも賢く、もっとも詳細なモデル",
          "優先サポート",
        ],
        cta: "無料ではじめて、いつでもアップグレード",
      },
    },
    closing: {
      titleLine1: "準備は、もう終わり。",
      titleLine2: "さあ、学習を始めよう。",
      subtitle: "最初のワークスペースは、たった一文で。",
      cta: "ワークスペースを生成",
    },
    footer: {
      tagline: "学生のための学習ワークスペース · © 2026",
    },
    // The little workspace mockup in the hero.
    preview: {
      name: "CS学習本部",
      thisWeek: "今週",
      columns: { todo: "未着手", doing: "進行中", done: "完了" },
      cards: ["証明クイズ", "連結リスト演習", "実験レポート2"],
      coursesLabel: "科目",
      courses: ["データ構造", "離散数学", "物理学I"],
    },
  },

  // ---- Workspaces list (/app) -------------------------------------------
  app: {
    pro: "Pro",
    manage: "管理",
    upgrade: "Proにアップグレード",
    generate: "生成",
    upgradedBanner: "Proをご利用中です。ワークスペースはより賢いモデルで動作するようになりました。",
    title: "あなたのワークスペース",
    subtitle: "StudyOSがあなたのために構築したすべて。",
    total: "全{count}件",
    emptyTitle: "ワークスペースはまだありません",
    emptySubtitle: "ひとつ生成するか、デモを読み込んで見てまわりましょう。",
    emptyGenerate: "ワークスペースを生成",
    loadDemo: "デモを読み込む",
    updatedAt: "更新日 {date}",
    fallbackIcon: "📄",
  },

  // ---- Generate flow (/generate) ----------------------------------------
  generate: {
    backToWorkspaces: "あなたのワークスペース →",
    examples: [
      { emoji: "💻", text: "CS専攻の1年生で、5科目を履修しています" },
      {
        emoji: "⚕️",
        text: "医学部進学課程の2年生:解剖学、生化学、生理学、有機化学",
      },
      { emoji: "🎓", text: "高校2年生で、期末試験に向けて6科目を勉強しています" },
      {
        emoji: "📈",
        text: "MBAの学生で、ミクロ経済学、会計学、マーケティングを履修しています",
      },
    ],
    planSteps: [
      "ご説明を読み込んでいます",
      "よい質問を考えています",
      "セットアップを調整しています",
    ],
    buildSteps: [
      "科目を計画しています",
      "ダッシュボードを設計しています",
      "プランナーをレイアウトしています",
      "ワークスペースを組み立てています",
    ],
    planningTitle: "あなたについて知る",
    buildingTitle: "ワークスペースを構築中",
    errorGeneric: "問題が発生しました。もう一度お試しください。",
    errorBuild: "ワークスペースの生成中に問題が発生しました。もう一度お試しください。",
    describe: {
      step: "ステップ 1 / 2",
      title: "何を勉強していますか?",
      subtitle:
        "履修科目と目標をふつうの言葉で説明してください。StudyOSが簡単な質問をいくつかしたあと、あなたの答えに合わせてワークスペース全体を設計します。",
      placeholder:
        "例:CS専攻の1年生で、今学期はデータ構造、離散数学、微分積分II、アカデミックライティングを履修しています。",
      shortcut: "⌘ / Ctrl + Enter",
      continue: "続ける",
      examplesLabel: "迷ったら、例から始めましょう",
      finePrint: "無料 · クレジットカード不要 · 数秒で完成",
    },
    questions: {
      back: "← 説明を編集",
      step: "ステップ 2 / 2",
      title: "あなた仕様に整えましょう",
      designingFor: "対象:",
      pickAny: "いくつでも選択",
      pickOne: "ひとつ選択",
      build: "ワークスペースを構築",
      answeredNone: "いくつか答えても、そのまま構築してもOK。お好みで",
      answeredCount: "{n} / {total} 回答済み",
    },
  },

  // ---- AI activity overlay ----------------------------------------------
  aiActivity: {
    defaultTitle: "作業中",
    defaultSteps: [
      "ワークスペースを読み込んでいます",
      "変更を計画しています",
      "レイアウトを設計しています",
      "内容を書き込んでいます",
    ],
    updatingTitle: "ワークスペースを更新中",
  },

  // ---- Workspace editor --------------------------------------------------
  editor: {
    newPage: "新しいページ",
    untitled: "無題",
    allWorkspaces: "← すべてのワークスペース",
    deletePage: "ページを削除",
    askAi: "AIに頼む",
    aiPlaceholder:
      "AIにこのワークスペースの変更を頼みましょう。「CSに中間試験を追加」「期末試験の学習計画を作成」「習慣トラッカーを追加」…",
    aiWorking: "作業中…",
    aiApply: "適用",
    aiClose: "閉じる",
    aiError: "適用できませんでした。表現を変えるか、依頼を簡単にしてお試しください。",
    saving: "保存中…",
    saveFailed: "保存に失敗しました",
    saved: "保存しました",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    addBlock: "+ ブロックを追加",
    cancel: "キャンセル",
    deleteBlock: "ブロックを削除",
    blockTypes: {
      paragraph: "テキスト",
      heading: "見出し",
      todo: "ToDo",
      bulleted_list_item: "リスト",
      callout: "コールアウト",
      divider: "区切り線",
      database: "テーブル",
    },
    placeholders: {
      paragraph: "何か入力してください…",
      todo: "ToDo",
      listItem: "リスト項目",
      callout: "コールアウト",
    },
    headingDefault: "見出し",
    // Defaults for a brand-new table inserted via "+ Add block → Table".
    newTable: {
      name: "新しいテーブル",
      propName: "名前",
      propStatus: "ステータス",
      propDue: "期限",
      statusTodo: "未着手",
      statusInProgress: "進行中",
      statusDone: "完了",
      viewTable: "テーブル",
    },
  },

  // ---- Database views (table / board / calendar) ------------------------
  db: {
    nameAria: "データベース名",
    newRow: "+ 新しい行",
    newCard: "+ 新規",
    untitled: "無題",
    empty: "—",
    link: "リンク ↗",
    linked: "{count}件リンク済み",
    deleteRow: "行を削除",
    deleteCard: "カードを削除",
    dragHint: "別の列にドラッグ",
    prevMonth: "前の月",
    nextMonth: "次の月",
    addOnDay: "この日に追加",
    clickToRename: "クリックして名前を変更",
    delete: "削除",
  },

  // ---- Default onboarding questions (no-API-key fallback) ----------------
  onboarding: {
    level: {
      question: "学習レベルを教えてください。",
      options: {
        hs: "高校",
        ug: "学部",
        grad: "大学院 / 博士課程",
        self: "独学",
      },
    },
    load: {
      question: "いくつの科目を並行して進めていますか?",
      // 1–2, 3–4, 5–6, 7+ stay numeric across locales (see onboarding.ts).
    },
    track: {
      question: "もっとも管理したいものは何ですか?",
      options: {
        assign: "課題",
        exams: "試験",
        read: "リーディング",
        notes: "ノート",
        habits: "学習習慣",
        grades: "成績",
      },
    },
    style: {
      question: "どのように計画を立てたいですか?",
      options: {
        cal: "カレンダーで",
        board: "ボードで",
        list: "シンプルなリストで",
      },
    },
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
  // The fixed labels the rule-based generator emits so the offline experience
  // is localized too. Course names derive from the user's own prompt.
  mock: {
    workspaceName: "学習本部",
    workspaceNameField: "{field}学習本部",
    welcome:
      "ご説明「{summary}」から生成しました。ここにあるものはすべて、編集できる出発点です。",
    tbd: "未定",
    status: { notStarted: "未着手", inProgress: "進行中", done: "完了" },
    type: { homework: "宿題", quiz: "クイズ", exam: "試験", project: "プロジェクト" },
    exam: { midterm: "中間試験", final: "期末試験" },
    courses: {
      name: "科目",
      description: "今学期に履修するすべての授業。",
      propCourse: "科目",
      propCode: "コード",
      propInstructor: "担当教員",
      propCredits: "単位",
      propSchedule: "時間割",
      viewAll: "すべての科目",
    },
    assignments: {
      name: "課題",
      description: "宿題、クイズ、プロジェクト、試験。",
      propName: "課題",
      propCourse: "科目",
      propType: "種類",
      propStatus: "ステータス",
      propDue: "期限",
      propWeight: "比重 %",
      viewAll: "すべて",
      viewBoard: "ステータス別",
      viewCalendar: "カレンダー",
      projectMilestone: "プロジェクトのマイルストーン {n} — {code}",
    },
    readings: {
      name: "リーディングリスト",
      description: "科目ごとに整理された、読むべきもの。",
      propTitle: "タイトル",
      propCourse: "科目",
      propRead: "読了",
      propLink: "リンク",
      viewAll: "リーディングリスト",
      coreReading: "{course}:必読文献",
    },
    habits: {
      name: "学習習慣",
      description: "毎週の継続を軽やかに記録するトラッカー。",
      propHabit: "習慣",
      propDate: "日付",
      propDone: "完了",
      propMinutes: "分",
      viewAll: "すべての習慣",
      viewCalendar: "カレンダー",
      reviewNotes: "今日のノートを復習する",
      practiceRecall: "想起練習をする",
    },
    grades: {
      name: "成績トラッカー",
      description: "科目ごとに編集できる点数と比重。",
      propItem: "評価項目",
      propCourse: "科目",
      propScore: "得点",
      propOutOf: "満点",
      propWeight: "比重 %",
      viewAll: "すべての成績",
      assessmentN: "評価項目 {n}",
    },
    pages: {
      dashboard: "ダッシュボード",
      courses: "科目",
      assignments: "課題",
      planner: "プランナー",
      readings: "リーディングリスト",
      exams: "試験対策",
      notes: "ノート",
      habits: "学習習慣",
      grades: "成績トラッカー",
    },
    dashboard: {
      assignmentsHeading: "📌 ステータス別の課題",
      coursesHeading: "📚 履修科目",
    },
    assignmentsPage: { intro: "提出すべきものすべてを、期限と比重とともに。" },
    plannerPage: { intro: "締め切りをカレンダー上に並べて。" },
    examsPage: {
      callout:
        "日程を確認したら、各試験を復習トピックと練習セッションに分解しましょう。",
    },
    notesPage: {
      heading: "授業ノート",
      callout:
        "講義ごとに見出しを追加し、その下に重要なポイントと疑問を書き留めましょう。",
      fallbackCourse: "科目",
      startWriting: "ここから書き始めましょう…",
    },
    gradesPage: {
      callout:
        "最初の評価項目を、シラバスの比重と実際の結果に置き換えましょう。",
    },
    // Workspace component plan (labels + descriptions shown in the loader).
    plan: {
      summaryWith: "{focus}を中心に組み立てた、あなた仕様のワークスペース。",
      summaryGeneric:
        "科目、締め切り、学習計画のための、あなた仕様のワークスペース。",
      components: {
        dashboard: {
          label: "ダッシュボード",
          description: "学期、優先事項、次の締め切り。",
        },
        courses: {
          label: "科目",
          description: "科目の詳細、時間割、担当教員。",
        },
        assignments: {
          label: "課題",
          description: "課題、締め切り、比重、ステータス。",
        },
        planner: {
          label: "プランナー",
          description: "これからの作業をカレンダーで表示。",
        },
        readings: {
          label: "リーディングリスト",
          description: "指定された文献と読書の進捗。",
        },
        exams: {
          label: "試験対策",
          description: "試験の日程、トピック、復習タスク。",
        },
        notes: {
          label: "ノート",
          description: "授業ノートのための、整理された場所。",
        },
        habits: {
          label: "学習習慣",
          description: "毎日の学習ルーティンと継続。",
        },
        grades: {
          label: "成績トラッカー",
          description: "得点、比重、目標成績。",
        },
        projects: {
          label: "プロジェクト",
          description: "大きめの作業のマイルストーンと次のアクション。",
        },
      },
    },
  },
} satisfies Dictionary;

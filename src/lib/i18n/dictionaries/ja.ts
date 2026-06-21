import type { Dictionary } from "./en";
// 日本語（ja-JP）— StudyOS の翻訳辞書。
export const ja = {
  // ---- Document <title> / <meta> ----------------------------------------
  meta: {
    homeTitle: "StudyOS — AIがつくる、あなたの学習ワークスペース",
    homeDescription:
      "履修科目と締め切りを伝えるだけで、StudyOS がダッシュボード、プランナー、課題トラッカーをすぐに構築します。学生のためのAI学習ワークスペース。",
    appTitle: "あなたのワークスペース · StudyOS",
    generateTitle: "ワークスペースを生成 · StudyOS",
    pricingTitle: "料金 · StudyOS",
    pricingDescription:
      "StudyOS の無料プランと Pro プランを比較。まずは無料で始めて、最も高性能なモデル、無制限の生成、優先サポートが必要になったらアップグレードできます。",
    workspaceTitle: "{name} · StudyOS",
    brandFallback: "StudyOS",
  },

  // ---- Language switcher -------------------------------------------------
  language: {
    label: "言語",
    choose: "言語を選択",
  },

  // ---- Shared bits used on more than one surface ------------------------
  common: {
    openApp: "アプリを開く",
    signIn: "サインイン",
    getStarted: "始める",
    cancel: "キャンセル",
  },

  // ---- Landing page ------------------------------------------------------
  landing: {
    nav: {
      howItWorks: "使い方",
      features: "機能",
      pricing: "料金",
      openApp: "アプリを開く",
      signIn: "サインイン",
      getStarted: "始める",
    },
    hero: {
      badge: "学生と研究者のために",
      titleLine1: "学期まるごとを、",
      titleLine2: "整理する。",
      subtitle:
        "履修科目を一文で伝えるだけで、StudyOS が必要なダッシュボード、プランナー、トラッカーを用意します。すでに中身も入った状態で。テンプレートも白紙のページもありません。",
      ctaGenerate: "ワークスペースを生成",
      ctaDemo: "デモを見る",
      finePrint: "無料で開始 · クレジットカード不要 · 数秒で完成",
    },
    builtFor: {
      label: "対応分野",
      items: [
        "コンピューターサイエンス",
        "医学部進学",
        "法学",
        "MBA",
        "高校",
        "大学院",
      ],
    },
    how: {
      title: "一文から、完成されたワークスペースへ。",
      subtitle: "3ステップ、約10秒。",
      steps: [
        {
          title: "履修科目を伝える",
          body: "一文だけ —「医学部志望で解剖学、生化学、生理学を履修しています。」",
        },
        {
          title: "完成されたワークスペースを受け取る",
          body: "科目、課題ボード、プランナー、リーディングリスト — すでに設定され、中身も入った状態で。",
        },
        {
          title: "学習しながら調整する",
          body: "何でも編集でき、タスクにチェックを入れ、日常の言葉で変更を頼めます。すべて自動保存されます。",
        },
      ],
    },
    features: {
      title: "学期に必要なものを、すべて。",
      subtitle: "ワンステップで生成し、あとは自由に形づくれます。",
      items: {
        generate: {
          k: "生成",
          title: "あなた専用のワークスペース",
          body: "ひとつのプロンプトが、あなたの履修科目にぴったり合った完全なワークスペースになります。",
        },
        databases: {
          k: "データベース",
          title: "本物の構造化データ",
          body: "課題、成績、リーディングをカスタムフィールド付きのテーブルで。ただのメモではありません。",
        },
        calendar: {
          k: "カレンダー",
          title: "プランナーとカレンダー",
          body: "すべての締め切りをひとつの場所に。テーブル、ボード、カレンダーをワンクリックで切り替え。",
        },
        dashboard: {
          k: "ダッシュボード",
          title: "わかりやすいホーム",
          body: "一週間をまとめて見渡せるページで、次にやることがいつでもわかります。",
        },
        autosave: {
          k: "自動保存",
          title: "編集はすぐに保存",
          body: "名前の変更、チェック、行の追加 — どんな変更もその瞬間に自動で保存されます。",
        },
        assistant: {
          k: "アシスタント",
          title: "日常の言葉で頼むだけ",
          body: "「CSに中間試験を追加して。」と頼めば、ワークスペースが目の前で自動更新されます。",
        },
      },
    },
    pricing: {
      title: "シンプルで、学生にやさしい料金。",
      subtitle: "まずは無料で。もっと必要になったときだけアップグレード。",
      perMonth: "/月",
      free: {
        name: "無料",
        price: "$0",
        features: [
          "AIワークスペースの生成",
          "すべてを編集・自動保存",
          "ダッシュボード、データベース、カレンダー",
          "日常の言葉で編集を依頼",
        ],
        cta: "始める",
      },
      pro: {
        badge: "一番人気",
        name: "Pro",
        price: "$5",
        features: [
          "無料プランのすべて",
          "無制限の生成",
          "最も賢く、最も詳細なモデル",
          "優先サポート",
        ],
        cta: "無料で始めて、いつでもアップグレード",
      },
    },
    closing: {
      titleLine1: "準備はもう終わり。",
      titleLine2: "学習を始めよう。",
      subtitle: "最初のワークスペースは、たった一文で。",
      cta: "ワークスペースを生成",
    },
    footer: {
      tagline: "学生のための学習ワークスペース · © 2026",
    },
    preview: {
      name: "CS学習本部",
      thisWeek: "今週",
      columns: { todo: "未着手", doing: "進行中", done: "完了" },
      cards: ["証明クイズ", "連結リスト演習", "レポート2"],
      coursesLabel: "科目",
      courses: ["データ構造", "離散数学", "物理学I"],
    },
  },

  // ---- Pricing page (/pricing) ------------------------------------------
  pricing: {
    nav: { openApp: "アプリを開く", signIn: "サインイン", getStarted: "始める" },
    badge: "シンプルで、学生にやさしい料金",
    title: "まずは無料で。準備ができたらアップグレード。",
    subtitle:
      "学期を整理するために必要なものはすべて無料です。Pro では最も高性能なモデル、無制限の生成、優先サポートが加わります。",
    free: {
      name: "無料",
      price: "$0",
      tagline: "整理に必要なすべて。",
      bullets: [
        "AIが生成する学習ワークスペース",
        "完全なインライン編集と自動保存",
        "データベース — テーブル、ボード、カレンダー",
        "ワークスペース内のAIエージェントチャット",
      ],
      ctaSignedOut: "無料で始める",
      ctaSignedIn: "ワークスペースを開く",
      bulletCredits: "{count} クレジットのスターターAIクレジット",
    },
    pro: {
      badge: "一番人気",
      name: "Pro",
      price: "$5",
      perMonth: "/月",
      billed: "月額課金 · いつでも解約可能。",
      bullets: [
        "無料プランのすべて",
        "無制限のワークスペース生成",
        "最も高性能で、最も詳細なモデル",
        "優先サポートと先行アクセス",
      ],
      currentPlan: "✦ 現在のプラン",
      manageBilling: "請求を管理",
      upgrade: "Pro にアップグレード",
      ctaSignedOut: "Pro で始める",
      bulletCredits: "{count} クレジットのAIクレジット込み",
    },
    comparison: {
      title: "プランを比較",
      featuresHeader: "機能",
      freeHeader: "無料",
      proHeader: "Pro",
      included: "含む",
      notIncluded: "含まない",
      features: {
        aiWorkspaces: "AIが生成するワークスペース",
        onboarding: "ガイド付きのオンボーディング質問",
        editing: "完全なインライン編集と自動保存",
        databases: "データベース — テーブル、ボード、カレンダー",
        dragDrop: "ドラッグ＆ドロップ編集",
        agentChat: "ワークスペースを編集するAIエージェントチャット",
        model: "生成モデル",
        generations: "ワークスペースの生成",
        support: "サポート",
        earlyAccess: "新機能への先行アクセス",
        credits: "含まれるAIクレジット",
        buyMore: "いつでもクレジットを追加購入",
      },
      values: {
        standard: "標準",
        mostCapable: "最高性能",
        generous: "たっぷり",
        unlimited: "無制限",
        community: "コミュニティ",
        priority: "優先",
      },
    },
    credits: {
      heading: "AIはクレジットで動きます",
      intro:
        "AIリクエストはその処理量に応じてクレジットを消費します — ちょっとした調整なら少しだけ、ワークスペースをまるごと構築するならもっと多く。Pro にはクレジットがたっぷり含まれ、いつでも追加できます。",
      freeIncludes: "無料プランには {count} クレジットのスターターが含まれます",
      proIncludes: "Pro には {count} クレジットが含まれます",
      neverExpire: "いつでも追加 — クレジットは期限切れになりません",
      balance: "残高：{count} クレジット",
      pack: "クレジットパック",
      unit: "クレジット",
      buy: "{count} クレジットを購入",
      signUpToBuy: "サインアップしてクレジットを購入",
      oneTime: "一回限りの購入 · 安全な決済",
    },
    faqTitle: "よくある質問",
    faq: [
      {
        q: "StudyOS は本当に無料で始められますか？",
        a: "はい。アカウントを作成すれば、無料プランでワークスペースの生成、編集、利用ができます。クレジットカードは不要です。",
      },
      {
        q: "Pro では何が得られますか？",
        a: "無制限の生成、より豊かで正確なワークスペースのための最高性能モデル、優先サポート、そして新機能への先行アクセスです。",
      },
      {
        q: "いつでも解約できますか？",
        a: "いつでも可能です。請求ポータルからサブスクリプションの管理・解約ができます。期間終了までは Pro をご利用いただけます。",
      },
      {
        q: "プランを下げたらワークスペースはどうなりますか？",
        a: "何も削除されません。ワークスペースはそのまま残り、無料プランでも引き続き編集できます。",
      },
    ],
    ctaTitle: "最初のワークスペースは、たった一文で。",
    ctaSubtitle: "StudyOS を無料でお試しください。もっと必要なときだけアップグレード。",
    ctaSignedIn: "ワークスペースを生成",
    ctaSignedOut: "無料で始める",
    footerTagline: "学生のための学習ワークスペース · © 2026",
  },

  // ---- Workspaces list (/app) -------------------------------------------
  app: {
    pro: "Pro",
    manage: "管理",
    upgrade: "Pro にアップグレード",
    generate: "生成",
    upgradedBanner: "Pro をご利用中です — ワークスペースはより賢いモデルを使用します。",
    title: "あなたのワークスペース",
    subtitle: "StudyOS があなたのために構築したすべて。",
    total: "合計 {count} 件",
    emptyTitle: "まだワークスペースがありません",
    emptySubtitle: "ひとつ生成するか、デモを読み込んで見てまわりましょう。",
    emptyGenerate: "ワークスペースを生成",
    loadDemo: "デモを読み込む",
    updatedAt: "{date} に更新",
    fallbackIcon: "📄",
  },

  // ---- Generate flow (/generate) ----------------------------------------
  generate: {
    backToWorkspaces: "あなたのワークスペース →",
    examples: [
      { emoji: "💻", text: "CS専攻1年生で、5科目を履修しています" },
      {
        emoji: "⚕️",
        text: "医学部志望の2年生：解剖学、生化学、生理学、有機化学",
      },
      { emoji: "🎓", text: "高校3年生で、期末試験に向けて6科目を勉強中" },
      {
        emoji: "📈",
        text: "MBAの学生で、ミクロ経済学、会計、マーケティングを履修",
      },
    ],
    planSteps: [
      "あなたの説明を読んでいます",
      "適切な質問を考えています",
      "あなたに合わせて設定中",
    ],
    planningTitle: "あなたのことを教えてください",
    errorGeneric: "問題が発生しました。もう一度お試しください。",
    errorBuild: "ワークスペースの生成中に問題が発生しました。もう一度お試しください。",
    describe: {
      step: "ステップ 1 / 2",
      title: "何を勉強していますか？",
      subtitle:
        "履修科目と目標を日常の言葉で説明してください。StudyOS がいくつか簡単な質問をしたうえで、あなたの回答に合わせてワークスペース全体を設計します。",
      placeholder:
        "例：CS専攻1年生で、今学期はデータ構造、離散数学、微積分II、アカデミックライティングを履修しています。",
      shortcut: "⌘ / Ctrl + Enter",
      continue: "続ける",
      examplesLabel: "迷ったら、例から始めましょう",
      finePrint: "無料 · クレジットカード不要 · 数秒で完成",
    },
    questions: {
      back: "← 説明を編集",
      step: "ステップ 2 / 2",
      title: "あなたに合わせて調整",
      designingFor: "設計対象：",
      pickAny: "いくつでも選択可",
      pickOne: "ひとつ選択",
      build: "ワークスペースを構築",
      answeredNone: "いくつか答えても、そのまま構築してもOKです",
      answeredCount: "{n} / {total} 件回答済み",
      other: "その他",
      otherPlaceholder: "あなた自身の希望を入力…",
      otherAria: "「{question}」へのその他の回答",
    },
  },

  // ---- Generation activity (full-screen build progress) -----------------
  genActivity: {
    building: "ワークスペースを構築中",
    designing: "ワークスペースを設計中",
    componentsChosen: "あなたのために選ばれたコンポーネント",
    planningComponents: "コンポーネントを計画中",
    onlyRelevant: "あなたの回答に関係するページとトラッカーだけ。",
    componentsCount: "{count} 個のコンポーネント",
    everythingEditable:
      "生成されたものはすべて編集可能です — ページ、フィールド、ビュー、行、内容まで。",
    statusReady: "完了",
    statusGenerating: "生成中…",
    statusQueued: "待機中",
    finishingUp: "仕上げ中",
    yourWorkspace: "あなたのワークスペース",
    pagesLabel: "ページ",
    sectionsBuilt: "{total} 個中 {built} 個のセクションを作成済み",
    choosingPieces: "あなたに合うパーツを選んでいます…",
    stillEditable: "完成後もすべて編集できます",
    writingItIn: "書き込み中…",
    board: { todo: "未着手", doing: "作業中", done: "完了" },
    phase: {
      analyzing: "回答を分析中",
      planning: "コンポーネントを選択中",
      generating: "ワークスペースを生成中",
      validating: "データを検証中",
      saving: "保存中",
    },
  },

  // ---- AiActivity overlay (calm spinner used during planning) -----------
  aiActivity: {
    defaultTitle: "処理中",
    defaultSteps: [
      "ワークスペースを読み込み中",
      "変更を計画中",
      "レイアウトを設計中",
      "書き込み中",
    ],
  },

  // ---- Workspace editor chrome ------------------------------------------
  editor: {
    workspaceIcon: "ワークスペースのアイコン",
    newPage: "新規ページ",
    untitled: "無題",
    allWorkspaces: "← すべてのワークスペース",
    deletePage: "ページを削除",
    askAi: "AIに尋ねる",
    closeAgent: "エージェントを閉じる",
    saving: "保存中…",
    saveFailed: "保存に失敗しました",
    saved: "保存しました",
  },

  // ---- In-workspace AI agent chat ---------------------------------------
  agentChat: {
    title: "AIエージェント",
    subtitleIdle: "ワークスペース全体を理解しています",
    closeChat: "チャットを閉じる",
    suggestions: [
      "習慣トラッカーを追加",
      "2週間の期末試験対策プランを作成",
      "各科目に中間試験を追加",
      "今週は何に集中すべき？",
    ],
    intro:
      "ひとつの項目の変更から、ワークスペース全体にまたがる更新の調整まで、何でもお任せください。不明な点があれば、編集する前に確認します。",
    workspaceUpdated: "ワークスペースを更新しました",
    undo: "元に戻す",
    undoing: "元に戻しています…",
    undone: "変更を元に戻しました",
    undoFailed: "ワークスペースが変更されたため、この変更は元に戻せません。",
    buildingUpdate: "更新を作成中",
    thinking: "思考中…",
    stopTask: "タスクを停止",
    stopping: "停止中…",
    taskStopped: "タスクを停止しました。",
    stopFailed: "タスクを停止できませんでした。まだ実行中の可能性があります。",
    steps: {
      inspect: "ワークスペースを確認",
      decide: "最も安全な操作を判断",
      prepare: "連携した更新を準備",
    },
    phase: {
      inspecting: "ワークスペースを確認中",
      planning: "最も安全な変更を計画中",
      updating: "ワークスペースの更新を調整中",
      validating: "すべての接続を確認中",
      saving: "変更を保存中",
    },
    areaStatus: { queued: "待機中", working: "更新中", complete: "完了" },
    initialMessage: "ワークスペースを開いています",
    placeholderBusy: "エージェントが作業中です…",
    placeholderIdle: "エージェントに作成や変更を頼んでみましょう…",
    send: "送信",
    inputHint: "Enter で送信 · Shift+Enter で改行",
    errorRequestFailed: "エージェントへのリクエストが失敗しました",
    errorEndedUnexpectedly: "エージェントの応答が予期せず終了しました",
    errorSnag: "エージェントに問題が発生しました。もう一度お試しください。",
    errorCouldntComplete:
      "それを安全に完了できませんでした。もう一度試すか、リクエストをより具体的にしてください。",
  },

  // ---- Page / block editor ----------------------------------------------
  page: {
    pageIcon: "ページのアイコン",
    headingLevel: "見出しレベル",
    calloutIcon: "コールアウトのアイコン",
    addBlock: "+ ブロックを追加",
    deleteBlock: "ブロックを削除",
    blockTypes: {
      paragraph: "テキスト",
      heading: "見出し",
      todo: "ToDo",
      bulleted_list_item: "リスト",
      numbered_list_item: "番号付き",
      quote: "引用",
      callout: "コールアウト",
      divider: "区切り線",
      database: "テーブル",
      media: "画像",
    },
    placeholders: {
      paragraph: "入力してください…",
      todo: "ToDo",
      listItem: "リスト項目",
      callout: "コールアウト",
    },
    headingDefault: "見出し",
    newTable: {
      name: "新規テーブル",
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
    databaseIcon: "データベースのアイコン",
    nameAria: "データベース名",
    newRow: "+ 新規行",
    newCard: "+ 新規",
    untitled: "無題",
    empty: "—",
    deleteRow: "行を削除",
    deleteCard: "カードを削除",
    dragHint: "別の列へドラッグ",
    prevMonth: "前の月",
    nextMonth: "次の月",
    addOnDay: "この日に追加",
    clickToRename: "クリックして名前を変更",
    delete: "削除",
  },

  // ---- Database settings panel ------------------------------------------
  dbSettings: {
    customize: "フィールドとビューをカスタマイズ",
    description: "説明",
    descriptionPlaceholder: "このトラッカーの用途",
    fields: "フィールド",
    addField: "+ フィールドを追加",
    fieldName: "フィールド名",
    fieldType: "フィールドの種類",
    deleteField: "フィールドを削除",
    newField: "新規フィールド",
    chooseRelatedDatabase: "関連するデータベースを選択",
    optionLabel: "オプションのラベル",
    addOption: "+ オプション",
    newOption: "新規オプション",
    views: "ビュー",
    addView: "+ ビューを追加",
    viewName: "ビュー名",
    newView: "新規ビュー",
    deleteView: "ビューを削除",
    groupBy: "グループ化…",
    dateField: "日付フィールド…",
    deleteDatabase: "このデータベースを削除",
    deleteConfirm: "「{name}」を削除し、すべてのページから取り除きますか？",
    propertyTypes: {
      text: "テキスト",
      number: "数値",
      checkbox: "チェックボックス",
      date: "日付",
      select: "選択",
      multi_select: "複数選択",
      status: "ステータス",
      url: "URL",
      relation: "リレーション",
    },
    viewTypes: {
      table: "テーブル",
      board: "ボード",
      calendar: "カレンダー",
      list: "リスト",
      gallery: "ギャラリー",
    },
    defaults: {
      statusTodo: "未着手",
      statusInProgress: "進行中",
      statusDone: "完了",
      option1: "オプション1",
      option2: "オプション2",
    },
  },

  // ---- Default onboarding questions (no-API-key fallback) ----------------
  onboarding: {
    level: {
      question: "学習レベルはどれですか？",
      options: {
        hs: "高校",
        ug: "学部",
        grad: "大学院 / 修士・博士",
        self: "独学",
      },
    },
    load: { question: "いくつの科目を抱えていますか？" },
    track: {
      question: "最も管理したいものは何ですか？",
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
      question: "どのように計画を立てたいですか？",
      options: { cal: "カレンダーで", board: "ボードで", list: "シンプルなリストで" },
    },
  },

  // ---- Server-emitted AI progress + errors ------------------------------
  ai: {
    generate: {
      phase: {
        analyzing: "履修科目、目標、希望を読み込み中",
        planning: "最適なワークスペースのコンポーネントを選択中",
        generating: "完全なワークスペースを一度に生成中",
        validating: "リンク、ビュー、フィールド、初期データを確認中",
        saving: "編集可能なワークスペースを保存中",
      },
      error:
        "ワークスペースを生成できませんでした。説明を短くして、もう一度お試しください。",
      detail: {
        dashboard: "{count} 個の編集可能なページを接続しました",
        courses: "{count} 件の科目を追加しました",
        trackedItems: "{count} 件の管理項目を追加しました",
        scheduled: "{count} 件の項目をスケジュールしました",
        readings: "{count} 件のリーディング項目を追加しました",
        habits: "{count} 件のルーティンを追加しました",
        grades: "{count} 件の成績行を追加しました",
        notes: "編集可能なノート構造を作成しました",
        generic: "コンポーネントを作成して接続しました",
      },
    },
    agent: {
      inspecting: "{pages} 個のページと {databases} 個のデータベースを確認中",
      inspectingArea: "{area} を確認中",
      planning: "リクエストを理解し、あいまいな点を確認中",
      updating: "ワークスペース全体に連携した変更を適用中",
      validating: "参照、ビュー、フィールド、リンクされたデータを確認中",
      saving: "更新されたワークスペースを保存中",
      workspaceNotFound: "ワークスペースが見つかりません。",
      workspaceChanged: "作業中にワークスペースが変更されました。もう一度お試しください。",
      undoUnavailable: "ワークスペースに新しい編集があるため、この変更は元に戻せません。",
      error:
        "エージェントはそのリクエストを安全に完了できませんでした。もう一度試すか、リクエストをより具体的にしてください。",
      fallbackReply: "ワークスペースを更新しました。",
    },
    errors: {
      notAuthenticated: "認証されていません",
      invalidAgentRequest: "無効なエージェントリクエストです",
      describeBeforeGenerating:
        "ワークスペースを生成する前に、学習内容を説明してください。",
    },
  },

  // ---- Credits ----------------------------------------------------------
  credits: {
    label: "AIクレジット",
    amount: "{count} クレジット",
    buy: "クレジットを購入",
    metaTitle: "クレジットを購入 · StudyOS",
    pageIntro:
      "クレジットはすべての AI リクエストの原動力です——ワークスペースの生成やエージェントとのチャットに使われます。いつでもチャージでき、クレジットは無期限です。",
    oneTimeExpire: "一回限りの購入 · 安全な決済 · クレジットは無期限",
    wantMore: "最も高性能なモデルと付属クレジットが必要ですか？",
    spentOn: "AIの生成とエージェントの編集に使われます。",
    addedBanner: "{added} クレジットを追加しました — 現在 {total} クレジットあります。",
    outGenerate:
      "AIクレジットが残っていません。生成を続けるには、料金ページからクレジットを追加してください。",
    outAgent:
      "AIクレジットが残っていません。エージェントを使い続けるには、料金ページからクレジットを追加してください。",
  },

  // ---- Account menu -----------------------------------------------------
  account: {
    pro: "Pro",
    free: "無料",
    fallbackName: "アカウント",
    viewProfile: "プロフィールを表示",
    manageProfile: "プロフィールを管理",
    subscriptionPayments: "サブスクリプションと支払い",
    buyCredits: "クレジットを購入",
    settings: "設定",
    signOut: "サインアウト",
    manageAccount: "アカウントを管理",
    creditsAndPlan: "{credits} クレジット · {plan}",
  },

  // ---- Account settings page --------------------------------------------
  settings: {
    metaTitle: "アカウント設定 · StudyOS",
    back: "← ワークスペース",
    title: "アカウント設定",
    subtitle: "プロフィール、プラン、支払い、クレジットを管理します。",
    profile: "プロフィール",
    yourAccount: "あなたのアカウント",
    subscription: "サブスクリプション",
    proDesc:
      "Pro をご利用中です — 最も高性能なモデルと優先サポート。サブスクリプション、支払い方法、請求書は以下で管理できます。",
    freeDesc:
      "無料プランをご利用中です。Pro にアップグレードすると、最も高性能なモデル、含まれるクレジット、優先サポートが得られます。",
    manageSubscription: "サブスクリプションと支払いを管理",
    upgrade: "Pro にアップグレード",
    comparePlans: "プランを比較",
    creditsDesc:
      "クレジットがすべてのAIリクエストを動かします。いつでも追加 — クレジットは期限切れになりません。",
    buyPack: "{count} クレジットを購入 · ${price}",
    viewPricing: "料金を見る",
    signOut: "サインアウト",
  },

  // ---- Workspace card (delete control) ----------------------------------
  workspaceCard: {
    delete: "ワークスペースを削除",
    deleteAria: "{name} を削除",
    deleteConfirm:
      "「{name}」を削除しますか？\n\nワークスペースとその中身がすべて完全に削除されます。この操作は取り消せません。",
  },

  // ---- Mock generator scaffolding (no-API-key fallback) ------------------
  mock: {
    workspaceName: "学習本部",
    workspaceNameField: "{field} 学習本部",
    welcome:
      "あなたの説明から生成しました：「{summary}」。ここにあるものはすべて、編集できる出発点です。",
    tbd: "未定",
    status: { notStarted: "未着手", inProgress: "進行中", done: "完了" },
    type: { homework: "宿題", quiz: "小テスト", exam: "試験", project: "プロジェクト" },
    exam: { midterm: "中間試験", final: "期末試験" },
    courses: {
      name: "科目",
      description: "今学期に履修するすべての授業。",
      propCourse: "科目",
      propCode: "科目コード",
      propInstructor: "担当教員",
      propCredits: "単位",
      propSchedule: "時間割",
      viewAll: "すべての科目",
    },
    assignments: {
      name: "課題",
      description: "宿題、小テスト、プロジェクト、試験。",
      propName: "課題",
      propCourse: "科目",
      propType: "種類",
      propStatus: "ステータス",
      propDue: "期限",
      propWeight: "配点 %",
      viewAll: "すべて",
      viewBoard: "ステータス別",
      viewCalendar: "カレンダー",
      projectMilestone: "プロジェクトの節目 {n} — {code}",
    },
    readings: {
      name: "リーディングリスト",
      description: "科目ごとに整理された、読むべきもの。",
      propTitle: "タイトル",
      propCourse: "科目",
      propRead: "読了",
      propLink: "リンク",
      viewAll: "リーディングリスト",
      coreReading: "{course}：必読文献",
    },
    habits: {
      name: "学習習慣",
      description: "毎週の継続を手軽に記録するトラッカー。",
      propHabit: "習慣",
      propDate: "日付",
      propDone: "完了",
      propMinutes: "分",
      viewAll: "すべての習慣",
      viewCalendar: "カレンダー",
      reviewNotes: "今日のノートを復習",
      practiceRecall: "想起練習をする",
    },
    grades: {
      name: "成績トラッカー",
      description: "科目ごとの編集可能な点数と配点。",
      propItem: "評価項目",
      propCourse: "科目",
      propScore: "得点",
      propOutOf: "満点",
      propWeight: "配点 %",
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
    assignmentsPage: { intro: "期限と配点付きで、やるべきことをすべて。" },
    plannerPage: { intro: "締め切りをカレンダーに並べて表示。" },
    examsPage: {
      callout:
        "日程を確認したら、各試験を復習トピックと演習セッションに分けましょう。",
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
        "最初の評価項目を、シラバスの配点と実際の結果に置き換えましょう。",
    },
    plan: {
      summaryWith: "{focus} を中心に構築された、あなた専用のワークスペース。",
      summaryGeneric:
        "科目、締め切り、学習計画のための、あなた専用のワークスペース。",
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
          description: "課題、締め切り、配点、ステータス。",
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
          description: "試験日程、トピック、復習タスク。",
        },
        notes: {
          label: "ノート",
          description: "授業ノートのための整理された場所。",
        },
        habits: {
          label: "学習習慣",
          description: "毎日の学習ルーティンと継続。",
        },
        grades: {
          label: "成績トラッカー",
          description: "得点、配点、目標成績。",
        },
      },
    },
  },
} satisfies Dictionary;

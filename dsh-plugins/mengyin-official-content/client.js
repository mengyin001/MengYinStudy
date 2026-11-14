/**
 * DSH Web client half: a main-panel manager for MengYin Study official
 * question banks and collections.
 *
 * The page talks to the Host half's `/api/mengyin-official` route, which runs
 * the workspace authoring CLI. No Supabase key or Node API is exposed to the
 * browser.
 */
window.__ModuleLoader__.load({
  id: '@local/mengyin-official-content',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;
    const { useEffect, useMemo, useRef, useState } = React;

    const NS = 'mengyin-official';
    const PAGE_KEY = 'mengyin-official';
    let boundTranslate = null;

    const EN = {
      nav: 'Official banks',
      eyebrow: 'MENGYIN STUDY',
      title: 'Official question banks',
      subtitle: 'Manage the collections and banks that appear in the Plaza.',
      refresh: 'Refresh',
      newBank: 'New bank',
      newCollection: 'New collection',
      searchCollections: 'Search collections',
      collections: 'Collections',
      banks: 'Banks',
      bankOne: 'bank',
      bankMany: 'banks',
      collectionOne: 'collection',
      collectionMany: 'collections',
      questionOne: 'question',
      questionMany: 'questions',
      figureOne: 'figure',
      figureMany: 'figures',
      imageOne: 'image',
      imageMany: 'images',
      minutes: 'min',
      published: 'Published',
      draft: 'Draft',
      visible: 'In Plaza',
      hidden: 'Hidden',
      noPublishedBanks: 'No published banks',
      selectCollection: 'Select a collection',
      selectCollectionHint: 'Pick a collection on the left to see its question banks.',
      emptyCollections: 'No official collections yet',
      emptyCollectionsHint: 'Create a collection, then add a question bank to it.',
      emptyBanks: 'This collection has no question banks',
      emptyBanksHint: 'A collection appears in the Plaza once it has at least one published bank.',
      noMatches: 'No collections match',
      createFirstCollection: 'Create a collection',
      createFirstBank: 'Create the first bank',
      delete: 'Delete',
      deleteCollection: 'Delete collection',
      deleteBank: 'Delete bank',
      deleteCollectionTitle: 'Delete this collection?',
      deleteCollectionBody:
        'Every question bank in this collection, its questions and its stored images will be permanently deleted. Learners who added these banks will lose them from their library.',
      deleteBankTitle: 'Delete this question bank?',
      deleteBankBody:
        'The bank, its questions and its stored images will be permanently deleted. This cannot be undone.',
      cancel: 'Cancel',
      confirmDelete: 'Delete permanently',
      deleting: 'Deleting…',
      bankDialogTitle: 'New official question bank',
      bankDialogHint:
        'The app writes the questions from this brief. Generation usually takes 10–90 seconds; photos can make it take several minutes.',
      description: 'Description / brief',
      descriptionPlaceholder:
        'What should the bank cover? Include the level, scope and any constraints. For example: “DSE Biology, cell structure, 15 single-choice questions, include labelled diagrams where useful.”',
      descriptionRequired: 'Add a description first.',
      typesRequired: 'Choose at least one question type.',
      countInvalid: 'Choose a whole number from 1 to 50.',
      nameRequired: 'Add a name first.',
      idInvalid: 'Use 2–64 letters, digits, dots, underscores or hyphens.',
      titleLabel: 'Title (optional)',
      titlePlaceholder: 'Defaults to the first line of the description',
      count: 'Questions',
      difficulty: 'Difficulty',
      difficultyMixed: 'Mixed',
      difficultyEasy: 'Easy',
      difficultyHard: 'Hard',
      language: 'Language',
      languageAuto: 'Follow the description',
      languageEn: 'English',
      languageZh: 'Traditional Chinese',
      images: 'Images',
      imagesOff: 'Text only',
      imagesAuto: 'Where they help',
      imagesOn: 'Every eligible question',
      imageMax: 'Maximum photos',
      imageMaxHint: 'Diagrams are not counted.',
      types: 'Question types',
      typeSingle: 'Single choice',
      typeMulti: 'Multi-select',
      typeBoolean: 'True / false',
      typeFill: 'Fill in the blank',
      typeShort: 'Short answer',
      typeCode: 'Code',
      codeLanguage: 'Code language',
      tags: 'Tags (optional)',
      tagsPlaceholder: 'Comma separated, up to 8',
      collection: 'Collection',
      newCollectionOption: 'Create a new collection',
      packName: 'New collection name',
      packNamePlaceholder: 'Defaults to the bank title',
      publishedLabel: 'Publish immediately',
      createBank: 'Create bank',
      creating: 'Creating…',
      generating: 'Writing and publishing questions…',
      collectionDialogTitle: 'New official collection',
      collectionDialogHint:
        'A collection is the Plaza pack that groups question banks. It appears in the Plaza once it has a published bank.',
      name: 'Name',
      namePlaceholder: 'e.g. DSE 2027 revision',
      descriptionLabel: 'Description (optional)',
      descriptionPlaceholder: 'What is this collection for?',
      idLabel: 'Collection id (optional)',
      idPlaceholder: 'Letters, digits, dots, underscores or hyphens',
      createCollection: 'Create collection',
      success: 'Done',
      error: 'Something went wrong',
      warnings: 'Warnings',
      close: 'Close',
      refreshHint: 'The study app picks up catalogue changes on its next check.',
      loading: 'Loading official content…',
      retry: 'Retry',
      noCollectionsLoaded: 'The catalogue could not be loaded.',
    };

    const ZH = {
      nav: '官方題庫',
      eyebrow: 'MengYin Study',
      title: '官方題庫管理',
      subtitle: '管理在廣場顯示的官方合集與題庫。',
      refresh: '重新整理',
      newBank: '新增題庫',
      newCollection: '新增合集',
      searchCollections: '搜尋合集',
      collections: '合集',
      banks: '題庫',
      bankOne: '個題庫',
      bankMany: '個題庫',
      collectionOne: '個合集',
      collectionMany: '個合集',
      questionOne: '題',
      questionMany: '題',
      figureOne: '個圖',
      figureMany: '個圖',
      imageOne: '張圖',
      imageMany: '張圖',
      minutes: '分鐘',
      published: '已發布',
      draft: '草稿',
      visible: '廣場可見',
      hidden: '未顯示',
      noPublishedBanks: '沒有已發布題庫',
      selectCollection: '選擇一個合集',
      selectCollectionHint: '從左邊選擇合集，查看它的題庫。',
      emptyCollections: '還沒有官方合集',
      emptyCollectionsHint: '先建立合集，再把題庫加入其中。',
      emptyBanks: '這個合集還沒有題庫',
      emptyBanksHint: '合集至少有一個已發布題庫，才會在廣場顯示。',
      noMatches: '沒有符合的合集',
      createFirstCollection: '建立合集',
      createFirstBank: '建立第一個題庫',
      delete: '刪除',
      deleteCollection: '刪除合集',
      deleteBank: '刪除題庫',
      deleteCollectionTitle: '刪除這個合集？',
      deleteCollectionBody:
        '合集內所有題庫、題目與已儲存的圖片都會永久刪除；已把題庫加入自己題庫的學習者也會失去它們。',
      deleteBankTitle: '刪除這個題庫？',
      deleteBankBody: '題庫、題目與已儲存的圖片都會永久刪除，無法復原。',
      cancel: '取消',
      confirmDelete: '永久刪除',
      deleting: '刪除中…',
      bankDialogTitle: '新增官方題庫',
      bankDialogHint: 'App 會依照這段描述出題。一般需要 10–90 秒；啟用照片時可能需要數分鐘。',
      description: '描述／出題指引',
      descriptionPlaceholder:
        '題庫要涵蓋甚麼？請寫程度、範圍與限制。例如：「DSE 生物，細胞結構，15 題單選，適合時加入標註圖。」',
      descriptionRequired: '請先填寫描述。',
      typesRequired: '請至少選擇一種題型。',
      countInvalid: '請填寫 1–50 的整數題數。',
      nameRequired: '請先填寫名稱。',
      idInvalid: '請使用 2–64 個字母、數字、點、底線或連字號。',
      titleLabel: '標題（可選）',
      titlePlaceholder: '留空則使用描述第一行',
      count: '題數',
      difficulty: '難度',
      difficultyMixed: '混合',
      difficultyEasy: '容易',
      difficultyHard: '困難',
      language: '語言',
      languageAuto: '跟隨描述',
      languageEn: '英文',
      languageZh: '繁體中文',
      images: '圖片',
      imagesOff: '純文字',
      imagesAuto: '適合時加入',
      imagesOn: '每題都盡量加',
      imageMax: '照片上限',
      imageMaxHint: '圖形不計入上限。',
      types: '題型',
      typeSingle: '單選',
      typeMulti: '多選',
      typeBoolean: '是非',
      typeFill: '填空',
      typeShort: '簡答',
      typeCode: '程式',
      codeLanguage: '程式語言',
      tags: '標籤（可選）',
      tagsPlaceholder: '以逗號分隔，最多 8 個',
      collection: '合集',
      newCollectionOption: '建立新合集',
      packName: '新合集名稱',
      packNamePlaceholder: '留空則使用題庫標題',
      publishedLabel: '立即發布',
      createBank: '建立題庫',
      creating: '建立中…',
      generating: '正在出題並發布…',
      collectionDialogTitle: '新增官方合集',
      collectionDialogHint: '合集是廣場中組裝題庫的包；有已發布題庫後才會在廣場顯示。',
      name: '名稱',
      namePlaceholder: '例如：DSE 2027 溫習',
      descriptionLabel: '描述（可選）',
      descriptionPlaceholder: '這個合集是為了甚麼？',
      idLabel: '合集 id（可選）',
      idPlaceholder: '字母、數字、點、底線或連字號',
      createCollection: '建立合集',
      success: '完成',
      error: '發生錯誤',
      warnings: '注意',
      close: '關閉',
      refreshHint: '學習 App 會在下次檢查目錄時看到變更。',
      loading: '正在載入官方內容…',
      retry: '重試',
      noCollectionsLoaded: '無法載入目錄。',
    };

    function tx(t, key) {
      if (!t) return key;
      try {
        const value = t(key);
        return value || key;
      } catch {
        return key;
      }
    }

    function splitTags(value) {
      return String(value || '')
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 8);
    }

    function initials(name) {
      const clean = String(name || '').replace(/\s+/g, '');
      return clean.slice(0, 2).toUpperCase();
    }

    function relativeError(error) {
      return error instanceof Error ? error.message : String(error);
    }

    async function requestJson(url, options) {
      let response;
      try {
        response = await fetch(url, { cache: 'no-store', ...options });
      } catch (error) {
        throw new Error(`Cannot reach the Host: ${relativeError(error)}`);
      }
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok || (body && body.ok === false)) {
        const message =
          body && body.error && typeof body.error.message === 'string'
            ? body.error.message
            : `Request failed (HTTP ${response.status}).`;
        throw new Error(message);
      }
      return body;
    }

    function postAction(action, payload) {
      return requestJson('/api/mengyin-official/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(payload || {}) }),
      });
    }

    function formatCount(n, one, many) {
      return `${n} ${n === 1 ? one : many}`;
    }

    function PanelIcon(props) {
      const size = Number(props.size) || 20;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block', opacity: props.active ? 1 : 0.78 },
        },
        h('rect', {
          x: 4.2,
          y: 2.8,
          width: 11,
          height: 14,
          rx: 2,
          stroke: 'currentColor',
          strokeWidth: 1.6,
          opacity: 0.6,
        }),
        h('rect', {
          x: 8.2,
          y: 6.2,
          width: 11.4,
          height: 14,
          rx: 2,
          stroke: 'currentColor',
          strokeWidth: 1.6,
        }),
        h('path', {
          d: 'M10.6 12.4 12.5 14.3 15.8 10.6',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    const CSS = `
      .myo-page { height: 100%; min-height: 420px; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
      .myo-header { flex: none; display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 24px 28px 18px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
      .myo-eyebrow { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--dsw-alias-label-secondary); }
      .myo-h1 { margin: 6px 0 5px; font-size: 22px; line-height: 1.2; font-weight: 600; letter-spacing: -.01em; }
      .myo-sub { margin: 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
      .myo-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
      .myo-button { font: inherit; font-size: 13px; line-height: 1.2; border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-primary); border-radius: 7px; padding: 7px 11px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; }
      .myo-button:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); }
      .myo-button:disabled { opacity: .55; cursor: default; }
      .myo-button.primary { background: var(--dsw-alias-brand-primary); border-color: transparent; color: var(--dsw-alias-bg-base); }
      .myo-button.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 88%, var(--dsw-alias-label-primary)); }
      .myo-button.danger { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
      .myo-button.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); }
      .myo-button.icon { width: 32px; height: 32px; padding: 0; }
      .myo-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(220px, 300px) minmax(0, 1fr); }
      .myo-side { min-height: 0; overflow: auto; border-right: 1px solid var(--dsw-alias-border-l1); padding: 16px 14px; }
      .myo-side-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
      .myo-side-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); text-transform: uppercase; letter-spacing: .06em; }
      .myo-count { font-size: 11px; color: var(--dsw-alias-label-secondary); border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 0 6px; }
      .myo-search { width: 100%; box-sizing: border-box; margin-bottom: 10px; }
      .myo-pack { width: 100%; display: flex; align-items: flex-start; gap: 10px; text-align: left; font: inherit; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 8px; padding: 8px; cursor: pointer; }
      .myo-pack:hover { background: var(--dsw-alias-bg-layer-1); }
      .myo-pack[data-active="true"] { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l1); }
      .myo-crest { flex: none; width: 32px; height: 32px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; display: grid; place-items: center; font-size: 12px; font-weight: 600; letter-spacing: .02em; }
      .myo-crest.lg { width: 42px; height: 42px; font-size: 14px; border-radius: 10px; }
      .myo-pack-text { min-width: 0; display: flex; flex-direction: column; gap: 3px; padding-top: 1px; }
      .myo-pack-name { font-size: 13px; font-weight: 600; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .myo-muted { font-size: 11px; line-height: 1.45; color: var(--dsw-alias-label-secondary); }
      .myo-main { min-height: 0; overflow: auto; padding: 20px 24px 32px; }
      .myo-detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
      .myo-detail-id { display: flex; gap: 12px; align-items: flex-start; min-width: 0; }
      .myo-h2 { margin: 0; font-size: 18px; line-height: 1.25; font-weight: 600; }
      .myo-desc { margin: 5px 0 0; max-width: 70ch; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
      .myo-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; margin-top: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .myo-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--dsw-alias-border-l2); display: inline-block; }
      .myo-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; line-height: 1.4; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); border-radius: 999px; padding: 1px 7px; white-space: nowrap; }
      .myo-badge.success { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 42%, transparent); }
      .myo-badge.warn { color: var(--dsw-alias-state-warn-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 42%, transparent); }
      .myo-badge.idle { color: var(--dsw-alias-state-idle-primary); }
      .myo-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 18px 0 10px; }
      .myo-h3 { margin: 0; font-size: 13px; font-weight: 600; }
      .myo-list { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; overflow: hidden; background: var(--dsw-alias-bg-layer-1); }
      .myo-row { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 13px 15px; border-top: 1px solid var(--dsw-alias-border-l1); }
      .myo-row:first-child { border-top: 0; }
      .myo-row-main { min-width: 0; }
      .myo-row-title { font-size: 13px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
      .myo-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; padding: 0 4px; }
      .myo-row-actions { display: flex; align-items: center; gap: 8px; flex: none; }
      .myo-empty { border: 1px dashed var(--dsw-alias-border-l2); border-radius: 12px; padding: 42px 24px; text-align: center; background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 55%, transparent); }
      .myo-empty-title { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
      .myo-empty-text { margin: 0 auto 14px; max-width: 52ch; font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }
      .myo-loading { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 56px 24px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
      .myo-spinner { width: 16px; height: 16px; border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-brand-primary); border-radius: 50%; animation: myo-spin .8s linear infinite; flex: none; }
      @keyframes myo-spin { to { transform: rotate(360deg); } }
      .myo-banner { flex: none; margin: 12px 28px 0; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; font-size: 12px; line-height: 1.5; }
      .myo-banner.success { border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 38%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 7%, var(--dsw-alias-bg-base)); }
      .myo-banner.error { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 38%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 7%, var(--dsw-alias-bg-base)); }
      .myo-banner-title { font-weight: 600; margin-bottom: 2px; }
      .myo-banner ul { margin: 6px 0 0; padding-left: 18px; }
      .myo-banner .myo-banner-close { flex: none; border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 4px; }
      .myo-footer { margin-top: 20px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .myo-overlay { position: fixed; inset: 0; z-index: 1000; background: color-mix(in srgb, var(--dsw-alias-label-primary) 34%, transparent); display: flex; align-items: center; justify-content: center; padding: 24px; }
      .myo-modal { width: min(680px, 100%); max-height: calc(100vh - 48px); display: flex; flex-direction: column; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; box-shadow: 0 18px 60px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent); }
      .myo-modal-head { flex: none; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 20px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
      .myo-modal-title { margin: 0; font-size: 16px; font-weight: 600; }
      .myo-modal-x { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 20px; line-height: 1; cursor: pointer; padding: 2px 4px; border-radius: 5px; }
      .myo-modal-x:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
      .myo-modal-body { flex: 1 1 auto; min-height: 0; padding: 18px 20px; overflow: auto; display: flex; flex-direction: column; gap: 14px; }
      .myo-modal-foot { flex: none; display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 13px 20px; border-top: 1px solid var(--dsw-alias-border-l1); }
      .myo-field { display: flex; flex-direction: column; gap: 6px; }
      .myo-label { font-size: 12px; font-weight: 600; }
      .myo-hint { font-size: 11px; line-height: 1.45; color: var(--dsw-alias-label-secondary); }
      .myo-input, .myo-textarea, .myo-select { width: 100%; box-sizing: border-box; font: inherit; font-size: 13px; line-height: 1.45; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; padding: 8px 10px; outline: none; }
      .myo-input:focus, .myo-textarea:focus, .myo-select:focus { border-color: var(--dsw-alias-brand-primary); }
      .myo-textarea { min-height: 132px; resize: vertical; }
      .myo-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .myo-grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .myo-checks { display: flex; flex-wrap: wrap; gap: 8px 16px; }
      .myo-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
      .myo-check input { accent-color: var(--dsw-alias-brand-primary); }
      .myo-error { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); overflow-wrap: anywhere; }
      .myo-form-note { font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
      .myo-generating { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
      @media (max-width: 860px) {
        .myo-header { flex-direction: column; align-items: stretch; }
        .myo-actions { justify-content: flex-start; }
        .myo-body { grid-template-columns: 1fr; }
        .myo-side { border-right: 0; border-bottom: 1px solid var(--dsw-alias-border-l1); max-height: 240px; }
        .myo-main { padding: 16px 18px 28px; }
        .myo-banner { margin-left: 18px; margin-right: 18px; }
        .myo-grid, .myo-grid3 { grid-template-columns: 1fr; }
        .myo-detail-head { flex-direction: column; }
      }
    `;

    function Styles() {
      return h('style', { 'data-mengyin-official': true }, CSS);
    }

    function Button(props) {
      const { variant = '', className = '', ...rest } = props;
      return h('button', {
        type: 'button',
        className: `myo-button ${variant} ${className}`.trim(),
        ...rest,
      });
    }

    function Badge({ tone = '', children }) {
      return h('span', { className: `myo-badge ${tone}`.trim() }, children);
    }

    function Modal({ title, children, footer, onClose, closeLabel = 'Close' }) {
      const dialogRef = useRef(null);

      useEffect(() => {
        const node = dialogRef.current;
        if (!node) return undefined;

        const focusableSelector =
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]';
        const focusable = () =>
          [...node.querySelectorAll(focusableSelector)].filter((element) => element.offsetParent !== null);

        if (!node.contains(document.activeElement)) {
          const first = focusable()[0];
          if (first) first.focus();
        }

        const onKeyDown = (event) => {
          if (event.key !== 'Tab') return;
          const items = focusable();
          if (items.length === 0) return;
          const first = items[0];
          const last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        };

        const onWindowKeyDown = (event) => {
          if (event.key === 'Escape') onClose();
        };

        node.addEventListener('keydown', onKeyDown);
        window.addEventListener('keydown', onWindowKeyDown);
        return () => {
          node.removeEventListener('keydown', onKeyDown);
          window.removeEventListener('keydown', onWindowKeyDown);
        };
      }, [onClose]);

      return ReactDOM.createPortal(
        h(
          'div',
          {
            className: 'myo-overlay',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) onClose();
            },
          },
          h(
            'div',
            {
              ref: dialogRef,
              className: 'myo-modal',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-labelledby': 'myo-modal-title',
            },
            h(
              'div',
              { className: 'myo-modal-head' },
              h('h2', { className: 'myo-modal-title', id: 'myo-modal-title' }, title),
              h(
                'button',
                {
                  type: 'button',
                  className: 'myo-modal-x',
                  'aria-label': closeLabel,
                  onClick: onClose,
                },
                '×',
              ),
            ),
            h('div', { className: 'myo-modal-body' }, children),
            footer ? h('div', { className: 'myo-modal-foot' }, footer) : null,
          ),
        ),
        document.body,
      );
    }

    function Banner({ tone, title, text, warnings, onClose, closeLabel = 'Close' }) {
      return h(
        'div',
        { className: `myo-banner ${tone}`.trim(), role: tone === 'error' ? 'alert' : 'status' },
        h(
          'div',
          null,
          h('div', { className: 'myo-banner-title' }, title),
          text ? h('div', null, text) : null,
          warnings && warnings.length > 0
            ? h(
                'ul',
                null,
                warnings.slice(0, 4).map((warning, index) =>
                  h('li', { key: `${index}-${warning}` }, String(warning)),
                ),
              )
            : null,
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'myo-banner-close',
            'aria-label': closeLabel,
            onClick: onClose,
          },
          '×',
        ),
      );
    }

    function Field({ label, hint, children }) {
      return h(
        'label',
        { className: 'myo-field' },
        h('span', { className: 'myo-label' }, label),
        children,
        hint ? h('span', { className: 'myo-hint' }, hint) : null,
      );
    }

    function BankDialog({ t, collections, defaultPackId, busy, error, onSubmit, onClose }) {
      const [description, setDescription] = useState('');
      const [title, setTitle] = useState('');
      const [count, setCount] = useState('10');
      const [types, setTypes] = useState(['single', 'multi', 'boolean']);
      const [difficulty, setDifficulty] = useState('mixed');
      const [language, setLanguage] = useState('auto');
      const [images, setImages] = useState('auto');
      const [imageMax, setImageMax] = useState('4');
      const [codeLanguage, setCodeLanguage] = useState('javascript');
      const [tags, setTags] = useState('');
      const [packChoice, setPackChoice] = useState(
        collections.some((pack) => pack.id === defaultPackId) ? defaultPackId : 'new',
      );
      const [packName, setPackName] = useState('');
      const [published, setPublished] = useState(true);
      const [localError, setLocalError] = useState('');
      const descriptionRef = useRef(null);

      useEffect(() => {
        descriptionRef.current?.focus();
      }, []);

      const typeOptions = [
        ['single', 'typeSingle'],
        ['multi', 'typeMulti'],
        ['boolean', 'typeBoolean'],
        ['fill', 'typeFill'],
        ['short', 'typeShort'],
        ['code', 'typeCode'],
      ];

      function toggleType(type) {
        setTypes((current) =>
          current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
        );
      }

      function submit(event) {
        event.preventDefault();
        if (!description.trim()) {
          setLocalError(tx(t, 'descriptionRequired'));
          descriptionRef.current?.focus();
          return;
        }
        if (types.length === 0) {
          setLocalError(tx(t, 'typesRequired'));
          return;
        }
        const numericCount = Number(count);
        if (!Number.isInteger(numericCount) || numericCount < 1 || numericCount > 50) {
          setLocalError(tx(t, 'countInvalid'));
          return;
        }
        setLocalError('');
        onSubmit({
          description: description.trim(),
          ...(title.trim() ? { title: title.trim() } : {}),
          count: numericCount,
          types,
          difficulty,
          language,
          images,
          ...(images === 'off' ? {} : { imageMax: Number(imageMax) || 0 }),
          ...(types.includes('code') ? { codeLanguage } : {}),
          tags: splitTags(tags),
          ...(packChoice === 'new'
            ? { packName: packName.trim() || title.trim() || undefined }
            : { packId: packChoice }),
          published,
        });
      }

      const canSubmit = !busy && description.trim().length > 0 && types.length > 0;

      return h(
        Modal,
        {
          title: tx(t, 'bankDialogTitle'),
          closeLabel: tx(t, 'close'),
          onClose: busy ? () => undefined : onClose,
          footer: [
            h(
              Button,
              { key: 'cancel', onClick: onClose, disabled: busy },
              tx(t, 'cancel'),
            ),
            h(
              Button,
              {
                key: 'create',
                variant: 'primary',
                type: 'submit',
                form: 'myo-bank-form',
                disabled: !canSubmit,
              },
              busy ? tx(t, 'creating') : tx(t, 'createBank'),
            ),
          ],
        },
        h(
          'form',
          { id: 'myo-bank-form', onSubmit: submit },
          h(
            'div',
            { className: 'myo-field' },
            h('span', { className: 'myo-hint' }, tx(t, 'bankDialogHint')),
          ),
          h(
            Field,
            { label: `${tx(t, 'description')} *` },
            h('textarea', {
              ref: descriptionRef,
              className: 'myo-textarea',
              value: description,
              maxLength: 20000,
              onChange: (event) => setDescription(event.target.value),
              placeholder: tx(t, 'descriptionPlaceholder'),
              disabled: busy,
            }),
          ),
          h(
            Field,
            { label: tx(t, 'titleLabel'), hint: tx(t, 'titlePlaceholder') },
            h('input', {
              className: 'myo-input',
              value: title,
              maxLength: 200,
              onChange: (event) => setTitle(event.target.value),
              disabled: busy,
            }),
          ),
          h(
            'div',
            { className: 'myo-grid3' },
            h(
              Field,
              { label: tx(t, 'count') },
              h('input', {
                className: 'myo-input',
                type: 'number',
                min: 1,
                max: 50,
                value: count,
                onChange: (event) => setCount(event.target.value),
                disabled: busy,
              }),
            ),
            h(
              Field,
              { label: tx(t, 'difficulty') },
              h(
                'select',
                {
                  className: 'myo-select',
                  value: difficulty,
                  onChange: (event) => setDifficulty(event.target.value),
                  disabled: busy,
                },
                h('option', { value: 'mixed' }, tx(t, 'difficultyMixed')),
                h('option', { value: 'easy' }, tx(t, 'difficultyEasy')),
                h('option', { value: 'hard' }, tx(t, 'difficultyHard')),
              ),
            ),
            h(
              Field,
              { label: tx(t, 'language') },
              h(
                'select',
                {
                  className: 'myo-select',
                  value: language,
                  onChange: (event) => setLanguage(event.target.value),
                  disabled: busy,
                },
                h('option', { value: 'auto' }, tx(t, 'languageAuto')),
                h('option', { value: 'en' }, tx(t, 'languageEn')),
                h('option', { value: 'zh-Hant' }, tx(t, 'languageZh')),
              ),
            ),
          ),
          h(
            'div',
            { className: 'myo-field' },
            h('span', { className: 'myo-label' }, tx(t, 'types')),
            h(
              'div',
              { className: 'myo-checks' },
              typeOptions.map(([value, key]) =>
                h(
                  'label',
                  { key: value, className: 'myo-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: types.includes(value),
                    onChange: () => toggleType(value),
                    disabled: busy,
                  }),
                  tx(t, key),
                ),
              ),
            ),
          ),
          types.includes('code')
            ? h(
                Field,
                { label: tx(t, 'codeLanguage') },
                h(
                  'select',
                  {
                    className: 'myo-select',
                    value: codeLanguage,
                    onChange: (event) => setCodeLanguage(event.target.value),
                    disabled: busy,
                  },
                  h('option', { value: 'javascript' }, 'JavaScript'),
                  h('option', { value: 'typescript' }, 'TypeScript'),
                  h('option', { value: 'python' }, 'Python'),
                  h('option', { value: 'sql' }, 'SQL'),
                  h('option', { value: 'java' }, 'Java'),
                  h('option', { value: 'cpp' }, 'C++'),
                ),
              )
            : null,
          h(
            'div',
            { className: 'myo-grid' },
            h(
              Field,
              { label: tx(t, 'images') },
              h(
                'select',
                {
                  className: 'myo-select',
                  value: images,
                  onChange: (event) => setImages(event.target.value),
                  disabled: busy,
                },
                h('option', { value: 'off' }, tx(t, 'imagesOff')),
                h('option', { value: 'auto' }, tx(t, 'imagesAuto')),
                h('option', { value: 'on' }, tx(t, 'imagesOn')),
              ),
            ),
            images === 'off'
              ? null
              : h(
                  Field,
                  { label: tx(t, 'imageMax'), hint: tx(t, 'imageMaxHint') },
                  h('input', {
                    className: 'myo-input',
                    type: 'number',
                    min: 0,
                    max: 20,
                    value: imageMax,
                    onChange: (event) => setImageMax(event.target.value),
                    disabled: busy,
                  }),
                ),
          ),
          h(
            Field,
            { label: tx(t, 'collection') },
            h(
              'select',
              {
                className: 'myo-select',
                value: packChoice,
                onChange: (event) => setPackChoice(event.target.value),
                disabled: busy,
              },
              collections.map((pack) =>
                h('option', { key: pack.id, value: pack.id }, pack.name),
              ),
              h('option', { value: 'new' }, tx(t, 'newCollectionOption')),
            ),
          ),
          packChoice === 'new'
            ? h(
                Field,
                { label: tx(t, 'packName'), hint: tx(t, 'packNamePlaceholder') },
                h('input', {
                  className: 'myo-input',
                  value: packName,
                  maxLength: 80,
                  onChange: (event) => setPackName(event.target.value),
                  disabled: busy,
                }),
              )
            : null,
          h(
            Field,
            { label: tx(t, 'tags'), hint: tx(t, 'tagsPlaceholder') },
            h('input', {
              className: 'myo-input',
              value: tags,
              maxLength: 400,
              onChange: (event) => setTags(event.target.value),
              disabled: busy,
            }),
          ),
          h(
            'label',
            { className: 'myo-check' },
            h('input', {
              type: 'checkbox',
              checked: published,
              onChange: (event) => setPublished(event.target.checked),
              disabled: busy,
            }),
            tx(t, 'publishedLabel'),
          ),
          localError ? h('div', { className: 'myo-error' }, localError) : null,
          error ? h('div', { className: 'myo-error' }, error) : null,
          busy
            ? h(
                'div',
                { className: 'myo-generating' },
                h('span', { className: 'myo-spinner' }),
                tx(t, 'generating'),
              )
            : null,
        ),
      );
    }

    function CollectionDialog({ t, busy, error, onSubmit, onClose }) {
      const [name, setName] = useState('');
      const [description, setDescription] = useState('');
      const [tags, setTags] = useState('');
      const [id, setId] = useState('');
      const [published, setPublished] = useState(true);
      const [localError, setLocalError] = useState('');
      const nameRef = useRef(null);

      useEffect(() => {
        nameRef.current?.focus();
      }, []);

      function submit(event) {
        event.preventDefault();
        if (!name.trim()) {
          setLocalError(tx(t, 'nameRequired'));
          nameRef.current?.focus();
          return;
        }
        if (id.trim() && !/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(id.trim())) {
          setLocalError(tx(t, 'idInvalid'));
          return;
        }
        setLocalError('');
        onSubmit({
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          tags: splitTags(tags),
          ...(id.trim() ? { id: id.trim() } : {}),
          published,
        });
      }

      return h(
        Modal,
        {
          title: tx(t, 'collectionDialogTitle'),
          closeLabel: tx(t, 'close'),
          onClose: busy ? () => undefined : onClose,
          footer: [
            h(Button, { key: 'cancel', onClick: onClose, disabled: busy }, tx(t, 'cancel')),
            h(
              Button,
              {
                key: 'create',
                variant: 'primary',
                type: 'submit',
                form: 'myo-collection-form',
                disabled: busy || !name.trim(),
              },
              busy ? tx(t, 'creating') : tx(t, 'createCollection'),
            ),
          ],
        },
        h(
          'form',
          { id: 'myo-collection-form', onSubmit: submit },
          h('div', { className: 'myo-hint' }, tx(t, 'collectionDialogHint')),
          h(
            Field,
            { label: `${tx(t, 'name')} *` },
            h('input', {
              ref: nameRef,
              className: 'myo-input',
              value: name,
              maxLength: 80,
              onChange: (event) => setName(event.target.value),
              placeholder: tx(t, 'namePlaceholder'),
              disabled: busy,
            }),
          ),
          h(
            Field,
            { label: tx(t, 'descriptionLabel') },
            h('textarea', {
              className: 'myo-textarea',
              style: { minHeight: 90 },
              value: description,
              maxLength: 2000,
              onChange: (event) => setDescription(event.target.value),
              placeholder: tx(t, 'descriptionPlaceholder'),
              disabled: busy,
            }),
          ),
          h(
            Field,
            { label: tx(t, 'tags'), hint: tx(t, 'tagsPlaceholder') },
            h('input', {
              className: 'myo-input',
              value: tags,
              maxLength: 400,
              onChange: (event) => setTags(event.target.value),
              disabled: busy,
            }),
          ),
          h(
            Field,
            { label: tx(t, 'idLabel'), hint: tx(t, 'idPlaceholder') },
            h('input', {
              className: 'myo-input',
              value: id,
              maxLength: 64,
              onChange: (event) => setId(event.target.value),
              disabled: busy,
            }),
          ),
          h(
            'label',
            { className: 'myo-check' },
            h('input', {
              type: 'checkbox',
              checked: published,
              onChange: (event) => setPublished(event.target.checked),
              disabled: busy,
            }),
            tx(t, 'publishedLabel'),
          ),
          localError ? h('div', { className: 'myo-error' }, localError) : null,
          error ? h('div', { className: 'myo-error' }, error) : null,
        ),
      );
    }

    function ConfirmDialog({ t, title, body, busy, onConfirm, onClose }) {
      return h(
        Modal,
        {
          title,
          closeLabel: tx(t, 'close'),
          onClose: busy ? () => undefined : onClose,
          footer: [
            h(Button, { key: 'cancel', onClick: onClose, disabled: busy }, tx(t, 'cancel')),
            h(
              Button,
              { key: 'delete', variant: 'danger', onClick: onConfirm, disabled: busy },
              busy ? tx(t, 'deleting') : tx(t, 'confirmDelete'),
            ),
          ],
        },
        h('p', { style: { margin: 0, fontSize: 13, lineHeight: 1.6 } }, body),
        busy
          ? h(
              'div',
              { className: 'myo-generating' },
              h('span', { className: 'myo-spinner' }),
              tx(t, 'deleting'),
            )
          : null,
      );
    }

    function Page(props) {
      const t = boundTranslate || props.t;
      const [catalog, setCatalog] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState('');
      const [activeId, setActiveId] = useState(null);
      const [query, setQuery] = useState('');
      const [modal, setModal] = useState(null);
      const [busy, setBusy] = useState(false);
      const [banner, setBanner] = useState(null);

      async function load(quiet) {
        if (!quiet) setLoading(true);
        setError('');
        try {
          const data = await requestJson('/api/mengyin-official/catalog?includeUnpublished=1');
          setCatalog(data);
          setActiveId((current) => {
            const packs = Array.isArray(data.packs) ? data.packs : [];
            if (current && packs.some((pack) => pack.id === current)) return current;
            return packs.length > 0 ? packs[0].id : null;
          });
        } catch (failure) {
          setError(relativeError(failure));
        } finally {
          setLoading(false);
        }
      }

      useEffect(() => {
        void load();
      }, []);

      const packs = catalog && Array.isArray(catalog.packs) ? catalog.packs : [];
      const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return packs;
        return packs.filter((pack) => {
          const haystack = `${pack.name} ${pack.id} ${pack.description || ''}`.toLowerCase();
          return haystack.includes(needle);
        });
      }, [packs, query]);
      const active = packs.find((pack) => pack.id === activeId) || null;

      function openBank(defaultPackId) {
        setBanner(null);
        setModal({ type: 'bank', defaultPackId: defaultPackId || active?.id || null });
      }

      function openCollection() {
        setBanner(null);
        setModal({ type: 'collection' });
      }

      async function createBank(spec) {
        setBusy(true);
        setModal((current) => (current && current.type === 'bank' ? { ...current, error: '' } : current));
        try {
          const result = await postAction('create-bank', { spec });
          setModal(null);
          setBanner({
            tone: 'success',
            title: tx(t, 'success'),
            text: result.summary,
            warnings: result.warnings,
          });
          await load(true);
          if (result.collection && result.collection.id) setActiveId(result.collection.id);
        } catch (failure) {
          setModal((current) =>
            current && current.type === 'bank'
              ? { ...current, error: relativeError(failure) }
              : current,
          );
        } finally {
          setBusy(false);
        }
      }

      async function createCollection(spec) {
        setBusy(true);
        setModal((current) =>
          current && current.type === 'collection' ? { ...current, error: '' } : current,
        );
        try {
          const result = await postAction('create-pack', { spec });
          setModal(null);
          setBanner({
            tone: 'success',
            title: tx(t, 'success'),
            text: result.summary,
            warnings: result.warnings,
          });
          await load(true);
          if (result.collection && result.collection.id) setActiveId(result.collection.id);
        } catch (failure) {
          setModal((current) =>
            current && current.type === 'collection'
              ? { ...current, error: relativeError(failure) }
              : current,
          );
        } finally {
          setBusy(false);
        }
      }

      async function confirmDelete() {
        if (!modal) return;
        setBusy(true);
        try {
          const target = modal.target;
          const result = await postAction('delete', {
            kind: target.kind,
            packId: target.packId,
            ...(target.deckId ? { deckId: target.deckId } : {}),
            confirm: true,
          });
          if (target.kind === 'collection' && activeId === target.packId) setActiveId(null);
          setModal(null);
          setBanner({
            tone: 'success',
            title: tx(t, 'success'),
            text: result.summary,
            warnings: result.warnings,
          });
          await load(true);
        } catch (failure) {
          setModal(null);
          setBanner({ tone: 'error', title: tx(t, 'error'), text: relativeError(failure) });
        } finally {
          setBusy(false);
        }
      }

      const header = h(
        'header',
        { className: 'myo-header' },
        h(
          'div',
          null,
          h('div', { className: 'myo-eyebrow' }, tx(t, 'eyebrow')),
          h('h1', { className: 'myo-h1' }, tx(t, 'title')),
          h('p', { className: 'myo-sub' }, tx(t, 'subtitle')),
        ),
        h(
          'div',
          { className: 'myo-actions' },
          h(
            Button,
            { onClick: () => void load(), disabled: loading },
            loading ? h('span', { className: 'myo-spinner' }) : null,
            tx(t, 'refresh'),
          ),
          h(
            Button,
            { onClick: openCollection, disabled: busy || loading || !catalog },
            tx(t, 'newCollection'),
          ),
          h(
            Button,
            {
              variant: 'primary',
              onClick: () => openBank(null),
              disabled: busy || loading || !catalog,
            },
            tx(t, 'newBank'),
          ),
        ),
      );

      const visibleBanner = banner || (error ? { tone: 'error', title: tx(t, 'error'), text: error } : null);
      const bannerNode = visibleBanner
        ? h(Banner, {
            tone: visibleBanner.tone,
            title: visibleBanner.title,
            text: visibleBanner.text,
            warnings: visibleBanner.warnings,
            closeLabel: tx(t, 'close'),
            onClose: () => {
              setBanner(null);
              setError('');
            },
          })
        : null;

      if (loading && !catalog) {
        return h(
          'div',
          { className: 'myo-page' },
          h(Styles),
          header,
          h(
            'div',
            { className: 'myo-loading' },
            h('span', { className: 'myo-spinner' }),
            tx(t, 'loading'),
          ),
        );
      }

      if (!catalog) {
        return h(
          'div',
          { className: 'myo-page' },
          h(Styles),
          header,
          h(
            'div',
            { className: 'myo-main' },
            h(
              'div',
              { className: 'myo-empty' },
              h('div', { className: 'myo-empty-title' }, tx(t, 'noCollectionsLoaded')),
              h('p', { className: 'myo-empty-text' }, error || ''),
              h(Button, { variant: 'primary', onClick: () => void load() }, tx(t, 'retry')),
            ),
          ),
        );
      }

      const side = h(
        'aside',
        { className: 'myo-side' },
        h(
          'div',
          { className: 'myo-side-head' },
          h('span', { className: 'myo-side-title' }, tx(t, 'collections')),
          h('span', { className: 'myo-count' }, packs.length),
        ),
        h('input', {
          className: 'myo-input myo-search',
          value: query,
          onChange: (event) => setQuery(event.target.value),
          placeholder: tx(t, 'searchCollections'),
          'aria-label': tx(t, 'searchCollections'),
        }),
        filtered.length === 0
          ? packs.length === 0
            ? null
            : h(
                'div',
                { className: 'myo-empty', style: { padding: '24px 14px', marginTop: 8 } },
                h('div', { className: 'myo-empty-text', style: { marginBottom: 0 } }, tx(t, 'noMatches')),
              )
          : filtered.map((pack) => {
              const state = pack.published ? (pack.visibleInApp ? null : tx(t, 'noPublishedBanks')) : tx(t, 'draft');
              return h(
                'button',
                {
                  key: pack.id,
                  type: 'button',
                  className: 'myo-pack',
                  'data-active': pack.id === activeId ? 'true' : 'false',
                  onClick: () => {
                    setActiveId(pack.id);
                    setBanner(null);
                  },
                },
                h('span', { className: 'myo-crest' }, initials(pack.name)),
                h(
                  'span',
                  { className: 'myo-pack-text' },
                  h('span', { className: 'myo-pack-name' }, pack.name),
                  h(
                    'span',
                    { className: 'myo-muted' },
                    `${formatCount(pack.deckCount || 0, tx(t, 'bankOne'), tx(t, 'bankMany'))}${
                      state ? ` · ${state}` : ''
                    }`,
                  ),
                ),
              );
            }),
      );

      let main;
      if (packs.length === 0) {
        main = h(
          'main',
          { className: 'myo-main' },
          h(
            'div',
            { className: 'myo-empty' },
            h('div', { className: 'myo-empty-title' }, tx(t, 'emptyCollections')),
            h('p', { className: 'myo-empty-text' }, tx(t, 'emptyCollectionsHint')),
            h(
              Button,
              { variant: 'primary', onClick: openCollection, disabled: busy },
              tx(t, 'createFirstCollection'),
            ),
          ),
          h('div', { className: 'myo-footer' }, tx(t, 'refreshHint')),
        );
      } else if (!active) {
        main = h(
          'main',
          { className: 'myo-main' },
          h(
            'div',
            { className: 'myo-empty' },
            h('div', { className: 'myo-empty-title' }, tx(t, 'selectCollection')),
            h('p', { className: 'myo-empty-text' }, tx(t, 'selectCollectionHint')),
          ),
        );
      } else {
        const deckState = (deck) => {
          if (!deck.published) return h(Badge, { tone: 'warn' }, tx(t, 'draft'));
          if (!deck.visibleInApp) return h(Badge, { tone: 'idle' }, tx(t, 'hidden'));
          return h(Badge, { tone: 'success' }, tx(t, 'visible'));
        };
        const packState = !active.published
          ? h(Badge, { tone: 'warn' }, tx(t, 'draft'))
          : active.visibleInApp
            ? h(Badge, { tone: 'success' }, tx(t, 'visible'))
            : h(Badge, { tone: 'idle' }, tx(t, 'noPublishedBanks'));

        main = h(
          'main',
          { className: 'myo-main' },
          h(
            'div',
            { className: 'myo-detail-head' },
            h(
              'div',
              { className: 'myo-detail-id' },
              h('span', { className: 'myo-crest lg' }, initials(active.name)),
              h(
                'div',
                null,
                h('h2', { className: 'myo-h2' }, active.name),
                active.description ? h('p', { className: 'myo-desc' }, active.description) : null,
                h(
                  'div',
                  { className: 'myo-meta' },
                  h('span', null, formatCount(active.deckCount || 0, tx(t, 'bankOne'), tx(t, 'bankMany'))),
                  h('span', { className: 'myo-dot' }),
                  h('code', { className: 'myo-code' }, active.id),
                  h('span', { className: 'myo-dot' }),
                  packState,
                ),
              ),
            ),
            h(
              'div',
              { className: 'myo-actions' },
              h(
                Button,
                { onClick: () => openBank(active.id), disabled: busy },
                tx(t, 'newBank'),
              ),
              h(
                Button,
                {
                  variant: 'danger',
                  onClick: () => {
                    setBanner(null);
                    setModal({
                      type: 'confirm',
                      title: tx(t, 'deleteCollectionTitle'),
                      body: tx(t, 'deleteCollectionBody'),
                      target: { kind: 'collection', packId: active.id },
                    });
                  },
                  disabled: busy,
                },
                tx(t, 'deleteCollection'),
              ),
            ),
          ),
          h(
            'div',
            { className: 'myo-section-head' },
            h('h3', { className: 'myo-h3' }, tx(t, 'banks')),
            h(
              Button,
              { onClick: () => openBank(active.id), disabled: busy },
              tx(t, 'newBank'),
            ),
          ),
          active.decks && active.decks.length > 0
            ? h(
                'div',
                { className: 'myo-list' },
                active.decks.map((deck) =>
                  h(
                    'div',
                    { key: deck.id, className: 'myo-row' },
                    h(
                      'div',
                      { className: 'myo-row-main' },
                      h('div', { className: 'myo-row-title' }, deck.title),
                      h(
                        'div',
                        { className: 'myo-meta' },
                        h(
                          'span',
                          null,
                          formatCount(deck.questions || 0, tx(t, 'questionOne'), tx(t, 'questionMany')),
                        ),
                        deck.examMinutes
                          ? h('span', null, `${deck.examMinutes} ${tx(t, 'minutes')}`)
                          : null,
                        deck.figures
                          ? h(
                              'span',
                              null,
                              formatCount(deck.figures, tx(t, 'figureOne'), tx(t, 'figureMany')),
                            )
                          : null,
                        deck.images
                          ? h(
                              'span',
                              null,
                              formatCount(deck.images, tx(t, 'imageOne'), tx(t, 'imageMany')),
                            )
                          : null,
                        h('code', { className: 'myo-code' }, deck.id),
                      ),
                    ),
                    h(
                      'div',
                      { className: 'myo-row-actions' },
                      deckState(deck),
                      h(
                        Button,
                        {
                          variant: 'danger',
                          onClick: () => {
                            setBanner(null);
                            setModal({
                              type: 'confirm',
                              title: tx(t, 'deleteBankTitle'),
                              body: tx(t, 'deleteBankBody'),
                              target: { kind: 'question_bank', packId: active.id, deckId: deck.id },
                            });
                          },
                          disabled: busy,
                        },
                        tx(t, 'delete'),
                      ),
                    ),
                  ),
                ),
              )
            : h(
                'div',
                { className: 'myo-empty' },
                h('div', { className: 'myo-empty-title' }, tx(t, 'emptyBanks')),
                h('p', { className: 'myo-empty-text' }, tx(t, 'emptyBanksHint')),
                h(
                  Button,
                  { variant: 'primary', onClick: () => openBank(active.id), disabled: busy },
                  tx(t, 'createFirstBank'),
                ),
              ),
          h('div', { className: 'myo-footer' }, tx(t, 'refreshHint')),
        );
      }

      return h(
        'div',
        { className: 'myo-page' },
        h(Styles),
        header,
        bannerNode,
        h('div', { className: 'myo-body' }, side, main),
        modal && modal.type === 'bank'
          ? h(BankDialog, {
              t,
              collections: packs,
              defaultPackId: modal.defaultPackId,
              busy,
              error: modal.error,
              onSubmit: createBank,
              onClose: () => setModal(null),
            })
          : null,
        modal && modal.type === 'collection'
          ? h(CollectionDialog, {
              t,
              busy,
              error: modal.error,
              onSubmit: createCollection,
              onClose: () => setModal(null),
            })
          : null,
        modal && modal.type === 'confirm'
          ? h(ConfirmDialog, {
              t,
              title: modal.title,
              body: modal.body,
              busy,
              onConfirm: confirmDelete,
              onClose: () => setModal(null),
            })
          : null,
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'en', EN));
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH));
        boundTranslate = ctx.locale.bind(NS);

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PAGE_KEY,
              order: 20,
              label: () => ctx.locale.bind(NS)('nav'),
            },
            PanelIcon,
          ),
        );

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: PAGE_KEY,
              locale: NS,
            },
            Page,
          ),
        );
      },
    };
  },
});

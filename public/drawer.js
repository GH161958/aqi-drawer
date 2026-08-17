if (window.gsap && window.Flip) {
  gsap.registerPlugin(Flip)
  console.info('[Aqi Drawer] GSAP + Flip ready', gsap.version)
} else {
  console.warn('[Aqi Drawer] GSAP or Flip missing')
}

const list = document.querySelector('#item-list')
const shell = document.querySelector('.drawer-shell')
const cabinetHome = document.querySelector('#cabinet-home')
const cabinetStatus = document.querySelector('#cabinet-status')
const collectionView = document.querySelector('#collection-view')
const collectionTitle = document.querySelector('#collection-title')
const archiveIndex = document.querySelector('#archive-index')
const collectionIndex = document.querySelector('#collection-index')
const sourceIndex = document.querySelector('#source-index')
const closeDrawer = document.querySelector('#close-drawer')
const openTriggers = [...document.querySelectorAll('[data-open-status]')]
const loading = document.querySelector('#loading')
const empty = document.querySelector('#empty')
const errorState = document.querySelector('#error')
const errorMessage = document.querySelector('#error-message')
const retry = document.querySelector('#retry')
const dialog = document.querySelector('#item-detail')
const detailContent = document.querySelector('#detail-content')
const closeDetail = document.querySelector('#close-detail')
const typeDialog = document.querySelector('#type-cabinet')
const typeToggle = document.querySelector('#type-cabinet-toggle')
const closeTypeCabinet = document.querySelector('#close-type-cabinet')
const typePresets = [...document.querySelectorAll('[data-type-preset]')]
const wearType = document.querySelector('#wear-type')
const resetType = document.querySelector('#reset-type')
const typeStatus = document.querySelector('#type-status')
const typeFontManifest = document.querySelector('#type-font-manifest')
const authDialog = document.querySelector('#drawer-auth')
const authForm = document.querySelector('#drawer-auth-form')
const authSecret = document.querySelector('#drawer-auth-secret')
const authStatus = document.querySelector('#drawer-auth-status')
const authCancel = document.querySelector('#drawer-auth-cancel')

const statusLabels = {
  inbox: '刚放进来',
  tonight: '今晚看看',
  discussed: '聊过了',
  deferred: '晚点再看',
  memory_candidate: '想留住',
  archived: '收好了',
}

function pocketApi(pathname = '') {
  const path = String(pathname)
  if (path && !path.startsWith('/')) throw new Error('Pocket API path must start with /.')
  return `/api/pocket${path}`
}

async function apiFetch(path, options = {}) {
  if (!String(path).startsWith('/api/pocket/')) throw new Error('Drawer API requests must use the same-origin Pocket path.')
  let response
  try {
    response = await fetch(path, { ...options, credentials: 'same-origin' })
  } catch (error) {
    console.error('Drawer API network failure.', error)
    throw new Error('无法连接当前网站的 Drawer API。')
  }
  if (response.status === 401) {
    showDrawerAuth('这只抽屉需要先确认身份。')
    throw new Error('请先打开私人抽屉。')
  }
  return response
}

function showDrawerAuth(message = '') {
  authStatus.textContent = message
  if (!authDialog.open) authDialog.showModal()
  window.setTimeout(() => authSecret.focus(), 0)
}

const typePresetNames = new Set(['archive', 'bookish', 'paper', 'print'])
const typeStorageKey = 'aqi-drawer:type-preset'
const typePresetManifest = {
  archive: {
    display: 'Gloock', cjk: 'Noto Serif SC', body: 'Source Serif 4', meta: 'IBM Plex Sans / Mono',
    href: 'https://fonts.googleapis.com/css2?family=Gloock&family=IBM+Plex+Mono:wght@400&family=IBM+Plex+Sans:wght@400;500&family=Noto+Serif+SC:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap',
  },
  bookish: {
    display: 'Newsreader', cjk: 'LXGW WenKai', body: 'Newsreader', meta: 'IBM Plex Sans',
    href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&family=LXGW+WenKai&family=Newsreader:opsz,wght@6..72,400;6..72,600&display=swap',
  },
  paper: {
    display: 'Instrument Serif', cjk: 'ZCOOL XiaoWei', body: 'Noto Serif SC', meta: 'IBM Plex Sans',
    href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&family=Instrument+Serif&family=Noto+Serif+SC:wght@400;500&family=ZCOOL+XiaoWei&display=swap',
  },
  print: {
    display: 'Fraunces', cjk: 'Noto Serif SC', body: 'Spectral', meta: 'IBM Plex Sans',
    href: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500&family=Noto+Serif+SC:wght@400;600;700&family=Spectral:wght@400;600&display=swap',
  },
}

let activeStatus = ''
let lastCabinetTrigger = null
let cabinetCounts = { all: 0 }
let inspectedItemRow = null
let activeDetailItem = null
let loadedItems = []
let activeCollection = ''
let activeSource = ''
let committedTypePreset = readTypePreset()
let draftTypePreset = committedTypePreset
let lockedScrollY = 0

applyTypePreset(committedTypePreset)
document.body.classList.add('is-cabinet-home')
updateVisibleViewport()
window.visualViewport?.addEventListener('resize', updateVisibleViewport)
window.visualViewport?.addEventListener('scroll', updateVisibleViewport)
window.addEventListener('resize', updateVisibleViewport)

/* DETAIL KEYBOARD VIEWPORT FREEZE V2 BEGIN */

var detailKeyboardViewportFrozen = false
let detailKeyboardReleaseTimer = null

function isDetailEditorControl(node) {
  return Boolean(
    node
    && detailContent.contains(node)
    && node.matches('input, textarea, select')
  )
}

detailContent.addEventListener('focusin', (event) => {
  if (!isDetailEditorControl(event.target)) return

  if (detailKeyboardReleaseTimer) {
    window.clearTimeout(detailKeyboardReleaseTimer)
    detailKeyboardReleaseTimer = null
  }

  /*
    Freeze BEFORE the software keyboard changes visualViewport.
    The paper keeps the exact geometry it had when editing began.
  */
  detailKeyboardViewportFrozen = true
  document.body.classList.add('is-detail-keyboard-editing')
})

detailContent.addEventListener('focusout', () => {
  if (detailKeyboardReleaseTimer) {
    window.clearTimeout(detailKeyboardReleaseTimer)
  }

  /*
    iOS animates the keyboard closed for a short moment.
    Keep the geometry frozen during that animation too.
  */
  detailKeyboardReleaseTimer = window.setTimeout(() => {
    if (isDetailEditorControl(document.activeElement)) {
      return
    }

    detailKeyboardViewportFrozen = false
    detailKeyboardReleaseTimer = null

    document.body.classList.remove(
      'is-detail-keyboard-editing',
    )

    /*
      Only now, after the keyboard has returned the viewport,
      recalculate the visible browser area.
    */
    updateVisibleViewport()
  }, 360)
})

/* DETAIL KEYBOARD VIEWPORT FREEZE V2 END */

async function loadCabinetCounts() {
  try {
    const response = await apiFetch(pocketApi('/items?limit=500'), { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`请求失败（${response.status}）`)
    const payload = await response.json()
    const items = Array.isArray(payload.items) ? payload.items : []
    const counts = Object.fromEntries(Object.keys(statusLabels).map((status) => [status, 0]))
    items.forEach((item) => {
      if (Object.hasOwn(counts, item.status)) counts[item.status] += 1
    })
    cabinetCounts = { ...counts, all: items.length }
    document.querySelector('#count-all').textContent = archiveNumber(items.length)
    document.querySelectorAll('[data-count-status]').forEach((node) => {
      const count = counts[node.dataset.countStatus] || 0
      node.textContent = count ? archiveNumber(count) : ''
      node.setAttribute('aria-label', `${count} 件`)
    })
    applyCabinetContents(items)
    cabinetStatus.hidden = true
  } catch (error) {
    cabinetStatus.textContent = error.message || '暂时没能核对每一格。'
  }
}

async function loadItems() {
  setState('loading')
  const query = new URLSearchParams({ limit: '200' })
  if (activeStatus) query.set('status', activeStatus)

  try {
    const response = await apiFetch(pocketApi(`/items?${query}`), { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(response.status === 401 ? '本地 API 需要授权。' : `请求失败（${response.status}）`)
    const payload = await response.json()
    loadedItems = Array.isArray(payload.items) ? payload.items : []
    renderArchiveIndex(loadedItems)
    applyIndexFilters()
  } catch (error) {
    errorMessage.textContent = error.message || '无法读取 Drawer items。'
    setState('error')
  }
}

function setState(state) {
  loading.hidden = state !== 'loading'
  empty.hidden = state !== 'empty'
  errorState.hidden = state !== 'error'
  list.hidden = state !== 'ready'
  shell.setAttribute('aria-busy', String(state === 'loading'))
}

function renderArchiveIndex(items) {
  archiveIndex.hidden = Boolean(activeStatus)
  if (activeStatus) return
  const collections = [...new Set(items.map((item) => item.collection).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const sources = [...new Set(items.map(sourceCategory))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  if (activeCollection && !collections.includes(activeCollection)) activeCollection = ''
  if (activeSource && !sources.includes(activeSource)) activeSource = ''
  collectionIndex.replaceChildren(
    createIndexButton('全部', '', 'collection'),
    ...collections.map((collection) => createIndexButton(collection, collection, 'collection')),
  )
  sourceIndex.replaceChildren(
    createIndexButton('全部来源', '', 'source'),
    ...sources.map((source) => createIndexButton(source, source, 'source')),
  )
}

function createIndexButton(label, value, kind) {
  const button = element('button', 'index-entry', label)
  button.type = 'button'
  const selected = kind === 'collection' ? activeCollection === value : activeSource === value
  button.classList.toggle('is-current', selected)
  button.setAttribute('aria-pressed', String(selected))
  button.addEventListener('click', () => {
    if (kind === 'collection') activeCollection = value
    else activeSource = value
    renderArchiveIndex(loadedItems)
    applyIndexFilters()
  })
  return button
}

function applyIndexFilters() {
  const items = loadedItems.filter((item) => (!activeCollection || item.collection === activeCollection)
    && (!activeSource || sourceCategory(item) === activeSource))
  renderItems(items)
  setState(items.length ? 'ready' : 'empty')
}

function renderItems(items) {
  list.replaceChildren(...items.map((item) => {
    const visualKind = itemVisualKind(item)
    const row = document.createElement('li')
    row.className = `item-row item-${visualKind}`
    row.dataset.kind = visualKind
    row.classList.add(`bundle-${stableVariant(item.id)}`)

    const recordTab = document.createElement('button')
    recordTab.type = 'button'
    recordTab.className = 'bundle-record-tab'
    recordTab.setAttribute('aria-label', `打开「${item.title || '这件东西'}」的记录`)
    const activityCount = Array.isArray(item.activity) ? item.activity.length : 0
    const recordLabel = activityCount ? `RECORD · ${archiveNumber(activityCount)}` : 'RECORD'
    recordTab.textContent = recordLabel
    recordTab.dataset.label = recordLabel
    recordTab.classList.toggle('has-activity', activityCount > 0)
    recordTab.classList.toggle('is-quiet', activityCount === 0)
    recordTab.addEventListener('click', () => showDetail(item.id, row, 'record'))

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'item-button item-paper'
    button.addEventListener('click', () => showDetail(item.id, row, 'original'))

    if (visualKind === 'xiaohongshu') {
      button.classList.add('xhs-object')
      button.append(createXhsPreview(item))
    } else if (visualKind === 'link') {
      button.classList.add('link-object')
      button.append(createLinkClipping(item))
    } else if (visualKind === 'image') {
      button.classList.add('image-object')
      button.append(createImagePreview(item))
    } else if (visualKind === 'attachment') {
      button.classList.add('document-object')
      button.append(createDocumentPreview(item))
    } else {
      const title = element('h2', 'item-title', item.title || '没有标题的一张纸')
      const preview = element('p', 'item-preview', item.text || item.contentRead?.textPreview || '这件东西没有留下文字。')
      button.append(title, preview, createItemMeta(item))
    }
    const additions = createStorageAdditions(item, row)
    row.classList.toggle('has-side-notes', Boolean(additions))
    row.append(recordTab, button)
    if (additions) row.append(additions)
    return row
  }))
}

function createLinkClipping(item) {
  const clipping = element('div', 'link-clipping')
  const masthead = element('div', 'clipping-masthead')
  masthead.append(
    element('span', 'clipping-source', sourceName(item)),
    element('span', 'clipping-index', formatDate(item.lastReceivedAt || item.createdAt)),
  )
  clipping.append(masthead, element('h2', 'item-title', item.title || '收进来的一页网页'))
  const previewText = item.text || item.contentRead?.textPreview
  if (previewText) clipping.append(element('p', 'item-preview clipping-preview', previewText))
  clipping.append(createItemMeta(item))
  return clipping
}

function createStorageAdditions(item, row) {
  const hasNote = Boolean(item.note)
  const replyCount = Array.isArray(item.replies) ? item.replies.length : 0
  if (!hasNote && !replyCount) return null
  const additions = element('div', 'storage-additions annotation-rail')
  if (hasNote) {
    const note = element('button', 'storage-slip storage-note-slip')
    note.type = 'button'
    note.addEventListener('click', () => showDetail(item.id, row, 'ee-note'))
    note.append(element('strong', '', 'EE 留了一句'))
    additions.append(note)
  }
  if (replyCount) {
    const label = replyCount === 1 ? 'Aqi 留了一张回条' : `Aqi 留了 ${replyCount} 张回条`
    const reply = element('button', 'storage-slip storage-reply-slip', label)
    reply.type = 'button'
    reply.addEventListener('click', () => showDetail(item.id, row, 'aqi-note'))
    additions.append(reply)
  }
  return additions
}

function createImagePreview(item) {
  const object = element('div', 'image-print-object')
  const images = imageAttachments(item).slice(0, 3)
  const stack = element('div', 'image-print-stack')
  images.forEach((attachment, index) => {
    const image = document.createElement('img')
    image.src = attachment.url
    image.alt = index === 0 ? (item.title || attachment.name || '收藏图片') : ''
    image.loading = 'lazy'
    image.style.setProperty('--image-index', index)
    stack.append(image)
  })
  object.append(stack, element('p', 'image-caption', item.title || '收进来的一张照片'), createItemMeta(item))
  return object
}

function createDocumentPreview(item) {
  const attachment = (item.attachments || [])[0]
  const object = element('div', 'document-sheet')
  object.append(
    element('p', 'document-kicker', attachment?.mimeType || 'ATTACHMENT'),
    element('h2', 'item-title', item.title || attachment?.name || '收进来的文件'),
  )
  if (item.text) object.append(element('p', 'item-preview', item.text))
  object.append(createItemMeta(item))
  return object
}

function createXhsPreview(item) {
  const object = element('div', 'xhs-storage-object')
  const images = imageAttachments(item).slice(0, 3)
  if (images.length) {
    const stack = element('div', 'xhs-photo-stack')
    images.forEach((attachment, index) => {
      const image = document.createElement('img')
      image.src = attachment.url
      image.alt = index === 0 ? (item.title || '小红书收藏图片') : ''
      image.loading = 'lazy'
      image.style.setProperty('--photo-index', index)
      image.style.setProperty('--photo-count', images.length)
      stack.append(image)
    })
    object.append(stack)
  }
  const sheet = element('div', 'xhs-caption-slip')
  const author = item.sourceData?.author?.name
  sheet.append(element('h2', 'item-title', item.title || item.sourceData?.title || '收进来的一页'))
  if (author) sheet.append(element('p', 'xhs-author', author))
  const record = element('p', 'xhs-preview-record')
  record.append(
    element('span', '', item.sourceApp || '小红书'),
    element('span', 'archive-separator', '·'),
    element('time', '', formatDate(item.lastReceivedAt || item.createdAt)),
  )
  sheet.append(record)
  object.append(sheet)
  return object
}

function itemVisualKind(item) {
  if (item.sourceIdentity?.provider === 'xiaohongshu' || item.sourceData?.provider === 'xiaohongshu') return 'xiaohongshu'
  if (item.kind === 'image') return 'image'
  if (item.kind === 'link' || item.sourceUrl) return 'link'
  if (item.attachments?.length) return 'attachment'
  return item.kind === 'text' ? 'text' : 'note'
}

function sourceCategory(item) {
  const kind = itemVisualKind(item)
  if (kind === 'xiaohongshu') return '小红书'
  if (kind === 'image') return '图片'
  if (kind === 'attachment') {
    const mime = item.attachments?.[0]?.mimeType || ''
    return mime.startsWith('video/') ? '视频' : '文档'
  }
  if (kind === 'link') return '网页'
  return '文字'
}

function stableVariant(id) {
  let hash = 0
  for (const character of String(id || '')) hash = ((hash << 5) - hash + character.codePointAt(0)) | 0
  return ['a', 'b', 'c', 'd', 'e'][Math.abs(hash) % 5]
}

function drawerMotionReduced() {
  return window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches
}

async function pickUpSourceRow(row) {
  if (!row) return

  row.classList.add('is-lifting')

  if (window.gsap && !drawerMotionReduced()) {
    await new Promise((resolve) => {
      gsap.to(row, {
        y: -4,
        duration: 0.11,
        ease: 'power2.out',
        onComplete: resolve,
      })
    })
  } else {
    await new Promise((resolve) => {
      window.setTimeout(resolve, 80)
    })
  }

  row.classList.add('is-picked-up')

  if (window.gsap) {
    gsap.set(row, {
      clearProps: 'transform',
    })
  }
}

async function restoreSourceRow(row) {
  if (!row) return

  if (window.gsap && !drawerMotionReduced()) {
    gsap.set(row, {
      opacity: 0,
      y: -4,
    })

    row.classList.remove(
      'is-picked-up',
      'is-lifting',
    )

    await new Promise((resolve) => {
      gsap.to(row, {
        opacity: 1,
        y: 0,
        duration: 0.15,
        ease: 'power2.out',
        clearProps: 'transform,opacity',
        onComplete: resolve,
      })
    })

    return
  }

  row.classList.remove(
    'is-picked-up',
    'is-lifting',
  )
}

function rerenderDetailQuietly(item, panel = 'original') {
  detailContent.dataset.quietRefresh = 'true'
  renderDetail(item, panel)
  window.requestAnimationFrame(() => {
    delete detailContent.dataset.quietRefresh
  })
}

async function showDetail(id, row, panel = 'original') {
  inspectedItemRow = row

  await pickUpSourceRow(row)

  detailContent.replaceChildren(
    element(
      'p',
      'state-message',
      '正在取出这张纸……',
    ),
  )

  lockPageScroll()
  updateVisibleViewport()

  dialog.showModal()
  dialog.classList.add('is-entering')

  window.setTimeout(
    () => dialog.classList.remove('is-entering'),
    220,
  )

  try {
    const response = await apiFetch(
      pocketApi(`/items/${encodeURIComponent(id)}`),
      {
        headers: {
          accept: 'application/json',
        },
      },
    )

    if (!response.ok) {
      throw new Error(
        `详情读取失败（${response.status}）`,
      )
    }

    const { item } = await response.json()

    renderDetail(item, panel)
  } catch (error) {
    detailContent.replaceChildren(
      element(
        'p',
        'state-message',
        error.message || '暂时无法读取详情。',
      ),
    )
  }
}

function renderDetail(item, panel = 'original') {
  activeDetailItem = item

  const fragment = document.createDocumentFragment()
  const visualKind = itemVisualKind(item)

  dialog.dataset.kind = visualKind
  dialog.dataset.panel = panel

  const stage = element('div', 'inspect-stage')

  const original = element('section', 'inspect-original')
  const originalContent = document.createDocumentFragment()

  if (visualKind === 'xiaohongshu') {
    renderXhsDetail(item, originalContent)
  } else if (visualKind === 'link') {
    renderLinkDetail(item, originalContent)
  } else {
    renderPaperDetail(item, originalContent)
  }

  original.append(originalContent)

  stage.append(
    createInspectRecordPeek(item),
    original,
    createInspectSideTabs(item),
    createInspectFilingPeek(item),
  )

  fragment.append(stage)
  fragment.append(createItemRecord(item))

  appendSecondaryPapers(item, fragment)
  fragment.append(createFilingSlip(item))

  fragment.querySelectorAll('.detail-aux-panel').forEach((node) => {
    node.hidden = true
  })

  detailContent.replaceChildren(fragment)

  detailContent.querySelectorAll('.detail-aux-panel').forEach((node) => {
    ensurePaperReturnControl(node)
  })

  setDetailPanel(panel)
}

function createInspectRecordPeek(item) {
  const count = Array.isArray(item.activity) ? item.activity.length : 0
  const label = count ? `RECEIPT · ${archiveNumber(count)}` : 'RECEIPT'

  const button = element('button', 'inspect-record-peek', label)
  button.type = 'button'
  button.dataset.inspectPanel = 'record'
  button.setAttribute('aria-label', '打开 Record')

  button.addEventListener('click', () => {
    const current = detailContent.dataset.openPanel || 'original'
    setDetailPanel(current === 'record' ? 'original' : 'record')
  })

  return button
}

function createInspectSideTabs(item) {
  const tabs = element('div', 'inspect-side-tabs')

  const ee = element('button', 'inspect-side-tab inspect-ee-tab', 'EE')
  ee.type = 'button'
  ee.dataset.inspectPanel = 'ee-note'
  ee.setAttribute('aria-label', item.note ? '打开 EE Note' : '留一句 EE Note')

  ee.addEventListener('click', () => {
    const current = detailContent.dataset.openPanel || 'original'
    setDetailPanel(current === 'ee-note' ? 'original' : 'ee-note')
  })

  tabs.append(ee)

  const replies = Array.isArray(item.replies) ? item.replies : []

  if (replies.length) {
    const aqi = element('button', 'inspect-side-tab inspect-aqi-tab', 'Aqi')
    aqi.type = 'button'
    aqi.dataset.inspectPanel = 'aqi-note'
    aqi.setAttribute('aria-label', '打开 Aqi Note')

    aqi.addEventListener('click', () => {
      const current = detailContent.dataset.openPanel || 'original'
      setDetailPanel(current === 'aqi-note' ? 'original' : 'aqi-note')
    })

    tabs.append(aqi)
  }

  return tabs
}

function createInspectFilingPeek(item) {
  const button = element('button', 'inspect-filing-peek')
  button.type = 'button'
  button.dataset.inspectPanel = 'filing'
  button.setAttribute('aria-label', '打开 Filing')

  button.append(
    element('span', 'inspect-filing-label', `FILING · ${statusLabels[item.status] || item.status || '—'}`),
    element('span', 'inspect-filing-note', '看完放哪儿？'),
  )

  button.addEventListener('click', () => {
    const current = detailContent.dataset.openPanel || 'original'
    setDetailPanel(current === 'filing' ? 'original' : 'filing')
  })

  return button
}

function renderPaperDetail(item, fragment) {
  fragment.append(element('h2', 'detail-title', item.title || '没有标题的一张纸'))

  const text = item.text || item.contentRead?.textPreview
  if (text) fragment.append(element('p', 'detail-text', text))

  const detailImages = imageAttachments(item)
  if (detailImages.length) {
    const spread = element('div', 'detail-images')
    detailImages.forEach((attachment) => {
      const image = document.createElement('img')
      image.className = 'detail-image'
      image.src = attachment.url
      image.alt = attachment.name || item.title || 'Drawer 图片附件'
      image.loading = 'lazy'
      spread.append(image)
    })
    fragment.append(spread)
  }

  fragment.append(createItemMeta(item, 'detail-item-meta'))

  if (item.sourceUrl) {
    const source = document.createElement('a')
    source.className = 'source-link'
    source.href = item.sourceUrl
    source.target = '_blank'
    source.rel = 'noreferrer noopener'
    source.textContent = visualKind === 'xiaohongshu' ? '原帖 ↗' : '打开原出处'
    fragment.append(source)
  }

}

function renderLinkDetail(item, fragment) {
  const clipping = element('article', 'link-detail-clipping')
  const masthead = element('div', 'clipping-masthead')
  masthead.append(
    element('span', 'clipping-source', sourceName(item)),
    element('span', 'clipping-index', formatDate(item.lastReceivedAt || item.createdAt)),
  )
  clipping.append(masthead, element('h2', 'detail-title', item.title || '收进来的一页网页'))
  if (item.text) clipping.append(element('p', 'detail-text link-saved-text', item.text))
  clipping.append(createItemMeta(item, 'detail-item-meta'))

  const readArea = element('section', 'link-read-area')
  readArea.setAttribute('aria-label', '来源内容')
  const readButton = element('button', 'read-source-button', '展开来源')
  readButton.type = 'button'
  readButton.addEventListener('click', () => readLinkContent(item, readArea, 'compact', 0))
  readArea.append(readButton)
  clipping.append(readArea)

  if (item.sourceUrl) clipping.append(createSourceLink(item.sourceUrl, '原网页 ↗'))
  fragment.append(clipping)
}

function renderXhsDetail(item, fragment) {
  const images = imageAttachments(item)
  if (images.length) fragment.append(createXhsPhotoViewer(item, images))

  const note = element('section', 'xhs-detail-note')
  note.append(element('h2', 'detail-title', item.title || item.sourceData?.title || '收进来的一页'))
  const author = item.sourceData?.author?.name
  if (author) note.append(element('p', 'xhs-author detail-author', author))
  const text = item.text || item.sourceData?.desc || item.contentRead?.textPreview
  if (text) note.append(element('p', 'detail-text', text))
  fragment.append(note, createXhsRecordSlip(item, images.length))
}

function createXhsPhotoViewer(item, images) {
  const viewer = element('section', 'xhs-detail-photos')
  viewer.setAttribute('aria-label', `小红书照片，共 ${images.length} 张`)
  const stage = element('div', 'xhs-photo-stage')
  const mainImage = document.createElement('img')
  mainImage.className = 'xhs-main-photo'
  mainImage.src = images[0].url
  mainImage.alt = images[0].name || item.title || '小红书图片 1'
  stage.append(mainImage)
  viewer.append(stage)

  if (images.length > 1) {
    const thumbnails = element('div', 'xhs-thumbnails')
    thumbnails.setAttribute('aria-label', '选择照片')
    images.forEach((attachment, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'xhs-thumbnail'
      button.setAttribute('aria-label', `查看第 ${index + 1} 张照片`)
      button.setAttribute('aria-pressed', String(index === 0))
      const thumbnail = document.createElement('img')
      thumbnail.src = attachment.url
      thumbnail.alt = ''
      thumbnail.loading = 'lazy'
      button.append(thumbnail)
      button.addEventListener('click', () => {
        mainImage.src = attachment.url
        mainImage.alt = attachment.name || item.title || `小红书图片 ${index + 1}`
        thumbnails.querySelectorAll('.xhs-thumbnail').forEach((node) => {
          node.setAttribute('aria-pressed', String(node === button))
        })
      })
      thumbnails.append(button)
    })
    viewer.append(thumbnails)
  }
  return viewer
}

function createXhsRecordSlip(item, imageCount) {
  const record = element('dl', 'xhs-record-slip')
  appendRecord(record, '来源', item.sourceApp || '小红书')
  if (item.sourceData?.author?.name) appendRecord(record, '作者', item.sourceData.author.name)
  appendRecord(record, '日期', formatDate(item.lastReceivedAt || item.createdAt))
  appendRecord(record, '图片', `${imageCount} 张`)
  if (item.sourceUrl) {
    const row = element('div', 'xhs-record-row')
    row.append(element('dt', '', '原帖'))
    const value = element('dd', '')
    const source = document.createElement('a')
    source.href = item.sourceUrl
    source.target = '_blank'
    source.rel = 'noreferrer noopener'
    source.textContent = '打开原帖 ↗'
    value.append(source)
    row.append(value)
    record.append(row)
  }
  return record
}

function appendRecord(record, label, value) {
  const row = element('div', 'xhs-record-row')
  row.append(element('dt', '', label), element('dd', '', value))
  record.append(row)
}

function appendSecondaryPapers(item, fragment) {
  fragment.append(createEeNoteEditor(item))
  const replies = Array.isArray(item.replies)
    ? [...item.replies].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    : []
  if (replies.length) {
    const group = element('section', 'reply-slip-group')
    group.setAttribute('aria-label', '夹入的回条')
    group.classList.add('detail-aux-panel')
    group.dataset.panel = 'aqi-note'
    replies.forEach((reply) => group.append(createReplySlip(item, reply)))
    fragment.append(group)
  }
}

function createItemRecord(item) {
  const record = element('section', 'item-record detail-aux-panel')
  record.dataset.panel = 'record'
  const heading = element('div', 'record-heading')
  heading.append(
    element('p', 'record-kicker', 'AQI DRAWER'),
    element('h2', 'record-title', 'ITEM RECORD'),
    element('span', 'record-count', Array.isArray(item.activity) && item.activity.length ? archiveNumber(item.activity.length) : ''),
  )
  record.append(heading, createRecordIndex(item), createActivityLedger(item))
  return record
}

function createRecordIndex(item) {
  const section = element('section', 'record-index')
  section.append(element('h3', 'record-section-title', 'CURRENT INDEX'))
  section.append(recordField('SOURCE', sourceName(item)))

  const form = element('form', 'metadata-form')
  const collectionLabel = element('label', 'record-edit-field')
  collectionLabel.append(element('span', '', 'COLLECTION'))
  const collectionInput = document.createElement('input')
  collectionInput.name = 'collection'
  collectionInput.maxLength = 80
  collectionInput.value = item.collection || ''
  collectionInput.placeholder = '尚未分类'
  collectionLabel.append(collectionInput)
  const existingCollections = [...new Set(loadedItems.map((entry) => entry.collection).filter(Boolean))]
  const collectionSuggestions = element('div', 'collection-suggestions')
  existingCollections.forEach((collection) => {
    const suggestion = element('button', 'collection-suggestion', collection)
    suggestion.type = 'button'
    suggestion.addEventListener('click', () => { collectionInput.value = collection })
    collectionSuggestions.append(suggestion)
  })

  const tagsLabel = element('label', 'record-edit-field')
  tagsLabel.append(element('span', '', 'INDEX TERMS'))
  const tagsInput = document.createElement('input')
  tagsInput.name = 'tags'
  tagsInput.value = (item.tags || []).join(' · ')
  tagsInput.placeholder = '用逗号或 · 分开'
  tagsLabel.append(tagsInput)
  form.append(collectionLabel)
  if (item.collection) {
    const removeCollection = element('button', 'record-action record-clear collection-remove', '移出分类')
    removeCollection.type = 'button'
    removeCollection.addEventListener('click', () => saveMetadata(item, form, true))
    form.append(removeCollection)
  }
  if (existingCollections.length) form.append(collectionSuggestions)
  form.append(tagsLabel)

  const sourceTags = getSourceTags(item)
  if (sourceTags.length) form.append(recordField('SOURCE TAGS', sourceTags.map((tag) => `#${tag}`).join('  ')))
  const actions = element('div', 'metadata-actions')
  const save = element('button', 'record-action', '记下整理')
  save.type = 'submit'
  const feedback = element('p', 'metadata-feedback')
  actions.append(save)
  form.append(actions, feedback)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    saveMetadata(item, form, false)
  })
  section.append(form)
  return section
}

function recordField(label, value) {
  const row = element('div', 'record-field')
  row.append(element('span', 'record-field-label', label), element('span', 'record-field-value', value || '—'))
  return row
}

function createActivityLedger(item) {
  const section = element('section', 'activity-ledger')
  section.append(element('h3', 'record-section-title', 'LIVING RECORD'))
  const entries = Array.isArray(item.activity) ? [...item.activity].sort((a, b) => String(a.at).localeCompare(String(b.at))) : []
  if (!entries.length) {
    section.append(element('p', 'record-empty', '还没有留下可记录的动作。'))
    return section
  }
  const list = element('ol', 'activity-list')
  entries.forEach((entry) => {
    const row = document.createElement('li')
    row.append(
      element('time', 'activity-time', formatActivityTime(entry.at)),
      element('span', 'activity-event', activityLabel(entry)),
    )
    list.append(row)
  })
  section.append(list)
  return section
}

function inspectPanelSource(panel) {
  return detailContent.querySelector(`[data-inspect-panel="${panel}"]`)
}

function setInspectSourceWithdrawn(panel, withdrawn) {
  const source = inspectPanelSource(panel)
  if (!source) return
  source.classList.toggle('is-withdrawn', withdrawn)
}

function ensurePaperReturnControl(panelNode) {
  let control = panelNode.querySelector(':scope > .inspect-paper-return')

  if (control) return control

  control = element('button', 'inspect-paper-return', '放回这张')
  control.type = 'button'
  control.addEventListener('click', () => setDetailPanel('original'))

  panelNode.prepend(control)

  return control
}

function animatePulledPaperIn(panelNode, panel) {
  if (!window.gsap || drawerMotionReduced()) return

  const from = {
    record: { marginLeft: -22, marginTop: -15 },
    'ee-note': { marginLeft: 24, marginTop: 0 },
    'aqi-note': { marginLeft: 24, marginTop: 4 },
    filing: { marginLeft: 0, marginTop: 22 },
  }[panel] || { marginLeft: 0, marginTop: 10 }

  gsap.killTweensOf(panelNode)

  gsap.fromTo(
    panelNode,
    {
      opacity: 0,
      marginLeft: from.marginLeft,
      marginTop: from.marginTop,
    },
    {
      opacity: 1,
      marginLeft: 0,
      marginTop: 0,
      duration: 0.22,
      ease: 'power2.out',
      clearProps: 'opacity,marginLeft,marginTop',
    },
  )
}

function animatePulledPaperOut(panelNode, panel, done) {
  if (!window.gsap || drawerMotionReduced()) {
    done()
    return
  }

  const to = {
    record: { marginLeft: -18, marginTop: -12 },
    'ee-note': { marginLeft: 20, marginTop: 0 },
    'aqi-note': { marginLeft: 20, marginTop: 3 },
    filing: { marginLeft: 0, marginTop: 18 },
  }[panel] || { marginLeft: 0, marginTop: 8 }

  gsap.killTweensOf(panelNode)

  gsap.to(panelNode, {
    opacity: 0,
    marginLeft: to.marginLeft,
    marginTop: to.marginTop,
    duration: 0.16,
    ease: 'power1.in',
    onComplete: done,
  })
}

function setDetailPanel(panel) {
  const auxPanels = [...detailContent.querySelectorAll('.detail-aux-panel')]
  const target = auxPanels.find((node) => node.dataset.panel === panel)
  const targetPanel = target?.dataset.panel || 'original'
  const currentlyOpen = auxPanels.find((node) => !node.hidden)

  if (targetPanel === 'original') {
    const previousPanel = currentlyOpen?.dataset.panel

    const finishReturn = () => {
      auxPanels.forEach((node) => {
        node.hidden = true
        setInspectSourceWithdrawn(node.dataset.panel, false)

        if (window.gsap) {
          gsap.set(node, {
            clearProps: 'opacity,marginLeft,marginTop',
          })
        }
      })

      detailContent.dataset.openPanel = 'original'

      detailContent.querySelectorAll('[data-inspect-panel]').forEach((control) => {
        control.classList.remove('is-open')
        control.setAttribute('aria-pressed', 'false')
      })

      const original = detailContent.querySelector('.inspect-original')
      original?.classList.remove('has-attached-paper')

      if (previousPanel) {
        inspectPanelSource(previousPanel)?.focus({
          preventScroll: true,
        })
      }
    }

    if (currentlyOpen) {
      animatePulledPaperOut(
        currentlyOpen,
        previousPanel,
        finishReturn,
      )
    } else {
      finishReturn()
    }

    return
  }

  auxPanels.forEach((node) => {
    const isTarget = node === target

    if (!isTarget) {
      node.hidden = true
      setInspectSourceWithdrawn(node.dataset.panel, false)

      if (window.gsap) {
        gsap.set(node, {
          clearProps: 'opacity,marginLeft,marginTop',
        })
      }
    }
  })

  target.hidden = false

  ensurePaperReturnControl(target)
  setInspectSourceWithdrawn(targetPanel, true)

  detailContent.dataset.openPanel = targetPanel

  detailContent.querySelectorAll('[data-inspect-panel]').forEach((control) => {
    const selected = control.dataset.inspectPanel === targetPanel

    control.classList.toggle('is-open', selected)
    control.setAttribute('aria-pressed', String(selected))
  })

  const original = detailContent.querySelector('.inspect-original')
  original?.classList.add('has-attached-paper')

  animatePulledPaperIn(target, targetPanel)

  target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
}

async function saveMetadata(item, form, clearCollection) {
  const feedback = form.querySelector('.metadata-feedback')
  const save = form.querySelector('button[type="submit"]')

  const collection =
    form.elements.collection.value.trim()

  const nextTags =
    parseTags(form.elements.tags.value)

  const currentTags =
    Array.isArray(item.tags)
      ? item.tags
      : []

  if (save) {
    save.disabled = true
  }

  feedback.textContent = '正在记下……'

  try {
    const response = await apiFetch(
      pocketApi(
        `/items/${encodeURIComponent(item.id)}/metadata`,
      ),
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          ...(clearCollection
            ? { clearCollection: true }
            : { collection }),
          tagsAdd: nextTags.filter(
            (tag) => !currentTags.includes(tag),
          ),
          tagsRemove: currentTags.filter(
            (tag) => !nextTags.includes(tag),
          ),
        }),
      },
    )

    const payload = await response.json()

    if (!response.ok) {
      throw new Error(
        response.status === 403
          ? '当前页面不能提交这次修改。'
          : response.status === 404
            ? '当前网站没有找到保存入口。'
            : payload.error
              || `这次没有记下来（${response.status}）。`,
      )
    }

    const updatedItem = payload.item

    activeDetailItem = updatedItem

    Object.assign(
      item,
      updatedItem,
    )

    const loadedIndex =
      loadedItems.findIndex(
        (entry) => entry.id === updatedItem.id,
      )

    if (loadedIndex !== -1) {
      loadedItems[loadedIndex] =
        updatedItem
    }

    if (form.elements.collection) {
      form.elements.collection.value =
        updatedItem.collection || ''
    }

    if (form.elements.tags) {
      form.elements.tags.value =
        (updatedItem.tags || []).join(' · ')
    }

    const removeCollection =
      form.querySelector('.collection-remove')

    if (removeCollection) {
      removeCollection.hidden =
        !updatedItem.collection
    }

    const record =
      form.closest('.item-record')

    const count =
      record?.querySelector('.record-count')

    if (count) {
      const activityCount =
        Array.isArray(updatedItem.activity)
          ? updatedItem.activity.length
          : 0

      count.textContent =
        activityCount
          ? archiveNumber(activityCount)
          : ''
    }

    feedback.textContent =
      payload.changed
        ? '已经记进这张 Record。'
        : '这里已经是这样。'

    if (save) {
      save.disabled = false
    }

    window.setTimeout(() => {
      if (
        feedback.isConnected
        && (
          feedback.textContent === '已经记进这张 Record。'
          || feedback.textContent === '这里已经是这样。'
        )
      ) {
        feedback.textContent = ''
      }
    }, 1100)
  } catch (error) {
    if (save) {
      save.disabled = false
    }

    feedback.textContent =
      error.message || '这次没有记下来。'
  }
}

function createEeNoteEditor(item) {
  const note = element('aside', 'secondary-slip ee-note-slip detail-aux-panel')
  note.dataset.panel = 'ee-note'
  note.append(element('p', 'slip-kicker', item.note ? '伊伊留的一句' : '留一句给阿栖'))
  const form = element('form', 'ee-note-form')
  const input = document.createElement('textarea')
  input.name = 'note'
  input.maxLength = 2000
  input.rows = 5
  input.value = item.note || ''
  input.placeholder = '写在这张小纸上……'
  const actions = element('div', 'note-actions')
  const save = element('button', 'note-action', item.note ? '改好这句' : '夹进抽屉')
  save.type = 'submit'
  actions.append(save)
  if (item.note) {
    const clear = element('button', 'note-action note-remove', '移除这句')
    clear.type = 'button'
    clear.addEventListener('click', () => {
      if (window.confirm('把这句 EE Note 从当前物件移除？')) saveEeNote(item, '', note)
    })
    actions.append(clear)
  }
  form.append(input, actions, element('p', 'note-feedback'))
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    saveEeNote(item, input.value, note)
  })
  note.append(form)
  return note
}

async function saveEeNote(item, value, panel) {
  const feedback = panel.querySelector('.note-feedback')
  const input = panel.querySelector('textarea[name="note"]')
  const save = panel.querySelector('button[type="submit"]')
  const kicker = panel.querySelector('.slip-kicker')
  const clear = panel.querySelector('.note-remove')

  if (save) save.disabled = true
  feedback.textContent = '正在夹好……'

  try {
    const response = await apiFetch(
      pocketApi(`/items/${encodeURIComponent(item.id)}/note`),
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ note: value }),
      },
    )

    const payload = await response.json()

    if (!response.ok) {
      throw new Error(
        payload.error || `附言保存失败（${response.status}）`,
      )
    }

    const updatedItem = payload.item

    activeDetailItem = updatedItem
    Object.assign(item, updatedItem)

    const loadedIndex = loadedItems.findIndex(
      (entry) => entry.id === updatedItem.id,
    )

    if (loadedIndex !== -1) {
      loadedItems[loadedIndex] = updatedItem
    }

    if (input) {
      input.value = updatedItem.note || ''
    }

    if (kicker) {
      kicker.textContent = updatedItem.note
        ? '伊伊留的一句'
        : '留一句给阿栖'
    }

    if (save) {
      save.textContent = updatedItem.note
        ? '改好这句'
        : '夹进抽屉'
      save.disabled = false
    }

    if (clear) {
      clear.hidden = !updatedItem.note
    }

    feedback.textContent = updatedItem.note
      ? '夹好了。'
      : '已经移除。'

    window.setTimeout(() => {
      if (
        panel.isConnected
        && feedback.textContent === '夹好了。'
      ) {
        feedback.textContent = ''
      }
    }, 900)
  } catch (error) {
    if (save) save.disabled = false

    feedback.textContent =
      error.message || '这句暂时没有夹好。'
  }
}

function createReplySlip(item, reply) {
  const slip = element('article', `secondary-slip reply-slip reply-${reply.author === 'EE' ? 'ee' : 'aqi'}`)
  const author = reply.author === 'EE' ? 'EE 留了一张回条' : 'AQI LEFT A NOTE'
  slip.append(
    element('p', 'slip-kicker', author),
    element('p', 'slip-text', reply.text),
  )
  const annotations = []
  if (reply.createdAt) annotations.push(formatLongDate(reply.createdAt))
  if (reply.source) annotations.push(reply.source)
  if (annotations.length) slip.append(element('p', 'slip-annotation', annotations.join(' · ')))
  if (reply.author === 'Aqi') {
    const remove = element('button', 'note-action note-remove reply-remove', '收起这张')
    remove.type = 'button'
    remove.addEventListener('click', () => {
      if (window.confirm('把这张 Aqi 回条从当前物件收起？记录仍会保留。')) hideReply(item, reply, slip)
    })
    slip.append(remove)
  }
  return slip
}

async function hideReply(item, reply, slip) {
  const control = slip.querySelector('.reply-remove')
  control.disabled = true
  try {
    const response = await apiFetch(pocketApi(`/items/${encodeURIComponent(item.id)}/replies/${encodeURIComponent(reply.id)}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ hidden: true }),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.error || `回条收起失败（${response.status}）`)
    rerenderDetailQuietly(payload.item, payload.item.replies.length ? 'aqi-note' : 'original')
    await loadItems()
  } catch (error) {
    control.disabled = false
    control.textContent = error.message || '暂时收不起来'
  }
}

function createFilingSlip(item) {
  const slip = element('section', 'filing-slip detail-aux-panel')
  slip.dataset.panel = 'filing'
  slip.setAttribute('aria-label', '移动到另一格抽屉')

  slip.append(element('p', 'filing-title', '看完放哪儿？'))

  const choices = element('div', 'filing-choices')

  Object.entries(statusLabels).forEach(([status, label]) => {
    if (status === item.status) {
      const current = element('span', 'filing-choice is-current')
      current.append(
        element('span', '', label),
        element('small', '', '现在在这里'),
      )
      choices.append(current)
      return
    }

    const button = element('button', 'filing-choice', label)
    button.type = 'button'
    button.dataset.filingStatus = status

    button.addEventListener('click', () => {
      if (status === 'memory_candidate') showMemoryConfirmation(slip, item)
      else fileItem(item, status, slip)
    })

    choices.append(button)
  })

  slip.append(choices, element('p', 'filing-feedback'))
  return slip
}

function showMemoryConfirmation(slip, item) {
  let confirmation = slip.querySelector('.filing-confirmation')
  if (!confirmation) {
    confirmation = element('div', 'filing-confirmation')
    confirmation.append(element('p', '', '放进「想留住」？'))
    const actions = element('div', 'filing-confirm-actions')
    const confirm = element('button', 'filing-confirm', '放进去')
    confirm.type = 'button'
    confirm.addEventListener('click', () => fileItem(item, 'memory_candidate', slip))
    const cancel = element('button', 'filing-cancel', '算了')
    cancel.type = 'button'
    cancel.addEventListener('click', () => confirmation.remove())
    actions.append(confirm, cancel)
    confirmation.append(actions)
    slip.append(confirmation)
  }
  confirmation.querySelector('.filing-confirm').focus()
}

function updateCabinetCountsAfterMove(previousStatus, nextStatus) {
  if (
    !previousStatus
    || !nextStatus
    || previousStatus === nextStatus
  ) {
    return
  }

  if (Object.hasOwn(cabinetCounts, previousStatus)) {
    cabinetCounts[previousStatus] = Math.max(
      0,
      (cabinetCounts[previousStatus] || 0) - 1,
    )
  }

  if (Object.hasOwn(cabinetCounts, nextStatus)) {
    cabinetCounts[nextStatus] =
      (cabinetCounts[nextStatus] || 0) + 1
  }

  document.querySelectorAll('[data-count-status]').forEach((node) => {
    const count =
      cabinetCounts[node.dataset.countStatus] || 0

    node.textContent =
      count ? archiveNumber(count) : ''

    node.setAttribute(
      'aria-label',
      `${count} 件`,
    )
  })

  const all = document.querySelector('#count-all')

  if (all) {
    all.textContent =
      archiveNumber(cabinetCounts.all || 0)
  }
}

async function fileItem(item, status, slip) {
  const feedback = slip.querySelector('.filing-feedback')
  const controls = [...slip.querySelectorAll('button')]
  const targetControl = controls.find(
    (control) => control.dataset.filingStatus === status,
  )

  controls.forEach((control) => {
    control.disabled = true
  })

  targetControl?.classList.add('is-commit-target')
  slip.classList.add('is-committing')

  feedback.textContent = `正在放进「${statusLabels[status]}」……`

  try {
    const response = await apiFetch(
      pocketApi(`/items/${encodeURIComponent(item.id)}/review`),
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ action: status }),
      },
    )

    if (!response.ok) {
      throw new Error(`归档失败（${response.status}）`)
    }

    const payload = await response.json()
    const previousStatus = item.status
    const updatedItem = payload.item

    activeDetailItem = updatedItem
    updateCabinetCountsAfterMove(
      previousStatus,
      updatedItem.status,
    )

    /*
      The paper can return as soon as the server confirms the move.
      Cabinet bookkeeping must not make the physical interaction wait.
    */
    if (activeStatus && activeStatus !== updatedItem.status) {
      await putBackDetail()

      window.setTimeout(() => {
        void loadItems().catch((error) => {
          console.warn(
            'Current drawer refresh failed.',
            error,
          )
        })
      }, 0)

      return
    }

    /*
      In "all items" / same-drawer views the item remains visible.
      Refresh the current paper immediately, then update the cabinet
      quietly in the background.
    */
    if (typeof rerenderDetailQuietly === 'function') {
      rerenderDetailQuietly(updatedItem)
    } else {
      renderDetail(updatedItem)
    }

    const nextFeedback = detailContent.querySelector('.filing-feedback')
    if (nextFeedback) {
      nextFeedback.textContent =
        `已经放进「${statusLabels[updatedItem.status]}」。`
    }


  } catch (error) {
    slip.classList.remove('is-committing')
    targetControl?.classList.remove('is-commit-target')

    feedback.textContent =
      error.message || '暂时没能移动这张纸。'

    controls.forEach((control) => {
      control.disabled = false
    })
  }
}

async function readLinkContent(item, area, detail, videoFrames) {
  const previousNodes = [...area.childNodes]
  area.replaceChildren(element('p', 'read-progress', '正在展开这张剪报……'))
  try {
    const response = await apiFetch(pocketApi(`/items/${encodeURIComponent(item.id)}/read-content`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ detail, maxImages: 2, videoFrames, refresh: false }),
    })
    if (!response.ok) throw new Error(`来源读取失败（${response.status}）`)
    const { snapshot } = await response.json()
    renderReadSnapshot(area, item, snapshot)
  } catch (error) {
    area.replaceChildren(...previousNodes)
    area.append(element('p', 'read-error', error.message || '这张剪报暂时没能展开。'))
  }
}

function renderReadSnapshot(area, item, snapshot) {
  const content = element('div', 'read-snapshot')
  const header = element('header', 'read-snapshot-header')
  if (snapshot.siteName) header.append(element('p', 'read-site', snapshot.siteName))
  header.append(element('h3', 'read-title', snapshot.title || item.title || '来源内容'))
  const byline = [snapshot.author, formatOptionalDate(snapshot.publishedAt)].filter(Boolean).join(' · ')
  if (byline) header.append(element('p', 'read-byline', byline))
  content.append(header)
  if (snapshot.description) content.append(element('p', 'read-description', snapshot.description))
  if (snapshot.text) content.append(element('p', 'read-text', snapshot.text))

  const images = Array.isArray(snapshot.images) ? snapshot.images.filter((image) => safeHttpUrl(image?.url)).slice(0, 2) : []
  if (images.length) {
    const imageGroup = element('div', 'read-images')
    images.forEach((entry, index) => {
      const image = document.createElement('img')
      image.src = entry.url
      image.alt = entry.alt || `${snapshot.title || item.title || '网页'} 图片 ${index + 1}`
      image.loading = 'lazy'
      image.referrerPolicy = 'no-referrer'
      imageGroup.append(image)
    })
    content.append(imageGroup)
  }

  if (snapshot.browserCapturePlan?.needed) {
    content.append(element('p', 'read-capture-note', '这个页面需要另外打开才能完整看。'))
  }
  const actions = element('div', 'read-actions')
  if (snapshot.detail !== 'full' && (snapshot.textTruncated || snapshot.text)) {
    const full = element('button', 'read-more-button', '再读完整一点')
    full.type = 'button'
    full.addEventListener('click', () => readLinkContent(item, area, 'full', 0))
    actions.append(full)
  }
  if (snapshot.video?.detected && snapshot.frameExtraction?.requested === 0) {
    const frames = element('button', 'read-frames-button', '看看画面')
    frames.type = 'button'
    frames.addEventListener('click', () => readLinkContent(item, area, snapshot.detail || 'compact', 2))
    actions.append(frames)
  }
  if (snapshot.frameExtraction?.requested > 0) {
    const count = Number(snapshot.frameExtraction.extracted) || 0
    content.append(element('p', 'read-frame-note', count ? `已经取到 ${count} 帧画面。` : '暂时没有取到可看的画面。'))
  }
  if (actions.childNodes.length) content.append(actions)
  const finalUrl = safeHttpUrl(snapshot.canonicalUrl) || safeHttpUrl(snapshot.finalUrl)
  const sourceLink = area.closest('.link-detail-clipping')?.querySelector(':scope > .source-link')
  if (finalUrl && sourceLink) sourceLink.href = finalUrl
  area.replaceChildren(content)
}

function createSourceLink(url, label) {
  const source = document.createElement('a')
  source.className = 'source-link'
  source.href = url
  source.target = '_blank'
  source.rel = 'noreferrer noopener'
  source.textContent = label
  return source
}

function imageAttachments(item) {
  return (item.attachments || []).filter((attachment) => attachment.mimeType?.startsWith('image/') && attachment.url)
}

function applyCabinetContents(items) {
  document.querySelectorAll('.cabinet-drawer').forEach((drawer) => {
    const item = items.find((candidate) => candidate.status === drawer.dataset.openStatus)
    const peek = drawer.querySelector('.drawer-peek')
    drawer.classList.toggle('is-occupied', Boolean(item))
    peek.className = 'drawer-peek'
    peek.style.backgroundImage = ''
    if (!item) return
    const kind = itemVisualKind(item)
    peek.classList.add(`peek-${kind}`)
    const firstImage = imageAttachments(item)[0]
    if ((kind === 'xiaohongshu' || kind === 'image') && firstImage) {
      peek.style.backgroundImage = `url(${JSON.stringify(firstImage.url)})`
    }
  })
}

function createItemMeta(item, extraClass = '') {
  const meta = element('div', `item-meta${extraClass ? ` ${extraClass}` : ''}`)
  const archiveLine = element('span', 'item-archive-line')
  const date = element('time', 'item-date', formatDate(item.lastReceivedAt || item.createdAt))
  date.dateTime = item.lastReceivedAt || item.createdAt || ''
  archiveLine.append(
    element('span', 'item-source', item.sourceApp || 'Aqi Drawer'),
    element('span', 'archive-separator', '·'),
    date,
  )
  meta.append(
    element('span', 'status-tag', statusLabels[item.status] || item.status || '新放入'),
    archiveLine,
  )
  return meta
}

function sourceName(item) {
  if (item.sourceApp && item.sourceApp !== 'Aqi Drawer') return item.sourceApp
  try { return new URL(item.sourceUrl).hostname.replace(/^www\./, '') } catch { return 'WEB CLIPPING' }
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

function textPreview(value, length) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  return normalized.length > length ? `${normalized.slice(0, length)}…` : normalized
}

function parseTags(value) {
  return [...new Set(String(value || '').split(/[,，·\n]/u).map((tag) => tag.trim().replace(/^#+/u, '')).filter(Boolean))].slice(0, 40)
}

function getSourceTags(item) {
  const values = item.sourceData?.sourceTags || item.sourceData?.hashtags || item.sourceData?.tags || []
  if (!Array.isArray(values)) return []
  return [...new Set(values.map((value) => typeof value === 'string' ? value : value?.name || value?.text || '').map((value) => value.trim().replace(/^#+/u, '')).filter(Boolean))]
}

function formatActivityTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未记下'
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(date).toUpperCase()
}

function activityLabel(entry) {
  const actor = entry.actor === 'EE' ? 'EE' : entry.actor === 'Aqi' ? 'AQI' : 'SYSTEM'
  if (entry.type === 'received') return `${actor} LEFT THIS HERE${entry.detail?.count > 1 ? ` · ${entry.detail.count}` : ''}`
  if (entry.type === 'seen_by_aqi') return 'AQI SAW THIS'
  if (entry.type === 'content_read') return `${actor} READ SOURCE · ${(entry.detail?.mode || 'compact').toUpperCase()}`
  if (entry.type === 'reply_added') return `${actor} LEFT A NOTE`
  if (entry.type === 'status_changed') return `${actor} MOVED IT · ${statusLabels[entry.detail?.to] || entry.detail?.to || ''}`
  if (entry.type === 'metadata_changed') return `${actor} UPDATED THE INDEX`
  if (entry.type === 'source_refreshed') return 'SOURCE REFRESHED'
  return entry.type
}

function formatOptionalDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return ''
  return formatDate(value)
}

function formatLongDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date).toUpperCase()
}

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '日期未记下'
  const parts = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}.${parts.month}.${parts.day}`
}

function archiveNumber(value) {
  return String(Math.max(0, Number(value) || 0)).padStart(2, '0')
}

function readTypePreset() {
  try {
    const value = window.localStorage.getItem(typeStorageKey)
    return typePresetNames.has(value) ? value : 'archive'
  } catch {
    return 'archive'
  }
}

function applyTypePreset(preset) {
  const selectedPreset = typePresetNames.has(preset) ? preset : 'archive'
  document.body.dataset.typePreset = selectedPreset
  loadTypePreset(selectedPreset)
  typePresets.forEach((button) => {
    const selected = button.dataset.typePreset === selectedPreset
    button.classList.toggle('is-selected', selected)
    button.setAttribute('aria-pressed', String(selected))
  })
  updateTypeManifest(selectedPreset)
}

function loadTypePreset(preset) {
  if (document.querySelector(`link[data-type-fonts="${preset}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = typePresetManifest[preset].href
  link.dataset.typeFonts = preset
  document.head.append(link)
}

function preloadTypeCabinet() {
  Object.keys(typePresetManifest).forEach(loadTypePreset)
}

function updateTypeManifest(preset) {
  const manifest = typePresetManifest[preset]
  const values = [manifest.display, manifest.cjk, manifest.body, manifest.meta]
  typeFontManifest.querySelectorAll('dd').forEach((node, index) => { node.textContent = values[index] })
}

function openTypeCabinet() {
  preloadTypeCabinet()
  draftTypePreset = committedTypePreset
  applyTypePreset(draftTypePreset)
  typeStatus.textContent = ''
  typeDialog.showModal()
  typePresets.find((button) => button.dataset.typePreset === draftTypePreset)?.focus()
}

function dismissTypeCabinet() {
  applyTypePreset(committedTypePreset)
  typeDialog.close()
  typeToggle.focus({ preventScroll: true })
}

function storeTypePreset() {
  committedTypePreset = draftTypePreset
  try { window.localStorage.setItem(typeStorageKey, committedTypePreset) } catch {}
  applyTypePreset(committedTypePreset)
  typeStatus.textContent = '这套字已经穿好了。'
  window.setTimeout(() => {
    if (typeDialog.open) typeDialog.close()
    typeToggle.focus({ preventScroll: true })
  }, 160)
}

function restoreTypePreset() {
  committedTypePreset = 'archive'
  draftTypePreset = 'archive'
  try { window.localStorage.removeItem(typeStorageKey) } catch {}
  applyTypePreset('archive')
  typeStatus.textContent = '已经恢复原样。'
}
async function animateDrawerPull(trigger, hasItems = true) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (reducedMotion) return

  if (!window.gsap || !trigger.classList.contains('cabinet-drawer')) {
    trigger.classList.add('is-opening')
    await transitionPause()
    trigger.classList.remove('is-opening')
    return
  }

  document
    .querySelectorAll('.drawer-paper-motion-ghost, .drawer-cavity-motion')
    .forEach((node) => node.remove())

  const paper = trigger.querySelector('.drawer-peek')
  const pull = trigger.querySelector('.cabinet-pull')

  gsap.killTweensOf(trigger)
  if (paper) gsap.killTweensOf(paper)
  if (pull) gsap.killTweensOf(pull)

  gsap.set(trigger, {
    zIndex: 5,
    transformOrigin: '50% 40%',
  })

  // Empty drawers have less visual information,
  // so they should finish a little faster.
  const pressDuration = hasItems ? 0.055 : 0.045
  const pullDuration = hasItems ? 0.23 : 0.19
  const settleDuration = hasItems ? 0.055 : 0.025

  await new Promise((resolve) => {
    const tl = gsap.timeline({ onComplete: resolve })

    tl.to(trigger, {
      y: 1,
      scale: 0.995,
      duration: pressDuration,
      ease: 'power1.in',
      overwrite: true,
    })

    tl.to(trigger, {
      y: 2,
      scale: 1.03,
      duration: pullDuration,
      ease: 'power3.out',
      boxShadow:
        'inset 0 -4px 7px rgba(76, 50, 37, 0.025), 0 16px 23px rgba(47, 33, 26, 0.25)',
    })

    if (paper && hasItems) {
      tl.to(
        paper,
        {
          y: -7,
          rotation: -0.25,
          scale: 1.01,
          boxShadow:
            '0 3px 0 rgba(232, 222, 204, 0.96), 0 6px 0 rgba(218, 205, 183, 0.82)',
          duration: 0.17,
          ease: 'power2.out',
        },
        0.075,
      )
    }

    if (pull) {
      tl.to(
        pull,
        {
          scale: 1.045,
          duration: hasItems ? 0.17 : 0.15,
          ease: 'power2.out',
        },
        0.075,
      )
    }

    tl.to({}, { duration: settleDuration })
  })
}

async function openCollection(trigger) {
  lastCabinetTrigger = trigger
  activeStatus = trigger.dataset.openStatus || ''
  activeCollection = ''
  activeSource = ''

  const count = activeStatus
    ? cabinetCounts[activeStatus] || 0
    : cabinetCounts.all || 0

  const label = activeStatus
    ? statusLabels[activeStatus]
    : '全部收藏'

  collectionTitle.textContent = count
    ? `${label} · ${archiveNumber(count)}`
    : label

  // Important:
  // Load the real contents while the cabinet is still in front of us.
  // The transition should never reveal a half-loaded drawer.
  const contentReady = loadItems()

  await animateDrawerPull(trigger, count > 0)
  await contentReady

  cabinetHome.hidden = true
  document.body.classList.remove('is-cabinet-home')

  collectionView.hidden = false
  collectionView.classList.remove('is-entering')

  if (window.gsap) {
    gsap.set(trigger, { clearProps: 'transform,boxShadow,zIndex' })

    const paper = trigger.querySelector('.drawer-peek')
    const pull = trigger.querySelector('.cabinet-pull')
    const drawerLabel = trigger.querySelector('.cabinet-label')

    if (paper) gsap.set(paper, { clearProps: 'transform,boxShadow' })
    if (pull) gsap.set(pull, { clearProps: 'transform' })
    if (drawerLabel) gsap.set(drawerLabel, { clearProps: 'transform' })

    // The already-filled drawer settles into view.
    await new Promise((resolve) => {
      gsap.fromTo(
        collectionView,
        {
          y: 7,
          scale: 0.992,
          opacity: 0.88,
        },
        {
          y: 0,
          scale: 1,
          opacity: 1,
          duration: 0.19,
          ease: 'power2.out',
          clearProps: 'transform,opacity',
          onComplete: resolve,
        },
      )
    })
  }

  trigger.classList.remove('is-opening')
  closeDrawer.focus({ preventScroll: true })
}

async function closeCollection() {
  collectionView.classList.add('is-closing')
  await transitionPause()
  collectionView.hidden = true
  collectionView.classList.remove('is-closing')
  cabinetHome.hidden = false
  document.body.classList.add('is-cabinet-home')
  lastCabinetTrigger?.focus({ preventScroll: true })
}

function transitionPause() {
  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180
  return new Promise((resolve) => window.setTimeout(resolve, duration))
}

async function putBackDetail() {
  const row = inspectedItemRow

  dialog.classList.add('is-returning')

  await transitionPause()

  dialog.close()
  unlockPageScroll()

  dialog.classList.remove('is-returning')

  inspectedItemRow = null
  activeDetailItem = null

  await restoreSourceRow(row)
}

function lockPageScroll() {
  if (document.body.classList.contains('has-paper-open')) return
  lockedScrollY = window.scrollY
  document.body.style.top = `-${lockedScrollY}px`
  document.body.classList.add('has-paper-open')
}

function updateVisibleViewport() {

  if (detailKeyboardViewportFrozen) return
  const viewport = window.visualViewport

  const height = Math.round(
    viewport?.height || window.innerHeight,
  )

  const top = Math.round(
    viewport?.offsetTop || 0,
  )

  document.documentElement.style.setProperty(
    '--drawer-visible-height',
    `${height}px`,
  )

  document.documentElement.style.setProperty(
    '--drawer-visible-top',
    `${top}px`,
  )
}

function unlockPageScroll() {
  if (!document.body.classList.contains('has-paper-open')) return
  document.body.classList.remove('has-paper-open')
  document.body.style.top = ''
  window.scrollTo(0, lockedScrollY)
}

openTriggers.forEach((trigger) => trigger.addEventListener('click', () => openCollection(trigger)))

retry.addEventListener('click', loadItems)
closeDrawer.addEventListener('click', closeCollection)
closeDetail.addEventListener('click', putBackDetail)
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) putBackDetail()
})
dialog.addEventListener('cancel', (event) => {
  event.preventDefault()
  putBackDetail()
})

typeToggle.addEventListener('click', openTypeCabinet)
closeTypeCabinet.addEventListener('click', dismissTypeCabinet)
typePresets.forEach((button) => button.addEventListener('click', () => {
  draftTypePreset = button.dataset.typePreset
  applyTypePreset(draftTypePreset)
  typeStatus.textContent = `${button.querySelector('strong').textContent} 正在试穿。`
}))
wearType.addEventListener('click', storeTypePreset)
resetType.addEventListener('click', restoreTypePreset)
typeDialog.addEventListener('click', (event) => {
  if (event.target === typeDialog) dismissTypeCabinet()
})
typeDialog.addEventListener('cancel', (event) => {
  event.preventDefault()
  dismissTypeCabinet()
})

authForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  authStatus.textContent = '正在打开……'
  try {
    const response = await fetch('/drawer/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ secret: authSecret.value }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      authStatus.textContent = response.status === 401 ? '这把钥匙没有打开抽屉。' : payload.error || `暂时打不开（${response.status}）。`
      return
    }
    authSecret.value = ''
    authDialog.close()
    await loadCabinetCounts()
    if (!collectionView.hidden) await loadItems()
  } catch (error) {
    console.error('Drawer sign-in failed.', error)
    authStatus.textContent = '暂时无法连接当前网站。'
  }
})
authCancel.addEventListener('click', () => authDialog.close())

loadCabinetCounts()


/* INSPECT BACKGROUND RETURN V1 */
dialog.addEventListener('click', (event) => {
  if (!dialog.open) return

  const protectedTarget = event.target.closest?.(
    [
      '#close-detail',
      '.inspect-original',
      '.detail-aux-panel',
      '.inspect-record-peek',
      '.inspect-side-tab',
      '.inspect-filing-peek',
      'a',
      'button',
      'input',
      'textarea',
      'select',
      'label',
    ].join(','),
  )

  if (protectedTarget) return

  const openPanel = detailContent.dataset.openPanel || 'original'

  if (openPanel !== 'original') {
    setDetailPanel('original')
    return
  }

  putBackDetail()
})

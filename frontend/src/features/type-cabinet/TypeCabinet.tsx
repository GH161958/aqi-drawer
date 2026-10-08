import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import {
  deleteStoredFont,
  getStoredFont,
  getWardrobeSettings,
  listStoredFonts,
  openFontWardrobe,
  renameStoredFont,
  saveStoredFont,
  setActiveFontId,
  type StoredFont,
} from './fontWardrobeStorage'
import {
  applyFontChoice,
  assertNoWardrobeConflict,
  commitFontChoice,
  createStoredFontFromFile,
  createStoredFontFromUrl,
  defaultDisplayName,
  getCommittedFontChoice,
  initializeFontDressingRoom,
  loadStoredFontChoice,
  normalizeDisplayName,
  releaseFontChoice,
  sameFontChoice,
  SYSTEM_FONT_CHOICE,
  type FontChoice,
  wardrobeLimitsLabel,
} from './typeCabinetLogic'

import styles from './TypeCabinet.module.css'

function formatBytes(byteLength: number) {
  if (byteLength < 1024 * 1024) {
    return `${Math.ceil(byteLength / 1024)} KiB`
  }
  return `${(byteLength / 1024 / 1024).toFixed(1)} MiB`
}

function sourceSummary(font: StoredFont) {
  return font.sourceType === 'url'
    ? font.sourceUrl
    : font.originalFilename
}

function errorMessage(error: unknown, fallback: string) {
  if (
    error instanceof DOMException
    && error.name === 'QuotaExceededError'
  ) {
    return '这台设备留给字体衣柜的本地空间不足。现有字体没有被改动。'
  }

  return error instanceof Error
    ? error.message
    : fallback
}

export function TypeCabinet() {
  const overlayRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const databaseRef = useRef<IDBDatabase | null>(null)
  const operationRef = useRef(0)
  const mountedRef = useRef(true)

  const [fonts, setFonts] = useState<StoredFont[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [committedChoice, setCommittedChoice] = useState<FontChoice>(
    getCommittedFontChoice,
  )
  const [draftChoice, setDraftChoice] = useState<FontChoice>(
    getCommittedFontChoice,
  )
  const committedChoiceRef = useRef(committedChoice)
  const draftChoiceRef = useRef(draftChoice)
  const [status, setStatus] = useState('正在打开本地字体衣柜……')
  const [startupLoading, setStartupLoading] = useState(true)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [importMethod, setImportMethod] = useState<'file' | 'url'>('file')
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [fileError, setFileError] = useState('')
  const [urlError, setUrlError] = useState('')
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({})
  const [renamingFontId, setRenamingFontId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileDisplayName, setFileDisplayName] = useState('')
  const [urlDisplayName, setUrlDisplayName] = useState('')
  const [fontUrl, setFontUrl] = useState('')

  committedChoiceRef.current = committedChoice
  draftChoiceRef.current = draftChoice

  useEffect(() => {
    mountedRef.current = true
    initializeFontDressingRoom()
    const operation = ++operationRef.current

    async function restoreWardrobe() {
      try {
        const database = await openFontWardrobe()
        const [storedFonts, settings] = await Promise.all([
          listStoredFonts(database),
          getWardrobeSettings(database),
        ])

        if (!mountedRef.current || operation !== operationRef.current) {
          database.close()
          return
        }

        databaseRef.current = database
        setFonts(storedFonts)

        if (!settings.activeFontId) {
          setStatus('System 原样。')
          setStartupLoading(false)
          return
        }

        const active = storedFonts.find(
          (font) => font.id === settings.activeFontId,
        )

        if (!active) {
          await setActiveFontId(database, null)
          setStatus('原先穿着的字体记录已缺失，已安全回到 System。')
          setStartupLoading(false)
          return
        }

        const choice = await loadStoredFontChoice(active)

        if (!mountedRef.current || operation !== operationRef.current) {
          releaseFontChoice(choice)
          return
        }

        commitFontChoice(choice)
        setCommittedChoice(choice)
        setDraftChoice(choice)
        setStatus(`${active.displayName} · 已从本机衣柜恢复`)
      } catch (error) {
        commitFontChoice(SYSTEM_FONT_CHOICE)
        setStatus(
          errorMessage(
            error,
            '本地字体衣柜暂时不可用，已安全回到 System。',
          ),
        )
      } finally {
        if (mountedRef.current && operation === operationRef.current) {
          setStartupLoading(false)
        }
      }
    }

    void restoreWardrobe()

    return () => {
      mountedRef.current = false
      operationRef.current += 1
      const draft = draftChoiceRef.current
      const committed = committedChoiceRef.current
      if (!sameFontChoice(draft, committed)) releaseFontChoice(draft)
      applyFontChoice(committed)
      databaseRef.current?.close()
      databaseRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return

    const appRoot = document.getElementById('root')
    const previousInert = appRoot?.inert ?? false
    const previousAriaHidden = appRoot
      ? appRoot.getAttribute('aria-hidden')
      : null

    if (appRoot) {
      appRoot.inert = true
      appRoot.setAttribute('aria-hidden', 'true')
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismissCabinet()
        return
      }

      if (event.key !== 'Tab') return

      const overlay = overlayRef.current
      if (!overlay) return

      const focusable = Array.from(
        overlay.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hidden)

      if (focusable.length === 0) {
        event.preventDefault()
        overlay.focus({ preventScroll: true })
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus({ preventScroll: true })
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    window.requestAnimationFrame(() => {
      overlayRef.current?.focus({ preventScroll: true })
    })

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (appRoot) {
        appRoot.inert = previousInert
        if (previousAriaHidden === null) appRoot.removeAttribute('aria-hidden')
        else appRoot.setAttribute('aria-hidden', previousAriaHidden)
      }
    }
  }, [isOpen])

  function discardDraft() {
    const draft = draftChoiceRef.current
    const committed = committedChoiceRef.current
    if (!sameFontChoice(draft, committed)) releaseFontChoice(draft)
  }

  function chooseDraft(choice: FontChoice, message: string) {
    discardDraft()
    applyFontChoice(choice)
    draftChoiceRef.current = choice
    setDraftChoice(choice)
    setStatus(message)
  }

  function openCabinet() {
    operationRef.current += 1
    const committed = committedChoiceRef.current
    chooseDraft(committed, '')
    setIsOpen(true)
  }

  function dismissCabinet() {
    operationRef.current += 1
    discardDraft()
    const committed = committedChoiceRef.current
    applyFontChoice(committed)
    draftChoiceRef.current = committed
    setDraftChoice(committed)
    setIsOpen(false)
    window.requestAnimationFrame(() => {
      triggerRef.current?.focus({ preventScroll: true })
    })
  }

  async function previewFont(font: StoredFont) {
    const operation = ++operationRef.current
    setPendingKey(`preview:${font.id}`)
    setCardErrors((current) => ({ ...current, [font.id]: '' }))
    try {
      const record = await getStoredFont(databaseRef.current!, font.id)
      if (!record) throw new Error('找不到这套字体。')
      const choice = draftChoiceRef.current.kind === 'custom'
        && draftChoiceRef.current.fontId === font.id
        ? draftChoiceRef.current
        : committedChoiceRef.current.kind === 'custom'
          && committedChoiceRef.current.fontId === font.id
          ? committedChoiceRef.current
          : await loadStoredFontChoice(record)
      if (operation !== operationRef.current) {
        releaseFontChoice(choice)
        return
      }
      chooseDraft(choice, '')
    } catch (error) {
      if (operation === operationRef.current) {
        setCardErrors((current) => ({
          ...current,
          [font.id]: errorMessage(error, '这套字体暂时无法使用。'),
        }))
      }
    } finally {
      if (operation === operationRef.current) setPendingKey(null)
    }
  }

  async function wearFont(font: StoredFont | null) {
    const database = databaseRef.current
    if (!database) {
      setStatus('本地字体衣柜暂时不可用。')
      return
    }

    const operation = ++operationRef.current
    setPendingKey(`wear:${font?.id ?? 'system'}`)
    if (font) setCardErrors((current) => ({ ...current, [font.id]: '' }))
    try {
      const record = font ? await getStoredFont(database, font.id) : null
      if (font && !record) throw new Error('找不到这套字体。')
      const choice = record
        ? draftChoiceRef.current.kind === 'custom'
          && draftChoiceRef.current.fontId === record.id
          ? draftChoiceRef.current
          : committedChoiceRef.current.kind === 'custom'
            && committedChoiceRef.current.fontId === record.id
            ? committedChoiceRef.current
            : await loadStoredFontChoice(record)
        : SYSTEM_FONT_CHOICE

      if (operation !== operationRef.current) {
        releaseFontChoice(choice)
        return
      }

      await setActiveFontId(database, font?.id ?? null)
      if (operation !== operationRef.current) {
        releaseFontChoice(choice)
        return
      }

      commitFontChoice(choice)
      committedChoiceRef.current = choice
      draftChoiceRef.current = choice
      setCommittedChoice(choice)
      setDraftChoice(choice)
      setStatus('')
    } catch (error) {
      if (font) {
        setCardErrors((current) => ({
          ...current,
          [font.id]: errorMessage(error, '无法保存这次选择。'),
        }))
      } else {
        setStatus(errorMessage(error, '无法恢复 System。'))
      }
    } finally {
      if (operation === operationRef.current) setPendingKey(null)
    }
  }

  async function saveImported(
    build: () => Promise<{ record: StoredFont; choice: FontChoice }>,
    method: 'file' | 'url',
  ) {
    const database = databaseRef.current
    if (!database) {
      setStatus('本地字体衣柜暂时不可用。')
      return
    }
    const operation = ++operationRef.current
    setPendingKey('import')
    if (method === 'file') setFileError('')
    else setUrlError('')
    try {
      const { record, choice } = await build()
      if (operation !== operationRef.current) {
        releaseFontChoice(choice)
        return
      }
      assertNoWardrobeConflict(fonts, record)
      await saveStoredFont(database, record)
      if (operation !== operationRef.current) {
        releaseFontChoice(choice)
        return
      }
      releaseFontChoice(choice)
      const canonicalRecord = await getStoredFont(database, record.id)
      if (!canonicalRecord) {
        throw new Error('字体已保存，但无法从本机衣柜重新读取。')
      }
      setFonts((current) => [...current, canonicalRecord])
      const canonicalChoice = await loadStoredFontChoice(canonicalRecord)
      if (operation !== operationRef.current) {
        releaseFontChoice(canonicalChoice)
        return
      }
      chooseDraft(canonicalChoice, '')
      if (method === 'file') {
        setFileDisplayName('')
        setSelectedFile(null)
        setFileError('')
        if (fileInputRef.current) fileInputRef.current.value = ''
      } else {
        setUrlDisplayName('')
        setFontUrl('')
        setUrlError('')
      }
      setIsAddOpen(false)
    } catch (error) {
      const message = errorMessage(error, '字体导入失败。')
      if (method === 'file') setFileError(message)
      else setUrlError(message)
    } finally {
      if (operation === operationRef.current) setPendingKey(null)
    }
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setSelectedFile(file)
    setFileDisplayName(file ? defaultDisplayName(file.name) : '')
  }

  function importLocal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedFile) {
      setFileError('请先选择一个字体文件。')
      return
    }
    void saveImported(
      () => createStoredFontFromFile(selectedFile, fileDisplayName),
      'file',
    )
  }

  function importUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void saveImported(
      () => createStoredFontFromUrl(fontUrl, urlDisplayName),
      'url',
    )
  }

  function startRename(font: StoredFont) {
    setRenamingFontId(font.id)
    setRenameDraft(font.displayName)
    setCardErrors((current) => ({ ...current, [font.id]: '' }))
  }

  function cancelRename() {
    setRenamingFontId(null)
    setRenameDraft('')
  }

  async function saveRename(font: StoredFont) {
    if (!databaseRef.current) return
    const operation = ++operationRef.current
    setPendingKey(`rename:${font.id}`)
    try {
      const displayName = normalizeDisplayName(renameDraft)
      assertNoWardrobeConflict(fonts, { displayName }, font.id)
      await renameStoredFont(databaseRef.current, font.id, displayName)
      setFonts((current) => current.map((entry) =>
        entry.id === font.id ? { ...entry, displayName } : entry,
      ))

      if (
        committedChoiceRef.current.kind === 'custom'
        && committedChoiceRef.current.fontId === font.id
      ) {
        const renamedChoice = {
          ...committedChoiceRef.current,
          displayName,
        }
        committedChoiceRef.current = renamedChoice
        setCommittedChoice(renamedChoice)
      }
      setRenamingFontId(null)
      setRenameDraft('')
      setStatus('')
    } catch (error) {
      setCardErrors((current) => ({
        ...current,
        [font.id]: errorMessage(error, '无法重命名。'),
      }))
    } finally {
      if (operation === operationRef.current) setPendingKey(null)
    }
  }

  async function remove(font: StoredFont) {
    const database = databaseRef.current
    if (!database || !window.confirm(`从这台设备删除“${font.displayName}”？`)) return

    const deletingActive = committedChoiceRef.current.kind === 'custom'
      && committedChoiceRef.current.fontId === font.id
    const deletingDraft = draftChoiceRef.current.kind === 'custom'
      && draftChoiceRef.current.fontId === font.id

    const operation = ++operationRef.current
    setPendingKey(`delete:${font.id}`)
    setCardErrors((current) => ({ ...current, [font.id]: '' }))
    try {
      await deleteStoredFont(database, font.id)

      if (deletingActive) {
        commitFontChoice(SYSTEM_FONT_CHOICE)
        committedChoiceRef.current = SYSTEM_FONT_CHOICE
        setCommittedChoice(SYSTEM_FONT_CHOICE)
      }
      if (deletingDraft || deletingActive) {
        chooseDraft(SYSTEM_FONT_CHOICE, 'System 原样。')
      }
      setFonts((current) => current.filter((entry) => entry.id !== font.id))
      setStatus('')
    } catch (error) {
      setCardErrors((current) => ({
        ...current,
        [font.id]: errorMessage(error, '无法删除这套字体。'),
      }))
    } finally {
      if (operation === operationRef.current) setPendingKey(null)
    }
  }

  const draftFontId = draftChoice.kind === 'custom' ? draftChoice.fontId : null
  const activeFontId = committedChoice.kind === 'custom' ? committedChoice.fontId : null
  const previewedFont = draftFontId && draftFontId !== activeFontId
    ? fonts.find((font) => font.id === draftFontId) ?? null
    : null
  const activeFont = activeFontId
    ? fonts.find((font) => font.id === activeFontId) ?? null
    : null

  function cancelPreview() {
    operationRef.current += 1
    discardDraft()
    const committed = committedChoiceRef.current
    applyFontChoice(committed)
    draftChoiceRef.current = committed
    setDraftChoice(committed)
    setStatus('')
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        disabled={startupLoading}
        aria-label="打开字体试衣间"
        title="Type Cabinet"
        onClick={openCabinet}
      >
        <span className={styles.triggerDot} aria-hidden="true" />
      </button>

      {isOpen ? createPortal(<div
        ref={overlayRef}
        tabIndex={-1}
        className={styles.overlay}
        role="dialog"
        aria-modal="true"
        aria-labelledby="type-cabinet-title"
        onClick={(event) => {
          if (event.target === overlayRef.current) dismissCabinet()
        }}
      >
        <section className={styles.sheet}>
          <button type="button" className={styles.close} onClick={dismissCabinet}>
            放回
          </button>

          <p className={styles.kicker}>TYPE CABINET</p>
          <h2 id="type-cabinet-title" className={styles.title}>字体试衣间</h2>

          <section className={styles.mirror} aria-live="polite">
            <p className={styles.specimenDisplay}>Aqi Drawer</p>
            <p className={styles.specimenBody}>
              中文字体预览 Aa · Drawer 里的阅读与标题
            </p>
            <div className={styles.mirrorStatus}>
              <span>
                {previewedFont
                  ? `正在预览：${previewedFont.displayName}`
                  : activeFont
                    ? `正在使用：${activeFont.displayName}`
                    : '系统字体'}
              </span>
              <div className={styles.mirrorActionSlot}>
                {previewedFont ? (
                  <button type="button" onClick={cancelPreview}>结束预览</button>
                ) : null}
              </div>
            </div>
          </section>

          <section className={styles.addSection}>
            <button
              type="button"
              className={styles.addToggle}
              aria-expanded={isAddOpen}
              onClick={() => setIsAddOpen((open) => !open)}
            >
              <span>添加字体</span>
              <span className={styles.addChevron} data-expanded={isAddOpen || undefined} aria-hidden="true" />
            </button>

            {isAddOpen ? <div className={styles.addPanel}>
              <div className={styles.methodSwitch} aria-label="字体导入方式">
                <button type="button" aria-pressed={importMethod === 'file'} onClick={() => setImportMethod('file')}>本地文件</button>
                <button type="button" aria-pressed={importMethod === 'url'} onClick={() => setImportMethod('url')}>HTTPS 网址</button>
              </div>

              {importMethod === 'file' ? <form className={styles.importForm} onSubmit={importLocal}>
                <p className={styles.formHelp}>字体文件只保存在这台设备，不会上传。</p>
                <label>
                  <span>显示名称</span>
                  <input value={fileDisplayName} maxLength={60} onChange={(event) => setFileDisplayName(event.target.value)} />
                </label>
                <label className={styles.choose} htmlFor="type-cabinet-font-file">选择字体文件</label>
                <p className={styles.fileName}>{selectedFile?.name ?? '尚未选择文件'}</p>
                <input ref={fileInputRef} id="type-cabinet-font-file" className={styles.fileInput} type="file" accept=".woff2,.woff,.ttf,.otf" disabled={pendingKey === 'import'} onChange={handleFileSelection} />
                <button type="submit" className={styles.importPrimary} disabled={pendingKey === 'import'}>存入衣柜</button>
                {fileError ? <p className={styles.fieldError} role="alert">{fileError}</p> : null}
              </form> : null}

              {importMethod === 'url' ? <form className={styles.importForm} onSubmit={importUrl}>
                <p className={styles.formHelp}>下载一次并把字体字节保存在本机衣柜。</p>
                <label><span>显示名称</span><input required value={urlDisplayName} maxLength={60} onChange={(event) => setUrlDisplayName(event.target.value)} /></label>
                <label><span>字体网址</span><input required type="url" inputMode="url" maxLength={2048} placeholder="https://…/font.woff2" value={fontUrl} onChange={(event) => setFontUrl(event.target.value)} /></label>
                <button type="submit" className={styles.importPrimary} disabled={pendingKey === 'import'}>下载并存入衣柜</button>
                <p className={styles.privacy}>远程主机会看到下载请求；请只导入你有权使用的字体。导入后副本只保存在这台设备。</p>
                {urlError ? <p className={styles.fieldError} role="alert">{urlError}</p> : null}
              </form> : null}
            </div> : null}
          </section>

          <section className={styles.wardrobe} aria-label="本机字体衣柜">
            <header className={styles.sectionHeader}>
              <h3>已保存字体</h3>
              <p>预览不会改变已穿字体；“穿上”会保存在这台设备。</p>
            </header>
            <article
              className={styles.fontCard}
              data-system="true"
              data-selected={draftFontId === null || undefined}
              data-active={activeFontId === null || undefined}
            >
              <div className={styles.systemDetails}>
                <div>
                  <strong>System</strong>
                  <small>Apple / PingFang system stack</small>
                </div>
              </div>
              <div className={styles.systemAction}>
                {activeFontId === null ? (
                  <span>当前为系统字体</span>
                ) : (
                  <button
                    type="button"
                    disabled={pendingKey === 'wear:system'}
                    aria-busy={pendingKey === 'wear:system' || undefined}
                    onClick={() => void wearFont(null)}
                  >
                    切回系统字体
                  </button>
                )}
              </div>
            </article>

            {fonts.map((font) => (
              <article
                key={font.id}
                className={styles.fontCard}
                data-selected={draftFontId === font.id || undefined}
                data-active={activeFontId === font.id || undefined}
              >
                <div className={styles.fontDetails}>
                  <div className={styles.cardHeading}>
                    <strong>{font.displayName}</strong>
                  </div>
                  <small>
                    <span>{font.sourceType === 'url' ? 'URL' : 'FILE'}</span>
                    {' · '}{font.format.toUpperCase()} · {formatBytes(font.byteLength)}
                  </small>
                  <small title={sourceSummary(font)}>{sourceSummary(font)}</small>
                </div>
                {renamingFontId === font.id ? (
                  <div className={styles.renameEditor}>
                    <label>
                      <span>字体名称</span>
                      <input
                        value={renameDraft}
                        maxLength={60}
                        onChange={(event) => setRenameDraft(event.target.value)}
                      />
                    </label>
                    <div>
                      <button type="button" disabled={pendingKey === `rename:${font.id}`} onClick={() => void saveRename(font)}>保存</button>
                      <button type="button" onClick={cancelRename}>取消</button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.cardActions}>
                    <div className={styles.secondaryActions}>
                      <button
                        type="button"
                        disabled={pendingKey === `preview:${font.id}`}
                        aria-busy={pendingKey === `preview:${font.id}` || undefined}
                        onClick={draftFontId === font.id && activeFontId !== font.id ? cancelPreview : () => void previewFont(font)}
                      >
                        {draftFontId === font.id && activeFontId !== font.id
                          ? '结束预览'
                          : '预览'}
                      </button>
                      {activeFontId === font.id ? (
                        <span className={styles.actionState}>已穿上</span>
                      ) : (
                        <button
                          type="button"
                          disabled={pendingKey === `wear:${font.id}`}
                          aria-busy={pendingKey === `wear:${font.id}` || undefined}
                          onClick={() => void wearFont(font)}
                        >
                          穿上
                        </button>
                      )}
                      <button type="button" onClick={() => startRename(font)}>重命名</button>
                      <button type="button" className={styles.destructive} disabled={pendingKey === `delete:${font.id}`} onClick={() => void remove(font)}>删除</button>
                    </div>
                  </div>
                )}
                {cardErrors[font.id] ? (
                  <p className={styles.fieldError} role="alert">{cardErrors[font.id]}</p>
                ) : null}
              </article>
            ))}
          </section>

          <p className={styles.supported}>
            WOFF2 · WOFF · TTF · OTF · 20 MiB each · {wardrobeLimitsLabel()}
          </p>

          <p className={styles.status} aria-live="polite">{status}</p>
        </section>
      </div>, document.body) : null}
    </>
  )
}

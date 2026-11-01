import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { cancelCanonicalXhs, confirmCanonicalXhs, previewCanonicalXhs } from '../../api/pocket'
import type { XhsCanonicalError, XhsCanonicalPreview } from '../../api/pocket'
import { pocketQueryKeys } from '../../api/queryKeys'
import type { PocketItemSummary } from '../../types/pocket'
import styles from './SourceReadPanel.module.css'

export function XhsCanonicalPanel({ item, disabled }: { item: PocketItemSummary; disabled: boolean }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<XhsCanonicalPreview | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<XhsCanonicalError | null>(null)
  const [message, setMessage] = useState('')
  const waiting = Boolean(busy) || disabled
  const run = async (action: 'preview' | 'confirm' | 'cancel') => {
    setBusy(action); setError(null); setMessage('')
    try {
      if (action === 'preview') {
        setPreview(await previewCanonicalXhs(item.id, url)); setUrl('')
      } else if (action === 'confirm' && preview) {
        const result = await confirmCanonicalXhs(item.id, preview.ticket)
        setPreview(null); setUrl(''); setOpen(false)
        queryClient.setQueryData(pocketQueryKeys.item(item.id), result)
        void queryClient.invalidateQueries({ queryKey: pocketQueryKeys.all })
        setMessage(result.xhsParseStatus === 'partial' ? '正文已补全，部分图片未取得。可重新预览正式链接补齐；已保存的图片会保留。' : '已补全选中的原收藏。')
      } else if (action === 'cancel') {
        if (preview) await cancelCanonicalXhs(item.id, preview.ticket)
        setPreview(null); setUrl(''); setOpen(false)
      }
    } catch (cause) {
      setError(cause as XhsCanonicalError)
      if (action === 'confirm' || action === 'cancel') setPreview(null)
    } finally { setBusy('') }
  }
  return <div className={styles.canonical}>
    {!open && <button className={styles.readButton} type="button" disabled={waiting} onClick={() => { setOpen(true); setError(null) }}>用正式链接补全这张纸</button>}
    {open && <section aria-label="正式链接补全">
      {!preview ? <>
        <label className={styles.canonicalLabel}>正式笔记链接
          <textarea className={styles.canonicalInput} value={url} maxLength={8192} autoComplete="off" spellCheck={false} disabled={waiting}
            placeholder="粘贴 www.xiaohongshu.com 的正式笔记链接" onChange={event => setUrl(event.currentTarget.value)} />
        </label>
        <p className={styles.readMeta}>仅用于本次预览和确认；查询令牌不会保存到收藏。之后若失效，请重新粘贴新链接。</p>
        <div className={styles.actions}>
          <button type="button" disabled={waiting || !url.trim()} onClick={() => void run('preview')}>{busy === 'preview' ? '正在解析预览…' : '解析并预览'}</button>
          <button type="button" disabled={waiting} onClick={() => void run('cancel')}>取消补全</button>
        </div>
      </> : <>
        <p>这会补全选中的原收藏；请确认是同一篇笔记。</p>
        <p className={styles.canonicalIdentity}>选中：{preview.item.title} · {preview.item.id}</p>
        <p>预览：{preview.note.title}</p>
        <p className={styles.readMeta}>笔记 {preview.note.noteIdHint} · 预计 {preview.note.imageCount} 张图片；尚未下载或保存。</p>
        <div className={styles.actions}>
          <button type="button" disabled={waiting} onClick={() => void run('confirm')}>{busy === 'confirm' ? '正在保存真实原件…' : '确认是同一篇，补全原收藏'}</button>
          <button type="button" disabled={waiting} onClick={() => void run('cancel')}>取消补全</button>
        </div>
      </>}
    </section>}
    {error && <div role="alert" className={styles.error}><p>{error.message}</p>{error.code && <p className={styles.readMeta}>{error.code}</p>}{error.candidate && <p className={styles.canonicalIdentity}>另一张纸：{error.candidate.title} · {error.candidate.id}。请返回抽屉人工检查；没有自动合并。</p>}</div>}
    {message && <p role="status">{message}</p>}
  </div>
}

import { XhsCanonicalPanel } from './XhsCanonicalPanel'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { retryPocketXhsSource } from '../../api/pocket'
import { pocketQueryKeys } from '../../api/queryKeys'
import type { PocketItemSummary } from '../../types/pocket'
import styles from './SourceReadPanel.module.css'

export function XhsRetryPanel({ item }: { item: PocketItemSummary }) {
  const queryClient = useQueryClient()
  const retry = useMutation({
    mutationFn: () => retryPocketXhsSource(item.id),
    retry: false,
    onSuccess: result => {
      queryClient.setQueryData(pocketQueryKeys.item(item.id), result)
      void queryClient.invalidateQueries({ queryKey: pocketQueryKeys.all })
    },
  })
  return <section className={styles.shell} aria-label="小红书来源恢复">
    <p>小红书 · 待补全。原链接和已保存的内容仍在；尚未取得的图片不会显示为已收藏。</p>
    {item.xhsImageCounts && <p role="status">图片：已保存 {item.xhsImageCounts.ready} / 失败 {item.xhsImageCounts.failed} / 共 {item.xhsImageCounts.total} 张。可重新读取来源，仅补齐缺失原件。</p>}
    <button type="button" className={styles.readButton} disabled={retry.isPending}
      onClick={() => retry.mutate()}>{retry.isPending ? '正在重新读取来源…' : '重新读取来源'}</button>
    <XhsCanonicalPanel key={item.id} item={item} disabled={retry.isPending} />
    {retry.isError && <p className={styles.error} role="alert">{retry.error.message}</p>}
    {retry.isSuccess && retry.data.xhsParseStatus === 'partial'
      && <p role="status">来源文字已更新，部分图片仍待补全；已保存的原件未移除。</p>}
  </section>
}

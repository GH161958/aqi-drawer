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
    <p className={styles.readMeta}>不同短链接暂不能确认是否同一篇，原收藏不会按标题自动合并。若持续无法读取，可打开原链接，并用现有“补充附件”保存你提供的原图。</p>
    <button type="button" className={styles.readButton} disabled={retry.isPending}
      onClick={() => retry.mutate()}>{retry.isPending ? '正在重新读取来源…' : '重新读取来源'}</button>
    {retry.isError && <p className={styles.error} role="alert">{retry.error.message}</p>}
    {retry.isSuccess && retry.data.xhsParseStatus === 'partial'
      && <p role="status">来源文字已更新，部分图片仍待补全；已保存的原件未移除。</p>}
  </section>
}

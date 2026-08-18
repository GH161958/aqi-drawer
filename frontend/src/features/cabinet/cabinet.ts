import type {
  CabinetSlot,
  PocketStatus,
} from '../../types/pocket'

export interface CabinetDrawerDefinition {
  status: PocketStatus
  label: string
}

export const cabinetDrawers:
  CabinetDrawerDefinition[] = [
    {
      status: 'inbox',
      label: '刚放进来',
    },
    {
      status: 'tonight',
      label: '今晚看看',
    },
    {
      status: 'discussed',
      label: '聊过了',
    },
    {
      status: 'deferred',
      label: '晚点再看',
    },
    {
      status: 'memory_candidate',
      label: '想留住',
    },
    {
      status: 'archived',
      label: '收好了',
    },
  ]

export const cabinetSlotLabels:
  Record<CabinetSlot, string> = {
    all: '全部收藏',
    inbox: '刚放进来',
    tonight: '今晚看看',
    discussed: '聊过了',
    deferred: '晚点再看',
    memory_candidate: '想留住',
    archived: '收好了',
    trash: 'DISCARDED',
  }

export function formatCabinetCount(
  count: number,
): string {
  return String(count).padStart(2, '0')
}

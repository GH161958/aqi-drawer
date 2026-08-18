export const pocketQueryKeys = {
  all: ['pocket'] as const,

  items: () =>
    [...pocketQueryKeys.all, 'items'] as const,

  item: (id: string) =>
    [
      ...pocketQueryKeys.all,
      'item',
      id,
    ] as const,

  trash: () =>
    [...pocketQueryKeys.all, 'trash'] as const,
}

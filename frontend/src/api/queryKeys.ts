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

  collections: () =>
    [
      ...pocketQueryKeys.all,
      'collections',
    ] as const,

  tags: () =>
    [
      ...pocketQueryKeys.all,
      'tags',
    ] as const,

  trash: () =>
    [...pocketQueryKeys.all, 'trash'] as const,
}

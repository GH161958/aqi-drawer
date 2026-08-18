export const pocketQueryKeys = {
  all: ['pocket'] as const,

  items: () =>
    [...pocketQueryKeys.all, 'items'] as const,

  trash: () =>
    [...pocketQueryKeys.all, 'trash'] as const,
}

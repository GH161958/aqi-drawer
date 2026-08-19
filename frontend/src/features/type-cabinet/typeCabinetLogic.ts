export type TypePresetName =
  | 'archive'
  | 'bookish'
  | 'paper'
  | 'print'

export interface TypePresetDefinition {
  id: TypePresetName
  index: string
  label: string

  display: string
  cjk: string
  body: string
  meta: string

  displayStack: string
  bodyStack: string
  metaStack: string

  href: string
}

export const TYPE_STORAGE_KEY =
  'aqi-drawer:type-preset'

export const DEFAULT_TYPE_PRESET:
  TypePresetName =
    'archive'

export const TYPE_PRESETS:
  Record<
    TypePresetName,
    TypePresetDefinition
  > = {
    archive: {
      id: 'archive',
      index: '01',
      label: 'Archive',

      display: 'Gloock',
      cjk: 'Noto Serif SC',
      body: 'Source Serif 4',
      meta: 'IBM Plex Sans / Mono',

      displayStack:
        '"Gloock", "Noto Serif SC", Georgia, serif',

      bodyStack:
        '"Source Serif 4", "Noto Serif SC", Georgia, serif',

      metaStack:
        '"IBM Plex Sans", "IBM Plex Mono", ui-sans-serif, system-ui, sans-serif',

      href:
        'https://fonts.googleapis.com/css2?family=Gloock&family=IBM+Plex+Mono:wght@400&family=IBM+Plex+Sans:wght@400;500&family=Noto+Serif+SC:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap',
    },

    bookish: {
      id: 'bookish',
      index: '02',
      label: 'Bookish',

      display: 'Newsreader',
      cjk: 'LXGW WenKai',
      body: 'Newsreader',
      meta: 'IBM Plex Sans',

      displayStack:
        '"Newsreader", "LXGW WenKai", "Iowan Old Style", Baskerville, serif',

      bodyStack:
        '"Newsreader", "LXGW WenKai", "Iowan Old Style", Charter, serif',

      metaStack:
        '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',

      href:
        'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&family=LXGW+WenKai&family=Newsreader:opsz,wght@6..72,400;6..72,600&display=swap',
    },

    paper: {
      id: 'paper',
      index: '03',
      label: 'Paper',

      display:
        'Instrument Serif',
      cjk:
        'ZCOOL XiaoWei',
      body:
        'Noto Serif SC',
      meta:
        'IBM Plex Sans',

      displayStack:
        '"Instrument Serif", "ZCOOL XiaoWei", Georgia, serif',

      bodyStack:
        'Georgia, "Noto Serif SC", "Songti SC", serif',

      metaStack:
        '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',

      href:
        'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500&family=Instrument+Serif&family=Noto+Serif+SC:wght@400;500&family=ZCOOL+XiaoWei&display=swap',
    },

    print: {
      id: 'print',
      index: '04',
      label: 'Print',

      display:
        'Fraunces',
      cjk:
        'Noto Serif SC',
      body:
        'Spectral',
      meta:
        'IBM Plex Sans',

      displayStack:
        '"Fraunces", "Noto Serif SC", Georgia, serif',

      bodyStack:
        '"Spectral", "Noto Serif SC", Georgia, serif',

      metaStack:
        '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',

      href:
        'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500&family=Noto+Serif+SC:wght@400;600;700&family=Spectral:wght@400;600&display=swap',
    },
  }

export const TYPE_PRESET_NAMES =
  Object.keys(
    TYPE_PRESETS,
  ) as TypePresetName[]

export function isTypePresetName(
  value: unknown,
): value is TypePresetName {
  return (
    typeof value === 'string'
    && TYPE_PRESET_NAMES.includes(
      value as TypePresetName,
    )
  )
}

export function readTypePreset():
  TypePresetName {
  try {
    const value =
      window.localStorage.getItem(
        TYPE_STORAGE_KEY,
      )

    return isTypePresetName(value)
      ? value
      : DEFAULT_TYPE_PRESET
  } catch {
    return DEFAULT_TYPE_PRESET
  }
}

export function loadTypePreset(
  preset: TypePresetName,
) {
  if (
    typeof document === 'undefined'
  ) {
    return
  }

  if (
    document.querySelector(
      `link[data-drawer-type-fonts="${preset}"]`,
    )
  ) {
    return
  }

  const link =
    document.createElement(
      'link',
    )

  link.rel = 'stylesheet'
  link.href =
    TYPE_PRESETS[preset].href

  link.dataset.drawerTypeFonts =
    preset

  document.head.append(link)
}

export function preloadTypeCabinet() {
  TYPE_PRESET_NAMES.forEach(
    loadTypePreset,
  )
}

export function applyTypePreset(
  preset: TypePresetName,
) {
  if (
    typeof document === 'undefined'
  ) {
    return
  }

  const definition =
    TYPE_PRESETS[preset]

  loadTypePreset(preset)

  const root =
    document.documentElement

  root.style.setProperty(
    '--drawer-font-display',
    definition.displayStack,
  )

  root.style.setProperty(
    '--drawer-font-body',
    definition.bodyStack,
  )

  root.style.setProperty(
    '--drawer-font-meta',
    definition.metaStack,
  )

  document.body.dataset.typePreset =
    preset
}

export function storeTypePreset(
  preset: TypePresetName,
) {
  try {
    window.localStorage.setItem(
      TYPE_STORAGE_KEY,
      preset,
    )
  } catch {
    // Local storage is a convenience,
    // never a requirement for the Drawer.
  }
}

export function clearTypePreset() {
  try {
    window.localStorage.removeItem(
      TYPE_STORAGE_KEY,
    )
  } catch {
    // Keep the UI functional even if
    // localStorage is unavailable.
  }
}

import { ref } from 'vue'
import { defineStore } from 'pinia'
import { useAudio } from '@/composables/useAudio'
import { LATE_GAME_FEATURE_FLAGS, LATE_GAME_FEATURE_FLAG_CONFIG_MAP, createLateGameFeatureFlagState, normalizeLateGameFeatureOverrides } from '@/data/systemFlags'
import { LATE_GAME_BALANCE_CONFIG } from '@/data/balance/lateGameBalance'
import { getThemeByKey, hexToRgb, type ThemeKey } from '@/data/themes'
import { applyQmsgConfig } from '@/composables/useGameLog'
import type { ItemCategory, LateGameBalanceConfig, LateGameBalanceOverride, LateGameFeatureFlag, LateGameFeatureOverrideMap } from '@/types'

export type QmsgPosition = 'topleft' | 'top' | 'topright' | 'left' | 'center' | 'right' | 'bottomleft' | 'bottom' | 'bottomright'
export type QmsgLimitWidthWrap = 'no-wrap' | 'wrap' | 'ellipsis'

export const DEFAULT_FONT_SIZE = 16
export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 24
export type FontColorKey = 'theme' | 'cream' | 'ink' | 'gold' | 'jade' | 'custom'
export type MutedColorKey = 'theme' | 'gray' | 'soft' | 'warm' | 'slate' | 'custom'
export type FontWeightValue = 400 | 500 | 600 | 700

export interface FontColorOption {
  value: FontColorKey
  label: string
  hex: string | null
}

export interface MutedColorOption {
  value: MutedColorKey
  label: string
  hex: string | null
}

export interface FontWeightOption {
  value: FontWeightValue
  label: string
}

export const FONT_COLOR_OPTIONS: FontColorOption[] = [
  { value: 'theme', label: '随主题', hex: null },
  { value: 'cream', label: '米白', hex: '#e8e4d9' },
  { value: 'ink', label: '墨黑', hex: '#2c2c2c' },
  { value: 'gold', label: '金色', hex: '#c8a45c' },
  { value: 'jade', label: '青绿', hex: '#7fb08a' },
  { value: 'custom', label: '自定义', hex: null }
]

export const MUTED_COLOR_OPTIONS: MutedColorOption[] = [
  { value: 'theme', label: '随主题', hex: null },
  { value: 'gray', label: '石灰', hex: '#6b7280' },
  { value: 'soft', label: '浅灰', hex: '#9ca3af' },
  { value: 'warm', label: '暖灰', hex: '#a89984' },
  { value: 'slate', label: '烟蓝', hex: '#64748b' },
  { value: 'custom', label: '自定义', hex: null }
]

export const FONT_WEIGHT_OPTIONS: FontWeightOption[] = [
  { value: 400, label: '常规' },
  { value: 500, label: '中等' },
  { value: 600, label: '半粗' },
  { value: 700, label: '粗体' }
]

const DEFAULT_FONT_COLOR: FontColorKey = 'theme'
const DEFAULT_FONT_CUSTOM_COLOR = '#e8e4d9'
const DEFAULT_MUTED_COLOR: MutedColorKey = 'theme'
const DEFAULT_MUTED_CUSTOM_COLOR = '#6b7280'
const DEFAULT_FONT_WEIGHT: FontWeightValue = 400
const DEFAULT_THEME: ThemeKey = 'dark'
const DEFAULT_QMSG_POSITION: QmsgPosition = 'top'
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const THEME_MUTED_COLOR_MAP: Record<ThemeKey, string> = {
  dark: '#6b7280',
  warm: '#a09686',
  ink: '#707070',
  parchment: '#786b5d'
}

const clampFontSize = (value: number) => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)))
const normalizeHexColor = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!HEX_COLOR_PATTERN.test(trimmed)) return null
  return trimmed.toLowerCase()
}
const isFontColorKey = (value: unknown): value is FontColorKey =>
  typeof value === 'string' && FONT_COLOR_OPTIONS.some(option => option.value === value)
const isMutedColorKey = (value: unknown): value is MutedColorKey =>
  typeof value === 'string' && MUTED_COLOR_OPTIONS.some(option => option.value === value)
const normalizeFontColor = (value: unknown): FontColorKey => (isFontColorKey(value) ? value : DEFAULT_FONT_COLOR)
const normalizeMutedColor = (value: unknown): MutedColorKey => (isMutedColorKey(value) ? value : DEFAULT_MUTED_COLOR)
const getFontColorHex = (value: FontColorKey): string | null => {
  const option = FONT_COLOR_OPTIONS.find(item => item.value === value)
  return normalizeHexColor(option?.hex)
}
const getMutedColorHex = (value: MutedColorKey): string | null => {
  const option = MUTED_COLOR_OPTIONS.find(item => item.value === value)
  return normalizeHexColor(option?.hex)
}
const normalizeFontWeight = (value: unknown): FontWeightValue => {
  const numeric = typeof value === 'number' ? value : Number(value)
  return FONT_WEIGHT_OPTIONS.some(option => option.value === numeric) ? (numeric as FontWeightValue) : DEFAULT_FONT_WEIGHT
}

interface SerializedSettingsState {
  fontSize: number
  fontColor: FontColorKey
  fontCustomColor: string
  mutedColor: MutedColorKey
  mutedCustomColor: string
  fontWeight: FontWeightValue
  sfxEnabled: boolean
  bgmEnabled: boolean
  theme: ThemeKey
  qmsgPosition: QmsgPosition
  qmsgTimeout: number
  qmsgMaxNums: number
  qmsgIsLimitWidth: boolean
  qmsgLimitWidthNum: number
  qmsgLimitWidthWrap: QmsgLimitWidthWrap
  qmsgAnimation: boolean
  qmsgAutoClose: boolean
  qmsgShowClose: boolean
  qmsgShowIcon: boolean
  qmsgShowReverse: boolean
  inventoryFilter: ItemCategory[]
  lateGameFeatureOverrides: LateGameFeatureOverrideMap
  lateGameBalanceOverrides: LateGameBalanceOverride
}

export const useSettingsStore = defineStore('settings', () => {
  const fontSize = ref(DEFAULT_FONT_SIZE)
  const fontColor = ref<FontColorKey>(DEFAULT_FONT_COLOR)
  const fontCustomColor = ref(DEFAULT_FONT_CUSTOM_COLOR)
  const mutedColor = ref<MutedColorKey>(DEFAULT_MUTED_COLOR)
  const mutedCustomColor = ref(DEFAULT_MUTED_CUSTOM_COLOR)
  const fontWeight = ref<FontWeightValue>(DEFAULT_FONT_WEIGHT)
  const theme = ref<ThemeKey>(DEFAULT_THEME)
  const qmsgPosition = ref<QmsgPosition>(DEFAULT_QMSG_POSITION)
  const qmsgTimeout = ref(2500)
  const qmsgMaxNums = ref(5)
  const qmsgIsLimitWidth = ref(true)
  const qmsgLimitWidthNum = ref(200)
  const qmsgLimitWidthWrap = ref<QmsgLimitWidthWrap>('wrap')
  const qmsgAnimation = ref(true)
  const qmsgAutoClose = ref(true)
  const qmsgShowClose = ref(false)
  const qmsgShowIcon = ref(false)
  const qmsgShowReverse = ref(false)

  /** 背包物品筛选：选中的分类（空数组 = 显示全部） */
  const inventoryFilter = ref<ItemCategory[]>([])
  const lateGameFeatureOverrides = ref<LateGameFeatureOverrideMap>({})
  const lateGameFeatureBaselineSaveVersion = ref(Number.MAX_SAFE_INTEGER)
  const lateGameBalanceOverrides = ref<LateGameBalanceOverride>({})

  const applyFontSize = () => {
    fontSize.value = clampFontSize(fontSize.value)
    document.documentElement.style.fontSize = `${fontSize.value}px`
  }

  const applyFontColor = () => {
    fontColor.value = normalizeFontColor(fontColor.value)
    const themeText = getThemeByKey(theme.value).text
    const customHex = normalizeHexColor(fontCustomColor.value) ?? DEFAULT_FONT_CUSTOM_COLOR
    fontCustomColor.value = customHex
    document.documentElement.style.setProperty('--color-text', hexToRgb(fontColor.value === 'custom' ? customHex : (getFontColorHex(fontColor.value) ?? themeText)))
  }

  const applyMutedColor = () => {
    mutedColor.value = normalizeMutedColor(mutedColor.value)
    const themeMuted = THEME_MUTED_COLOR_MAP[theme.value]
    const customHex = normalizeHexColor(mutedCustomColor.value) ?? DEFAULT_MUTED_CUSTOM_COLOR
    const nextHex = mutedColor.value === 'custom' ? customHex : (getMutedColorHex(mutedColor.value) ?? themeMuted)
    mutedCustomColor.value = customHex
    document.documentElement.style.setProperty('--color-muted', nextHex)
    document.documentElement.style.setProperty('--color-muted-rgb', hexToRgb(nextHex))
  }

  const applyFontWeight = () => {
    fontWeight.value = normalizeFontWeight(fontWeight.value)
    document.documentElement.style.setProperty('--font-weight-game', String(fontWeight.value))
  }

  const applyTheme = () => {
    const t = getThemeByKey(theme.value)
    document.documentElement.style.setProperty('--color-bg', hexToRgb(t.bg))
    document.documentElement.style.setProperty('--color-panel', hexToRgb(t.panel))
    applyFontColor()
    applyMutedColor()
  }

  const changeFontSize = (delta: number) => {
    fontSize.value = clampFontSize(fontSize.value + delta)
    applyFontSize()
  }

  const changeFontColor = (value: FontColorKey) => {
    fontColor.value = normalizeFontColor(value)
    applyFontColor()
  }

  const changeFontCustomColor = (value: string) => {
    const normalized = normalizeHexColor(value)
    if (!normalized) return false
    fontCustomColor.value = normalized
    fontColor.value = 'custom'
    applyFontColor()
    return true
  }

  const changeMutedColor = (value: MutedColorKey) => {
    mutedColor.value = normalizeMutedColor(value)
    applyMutedColor()
  }

  const changeMutedCustomColor = (value: string) => {
    const normalized = normalizeHexColor(value)
    if (!normalized) return false
    mutedCustomColor.value = normalized
    mutedColor.value = 'custom'
    applyMutedColor()
    return true
  }

  const changeFontWeight = (value: FontWeightValue) => {
    fontWeight.value = normalizeFontWeight(value)
    applyFontWeight()
  }

  const changeTheme = (key: ThemeKey) => {
    theme.value = key
    applyTheme()
  }

  const changeQmsgPosition = (pos: QmsgPosition) => {
    qmsgPosition.value = pos
    syncQmsgConfig()
  }

  /** 将当前所有通知设置同步到 Qmsg */
  const syncQmsgConfig = () => {
    applyQmsgConfig({
      position: qmsgPosition.value,
      timeout: qmsgTimeout.value,
      maxNums: qmsgMaxNums.value,
      isLimitWidth: qmsgIsLimitWidth.value,
      limitWidthNum: qmsgLimitWidthNum.value,
      limitWidthWrap: qmsgLimitWidthWrap.value,
      animation: qmsgAnimation.value,
      autoClose: qmsgAutoClose.value,
      showClose: qmsgShowClose.value,
      showIcon: qmsgShowIcon.value,
      showReverse: qmsgShowReverse.value
    })
  }

  const setLateGameFeatureBaselineSaveVersion = (saveVersion?: number) => {
    lateGameFeatureBaselineSaveVersion.value = Number.isFinite(saveVersion)
      ? Number(saveVersion)
      : Number.MAX_SAFE_INTEGER
  }

  const getLateGameFeatureState = () =>
    createLateGameFeatureFlagState(lateGameFeatureBaselineSaveVersion.value, lateGameFeatureOverrides.value)

  const isFeatureEnabled = (flagId: LateGameFeatureFlag) => getLateGameFeatureState()[flagId] ?? false

  const setFeatureOverride = (flagId: LateGameFeatureFlag, enabled: boolean | null | undefined) => {
    if (!import.meta.env.DEV) return

    const next = { ...lateGameFeatureOverrides.value }
    if (enabled === null || enabled === undefined) {
      delete next[flagId]
    } else {
      next[flagId] = enabled
    }
    lateGameFeatureOverrides.value = next
  }

  const clearFeatureOverride = (flagId: LateGameFeatureFlag) => {
    setFeatureOverride(flagId, null)
  }

  const clearAllFeatureOverrides = () => {
    if (!import.meta.env.DEV) return
    lateGameFeatureOverrides.value = {}
  }

  const getFeatureConfig = (flagId: LateGameFeatureFlag) => LATE_GAME_FEATURE_FLAG_CONFIG_MAP[flagId]

  const getLateGameBalanceConfig = (): LateGameBalanceConfig => ({
    ...LATE_GAME_BALANCE_CONFIG,
    ...lateGameBalanceOverrides.value,
    budgetReturnCurves: lateGameBalanceOverrides.value.budgetReturnCurves ?? LATE_GAME_BALANCE_CONFIG.budgetReturnCurves,
    wealthTiers: lateGameBalanceOverrides.value.wealthTiers ?? LATE_GAME_BALANCE_CONFIG.wealthTiers
  })

  const setLateGameBalanceOverrides = (overrides: LateGameBalanceOverride) => {
    if (!import.meta.env.DEV) return
    lateGameBalanceOverrides.value = {
      ...lateGameBalanceOverrides.value,
      ...overrides
    }
  }

  const clearLateGameBalanceOverrides = () => {
    if (!import.meta.env.DEV) return
    lateGameBalanceOverrides.value = {}
  }

  const serialize = () => {
    const { sfxEnabled, bgmEnabled } = useAudio()
    return {
      fontSize: fontSize.value,
      fontColor: normalizeFontColor(fontColor.value),
      fontCustomColor: normalizeHexColor(fontCustomColor.value) ?? DEFAULT_FONT_CUSTOM_COLOR,
      mutedColor: normalizeMutedColor(mutedColor.value),
      mutedCustomColor: normalizeHexColor(mutedCustomColor.value) ?? DEFAULT_MUTED_CUSTOM_COLOR,
      fontWeight: fontWeight.value,
      sfxEnabled: sfxEnabled.value,
      bgmEnabled: bgmEnabled.value,
      theme: theme.value,
      qmsgPosition: qmsgPosition.value,
      qmsgTimeout: qmsgTimeout.value,
      qmsgMaxNums: qmsgMaxNums.value,
      qmsgIsLimitWidth: qmsgIsLimitWidth.value,
      qmsgLimitWidthNum: qmsgLimitWidthNum.value,
      qmsgLimitWidthWrap: qmsgLimitWidthWrap.value,
      qmsgAnimation: qmsgAnimation.value,
      qmsgAutoClose: qmsgAutoClose.value,
      qmsgShowClose: qmsgShowClose.value,
      qmsgShowIcon: qmsgShowIcon.value,
      qmsgShowReverse: qmsgShowReverse.value,
      inventoryFilter: inventoryFilter.value,
      lateGameFeatureOverrides: lateGameFeatureOverrides.value,
      lateGameBalanceOverrides: lateGameBalanceOverrides.value
    }
  }

  const deserialize = (data?: Partial<SerializedSettingsState> | null, saveVersion?: number) => {
    setLateGameFeatureBaselineSaveVersion(saveVersion)
    fontSize.value = clampFontSize(data?.fontSize ?? DEFAULT_FONT_SIZE)
    applyFontSize()
    fontColor.value = normalizeFontColor(data?.fontColor)
    fontCustomColor.value = normalizeHexColor(data?.fontCustomColor) ?? DEFAULT_FONT_CUSTOM_COLOR
    mutedColor.value = normalizeMutedColor(data?.mutedColor)
    mutedCustomColor.value = normalizeHexColor(data?.mutedCustomColor) ?? DEFAULT_MUTED_CUSTOM_COLOR
    fontWeight.value = normalizeFontWeight(data?.fontWeight)
    applyFontWeight()
    theme.value = data?.theme ?? DEFAULT_THEME
    applyTheme()
    qmsgPosition.value = data?.qmsgPosition ?? DEFAULT_QMSG_POSITION
    qmsgTimeout.value = data?.qmsgTimeout ?? 2500
    qmsgMaxNums.value = data?.qmsgMaxNums ?? 5
    qmsgIsLimitWidth.value = data?.qmsgIsLimitWidth ?? true
    qmsgLimitWidthNum.value = data?.qmsgLimitWidthNum ?? 200
    qmsgLimitWidthWrap.value = data?.qmsgLimitWidthWrap ?? 'wrap'
    qmsgAnimation.value = data?.qmsgAnimation ?? true
    qmsgAutoClose.value = data?.qmsgAutoClose ?? true
    qmsgShowClose.value = data?.qmsgShowClose ?? false
    qmsgShowIcon.value = data?.qmsgShowIcon ?? false
    qmsgShowReverse.value = data?.qmsgShowReverse ?? false
    inventoryFilter.value = data?.inventoryFilter ?? []
    lateGameFeatureOverrides.value = import.meta.env.DEV
      ? normalizeLateGameFeatureOverrides(data?.lateGameFeatureOverrides, lateGameFeatureBaselineSaveVersion.value)
      : {}
    lateGameBalanceOverrides.value = import.meta.env.DEV && data?.lateGameBalanceOverrides && typeof data.lateGameBalanceOverrides === 'object'
      ? data.lateGameBalanceOverrides
      : {}
    syncQmsgConfig()
    const { sfxEnabled, bgmEnabled, startBgm, stopBgm } = useAudio()
    sfxEnabled.value = data?.sfxEnabled ?? true
    bgmEnabled.value = data?.bgmEnabled ?? true
    if (bgmEnabled.value) {
      startBgm()
    } else {
      stopBgm()
    }
  }

  // 初始化时立即同步到 Qmsg，确保新游戏/首次加载也能生效
  syncQmsgConfig()
  applyFontSize()
  applyFontWeight()
  applyTheme()

  return {
    fontSize,
    fontColor,
    fontCustomColor,
    mutedColor,
    mutedCustomColor,
    fontWeight,
    theme,
    qmsgPosition,
    qmsgTimeout,
    qmsgMaxNums,
    qmsgIsLimitWidth,
    qmsgLimitWidthNum,
    qmsgLimitWidthWrap,
    qmsgAnimation,
    qmsgAutoClose,
    qmsgShowClose,
    qmsgShowIcon,
    qmsgShowReverse,
    inventoryFilter,
    lateGameFeatureOverrides,
    lateGameFeatureBaselineSaveVersion,
    lateGameBalanceOverrides,
    lateGameFeatureConfigs: LATE_GAME_FEATURE_FLAGS,
    changeFontSize,
    changeFontColor,
    changeFontCustomColor,
    changeMutedColor,
    changeMutedCustomColor,
    changeFontWeight,
    changeTheme,
    changeQmsgPosition,
    syncQmsgConfig,
    setLateGameFeatureBaselineSaveVersion,
    getLateGameFeatureState,
    isFeatureEnabled,
    setFeatureOverride,
    clearFeatureOverride,
    clearAllFeatureOverrides,
    getFeatureConfig,
    getLateGameBalanceConfig,
    setLateGameBalanceOverrides,
    clearLateGameBalanceOverrides,
    applyFontSize,
    applyFontColor,
    applyMutedColor,
    applyFontWeight,
    applyTheme,
    serialize,
    deserialize
  }
})

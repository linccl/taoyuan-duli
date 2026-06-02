<template>
  <div class="auth-view flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-8" @click.once="startBgm">
    <div class="flex flex-col items-center gap-2 text-center">
      <div class="flex items-center space-x-3">
        <div class="logo" />
        <h1 class="text-accent text-2xl md:text-4xl tracking-widest">{{ pkg.title }}</h1>
      </div>
      <p class="text-[11px] md:text-xs text-muted leading-6 max-w-md">登录后就能同步账号进度，在不同设备上继续你的田园生活。</p>
    </div>

    <div class="w-full max-w-3xl grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
      <section class="game-panel space-y-4">
        <div class="space-y-1">
          <p class="game-section-title">登录账号</p>
          <p class="game-section-desc">登录后可继续账号存档，并使用交流大厅、邮箱等在线功能。</p>
        </div>

        <template v-if="currentUser">
          <div class="game-panel-muted p-4 space-y-3">
            <div>
              <p class="text-xs text-accent">当前账号</p>
              <p class="text-sm mt-1">{{ currentUser.display_name || currentUser.username }}</p>
              <p class="text-[11px] text-muted mt-1">用户名：{{ currentUser.username }}</p>
            </div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button class="justify-center" :icon="ArrowLeft" @click="goBack">返回主菜单</Button>
              <Button class="justify-center" :icon="LogOut" @click="handleLogout">退出登录</Button>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="flex items-center justify-center space-x-2">
            <Button class="py-1 px-3 text-xs" :class="authMode === 'login' ? '!bg-accent !text-bg' : ''" @click="authMode = 'login'">登录账号</Button>
            <Button class="py-1 px-3 text-xs" :class="authMode === 'register' ? '!bg-accent !text-bg' : ''" @click="authMode = 'register'">注册账号</Button>
          </div>

          <div class="game-panel-muted p-4 space-y-3">
            <div class="grid grid-cols-1 gap-3">
              <input v-model="authForm.username" type="text" maxlength="20" placeholder="请输入用户名" class="w-full px-3 py-2 bg-bg border border-accent/30 rounded-xs text-sm focus:border-accent outline-none" />
              <input v-model="authForm.password" type="password" maxlength="50" placeholder="密码（至少 6 位）" class="w-full px-3 py-2 bg-bg border border-accent/30 rounded-xs text-sm focus:border-accent outline-none" />
              <input v-if="authMode === 'register'" v-model="authForm.displayName" type="text" maxlength="30" placeholder="显示名称（可选）" class="w-full px-3 py-2 bg-bg border border-accent/30 rounded-xs text-sm focus:border-accent outline-none" />
            </div>

            <div class="rounded-xs border border-accent/10 bg-bg/15 px-3 py-2">
              <p class="text-[10px] text-accent">说明</p>
              <p class="text-[11px] text-muted mt-1 leading-5">{{ authMode === 'login' ? '如果你已经注册过，直接输入账号和密码即可。' : '注册完成后会自动登录，方便你马上开始游戏。' }}</p>
            </div>

            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button class="justify-center" :icon="ArrowLeft" @click="goBack">返回主菜单</Button>
              <Button class="justify-center" :icon="authMode === 'login' ? LogIn : UserPlus" :disabled="authSubmitting" @click="handleAuthSubmit">
                {{ authSubmitting ? '提交中...' : authMode === 'login' ? '登录' : '注册并登录' }}
              </Button>
            </div>

            <div v-if="showLinuxDoLogin" class="border-t border-accent/10 pt-3">
              <Button class="w-full justify-center" :icon="LogIn" :disabled="linuxDoSubmitting || authSubmitting" @click="handleLinuxDoLogin">
                {{ linuxDoSubmitting ? '正在前往 Linux DO...' : '使用 Linux DO 登录' }}
              </Button>
            </div>
          </div>
        </template>
      </section>

      <section class="game-panel space-y-3">
        <div class="space-y-1">
          <p class="game-section-title">使用说明</p>
          <p class="game-section-desc">先登录或注册账号，再回到主菜单开始你的旅程。</p>
        </div>
        <div class="game-panel-muted p-3 space-y-2 text-[11px] text-muted leading-5">
          <p v-for="(tip, index) in authTips" :key="tip">{{ index + 1 }}. {{ tip }}</p>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { computed, ref, onMounted, watch } from 'vue'
  import { useRouter, useRoute } from 'vue-router'
  import { Capacitor } from '@capacitor/core'
  import { ArrowLeft, LogIn, LogOut, UserPlus } from 'lucide-vue-next'
  import Button from '@/components/game/Button.vue'
  import _pkg from '../../package.json'
  import { useAudio } from '@/composables/useAudio'
  import { showFloat } from '@/composables/useGameLog'
  import { buildApiUrl, isSafeApiStartPath, resolveSafeSameSitePath } from '@/utils/apiClient'
  import { initCurrentAccount } from '@/utils/accountStorage'
  import { clearStoredAdminToken } from '@/utils/taoyuanMailboxAdminApi'
  import { useSaveStore } from '@/stores/useSaveStore'

  type CurrentUser = { username: string; display_name?: string }
  type QueryValue = string | string[] | null | undefined

  const LINUX_DO_ERROR_MESSAGES: Record<string, string> = {
    cancelled: '已取消 Linux DO 登录',
    provider_cancelled: '已取消 Linux DO 登录',
    token: 'Linux DO 授权信息校验失败，请重试',
    profile: '获取 Linux DO 用户资料失败，请重试',
    oauth_store: '保存 Linux DO 登录状态失败，请稍后重试',
    id_token_invalid: 'Linux DO 身份令牌校验失败，请重试',
    profile_rejected: '当前 Linux DO 账号暂不可登录',
    account_blocked: '当前账号暂不可登录',
    auto_create: '自动创建账号失败，请稍后重试',
    account_create: '自动创建账号失败，请稍后重试'
  }

  const router = useRouter()
  const route = useRoute()
  const { startBgm } = useAudio()
  const pkg = _pkg as typeof _pkg & { title: string }
  const saveStore = useSaveStore()

  const authMode = ref<'login' | 'register'>('login')
  const authSubmitting = ref(false)
  const linuxDoSubmitting = ref(false)
  const linuxDoStartPath = ref('')
  const currentUser = ref<null | CurrentUser>(null)
  const authForm = ref({ username: '', password: '', displayName: '' })
  const showLinuxDoLogin = computed(() => !currentUser.value && !!linuxDoStartPath.value)
  const authTips = ['注册一个新账号后，下次可以直接用它登录。', '登录成功后，会自动回到主菜单并同步当前账号。', '想换成本地存档或账号存档，都可以回主菜单再切换。', '如果只是想先看看，也可以随时返回主菜单。']

  const syncModeFromRoute = () => {
    authMode.value = route.query.mode === 'register' ? 'register' : 'login'
  }

  const firstQueryValue = (value: QueryValue): string => Array.isArray(value) ? value[0] || '' : value || ''
  const safeQueryPath = (value: QueryValue): string => resolveSafeSameSitePath(firstQueryValue(value))
  const hasLinuxDoCallbackQuery = () => firstQueryValue(route.query.linuxdo) === 'success' || !!firstQueryValue(route.query.linuxdo_error)

  const isNativePlatform = (): boolean => {
    try {
      return Capacitor.isNativePlatform()
    } catch {
      return true
    }
  }

  const goBack = () => {
    void router.push(safeQueryPath(route.query.redirect))
  }

  const loadCurrentUser = async () => {
    try {
      const res = await fetch('/api/me', { credentials: 'include' })
      const data = await res.json().catch(() => null)
      currentUser.value = res.ok && data?.ok && data?.user
        ? { username: data.user.username, display_name: data.user.display_name }
        : null
    } catch {
      currentUser.value = null
    }
  }

  const loadLinuxDoConfig = async () => {
    linuxDoStartPath.value = ''
    if (isNativePlatform()) return
    try {
      const res = await fetch('/api/public-config', { credentials: 'include' })
      const data = await res.json().catch(() => null) as unknown
      if (!res.ok || !data || typeof data !== 'object' || Array.isArray(data)) return
      const config = data as Record<string, unknown>
      const startPath = config.linux_do_oauth_start_path
      linuxDoStartPath.value = config.linux_do_oauth_enabled === true && isSafeApiStartPath(startPath) ? startPath : ''
    } catch {
      linuxDoStartPath.value = ''
    }
  }

  const resetAuthForm = () => {
    authForm.value = { username: '', password: '', displayName: '' }
  }

  const refreshAccountAfterLogin = async () => {
    await initCurrentAccount()
    saveStore.reloadAccountScopedState()
    if (saveStore.storageMode === 'server') {
      await saveStore.syncPendingServerSaves()
    }
    await loadCurrentUser()
  }

  const handleAuthSubmit = async () => {
    const username = authForm.value.username.trim()
    const password = authForm.value.password
    const displayName = authForm.value.displayName.trim()
    if (!username) {
      showFloat('请填写用户名', 'danger')
      return
    }
    if (password.length < 6) {
      showFloat('密码至少需要 6 位', 'danger')
      return
    }

    authSubmitting.value = true
    try {
      const res = await fetch(authMode.value === 'login' ? '/api/login' : '/api/register', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, display_name: displayName })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        showFloat(data?.msg || (authMode.value === 'login' ? '登录失败' : '注册失败'), 'danger')
        return
      }

      await refreshAccountAfterLogin()
      resetAuthForm()
      showFloat(authMode.value === 'login' ? '登录成功' : '注册成功，已自动登录', 'success')
      goBack()
    } catch {
      showFloat(authMode.value === 'login' ? '登录失败' : '注册失败', 'danger')
    } finally {
      authSubmitting.value = false
    }
  }

  const resolveLinuxDoErrorMessage = (code: string) => {
    if (code.startsWith('state_')) return '登录状态已过期，请重新发起 Linux DO 登录'
    return LINUX_DO_ERROR_MESSAGES[code] || 'Linux DO 登录失败，请重试'
  }

  const clearLinuxDoCallbackQuery = async () => {
    const query = { ...route.query }
    delete query.linuxdo
    delete query.linuxdo_error
    await router.replace({ name: 'auth', query })
  }

  const handleLinuxDoCallback = async () => {
    const linuxdoError = firstQueryValue(route.query.linuxdo_error)
    if (!hasLinuxDoCallbackQuery()) return
    const redirect = safeQueryPath(route.query.redirect)
    await clearLinuxDoCallbackQuery()

    if (linuxdoError) {
      showFloat(resolveLinuxDoErrorMessage(linuxdoError), 'danger')
      return
    }

    try {
      await refreshAccountAfterLogin()
      if (!currentUser.value) {
        showFloat('Linux DO 登录状态刷新失败，请重试', 'danger')
        return
      }
      showFloat('Linux DO 登录成功', 'success')
      void router.push(redirect)
    } catch {
      showFloat('Linux DO 登录状态刷新失败，请重试', 'danger')
    }
  }

  const handleLinuxDoLogin = () => {
    if (!linuxDoStartPath.value || isNativePlatform()) return
    const returnTo = safeQueryPath(route.query.redirect)
    const startUrl = buildApiUrl(`${linuxDoStartPath.value}?return_to=${encodeURIComponent(returnTo)}`)
    linuxDoSubmitting.value = true
    try {
      window.location.assign(startUrl)
    } catch {
      linuxDoSubmitting.value = false
      showFloat('无法前往 Linux DO 登录，请稍后重试', 'danger')
    }
  }

  const handleLogout = async () => {
    let logoutRequestFailed = false
    try {
      const response = await fetch('/api/logout', { method: 'POST', credentials: 'include' })
      logoutRequestFailed = !response.ok
    } catch {
      logoutRequestFailed = true
    }
    clearStoredAdminToken()
    await initCurrentAccount()
    saveStore.reloadAccountScopedState()
    await loadCurrentUser()
    if (currentUser.value) {
      showFloat('退出登录未完成，请稍后重试。', 'danger')
      return
    }
    if (logoutRequestFailed) {
      showFloat('本地状态已刷新，如仍显示已登录请重试。', 'danger')
      return
    }
    showFloat('已退出登录', 'success')
  }

  onMounted(() => {
    syncModeFromRoute()
    void loadLinuxDoConfig()
    void (hasLinuxDoCallbackQuery() ? handleLinuxDoCallback() : loadCurrentUser())
  })

  watch(() => route.query.mode, syncModeFromRoute)

  watch(() => [route.query.linuxdo, route.query.linuxdo_error], () => { void handleLinuxDoCallback() })
</script>

<style scoped>
  .auth-view { max-width: 980px; margin: 0 auto; }
  .logo { width: 50px; height: 50px; background: url(@/assets/logo.png) center / contain no-repeat; image-rendering: pixelated; flex-shrink: 0; }
</style>

import { onMounted, onBeforeUnmount, watch, reactive, ref } from '@common/utils/vueTools'

export default ({ visible, location, onHide }) => {
  let show = false
  let mounted = true
  let openGen = 0
  const dom_menu = ref(null)
  const menuStyles = reactive({
    left: '0px',
    top: '0px',
    opacity: 0,
    transitionProperty: 'transform, opacity',
    transform: 'scale(.8, .7)',
    pointerEvents: 'none',
  })
  const place = () => {
    const menu = dom_menu.value
    if (!menu) return
    const parent = menu.offsetParent
    const bounds = parent?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    // Callers use page coordinates; convert to the actual teleport container, not a guessed border offset.
    const x = location.value.x - window.scrollX - bounds.left + 2
    const y = location.value.y - window.scrollY - bounds.top
    menuStyles.left = `${Math.max(4, Math.min(x, bounds.width - menu.clientWidth - 4))}px`
    menuStyles.top = `${Math.max(4, Math.min(y, bounds.height - menu.clientHeight - 4))}px`
  }
  const update = () => {
    const nextShow = Boolean(visible.value)
    if (nextShow !== show) openGen++
    show = nextShow
    if (show) place()
    menuStyles.opacity = show ? 1 : 0
    menuStyles.transform = show ? 'scale(1)' : 'scale(.8, .7)'
    menuStyles.pointerEvents = show ? 'auto' : 'none'
  }
  const dismiss = () => { if (mounted && show) onHide() }
  const outside = (event) => {
    if (!show || dom_menu.value?.contains(event.target)) return
    if (event.type === 'click') {
      // 延迟到当前 click 同步派发后的微任务收起菜单：
      // 1) document capture 仍可穿透 Modal 的 @click.stop 收起菜单；
      // 2) 目标行/侧栏的同步 @click 仍能观察到 rightClickSelectedIndex > -1 / isShowMenu 守卫，避免点击穿透误选/误播；
      // 3) Modal 关闭按钮等无守卫控件同次点击仍可正常响应。
      const gen = openGen
      const prevX = location.value.x
      const prevY = location.value.y
      queueMicrotask(() => {
        if (mounted && show && gen === openGen && location.value.x === prevX && location.value.y === prevY) onHide()
      })
      return
    }
    dismiss()
  }
  const keydown = (event) => {
    if (!show || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    dismiss()
  }
  watch(visible, update, { flush: 'post' })
  watch(location, () => { if (show) place() }, { deep: true, flush: 'post' })
  onMounted(() => {
    update()
    document.addEventListener('click', outside, true)
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('scroll', outside, true)
    window.addEventListener('resize', dismiss)
  })
  onBeforeUnmount(() => {
    mounted = false
    document.removeEventListener('click', outside, true)
    document.removeEventListener('keydown', keydown, true)
    document.removeEventListener('scroll', outside, true)
    window.removeEventListener('resize', dismiss)
  })
  return { dom_menu, menuStyles }
}

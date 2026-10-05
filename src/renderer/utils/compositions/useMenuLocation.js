import { onMounted, onBeforeUnmount, watch, reactive, ref } from '@common/utils/vueTools'

export default ({ visible, location, onHide }) => {
  let show = false
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
    show = visible.value
    if (show) place()
    menuStyles.opacity = show ? 1 : 0
    menuStyles.transform = show ? 'scale(1)' : 'scale(.8, .7)'
    menuStyles.pointerEvents = show ? 'auto' : 'none'
  }
  const dismiss = () => { if (show) onHide() }
  const outside = (event) => {
    if (!dom_menu.value?.contains(event.target)) dismiss()
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
    document.removeEventListener('click', outside, true)
    document.removeEventListener('keydown', keydown, true)
    document.removeEventListener('scroll', outside, true)
    window.removeEventListener('resize', dismiss)
  })
  return { dom_menu, menuStyles }
}

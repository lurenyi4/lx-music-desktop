import { createApp, defineComponent, h, nextTick } from 'vue'
import Harness from './Harness.vue'
import Modal from '../../src/renderer/components/material/Modal.vue'
import Menu from '../../src/renderer/components/base/Menu.vue'
import OnlineList from '../../src/renderer/components/material/OnlineList/index.vue'
import { createI18n } from '../../src/lang'
import './mocks'
const i18n = createI18n(); i18n.setLanguage('en-us')
Object.assign(window, { i18n, app_event: { on() {}, off() {}, musicToggled() {} } })
const app = createApp(Harness)
app.config.globalProperties.$t = (...args: any[]) => (i18n.t as any)(...args)
app.component('material-modal', Modal)
app.component('base-menu', Menu)
app.component('material-online-list', OnlineList)
app.component('base-btn', defineComponent({ setup(_, { slots, attrs }) { return () => h('button', attrs, slots.default?.()) } }))
app.component('base-virtualized-list', defineComponent({
  props: ['list'],
  setup(props, { slots, attrs, expose }) {
    expose({ scrollTo() {} })
    return () => h('div', attrs, [...props.list.map((item: any, index: number) => slots.default?.({ item, index })), slots.footer?.()])
  },
}))
app.component('material-pagination', defineComponent({ setup() { return () => h('button', { id: 'catalog-footer' }, 'Catalog footer') } }))
app.component('common-catalog-link', defineComponent({ props: ['music', 'kind'], setup(props) { return () => h('span', props.kind === 'artist' ? props.music.singer : props.music.meta.albumName) } }))
for (const name of ['common-list-add-modal', 'common-list-add-multiple-modal', 'common-download-modal', 'common-download-multiple-modal']) app.component(name, defineComponent({ setup() { return () => null } }))
app.mount('#app')
;(window as any).fixture.flush = async() => nextTick()
;(window as any).fixture.unmount = () => { app.unmount() }

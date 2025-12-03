<script>
import Moment from 'moment'
import jsbridge from '@/utils/jsbridge'

export default {
  components: {},
  data: function () {
    return {}
  },
  mounted () {
    // 注册所有可供 App 调用的功能
    this.registerBridgeActions()
  },
  methods: {
    // 注册 JSBridge 动作
    registerBridgeActions () {
      jsbridge.registerActions({
        // 星座线
        toggleConstellationLines: (visible) => {
          this.$stel.core.constellations.lines_visible = visible
          this.$stel.core.constellations.labels_visible = visible
        },
        // 星座图
        toggleConstellationArt: (visible) => {
          this.$stel.core.constellations.images_visible = visible
        },
        // 大气层
        toggleAtmosphere: (visible) => {
          this.$stel.core.atmosphere.visible = visible
        },
        // 地景
        toggleLandscape: (visible) => {
          this.$stel.core.landscapes.visible = visible
        },
        // 地平网格
        toggleAzimuthalGrid: (visible) => {
          this.$stel.core.lines.azimuthal.visible = visible
        },
        // 赤道网格
        toggleEquatorialGrid: (visible) => {
          this.$stel.core.lines.equatorial_jnow.visible = visible
        },
        // 赤道 J2000 网格
        toggleEquatorialJ2000Grid: (visible) => {
          this.$stel.core.lines.equatorial.visible = visible
        },
        // 深空天体
        toggleDeepSkyObjects: (visible) => {
          this.$stel.core.dsos.visible = visible
        },
        // 夜间模式
        toggleNightMode: (enabled) => {
          this.setNightMode(enabled)
        },
        // 全屏
        toggleFullscreen: (enabled) => {
          this.setFullscreen(enabled)
        },
        // 设置位置
        // {
        // "lat": 31.2304,
        // "lng": 121.4737,
        // "short_name": "Shanghai",
        // "country": "China"
        // }
        setLocation: (loc) => {
          this.setLocation(loc)
        },
        // 设置时间
        setDateTime: (isoString) => {
          const m = Moment(isoString)
          m.local()
          m.milliseconds(this.getLocalTime().milliseconds())
          this.$stel.core.observer.utc = m.toDate().getMJD()
        },
        // 获取当前状态
        getState: () => {
          return {
            constellationLines: this.$store.state.stel.constellations.lines_visible,
            constellationArt: this.$store.state.stel.constellations.images_visible,
            atmosphere: this.$store.state.stel.atmosphere.visible,
            landscape: this.$store.state.stel.landscapes.visible,
            azimuthalGrid: this.$store.state.stel.lines.azimuthal.visible,
            equatorialGrid: this.$store.state.stel.lines.equatorial_jnow.visible,
            equatorialJ2000Grid: this.$store.state.stel.lines.equatorial.visible,
            deepSkyObjects: this.$store.state.stel.dsos.visible,
            nightMode: this.$store.state.nightmode,
            fullscreen: this.$store.state.fullscreen,
            currentTime: this.pickerDate,
            location: this.$store.state.currentLocation
          }
        }
      })
    },

    // ... 保留原有方法
    getLocalTime: function () {
      var d = new Date()
      d.setMJD(this.$store.state.stel.observer.utc)
      const m = Moment(d)
      m.local()
      return m
    },
    setLocation: function (loc) {
      this.$store.commit('setCurrentLocation', loc)
    },
    setFullscreen: function (b) {
      this.$fullscreen.toggle(document.body, {
        wrap: false,
        callback: this.onFullscreenChange
      })
    },
    setNightMode: function (b) {
      this.$store.commit('toggleBool', 'nightmode')
      if (window.navigator.userAgent.indexOf('Edge') > -1) {
        document.getElementById('nightmode').style.opacity = b ? '0.5' : '0'
      }
      document.getElementById('nightmode').style.visibility = b ? 'visible' : 'hidden'
    },
    onFullscreenChange: function (b) {
      if (this.$store.state.fullscreen === b) return
      this.$store.commit('toggleBool', 'fullscreen')
    }
  }
}
</script>

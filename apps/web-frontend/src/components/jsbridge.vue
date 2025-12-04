<template>
  <div style="display: none"></div>
</template>
<script>
import Moment from 'moment'
import jsbridge from '@/utils/jsbridge'
import swh from '@/assets/sw_helpers'

export default {
  components: {},
  data: function () {
    return {
      calibrationOffset: {
        azimuth: 0,
        altitude: 0
      }
    }
  },
  mounted () {
    this.registerBridgeActions()
  },
  methods: {
    azAltToObserved (azimuth, altitude) {
      const cosAlt = Math.cos(altitude)
      return [
        Math.cos(azimuth) * cosAlt, // X = 北分量
        Math.sin(azimuth) * cosAlt, // Y = 东分量
        Math.sin(altitude) // Z = 上分量
      ]
    },
    updateState () {
      console.log('JSBridge getState called')
      const data =
        {
          toggleConstellationLines: this.$store.state.stel.constellations.lines_visible,
          toggleConstellationArt: this.$store.state.stel.constellations.images_visible,
          toggleAtmosphere: this.$store.state.stel.atmosphere.visible,
          toggleLandscape: this.$store.state.stel.landscapes.visible,
          toggleAzimuthalGrid: this.$store.state.stel.lines.azimuthal.visible,
          toggleEquatorialGrid: this.$store.state.stel.lines.equatorial_jnow.visible,
          toggleEquatorialJ2000Grid: this.$store.state.stel.lines.equatorial.visible,
          toggleNightMode: this.$store.state.nightmode,
          currentTime: this.pickerDate,
          location: this.$store.state.currentLocation
        }
      console.log('JSBridge getState returning', data)
      jsbridge.postMessage('getState', data)
    },
    registerBridgeActions () {
      jsbridge.registerActions({
        // 星座线
        toggleConstellationLines: (visible) => {
          this.$stel.core.constellations.lines_visible = visible
          this.$stel.core.constellations.labels_visible = visible
          this.updateState()
        },
        // 星座图
        toggleConstellationArt: (visible) => {
          this.$stel.core.constellations.images_visible = visible
          this.updateState()
        },
        // 大气层
        toggleAtmosphere: (visible) => {
          this.$stel.core.atmosphere.visible = visible
          this.updateState()
        },
        // 地景
        toggleLandscape: (visible) => {
          this.$stel.core.landscapes.visible = visible
          this.updateState()
        },
        // 地平网格
        toggleAzimuthalGrid: (visible) => {
          this.$stel.core.lines.azimuthal.visible = visible
          this.updateState()
        },
        // 赤道网格
        toggleEquatorialGrid: (visible) => {
          this.$stel.core.lines.equatorial_jnow.visible = visible
          this.updateState()
        },
        // 赤道 J2000 网格
        toggleEquatorialJ2000Grid: (visible) => {
          this.$stel.core.lines.equatorial.visible = visible
          this.updateState()
        },
        // 夜间模式
        toggleNightMode: (enabled) => {
          this.setNightMode(enabled)
          this.updateState()
        },
        gotoAndLock: (ss) => {
          let obj = swh.skySource2SweObj(ss)
          if (!obj) {
            obj = this.$stel.createObj(ss.model, ss)
            this.$selectionLayer.add(obj)
            swh.setSweObjAsSelection(obj)
          } else {
            const raDeg = ss.model_data.ra
            const decDeg = ss.model_data.dec

            const raRad = raDeg * Math.PI / 180
            const decRad = decDeg * Math.PI / 180

            const m31Coords = this.$stel.createObj('coordinates', {
              pos: this.$stel.s2c(raRad, decRad)
            })
            swh.setSweObjAsSelection(m31Coords, ss.lock ?? true)
          }
          this.updateState()
        },
        setLocation: (loc) => {
          console.log('JSBridge setLocation:', loc)
          this.setLocation(loc)
          this.updateState()
        },

        /// 陀螺仪
        setOrientation: (data) => {
          const now = Date.now()
          if (now - this.lastUpdate < 16) {
            return
          }
          this.lastUpdate = now
          console.log('JSBridge setOrientation:', data)
          const azimuth = data.azimuth + this.calibrationOffset.azimuth
          const altitude = data.altitude + this.calibrationOffset.altitude
          const observed = this.azAltToObserved(azimuth, altitude)
          this.$stel.lookAt(observed, 0)
          this.updateState()
        },

        // 设置时间
        setDateTime: (isoString) => {
          const m = Moment(isoString)
          m.local()
          m.milliseconds(this.getLocalTime().milliseconds())
          this.$stel.core.observer.utc = m.toDate().getMJD()
          this.updateState()
        },
        zoomIn: (b) => {
          const currentFov = this.$store.state.stel.fov * 180 / Math.PI
          this.$stel.zoomTo(currentFov * b.speed * Math.PI / 180, 0.4)
          this.zoomTimeout = setTimeout(_ => {
            this.zoomIn()
          }, b.timeout)
          this.updateState()
        },
        zoomOut: (b) => {
          const currentFov = this.$store.state.stel.fov * 180 / Math.PI
          this.$stel.zoomTo(currentFov * b.speed * Math.PI / 180, 0.6)
          this.zoomTimeout = setTimeout(_ => {
            this.zoomOut()
          }, b.timeout)
          this.updateState()
        },
        stopZoom: () => {
          if (this.zoomTimeout) {
            clearTimeout(this.zoomTimeout)
            this.zoomTimeout = undefined
          }
          this.updateState()
        },
        // 获取当前状态
        getState: () => {
          this.updateState()
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

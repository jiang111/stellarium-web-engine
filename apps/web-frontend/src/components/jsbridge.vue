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
      },
      linesLayer: null,
      linesObj: null,
      currentRectLayer: null,
      currentRectObj: null,
      targetRectLayer: null,
      targetRectObj: null,
      smoothing: {
        enabled: true,
        factor: 0.3,
        current: { azimuth: 0, altitude: 0 },
        target: { azimuth: 0, altitude: 0 }
      },
      isEnabled: false,
      lastUpdate: 0,
      lastStableAzimuth: 0,
      lastAlt: undefined
    }
  },
  mounted () {
    this.registerBridgeActions()
  },
  watch: {
    '$store.state.arMode': function (newVal) {
      this.updateState()
    }
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
    angleDiff (a, b) {
      let diff = a - b
      while (diff > Math.PI) diff -= 2 * Math.PI
      while (diff < -Math.PI) diff += 2 * Math.PI
      return diff
    },
    lerpAngle (from, to, t) {
      const diff = this.angleDiff(to, from)
      return from + diff * t
    },
    updateState () {
      const data =
        {
          toggleConstellationLines: this.$store.state.stel.constellations.lines_visible,
          toggleConstellationArt: this.$store.state.stel.constellations.images_visible,
          toggleAtmosphere: this.$store.state.stel.atmosphere.visible,
          toggleLandscape: this.$store.state.stel.landscapes.visible,
          toogleMilkyway: this.$store.state.stel.milkyway.visible,
          toggleMeridian: this.$store.state.stel.lines.meridian.visible,
          toggleAzimuthalGrid: this.$store.state.stel.lines.azimuthal.visible,
          toggleEquatorialGrid: this.$store.state.stel.lines.equatorial_jnow.visible,
          toggleEquatorialJ2000Grid: this.$store.state.stel.lines.equatorial.visible,
          toggleNightMode: this.$store.state.nightmode,
          currentTime: this.getLocalTime(),
          location: this.$store.state.currentLocation,
          speedTime: this.$store.state.stel.time_speed,
          fov: this.$store.state.stel.fov * 180 / Math.PI,
          arMode: this.$store.state.arMode,
          enableArMode: this.$store.state.enableARMode
        }
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
        toogleMilkyway: (visible) => {
          this.$stel.core.milkyway.visible = visible
          this.updateState()
        },
        toggleMeridian: (visible) => {
          this.$stel.core.lines.meridian.visible = visible
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
        enableARMode: (enabled) => {
          this.$store.commit('setAppEnableARMode', enabled)
          if (enabled) {
            this.$store.commit('setARMode', false)
          } else {
            this.$store.commit('setARMode', false)
          }
          this.updateState()
        },
        drawRectWithAltAndAz: (ss) => {
          // 清除之前的矩形
          if (this.currentRectLayer && this.currentRectObj) {
            this.currentRectLayer.remove(this.currentRectObj)
            this.currentRectObj = null
          }

          const alt = Number(ss.alt)
          const az = Number(ss.az)
          const fovX = Number(ss.fovX)
          const fovY = Number(ss.fovY)

          if (isNaN(alt) || isNaN(az) || isNaN(fovX) || isNaN(fovY)) {
            console.warn('drawRectWithAltAndAz: Invalid parameters', ss)
            return
          }

          const toRad = Math.PI / 180
          const getRaDec = (azDeg, altDeg) => {
            const azR = azDeg * toRad
            const altR = altDeg * toRad
            const vObs = this.$stel.s2c(azR, altR)
            const vIcrf = this.$stel.convertFrame(this.$stel.core.observer, 'OBSERVED', 'ICRF', vObs)
            const radec = this.$stel.c2s(vIcrf)
            return [radec[0] * 180 / Math.PI, radec[1] * 180 / Math.PI]
          }

          // 计算矩形四个角
          let cosAlt = Math.cos(alt * toRad)
          if (cosAlt < 0.001) cosAlt = 0.001 // 避免接近天顶时宽度过大

          // 方位角半宽需要根据高度角修正
          const dAz = (fovX / 2) / cosAlt
          const dAlt = fovY / 2

          const p1 = getRaDec(az - dAz, alt + dAlt) // 左上
          const p2 = getRaDec(az + dAz, alt + dAlt) // 右上
          const p3 = getRaDec(az + dAz, alt - dAlt) // 右下
          const p4 = getRaDec(az - dAz, alt - dAlt) // 左下

          const features = [{
            type: 'Feature',
            properties: {
              stroke: '#F48123',
              'stroke-width': 2,
              'fill-opacity': 0
            },
            geometry: {
              type: 'LineString',
              coordinates: [p1, p2, p3, p4, p1]
            }
          }]

          const geojsonData = {
            type: 'FeatureCollection',
            features: features
          }

          // 获取或创建 layer
          let layer = this.currentRectLayer
          if (!layer) {
            // 尝试获取现有 layer，如果之前的状态没有保存的话
            layer = this.$stel.getObj('jsbridge-rects')
            if (!layer) {
              layer = this.$stel.createLayer({
                id: 'jsbridge-rects',
                z: 40,
                visible: true
              })
            }
            this.currentRectLayer = layer
          }
          layer.visible = true

          const rectObj = this.$stel.createObj('geojson', {
            data: geojsonData
          })

          layer.add(rectObj)
          this.currentRectObj = rectObj
        },
        getCenterRaDecValue: () => {
          const yaw = this.$stel.core.observer.yaw
          const pitch = this.$stel.core.observer.pitch
          const vObs = this.$stel.s2c(-yaw, pitch)
          const vIcrf = this.$stel.convertFrame(this.$stel.core.observer, 'OBSERVED', 'ICRF', vObs)
          const radec = this.$stel.c2s(vIcrf)
          const result = {
            ra: radec[0] * 180 / Math.PI,
            dec: radec[1] * 180 / Math.PI
          }
          console.log('getCenterRaDecValue result:', result)
          return result
        },
        gotoByAltAndAzWithArMode: (ss) => {
          if (!this.$store.state.appEnableARMode) {
            return
          }
          const currentAlt = ss.alt
          if (!this.$store.state.arMode) {
            if (this.lastAlt !== undefined) {
              const diff = Math.abs(currentAlt - this.lastAlt)
              // 当高度变化超过 2 度时，认为用户在上下晃动手机，重新开启 AR 模式
              if (diff > 2) {
                this.$store.commit('setARMode', true)
              }
            }
            this.lastAlt = currentAlt
            return
          }
          this.lastAlt = currentAlt
          this.$stel.core.observer.yaw = -1 * ss.az * 0.017453292519943295
          this.$stel.core.observer.pitch = ss.alt * 0.017453292519943295
        },
        gotoByAltAndAz: (ss) => {
          this.$stel.core.observer.yaw = -1 * ss.az * 0.017453292519943295
          this.$stel.core.observer.pitch = ss.alt * 0.017453292519943295
        },
        gotoAndLock: (ss) => {
          // console.log('JSBridge gotoAndLock:', ss)
          if (ss.model === 'custom') {
            const raDeg = ss.model_data.ra
            const decDeg = ss.model_data.dec

            const raRad = raDeg * Math.PI / 180
            const decRad = decDeg * Math.PI / 180

            const m31Coords = this.$stel.createObj('coordinates', {
              pos: this.$stel.s2c(raRad, decRad)
            })
            swh.setSweObjAsSelection(m31Coords, ss.lock ?? true)
          } else {
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
          }
          this.updateState()
        },
        lockToSelection: () => {
          if (this.$stel.core.selection) {
            this.$stel.pointAndLock(this.$stel.core.selection, 0.5)
          }
        },
        unselect: () => {
          this.$stel.core.selection = 0
        },
        updateFov: (fovDeg) => {
          if (fovDeg < 0.01) fovDeg = 0.01
          if (fovDeg > 185) fovDeg = 185


          this.$stel.zoomTo(fovDeg * Math.PI / 180, 0.5)
          this.updateState()
        },
        setLocation: (loc) => {
          console.log('JSBridge setLocation:', loc)
          this.setLocation(loc)
          this.updateState()
        },
        setDateTime:
          (million) => {
            const isoString = new Date(million).toISOString()
            const m = Moment(isoString)
            m.local()
            this.$stel.core.observer.utc = m.toDate().getMJD()
            this.updateState()
          },
        speedTime:
          (speed) => {
            this.$stel.core.time_speed = speed
            this.updateState()
          },
        zoomIn:
          (b) => {
            const currentFov = this.$store.state.stel.fov * 180 / Math.PI
            this.$stel.zoomTo(currentFov * b.speed * Math.PI / 180, 0.4)
            this.zoomTimeout = setTimeout(_ => {
              this.zoomIn()
            }, b.timeout)
            this.updateState()
          },
        zoomOut:
          (b) => {
            const currentFov = this.$store.state.stel.fov * 180 / Math.PI
            this.$stel.zoomTo(currentFov * b.speed * Math.PI / 180, 0.6)
            this.zoomTimeout = setTimeout(_ => {
              this.zoomOut()
            }, b.timeout)
            this.updateState()
          },
        stopZoom:
          () => {
            if (this.zoomTimeout) {
              clearTimeout(this.zoomTimeout)
              this.zoomTimeout = undefined
            }
            this.updateState()
          },
        // 获取当前状态
        getState:
          () => {
            this.updateState()
          },
        drawLines: (data) => {
          this.clearLines()
          const {
            points: pointsList = [],
            color = '#FF0000',
            width = 2
          } = data

          if (!pointsList || pointsList.length < 2) {
            console.warn('drawLines: Need at least 2 points')
            return
          }

          // 1. 转换坐标并生成虚线段 (Manual Dashing)
          const features = []
          const toRad = Math.PI / 180
          const dashSizeDeg = 0.5 // 虚线实线部分长度 (度)
          const gapSizeDeg = 1.0 // 虚线间隔部分长度 (度)
          const dashRad = dashSizeDeg * toRad
          const gapRad = gapSizeDeg * toRad

          // Helper: Spherical Linear Interpolation
          const slerp = (v1, v2, t) => {
            const omega = Math.acos(Math.min(1, Math.max(-1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2])))
            if (Math.abs(omega) < 1e-6) return v1
            const sinOmega = Math.sin(omega)
            const k1 = Math.sin((1 - t) * omega) / sinOmega
            const k2 = Math.sin(t * omega) / sinOmega
            return [
              k1 * v1[0] + k2 * v2[0],
              k1 * v1[1] + k2 * v2[1],
              k1 * v1[2] + k2 * v2[2]
            ]
          }

          const getVecIcrf = (pt) => {
            const azR = pt.az * toRad
            const altR = pt.alt * toRad
            const vObs = this.$stel.s2c(azR, altR)
            return this.$stel.convertFrame(this.$stel.core.observer, 'OBSERVED', 'ICRF', vObs)
          }

          const vecToRaDecDeg = (v) => {
            const radec = this.$stel.c2s(v)
            return [radec[0] * 180 / Math.PI, radec[1] * 180 / Math.PI]
          }

          for (let i = 0; i < pointsList.length - 1; i++) {
            const pt1 = pointsList[i]
            const pt2 = pointsList[i + 1]

            const v1 = getVecIcrf(pt1)
            const v2 = getVecIcrf(pt2)

            const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]
            const totalAngle = Math.acos(Math.min(1, Math.max(-1, dot)))

            let currentAngle = 0
            while (currentAngle < totalAngle) {
              const startT = currentAngle / totalAngle
              const endT = Math.min((currentAngle + dashRad) / totalAngle, 1)

              const pStart = slerp(v1, v2, startT)
              const pEnd = slerp(v1, v2, endT)

              // Create a LineString feature for each dash
              features.push({
                type: 'Feature',
                properties: {
                  stroke: color,
                  'stroke-width': width
                },
                geometry: {
                  type: 'LineString',
                  coordinates: [vecToRaDecDeg(pStart), vecToRaDecDeg(pEnd)]
                }
              })

              currentAngle += dashRad + gapRad
            }
          }

          const geojsonData = {
            type: 'FeatureCollection',
            features: features
          }

          // 先清除旧的 geojson 对象（如果存在）
          this.clearLines()

          // 获取或创建 layer
          let layer = this.$stel.getObj('jsbridge-lines')
          if (!layer) {
            layer = this.$stel.createLayer({
              id: 'jsbridge-lines',
              z: 40,
              visible: true
            })
          }
          layer.visible = true

          const lineObj = this.$stel.createObj('geojson', {
            data: geojsonData
          })

          layer.add(lineObj)
          this.linesLayer = layer
          this.linesObj = lineObj // 保存 geojson 对象引用
        },
        clearLines: () => {
          this.clearLines()
        }
      })
    },
    clearLines: function () {
      if (this.linesLayer && this.linesObj) {
        this.linesLayer.remove(this.linesObj)
        this.linesLayer.visible = false
        this.linesObj = null
      }
    },
    getLocalTime: function () {
      var d = new Date()
      d.setMJD(this.$store.state.stel.observer.utc)
      const m = Moment(d)
      // 转换成毫秒值
      return m.utc().toDate().getTime()
    },
    setLocation: function (loc) {
      // 确保 loc 包含必要字段
      const location = {
        short_name: loc.short_name || 'Unknown',
        country: loc.country || 'Unknown',
        street_address: loc.street_address || '',
        lat: Number(loc.lat),
        lng: Number(loc.lng),
        alt: Number(loc.alt) || 0,
        accuracy: Number(loc.accuracy) || 1
      }
      this.$store.commit('setCurrentLocation', location)
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

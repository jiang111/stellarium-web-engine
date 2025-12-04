<template>
  <div style="display: none"></div>
</template>
<script>
import jsbridge from '@/utils/jsbridge'

export default {
  components: {},
  data: function () {
    return {
      updateTimer: undefined
    }
  },
  mounted () {
    // 注册所有可供 App 调用的功能
    this.registerBridgeActions()
  },
  beforeDestroy () {
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = undefined
    }
  },
  computed: {
    selectedObject: function () {
      return this.$store.state.selectedObject
    },
    showPointToButton: function () {
      if (!this.$store.state.stel.lock) return true
      if (this.$store.state.stel.lock !== this.$store.state.stel.selection) return true
      return false
    }
  },
  watch: {
    selectedObject: function (newObject) {
      console.log('selectedObjectChanged resource:', JSON.stringify(newObject))

      // 停止之前的定时器
      if (this.updateTimer) {
        clearInterval(this.updateTimer)
        this.updateTimer = undefined
      }

      if (newObject) {
        // 立即发送一次数据
        this.sendSelectedObjectData()
        // 启动定时器，每秒更新一次位置信息（ra/dec 和 az/alt 会随时间变化）
        this.updateTimer = setInterval(() => {
          this.sendSelectedObjectData()
        }, 1000)
      } else {
        jsbridge.postMessage('selectedObjectChanged', null)
        console.log('selectedObjectChanged', null)
      }
    },
    showPointToButton: function (show) {
      // 居中按钮是否显示,如果当前选中的天体没有居中，那就会要求显示这个按钮
      jsbridge.postMessage('showPointToButtonChanged', show)
    }
  },
  methods: {
    // 发送选中天体数据给 App
    sendSelectedObjectData () {
      const newObject = this.selectedObject
      if (!newObject) return
      const that = this
      const obj = this.$stel.core.selection
      const result = {
        name: newObject.names || [],
        culturalNames: newObject.culturalNames || [],
        model: newObject.model || '',
        types: newObject.types || [],
        model_data: newObject.model_data || {}
      }
      const formatInt = function (num, padLen) {
        const pad = new Array(1 + padLen).join('0')
        return (pad + num).slice(-pad.length)
      }
      const formatRA = function (a) {
        const raf = that.$stel.a2tf(a, 1)
        const hour = raf.hours
        const minute = raf.minutes * 100 / 60
        const second = raf.seconds * 100 / 3600
        return hour + minute / 100 + second / 10000
      }
      const formatDec = function (a) {
        const raf = that.$stel.a2af(a, 1)
        var result = raf.sign + formatInt(raf.degrees, 2) + '.' + formatInt(raf.arcminutes, 2) + formatInt(raf.arcseconds, 2)
        return parseFloat(result)
      }
      const formatAz = function (a) {
        const raf = that.$stel.a2af(a, 1)
        var result = formatInt(raf.degrees < 0 ? raf.degrees + 360 : raf.degrees, 3) + '.' + formatInt(raf.arcminutes, 2) + formatInt(raf.arcseconds, 2)
        return parseFloat(result)
      }
      // 获取 Ra/Dec (赤经赤纬)
      if (obj) {
        const radecCIRS = this.$stel.c2s(obj.getInfo('radec'))
        const raCIRS = this.$stel.anp(radecCIRS[0])
        const decCIRS = this.$stel.anpm(radecCIRS[1])
        result.ra = formatRA(raCIRS)
        result.dec = formatDec(decCIRS)

        // 获取 Az/Alt (方位角/高度角)
        const azalt = this.$stel.c2s(this.$stel.convertFrame(this.$stel.core.observer, 'ICRF', 'OBSERVED', obj.getInfo('radec')))
        result.az = formatAz(this.$stel.anp(azalt[0]))
        result.alt = formatDec(this.$stel.anpm(azalt[1]))

        // 获取 Magnitude (星等)
        const vmag = obj.getInfo('vmag')
        if (vmag && !isNaN(vmag)) {
          result.vmag = vmag
          result.magnitude = vmag
        }

        // 获取距离
        const distance = obj.getInfo('distance')
        if (distance && !isNaN(distance)) {
          result.distance = distance // 单位：AU
        }

        // 获取相位
        const phase = obj.getInfo('phase')
        if (phase && !isNaN(phase)) {
          result.phase = phase
        }

        // 获取 Visibility (可见性)
        const vis = obj.computeVisibility()
        if (vis && vis.length > 0) {
          if (vis[0].rise === null) {
            result.visibility = 'always_visible'
            result.visibilityInfo = {
              status: 'always_visible',
              rise: null,
              set: null
            }
          } else {
            // 将 MJD 转换为 11 位时间戳（毫秒）
            const riseDate = new Date()
            riseDate.setMJD(vis[0].rise)
            const setDate = new Date()
            setDate.setMJD(vis[0].set)

            result.visibility = 'visible'
            result.visibilityInfo = {
              status: 'visible',
              rise: riseDate.getTime(), // 11位时间戳（毫秒）
              set: setDate.getTime() // 11位时间戳（毫秒）
            }
          }
        } else {
          result.visibility = 'not_visible'
          result.visibilityInfo = {
            status: 'not_visible',
            rise: null,
            set: null
          }
        }
      }

      jsbridge.postMessage('selectedObjectChanged', result)
      console.log('selectedObjectChanged', JSON.stringify(result))
    },
    // 注册 JSBridge 动作
    registerBridgeActions () {
      jsbridge.registerActions({
        // 强制当前选中的天体居中
        lockToSelection: function () {
          if (this.$stel.core.selection) {
            this.$stel.pointAndLock(this.$stel.core.selection, 0.5)
          }
        },
        unselect: function () {
          this.$stel.core.selection = 0
        }
      })
    }
  }
}
</script>

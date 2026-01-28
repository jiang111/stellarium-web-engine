<template>
  <div class="jsbridge-overlay"
       style="overflow: hidden; position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; display: flex; align-items: center; justify-content: center;">
    <div v-if="showCenterFov" :style="fovBoxStyle"></div>
  </div>
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
      smoothing: {
        enabled: true,
        factor: 0.3,
        current: { azimuth: 0, altitude: 0 },
        target: { azimuth: 0, altitude: 0 }
      },
      isEnabled: false,
      lastUpdate: 0,
      lastStableAzimuth: 0,
      lastAlt: undefined,
      showCenterFov: true,
      targetFovX: 10,
      targetFovY: 5,
      fovBoxStyle: {
        width: '0px',
        height: '0px',
        background: 'rgba(244, 129, 35, 0.1)',
        border: '1px solid rgba(244, 129, 35, 0.7)',
        transform: 'rotate(0deg)'
      },
      manualCenterRotation: null,
      fovAnimationId: null
    }
  },
  mounted () {
    this.registerBridgeActions()
    this.startFovAnimation()
  },
  beforeDestroy () {
    this.stopFovAnimation()
  },
  watch: {
    '$store.state.arMode': function (newVal) {
      this.updateState()
    },
    '$store.state.stel.fov': function () {
      this.updateFovBox()
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
    getFovY () {
      return this.$store.state.stel.fov * 180 / Math.PI
    },
    getFovX () {
      const fovYRad = this.$store.state.stel.fov
      if (this.$stel && this.$stel.canvas) {
        const ratio = this.$stel.canvas.width / this.$stel.canvas.height
        const fovXRad = 2 * Math.atan(Math.tan(fovYRad / 2) * ratio)
        return fovXRad * 180 / Math.PI
      }
      return fovYRad * 180 / Math.PI
    },
    // 在屏幕中心点绘制一个矩形 fov (DOM overlay with real-time rotation)
    updateFovBox () {
      if (!this.showCenterFov || !this.$stel || !this.$stel.canvas) return

      // Use buffer dimensions for precise aspect ratio
      const canvasWidth = this.$stel.canvas.width
      const canvasHeight = this.$stel.canvas.height
      const aspect = canvasWidth / canvasHeight

      // Use client dimensions for CSS pixel scaling (handles DPR)
      const clientHeight = this.$stel.canvas.clientHeight

      const targetFovXRad = (this.targetFovX || 10) * Math.PI / 180
      const targetFovYRad = (this.targetFovY || 5) * Math.PI / 180

      const fovYRad = this.$store.state.stel.fov
      let currentFovYRad = fovYRad

      // Handle aspect ratio effect on FOV definition in Stellarium
      if (aspect < 1) {
        currentFovYRad = 4 * Math.atan(Math.tan(fovYRad / 4) / aspect)
      }

      // Combined stereographic + perspective formula
      // Note: use clientHeight (CSS px) instead of canvasHeight (physical px) to fix 3x size issue
      const widthPx = clientHeight * Math.tan(targetFovXRad / 4) / Math.tan(currentFovYRad / 4)
      const heightPx = clientHeight * Math.tan(targetFovYRad / 4) / Math.tan(currentFovYRad / 4)

      // Calculate rotation to align with Alt-Az Up (Zenith)
      let angleDeg = 0
      if (this.manualCenterRotation !== null && this.manualCenterRotation !== undefined) {
        // If manual rotation is provided (Indigo PA), use it directly.
        // PA=0 means North-Up.
        // Our FOV Box: Width (X) is initially horizontal. Height (Y) is vertical.
        // CSS Rotation 0deg: X points Right, Y points Down.
        // We want Top (-Y) to point North when PA=0.
        // If PA=0: Top(-Y) -> North. Right(X) -> East.
        // Standard CSS 0deg: Top is Up (Screen Up).
        // Wait, calculateFovRotation returns CSS rotation angle to align Top to North.
        // If we have a PA, we want Top to point PA degrees E of N?
        // No, PA describes the camera rotation.
        // If PA=0: Top points North.
        // If PA=90: Top points East.
        // calculateFovRotation calculates angle "a" such that rotating by "a" aligns Top to North.
        // If we want Top to be at PA (relative to North), we need to rotate by (AngleToNorth + PA)?
        // BUT, the request says "If I give you an angle... draw it".
        // If using `drawRectWithAltAndAz` logic (vector basis), rotation is handled in 3D.
        // Here in `updateFovBox`, we are in 2D screen space + CSS rotation.
        // We first align Top to North, THEN apply PA rotation?
        // Yes: calculateFovRotation gets us to "Top = North".
        // Then we add manualCenterRotation (PA).
        // Let's verify direction: PA is E of N (CCW on sky? No, PA is usually East of North).
        // On screen (looking at sky), East is Left?
        // Stellarium: East is Left. West is Right.
        // PA definition: "Angle ... E of N".
        // 0 = N, 90 = E.
        // In screen space (Y down):
        // North is some direction. East is -90 deg from North?
        // Let's look at `calculateFovRotation`:
        // "Box X-axis (Width) is 90 degrees clockwise from Top (-Y)"
        // "We want Top (-Y) to point towards North"
        // It returns (angleRad * 180 / Math.PI) + 90.
        // This suggests it aligns X-axis to East (if N is Up).
        // If we add PA:
        // If PA=90 (East), Top should point East.
        // Original aligns Top to North.
        // To make Top point East, we rotate -90 degrees? (Since East is Left/CCW?)
        // Or +90?
        // PA: N -> E -> S -> W.
        // On Sky Map (inside sphere): N is Up. E is Left.
        // So PA=90 means pointing Left.
        // CSS Rotation: +Degrees is CW.
        // So to point Left (East), we need -90 deg relative to North?
        // Let's assume standard PA usage:
        // We take the "North Aligned" angle, and subtract PA?
        // Or add?
        // Let's try subtracting PA (since +PA is East/Left, and +CSS is CW/Right).
        const angleToNorth = this.calculateFovRotation()
        // angleToNorth makes Top point North.
        // If PA=90, we want Top to point East (Left).
        // CSS rotation to left is -90.
        // So angle = angleToNorth - PA.
        angleDeg = angleToNorth - this.manualCenterRotation
      } else {
        angleDeg = this.calculateFovRotation()
      }

      this.fovBoxStyle = {
        width: widthPx + 'px',
        height: heightPx + 'px',
        background: 'rgba(244, 129, 35, 0.1)',
        border: '1px solid rgba(244, 129, 35, 0.7)',
        transform: `rotate(${angleDeg}deg)`
      }
    },
    // Calculate the rotation angle to align FOV box's long edge towards celestial north pole
    calculateFovRotation () {
      if (!this.$stel || !this.$stel.core) return 0

      const obs = this.$stel.core.observer

      // 1. Get screen center in ICRF coordinates
      const vCenterView = [0, 0, -1] // VIEW frame center direction
      const vCenterIcrf = this.$stel.convertFrame(obs, 'VIEW', 'ICRF', vCenterView)

      // 2. Calculate current center's RA/Dec
      const radec = this.$stel.c2s(vCenterIcrf)
      const ra = radec[0]
      const dec = radec[1]

      // 3. Create a point slightly north (higher dec) along the same RA
      const decOffset = 0.01 // Small offset in radians (~0.5 degrees)
      const northPointIcrf = this.$stel.s2c(ra, dec + decOffset)

      // 4. Convert both points to VIEW frame
      const centerView = this.$stel.convertFrame(obs, 'ICRF', 'VIEW', vCenterIcrf)
      const northView = this.$stel.convertFrame(obs, 'ICRF', 'VIEW', northPointIcrf)

      // 5. Calculate direction vector in VIEW frame
      const dx = northView[0] - centerView[0]
      const dy = northView[1] - centerView[1]

      // 6. Convert to screen coordinates (Y is flipped in screen space)
      const screenDx = dx
      const screenDy = -dy

      // 7. Calculate angle to align Top of FOV box towards north
      // Default: Width (fovX) is X-axis, Height (fovY) is Y-axis (down)
      // Top of box is -Y axis (up relative to box)
      // We want Top (-Y) to point towards North
      // Box X-axis (Width) is 90 degrees clockwise from Top (-Y)
      // So if North is at angle 'a', we want X-axis at 'a + 90'
      const angleRad = Math.atan2(screenDy, screenDx)
      return (angleRad * 180 / Math.PI) + 90
    },
    // Start real-time animation loop for FOV box rotation
    startFovAnimation () {
      const animate = () => {
        if (this.showCenterFov) {
          this.updateFovBox()
        }
        this.fovAnimationId = requestAnimationFrame(animate)
      }
      this.fovAnimationId = requestAnimationFrame(animate)
    },
    // Stop animation loop
    stopFovAnimation () {
      if (this.fovAnimationId) {
        cancelAnimationFrame(this.fovAnimationId)
        this.fovAnimationId = null
      }
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
          toggleEcliptic: this.$store.state.stel.lines.ecliptic.visible,
          toggleAzimuthalGrid: this.$store.state.stel.lines.azimuthal.visible,
          toggleEquatorialGrid: this.$store.state.stel.lines.equatorial_jnow.visible,
          toggleEquatorialJ2000Grid: this.$store.state.stel.lines.equatorial.visible,
          toggleNightMode: this.$store.state.nightmode,
          currentTime: this.getLocalTime(),
          location: this.$store.state.currentLocation,
          speedTime: this.$store.state.stel.time_speed,
          fov: this.$store.state.stel.fov * 180 / Math.PI,
          fovX: this.$stel.core.fovX * 180 / Math.PI,
          fovY: this.$stel.core.fovY * 180 / Math.PI,
          arMode: this.$store.state.arMode,
          enableArMode: this.$store.state.appEnableARMode,
          currentLocation: this.getCenterRaDecValue(),
          direction: ((this.$stel.core.observer.yaw * 180 / Math.PI) % 360 + 360) % 360,
          drawSelectedTargetLine: this.linesObj != null
        }
      this.updateFovBox()
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
        toggleEcliptic: (visible) => {
          this.$stel.core.lines.ecliptic.visible = visible
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
          this.updateState()
        },
        // 配置中心视场框的显示与否，以及大小
        toggleCenterFov: (data) => {
          if (typeof data === 'boolean') {
            this.showCenterFov = data
          } else if (typeof data === 'object') {
            this.showCenterFov = true
            if (data.fovX !== undefined) {
              this.targetFovX = Number(data.fovX)
            }
            if (data.fovY !== undefined) {
              this.targetFovY = Number(data.fovY)
            }
            if (data.rotation !== undefined) {
              this.manualCenterRotation = data.rotation
            }
          }

          if (this.showCenterFov) {
            this.updateFovBox()
          }
        },
        /// 根据 app 的赤道仪的位置，实时绘制一个矩形，表示当前相机的视场范围
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
          const rotation = ss.rotation !== undefined ? Number(ss.rotation) : (ss.angle !== undefined ? Number(ss.angle) : null)

          if (isNaN(alt) || isNaN(az) || isNaN(fovX) || isNaN(fovY)) {
            return
          }

          const toRad = Math.PI / 180

          // Vector helpers
          const normalize = (v) => {
            const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
            return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0]
          }
          const cross = (a, b) => [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
          ]
          const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
          const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s]

          // 1. Calculate Center Vector (View Direction) in Observed Frame
          const azR = az * toRad
          const altR = alt * toRad
          // s2c returns direction vector from spherical coords.
          // Note: Stellarium az usually needs negation for standard math or check s2c impl.
          // Based on gotoByAltAndAz: yaw = -az, pitch = alt.
          // Let's rely on s2c to handle the frame correctly if we pass consistent args.
          const vF = this.$stel.s2c(azR, altR)

          // 2. Define Local Tangent Plane Basis
          // We want fovX (width, along vR) to be perpendicular to the direction of standard North (ra=0, dec=90)
          // Use JNOW frame to account for precession (current date North Pole)

          // Get Celestial North Pole (ra=0, dec=90) in JNOW [0, 0, 1]
          // Convert to OBSERVED frame
          const vNorthJnow = [0, 0, 1]
          const vNorthObs = this.$stel.convertFrame(this.$stel.core.observer, 'JNOW', 'OBSERVED', vNorthJnow)

          // Calculate Right vector (vR)
          // vR = vNorthObs x vF (This points "East" relative to the North Pole direction)
          let vR = cross(vNorthObs, vF)

          // Handle singularity if looking directly at North Pole or South Pole
          if (vR[0] * vR[0] + vR[1] * vR[1] + vR[2] * vR[2] < 1e-6) {
            const vZ = [0, 0, 1]
            vR = cross(vZ, vF)
            if (vR[0] * vR[0] + vR[1] * vR[1] + vR[2] * vR[2] < 1e-6) {
              vR = [1, 0, 0]
            }
          }

          vR = normalize(vR)
          vR = normalize(vR)
          // Up vector (vU) completes the orthonormal basis
          let vU = normalize(cross(vR, vF))

          // Apply Rotation if provided (PA: E of N)
          if (rotation !== null && !isNaN(rotation)) {
            // Rotation logic:
            // vR points East (relative to North)
            // vU points North
            // PA = 0 -> Top(vU) points North.
            // PA = 90 -> Top(vU) points East(vR).
            // On the sky (looking from center), East is "Left" if North is "Up"?
            // Wait, standard vectors:
            // vNorthObs points to Celestial North.
            // vR = vNorthObs x vF. (North x View).
            // If View is "Out of screen", North is Up.
            // Up x Out = Right. So vR points "West"?
            // Let's check: Right hand rule.
            // North(Index) x View(Middle) -> Right(Thumb).
            // If looking at sky: North is Up. View is towards sky.
            // N x V -> West (Right side of screen).
            // So vR points West.
            // vU = vR x vF = West x View = Down (South).
            // Wait, let's re-verify `vR = cross(vNorthObs, vF)`
            // Usually East vector is `vNorth x vZenith` (for Az). Here we use `vCurrentView`.
            // `vNorth` (Up) x `vView` (Forward).
            // If we look at North Horizon. N=[1,0,0]? No, let's assume standard frame.
            // If vR points West.
            // Then vU = vR x vF = West x View = Down?
            // If we want vU to point North.
            // vU_north = vF x vR = View x West = Up (North).
            // Let's check original code:
            // `const vU = normalize(cross(vR, vF))`
            // If vR is West, vR x vF -> South (Down).
            // If vR is East (let's say we defined it that way?), then East x View -> North (Up).
            // Is `vNorthObs x vF` East or West?
            // N x V.
            // If N is Up, V is In(Forward). N x V = Left (East).
            // If N is Up, V is Out(Backward?).
            // Let's assume standard Right Handed system.
            // If vR points East.
            // vU = vR x vF = East x View -> North.
            // So vU aligns with North. vR aligns with East.

            // We want Rotation Angle (PA) = 0 => Top points North.
            // Top of Rect is defined by `c1` etc?
            // `c1 ... add(scale(vU, tanY))` -> vU component is positive Y in rect space.
            // So "Up" in rect space corresponds to vU direction.
            // So if PA=0, vU should point North. The current basis (vR, vU) does this (assuming vR=East, vU=North).

            // PA = 90 => Top points East.
            // We need vU_new to point East (which is vR).
            // So we rotate basis vectors.
            // vU_new = vU * cos(90) + vR * sin(90) = vR. (Correct)
            // vR_new = vR * cos(90) - vU * sin(90) = -vU (South? or West?)
            // Vector rotation in plane defined by vR, vU.
            // Rotated basis:
            // vU' = vU cos(a) + vR sin(a)
            // vR' = vR cos(a) - vU sin(a)
            // (Standard rotation of axes or vector? We rotate the vector vU towards vR).
            // PA measures N -> E.
            // vU is N. vR is E.
            // So rotating N towards E is +angle.
            // Yes.

            // const theta = -(rotation * toRad) // Wait, why negative?
            // If we rotate vU towards vR (N to E) by rotation angle.
            // vU_new = vU cos(r) + vR sin(r).
            // Let's use `theta = rotation * toRad`.
            // vU_new = vU cos - vR sin ??
            // Let's test:
            // r=90. vU_new = vR.
            // vR_new = -vU.
            // In rect:
            // p = vF + vR_new * x + vU_new * y.
            // Top (y>0): moves along vU_new (East).
            // Right (x>0): moves along vR_new (South).
            // So Top points East. Right points South.
            // This corresponds to 90 deg rotation.
            // So theta = rotation * toRad.

            const rRad = rotation * toRad
            const cosA = Math.cos(rRad)
            const sinA = Math.sin(rRad)

            // Create new basis
            // Note: pure vector addition
            const vRNew = [
              vR[0] * cosA - vU[0] * sinA,
              vR[1] * cosA - vU[1] * sinA,
              vR[2] * cosA - vU[2] * sinA
            ]
            const vUNew = [
              vU[0] * cosA + vR[0] * sinA,
              vU[1] * cosA + vR[1] * sinA,
              vU[2] * cosA + vR[2] * sinA
            ]
            vR = vRNew
            vU = vUNew
          }

          // 3. Calculate 4 corners on Tangent Plane (Camera FOV)
          // Gnomonic projection: distance = tan(angle)
          const tanX = Math.tan((fovX / 2) * toRad)
          const tanY = Math.tan((fovY / 2) * toRad)

          // Corners relative to vF
          // p = vF + vR*tx + vU*ty
          const c1 = normalize(add(vF, add(scale(vR, -tanX), scale(vU, tanY)))) // Top-Left
          const c2 = normalize(add(vF, add(scale(vR, tanX), scale(vU, tanY)))) // Top-Right
          const c3 = normalize(add(vF, add(scale(vR, tanX), scale(vU, -tanY)))) // Bottom-Right
          const c4 = normalize(add(vF, add(scale(vR, -tanX), scale(vU, -tanY))))// Bottom-Left

          // 4. Convert to ICRF (Ra/Dec)
          const vecToRaDec = (vObs) => {
            const vIcrf = this.$stel.convertFrame(this.$stel.core.observer, 'OBSERVED', 'ICRF', vObs)
            const radec = this.$stel.c2s(vIcrf)
            return [radec[0] / toRad, radec[1] / toRad]
          }

          const p1 = vecToRaDec(c1)
          const p2 = vecToRaDec(c2)
          const p3 = vecToRaDec(c3)
          const p4 = vecToRaDec(c4)

          const features = [{
            type: 'Feature',
            properties: {
              stroke: '#3C83FF',
              'stroke-width': 2,
              'fill-opacity': 0.1,
              fill: '#3C83FF'
            },
            geometry: {
              type: 'Polygon',
              coordinates: [[p1, p4, p3, p2, p1]]
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
        // 仅用于配置星图的 armode,和 app 本身的 armode 没关系
        updateArMode: (v) => {
          this.$store.commit('setARMode', v)
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
          this.$stel.core.selection = null
          this.lastAlt = undefined
        },
        // updateFov 支持两种调用方式：
        // 1. updateFov(fovDeg) - 传入单个 fovY 度数
        // 2. updateFov({fovX, fovY}) - 传入包含 fovX 和 fovY 的对象
        // 使用 fovY 作为垂直视场角，与 drawRectWithAltAndAz 保持一致
        updateFov: (data) => {
          let fovYDeg

          if (typeof data === 'object' && data !== null) {
            // 处理 {fovX, fovY} 对象参数，直接使用 fovY
            fovYDeg = Number(data.fovY * 2)

            if (isNaN(fovYDeg)) {
              return
            }
          } else {
            // 处理单个数值参数（传统方式，fovY）
            fovYDeg = Number(data)
          }

          // 限制范围
          if (fovYDeg < 0.01) fovYDeg = 0.01
          if (fovYDeg > 180) fovYDeg = 180

          this.$stel.zoomTo(fovYDeg * Math.PI / 180, 0.5)
          this.updateState()
        },
        setLocation: (loc) => {
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
            return
          }

          // 1. 转换坐标并生成虚线段 (Manual Dashing)
          const features = []
          const toRad = Math.PI / 180
          const dashSizeDeg = 0.2 // 虚线实线部分长度 (度)
          const gapSizeDeg = 0.2 // 虚线间隔部分长度 (度)
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
    // 获取中心点的坐标（alt/az 地平坐标 + ra/dec 赤道坐标）
    getCenterRaDecValue: function () {
      const that = this

      const formatInt = function (num, padLen) {
        const pad = new Array(1 + padLen).join('0')
        return (pad + num).slice(-pad.length)
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
      const formatRA = function (a) {
        const raf = that.$stel.a2tf(a, 1)
        const hour = raf.hours
        const minute = raf.minutes * 100 / 60
        const second = raf.seconds * 100 / 3600
        return hour + minute / 100 + second / 10000
      }

      let vIcrf
      // 如果有选中的天体（锁定状态），直接使用天体的 ICRF 坐标以避免转换误差
      if (this.$stel.core.selection) {
        const obj = this.$stel.core.selection
        vIcrf = obj.getInfo('radec')
      } else {
        // 没有锁定时，使用 VIEW frame 的中心 (0,0,-1) 转换获取
        const vView = [0, 0, -1] // VIEW frame 中心方向
        const vObs = this.$stel.convertFrame(this.$stel.core.observer, 'VIEW', 'OBSERVED', vView)
        vIcrf = this.$stel.convertFrame(this.$stel.core.observer, 'OBSERVED', 'ICRF', vObs)
      }

      // 计算 Alt/Az（从 ICRF 转换到 OBSERVED）
      const vObs = this.$stel.convertFrame(this.$stel.core.observer, 'ICRF', 'OBSERVED', vIcrf)
      const azalt = this.$stel.c2s(vObs)

      // 计算 J2000 (ICRF)
      const radecIcrf = this.$stel.c2s(vIcrf)
      const raIcrf = this.$stel.anp(radecIcrf[0])
      const decIcrf = this.$stel.anpm(radecIcrf[1])

      // 计算 JNow
      const vJnow = this.$stel.convertFrame(this.$stel.core.observer, 'ICRF', 'JNOW', vIcrf)
      const radecJnow = this.$stel.c2s(vJnow)
      const raJnow = this.$stel.anp(radecJnow[0])
      const decJnow = this.$stel.anpm(radecJnow[1])

      const result = {
        az: formatAz(this.$stel.anp(azalt[0])),
        alt: formatDec(this.$stel.anpm(azalt[1])),
        ra: formatRA(raJnow),
        dec: formatDec(decJnow),
        ra_j2000: formatRA(raIcrf),
        dec_j2000: formatDec(decIcrf)
      }
      return result
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

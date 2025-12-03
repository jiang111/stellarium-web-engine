// Vec3.js - 修正版三维向量类
class Vec3 {
  constructor (x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }

  /**
   * 从天球坐标创建向量（J2000坐标系）
   * @param {number} ra - 赤经，可以是小时(0-24)或度数(0-360)
   * @param {number} dec - 赤纬（度）-90到+90
   * @param {number} distance - 距离（任意单位）
   * @param {string} raUnit - 'hours' 或 'degrees'，默认 'degrees'
   * @returns {Vec3}
   */
  static fromSpherical (ra, dec, distance = 1, raUnit = 'degrees') {
    // 如果RA是小时制，转换为度数
    const raDegrees = raUnit === 'hours' ? ra * 15 : ra

    // 转换为弧度
    const raRad = raDegrees * Math.PI / 180
    const decRad = dec * Math.PI / 180

    // J2000 笛卡尔坐标系：
    // X轴指向春分点（赤经=0, 赤纬=0）
    // Y轴在赤道平面内，指向赤经=90度
    // Z轴指向北天极（赤纬=+90度）
    const x = distance * Math.cos(decRad) * Math.cos(raRad)
    const y = distance * Math.cos(decRad) * Math.sin(raRad)
    const z = distance * Math.sin(decRad)

    return new Vec3(x, y, z)
  }

  /**
   * 转换为球面坐标
   * @param {string} raUnit - 返回RA的单位：'hours' 或 'degrees'
   * @returns {Object} {ra, dec, distance}
   */
  toSpherical (raUnit = 'degrees') {
    const distance = this.length()

    if (distance === 0) {
      return { ra: 0, dec: 0, distance: 0 }
    }

    // 计算赤纬（度）
    const dec = Math.asin(this.z / distance) * 180 / Math.PI

    // 计算赤经（度）
    let raDegrees = Math.atan2(this.y, this.x) * 180 / Math.PI

    // 确保赤经在 0-360 度范围内
    if (raDegrees < 0) {
      raDegrees += 360
    }

    // 如果需要小时制
    const ra = raUnit === 'hours' ? raDegrees / 15 : raDegrees

    return {
      ra: ra,
      dec: dec,
      distance: distance
    }
  }

  // 向量长度
  length () {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z)
  }

  // 归一化
  normalize () {
    const len = this.length()
    if (len > 0) {
      return new Vec3(this.x / len, this.y / len, this.z / len)
    }
    return new Vec3(0, 0, 0)
  }

  // 向量加法
  add (v) {
    return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z)
  }

  // 向量减法
  subtract (v) {
    return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z)
  }

  // 标量乘法
  multiply (scalar) {
    return new Vec3(this.x * scalar, this.y * scalar, this.z * scalar)
  }

  // 点积
  dot (v) {
    return this.x * v.x + this.y * v.y + this.z * v.z
  }

  // 叉积
  cross (v) {
    return new Vec3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    )
  }

  // 两向量之间的角度（度）
  angleTo (v) {
    const cosAngle = this.dot(v) / (this.length() * v.length())
    return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180 / Math.PI
  }

  // 计算到另一点的距离
  distanceTo (v) {
    return this.subtract(v).length()
  }

  // 格式化输出
  toString (decimals = 6) {
    return `(${this.x.toFixed(decimals)}, ${this.y.toFixed(decimals)}, ${this.z.toFixed(decimals)})`
  }
}

export { Vec3 }

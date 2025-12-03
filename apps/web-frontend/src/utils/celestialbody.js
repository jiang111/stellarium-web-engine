// CelestialBody.js - 天体类
import { Vec3 } from '@/utils/vec3'

class CelestialBody {
  constructor (name, ra, dec, distance, magnitude = 0, color = '#ffffff') {
    this.name = name // 名称
    this.ra = ra // 赤经（度）
    this.dec = dec // 赤纬（度）
    this.distance = distance // 距离（光年）
    this.magnitude = magnitude // 视星等
    // 转换为笛卡尔坐标
    this.position = Vec3.fromSpherical(ra, dec, distance)
  }

  // 计算视大小（基于星等）
  getVisualSize () {
    // 星等越小，星星越亮，显示越大
    return Math.max(1, 5 - this.magnitude)
  }

  // 计算到另一天体的角距离
  angularDistanceTo (other) {
    const v1 = this.position.normalize()
    const v2 = other.position.normalize()
    return v1.angleTo(v2)
  }

  // 计算实际距离
  physicalDistanceTo (other) {
    return this.position.distanceTo(other.position)
  }
}
export default CelestialBody

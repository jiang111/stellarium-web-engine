class StellariumBridge {
  constructor () {
    this.bridge = window.webkit?.messageHandlers || window.AndroidBridge
  }

  // 发送消息给 App
  postMessage (action, data = {}) {
    if (window.webkit?.messageHandlers?.stellarium) {
      window.webkit.messageHandlers.stellarium.postMessage({ action, data })
    } else if (window.AndroidBridge) {
      window.AndroidBridge.postMessage(JSON.stringify({ action, data }))
    }
  }

  // 注册供 App 调用的方法
  registerActions (actions) {
    window.StellariumActions = actions
  }
}

export default new StellariumBridge()

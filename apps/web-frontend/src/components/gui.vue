// Stellarium Web - Copyright (c) 2022 - Stellarium Labs SRL
//
// This program is licensed under the terms of the GNU AGPL v3, or
// alternatively under a commercial licence.
//
// The terms of the AGPL v3 license can be found in the main directory of this
// repository.

<template>

  <div class="click-through" style="position:absolute; width: 100%; height: 100%; display:flex; align-items: flex-end;">
    <template v-for="(item, i) in pluginsGuiComponents">
      <component :is="item" :key="i"></component>
    </template>
    <template v-for="(item, i) in dialogs">
      <component :is="item" :key="i + pluginsGuiComponents.length"></component>
    </template>
    <js-bridge-selected-object></js-bridge-selected-object>
    <js-bridge></js-bridge>
  </div>

</template>

<script>
import JsBridge from '@/components/jsbridge.vue'
import JsBridgeSelectedObject from '@/components/jsbridge-selected-object.vue'

export default {
  data: function () {
    return {}
  },
  methods: {},
  computed: {
    pluginsGuiComponents: function () {
      let res = []
      for (const i in this.$stellariumWebPlugins()) {
        const plugin = this.$stellariumWebPlugins()[i]
        if (plugin.guiComponents) {
          res = res.concat(plugin.guiComponents)
        }
      }
      return res
    },
    dialogs: function () {
      let res = [
        'data-credits-dialog',
        'view-settings-dialog',
        'planets-visibility',
        'location-dialog'
      ]
      for (const i in this.$stellariumWebPlugins()) {
        const plugin = this.$stellariumWebPlugins()[i]
        if (plugin.dialogs) {
          res = res.concat(plugin.dialogs.map(d => d.name))
        }
      }
      return res
    }
  },
  components: {
    JsBridge,
    JsBridgeSelectedObject
  }
}
</script>

<style>
</style>

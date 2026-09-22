<script>
import { recoverAndRetryAll } from '@/utils/pipeline.js'

export default {
  onLaunch() {
    console.log('TalkSum launched')
    // Un-stick anything left over from a session that ended abnormally
    // (force-quit, crash, killed by the OS) — see recoverAndRetryAll's
    // own comment for exactly what this catches.
    recoverAndRetryAll()
    // Also retry the moment connectivity actually comes back, rather than
    // waiting on a blind timer that'd mostly tick while still offline.
    uni.onNetworkStatusChange(res => {
      if (res.isConnected) {
        recoverAndRetryAll()
      }
    })
  },
  onShow() {
    console.log('App Show')
  },
  onHide() {
    console.log('App Hide')
  }
}
</script>

<style lang="scss">
page {
  background-color: #F5F5F5;
  height: 100%;
}
</style>

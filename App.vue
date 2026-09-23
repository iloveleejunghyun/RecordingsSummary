<script>
import { recoverOrphanedSessions, retryAllFailed } from '@/utils/pipeline.js'

export default {
  onLaunch() {
    console.log('TalkSum launched')
    // Un-stick anything left over from a session that ended abnormally
    // (force-quit, crash, killed by the OS) — only safe here, at true cold
    // start before any page has mounted, since nothing could possibly be
    // genuinely mid-recording yet. See recoverOrphanedSessions' own comment.
    recoverOrphanedSessions()
    // Retry anything already failed the moment connectivity actually comes
    // back, rather than waiting on a blind timer that'd mostly tick while
    // still offline. Deliberately the lighter, anytime-safe sweep — this can
    // fire in the middle of an active recording session, and must not touch
    // its still-growing 'recording' status the way the full sweep would.
    uni.onNetworkStatusChange(res => {
      if (res.isConnected) {
        retryAllFailed()
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

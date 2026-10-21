import { env } from '@/config/env'
import { supabaseHarnessRepository } from '@/repositories/harness-supabase'

let cleanupTimer: ReturnType<typeof setInterval> | null = null
let cleanupInFlight = false

async function runCleanup() {
  if (cleanupInFlight) return
  cleanupInFlight = true
  try {
    await supabaseHarnessRepository.cleanup()
  } catch (error) {
    // Telemetry maintenance must not affect API availability.
    console.error('[HarnessCleanup] Supabase cleanup failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    cleanupInFlight = false
  }
}

export function startSupabaseHarnessCleanup() {
  if (env.DATABASE_PROVIDER !== 'supabase' || cleanupTimer) return

  void runCleanup()
  cleanupTimer = setInterval(() => {
    void runCleanup()
  }, env.HARNESS_CLEANUP_INTERVAL_MS)
  cleanupTimer.unref?.()
}

export function stopSupabaseHarnessCleanupForTests() {
  if (!cleanupTimer) return
  clearInterval(cleanupTimer)
  cleanupTimer = null
}

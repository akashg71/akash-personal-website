'use client'

import { useEffect, useSyncExternalStore, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSync, IDLE, refreshSettled, setRefreshRunner, subscribe } from './mutate'
import ProgressBar from './ProgressBar'

/**
 * Runs the page's one refresh (see requestRefresh in mutate.ts) inside a
 * transition, so it knows when the new server render has landed, and shows
 * the progress bar while writes or that refresh are in flight.
 */
export default function RefreshHost() {
  const router = useRouter()
  const [refreshing, startTransition] = useTransition()
  const { writes } = useSyncExternalStore(subscribe, getSync, () => IDLE)

  // Declared first: on mount it must not settle a refresh the runner below starts.
  useEffect(() => {
    if (!refreshing) refreshSettled()
  }, [refreshing])

  useEffect(() => {
    setRefreshRunner(() => startTransition(() => router.refresh()))
    return () => setRefreshRunner(null)
  }, [router])

  return <ProgressBar active={writes > 0 || refreshing} />
}

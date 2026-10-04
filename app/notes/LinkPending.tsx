'use client'

import { useLinkStatus } from 'next/link'
import ProgressBar from './ProgressBar'

/** Inside a <Link>: shows the progress bar from the tap until the note arrives. */
export default function LinkPending() {
  return <ProgressBar active={useLinkStatus().pending} />
}

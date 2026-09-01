import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { HARNESS_PROFILE_PATCH_PATH } from './harness-config.js'

interface WorkerRunResult {
  sessionId: string
  finalResponse: string
}

interface PendingRequest {
  resolve: (value: WorkerRunResult) => void
  reject: (error: Error) => void
}

interface WorkerMessage {
  type: 'result' | 'error' | 'closed'
  requestId?: string
  sessionId?: string
  finalResponse?: string
  message?: string
}

export interface NodeHarnessRuntime {
  run(input: string, options: { sessionId: string }): Promise<WorkerRunResult>
  close(): Promise<void>
}

class NodeHarnessRuntimeImpl implements NodeHarnessRuntime {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly pending = new Map<string, PendingRequest>()
  private requestCounter = 0
  private closed = false
  private closePromise: Promise<void> | undefined
  private resolveClosed: (() => void) | undefined

  constructor(cwd: string) {
    const workerPath = fileURLToPath(new URL('./harness-worker.js', import.meta.url))
    this.child = spawn(process.platform === 'win32' ? 'node.exe' : 'node', [workerPath, HARNESS_PROFILE_PATCH_PATH], {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    createInterface({ input: this.child.stdout }).on('line', line => this.handleLine(line))
    // Drain stderr so the child can never block. It is intentionally not
    // forwarded to the renderer because provider diagnostics may be sensitive.
    this.child.stderr.resume()
    this.child.once('error', error => this.failAll(error))
    this.child.once('exit', (code, signal) => {
      this.failAll(new Error('Harness worker closed.'))
      if (!this.closed) {
        this.failAll(new Error(`Harness worker exited (${code ?? signal ?? 'unknown'}).`))
      }
      this.resolveClosed?.()
    })
  }

  run(input: string, options: { sessionId: string }): Promise<WorkerRunResult> {
    if (this.closed) return Promise.reject(new Error('Harness worker is closed.'))
    const requestId = `request-${++this.requestCounter}`
    const response = new Promise<WorkerRunResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
    })
    this.child.stdin.write(`${JSON.stringify({ type: 'ask', requestId, prompt: input, sessionId: options.sessionId })}\n`)
    return response
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closed = true
    this.closePromise = new Promise<void>((resolve) => {
      this.resolveClosed = resolve
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        resolve()
        return
      }
      this.child.stdin.write(`${JSON.stringify({ type: 'close' })}\n`)
      const fallback = setTimeout(() => this.child.kill(), 10_000)
      fallback.unref()
      this.child.once('exit', () => clearTimeout(fallback))
    })
    return this.closePromise
  }

  private handleLine(line: string): void {
    let message: WorkerMessage
    try {
      message = JSON.parse(line) as WorkerMessage
    } catch {
      return
    }
    if (message.type === 'closed') return
    if (!message.requestId) return
    const pending = this.pending.get(message.requestId)
    if (!pending) return
    this.pending.delete(message.requestId)
    if (message.type === 'result' && message.sessionId !== undefined && message.finalResponse !== undefined) {
      pending.resolve({ sessionId: message.sessionId, finalResponse: message.finalResponse })
    } else {
      pending.reject(new Error(message.message ?? 'Harness worker request failed.'))
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

export function createNodeHarnessRuntime(cwd: string): NodeHarnessRuntime {
  return new NodeHarnessRuntimeImpl(cwd)
}

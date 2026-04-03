/**
 * task-queue
 *
 * In-memory priority task queue with concurrency control.
 * Supports priority levels, task timeouts, pause/resume,
 * event callbacks, and bounded concurrency.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Priority level: lower number = higher priority. */
export type Priority = number;

/** Possible states of a task. */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

/** The function a task executes. */
export type TaskFunction<T = unknown> = (signal: AbortSignal) => Promise<T>;

/** Options when enqueuing a task. */
export interface TaskOptions {
  /** Task identifier (auto-generated if omitted). */
  id?: string;
  /** Priority level (default: 0, lower = higher priority). */
  priority?: Priority;
  /** Timeout in milliseconds (0 = no timeout). */
  timeout?: number;
  /** Arbitrary metadata attached to the task. */
  meta?: Record<string, unknown>;
}

/** Public view of a task's state. */
export interface TaskInfo<T = unknown> {
  id: string;
  priority: Priority;
  status: TaskStatus;
  result?: T;
  error?: Error;
  enqueuedAt: number;
  startedAt?: number;
  completedAt?: number;
  meta?: Record<string, unknown>;
}

/** Events the queue can emit via callbacks. */
export interface QueueEvents<T = unknown> {
  taskStart?: (task: TaskInfo<T>) => void;
  taskComplete?: (task: TaskInfo<T>) => void;
  taskFailed?: (task: TaskInfo<T>) => void;
  taskTimeout?: (task: TaskInfo<T>) => void;
  drain?: () => void;
}

/** Configuration for the TaskQueue. */
export interface QueueOptions<T = unknown> {
  /** Maximum concurrent tasks (default: 1). */
  concurrency?: number;
  /** Default timeout for all tasks in ms (default: 0 = none). */
  defaultTimeout?: number;
  /** Event callbacks. */
  events?: QueueEvents<T>;
}

// ---------------------------------------------------------------------------
// Internal task wrapper
// ---------------------------------------------------------------------------

interface InternalTask<T = unknown> {
  id: string;
  priority: Priority;
  status: TaskStatus;
  fn: TaskFunction<T>;
  timeout: number;
  result?: T;
  error?: Error;
  enqueuedAt: number;
  startedAt?: number;
  completedAt?: number;
  meta?: Record<string, unknown>;
  abortController?: AbortController;
  resolve: (info: TaskInfo<T>) => void;
  reject: (err: Error) => void;
}

// ---------------------------------------------------------------------------
// Priority min-heap helpers (array-based, inline)
// ---------------------------------------------------------------------------

function heapPush<T>(heap: InternalTask<T>[], task: InternalTask<T>): void {
  heap.push(task);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = Math.floor((i - 1) / 2);
    if (heap[parent].priority <= heap[i].priority) break;
    [heap[parent], heap[i]] = [heap[i], heap[parent]];
    i = parent;
  }
}

function heapPop<T>(heap: InternalTask<T>[]): InternalTask<T> | undefined {
  if (heap.length === 0) return undefined;
  const top = heap[0];
  const last = heap.pop()!;
  if (heap.length > 0) {
    heap[0] = last;
    let i = 0;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < heap.length && heap[left].priority < heap[smallest].priority) {
        smallest = left;
      }
      if (right < heap.length && heap[right].priority < heap[smallest].priority) {
        smallest = right;
      }
      if (smallest === i) break;
      [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
      i = smallest;
    }
  }
  return top;
}

// ---------------------------------------------------------------------------
// TaskQueue
// ---------------------------------------------------------------------------

let globalIdCounter = 0;

export class TaskQueue<T = unknown> {
  private readonly concurrency: number;
  private readonly defaultTimeout: number;
  private readonly events: QueueEvents<T>;
  private readonly pending: InternalTask<T>[] = []; // min-heap
  private readonly running: Map<string, InternalTask<T>> = new Map();
  private readonly completed: Map<string, InternalTask<T>> = new Map();
  private paused = false;

  constructor(options: QueueOptions<T> = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.defaultTimeout = options.defaultTimeout ?? 0;
    this.events = options.events ?? {};
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Add a task to the queue. Returns a promise that resolves with
   * the TaskInfo when the task completes (or rejects on failure).
   */
  add(fn: TaskFunction<T>, options: TaskOptions = {}): Promise<TaskInfo<T>> {
    return new Promise<TaskInfo<T>>((resolve, reject) => {
      const task: InternalTask<T> = {
        id: options.id ?? `task-${++globalIdCounter}`,
        priority: options.priority ?? 0,
        status: 'pending',
        fn,
        timeout: options.timeout ?? this.defaultTimeout,
        enqueuedAt: Date.now(),
        meta: options.meta,
        resolve,
        reject,
      };
      heapPush(this.pending, task);
      this.flush();
    });
  }

  /** Pause processing (running tasks continue, no new ones start). */
  pause(): void {
    this.paused = true;
  }

  /** Resume processing. */
  resume(): void {
    this.paused = false;
    this.flush();
  }

  /** Cancel a pending task by id. Returns true if it was found and cancelled. */
  cancel(taskId: string): boolean {
    const idx = this.pending.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      const task = this.pending[idx];
      task.status = 'cancelled';
      task.completedAt = Date.now();
      this.pending.splice(idx, 1);
      // Re-heapify (simple: rebuild)
      this.rebuildHeap();
      task.resolve(this.toInfo(task));
      return true;
    }
    // Also try cancelling a running task
    const running = this.running.get(taskId);
    if (running) {
      running.abortController?.abort();
      running.status = 'cancelled';
      running.completedAt = Date.now();
      this.running.delete(taskId);
      this.completed.set(taskId, running);
      running.resolve(this.toInfo(running));
      this.flush();
      return true;
    }
    return false;
  }

  /** Get info about a specific task. */
  getTask(taskId: string): TaskInfo<T> | undefined {
    const task =
      this.pending.find((t) => t.id === taskId) ??
      this.running.get(taskId) ??
      this.completed.get(taskId);
    return task ? this.toInfo(task) : undefined;
  }

  /** Number of tasks waiting to run. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** Number of tasks currently running. */
  get runningCount(): number {
    return this.running.size;
  }

  /** Number of tasks completed (including failed). */
  get completedCount(): number {
    return this.completed.size;
  }

  /** Total tasks across all states. */
  get size(): number {
    return this.pending.length + this.running.size + this.completed.size;
  }

  /** Whether the queue is paused. */
  get isPaused(): boolean {
    return this.paused;
  }

  /** Whether there are no pending or running tasks. */
  get isIdle(): boolean {
    return this.pending.length === 0 && this.running.size === 0;
  }

  /** Wait until the queue is fully drained (no pending or running tasks). */
  async drain(): Promise<void> {
    if (this.isIdle) return;
    return new Promise<void>((resolve) => {
      const check = (): void => {
        if (this.isIdle) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });
  }

  /** Remove all pending tasks (running tasks are not affected). */
  clear(): void {
    for (const task of this.pending) {
      task.status = 'cancelled';
      task.completedAt = Date.now();
      task.resolve(this.toInfo(task));
    }
    this.pending.length = 0;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private flush(): void {
    if (this.paused) return;
    while (this.running.size < this.concurrency && this.pending.length > 0) {
      const task = heapPop(this.pending);
      if (!task) break;
      this.execute(task);
    }
  }

  private execute(task: InternalTask<T>): void {
    task.status = 'running';
    task.startedAt = Date.now();
    task.abortController = new AbortController();
    this.running.set(task.id, task);

    this.events.taskStart?.(this.toInfo(task));

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      this.running.delete(task.id);
      this.completed.set(task.id, task);
      this.flush();
      if (this.isIdle) {
        this.events.drain?.();
      }
    };

    // Timeout
    if (task.timeout > 0) {
      timeoutHandle = setTimeout(() => {
        task.abortController?.abort();
        task.status = 'timeout';
        task.error = new Error(`Task "${task.id}" timed out after ${task.timeout}ms`);
        task.completedAt = Date.now();
        cleanup();
        this.events.taskTimeout?.(this.toInfo(task));
        task.resolve(this.toInfo(task));
      }, task.timeout);
    }

    task
      .fn(task.abortController.signal)
      .then((result) => {
        if (task.status !== 'running') return; // already timed out / cancelled
        task.status = 'completed';
        task.result = result;
        task.completedAt = Date.now();
        cleanup();
        this.events.taskComplete?.(this.toInfo(task));
        task.resolve(this.toInfo(task));
      })
      .catch((err: Error) => {
        if (task.status !== 'running') return;
        task.status = 'failed';
        task.error = err;
        task.completedAt = Date.now();
        cleanup();
        this.events.taskFailed?.(this.toInfo(task));
        task.reject(err);
      });
  }

  private toInfo(task: InternalTask<T>): TaskInfo<T> {
    return {
      id: task.id,
      priority: task.priority,
      status: task.status,
      result: task.result,
      error: task.error,
      enqueuedAt: task.enqueuedAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      meta: task.meta,
    };
  }

  private rebuildHeap(): void {
    const items = [...this.pending];
    this.pending.length = 0;
    for (const item of items) {
      heapPush(this.pending, item);
    }
  }
}

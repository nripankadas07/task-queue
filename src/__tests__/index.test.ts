import { TaskQueue } from '../index';

// Helper: create a delay function
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Helper: create a task that resolves after a delay
const delayTask =
  <T>(ms: number, value: T) =>
  async (_signal: AbortSignal): Promise<T> => {
    await delay(ms);
    return value;
  };

// ---------------------------------------------------------------------------
// Basic enqueue and execution
// ---------------------------------------------------------------------------

describe('TaskQueue â basic', () => {
  it('executes a single task and returns its result', async () => {
    const q = new TaskQueue<string>({ concurrency: 1 });
    const info = await q.add(async () => 'hello', { id: 't1' });
    expect(info.status).toBe('completed');
    expect(info.result).toBe('hello');
    expect(info.id).toBe('t1');
  });

  it('auto-generates task IDs when not provided', async () => {
    const q = new TaskQueue<number>();
    const info = await q.add(async () => 42);
    expect(info.id).toMatch(/^task-\d+$/);
  });

  it('handles task failures with rejection', async () => {
    const q = new TaskQueue();
    await expect(
      q.add(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});

// ---------------------------------------------------------------------------
// Priority ordering
// ---------------------------------------------------------------------------

describe('TaskQueue â priority', () => {
  it('executes higher-priority tasks first (lower number = higher priority)', async () => {
    const order: string[] = [];
    const q = new TaskQueue<void>({ concurrency: 1 });

    // Enqueue 3 tasks; they won't start until the first slot is free
    const p1 = q.add(
      async () => {
        order.push('low');
      },
      { priority: 10, id: 'low' },
    );
    const p2 = q.add(
      async () => {
        order.push('high');
      },
      { priority: 1, id: 'high' },
    );
    const p3 = q.add(
      async () => {
        order.push('mid');
      },
      { priority: 5, id: 'mid' },
    );

    await Promise.all([p1, p2, p3]);

    // First task grabbed immediately was 'low' (it was first in when queue was empty).
    // Of the remaining two, 'high' (priority 1) should run before 'mid' (priority 5).
    expect(order[1]).toBe('high');
    expect(order[2]).toBe('mid');
  });
});

// ---------------------------------------------------------------------------
// Concurrency control
// ---------------------------------------------------------------------------

describe('TaskQueue â concurrency', () => {
  it('respects concurrency limit', async () => {
    let peak = 0;
    let current = 0;
    const q = new TaskQueue<void>({ concurrency: 2 });

    const tasks = Array.from({ length: 6 }, (_, i) =>
      q.add(async () => {
        current++;
        peak = Math.max(peak, current);
        await delay(30);
        current--;
      }, { id: `c-${i}` }),
    );

    await Promise.all(tasks);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('runs tasks in parallel up to the concurrency limit', async () => {
    const q = new TaskQueue<number>({ concurrency: 3 });
    const start = Date.now();

    const tasks = Array.from({ length: 3 }, (_, i) =>
      q.add(delayTask(50, i), { id: `par-${i}` }),
    );

    await Promise.all(tasks);
    const elapsed = Date.now() - start;
    // All 3 should run in parallel, so ~50ms, not ~150ms
    expect(elapsed).toBeLessThan(120);
  });
});

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

describe('TaskQueue â timeout', () => {
  it('times out a task that exceeds its timeout', async () => {
    const q = new TaskQueue<string>();
    const info = await q.add(delayTask(500, 'late'), { timeout: 50, id: 'slow' });
    expect(info.status).toBe('timeout');
    expect(info.error?.message).toContain('timed out');
  });

  it('uses defaultTimeout when no per-task timeout is set', async () => {
    const q = new TaskQueue<string>({ defaultTimeout: 50 });
    const info = await q.add(delayTask(500, 'late'), { id: 'default-to' });
    expect(info.status).toBe('timeout');
  });
});

// ---------------------------------------------------------------------------
// Pause / Resume
// ---------------------------------------------------------------------------

describe('TaskQueue â pause/resume', () => {
  it('pauses and resumes task processing', async () => {
    const q = new TaskQueue<string>({ concurrency: 1 });

    // Add a task that takes 50ms
    const p1 = q.add(delayTask(50, 'first'), { id: 'pr1' });

    // Pause immediately â the first task is already running but no new ones start
    q.pause();
    expect(q.isPaused).toBe(true);

    // Enqueue another task while paused
    const p2 = q.add(async () => 'second', { id: 'pr2' });

    // Wait for first to finish
    const info1 = await p1;
    expect(info1.status).toBe('completed');

    // Second should still be pending (queue is paused)
    expect(q.pendingCount).toBe(1);

    // Resume
    q.resume();
    const info2 = await p2;
    expect(info2.status).toBe('completed');
    expect(info2.result).toBe('second');
  });
});

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

describe('TaskQueue â cancel', () => {
  it('cancels a pending task', async () => {
    const q = new TaskQueue<string>({ concurrency: 1 });

    // Block the queue with a slow task
    const blocker = q.add(delayTask(100, 'block'), { id: 'block' });

    // Enqueue another task
    const p2 = q.add(async () => 'never', { id: 'victim' });

    // Cancel the pending task
    const cancelled = q.cancel('victim');
    expect(cancelled).toBe(true);

    const info = await p2;
    expect(info.status).toBe('cancelled');

    await blocker;
  });

  it('returns false when cancelling a nonexistent task', () => {
    const q = new TaskQueue();
    expect(q.cancel('nope')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

describe('TaskQueue â events', () => {
  it('fires taskStart and taskComplete callbacks', async () => {
    const started: string[] = [];
    const completed: string[] = [];

    const q = new TaskQueue<string>({
      concurrency: 1,
      events: {
        taskStart: (t) => started.push(t.id),
        taskComplete: (t) => completed.push(t.id),
      },
    });

    await q.add(async () => 'ok', { id: 'ev1' });
    expect(started).toContain('ev1');
    expect(completed).toContain('ev1');
  });

  it('fires taskFailed callback on error', async () => {
    const failed: string[] = [];
    const q = new TaskQueue({
      events: { taskFailed: (t) => failed.push(t.id) },
    });

    await q.add(async () => { throw new Error('oops'); }, { id: 'fail1' }).catch(() => {});
    expect(failed).toContain('fail1');
  });

  it('fires drain callback when queue empties', async () => {
    let drained = false;
    const q = new TaskQueue<string>({
      concurrency: 2,
      events: { drain: () => { drained = true; } },
    });

    await Promise.all([
      q.add(async () => 'a', { id: 'd1' }),
      q.add(async () => 'b', { id: 'd2' }),
    ]);

    // Give the drain event a tick to fire
    await delay(20);
    expect(drained).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getTask / size / clear / drain
// ---------------------------------------------------------------------------

describe('TaskQueue â utility methods', () => {
  it('getTask returns task info', async () => {
    const q = new TaskQueue<number>();
    const p = q.add(async () => 99, { id: 'info1' });
    await p;
    const info = q.getTask('info1');
    expect(info?.status).toBe('completed');
    expect(info?.result).toBe(99);
  });

  it('getTask returns undefined for unknown ids', () => {
    const q = new TaskQueue();
    expect(q.getTask('missing')).toBeUndefined();
  });

  it('clear cancels all pending tasks', async () => {
    const q = new TaskQueue<string>({ concurrency: 1 });
    const blocker = q.add(delayTask(100, 'block'), { id: 'clr-block' });
    const p2 = q.add(async () => 'a', { id: 'clr-a' });
    const p3 = q.add(async () => 'b', { id: 'clr-b' });

    q.clear();
    expect(q.pendingCount).toBe(0);

    const info2 = await p2;
    const info3 = await p3;
    expect(info2.status).toBe('cancelled');
    expect(info3.status).toBe('cancelled');

    await blocker;
  });

  it('drain() resolves when queue is idle', async () => {
    const q = new TaskQueue<void>({ concurrency: 2 });
    q.add(delayTask(30, undefined));
    q.add(delayTask(30, undefined));
    await q.drain();
    expect(q.isIdle).toBe(true);
  });

  it('size reflects total tasks across all states', async () => {
    const q = new TaskQueue<string>({ concurrency: 1 });
    q.add(async () => 'x', { id: 'sz1' });
    q.add(async () => 'y', { id: 'sz2' });
    // sz1 is running, sz2 is pending â size=2
    expect(q.size).toBeGreaterThanOrEqual(2);
    await q.drain();
    // Both completed â still counted in size
    expect(q.completedCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Abort signal
// ---------------------------------------------------------------------------

describe('TaskQueue â abort signal', () => {
  it('provides an AbortSignal to the task function', async () => {
    const q = new TaskQueue<string>({ concurrency: 1 });
    let receivedSignal = false;

    await q.add(async (signal) => {
      receivedSignal = signal instanceof AbortSignal;
      return 'done';
    });

    expect(receivedSignal).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

describe('TaskQueue â meta', () => {
  it('preserves task metadata', async () => {
    const q = new TaskQueue<string>();
    const info = await q.add(async () => 'ok', {
      id: 'meta1',
      meta: { user: 'alice', retries: 3 },
    });
    expect(info.meta).toEqual({ user: 'alice', retries: 3 });
  });
});

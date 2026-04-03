# task-queue

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)]()

In-memory priority task queue for Node.js with bounded concurrency, timeouts, pause/resume, cancellation, and event hooks. Zero dependencies.

## Features

- **Priority scheduling** â lower number = higher priority, backed by a min-heap
- **Bounded concurrency** â run N tasks in parallel, no more
- **Timeouts** â per-task and global default, with automatic abort
- **AbortSignal** â every task receives a signal for cooperative cancellation
- **Pause / Resume** â freeze the queue without losing state
- **Cancel** â cancel pending or running tasks by ID
- **Event hooks** â `taskStart`, `taskComplete`, `taskFailed`, `taskTimeout`, `drain`
- **Task metadata** â attach arbitrary data to tasks for tracing/logging
- **Zero dependencies** â pure TypeScript, no runtime deps

## Installation

```bash
npm install task-queue
```

## Quick Start

```typescript
import { TaskQueue } from 'task-queue';

const queue = new TaskQueue<string>({
  concurrency: 3,
  defaultTimeout: 5000,
  events: {
    taskComplete: (info) => console.log(`Done: ${info.id}`),
    drain: () => console.log('All tasks finished'),
  },
});

// Add tasks with priorities
queue.add(async () => fetchUser(1), { id: 'user-1', priority: 1 });
queue.add(async () => fetchUser(2), { id: 'user-2', priority: 5 });
queue.add(async () => fetchUser(3), { id: 'user-3', priority: 1 });

// Wait for everything to complete
await queue.drain();
```

## Usage

### Basic Task Execution

```typescript
const queue = new TaskQueue<number>({ concurrency: 2 });

const result = await queue.add(async (signal) => {
  // signal is an AbortSignal for cooperative cancellation
  const data = await fetch('/api/data', { signal });
  return data.status;
}, { id: 'fetch-data' });

console.log(result.status); // 'completed'
console.log(result.result); // 200
```

### Priority Scheduling

```typescript
// Lower number = higher priority
queue.add(fn, { priority: 10, id: 'background' });
queue.add(fn, { priority: 1,  id: 'critical' });  // runs first
queue.add(fn, { priority: 5,  id: 'normal' });
```

### Timeouts

```typescript
// Per-task timeout
const info = await queue.add(longRunningTask, { timeout: 3000 });
if (info.status === 'timeout') {
  console.log('Task timed out:', info.error?.message);
}

// Global default timeout
const queue = new TaskQueue({ defaultTimeout: 5000 });
```

### Pause and Resume

```typescript
queue.pause();
// Tasks already running will finish, but no new tasks start
console.log(queue.isPaused); // true

queue.resume();
// Queued tasks begin processing again
```

### Cancellation

```typescript
queue.add(longTask, { id: 'my-task' });
const cancelled = queue.cancel('my-task');
console.log(cancelled); // true
```

### Task Metadata

```typescript
const info = await queue.add(fn, {
  id: 'task-1',
  meta: { userId: 42, attempt: 1 },
});
console.log(info.meta); // { userId: 42, attempt: 1 }
```

## API Reference

### `new TaskQueue<T>(options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `concurrency` | `number` | `1` | Max parallel tasks |
| `defaultTimeout` | `number` | `0` | Default timeout in ms (0 = none) |
| `events` | `QueueEvents<T>` | `{}` | Event callbacks |

### Instance Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `add(fn, options?)` | `Promise<TaskInfo<T>>` | Enqueue a task |
| `cancel(id)` | `boolean` | Cancel a task by ID |
| `pause()` | `void` | Pause processing |
| `resume()` | `void` | Resume processing |
| `clear()` | `void` | Cancel all pending tasks |
| `drain()` | `Promise<void>` | Wait until queue is idle |
| `getTask(id)` | `TaskInfo<T> \| undefined` | Get task info by ID |

### Instance Properties

| Property | Type | Description |
|----------|------|-------------|
| `pendingCount` | `number` | Tasks waiting to run |
| `runningCount` | `number` | Tasks currently executing |
| `completedCount` | `number` | Tasks finished |
| `size` | `number` | Total tasks in all states |
| `isPaused` | `boolean` | Whether queue is paused |
| `isIdle` | `boolean` | No pending or running tasks |

### `TaskInfo<T>`

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Task identifier |
| `priority` | `number` | Priority level |
| `status` | `TaskStatus` | `'pending' \| 'running' \| 'completed' \| 'failed' \| 'cancelled' \| 'timeout'` |
| `result` | `T` | Return value (if completed) |
| `error` | `Error` | Error (if failed/timeout) |
| `enqueuedAt` | `number` | Timestamp when added |
| `startedAt` | `number` | Timestamp when started |
| `completedAt` | `number` | Timestamp when finished |
| `meta` | `object` | User-defined metadata |

## Architecture

```
âââââââââââââââââââââââââââââââââââââââââââ
â             TaskQueue                    â
â                                         â
â  âââââââââââ   âââââââââââââââââââââââ  â
â  â Min-Heap â   â Concurrency Gate    â  â
â  â (pending)ââââ¶â (max N running)     â  â
â  âââââââââââ   ââââââââ¬âââââââââââââââ  â
â                        â                 â
â              âââââââââââ¼ââââââââââ       â
â              â  Execute w/ timer â       â
â              â  + AbortSignal    â       â
â              âââââââââââ¬ââââââââââ       â
â                        â                 â
â              âââââââââââ¼ââââââââââ       â
â              â  completed map    â       â
â              â  + event hooks    â       â
â              âââââââââââââââââââââ       â
âââââââââââââââââââââââââââââââââââââââââââ
```

## License

MIT Â© Nripanka Das

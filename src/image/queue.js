import { ImageQueueFullError } from "./errors.js";

export class SerialTaskQueue {
    #active = false;
    #pending = [];

    constructor({ maxSize = 5 } = {}) {
        this.maxSize = maxSize;
    }

    get size() {
        return Number(this.#active) + this.#pending.length;
    }

    add(task) {
        if (typeof task !== "function") {
            throw new TypeError("Queue task must be a function.");
        }
        if (this.size >= this.maxSize) {
            throw new ImageQueueFullError("The conversation queue is full.");
        }

        const position = this.size + 1;
        let resolveTask;
        let rejectTask;
        const promise = new Promise((resolve, reject) => {
            resolveTask = resolve;
            rejectTask = reject;
        });
        this.#pending.push({ task, resolveTask, rejectTask });
        queueMicrotask(() => this.#drain());

        return Object.freeze({ promise, position, queued: position > 1 });
    }

    async #drain() {
        if (this.#active || this.#pending.length === 0) return;

        const entry = this.#pending.shift();
        this.#active = true;
        try {
            entry.resolveTask(await entry.task());
        } catch (error) {
            entry.rejectTask(error);
        } finally {
            this.#active = false;
            queueMicrotask(() => this.#drain());
        }
    }
}


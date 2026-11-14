/**
 * Runtime registry of loaded adapters.
 * The pipeline uses this to check capabilities without importing adapters directly.
 */

import type { Adapter } from "@mind/core";

export class AdapterRegistry {
  private readonly map = new Map<string, Adapter>();

  register(adapter: Adapter): void {
    this.map.set(adapter.id, adapter);
  }

  get(id: string): Adapter | undefined {
    return this.map.get(id);
  }

  all(): Adapter[] {
    return [...this.map.values()];
  }
}

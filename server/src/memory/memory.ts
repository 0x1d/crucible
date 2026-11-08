// Memory facade (spec 10): one memory space with its temporal-reasoning server (primary memory)
// and its wiki (written on the user's explicit request).
import type { Logger } from "../log.js";
import { SearchIndex } from "./search.js";
import { commit, openSpace, type MemorySpace } from "./space.js";
import { TemporalReasoning, type TemporalReasoningOptions } from "./temporal-reasoning.js";
import { Wiki } from "./wiki.js";

export interface MemoryOptions {
  watch?: boolean;
  /** temporal-reasoning child options (graph path is the space's). */
  temporal: Omit<TemporalReasoningOptions, "graphPath">;
}

export class Memory {
  readonly wiki: Wiki;
  readonly search = new SearchIndex();
  private commits: Promise<unknown> = Promise.resolve();
  private constructor(
    readonly space: MemorySpace,
    readonly temporal: TemporalReasoning,
    private readonly log: Logger,
  ) {
    this.wiki = new Wiki(space.wiki);
    this.wiki.onChange = (changes) => {
      if (changes.length === 0) this.search.rebuild(this.wiki.list());
      for (const c of changes) this.search.update(c.slug, c.deleted ? undefined : this.wiki.get(c.slug));
    };
  }

  static async open(rootDir: string, name: string, log: Logger, opts: MemoryOptions): Promise<Memory> {
    const space = await openSpace(rootDir, name);
    const mlog = log.child({ component: "memory", space: name });
    const m = new Memory(space, new TemporalReasoning({ cwd: space.root, ...opts.temporal, graphPath: space.graph }, mlog), mlog);
    await m.wiki.load();
    m.search.rebuild(m.wiki.list());
    if (opts.watch) m.wiki.watch();
    await m.temporal.start();
    m.log.info("memory_open", { pages: m.wiki.list().length, graph: space.graph });
    return m;
  }

  /** One git commit per wiki change, serialised. */
  commitWiki(message: string): Promise<void> {
    const next = this.commits.then(() =>
      commit(this.space, message).catch((e: Error) => this.log.warn("wiki_commit_failed", { error: e.message })),
    );
    this.commits = next;
    return next.then(() => undefined);
  }

  async close(): Promise<void> {
    this.wiki.close();
    await this.commits;
    await this.temporal.close();
  }
}

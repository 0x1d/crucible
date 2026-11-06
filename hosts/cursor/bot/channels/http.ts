import { httpChannel } from "@grok/agent-sdk/channels";

import { defaultStateRoot, loadMemoryExploreSettings } from "../lib/host-flags.ts";
import { prependMemoryRecallBeforeExplore } from "../lib/memory-recall-before-explore.ts";

export default httpChannel({
  async onMessage(message) {
    const settings = loadMemoryExploreSettings(defaultStateRoot("cursor"), "cursor");
    return prependMemoryRecallBeforeExplore(message, settings);
  },
});

// issue #89 item 6: the wiring half of chooseExampleModelAlias() — McpFacade.workflowAuthoringGuide()
// must thread `aliasProbes` (a thunk over server.ts's aliasMap/probeLookup) into buildAuthoringGuide()
// so the LIVE tool response picks a tool-capable example alias, not always the literal 'default'.
// Mock policy (unit): a bare McpFacade (no store/runManager wiring needed — this method only reads
// ceilings/aliasNames/aliasProbes/confinementPosture, never the run store), so this is a real,
// un-mocked construction of the class under test, exercising the actual composeConfig-class wiring
// hop this item introduces (McpFacadeDeps.aliasProbes -> workflowAuthoringGuide()'s
// chooseExampleModelAlias() call), not a stand-in.
import { describe, it, expect } from 'vitest';
import { McpFacade } from '../../src/mcp-facade.js';
import type { AliasProbeInfo } from '../../src/authoring-guide.js';

async function guideText(facade: McpFacade): Promise<string> {
  const res = await facade.workflowAuthoringGuide();
  return (res as { result: { text: string } }).result.text;
}

describe('McpFacade.workflowAuthoringGuide threads aliasProbes into chooseExampleModelAlias (issue #89 item 6)', () => {
  it('with no aliasProbes dep at all, every example still says \'default\' (back-compat: unit construction, and every deployment before this field existed)', async () => {
    const facade = new McpFacade({});
    const text = await guideText(facade);
    expect(text).toMatch(/default: 'default'/);
    expect(text).not.toContain("default: 'sonnet'");
  });

  it('with aliasProbes reporting \'default\' probed tool-incapable and \'sonnet\' verified, the LIVE guide switches to \'sonnet\' and states why', async () => {
    const probes: AliasProbeInfo[] = [
      { alias: 'default', model: 'ollama/qwen2.5:7b', toolUseVerified: false },
      { alias: 'sonnet', model: 'anthropic/claude-sonnet-5', toolUseVerified: true },
    ];
    const facade = new McpFacade({ aliasProbes: () => probes });
    const text = await guideText(facade);
    expect(text).toContain("default: 'sonnet'");
    expect(text).not.toContain("default: 'default'");
    expect(text).toMatch(/ollama\/qwen2\.5:7b/);
    expect(text).toMatch(/tool-incapable|toolUseVerified.*false/i);
  });

  it('aliasProbes is read FRESH on every call (a thunk, not a snapshot taken at construction)', async () => {
    let verified = false;
    const facade = new McpFacade({
      aliasProbes: () => [
        { alias: 'default', model: 'ollama/qwen2.5:7b', toolUseVerified: verified ? true : false },
        { alias: 'sonnet', model: 'anthropic/claude-sonnet-5', toolUseVerified: true },
      ],
    });
    const before = await guideText(facade);
    expect(before).toContain("default: 'sonnet'");

    verified = true; // simulate the weekly ModelProber re-probing 'default' as now tool-capable
    const after = await guideText(facade);
    expect(after).toContain("default: 'default'");
  });
});

# Verification

Edge Case Studio plugin package 0.1.2 adds a local MCP entry point for the bundled checkout only. The fixture generator remains version 0.1.1. That is the version recorded in CLI fixtures and native results; the adapter reports its own protocol service version. Plugin package version and fixture format version need not change together. Output bytes from 0.1.1 remain unchanged.

| Coverage | Check |
| --- | --- |
| Package layout | Manifest, skill, command, logo, MCP entry point, package/runtime version relationship, no package dependencies or hooks. |
| Core, CLI and built-in workbench | 26 Node test groups: boundaries, UTF-8, repeatability, strict schema refusal, CSP, expected report interactions, and generated artifacts. |
| Native stdio tool | Five integration groups exercising initialize/list/call, both boundaries with six seeds, identical full rows to CLI, refusal and recovery. |
| Independent MCP client | The Python MCP SDK 1.29.0 negotiated 2025-11-25, listed one tool, and exercised both quantities and an input refusal. The small server supports the 2025-06-18 and 2025-11-25 handshake revisions. |
| Independent validator | 304 suites / 5,200 cases checked with Python jsonschema Draft 2020-12, including one failed keyword and exact pointer for every rejected case. |

Run all required Node groups using an existing Node.js 18+ runtime:

```sh
node scripts/check-package.cjs
node --test tests/core.test.cjs tests/report.test.cjs tests/cli.test.cjs tests/checkout-mcp.test.cjs
```

Optional checks, using already-installed Python SDKs and browsers:

```sh
python3 tests/checkout-sdk-smoke.py
node tests/oracle-input.cjs | python3 tests/oracle.py
python3 tests/browser_smoke.py
```

The stdio SDK test is not an IDE or Marketplace verification. To verify an actual host, open the recorded tool call in the UI and confirm that the checkout tool itself produced the returned case rows for the supplied seed. To distinguish it from the prebuilt example, use seed `cursor-smoke-17`; the expected order reference is `8ZS4BP`. No endpoints should be contacted.

The identical adapter, generator and MCP configuration were also exercised in Windows Cursor Free during the private 0.1.1 test. The native tool returned the synthetic 99-accept / 100-reject pair. The test establishes behavior of the shared runtime, not auto-discovery of the 0.1.2 package manifest.

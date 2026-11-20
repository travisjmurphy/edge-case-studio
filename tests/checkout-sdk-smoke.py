"""Optional QA only. Uses an already-installed MCP Python SDK; never required by server."""
import asyncio, json, shutil
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    root = Path(__file__).resolve().parents[1]
    entry = json.loads((root / 'mcp.json').read_text())['mcpServers']['checkout-fixtures']
    node = shutil.which(entry['command'])
    if not node:
        raise RuntimeError('Node not available')
    args = [a.replace('${CURSOR_PLUGIN_ROOT}', str(root)) for a in entry['args']]
    async with stdio_client(StdioServerParameters(command=node, args=args)) as (reader, writer):
        async with ClientSession(reader, writer) as session:
            hi = await session.initialize()
            listing = await session.list_tools()
            assert [tool.name for tool in listing.tools] == ['checkout_quantity_pair']
            for boundary, quantities in [('maximum', [99, 100]), ('minimum', [1, 0])]:
                result = await session.call_tool('checkout_quantity_pair', {'boundary': boundary})
                assert not result.isError
                view = json.loads(result.content[0].text)
                assert view['counts'] == {'total': 45, 'accept': 17, 'reject': 28}
                assert [c['payload']['lineItem']['quantity'] for c in view['cases']] == quantities
                assert view['cases'][1]['expectedErrors'] == [{'pointer': '/lineItem/quantity', 'rule': boundary}]
            refused = await session.call_tool('checkout_quantity_pair', {'path': 'not-supported'})
            assert refused.isError
            print(f'SDK initialized ({hi.protocolVersion}); one tool; upper and lower fixtures; unaccepted path input refused.')

if __name__ == '__main__':
    if not __debug__: raise SystemExit('Checks require normal Python (no -O).')
    asyncio.run(main())

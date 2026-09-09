# Checking Arrange against the displayed board

Start the local app (`npm run dev`). Run:

```powershell
node tools/audit-board.mjs 'C:/Users/jack/Downloads/oil.json' artifacts/route-audit/oil-original
node tools/audit-board.mjs 'C:/Users/jack/Downloads/oil.json' artifacts/route-audit/oil-arranged --arrange
```

Successful output is exactly two integers: **crossings, total wire length in
board pixels**. Length is Euclidean centerline length, summed before rounding;
decorative crossing hops are not extra length. Crossings are pairwise crossings
of continuing paths, including at bends or subdivisions. Shared endpoints,
tangential touches and collinear overlaps are separate diagnostics in the JSON,
not counted as crossings. Three wires crossing at one point count as three pairs.

The tool loads a plan in an isolated Chromium profile, uses the actual View
options → Arrange button when requested, and waits for every installed route to
match the current solve signature and for geometry to stabilize. It reads the
installed paths, without rerouting a reconstruction. No screenshots are taken.
The profile uses default device settings; router tuning is saved in the audit.
`AUDIT_URL` and `AUDIT_CHROME` override the local app URL and Chrome executable.
The default executable is the newest local Playwright Chromium installation.

`<prefix>.plan.json` is the exact project from the app's store for independent
human checking. `<prefix>.audit.json` preserves inputs, tuning, installed paths,
and located intersection events. Import the saved plan into the same local app
with matching device tuning to check the reported number. Production may be on
different code and device tuning does not travel in a plan.

The earlier segment-only benchmark excludes every segment endpoint. Splitting
a straight wire at a crossing could therefore change its count from one to zero.
The independent audit tests pin subdivision invariance and distinguish an actual
crossing at a bend from a bend that only touches another wire. The arranger's old
judge has deliberately not been replaced yet: first validate these measurements
against the user's count on the same saved board.

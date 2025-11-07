'use client';

type Cell = { cell_index: number; col: number; row: number };
type RosterItem = { flyer_id: string; roster_index: number };

function computeBounds(cells: Cell[]) {
  if (!cells.length) return { minCol: -3, maxCol: 3, minRow: -3, maxRow: 3 };
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (const { col, row } of cells) {
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
  }
  return { minCol, maxCol, minRow, maxRow };
}

export default function StepMappingVisual({
  cells,
  roster,                         // ordered by roster_index ascending
  assignments,                    // { flyer_id, formation_cell_index }[]
  cellSize = 32,
  viewRotationDeg = 0,
}: {
  cells: Cell[];
  roster: RosterItem[];
  assignments: { flyer_id: string; formation_cell_index: number }[];
  cellSize?: number;
  viewRotationDeg?: number;
}) {
  // ---- Build lookups --------------------------------------------------------
  // Map flyer_id -> roster number (1..N)
  const rosterNumber = new Map<string, number>();
  roster.forEach((r, i) => rosterNumber.set(r.flyer_id, i + 1));

  // Map cell_index -> roster number / flyer_id
  const labelByCell = new Map<number, number>();
  const flyerByCell = new Map<number, string>();
  for (const a of assignments) {
    const n = rosterNumber.get(a.flyer_id);
    if (n != null) {
      labelByCell.set(a.formation_cell_index, n);
      flyerByCell.set(a.formation_cell_index, a.flyer_id);
    }
  }

  // ---- Grid geometry + viewport --------------------------------------------
  const { minCol, maxCol, minRow, maxRow } = computeBounds(cells);
  const cols = Math.max(0, maxCol - minCol + 1);
  const rows = Math.max(0, maxRow - minRow + 1);

  const widthPx = cols * cellSize;
  const heightPx = rows * cellSize;

  // Clip in a square viewport and scale-to-fit when rotated
  const viewportPx = 420; // tweak if you want larger/smaller
  const theta = (viewRotationDeg * Math.PI) / 180;
  const rotW = Math.abs(widthPx * Math.cos(theta)) + Math.abs(heightPx * Math.sin(theta));
  const rotH = Math.abs(widthPx * Math.sin(theta)) + Math.abs(heightPx * Math.cos(theta));
  const scale = Math.min(1, viewportPx / Math.max(rotW, rotH));

  // Quick lookup: (col,row) -> cell_index
  const indexByPos = new Map<string, number>();
  for (const c of cells) indexByPos.set(`${c.col},${c.row}`, c.cell_index);

  // ---- UI -------------------------------------------------------------------
  return (
    <div className="space-y-4">
      {/* Numbered roster ABOVE the visual grid */}
      <section className="rounded border bg-white p-3">
        <div className="font-semibold text-sm mb-2">Roster</div>
        {roster.length === 0 ? (
          <div className="text-xs text-amber-700">
            No roster saved for this sequence yet. Save a roster to see numbered slots.
          </div>
        ) : (
          <div className="max-h-56 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-600">
                  <th className="w-12 pr-2">#</th>
                  <th>Flyer</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r, i) => (
                  <tr key={r.flyer_id}>
                    <td className="py-1 pr-2 font-mono tabular-nums">{i + 1}</td>
                    <td className="py-1">{r.flyer_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Formation grid (rotated), numbers upright */}
      <section className="rounded border bg-white p-3">
        <div className="font-semibold text-sm mb-2">Formation</div>

        {cells.length === 0 ? (
          <div className="text-xs text-gray-600">This formation has no cells yet.</div>
        ) : (
          <div className="relative w-full max-w-[420px] aspect-square overflow-hidden rounded border">
            <div
              className="absolute left-1/2 top-1/2"
              style={{
                width: widthPx,
                height: heightPx,
                transform: `translate(-50%, -50%) rotate(${viewRotationDeg}deg) scale(${scale})`,
                transformOrigin: 'center',
              }}
            >
              <div
                className="grid bg-gray-300 p-px rounded"
                style={{
                  gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
                  gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
                }}
              >
                {Array.from({ length: rows }).map((_, rIdx) =>
                  Array.from({ length: cols }).map((_, cIdx) => {
                    const col = minCol + cIdx;
                    const row = minRow + rIdx;
                    const key = `${col},${row}`;
                    const cellIndex = indexByPos.get(key);
                    const isCell = cellIndex != null;
                    const label = isCell ? labelByCell.get(cellIndex!) : undefined;
                    const flyer = isCell ? flyerByCell.get(cellIndex!) : undefined;

                    return (
                      <div
                        key={key}
                        className={`flex items-center justify-center ${
                          isCell ? 'bg-white' : 'bg-gray-300'
                        }`}
                        style={{ width: cellSize, height: cellSize }}
                        title={isCell && label != null ? `#${label} ${flyer}` : undefined}
                      >
                        {isCell && (
                          // Tile stays rotated with the grid; only the NUMBER text is counter‑rotated
                          <div
                            className={`flex items-center justify-center rounded ${
                              label != null ? 'bg-black text-white' : 'bg-white text-gray-400 border'
                            }`}
                            style={{ width: cellSize - 8, height: cellSize - 8, fontSize: 12 }}
                          >
                            <span
                              className="inline-block"
                              style={{ transform: `rotate(${-viewRotationDeg}deg)` }}
                            >
                              {label != null ? label : '–'}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        <div className="text-[11px] text-gray-500 mt-2">
          Rotation is for <strong>view</strong> only; rules &amp; differences use the canonical grid.
        </div>
      </section>
    </div>
  );
}

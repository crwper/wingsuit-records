'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Cell = { cell_index: number; col: number; row: number };
type RosterItem = { flyer_id: string; roster_index: number };
type Assignment = { flyer_id: string; formation_cell_index: number };

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
  sequenceId,
  stepId,
  cells,
  roster,                         // ordered by roster_index ascending
  assignments,                    // current server mapping
  cellSize = 32,
  viewRotationDeg = 0,
}: {
  sequenceId: string;
  stepId: string;
  cells: Cell[];
  roster: RosterItem[];
  assignments: Assignment[];
  cellSize?: number;
  viewRotationDeg?: number;
}) {
  const router = useRouter();
  const supabase = createClient();

  // --- Local, optimistic mapping state (kept in sync with props) -------------
  const [localAssign, setLocalAssign] = useState<Assignment[]>(assignments);
  useEffect(() => setLocalAssign(assignments), [assignments]);

  // flyer_id -> roster number (1..N)
  const rosterNumber = useMemo(() => {
    const m = new Map<string, number>();
    roster.forEach((r, i) => m.set(r.flyer_id, i + 1));
    return m;
  }, [roster]);

  // cell_index -> flyer_id (from localAssign)
  const flyerByCell = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of localAssign) m.set(a.formation_cell_index, a.flyer_id);
    return m;
  }, [localAssign]);

  // --- Drag state ------------------------------------------------------------
  const [dragOrigin, setDragOrigin] = useState<number | null>(null); // cell_index
  const [hoverCell, setHoverCell] = useState<number | null>(null);   // cell_index
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const dragging = dragOrigin !== null;

  // Resolve which flyer is visually in a given cell considering swap preview
  function renderedFlyerForCell(idx: number): string | null {
    const origin = dragOrigin;
    const hover  = hoverCell;
    let flyer = flyerByCell.get(idx) ?? null;
    if (origin != null && hover != null && hover !== origin) {
      if (idx === origin) flyer = flyerByCell.get(hover) ?? null;
      else if (idx === hover) flyer = flyerByCell.get(origin) ?? null;
    }
    return flyer;
  }

  function renderedLabelForCell(idx: number): number | null {
    const flyer = renderedFlyerForCell(idx);
    if (!flyer) return null;
    return rosterNumber.get(flyer) ?? null;
  }

  async function commitSwap(origin: number, target: number) {
    const flyerA = flyerByCell.get(origin);
    const flyerB = flyerByCell.get(target);
    if (!flyerA || !flyerB) return; // ignore invalid
    setErrorMsg(null);

    // Optimistic local update
    setLocalAssign((prev) => prev.map((a) => {
      if (a.flyer_id === flyerA) return { ...a, formation_cell_index: target };
      if (a.flyer_id === flyerB) return { ...a, formation_cell_index: origin };
      return a;
    }));

    // Commit to DB
    const { error } = await supabase.rpc('swap_step_flyers', {
      p_sequence_step_id: stepId,
      p_flyer_a: flyerA,
      p_flyer_b: flyerB,
    });

    if (error) {
      // Roll back local change on error
      setLocalAssign((prev) => prev.map((a) => {
        if (a.flyer_id === flyerA) return { ...a, formation_cell_index: origin };
        if (a.flyer_id === flyerB) return { ...a, formation_cell_index: target };
        return a;
      }));
      setErrorMsg(error.message);
    } else {
      // Refresh server components (counts, etc.)
      router.refresh();
    }
  }

  function onPointerDownCell(idx: number) {
    const flyer = flyerByCell.get(idx);
    if (!flyer) return; // only start drag if a flyer is present
    setDragOrigin(idx);
    setHoverCell(idx);
  }

  function onPointerEnterCell(idx: number) {
    if (!dragging) return;
    setHoverCell(idx);
  }

  function onPointerUp() {
    if (dragOrigin != null && hoverCell != null && hoverCell !== dragOrigin) {
      void commitSwap(dragOrigin, hoverCell);
    }
    setDragOrigin(null);
    setHoverCell(null);
  }

  // --- Grid geometry + viewport --------------------------------------------
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
  const indexByPos = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cells) m.set(`${c.col},${c.row}`, c.cell_index);
    return m;
  }, [cells]);

  return (
    <div className="space-y-4">
      {/* Numbered roster ABOVE the visual grid */}
      <section className="rounded border bg-white p-4">
        <div className="font-semibold text-sm mb-1">Roster</div>
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
              <tbody className="leading-5">
                {roster.map((r, i) => (
                  <tr key={r.flyer_id}>
                    <td className="pr-2 font-mono tabular-nums py-0.5">{i + 1}</td>
                    <td className="py-0.5">{r.flyer_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Formation grid (rotated), numbers upright; drag-to-swap */}
      <section className="rounded border bg-white p-4">
        <div className="font-semibold text-sm mb-2">Formation</div>

        {cells.length === 0 ? (
          <div className="text-xs text-gray-600">This formation has no cells yet.</div>
        ) : (
          <div
            className="relative w-full max-w-[420px] aspect-square overflow-hidden rounded border select-none"
            onPointerUp={onPointerUp}
          >
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
                    const label = isCell ? renderedLabelForCell(cellIndex!) : null;
                    const flyer = isCell ? renderedFlyerForCell(cellIndex!) : null;

                    // Decorations for origin/hover during drag
                    const isOrigin = dragging && isCell && cellIndex === dragOrigin;
                    const isHover  = dragging && isCell && cellIndex === hoverCell;

                    // Draggable only if this cell currently has a flyer (in original mapping)
                    const hasFlyerOriginal = isCell ? (flyerByCell.get(cellIndex!) != null) : false;
                    const canStartDrag = !!hasFlyerOriginal;

                    return (
                      <div
                        key={key}
                        className={[
                          'relative flex items-center justify-center',
                          isCell ? 'bg-white' : 'bg-gray-300',
                          canStartDrag ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-not-allowed',
                          (isOrigin || isHover) ? 'ring-2' : '',
                          isOrigin ? 'ring-blue-500' : '',
                          isHover ? 'ring-amber-500' : '',
                        ].join(' ')}
                        style={{ width: cellSize, height: cellSize }}
                        title={isCell && label != null ? `#${label} ${flyer ?? ''}` : undefined}
                        onPointerDown={isCell ? () => onPointerDownCell(cellIndex!) : undefined}
                        onPointerEnter={isCell ? () => onPointerEnterCell(cellIndex!) : undefined}
                      >
                        {isCell && (
                          // Tile stays rotated with the grid; only the NUMBER text is counter‑rotated
                          <div
                            className={[
                              'flex items-center justify-center rounded',
                              label != null ? 'bg-black text-white' : 'bg-white text-gray-400 border',
                              'pointer-events-none', // let the outer tile receive pointer events
                            ].join(' ')}
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
          Drag a numbered slot over another to preview; release to commit the swap.
        </div>

        {errorMsg && (
          <div className="mt-2 text-xs text-red-600">
            Error swapping: {errorMsg}
          </div>
        )}
      </section>
    </div>
  );
}

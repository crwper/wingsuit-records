'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

  // ----- roster -> label (1..N) ---------------------------------------------
  const rosterNumber = useMemo(() => {
    const m = new Map<string, number>();
    roster.forEach((r, i) => m.set(r.flyer_id, i + 1));
    return m;
  }, [roster]);

  // ----- mapping: cell_index -> {flyer_id, label} ---------------------------
  const baseMapping = useMemo(() => {
    const m = new Map<number, { flyer_id: string; label: number }>();
    for (const a of assignments) {
      const label = rosterNumber.get(a.flyer_id);
      if (label != null) m.set(a.formation_cell_index, { flyer_id: a.flyer_id, label });
    }
    return m;
  }, [assignments, rosterNumber]);

  const [mapping, setMapping] = useState(baseMapping);
  useEffect(() => setMapping(baseMapping), [baseMapping]);

  // ----- geometry & transforms ----------------------------------------------
  const { minCol, maxCol, minRow, maxRow } = computeBounds(cells);
  const cols = Math.max(0, maxCol - minCol + 1);
  const rows = Math.max(0, maxRow - minRow + 1);

  const widthPx  = cols * cellSize;
  const heightPx = rows * cellSize;

  const theta = (viewRotationDeg * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState<number>(420); // actual px of the square box
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const box = entry.contentBoxSize?.[0];
      const w = box ? box.inlineSize : el.getBoundingClientRect().width;
      setViewportSize(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Grid is rotated+scaled to fit the square viewport
  const rotW = Math.abs(widthPx * cosT) + Math.abs(heightPx * sinT);
  const rotH = Math.abs(widthPx * sinT) + Math.abs(heightPx * cosT);
  const scale = Math.min(1, viewportSize / Math.max(rotW, rotH));

  // position lookup: (col,row) -> cell_index
  const indexByPos = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cells) m.set(`${c.col},${c.row}`, c.cell_index);
    return m;
  }, [cells]);

  // ----- drag state & ghost --------------------------------------------------
  const [dragOrigin, setDragOrigin] = useState<number | null>(null); // cell_index
  const [hoverCell, setHoverCell]   = useState<number | null>(null); // cell_index under pointer (assigned)
  const [dragging, setDragging]     = useState(false);
  const [ghost, setGhost]           = useState<{ x: number; y: number } | null>(null); // viewport-local coords
  const [err, setErr]               = useState<string | null>(null);

  const dragOriginSlot = dragOrigin != null ? mapping.get(dragOrigin) ?? null : null;

  // ----- hit-testing in rotated/scaled space --------------------------------
  function hitTest(localX: number, localY: number): number | null {
    const vx = localX - viewportSize / 2;
    const vy = localY - viewportSize / 2;

    const gxScaled = vx / scale;
    const gyScaled = vy / scale;

    // rotate by -theta
    const gx =  cosT * gxScaled + sinT * gyScaled;
    const gy = -sinT * gxScaled + cosT * gyScaled;

    // translate to grid's top-left
    const ux = gx + widthPx  / 2;
    const uy = gy + heightPx / 2;

    if (ux < 0 || uy < 0 || ux >= widthPx || uy >= heightPx) return null;

    const cIdx = Math.floor(ux / cellSize);
    const rIdx = Math.floor(uy / cellSize);
    const col  = minCol + cIdx;
    const row  = minRow + rIdx;
    return indexByPos.get(`${col},${row}`) ?? null;
  }

  function localPoint(e: React.PointerEvent | PointerEvent) {
    const el = viewportRef.current!;
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ----- pointer handlers (container-level) ----------------------------------
  function onPointerMove(e: React.PointerEvent) {
    const pt = localPoint(e);
    setGhost(pt);

    const idx = hitTest(pt.x, pt.y);
    if (dragging) {
      if (idx != null && mapping.get(idx)) {
        // while dragging, you can only drop on an assigned cell
        setHoverCell(idx === dragOrigin ? null : idx);
      } else {
        setHoverCell(null);
      }
    } else {
      setHoverCell(idx != null && mapping.get(idx) ? idx : null);
    }
  }

  function onPointerEnter(e: React.PointerEvent) {
    onPointerMove(e);
  }

  function onPointerLeave() {
    if (!dragging) {
      setHoverCell(null);
      setGhost(null);
    } else {
      setHoverCell(null);
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    const pt = localPoint(e);
    const idx = hitTest(pt.x, pt.y);
    if (idx == null) return;
    const slot = mapping.get(idx);
    if (!slot) return; // only start from assigned cells

    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setErr(null);
    setDragOrigin(idx);
    setHoverCell(null); // origin is now blank; hover is whichever you move over
    setDragging(true);
    setGhost(pt);
  }

  async function onPointerUp() {
    const origin = dragOrigin;
    const target = hoverCell;
    setDragging(false);

    if (origin == null || target == null || origin === target) {
      // cancel
      setDragOrigin(null);
      setHoverCell(null);
      setGhost(null);
      return;
    }

    const A = mapping.get(origin);
    const B = mapping.get(target);
    if (!A || !B) {
      setDragOrigin(null);
      setHoverCell(null);
      setGhost(null);
      return;
    }

    // optimistic swap
    setMapping(prev => {
      const m = new Map(prev);
      m.set(origin, B);
      m.set(target, A);
      return m;
    });

    const { error } = await supabase.rpc('swap_step_flyers', {
      p_sequence_step_id: stepId,
      p_flyer_a: A.flyer_id,
      p_flyer_b: B.flyer_id,
    });

    if (error) {
      // rollback
      setMapping(prev => {
        const m = new Map(prev);
        m.set(origin, A);
        m.set(target, B);
        return m;
      });
      setErr(error.message);
    }

    setDragOrigin(null);
    setHoverCell(null);
    setGhost(null);

    // Keep server-side counts etc. up to date
    router.refresh();
  }

  // dynamic cursor: hand over assigned slots, grabbing while dragging
  const cursorStyle = dragging ? 'grabbing' : (hoverCell != null ? 'grab' : 'default');

  // ----- UI ------------------------------------------------------------------
  return (
    <div className="space-y-4">
      {/* Roster (spacing like your editor) */}
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

      {/* Formation grid with drag-to-swap + ghost */}
      <section className="rounded border bg-white p-4">
        <div className="font-semibold text-sm mb-2">Formation</div>

        {cells.length === 0 ? (
          <div className="text-xs text-gray-600">This formation has no cells yet.</div>
        ) : (
          <div
            ref={viewportRef}
            className="relative w-full max-w-[420px] aspect-square overflow-hidden rounded border select-none"
            style={{ touchAction: 'none', cursor: cursorStyle as any }}
            onPointerEnter={onPointerEnter}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
          >
            {/* Rotated & scaled grid */}
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

                    const slot = isCell ? mapping.get(cellIndex!) : undefined;
                    let label = slot?.label ?? null;

                    // Is this the hovered drop spot (always dashed blank)?
                    const isDropSpot =
                      dragging && isCell && hoverCell === cellIndex && hoverCell !== dragOrigin;

                    // Should the origin be hidden (no tile at origin → only ghost visible)?
                    const hideOriginOnlyGhost =
                      dragging && isCell && cellIndex === dragOrigin && (!hoverCell || hoverCell === dragOrigin);

                    // Live preview at origin: if hovering a *different* target, show the target's label at the origin
                    if (dragging && isCell && cellIndex === dragOrigin && hoverCell && hoverCell !== dragOrigin) {
                      const targetSlot = mapping.get(hoverCell);
                      label = targetSlot?.label ?? null;
                    }

                    // BLANK ORIGIN while dragging
                    const isBlankOrigin   = dragging && cellIndex === dragOrigin;
                    // BLANK HOVER target while dragging (if different from origin)
                    const isBlankDropSpot = dragging && cellIndex === hoverCell && hoverCell !== dragOrigin;
                    const isBlank = isBlankOrigin || isBlankDropSpot;

                    // Draggable iff this cell currently has an assignment
                    const isDraggable = isCell && !!slot;

                    return (
                      <div
                        key={key}
                        className={[
                          'flex items-center justify-center',
                          isCell ? 'bg-white' : 'bg-gray-300',
                          isDraggable ? 'cursor-pointer cursor-grab active:cursor-grabbing' : 'cursor-not-allowed',
                        ].join(' ')}
                        style={{ width: cellSize, height: cellSize, userSelect: 'none' }}
                        title={(!isBlank && label != null && slot) ? `#${label} ${slot.flyer_id}` : undefined}
                      >
                        {/* 1) Hovered target: dashed blank drop spot */}
                        {isCell && isDropSpot && (
                          <div
                            className="rounded border border-dashed border-gray-400 bg-white pointer-events-none"
                            style={{ width: cellSize - 8, height: cellSize - 8 }}
                          />
                        )}

                        {/* 2) Origin hidden when no valid target (only ghost shows) */}
                        {isCell && hideOriginOnlyGhost && null}

                        {/* 3) Everything else: normal tile (includes live preview label at origin) */}
                        {isCell && !isDropSpot && !hideOriginOnlyGhost && (
                          <div
                            className={`flex items-center justify-center rounded ${
                              label != null ? 'bg-black text-white' : 'bg-white text-gray-400 border'
                            } pointer-events-none`}
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

            {/* Ghost tile (semi-transparent), follows cursor; pointer-events: none */}
            {dragging && dragOriginSlot && ghost && (
              <div
                className="pointer-events-none absolute z-10 will-change-transform"
                style={{
                  left: ghost.x,
                  top: ghost.y,
                  transform: `translate(-50%, -50%) rotate(${viewRotationDeg}deg) scale(${scale})`,
                  transformOrigin: 'center',
                  opacity: 0.75,
                }}
              >
                <div
                  className="flex items-center justify-center"
                  style={{ width: cellSize, height: cellSize }}
                >
                  <div
                    className="flex items-center justify-center rounded bg-black text-white shadow-md"
                    style={{ width: cellSize - 8, height: cellSize - 8, fontSize: 12 }}
                  >
                    <span
                      className="inline-block"
                      style={{ transform: `rotate(${-viewRotationDeg}deg)` }}
                    >
                      {dragOriginSlot.label}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="text-[11px] text-gray-500 mt-2">
          Pick up a slot and drag it; both the origin and hovered cell appear blank. Release to commit the swap.
        </div>

        {err && <div className="mt-2 text-xs text-red-600">Error swapping: {err}</div>}
      </section>
    </div>
  );
}

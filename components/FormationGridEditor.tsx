'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Cell = { col: number; row: number };

function key(col: number, row: number) {
  return `${col},${row}`;
}

function computeBounds(cells: Cell[]) {
  if (!cells || cells.length === 0) return { minCol: -6, maxCol: 6, minRow: -6, maxRow: 6 };
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (const { col, row } of cells) {
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
  }
  return { minCol: minCol - 2, maxCol: maxCol + 2, minRow: minRow - 2, maxRow: maxRow + 2 };
}

export default function FormationGridEditor({
  formationId,
  initialCells,
  viewRotationDeg = 0,
}: {
  formationId: string;
  initialCells: Cell[];
  viewRotationDeg?: number;
}) {
  const [cellSet, setCellSet] = useState<Set<string>>(
    () => new Set(initialCells.map((c) => key(c.col, c.row))),
  );
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [bounds, setBounds] = useState(() => computeBounds(initialCells));
  const [rotation, setRotation] = useState<number>(viewRotationDeg);

  useEffect(() => {
    if (initialCells.length > 0) setBounds(computeBounds(initialCells));
  }, [initialCells.length]);

  const cols = useMemo(() => {
    const arr: number[] = [];
    for (let c = bounds.minCol; c <= bounds.maxCol; c++) arr.push(c);
    return arr;
  }, [bounds]);

  const rows = useMemo(() => {
    const arr: number[] = [];
    for (let r = bounds.minRow; r <= bounds.maxRow; r++) arr.push(r);
    return arr;
  }, [bounds]);

  function has(col: number, row: number) {
    return cellSet.has(key(col, row));
  }

  function toggle(col: number, row: number) {
    setInfo(null);
    setError(null);
    const k = key(col, row);
    setCellSet((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function expand(delta: number) {
    setBounds((b) => ({
      minCol: b.minCol - delta,
      maxCol: b.maxCol + delta,
      minRow: b.minRow - delta,
      maxRow: b.maxRow + delta,
    }));
  }

  async function onSaveCells() {
    setError(null);
    setInfo(null);
    const supabase = createClient();
    const payload = Array.from(cellSet).map((s) => {
      const [col, row] = s.split(',').map(Number);
      return { col, row };
    });
    const { error } = await supabase.rpc('save_formation_cells', {
      p_formation_id: formationId,
      p_cells: payload,
    });
    if (error) setError(error.message);
    else setInfo('Cells saved.');
  }

  async function onSaveRotation() {
    setError(null);
    setInfo(null);
    const supabase = createClient();
    const normalized = (((rotation % 360) + 360) % 360);
    const { error } = await supabase.rpc('set_formation_view_rotation', {
      p_formation_id: formationId,
      p_deg: normalized,
    });
    if (error) setError(error.message);
    else setInfo('Rotation saved.');
  }

  function stepRotation(delta: number) {
    setRotation((r) => {
      const next = (((r + delta) % 360) + 360) % 360;
      const snapped = Math.round(next / 45) * 45;
      return snapped % 360;
    });
  }

  // --- Viewport & scale-to-fit for the rotated grid ---
  const cellPx = 24;
  const widthPx  = cols.length * cellPx;
  const heightPx = rows.length * cellPx;

  const viewportPx = 420; // change if you want bigger/smaller frame
  const theta = (rotation * Math.PI) / 180;
  const rotW = Math.abs(widthPx  * Math.cos(theta)) + Math.abs(heightPx * Math.sin(theta));
  const rotH = Math.abs(widthPx  * Math.sin(theta)) + Math.abs(heightPx * Math.cos(theta));
  const scale = Math.min(1, viewportPx / Math.max(rotW, rotH));

  return (
    <div className="space-y-3">
      {/* TOP BAR — rotation controls (restored) */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">
          View: cols {bounds.minCol}..{bounds.maxCol}, rows {bounds.minRow}..{bounds.maxRow}
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm text-muted-foreground">Rotation: {rotation}°</div>
          <button onClick={() => stepRotation(-45)} className="rounded border px-2 py-1 text-sm">↺ −45°</button>
          <button onClick={() => stepRotation(+45)} className="rounded border px-2 py-1 text-sm">↻ +45°</button>
          <button onClick={() => setRotation(0)} className="rounded border px-2 py-1 text-sm">Reset</button>
          <button onClick={onSaveRotation} className="rounded border px-3 py-1 text-sm hover:bg-control-hover">
            Save rotation
          </button>
        </div>
      </div>

      {/* CLIPPED, CENTERED, SCALED VIEWPORT */}
      <div className="relative w-full max-w-[420px] aspect-square overflow-hidden rounded border mx-auto">
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            width: widthPx,
            height: heightPx,
            transform: `translate(-50%, -50%) rotate(${rotation}deg) scale(${scale})`,
            transformOrigin: 'center',
          }}
        >
          <div
            className="grid gap-px bg-gray-300 p-px rounded"
            style={{ gridTemplateColumns: `repeat(${cols.length}, ${cellPx}px)` }}
          >
            {rows.map((row) =>
              cols.map((col) => {
                const active = has(col, row);
                return (
                  <button
                    key={`${col}:${row}`}
                    onClick={() => toggle(col, row)}
                    className={`w-6 h-6 ${active ? 'bg-formation-pixel-on' : 'bg-formation-pixel-off'} hover:opacity-80 focus:outline-none`}
                    title={`(${col}, ${row})`}
                  />
                );
              }),
            )}
          </div>
        </div>
      </div>

      {/* FOOTER — cells actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-muted-foreground">
          Click to toggle cells. Save enforces 4-neighbor connectivity on the server.
        </div>
        <div className="flex gap-2">
          <button onClick={() => expand(1)} className="rounded border px-3 py-1 text-sm hover:bg-control-hover">Expand</button>
          <button onClick={() => setCellSet(new Set())} className="rounded border px-3 py-1 text-sm hover:bg-control-hover">Clear</button>
          <button onClick={onSaveCells} className="rounded border px-3 py-1 text-sm hover:bg-control-hover">Save cells</button>
        </div>
      </div>

      {error && <div className="text-sm text-red-600">Error: {error}</div>}
      {info && <div className="text-sm text-green-700">{info}</div>}
    </div>
  );
}

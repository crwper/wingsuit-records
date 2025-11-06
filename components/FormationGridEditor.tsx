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
}: {
  formationId: string;
  initialCells: Cell[];
}) {
  const [cellSet, setCellSet] = useState<Set<string>>(
    () => new Set(initialCells.map((c) => key(c.col, c.row))),
  );
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [bounds, setBounds] = useState(() => computeBounds(initialCells));

  useEffect(() => {
    // When opening an existing formation with cells, fit the view
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

  async function onSave() {
    setError(null);
    setInfo(null);

    const supabase = createClient();
    const payload = Array.from(cellSet).map((s) => {
      const [col, row] = s.split(',').map(Number);
      return { col, row };
    });

    const { error } = await supabase.rpc('save_formation_cells', {
      p_formation_id: formationId,
      p_cells: payload, // JS object → sent as JSONB
    });

    if (error) {
      setError(error.message);
    } else {
      setInfo('Saved.');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          View: cols {bounds.minCol}..{bounds.maxCol}, rows {bounds.minRow}..{bounds.maxRow}
        </div>
        <div className="flex gap-2">
          <button onClick={() => expand(1)} className="rounded border px-2 py-1 text-sm">
            Expand
          </button>
          <button onClick={() => setCellSet(new Set())} className="rounded border px-2 py-1 text-sm">
            Clear
          </button>
          <button onClick={onSave} className="rounded bg-black px-3 py-1.5 text-white text-sm">
            Save
          </button>
        </div>
      </div>

      <div
        className="grid gap-px bg-gray-300 p-px rounded"
        style={{ gridTemplateColumns: `repeat(${cols.length}, 24px)` }}
      >
        {rows.map((row) =>
          cols.map((col) => {
            const active = has(col, row);
            return (
              <button
                key={`${col}:${row}`}
                onClick={() => toggle(col, row)}
                className={`w-6 h-6 ${active ? 'bg-black' : 'bg-white'} hover:opacity-80 focus:outline-none`}
                title={`(${col}, ${row})`}
              />
            );
          }),
        )}
      </div>

      <div className="text-xs text-gray-600">
        Click to toggle cells. Save enforces 4‑neighbor connectivity on the server.
      </div>

      {error && <div className="text-sm text-red-600">Error: {error}</div>}
      {info && <div className="text-sm text-green-700">{info}</div>}
    </div>
  );
}

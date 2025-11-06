// components/WhereClient.tsx
'use client';

import { useEffect } from 'react';

export default function WhereClient() {
  useEffect(() => {
    console.log("[Client] Mounted WhereClient"); // appears in browser DevTools
  }, []);

  return (
    <div style={{ padding: '8px 0' }}>
      <strong>Client component:</strong> open DevTools → Console to see logs
    </div>
  );
}

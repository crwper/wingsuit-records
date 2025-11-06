// components/WhereServer.tsx
export default function WhereServer() {
  console.log("[Server] Rendering WhereServer"); // appears in terminal
  const when = new Date().toISOString();
  return (
    <div style={{ padding: '8px 0' }}>
      <strong>Server component:</strong> rendered at {when}
    </div>
  );
}

export function ActionError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p className="rounded-md border border-bad/30 bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">
      {error}
    </p>
  );
}

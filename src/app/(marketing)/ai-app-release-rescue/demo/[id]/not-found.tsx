export default function RescueDemoNotFound() {
  return (
    <div className="mx-auto max-w-xl px-5 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">That demo request is gone</h1>
      <p className="mt-4 text-ink-soft">
        Demo engagements live in this server’s memory. A restart, another process, or an unknown id will not find
        them. Nothing was billed.
      </p>
      <p className="mt-6 text-sm">
        <a className="underline" href="/ai-app-release-rescue/intake">
          Start the intake again
        </a>
      </p>
    </div>
  );
}

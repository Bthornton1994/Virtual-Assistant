export const metadata = { title: "Security" };

const items = [
  {
    title: "Tenant isolation",
    body: "Every customer-owned row carries organization_id. Row-level security restricts reads and writes to membership. Operators see assigned work; they do not browse another tenant’s files.",
  },
  {
    title: "Authorization is not the proxy",
    body: "src/proxy.ts only routes unauthenticated visitors. Session, role, and RLS are checked again on the server for every read and mutation.",
  },
  {
    title: "Least privilege",
    body: "Integrations request only the scopes a workstream needs. Privileged Supabase keys never ship to the browser.",
  },
  {
    title: "Bounded authority",
    body: "Sensitive execution cannot enter in-progress without an approved approval | in application code and in a database trigger.",
  },
  {
    title: "Audit trail",
    body: "Logins, request changes, approvals, assignments, exports, integration access, and AI actions are written to audit_events.",
  },
  {
    title: "What we will not do",
    body: "We do not silently send, buy, publish, commit, transfer funds, or change access. We do not take custody of customer funds or practice regulated professions.",
  },
];

export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">Security</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Delegation requires a smaller key, not a master key.</h1>
      <div className="mt-12 space-y-8">
        {items.map((item) => (
          <section key={item.title}>
            <h2 className="text-xl font-semibold tracking-tight">{item.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

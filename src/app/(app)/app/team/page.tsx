import { inviteMemberAction } from "@/app/actions/requests";
import { PageHeader } from "@/components/product";
import { Button, Field, Input } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const actor = await requireClient();
  const store = getStore();
  const orgId = actor.organizationId;
  const members = orgId ? store.listMembers(actor, orgId) : [];
  return (
    <div className="space-y-8">
      <PageHeader title="Team" description="People in your organization. Operators are not listed here." />
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{m.user?.name}</p>
                  <p className="text-xs text-muted">{m.user?.email}</p>
                </td>
                <td className="px-4 py-3">{m.role.replaceAll("_", " ")}</td>
                <td className="px-4 py-3">{m.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actor.role === "client_admin" ? (
        <form action={inviteMemberAction} className="grid gap-3 rounded-xl border border-line bg-surface p-5 sm:grid-cols-4">
          <Field label="Name">
            <Input name="name" required />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" required />
          </Field>
          <Field label="Role">
            <select name="role" className="h-10 w-full rounded-md border border-line px-3 text-sm">
              <option value="client_member">Member</option>
              <option value="client_admin">Admin</option>
            </select>
          </Field>
          <div className="flex items-end">
            <Button type="submit">Invite</Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

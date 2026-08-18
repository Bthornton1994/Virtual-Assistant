import { redirect } from "next/navigation";

export const metadata = { title: "Start Delegating" };

export default function SignupPage() {
  redirect("/book");
}

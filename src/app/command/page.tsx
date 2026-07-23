// app/command/page.tsx — retired in WO-002. The revenue-first portfolio now
// lives at /dashboard (absorbed the per-client scorecard + attention rail).
// Redirect preserves any existing bookmarks/links.
import { redirect } from "next/navigation";

export default function Command() {
  redirect("/dashboard");
}

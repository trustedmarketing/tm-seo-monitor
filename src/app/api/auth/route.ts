import { makeToken, type Role } from "@/lib/authToken";

export async function POST(req: Request) {
  const { password } = await req.json();
  let role: Role | null = null;
  if (password && password === process.env.ADMIN_PASSWORD) role = "admin";
  else if (password && password === process.env.DASHBOARD_PASSWORD) role = "viewer";

  if (!role) return Response.json({ error: "Wrong password" }, { status: 401 });

  const token = await makeToken(role, process.env.CRON_SECRET!);
  return new Response(JSON.stringify({ role }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `tm_auth=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}`,
    },
  });
}

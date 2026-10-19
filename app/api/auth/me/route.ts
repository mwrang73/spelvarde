import { NextResponse } from "next/server";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

export const GET = withUser("auth/me", async ({ user }) =>
  NextResponse.json({ id: user.id, name: user.name, email: user.email, role: user.role }),
);

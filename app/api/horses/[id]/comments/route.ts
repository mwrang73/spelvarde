import { NextResponse } from "next/server";
import { COMMENT_INCLUDE, commentDto } from "@/lib/dto";
import { badRequest, isId } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withUser } from "@/lib/route";

export const dynamic = "force-dynamic";

// Användarens kommentarer om hästen från alla omgångar, nyast först.
export const GET = withUser<{ id: string }>("horses/comments", async ({ params, user }) => {
  if (!isId(params.id)) return badRequest("Ogiltig häst.");
  const comments = await prisma.horseComment.findMany({
    where: { userId: user.id, horseId: params.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: COMMENT_INCLUDE,
  });
  return NextResponse.json({ comments: comments.map(commentDto) });
});

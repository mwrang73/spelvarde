// Omslag för API-rutterna: kräver inloggad användare (färskt uppslag i
// databasen, inte bara JWT:n), fångar fel och svarar alltid med
// { error: "<svensk mening>" }. Interna fel loggas men lämnas inte ut.
import { AtgError } from "@/lib/atg";
import { FetchStepError } from "@/lib/fetch-round";
import { jsonError, serverError, unauthorized } from "@/lib/http";
import { getCurrentUser, type SessionUser } from "@/lib/session";

export type RouteCtx<P> = { req: Request; params: P; user: SessionUser };

export function withUser<P = Record<string, never>>(name: string, fn: (ctx: RouteCtx<P>) => Promise<Response>) {
  return async (req: Request, context: { params: P }) => {
    try {
      const user = await getCurrentUser();
      if (!user) return unauthorized();
      return await fn({ req, params: context?.params ?? ({} as P), user });
    } catch (e) {
      if (e instanceof FetchStepError) return jsonError(e.status, e.message);
      if (e instanceof AtgError) return jsonError(502, `${e.message}. Försök igen.`);
      return serverError(name, e);
    }
  };
}

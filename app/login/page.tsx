import { LoginForm } from "@/components/LoginForm";

export default function LoginPage({ searchParams }: { searchParams?: { next?: string | string[] } }) {
  const next = typeof searchParams?.next === "string" ? searchParams.next : null;
  return <LoginForm next={next} />;
}

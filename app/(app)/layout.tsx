import { AppShell } from "@/components/shell/AppShell";

// De inloggade sidorna (middleware skickar utloggade till /login).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

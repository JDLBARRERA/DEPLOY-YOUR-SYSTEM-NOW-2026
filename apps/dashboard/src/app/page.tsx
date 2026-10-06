import { auth } from "@/auth";
import { ControlPanel } from "@/components/control-panel";

export default async function Home() {
  const session = await auth();
  return (
    <ControlPanel
      userLabel={session?.user?.email ?? session?.user?.name ?? ""}
    />
  );
}

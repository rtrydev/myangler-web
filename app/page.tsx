import { AppShell } from "./views/AppShell";
import { EngineProvider } from "./lib/app/engine-context";

export default function Page() {
  return (
    <EngineProvider>
      <AppShell />
    </EngineProvider>
  );
}

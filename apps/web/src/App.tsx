import { formatGreeting } from "@kagami/shared";
import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";

function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-1 text-sm text-muted-foreground">
        <Rocket className="h-4 w-4" />
        PNPM Monorepo Ready
      </div>

      <h1 className="text-4xl font-bold tracking-tight">Kagami Starter</h1>
      <p className="text-muted-foreground">{formatGreeting("Web App")}</p>

      <Button>shadcn/ui Button</Button>
    </main>
  );
}

export default App;
